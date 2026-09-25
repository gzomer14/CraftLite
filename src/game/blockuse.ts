/**
 * Clique direito **num bloco** que responde: cama, porta/portão/alçapão e
 * bolo (doc 04 §2.5, doc 05 §4, doc 06 §6).
 *
 * Saiu da `Session` em 2026-09-22 (M13). É a outra metade do clique direito:
 * o que é do **item** na mão mora em `game/itemuse.ts`; o que é do bloco
 * mirado, aqui. A ordem entre os dois — e com circuito, contêiner e veículo —
 * continua sendo decidida em `Session.useHeld`.
 */

import { AIR, BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf } from '../data/blocks';
import { mobDef } from '../data/mobs';
import { CAKE_SLICES } from '../world/mesh/shapes';
import { isBedAt, partnerIdOf, partnerOffset } from '../world/multiblock';
import { toggleOpenState } from './interaction';
import { trySleep } from './sleep';
import type { Achievements } from './achievements';
import type { DayNight } from './daynight';
import type { Survival } from './survival';
import type { MobStore } from '../entity/mobstore';
import type { World } from '../world/world';
import { t } from '../core/i18n';

const CAKE = BLOCK_BY_NAME.get('cake')?.id ?? -1;
/** Uma fatia de bolo (doc 05 §4). */
const CAKE_HUNGER = 2;
const CAKE_SATURATION = 0.4;
/** Raio em que um hostil impede dormir (8 blocos, ao quadrado). */
const SLEEP_HOSTILE_RADIUS_SQ = 64;
/** Deslocamento até a outra folha da porta, reusado — não aloca por clique. */
const DOOR_PARTNER = new Int8Array(3);

export interface BlockUseHost {
  readonly world: World;
  readonly survival: Survival;
  readonly dayNight: DayNight;
  readonly achievements: Achievements;
  readonly mobs: MobStore;
  changed(x: number, y: number, z: number, previous: number, state: number): void;
  sound(name: string, x: number, y: number, z: number): void;
  message(text: string): void;
  /** A cama define o ponto de renascimento. */
  setSpawn(x: number, y: number, z: number): void;
}

export class BlockUse {
  private readonly host: BlockUseHost;

  constructor(host: BlockUseHost) {
    this.host = host;
  }

  /**
   * Dormir: define o ponto de renascimento e pula para o amanhecer.
   * Devolve true se a cama foi usada (mesmo que o sono seja negado).
   */
  bed(x: number, y: number, z: number): boolean {
    const host = this.host;
    // Clicar em qualquer uma das duas metades deita na mesma cama (M8).
    if (!isBedAt(host.world, x, y, z)) return false;
    host.setSpawn(x, y + 1, z);
    const result = trySleep(host.dayNight.time, this.hostilesNear(x, y, z));
    if (!result.ok) {
      host.message(result.message);
      return true;
    }
    host.dayNight.setTimeOfDay(result.wakeTime);
    host.survival.health = Math.min(20, host.survival.health + 1);
    host.message(t('msg.good_morning'));
    host.sound('ui/sleep', x, y, z);
    host.achievements.event('sleep');
    return true;
  }

  /** Quantos hostis existem num raio de 8 blocos (dormir exige abrigo). */
  hostilesNear(x: number, y: number, z: number): number {
    const store = this.host.mobs;
    let count = 0;
    for (let i = 0; i < store.active; i++) {
      if (mobDef(store.type[i]).category !== 'hostile') continue;
      const dx = store.x[i] - x;
      const dy = store.y[i] - y;
      const dz = store.z[i] - z;
      if (dx * dx + dy * dy + dz * dz <= SLEEP_HOSTILE_RADIUS_SQ) count++;
    }
    return count;
  }

  /**
   * Abre ou fecha porta, portão e alçapão (doc 04 §2.5). Mesmo bloco não abre
   * duas vezes no mesmo clique porque o cooldown de colocação segura o botão.
   */
  toggle(x: number, y: number, z: number): boolean {
    const { world } = this.host;
    const current = world.getBlock(x, y, z);
    const next = toggleOpenState(current);
    if (next < 0) return false;
    if (!world.setBlock(x, y, z, next, 'player')) return false;
    this.host.changed(x, y, z, current, next);
    /*
     * A porta tem duas folhas desde o M8, e as duas giram juntas: clicar na de
     * baixo e ver só ela abrir seria pior que a porta de um bloco que ela
     * substituiu. O bit de aberto é o mesmo nas duas, então basta copiá-lo.
     */
    if (partnerOffset(current, DOOR_PARTNER)) {
      const px = x + DOOR_PARTNER[0];
      const py = y + DOOR_PARTNER[1];
      const pz = z + DOOR_PARTNER[2];
      const other = world.getBlock(px, py, pz);
      const otherNext = toggleOpenState(other);
      if (otherNext >= 0 && blockIdOf(other) === partnerIdOf(blockIdOf(current))
        && world.setBlock(px, py, pz, otherNext, 'player')) {
        this.host.changed(px, py, pz, other, otherNext);
      }
    }
    this.host.sound('block/door', x, y, z);
    return true;
  }

  /**
   * Uma fatia de bolo (doc 05 §4: 2 de fome e 0,4 de saturação por fatia, 7
   * fatias). De barriga cheia o clique é gasto sem comer, como no gênero — é
   * o que impede colocar bloco em cima do bolo sem querer.
   */
  cake(x: number, y: number, z: number): boolean {
    const { world, survival } = this.host;
    const state = world.getBlock(x, y, z);
    if (blockIdOf(state) !== CAKE) return false;
    if (!survival.canEat) return true;
    survival.eat(CAKE_HUNGER, CAKE_SATURATION);
    const eaten = (stateBitsOf(state) & 7) + 1;
    const next = eaten >= CAKE_SLICES ? AIR : makeState(CAKE, eaten);
    if (world.setBlock(x, y, z, next, 'player')) this.host.changed(x, y, z, state, next);
    this.host.sound('player/eat', x + 0.5, y + 0.5, z + 0.5);
    return true;
  }
}
