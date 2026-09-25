/**
 * Poções e preparo (doc 14 — M16).
 *
 * Uma poção é um **item** por tipo, não um item com o efeito escondido em bits
 * da pilha: a mochila, a bigorna, o save e o funil já sabem lidar com item, e
 * uma pilha de dano/encantamento com um terceiro significado seria mais um
 * campo para todos eles copiarem certo. Os itens são registrados a partir
 * desta tabela em `data/items.ts`, no fim da fila de ids.
 *
 * O preparo é a tabela `BREWING`: base + ingrediente → resultado. O suporte
 * (`game/brewing.ts`) não conhece nenhuma poção pelo nome.
 *
 * Beber é o caminho de comer (`food` com `drink`): segurar, e o efeito entra
 * pela mesma porta que a maçã dourada usa (`game/food.ts`).
 */

export interface PotionDef {
  /** Nome do item. */
  name: string;
  display: string;
  /** Efeito ao beber, de `data/effects.ts`; ausente = não faz nada. */
  effect?: string;
  level?: number;
  /** Duração em segundos; ignorada pelos instantâneos. */
  seconds?: number;
  /** Cor do líquido no frasco (arte do item). */
  color: readonly [number, number, number];
}

/**
 * **A ordem vai para o save** (vira id de item): acrescente no fim.
 *
 * O frasco d'água e a poção estranha também são poções — bebíveis e sem
 * efeito —, porque são a base do preparo e o jogador os carrega como tal.
 */
export const POTIONS: readonly PotionDef[] = [
  { name: 'water_bottle', display: 'Frasco de Água', color: [52, 96, 214] },
  { name: 'awkward_potion', display: 'Poção Estranha', color: [60, 88, 196] },
  {
    name: 'healing_potion', display: 'Poção de Cura', effect: 'instant_health', level: 1,
    color: [248, 36, 35],
  },
  {
    name: 'strength_potion', display: 'Poção de Força', effect: 'strength', level: 1,
    seconds: 180, color: [147, 36, 35],
  },
  {
    name: 'swiftness_potion', display: 'Poção de Velocidade', effect: 'speed', level: 1,
    seconds: 180, color: [124, 175, 198],
  },
  {
    name: 'night_vision_potion', display: 'Poção de Visão Noturna', effect: 'night_vision',
    level: 1, seconds: 180, color: [31, 31, 161],
  },
  {
    name: 'fire_resistance_potion', display: 'Poção de Resistência ao Fogo',
    effect: 'fire_resistance', level: 1, seconds: 180, color: [228, 154, 58],
  },
  {
    name: 'poison_potion', display: 'Poção de Veneno', effect: 'poison', level: 1,
    seconds: 45, color: [78, 147, 49],
  },
  {
    name: 'weakness_potion', display: 'Poção de Fraqueza', effect: 'weakness', level: 1,
    seconds: 90, color: [72, 77, 72],
  },
  {
    name: 'slowness_potion', display: 'Poção de Lentidão', effect: 'slowness', level: 1,
    seconds: 90, color: [90, 108, 129],
  },
];

/** Uma receita de preparo: o frasco `base` com `ingredient` vira `result`. */
export interface BrewingRecipe {
  base: string;
  ingredient: string;
  result: string;
}

/**
 * As receitas do doc 14: cura, força, velocidade, visão noturna e
 * resistência ao fogo, todas a partir da poção estranha (água + verruga).
 * Veneno, fraqueza e lentidão são as poções da bruxa, que o jogador também
 * pode fazer: aranha, e o olho fermentado que "estraga" uma poção boa.
 */
export const BREWING: readonly BrewingRecipe[] = [
  { base: 'water_bottle', ingredient: 'nether_wart', result: 'awkward_potion' },
  { base: 'awkward_potion', ingredient: 'glistering_melon_slice', result: 'healing_potion' },
  { base: 'awkward_potion', ingredient: 'blaze_powder', result: 'strength_potion' },
  { base: 'awkward_potion', ingredient: 'sugar', result: 'swiftness_potion' },
  { base: 'awkward_potion', ingredient: 'golden_carrot', result: 'night_vision_potion' },
  { base: 'awkward_potion', ingredient: 'magma_cream', result: 'fire_resistance_potion' },
  { base: 'awkward_potion', ingredient: 'spider_eye', result: 'poison_potion' },
  { base: 'water_bottle', ingredient: 'fermented_spider_eye', result: 'weakness_potion' },
  { base: 'strength_potion', ingredient: 'fermented_spider_eye', result: 'weakness_potion' },
  { base: 'swiftness_potion', ingredient: 'fermented_spider_eye', result: 'slowness_potion' },
];

/** Ticks de um preparo: 20 s, o do gênero. */
export const BREW_TICKS = 400;
/** Preparos por pó de blaze no combustível. */
export const BREWS_PER_FUEL = 20;
/** Item que o suporte queima. */
export const BREWING_FUEL = 'blaze_powder';
