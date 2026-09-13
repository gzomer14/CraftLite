/**
 * Atlas de skins de entidade: um `TEXTURE_2D_ARRAY` de 64×64 por camada.
 *
 * Fica separado do atlas de blocos porque o tile é diferente (64 contra 16) e
 * misturar os dois obrigaria a subir tudo em 64×64 — 16× mais memória de
 * textura por bloco, o que não caberia no orçamento de T0.
 *
 * Tudo é gerado por código (doc 13): as skins vêm de `skingen` a partir dos
 * modelos, e a sombra é um disco radial desenhado aqui mesmo.
 */

import { MOBS } from '../data/mobs';
import { MOB_SKINS } from '../data/mobskins';
import { ENTITY_FINISH, type TextureStyleId } from '../data/texturestyle';
import { applyFinish } from './texfinish';
import { modelOf } from '../data/mobmodels';
import { generateSkin } from './skingen';
import type { AnyGL, GlContext } from './gl';

/** Lado de cada camada, em texels. */
export const SKIN_SIZE = 64;
/** Nome da camada da sombra de entidade (doc 07 §5). */
export const SHADOW_LAYER = 'shadow';
/** Nome da camada da flecha. */
export const ARROW_LAYER = 'arrow';
/** Camada do barco no atlas (M6). */
export const BOAT_LAYER = 'boat';
/** Camada do carrinho de mina (M7). */
export const MINECART_LAYER = 'minecart';

/** Camadas fora da tabela de mobs, mas com modelo e skin próprios. */
const EXTRA_LAYERS: readonly string[] = [ARROW_LAYER, BOAT_LAYER, MINECART_LAYER];

export class EntityAtlas {
  readonly texture: WebGLTexture;
  readonly isArray: boolean;
  /** Tiles por linha no fallback WebGL1; 0 em WebGL2. */
  readonly tilesPerRow: number;
  readonly layerCount: number;
  readonly buildMs: number;

  private readonly gl: AnyGL;
  private readonly layers = new Map<string, number>();

  /**
   * `overrides` é a arte do jogador (`render/pack.ts`), por nome de skin. Ela
   * entra **antes** do upload: nada é regerado nem reenviado depois.
   *
   * `style` é o visual das opções. No Nítido a skin gerada recebe o mesmo
   * relevo dos blocos, **sem chanfro** — ver `ENTITY_FINISH`. A skin do jogador
   * não recebe nada: a arte dele é dele.
   */
  constructor(
    ctx: GlContext, overrides?: ReadonlyMap<string, Uint8ClampedArray>,
    style: TextureStyleId = 'classico',
  ) {
    const t0 = performance.now();
    this.gl = ctx.gl;
    this.isArray = ctx.gl2 !== null;

    const custom = (name: string, generated: () => Uint8ClampedArray): Uint8ClampedArray => {
      const art = overrides?.get(name);
      if (art !== undefined && art.length === SKIN_SIZE * SKIN_SIZE * 4) return art;
      const made = generated();
      return style === 'nitido' ? applyFinish(made, SKIN_SIZE, ENTITY_FINISH) : made;
    };
    const pixels: Uint8ClampedArray[] = [];
    // Uma camada por tipo de mob, na ordem da tabela: assim `layerOf` de um mob
    // é o próprio id dele, sem consulta.
    for (const mob of MOBS) {
      const recipe = MOB_SKINS[mob.skin];
      const model = modelOf(mob.model);
      this.layers.set(mob.skin, pixels.length);
      pixels.push(custom(mob.skin, () => (
        recipe === undefined
          ? flatColor([220, 60, 200])
          : generateSkin(model, recipe, seedOf(mob.skin))
      )));
    }

    // Camadas que não são mob mas usam o mesmo batcher: flecha e barco.
    for (const name of EXTRA_LAYERS) {
      const recipe = MOB_SKINS[name];
      this.layers.set(name, pixels.length);
      pixels.push(custom(name, () => (
        recipe === undefined
          ? flatColor([210, 210, 205])
          : generateSkin(modelOf(name), recipe, seedOf(name))
      )));
    }

    this.layers.set(SHADOW_LAYER, pixels.length);
    pixels.push(custom(SHADOW_LAYER, shadowDisc));

    this.layerCount = pixels.length;

    if (ctx.gl2 !== null) {
      this.tilesPerRow = 0;
      this.texture = uploadArray(ctx.gl2, pixels);
    } else {
      let tiles = 1;
      while (tiles * tiles < pixels.length) tiles <<= 1;
      this.tilesPerRow = tiles;
      this.texture = upload2D(ctx.gl, pixels, tiles);
    }
    this.buildMs = performance.now() - t0;
  }

