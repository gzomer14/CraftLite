/**
 * Iluminação por flood fill BFS incremental (doc 02 §5.3).
 *
 * A regra que domina o design: **nunca recalcular a coluna inteira.** Colocar
 * uma tocha toca ~10 mil voxels no pior caso; recalcular a coluna tocaria
 * 32 mil por chunk afetado e estouraria o frame.
 *
 * São dois BFS por tipo de luz:
 *
 * - **Adição**: propaga a partir de uma fonte, decaindo 1 por bloco (mais a
 *   atenuação do bloco atravessado), enquanto encontrar vizinhos mais escuros.
 * - **Remoção**: apaga a região que dependia da fonte que sumiu e coleta as
 *   bordas mais claras encontradas no caminho, que viram sementes de adição.
 *   Sem esse segundo passo, apagar uma tocha deixaria luz "órfã" pendurada.
 *
 * As filas são circulares e pré-alocadas — o caminho quente não aloca.
 */

import { defOf } from '../data/blocks';
import { SECTIONS_PER_COLUMN, WORLD_HEIGHT } from './chunk';
import type { World } from './world';

/** Capacidade inicial das filas. Uma tocha (nível 14) cabe folgado. */
const INITIAL_CAPACITY = 32768;

/** Fila circular de posições com nível associado. */
class LightQueue {
  private x: Int32Array;
  private y: Int32Array;
  private z: Int32Array;
  private level: Uint8Array;
  private head = 0;
  private tail = 0;
  private capacity: number;

  constructor(capacity = INITIAL_CAPACITY) {
    this.capacity = capacity;
    this.x = new Int32Array(capacity);
    this.y = new Int32Array(capacity);
    this.z = new Int32Array(capacity);
    this.level = new Uint8Array(capacity);
  }

  get size(): number {
    return (this.tail - this.head + this.capacity) % this.capacity;
  }

  get isEmpty(): boolean {
    return this.head === this.tail;
  }

  clear(): void {
    this.head = 0;
    this.tail = 0;
  }

  push(x: number, y: number, z: number, level: number): void {
    this.x[this.tail] = x;
    this.y[this.tail] = y;
    this.z[this.tail] = z;
    this.level[this.tail] = level;
    this.tail = (this.tail + 1) % this.capacity;
    // Fila cheia: dobra. Acontece em atualizações de skylight muito grandes,
    // não no caminho comum de uma tocha.
    if (this.tail === this.head) this.grow();
  }

  /** Lê a frente para `out` = [x, y, z, level] e avança. */
  shift(out: Int32Array): void {
    out[0] = this.x[this.head];
    out[1] = this.y[this.head];
    out[2] = this.z[this.head];
    out[3] = this.level[this.head];
    this.head = (this.head + 1) % this.capacity;
  }

  private grow(): void {
    const next = this.capacity * 2;
    const nx = new Int32Array(next);
    const ny = new Int32Array(next);
    const nz = new Int32Array(next);
    const nl = new Uint8Array(next);
    // Reordena para começar em 0 e simplificar o resto.
    for (let i = 0; i < this.capacity; i++) {
      const src = (this.head + i) % this.capacity;
      nx[i] = this.x[src];
      ny[i] = this.y[src];
      nz[i] = this.z[src];
      nl[i] = this.level[src];
    }
    this.x = nx; this.y = ny; this.z = nz; this.level = nl;
    this.head = 0;
    this.tail = this.capacity;
    this.capacity = next;
  }
}

/** Deslocamentos dos 6 vizinhos. */
const NEIGHBORS = new Int32Array([
  1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1, 0, 0, 0, 1, 0, 0, -1,
]);

export class Lighting {
  private readonly world: World;
  private readonly addQueue = new LightQueue();
  private readonly removeQueue = new LightQueue();
  private readonly entry = new Int32Array(4);

  /** ms do último `update` — o overlay de debug mostra isso. */
  lastUpdateMs = 0;
  /** Voxels tocados no último update, para diagnóstico. */
  lastTouched = 0;

  constructor(world: World) {
    this.world = world;
  }

