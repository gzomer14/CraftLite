/**
 * As duas ações de roça do jogador: arar e plantar (doc 14 — M6).
 *
 * Ficam separadas da `Session` porque são regras puras de mundo — dá para
 * testá-las sem inventário, sem UI e sem GL. Quem consome o item e gasta a
 * durabilidade é a sessão.
 */

import { AIR, FARMLAND, defOf, makeState } from '../data/blocks';
import { cropBlockId, cropOfSeed } from '../data/crops';
import { itemDef, type ItemStack } from '../data/items';
import type { World } from '../world/world';

/** Blocos que a enxada transforma em terra arada. */
const TILLABLE: readonly string[] = ['dirt', 'grass_block', 'coarse_dirt', 'podzol'];

/**
 * Passa a enxada no bloco mirado. Só pega no topo: arar a lateral de um bloco
 * enterrado criaria terra arada dentro do chão.
 *
 * Devolve true se arou — o chamador gasta durabilidade.
 */
export function tillSoil(world: World, x: number, y: number, z: number, held: ItemStack | null): boolean {
  if (held === null) return false;
  if (itemDef(held.item)?.tool?.kind !== 'hoe') return false;

  const def = defOf(world.getBlock(x, y, z));
  if (!TILLABLE.includes(def.name)) return false;
  if (world.getBlock(x, y + 1, z) !== AIR) return false;

  return world.setBlock(x, y, z, makeState(FARMLAND, 0), 'player');
}

/**
 * Planta a semente da mão em cima do bloco mirado.
 * Devolve true se plantou — o chamador consome uma unidade.
 */
export function plantSeed(world: World, x: number, y: number, z: number, held: ItemStack | null): boolean {
  if (held === null) return false;
  const crop = cropOfSeed(held.item);
  if (crop === undefined) return false;

  const soil = defOf(world.getBlock(x, y, z));
  if (soil.name !== crop.soil) return false;
  if (world.getBlock(x, y + 1, z) !== AIR) return false;

  return world.setBlock(x, y + 1, z, makeState(cropBlockId(crop), 0), 'player');
}
