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

import { dyeRgbOf } from '../data/tints';
import { BIOMES } from '../data/biomes';
import { defOf, makeState, texOf } from '../data/blocks';
import {
  BOX_STRIDE, MAX_BOXES, MOUNT_FLOOR, SHAPE_BUTTON, SHAPE_BY_NAME, SHAPE_CROSS, SHAPE_LEVER,
  SHAPE_NONE, SHAPE_RAIL, SHAPE_STAIRS, SHAPE_TORCH, boxesFor,
} from '../world/mesh/shapes';
import { ITEMS, type ItemDef } from '../data/items';
import { DIAL_FRAMES, ITEM_ART, SHAPES, type DialKind, type ItemArt } from '../data/itemart';
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
  /**
   * Mostradores (M10): itemId → tile de cada quadro, o 0 sendo o de `index`.
   * Os quadros ficam no fim da folha, depois de todos os itens.
   */
  dials: Map<number, readonly number[]>;
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

  // Mostradores ganham quadros extras no fim. Arte do jogador vence: um
  // `item/compass.png` desenhado à mão é um quadro só, e fica parado.
  let dialTiles = 0;
  for (const item of drawable) {
    if (ITEM_ART[item.name]?.dial !== undefined && overrides?.has(item.name) !== true) {
      dialTiles += DIAL_FRAMES - 1;
    }
  }
  const rows = Math.max(1, Math.ceil((drawable.length + dialTiles) / COLUMNS));
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

    if (custom === undefined && art?.dial !== undefined) drawDialFace(tile, size, art, 0);
    blit(pixels, width, tile, (i % COLUMNS) * size, Math.floor(i / COLUMNS) * size, size);
    index.set(item.id, i);
  }

  // Os outros quadros dos mostradores: a mesma silhueta, outro ângulo.
  const dials = new Map<number, readonly number[]>();
  let next = drawable.length;
  for (const item of drawable) {
    const art = ITEM_ART[item.name];
    if (art?.dial === undefined || overrides?.has(item.name) === true) continue;
    const tiles = [index.get(item.id) ?? 0];
    for (let frame = 1; frame < DIAL_FRAMES; frame++) {
      tile.fill(0);
      if (style === 'nitido') {
        drawItemArt3d(tile, size, art, ITEM_FINISHES[itemMaterialOf(item.name, art.shape)]);
      } else {
        drawItemArt(tile, art, size);
      }
      drawDialFace(tile, size, art, frame);
      blit(pixels, width, tile, (next % COLUMNS) * size, Math.floor(next / COLUMNS) * size, size);
      tiles.push(next++);
    }
    dials.set(item.id, tiles);
  }

  return { pixels, width, height, columns: COLUMNS, rows, index, dials };
}

const NEEDLE: Rgb = [206, 40, 36];
const NEEDLE_TAIL: Rgb = [70, 72, 84];
const NIGHT: Rgb = [26, 32, 74];
const SUN: Rgb = [252, 220, 70];
const MOON: Rgb = [226, 226, 214];
/** Centro da face do mostrador, em pixels de máscara (ver `SHAPES.dial`). */
const DIAL_CENTER = 7.5;

/**
 * Pinta o mostrador do quadro `frame` por cima da silhueta: a agulha da
 * bússola ou o disco dia/noite do relógio, só onde a máscara é face (`a`).
 *
 * Quadro 0 é agulha para cima e sol no alto; cada quadro gira 360°/16 no
 * sentido horário.
 */
