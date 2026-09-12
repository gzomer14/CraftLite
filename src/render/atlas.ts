/**
 * Monta o atlas de texturas no boot (doc 01 §5.2).
 *
 * WebGL2 → `TEXTURE_2D_ARRAY` de 16×16 por camada: uma draw call por section,
 * independente de quantos blocos diferentes ela tem.
 * WebGL1 → atlas 2D 256×256 (16×16 tiles) com padding para evitar bleeding.
 *
 * Nada é baixado: os pixels vêm do motor procedural (doc 13).
 */

import { ANIMATED_OPS, TEXTURES } from '../data/textures';
import { buildLayerIndex, type LayerIndex } from './layers';
import { TEX_SIZE, renderRecipe, type Canvas16, type TexRecipe } from './texgen';
import type { AnyGL, GlContext } from './gl';

const MIP_LEVELS = 3; // 16×16, 8×8, 4×4 (doc 01 §5.2: mipmaps até nível 2)

export interface AtlasLayer {
  name: string;
  layer: number;
  /** Quantos quadros a animação tem (1 = estática). */
  frames: number;
  /** Camada do primeiro quadro. */
  firstFrame: number;
}

export class Atlas {
  readonly texture: WebGLTexture;
  readonly isArray: boolean;
  /** Lado do atlas 2D no fallback; 0 em WebGL2. */
  readonly atlasSize: number;
  /** Tiles por linha no fallback; 0 em WebGL2. */
  readonly tilesPerRow: number;

  private readonly layers = new Map<string, AtlasLayer>();
  /** O mesmo índice que o worker de meshing usa — daí as camadas baterem. */
  readonly layerIndex: LayerIndex = buildLayerIndex();
  private readonly gl: AnyGL;
  readonly layerCount: number;
  /** ms gastos gerando os pixels — mostrado no debug. */
  readonly buildMs: number;
  /** Cor média de cada camada, em 0..1 — as partículas de quebra usam isso. */
  private readonly averages: Float32Array;
  /**
   * Pixels de cada camada, guardados depois do upload.
   *
   * São ~300 KB que ficam na RAM para sempre, e valem: é a única forma de a
   * interface (que é DOM, não GL) montar os sprites de item a partir das
   * texturas de bloco, sem ler de volta da GPU.
   */
  private readonly pixelData: Uint8ClampedArray[];

  constructor(ctx: GlContext) {
    const t0 = performance.now();
    this.gl = ctx.gl;
    this.isArray = ctx.gl2 !== null;

    const pixels = buildPixels(this.layers, this.layerIndex);
    this.layerCount = pixels.length;
    this.averages = computeAverages(pixels);
    this.pixelData = pixels;

    if (ctx.gl2 !== null) {
      this.atlasSize = 0;
      this.tilesPerRow = 0;
      this.texture = uploadArray(ctx.gl2, pixels);
    } else {
      // Menor potência de 2 que comporta todas as camadas em grade.
      let tiles = 1;
      while (tiles * tiles < pixels.length) tiles <<= 1;
      this.tilesPerRow = tiles;
      this.atlasSize = tiles * TEX_SIZE;
      this.texture = upload2D(ctx.gl, pixels, tiles);
    }

    this.buildMs = performance.now() - t0;
  }

  /** Índice de camada por nome. Cai para `block/missing` se não existir. */
  layerOf(name: string): number {
    const entry = this.layers.get(name);
    if (entry !== undefined) return entry.layer;
    const missing = this.layers.get('block/missing');
    return missing !== undefined ? missing.layer : 0;
  }

  /** Camada do quadro `frame` de uma textura animada. */
  animatedLayer(name: string, frame: number): number {
    const entry = this.layers.get(name);
    if (entry === undefined) return this.layerOf(name);
    return entry.firstFrame + (frame % entry.frames);
  }

  info(name: string): AtlasLayer | undefined {
    return this.layers.get(name);
  }

  /** RGBA 16×16 de uma textura pelo nome, ou `null` — usado pelos sprites de item. */
  texturePixels(name: string): Uint8ClampedArray | null {
    const entry = this.layers.get(name);
    return entry === undefined ? null : this.pixelData[entry.layer] ?? null;
  }