  /**
   * Recalcula a luz depois de um bloco mudar. É o caminho que precisa caber em
   * bem menos que um frame (doc 14, aceite do M2: tocha em < 16 ms).
   */
  onBlockChanged(x: number, y: number, z: number, previous: number, state: number): void {
    const t0 = performance.now();
    this.lastTouched = 0;

    const before = defOf(previous);
    const after = defOf(state);

    // --- luz de bloco ---
    if (before.emission > 0 && after.emission !== before.emission) {
      this.removeBlockLight(x, y, z);
    }
    if (before.lightAttenuation !== after.lightAttenuation && after.emission === 0) {
      // Ficou mais opaco: apaga e deixa os vizinhos re-preencherem.
      if (after.lightAttenuation > before.lightAttenuation) {
        this.removeBlockLight(x, y, z);
      }
    }
    if (after.emission > 0) {
      this.world.setBlockLight(x, y, z, after.emission);
      this.addQueue.push(x, y, z, after.emission);
    }
    // Abriu passagem: os vizinhos acesos empurram luz para cá.
    if (after.lightAttenuation < before.lightAttenuation) {
      this.seedFromNeighbors(x, y, z, false);
    }
    this.propagate(false);

    // --- luz do céu ---
    this.updateSkyColumn(x, y, z, before.lightAttenuation, after.lightAttenuation);

    this.markDirtyAround(x, y, z);
    this.lastUpdateMs = performance.now() - t0;
  }

  /** Apaga a luz de bloco em `(x,y,z)` e reacende a partir das bordas. */
  private removeBlockLight(x: number, y: number, z: number): void {
    const level = this.world.getBlockLight(x, y, z);
    if (level === 0) return;
    this.world.setBlockLight(x, y, z, 0);
    this.removeQueue.clear();
    this.removeQueue.push(x, y, z, level);
    this.propagateRemoval(false);
  }

  /**
   * Recalcula a coluna de skylight afetada.
   *
   * A luz do céu desce sem perda enquanto não encontra obstáculo, então mudar
   * um bloco só afeta a coluna dele para baixo — e depois espalha lateralmente.
   */
  private updateSkyColumn(
    x: number, y: number, z: number, beforeAttenuation: number, afterAttenuation: number,
  ): void {
    if (beforeAttenuation === afterAttenuation) return;

    if (afterAttenuation > beforeAttenuation) {
      // Bloqueou: apaga a coluna daqui para baixo e deixa os lados reacenderem.
      this.removeQueue.clear();
      for (let cy = y; cy >= 0; cy--) {
        const level = this.world.getSkyLight(x, cy, z);
        if (level === 0) break;
        this.world.setSkyLight(x, cy, z, 0);
        this.removeQueue.push(x, cy, z, level);
      }
      this.propagateRemoval(true);
    } else {
      // Desbloqueou: se há céu aberto acima, a coluna volta a 15.
      const above = this.world.getSkyLight(x, y + 1, z);
      const attenuated = Math.max(0, above - Math.max(1, afterAttenuation));
      const direct = above === 15 && afterAttenuation === 0 ? 15 : attenuated;
      if (direct > this.world.getSkyLight(x, y, z)) {
        this.world.setSkyLight(x, y, z, direct);
        this.addQueue.push(x, y, z, direct);
      }
      this.seedFromNeighbors(x, y, z, true);
    }
    this.propagate(true);
  }

  /** Enfileira os 6 vizinhos como possíveis fontes para o voxel dado. */
  private seedFromNeighbors(x: number, y: number, z: number, sky: boolean): void {
    for (let i = 0; i < 6; i++) {
      const nx = x + NEIGHBORS[i * 3];
      const ny = y + NEIGHBORS[i * 3 + 1];
      const nz = z + NEIGHBORS[i * 3 + 2];
      if (ny < 0 || ny >= WORLD_HEIGHT) continue;
      const level = sky ? this.world.getSkyLight(nx, ny, nz) : this.world.getBlockLight(nx, ny, nz);
      if (level > 1) this.addQueue.push(nx, ny, nz, level);
    }
  }

