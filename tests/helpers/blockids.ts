/** Reexporta ids usados pelos testes, para não repetir números mágicos. */
export { AIR, STONE, DIRT, GRASS_BLOCK, WATER, makeState } from '../../src/data/blocks';
import { BLOCK_BY_NAME } from '../../src/data/blocks';

export const GLASS_ID = BLOCK_BY_NAME.get('glass')!.id;
export const OAK_LEAVES_ID = BLOCK_BY_NAME.get('oak_leaves')!.id;
export const OAK_LOG_ID = BLOCK_BY_NAME.get('oak_log')!.id;
