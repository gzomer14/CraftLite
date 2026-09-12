/**
 * Receitas de crafting (doc 05 §6).
 *
 * As **tags** (`#planks`, `#logs`) existem para não escrever quatro receitas de
 * bancada, uma por madeira. Uma tag é um array de nomes resolvido no boot.
 *
 * A tabela é declarativa: acrescentar uma receita é uma entrada, nunca código.
 */

import { ITEM_BY_NAME } from './items';

/** Um ingrediente é um item, ou uma tag (prefixada com `#`). */
export type Ingredient = string;

export interface ShapedRecipe {
  type: 'shaped';
  /** Linhas do padrão; `' '` ou `'.'` = vazio. */
  pattern: string[];
  key: Record<string, Ingredient>;
  result: { item: string; count: number };
}

export interface ShapelessRecipe {
  type: 'shapeless';
  ingredients: Ingredient[];
  result: { item: string; count: number };
}

export type Recipe = ShapedRecipe | ShapelessRecipe;

/** Grupos de itens intercambiáveis. */
export const TAGS: Record<string, readonly string[]> = {
  planks: ['oak_planks', 'birch_planks', 'spruce_planks', 'acacia_planks'],
  logs: ['oak_log', 'birch_log', 'spruce_log', 'acacia_log'],
  coals: ['coal', 'charcoal'],
  wool: ['white_wool'],
  stone_crafting: ['cobblestone'],
};

/** Atalho para o conjunto de armadura, que só muda de material (doc 05 §6). */
function armorSet(material: string, prefix: string): Recipe[] {
  const key = { M: material };
  return [
    { type: 'shaped', pattern: ['MMM', 'M.M'], key, result: { item: `${prefix}_helmet`, count: 1 } },
    { type: 'shaped', pattern: ['M.M', 'MMM', 'MMM'], key, result: { item: `${prefix}_chestplate`, count: 1 } },
    { type: 'shaped', pattern: ['MMM', 'M.M', 'M.M'], key, result: { item: `${prefix}_leggings`, count: 1 } },
    { type: 'shaped', pattern: ['M.M', 'M.M'], key, result: { item: `${prefix}_boots`, count: 1 } },
  ];
}

/** Atalho para as receitas de ferramenta, que só mudam de material. */
function toolSet(material: string, suffix: string): Recipe[] {
  const key = { M: material, S: 'stick' };
  return [
    { type: 'shaped', pattern: ['MMM', '.S.', '.S.'], key, result: { item: `${suffix}_pickaxe`, count: 1 } },
    { type: 'shaped', pattern: ['MM.', 'MS.', '.S.'], key, result: { item: `${suffix}_axe`, count: 1 } },
    { type: 'shaped', pattern: ['.M.', '.S.', '.S.'], key, result: { item: `${suffix}_shovel`, count: 1 } },
    { type: 'shaped', pattern: ['.M.', '.M.', '.S.'], key, result: { item: `${suffix}_sword`, count: 1 } },
    { type: 'shaped', pattern: ['MM.', '.S.', '.S.'], key, result: { item: `${suffix}_hoe`, count: 1 } },
  ];
}

/**
 * Receitas de construção por material (doc 14 — M6).
 *
 * Escada, laje, cerca, portão e alçapão têm sempre o mesmo padrão; só muda o
 * bloco base. Gerar a partir da lista evita 30 linhas iguais e garante que
 * material novo já nasça com todas as peças.
 */
function buildingSet(material: string, base: string, wood: boolean): Recipe[] {
  const key = { B: base, S: 'stick' };
  const out: Recipe[] = [
    { type: 'shaped', pattern: ['B..', 'BB.', 'BBB'], key, result: { item: `${material}_stairs`, count: 4 } },
    { type: 'shaped', pattern: ['BBB'], key, result: { item: `${material}_slab`, count: 6 } },
  ];
  if (wood) {
    out.push(
      { type: 'shaped', pattern: ['BSB', 'BSB'], key, result: { item: `${material}_fence`, count: 3 } },
      { type: 'shaped', pattern: ['SBS', 'SBS'], key, result: { item: `${material}_fence_gate`, count: 1 } },
      { type: 'shaped', pattern: ['BBB', 'BBB'], key, result: { item: `${material}_trapdoor`, count: 2 } },
    );
  }
  return out;
}

