/**
 * O trabalho de um pedido de malha, fora do worker (M12).
 *
 * Fica num módulo próprio para que o worker real e os duplos dos testes rodem
 * **o mesmo código**: decodificar as sections cruas na vizinhança 18³, meshar,
 * calcular a conectividade entre faces e embrulhar a resposta.
 */

import { fillNeighborhood, NB_VOLUME } from '../world/neighborhood';
import { VisibilityScanner } from '../world/mesh/visibility';
import type { GreedyMesher } from '../world/mesh/greedy';
import type { MeshData } from '../render/mesh';
import type {
  MeshRequest, MeshResponse, SectionMeshResult, SerializedMesh,
} from './protocol';

export class MeshJobRunner {
  private readonly mesher: GreedyMesher;
  private readonly occludes: Uint8Array;
  private readonly scanner = new VisibilityScanner();
  /** Vizinhança reusada entre sections e pedidos: um par por worker. */
  private readonly blocks = new Uint16Array(NB_VOLUME);
  private readonly light = new Uint8Array(NB_VOLUME);

  constructor(mesher: GreedyMesher, occludes: Uint8Array) {
    this.mesher = mesher;
    this.occludes = occludes;
  }

  run(request: MeshRequest): MeshResponse {
    const t0 = performance.now();
    const sections: SectionMeshResult[] = [];
    let quads = 0;
    for (let sy = 0; sy < 32; sy++) {
      if ((request.mask & (1 << sy)) === 0) continue;
      fillNeighborhood(request.sections, request.syMin, request.span, sy, this.blocks, this.light);
      const result = this.mesher.mesh(this.blocks, this.light);
      quads += result.quads;
      sections.push({
        sy,
        opaque: toSerialized(result.opaque),
        cutout: toSerialized(result.cutout),
        translucent: toSerialized(result.translucent),
        visibility: this.scanner.scan(this.blocks, this.occludes),
      });
    }
    return {
      type: 'mesh', cx: request.cx, cz: request.cz,
      ...(request.dim !== undefined ? { dim: request.dim } : {}),
      sections, quads, ms: performance.now() - t0,
    };
  }
}

function toSerialized(data: MeshData | null): SerializedMesh | null {
  if (data === null) return null;
  return {
    vertices: data.vertices,
    indices: data.indices,
    vertexCount: data.vertexCount,
    indexCount: data.indexCount,
    wideIndices: data.wideIndices,
    faceStarts: data.faceStarts,
  };
}
