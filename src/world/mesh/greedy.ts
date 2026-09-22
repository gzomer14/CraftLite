/**
 * Greedy meshing binário com ambient occlusion (doc 02 §5.1 e §5.2).
 *
 * Recebe uma vizinhança **18×18×18** (a section + 1 camada de cada lado) para
 * não precisar de sincronização com o `World`, e devolve um mesh por passe.
 *
 * Duas fases:
 *
 * 1. **Binária.** Para cada eixo, monta máscaras `uint32` por coluna (18 bits)
 *    e obtém as faces visíveis com `render & ~(occlude >> 1)` — uma operação
 *    por coluna em vez de uma por voxel. Regiões vazias custam zero, que é o
 *    que faz isto ser 5–10× mais rápido que a varredura ingênua.
 * 2. **Merge.** Por fatia, monta uma grade 16×16 de "chaves de merge" que
 *    empacotam textura + luz + AO + tint. Duas faces só se fundem se a chave
 *    for idêntica — é isso que impede mesclagem excessiva e mantém a
 *    iluminação correta.
 */

import { MeshBuilder, type MeshData } from '../../render/mesh';
import { AIR } from '../../data/blocks';
import {
  LAYER_CUTOUT, LAYER_OPAQUE, LAYER_TRANSLUCENT, type BlockTables,
} from './blockinfo';
import { meshComplex } from './complex';

export const PAD = 1;
export const NB_SIDE = 18;
const NB_PLANE = NB_SIDE * NB_SIDE; // 324
const NB_VOLUME = NB_SIDE * NB_PLANE; // 5832
const S = 16;

/** Índice na vizinhança para coordenadas locais em −1..16. */
export function nbIndex(x: number, y: number, z: number): number {
  return (y + PAD) * NB_PLANE + (z + PAD) * NB_SIDE + (x + PAD);
}

/**
 * Base de cada face: normal e os dois vetores de aresta, na mesma convenção do
 * `MeshBuilder` (e1 × e2 = normal). A ordem dos cantos do AO segue e1/e2.
 */
const FACE_BASIS: readonly (readonly number[])[] = [
  // nx,ny,nz, e1x,e1y,e1z, e2x,e2y,e2z
  [1, 0, 0, 0, 0, -1, 0, 1, 0], // +X
  [-1, 0, 0, 0, 0, 1, 0, 1, 0], // -X
  [0, 1, 0, 1, 0, 0, 0, 0, -1], // +Y
  [0, -1, 0, 1, 0, 0, 0, 0, 1], // -Y
  [0, 0, 1, 1, 0, 0, 0, 1, 0], // +Z
  [0, 0, -1, -1, 0, 0, 0, 1, 0], // -Z
];

/** Eixo constante e os dois eixos tangentes (largura, altura) de cada face. */
const FACE_AXES: readonly (readonly [number, number, number])[] = [
  [0, 2, 1], [0, 2, 1], [1, 0, 2], [1, 0, 2], [2, 0, 1], [2, 0, 1],
];

/** +1 se a face olha para o lado positivo do seu eixo. */
const FACE_SIGN = [1, -1, 1, -1, 1, -1] as const;

export interface SectionMesh {
  opaque: MeshData | null;
  cutout: MeshData | null;
  translucent: MeshData | null;
  /** Total de quads emitidos — usado pelos testes e pelo debug. */
  quads: number;
}

/**
 * Estado reusável do mesher. Um por worker: alocar 60 KB de buffers a cada
 * section carregada seria o maior gerador de lixo do jogo.
 */
export class GreedyMesher {
  private readonly tables: BlockTables;
  private readonly opaque: MeshBuilder;
  private readonly cutout: MeshBuilder;
  private readonly translucent: MeshBuilder;

  /** Máscaras por eixo: [eixo][coluna] → 18 bits de ocupação. */
  private readonly renderBits: Uint32Array[] = [
    new Uint32Array(NB_PLANE), new Uint32Array(NB_PLANE), new Uint32Array(NB_PLANE),
  ];
  private readonly occludeBits: Uint32Array[] = [
    new Uint32Array(NB_PLANE), new Uint32Array(NB_PLANE), new Uint32Array(NB_PLANE),
  ];
  /** Grade de chaves de merge: 16 fatias × 16 × 16. */
  private readonly keys = new Uint32Array(S * S * S);
  private readonly ao = new Uint8Array(4);

  quads = 0;

