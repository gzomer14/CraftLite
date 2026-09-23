/**
 * Item na mão em primeira pessoa (doc 01 §1 e §191).
 *
 * O doc pede "viewport separado com FOV menor, depth cleared", e é literalmente
 * isso: a mão é desenhada depois de todo o resto, com o buffer de profundidade
 * limpo, numa projeção própria de FOV menor. Sem limpar a profundidade, encostar
 * numa parede enfiaria metade do braço dentro dela; com FOV próprio, a mão não
 * estica quando o jogador aumenta o campo de visão do mundo.
 *
 * **Três formas, um programa só** (`uMode`):
 *
 *  - **bloco** — cubo de 36 vértices tirado do atlas de blocos, uma camada por
 *    face. É a forma que o jogador reconhece: segurar terra tem que parecer
 *    segurar um cubo de terra.
 *  - **item** — a folha de sprites **extrudada** (`itemmodel.ts`): frente,
 *    verso e uma borda por aresta da silhueta. Era um quad chapado até
 *    2026-09-16, e chapado é o que o jogador via — uma espada de espessura zero
 *    que desaparecia de perfil. O desenho é o mesmo do inventário; o que mudou
 *    é que ele tem lado.
 *  - **mão vazia** — caixa em tom de pele, sem textura. Não há skin de jogador
 *    no projeto (doc 13 não prevê nenhuma), e inventar uma só para isto custaria
 *    uma camada de atlas por nada.
 *
 * **Uma draw call**, sempre, e a geometria só é reconstruída quando o item da
 * mão muda — trocar de slot é raro, e o caminho de render não aloca nada.
 */

import { dyeRgbOf } from '../data/tints';
import {
  createMat4, identity, multiply, perspective, rotateX, rotateY, scaleMat, translate, type Mat4,
} from '../core/math';
import { defOf, makeState, texOf, AIR } from '../data/blocks';
import { itemDef } from '../data/items';
import {
  ITEM_FLOATS_PER_VERTEX, buildExtrudedSprite, extrudedVertexCapacity, maskFromSheet,
} from './itemmodel';
import { createProgram, uniformLocations, type GlContext } from './gl';
import type { Atlas } from './atlas';
import { isUprightFace } from './mesh';
import type { ItemSheet } from './itemsprites';

/** FOV da mão, menor que o do mundo (doc 01 §191). Exportado para o teste
 * poder conferir que a pose cai dentro do frustum. */
export const HAND_FOV = 55 * (Math.PI / 180);
/** Ticks que um balanço completo leva. */
export const SWING_TICKS = 6;

/**
 * Estado da animação da mão — golpe e balanço de caminhada.
 *
 * Fica fora do `HandRenderer` porque é aritmética pura: assim dá para testar
 * sem GL, e o que precisava de teste é justamente a regra abaixo.
 *
 * **`tick()` tem que ser chamado todo tick de simulação, sem exceção**, mesmo
 * com uma tela de contêiner aberta e mesmo parado. Ele é quem iguala
 * `previous` a `current`; parar de chamá-lo congela os dois em valores
 * diferentes, e aí `swingAt(alpha)` varre o golpe inteiro a cada frame, para
 * sempre. Era o que acontecia ao abrir a bancada com a mão vazia: a guarda de
 * "tela aberta" saía do tick antes da mão, e ela vibrava para frente e para
 * trás até fechar a tela (relato de campo 2026-09-12).
 */
export class HandAnimation {
  private swingTicks = 0;
  private prevSwingTicks = 0;
  private bob = 0;
  private prevBob = 0;

  /** Dispara o balanço. Um golpe em curso não é reiniciado. */
  swing(): void {
    if (this.swingTicks <= 0) this.swingTicks = SWING_TICKS;
  }

  /** true quando a mão está parada — a pose não depende mais de `alpha`. */
  get settled(): boolean {
    return this.swingTicks === 0 && this.prevSwingTicks === 0;
  }

