/**
 * Malha dos blocos que não são cubo (doc 04 §3).
 *
 * O greedy meshing trabalha com máscaras de bits de voxel cheio: planta, tocha,
 * laje e escada não cabem nele sem quebrar as máscaras. Elas saem por aqui, num
 * segundo passe sobre os mesmos 16³ da section, e entram no **mesmo buffer
 * recortado** — nada de uma terceira draw call por section.
 *
 * Duas geometrias, só:
 *
 * - **cruz** — dois quads na diagonal, dos dois lados: grama alta, flor, muda,
 *   plantação, teia. A tocha entra aqui também: a textura dela já é uma cruz e,
 *   com posição em meios-blocos (doc 01 §5.1), um poste fino não é
 *   representável.
 * - **caixas** — tudo o mais, com a lista vindo de `shapes.ts`: laje, escada,
 *   cerca, portão, alçapão, porta, grade, escada de mão, placa, quadro,
 *   trilho e camada de neve.
 *
 * **Conexão de cerca e grade é calculada aqui**, não guardada no estado
 * (doc 04 §2.5): quatro consultas de vizinho no meshing custam menos que quatro
 * bits em cada voxel do save.
 *
 * Duas limitações herdadas do formato de vértice, conscientes: `u`/`v` são
 * inteiros de 5 bits, então uma caixa parcial repete a textura inteira em vez
 * de mostrar só o pedaço correspondente; e a escada não tem variante de canto.
 */

import {
  CPLX_BOXES, CPLX_CROSS, CPLX_RAIL, stageTexOf, shapeIdOf, type BlockTables,
} from './blockinfo';
import { nbIndex } from './greedy';
import {
  BOX_STRIDE, FACING_STEP, MAX_BOXES, SHAPE_FENCE, SHAPE_FENCE_GATE, SHAPE_PANE, boxesFor,
  railSlopeDir,
} from './shapes';
import { FACE_POS_Y } from '../../render/vertex';
import type { MeshBuilder } from '../../render/mesh';

/** Cantos de cada face de uma caixa: 0 = mínimo do eixo, 1 = máximo. */
const BOX_FACES: readonly (readonly number[])[] = [
  [1, 0, 1, 1, 0, 0, 1, 1, 0, 1, 1, 1], // +X
  [0, 0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0], // −X
  [0, 1, 1, 1, 1, 1, 1, 1, 0, 0, 1, 0], // +Y
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], // −Y
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1, 1], // +Z
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 1, 0], // −Z
];

/** Vizinho de cada face, na mesma ordem de `BOX_FACES`. */
const FACE_STEP: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Buffers reusados — este passe não pode alocar por voxel. */
const CORNERS = new Float32Array(12);
const BOXES = new Float32Array(MAX_BOXES * BOX_STRIDE);

/**
 * Desenha todos os blocos complexos do interior da section.
 * Devolve quantos quads emitiu.
 */
export function meshComplex(
  blocks: Uint16Array, light: Uint8Array, tables: BlockTables, out: MeshBuilder,
): number {
  let quads = 0;
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        const state = blocks[nbIndex(x, y, z)];
        const id = state & 0x3ff;
        const kind = tables.complex[id];
        if (kind === 0) continue;

        const bits = (state >>> 10) & 0x3f;
        const tex = stageTexOf(tables, id, bits);
        const tint = tables.tint[id];
        // Luz do próprio voxel: ele é vazado, então é ele que está iluminado.
        const lightByte = light[nbIndex(x, y, z)];
        const blockLight = Math.max(lightByte & 0xf, tables.emission[id]);
        const skyLight = (lightByte >>> 4) & 0xf;

        if (kind === CPLX_CROSS) {
          quads += emitCross(out, x, y, z, tex, blockLight, skyLight, tint);
        } else if (kind === CPLX_RAIL) {
          quads += emitRail(out, x, y, z, bits & 0xf, tex, blockLight, skyLight, tint);
        } else if (kind === CPLX_BOXES) {
          const shape = shapeIdOf(tables, id);
          const links = needsConnections(shape)
            ? connectionsAt(blocks, tables, x, y, z)
            : 0;
          const count = boxesFor(shape, bits, links, BOXES);
          for (let b = 0; b < count; b++) {
            quads += emitBox(
              blocks, tables, out, x, y, z, b, count, tex, blockLight, skyLight, tint,
            );
          }
        }
      }
    }
  }
  return quads;
}

/** Formas cuja geometria depende dos vizinhos (doc 04 §2.5). */
function needsConnections(shape: number): boolean {
  return shape === SHAPE_FENCE || shape === SHAPE_PANE;
}

/**
 * Máscara de vizinhos a que uma cerca ou grade se liga: bloco opaco, outra
 * cerca/grade, ou portão. É o mínimo para uma cerca parecer uma cerca.
 */
function connectionsAt(
  blocks: Uint16Array, tables: BlockTables, x: number, y: number, z: number,
): number {
  let mask = 0;
  for (let dir = 0; dir < 4; dir++) {
    const step = FACING_STEP[dir];
    const neighbor = blocks[nbIndex(x + step[0], y, z + step[1])] & 0x3ff;
    const shape = shapeIdOf(tables, neighbor);
    const links = tables.occludes[neighbor] === 1
      || shape === SHAPE_FENCE || shape === SHAPE_PANE || shape === SHAPE_FENCE_GATE;
    if (links) mask |= 1 << dir;
  }
  return mask;
}