  /**
   * Cor média de uma camada, escrita em `out` (3 floats em 0..1).
   * É o que dá às partículas de quebra a cor do bloco quebrado (doc 06 §4).
   */
  averageColor(layer: number, out: Float32Array): void {
    const o = layer * 3;
    out[0] = this.averages[o];
    out[1] = this.averages[o + 1];
    out[2] = this.averages[o + 2];
  }

  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(this.isArray ? (gl as WebGL2RenderingContext).TEXTURE_2D_ARRAY : gl.TEXTURE_2D, this.texture);
  }

  /**
   * Substitui camadas por arte do próprio jogador (resource pack).
   * O projeto não distribui nada — só aceita o que o jogador trouxer (doc 13 §7).
   */
  loadOverrides(map: Map<string, Uint8ClampedArray>): void {
    const gl = this.gl;
    for (const [name, data] of map) {
      const entry = this.layers.get(name);
      if (entry === undefined || data.length !== TEX_SIZE * TEX_SIZE * 4) continue;
      if (this.isArray) {
        const gl2 = gl as WebGL2RenderingContext;
        gl2.bindTexture(gl2.TEXTURE_2D_ARRAY, this.texture);
        gl2.texSubImage3D(
          gl2.TEXTURE_2D_ARRAY, 0, 0, 0, entry.layer,
          TEX_SIZE, TEX_SIZE, 1, gl2.RGBA, gl2.UNSIGNED_BYTE, new Uint8Array(data.buffer),
        );
      } else {
        const tx = (entry.layer % this.tilesPerRow) * TEX_SIZE;
        const ty = ((entry.layer / this.tilesPerRow) | 0) * TEX_SIZE;
        gl.bindTexture(gl.TEXTURE_2D, this.texture);
        gl.texSubImage2D(
          gl.TEXTURE_2D, 0, tx, ty, TEX_SIZE, TEX_SIZE,
          gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer),
        );
      }
    }
  }
}

// ---------------------------------------------------------------------------

/** Gera todos os pixels seguindo a ordem de camadas do `LayerIndex`. */
function buildPixels(out: Map<string, AtlasLayer>, index: LayerIndex): Uint8ClampedArray[] {
  const cache = new Map<string, Uint8ClampedArray>();
  const pixels: Uint8ClampedArray[] = [];
  const names = index.names;

  // Seed derivada do nome: a textura é a mesma em qualquer máquina e sessão.
  const seedOf = (name: string): number => {
    let h = 0x811c9dc5;
    for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
    return h >>> 0;
  };

  const resolve = (name: string): Uint8ClampedArray => {
    const hit = cache.get(name);
    if (hit !== undefined) return hit;
    const recipe = TEXTURES[name] as TexRecipe | undefined;
    if (recipe === undefined) return new Uint8ClampedArray(TEX_SIZE * TEX_SIZE * 4);
    const data = renderRecipe(recipe, seedOf(name), resolve);
    cache.set(name, data);
    return data;
  };

  for (const name of names) {
    const recipe = TEXTURES[name];
    const base = resolve(name);
    const frames = recipe.frames ?? 1;
    const first = pixels.length;

    pixels.push(base);
    if (frames > 1) {
      const op = ANIMATED_OPS[name];
      for (let f = 1; f < frames; f++) {
        const frameData = base.slice();
        if (op !== undefined) {
          const c: Canvas16 = { data: frameData, seed: seedOf(name) };
          op(f, frames)(c);
        }
        pixels.push(frameData);
      }
    }

    // A camada calculada aqui tem que bater com a do índice compartilhado.
    if (first !== (index.byName.get(name)?.layer ?? -1)) {
      throw new Error(`Camada de ${name} divergiu do índice compartilhado.`);
    }
    out.set(name, { name, layer: first, frames, firstFrame: first });
  }

  return pixels;
}

