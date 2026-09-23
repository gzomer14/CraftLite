/**
 * Guarda os VBOs das sections e monta a lista de desenho por frame.
 *
 * Frustum culling é obrigatório (doc 01 §5.4) e os opacos vão front-to-back,
 * porque o early-Z ajuda muito nas GPUs tile-based dos celulares (doc 02 §5.6).
 *
 * **M12:** a lista sai do culling por conectividade (`sectioncull.ts`), que
 * já inclui o frustum, e cada malha opaca ou recortada desenha só as faixas de
 * face viradas para a câmera (`facingFaces`).
 *
 * O `ArrayBuffer` do mesh é descartado logo após o `bufferData`: ele já foi
 * transferido do worker, e manter uma cópia na CPU dobraria a memória (doc 02 §3).
 */

import { GpuMesh, type MeshData } from './mesh';
import { SECTION_SIZE, SECTIONS_PER_COLUMN } from '../world/chunk';
import { SectionCulling, facingFaces, sectionKey } from './sectioncull';
import type { GlContext } from './gl';
import type { Frustum } from '../core/math';
import type { MeshResult } from '../world/pipeline';
import type { SerializedMesh } from '../workers/protocol';

/** Uma section com geometria na GPU. */
class SectionMeshes {
  opaque: GpuMesh | null = null;
  cutout: GpuMesh | null = null;
  translucent: GpuMesh | null = null;
  /** Canto mínimo em coordenadas de mundo. */
  originX = 0;
  originY = 0;
  originZ = 0;
  vertexCount = 0;

  dispose(): void {
    this.opaque?.dispose();
    this.cutout?.dispose();
    this.translucent?.dispose();
    this.opaque = null;
    this.cutout = null;
    this.translucent = null;
  }
}

/** Uma entrada da lista de desenho. */
interface DrawItem {
  mesh: GpuMesh;
  x: number;
  y: number;
  z: number;
  distance: number;
  /** Faces viradas para a câmera (bit por `FACE_*`). */
  faces: number;
}

export class ChunkRenderer {
  private readonly ctx: GlContext;
  private readonly sections = new Map<number, SectionMeshes>();
  private readonly culling = new SectionCulling();

  /** Listas reusadas — montar a lista de desenho não pode alocar. */
  private readonly opaqueList: DrawItem[] = [];
  private readonly cutoutList: DrawItem[] = [];
  private readonly translucentList: DrawItem[] = [];
  private opaqueCount = 0;
  private cutoutCount = 0;
  private translucentCount = 0;

  /** Contadores lidos pelo overlay de debug. */
  visibleSections = 0;
  /** Sections com malha que não entraram na lista (frustum ou parede). */
  culledSections = 0;
  vertices = 0;
  gpuBytes = 0;

  constructor(ctx: GlContext) {
    this.ctx = ctx;
  }

  get sectionCount(): number {
    return this.sections.size;
  }

  /** Ajusta a grade do culling à distância de render, em colunas. */
  setRenderDistance(renderDistance: number): void {
    this.culling.setRadius(renderDistance);
  }

  /** Sobe um mesh vindo do worker. */
  apply(result: MeshResult): void {
    const key = sectionKey(result.cx, result.cz, result.sy);
    const section = result.section;
    // A conectividade vale mesmo para section sem geometria nenhuma — uma
    // section de pedra maciça não tem malha e é justamente a que tapa a vista.
    this.culling.set(
      result.cx, result.cz, result.sy, section.visibility,
      section.opaque !== null || section.cutout !== null || section.translucent !== null,
    );
    let entry = this.sections.get(key);
    if (entry === undefined) {
      entry = new SectionMeshes();
      entry.originX = result.cx * SECTION_SIZE;
      entry.originY = result.sy * SECTION_SIZE;
      entry.originZ = result.cz * SECTION_SIZE;
      this.sections.set(key, entry);
    }

    entry.vertexCount = 0;
    entry.opaque = this.upload(entry.opaque, section.opaque, entry);
    entry.cutout = this.upload(entry.cutout, section.cutout, entry);
    entry.translucent = this.upload(entry.translucent, section.translucent, entry);

    // Section ficou sem geometria nenhuma: solta o slot.
    if (entry.opaque === null && entry.cutout === null && entry.translucent === null) {
      this.sections.delete(key);
    }
  }

  private upload(
    existing: GpuMesh | null, data: SerializedMesh | null, entry: SectionMeshes,
  ): GpuMesh | null {
    if (data === null) {
      existing?.dispose();
      return null;
    }
    const mesh = existing ?? new GpuMesh(this.ctx);
    const meshData: MeshData = {
      vertices: data.vertices,
      indices: data.indices,
      vertexCount: data.vertexCount,
      indexCount: data.indexCount,
      wideIndices: data.wideIndices,
      packed: this.ctx.gl2 !== null,
      faceStarts: data.faceStarts,
    };
    mesh.upload(meshData);
    entry.vertexCount += data.vertexCount;
    // `meshData` sai de escopo aqui; os ArrayBuffer viram lixo coletável, que é
    // exatamente o que queremos — a cópia que importa está na GPU.
    return mesh;
  }

