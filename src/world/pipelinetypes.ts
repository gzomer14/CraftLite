/**
 * Os tipos do pipeline de chunks (doc 02 §5.4): o pedido na fila, o resultado
 * de malha, as estatísticas, o worker e as opções. Saíram de `pipeline.ts` no
 * M24, que passava de 700 linhas; `pipeline.ts` os re-exporta.
 */

import type { SectionMeshResult, WorkerResponse } from '../workers/protocol';

/** Um pedido na fila, com a prioridade já calculada. */
export interface PendingJob {
  cx: number;
  cz: number;
  /**
   * Na fila de malha, as sections da coluna a meshar (bit `sy`). Um pedido por
   * coluna desde o M12; na fila de geração não é usado.
   */
  mask: number;
  priority: number;
}

/** Uma section pronta para subir para a GPU. */
export interface MeshResult {
  cx: number;
  cz: number;
  sy: number;
  section: SectionMeshResult;
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
