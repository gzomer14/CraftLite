/**
 * Conexão automática de trilhos (doc 14 — M7).
 *
 * Um trilho não é colocado com uma forma: ele **descobre** a forma olhando os
 * vizinhos, e a redescobre toda vez que um vizinho muda. Isso é o que faz
 * "colocar trilho" ser um gesto só em vez de escolher entre dez peças.
 *
 * A forma vai para os bits 0..3 do estado — e não é calculada no meshing, como
 * a conexão da cerca — porque **o carrinho precisa dela**. Cerca conectada é
 * desenho; trilho conectado é física, e recalcular a forma dentro do tick do
 * carrinho seria pagar a busca de vizinhos a cada movimento.
 *
 * A disciplina é a de sempre: fila incremental alimentada pelo evento de
 * mudança de bloco, drenada dentro do tick com teto duro (a mesma de
 * `redstone.ts`, e pelo mesmo motivo).
 */

import { BLOCKS, blockIdOf, defOf, makeState, stateBitsOf } from '../data/blocks';
import {
  FACING_STEP, RAIL_ASCEND_EAST, RAIL_CURVE_NE, RAIL_CURVE_NW, RAIL_CURVE_SE, RAIL_CURVE_SW,
  RAIL_EW, RAIL_NS, RAIL_POWERED, railIsCurve,
} from './mesh/shapes';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';

/** Teto de trilhos reavaliados por tick. */
export const MAX_UPDATES_PER_TICK = 256;

/** 1 por id de bloco que é trilho; 1 em `curves` se ele aceita curva. */
const IS_RAIL = new Uint8Array(BLOCKS.length);
const CURVES = new Uint8Array(BLOCKS.length);

for (let id = 0; id < BLOCKS.length; id++) {
  const def = BLOCKS[id];
  if (def === undefined || def.shape !== 'rail') continue;
  IS_RAIL[id] = 1;
  // Só o trilho comum curva: máquina dentro de curva não existe no gênero.
  CURVES[id] = def.name === 'rail' ? 1 : 0;
}

export function isRail(state: number): boolean {
  return IS_RAIL[blockIdOf(state)] === 1;
}

/** Forma do trilho (bits 0..3). Devolve −1 se o bloco não é trilho. */
export function railShapeOf(state: number): number {
  return isRail(state) ? stateBitsOf(state) & 0xf : -1;
}

/**
 * Curva formada por dois lados conectados, nos índices de `FACING_STEP`.
 * A chave é `ladoA * 4 + ladoB`, e as duas ordens apontam para a mesma curva.
 */
const CURVE_BY_SIDES = new Int8Array(16).fill(-1);
CURVE_BY_SIDES[2 * 4 + 0] = RAIL_CURVE_SE; CURVE_BY_SIDES[0 * 4 + 2] = RAIL_CURVE_SE;
CURVE_BY_SIDES[2 * 4 + 1] = RAIL_CURVE_SW; CURVE_BY_SIDES[1 * 4 + 2] = RAIL_CURVE_SW;
CURVE_BY_SIDES[3 * 4 + 1] = RAIL_CURVE_NW; CURVE_BY_SIDES[1 * 4 + 3] = RAIL_CURVE_NW;
CURVE_BY_SIDES[3 * 4 + 0] = RAIL_CURVE_NE; CURVE_BY_SIDES[0 * 4 + 3] = RAIL_CURVE_NE;

/** Rampa que sobe na direção `dir` de `FACING_STEP`. */
const SLOPE_BY_DIR: readonly number[] = [
  RAIL_ASCEND_EAST, // +X
  RAIL_ASCEND_EAST + 1, // −X
  RAIL_ASCEND_EAST + 3, // +Z
  RAIL_ASCEND_EAST + 2, // −Z
];

export interface RailEvents {
  /** Perdeu o chão e caiu: quem ouve dropa o item. */
  onBroken?(x: number, y: number, z: number, state: number): void;
}

export class Rails {
  private readonly world: World;
  private readonly events: RailEvents;
  private queue: number[] = [];
  private readonly queued = new Set<number>();

  /** Quantos trilhos foram reavaliados no último tick (overlay de debug). */
  lastUpdates = 0;

