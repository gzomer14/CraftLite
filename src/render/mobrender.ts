/**
 * Desenha mobs, flechas e sombras (doc 07 §5).
 *
 * **Desvio consciente do doc:** ele pede instancing com as rotações das partes
 * empacotadas por instância. Aqui as matrizes das partes são aplicadas na CPU e
 * todos os mobs vão para **um único** buffer dinâmico — uma draw call para a
 * cena inteira, não uma por tipo de mob.
 *
 * O motivo é aritmética: 20 mobs × 12 caixas × 24 vértices = 5760 vértices por
 * frame, ~200 KB de upload. Isso é menos que uma section de terreno. Em troca,
 * o shader fica trivial (nenhum atributo por instância, nenhum limite de 16
 * slots) e o WebGL1 antigo não precisa da extensão de instancing para ver mobs.
 *
 * Nada aqui aloca: os vértices vão para um `Float32Array` pré-alocado e o índice
 * é montado uma vez, no construtor.
 */

import { FACE_ORDER, faceRect, type ModelDef, type PartDef } from '../data/mobmodels';
import { createProgram, uniformLocations, type GlContext } from './gl';
import { SKIN_SIZE } from './entityatlas';
import {
  ENTITY_FS_100, ENTITY_FS_300, ENTITY_VS_100, ENTITY_VS_300,
} from './shaders/entity.glsl';
import { withDefines } from './shaders/terrain.glsl';
import type { EntityAtlas } from './entityatlas';
import type { Mat4 } from '../core/math';
import type { SkyParams } from './terrain';

const UNIFORMS = [
  'uViewProj', 'uMinSkyLight', 'uAtlas', 'uAtlasTiles',
  'uFogColor', 'uFogDensity', 'uOpacity', 'uMediumTint',
] as const;

/** Floats por vértice: posição (3) + uv/camada (3) + sombra/luz/flash (3). */
const STRIDE = 9;
/** Vértices e índices por caixa. */
const VERTS_PER_BOX = 24;
const INDICES_PER_BOX = 36;
/** Unidades do modelo por bloco. */
const UNIT = 1 / 16;
/** Sombreado fixo por face — dá volume sem custar luz de verdade. */
const FACE_SHADE = [1.0, 0.55, 0.82, 0.95, 0.82, 0.88];
/** Limites da rotação da cabeça (doc 07 §5). */
const HEAD_YAW_LIMIT = 75 * Math.PI / 180;
const HEAD_PITCH_LIMIT = 40 * Math.PI / 180;
/** Frequência do balanço das pernas (doc 07 §5). */
const SWING_RATE = 0.6662;
/** Tremor dos braços travados do zumbi. */
const STIFF_TREMOR = 0.05;

/** Vértices de cada face da caixa unitária, em ordem CCW vista de fora. */
const FACE_CORNERS: readonly number[][] = [
  // topo (+Y)
  [0, 1, 0, 0, 1, 1, 1, 1, 1, 1, 1, 0],
  // baixo (−Y)
  [0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1],
  // leste (+X)
  [1, 0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 1],
  // frente (+Z)
  [1, 0, 1, 1, 1, 1, 0, 1, 1, 0, 0, 1],
  // oeste (−X)
  [0, 0, 1, 0, 1, 1, 0, 1, 0, 0, 0, 0],
  // trás (−Z)
  [0, 0, 0, 0, 1, 0, 1, 1, 0, 1, 0, 0],
];

/** UV de cada vértice da face, na mesma ordem de `FACE_CORNERS`. */
const FACE_UVS: readonly number[] = [0, 1, 0, 0, 1, 0, 1, 1];

/** Caixa achatada da sombra, reusada e mutada a cada mob. */
const SHADOW_BOX: number[] = [0, 0, 0, 0, 0.05, 0];
const SHADOW_PART = {
  name: 'shadow', pivot: [0, 0, 0], box: SHADOW_BOX, uv: [0, 0],
} as unknown as PartDef;

