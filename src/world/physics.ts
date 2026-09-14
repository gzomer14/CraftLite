/**
 * Colisão de AABB contra voxels (doc 06 §3).
 *
 * Um eixo por vez, na ordem **Y → X → Z**. A ordem importa: resolver Y antes
 * é o que faz o jogador pousar no chão antes de decidir se o movimento
 * horizontal está bloqueado, e é o que permite o auto-step funcionar.
 *
 * Nada aqui aloca: a AABB é um `Float32Array` de 6 e o resultado sai em campos.
 *
 * A forma de cada bloco vem de `mesh/shapes.ts`, a **mesma** tabela que desenha
 * — laje colide em meia altura, escada em dois degraus, alçapão aberto vira
 * parede. Duas tabelas divergiriam na primeira forma nova, e o jogador
 * atravessaria a escada que enxerga.
 */

import { defOf, stateBitsOf, type BlockDef } from '../data/blocks';
import {
  BOX_STRIDE, MAX_BOXES, NOT_STAIRS, SHAPE_BY_NAME, SHAPE_STAIRS, collisionBoxesFor,
  stairCornerFrom,
} from './mesh/shapes';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';

/** AABB como [minX, minY, minZ, maxX, maxY, maxZ]. */
export type Aabb = Float32Array;

export function createAabb(): Aabb {
  return new Float32Array(6);
}

/** Monta a AABB de uma entidade a partir do centro da base. */
export function setAabbFromBase(
  out: Aabb, x: number, y: number, z: number, width: number, height: number,
): void {
  const half = width / 2;
  out[0] = x - half;
  out[1] = y;
  out[2] = z - half;
  out[3] = x + half;
  out[4] = y + height;
  out[5] = z + half;
}

export function aabbIntersects(a: Aabb, b: Aabb): boolean {
  return a[0] < b[3] && a[3] > b[0]
    && a[1] < b[4] && a[4] > b[1]
    && a[2] < b[5] && a[5] > b[2];
}

/** Resultado de um movimento com colisão. */
export interface MoveResult {
  dx: number;
  dy: number;
  dz: number;
  collidedX: boolean;
  collidedY: boolean;
  collidedZ: boolean;
  onGround: boolean;
}

const RESULT: MoveResult = {
  dx: 0, dy: 0, dz: 0,
  collidedX: false, collidedY: false, collidedZ: false, onGround: false,
};

const stepAabb = createAabb();
const scratchAabb = createAabb();

/**
 * Move a AABB por `(dx, dy, dz)`, clampando contra os blocos sólidos.
 * `aabb` é mutada no lugar. O resultado é um objeto reusado — copie o que
 * precisar antes da próxima chamada.
 */
export function moveWithCollision(
  world: World, aabb: Aabb, dx: number, dy: number, dz: number, autoStep: number,
): MoveResult {
  const r = RESULT;
  r.collidedX = false;
  r.collidedY = false;
  r.collidedZ = false;

  // --- Y primeiro: define se está no chão antes de resolver o horizontal ---
  const movedY = sweepAxis(world, aabb, dy, 1);
  r.collidedY = movedY !== dy;
  r.onGround = dy < 0 && r.collidedY;
  translate(aabb, 0, movedY, 0);
  r.dy = movedY;

  // --- X e Z ---
  const movedX = sweepAxis(world, aabb, dx, 0);
  const movedZ = sweepAxis(world, aabb, dz, 2);

  const blockedX = movedX !== dx;
  const blockedZ = movedZ !== dz;

  // Auto-step: se o horizontal travou e cabe subindo até `autoStep`, sobe.
  //
  // Quem decide se subir é permitido é o chamador, via `autoStep > 0` — exigir
  // `r.onGround` aqui quebraria o caso em que a vertical já estava zerada, que
  // é justamente o de andar em terreno plano.
  if ((blockedX || blockedZ) && autoStep > 0) {
    stepAabb.set(aabb);
    const lift = sweepAxis(world, stepAabb, autoStep, 1);
    if (lift > 0.001) {
      translate(stepAabb, 0, lift, 0);
      const stepX = sweepAxis(world, stepAabb, dx, 0);
      translate(stepAabb, stepX, 0, 0);
      const stepZ = sweepAxis(world, stepAabb, dz, 2);
      translate(stepAabb, 0, 0, stepZ);
      // Só vale a pena se o degrau realmente destravou o movimento.
      if (Math.abs(stepX) > Math.abs(movedX) + 0.001
        || Math.abs(stepZ) > Math.abs(movedZ) + 0.001) {
        // Reencosta no chão do degrau.
        const drop = sweepAxis(world, stepAabb, -autoStep, 1);
        translate(stepAabb, 0, drop, 0);
        aabb.set(stepAabb);
        r.dx = stepX;
        r.dz = stepZ;
        r.dy = movedY + lift + drop;
        r.collidedX = false;
        r.collidedZ = false;
        r.onGround = true;
        return r;
      }
    }
  }

  translate(aabb, movedX, 0, 0);
  translate(aabb, 0, 0, movedZ);
  r.dx = movedX;
  r.dz = movedZ;
  r.collidedX = blockedX;
  r.collidedZ = blockedZ;
  return r;
}

