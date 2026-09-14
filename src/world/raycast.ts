/**
 * Raycast por voxel — algoritmo de Amanatides & Woo (doc 06 §5).
 *
 * Caminha bloco a bloco em vez de amostrar a intervalos fixos: nunca pula um
 * voxel fino nem testa o mesmo duas vezes, e o custo é proporcional à distância
 * em blocos, não à precisão desejada.
 *
 * O resultado vai para um objeto reusado — isto roda todo frame.
 */

import { defOf } from '../data/blocks';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';

/** O que o raio deve considerar um acerto. */
export interface RayOptions {
  /** Líquidos contam como acerto (balde, pesca). */
  fluids?: boolean;
  /**
   * Blocos substituíveis contam: planta, neve fina, fogo.
   *
   * É o raio **da interação** — o que o jogador mira para quebrar e onde ele
   * coloca. Linha de visão e explosão não usam isto, porque nada disso
   * bloqueia coisa nenhuma.
   */
  replaceable?: boolean;
}

export interface RayHit {
  hit: boolean;
  /** Bloco atingido. */
  x: number;
  y: number;
  z: number;
  /** Normal da face atingida (um dos eixos, ±1). */
  nx: number;
  ny: number;
  nz: number;
  /** Ponto exato do impacto, para decidir metade superior/inferior da face. */
  px: number;
  py: number;
  pz: number;
  distance: number;
  state: number;
}

const HIT: RayHit = {
  hit: false, x: 0, y: 0, z: 0, nx: 0, ny: 0, nz: 0, px: 0, py: 0, pz: 0,
  distance: 0, state: 0,
};

/**
 * Lança um raio de `(ox,oy,oz)` na direção `(dx,dy,dz)` (normalizada) até
 * `maxDistance` blocos. `options` decide o que conta como acerto — o padrão é
 * o que **bloqueia**, que é o que linha de visão e explosão precisam.
 */
export function raycast(
  world: World,
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  maxDistance: number,
  options: RayOptions = {},
): RayHit {
  const includeFluids = options.fluids === true;
  const includeReplaceable = options.replaceable === true;
  const r = HIT;
  r.hit = false;
  r.distance = 0;

  let x = Math.floor(ox);
  let y = Math.floor(oy);
  let z = Math.floor(oz);

  const stepX = dx > 0 ? 1 : dx < 0 ? -1 : 0;
  const stepY = dy > 0 ? 1 : dy < 0 ? -1 : 0;
  const stepZ = dz > 0 ? 1 : dz < 0 ? -1 : 0;

  // Distância até o próximo plano de voxel em cada eixo, e o passo entre planos.
  const tDeltaX = stepX === 0 ? Infinity : Math.abs(1 / dx);
  const tDeltaY = stepY === 0 ? Infinity : Math.abs(1 / dy);
  const tDeltaZ = stepZ === 0 ? Infinity : Math.abs(1 / dz);

  let tMaxX = stepX === 0 ? Infinity : boundary(ox, stepX) / Math.abs(dx);
  let tMaxY = stepY === 0 ? Infinity : boundary(oy, stepY) / Math.abs(dy);
  let tMaxZ = stepZ === 0 ? Infinity : boundary(oz, stepZ) / Math.abs(dz);

  let t = 0;
  // A face por onde entramos no voxel atual — é ela que vira a normal.
  let nx = 0, ny = 0, nz = 0;

  while (t <= maxDistance) {
    if (y >= 0 && y < WORLD_HEIGHT) {
      const state = world.getBlock(x, y, z);
      const def = defOf(state);
      /*
       * O que conta como acerto depende de **para quê** é o raio.
       *
       * Planta, neve fina e fogo são `replaceable`: eles não bloqueiam nada —
       * uma flor não pode esconder o jogador de um creeper nem barrar uma
       * explosão —, mas **são** o que o jogador mira quando quer quebrá-los.
       * Com a regra única de antes, nenhuma planta podia ser mirada: o raio
       * atravessava as 18 de dureza zero e acertava o chão atrás (relato de
       * campo 2026-09-14). O código de colocação já esperava o contrário: ele
       * tem um ramo para "bloco substituível recebe no próprio lugar" que
       * nunca era alcançado.
       */
      const solid = def.shape === 'liquid'
        ? includeFluids
        : def.shape !== 'none' && (includeReplaceable || !def.replaceable);
      if (solid) {
        r.hit = true;
        r.x = x; r.y = y; r.z = z;
        r.nx = nx; r.ny = ny; r.nz = nz;
        r.px = ox + dx * t;
        r.py = oy + dy * t;
        r.pz = oz + dz * t;
        r.distance = t;
        r.state = state;
        return r;
      }
    }

    // Avança pelo eixo cujo próximo plano está mais perto.
    if (tMaxX < tMaxY && tMaxX < tMaxZ) {
      x += stepX;
      t = tMaxX;
      tMaxX += tDeltaX;
      nx = -stepX; ny = 0; nz = 0;
    } else if (tMaxY < tMaxZ) {
      y += stepY;
      t = tMaxY;
      tMaxY += tDeltaY;
      nx = 0; ny = -stepY; nz = 0;
    } else {
      z += stepZ;
      t = tMaxZ;
      tMaxZ += tDeltaZ;
      nx = 0; ny = 0; nz = -stepZ;
    }
  }

  return r;
}

/** Distância do ponto até a borda do voxel no sentido do passo. */
function boundary(value: number, step: number): number {
  const fraction = value - Math.floor(value);
  return step > 0 ? 1 - fraction : fraction;
}
