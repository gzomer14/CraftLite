/**
 * Geração de coluna, do lado do worker: qual gerador por dimensão, e a
 * resposta que volta para a thread principal.
 *
 * Saiu de `chunk.worker.ts` em 2026-09-24 (M16) para ser testável sem
 * `self` nem `postMessage` — e foi o teste que faltava. A resposta levava as
 * sections, a altura e o bioma, e **não levava os marcos de estrutura**
 * (`chunk.structures`): o baú de dungeon, de mina, de aldeia e de naufrágio
 * saía do gerador marcado para receber loot, e chegava ao mundo sem marca —
 * abria vazio. O gerador de monstros da dungeon, idem: bloco sem registro,
 * inerte. Os testes geravam a coluna direto, sem passar pelo worker, e nunca
 * viram. Os marcos agora vão na resposta (`GenResponse.structures`).
 */

import { TerrainNoise, generateChunk } from '../world/gen/terrain';
import { NetherNoise, generateNetherChunk } from '../world/gen/nether';
import { EndNoise, generateEndChunk } from '../world/gen/end';
import { DIM_END, DIM_NETHER } from '../data/dimensions';
import type { ChunkSection } from '../world/chunk';
import type { GenResponse, SerializedSection } from './protocol';

export class GenJobRunner {
  readonly seed: number;
  private terrain: TerrainNoise | null = null;
  /**
   * Ruído do Nether e do End, criados **preguiçosamente**: quem nunca
   * atravessa o portal não paga as tabelas de permutação no boot.
   */
  private nether: NetherNoise | null = null;
  private end: EndNoise | null = null;

  constructor(seed: number) {
    this.seed = seed;
  }

  /** O ruído da superfície (a busca de nascimento também usa). */
  get terrainNoise(): TerrainNoise {
    this.terrain ??= new TerrainNoise(this.seed);
    return this.terrain;
  }

  /**
   * Gera a coluna na dimensão pedida.
   *
   * Um `if` por dimensão é o único aceitável no motor: são geradores inteiros,
   * não conteúdo. Acrescentar uma dimensão é uma entrada em `data/dimensions.ts`
   * mais um módulo em `world/gen/` — e uma linha aqui.
   */
  run(cx: number, cz: number, dim: number): GenResponse {
    const t0 = performance.now();
    let chunk;
    if (dim === DIM_NETHER) {
      this.nether ??= new NetherNoise(this.seed);
      chunk = generateNetherChunk(this.seed, this.nether, cx, cz);
    } else if (dim === DIM_END) {
      this.end ??= new EndNoise(this.seed);
      chunk = generateEndChunk(this.seed, this.end, cx, cz);
    } else {
      chunk = generateChunk(this.seed, this.terrainNoise, cx, cz);
    }

    const sections: SerializedSection[] = [];
    for (const section of chunk.sections) sections.push(serializeSection(section));

    return {
      type: 'gen',
      cx, cz, dim,
      sections,
      heightMap: chunk.heightMap,
      biomeMap: chunk.biomeMap,
      structures: chunk.structures,
      ms: performance.now() - t0,
    };
  }
}

function serializeSection(section: ChunkSection): SerializedSection {
  return {
    bits: section.bits,
    paletteLen: section.paletteLen,
    palette: section.palette,
    data: section.data,
    nonAirCount: section.nonAirCount,
    skyLight: section.skyLight ?? new Uint8Array(2048),
    blockLight: section.blockLight ?? new Uint8Array(2048),
  };
}
