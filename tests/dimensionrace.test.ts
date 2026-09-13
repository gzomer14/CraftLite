/**
 * Regressões dos quatro bugs achados em campo no S24 Ultra (2026-09-13).
 *
 * Os dois primeiros são a mesma doença com duas causas: **coluna de uma
 * dimensão entrando na outra**, o que no aparelho virou um pilar de netherrack
 * plantado na superfície. O terceiro é o meshing matando a geração de fome; o
 * quarto é o Nether nascer sem luz nenhuma.
 */
import { describe, expect, it } from 'vitest';
import { ChunkPipeline, type WorkerLike } from '../src/world/pipeline';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { SaveManager } from '../src/save/savemanager';
import { NetherNoise, generateNetherChunk, LAVA_SEA_LEVEL } from '../src/world/gen/nether';
import { dimensionIdFor, type SaveDatabase } from '../src/save/db';
import { DIM_NETHER, DIM_OVERWORLD } from '../src/data/dimensions';
import { BLOCK_BY_NAME, defOf, makeState } from '../src/data/blocks';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { detectTier, type DeviceInfo } from '../src/core/tier';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

/** Worker que só conta: nenhuma resposta volta, então as vagas ficam presas. */
class SilentWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  genCount = 0;
  meshCount = 0;

  postMessage(message: unknown): void {
    const request = message as WorkerRequest;
    if (request.type === 'gen') this.genCount++;
    else if (request.type === 'mesh') this.meshCount++;
  }

  terminate(): void { /* nada */ }
}

const tables = buildBlockTables(buildLayerIndex());

/** Deixa as microtarefas pendentes rodarem. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe('coluna do save que chega depois do portal', () => {
  it('não entra no mundo da dimensão nova', async () => {
    const world = new World(1);
    const workers: SilentWorker[] = [];
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 2, packed: true,
      createWorker: () => { const w = new SilentWorker(); workers.push(w); return w; },
    });

    let deliver: ((chunk: ChunkColumn | null) => void) | null = null;
    pipeline.loadSaved = () => new Promise((resolve) => { deliver = resolve; });

    pipeline.setCenter(0, 0);
    pipeline.pump();
    expect(deliver).not.toBeNull();

    // O jogador atravessa o portal enquanto a leitura do disco está em voo.
    pipeline.setDimension(DIM_NETHER);
    (deliver as unknown as (c: ChunkColumn | null) => void)(new ChunkColumn(0, 0));
    await settle();

    expect(world.getChunk(0, 0)).toBeUndefined();
  });

  it('a coluna do save entra normalmente quando ninguém trocou de dimensão', async () => {
    const world = new World(1);
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 2, packed: true,
      createWorker: () => new SilentWorker(),
    });
    pipeline.loadSaved = (cx, cz) => Promise.resolve(new ChunkColumn(cx, cz));

    pipeline.setCenter(0, 0);
    pipeline.pump();
    await settle();

    expect(world.getChunk(0, 0)).toBeDefined();
  });
});

describe('gravação em curso na hora do portal', () => {
  /** Banco falso cuja escrita demora, para a gravação ficar mesmo em voo. */
  function slowDb() {
    const written: { store: string; cx: number; cz: number }[] = [];
    return {
      written,
      async putChunks(
        dimensionId: string, entries: readonly [number, number, Uint8Array][],
      ): Promise<void> {
        await settle();
        for (const [cx, cz] of entries) written.push({ store: dimensionId, cx, cz });
      },
    };
  }

  const dirtyColumn = (cx: number, cz: number): ChunkColumn => {
    const chunk = new ChunkColumn(cx, cz);
    chunk.setBlock(0, 40, 0, makeState(BLOCK_BY_NAME.get('netherrack')?.id ?? 1));
    chunk.modified = true;
    return chunk;
  };

  it('o lote em voo vai para a chave da dimensão que está sendo deixada', async () => {
    const db = slowDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    await manager.setDimension(DIM_NETHER);

    manager.markDirty(dirtyColumn(3, 4));
    // Autosave dispara e **fica em voo**; o portal chega no meio dele.
    void manager.flush();
    await manager.setDimension(DIM_OVERWORLD);

    expect(db.written).toHaveLength(1);
    expect(db.written[0].store).toBe(dimensionIdFor('mundo', DIM_NETHER));
  });

  it('a coluna sujada durante a gravação também sai com a chave antiga', async () => {
    const db = slowDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    await manager.setDimension(DIM_NETHER);

    manager.markDirty(dirtyColumn(1, 1));
    void manager.flush();
    // É o que o `pipeline.setDimension` faz: descarrega tudo antes do save virar.
    manager.markDirty(dirtyColumn(2, 2));
    await manager.setDimension(DIM_OVERWORLD);

    const nether = dimensionIdFor('mundo', DIM_NETHER);
    expect(db.written).toHaveLength(2);
    expect(db.written.every((w) => w.store === nether)).toBe(true);
  });

  it('depois da troca, a gravação usa a chave nova', async () => {
    const db = slowDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    await manager.setDimension(DIM_NETHER);
    await manager.setDimension(DIM_OVERWORLD);

    manager.markDirty(dirtyColumn(5, 5));
    await manager.flush();

    expect(db.written[0].store).toBe(dimensionIdFor('mundo', DIM_OVERWORLD));
  });

  it('duas chamadas concorrentes de flush terminam na mesma gravação', async () => {
    const db = slowDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    manager.markDirty(dirtyColumn(0, 0));

    await Promise.all([manager.flush(), manager.flush()]);
    expect(db.written).toHaveLength(1);
  });
});