function drawDialFace(tile: Uint8ClampedArray, size: number, art: ItemArt, frame: number): void {
  const mask = SHAPES[art.shape];
  if (mask === undefined || art.dial === undefined) return;
  const k = Math.max(1, Math.floor(size / SPRITE_SIZE));
  const angle = (frame / DIAL_FRAMES) * Math.PI * 2;
  const face = (mx: number, my: number): boolean => {
    const role = mask[my]?.[mx];
    return role === 'a' || role === 'A';
  };
  const paint = (mx: number, my: number, color: Rgb): void => {
    if (!face(mx, my)) return;
    for (let y = my * k; y < (my + 1) * k; y++) {
      for (let x = mx * k; x < (mx + 1) * k; x++) {
        const o = ((y * size) + x) << 2;
        tile[o] = color[0]; tile[o + 1] = color[1]; tile[o + 2] = color[2]; tile[o + 3] = 255;
      }
    }
  };
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  drawDialKind(art.dial, angle, dx, dy, paint);
}

function drawDialKind(
  kind: DialKind, angle: number, dx: number, dy: number,
  paint: (mx: number, my: number, color: Rgb) => void,
): void {
  if (kind === 'needle') {
    // Ponta vermelha para onde aponta, rabo escuro do outro lado.
    for (let t = -3; t <= 4.01; t += 0.5) {
      const color = t > 0 ? NEEDLE : NEEDLE_TAIL;
      paint(Math.floor(DIAL_CENTER + dx * t + 0.5), Math.floor(DIAL_CENTER + dy * t + 0.5), color);
    }
    return;
  }
  // Céu: metade dia (o acento já pintado), metade noite, sol e lua opostos.
  for (let my = 0; my < SPRITE_SIZE; my++) {
    for (let mx = 0; mx < SPRITE_SIZE; mx++) {
      const px = mx + 0.5 - DIAL_CENTER - 0.5;
      const py = my + 0.5 - DIAL_CENTER - 0.5;
      if (px * dx + py * dy < -0.3) paint(mx, my, NIGHT);
    }
  }
  const sunX = DIAL_CENTER + Math.sin(angle) * 3;
  const sunY = DIAL_CENTER - Math.cos(angle) * 3;
  const moonX = DIAL_CENTER - Math.sin(angle) * 3;
  const moonY = DIAL_CENTER + Math.cos(angle) * 3;
  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      paint(Math.floor(sunX) + ox, Math.floor(sunY) + oy, SUN);
      paint(Math.floor(moonX) + ox, Math.floor(moonY) + oy, MOON);
    }
  }
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

  // Lã das dezesseis cores é um desenho cinza tingido (M13): o sprite pinta igual.
  const dye = dyeRgbOf(def);
  const topTint = dye ?? (def.tint === 'grass' ? GRASS_TINT : def.tint === 'foliage' ? FOLIAGE_TINT : null);
  const sideTint = dye ?? (def.tint === 'foliage' ? FOLIAGE_TINT : null);
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
  const shape = SHAPE_BY_NAME[def.shape] ?? SHAPE_NONE;

  /*
   * Planta e trilho não são sólidos: o desenho deles é **o próprio ladrilho**.
   *
   * Em isométrica eles viravam um cubo de flor — e uma muda, uma samambaia e
   * uma cana davam três cubos verdes iguais no inventário.
   */
  if (shape === SHAPE_CROSS || shape === SHAPE_RAIL) {
    drawFlat(out, size, sidePixels, sideTint);
    if (outlined && strokeThickness(out, size) > 2.6) outlineOpaque(out, size);
    return;
  }

  const count = spriteBoxes(shape);
  for (let b = 0; b < count; b++) {
    const o = ORDER[b] * BOX_STRIDE;
    drawBox(
      out, size, k,
      BOXES[o], BOXES[o + 1], BOXES[o + 2], BOXES[o + 3], BOXES[o + 4], BOXES[o + 5],
      topPixels, sidePixels, topTint, sideTint,
    );
  }

  // Contorno só faz sentido em cubo cheio. Numa textura vazada de traço fino
  // ele engrossa cada fio e o desenho vira borrão, então quem decide é a
  // espessura média do traço: teia (1,3), gerador (1,1), plantação (1,5),
  // trilho e escada (2,0–2,5) ficam de fora; a muda em cruz (2,7) e qualquer
  // cubo cheio (acima de 6) levam contorno.
  if (outlined && strokeThickness(out, size) > 2.6) outlineOpaque(out, size);
}

