/**
 * Extração da vizinhança 18×18×18 que o worker de meshing consome.
 *
 * Roda no main thread a cada re-mesh, então é caminho quente: resolve as 9
 * colunas vizinhas **uma vez** em um cache 3×3 e depois indexa por array. A
 * versão ingênua (um `Map.get` por voxel) custa 5832 lookups por section e
 * estoura o orçamento de 2 ms sozinha.
 */

import { AIR } from '../data/blocks';
import { SECTION_SIZE, SECTIONS_PER_COLUMN, WORLD_HEIGHT, type ChunkColumn } from './chunk';
import type { World } from './world';

export const NB_SIDE = 18;
export const NB_PLANE = NB_SIDE * NB_SIDE;
export const NB_VOLUME = NB_SIDE * NB_PLANE;

/** Cache das 9 colunas ao redor, reusado entre chamadas. */
const columns: (ChunkColumn | undefined)[] = new Array(9);

/**
 * Preenche `blocks` e `light` (ambos de 5832 elementos) com a section
 * `(cx, cz, sy)` mais uma camada de padding de cada lado.
 *
 * Devolve `false` se algum vizinho ainda não carregou — meshar antes disso
 * criaria paredes falsas na borda do chunk que teriam de ser refeitas.
 */
export function extractNeighborhood(
  world: World, cx: number, cz: number, sy: number,
  blocks: Uint16Array, light: Uint8Array,
): boolean {
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const column = world.getChunk(cx + dx, cz + dz);
      if (column === undefined) return false;
      columns[(dz + 1) * 3 + (dx + 1)] = column;
    }
  }

  const baseY = sy * SECTION_SIZE - 1;

  for (let y = 0; y < NB_SIDE; y++) {
    const wy = baseY + y;
    const planeOffset = y * NB_PLANE;
    if (wy < 0 || wy >= WORLD_HEIGHT) {
      blocks.fill(AIR, planeOffset, planeOffset + NB_PLANE);
      // Acima do mundo é céu aberto; abaixo é rocha — nem um nem outro precisa
      // de luz correta, mas o topo aberto evita uma faixa preta no horizonte.
      light.fill(wy >= WORLD_HEIGHT ? 0xf0 : 0x00, planeOffset, planeOffset + NB_PLANE);
      continue;
    }

    const sectionY = wy >> 4;
    const localY = wy & 15;

    for (let z = 0; z < NB_SIDE; z++) {
      // z local dentro da vizinhança → coluna e coordenada local no chunk.
      const lz = z - 1;
      const dz = lz < 0 ? -1 : lz >= SECTION_SIZE ? 1 : 0;
      const czLocal = lz - dz * SECTION_SIZE;
      const rowOffset = planeOffset + z * NB_SIDE;

      for (let x = 0; x < NB_SIDE; x++) {
        const lx = x - 1;
        const dx = lx < 0 ? -1 : lx >= SECTION_SIZE ? 1 : 0;
        const cxLocal = lx - dx * SECTION_SIZE;

        const column = columns[(dz + 1) * 3 + (dx + 1)];
        if (column === undefined) {
          blocks[rowOffset + x] = AIR;
          light[rowOffset + x] = 0xf0;
          continue;
        }
        const section = column.sections[sectionY];
        blocks[rowOffset + x] = section.get(cxLocal, localY, czLocal);

        const index = (localY << 8) | (czLocal << 4) | cxLocal;
        const block = section.blockLight === null ? 0 : readNibble(section.blockLight, index);
        const sky = section.skyLight === null ? 15 : readNibble(section.skyLight, index);
        light[rowOffset + x] = block | (sky << 4);
      }
    }
  }
  return true;
}

function readNibble(data: Uint8Array, index: number): number {
  const byte = data[index >> 1];
  return (index & 1) === 0 ? byte & 0xf : (byte >> 4) & 0xf;
}

/** true se a section tem algo para meshar (nem ela nem o vizinho de cima/baixo vazios). */
export function sectionHasWork(column: ChunkColumn, sy: number): boolean {
  if (sy < 0 || sy >= SECTIONS_PER_COLUMN) return false;
  if (!column.sections[sy].isEmpty) return true;
  // Uma section vazia ainda pode precisar de mesh se a de baixo tem topo exposto —
  // mas essa face pertence à section de baixo, não a esta.
  return false;
}