  layerOf(name: string): number {
    return this.layers.get(name) ?? 0;
  }

  bind(unit: number): void {
    const gl = this.gl;
    gl.activeTexture(gl.TEXTURE0 + unit);
    gl.bindTexture(
      this.isArray ? (gl as WebGL2RenderingContext).TEXTURE_2D_ARRAY : gl.TEXTURE_2D,
      this.texture,
    );
  }

  dispose(): void {
    this.gl.deleteTexture(this.texture);
  }
}

/**
 * Toda camada que o atlas monta, na ordem em que ele as monta.
 *
 * Existe para o resource pack poder **validar um nome sem contexto GL** — a
 * importação roda num menu, muito antes de haver atlas de entidade.
 */
export function entitySkinNames(): string[] {
  const names: string[] = [];
  for (const mob of MOBS) names.push(mob.skin);
  for (const name of EXTRA_LAYERS) names.push(name);
  names.push(SHADOW_LAYER);
  return names;
}

/** Seed derivada do nome: a skin é igual em qualquer máquina e sessão. */
function seedOf(name: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < name.length; i++) h = Math.imul(h ^ name.charCodeAt(i), 0x01000193) >>> 0;
  return h >>> 0;
}

function flatColor(color: readonly [number, number, number]): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
  for (let i = 0; i < data.length; i += 4) {
    data[i] = color[0];
    data[i + 1] = color[1];
    data[i + 2] = color[2];
    data[i + 3] = 255;
  }
  return data;
}

/**
 * Disco radial escuro, usado como sombra projetada no chão (doc 07 §5).
 * O alfa cai com o quadrado da distância ao centro: a borda some sem serrote.
 */
function shadowDisc(): Uint8ClampedArray {
  const data = new Uint8ClampedArray(SKIN_SIZE * SKIN_SIZE * 4);
  const center = (SKIN_SIZE - 1) / 2;
  for (let y = 0; y < SKIN_SIZE; y++) {
    for (let x = 0; x < SKIN_SIZE; x++) {
      const dx = (x - center) / center;
      const dy = (y - center) / center;
      const d = Math.min(1, Math.sqrt(dx * dx + dy * dy));
      const o = (y * SKIN_SIZE + x) << 2;
      data[o] = 0; data[o + 1] = 0; data[o + 2] = 0;
      data[o + 3] = Math.round(200 * (1 - d) * (1 - d));
    }
  }
  return data;
}

function uploadArray(gl: WebGL2RenderingContext, pixels: Uint8ClampedArray[]): WebGLTexture {
  const tex = gl.createTexture();
  if (tex === null) throw new Error('Falha ao criar o atlas de entidades.');
  gl.bindTexture(gl.TEXTURE_2D_ARRAY, tex);
  gl.texStorage3D(gl.TEXTURE_2D_ARRAY, 1, gl.RGBA8, SKIN_SIZE, SKIN_SIZE, pixels.length);
  for (let i = 0; i < pixels.length; i++) {
    const data = pixels[i];
    gl.texSubImage3D(
      gl.TEXTURE_2D_ARRAY, 0, 0, 0, i, SKIN_SIZE, SKIN_SIZE, 1,
      gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(data.buffer, data.byteOffset, data.byteLength),
    );
  }
  // NEAREST em tudo: a cara de pixel art é o ponto, e sem mipmap não há custo.
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D_ARRAY, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}

function upload2D(gl: AnyGL, pixels: Uint8ClampedArray[], tilesPerRow: number): WebGLTexture {
  const tex = gl.createTexture();
  if (tex === null) throw new Error('Falha ao criar o atlas 2D de entidades.');
  const side = tilesPerRow * SKIN_SIZE;
  const buf = new Uint8ClampedArray(side * side * 4);

  for (let i = 0; i < pixels.length; i++) {
    const tx = (i % tilesPerRow) * SKIN_SIZE;
    const ty = ((i / tilesPerRow) | 0) * SKIN_SIZE;
    const src = pixels[i];
    for (let y = 0; y < SKIN_SIZE; y++) {
      const srcOff = (y * SKIN_SIZE) << 2;
      const dstOff = (((ty + y) * side) + tx) << 2;
      buf.set(src.subarray(srcOff, srcOff + (SKIN_SIZE << 2)), dstOff);
    }
  }

  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(
    gl.TEXTURE_2D, 0, gl.RGBA, side, side, 0, gl.RGBA, gl.UNSIGNED_BYTE,
    new Uint8Array(buf.buffer),
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  return tex;
}
