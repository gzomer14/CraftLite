/**
 * Sprites de item para a interface (doc 13 §2.4).
 *
 * Duas fontes, uma folha só:
 *
 * - **Item que é bloco** → o próprio cubo em projeção isométrica 2:1, montado a
 *   partir das texturas de topo e de lado que já existem no atlas. São ~60
 *   sprites de graça, como o doc prevê.
 * - **Item que não é bloco** → a máscara declarada em `data/itemart.ts`.
 *
 * O resultado vira **uma folha de sprites em data URL**, usada como
 * `background-image` pelos slots do inventário e da hotbar. A UI é DOM (doc 01
 * §1), então não dá para amostrar a textura da GPU: gerar a folha uma vez no
 * boot é o que evita 46 canvas vivos por tela.
 */

import { BIOMES } from '../data/biomes';
import { defOf, makeState, texOf } from '../data/blocks';
import { ITEMS, type ItemDef } from '../data/items';
import { ITEM_ART, SHAPES, type ItemArt } from '../data/itemart';
import { ITEM_FINISHES, itemMaterialOf, type TextureStyleId } from '../data/texturestyle';
import { drawItemArt3d } from './itemart3d';
import type { Rgb } from './texgen';

export const SPRITE_SIZE = 16;
/** Colunas da folha. 16 mantém a imagem quadrada até ~256 itens. */
const COLUMNS = 16;

/**
 * Sombreado de cada face do cubo isométrico.
 *
 * O contraste é maior que o do terreno de propósito: no mundo, o cubo tem
 * silhueta contra o céu; no slot de 16 px sobre fundo cinza, é só a diferença
 * de brilho entre as faces que faz o desenho parecer um cubo.
 */
const SHADE_TOP = 1;
const SHADE_LEFT = 0.72;
const SHADE_RIGHT = 0.5;

/** Passo da amostragem: menor que 0,5 para não deixar buraco entre pixels. */
const STEP = 0.25;

/** De onde vêm os pixels de uma textura de bloco. */
export interface SpriteSource {
  /** RGBA 16×16 da textura, ou `null` se ela não existe. */
  texturePixels(name: string): Uint8ClampedArray | null;
}

/** Tint fixo usado nos sprites de grama e folha — o do bioma de planície. */
const PLAINS = BIOMES.find((b) => b.name === 'plains');
const GRASS_TINT = rgbOf(PLAINS?.grassTint ?? 0x91bd59);
const FOLIAGE_TINT = rgbOf(PLAINS?.foliageTint ?? 0x77ab2f);

export interface ItemSheet {
  /** RGBA da folha inteira. */
  pixels: Uint8ClampedArray;
  width: number;
  height: number;
  columns: number;
  rows: number;
  /** itemId → índice do tile. */
  index: Map<number, number>;
}

/**
 * Monta a folha com todos os itens que têm sprite.
 * Puro: recebe os pixels das texturas e devolve pixels — dá para testar sem DOM.
 *
 * `overrides` é a arte do jogador (`render/pack.ts`), por nome de item. Ela
 * vence tudo, e **dá sprite a item que não tinha nenhum**: quem desenhar
 * `item/bucket.png` vê o balde, que hoje cai no vazio.
 */
export interface ItemSheetOptions {
  /** Lado de cada tile. Padrão `SPRITE_SIZE`; o estilo Nítido usa 32. */
  size?: number;
  /** Estilo de textura escolhido nas opções. */
  style?: TextureStyleId;
}

/**
 * Monta a folha com todos os itens que têm sprite.
 * Puro: recebe os pixels das texturas e devolve pixels — dá para testar sem DOM.
 *
 * `overrides` é a arte do jogador (`render/pack.ts`), por nome de item. Ela
 * vence tudo, e **dá sprite a item que não tinha nenhum**: quem desenhar
 * `item/bucket.png` vê o balde, que hoje cai no vazio. O pacote do jogador é
 * sempre 16×16; numa folha maior ele é ampliado por repetição de pixel, e
 * **não** passa pelo sombreado do estilo Nítido — a arte dele é dele.
 */