  /** `speed` é o deslocamento horizontal do jogador no tick. */
  tick(speed: number): void {
    this.prevSwingTicks = this.swingTicks;
    this.prevBob = this.bob;
    if (this.swingTicks > 0) this.swingTicks--;
    this.bob += Math.min(speed, 0.4) * 1.6;
    if (this.bob > Math.PI * 2) {
      this.bob -= Math.PI * 2;
      this.prevBob -= Math.PI * 2;
    }
  }

  /** Fase do golpe em 0..1, interpolada para o frame. */
  swingAt(alpha: number): number {
    return lerpTicks(this.prevSwingTicks, this.swingTicks, alpha) / SWING_TICKS;
  }

  /** Fase do balanço de caminhada, em radianos. */
  bobAt(alpha: number): number {
    return lerpTicks(this.prevBob, this.bob, alpha);
  }
}
/** Tom de pele da mão vazia. */
const SKIN = [0.85, 0.66, 0.52] as const;

/** 7 floats por vértice: posição, uv, camada e sombra de face. */
const FLOATS_PER_VERTEX = ITEM_FLOATS_PER_VERTEX;

const UNIFORMS = [
  'uProj', 'uModel', 'uAtlas', 'uSprites', 'uAtlasTiles', 'uSheet', 'uMode', 'uColor',
] as const;

const VS_300 = `#version 300 es
precision highp float;
layout(location = 0) in vec3 aPos;
layout(location = 1) in vec2 aUv;
layout(location = 2) in float aLayer;
layout(location = 3) in float aShade;
uniform mat4 uProj;
uniform mat4 uModel;
out vec2 vUv;
out float vLayer;
out float vShade;
void main() {
  vUv = aUv;
  vLayer = aLayer;
  vShade = aShade;
  gl_Position = uProj * uModel * vec4(aPos, 1.0);
}
`;

const FS_300 = `#version 300 es
precision mediump float;
precision mediump sampler2DArray;
in vec2 vUv;
in float vLayer;
in float vShade;
uniform sampler2DArray uAtlas;
uniform sampler2D uSprites;
uniform vec2 uSheet;
uniform float uMode;      // 0 = bloco, 1 = item, 2 = mão vazia
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  vec4 texel;
  if (uMode < 0.5) {
    texel = texture(uAtlas, vec3(vUv, vLayer));
  } else if (uMode < 1.5) {
    vec2 cell = vec2(mod(vLayer, uSheet.x), floor(vLayer / uSheet.x));
    texel = texture(uSprites, (cell + vec2(vUv.x, 1.0 - vUv.y)) / uSheet);
  } else {
    texel = uColor;
  }
  if (texel.a < 0.5) discard;
  fragColor = vec4(texel.rgb * vShade * uColor.rgb, 1.0);
}
`;

const VS_100 = `
precision highp float;
attribute vec3 aPos;
attribute vec2 aUv;
attribute float aLayer;
attribute float aShade;
uniform mat4 uProj;
uniform mat4 uModel;
varying vec2 vUv;
varying float vLayer;
varying float vShade;
void main() {
  vUv = aUv;
  vLayer = aLayer;
  vShade = aShade;
  gl_Position = uProj * uModel * vec4(aPos, 1.0);
}
`;

const FS_100 = `
precision mediump float;
varying vec2 vUv;
varying float vLayer;
varying float vShade;
uniform sampler2D uAtlas;
uniform sampler2D uSprites;
uniform vec2 uAtlasTiles;   // colunas, 1/colunas
uniform vec2 uSheet;
uniform float uMode;
uniform vec4 uColor;
void main() {
  vec4 texel;
  if (uMode < 0.5) {
    vec2 tile = vec2(mod(vLayer, uAtlasTiles.x), floor(vLayer * uAtlasTiles.y));
    texel = texture2D(uAtlas, (tile + clamp(vUv, 0.002, 0.998)) * uAtlasTiles.y);
  } else if (uMode < 1.5) {
    vec2 cell = vec2(mod(vLayer, uSheet.x), floor(vLayer / uSheet.x));
    texel = texture2D(uSprites, (cell + vec2(vUv.x, 1.0 - vUv.y)) / uSheet);
  } else {
    texel = uColor;
  }
  if (texel.a < 0.5) discard;
  gl_FragColor = vec4(texel.rgb * vShade * uColor.rgb, 1.0);
}
`;

