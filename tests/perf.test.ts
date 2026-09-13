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
import { ChunkColumn, SEA_LEVEL } from '../src/world/chunk';
import { Redstone } from '../src/world/redstone';
import { NetherNoise, generateNetherChunk } from '../src/world/gen/nether';
import { BLOCK_BY_NAME, STONE, makeState } from '../src/data/blocks';
import { MOUNT_FLOOR } from '../src/world/mesh/shapes';
import { TEXTURES } from '../src/data/textures';
import { blockFinishOf } from '../src/data/texturestyle';
import { applyFinish } from '../src/render/texfinish';
import { TEX_SIZE } from '../src/render/texgen';
import { HD_SPRITE_SIZE } from '../src/render/itemart3d';
import { buildItemSheet } from '../src/render/itemsprites';

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

  it('gera um chunk do Nether em menos de 25 ms', () => {
    const noise = new NetherNoise(SEED);
    for (let i = 0; i < 3; i++) generateNetherChunk(SEED, noise, i, 0);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      generateNetherChunk(SEED, noise, i, 200);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  Nether: ${ms.toFixed(2)} ms/chunk (mediana de 20)`);
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

  /**
   * O circuito é a única coisa do jogo que pode reagir em cascata dentro de um
   * tick. O limite é de **tick**, não de frame: 5 ms num orçamento de 50 ms de
   * tick (20 Hz), com a mesma folga dos outros limites deste arquivo. O que ele
   * pega é a regressão de ordem de grandeza — alguém trocar a fila incremental
   * por varredura do mundo.
   */
  it('um anel de 64 blocos de pó liga e desliga em menos de 5 ms por tick', () => {
    const world = new World(SEED);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        const stone = makeState(STONE);
        for (let y = 0; y <= 63; y++) {
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
          }
        }
        chunk.recomputeHeightMap();
        world.addChunk(chunk);
      }
    }

    const redstone = new Redstone(world);
    redstone.attach();
    const wire = makeState(BLOCK_BY_NAME.get('redstone_wire')!.id);
    const lever = BLOCK_BY_NAME.get('lever')!.id;
    for (let x = 0; x < 64; x++) world.setBlock(x, 64, 0, wire, 'player');
    world.setBlock(-1, 64, 0, makeState(lever, MOUNT_FLOOR), 'player');
    redstone.tick();

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      redstone.use(-1, 64, 0);
      const t0 = performance.now();
      redstone.tick();
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  redstone: ${ms.toFixed(2)} ms/tick (fio de 64, mediana de 20)`);
    expect(ms).toBeLessThan(5);
  });

  /*
   * O estilo Nítido roda uma vez no boot e nunca mais. O orçamento existe
   * porque ele entra **antes da primeira tela**, no aparelho mais fraco: se
   * passar de algumas dezenas de ms, o jogador vê a barra de carregamento
   * parar. O que ele pega é regressão de ordem de grandeza — alguém trocar a
   * varredura linear por algo quadrático no número de pixels.
   *
   * Medido nesta máquina: **2,0 ms** o acabamento do atlas e **26,7 ms** a
   * folha. Os limites são muito mais folgados de propósito, pela mesma razão do
   * cabeçalho do arquivo: um orçamento apertado em teste de relógio falha por
   * ruído de máquina, e teste que falha por ruído vira teste ignorado. A folha
   * já custou 89 ms — é esse tipo de salto que estes dois pegam.
   */
  it('o acabamento do estilo Nítido custa menos de 60 ms no atlas inteiro', () => {
    const nomes = Object.keys(TEXTURES);
    const tiles = nomes.map(() => {
      const data = new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
      for (let i = 0; i < data.length; i += 4) {
        data[i] = (i * 7) & 255;
        data[i + 1] = (i * 13) & 255;
        data[i + 2] = (i * 29) & 255;
        data[i + 3] = 255;
      }
      return data;
    });
    // Aquecimento: a primeira passada paga a compilação do JIT.
    for (let i = 0; i < nomes.length; i++) {
      applyFinish(tiles[i].slice(), TEX_SIZE, blockFinishOf(nomes[i]));
    }

    const samples: number[] = [];
    for (let round = 0; round < 5; round++) {
      const t0 = performance.now();
      for (let i = 0; i < nomes.length; i++) {
        applyFinish(tiles[i].slice(), TEX_SIZE, blockFinishOf(nomes[i]));
      }
      samples.push(performance.now() - t0);
    }
    expect(median(samples)).toBeLessThan(60);
  });

  it('a folha de sprites em volume sai em menos de 200 ms', () => {
    const source = {
      texturePixels: (): Uint8ClampedArray => new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4),
    };
    buildItemSheet(source, undefined, { size: HD_SPRITE_SIZE, style: 'nitido' });

    const samples: number[] = [];
    for (let round = 0; round < 3; round++) {
      const t0 = performance.now();
      buildItemSheet(source, undefined, { size: HD_SPRITE_SIZE, style: 'nitido' });
      samples.push(performance.now() - t0);
    }
    expect(median(samples)).toBeLessThan(200);
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