export function buildItemSheet(
  source: SpriteSource, overrides?: ReadonlyMap<string, Uint8ClampedArray>,
  options?: ItemSheetOptions,
): ItemSheet {
  const size = options?.size ?? SPRITE_SIZE;
  const style = options?.style ?? 'classico';
  const drawable: ItemDef[] = [];
  for (const item of ITEMS) {
    if (item === undefined) continue;
    if (item.placesBlock !== undefined || ITEM_ART[item.name] !== undefined
      || overrides?.has(item.name) === true) drawable.push(item);
  }

  const rows = Math.max(1, Math.ceil(drawable.length / COLUMNS));
  const width = COLUMNS * size;
  const height = rows * size;
  const pixels = new Uint8ClampedArray(width * height * 4);
  const index = new Map<number, number>();
  const tile = new Uint8ClampedArray(size * size * 4);

  for (let i = 0; i < drawable.length; i++) {
    const item = drawable[i];
    tile.fill(0);

    // A arte desenhada vence o cubo isométrico: o pó de redstone coloca um
    // bloco, mas na mão ele é pó, e o cubo de uma textura vazada não lê nada.
    const custom = overrides?.get(item.name);
    const art = ITEM_ART[item.name];
    if (custom !== undefined) upscaleInto(tile, size, custom);
    else if (art !== undefined) {
      if (style === 'nitido') {
        drawItemArt3d(tile, size, art, ITEM_FINISHES[itemMaterialOf(item.name, art.shape)]);
      } else {
        drawItemArt(tile, art, size);
      }
    } else if (item.placesBlock !== undefined) {
      drawBlockIsometric(tile, item.placesBlock, source, size, style === 'nitido');
    }

    blit(pixels, width, tile, (i % COLUMNS) * size, Math.floor(i / COLUMNS) * size, size);
    index.set(item.id, i);
  }

  return { pixels, width, height, columns: COLUMNS, rows, index };
}

/**
 * Copia a arte do pacote do jogador no tile, ampliando por repetição de pixel
 * quando a folha é maior que os 16×16 que o pacote entrega.
 */
function upscaleInto(tile: Uint8ClampedArray, size: number, art: Uint8ClampedArray): void {
  if (art.length === tile.length) { tile.set(art); return; }
  const from = Math.round(Math.sqrt(art.length / 4));
  if (from === 0 || from * from * 4 !== art.length) return;
  for (let y = 0; y < size; y++) {
    const sy = Math.min(from - 1, Math.floor((y * from) / size));
    for (let x = 0; x < size; x++) {
      const sx = Math.min(from - 1, Math.floor((x * from) / size));
      const to = ((y * size) + x) << 2;
      const s = ((sy * from) + sx) << 2;
      tile[to] = art[s];
      tile[to + 1] = art[s + 1];
      tile[to + 2] = art[s + 2];
      tile[to + 3] = art[s + 3];
    }
  }
}

/** Desenha a máscara de um item, resolvendo os papéis em cores. */
export function drawItemArt(
  out: Uint8ClampedArray, art: ItemArt | undefined, size = SPRITE_SIZE,
): void {
  if (art === undefined) return;
  const mask = SHAPES[art.shape];
  if (mask === undefined) return;

  const k = Math.max(1, Math.floor(size / SPRITE_SIZE));
  const accent = art.accent ?? shade(art.color, 0.55);
  for (let y = 0; y < size; y++) {
    const row = mask[Math.min(mask.length - 1, Math.floor(y / k))];
    if (row === undefined) continue;
    for (let x = 0; x < size; x++) {
      const role = row[Math.min(row.length - 1, Math.floor(x / k))];
      if (role === undefined || role === '.') continue;
      const color = role === 'm' ? art.color
        : role === 'M' ? shade(art.color, 1.3)
          : role === 'd' ? shade(art.color, 0.68)
            : role === 'a' ? accent
              : role === 'A' ? shade(accent, 1.25)
                : OUTLINE;
      const o = ((y * size) + x) << 2;
      out[o] = color[0];
      out[o + 1] = color[1];
      out[o + 2] = color[2];
      out[o + 3] = 255;
    }
  }
}

/**
 * Cubo em isométrica 2:1 dentro do tile.
 *
 * O losango do topo ocupa `y` 1..9 e as duas faces laterais vão de lá até 16
 * (em unidades de máscara de 16, multiplicadas pelo tamanho do tile). Metade da
 * altura para o topo é o que faz o desenho ler como cubo — com o topo achatado
 * ele vira um quadrado com sombra.
 *
 * `outlined` acrescenta o contorno do estilo Nítido: sem ele, um cubo claro
 * sobre o fundo claro do slot perde a silhueta.
 */
