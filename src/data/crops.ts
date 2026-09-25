/**
 * Plantações (doc 14 — M6: agricultura).
 *
 * Uma plantação é a tripla **semente → bloco → colheita**, e tudo que o motor
 * precisa saber sobre ela está aqui: em que bloco planta, quantas idades tem,
 * quanto atrasa por não ter água e o que dropa madura ou verde. Acrescentar
 * uma plantação nova é uma entrada nesta tabela mais o bloco em `blocks.ts` —
 * nenhum `case` em lugar nenhum.
 */

import { BLOCK_BY_NAME, blockIdOf, stateBitsOf } from './blocks';
import { ITEM_BY_NAME } from './items';
import type { Drop } from './loot';

export interface CropDef {
  /** Bloco da plantação. */
  block: string;
  /** Item que planta (clique com ele na terra arada). */
  seed: string;
  /** Bloco em que a semente pega. */
  soil: string;
  /** Última idade; abaixo dela a planta ainda cresce. */
  maxAge: number;
  /** Chance por random tick de avançar uma idade, com a terra encharcada. */
  growChance: number;
  /** Colheita madura. */
  ripe: readonly Drop[];
  /** O que sai ao arrancar antes da hora — só a semente de volta. */
  young: readonly Drop[];
  /**
   * Cresce no escuro (M16: a verruga do Nether, que não vê o céu). Sem isto
   * a planta precisa de luz 9, como o trigo.
   */
  growsInDark?: boolean;
}

export const CROPS: readonly CropDef[] = [
  {
    block: 'wheat', seed: 'wheat_seeds', soil: 'farmland', maxAge: 7, growChance: 0.25,
    ripe: [{ item: 'wheat', count: 1 }, { item: 'wheat_seeds', count: [1, 3] }],
    young: [{ item: 'wheat_seeds', count: 1 }],
  },
  {
    block: 'carrots', seed: 'carrot', soil: 'farmland', maxAge: 7, growChance: 0.25,
    ripe: [{ item: 'carrot', count: [2, 4] }],
    young: [{ item: 'carrot', count: 1 }],
  },
  {
    block: 'potatoes', seed: 'potato', soil: 'farmland', maxAge: 7, growChance: 0.25,
    ripe: [{ item: 'potato', count: [2, 4] }],
    young: [{ item: 'potato', count: 1 }],
  },
  // M16: a verruga na areia das almas, sem água e sem luz — o jardim da
  // fortaleza do Nether é de onde ela vem, e é ela que começa toda poção.
  {
    block: 'nether_wart', seed: 'nether_wart', soil: 'soul_sand', maxAge: 3, growChance: 0.1,
    ripe: [{ item: 'nether_wart', count: [2, 4] }],
    young: [{ item: 'nether_wart', count: 1 }],
    growsInDark: true,
  },
];

/** Índice blockId → plantação; o tick de crescimento consulta isso por voxel. */
const BY_BLOCK = new Map<number, CropDef>();
/** Índice itemId da semente → plantação; o clique direito consulta isso. */
const BY_SEED = new Map<number, CropDef>();
/** Plantação → id do bloco dela, resolvido no boot. */
const BLOCK_ID = new Map<CropDef, number>();

for (const crop of CROPS) {
  const block = BLOCK_BY_NAME.get(crop.block);
  const seed = ITEM_BY_NAME.get(crop.seed);
  if (block === undefined) throw new Error(`Plantação sem bloco: ${crop.block}`);
  if (seed === undefined) throw new Error(`Plantação sem semente: ${crop.seed}`);
  BY_BLOCK.set(block.id, crop);
  BY_SEED.set(seed.id, crop);
  BLOCK_ID.set(crop, block.id);
}

/** Solo de cada plantação, por id — o tick de crescimento confere o de baixo. */
const SOIL_ID = new Map<CropDef, number>();
for (const crop of CROPS) SOIL_ID.set(crop, BLOCK_BY_NAME.get(crop.soil)?.id ?? -1);

/** Id do bloco em que a plantação pega. */
export function cropSoilId(crop: CropDef): number {
  return SOIL_ID.get(crop) ?? -1;
}

/** Id do bloco de uma plantação. */
export function cropBlockId(crop: CropDef): number {
  return BLOCK_ID.get(crop) ?? 0;
}

/** A plantação de um blockState, ou `undefined` se o bloco não é plantação. */
export function cropOfState(state: number): CropDef | undefined {
  return BY_BLOCK.get(blockIdOf(state));
}

/** A plantação que uma semente planta, ou `undefined`. */
export function cropOfSeed(item: number): CropDef | undefined {
  return BY_SEED.get(item);
}

/** true se o estado é de uma plantação madura — o que muda a colheita. */
export function isRipe(state: number): boolean {
  const crop = cropOfState(state);
  return crop !== undefined && stateBitsOf(state) >= crop.maxAge;
}

/** Ids de bloco de todas as plantações — usado para filtrar seções no tick. */
export const CROP_BLOCK_IDS: readonly number[] = [...BY_BLOCK.keys()];