/**
 * Pose da mão, em espaço de view (a câmera é a origem, olhando para −Z).
 *
 * Os números saíram de olhar a tela: a mão fica no canto inferior direito, um
 * pouco à frente do near plane, inclinada para dentro. `swing` a puxa para
 * baixo e a gira, que é o gesto de bater.
 */
export interface HandPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  scale: number;
}

/**
 * Pose para um instante do balanço e do passo.
 *
 * `swing` 0..1 é o golpe, `bob` a fase do caminhar em radianos e `aspect` a
 * proporção da tela. Separado do resto porque é pura matemática — dá para
 * testar sem GL, e foi o que pegou a primeira versão desenhando a mão **fora
 * do frustum**.
 *
 * A posição é **ancorada nas bordas da projeção**, não em números fixos: a
 * meia-altura visível na distância `z` é `tan(fov/2)·|z|`, e a meia-largura é
 * essa altura vezes o aspecto. Com coordenadas fixas a mão que fica no canto
 * de um celular em paisagem sai da tela num monitor 21:9, e some de vez em
 * retrato.
 */
export function handPose(swing: number, bob: number, aspect: number, out: HandPose): HandPose {
  // Meia senoide: sai da posição de descanso, vai ao extremo e volta.
  const arc = Math.sin(swing * Math.PI);
  const z = -0.78 + arc * 0.06;
  const halfHeight = Math.tan(HAND_FOV / 2) * Math.abs(z);
  const halfWidth = halfHeight * aspect;

  out.z = z;
  // 0.70 da borda direita e 0.74 da inferior: o item fica no canto, longe da
  // mira, e com a base cortada pela borda como se saísse de baixo da tela.
  out.x = halfWidth * 0.70 - arc * halfWidth * 0.10 + Math.cos(bob) * halfWidth * 0.02;
  // O descanso em 0.62 deixa espaço para o golpe descer 0.30 sem que o centro
  // da mão saia por baixo da tela — junto, 0.92 da meia-altura.
  out.y = -halfHeight * 0.62 - arc * halfHeight * 0.30
    + Math.abs(Math.sin(bob)) * halfHeight * 0.04;
  out.yaw = 0.62 - arc * 0.5;
  out.pitch = 0.18 + arc * 1.1;
  // A escala segue a altura visível, senão a mão encolhe em tela estreita.
  // 0.5 dá um item com cerca de um quarto da altura da tela.
  out.scale = halfHeight * 0.5;
  return out;
}

export class HandRenderer {
  private readonly ctx: GlContext;
  private readonly atlas: Atlas;
  private readonly sheet: ItemSheet;
  private readonly program: WebGLProgram;
  private readonly uniforms: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly buffer: WebGLBuffer;
  private readonly sprites: WebGLTexture;
  private readonly data: Float32Array;
  private readonly proj: Mat4 = createMat4();
  private readonly model: Mat4 = createMat4();
  private readonly scratch: Mat4 = createMat4();
  private readonly pose: HandPose = { x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: 1 };

  /** Item desenhado agora; `-1` é mão vazia. */
  private held = -2;
  /** Tile do item na mão, para reconstruir quando só o quadro muda (M10). */
  private heldTile = -2;
  /** Tile atual de um item — a folha de `ItemSprites`, com o quadro do mostrador. */
  tileOf: ((item: number) => number | undefined) | null = null;
  private mode = 2;
  /** Tint do bloco na mão (lã colorida); branco para o resto. */
  private readonly tint = new Float32Array([1, 1, 1]);
  private vertexCount = 0;
  private lastAspect = 0;

  /** Golpe e balanço de caminhada. Ver `HandAnimation`. */
  private readonly animation = new HandAnimation();

  /** Desligada pelo preset do tier ou pela opção do jogador. */
  enabled = true;

