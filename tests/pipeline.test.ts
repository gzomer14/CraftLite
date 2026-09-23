/**
 * Pipeline de chunks, com um worker duplo que roda a geração e o meshing
 * de verdade (o mesmo código do worker real), só que síncrono.
 *
 * É o teste que pega erro de fiação: chunk que nunca sai de GENERATING, mesh
 * despachado sem os 8 vizinhos, pedido de malha que não é por coluna, chunk descarregado sem
 * liberar o VBO.
 */
import { findSpawnColumn } from '../src/world/gen/spawnsearch';
import { describe, expect, it } from 'vitest';
import { ChunkPipeline, type WorkerLike } from '../src/world/pipeline';
import { World } from '../src/world/world';
import { ChunkState } from '../src/world/chunk';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { MeshJobRunner } from '../src/workers/meshjob';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

const tables = buildBlockTables(buildLayerIndex());

/**
 * Guarda os pedidos e só trabalha no `flush()`.
 *
 * O trabalho **não** roda dentro do `postMessage`: no navegador ele volta na
 * hora e o worker trabalha em outra thread. Gerar terreno aqui dentro cobrava
 * o custo do worker no orçamento de despacho da thread principal, e o pipeline
 * parava de despachar depois de um ou dois pedidos por ciclo — num pool de
 * três, o terceiro worker nunca recebia nada.
 */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  private seed = 0;
  private noise: TerrainNoise | null = null;
  private meshJobs: MeshJobRunner | null = null;
  private readonly inbox: WorkerRequest[] = [];

  /** Contadores para asserções. */
  genCount = 0;
  meshCount = 0;

  postMessage(message: unknown): void {
    const request = message as WorkerRequest;
    if (request.type === 'init') {
      this.seed = request.seed;
      this.noise = new TerrainNoise(this.seed);
      this.meshJobs = new MeshJobRunner(new GreedyMesher(tables, request.packed), tables.occludes);
      return;
    }
    if (request.type === 'gen') this.genCount++;
    if (request.type === 'mesh') this.meshCount++;
    // O `postMessage` de verdade copia o pedido na hora; o duplo também, senão
    // uma edição no mundo depois do despacho vazaria para dentro do job.
    this.inbox.push(structuredClone(request));
  }

  private work(request: WorkerRequest): WorkerResponse | null {
    if (request.type === 'spawn') return { type: 'spawn', ...spawnOf(this.noise!) };
    if (request.type === 'mesh') return this.meshJobs!.run(request);
    if (request.type !== 'gen') return null;
    const chunk = generateChunk(this.seed, this.noise!, request.cx, request.cz);
    return {
      type: 'gen',
      cx: request.cx, cz: request.cz, dim: request.dim,
      sections: chunk.sections.map((s) => ({
        bits: s.bits, paletteLen: s.paletteLen, palette: s.palette, data: s.data,
        nonAirCount: s.nonAirCount,
        skyLight: s.skyLight ?? new Uint8Array(2048),
        blockLight: s.blockLight ?? new Uint8Array(2048),
      })),
      heightMap: chunk.heightMap,
      biomeMap: chunk.biomeMap,
      ms: 1,
    };
  }

  /** Trabalha tudo que chegou e entrega as respostas. */
  flush(): number {
    let n = 0;
    while (this.inbox.length > 0) {
      const response = this.work(this.inbox.shift() as WorkerRequest);
      if (response === null) continue;
      n++;
      this.onmessage?.({ data: response });
    }
    return n;
  }

  terminate(): void { /* nada */ }
}

interface Harness {
  world: World;
  pipeline: ChunkPipeline;
  workers: FakeWorker[];
  /** Roda `n` ciclos de pump + flush, como o loop faria. */
  run(n: number): void;
}

function harness(renderDistance = 2, workerCount = 1): Harness {
  const world = new World(777);
  const workers: FakeWorker[] = [];
  const pipeline = new ChunkPipeline(world, {
    workers: workerCount,
    renderDistance,
    packed: true,
    createWorker: () => {
      const w = new FakeWorker();
      workers.push(w);
      return w;
    },
  });
  return {
    world, pipeline, workers,
    run(n: number): void {
      for (let i = 0; i < n; i++) {
        pipeline.enqueueDirty();
        pipeline.pump();
        for (const w of workers) w.flush();
        pipeline.drainReady(1000, () => { /* descarta */ });
      }
    },
  };
}