/** Duas diagonais do bloco, visíveis dos dois lados. */
function emitCross(
  out: MeshBuilder, x: number, y: number, z: number,
  tex: number, blockLight: number, skyLight: number, tint: number,
): number {
  setCorners(x, y, z, 0, 0, 1, 1);
  out.addPolyQuad(CORNERS, FACE_POS_Y, tex, blockLight, skyLight, tint, true);
  setCorners(x, y, z, 1, 0, 0, 1);
  out.addPolyQuad(CORNERS, FACE_POS_Y, tex, blockLight, skyLight, tint, true);
  return 2;
}

/**
 * Trilho: **um quad só**, deitado ou inclinado (M7).
 *
 * A rampa é a única geometria do jogo que não é caixa alinhada aos eixos, e é
 * por isso que ela tem um caminho próprio aqui em vez de uma forma em
 * `shapes.ts`. Os quatro cantos saem direto, como na cruz da planta.
 *
 * Visível dos dois lados: um trilho é fino, e olhar por baixo de uma ponte não
 * pode mostrar um buraco.
 */
function emitRail(
  out: MeshBuilder, x: number, y: number, z: number, shape: number,
  tex: number, blockLight: number, skyLight: number, tint: number,
): number {
  const slope = railSlopeDir(shape);
  // Alturas dos quatro cantos, na ordem (0,0) (1,0) (1,1) (0,1) em (x,z).
  const base = y + RAIL_LIFT;
  let h00 = base; let h10 = base; let h11 = base; let h01 = base;
  if (slope === 0) { h10 += 1; h11 += 1; }        // sobe para +X
  else if (slope === 1) { h00 += 1; h01 += 1; }   // sobe para −X
  else if (slope === 2) { h01 += 1; h11 += 1; }   // sobe para +Z
  else if (slope === 3) { h00 += 1; h10 += 1; }   // sobe para −Z

  CORNERS[0] = x; CORNERS[1] = h00; CORNERS[2] = z;
  CORNERS[3] = x + 1; CORNERS[4] = h10; CORNERS[5] = z;
  CORNERS[6] = x + 1; CORNERS[7] = h11; CORNERS[8] = z + 1;
  CORNERS[9] = x; CORNERS[10] = h01; CORNERS[11] = z + 1;
  out.addPolyQuad(CORNERS, FACE_POS_Y, tex, blockLight, skyLight, tint, true);
  return 1;
}

/** Quanto o trilho fica acima do chão, para não brigar com a face do bloco. */
const RAIL_LIFT = 1 / 16;

/** Plano vertical do canto `(ax,az)` ao canto `(bx,bz)` do bloco. */
function setCorners(
  x: number, y: number, z: number, ax: number, az: number, bx: number, bz: number,
): void {
  CORNERS[0] = x + ax; CORNERS[1] = y; CORNERS[2] = z + az;
  CORNERS[3] = x + bx; CORNERS[4] = y; CORNERS[5] = z + bz;
  CORNERS[6] = x + bx; CORNERS[7] = y + 1; CORNERS[8] = z + bz;
  CORNERS[9] = x + ax; CORNERS[10] = y + 1; CORNERS[11] = z + az;
}

/**
 * Uma caixa da lista, sem as faces que um vizinho opaco já esconde.
 *
 * A face só é descartada quando a caixa **encosta** naquela borda do bloco: uma
 * escada tem a face de trás colada na parede e a da frente no meio do ar.
 * Numa forma de várias caixas, só a primeira aceita esse descarte — as outras
 * podem estar erguidas do chão (o braço da cerca) e sumiriam por engano.
 */
function emitBox(
  blocks: Uint16Array, tables: BlockTables, out: MeshBuilder,
  x: number, y: number, z: number, boxIndex: number, boxCount: number,
  tex: number, blockLight: number, skyLight: number, tint: number,
): number {
  const o = boxIndex * BOX_STRIDE;
  const x0 = BOXES[o]; const y0 = BOXES[o + 1]; const z0 = BOXES[o + 2];
  const x1 = BOXES[o + 3]; const y1 = BOXES[o + 4]; const z1 = BOXES[o + 5];
  const size = [x1 - x0, y1 - y0, z1 - z0];
  if (size[0] <= 0 || size[1] <= 0 || size[2] <= 0) return 0;

  let quads = 0;
  for (let face = 0; face < 6; face++) {
    if (boxIndex === 0 && boxCount === 1 && touchesEdge(face, x0, y0, z0, x1, y1, z1)) {
      const step = FACE_STEP[face];
      const neighbor = blocks[nbIndex(x + step[0], y + step[1], z + step[2])] & 0x3ff;
      if (tables.occludes[neighbor] === 1) continue;
    }
    const corners = BOX_FACES[face];
    for (let k = 0; k < 4; k++) {
      CORNERS[k * 3] = x + x0 + corners[k * 3] * size[0];
      CORNERS[k * 3 + 1] = y + y0 + corners[k * 3 + 1] * size[1];
      CORNERS[k * 3 + 2] = z + z0 + corners[k * 3 + 2] * size[2];
    }
    out.addPolyQuad(CORNERS, face, tex, blockLight, skyLight, tint, false);
    quads++;
  }
  return quads;
}

/** true se a face da caixa coincide com a borda do bloco naquele eixo. */
function touchesEdge(
  face: number, x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
): boolean {
  if (face === 0) return x1 >= 1;
  if (face === 1) return x0 <= 0;
  if (face === 2) return y1 >= 1;
  if (face === 3) return y0 <= 0;
  if (face === 4) return z1 >= 1;
  return z0 <= 0;
}
