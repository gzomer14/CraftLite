/**
 * A bigorna (M15): consertar com o material, juntar duas peças, aplicar livro
 * encantado e dar nome. Funções de número, sem mundo e sem tela — a tela
 * (`ui/containers/anvilpanel.ts`) e a bancada (`game/workbench.ts`) só
 * chamam `anvilResult` e aplicam o que ele disse.
 *
 * **Simplificações conscientes** do gênero: não há "custo de trabalho
 * anterior" (a mesma peça não encarece a cada passagem), e a bigorna não se
 * desgasta nem cai como bloco de areia. O teto de "Caro demais" existe.
 *
 * **Nome só em item que não empilha** (ferramenta, armadura, livro
 * encantado): uma pilha de 64 com nome obrigaria o inventário inteiro a
 * decidir o que fazer ao juntar pilhas de nomes diferentes.
 */

import {
  COMBINE_BONUS, COMBINE_COST, ENCHANT_COST_BOOK, ENCHANT_COST_ITEM, MAX_NAME_LENGTH,
  RENAME_COST, REPAIR_MATERIAL, REPAIR_PER_UNIT, REPAIR_TAG_DISPLAY,
} from '../data/anvil';
import { CONFLICTS, ENCHANTS, fitsItem } from '../data/enchants';
import { ITEM_BY_NAME, itemDef, maxStackOf, type ItemStack } from '../data/items';
import { TAGS } from '../data/recipes';
import { levelIn, withEnchant } from './enchanting';

const ENCHANTED_BOOK = ITEM_BY_NAME.get('enchanted_book')?.id ?? -1;

/** O que a bigorna faria com o que está nos dois slots. */
export interface AnvilOutcome {
  /** A peça que sai, ou `null` se a combinação não vale nada. */
  result: ItemStack | null;
  /** Níveis de experiência que custa. */
  cost: number;
  /** Quantas unidades do slot da direita a operação gasta. */
  rightUsed: number;
}

/** Itens que consertam `item`, pelo prefixo de material do nome. */
function repairItemsOf(item: number): readonly number[] {
  const name = itemDef(item)?.name ?? '';
  const material = REPAIR_MATERIAL[name.slice(0, name.indexOf('_'))];
  if (material === undefined) return NONE;
  const names = material.startsWith('#') ? TAGS[material.slice(1)] ?? [] : [material];
  const out: number[] = [];
  for (const n of names) {
    const def = ITEM_BY_NAME.get(n);
    if (def !== undefined) out.push(def.id);
  }
  return out;
}

const NONE: readonly number[] = [];

/**
 * Nome do material que conserta `item`, em minúsculas para caber no meio da
 * frase ("conserta com diamante"). `null` se nada conserta.
 */
export function repairMaterialName(item: number): string | null {
  const def = itemDef(item);
  if (def === undefined || (def.durability ?? 0) <= 0) return null;
  const material = REPAIR_MATERIAL[def.name.slice(0, def.name.indexOf('_'))];
  if (material === undefined) return null;
  if (material.startsWith('#')) return REPAIR_TAG_DISPLAY[material.slice(1)] ?? null;
  const display = ITEM_BY_NAME.get(material)?.display;
  return display === undefined ? null : display.toLowerCase();
}

/** true se `material` conserta `item` (a madeira aceita qualquer tábua). */
export function repairsWith(item: number, material: number): boolean {
  return repairItemsOf(item).includes(material);
}

/**
 * Encantamentos de `from` gravados em `into`: nível igual sobe um, diferente
 * fica o maior; o que não cabe no item ou briga com o que já está lá é
 * ignorado. Devolve a máscara nova e o custo.
 */
export function mergeEnchants(
  into: number, from: number, targetItem: number, fromBook: boolean,
): { ench: number; cost: number } {
  let ench = into;
  let cost = 0;
  const bookTarget = targetItem === ENCHANTED_BOOK;
  for (const def of ENCHANTS) {
    const level = levelIn(from, def.id);
    if (level === 0) continue;
    if (!bookTarget && !fitsItem(def.id, targetItem)) continue;
    let clash = false;
    for (const other of CONFLICTS[def.id]) {
      if (levelIn(ench, other) > 0) { clash = true; break; }
    }
    if (clash) continue;
    const current = levelIn(ench, def.id);
    const next = current === level ? Math.min(def.maxLevel, level + 1) : Math.max(current, level);
    if (next === current) continue;
    ench = withEnchant(ench, def.id, next);
    cost += next * (fromBook ? ENCHANT_COST_BOOK : ENCHANT_COST_ITEM);
  }
  return { ench, cost };
}

/**
 * Nome limpo para gravar: sem espaço nas pontas e no tamanho máximo. Vazio
 * quer dizer "sem nome".
 */
export function cleanName(name: string): string {
  return name.trim().slice(0, MAX_NAME_LENGTH);
}

/**
 * O resultado da bigorna para `left` + `right`, com o nome digitado em
 * `rename` (`null` = o campo não foi mexido). Escreve em `out` e o devolve.
 */
export function anvilResult(
  left: ItemStack | null, right: ItemStack | null, rename: string | null, out: AnvilOutcome,
): AnvilOutcome {
  out.result = null;
  out.cost = 0;
  out.rightUsed = 0;
  if (left === null) return out;

  const def = itemDef(left.item);
  const max = def?.durability ?? 0;
  const result: ItemStack = { ...left, count: 1 };
  let cost = 0;
  let changed = false;

  if (right !== null) {
    if (max > 0 && left.damage > 0 && repairsWith(left.item, right.item)) {
      // Conserto com material: um quarto da durabilidade por unidade.
      const perUnit = Math.max(1, Math.floor(max * REPAIR_PER_UNIT));
      const needed = Math.ceil(left.damage / perUnit);
      const used = Math.min(needed, right.count);
      result.damage = Math.max(0, left.damage - used * perUnit);
      out.rightUsed = used;
      cost += used;
      changed = true;
    } else if (right.item === left.item || right.item === ENCHANTED_BOOK) {
      const fromBook = right.item === ENCHANTED_BOOK;
      if (!fromBook && max > 0) {
        // Duas peças iguais: soma as durabilidades, com bônus.
        const remaining = (max - left.damage) + (max - right.damage) + Math.floor(max * COMBINE_BONUS);
        result.damage = Math.max(0, max - remaining);
        if (result.damage !== left.damage) changed = true;
        cost += COMBINE_COST;
      }
      const merged = mergeEnchants(left.ench ?? 0, right.ench ?? 0, left.item, fromBook);
      if (merged.ench !== (left.ench ?? 0)) {
        result.ench = merged.ench;
        cost += merged.cost;
        changed = true;
      }
      if (!changed) return out;
      out.rightUsed = 1;
    } else {
      return out; // o slot da direita não serve para esta peça
    }
  }

  // Nome: só em item que não empilha (ver o comentário do módulo).
  if (rename !== null && maxStackOf(left.item) === 1) {
    const name = cleanName(rename);
    const current = left.name ?? '';
    if (name !== current) {
      if (name === '') delete result.name;
      else result.name = name;
      cost += RENAME_COST;
      changed = true;
    }
  }

  if (!changed) return out;
  out.result = result;
  out.cost = Math.max(1, cost);
  return out;
}