  constructor(ctx: GlContext, atlas: Atlas, sheet: ItemSheet) {
    this.ctx = ctx;
    this.atlas = atlas;
    this.sheet = sheet;
    const gl = ctx.gl;
    const use300 = ctx.gl2 !== null;

    this.program = createProgram(gl, use300 ? VS_300 : VS_100, use300 ? FS_300 : FS_100, 'hand');
    this.uniforms = uniformLocations(gl, this.program, UNIFORMS);

    /*
     * O buffer é dimensionado pelo **pior caso da extrusão**, não pelo cubo:
     * um sprite em xadrez gasta quatro arestas por pixel. Alocar aqui uma vez
     * é o que mantém a troca de item sem alocação nenhuma depois.
     */
    this.data = new Float32Array(
      Math.max(36, extrudedVertexCapacity(sheet.width / sheet.columns)) * FLOATS_PER_VERTEX,
    );

    const buffer = gl.createBuffer();
    if (buffer === null) throw new Error('Falha ao criar buffer da mão.');
    this.buffer = buffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    // A folha de sprites é a mesma do item no chão, mas a textura é própria:
    // compartilhar o objeto exigiria acoplar os dois módulos por nada.
    const texture = gl.createTexture();
    if (texture === null) throw new Error('Falha ao criar textura da mão.');
    this.sprites = texture;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(
      gl.TEXTURE_2D, 0, gl.RGBA, sheet.width, sheet.height, 0,
      gl.RGBA, gl.UNSIGNED_BYTE, sheet.pixels,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.setHeld(-1);
  }

  /** Dispara o balanço. Chamado ao quebrar, bater ou usar. */
  swing(): void {
    this.animation.swing();
  }

  /**
   * Um tick de animação. `speed` é o deslocamento horizontal do jogador no
   * tick, que é o que faz a mão balançar ao andar e ficar parada ao parar.
   *
   * Chame **todo tick**, inclusive com tela aberta: ver `HandAnimation`.
   */
  tick(speed: number): void {
    this.animation.tick(speed);
  }

  /**
   * Troca o que está na mão. `item` é o id do item, ou `-1` para mão vazia.
   * Reconstrói a geometria **só quando muda** — no caminho de render isto é
   * uma comparação de inteiros.
   */
  setHeld(item: number): void {
    // O tile muda sem o item mudar quando a agulha da bússola gira (M10).
    const tile = item < 0 ? -1 : this.tileOf?.(item) ?? this.sheet.index.get(item) ?? -1;
    if (item === this.held && tile === this.heldTile) return;
    this.held = item;
    this.heldTile = tile;

    if (item < 0) {
      this.mode = 2;
      this.vertexCount = buildBox(this.data, 0.32, 0.9, 0.32);
    } else {
      const blockId = blockOf(item);
      if (blockId !== undefined) {
        this.mode = 0;
        this.vertexCount = buildBlockCube(this.data, this.atlas, blockId);
        // Lã colorida é o desenho cinza tingido (M13): a mão tinge igual.
        const dye = dyeRgbOf(defOf(makeState(blockId)));
        this.tint[0] = dye === null ? 1 : dye[0] / 255;
        this.tint[1] = dye === null ? 1 : dye[1] / 255;
        this.tint[2] = dye === null ? 1 : dye[2] / 255;
      } else {
        this.mode = 1;
        // Item sem sprite (não deveria acontecer) cai na mão vazia, que é
        // melhor que um quad de textura faltando ocupando a tela.
        if (tile < 0) {
          this.mode = 2;
          this.vertexCount = buildBox(this.data, 0.32, 0.9, 0.32);
        } else {
          const size = this.sheet.width / this.sheet.columns;
          this.vertexCount = buildExtrudedSprite(
            this.data,
            maskFromSheet(this.sheet.pixels, this.sheet.width, this.sheet.columns, size, tile),
            tile, SPRITE_HALF, SPRITE_THICKNESS,
          );
        }
      }
    }

    const gl = this.ctx.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.data.subarray(0, this.vertexCount * FLOATS_PER_VERTEX));
  }