  /**
   * Iluminação suave (doc 08 §3.11, linha "Iluminação Suave (AO)").
   *
   * Desligada, todo vértice sai com AO 3 — sem sombra de canto. Não é só
   * estética: com o AO uniforme, o merge greedy deixa de ser interrompido nas
   * bordas (`aoUniformAlongU`) e a mesma section rende **menos quads**. É o
   * caminho de fuga de quem precisa de cada vértice.
   *
   * Vale no próximo carregamento: o AO é assado no mesh, e trocá-lo ao vivo
   * significa remesar o mundo inteiro.
   */
  smoothLighting = true;

  constructor(tables: BlockTables, packed: boolean, smoothLighting = true) {
    this.tables = tables;
    this.smoothLighting = smoothLighting;
    this.opaque = new MeshBuilder(packed, 8192);
    this.cutout = new MeshBuilder(packed, 2048);
    this.translucent = new MeshBuilder(packed, 2048);
  }

  /**
   * `blocks` é a vizinhança 18³ de blockStates; `light` traz o nibble baixo =
   * luz de bloco e o alto = luz do céu, no mesmo layout.
   */
  mesh(blocks: Uint16Array, light: Uint8Array): SectionMesh {
    this.opaque.reset();
    this.cutout.reset();
    this.translucent.reset();
    this.quads = 0;

    for (const layer of [LAYER_OPAQUE, LAYER_CUTOUT, LAYER_TRANSLUCENT]) {
      this.buildBitmasks(blocks, layer);
      for (let face = 0; face < 6; face++) {
        this.meshFace(blocks, light, face, this.builderFor(layer));
      }
    }

    // Blocos que não são cubo (planta, tocha, laje) entram no mesmo buffer
    // recortado, com geometria própria — ver `mesh/complex.ts`.
    this.quads += meshComplex(blocks, light, this.tables, this.cutout);

    return {
      opaque: this.opaque.isEmpty ? null : this.opaque.build(),
      cutout: this.cutout.isEmpty ? null : this.cutout.build(),
      translucent: this.translucent.isEmpty ? null : this.translucent.build(),
      quads: this.quads,
    };
  }

  private builderFor(layer: number): MeshBuilder {
    if (layer === LAYER_CUTOUT) return this.cutout;
    if (layer === LAYER_TRANSLUCENT) return this.translucent;
    return this.opaque;
  }

  /**
   * Fase 1: uma passada por 18³ montando, para os 3 eixos, o bit de "este voxel
   * emite face neste passe" e o bit de "este voxel esconde a face do vizinho".
   */
  private buildBitmasks(blocks: Uint16Array, layer: number): void {
    for (let a = 0; a < 3; a++) {
      this.renderBits[a].fill(0);
      this.occludeBits[a].fill(0);
    }
    const t = this.tables;

    for (let y = 0; y < NB_SIDE; y++) {
      for (let z = 0; z < NB_SIDE; z++) {
        const rowBase = y * NB_PLANE + z * NB_SIDE;
        for (let x = 0; x < NB_SIDE; x++) {
          const id = blocks[rowBase + x] & 0x3ff;
          if (id === AIR) continue;

          const emits = t.isCube[id] === 1 && t.renderLayer[id] === layer;
          // Um bloco esconde a face do vizinho se é opaco; no passe translúcido,
          // água também esconde água (senão o oceano vira mil planos internos).
          const hides = t.occludes[id] === 1
            || (layer === LAYER_TRANSLUCENT && t.renderLayer[id] === LAYER_TRANSLUCENT)
            || (layer === LAYER_CUTOUT && t.renderLayer[id] === LAYER_CUTOUT && t.isCube[id] === 1);

          if (emits) {
            this.renderBits[0][y * NB_SIDE + z] |= 1 << x;
            this.renderBits[1][z * NB_SIDE + x] |= 1 << y;
            this.renderBits[2][y * NB_SIDE + x] |= 1 << z;
          }
          if (hides) {
            this.occludeBits[0][y * NB_SIDE + z] |= 1 << x;
            this.occludeBits[1][z * NB_SIDE + x] |= 1 << y;
            this.occludeBits[2][y * NB_SIDE + x] |= 1 << z;
          }
        }
      }
    }
  }

