/**
 * Matemática de combate: armadura, dano de ataque e empurrão
 * (doc 05 §2–§3, doc 06 §6, doc 07 §2).
 *
 * Fica separado de quem aplica o dano (`Survival`, `Mobs`) porque é aqui que
 * moram as fórmulas — e porque fórmula é o que dá para testar sem mundo, sem
 * GL e sem DOM.
 */

import { itemDef, type ItemStack } from '../data/items';
import { PROTECTION, SHARPNESS } from '../data/enchants';
import { levelOf, sharpnessBonus } from './enchanting';
import { ARMOR_END, ARMOR_START, armorSlotIndex } from './inventory';

/** Dano com a mão vazia (doc 05 §2). */
export const FIST_DAMAGE = 1;
/** Ataques por segundo com a mão vazia. */
export const FIST_ATTACK_SPEED = 4;
/** Empurrão horizontal de um golpe do jogador. */
export const HIT_KNOCKBACK = 0.4;
/** Componente vertical do empurrão — é o que dá o "pop" do acerto. */
export const HIT_KNOCKBACK_UP = 0.36;
/** Teto de pontos de armadura que contam (doc 05 §3). */
const MAX_ARMOR = 20;

export interface ArmorTotals {
  defense: number;
  toughness: number;
  /** Soma dos níveis de Proteção nas quatro peças (M6). */
  protection: number;
}

/** Soma os 4 slots de armadura do inventário. */
export function armorTotals(
  slots: readonly (ItemStack | null)[], out: ArmorTotals,
): ArmorTotals {
  out.defense = 0;
  out.toughness = 0;
  out.protection = 0;
  for (let i = ARMOR_START; i < ARMOR_END; i++) {
    const stack = slots[i] ?? null;
    if (stack === null) continue;
    out.protection += levelOf(stack, PROTECTION);
    const armor = itemDef(stack.item)?.armor;
    if (armor === undefined) continue;
    out.defense += armor.defense;
    out.toughness += armor.toughness;
  }
  return out;
}

/**
 * Dano depois da armadura (doc 05 §3).
 *
 * A fórmula com toughness é a do doc; o piso de `defense / 5` existe porque sem
 * ele um golpe forte anularia a armadura por completo, e uma armadura de
 * diamante deixaria de valer a pena exatamente contra o que mais machuca.
 */
export function reduceByArmor(damage: number, defense: number, toughness: number): number {
  if (defense <= 0 || damage <= 0) return damage;
  const effective = Math.min(
    MAX_ARMOR,
    Math.max(defense / 5, defense - damage / (2 + toughness / 4)),
  );
  return damage * (1 - effective / 25);
}

/** Slot de armadura de um item, ou −1 se não é armadura. */
export function armorSlotOf(item: number): number {
  const armor = itemDef(item)?.armor;
  return armor === undefined ? -1 : armorSlotIndex(armor.slot);
}

/** Dano de ataque do que está na mão, já com Afiação (doc 05 §2). */
export function attackDamageOf(held: ItemStack | null): number {
  if (held === null) return FIST_DAMAGE;
  const base = itemDef(held.item)?.attack ?? FIST_DAMAGE;
  return base + sharpnessBonus(levelOf(held, SHARPNESS));
}

/**
 * Cooldown de ataque em ticks. Espada 1.6/s → 12 ticks; machado 0.9/s → 22.
 * É o que impede segurar o botão e picar tudo em cima do mob.
 */
export function attackCooldownOf(held: ItemStack | null): number {
  const speed = held === null
    ? FIST_ATTACK_SPEED
    : itemDef(held.item)?.attackSpeed ?? FIST_ATTACK_SPEED;
  return Math.max(1, Math.round(20 / speed));
}

/** Durabilidade gasta por peça de armadura ao levar dano (mínimo 1). */
export function armorDurabilityCost(damage: number): number {
  return Math.max(1, Math.floor(damage / 4));
}
