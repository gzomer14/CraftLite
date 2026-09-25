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
import { findSpawnColumn } from '../world/gen/spawnsearch';
import { collectTransfers, type WorkerRequest, type WorkerResponse } from './protocol';
import { MeshJobRunner } from './meshjob';
import { GenJobRunner } from './genjob';

/** Geração por dimensão (`genjob.ts`); recriada no `init`, com a seed nova. */
let gen = new GenJobRunner(0);
let meshJobs: MeshJobRunner | null = null;

const layerIndex = buildLayerIndex();
const tables = buildBlockTables(layerIndex);

self.onmessage = (event: MessageEvent<WorkerRequest>): void => {
  const message = event.data;
  switch (message.type) {
    case 'init':
      gen = new GenJobRunner(message.seed);
      meshJobs = new MeshJobRunner(
        new GreedyMesher(tables, message.packed, message.smoothLighting !== false), tables.occludes,
      );
      break;
    case 'gen':
      reply(gen.run(message.cx, message.cz, message.dim));
      break;
    case 'mesh':
      if (meshJobs === null) meshJobs = new MeshJobRunner(new GreedyMesher(tables, true), tables.occludes);
      reply(meshJobs.run(message));
      break;
    case 'spawn': {
      const [x, z] = findSpawnColumn(gen.terrainNoise.field);
      reply({ type: 'spawn', x, z });
      break;
    }
  }
};

function reply(response: WorkerResponse): void {
  (self as unknown as Worker).postMessage(response, collectTransfers(response));
}