  constructor(world: World, events: RailEvents = {}) {
    this.world = world;
    this.events = events;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Liga ao mundo: toda mudança de bloco reavalia os trilhos em volta. */
  attach(): () => void {
    return this.world.onBlockChange((change) => {
      if (change.source === 'gen') return;
      this.scheduleAround(change.x, change.y, change.z);
    });
  }

  /**
   * Agenda a posição e a vizinhança que pode ter mudado de forma.
   *
   * O alcance é um bloco na horizontal e **um acima e um abaixo**, porque a
   * rampa liga níveis: um trilho colocado em cima muda a forma do de baixo.
   */
  scheduleAround(x: number, y: number, z: number): void {
    this.schedule(x, y, z);
    for (let d = 0; d < 4; d++) {
      const step = FACING_STEP[d];
      for (let dy = -1; dy <= 1; dy++) {
        this.schedule(x + step[0], y + dy, z + step[1]);
      }
    }
    this.schedule(x, y - 1, z);
    this.schedule(x, y + 1, z);
  }

  schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    if (!isRail(this.world.getBlock(x, y, z))) return;
    const key = positionKey(x, y, z);
    if (this.queued.has(key)) return;
    this.queued.add(key);
    this.queue.push(key);
  }

  /** Um tick: drena a fila até esvaziar ou bater o teto. */
  tick(): void {
    this.lastUpdates = 0;
    while (this.queue.length > 0 && this.lastUpdates < MAX_UPDATES_PER_TICK) {
      const key = this.queue.pop() as number;
      this.queued.delete(key);
      this.update(xOfKey(key), yOfKey(key), zOfKey(key));
      this.lastUpdates++;
    }
  }

  private update(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    if (IS_RAIL[id] !== 1) return;

    // Trilho sem chão cai como item, igual ao pó de redstone.
    if (!defOf(this.world.getBlock(x, y - 1, z)).solid) {
      if (!this.world.setBlock(x, y, z, 0, 'physics')) return;
      this.events.onBroken?.(x, y, z, state);
      return;
    }

    const bits = stateBitsOf(state);
    const shape = this.shapeAt(x, y, z, id, bits & 0xf);
    if (shape === (bits & 0xf)) return;
    this.world.setBlock(x, y, z, makeState(id, (bits & ~0xf) | shape), 'physics');
  }

  /**
   * Forma que o trilho deveria ter.
   *
   * A regra, em ordem: **dois vizinhos** mandam (retos no mesmo eixo, curva em
   * eixos diferentes); **um vizinho** define o eixo; **nenhum** mantém o que
   * estava. A rampa entra depois, sobre o eixo já decidido: se o vizinho
   * daquele lado está um nível acima, o trilho sobe para lá.
   */
  shapeAt(x: number, y: number, z: number, id: number, current: number): number {
    let count = 0;
    const linked: number[] = LINK_SCRATCH;
    for (let d = 0; d < 4; d++) {
      if (this.linksTo(x, y, z, d) < 0) continue;
      linked[count++] = d;
    }

    let shape = current;
    if (count >= 2) {
      shape = this.shapeFromSides(id, linked, count, current);
    } else if (count === 1) {
      shape = linked[0] < 2 ? RAIL_EW : RAIL_NS;
    } else if (railIsCurve(current) && CURVES[id] !== 1) {
      // Trilho que deixou de curvar (virou motorizado) volta a ser reto.
      shape = RAIL_EW;
    }

    return this.applySlope(x, y, z, shape);
  }

  /** Decide entre reta e curva quando há dois ou mais lados ligados. */
  private shapeFromSides(
    id: number, linked: readonly number[], count: number, current: number,
  ): number {
    // Dois lados do mesmo eixo: reta, sempre.
    for (let a = 0; a < count; a++) {
      for (let b = a + 1; b < count; b++) {
        if ((linked[a] ^ linked[b]) === 1) return linked[a] < 2 ? RAIL_EW : RAIL_NS;
      }
    }
    if (CURVES[id] !== 1) {
      // Máquina não curva: mantém o eixo que já tinha, ou pega o do primeiro.
      return railIsCurve(current) ? RAIL_EW : (linked[0] < 2 ? RAIL_EW : RAIL_NS);
    }
    const curve = CURVE_BY_SIDES[linked[0] * 4 + linked[1]];
    return curve >= 0 ? curve : RAIL_NS;
  }

