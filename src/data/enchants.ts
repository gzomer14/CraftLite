/**
 * Tabela declarativa de encantamentos (doc 14 — M6: "mesa + níveis + 8
 * encantamentos").
 *
 * O encantamento é **dado**, não código: cada entrada diz em que itens cabe,
 * até que nível vai, quanto pesa no sorteio da mesa e com quem briga. Quem
 * aplica o efeito consulta `levelOf` e usa o número — nenhum sistema tem um
 * `switch` por nome de encantamento.
 *
 * **Os ids são estáveis e vão para o save** (viram 3 bits cada no campo `ench`
 * da pilha, ver `game/enchanting.ts`) — nunca reordene esta tabela.
 */

import { itemDef } from './items';

/**
 * Em que tipo de item o encantamento cabe. `armor` vale para as quatro peças;
 * `boots` é o subconjunto que recebe Queda Suave.
 */
export type EnchantTarget = 'pickaxe' | 'axe' | 'shovel' | 'hoe' | 'sword' | 'armor' | 'boots';

export interface EnchantDef {
  id: number;
  name: string;
  display: string;
  /** Nível máximo; também o teto dos 3 bits do save (nunca acima de 7). */
  maxLevel: number;
  targets: readonly EnchantTarget[];
  /** Peso no sorteio da mesa: quanto maior, mais comum. */
  weight: number;
  /** Nomes que não podem coexistir na mesma peça. */
  conflicts: readonly string[];
}

/** Teto imposto pelos 3 bits por encantamento no campo `ench`. */
export const MAX_ENCHANT_LEVEL = 7;

const SPECS: readonly EnchantDef[] = [
  {
    id: 0, name: 'efficiency', display: 'Eficiência', maxLevel: 5, weight: 10,
    targets: ['pickaxe', 'axe', 'shovel', 'hoe'], conflicts: [],
  },
  {
    id: 1, name: 'unbreaking', display: 'Inquebrável', maxLevel: 3, weight: 5,
    targets: ['pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'armor'], conflicts: [],
  },
  {
    id: 2, name: 'fortune', display: 'Fortuna', maxLevel: 3, weight: 2,
    targets: ['pickaxe', 'shovel'], conflicts: ['silk_touch'],
  },
  {
    id: 3, name: 'silk_touch', display: 'Toque Suave', maxLevel: 1, weight: 1,
    targets: ['pickaxe', 'axe', 'shovel'], conflicts: ['fortune'],
  },
  {
    id: 4, name: 'sharpness', display: 'Afiação', maxLevel: 5, weight: 10,
    targets: ['sword', 'axe'], conflicts: [],
  },
  {
    id: 5, name: 'looting', display: 'Pilhagem', maxLevel: 3, weight: 2,
    targets: ['sword'], conflicts: [],
  },
  {
    id: 6, name: 'protection', display: 'Proteção', maxLevel: 4, weight: 10,
    targets: ['armor'], conflicts: [],
  },
  {
    id: 7, name: 'feather_falling', display: 'Queda Suave', maxLevel: 4, weight: 5,
    targets: ['boots'], conflicts: [],
  },
];

export const ENCHANTS: readonly EnchantDef[] = SPECS;

export const ENCHANT_BY_NAME: ReadonlyMap<string, EnchantDef> = new Map(
  SPECS.map((e) => [e.name, e]),
);

export function enchantDef(id: number): EnchantDef | undefined {
  return SPECS[id];
}

/** Id de um encantamento pelo nome, com erro claro se não existir. */
export function enchantId(name: string): number {
  const def = ENCHANT_BY_NAME.get(name);
  if (def === undefined) throw new Error(`Encantamento desconhecido: ${name}`);
  return def.id;
}

/** Ids resolvidos uma vez, para quem consulta efeito no caminho quente. */
export const EFFICIENCY = enchantId('efficiency');
export const UNBREAKING = enchantId('unbreaking');
export const FORTUNE = enchantId('fortune');
export const SILK_TOUCH = enchantId('silk_touch');
export const SHARPNESS = enchantId('sharpness');
export const LOOTING = enchantId('looting');
export const PROTECTION = enchantId('protection');
export const FEATHER_FALLING = enchantId('feather_falling');

/**
 * Alvos de um item, como máscara de bits sobre a ordem de `TARGET_ORDER`.
 *
 * Devolve 0 para o que não é ferramenta nem armadura — livro, minério, comida.
 */
const TARGET_ORDER: readonly EnchantTarget[] = [
  'pickaxe', 'axe', 'shovel', 'hoe', 'sword', 'armor', 'boots',
];

const TARGET_BIT = new Map<EnchantTarget, number>(
  TARGET_ORDER.map((name, index) => [name, 1 << index]),
);

/** Todos os alvos: o do livro (M15). */
const ALL_TARGETS = (1 << TARGET_ORDER.length) - 1;

/** Máscara de alvos de cada encantamento, pré-calculada. */
const ENCHANT_MASK: readonly number[] = SPECS.map((spec) => {
  let mask = 0;
  for (const target of spec.targets) mask |= TARGET_BIT.get(target) ?? 0;
  return mask;
});

/** Máscara de alvos de um item; 0 = não aceita encantamento. */
export function targetMaskOf(item: number): number {
  const def = itemDef(item);
  if (def === undefined) return 0;
  // O livro comum aceita qualquer encantamento na mesa e vira livro encantado
  // (M15); é o livro encantado que a bigorna passa para a peça.
  if (def.name === 'book') return ALL_TARGETS;
  if (def.tool !== undefined) return TARGET_BIT.get(def.tool.kind as EnchantTarget) ?? 0;
  if (def.armor !== undefined) {
    let mask = TARGET_BIT.get('armor') ?? 0;
    if (def.armor.slot === 'feet') mask |= TARGET_BIT.get('boots') ?? 0;
    return mask;
  }
  return 0;
}

/** true se este encantamento cabe neste item. */
export function fitsItem(enchant: number, item: number): boolean {
  const mask = ENCHANT_MASK[enchant];
  if (mask === undefined) return false;
  return (targetMaskOf(item) & mask) !== 0;
}

/** true se o item aceita **algum** encantamento. */
export function isEnchantable(item: number): boolean {
  return targetMaskOf(item) !== 0;
}

/** Ids que conflitam com este, resolvidos uma vez. */
export const CONFLICTS: readonly (readonly number[])[] = SPECS.map((spec) => {
  const out: number[] = [];
  for (const name of spec.conflicts) {
    const other = ENCHANT_BY_NAME.get(name);
    if (other !== undefined) out.push(other.id);
  }
  return out;
});
