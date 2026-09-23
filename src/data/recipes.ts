/**
 * Receitas de crafting (doc 05 §6).
 *
 * As **tags** (`#planks`, `#logs`) existem para não escrever quatro receitas de
 * bancada, uma por madeira. Uma tag é um array de nomes resolvido no boot.
 *
 * A tabela é declarativa: acrescentar uma receita é uma entrada, nunca código.
 */

import { ITEM_BY_NAME } from './items';
import { DYES, DYE_SOURCES } from './dyes';

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
  // Toda lã serve onde a receita pede lã: linha, quadro e cama (M8).
  wool: DYES.map((dye) => (dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`)),
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
      // A porta saiu da receita genérica de `#planks` e virou por material: com
      // as duas no ar, seis tábuas de bétula davam uma porta de carvalho.
      { type: 'shaped', pattern: ['BB', 'BB', 'BB'], key, result: { item: `${material}_door`, count: 3 } },
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
  { type: 'shaped', pattern: ['SSS'], key: { S: 'sugar_cane' }, result: { item: 'paper', count: 3 } },
  { type: 'shapeless', ingredients: ['paper', 'paper', 'paper', 'leather'], result: { item: 'book', count: 1 } },
  { type: 'shaped', pattern: ['PPP', 'BBB', 'PPP'], key: { P: '#planks', B: 'book' }, result: { item: 'bookshelf', count: 1 } },
  { type: 'shaped', pattern: ['WWW'], key: { W: 'wheat' }, result: { item: 'bread', count: 1 } },
  { type: 'shaped', pattern: ['III', 'III', 'III'], key: { I: 'iron_ingot' }, result: { item: 'iron_block', count: 1 } },
  { type: 'shaped', pattern: ['GGG', 'GGG', 'GGG'], key: { G: 'gold_ingot' }, result: { item: 'gold_block', count: 1 } },
  { type: 'shaped', pattern: ['DDD', 'DDD', 'DDD'], key: { D: 'diamond' }, result: { item: 'diamond_block', count: 1 } },
  { type: 'shapeless', ingredients: ['iron_block'], result: { item: 'iron_ingot', count: 9 } },
  { type: 'shapeless', ingredients: ['gold_block'], result: { item: 'gold_ingot', count: 9 } },
  { type: 'shapeless', ingredients: ['diamond_block'], result: { item: 'diamond', count: 9 } },
  // --- 2026-09-22 (M11): comidas do doc 05 §4 e a tesoura do §6.3 ---------
  { type: 'shaped', pattern: ['GGG', 'GAG', 'GGG'], key: { G: 'gold_ingot', A: 'apple' }, result: { item: 'golden_apple', count: 1 } },
  { type: 'shapeless', ingredients: ['brown_mushroom', 'red_mushroom', 'bowl'], result: { item: 'mushroom_stew', count: 1 } },
  { type: 'shapeless', ingredients: ['sugar_cane'], result: { item: 'sugar', count: 1 } },
  // Desvio consciente: o biscoito do gênero leva cacau, e não há selva nem
  // cacau no jogo. O açúcar faz o papel — é o que a cana ganha de utilidade.
  { type: 'shaped', pattern: ['WSW'], key: { W: 'wheat', S: 'sugar' }, result: { item: 'cookie', count: 8 } },
  // O bolo devolve os três baldes vazios na grade (`consumeGrid`).
  {
    type: 'shaped', pattern: ['MMM', 'SES', 'WWW'],
    key: { M: 'milk_bucket', S: 'sugar', E: 'egg', W: 'wheat' },
    result: { item: 'cake', count: 1 },
  },
  { type: 'shaped', pattern: ['.I', 'I.'], key: { I: 'iron_ingot' }, result: { item: 'shears', count: 1 } },
  // M10: bússola, relógio e mapa, nas receitas do original.
  { type: 'shaped', pattern: ['.I.', 'IRI', '.I.'], key: { I: 'iron_ingot', R: 'redstone' }, result: { item: 'compass', count: 1 } },
  { type: 'shaped', pattern: ['.G.', 'GRG', '.G.'], key: { G: 'gold_ingot', R: 'redstone' }, result: { item: 'clock', count: 1 } },
  { type: 'shaped', pattern: ['PPP', 'PCP', 'PPP'], key: { P: 'paper', C: 'compass' }, result: { item: 'map', count: 1 } },
  // Bloco de carvão (doc 05 §5): nove carvões num bloco que queima dez vezes.
  { type: 'shaped', pattern: ['CCC', 'CCC', 'CCC'], key: { C: 'coal' }, result: { item: 'coal_block', count: 1 } },
  { type: 'shapeless', ingredients: ['coal_block'], result: { item: 'coal', count: 9 } },
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

  // --- redstone (M7) ------------------------------------------------------
  // O pó sai do minério; daqui para a frente é tudo pó + um material comum.
  { type: 'shaped', pattern: ['R', 'S'], key: { R: 'redstone', S: 'stick' },
    result: { item: 'redstone_torch', count: 1 } },
  { type: 'shaped', pattern: ['S', 'C'], key: { S: 'stick', C: 'cobblestone' },
    result: { item: 'lever', count: 1 } },
  { type: 'shapeless', ingredients: ['stone'], result: { item: 'stone_button', count: 1 } },
  { type: 'shapeless', ingredients: ['#planks'], result: { item: 'oak_button', count: 1 } },
  { type: 'shaped', pattern: ['SS'], key: { S: 'stone' },
    result: { item: 'stone_pressure_plate', count: 1 } },
  { type: 'shaped', pattern: ['PP'], key: { P: '#planks' },
    result: { item: 'oak_pressure_plate', count: 1 } },
  { type: 'shaped', pattern: ['TRT', 'SSS'], key: { T: 'redstone_torch', R: 'redstone', S: 'stone' },
    result: { item: 'repeater', count: 1 } },
  { type: 'shaped', pattern: ['PPP', 'CIC', 'CRC'],
    key: { P: '#planks', C: 'cobblestone', I: 'iron_ingot', R: 'redstone' },
    result: { item: 'piston', count: 1 } },
  { type: 'shapeless', ingredients: ['piston', 'slime_ball'],
    result: { item: 'sticky_piston', count: 1 } },
  { type: 'shaped', pattern: ['.R.', 'RGR', '.R.'], key: { R: 'redstone', G: 'glowstone' },
    result: { item: 'redstone_lamp', count: 1 } },
  { type: 'shaped', pattern: ['RRR', 'RRR', 'RRR'], key: { R: 'redstone' },
    result: { item: 'redstone_block', count: 1 } },
  { type: 'shapeless', ingredients: ['redstone_block'], result: { item: 'redstone', count: 9 } },

  // --- Nether (M7) --------------------------------------------------------
  // O isqueiro é o que abre o portal, e por isso é barato: ferro e sílex.
  { type: 'shapeless', ingredients: ['iron_ingot', 'flint'],
    result: { item: 'flint_and_steel', count: 1 } },
  { type: 'shaped', pattern: ['BB', 'BB'], key: { B: 'nether_brick' },
    result: { item: 'nether_bricks', count: 1 } },

  // --- trilhos e carrinho (M7) --------------------------------------------
  { type: 'shaped', pattern: ['I.I', 'ISI', 'IRI'],
    key: { I: 'gold_ingot', S: 'stick', R: 'redstone' },
    result: { item: 'powered_rail', count: 6 } },
  { type: 'shaped', pattern: ['I.I', 'IPI', 'IRI'],
    key: { I: 'iron_ingot', P: 'stone_pressure_plate', R: 'redstone' },
    result: { item: 'detector_rail', count: 6 } },
  { type: 'shaped', pattern: ['I.I', 'III'], key: { I: 'iron_ingot' },
    result: { item: 'minecart', count: 1 } },
  ...dyeRecipes(),
];

/**
 * Corantes, lã tingida e cama colorida (M8).
 *
 * Três famílias saem de uma tabela só (`data/dyes.ts`): o corante, a lã que ele
 * tinge e a cama que a lã faz. Cor nova é **uma linha** lá, nenhuma aqui — que
 * é a regra do doc 05 §2 aplicada a conteúdo.
 *
 * A cama vermelha é `bed` e não `bed_red` porque o id 62 já era dela antes das
 * cores existirem, e id vai para o save.
 */
function dyeRecipes(): Recipe[] {
  const out: Recipe[] = [];
  for (const source of DYE_SOURCES) {
    // O verde sai da fornalha (`data/smelting.ts`), não da bancada.
    if (source.smelted === true) continue;
    if (source.from !== undefined) {
      out.push({
        type: 'shapeless', ingredients: [source.from],
        result: { item: `${source.dye}_dye`, count: 2 },
      });
    } else if (source.mix !== undefined) {
      out.push({
        type: 'shapeless', ingredients: [source.mix[0], source.mix[1]],
        result: { item: `${source.dye}_dye`, count: 2 },
      });
    }
  }
  for (const dye of DYES) {
    const wool = dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`;
    // Tingir: qualquer lã mais o corante. Repintar lã colorida também vale.
    if (dye.name !== 'white') {
      out.push({
        type: 'shapeless', ingredients: ['#wool', `${dye.name}_dye`],
        result: { item: wool, count: 1 },
      });
    }
    out.push({
      type: 'shaped', pattern: ['WWW', 'PPP'], key: { W: wool, P: '#planks' },
      result: { item: dye.name === 'red' ? 'bed' : `bed_${dye.name}`, count: 1 },
    });
  }
  return out;
}

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
