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
import type { ChunkSection } from '../world/chunk';
import {
  collectTransfers,
  type GenResponse, type MeshResponse, type SerializedMesh,
  type SerializedSection, type WorkerRequest, type WorkerResponse,
} from './protocol';
import type { MeshData } from '../render/mesh';

let seed = 0;
let noise: TerrainNoise | null = null;
let mesher: GreedyMesher | null = null;

const layerIndex = buildLayerIndex();
const tables = buildBlockTables(layerIndex);

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      seed = message.seed;
      noise = new TerrainNoise(seed);
      mesher = new GreedyMesher(tables, message.packed);
      break;
    case 'gen':
      reply(handleGen(message.cx, message.cz));
      break;
    case 'mesh':
      reply(handleMesh(message.cx, message.cz, message.sy, message.blocks, message.light));
      break;
  }
};

function reply(response: WorkerResponse): void {
  (self as unknown as Worker).postMessage(response, collectTransfers(response));
}

function handleGen(cx: number, cz: number): GenResponse {
  const t0 = performance.now();
  if (noise === null) noise = new TerrainNoise(seed);
  const chunk = generateChunk(seed, noise, cx, cz);

  const sections: SerializedSection[] = [];
  for (const section of chunk.sections) sections.push(serializeSection(section));

  return {
    type: 'gen',
    cx, cz,
    sections,
    heightMap: chunk.heightMap,
    biomeMap: chunk.biomeMap,
    ms: performance.now() - t0,
  };
}

function handleMesh(
  cx: number, cz: number, sy: number, blocks: Uint16Array, light: Uint8Array,
): MeshResponse {
  const t0 = performance.now();
  if (mesher === null) mesher = new GreedyMesher(tables, true);
  const result = mesher.mesh(blocks, light);
  return {
    type: 'mesh',
    cx, cz, sy,
    opaque: toSerialized(result.opaque),
    cutout: toSerialized(result.cutout),
    translucent: toSerialized(result.translucent),
    quads: result.quads,
    ms: performance.now() - t0,
    // Devolve os buffers para o main thread reciclar em vez de realocar.
    blocks,
    light,
  };
}

function toSerialized(data: MeshData | null): SerializedMesh | null {
  if (data === null) return null;
  return {
    vertices: data.vertices,
    indices: data.indices,
    vertexCount: data.vertexCount,
    indexCount: data.indexCount,
    wideIndices: data.wideIndices,
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
