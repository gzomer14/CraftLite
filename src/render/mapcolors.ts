/**
 * Cor de cada bloco no mapa (M10).
 *
 * **Tirada da textura, não de uma tabela.** A cor do bloco no mapa é a média
 * dos pixels opacos da face de cima, com o tinte da grama e da folha do bioma
 * de planície — a mesma conta que o sprite isométrico faz
 * (`render/itemsprites.ts`). Bloco novo ganha cor sozinho, e o mapa segue o
 * pacote de texturas do jogador.
 *
 * Três sombras por cor, como no original: 71%, 86% e 100%.
 */

import { BIOMES } from '../data/biomes';
import { BLOCKS, WATER, defOf, makeState, texOf } from '../data/blocks';
import { dyeRgbOf } from '../data/tints';
import { shadeOf, blockOfPixel, PIXEL_KNOWN } from '../game/worldmap';
import type { SpriteSource } from './itemsprites';

const SHADES: readonly number[] = [0.71, 0.86, 1];
/** Água: a textura é cinza e o tinte é do bioma; no mapa, um azul só. */
const WATER_RGB: readonly [number, number, number] = [52, 96, 214];
/** Onde ninguém foi: papel escuro. */
export const UNKNOWN_RGB: readonly [number, number, number] = [54, 48, 40];

const PLAINS = BIOMES.find((b) => b.name === 'plains');
const GRASS = hex(PLAINS?.grassTint ?? 0x91bd59);
const FOLIAGE = hex(PLAINS?.foliageTint ?? 0x77ab2f);

/** RGB por id de bloco, três bytes cada. */
export function buildMapPalette(source: SpriteSource): Uint8Array {
  const palette = new Uint8Array(1024 * 3).fill(128);
  for (const block of BLOCKS) {
    if (block === undefined) continue;
    const def = defOf(makeState(block.id));
    let rgb: readonly [number, number, number] | null;
    if (block.id === WATER) rgb = WATER_RGB;
    else {
      const pixels = source.texturePixels(texOf(def, 'top'));
      rgb = pixels === null ? null : average(pixels);
      const tint = dyeRgbOf(def)
        ?? (def.tint === 'grass' ? GRASS : def.tint === 'foliage' ? FOLIAGE : null);
      if (rgb !== null && tint !== null) {
        rgb = [(rgb[0] * tint[0]) / 255, (rgb[1] * tint[1]) / 255, (rgb[2] * tint[2]) / 255];
      }
    }
    if (rgb === null) continue;
    palette[block.id * 3] = rgb[0];
    palette[block.id * 3 + 1] = rgb[1];
    palette[block.id * 3 + 2] = rgb[2];
  }
  return palette;
}

/**
 * Escreve a cor do pixel do mapa em `out[at..at+3]` (RGBA). Pixel 0 é o que
 * ninguém explorou.
 */
export function writeMapColor(palette: Uint8Array, pixel: number, out: Uint8ClampedArray, at: number): void {
  if ((pixel & PIXEL_KNOWN) === 0) {
    out[at] = UNKNOWN_RGB[0]; out[at + 1] = UNKNOWN_RGB[1]; out[at + 2] = UNKNOWN_RGB[2];
    out[at + 3] = 255;
    return;
  }
  const id = blockOfPixel(pixel);
  const k = SHADES[shadeOf(pixel)] ?? 1;
  out[at] = palette[id * 3] * k;
  out[at + 1] = palette[id * 3 + 1] * k;
  out[at + 2] = palette[id * 3 + 2] * k;
  out[at + 3] = 255;
}

function average(pixels: Uint8ClampedArray): [number, number, number] | null {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < pixels.length; i += 4) {
    if (pixels[i + 3] < 128) continue;
    r += pixels[i]; g += pixels[i + 1]; b += pixels[i + 2]; n++;
  }
  return n === 0 ? null : [r / n, g / n, b / n];
}

function hex(value: number): [number, number, number] {
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}
