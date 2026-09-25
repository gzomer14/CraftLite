/**
 * A frase que a mesa de encantamento e a bigorna mostram embaixo dos slots:
 * o que falta pôr, onde, e quanto custa.
 *
 * Nasceu de um relato de campo (2026-09-24): com dois ou três slots vazios e
 * sem rótulo, o jogador não sabia qual recebia o item, qual o material e qual
 * era o resultado — e na mesa, com os botões apagados, não havia como saber
 * o que faltava. Aqui é só texto a partir do estado, sem DOM, para dar para
 * testar no Node; os painéis (`ui/containers/enchantpanel.ts`,
 * `ui/containers/anvilpanel.ts`) só escrevem o que sai daqui.
 *
 * Os nomes "Item", "Lápis" e "Material" são os rótulos embaixo dos slots.
 */

import { t, tf } from '../core/i18n';
import { isEnchantable } from '../data/enchants';
import { ITEM_BY_NAME, itemDef, maxStackOf, type ItemStack } from '../data/items';
import { repairMaterialName, repairsWith, type AnvilOutcome } from './anvil';
import {
  BREW_BOTTLE_COUNT, BREW_FUEL, BREW_INGREDIENT, brewResult, isBrewingFuel, type BrewingStand,
} from './brewing';

const ENCHANTED_BOOK = ITEM_BY_NAME.get('enchanted_book')?.id ?? -1;

/** "1 nível", "5 níveis". */
export function levels(n: number): string {
  return n === 1 ? t('station.level_one') : tf('station.levels', n);
}

/** O que a mesa diz, dado o que está nela. */
export function enchantHelp(
  item: ItemStack | null, lapis: number, validOffers: number, level: number, creative: boolean,
): string {
  if (item === null) return t('enchant.put_item');
  if (validOffers === 0) {
    return isEnchantable(item.item)
      ? t('enchant.maxed')
      : t('enchant.cannot');
  }
  if (creative) return t('enchant.creative');
  if (lapis === 0) return t('enchant.put_lapis');
  return tf('enchant.pick', levels(level));
}

/** Por que a bigorna não entrega o resultado, como devolve `Workbench.anvilBlocker`. */
export type AnvilBlocker = 'ok' | 'nothing' | 'expensive' | 'no-level';

/** O que a bigorna diz, dado o que está nela. */
export function anvilHelp(
  left: ItemStack | null, right: ItemStack | null, outcome: AnvilOutcome,
  blocker: AnvilBlocker, level: number, creative: boolean,
): string {
  if (left === null) return t('anvil.put_item');
  if (outcome.result !== null) {
    if (blocker === 'expensive') return t('anvil.too_expensive');
    if (blocker === 'no-level') return tf('anvil.no_level', levels(outcome.cost), level);
    if (creative) return t('anvil.creative');
    return tf('anvil.cost', levels(outcome.cost));
  }
  if (maxStackOf(left.item) > 1) {
    return t('anvil.only_gear');
  }
  const material = repairMaterialName(left.item);
  if (right === null) {
    if (left.item === ENCHANTED_BOOK) {
      return t('anvil.book_material');
    }
    if ((itemDef(left.item)?.durability ?? 0) <= 0) return t('anvil.name_only');
    const fix = material !== null ? tf('anvil.fix_with', material) : '';
    return tf('anvil.material', fix);
  }
  if (left.damage === 0 && repairsWith(left.item, right.item)) return t('anvil.not_worn');
  if (right.item === left.item || right.item === ENCHANTED_BOOK) {
    return t('anvil.no_change');
  }
  const tail = material !== null ? tf('anvil.repairs_with', material) : '';
  return tf('anvil.wrong', itemDef(right.item)?.display ?? t('station.that'), tail);
}

const WATER_BOTTLE = ITEM_BY_NAME.get('water_bottle')?.id ?? -1;

/** O que o suporte de preparo diz (M16), dado o que está nele. */
export function brewingHelp(stand: BrewingStand): string {
  let bottles = 0;
  let water = 0;
  for (let i = 0; i < BREW_BOTTLE_COUNT; i++) {
    const bottle = stand.get(i);
    if (bottle === null) continue;
    bottles++;
    if (bottle.item === WATER_BOTTLE) water++;
  }
  if (stand.brewTicks > 0) return t('brew.boiling');
  if (bottles === 0) return t('brew.put_bottle');
  const ingredient = stand.get(BREW_INGREDIENT);
  if (ingredient === null) {
    return water === bottles
      ? t('brew.put_wart')
      : t('brew.put_effect');
  }
  let fits = false;
  for (let i = 0; i < BREW_BOTTLE_COUNT && !fits; i++) {
    const bottle = stand.get(i);
    if (bottle !== null && brewResult(bottle.item, ingredient.item) >= 0) fits = true;
  }
  if (!fits) return tf('brew.wrong', itemDef(ingredient.item)?.display ?? t('station.that'));
  const fuel = stand.get(BREW_FUEL);
  if (stand.fuel === 0 && (fuel === null || !isBrewingFuel(fuel.item))) {
    return t('brew.put_fuel');
  }
  return t('brew.boiling');
}