export class MobRenderer {
  private readonly ctx: GlContext;
  private readonly atlas: EntityAtlas;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly vbo: WebGLBuffer;
  private readonly ibo: WebGLBuffer;
  private readonly data: Float32Array;
  private readonly maxBoxes: number;

  /** Caixas escritas neste frame, e quantas delas são sombra. */
  private boxes = 0;
  private shadowStart = 0;
  private shadowBoxes = 0;

  /** Estado do mob sendo montado, para não recalcular por parte. */
  private readonly rect = new Float32Array(4);

  constructor(ctx: GlContext, atlas: EntityAtlas, maxBoxes = 512) {
    this.ctx = ctx;
    this.atlas = atlas;
    this.maxBoxes = maxBoxes;
    this.data = new Float32Array(maxBoxes * VERTS_PER_BOX * STRIDE);

    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;
    const vs = use300 ? ENTITY_VS_300 : ENTITY_VS_100;
    const fs = use300 ? ENTITY_FS_300 : ENTITY_FS_100;
    this.program = createProgram(gl, vs, withDefines(fs, ['ALPHA_TEST']), 'entities');
    this.uniforms = uniformLocations(gl, this.program, UNIFORMS);

    const vbo = gl.createBuffer();
    const ibo = gl.createBuffer();
    if (vbo === null || ibo === null) throw new Error('Falha ao criar buffers de entidade.');
    this.vbo = vbo;
    this.ibo = ibo;

    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, ibo);
    gl.bufferData(gl.ELEMENT_ARRAY_BUFFER, buildIndices(maxBoxes), gl.STATIC_DRAW);
  }

  begin(): void {
    this.boxes = 0;
    this.shadowStart = 0;
    this.shadowBoxes = 0;
  }

  get pending(): number {
    return this.boxes;
  }

  /**
   * Acrescenta um modelo animado.
   *
   * `light` é o nível 0..15 já resolvido (uma amostra por mob), `flash` a
   * piscada de dano 0..1, e `squash` o achatamento vertical do slime.
   */
  addModel(
    model: ModelDef, layer: number,
    x: number, y: number, z: number,
    bodyYaw: number, bodyPitch: number,
    headYaw: number, headPitch: number,
    limbSwing: number, limbAmount: number, age: number,
    light: number, flash: number, scale: number, squash: number,
  ): void {
    const parts = model.parts;
    if (this.boxes + parts.length > this.maxBoxes) return;

    // Achatamento preserva volume: o que perde em altura ganha em largura.
    const scaleY = scale * (1 + squash);
    const scaleXZ = scale * (1 - squash * 0.5);
    const cosBody = Math.cos(bodyYaw);
    const sinBody = Math.sin(bodyYaw);
    const cosPitch = Math.cos(bodyPitch);
    const sinPitch = Math.sin(bodyPitch);

    // Relativo ao corpo, com os limites do doc 07 §5.
    const relYaw = clampAngle(normalizeAngle(headYaw - bodyYaw), HEAD_YAW_LIMIT);
    const relPitch = clampAngle(headPitch, HEAD_PITCH_LIMIT);

    for (let p = 0; p < parts.length; p++) {
      const part = parts[p];
      let rx = 0;
      let ry = 0;
      let rz = 0;
      if (part.rot !== undefined) { rx = part.rot[0]; ry = part.rot[1]; rz = part.rot[2]; }

      const amp = part.amp ?? 0;
      const phase = part.phase ?? 0;
      switch (part.anim) {
        case 'head':
          rx += relPitch;
          ry += relYaw;
          break;
        case 'swing': {
          const value = Math.cos(limbSwing * SWING_RATE + phase) * amp * limbAmount;
          if (part.axis === 1) ry += value;
          else if (part.axis === 2) rz += value;
          else rx += value;
          break;
        }
        case 'flap': {
          const value = Math.sin(age * 0.3 + phase) * amp;
          if (part.axis === 1) ry += value;
          else if (part.axis === 2) rz += value;
          else rx += value;
          break;
        }
        case 'stiff':
          rx += Math.sin(age * 0.09) * STIFF_TREMOR;
          break;
        default:
          break;
      }

      this.emitBox(
        part, layer, model.skinSize,
        x, y, z, cosBody, sinBody, cosPitch, sinPitch,
        scaleXZ, scaleY, rx, ry, rz, light, flash,
      );
    }
  }

  /**
   * Sombra: um quad escuro achatado no chão (doc 07 §5).
   *
   * Precisa ser chamada **depois de todos os modelos** do frame: as sombras são
   * desenhadas com blending numa segunda chamada, e para isso ficam no fim do
   * buffer.
   */
  addShadow(x: number, y: number, z: number, radius: number, light: number): void {
    if (this.boxes >= this.maxBoxes) return;
    // A sombra é desenhada depois de tudo, com blending: fica no fim do buffer.
    if (this.shadowBoxes === 0) this.shadowStart = this.boxes;
    this.shadowBoxes++;

    // A caixa da sombra é mutada no lugar: um objeto novo por mob por frame
    // seria lixo garantido no caminho quente.
    const size = radius * 16;
    SHADOW_BOX[0] = -size / 2;
    SHADOW_BOX[2] = -size / 2;
    SHADOW_BOX[3] = size;
    SHADOW_BOX[5] = size;
    this.emitBox(
      SHADOW_PART, this.atlas.layerOf('shadow'), SKIN_SIZE,
      x, y + 0.02, z, 1, 0, 1, 0, 1, 1, 0, 0, 0, light, 0,
    );
  }

  /** Escreve as 6 faces de uma caixa já transformada. */
  private emitBox(
    part: PartDef, layer: number, skinSize: number,
    ox: number, oy: number, oz: number,
    cosBody: number, sinBody: number, cosPitch: number, sinPitch: number,
    scaleXZ: number, scaleY: number,
    rx: number, ry: number, rz: number,
    light: number, flash: number,
  ): void {
    const data = this.data;
    const x0 = part.box[0];
    const y0 = part.box[1];
    const z0 = part.box[2];
    const sx = part.box[3];
    const sy = part.box[4];
    const sz = part.box[5];
    const px = part.pivot[0];
    const py = part.pivot[1];
    const pz = part.pivot[2];

    const cx = Math.cos(rx); const snx = Math.sin(rx);
    const cy = Math.cos(ry); const sny = Math.sin(ry);
    const cz = Math.cos(rz); const snz = Math.sin(rz);

    let offset = this.boxes * VERTS_PER_BOX * STRIDE;
    this.boxes++;

    for (let f = 0; f < 6; f++) {
      faceRect(part, FACE_ORDER[f], this.rect);
      const u0 = (part.mirror === true ? this.rect[0] + this.rect[2] : this.rect[0]) / skinSize;
      const u1 = (part.mirror === true ? this.rect[0] : this.rect[0] + this.rect[2]) / skinSize;
      const v0 = this.rect[1] / skinSize;
      const v1 = (this.rect[1] + this.rect[3]) / skinSize;
      const shade = FACE_SHADE[f];
      const corners = FACE_CORNERS[f];

      for (let c = 0; c < 4; c++) {
        // Canto da caixa, em unidades do modelo, relativo ao pivô.
        let vx = x0 + corners[c * 3] * sx;
        let vy = y0 + corners[c * 3 + 1] * sy;
        let vz = z0 + corners[c * 3 + 2] * sz;

        // Rotação da parte: Z, depois X, depois Y (a ordem que faz a cabeça
        // olhar para o lado certo depois de inclinar).
        let tx = vx * cz - vy * snz;
        let ty = vx * snz + vy * cz;
        vx = tx; vy = ty;
        ty = vy * cx - vz * snx;
        let tz = vy * snx + vz * cx;
        vy = ty; vz = tz;
        tx = vx * cy + vz * sny;
        tz = -vx * sny + vz * cy;
        vx = tx; vz = tz;

        // Volta para o espaço do modelo e converte para blocos.
        vx = (vx + px) * UNIT * scaleXZ;
        vy = (vy + py) * UNIT * scaleY;
        vz = (vz + pz) * UNIT * scaleXZ;

        // Inclinação do corpo inteiro (flecha), depois o yaw do corpo.
        ty = vy * cosPitch - vz * sinPitch;
        tz = vy * sinPitch + vz * cosPitch;
        vy = ty; vz = tz;
        tx = vx * cosBody + vz * sinBody;
        tz = -vx * sinBody + vz * cosBody;

        data[offset] = ox + tx;
        data[offset + 1] = oy + vy;
        data[offset + 2] = oz + tz;
        data[offset + 3] = FACE_UVS[c * 2] === 0 ? u0 : u1;
        data[offset + 4] = FACE_UVS[c * 2 + 1] === 0 ? v0 : v1;
        data[offset + 5] = layer;
        data[offset + 6] = shade;
        data[offset + 7] = light;
        data[offset + 8] = flash;
        offset += STRIDE;
      }
    }
  }

  /** Desenha o batch. Devolve o número de draw calls. */
  render(viewProj: Mat4, sky: SkyParams): number {
    if (this.boxes === 0) return 0;
    const gl = this.ctx.gl;

    gl.useProgram(this.program);
    this.atlas.bind(0);
    gl.uniform1i(this.uniforms.uAtlas, 0);
    if (!this.atlas.isArray) {
      gl.uniform2f(
        this.uniforms.uAtlasTiles, this.atlas.tilesPerRow, 1 / this.atlas.tilesPerRow,
      );
    }
    gl.uniformMatrix4fv(this.uniforms.uViewProj, false, viewProj);
    gl.uniform1f(this.uniforms.uMinSkyLight, sky.minSkyLight);
    gl.uniform3fv(this.uniforms.uFogColor, sky.fogColor);
    gl.uniform1f(this.uniforms.uFogDensity, sky.fogDensity);
    gl.uniform3fv(this.uniforms.uMediumTint, sky.tint);
    gl.uniform1f(this.uniforms.uOpacity, 1);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.vbo);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.boxes * VERTS_PER_BOX * STRIDE));
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, this.ibo);

    const bytes = STRIDE * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, bytes, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 3, gl.FLOAT, false, bytes, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 3, gl.FLOAT, false, bytes, 24);

    let calls = 0;
    const solidBoxes = this.shadowBoxes > 0 ? this.shadowStart : this.boxes;
    if (solidBoxes > 0) {
      gl.drawElements(gl.TRIANGLES, solidBoxes * INDICES_PER_BOX, gl.UNSIGNED_SHORT, 0);
      calls++;
    }

    // Sombras por último, com blending e sem escrever profundidade.
    if (this.shadowBoxes > 0) {
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
      gl.depthMask(false);
      gl.uniform1f(this.uniforms.uOpacity, 0.55);
      gl.drawElements(
        gl.TRIANGLES, this.shadowBoxes * INDICES_PER_BOX, gl.UNSIGNED_SHORT,
        this.shadowStart * INDICES_PER_BOX * 2,
      );
      gl.depthMask(true);
      gl.disable(gl.BLEND);
      calls++;
    }

    gl.disableVertexAttribArray(2);
    gl.disableVertexAttribArray(1);
    gl.disableVertexAttribArray(0);
    return calls;
  }

  dispose(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.vbo);
    gl.deleteBuffer(this.ibo);
    gl.deleteProgram(this.program);
  }
}

/** Índices de todas as caixas possíveis, montados uma vez. */
function buildIndices(maxBoxes: number): Uint16Array {
  const quads = maxBoxes * 6;
  const out = new Uint16Array(quads * 6);
  for (let q = 0; q < quads; q++) {
    const v = q * 4;
    const o = q * 6;
    out[o] = v; out[o + 1] = v + 1; out[o + 2] = v + 2;
    out[o + 3] = v; out[o + 4] = v + 2; out[o + 5] = v + 3;
  }
  return out;
}

function normalizeAngle(angle: number): number {
  let a = angle;
  while (a > Math.PI) a -= Math.PI * 2;
  while (a < -Math.PI) a += Math.PI * 2;
  return a;
}

function clampAngle(angle: number, limit: number): number {
  return angle > limit ? limit : angle < -limit ? -limit : angle;
}
