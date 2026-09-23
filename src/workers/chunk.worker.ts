/**
 * Worker de chunk: gera terreno e monta malhas.
 *
 * Não tem acesso ao `World` — recebe cópias imutáveis do que precisa (doc 01 §4).
 * O índice de camadas de textura é derivado da mesma tabela declarativa que o
 * atlas usa, então a camada gravada no vértice bate com a que foi para a GPU.
 */

import { buildLayerIndex } from '../render/layers';
import { buildBlockTables } from '../world/mesh/blockinfo';
import { GreedyMesher } from '../world/mesh/greedy';
import { TerrainNoise, generateChunk } from '../world/gen/terrain';
import { NetherNoise, generateNetherChunk } from '../world/gen/nether';
import { findSpawnColumn } from '../world/gen/spawnsearch';
import { DIM_NETHER } from '../data/dimensions';
import type { ChunkSection } from '../world/chunk';
import {
  collectTransfers,
  type GenResponse, type SerializedSection, type WorkerRequest, type WorkerResponse,
} from './protocol';
import { MeshJobRunner } from './meshjob';

let seed = 0;
let noise: TerrainNoise | null = null;
/**
 * Ruído do Nether, criado **preguiçosamente**: quem nunca atravessa o portal
 * não paga as três tabelas de permutação no boot.
 */
let netherNoise: NetherNoise | null = null;
let meshJobs: MeshJobRunner | null = null;

const layerIndex = buildLayerIndex();
const tables = buildBlockTables(layerIndex);

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      seed = message.seed;
      noise = new TerrainNoise(seed);
      netherNoise = null;
      meshJobs = new MeshJobRunner(
        new GreedyMesher(tables, message.packed, message.smoothLighting !== false), tables.occludes,
      );
      break;
    case 'gen':
      reply(handleGen(message.cx, message.cz, message.dim));
      break;
    case 'mesh':
      if (meshJobs === null) meshJobs = new MeshJobRunner(new GreedyMesher(tables, true), tables.occludes);
      reply(meshJobs.run(message));
      break;
    case 'spawn': {
      if (noise === null) noise = new TerrainNoise(seed);
      const [x, z] = findSpawnColumn(noise.field);
      reply({ type: 'spawn', x, z });
      break;
    }
  }
};

function reply(response: WorkerResponse): void {
  (self as unknown as Worker).postMessage(response, collectTransfers(response));
}

/**
 * Gera a coluna na dimensão pedida.
 *
 * Um `if` por dimensão é o único aceitável no motor: são geradores inteiros,
 * não conteúdo. Acrescentar uma dimensão é uma entrada em `data/dimensions.ts`
 * mais um módulo em `world/gen/` — e uma linha aqui.
 */
function handleGen(cx: number, cz: number, dim: number): GenResponse {
  const t0 = performance.now();
  let chunk;
  if (dim === DIM_NETHER) {
    if (netherNoise === null) netherNoise = new NetherNoise(seed);
    chunk = generateNetherChunk(seed, netherNoise, cx, cz);
  } else {
    if (noise === null) noise = new TerrainNoise(seed);
    chunk = generateChunk(seed, noise, cx, cz);
  }

  const sections: SerializedSection[] = [];
  for (const section of chunk.sections) sections.push(serializeSection(section));

  return {
    type: 'gen',
    cx, cz, dim,
    sections,
    heightMap: chunk.heightMap,
    biomeMap: chunk.biomeMap,
    ms: performance.now() - t0,
  };
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
