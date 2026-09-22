/**
 * Água e lava com nível 0–7 (doc 03 §9).
 *
 * O comportamento que faz a água "parecer certa" é a **busca de menor caminho**:
 * antes de espalhar lateralmente, o fluido olha até 5 blocos à frente
 * procurando um buraco, e flui preferencialmente para lá. Sem isso a água
 * escorre em todas as direções igualmente e nunca "encontra" a descida.
 *
 * Há um limite duro de updates por tick — um oceano vazando numa caverna não
 * pode travar o frame.
 */

import {
  AIR, BLOCK_BY_NAME, LAVA, STONE, WATER, blockIdOf, defOf, makeState, stateBitsOf,
} from '../data/blocks';
import { WORLD_HEIGHT } from './chunk';
import type { World } from './world';

/**
 * Alcance horizontal da água (doc 03 §9). O da lava mora em
 * `data/dimensions.ts`, porque muda com a dimensão: 3 na superfície, 4 no
 * Nether.
 */
const WATER_RANGE = 7;
/** Intervalo entre atualizações. */
const WATER_INTERVAL = 5;
const LAVA_INTERVAL = 30;
/** Teto de atualizações por tick (doc 03 §9). */
const MAX_UPDATES_PER_TICK = 512;
/** Quantos blocos à frente a busca de menor caminho enxerga. */
const PATH_SEARCH = 5;

/** Nível 0 = fonte; 1..7 = fluxo, cada vez mais raso. */
export function fluidLevel(state: number): number {
  return stateBitsOf(state) & 0x7;
}

export function isSource(state: number): boolean {
  return fluidLevel(state) === 0;
}

export function makeFluid(id: number, level: number): number {
  return makeState(id, level & 0x7);
}

/** Altura visual da superfície, em blocos — usada pelo mesher em M5. */
export function fluidHeight(level: number): number {
  return level === 0 ? 0.875 : 0.875 - level * 0.111;
}

interface PendingUpdate {
  x: number;
  y: number;
  z: number;
  /** Tick em que deve ser processado. */
  at: number;
}

export class Fluids {
  private readonly world: World;
  private queue: PendingUpdate[] = [];
  private readonly scheduled = new Set<number>();
  private tickCounter = 0;

  /** Contadores para o overlay de debug. */
  lastUpdates = 0;

  /**
   * Alcance da lava, que muda com a dimensão (doc 03 §9: 3, 4 no Nether).
   * Lido do mundo a cada tick — o portal troca a dimensão debaixo do sistema.
   */
  private get lavaRange(): number {
    return this.world.dimensionDef.lavaRange;
  }

  /** A água evaporou — quem ouve toca o chiado. */
  onEvaporate: ((x: number, y: number, z: number) => void) | null = null;

  constructor(world: World) {
    this.world = world;
  }

  get pending(): number {
    return this.queue.length;
  }

  /** Agenda a checagem de um bloco e dos 6 vizinhos. */
  scheduleAround(x: number, y: number, z: number): void {
    this.schedule(x, y, z);
    this.schedule(x + 1, y, z);
    this.schedule(x - 1, y, z);
    this.schedule(x, y + 1, z);
    this.schedule(x, y - 1, z);
    this.schedule(x, y, z + 1);
    this.schedule(x, y, z - 1);
  }

  schedule(x: number, y: number, z: number): void {
    if (y < 0 || y >= WORLD_HEIGHT) return;
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);
    // Só interessa se é fluido ou pode receber fluido de um vizinho.
    if (id !== WATER && id !== LAVA && !defOf(state).replaceable) return;