/** Média ponderada por alfa de cada camada, pré-calculada no boot. */
function computeAverages(pixels: Uint8ClampedArray[]): Float32Array {
  const out = new Float32Array(pixels.length * 3);
  for (let i = 0; i < pixels.length; i++) {
    const data = pixels[i];
    let r = 0, g = 0, b = 0, weight = 0;
    for (let p = 0; p < data.length; p += 4) {
      const a = data[p + 3];
      if (a === 0) continue;
      r += data[p] * a;
      g += data[p + 1] * a;
      b += data[p + 2] * a;
      weight += a;
    }
    const o = i * 3;
    if (weight > 0) {
      out[o] = r / weight / 255;
      out[o + 1] = g / weight / 255;
      out[o + 2] = b / weight / 255;
    }
  }
  return out;
}

/** Reduz 2× por média de 4 pixels, respeitando alfa (para não sangrar recortes). */
function downsample(src: Uint8ClampedArray, size: number): Uint8ClampedArray {
  const half = size >> 1;
  const dst = new Uint8ClampedArray(half * half * 4);
  for (let y = 0; y < half; y++) {
    for (let x = 0; x < half; x++) {
      let r = 0, g = 0, b = 0, a = 0, weight = 0;
      for (let oy = 0; oy < 2; oy++) {
        for (let ox = 0; ox < 2; ox++) {
          const o = (((y * 2 + oy) * size) + (x * 2 + ox)) << 2;
          const al = src[o + 3];
          r += src[o] * al; g += src[o + 1] * al; b += src[o + 2] * al;
          a += al;
          weight += al;
        }
      }
      const o = ((y * half) + x) << 2;
      if (weight > 0) {
        dst[o] = r / weight;
        dst[o + 1] = g / weight;
        dst[o + 2] = b / weight;
      }
      dst[o + 3] = a / 4;
    }
  }
  return dst;
}

function uploadArray(gl: WebGL2RenderingContext, pixels: Uint8ClampedArray[]): WebGLTexture {
  const tex = gl.createTexture();
  if (tex === null) throw new Error('Falha ao criar o texture array.');
  const layers = pixels.length;

  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, MIP_LEVELS, gl.RGBA8, TEX_SIZE, TEX_SIZE, layers);

  let level: Uint8ClampedArray[] = pixels;
  let size = TEX_SIZE;
  for (let mip = 0; mip < MIP_LEVELS; mip++) {
    for (let i = 0; i < layers; i++) {
      gl.texSubImage3D(
        gl.TEXTURE_2D_ARRAY, mip, 0, 0, i, size, size, 1,
        gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(level[i].buffer, level[i].byteOffset, level[i].byteLength),
      );
    }
    if (mip + 1 < MIP_LEVELS) {
      const next: Uint8ClampedArray[] = new Array(layers);
      for (let i = 0; i < layers; i++) next[i] = downsample(level[i], size);
      level = next;
      size >>= 1;
    }
  }

  // NEAREST no magnify mantém a cara de pixel art; mip linear tira o cintilamento à distância.
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.REPEAT);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_BASE_LEVEL, 0);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAX_LEVEL, MIP_LEVELS - 1);
  return tex;
}

function upload2D(gl: AnyGL, pixels: Uint8ClampedArray[], tilesPerRow: number): WebGLTexture {
  const tex = gl.createTexture();
  if (tex === null) throw new Error('Falha ao criar o atlas 2D.');
  const side = tilesPerRow * TEX_SIZE;
  const buf = new Uint8ClampedArray(side * side * 4);

  for (let i = 0; i < pixels.length; i++) {
    const tx = (i % tilesPerRow) * TEX_SIZE;
    const ty = ((i / tilesPerRow) | 0) * TEX_SIZE;
    const src = pixels[i];
    for (let y = 0; y < TEX_SIZE; y++) {
      const srcOff = (y * TEX_SIZE) << 2;
      const dstOff = (((ty + y) * side) + tx) << 2;
      buf.set(src.subarray(srcOff, srcOff + (TEX_SIZE << 2)), dstOff);
    }
  }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(buf.buffer),
  );
  // Sem mipmap no fallback: o padding de 1px necessário custaria mais do que ganha.
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
