/**
 * Extração da vizinhança 18×18×18 que o mesher consome.
 *
 * **M12 (2026-09-23): a extração saiu da thread principal.** Ela roda no worker,
 * sobre as sections cruas (paleta, dados empacotados e luz) que chegam na
 * mensagem de malha — a thread principal só junta as referências e o
 * `postMessage` copia os arrays com `memcpy`. Medido em Node: 0,24 ms por
 * section decodificando voxel a voxel aqui, contra 0,045 ms de cópia crua. O
 * doc 14 pedia um espelho das colunas **dentro** do worker; ficou de fora de
 * propósito: com N workers seriam N cópias do mundo carregado (RD 16 no T2 dá
 * ~50 MB por worker), e o `SharedArrayBuffer` que evitaria isso não existe no
 * GitHub Pages, que não serve COOP/COEP.
 *
 * `fillNeighborhood` é o núcleo e não conhece `World`: recebe as 3×3 colunas
 * como uma lista de sections. `extractNeighborhood` é o mesmo núcleo alimentado
 * pelo `World` — os testes de mesher e de perf usam por ele.
 */

import { AIR } from '../data/blocks';
import {
  SECTION_SIZE, SECTIONS_PER_COLUMN, WORLD_HEIGHT, readPacked, type BitsPerBlock,
} from './chunk';
import type { World } from './world';

export const NB_SIDE = 18;
export const NB_PLANE = NB_SIDE * NB_SIDE;
export const NB_VOLUME = NB_SIDE * NB_PLANE;

/**
 * O que o mesher precisa de uma section. Uma `ChunkSection` já é isto; do outro
 * lado do `postMessage` chega como objeto simples, com os mesmos campos.
 */
export interface SectionView {
  bits: BitsPerBlock;
  palette: Uint16Array;
  data: Uint8Array | Uint16Array | null;
  skyLight: Uint8Array | null;
  blockLight: Uint8Array | null;
}

/**
 * Preenche `blocks` e `light` (5832 elementos cada) com a section `sy` e uma
 * camada de padding de cada lado.
 *
 * `sections` traz as 3×3 colunas em volta, na ordem `(dz+1)*3 + (dx+1)`, e em
 * cada coluna as sections `syMin .. syMin+span-1`:
 * `sections[coluna * span + (sy - syMin)]`. Section fora dessa faixa (abaixo do
 * mundo, acima do topo) não é consultada.
 */
export function fillNeighborhood(
  sections: readonly SectionView[], syMin: number, span: number, sy: number,
  blocks: Uint16Array, light: Uint8Array,
): void {
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

    const slot = (wy >> 4) - syMin;
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

        const section = sections[((dz + 1) * 3 + (dx + 1)) * span + slot];
        const index = (localY << 8) | (czLocal << 4) | cxLocal;
        const data = section.data;
        blocks[rowOffset + x] = data === null ? AIR : section.palette[readPacked(data, section.bits, index)];

        const block = section.blockLight === null ? 0 : readNibble(section.blockLight, index);
        const sky = section.skyLight === null ? 15 : readNibble(section.skyLight, index);
        light[rowOffset + x] = block | (sky << 4);
      }
    }
  }
}

/** Referências das 9 colunas × 8 sections, reusadas entre chamadas. */
const VIEWS: SectionView[] = [];

/**
 * A mesma extração, a partir do `World`. Devolve `false` se algum vizinho
 * ainda não carregou — meshar antes disso criaria paredes falsas na borda.
 */
export function extractNeighborhood(
  world: World, cx: number, cz: number, sy: number,
  blocks: Uint16Array, light: Uint8Array,
): boolean {
  if (!gatherSections(world, cx, cz, 0, SECTIONS_PER_COLUMN, VIEWS)) return false;
  fillNeighborhood(VIEWS, 0, SECTIONS_PER_COLUMN, sy, blocks, light);
  return true;
}

/**
 * Junta em `out` as sections `syMin .. syMin+span-1` das 3×3 colunas em volta
 * de `(cx, cz)`, na ordem que `fillNeighborhood` espera. São referências, não
 * cópias: quem manda para o worker deixa o `postMessage` copiar.
 */
export function gatherSections(
  world: World, cx: number, cz: number, syMin: number, span: number, out: SectionView[],
): boolean {
  out.length = 9 * span;
  for (let dz = -1; dz <= 1; dz++) {
    for (let dx = -1; dx <= 1; dx++) {
      const column = world.getChunk(cx + dx, cz + dz);
      if (column === undefined) return false;
      const base = ((dz + 1) * 3 + (dx + 1)) * span;
      for (let i = 0; i < span; i++) out[base + i] = column.sections[syMin + i];
    }
  }
  return true;
}

function readNibble(data: Uint8Array, index: number): number {
  const byte = data[index >> 1];
  return (index & 1) === 0 ? byte & 0xf : (byte >> 4) & 0xf;
}
