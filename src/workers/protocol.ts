/**
 * Protocolo entre o main thread e os workers de chunk.
 *
 * Um único tipo de worker cuida de **geração e meshing**. O doc 01 §4 desenha
 * dois workers, mas também diz que em T0 (`N=1`) os dois papéis compartilham o
 * mesmo worker — e é o T0 que manda. Um worker só evita duplicar o código de
 * ruído em dois bundles e simplifica o balanceamento da fila.
 *
 * **Toda resposta usa transferables.** Nenhuma resposta copia buffer. A única
 * mensagem que copia de propósito é o pedido de malha (M12): as sections que
 * ela leva continuam vivas e mutáveis no `World`, e transferi-las esvaziaria o
 * mundo. A cópia é o `memcpy` do `postMessage`, não um laço em JS.
 */

import type { SectionView } from '../world/neighborhood';

/** Section serializada: exatamente os campos que a paleta precisa. */
export interface SerializedSection {
  bits: 1 | 2 | 4 | 8 | 16;
  paletteLen: number;
  palette: Uint16Array;
  /** `null` = section 100% ar. */
  data: Uint8Array | Uint16Array | null;
  nonAirCount: number;
  skyLight: Uint8Array;
  blockLight: Uint8Array;
}

/** Mesh serializado de um passe. */
export interface SerializedMesh {
  vertices: ArrayBuffer;
  indices: ArrayBuffer;
  vertexCount: number;
  indexCount: number;
  wideIndices: boolean;
  /** Faixas de índice por face (`MeshData.faceStarts`), ou `null`. */
  faceStarts: Uint32Array | null;
}

export interface InitRequest {
  type: 'init';
  seed: number;
  /** true = formato de vértice comprimido (WebGL2). */
  packed: boolean;
  /**
   * Iluminação suave (AO). Vai no `init` e não na requisição: ela é assada no
   * mesh, e trocá-la exige remesar tudo — que é o que "recarrega" faz.
   */
  smoothLighting: boolean;
}

export interface GenRequest {
  type: 'gen';
  cx: number;
  cz: number;
  /**
   * Dimensão a gerar (`DIM_*` de `data/dimensions.ts`).
   *
   * Vai na **requisição**, não no `init`: o jogador troca de dimensão em jogo, e
   * recriar o pool de workers a cada portal custaria mais que um número por
   * mensagem.
   */
  dim: number;
}

/**
 * Malha de uma ou mais sections da mesma coluna (M12).
 *
 * Vai **uma mensagem por coluna**, não uma por section: é uma vaga de
 * `maxInFlight` em vez de até oito, e as sections de cima e de baixo, que as
 * vizinhas dividem, são copiadas uma vez só.
 *
 * O que vai são as sections **cruas** das 3×3 colunas em volta, e não a
 * vizinhança 18³ já montada: a thread principal só junta referências e o
 * `postMessage` as copia (cópia nativa, sem laço em JS); quem decodifica é o
 * worker (`world/neighborhood.ts`).
 */
export interface MeshRequest {
  type: 'mesh';
  cx: number;
  cz: number;
  /** Bit `sy` ligado = meshar a section `sy`. */
  mask: number;
  /** Primeira section enviada de cada coluna, e quantas. */
  syMin: number;
  span: number;
  /** `9 × span` sections: coluna `(dz+1)*3 + (dx+1)`, depois `sy − syMin`. */
  sections: SectionView[];
}

/** Onde nasce o jogador num mundo novo (`world/gen/spawnsearch.ts`). */
export interface SpawnRequest {
  type: 'spawn';
}

export type WorkerRequest = InitRequest | GenRequest | MeshRequest | SpawnRequest;

export interface GenResponse {
  type: 'gen';
  cx: number;
  cz: number;
  /** Dimensão gerada: o pipeline descarta resposta de dimensão já trocada. */
  dim: number;
  sections: SerializedSection[];
  heightMap: Uint8Array;
  biomeMap: Uint8Array;
  /** ms gastos na geração — alimenta o overlay de debug. */
  ms: number;
}

/** Resultado de uma section dentro de uma `MeshResponse`. */
export interface SectionMeshResult {
  sy: number;
  opaque: SerializedMesh | null;
  cutout: SerializedMesh | null;
  translucent: SerializedMesh | null;
  /**
   * Pares de faces que se enxergam através da section, 15 bits
   * (`world/mesh/visibility.ts`). É o que o culling por conectividade usa.
   */
  visibility: number;
}

export interface MeshResponse {
  type: 'mesh';
  cx: number;
  cz: number;
  sections: SectionMeshResult[];
  quads: number;
  ms: number;
}

export interface SpawnResponse {
  type: 'spawn';
  x: number;
  z: number;
}

export type WorkerResponse = GenResponse | MeshResponse | SpawnResponse;

/** Junta os `ArrayBuffer` de uma resposta para o `postMessage` transferir. */
export function collectTransfers(response: WorkerResponse): Transferable[] {
  const out: Transferable[] = [];
  if (response.type === 'gen') {
    for (const section of response.sections) {
      out.push(section.palette.buffer);
      if (section.data !== null) out.push(section.data.buffer);
      out.push(section.skyLight.buffer, section.blockLight.buffer);
    }
    out.push(response.heightMap.buffer, response.biomeMap.buffer);
  } else if (response.type === 'mesh') {
    for (const section of response.sections) {
      for (const mesh of [section.opaque, section.cutout, section.translucent]) {
        if (mesh !== null) out.push(mesh.vertices, mesh.indices);
      }
    }
  }
  return out;
}
