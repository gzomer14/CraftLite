/**
 * O que o jogador tem na mão ao nascer num mundo novo (saiu do `main.ts` no
 * M18).
 */

import { BLOCK_BY_NAME } from '../data/blocks';
import { ITEM_BY_NAME, makeStack } from '../data/items';
import type { GameMode } from '../entity/player';
import type { Inventory } from './inventory';

/** Blocos da hotbar inicial do Criativo, para experimentar. */
const CREATIVE_BLOCKS = [
  'stone', 'cobblestone', 'dirt', 'oak_planks', 'oak_log', 'glass', 'torch', 'glowstone', 'sand',
];

/**
 * Criativo começa com blocos; Sobrevivência, só com um machado de madeira —
 * o suficiente para o primeiro tronco sair rápido, e a primeira hora guiada
 * (M17) ensina o resto.
 */
export function giveStartingKit(inventory: Inventory, mode: GameMode): void {
  if (mode === 'creative') {
    for (let i = 0; i < CREATIVE_BLOCKS.length; i++) {
      const block = BLOCK_BY_NAME.get(CREATIVE_BLOCKS[i]);
      if (block !== undefined) inventory.set(i, makeStack(block.id, 64));
    }
    return;
  }
  const axe = ITEM_BY_NAME.get('wooden_axe');
  if (axe !== undefined) inventory.set(0, makeStack(axe.id, 1));
}
