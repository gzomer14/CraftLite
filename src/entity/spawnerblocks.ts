/**
 * Geradores de monstros da dungeon (doc 03 §7).
 *
 * Saiu da `Session` em 2026-09-22 (M13). A regra é a mínima que faz a dungeon
 * ser perigosa sem virar fábrica: só com o jogador a menos de 16 blocos, com
 * teto de 6 mobs daquele tipo por perto, e um a cada 10 segundos. Os geradores
 * não vão para o save: nascem do marco da estrutura quando o chunk entra.
 */

import { MOB_BY_NAME } from '../data/mobs';
import { hash3 } from '../core/rng';
import type { MobStore } from './mobstore';

/** Alcance em que um gerador de monstros trabalha. */
const SPAWNER_RANGE = 16;
/** Teto de mobs daquele tipo perto do gerador. */
const SPAWNER_CAP = 6;
/** Ticks entre um spawn e o próximo: 10 s. */
const SPAWNER_TICKS = 200;

interface SpawnerBlock {
  x: number;
  y: number;
  z: number;
  mob: string;
  cooldown: number;
}

export class SpawnerBlocks {
  private readonly spawners = new Map<number, SpawnerBlock>();
  private readonly mobs: MobStore;
  private readonly seed: number;
  private readonly onSpawn: (x: number, y: number, z: number) => void;
  private tickCount = 0;

  constructor(mobs: MobStore, seed: number, onSpawn: (x: number, y: number, z: number) => void) {
    this.mobs = mobs;
    this.seed = seed;
    this.onSpawn = onSpawn;
  }

  get size(): number {
    return this.spawners.size;
  }

  add(x: number, y: number, z: number, mob: string): void {
    this.spawners.set(positionKey(x, y, z), { x, y, z, mob, cooldown: 0 });
  }

  /** Esquece os geradores do chunk que saiu de alcance. */
  forgetChunk(cx: number, cz: number): void {
    for (const [key, spawner] of this.spawners) {
      if ((spawner.x >> 4) === cx && (spawner.z >> 4) === cz) this.spawners.delete(key);
    }
  }

  clear(): void {
    this.spawners.clear();
  }

  tick(playerX: number, playerY: number, playerZ: number): void {
    if (this.spawners.size === 0) return;
    for (const spawner of this.spawners.values()) {
      if (spawner.cooldown > 0) { spawner.cooldown--; continue; }
      const dx = playerX - spawner.x;
      const dy = playerY - spawner.y;
      const dz = playerZ - spawner.z;
      if (dx * dx + dy * dy + dz * dz > SPAWNER_RANGE * SPAWNER_RANGE) continue;

      const def = MOB_BY_NAME.get(spawner.mob);
      if (def === undefined) continue;
      if (this.countNear(def.id, spawner.x, spawner.y, spawner.z) >= SPAWNER_CAP) {
        spawner.cooldown = SPAWNER_TICKS;
        continue;
      }
      const jitter = hash3(this.seed, spawner.x, spawner.y + this.tickCount, spawner.z, 0x5aa5);
      const ox = (jitter & 3) - 1.5;
      const oz = ((jitter >>> 2) & 3) - 1.5;
      const index = this.mobs.spawn(def.id, spawner.x + 0.5 + ox, spawner.y, spawner.z + 0.5 + oz);
      if (index >= 0) this.onSpawn(spawner.x, spawner.y, spawner.z);
      spawner.cooldown = SPAWNER_TICKS;
    }
    this.tickCount++;
  }

  /** Quantos mobs deste tipo estão perto do gerador. */
  private countNear(type: number, x: number, y: number, z: number): number {
    const store = this.mobs;
    let count = 0;
    for (let i = 0; i < store.active; i++) {
      if (store.type[i] !== type) continue;
      const dx = store.x[i] - x;
      const dy = store.y[i] - y;
      const dz = store.z[i] - z;
      if (dx * dx + dy * dy + dz * dz <= SPAWNER_RANGE * SPAWNER_RANGE) count++;
    }
    return count;
  }
}

function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}
