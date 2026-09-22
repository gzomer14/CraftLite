/**
 * Plantas que crescem sozinhas, fora da roça (doc 03 §9: "Crescimento —
 * sapling, wheat, carrot, sugar cane, cactus").
 *
 * Até 2026-09-22 só a roça de `data/crops.ts` crescia. A muda era decoração —
 * nunca virava árvore —, e cana e cacto ficavam do tamanho em que nasceram. O
 * resultado era que **madeira não era renovável**: derrubada a floresta em
 * volta da base, a única saída era andar até outra.
 *
 * Como a roça, isto é tabela: uma planta nova é uma linha aqui e o bloco em
 * `blocks.ts`. Quem visita é `world/growth.ts`, no mesmo registro e no mesmo
 * orçamento por tick que a plantação.
 */

import { BLOCK_BY_NAME, blockIdOf } from './blocks';

export type TreeKind = 'oak' | 'birch' | 'spruce' | 'acacia';

export interface PlantDef {
  block: string;
  /** `tree`: a muda vira árvore. `column`: cresce um bloco igual por cima. */
  kind: 'tree' | 'column';
  /** A árvore que a muda vira. */
  tree?: TreeKind;
  /** Altura máxima da coluna, contando a base. */
  maxHeight?: number;
  /**
   * Chance de crescer a cada visita do registro (uma a cada ~2 s).
   *
   * A muda leva em média ~2 min, a cana e o cacto ~1 min por bloco. É mais
   * rápido que o gênero de propósito: uma sessão de celular dura menos que uma
   * de computador, e replantar a floresta tem que caber nela.
   */
  chance: number;
  /** Cana: precisa de água encostada no bloco em que foi plantada. */
  needsWater?: boolean;
  /** Cacto: a célula nova não pode ter bloco sólido do lado. */
  needsClearSides?: boolean;
}

export const PLANTS: readonly PlantDef[] = [
  { block: 'oak_sapling', kind: 'tree', tree: 'oak', chance: 0.015 },
  { block: 'birch_sapling', kind: 'tree', tree: 'birch', chance: 0.015 },
  { block: 'spruce_sapling', kind: 'tree', tree: 'spruce', chance: 0.015 },
  { block: 'acacia_sapling', kind: 'tree', tree: 'acacia', chance: 0.015 },
  { block: 'sugar_cane', kind: 'column', maxHeight: 3, chance: 0.03, needsWater: true },
  { block: 'cactus', kind: 'column', maxHeight: 3, chance: 0.03, needsClearSides: true },
];

/** Índice blockId → planta; o tick consulta isso por voxel. */
const BY_BLOCK = new Map<number, PlantDef>();
for (const plant of PLANTS) {
  const block = BLOCK_BY_NAME.get(plant.block);
  if (block === undefined) throw new Error(`Planta sem bloco: ${plant.block}`);
  BY_BLOCK.set(block.id, plant);
}

/** A planta de um blockState, ou `undefined`. */
export function plantOfState(state: number): PlantDef | undefined {
  return BY_BLOCK.get(blockIdOf(state));
}