/**
 * Quanto a AABB consegue andar no eixo `axis` (0=X, 1=Y, 2=Z) antes de bater.
 * Varre só os inteiros que a caixa expandida cobre — nunca mais que ~4×4×4.
 */
function sweepAxis(world: World, aabb: Aabb, delta: number, axis: number): number {
  if (delta === 0) return 0;

  // Caixa expandida pelo movimento, para saber quais blocos consultar.
  scratchAabb.set(aabb);
  if (delta > 0) scratchAabb[axis + 3] += delta;
  else scratchAabb[axis] += delta;

  const minX = Math.floor(scratchAabb[0]);
  // Uma camada a mais para baixo: a cerca colide 1,5 acima da própria base
  // (doc 04 §3), então ela ainda barra quem está no bloco de cima.
  const minY = Math.floor(scratchAabb[1]) - 1;
  const minZ = Math.floor(scratchAabb[2]);
  const maxX = Math.floor(scratchAabb[3]);
  const maxY = Math.floor(scratchAabb[4]);
  const maxZ = Math.floor(scratchAabb[5]);

  let remaining = delta;

  for (let y = minY; y <= maxY; y++) {
    if (y < 0 || y >= WORLD_HEIGHT) continue;
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        const state = world.getBlock(x, y, z);
        const def = defOf(state);
        if (!def.solid) continue;
        const count = collisionShapeOf(world, def, state, x, y, z);
        for (let b = 0; b < count; b++) {
          remaining = clampAgainstBox(aabb, x, y, z, b, remaining, axis);
          if (remaining === 0) return 0;
        }
      }
    }
  }
  return remaining;
}

/**
 * Tolerância para tratar "encostado" como "fora".
 *
 * A AABB é `Float32Array`, então uma caixa pousada em y=64 pode virar
 * 63.99999996. Sem a folga, o bloco de baixo passa a contar como "já penetrado"
 * e deixa de bloquear — o jogador atravessa o chão um tick depois de pousar.
 */
const TOUCH_EPSILON = 1e-4;

/**
 * Caixas de colisão do bloco, em `COLLISION_BOXES`. Devolve quantas.
 *
 * O cubo é o caminho quente e sai sem passar por `shapes.ts`: 99% dos blocos
 * consultados no sweep são pedra e terra.
 */
function collisionShapeOf(
  world: World, def: BlockDef, state: number, x: number, y: number, z: number,
): number {
  const shape = SHAPE_BY_NAME[def.shape];
  if (shape === undefined) {
    COLLISION_BOXES[0] = 0; COLLISION_BOXES[1] = 0; COLLISION_BOXES[2] = 0;
    COLLISION_BOXES[3] = 1; COLLISION_BOXES[4] = 1; COLLISION_BOXES[5] = 1;
    return 1;
  }
  const bits = stateBitsOf(state);
  /*
   * A escada é a única forma cuja **colisão** também depende do vizinho.
   *
   * O canto é derivado na hora, dos mesmos quatro vizinhos que o mesher
   * consulta, e pela mesma função — se as duas contas divergissem, o jogador
   * atravessaria o canto que enxerga, que é exatamente o que o cabeçalho deste
   * módulo promete que não acontece. As quatro consultas só acontecem para
   * escada: pedra e terra, que são o caminho quente, saem antes.
   */
  if (shape === SHAPE_STAIRS) {
    return collisionBoxesFor(shape, bits, COLLISION_BOXES, stairCornerAt(world, x, y, z, bits));
  }
  return collisionBoxesFor(shape, bits, COLLISION_BOXES);
}

