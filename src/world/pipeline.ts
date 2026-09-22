/**
 * Pipeline de chunks (doc 02 §5.4).
 *
 * `EMPTY → GENERATING → GENERATED → MESHING → READY`, com fila de prioridade
 * por distância² ao jogador e bônus para quem está no frustum. Máximo de
 * `2 × nWorkers` requisições em voo, e orçamento duro de tempo por frame para
 * aplicar os resultados.
 *
 * A regra que mais importa em T0: **carregar devagar é melhor que travar.**
 */

import { DIM_OVERWORLD } from '../data/dimensions';
import { ChunkColumn, ChunkState, SECTIONS_PER_COLUMN, chunkKey } from './chunk';
import { extractNeighborhood, NB_VOLUME } from './neighborhood';
import type { World } from './world';
import type {
  GenResponse, MeshResponse, SerializedSection, WorkerRequest, WorkerResponse,
} from '../workers/protocol';

/** Resultado de `dispatchMesh`. Números, não string, para não alocar no pump. */
const MESH_SENT = 0;
/** Falta vizinho: continua na fila e tenta de novo no próximo frame. */
const MESH_DEFERRED = 1;
/** A coluna saiu do mundo: o job não tem mais destino e é descartado. */
const MESH_DROPPED = 2;

/** Um pedido na fila, com a prioridade já calculada. */
interface PendingJob {
  cx: number;
  cz: number;
  /** −1 = geração da coluna; 0..7 = meshing daquela section. */
  sy: number;
  priority: number;
}

export interface MeshResult {
  cx: number;
  cz: number;
  sy: number;
  response: MeshResponse;
}

export interface PipelineStats {
  loaded: number;
  queued: number;
  generating: number;
  meshing: number;
  /** Média móvel do tempo de geração e de meshing, em ms. */
  genMs: number;
  meshMs: number;
}

/** Interface mínima de worker que o pipeline usa — permite injetar um duplo. */
export interface WorkerLike {
  postMessage(message: unknown, transfer?: Transferable[]): void;
  terminate(): void;
  onmessage: ((event: { data: WorkerResponse }) => void) | null;
}

export interface PipelineOptions {
  workers: number;
  renderDistance: number;
  packed: boolean;
  /** Iluminação suave (AO) no mesh. Ver `GreedyMesher.smoothLighting`. */
  smoothLighting?: boolean;
  /** FPS alvo do preset. Define quanto do frame o despacho pode gastar. */
  targetFps?: number;
  /** Teto de pedidos em voo. O padrão é `workers * 16`. */
  maxInFlight?: number;
  /**
   * Teto de tempo de despacho por frame, em ms. O padrão sai do `targetFps`.
   *
   * Existe explícito para **teste**: um orçamento de relógio faz a vazão
   * depender de quanto a máquina está ocupada, e um teste de vazão assim passa
   * sozinho e falha na suíte cheia. Passando `Infinity`, quem limita é só o
   * teto de jobs em voo, e a medição vira determinística.
   */
  dispatchBudgetMs?: number;
  /** Fábrica de worker. O padrão cria o worker real; os testes injetam um duplo. */
  createWorker?: (index: number) => WorkerLike;
}

/**
 * Quanto do frame o `pump` pode gastar **despachando**.
 *
 * Despachar não é de graça: cada job de malha copia a vizinhança 18³ da coluna
 * (blocos e luz) na thread principal, ~0,26 ms por section. É este orçamento —
 * e não uma contagem fixa — que decide quantos cabem, porque num aparelho
 * lento cada cópia custa mais e a conta se ajusta sozinha.
 */
const DISPATCH_FRAME_SHARE = 0.2;

export class ChunkPipeline {
  private readonly world: World;
  private readonly pool: WorkerLike[] = [];
  /** Quantos pedidos cada worker tem em voo — usado para o round-robin. */
  private readonly inFlight: number[] = [];
  private readonly maxInFlight: number;
  /** Teto de tempo de despacho por frame, em ms. Ver `DISPATCH_FRAME_SHARE`. */
  private readonly dispatchBudgetMs: number;

  /** Dimensão que os pedidos de geração carregam (`DIM_*`). */
  dimension = DIM_OVERWORLD;

  private readonly genQueue: PendingJob[] = [];
  private readonly meshQueue: PendingJob[] = [];
  private readonly queuedKeys = new Set<number>();
  private readonly generating = new Set<number>();
  private readonly meshing = new Set<number>();