export const RECIPES: readonly Recipe[] = [
  // --- básicas (doc 05 §6.3) ---------------------------------------------
  { type: 'shapeless', ingredients: ['#logs'], result: { item: 'oak_planks', count: 4 } },
  { type: 'shaped', pattern: ['P', 'P'], key: { P: '#planks' }, result: { item: 'stick', count: 4 } },
  { type: 'shaped', pattern: ['PP', 'PP'], key: { P: '#planks' }, result: { item: 'crafting_table', count: 1 } },
  { type: 'shaped', pattern: ['PPP', 'P.P', 'PPP'], key: { P: '#planks' }, result: { item: 'chest', count: 1 } },
  { type: 'shaped', pattern: ['CCC', 'C.C', 'CCC'], key: { C: 'cobblestone' }, result: { item: 'furnace', count: 1 } },
  { type: 'shaped', pattern: ['C', 'S'], key: { C: '#coals', S: 'stick' }, result: { item: 'torch', count: 4 } },
  { type: 'shaped', pattern: ['S.S', 'SSS', 'S.S'], key: { S: 'stick' }, result: { item: 'ladder', count: 3 } },
  { type: 'shaped', pattern: ['P.P', '.P.'], key: { P: '#planks' }, result: { item: 'bowl', count: 4 } },
  { type: 'shaped', pattern: ['I.I', '.I.'], key: { I: 'iron_ingot' }, result: { item: 'bucket', count: 1 } },

  // --- ferramentas -------------------------------------------------------
  ...toolSet('#planks', 'wooden'),
  ...toolSet('cobblestone', 'stone'),
  ...toolSet('iron_ingot', 'iron'),
  ...toolSet('gold_ingot', 'golden'),
  ...toolSet('diamond', 'diamond'),

  // --- blocos e utilidades -----------------------------------------------
  { type: 'shaped', pattern: ['SS', 'SS'], key: { S: 'stone' }, result: { item: 'stone_bricks', count: 4 } },
  { type: 'shaped', pattern: ['CCC'], key: { C: 'cobblestone' }, result: { item: 'cobblestone_slab', count: 6 } },
  { type: 'shaped', pattern: ['PSP', 'PSP'], key: { P: '#planks', S: 'stick' }, result: { item: 'oak_fence', count: 3 } },
  { type: 'shaped', pattern: ['PP', 'PP', 'PP'], key: { P: '#planks' }, result: { item: 'oak_door', count: 3 } },
  { type: 'shaped', pattern: ['SSS'], key: { S: 'sugar_cane' }, result: { item: 'paper', count: 3 } },
  { type: 'shapeless', ingredients: ['paper', 'paper', 'paper', 'leather'], result: { item: 'book', count: 1 } },
  { type: 'shaped', pattern: ['PPP', 'BBB', 'PPP'], key: { P: '#planks', B: 'book' }, result: { item: 'bookshelf', count: 1 } },
  { type: 'shaped', pattern: ['WWW', 'PPP'], key: { W: '#wool', P: '#planks' }, result: { item: 'bed', count: 1 } },
  { type: 'shaped', pattern: ['WWW'], key: { W: 'wheat' }, result: { item: 'bread', count: 1 } },
  { type: 'shaped', pattern: ['III', 'III', 'III'], key: { I: 'iron_ingot' }, result: { item: 'iron_block', count: 1 } },
  { type: 'shaped', pattern: ['GGG', 'GGG', 'GGG'], key: { G: 'gold_ingot' }, result: { item: 'gold_block', count: 1 } },
  { type: 'shaped', pattern: ['DDD', 'DDD', 'DDD'], key: { D: 'diamond' }, result: { item: 'diamond_block', count: 1 } },
  { type: 'shapeless', ingredients: ['iron_block'], result: { item: 'iron_ingot', count: 9 } },
  { type: 'shapeless', ingredients: ['gold_block'], result: { item: 'gold_ingot', count: 9 } },
  { type: 'shapeless', ingredients: ['diamond_block'], result: { item: 'diamond', count: 9 } },
  { type: 'shaped', pattern: ['GSG', 'SGS', 'GSG'], key: { G: 'gunpowder', S: 'sand' }, result: { item: 'tnt', count: 1 } },

  // --- armadura (M5) ------------------------------------------------------
  ...armorSet('leather', 'leather'),
  ...armorSet('iron_ingot', 'iron'),
  ...armorSet('gold_ingot', 'golden'),
  ...armorSet('diamond', 'diamond'),

  // --- munição e derivados de mob (M5) ------------------------------------
  { type: 'shaped', pattern: ['F', 'S', 'P'], key: { F: 'flint', S: 'stick', P: 'feather' }, result: { item: 'arrow', count: 4 } },
  { type: 'shapeless', ingredients: ['#wool'], result: { item: 'string', count: 4 } },

  // --- construção por material (M6) ---------------------------------------
  // `cobblestone_slab` e `oak_fence` já têm receita acima, das versões antigas;
  // a geração abaixo pula esses dois nomes para não duplicar.
  ...buildingSet('stone', 'stone', false),
  ...buildingSet('stone_brick', 'stone_bricks', false),
  ...buildingSet('sandstone', 'sandstone', false),
  ...buildingSet('cobblestone', 'cobblestone', false).filter(
    (r) => r.result.item !== 'cobblestone_slab',
  ),
  ...buildingSet('oak', 'oak_planks', true).filter((r) => r.result.item !== 'oak_fence'),
  ...buildingSet('birch', 'birch_planks', true),
  ...buildingSet('spruce', 'spruce_planks', true),

  { type: 'shaped', pattern: ['PPP', 'PPP', '.S.'], key: { P: '#planks', S: 'stick' },
    result: { item: 'oak_sign', count: 3 } },
  { type: 'shaped', pattern: ['SSS', 'SWS', 'SSS'], key: { S: 'stick', W: '#wool' },
    result: { item: 'painting', count: 1 } },
  { type: 'shaped', pattern: ['I.I', 'ISI', 'I.I'], key: { I: 'iron_ingot', S: 'stick' },
    result: { item: 'rail', count: 16 } },
  { type: 'shapeless', ingredients: ['cobblestone', 'vine'],
    result: { item: 'mossy_cobblestone', count: 1 } },

  // --- arco, escudo e barco (M6) ------------------------------------------
  { type: 'shaped', pattern: ['.SL', 'S.L', '.SL'], key: { S: 'stick', L: 'string' },
    result: { item: 'bow', count: 1 } },
  { type: 'shaped', pattern: ['PIP', 'PPP', '.P.'], key: { P: '#planks', I: 'iron_ingot' },
    result: { item: 'shield', count: 1 } },
  { type: 'shaped', pattern: ['P.P', 'PPP'], key: { P: '#planks' },
    result: { item: 'boat', count: 1 } },

  // --- encantamento (M6) --------------------------------------------------
  // Livro em cima, dois diamantes e obsidiana: cara de propósito, porque é a
  // mesa que abre a segunda metade da progressão.
  { type: 'shaped', pattern: ['.B.', 'DOD', 'OOO'],
    key: { B: 'book', D: 'diamond', O: 'obsidian' },
    result: { item: 'enchanting_table', count: 1 } },
];

/**
 * Resolve um ingrediente (item ou tag) em ids concretos.
 * Roda uma vez no boot: o matcher trabalha só com ids.
 */
export function resolveIngredient(ingredient: Ingredient): number[] {
  if (ingredient.startsWith('#')) {
    const tag = TAGS[ingredient.slice(1)];
    if (tag === undefined) throw new Error(`Tag desconhecida: ${ingredient}`);
    return tag.map(nameToId).filter((id): id is number => id !== undefined);
  }
  const id = nameToId(ingredient);
  if (id === undefined) throw new Error(`Item desconhecido na receita: ${ingredient}`);
  return [id];
}

function nameToId(name: string): number | undefined {
  return ITEM_BY_NAME.get(name)?.id;
}