  /** Libera todas as sections de uma coluna descarregada. */
  releaseColumn(cx: number, cz: number): void {
    this.culling.releaseColumn(cx, cz);
    for (let sy = 0; sy < SECTIONS_PER_COLUMN; sy++) {
      const key = sectionKey(cx, cz, sy);
      const entry = this.sections.get(key);
      if (entry === undefined) continue;
      entry.dispose();
      this.sections.delete(key);
    }
  }

  /**
   * Solta **toda** a geometria da GPU (M7: troca de dimensão).
   *
   * `releaseColumn` por coluna deixaria para trás o que o pipeline já tinha
   * esquecido — e uma malha do Overworld pendurada no Nether é memória de vídeo
   * perdida até o jogo fechar.
   */
  clear(): void {
    for (const entry of this.sections.values()) entry.dispose();
    this.sections.clear();
    this.culling.clear();
  }

  /**
   * Monta as três listas de desenho: culling por conectividade (que inclui o
   * frustum) e, por section, as faces viradas para a câmera.
   * Opacos ficam front-to-back; translúcidos, back-to-front.
   */
  buildDrawLists(frustum: Frustum, camX: number, camY: number, camZ: number): void {
    this.opaqueCount = 0;
    this.cutoutCount = 0;
    this.translucentCount = 0;
    this.visibleSections = 0;
    this.vertices = 0;

    const culling = this.culling;
    culling.run(frustum, camX, camY, camZ);
    if (!culling.culled) {
      // Câmera abaixo do mundo: sem ponto de partida, só o frustum.
      for (const entry of this.sections.values()) {
        const x0 = entry.originX;
        const y0 = entry.originY;
        const z0 = entry.originZ;
        if (!frustum.intersectsAabb(x0, y0, z0, x0 + SECTION_SIZE, y0 + SECTION_SIZE, z0 + SECTION_SIZE)) continue;
        this.list(entry, camX, camY, camZ);
      }
    } else {
      const keys = culling.visibleKeys;
      for (let i = 0; i < culling.visibleCount; i++) {
        const entry = this.sections.get(keys[i]);
        if (entry !== undefined) this.list(entry, camX, camY, camZ);
      }
    }
    this.culledSections = this.sections.size - this.visibleSections;

    sortRange(this.opaqueList, this.opaqueCount, true);
    sortRange(this.cutoutList, this.cutoutCount, true);
    sortRange(this.translucentList, this.translucentCount, false);
  }

  /** Põe uma section visível nas listas dos passes que ela tem. */
  private list(entry: SectionMeshes, camX: number, camY: number, camZ: number): void {
    this.visibleSections++;
    this.vertices += entry.vertexCount;
    const x0 = entry.originX;
    const y0 = entry.originY;
    const z0 = entry.originZ;
    const cx = x0 + 8 - camX;
    const cy = y0 + 8 - camY;
    const cz = z0 + 8 - camZ;
    const distance = cx * cx + cy * cy + cz * cz;
    const faces = facingFaces(x0, y0, z0, camX, camY, camZ);

    if (entry.opaque !== null) {
      this.opaqueCount = push(this.opaqueList, this.opaqueCount, entry.opaque, x0, y0, z0, distance, faces);
    }
    if (entry.cutout !== null) {
      this.cutoutCount = push(this.cutoutList, this.cutoutCount, entry.cutout, x0, y0, z0, distance, faces);
    }
    if (entry.translucent !== null) {
      this.translucentCount = push(
        this.translucentList, this.translucentCount, entry.translucent, x0, y0, z0, distance, 0x3f,
      );
    }
  }

  /** Desenha uma lista, chamando `setOrigin` antes de cada section. */
  draw(
    which: 'opaque' | 'cutout' | 'translucent',
    setOrigin: (x: number, y: number, z: number) => void,
  ): number {
    const list = which === 'opaque' ? this.opaqueList
      : which === 'cutout' ? this.cutoutList : this.translucentList;
    const count = which === 'opaque' ? this.opaqueCount
      : which === 'cutout' ? this.cutoutCount : this.translucentCount;

    let calls = 0;
    for (let i = 0; i < count; i++) {
      const item = list[i];
      setOrigin(item.x, item.y, item.z);
      calls += item.mesh.drawFaces(item.faces);
    }
    return calls;
  }

  dispose(): void {
    for (const entry of this.sections.values()) entry.dispose();
    this.sections.clear();
  }
}

/** Insere na lista reusada, crescendo só quando precisa. */
function push(
  list: DrawItem[], count: number, mesh: GpuMesh,
  x: number, y: number, z: number, distance: number, faces: number,
): number {
  let item = list[count];
  if (item === undefined) {
    item = { mesh, x, y, z, distance, faces };
    list.push(item);
  } else {
    item.mesh = mesh;
    item.x = x;
    item.y = y;
    item.z = z;
    item.distance = distance;
    item.faces = faces;
  }
  return count + 1;
}

/**
 * Ordena só o prefixo válido da lista. Insertion sort é o certo aqui: a lista
 * chega quase ordenada de um frame para o outro (a câmera se move pouco), e
 * `Array.prototype.sort` sobre a lista inteira alocaria.
 */
function sortRange(list: DrawItem[], count: number, ascending: boolean): void {
  for (let i = 1; i < count; i++) {
    const item = list[i];
    const key = item.distance;
    let j = i - 1;
    while (j >= 0 && (ascending ? list[j].distance > key : list[j].distance < key)) {
      list[j + 1] = list[j];
      j--;
    }
    list[j + 1] = item;
  }
}