  /**
   * Desenha a mão. Devolve quantas draw calls gastou (0 ou 1).
   *
   * `light` é a luz do bloco onde o jogador está (0..15 já normalizado em
   * 0..1): a mão escurece junto com o mundo ao entrar numa caverna, senão ela
   * brilha sozinha no escuro.
   */
  render(aspect: number, alpha: number, light: number): number {
    if (!this.enabled || this.vertexCount === 0) return 0;
    const gl = this.ctx.gl;

    if (aspect !== this.lastAspect) {
      perspective(this.proj, HAND_FOV, aspect, 0.05, 4);
      this.lastAspect = aspect;
    }

    const swing = this.animation.swingAt(alpha);
    const bob = this.animation.bobAt(alpha);
    const pose = handPose(swing, bob, aspect, this.pose);

    // model = T(pose) · Ry · Rx · S — montado a cada frame em matrizes que já
    // existem, sem alocar.
    identity(this.model);
    translate(this.model, pose.x, pose.y, pose.z);
    identity(this.scratch);
    rotateY(this.scratch, pose.yaw);
    multiply(this.model, this.model, this.scratch);
    identity(this.scratch);
    rotateX(this.scratch, pose.pitch);
    multiply(this.model, this.model, this.scratch);
    identity(this.scratch);
    scaleMat(this.scratch, pose.scale, pose.scale, pose.scale);
    multiply(this.model, this.model, this.scratch);

    // A profundidade limpa é o que impede a mão de entrar na parede.
    gl.clear(gl.DEPTH_BUFFER_BIT);
    gl.useProgram(this.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);

    const stride = FLOATS_PER_VERTEX * 4;
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 3, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 2, gl.FLOAT, false, stride, 12);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, stride, 20);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, stride, 24);

    this.atlas.bind(0);
    gl.uniform1i(this.uniforms.uAtlas, 0);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.sprites);
    gl.uniform1i(this.uniforms.uSprites, 1);
    if (!this.atlas.isArray) {
      gl.uniform2f(this.uniforms.uAtlasTiles, this.atlas.tilesPerRow, 1 / this.atlas.tilesPerRow);
    }
    gl.uniform2f(this.uniforms.uSheet, this.sheet.columns, this.sheet.rows);
    gl.uniformMatrix4fv(this.uniforms.uProj, false, this.proj);
    gl.uniformMatrix4fv(this.uniforms.uModel, false, this.model);
    gl.uniform1f(this.uniforms.uMode, this.mode);

    // A mão nunca fica totalmente preta: 0,25 é o piso que mantém a silhueta.
    const shade = 0.25 + 0.75 * Math.min(1, Math.max(0, light));
    if (this.mode === 2) {
      gl.uniform4f(this.uniforms.uColor, SKIN[0] * shade, SKIN[1] * shade, SKIN[2] * shade, 1);
    } else {
      const t = this.mode === 0 ? this.tint : NO_TINT;
      gl.uniform4f(this.uniforms.uColor, shade * t[0], shade * t[1], shade * t[2], 1);
    }

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.drawArrays(gl.TRIANGLES, 0, this.vertexCount);
    gl.enable(gl.CULL_FACE);

    for (let i = 0; i < 4; i++) gl.disableVertexAttribArray(i);
    gl.activeTexture(gl.TEXTURE0);
    return 1;
  }

  dispose(): void {
    const gl = this.ctx.gl;
    gl.deleteBuffer(this.buffer);
    gl.deleteTexture(this.sprites);
    gl.deleteProgram(this.program);
  }
}

/** Interpola dois valores de tick, para o balanço não andar a 20 Hz na tela. */
function lerpTicks(previous: number, current: number, alpha: number): number {
  return previous + (current - previous) * alpha;
}

/**
 * O bloco **cúbico** que o item coloca, se colocar algum.
 *
 * A forma importa: tocha, porta, cama, escada de mão e trilho colocam bloco,
 * mas desenhá-los como um cubo da textura deles é o que fazia a tocha na mão
 * parecer um tijolo aceso. Quem não é cubo vai pelo sprite extrudado, que é o
 * mesmo desenho do inventário e tem a forma certa.
 */
function blockOf(item: number): number | undefined {
  if (item === AIR) return undefined;
  const places = itemDef(item)?.placesBlock;
  if (places === undefined) return undefined;
  const def = defOf(makeState(places));
  if (def.id !== places || def.shape !== 'cube') return undefined;
  return places;
}

/**
 * Sombra por face — a mesma ideia do mesher: sem ela o cubo vira uma silhueta
 * chapada e não dá para ver que é um cubo.
 */
