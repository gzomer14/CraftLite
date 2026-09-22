/**
 * Enche a fonte de dados do overlay F3 (doc 02 §6) a partir do renderizador,
 * do pipeline e do mundo. Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { BIOMES } from '../data/biomes';
import type { DebugSource } from './debug';
import type { Renderer } from '../render/renderer';
import type { ChunkPipeline } from '../world/pipeline';
import type { World } from '../world/world';
import type { Player } from '../entity/player';

export function updateDebugSource(
  source: DebugSource, renderer: Renderer, pipeline: ChunkPipeline, world: World, player: Player,
): void {
  source.drawCalls = renderer.drawCalls;
  source.vertices = renderer.vertices;
  source.renderScale = renderer.renderScale;
  source.chunks.visibleSections = renderer.chunks.visibleSections;
  source.chunks.queued = pipeline.stats.queued;
  source.chunks.generating = pipeline.stats.generating;
  source.chunks.meshing = pipeline.stats.meshing;
  pipeline.ringProgress(source.chunks);

  const x = Math.floor(player.x);
  const y = Math.floor(player.y + player.eyeHeight);
  const z = Math.floor(player.z);
  source.blockLight = world.getBlockLight(x, y, z);
  source.skyLight = world.getSkyLight(x, y, z);

  const chunk = world.getChunk(x >> 4, z >> 4);
  if (chunk !== undefined) {
    const biome = BIOMES[chunk.biomeMap[((z & 15) << 4) | (x & 15)]];
    source.biome = biome !== undefined ? biome.display : '—';
  } else {
    source.biome = 'carregando…';
  }
}