describe('geração não morre de fome', () => {
  /**
   * Worker que faz o trabalho de verdade: gera coluna cheia e mesha com o
   * `GreedyMesher`. É preciso ser de verdade — o sintoma não é travamento, é
   * **proporção**. Com o meshing tendo prioridade absoluta, cada pump gastava
   * as quatro vagas em malha e a geração só avançava no respiro entre uma
   * leva e a outra.
   */
  class RealWorker implements WorkerLike {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    private readonly outbox: WorkerResponse[] = [];
    private mesher: GreedyMesher | null = null;

    postMessage(message: unknown): void {
      const request = message as WorkerRequest;
      if (request.type === 'init') {
        this.mesher = new GreedyMesher(tables, request.packed);
        return;
      }
      if (request.type === 'mesh') {
        const out = (this.mesher as GreedyMesher).mesh(request.blocks, request.light);
        this.outbox.push({
          type: 'mesh', cx: request.cx, cz: request.cz, sy: request.sy,
          opaque: out.opaque, cutout: out.cutout, translucent: out.translucent,
          quads: out.quads, ms: 1, blocks: request.blocks, light: request.light,
        });
        return;
      }
      this.outbox.push(genResponse(request.cx, request.cz, request.dim));
    }

    flush(): void {
      while (this.outbox.length > 0) {
        this.onmessage?.({ data: this.outbox.shift() as WorkerResponse });
      }
    }

    terminate(): void { /* nada */ }
  }

  /**
   * Worker que **não** trabalha dentro do `postMessage`.
   *
   * Vale a distinção: no navegador o `postMessage` volta na hora e o mesher
   * roda em outra thread. Um duplo que mesha ali dentro cobra o custo do
   * worker no orçamento de despacho da thread principal e mede o pipeline
   * errado — foi o que aconteceu na primeira medição desta correção.
   */
  class ThreadedWorker extends RealWorker {
    private readonly queued: WorkerRequest[] = [];

    override postMessage(message: unknown): void {
      const request = message as WorkerRequest;
      if (request.type === 'mesh') { this.queued.push(request); return; }
      super.postMessage(message);
    }

    override flush(): void {
      while (this.queued.length > 0) super.postMessage(this.queued.shift());
      super.flush();
    }
  }

  it('um mundo de render distance 16 fica pronto em menos de 400 pumps', () => {
    const world = new World(11);
    const workers: ThreadedWorker[] = [];
    const pipeline = new ChunkPipeline(world, {
      // Sem relógio: quem limita é o teto de jobs em voo, e a conta de pumps
      // não muda conforme a máquina esteja ocupada.
      workers: 2, renderDistance: 16, packed: true, dispatchBudgetMs: Infinity,
      createWorker: () => { const w = new ThreadedWorker(); workers.push(w); return w; },
    });

    pipeline.setCenter(0, 0);
    let pumps = 0;
    while (pumps < 2000) {
      pumps++;
      pipeline.pump();
      for (const w of workers) w.flush();
      pipeline.drainReady(1000, () => { /* descarta */ });
      if (pipeline.stats.queued === 0) break;
    }

    expect(pipeline.stats.queued).toBe(0);
    /*
     * Com o teto de `workers * 2` eram **1314** pumps — 22 s a 60 FPS, que é o
     * que o jogador viu no aparelho. Com o teto alto mais o orçamento de tempo
     * são ~460. O piso protege a ordem de grandeza, não o número exato: ele
     * depende de quanto a máquina do teste gasta por `extractNeighborhood`.
     */
    expect(pumps).toBeLessThan(400);
    // Meshar 4.400 sections de verdade leva alguns segundos numa máquina
    // carregada, e o padrão de 5 s do vitest não cobre a suíte inteira em
    // paralelo. É o teste de vazão mais importante do projeto: vale o tempo.
  }, 30_000);

  /*
   * Este caso roda com o teto **apertado** de propósito. Com `workers * 16` a
   * reserva não muda nada — sobra vaga para os dois lados. Ela existe para o
   * regime oposto, que é o do aparelho lento: lá o orçamento de tempo deixa
   * passar meia dúzia de despachos por frame, e sem reserva o meshing leva
   * todos. Era esse o regime de antes, em todo aparelho.
   */
  it('com poucas vagas, a reserva dobra a velocidade do mundo nascer', () => {
    const world = new World(7);
    const workers: RealWorker[] = [];
    const pipeline = new ChunkPipeline(world, {
      workers: 2, renderDistance: 8, packed: true,
      dispatchBudgetMs: Infinity, maxInFlight: 4,
      createWorker: () => { const w = new RealWorker(); workers.push(w); return w; },
    });

    pipeline.setCenter(0, 0);
    for (let i = 0; i < 40; i++) {
      pipeline.pump();
      for (const w of workers) w.flush();
      pipeline.drainReady(1000, () => { /* descarta */ });
    }

    /*
     * Com a prioridade absoluta do meshing eram **44** colunas em 40 ciclos;
     * com metade das vagas reservada são **86**. O piso está entre os dois e
     * longe dos dois: o que ele protege é a ordem de grandeza, não o número.
     */
    expect(world.chunkCount).toBeGreaterThan(65);
  });
});

