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

import { isEnchantable } from '../data/enchants';
import { ITEM_BY_NAME, itemDef, maxStackOf, type ItemStack } from '../data/items';
import { repairMaterialName, repairsWith, type AnvilOutcome } from './anvil';
import {
  BREW_BOTTLE_COUNT, BREW_FUEL, BREW_INGREDIENT, brewResult, isBrewingFuel, type BrewingStand,
} from './brewing';

const ENCHANTED_BOOK = ITEM_BY_NAME.get('enchanted_book')?.id ?? -1;

/** "1 nível", "5 níveis". */
export function levels(n: number): string {
  return n === 1 ? '1 nível' : `${n} níveis`;
}

/** O que a mesa diz, dado o que está nela. */
export function enchantHelp(
  item: ItemStack | null, lapis: number, validOffers: number, level: number, creative: boolean,
): string {
  if (item === null) return 'Ponha em Item a ferramenta, arma, armadura ou livro a encantar.';
  if (validOffers === 0) {
    return isEnchantable(item.item)
      ? 'Este item já tem tudo o que a mesa pode dar.'
      : 'Este item não pode ser encantado.';
  }
  if (creative) return 'Toque num encantamento. No Criativo não custa nada.';
  if (lapis === 0) return 'Ponha lápis-lazúli em Lápis: cada encantamento gasta de 1 a 3.';
  return `Toque num encantamento. Você tem ${levels(level)}.`;
}

/** Por que a bigorna não entrega o resultado, como devolve `Workbench.anvilBlocker`. */
export type AnvilBlocker = 'ok' | 'nothing' | 'expensive' | 'no-level';

/** O que a bigorna diz, dado o que está nela. */
export function anvilHelp(
  left: ItemStack | null, right: ItemStack | null, outcome: AnvilOutcome,
  blocker: AnvilBlocker, level: number, creative: boolean,
): string {
  if (left === null) return 'Ponha em Item o que quer consertar, juntar, encantar ou renomear.';
  if (outcome.result !== null) {
    if (blocker === 'expensive') return 'Caro demais!';
    if (blocker === 'no-level') return `Custa ${levels(outcome.cost)} e você tem ${level}.`;
    if (creative) return 'Pegue o resultado. No Criativo não custa nada.';
    return `Custa ${levels(outcome.cost)}. Pegue o resultado.`;
  }
  if (maxStackOf(left.item) > 1) {
    return 'Na bigorna entram ferramentas, armas, armaduras e livros encantados.';
  }
  const material = repairMaterialName(left.item);
  if (right === null) {
    if (left.item === ENCHANTED_BOOK) {
      return 'Em Material: outro livro encantado, para juntar os dois. Ou escreva um nome.';
    }
    if ((itemDef(left.item)?.durability ?? 0) <= 0) return 'Este item só pode ganhar um nome.';
    const fix = material !== null ? `${material} para consertar, ` : '';
    return `Em Material: ${fix}outro igual para juntar ou um livro encantado. Ou escreva um nome.`;
  }
  if (left.damage === 0 && repairsWith(left.item, right.item)) return 'Este item não está gasto.';
  if (right.item === left.item || right.item === ENCHANTED_BOOK) {
    return 'Juntar estes dois não muda nada.';
  }
  const tail = material !== null ? ` Este item conserta com ${material}.` : '';
  return `${itemDef(right.item)?.display ?? 'Isso'} não serve aqui.${tail}`;
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
  if (stand.brewTicks > 0) return 'Fervendo…';
  if (bottles === 0) return 'Ponha em Frasco um frasco d\'água (frasco de vidro enchido na água).';
  const ingredient = stand.get(BREW_INGREDIENT);
  if (ingredient === null) {
    return water === bottles
      ? 'Ponha verruga do Nether em Ingrediente: é ela que começa toda poção.'
      : 'Ponha em Ingrediente o que dá o efeito: pó de blaze, açúcar, cenoura dourada…';
  }
  let fits = false;
  for (let i = 0; i < BREW_BOTTLE_COUNT && !fits; i++) {
    const bottle = stand.get(i);
    if (bottle !== null && brewResult(bottle.item, ingredient.item) >= 0) fits = true;
  }
  if (!fits) return `${itemDef(ingredient.item)?.display ?? 'Isso'} não serve para estes frascos.`;
  const fuel = stand.get(BREW_FUEL);
  if (stand.fuel === 0 && (fuel === null || !isBrewingFuel(fuel.item))) {
    return 'Ponha pó de blaze em Combustível para ferver.';
  }
  return 'Fervendo…';
}