const FACE_SHADE = [0.72, 0.72, 1.0, 0.55, 0.86, 0.86];

/** Cantos de cada face do cubo unitário, em ordem de triângulo. */
const FACE_CORNERS: readonly number[][] = [
  [1, 0, 0, 1, 0, 1, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 1, 0], // +X
  [0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 0, 0, 1, 1], // −X
  [0, 1, 0, 1, 1, 0, 1, 1, 1, 0, 1, 0, 1, 1, 1, 0, 1, 1], // +Y
  [0, 0, 1, 1, 0, 1, 1, 0, 0, 0, 0, 1, 1, 0, 0, 0, 0, 0], // −Y
  [0, 0, 1, 1, 0, 1, 1, 1, 1, 0, 0, 1, 1, 1, 1, 0, 1, 1], // +Z
  [1, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0], // −Z
];

/** UV de cada vértice da face, na mesma ordem de `FACE_CORNERS`. */
const FACE_UVS = [0, 0, 1, 0, 1, 1, 0, 0, 1, 1, 0, 1];

/** Cubo texturizado com as camadas do bloco. Devolve o número de vértices. */
function buildBlockCube(out: Float32Array, atlas: Atlas, blockId: number): number {
  const def = defOf(makeState(blockId));
  const layers = [
    atlas.layerOf(texOf(def, 'side')),
    atlas.layerOf(texOf(def, 'side')),
    atlas.layerOf(texOf(def, 'top')),
    atlas.layerOf(texOf(def, 'bottom')),
    atlas.layerOf(texOf(def, 'side')),
    atlas.layerOf(texOf(def, 'side')),
  ];

  let n = 0;
  for (let face = 0; face < 6; face++) {
    const corners = FACE_CORNERS[face];
    for (let v = 0; v < 6; v++) {
      const o = n * FLOATS_PER_VERTEX;
      // Cubo centrado na origem, lado 1.
      out[o] = corners[v * 3] - 0.5;
      out[o + 1] = corners[v * 3 + 1] - 0.5;
      out[o + 2] = corners[v * 3 + 2] - 0.5;
      out[o + 3] = FACE_UVS[v * 2];
      // Face de pé: linha 0 do desenho no alto, como no terreno (`mesh.ts`).
      out[o + 4] = isUprightFace(face) ? 1 - FACE_UVS[v * 2 + 1] : FACE_UVS[v * 2 + 1];
      out[o + 5] = layers[face];
      out[o + 6] = FACE_SHADE[face];
      n++;
    }
  }
  return n;
}

/** Caixa lisa (mão vazia), centrada na origem. */
function buildBox(out: Float32Array, width: number, height: number, depth: number): number {
  let n = 0;
  for (let face = 0; face < 6; face++) {
    const corners = FACE_CORNERS[face];
    for (let v = 0; v < 6; v++) {
      const o = n * FLOATS_PER_VERTEX;
      out[o] = (corners[v * 3] - 0.5) * width;
      out[o + 1] = (corners[v * 3 + 1] - 0.5) * height;
      out[o + 2] = (corners[v * 3 + 2] - 0.5) * depth;
      out[o + 3] = FACE_UVS[v * 2];
      out[o + 4] = FACE_UVS[v * 2 + 1];
      out[o + 5] = 0;
      out[o + 6] = FACE_SHADE[face];
      n++;
    }
  }
  return n;
}

/**
 * Meia altura do sprite extrudado.
 *
 * Maior que o cubo de propósito: o sprite tem margem transparente em volta, e
 * com o mesmo tamanho do bloco a espada sairia visivelmente menor que a terra.
 */
const SPRITE_HALF = 0.75;
/**
 * Espessura da chapa, em unidades de modelo.
 *
 * Dois pixels do sprite. Um só quase não se vê de frente; quatro fazem a
 * espada parecer um tijolo — este é o número que o gênero usa e que lê como
 * "objeto fino, mas objeto".
 */
const SPRITE_THICKNESS = (SPRITE_HALF * 2) * (2 / 16);

const NO_TINT = new Float32Array([1, 1, 1]);