describe('o Nether nasce com luz', () => {
  const noise = new NetherNoise(99);

  it('a lava do mar acende a si mesma', () => {
    const chunk = generateNetherChunk(99, noise, 0, 0);
    const lava = BLOCK_BY_NAME.get('lava')?.id ?? -1;
    let lit = 0;
    let dark = 0;
    for (let y = 1; y <= LAVA_SEA_LEVEL; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (defOf(chunk.getBlock(x, y, z)).id !== lava) continue;
          if (blockLightOf(chunk, x, y, z) >= 15) lit++;
          else dark++;
        }
      }
    }
    expect(lit).toBeGreaterThan(0);
    expect(dark).toBe(0);
  });

  it('a luz da lava chega aos blocos em volta', () => {
    const chunk = generateNetherChunk(99, noise, 3, -2);
    let maxAboveSea = 0;
    for (let y = LAVA_SEA_LEVEL + 1; y < LAVA_SEA_LEVEL + 6; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const level = blockLightOf(chunk, x, y, z);
          if (level > maxAboveSea) maxAboveSea = level;
        }
      }
    }
    expect(maxAboveSea).toBeGreaterThan(0);
  });

  it('o teto de rocha-mãe mantém a luz do céu em zero', () => {
    const chunk = generateNetherChunk(99, noise, 0, 0);
    const section = chunk.sections[6];
    if (section.skyLight === null) return; // sem luz do céu alocada: já é zero
    expect(Array.from(section.skyLight).every((v) => v === 0)).toBe(true);
  });

  it('duas colunas vizinhas nascem igualmente iluminadas', () => {
    const a = generateNetherChunk(99, noise, 10, 10);
    const b = generateNetherChunk(99, noise, 11, 10);
    expect(hasAnyBlockLight(a)).toBe(true);
    expect(hasAnyBlockLight(b)).toBe(true);
  });
});

