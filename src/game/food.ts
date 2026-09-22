/**
 * O que acontece depois de comer, além de fome e saturação (doc 05 §4).
 *
 * Fica fora da `Session` porque é regra de comida, não de costura: o bolo
 * (comido no bloco) e o item (comido na mão) passam pelo mesmo caminho.
 */

import { EFFECT_BY_NAME, type FoodEffect } from '../data/effects';
import type { Survival } from './survival';

/** Aplica os efeitos da comida, cada um com a sua chance. */
export function applyFoodEffects(
  survival: Survival, effects: readonly FoodEffect[] | undefined, random: () => number,
): void {
  if (effects === undefined) return;
  for (const entry of effects) {
    if (entry.chance !== undefined && random() >= entry.chance) continue;
    const def = EFFECT_BY_NAME.get(entry.effect);
    if (def === undefined) continue;
    survival.effects.add(def.id, entry.level, entry.seconds * 20, survival);
  }
}