export function drawBlockIsometric(
  out: Uint8ClampedArray, blockId: number, source: SpriteSource,
  size = SPRITE_SIZE, outlined = false,
): void {
  const def = defOf(makeState(blockId));
  const top = source.texturePixels(texOf(def, 'top'));
  const side = source.texturePixels(texOf(def, 'side'));
  if (top === null && side === null) return;

  const topTint = def.tint === 'grass' ? GRASS_TINT : def.tint === 'foliage' ? FOLIAGE_TINT : null;
  const sideTint = def.tint === 'foliage' ? FOLIAGE_TINT : null;
  const topPixels = top ?? side;
  const sidePixels = side ?? top;
  if (topPixels === null || sidePixels === null) return;

  /*
   * Unidades da máscara (16) mapeadas no tile: o desenho é o mesmo em 16 e 32.
   *
   * O passo **não** acompanha `k`. Ele existe para não deixar buraco entre
   * pixels de destino, e o destino anda `0,5·k·STEP` por iteração: com `k=2`
   * isso já dá 0,25 px, metade do necessário. Dividir o passo por `k` — que foi
   * a primeira versão — deixava a amostragem 16 vezes mais fina do que precisa
   * e sozinho respondia por 80 dos 89 ms da folha.
   */
  const k = size / SPRITE_SIZE;
  for (let v = 0; v < SPRITE_SIZE; v += STEP) {
    for (let u = 0; u < SPRITE_SIZE; u += STEP) {
      // topo: losango de (8,1) a (0,5), (8,9) e (16,5)
      plot(out, size, (8 + (u - v) * 0.5) * k, (1 + (u + v) * 0.25) * k,
        topPixels, u, v, SHADE_TOP, topTint);
      // face esquerda (aresta superior de (0,5) a (8,9))
      plot(out, size, (u * 0.5) * k, (5 + u * 0.25 + v * 0.4375) * k,
        sidePixels, u, v, SHADE_LEFT, sideTint);
      // face direita (aresta superior de (8,9) a (16,5))
      plot(out, size, (8 + u * 0.5) * k, (9 - u * 0.25 + v * 0.4375) * k,
        sidePixels, u, v, SHADE_RIGHT, sideTint);
    }
  }

  // Contorno só faz sentido em cubo cheio. Numa textura vazada de traço fino
  // ele engrossa cada fio e o desenho vira borrão, então quem decide é a
  // espessura média do traço: teia (1,3), gerador (1,1), plantação (1,5),
  // trilho e escada (2,0–2,5) ficam de fora; a muda em cruz (2,7) e qualquer
  // cubo cheio (acima de 6) levam contorno.
  if (outlined && strokeThickness(out, size) > 2.6) outlineOpaque(out, size);
}

/**
 * Espessura média do traço: pixels opacos divididos pelos que fazem borda.
 *
 * Uma linha de 1 px é toda borda e dá 1; um hexágono cheio de 32 px dá mais de
 * 6. É a medida barata de "isto é um desenho fino ou um sólido?".
 */
export function strokeThickness(out: Uint8ClampedArray, size: number): number {
  const on = (i: number): boolean => out[(i << 2) + 3] > 128;
  let filled = 0;
  let border = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      if (!on(i)) continue;
      filled++;
      if (x === 0 || y === 0 || x === size - 1 || y === size - 1
        || !on(i - 1) || !on(i + 1) || !on(i - size) || !on(i + size)) border++;
    }
  }
  return border === 0 ? 0 : filled / border;
}

/**
 * Contorno escuro de um pixel em volta do que já foi desenhado.
 *
 * Usado só pelo cubo isométrico: a arte de item tem contorno próprio, tingido
 * pelo material, em `render/itemart3d.ts`.
 */
export function outlineOpaque(out: Uint8ClampedArray, size: number): void {
  const filled = new Uint8Array(size * size);
  for (let i = 0; i < filled.length; i++) filled[i] = out[(i << 2) + 3] > 128 ? 1 : 0;

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      if (filled[i] === 1) continue;
      const near = (x > 0 && filled[i - 1] === 1)
        || (x < size - 1 && filled[i + 1] === 1)
        || (y > 0 && filled[i - size] === 1)
        || (y < size - 1 && filled[i + size] === 1);
      if (!near) continue;
      const o = i << 2;
      out[o] = OUTLINE[0];
      out[o + 1] = OUTLINE[1];
      out[o + 2] = OUTLINE[2];
      out[o + 3] = 255;
    }
  }
}