/**
 * Caixas do bloco para o sprite, já ordenadas de trás para frente.
 *
 * Devolve quantas escreveu em `BOXES`, com a ordem de desenho em `ORDER`.
 * Bloco cúbico — e qualquer forma sem lista de caixas — vira o cubo unitário,
 * que é exatamente o que este módulo desenhava antes de existir a forma.
 *
 * **Estado e conexões são escolhidos para o slot, não para o mundo**: a cerca
 * aparece com dois braços opostos, porque uma cerca sem braço nenhum é um
 * poste e ninguém reconhece um poste como cerca.
 */
function spriteBoxes(shape: number): number {
  let count = shape === SHAPE_NONE ? 0
    : boxesFor(shape, SPRITE_STATE[shape] ?? 0, SPRITE_LINKS, BOXES);
  if (count === 0) {
    BOXES[0] = 0; BOXES[1] = 0; BOXES[2] = 0;
    BOXES[3] = 1; BOXES[4] = 1; BOXES[5] = 1;
    count = 1;
  }
  /*
   * Pintor: o que está mais longe primeiro.
   *
   * A câmera isométrica olha do canto (+X, +Z), então a profundidade cresce com
   * `x0 + z0`; empate se resolve pela altura, para a tampa do baú cobrir o
   * corpo e não o contrário. São no máximo cinco caixas — ordenar por inserção
   * é mais barato que montar um array e chamar `sort`, que alocaria.
   */
  for (let i = 0; i < count; i++) ORDER[i] = i;
  for (let i = 1; i < count; i++) {
    const box = ORDER[i];
    const key = depthKey(box);
    let j = i - 1;
    while (j >= 0 && depthKey(ORDER[j]) > key) {
      ORDER[j + 1] = ORDER[j];
      j--;
    }
    ORDER[j + 1] = box;
  }
  return count;
}

function depthKey(box: number): number {
  const o = box * BOX_STRIDE;
  return (BOXES[o] + BOXES[o + 2]) * 4 + BOXES[o + 1];
}

/**
 * Uma caixa em isométrica 2:1: topo, face `+Z` (esquerda) e face `+X` (direita).
 *
 * A projeção é a mesma que o cubo sempre usou, escrita agora em função de um
 * ponto qualquer do bloco:
 *
 * ```
 *   x = 8 + (bx − bz)·8
 *   y = 1 + (bx + bz)·4 + (1 − by)·7
 * ```
 *
 * Com a caixa unitária ela reproduz o desenho antigo pixel por pixel — foi o
 * critério para trocar: laje e cerca passam a ter forma **sem** mexer no que
 * já estava certo.
 */
function drawBox(
  out: Uint8ClampedArray, size: number, k: number,
  x0: number, y0: number, z0: number, x1: number, y1: number, z1: number,
  topPixels: Uint8ClampedArray, sidePixels: Uint8ClampedArray,
  topTint: Rgb | null, sideTint: Rgb | null,
): void {
  for (let v = 0; v < SPRITE_SIZE; v += STEP) {
    for (let u = 0; u < SPRITE_SIZE; u += STEP) {
      const fu = u / SPRITE_SIZE;
      const fv = v / SPRITE_SIZE;

      // Topo, em y1.
      let bx = x0 + (x1 - x0) * fu;
      let bz = z0 + (z1 - z0) * fv;
      plot(out, size, isoX(bx, bz) * k, isoY(bx, y1, bz) * k,
        topPixels, u, v, SHADE_TOP, topTint);

      // Face +Z: a que aparece à esquerda.
      bx = x0 + (x1 - x0) * fu;
      let by = y1 - (y1 - y0) * fv;
      plot(out, size, isoX(bx, z1) * k, isoY(bx, by, z1) * k,
        sidePixels, u, v, SHADE_LEFT, sideTint);

      // Face +X: a que aparece à direita.
      bz = z1 - (z1 - z0) * fu;
      by = y1 - (y1 - y0) * fv;
      plot(out, size, isoX(x1, bz) * k, isoY(x1, by, bz) * k,
        sidePixels, u, v, SHADE_RIGHT, sideTint);
    }
  }
}