  /** Buffers de vizinhança reciclados (buffer ring do doc 02 §5.5). */
  private readonly blockPool: Uint16Array[] = [];
  private readonly lightPool: Uint8Array[] = [];

  /** Resultados prontos, aguardando upload dentro do orçamento do frame. */
  private readonly readyMeshes: MeshResult[] = [];

  /**
   * Jobs de meshing que esperam um vizinho chegar. Reaproveitado entre frames:
   * o `pump` esvazia no fim, então nunca aloca no caminho quente.
   */
  private readonly deferredMeshes: PendingJob[] = [];

  renderDistance: number;
  private centerX = 0;
  private centerZ = 0;
  private readonly packed: boolean;
  private readonly smoothLighting: boolean;

  readonly stats: PipelineStats = {
    loaded: 0, queued: 0, generating: 0, meshing: 0, genMs: 0, meshMs: 0,
  };

  constructor(world: World, options: PipelineOptions) {
    this.world = world;
    this.renderDistance = options.renderDistance;
    this.packed = options.packed;
    this.smoothLighting = options.smoothLighting ?? true;
    /*
     * Dezesseis por worker, não dois.
     *
     * Dois era o gargalo do jogo inteiro: o `pump` roda **uma vez por frame**,
     * então o teto de jobs em voo é também o teto de despachos por frame. Com
     * `workers * 2` o aparelho mandava 4 jobs e esperava o frame seguinte, com
     * os workers ociosos 90% do tempo — medido num S24 Ultra: mundo de render
     * distance 16 a 60 FPS, render de 3,2 ms de 16,6, e **7051 sections na
     * fila** que levavam ~22 s para sair. A máquina não estava lenta, estava
     * entediada (relato de campo 2026-09-13).
     *
     * O que segura o despacho agora é o orçamento de tempo abaixo, que se
     * ajusta ao aparelho; este número é só o teto de segurança para a fila de
     * mensagens do worker não crescer sem limite.
     */
    this.maxInFlight = options.maxInFlight ?? options.workers * 16;
    this.dispatchBudgetMs = options.dispatchBudgetMs
      ?? (1000 / (options.targetFps ?? 60)) * DISPATCH_FRAME_SHARE;

    const create = options.createWorker ?? defaultWorkerFactory;
    for (let i = 0; i < options.workers; i++) {
      const worker = create(i);
      worker.onmessage = (event) => this.onWorkerMessage(event.data);
      worker.postMessage({
        type: 'init', seed: world.seed, packed: this.packed,
        smoothLighting: this.smoothLighting,
      } as WorkerRequest);
      this.pool.push(worker);
      this.inFlight.push(0);
    }
  }

  /**
   * Troca a distância de render **em jogo** (opção de vídeo do doc 08).
   *
   * Não basta escrever no campo: `setCenter` sai cedo quando o centro não
   * mudou, então sem reenfileirar aqui o anel novo só apareceria quando o
   * jogador trocasse de chunk — e diminuindo, o excedente ficaria carregado.
   */
  setRenderDistance(distance: number): void {
    if (distance === this.renderDistance || distance < 1) return;
    this.renderDistance = distance;
    this.enqueueRing();
    this.unloadFarChunks();
  }

  /**
   * Troca a dimensão e limpa tudo que era da anterior.
   *
   * Chama `onChunkUnloaded` para cada coluna que sai — é assim que o save grava
   * o que estava sujo e o renderer solta a malha da GPU. As filas e os jobs em
   * voo são esquecidos: a resposta que chegar depois vem carimbada com a
   * dimensão de origem e é descartada em `onGenerated`.
   */
  setDimension(dimension: number): void {
    if (dimension === this.dimension) return;
    this.dimension = dimension;

    const taken: ChunkColumn[] = [];
    const count = this.world.takeAllChunks(taken);
    for (let i = 0; i < count; i++) this.onChunkUnloaded?.(taken[i]);

    this.genQueue.length = 0;
    this.meshQueue.length = 0;
    this.queuedKeys.clear();
    this.generating.clear();
    this.meshing.clear();
    this.readyMeshes.length = 0;
    // Força o `setCenter` seguinte a reenfileirar, mesmo na mesma coluna.
    this.centerX = Number.NaN;
    this.centerZ = Number.NaN;
  }

