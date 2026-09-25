/**
 * Regras do doc 07 que não são IA (saíram de `mobs.ts` no M18): quando o mob
 * some, quanto um drop rende e para onde o enderman teleporta.
 *
 * Funções sem estado: quem guarda o pool e dispara os eventos é `Mobs`.
 */

import { LAVA, blockIdOf } from '../data/blocks';
import { ITEM_BY_NAME } from '../data/items';
import { mobDef } from '../data/mobs';
import { lootingBonus } from '../game/enchanting';
import { standHeight } from './ai/pathfinder';
import { FLAG_PERSISTENT, type MobStore } from './mobstore';
import type { Drop } from '../data/loot';
import type { World } from '../world/world';

/** Distância em que o hostil despawna na hora (doc 07 §4). */
const DESPAWN_HARD = 128;
/** A partir daqui, 1/800 de chance por tick. */
const DESPAWN_SOFT = 32;
const DESPAWN_CHANCE = 800;

/** Regras do doc 07 §4: true se o mob deve sair do pool agora. */
export function shouldDespawn(
  s: MobStore, i: number, playerX: number, playerZ: number, difficulty: number,
  random: () => number,
): boolean {
  const def = mobDef(s.type[i]);
  if (!def.despawnable || s.hasFlag(i, FLAG_PERSISTENT)) return false;

  const dx = s.x[i] - playerX;
  const dz = s.z[i] - playerZ;
  const distanceSq = dx * dx + dz * dz;

  if (distanceSq > DESPAWN_HARD * DESPAWN_HARD) {
    return true;
  }
  if (distanceSq > DESPAWN_SOFT * DESPAWN_SOFT && random() < 1 / DESPAWN_CHANCE) {
    return true;
  }
  // Pacífico: hostis somem (doc 06 §10).
  if (difficulty === 0 && def.category === 'hostile') {
    return true;
  }
  return false;
}

/**
 * Sorteia um drop.
 *
 * Diferente de bloco quebrado, aqui o sorteio **não** é derivado da seed: o
 * drop de um mob não é conteúdo do mundo, e amarrá-lo à posição faria o mesmo
 * zumbi soltar sempre a mesma coisa no mesmo lugar.
 */
export function rollDrop(drop: Drop, random: () => number, looting: number): { item: number; count: number } | null {
  const item = ITEM_BY_NAME.get(drop.item);
  if (item === undefined) return null;
  if (drop.chance !== undefined && random() >= drop.chance) return null;

  let count: number;
  if (typeof drop.count === 'number') {
    count = drop.count;
  } else {
    count = drop.count[0] + Math.floor(random() * (drop.count[1] - drop.count[0] + 1));
  }
  // Pilhagem só acrescenta ao que já saiu: um drop que falhou no sorteio de
  // chance continua não saindo.
  if (count > 0) count += lootingBonus(looting, random());
  if (count <= 0) return null;
  return { item: item.id, count };
}

/** Enderman teleporta para uma posição válida num raio de 16 (doc 07 §2). */
export function teleport(
  s: MobStore, i: number, world: World, random: () => number,
  onSound: (name: string, x: number, y: number, z: number) => void,
): void {
  const tall = Math.max(1, Math.ceil(s.height(i)));
  for (let attempt = 0; attempt < 8; attempt++) {
    const x = Math.floor(s.x[i] + (random() - 0.5) * 32);
    const z = Math.floor(s.z[i] + (random() - 0.5) * 32);
    const y = standHeight(world, x, Math.floor(s.y[i]) + 2, z, tall);
    if (y < 0) continue;
    s.x[i] = x + 0.5; s.y[i] = y; s.z[i] = z + 0.5;
    s.prevX[i] = s.x[i]; s.prevY[i] = s.y[i]; s.prevZ[i] = s.z[i];
    s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
    s.clearMoveTarget(i);
    onSound('mob/enderman_teleport', s.x[i], s.centerY(i), s.z[i]);
    return;
  }
}

/** Ticks de fogo ao pegar sol, e dano a cada 20 ticks. */
const SUNLIGHT_FIRE_TICKS = 160;
/** Dano de lava por meio segundo, e quanto tempo o mob continua queimando. */
const LAVA_DAMAGE = 4;
const LAVA_FIRE_TICKS = 100;

/**
 * Fogo, lava, void e sol: acende o fogo e devolve o dano deste tick (0 =
 * nenhum). Quem aplica é `Mobs.damage`.
 *
 * Lava (M7): o traço `fireImmune` existia desde o M5 e **nenhum mob o
 * declarava** — não havia como pegar fogo além do sol. O Nether é metade lava,
 * e sem isto o ghast e o porco zumbi passeariam dentro dela junto com o zumbi
 * que os seguiu pelo portal.
 */
export function environmentHarm(
  s: MobStore, i: number, world: World, isDay: boolean, skyLight: number, tickCount: number,
): number {
  const def = mobDef(s.type[i]);
  if (def.traits.burnsInSunlight === true && isDay && skyLight >= 15 && s.fireTicks[i] <= 0) {
    s.fireTicks[i] = SUNLIGHT_FIRE_TICKS;
  }
  if (def.traits.fireImmune !== true && inLava(s, i, world)) {
    s.fireTicks[i] = LAVA_FIRE_TICKS;
    if (tickCount % 10 === 0) return LAVA_DAMAGE;
  }
  if (s.fireTicks[i] > 0 && def.traits.fireImmune !== true) {
    s.fireTicks[i]--;
    if (s.fireTicks[i] % 20 === 0) return 1;
  }
  return s.y[i] < -4 ? 4 : 0;
}

/** true se os pés do mob estão dentro de lava. */
function inLava(s: MobStore, i: number, world: World): boolean {
  return blockIdOf(world.getBlock(
    Math.floor(s.x[i]), Math.floor(s.y[i] + 0.1), Math.floor(s.z[i]),
  )) === LAVA;
}