    const key = positionKey(x, y, z);
    if (this.scheduled.has(key)) return;
    this.scheduled.add(key);
    const interval = id === LAVA ? LAVA_INTERVAL : WATER_INTERVAL;
    this.queue.push({ x, y, z, at: this.tickCounter + interval });
  }

  /** Processa os updates vencidos, até o teto do tick. */
  tick(): void {
    this.tickCounter++;
    this.lastUpdates = 0;
    if (this.queue.length === 0) return;

    const remaining: PendingUpdate[] = [];
    for (let i = 0; i < this.queue.length; i++) {
      const update = this.queue[i];
      if (update.at > this.tickCounter || this.lastUpdates >= MAX_UPDATES_PER_TICK) {
        remaining.push(update);
        continue;
      }
      this.scheduled.delete(positionKey(update.x, update.y, update.z));
      this.update(update.x, update.y, update.z);
      this.lastUpdates++;
    }
    this.queue = remaining;
  }

  /** Uma célula: decide se vira fluido, se muda de nível ou se seca. */
  private update(x: number, y: number, z: number): void {
    const state = this.world.getBlock(x, y, z);
    const id = blockIdOf(state);

    // Onde não chove, não fica água: no Nether ela vira vapor na hora, fonte
    // inclusive. É o que impede o jogador levar um balde e apagar a dimensão.
    if (id === WATER && this.world.dimensionDef.waterEvaporates) {
      this.setFluid(x, y, z, AIR);
      this.onEvaporate?.(x, y, z);
      return;
    }

    if (id === WATER || id === LAVA) {
      this.updateFluid(x, y, z, id, fluidLevel(state));
      return;
    }
    // Bloco vazio: recebe fluido se algum vizinho pode alimentá-lo.
    if (defOf(state).replaceable) this.tryFill(x, y, z);
  }

  private updateFluid(x: number, y: number, z: number, id: number, level: number): void {
    // Fonte nunca seca nem muda de nível.
    if (level > 0) {
      const supported = this.bestSupply(x, y, z, id);
      if (supported === null) {
        this.setFluid(x, y, z, AIR);
        return;
      }
      if (supported !== level) {
        this.setFluid(x, y, z, makeFluid(id, supported));
        return;
      }
    }

    // Água + lava: as regras de contato do doc 03 §9.
    if (this.handleContact(x, y, z, id, level)) return;

    this.spread(x, y, z, id, level);
  }

  /**
   * Nível que os vizinhos sustentam neste bloco, ou `null` se nenhum alimenta.
   * Descer de um fluido acima mantém o nível 1 (a queda não enfraquece).
   */
  private bestSupply(x: number, y: number, z: number, id: number): number | null {
    const above = this.world.getBlock(x, y + 1, z);
    if (blockIdOf(above) === id) return 1;

    const range = id === LAVA ? this.lavaRange : WATER_RANGE;
    let best: number | null = null;
    for (let d = 0; d < 4; d++) {
      const nx = x + DIRS[d * 2];
      const nz = z + DIRS[d * 2 + 1];
      const neighbor = this.world.getBlock(nx, y, nz);
      if (blockIdOf(neighbor) !== id) continue;
      const candidate = fluidLevel(neighbor) + 1;
      if (candidate > range) continue;
      if (best === null || candidate < best) best = candidate;
    }
    return best;
  }

  /** Espalha para baixo e, se não puder descer, para os lados. */
  private spread(x: number, y: number, z: number, id: number, level: number): void {
    const range = id === LAVA ? this.lavaRange : WATER_RANGE;

    // Descer tem prioridade absoluta; se desceu, não espalha lateralmente.
    const below = this.world.getBlock(x, y - 1, z);
    if (y > 0 && this.meetOther(x, y - 1, z, id, below, true)) return;
    if (y > 0 && defOf(below).replaceable && blockIdOf(below) !== id) {
      this.setFluid(x, y - 1, z, makeFluid(id, 1));
      return;
    }
    if (blockIdOf(below) === id) return; // já está escorrendo

    const nextLevel = level + 1;
    if (nextLevel > range) return;

    // Busca de menor caminho: se há um buraco perto, flui só para lá.
    const preferred = this.findDownhill(x, y, z);
    for (let d = 0; d < 4; d++) {
      if (preferred !== -1 && preferred !== d) continue;
      const nx = x + DIRS[d * 2];
      const nz = z + DIRS[d * 2 + 1];
      const target = this.world.getBlock(nx, y, nz);
      if (this.meetOther(nx, y, nz, id, target, false)) continue;
      if (!defOf(target).replaceable) continue;
      if (blockIdOf(target) === id && fluidLevel(target) <= nextLevel) continue;
      this.setFluid(nx, y, nz, makeFluid(id, nextLevel));
    }
  }

  /**
   * Procura a direção com o buraco mais próximo, até `PATH_SEARCH` blocos.
   * Devolve o índice da direção, ou −1 se não há preferência.
   */
  private findDownhill(x: number, y: number, z: number): number {
    let best = -1;
    let bestDistance = PATH_SEARCH + 1;

    for (let d = 0; d < 4; d++) {
      const dx = DIRS[d * 2];
      const dz = DIRS[d * 2 + 1];
      for (let step = 1; step <= PATH_SEARCH; step++) {
        const nx = x + dx * step;
        const nz = z + dz * step;
        // O caminho tem que estar livre até lá.
        if (!defOf(this.world.getBlock(nx, y, nz)).replaceable) break;
        if (defOf(this.world.getBlock(nx, y - 1, nz)).replaceable) {
          if (step < bestDistance) {
            bestDistance = step;
            best = d;
          }
          break;
        }
      }
    }
    return best;
  }

  /** Bloco vazio recebendo fluido de um vizinho. */
  private tryFill(x: number, y: number, z: number): void {
    for (const id of [WATER, LAVA]) {
      const level = this.bestSupply(x, y, z, id);
      if (level === null) continue;
      const range = id === LAVA ? this.lavaRange : WATER_RANGE;
      if (level > range) continue;
      this.setFluid(x, y, z, makeFluid(id, level));
      return;
    }
  }

  /**
   * Um fluido avançando sobre o **outro** (doc 03 §9).
   *
   * Sem isto, os dois se atropelavam: os dois são `replaceable`, e a água,
   * que atualiza seis vezes mais rápido, simplesmente apagava a lava por onde
   * passava — sem obsidiana, sem pedregulho, sem vapor.
   *
   * - água chegando numa fonte de lava: obsidiana;
   * - água chegando em lava corrente: pedregulho;
   * - lava **descendo** sobre água: pedra ("lava fluindo sobre água");
   * - lava chegando de lado na água: pedregulho, na célula da água.
   *
   * Devolve true se houve encontro — quem chamou não espalha para lá.
   */
  private meetOther(
    x: number, y: number, z: number, id: number, target: number, downward: boolean,
  ): boolean {
    const targetId = blockIdOf(target);
    if (id === WATER && targetId === LAVA) {
      this.setFluid(x, y, z, makeState(isSource(target) ? OBSIDIAN_ID : COBBLESTONE_ID));
      return true;
    }
    if (id === LAVA && targetId === WATER) {
      this.setFluid(x, y, z, makeState(downward ? STONE : COBBLESTONE_ID));
      return true;
    }
    return false;
  }

  /**
   * Contato entre água e lava (doc 03 §9), visto da célula da lava.
   * Devolve true se o bloco virou outra coisa e não deve mais espalhar.
   */
  private handleContact(x: number, y: number, z: number, id: number, level: number): boolean {
    if (id !== LAVA) return false;
    const other = WATER;

    let touchesWater = false;
    for (let d = 0; d < 4; d++) {
      if (blockIdOf(this.world.getBlock(x + DIRS[d * 2], y, z + DIRS[d * 2 + 1])) === other) {
        touchesWater = true;
      }
    }
    if (blockIdOf(this.world.getBlock(x, y + 1, z)) === other) touchesWater = true;
    if (!touchesWater) return false;

    /*
     * Fonte de lava + água = obsidiana; lava corrente + água = pedregulho.
     *
     * **Correção de 2026-09-22.** A lava corrente virava **pedra**, e o doc
     * diz pedregulho ("fonte+fluxo = cobblestone"). Pedra é o caso da lava
     * descendo sobre a água, que é outro encontro (`meetOther`). A diferença
     * importa porque é ela que faz o gerador de pedregulho do gênero dar o
     * bloco que se espera, e porque a pedra lisa quebrava em pedregulho de
     * qualquer jeito — o jogador via um bloco e colhia outro.
     */
    this.setFluid(x, y, z, makeState(level === 0 ? OBSIDIAN_ID : COBBLESTONE_ID));
    return true;
  }

  /** Aplica a mudança e reagenda a vizinhança. */
  private setFluid(x: number, y: number, z: number, state: number): void {
    if (!this.world.setBlock(x, y, z, state, 'physics')) return;
    this.scheduleAround(x, y, z);
  }
}

/** Direções horizontais: +X, −X, +Z, −Z. */
const DIRS = new Int8Array([1, 0, -1, 0, 0, 1, 0, -1]);

/** Resultados dos encontros, resolvidos pela tabela e não por número cru. */
const OBSIDIAN_ID = BLOCK_BY_NAME.get('obsidian')?.id ?? STONE;
const COBBLESTONE_ID = BLOCK_BY_NAME.get('cobblestone')?.id ?? STONE;

function positionKey(x: number, y: number, z: number): number {
  // 26 bits por eixo horizontal e 8 para Y cabem folgado em um double.
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}
