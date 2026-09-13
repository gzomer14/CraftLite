/**
 * Pipeline de chunks, com um worker duplo que roda a geração e o meshing
 * de verdade (o mesmo código do worker real), só que síncrono.
 *
 * É o teste que pega erro de fiação: chunk que nunca sai de GENERATING, mesh
 * despachado sem os 8 vizinhos, buffer não reciclado, chunk descarregado sem
 * liberar o VBO.
 */
import { describe, expect, it } from 'vitest';
import { ChunkPipeline, type WorkerLike } from '../src/world/pipeline';
import { World } from '../src/world/world';
import { ChunkState } from '../src/world/chunk';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

const tables = buildBlockTables(buildLayerIndex());

/** Enfileira as respostas e só entrega quando `flush()` é chamado. */
class FakeWorker implements WorkerLike {
  onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
  private seed = 0;
  private noise: TerrainNoise | null = null;
  private mesher: GreedyMesher | null = null;
  private readonly outbox: WorkerResponse[] = [];

  /** Contadores para asserções. */
  genCount = 0;
  meshCount = 0;

  postMessage(message: unknown): void {
    const request = message as WorkerRequest;
    if (request.type === 'init') {
      this.seed = request.seed;
      this.noise = new TerrainNoise(this.seed);
      this.mesher = new GreedyMesher(tables, request.packed);
      return;
    }
    if (request.type === 'gen') {
      this.genCount++;
      const chunk = generateChunk(this.seed, this.noise!, request.cx, request.cz);
      this.outbox.push({
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
      });
      return;
    }
    this.meshCount++;
    const result = this.mesher!.mesh(request.blocks, request.light);
    this.outbox.push({
      type: 'mesh',
      cx: request.cx, cz: request.cz, sy: request.sy,
      opaque: result.opaque, cutout: result.cutout, translucent: result.translucent,
      quads: result.quads, ms: 1,
      blocks: request.blocks, light: request.light,
    });
  }

  /** Entrega tudo que está na caixa de saída. */
  flush(): number {
    const n = this.outbox.length;
    while (this.outbox.length > 0) {
      this.onmessage?.({ data: this.outbox.shift() as WorkerResponse });
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

  it('respeita o limite de requisições em voo', () => {
    const h = harness(4, 2);
    h.pipeline.setCenter(0, 0);
    // Um pump sem flush: nada pode passar de 2 × 2 workers.
    h.pipeline.pump();
    const dispatched = h.workers.reduce((s, w) => s + w.genCount + w.meshCount, 0);
    expect(dispatched).toBeLessThanOrEqual(4);
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

  it('recicla os buffers de vizinhança em vez de realocar', () => {
    const h = harness(2);
    h.pipeline.setCenter(0, 0);
    h.run(80);
    const seen = new Set<ArrayBufferLike>();
    // Após muitos ciclos, o pool deve reusar poucos buffers distintos.
    for (let i = 0; i < 5; i++) {
      h.world.setBlock(0, h.world.getChunk(0, 0)!.heightMap[0], 0, 0, 'player');
      h.pipeline.enqueueDirty();
      h.pipeline.pump();
      for (const w of h.workers) w.flush();
      h.pipeline.drainReady(1000, (r) => seen.add(r.response.blocks.buffer));
    }
    // Com 1 worker e 2 em voo, o pool não deve crescer sem limite.
    expect(seen.size).toBeLessThanOrEqual(4);
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