/** Escreve um texel da textura no pixel de destino, com sombra e tint. */
function plot(
  out: Uint8ClampedArray, size: number, x: number, y: number,
  texture: Uint8ClampedArray, u: number, v: number,
  mul: number, tint: Rgb | null,
): void {
  const px = Math.floor(x);
  const py = Math.floor(y);
  if (px < 0 || py < 0 || px >= size || py >= size) return;

  // A textura de origem é sempre 16×16 (`TEX_SIZE`), o destino é que cresce.
  const t = ((Math.floor(v) * SPRITE_SIZE) + Math.floor(u)) << 2;
  const alpha = texture[t + 3];
  // Bloco recortado (vidro, folha): texel transparente não pinta nada.
  if (alpha < 128) return;

  const o = ((py * size) + px) << 2;
  const tintR = tint === null ? 1 : tint[0] / 255;
  const tintG = tint === null ? 1 : tint[1] / 255;
  const tintB = tint === null ? 1 : tint[2] / 255;
  out[o] = texture[t] * mul * tintR;
  out[o + 1] = texture[t + 1] * mul * tintG;
  out[o + 2] = texture[t + 2] * mul * tintB;
  out[o + 3] = 255;
}

const OUTLINE: Rgb = [26, 24, 28];

function shade(color: Rgb, mul: number): Rgb {
  return [
    Math.min(255, color[0] * mul),
    Math.min(255, color[1] * mul),
    Math.min(255, color[2] * mul),
  ];
}

function rgbOf(hex: number): Rgb {
  return [(hex >> 16) & 255, (hex >> 8) & 255, hex & 255];
}

function blit(
  target: Uint8ClampedArray, targetWidth: number,
  tile: Uint8ClampedArray, x: number, y: number, size: number,
): void {
  for (let row = 0; row < size; row++) {
    const from = row * size * 4;
    const to = ((y + row) * targetWidth + x) * 4;
    target.set(tile.subarray(from, from + size * 4), to);
  }
}

// ---------------------------------------------------------------------------
// Parte que toca no DOM: a folha vira uma imagem que o CSS consegue posicionar.
// ---------------------------------------------------------------------------

export class ItemSprites {
  /** `url(data:image/png;base64,...)`, pronto para `background-image`. */
  readonly cssUrl: string;
  readonly buildMs: number;
  private readonly sheet: ItemSheet;

  constructor(
    source: SpriteSource, overrides?: ReadonlyMap<string, Uint8ClampedArray>,
    options?: ItemSheetOptions,
  ) {
    const t0 = performance.now();
    this.sheet = buildItemSheet(source, overrides, options);
    this.cssUrl = toDataUrl(this.sheet);
    this.buildMs = performance.now() - t0;
  }

  get count(): number {
    return this.sheet.index.size;
  }

  /** A folha crua, para quem precisa dela na GPU (itens no chão). */
  get raw(): ItemSheet {
    return this.sheet;
  }

  has(item: number): boolean {
    return this.sheet.index.has(item);
  }

  /**
   * `background-position` do item, em porcentagem — funciona em qualquer
   * tamanho de slot, junto com o `background-size` de `sheetSize`.
   */
  position(item: number): string | null {
    const tile = this.sheet.index.get(item);
    if (tile === undefined) return null;
    const column = tile % this.sheet.columns;
    const row = Math.floor(tile / this.sheet.columns);
    const x = this.sheet.columns > 1 ? (column / (this.sheet.columns - 1)) * 100 : 0;
    const y = this.sheet.rows > 1 ? (row / (this.sheet.rows - 1)) * 100 : 0;
    return `${x.toFixed(4)}% ${y.toFixed(4)}%`;
  }

  /** `background-size` que faz um tile caber exatamente no elemento. */
  get sheetSize(): string {
    return `${this.sheet.columns * 100}% ${this.sheet.rows * 100}%`;
  }

  /**
   * Publica a folha como variáveis CSS globais, para os slots só precisarem do
   * `background-position`.
   */
  installCssVariables(): void {
    const root = document.documentElement.style;
    root.setProperty('--item-sheet', this.cssUrl);
    root.setProperty('--item-sheet-size', this.sheetSize);
  }
}

function toDataUrl(sheet: ItemSheet): string {
  const canvas = document.createElement('canvas');
  canvas.width = sheet.width;
  canvas.height = sheet.height;
  const ctx = canvas.getContext('2d');
  if (ctx === null) return '';
  const image = ctx.createImageData(sheet.width, sheet.height);
  image.data.set(sheet.pixels);
  ctx.putImageData(image, 0, 0);
  return `url(${canvas.toDataURL('image/png')})`;
}
