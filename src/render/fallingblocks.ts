/**
 * Desenho dos blocos que caem (doc 03 §9).
 *
 * **Não é um passe novo.** O bloco que cai é um cubo com as camadas de atlas
 * do próprio bloco, e o passe de terreno já sabe desenhar isso: a posição no
 * vértice é local e a origem é um uniform (`setOrigin`), que aceita fração de
 * bloco. Basta uma malha de seis quads na origem e mudar a origem a cada
 * entidade.
 *
 * A luz vai **gravada no vértice**, como no terreno. Por isso a malha é por
 * (bloco, luz do céu, luz de bloco) e não só por bloco — areia caindo num poço
 * escuro não pode sair acesa como ao meio-dia. O cache é pequeno na prática:
 * um desabamento usa um ou dois blocos em poucas luzes.
 */

import { GpuMesh, MeshBuilder } from './mesh';
import { blockIdOf, defOf, texOf } from '../data/blocks';
import {
  FACE_NEG_X, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z,
} from './vertex';
import { tintIndexOf } from '../data/tints';
import type { Atlas } from './atlas';
import type { GlContext } from './gl';

/** AO cheio nos quatro cantos: o cubo solto no ar não tem vizinho que sombreie. */
const NO_AO = [3, 3, 3, 3];
/** Teto do cache. Passou disso, esvazia: é raro e reconstruir custa pouco. */
const MAX_CACHED = 64;

const FACE_TEX: readonly (readonly [number, 'top' | 'bottom' | 'side'])[] = [
  [FACE_POS_X, 'side'], [FACE_NEG_X, 'side'], [FACE_POS_Y, 'top'],
  [FACE_NEG_Y, 'bottom'], [FACE_POS_Z, 'side'], [FACE_NEG_Z, 'side'],
];

export class FallingBlockMeshes {
  private readonly ctx: GlContext;
  private readonly atlas: Atlas;
  private readonly builder: MeshBuilder;
  private readonly cache = new Map<number, GpuMesh>();

  constructor(ctx: GlContext, atlas: Atlas) {
    this.ctx = ctx;
    this.atlas = atlas;
    this.builder = new MeshBuilder(ctx.gl2 !== null, 32);
  }

  /** Malha do cubo com a origem no canto mínimo do bloco. */
  meshFor(state: number, skyLight: number, blockLight: number): GpuMesh {
    const id = blockIdOf(state);
    const key = (id << 8) | ((skyLight & 15) << 4) | (blockLight & 15);
    let mesh = this.cache.get(key);
    if (mesh !== undefined) return mesh;

    if (this.cache.size >= MAX_CACHED) this.dispose();
    const def = defOf(state);
    const tint = tintIndexOf(def);
    const b = this.builder;
    b.reset();
    for (const [face, which] of FACE_TEX) {
      b.addQuad(
        0, 0, 0, face, 1, 1, this.atlas.layerOf(texOf(def, which)),
        blockLight, skyLight, NO_AO, tint,
      );
    }
    mesh = new GpuMesh(this.ctx);
    mesh.upload(b.build());
    this.cache.set(key, mesh);
    return mesh;
  }

  dispose(): void {
    for (const mesh of this.cache.values()) mesh.dispose();
    this.cache.clear();
  }
}
