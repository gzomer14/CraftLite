/**
 * Mod de demonstração (M21): o caminho de ponta a ponta, com o mínimo.
 *
 * Um bloco que brilha e cura quem fica em cima, um item com silhueta própria,
 * duas receitas e uma textura gerada por código. Serve de molde para os mods
 * que vierem a pedido — cada coisa aqui é uma linha de tabela, e o único código
 * é o sistema de tick, que custa um contador por tick e uma leitura de bloco a
 * cada dois segundos.
 *
 * Regra de isolamento (`mods/types.ts`): daqui para fora, só `import type`.
 */

import type { ModContext, ModDef } from '../types';

/** Faixas deste mod. Só acrescentar no fim: o id vai para o save. */
const BLOCK_BASE = 768;
const ITEM_BASE = 4096;

const CRYSTAL = BLOCK_BASE;
/** A cada 2 s, meio coração para quem está em cima do cristal. */
const HEAL_EVERY = 40;
const MAX_HEALTH = 20;

let ticks = 0;

function tick(ctx: ModContext): void {
  if (++ticks < HEAL_EVERY) return;
  ticks = 0;
  const p = ctx.player;
  const below = ctx.world.getBlock(Math.floor(p.x), Math.floor(p.y - 0.05), Math.floor(p.z));
  if ((below & 0x3ff) === CRYSTAL && ctx.survival.health < MAX_HEALTH) ctx.survival.heal(1);
}

const mod: ModDef = {
  id: 'exemplo',
  version: 1,
  blockBase: BLOCK_BASE,
  itemBase: ITEM_BASE,
  blocks: [
    {
      name: 'exemplo:cristal_luz', display: 'Cristal de Luz', tex: 'exemplo:block/cristal_luz',
      hardness: 0.3, emission: 15, tool: 'pickaxe', sound: 'glass',
    },
  ],
  items: [
    { name: 'exemplo:fragmento', display: 'Fragmento de Cristal' },
  ],
  textures: (g) => ({
    'exemplo:block/cristal_luz': {
      base: [120, 214, 226], noise: 'cell', scale: 3, variance: 0.18,
      ops: [g.emboss(0.45), g.speckle([236, 255, 255], 0.08), g.border([64, 150, 170], 1)],
    },
  }),
  itemShapes: {
    'exemplo:shard': [
      '................',
      '................',
      '.........xx.....',
      '........xMax....',
      '.......xMMax....',
      '......xMMmax....',
      '.....xMMmmdx....',
      '.....xMmmmdx....',
      '....xMmmmdx.....',
      '....xMmmddx.....',
      '...xMmmmdx......',
      '...xmmmddx......',
      '....xmddx.......',
      '.....xxx........',
      '................',
      '................',
    ],
  },
  itemArt: {
    'exemplo:fragmento': { shape: 'exemplo:shard', color: [120, 214, 226], accent: [236, 255, 255] },
  },
  recipes: [
    {
      type: 'shapeless', ingredients: ['glass', 'redstone'],
      result: { item: 'exemplo:fragmento', count: 2 },
    },
    {
      type: 'shaped', pattern: ['FF', 'FF'], key: { F: 'exemplo:fragmento' },
      result: { item: 'exemplo:cristal_luz', count: 1 },
    },
  ],
  en: {
    'exemplo:cristal_luz': 'Light Crystal',
    'exemplo:fragmento': 'Crystal Shard',
  },
  tick,
};

export default mod;