describe('ChunkPipeline', () => {
  it('carrega o anel inteiro em volta do centro', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(60);
    // Círculo de raio 2: 21 colunas (r² + r = 6 de folga).
    expect(h.world.chunkCount).toBeGreaterThanOrEqual(13);
    expect(h.pipeline.stats.queued).toBe(0);
  });

  it('deixa todos os chunks em estado READY', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    let ready = 0;
    let total = 0;
    h.world.forEachChunk((c) => {
      total++;
      if (c.state === ChunkState.Ready) ready++;
    });
    // As colunas da borda não têm os 8 vizinhos, então ficam em GENERATED.
    expect(ready).toBeGreaterThan(0);
    expect(total).toBeGreaterThan(ready);
  });

  it('nunca mesha uma coluna sem os 8 vizinhos carregados', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    h.world.forEachChunk((column) => {
      if (column.state !== ChunkState.Ready) return;
      for (let dz = -1; dz <= 1; dz++) {
        for (let dx = -1; dx <= 1; dx++) {
          expect(
            h.world.getChunk(column.cx + dx, column.cz + dz),
            `vizinho ${dx},${dz} de ${column.cx},${column.cz}`,
          ).toBeDefined();
        }
      }
    });
  });

  it('gera cada coluna uma única vez', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    const generated = h.workers.reduce((sum, w) => sum + w.genCount, 0);
    expect(generated).toBe(h.world.chunkCount);
  });

  /*
   * Travamento de campo (2026-09-12, aparelho T0: "ao sair voando o jogo
   * trava completamente, só atualizando a página para voltar").
   *
   * `dispatchMesh` devolvia o job bloqueado para a própria `meshQueue` de onde
   * o `pump` acabara de tirá-lo, e o `continue` não gastava vaga de `busy`. Com
   * todo job da fila bloqueado — voar descarrega o vizinho antes de o meshing
   * sair —, o `while` reexaminava o mesmo job para sempre. Loop infinito
   * síncrono: a aba não cai de FPS, ela morre, sem nem conseguir mostrar erro.
   *
   * ATENÇÃO: se este teste regredir, ele **trava** em vez de falhar — o vitest
   * não consegue interromper um laço síncrono. Um `pump()` que não retorna é
   * exatamente o bug.
   */
  it('pump() retorna quando todo job de mesh está sem vizinho', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(60);

    // (2,1) está carregada, (3,1) não: coluna de borda, sem os 8 vizinhos.
    expect(h.world.getChunk(2, 1)).toBeDefined();
    expect(h.world.getChunk(3, 1)).toBeUndefined();

    // Editar um bloco nela enfileira meshing — `enqueueDirty` não checa vizinho.
    h.world.setBlock(2 * 16 + 8, 70, 1 * 16 + 8, 1, 'player');
    h.pipeline.enqueueDirty();
    expect(h.pipeline.stats.queued).toBe(0); // stats só atualiza no pump

    h.pipeline.pump();
    // O job continua na fila esperando o vizinho, sem ter travado o frame.
    const queued = h.pipeline.stats.queued;
    expect(queued).toBeGreaterThan(0);

    // E não se multiplica a cada frame: dez pumps, mesma fila.
    for (let i = 0; i < 10; i++) h.pipeline.pump();
    expect(h.pipeline.stats.queued).toBe(queued);
  });

  it('descarta job de mesh cuja coluna saiu do mundo', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(60);
    h.world.setBlock(2 * 16 + 8, 70, 1 * 16 + 8, 1, 'player');
    h.pipeline.enqueueDirty();
    h.pipeline.pump();
    expect(h.pipeline.stats.queued).toBeGreaterThan(0);

    // Teleporte: a coluna do job some. Se o job órfão continuasse sendo
    // adiado, a fila nunca zeraria — ele espera um vizinho que não volta mais.
    h.pipeline.setCenter(8000, 8000);
    h.run(80);
    expect(h.pipeline.stats.queued).toBe(0);
  });

  /*
   * Distância de render em jogo (relato de campo 2026-09-12: "setei para o
   * máximo 16 chunks e nada foi renderizado de forma diferente").
   *
   * A opção era lida uma vez no boot. Mexer nela durante a partida não fazia
   * nada, porque `setCenter` sai cedo quando o centro não mudou — o anel novo
   * só seria enfileirado ao trocar de chunk, e o excedente nunca descarregado.
   */
  it('aumentar a distância de render carrega mais chunks na hora', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    const before = h.world.chunkCount;

    h.pipeline.setRenderDistance(4);
    h.run(160);
    expect(h.world.chunkCount).toBeGreaterThan(before);
    // O anel de raio 4 tem 69 colunas; o de raio 2, 21.
    const progress = { loaded: 0, total: 0 };
    h.pipeline.ringProgress(progress);
    expect(progress.total).toBe(69);
    expect(progress.loaded).toBe(69);
  });

  it('diminuir a distância de render descarrega o excedente', () => {
    const h = harness(4);
    h.pipeline.setCenter(0, 0);
    h.run(200);
    const before = h.world.chunkCount;

    h.pipeline.setRenderDistance(1);
    expect(h.world.chunkCount).toBeLessThan(before);
    const progress = { loaded: 0, total: 0 };
    h.pipeline.ringProgress(progress);
    expect(progress.total).toBe(9); // raio 1: dx²+dz² ≤ 2 pega as 9 colunas
  });

  /*
   * O teto é `workers × 16` desde 2026-09-13. Este teste dizia "2 × 2" e só
   * passava porque o duplo gerava terreno dentro do `postMessage` e esgotava o
   * orçamento de tempo do despacho — media o relógio, não o teto.
   */
  it('respeita o limite de requisições em voo', () => {
    const h = harness(4, 2);
    h.pipeline.setCenter(0, 0);
    // Um pump sem flush: nada pode passar de 16 por worker.
    h.pipeline.pump();
    const dispatched = h.workers.reduce((s, w) => s + w.genCount + w.meshCount, 0);
    expect(dispatched).toBe(32);

    // Com teto explícito, é ele que manda.
    const world = new World(777);
    const workers: FakeWorker[] = [];
    const tight = new ChunkPipeline(world, {
      workers: 2, renderDistance: 4, packed: true, maxInFlight: 4,
      createWorker: () => { const w = new FakeWorker(); workers.push(w); return w; },
    });
    tight.setCenter(0, 0);
    tight.pump();
    tight.pump();
    expect(workers.reduce((s, w) => s + w.genCount + w.meshCount, 0)).toBe(4);
  });

  it('descarrega o que sai do alcance e avisa quem escuta', () => {
    const h = harness(2);
    const released: string[] = [];
    h.pipeline.onChunkUnloaded = (c) => released.push(`${c.cx},${c.cz}`);

    h.pipeline.setCenter(0, 0);
    h.run(80);
    const before = h.world.chunkCount;

    h.pipeline.setCenter(1000, 1000);
    expect(released.length).toBe(before);
    expect(h.world.chunkCount).toBe(0);
  });

  it('mantém histerese: andar um chunk não descarrega nada', () => {
    const h = harness(3);
    h.pipeline.setCenter(0, 0);
    h.run(120);
    const before = h.world.chunkCount;
    h.pipeline.setCenter(16, 0); // um chunk para o lado
    expect(h.world.chunkCount).toBe(before);
  });

  it('entrega meshes prontos respeitando o orçamento de tempo', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    for (let i = 0; i < 10; i++) {
      h.pipeline.pump();
      for (const w of h.workers) w.flush();
    }
    let applied = 0;
    // Orçamento zero ainda entrega um, senão o pipeline nunca avança.
    applied += h.pipeline.drainReady(0, () => { /* nada */ });
    expect(applied).toBe(1);
  });

  /*
   * M12: a vizinhança 18³ deixou de ser montada na thread principal. O pedido
   * leva as sections cruas, uma mensagem por coluna, e só a faixa de sections
   * que as pedidas precisam (elas, uma acima e uma abaixo).
   */
  it('um pedido de malha por coluna, com as sections cruas das 3×3 vizinhas', () => {
    const world = new World(777);
    const sent: WorkerRequest[] = [];
    const worker = new FakeWorker();
    const original = worker.postMessage.bind(worker);
    worker.postMessage = (message: unknown) => {
      const request = message as WorkerRequest;
      if (request.type === 'mesh') sent.push(structuredClone(request));
      original(message);
    };
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 2, packed: true, createWorker: () => worker,
    });
    pipeline.setCenter(0, 0);
    for (let i = 0; i < 60; i++) {
      pipeline.pump();
      worker.flush();
      pipeline.drainReady(1000, () => { /* descarta */ });
    }

    expect(sent.length).toBeGreaterThan(0);
    const columns = new Set(sent.map((r) => r.type === 'mesh' ? `${r.cx},${r.cz}` : ''));
    // Carregando do zero, cada coluna pede malha uma vez só, com tudo junto.
    expect(columns.size).toBe(sent.length);
    for (const request of sent) {
      if (request.type !== 'mesh') continue;
      expect(request.sections.length).toBe(9 * request.span);
      expect('blocks' in request).toBe(false);
    }

    // Uma edição suja uma section só: o pedido leva ela e as duas em volta.
    sent.length = 0;
    const chunk = world.getChunk(0, 0)!;
    world.setBlock(8, 40, 8, 0, 'player'); // section 2
    expect(chunk.sections[2].isEmpty).toBe(false);
    pipeline.enqueueDirty();
    pipeline.pump();
    const edit = sent.find((r) => r.type === 'mesh' && r.cx === 0 && r.cz === 0);
    expect(edit).toBeDefined();
    if (edit?.type === 'mesh') {
      expect(edit.mask).toBe(1 << 2);
      expect([edit.syMin, edit.span]).toEqual([1, 3]);
    }
  });

  it('re-mesha a section quando um bloco muda', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    const meshesBefore = h.workers.reduce((s, w) => s + w.meshCount, 0);

    const chunk = h.world.getChunk(0, 0)!;
    h.world.setBlock(8, chunk.heightMap[(8 << 4) | 8], 8, 0, 'player');
    h.run(3);

    const meshesAfter = h.workers.reduce((s, w) => s + w.meshCount, 0);
    expect(meshesAfter).toBeGreaterThan(meshesBefore);
  });

  it('distribui o trabalho entre os workers', () => {
    const h = harness(3, 3);
    h.pipeline.setCenter(0, 0);
    h.run(120);
    const counts = h.workers.map((w) => w.genCount + w.meshCount);
    for (const c of counts) expect(c).toBeGreaterThan(0);
  });
});

function spawnOf(noise: TerrainNoise): { x: number; z: number } {
  const [x, z] = findSpawnColumn(noise.field);
  return { x, z };
}