describe('tier de um celular topo de linha', () => {
  const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
    hasWebGL2: true, memGB: 8, cores: 8, isMobile: false,
    maxTexSize: 8192, renderer: 'Mesa Intel(R) UHD Graphics', ...over,
  });

  it('um celular de 2024 chega ao T2', () => {
    /*
     * A string é a do aparelho, copiada do overlay: quem responde é o ANGLE,
     * e ele informa **8192** de textura máxima num Adreno 750. Foi por isso
     * que a primeira regra, baseada em `maxTexSize`, não promoveu ninguém.
     * `deviceMemory` satura em 8, então 12 GB reais chegam aqui como 8.
     */
    expect(detectTier(device({
      memGB: 8, cores: 8, isMobile: true, maxTexSize: 8192,
      renderer: 'ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)',
    }))).toBe(2);
  });

  it('as outras famílias de topo também contam', () => {
    const flagship = (renderer: string): number => detectTier(device({
      memGB: 8, cores: 8, isMobile: true, maxTexSize: 8192, renderer,
    }));
    expect(flagship('ANGLE (Samsung Xclipse 940)')).toBe(2);
    expect(flagship('Mali-G715-Immortalis')).toBe(2);
    expect(flagship('Apple GPU')).toBe(2);
  });

  it('o celular de 2020 continua em T1', () => {
    expect(detectTier(device({
      memGB: 4, cores: 8, isMobile: true, maxTexSize: 8192,
      renderer: 'Adreno (TM) 610',
    }))).toBe(1);
  });

  it('o aparelho alvo de 2016 continua em T0', () => {
    expect(detectTier(device({
      memGB: 2, cores: 8, isMobile: true, maxTexSize: 8192,
      renderer: 'Mali-T830',
    }))).toBe(0);
  });

  it('GPU de topo não promove quem não tem WebGL2', () => {
    expect(detectTier(device({
      hasWebGL2: false, isMobile: true, renderer: 'Adreno (TM) 750',
    }))).toBeLessThan(2);
  });

  it('o Adreno 610 de 2020 não é confundido com a família 7xx', () => {
    expect(detectTier(device({
      memGB: 8, cores: 8, isMobile: true, renderer: 'Adreno (TM) 610',
    }))).toBe(1);
  });
});

function blockLightOf(chunk: ChunkColumn, x: number, y: number, z: number): number {
  const section = chunk.sections[y >> 4];
  if (section.blockLight === null) return 0;
  const index = (((y & 15) << 8) | (z << 4) | x);
  const byte = section.blockLight[index >> 1];
  return (index & 1) === 0 ? byte & 15 : byte >> 4;
}

function hasAnyBlockLight(chunk: ChunkColumn): boolean {
  for (const section of chunk.sections) {
    if (section.blockLight === null) continue;
    for (const byte of section.blockLight) if (byte !== 0) return true;
  }
  return false;
}

/** Resposta de geração: coluna de pedra de Y=30 a 69, para haver malha de verdade. */
function genResponse(cx: number, cz: number, dim: number): WorkerResponse {
  const chunk = new ChunkColumn(cx, cz);
  for (let y = 30; y < 70; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(1));
    }
  }
  return {
    type: 'gen', cx, cz, dim,
    sections: chunk.sections.map((section) => ({
      bits: section.bits, paletteLen: section.paletteLen, palette: section.palette,
      data: section.data, nonAirCount: section.nonAirCount,
      skyLight: section.skyLight ?? new Uint8Array(2048),
      blockLight: section.blockLight ?? new Uint8Array(2048),
    })),
    heightMap: chunk.heightMap,
    biomeMap: chunk.biomeMap,
    ms: 1,
  };
}