  /**
   * Vira a forma reta em rampa quando o vizinho do eixo está um nível acima.
   * Curva nunca vira rampa: a geometria não existe.
   */
  private applySlope(x: number, y: number, z: number, shape: number): number {
    if (railIsCurve(shape)) return shape;
    const axis = shape === RAIL_EW ? 0 : 2;
    for (let i = 0; i < 2; i++) {
      const dir = axis + i;
      if (this.linksTo(x, y, z, dir) === 1) return SLOPE_BY_DIR[dir];
    }
    return shape === RAIL_EW ? RAIL_EW : RAIL_NS;
  }

  /**
   * Há trilho ligável na direção `dir`?
   *
   * Devolve o **degrau**: 0 no mesmo nível, 1 um acima, −1 um abaixo, e −2 se
   * não há ligação.
   *
   * O degrau precisa de **teto livre do lado de baixo**: subindo, o bloco sobre
   * este trilho; descendo, o bloco sobre o vizinho. Sem essa checagem a rampa
   * atravessaria a laje que está em cima dela. Não se pergunta pelo bloco de
   * apoio do trilho de cima — ele é justamente o degrau, e é sólido por
   * definição.
   */
  linksTo(x: number, y: number, z: number, dir: number): number {
    const step = FACING_STEP[dir];
    const nx = x + step[0];
    const nz = z + step[1];
    if (isRail(this.world.getBlock(nx, y, nz))) return 0;
    if (isRail(this.world.getBlock(nx, y + 1, nz))
      && !defOf(this.world.getBlock(x, y + 1, z)).solid) {
      return 1;
    }
    if (isRail(this.world.getBlock(nx, y - 1, nz))
      && !defOf(this.world.getBlock(nx, y, nz)).solid) {
      return -1;
    }
    return -2;
  }

  /** Liga ou desliga o bit de energizado de um trilho (motorizado, detector). */
  setPowered(x: number, y: number, z: number, powered: boolean): void {
    const state = this.world.getBlock(x, y, z);
    if (!isRail(state)) return;
    const bits = stateBitsOf(state);
    if (((bits & RAIL_POWERED) !== 0) === powered) return;
    this.world.setBlock(
      x, y, z,
      makeState(blockIdOf(state), powered ? bits | RAIL_POWERED : bits & ~RAIL_POWERED),
      'physics',
    );
  }

  /**
   * Cataloga os trilhos de um chunk que acabou de entrar (mesma técnica de
   * `redstone.scanChunk`: a paleta filtra antes dos 4096 voxels).
   */
  scanChunk(chunk: {
    cx: number; cz: number;
    sections: { paletteLen: number; palette: Uint16Array; getByIndex(i: number): number }[];
  }): void {
    for (let sy = 0; sy < chunk.sections.length; sy++) {
      const section = chunk.sections[sy];
      let interesting = false;
      for (let p = 0; p < section.paletteLen; p++) {
        if (isRail(section.palette[p])) { interesting = true; break; }
      }
      if (!interesting) continue;

      for (let i = 0; i < 4096; i++) {
        if (!isRail(section.getByIndex(i))) continue;
        this.schedule(
          chunk.cx * 16 + (i & 15),
          sy * 16 + (i >> 8),
          chunk.cz * 16 + ((i >> 4) & 15),
        );
      }
    }
  }
}

/** Lados ligados de um trilho — reusado, porque `shapeAt` roda muito. */
const LINK_SCRATCH: number[] = [0, 0, 0, 0];

/** 26 bits por eixo horizontal e 8 para Y cabem folgado em um double. */
function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}

function yOfKey(key: number): number {
  return key % 128;
}

function xOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(Math.floor(xz / 0x4000000));
}

function zOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(xz % 0x4000000);
}

function signed26(value: number): number {
  return value >= 0x2000000 ? value - 0x4000000 : value;
}