  /** Fase 2: faces visíveis por bit op, chaves de merge, e merge greedy. */
  private meshFace(
    blocks: Uint16Array, light: Uint8Array, face: number, out: MeshBuilder,
  ): void {
    const [axis, axisU, axisV] = FACE_AXES[face];
    const sign = FACE_SIGN[face];
    const render = this.renderBits[axis];
    const occlude = this.occludeBits[axis];
    const keys = this.keys;
    keys.fill(0);

    let anyFace = false;

    // Percorre as colunas paralelas ao eixo da face.
    for (let p = 0; p < NB_SIDE; p++) {
      for (let q = 0; q < NB_SIDE; q++) {
        const col = p * NB_SIDE + q;
        const r = render[col];
        if (r === 0) continue;
        // Face visível = o voxel emite e o vizinho naquele sentido não esconde.
        const o = occlude[col];
        let visible = sign > 0 ? r & ~(o >>> 1) : r & ~(o << 1);
        visible &= 0x3fffe; // só os 16 bits do interior (posições 1..16)
        if (visible === 0) continue;

        while (visible !== 0) {
          const bit = visible & -visible;
          const i = 31 - Math.clz32(bit);
          visible ^= bit;

          // Converte (coluna, bit) em coordenadas locais 0..15.
          const local = LOCAL;
          decodeColumn(axis, p, q, i, local);
          if (local[0] < 0 || local[0] > 15 || local[1] < 0 || local[1] > 15
            || local[2] < 0 || local[2] > 15) continue;

          const key = this.mergeKey(blocks, light, local[0], local[1], local[2], face);
          if (key === 0) continue;
          const slice = local[axis];
          const u = local[axisU];
          const v = local[axisV];
          keys[slice * 256 + v * 16 + u] = key;
          anyFace = true;
        }
      }
    }

    if (!anyFace) return;
    this.mergeAndEmit(keys, face, axis, axisU, axisV, out);
  }

  /** Varredura greedy clássica sobre a grade de chaves de cada fatia. */
  private mergeAndEmit(
    keys: Uint32Array, face: number, axis: number, axisU: number, axisV: number,
    out: MeshBuilder,
  ): void {
    const ao = this.ao;
    for (let slice = 0; slice < S; slice++) {
      const base = slice * 256;
      for (let v = 0; v < S; v++) {
        for (let u = 0; u < S; u++) {
          const key = keys[base + v * 16 + u];
          if (key === 0) continue;

          // Estende na largura enquanto a chave for idêntica **e** o AO não
          // variar nessa direção. Ver `aoUniformAlongU` para o porquê.
          let w = 1;
          if (aoUniformAlongU(key)) {
            while (u + w < S && keys[base + v * 16 + u + w] === key) w++;
          }

          // Depois na altura, exigindo a linha inteira igual.
          let h = 1;
          if (aoUniformAlongV(key)) {
            grow: while (v + h < S) {
              for (let n = 0; n < w; n++) {
                if (keys[base + (v + h) * 16 + u + n] !== key) break grow;
              }
              h++;
            }
          }

          for (let dv = 0; dv < h; dv++) {
            for (let du = 0; du < w; du++) keys[base + (v + dv) * 16 + u + du] = 0;
          }

          const pos = QUAD_POS;
          pos[axis] = slice;
          pos[axisU] = u;
          pos[axisV] = v;

          unpackAo(key, ao);
          out.addQuad(
            pos[0], pos[1], pos[2], face, w, h,
            key & 0x3ff, (key >>> 10) & 0xf, (key >>> 14) & 0xf,
            ao, (key >>> 26) & 0x1f,
          );
          this.quads++;
        }
      }
    }
  }

  /**
   * Chave de merge: textura, luz e AO empacotados. O bit 31 marca "existe face"
   * — sem ele, uma face de textura 0 com tudo zerado seria confundida com vazio.
   */
  private mergeKey(
    blocks: Uint16Array, light: Uint8Array, x: number, y: number, z: number, face: number,
  ): number {
    const t = this.tables;
    const state = blocks[nbIndex(x, y, z)];
    const id = state & 0x3ff;

    const basis = FACE_BASIS[face];
    const nx = basis[0], ny = basis[1], nz = basis[2];

    const texLayer = face === 2 ? t.texTop[id] : face === 3 ? t.texBottom[id] : t.texSide[id];

    // Luz vem do voxel do lado de fora — é ele que está iluminado.
    const lightByte = light[nbIndex(x + nx, y + ny, z + nz)];
    const blockLight = lightByte & 0xf;
    const skyLight = (lightByte >>> 4) & 0xf;

    const ao = this.ao;
    if (this.smoothLighting) {
      this.computeAo(blocks, x, y, z, face, ao);
    } else {
      // Tudo aceso: o merge greedy deixa de quebrar nas bordas e o mesh
      // encolhe, que é exatamente o que quem desliga o AO está comprando.
      ao[0] = 3; ao[1] = 3; ao[2] = 3; ao[3] = 3;
    }

    return (
      (texLayer & 0x3ff) |
      ((blockLight & 0xf) << 10) |
      ((skyLight & 0xf) << 14) |
      ((ao[0] & 3) << 18) | ((ao[1] & 3) << 20) | ((ao[2] & 3) << 22) | ((ao[3] & 3) << 24) |
      // Tint em 5 bits (26..30): até 32 cores, 20 em uso desde o M13.
      ((t.tint[id] & 0x1f) << 26) |
      0x80000000
    ) >>> 0;
  }