  /** BFS de adição: espalha enquanto encontrar vizinhos mais escuros. */
  private propagate(sky: boolean): void {
    const entry = this.entry;
    while (!this.addQueue.isEmpty) {
      this.addQueue.shift(entry);
      const x = entry[0], y = entry[1], z = entry[2];
      const level = entry[3];
      if (level <= 1) continue;

      for (let i = 0; i < 6; i++) {
        const nx = x + NEIGHBORS[i * 3];
        const ny = y + NEIGHBORS[i * 3 + 1];
        const nz = z + NEIGHBORS[i * 3 + 2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;

        const def = defOf(this.world.getBlock(nx, ny, nz));
        if (def.lightAttenuation >= 15) continue;

        // Luz do céu desce sem perder nível enquanto o caminho é livre.
        const goingDown = sky && NEIGHBORS[i * 3 + 1] === -1 && level === 15
          && def.lightAttenuation === 0;
        const next = goingDown ? 15 : level - Math.max(1, def.lightAttenuation);
        if (next <= 0) continue;

        const current = sky ? this.world.getSkyLight(nx, ny, nz) : this.world.getBlockLight(nx, ny, nz);
        if (current >= next) continue;

        if (sky) this.world.setSkyLight(nx, ny, nz, next);
        else this.world.setBlockLight(nx, ny, nz, next);
        this.markDirty(nx, ny, nz);
        this.lastTouched++;
        this.addQueue.push(nx, ny, nz, next);
      }
    }
  }

  /**
   * BFS de remoção. Apaga o que dependia da fonte e coleta as bordas mais
   * claras como sementes de re-adição — é o passo que evita luz órfã.
   */
  private propagateRemoval(sky: boolean): void {
    const entry = this.entry;
    while (!this.removeQueue.isEmpty) {
      this.removeQueue.shift(entry);
      const x = entry[0], y = entry[1], z = entry[2];
      const level = entry[3];

      for (let i = 0; i < 6; i++) {
        const nx = x + NEIGHBORS[i * 3];
        const ny = y + NEIGHBORS[i * 3 + 1];
        const nz = z + NEIGHBORS[i * 3 + 2];
        if (ny < 0 || ny >= WORLD_HEIGHT) continue;

        const current = sky ? this.world.getSkyLight(nx, ny, nz) : this.world.getBlockLight(nx, ny, nz);
        if (current === 0) continue;

        if (current < level || (sky && level === 15 && NEIGHBORS[i * 3 + 1] === -1)) {
          // Dependia da fonte que sumiu: apaga e continua descendo.
          if (sky) this.world.setSkyLight(nx, ny, nz, 0);
          else this.world.setBlockLight(nx, ny, nz, 0);
          this.markDirty(nx, ny, nz);
          this.lastTouched++;
          this.removeQueue.push(nx, ny, nz, current);
        } else {
          // Mais claro que a fonte removida: é uma borda, vira semente.
          this.addQueue.push(nx, ny, nz, current);
        }
      }
    }
  }

  /** Marca a section do voxel e as vizinhas de borda como sujas. */
  private markDirty(x: number, y: number, z: number): void {
    this.world.markDirty(x >> 4, z >> 4, y >> 4);
  }

  /** Idem, mas cobrindo as 6 direções — usado no ponto da mudança. */
  private markDirtyAround(x: number, y: number, z: number): void {
    const cx = x >> 4;
    const cz = z >> 4;
    const sy = y >> 4;
    this.world.markDirty(cx, cz, sy);
    if ((x & 15) === 0) this.world.markDirty(cx - 1, cz, sy);
    if ((x & 15) === 15) this.world.markDirty(cx + 1, cz, sy);
    if ((z & 15) === 0) this.world.markDirty(cx, cz - 1, sy);
    if ((z & 15) === 15) this.world.markDirty(cx, cz + 1, sy);
    if ((y & 15) === 0 && sy > 0) this.world.markDirty(cx, cz, sy - 1);
    if ((y & 15) === 15 && sy + 1 < SECTIONS_PER_COLUMN) this.world.markDirty(cx, cz, sy + 1);
  }
}
