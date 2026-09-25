/**
 * Cuidar de bicho (M6; saiu de `mobs.ts` no M18): domar, dar comida e cruzar.
 * O resto da criação — tosa, tinta, o que a ovelha come — está em
 * `husbandry.ts`.
 */

import { mobDef } from '../data/mobs';
import { babyVariant } from './husbandry';
import { FLAG_ANGRY, FLAG_PERSISTENT, FLAG_TAMED, type MobStore } from './mobstore';

/** Ticks que o bicho fica "no amor" depois de comer o item certo (30 s). */
export const LOVE_TICKS = 600;
/** Ticks até o filhote virar adulto (5 min) — o original leva 20. */
export const GROW_TICKS = 6000;
/** Ticks entre duas reproduções do mesmo bicho (2,5 min). */
export const BREED_COOLDOWN = 3000;
/** Quanto cada item de comida apressa o crescimento do filhote. */
const FEED_GROWTH = 600;

/** O que o cuidado precisa da gerência de mobs. */
export interface CareHost {
  readonly store: MobStore;
  random(): number;
  sound(i: number, kind: 'ambient' | 'hurt'): void;
  onXp(amount: number, x: number, y: number, z: number): void;
}

/**
 * Tenta domar o mob `i` com `itemName` (doc 07 §2: osso, 1/3 de chance).
 *
 * Devolve `'none'` se o mob não é domável ou o item é outro — aí o item não é
 * consumido e o clique segue o caminho normal (colocar bloco, abrir baú).
 */
export function tryTame(h: CareHost, i: number, itemName: string): 'none' | 'tamed' | 'failed' {
  const s = h.store;
  const traits = mobDef(s.type[i]).traits;
  if (traits.tameItem === undefined || traits.tameItem !== itemName) return 'none';
  if (s.hasFlag(i, FLAG_TAMED)) return 'none';

  if (h.random() >= (traits.tameChance ?? 1 / 3)) {
    h.sound(i, 'hurt');
    return 'failed';
  }
  s.setFlag(i, FLAG_TAMED, true);
  s.setFlag(i, FLAG_PERSISTENT, true);
  s.setFlag(i, FLAG_ANGRY, false);
  s.hasTarget[i] = 0;
  // Domado ganha vida cheia de bicho de estimação (doc 07 §2: HP 20).
  s.health[i] = 20;
  h.sound(i, 'ambient');
  return 'tamed';
}

/**
 * Dá o item de reprodução na mão do jogador ao mob `i`.
 *
 * Adulto pronto entra no amor; filhote cresce mais rápido; quem acabou de
 * cruzar recusa. Devolve `'none'` quando o item não serve — aí o clique
 * segue o caminho normal (comer, colocar bloco).
 */
export function tryFeed(h: CareHost, i: number, itemName: string): 'none' | 'love' | 'grow' | 'wait' {
  const s = h.store;
  const traits = mobDef(s.type[i]).traits;
  if (traits.breedItem === undefined || traits.breedItem !== itemName) return 'none';

  if (s.isBaby(i)) {
    s.growTicks[i] = Math.max(0, s.growTicks[i] - FEED_GROWTH);
    if (s.growTicks[i] === 0) s.scale[i] = 1;
    h.sound(i, 'ambient');
    return 'grow';
  }
  if (s.breedCooldown[i] > 0 || s.loveTicks[i] > 0) return 'wait';

  s.loveTicks[i] = LOVE_TICKS;
  s.setFlag(i, FLAG_PERSISTENT, true);
  h.sound(i, 'ambient');
  return 'love';
}

/**
 * Nasce um filhote entre os dois pais (doc 14 — M6).
 *
 * Os dois saem do amor e entram em cooldown mesmo se o pool estiver cheio:
 * senão um par preso num canto ficaria tentando cruzar todo tick.
 */
export function breed(h: CareHost, i: number, partner: number): void {
  const s = h.store;
  s.loveTicks[i] = 0;
  s.loveTicks[partner] = 0;
  s.breedCooldown[i] = BREED_COOLDOWN;
  s.breedCooldown[partner] = BREED_COOLDOWN;
  s.clearMoveTarget(i);
  s.clearMoveTarget(partner);

  const x = (s.x[i] + s.x[partner]) * 0.5;
  const y = Math.max(s.y[i], s.y[partner]);
  const z = (s.z[i] + s.z[partner]) * 0.5;
  const baby = h.store.spawn(
    s.type[i], x, y, z, babyVariant(mobDef(s.type[i]), s.variant[i]),
  );
  if (baby >= 0) {
    h.store.makeBaby(baby, GROW_TICKS);
    h.store.setFlag(baby, FLAG_PERSISTENT, true);
    h.sound(baby, 'ambient');
  }
  h.onXp(1 + Math.floor(h.random() * 7), x, y, z);
}
