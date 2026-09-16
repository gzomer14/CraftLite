/**
 * O que cada bloco dropa (doc 04 e doc 05 §7).
 *
 * Regra geral: o bloco dropa a si mesmo. A tabela só declara as exceções — o
 * que evita 68 linhas idênticas e deixa óbvio o que é especial.
 */

/** Uma entrada de drop; `count` pode ser uma faixa `[min, max]`. */
export interface Drop {
  item: string;
  count: number | [number, number];
  /** Probabilidade 0..1 de o drop sair. */
  chance?: number;
  /**
   * true = Fortuna multiplica esta saída. Vale para o que o bloco **converte**
   * (carvão, diamante, sílex), nunca para o que dropa a si mesmo — senão
   * Fortuna viraria duplicador de pedra.
   */
  fortune?: boolean;
}

export interface LootEntry {
  /** `null` = não dropa nada sem a ferramenta correta (já coberto por `requiresTool`). */
  drops: Drop[];
  /** Experiência solta ao quebrar, faixa `[min, max]` (doc 04 §2.2). */
  xp?: [number, number];
}

/** Exceções à regra "dropa a si mesmo", por nome de bloco. */
export const BLOCK_LOOT: Record<string, LootEntry> = {
  stone: { drops: [{ item: 'cobblestone', count: 1 }] },
  grass_block: { drops: [{ item: 'dirt', count: 1 }] },
  podzol: { drops: [{ item: 'dirt', count: 1 }] },
  coarse_dirt: { drops: [{ item: 'dirt', count: 1 }] },
  gravel: {
    drops: [{ item: 'gravel', count: 1 }, { item: 'flint', count: 1, chance: 0.1, fortune: true }],
  },
  clay: { drops: [{ item: 'clay_ball', count: 4 }] },
  snow_block: { drops: [{ item: 'snowball', count: 4 }] },
  snow_layer: { drops: [{ item: 'snowball', count: 1 }] },
  ice: { drops: [] },
  glass: { drops: [] },
  bedrock: { drops: [] },

  // A coluna de XP é a do doc 04 §2.2: minério de metal funde para dar XP, o
  // resto entrega na hora.
  coal_ore: { drops: [{ item: 'coal', count: 1, fortune: true }], xp: [0, 2] },
  iron_ore: { drops: [{ item: 'raw_iron', count: 1 }] },
  copper_ore: { drops: [{ item: 'raw_copper', count: [2, 5], fortune: true }] },
  gold_ore: { drops: [{ item: 'raw_gold', count: 1 }] },
  redstone_ore: { drops: [{ item: 'redstone', count: [4, 5], fortune: true }], xp: [1, 5] },
  lapis_ore: { drops: [{ item: 'lapis_lazuli', count: [4, 9], fortune: true }], xp: [2, 5] },
  diamond_ore: { drops: [{ item: 'diamond', count: 1, fortune: true }], xp: [3, 7] },
  emerald_ore: { drops: [{ item: 'emerald', count: 1, fortune: true }], xp: [3, 7] },
  glowstone: { drops: [{ item: 'glowstone_dust', count: [2, 4], fortune: true }] },

  oak_leaves: {
    drops: [
      { item: 'oak_sapling', count: 1, chance: 0.05 },
      { item: 'apple', count: 1, chance: 0.02 },
    ],
  },
  birch_leaves: { drops: [{ item: 'oak_sapling', count: 1, chance: 0.05 }] },
  spruce_leaves: { drops: [{ item: 'oak_sapling', count: 1, chance: 0.05 }] },
  tall_grass: { drops: [{ item: 'wheat_seeds', count: 1, chance: 0.125 }] },
  fern: { drops: [{ item: 'wheat_seeds', count: 1, chance: 0.125 }] },
  dead_bush: { drops: [{ item: 'stick', count: [0, 2] }] },
  bookshelf: { drops: [{ item: 'book', count: 3 }] },
  melon: { drops: [{ item: 'melon_slice', count: [3, 7] }] },

  farmland: { drops: [{ item: 'dirt', count: 1 }] },

  water: { drops: [] },
  lava: { drops: [] },
  mob_spawner: { drops: [] },

  // Redstone (M7): o lado "apagado" de cada par dropa o item que o jogador
  // conhece, e o pó volta a ser pó.
  redstone_wire: { drops: [{ item: 'redstone', count: 1 }] },
  redstone_torch_off: { drops: [{ item: 'redstone_torch', count: 1 }] },
  redstone_lamp_on: { drops: [{ item: 'redstone_lamp', count: 1 }] },
  // O braço não é item: quem o quebra fica com o pistão, que volta a recolher.
  piston_head: { drops: [] },

  // Blocos de duas células (M8): a metade de cima é `itemless`, então sem
  // linha aqui quebrá-la não daria nada — e uma porta quebrada pelo topo
  // sumiria do mundo.
  oak_door_top: { drops: [{ item: 'oak_door', count: 1 }] },
  bed_head: { drops: [{ item: 'bed', count: 1 }] },

  // Nether (M7).
  nether_quartz_ore: { drops: [{ item: 'nether_quartz', count: 1, fortune: true }], xp: [2, 5] },
  // O portal não é bloco de mão nenhuma: quebrá-lo só apaga o portal.
  nether_portal: { drops: [] },
};