function isoX(bx: number, bz: number): number {
  return 8 + (bx - bz) * 8;
}

function isoY(bx: number, by: number, bz: number): number {
  return 1 + (bx + bz) * 4 + (1 - by) * 7;
}

/** Ladrilho desenhado de frente, sem projeção: planta e trilho. */
function drawFlat(
  out: Uint8ClampedArray, size: number, pixels: Uint8ClampedArray, tint: Rgb | null,
): void {
  const k = size / SPRITE_SIZE;
  for (let v = 0; v < SPRITE_SIZE; v += STEP) {
    for (let u = 0; u < SPRITE_SIZE; u += STEP) {
      plot(out, size, u * k, v * k, pixels, u, v, 1, tint);
    }
  }
}

const BOXES = new Float32Array(MAX_BOXES * BOX_STRIDE);
const ORDER = new Uint8Array(MAX_BOXES);
/** Cerca e grade aparecem com dois braços opostos (bits de `FACING_STEP`). */
const SPRITE_LINKS = 0b0011;
/** Estado com que cada forma posa no slot. O que não está aqui posa em 0. */
const SPRITE_STATE: Readonly<Record<number, number>> = {
  [SHAPE_TORCH]: MOUNT_FLOOR,
  [SHAPE_LEVER]: MOUNT_FLOOR,
  [SHAPE_BUTTON]: MOUNT_FLOOR,
  /*
   * A escada posa com o **degrau virado para a câmera**.
   *
   * O lado alto é `bits ^ 1`, então com estado 0 ele cai atrás e o degrau fica
   * escondido: a silhueta saía idêntica à de um cubo cheio, que é justamente o
   * que este passe veio consertar. Com 1, o corte aparece.
   */
  [SHAPE_STAIRS]: 1,
};

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
  /** `background-position` de cada tile, calculado uma vez: a hotbar pede todo quadro. */
  private readonly positions: string[] = [];
  /** Quadro atual de cada mostrador (M10). */
  private readonly frames = new Map<number, number>();

  constructor(
    source: SpriteSource, overrides?: ReadonlyMap<string, Uint8ClampedArray>,
    options?: ItemSheetOptions,
  ) {
    const t0 = performance.now();
    this.sheet = buildItemSheet(source, overrides, options);
    this.cssUrl = toDataUrl(this.sheet);
    const { columns, rows } = this.sheet;
    for (let tile = 0; tile < columns * rows; tile++) {
      const x = columns > 1 ? ((tile % columns) / (columns - 1)) * 100 : 0;
      const y = rows > 1 ? (Math.floor(tile / columns) / (rows - 1)) * 100 : 0;
      this.positions.push(`${x.toFixed(4)}% ${y.toFixed(4)}%`);
    }
    this.buildMs = performance.now() - t0;
  }

  /** Gira o mostrador do item para o quadro `frame` (M10). */
  setFrame(item: number, frame: number): void {
    if (this.sheet.dials.has(item)) this.frames.set(item, frame);
  }

  /** Tile atual do item, já com o quadro do mostrador, ou `undefined`. */
  tileOf(item: number): number | undefined {
    const dial = this.sheet.dials.get(item);
    if (dial !== undefined) return dial[this.frames.get(item) ?? 0] ?? dial[0];
    return this.sheet.index.get(item);
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
    const tile = this.tileOf(item);
    if (tile === undefined) return null;
    return this.positions[tile] ?? null;
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
