/**
 * Suporte de preparo (doc 14 — M16): três frascos, um ingrediente e o pó de
 * blaze que o faz ferver.
 *
 * Mesmo molde da fornalha (`Furnace` em `container.ts`): um contêiner com
 * contadores que andam no tick do mundo, com a tela fechada. As receitas vêm
 * de `data/potions.ts` e o suporte não sabe o nome de nenhuma poção.
 *
 * Regras, as do gênero:
 * - o preparo só começa se o ingrediente serve para **algum** dos frascos;
 * - no fim, cada frasco que tinha receita vira o resultado, e o ingrediente
 *   gasta **um** — três poções pelo preço de uma verruga;
 * - um pó de blaze vale `BREWS_PER_FUEL` preparos;
 * - tirar o ingrediente ou os frascos no meio cancela o preparo.
 */

import { BREWING, BREWING_FUEL, BREW_TICKS, BREWS_PER_FUEL, POTIONS } from '../data/potions';
import { ITEM_BY_NAME } from '../data/items';
import { Container } from './container';

/** Slots: 0..2 frascos, 3 ingrediente, 4 combustível. */
export const BREW_BOTTLE_COUNT = 3;
export const BREW_INGREDIENT = 3;
export const BREW_FUEL = 4;
export const BREW_SLOTS = 5;

const FUEL_ITEM = ITEM_BY_NAME.get(BREWING_FUEL)?.id ?? -1;

/** `base * 4096 + ingrediente` → resultado. Resolvido uma vez. */
const RECIPES = new Map<number, number>();
/** Ingredientes que servem para alguma receita (a tela e o funil perguntam). */
const INGREDIENTS = new Set<number>();
/** Frascos que são base de alguma receita. */
const BASES = new Set<number>();
for (const recipe of BREWING) {
  const base = ITEM_BY_NAME.get(recipe.base)?.id;
  const ingredient = ITEM_BY_NAME.get(recipe.ingredient)?.id;
  const result = ITEM_BY_NAME.get(recipe.result)?.id;
  if (base === undefined || ingredient === undefined || result === undefined) {
    throw new Error(`Receita de poção com item desconhecido: ${recipe.base} + ${recipe.ingredient}`);
  }
  RECIPES.set(base * 4096 + ingredient, result);
  INGREDIENTS.add(ingredient);
  BASES.add(base);
}

/** Todo item de poção (frasco d'água incluído): só eles entram nos frascos. */
const POTION_ITEMS = new Set<number>();
for (const potion of POTIONS) {
  const id = ITEM_BY_NAME.get(potion.name)?.id;
  if (id !== undefined) POTION_ITEMS.add(id);
}

/**
 * true se `item` pode ir no slot `index` do suporte: frasco nos frascos, pó
 * de blaze no combustível, qualquer coisa no ingrediente (a frase da tela diz
 * se serve).
 */
export function brewingAccepts(index: number, item: number): boolean {
  if (index < BREW_BOTTLE_COUNT) return POTION_ITEMS.has(item);
  if (index === BREW_FUEL) return item === FUEL_ITEM;
  return true;
}

/** O que `base` vira com `ingredient`, ou −1. */
export function brewResult(base: number, ingredient: number): number {
  return RECIPES.get(base * 4096 + ingredient) ?? -1;
}

/** true se o item é ingrediente de alguma receita. */
export function isBrewingIngredient(item: number): boolean {
  return INGREDIENTS.has(item);
}

/** true se o item vai num slot de frasco (é base de receita, ou poção pronta). */
export function isBrewingBase(item: number): boolean {
  return BASES.has(item);
}

/** true se o item é o combustível do suporte. */
export function isBrewingFuel(item: number): boolean {
  return item === FUEL_ITEM;
}

export class BrewingStand extends Container {
  /** Preparos que o combustível aceso ainda paga. */
  fuel = 0;
  /** Ticks que faltam para o preparo em curso; 0 = parado. */
  brewTicks = 0;

  constructor(x: number, y: number, z: number) {
    super('brewing', BREW_SLOTS, x, y, z);
  }

  /** 0..1 do preparo atual (a barra da tela). */
  get progress(): number {
    return this.brewTicks === 0 ? 0 : 1 - this.brewTicks / BREW_TICKS;
  }

  /** true se o ingrediente serve para pelo menos um dos frascos. */
  canBrew(): boolean {
    const ingredient = this.slots[BREW_INGREDIENT];
    if (ingredient === null) return false;
    for (let i = 0; i < BREW_BOTTLE_COUNT; i++) {
      const bottle = this.slots[i];
      if (bottle !== null && brewResult(bottle.item, ingredient.item) >= 0) return true;
    }
    return false;
  }

  /** Um tick. Devolve true se algo mudou (a tela redesenha). */
  tick(): boolean {
    if (this.brewTicks > 0) {
      if (!this.canBrew()) {
        this.brewTicks = 0;
        this.onChange?.();
        return true;
      }
      this.brewTicks--;
      if (this.brewTicks === 0) this.finish();
      return true;
    }
    if (!this.canBrew()) return false;
    if (this.fuel === 0 && !this.takeFuel()) return false;
    this.fuel--;
    this.brewTicks = BREW_TICKS;
    this.onChange?.();
    return true;
  }

  /** Acende um pó de blaze do slot de combustível. */
  private takeFuel(): boolean {
    const slot = this.slots[BREW_FUEL];
    if (slot === null || slot.item !== FUEL_ITEM) return false;
    slot.count--;
    if (slot.count <= 0) this.slots[BREW_FUEL] = null;
    this.fuel = BREWS_PER_FUEL;
    return true;
  }

  /** Fim do preparo: cada frasco com receita muda, e o ingrediente gasta um. */
  private finish(): void {
    const ingredient = this.slots[BREW_INGREDIENT];
    if (ingredient === null) return;
    for (let i = 0; i < BREW_BOTTLE_COUNT; i++) {
      const bottle = this.slots[i];
      if (bottle === null) continue;
      const result = brewResult(bottle.item, ingredient.item);
      if (result >= 0) this.slots[i] = { item: result, count: 1, damage: 0 };
    }
    ingredient.count--;
    if (ingredient.count <= 0) this.slots[BREW_INGREDIENT] = null;
    this.onChange?.();
  }
}