/** Canto da escada em `(x, y, z)`, lido do mundo. */
function stairCornerAt(world: World, x: number, y: number, z: number, bits: number): number {
  return stairCornerFrom(
    bits,
    stairBitsAt(world, x + 1, y, z),
    stairBitsAt(world, x - 1, y, z),
    stairBitsAt(world, x, y, z + 1),
    stairBitsAt(world, x, y, z - 1),
  );
}

/** Bits da escada naquela posição, ou `NOT_STAIRS`. */
function stairBitsAt(world: World, x: number, y: number, z: number): number {
  const state = world.getBlock(x, y, z);
  if (SHAPE_BY_NAME[defOf(state).shape] !== SHAPE_STAIRS) return NOT_STAIRS;
  return stateBitsOf(state);
}

const COLLISION_BOXES = new Float32Array(MAX_BOXES * BOX_STRIDE);

/** Clampa `delta` para que a AABB não penetre a caixa `box` do bloco `(bx,by,bz)`. */
function clampAgainstBox(
  aabb: Aabb, bx: number, by: number, bz: number, box: number, delta: number, axis: number,
): number {
  const o = box * BOX_STRIDE;
  // Origem por eixo sem array temporário: este é o caminho quente da física.
  const originX = bx; const originY = by; const originZ = bz;
  // Precisa haver sobreposição nos outros dois eixos, senão não colide.
  for (let a = 0; a < 3; a++) {
    if (a === axis) continue;
    const origin = a === 0 ? originX : a === 1 ? originY : originZ;
    if (aabb[a] >= origin + COLLISION_BOXES[o + a + 3]) return delta;
    if (aabb[a + 3] <= origin + COLLISION_BOXES[o + a]) return delta;
  }

  const origin = axis === 0 ? originX : axis === 1 ? originY : originZ;
  const blockMin = origin + COLLISION_BOXES[o + axis];
  const blockMax = origin + COLLISION_BOXES[o + axis + 3];

  if (delta > 0) {
    // Só considera blocos que estão à frente: se já houver sobreposição no
    // eixo do movimento, empurrar para fora causaria teleporte.
    if (aabb[axis + 3] > blockMin + TOUCH_EPSILON) return delta;
    const gap = blockMin - aabb[axis + 3];
    return gap < delta ? Math.max(0, gap) : delta;
  }

  if (aabb[axis] < blockMax - TOUCH_EPSILON) return delta;
  const gap = blockMax - aabb[axis];
  return gap > delta ? Math.min(0, gap) : delta;
}

function isSolid(world: World, x: number, y: number, z: number): boolean {
  return defOf(world.getBlock(x, y, z)).solid;
}

function translate(aabb: Aabb, dx: number, dy: number, dz: number): void {
  aabb[0] += dx; aabb[3] += dx;
  aabb[1] += dy; aabb[4] += dy;
  aabb[2] += dz; aabb[5] += dz;
}

/** true se algum bloco sólido intersecta a AABB — usado ao colocar blocos. */
export function isSpaceBlocked(world: World, aabb: Aabb): boolean {
  const minX = Math.floor(aabb[0]);
  const minY = Math.floor(aabb[1]);
  const minZ = Math.floor(aabb[2]);
  const maxX = Math.ceil(aabb[3]) - 1;
  const maxY = Math.ceil(aabb[4]) - 1;
  const maxZ = Math.ceil(aabb[5]) - 1;
  for (let y = minY; y <= maxY; y++) {
    for (let z = minZ; z <= maxZ; z++) {
      for (let x = minX; x <= maxX; x++) {
        if (isSolid(world, x, y, z)) return true;
      }
    }
  }
  return false;
}
