/**
 * Protocolo entre o main thread e os workers de chunk.
 *
 * Um único tipo de worker cuida de **geração e meshing**. O doc 01 §4 desenha
 * dois workers, mas também diz que em T0 (`N=1`) os dois papéis compartilham o
 * mesmo worker — e é o T0 que manda. Um worker só evita duplicar o código de
 * ruído em dois bundles e simplifica o balanceamento da fila.
 *
 * **Toda transferência usa transferables.** Nenhuma mensagem copia buffer.
 */

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

export interface MeshRequest {
  type: 'mesh';
  cx: number;
  cz: number;
  sy: number;
  /** Vizinhança 18³ de blockStates. */
  blocks: Uint16Array;
  /** Vizinhança 18³ de luz: nibble baixo = bloco, alto = céu. */
  light: Uint8Array;
}

export type WorkerRequest = InitRequest | GenRequest | MeshRequest;

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

export interface MeshResponse {
  type: 'mesh';
  cx: number;
  cz: number;
  sy: number;
  opaque: SerializedMesh | null;
  cutout: SerializedMesh | null;
  translucent: SerializedMesh | null;
  quads: number;
  ms: number;
  /** Buffers devolvidos para reciclagem (buffer ring do doc 02 §5.5). */
  blocks: Uint16Array;
  light: Uint8Array;
}

export type WorkerResponse = GenResponse | MeshResponse;

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
  } else {
    for (const mesh of [response.opaque, response.cutout, response.translucent]) {
      if (mesh !== null) out.push(mesh.vertices, mesh.indices);
    }
    out.push(response.blocks.buffer, response.light.buffer);
  }
  return out;
}