  /**
   * AO de vértice pela fórmula de 3 vizinhos do doc 02 §5.2, na ordem dos
   * cantos do quad (e1/e2), que é a mesma que o `MeshBuilder` emite.
   */
  private computeAo(
    blocks: Uint16Array, x: number, y: number, z: number, face: number, out: Uint8Array,
  ): void {
    const t = this.tables;
    const b = FACE_BASIS[face];
    // Ponto do lado de fora da face: é aí que os vizinhos ocluem.
    const px = x + b[0], py = y + b[1], pz = z + b[2];
    const e1x = b[3], e1y = b[4], e1z = b[5];
    const e2x = b[6], e2y = b[7], e2z = b[8];

    for (let k = 0; k < 4; k++) {
      const du = k === 1 || k === 2 ? 1 : -1;
      const dv = k === 2 || k === 3 ? 1 : -1;

      const s1 = solidAt(blocks, t, px + e1x * du, py + e1y * du, pz + e1z * du);
      const s2 = solidAt(blocks, t, px + e2x * dv, py + e2y * dv, pz + e2z * dv);
      const cn = solidAt(
        blocks, t, px + e1x * du + e2x * dv, py + e1y * du + e2y * dv, pz + e1z * du + e2z * dv,
      );
      out[k] = s1 === 1 && s2 === 1 ? 0 : 3 - (s1 + s2 + cn);
    }
  }

}

/** 1 se o voxel oclui para efeito de AO. Fora da vizinhança conta como vazio. */
function solidAt(blocks: Uint16Array, t: BlockTables, x: number, y: number, z: number): number {
  if (x < -1 || x > 16 || y < -1 || y > 16 || z < -1 || z > 16) return 0;
  const id = blocks[nbIndex(x, y, z)] & 0x3ff;
  return t.occludes[id];
}

/**
 * Um quad só pode ser esticado numa direção se o AO **não variar** nela.
 *
 * O quad carrega quatro valores de AO, um por canto, e a GPU interpola
 * linearmente entre eles. Fundir N blocos com o mesmo padrão de AO não é
 * equivalente a desenhá-los separados: o degradê que deveria se repetir a cada
 * bloco passa a cobrir a faixa inteira. Na prática isso aparece como um
 * triângulo escuro enorme junto de qualquer degrau — foi o artefato relatado
 * em teste no celular.
 *
 * Como os cantos seguem a base e1/e2 do quad, "não variar ao longo de e1"
 * é `ao[0] === ao[1] && ao[3] === ao[2]`. O sentido de e1 pode ser negativo em
 * algumas faces, mas isso não afeta uma comparação de igualdade.
 *
 * Em superfície plana e aberta todos os AO valem 3, então o caso comum continua
 * fundindo por inteiro — o custo fica restrito às bordas.
 */
function aoUniformAlongU(key: number): boolean {
  return ((key >>> 18) & 3) === ((key >>> 20) & 3)
    && ((key >>> 24) & 3) === ((key >>> 22) & 3);
}

function aoUniformAlongV(key: number): boolean {
  return ((key >>> 18) & 3) === ((key >>> 24) & 3)
    && ((key >>> 20) & 3) === ((key >>> 22) & 3);
}

function unpackAo(key: number, out: Uint8Array): void {
  out[0] = (key >>> 18) & 3;
  out[1] = (key >>> 20) & 3;
  out[2] = (key >>> 22) & 3;
  out[3] = (key >>> 24) & 3;
}

/**
 * Inverte `colIndex` + o bit dentro da coluna, devolvendo coordenadas locais
 * (0..15 no interior; −1 e 16 são o padding).
 */
function decodeColumn(axis: number, p: number, q: number, bit: number, out: Int32Array): void {
  const i = bit - PAD;
  if (axis === 0) {
    // colunas ao longo de X, indexadas por (y, z)
    out[0] = i;
    out[1] = p - PAD;
    out[2] = q - PAD;
  } else if (axis === 1) {
    // colunas ao longo de Y, indexadas por (z, x)
    out[0] = q - PAD;
    out[1] = i;
    out[2] = p - PAD;
  } else {
    // colunas ao longo de Z, indexadas por (y, x)
    out[0] = q - PAD;
    out[1] = p - PAD;
    out[2] = i;
  }
}

const LOCAL = new Int32Array(3);
const QUAD_POS = new Int32Array(3);

export { NB_VOLUME };
