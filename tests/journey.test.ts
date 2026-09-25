/**
 * Critério do doc 14 para o M16: "um mundo novo pode ser **terminado** — do
 * primeiro tronco ao dragão — sem comando nem modo criativo".
 *
 * Este teste é a cadeia de itens: parte só do que o mundo dá sem fabricar
 * nada — o que se quebra, o que os mobs que nascem sozinhos deixam cair, o
 * que está nos baús das estruturas e o que o aldeão vende — e fecha a conta
 * com as receitas de bancada, a fornalha, o suporte de preparo e os usos que
 * transformam um item em outro (o frasco na água, o balde). Se algum elo
 * sumir de uma tabela, a cadeia quebra aqui, com o nome do que faltou.
 *
 * Os elos que precisam de mundo — o olho que acha a fortaleza, o portal que
 * acende, o dragão que cai — rodam de verdade em `tests/theend.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { RECIPES, resolveIngredient } from '../src/data/recipes';
import { SMELTING } from '../src/data/smelting';
import { BREWING } from '../src/data/potions';
import { BLOCK_LOOT } from '../src/data/loot';
import { CHEST_LOOT } from '../src/data/structures';
import { MOB_BY_NAME, SPAWN_RULES } from '../src/data/mobs';
import { PROFESSIONS } from '../src/data/villagers';
import { BLOCK_BY_NAME } from '../src/data/blocks';
import { ITEM_BY_NAME, itemDef } from '../src/data/items';
import { CROPS } from '../src/data/crops';
import { fortressDef } from '../src/world/gen/fortress';

/** O que se pega no mundo com a mão e as ferramentas, sem fabricar. */
const WORLD_BLOCKS = [
  'oak_log', 'birch_log', 'spruce_log', 'acacia_log', 'jungle_log', 'oak_sapling', 'dirt',
  'stone', 'sand', 'gravel', 'clay', 'sugar_cane', 'cactus', 'pumpkin', 'melon', 'brown_mushroom',
  'red_mushroom', 'dandelion', 'poppy', 'snow_block', 'coal_ore', 'iron_ore', 'copper_ore',
  'gold_ore', 'redstone_ore', 'lapis_ore', 'diamond_ore', 'emerald_ore', 'netherrack',
  'soul_sand', 'nether_quartz_ore', 'glowstone', 'tall_grass', 'oak_leaves',
];

/** Os mobs que nascem sozinhos (têm regra de nascimento) ou das estruturas. */
function naturalMobs(): string[] {
  const out = Object.keys(SPAWN_RULES);
  // Da fortaleza do Nether (gerador) e da cabana do pântano.
  for (const name of ['blaze', 'witch']) if (!out.includes(name)) out.push(name);
  return out;
}

function reachable(): Set<string> {
  const have = new Set<string>();
  const add = (name: string): boolean => {
    if (have.has(name)) return false;
    have.add(name);
    return true;
  };
  const dropsOf = (blockName: string): string[] => {
    const loot = BLOCK_LOOT[blockName];
    return loot === undefined ? [blockName] : loot.drops.map((d) => d.item);
  };
  for (const name of WORLD_BLOCKS) for (const drop of dropsOf(name)) add(drop);
  for (const mob of naturalMobs()) {
    for (const drop of MOB_BY_NAME.get(mob)?.drops ?? []) add(drop.item);
  }
  // A fortaleza do Nether: o jardim de verruga e os baús.
  for (const table of ['nether_fortress', 'stronghold_corridor', 'stronghold_library', 'dungeon', 'village']) {
    for (const roll of CHEST_LOOT[table] ?? []) add(roll.item);
  }
  expect(fortressDef(1, 0, 0).pieces.some((p) => p.block === 'nether_wart')).toBe(true);
  add('nether_wart');
  // Plantar colhe: a semente vira a colheita.
  const crops = CROPS;

  const uses: readonly [string, string][] = [
    ['bucket', 'water_bucket'], ['bucket', 'lava_bucket'], ['bucket', 'milk_bucket'],
    ['glass_bottle', 'water_bottle'],
    // Água em cima de lava: obsidiana, que a picareta de diamante quebra.
    ['lava_bucket', 'obsidian'],
  ];

  for (let changed = true; changed;) {
    changed = false;
    for (const recipe of RECIPES) {
      const ingredients = recipe.type === 'shaped'
        ? recipe.pattern.join('').split('').filter((c) => c !== '.' && c !== ' ').map((c) => recipe.key[c])
        : recipe.ingredients;
      const ok = ingredients.every((ingredient) => resolveIngredient(ingredient)
        .some((id) => have.has(itemDef(id)?.name ?? '')));
      if (ok && add(recipe.result.item)) changed = true;
    }
    for (const smelt of SMELTING) {
      const ok = resolveIngredient(smelt.input).some((id) => have.has(itemDef(id)?.name ?? ''));
      if (ok && add(smelt.output)) changed = true;
    }
    for (const brew of BREWING) {
      if (have.has(brew.base) && have.has(brew.ingredient) && have.has('brewing_stand')
        && have.has('blaze_powder') && add(brew.result)) changed = true;
    }
    for (const [from, to] of uses) if (have.has(from) && add(to)) changed = true;
    for (const crop of crops) {
      if (!have.has(crop.seed)) continue;
      for (const drop of crop.ripe) if (add(drop.item)) changed = true;
    }
    for (const profession of PROFESSIONS) {
      for (const trade of profession.trades) {
        if (have.has(trade.want[0]) && add(trade.give[0])) changed = true;
      }
    }
    // Bloco fabricado quebrado devolve o que a tabela diz (tijolo luminoso → pó).
    for (const name of [...have]) {
      if (!BLOCK_BY_NAME.has(name)) continue;
      for (const drop of dropsOf(name)) if (add(drop)) changed = true;
    }
  }
  return have;
}

describe('critério do doc 14: do primeiro tronco ao dragão', () => {
  const have = reachable();

  it('o olho do ender sai do que o mundo dá', () => {
    for (const name of ['blaze_rod', 'blaze_powder', 'ender_pearl', 'ender_eye']) {
      expect(have.has(name), name).toBe(true);
    }
  });

  it('as armas e a armadura da luta', () => {
    for (const name of [
      'bow', 'arrow', 'diamond_sword', 'diamond_pickaxe', 'iron_chestplate', 'shield',
      'golden_apple', 'obsidian', 'flint_and_steel',
    ]) {
      expect(have.has(name), name).toBe(true);
    }
  });

  it('as cinco poções do doc 14, e o que é preciso para prepará-las', () => {
    for (const name of [
      'brewing_stand', 'glass_bottle', 'water_bottle', 'awkward_potion', 'healing_potion',
      'strength_potion', 'swiftness_potion', 'night_vision_potion', 'fire_resistance_potion',
    ]) {
      expect(have.has(name), name).toBe(true);
    }
  });

  it('todo item novo do M16 tem de onde vir', () => {
    const m16 = [
      'blaze_rod', 'blaze_powder', 'nether_wart', 'glass_bottle', 'ender_eye', 'magma_cream',
      'gold_nugget', 'glistering_melon_slice', 'golden_carrot', 'fermented_spider_eye',
      'nether_brick_fence', 'brewing_stand', 'poison_potion', 'weakness_potion', 'slowness_potion',
    ];
    for (const name of m16) {
      expect(ITEM_BY_NAME.has(name), `${name} existe`).toBe(true);
      expect(have.has(name), `${name} alcançável`).toBe(true);
    }
  });
});
