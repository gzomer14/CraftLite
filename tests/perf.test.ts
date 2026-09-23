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
import {
  extractNeighborhood, gatherSections, NB_VOLUME, type SectionView,
} from '../src/world/neighborhood';
import { MeshJobRunner } from '../src/workers/meshjob';
import { SectionCulling } from '../src/render/sectioncull';
import { Lighting } from '../src/world/lighting';
import { Frustum, createMat4, lookYawPitch, multiply, perspective } from '../src/core/math';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { ChunkColumn, SEA_LEVEL } from '../src/world/chunk';
import { Redstone } from '../src/world/redstone';
import { NetherNoise, generateNetherChunk } from '../src/world/gen/nether';
import { BLOCK_BY_NAME, STONE, makeState } from '../src/data/blocks';
import { Fire, MAX_FIRES } from '../src/world/fire';
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

  /*
   * A tocha virou poste no M8: 5 ou 6 quads por tocha, contra 2 da cruz antiga.
   * O caso que um jogador consegue construir é um **piso** coberto de tochas —
   * 256 numa section, uma em cada célula da camada. É esse o orçamento; encher
   * a section inteira é impossível, porque tocha precisa de apoio.
   */
  it('mesha uma section com um piso de tochas em menos de 2 ms', () => {
    const torch = BLOCK_BY_NAME.get('torch')!.id;
    const blocks = new Uint16Array(NB_VOLUME);
    const light = new Uint8Array(NB_VOLUME).fill(0xf0);
    for (let z = 1; z <= 16; z++) {
      for (let x = 1; x <= 16; x++) {
        blocks[(1 * 18 + z) * 18 + x] = makeState(STONE);
        blocks[(2 * 18 + z) * 18 + x] = makeState(torch, MOUNT_FLOOR);
      }
    }
    const mesher = new GreedyMesher(tables, true);
    for (let i = 0; i < 3; i++) mesher.mesh(blocks, light);

    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      mesher.mesh(blocks, light);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  tochas: ${ms.toFixed(2)} ms/section (256 tochas, mediana de 20)`);
    expect(ms).toBeLessThan(2);
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
    // Roda no worker desde o M12, uma vez por section meshada: continua sendo
    // parte do custo de cada malha, só que fora do quadro.
    expect(ms).toBeLessThan(2);
  });

  /*
   * O que sobrou na thread principal do despacho de malha (M12): juntar as
   * referências das sections e o `postMessage` copiá-las. Medido com
   * `structuredClone`, que é o mesmo algoritmo de cópia.
   */
  it('o pedido de malha de uma coluna inteira custa menos de 2 ms na thread principal', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }
    const views: SectionView[] = [];
    const dispatch = (): void => {
      gatherSections(world, 0, 0, 0, 8, views);
      structuredClone({ type: 'mesh', cx: 0, cz: 0, mask: 0xff, syMin: 0, span: 8, sections: views });
    };
    for (let i = 0; i < 10; i++) dispatch();
    const samples: number[] = [];
    for (let i = 0; i < 30; i++) {
      const t0 = performance.now();
      dispatch();
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  pedido de malha: ${ms.toFixed(3)} ms/coluna (mediana de 30)`);
    // Antes eram 8 × 0,26 ms de vizinhança montada em JS para a mesma coluna.
    expect(ms).toBeLessThan(2);
  });

  /*
   * Culling por conectividade (M12). A busca roda quando a câmera troca de
   * section ou algo muda perto dela; o que roda **todo quadro** é o corte pelo
   * frustum do que ela alcançou.
   */
  it('culling por conectividade: busca em menos de 8 ms, quadro em menos de 1 ms', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    const RD = 8;
    for (let cz = -RD - 1; cz <= RD + 1; cz++) {
      for (let cx = -RD - 1; cx <= RD + 1; cx++) world.addChunk(generateChunk(SEED, noise, cx, cz));
    }
    const runner = new MeshJobRunner(new GreedyMesher(tables, true), tables.occludes);
    const culling = new SectionCulling();
    culling.setRadius(RD);
    const views: SectionView[] = [];
    for (let cz = -RD; cz <= RD; cz++) {
      for (let cx = -RD; cx <= RD; cx++) {
        gatherSections(world, cx, cz, 0, 8, views);
        const r = runner.run({ type: 'mesh', cx, cz, mask: 0xff, syMin: 0, span: 8, sections: views });
        for (const sec of r.sections) {
          culling.set(cx, cz, sec.sy, sec.visibility, sec.opaque !== null || sec.cutout !== null);
        }
      }
    }
    const proj = createMat4();
    const view = createMat4();
    const vp = createMat4();
    perspective(proj, (70 * Math.PI) / 180, 16 / 9, 0.05, RD * 16 + 64);
    lookYawPitch(view, 8, 90, 8, 0.3, 0.2);
    multiply(vp, proj, view);
    const frustum = new Frustum();
    frustum.fromMatrix(vp);

    const search: number[] = [];
    const frame: number[] = [];
    for (let i = 0; i < 30; i++) {
      // Alterna entre duas sections: cada `run` refaz a busca.
      const x = i % 2 === 0 ? 8 : 24;
      let t0 = performance.now();
      culling.run(frustum, x, 90, 8);
      search.push(performance.now() - t0);
      t0 = performance.now();
      culling.run(frustum, x, 90, 8);
      frame.push(performance.now() - t0);
    }
    const searchMs = median(search);
    const frameMs = median(frame);
    console.log(`  culling: busca ${searchMs.toFixed(3)} ms, quadro ${frameMs.toFixed(3)} ms (RD ${RD})`);
    expect(searchMs).toBeLessThan(8);
    expect(frameMs).toBeLessThan(1);
  }, 30_000);

  it('a costura de luz de uma coluna nova custa menos de 4 ms', () => {
    const noise = new TerrainNoise(SEED);
    const world = new World(SEED);
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) world.addChunk(generateChunk(SEED, noise, dx, dz));
    }
    const lighting = new Lighting(world);
    for (let i = 0; i < 5; i++) lighting.stitchColumn(0, 0);
    const samples: number[] = [];
    for (let i = 0; i < 20; i++) {
      const t0 = performance.now();
      lighting.stitchColumn(0, 0);
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  costura de luz: ${ms.toFixed(3)} ms/coluna (mediana de 20)`);
    expect(ms).toBeLessThan(4);
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
  /**
   * Fogo: o incêndio no teto, com a lista cheia.
   *
   * É o mesmo contrato do crescimento e dos fluidos — teto duro por tick, custo
   * independente do tamanho do incêndio. Se alguém trocar o registro por um
   * random tick por section, este teste é quem avisa.
   */
  it('um tick de fogo com o teto de chamas custa menos de 2 ms', () => {
    const world = new World(SEED);
    for (let cx = -1; cx <= 1; cx++) {
      for (let cz = -1; cz <= 1; cz++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let x = 0; x < 16; x++) {
          for (let z = 0; z < 16; z++) {
            chunk.setBlock(x, 63, z, makeState(STONE));
            chunk.setBlock(x, 65, z, makeState(BLOCK_BY_NAME.get('oak_planks')!.id));
          }
        }
        world.addChunk(chunk);
      }
    }
    const fire = new Fire(world);
    fire.random = () => 0.5;
    fire.attach();
    for (let x = 0; x < 20 && fire.burning < MAX_FIRES; x++) {
      for (let z = 0; z < 20 && fire.burning < MAX_FIRES; z++) fire.ignite(x, 64, z);
    }
    expect(fire.burning).toBe(MAX_FIRES);

    const samples: number[] = [];
    for (let i = 0; i < 40; i++) {
      const t0 = performance.now();
      fire.tick();
      samples.push(performance.now() - t0);
    }
    const ms = median(samples);
    console.log(`  fogo: ${ms.toFixed(2)} ms/tick (${MAX_FIRES} chamas, mediana de 40)`);
    expect(ms).toBeLessThan(2);
  });

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
    console.log(`  acabamento Nítido: ${median(samples).toFixed(1)} ms (atlas inteiro)`);
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
    console.log(`  folha de sprites: ${median(samples).toFixed(1)} ms (mediana de 3)`);
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
