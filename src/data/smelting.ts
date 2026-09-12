/**
 * Fundição e combustíveis (doc 05 §5).
 *
 * Fundir um item leva 200 ticks (10 s). Os ticks de queima de cada combustível
 * vêm da tabela de itens (`fuel`), porque é propriedade do item, não da receita.
 */

/** Ticks para fundir um item. */
export const SMELT_TICKS = 200;

export interface SmeltingRecipe {
  input: string;
  output: string;
  /** XP dado ao coletar (M6). */
  xp: number;
}

export const SMELTING: readonly SmeltingRecipe[] = [
  { input: 'raw_iron', output: 'iron_ingot', xp: 0.7 },
  { input: 'raw_copper', output: 'copper_ingot', xp: 0.7 },
  { input: 'raw_gold', output: 'gold_ingot', xp: 1.0 },
  { input: 'iron_ore', output: 'iron_ingot', xp: 0.7 },
  { input: 'copper_ore', output: 'copper_ingot', xp: 0.7 },
  { input: 'gold_ore', output: 'gold_ingot', xp: 1.0 },
  { input: 'sand', output: 'glass', xp: 0.1 },
  { input: 'red_sand', output: 'glass', xp: 0.1 },
  { input: 'cobblestone', output: 'stone', xp: 0.1 },
  { input: 'clay_ball', output: 'brick', xp: 0.3 },
  { input: '#logs', output: 'charcoal', xp: 0.15 },
  { input: 'beef', output: 'cooked_beef', xp: 0.35 },
  { input: 'porkchop', output: 'cooked_porkchop', xp: 0.35 },
  { input: 'chicken', output: 'cooked_chicken', xp: 0.35 },
  { input: 'mutton', output: 'cooked_mutton', xp: 0.35 },
  { input: 'potato', output: 'baked_potato', xp: 0.35 },
];