  /** Recentra o pipeline na posição do jogador e reordena as filas. */
  setCenter(x: number, z: number): void {
    const cx = Math.floor(x / 16);
    const cz = Math.floor(z / 16);
    // `NaN` no centro vem de `setDimension` e nunca compara igual: é o que
    // força o reenfileiramento na primeira chamada depois do portal.
    if (cx === this.centerX && cz === this.centerZ && this.queuedKeys.size > 0) return;
    this.centerX = cx;
    this.centerZ = cz;
    this.enqueueRing();
    this.unloadFarChunks();
  }

  /** Enfileira toda coluna faltante dentro do render distance. */
  private enqueueRing(): void {
    const rd = this.renderDistance;
    for (let dz = -rd; dz <= rd; dz++) {
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > rd * rd + rd) continue; // círculo, não quadrado
        const cx = this.centerX + dx;
        const cz = this.centerZ + dz;
        const key = chunkKey(cx, cz);
        if (this.world.getChunk(cx, cz) !== undefined) continue;
        if (this.generating.has(key) || this.queuedKeys.has(key)) continue;
        this.queuedKeys.add(key);
        this.genQueue.push({ cx, cz, sy: -1, priority: dx * dx + dz * dz });
      }
    }
    // Mais perto primeiro. Ordenar aqui é barato: só acontece ao trocar de chunk.
    this.genQueue.sort(byPriority);
  }

  /** Descarrega o que saiu do alcance, com histerese de 2 chunks. */
  private unloadFarChunks(): void {
    const limit = (this.renderDistance + 2) * (this.renderDistance + 2);
    const doomed: ChunkColumn[] = [];
    this.world.forEachChunk((chunk) => {
      const dx = chunk.cx - this.centerX;
      const dz = chunk.cz - this.centerZ;
      if (dx * dx + dz * dz > limit) doomed.push(chunk);
    });
    for (const chunk of doomed) {
      this.world.removeChunk(chunk.cx, chunk.cz);
      this.onChunkUnloaded?.(chunk);
    }
  }

  /**
   * Progresso do anel para o overlay (doc 02 §6): quantas colunas o anel pede
   * e quantas já estão no mundo. Escreve em `out` para não alocar.
   *
   * `world.chunkCount` **não** serve aqui: ele conta também o halo de
   * histerese de 2 chunks que `unloadFarChunks` ainda não descartou, e num
   * anel de 69 colunas ele passa de 100 sem que nada esteja errado.
   *
   * Varre o anel inteiro, então só chame com o overlay aberto.
   */
  ringProgress(out: { loaded: number; total: number }): void {
    const rd = this.renderDistance;
    let loaded = 0;
    let total = 0;
    for (let dz = -rd; dz <= rd; dz++) {
      for (let dx = -rd; dx <= rd; dx++) {
        if (dx * dx + dz * dz > rd * rd + rd) continue;
        total++;
        if (this.world.getChunk(this.centerX + dx, this.centerZ + dz) !== undefined) loaded++;
      }
    }
    out.loaded = loaded;
    out.total = total;
  }

  /** Chamado quando uma coluna sai de alcance — o renderer libera os VBOs. */
  onChunkUnloaded: ((chunk: ChunkColumn) => void) | null = null;
  /** Chamado quando uma coluna nova chega do worker, antes do meshing. */
  onChunkLoaded: ((chunk: ChunkColumn) => void) | null = null;
  /**
   * Consultado **antes** de gerar: se o chunk já foi modificado alguma vez, ele
   * vem do save em vez de ser recriado da seed (doc 11 §2). Devolver `null`
   * manda gerar normalmente.
   */
  loadSaved: ((cx: number, cz: number) => Promise<ChunkColumn | null>) | null = null;

  /**
   * Despacha trabalho para os workers. Chamado uma vez por frame, antes do
   * render, e limitado por `maxInFlight` para não encher a fila de mensagens.
   */
  pump(): void {
    let busy = 0;
    for (let i = 0; i < this.inFlight.length; i++) busy += this.inFlight[i];
    const deadline = performance.now() + this.dispatchBudgetMs;

    /*
     * Meshing tem prioridade sobre geração — mas **não prioridade absoluta**.
     *
     * Tinha, e isso matava a geração de fome: as vagas são `workers * 2`, o
     * meshing é despachado primeiro, e uma coluna rende até 8 jobs de malha.
     * Com a fila cheia o meshing ocupava as quatro vagas todo frame e nada
     * novo nascia — num S24 Ultra com render distance 16, 201 colunas de 861,
     * "1046 na fila, 0 gerando, 4 meshando" no overlay (relato de campo
     * 2026-09-13). É o mesmo sintoma que em T0 se atribuiu a ter um worker só.
     *
     * Quando os dois lados têm trabalho, metade das vagas fica reservada para
     * a geração. Gerar e meshar uma coluna custam a mesma ordem de grandeza
     * (6–14 ms contra 8 × 0,6–1,5 ms), então meio a meio é o ponto em que
     * nenhum dos dois espera pelo outro. Sem fila de geração, o meshing
     * continua levando tudo.
     */
    const reserved = this.genQueue.length > 0 ? Math.max(1, this.maxInFlight >> 1) : 0;
    const meshLimit = this.maxInFlight - reserved;

    // O job que não pode ser meshado agora (falta vizinho) **não** volta para
    // `meshQueue` aqui dentro: espera em `deferredMeshes` e só retorna ao fim
    // do laço. Devolver na hora fazia o `while` reexaminar o mesmo job para
    // sempre sem nunca gastar uma vaga de `busy` — travamento total da aba,
    // não queda de FPS (bug de campo 2026-09-12, "ao sair voando o jogo
    // trava"). `scan` limita o laço a uma passada por job e garante o término
    // mesmo que alguém reintroduza o reenfileiramento lá dentro.
    const deferred = this.deferredMeshes;
    let scan = this.meshQueue.length;
    while (busy < meshLimit && scan > 0 && this.meshQueue.length > 0) {
      scan--;
      const job = this.meshQueue.shift() as PendingJob;
      const outcome = this.dispatchMesh(job);
      if (outcome === MESH_SENT) busy++;
      else if (outcome === MESH_DEFERRED) deferred.push(job);
      // Só quem foi mesmo despachado custou cópia; adiar é barato, e parar por
      // causa deles deixaria a fila parada quando a borda do anel se repete.
      if (outcome === MESH_SENT && performance.now() >= deadline) break;
    }
    for (let i = 0; i < deferred.length; i++) this.meshQueue.push(deferred[i]);
    deferred.length = 0;
    while (busy < this.maxInFlight && this.genQueue.length > 0) {
      const job = this.genQueue.shift() as PendingJob;
      this.dispatchGen(job);
      busy++;
      if (performance.now() >= deadline) break;
    }

    this.stats.queued = this.genQueue.length + this.meshQueue.length;
    this.stats.generating = this.generating.size;
    this.stats.meshing = this.meshing.size;
    this.stats.loaded = this.world.chunkCount;
  }

  private dispatchGen(job: PendingJob): void {
    const key = chunkKey(job.cx, job.cz);
    this.queuedKeys.delete(key);
    this.generating.add(key);

    if (this.loadSaved === null) {
      this.send({ type: 'gen', cx: job.cx, cz: job.cz, dim: this.dimension });
      return;
    }

    /*
     * Caminho do save: não passa pelo worker, então não entra na conta de
     * `inFlight` — quem devolve o crédito é a resposta do worker, que aqui não
     * existe.
     *
     * **A dimensão é carimbada aqui e conferida na volta**, exatamente como a
     * resposta do worker. A leitura do IndexedDB é assíncrona: atravessar o
     * portal enquanto ela está em voo fazia a coluna do outro lado entrar no
     * mundo novo — e, como ela vem do disco marcada como `modified`, ao sair de
     * alcance era gravada de volta **na dimensão errada**. Uma coluna de
     * netherrack no meio da grama, permanente (relato de campo 2026-09-13).
     */
    const dim = this.dimension;
    void this.loadSaved(job.cx, job.cz).then((saved) => {
      if (dim !== this.dimension) return;
      if (saved === null) {
        this.send({ type: 'gen', cx: job.cx, cz: job.cz, dim });
        return;
      }
      this.generating.delete(key);
      this.acceptChunk(saved);
    }).catch(() => {
      if (dim !== this.dimension) return;
      this.send({ type: 'gen', cx: job.cx, cz: job.cz, dim });
    });
  }

  /**
   * Só despacha se os 8 vizinhos existem — senão a borda sai errada.
   *
   * Nunca mexe na fila: quem decide o destino do job é o `pump`.
   */
  private dispatchMesh(job: PendingJob): number {
    // Voar rápido descarrega o que ficou para trás, e o job enfileirado pode
    // já não ter coluna nenhuma. Insistir nele seria esperar para sempre; se a
    // coluna voltar, `acceptChunk` reenfileira o meshing dela.
    if (this.world.getChunk(job.cx, job.cz) === undefined) return MESH_DROPPED;
    // Checagem barata (9 consultas) antes de tomar buffer do pool.
    if (!this.hasAllNeighbors(job.cx, job.cz)) return MESH_DEFERRED;

    const blocks = this.blockPool.pop() ?? new Uint16Array(NB_VOLUME);
    const light = this.lightPool.pop() ?? new Uint8Array(NB_VOLUME);

    if (!extractNeighborhood(this.world, job.cx, job.cz, job.sy, blocks, light)) {
      this.blockPool.push(blocks);
      this.lightPool.push(light);
      return MESH_DEFERRED;
    }

    this.meshing.add(meshKey(job.cx, job.cz, job.sy));
    this.send({ type: 'mesh', cx: job.cx, cz: job.cz, sy: job.sy, blocks, light },
      [blocks.buffer, light.buffer]);
    return MESH_SENT;
  }

  /** Round-robin pelo worker menos ocupado. */
  private send(message: WorkerRequest, transfer: Transferable[] = []): void {
    let best = 0;
    for (let i = 1; i < this.inFlight.length; i++) {
      if (this.inFlight[i] < this.inFlight[best]) best = i;
    }
    this.inFlight[best]++;
    this.pool[best].postMessage(message, transfer);
  }

  private onWorkerMessage(response: WorkerResponse): void {
    // Descobre de qual worker veio pelo contador — a contagem exata não importa,
    // só o balanceamento, então decrementa o maior.
    let best = 0;
    for (let i = 1; i < this.inFlight.length; i++) {
      if (this.inFlight[i] > this.inFlight[best]) best = i;
    }
    if (this.inFlight[best] > 0) this.inFlight[best]--;

    if (response.type === 'gen') this.onGenerated(response);
    else if (response.type === 'mesh') this.onMeshed(response);
    else this.onSpawnFound(response.x, response.z);
  }

  /** Pedidos de ponto de nascimento esperando resposta do worker. */
  private readonly spawnWaiters: ((column: [number, number]) => void)[] = [];

  /**
   * Coluna em terra firme para o jogador nascer num mundo novo
   * (`world/gen/spawnsearch.ts`). Quem sabe o terreno é o worker.
   */
  findSpawn(): Promise<[number, number]> {
    return new Promise((resolve) => {
      this.spawnWaiters.push(resolve);
      this.send({ type: 'spawn' });
    });
  }

  private onSpawnFound(x: number, z: number): void {
    this.spawnWaiters.shift()?.([x, z]);
  }

  private onGenerated(response: GenResponse): void {
    const key = chunkKey(response.cx, response.cz);
    this.generating.delete(key);
    // Chegou depois de atravessar o portal: é terreno da outra dimensão.
    if (response.dim !== this.dimension) return;
    this.stats.genMs += (response.ms - this.stats.genMs) * 0.1;

    const chunk = new ChunkColumn(response.cx, response.cz);
    for (let i = 0; i < response.sections.length; i++) {
      applySection(chunk, i, response.sections[i]);
    }
    chunk.heightMap.set(response.heightMap);
    chunk.biomeMap.set(response.biomeMap);
    this.acceptChunk(chunk);
  }

  /** Entra com a coluna no mundo, venha ela do worker ou do save. */
  private acceptChunk(chunk: ChunkColumn): void {
    // Fora de alcance enquanto carregava: descarta em vez de guardar lixo.
    const dx = chunk.cx - this.centerX;
    const dz = chunk.cz - this.centerZ;
    if (dx * dx + dz * dz > (this.renderDistance + 2) ** 2) return;

    chunk.state = ChunkState.Generated;
    this.world.addChunk(chunk);
    // Quem escuta popula o chunk com bichos (doc 07 §4) e agenda o save.
    this.onChunkLoaded?.(chunk);

    // A chegada deste chunk destrava o meshing dele e o dos 8 vizinhos.
    this.enqueueMeshAround(chunk.cx, chunk.cz);
  }

  /** Enfileira meshing da coluna e revisita as vizinhas que estavam bloqueadas. */
  private enqueueMeshAround(cx: number, cz: number): void {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        const column = this.world.getChunk(cx + dx, cz + dz);
        if (column === undefined || column.state !== ChunkState.Generated) continue;
        if (!this.hasAllNeighbors(cx + dx, cz + dz)) continue;
        column.state = ChunkState.Meshing;
        const priority = (cx + dx - this.centerX) ** 2 + (cz + dz - this.centerZ) ** 2;
        for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
          if (column.sections[sy].isEmpty && !this.sectionBordersSolid(column, sy)) continue;
          this.meshQueue.push({ cx: cx + dx, cz: cz + dz, sy, priority });
        }
      }
    }
    this.meshQueue.sort(byPriority);
  }

  /** Uma section vazia entre duas cheias ainda precisa das faces dos vizinhos. */
  private sectionBordersSolid(column: ChunkColumn, sy: number): boolean {
    const below = sy > 0 && !column.sections[sy - 1].isEmpty;
    const above = sy + 1 < SECTIONS_PER_COLUMN && !column.sections[sy + 1].isEmpty;
    return below || above;
  }

  private hasAllNeighbors(cx: number, cz: number): boolean {
    for (let dz = -1; dz <= 1; dz++) {
      for (let dx = -1; dx <= 1; dx++) {
        if (this.world.getChunk(cx + dx, cz + dz) === undefined) return false;
      }
    }
    return true;
  }

  private onMeshed(response: MeshResponse): void {
    this.meshing.delete(meshKey(response.cx, response.cz, response.sy));
    this.stats.meshMs += (response.ms - this.stats.meshMs) * 0.1;

    // Recicla os buffers de vizinhança que o worker devolveu.
    this.blockPool.push(response.blocks);
    this.lightPool.push(response.light);

    const column = this.world.getChunk(response.cx, response.cz);
    if (column === undefined) return; // descarregou enquanto meshava
    column.state = ChunkState.Ready;

    this.readyMeshes.push({
      cx: response.cx, cz: response.cz, sy: response.sy, response,
    });
  }

  /**
   * Entrega meshes prontos ao chamador dentro de um orçamento de tempo.
   * O upload de VBO é o único trabalho de GPU que roda no main thread, e o
   * doc 02 §2 dá 2 ms para ele.
   */
  drainReady(budgetMs: number, apply: (result: MeshResult) => void): number {
    if (this.readyMeshes.length === 0) return 0;
    const deadline = performance.now() + budgetMs;
    let applied = 0;
    while (this.readyMeshes.length > 0) {
      apply(this.readyMeshes.shift() as MeshResult);
      applied++;
      if (performance.now() >= deadline) break;
    }
    return applied;
  }

  /** Reenfileira sections marcadas como sujas por `world.setBlock`. */
  enqueueDirty(): void {
    if (this.world.dirtyCount === 0) return;
    const n = this.world.takeDirtySections(DIRTY_SCRATCH);
    for (let i = 0; i < n; i++) {
      const packedKey = DIRTY_SCRATCH[i];
      const sy = packedKey % SECTIONS_PER_COLUMN;
      const columnKey = (packedKey - sy) / SECTIONS_PER_COLUMN;
      const cz = signed22(columnKey % 0x400000);
      const cx = signed22((columnKey - (columnKey % 0x400000)) / 0x400000);
      if (this.world.getChunk(cx, cz) === undefined) continue;
      this.meshQueue.push({
        cx, cz, sy,
        priority: (cx - this.centerX) ** 2 + (cz - this.centerZ) ** 2,
      });
    }
  }

  dispose(): void {
    for (const worker of this.pool) worker.terminate();
    this.pool.length = 0;
  }
}

/** Cria o worker real. Fica isolado para que os testes não precisem de bundler. */
function defaultWorkerFactory(index: number): WorkerLike {
  return new Worker(new URL('../workers/chunk.worker.ts', import.meta.url), {
    type: 'module',
    name: `chunk-${index}`,
  }) as unknown as WorkerLike;
}

function byPriority(a: PendingJob, b: PendingJob): number {
  return a.priority - b.priority;
}

function meshKey(cx: number, cz: number, sy: number): number {
  return chunkKey(cx, cz) * SECTIONS_PER_COLUMN + sy;
}

/** Desfaz o empacotamento de 22 bits com sinal usado por `chunkKey`. */
function signed22(value: number): number {
  return value >= 0x200000 ? value - 0x400000 : value;
}

function applySection(chunk: ChunkColumn, index: number, data: SerializedSection): void {
  const section = chunk.sections[index];
  section.bits = data.bits;
  section.paletteLen = data.paletteLen;
  section.palette = data.palette;
  section.data = data.data;
  section.nonAirCount = data.nonAirCount;
  section.skyLight = data.skyLight;
  section.blockLight = data.blockLight;
}

const DIRTY_SCRATCH: number[] = [];
