/**
 * Orçamento de performance em CI (doc 14, "Performance (CI)").
 *
 * Os limites são folgados de propósito: máquinas de CI variam muito e um teste
 * que falha por ruído vira teste ignorado. O que eles pegam é **regressão de
 * ordem de grandeza** — alguém trocar o mesher binário por varredura ingênua,
 * ou o gerador voltar a amostrar FBM por bloco.
 */
import { describe, expect, it } from 'vitest';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { World } from '../src/world/world';
import { extractNeighborhood, NB_VOLUME } from '../src/world/neighborhood';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { SEA_LEVEL } from '../src/world/chunk';

const SEED = 4242;
const tables = buildBlockTables(buildLayerIndex());

/** Mediana é mais estável que média quando o GC entra no meio da amostra. */
function median(values: number[]): number {
  const sorted = values.slice().sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

describe('orçamento de performance', () => {
  it('gera um chunk completo em menos de 25 ms', () => {
    const noise = new TerrainNoise(SEED);
    for (let i = 0; i < 3; i++) generateChunk(SEED, noise, i, 0);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      generateChunk(SEED, noise, i, 100);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  geração: ${ms.toFixed(2)} ms/chunk (mediana de 20)`);
    expect(ms).toBeLessThan(25);
  });

  it('mesha uma section de superfície em menos de 8 ms', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }

    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);
    const mesher = new GreedyMesher(tables, true);
    const sy = SEA_LEVEL >> 4;

    for (let i = 0; i < 5; i++) {
      extractNeighborhood(world, 0, 0, sy, blocks, light);
      mesher.mesh(blocks, light);
    }

    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      extractNeighborhood(world, 0, 0, sy, blocks, light);
      const t0 = performance.now();
      mesher.mesh(blocks, light);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  meshing: ${ms.toFixed(2)} ms/section (mediana de 30)`);
    expect(ms).toBeLessThan(8);
  });

  it('extrai a vizinhança 18³ em menos de 2 ms', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }
    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);

    for (let i = 0; i < 10; i++) extractNeighborhood(world, 0, 0, 4, blocks, light);
    const samples: number[] = [];
    for (let i = 0; i < 50; i++) {
      const t0 = performance.now();
      extractNeighborhood(world, 0, 0, 4, blocks, light);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  vizinhança: ${ms.toFixed(3)} ms/section (mediana de 50)`);
    // Roda no main thread a cada re-mesh: o orçamento do frame são 2 ms inteiros.
    expect(ms).toBeLessThan(2);
  });

  it('o greedy reduz os vértices de uma section típica a menos de 4000', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }
    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME);
    extractNeighborhood(world, 0, 0, SEA_LEVEL >> 4, blocks, light);
    const mesh = new GreedyMesher(tables, true).mesh(blocks, light);

    const vertices = (mesh.opaque?.vertexCount ?? 0) + (mesh.cutout?.vertexCount ?? 0)
      + (mesh.translucent?.vertexCount ?? 0);
    const bytes = (mesh.opaque?.vertices.byteLength ?? 0)
      + (mesh.cutout?.vertices.byteLength ?? 0)
      + (mesh.translucent?.vertices.byteLength ?? 0);
    console.log(`  section de superfície: ${vertices} vértices, ${(bytes / 1024).toFixed(1)} KB`);
    expect(vertices).toBeLessThan(4000);
    // 8 bytes por vértice é o número normativo do doc 01 §5.1.
    expect(bytes / Math.max(vertices, 1)).toBe(8);
  });
});
