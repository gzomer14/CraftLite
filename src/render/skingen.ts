/**
 * Skins de mob geradas por código (doc 13: zero assets no repositório).
 *
 * O gerador não sabe nada sobre mob nenhum: ele recebe o **modelo** (as caixas)
 * e uma **receita** declarativa, e pinta os retângulos de "box mapping" que o
 * modelo já define. Isso é o que evita ter que desenhar 12 skins à mão e
 * mantém a arte original.
 *
 * Uma receita diz "o corpo é marrom, a cabeça é branca, tem olhos vermelhos na
 * face frontal da cabeça" — nunca coordenadas de textura soltas, que quebrariam
 * ao mudar o modelo.
 */

import { FACE_ORDER, faceRect, type FaceName, type ModelDef, type PartDef } from '../data/mobmodels';
import type { Rgb } from './texgen';

export interface SkinRecipe {
  /** Cor de fundo de todas as partes. */
  base: Rgb;
  /** Variação de brilho por texel, 0..1. Sem ela a skin fica plástica. */
  noise?: number;
  /**
   * Cor por parte. A chave casa por **prefixo**: `leg` pinta `legRight`,
   * `legFrontLeft` e companhia de uma vez.
   */
  parts?: Record<string, Rgb>;
  details?: readonly SkinDetail[];
}

/** Um detalhe desenhado sobre a face de uma parte. */
export type SkinDetail =
  /** Par de olhos na face indicada (padrão: frente da cabeça). */
  | { kind: 'eyes'; part: string; color: Rgb; y?: number; size?: number; gap?: number }
  /** Boca/faixa horizontal centralizada. */
  | { kind: 'mouth'; part: string; color: Rgb; y?: number; w?: number; h?: number }
  /** Faixa horizontal em todas as faces da parte (colar, cinta, listra). */
  | { kind: 'band'; part: string; color: Rgb; y: number; h: number }
  /** Manchas irregulares determinísticas (vaca, slime). */
  | { kind: 'patch'; part: string; color: Rgb; count: number; radius: number }
  /** Escurece (amount < 1) ou clareia (> 1) a parte inteira. */
  | { kind: 'shade'; part: string; amount: number };

/** Face onde os detalhes caem por padrão. */
const DEFAULT_FACE: FaceName = 'front';

/**
 * Gera a skin de um modelo. Devolve RGBA de `size × size`.
 *
 * Determinística: a mesma receita e a mesma seed dão os mesmos pixels em
 * qualquer máquina, o que é o que permite o resource pack do jogador
 * (`loadOverrides`) substituir camada por camada sem surpresa.
 */
export function generateSkin(model: ModelDef, recipe: SkinRecipe, seed: number): Uint8ClampedArray {
  const size = model.skinSize;
  const data = new Uint8ClampedArray(size * size * 4);
  const noise = recipe.noise ?? 0.08;

  // 1. fundo de cada parte, com a cor específica quando houver.
  for (const part of model.parts) {
    const color = colorFor(recipe, part.name) ?? recipe.base;
    fillPart(data, size, part, color, noise, seed);
  }

  // 2. detalhes, na ordem declarada (o último desenha por cima).
  for (const detail of recipe.details ?? []) {
    for (const part of model.parts) {
      if (!part.name.startsWith(detail.part)) continue;
      applyDetail(data, size, part, detail, seed);
    }
  }

  return data;
}

/** Cor declarada para a parte, casando por prefixo mais longo primeiro. */
function colorFor(recipe: SkinRecipe, partName: string): Rgb | undefined {
  const parts = recipe.parts;
  if (parts === undefined) return undefined;
  let best: Rgb | undefined;
  let bestLength = -1;
  for (const key of Object.keys(parts)) {
    if (!partName.startsWith(key)) continue;
    if (key.length > bestLength) {
      bestLength = key.length;
      best = parts[key];
    }
  }
  return best;
}

/** Pinta todas as 6 faces da caixa com ruído leve e sombreado por face. */
function fillPart(
  data: Uint8ClampedArray, size: number, part: PartDef,
  color: Rgb, noise: number, seed: number,
): void {
  const rect = RECT;
  for (let f = 0; f < FACE_ORDER.length; f++) {
    faceRect(part, FACE_ORDER[f], rect);
    // Um pouco mais escuro embaixo, mais claro em cima: dá volume antes de a
    // luz do mundo entrar.
    const shade = FACE_SHADE[f];
    for (let y = 0; y < rect[3]; y++) {
      for (let x = 0; x < rect[2]; x++) {
        const px = (rect[0] + x) | 0;
        const py = (rect[1] + y) | 0;
        const n = 1 + (hash(seed, px, py) - 0.5) * 2 * noise;
        writePixel(data, size, px, py, color, shade * n);
      }
    }
  }
}

function applyDetail(
  data: Uint8ClampedArray, size: number, part: PartDef, detail: SkinDetail, seed: number,
): void {
  switch (detail.kind) {
    case 'eyes': {
      faceRect(part, DEFAULT_FACE, RECT);
      const s = detail.size ?? 2;
      const gap = detail.gap ?? 2;
      const y = RECT[1] + Math.round((detail.y ?? 0.3) * RECT[3]);
      const cx = RECT[0] + RECT[2] / 2;
      rect(data, size, Math.round(cx - gap / 2 - s), y, s, s, detail.color);
      rect(data, size, Math.round(cx + gap / 2), y, s, s, detail.color);
      break;
    }
    case 'mouth': {
      faceRect(part, DEFAULT_FACE, RECT);
      const w = detail.w ?? Math.max(2, Math.round(RECT[2] * 0.5));
      const h = detail.h ?? 2;
      const y = RECT[1] + Math.round((detail.y ?? 0.62) * RECT[3]);
      rect(data, size, Math.round(RECT[0] + (RECT[2] - w) / 2), y, w, h, detail.color);
      break;
    }
    case 'band': {
      for (let f = 0; f < FACE_ORDER.length; f++) {
        // A faixa é vertical no mundo: só as laterais a mostram.
        if (FACE_ORDER[f] === 'top' || FACE_ORDER[f] === 'bottom') continue;
        faceRect(part, FACE_ORDER[f], RECT);
        const y = RECT[1] + Math.round(detail.y * RECT[3]);
        rect(data, size, RECT[0], y, RECT[2], detail.h, detail.color);
      }
      break;
    }
    case 'patch': {
      for (let f = 0; f < FACE_ORDER.length; f++) {
        faceRect(part, FACE_ORDER[f], RECT);
        for (let i = 0; i < detail.count; i++) {
          const h1 = hash(seed + i * 977, RECT[0] + f, RECT[1]);
          const h2 = hash(seed + i * 613, RECT[1] + f, RECT[0]);
          const cx = RECT[0] + h1 * RECT[2];
          const cy = RECT[1] + h2 * RECT[3];
          disc(data, size, cx, cy, detail.radius, RECT, detail.color);
        }
      }
      break;
    }
    default: {
      for (let f = 0; f < FACE_ORDER.length; f++) {
        faceRect(part, FACE_ORDER[f], RECT);
        scaleRect(data, size, RECT, detail.amount);
      }
      break;
    }
  }
}

/** Sombreado fixo por face, na ordem de `FACE_ORDER`. */
const FACE_SHADE = [1.06, 0.78, 0.9, 1.0, 0.9, 0.94];

/** Retângulo reusado: gerar skin no boot não precisa alocar 500 arrays. */
const RECT = new Float32Array(4);

function writePixel(
  data: Uint8ClampedArray, size: number, x: number, y: number, color: Rgb, mul: number,
): void {
  if (x < 0 || y < 0 || x >= size || y >= size) return;
  const o = (y * size + x) << 2;
  data[o] = color[0] * mul;
  data[o + 1] = color[1] * mul;
  data[o + 2] = color[2] * mul;
  data[o + 3] = 255;
}

function rect(
  data: Uint8ClampedArray, size: number,
  x: number, y: number, w: number, h: number, color: Rgb,
): void {
  for (let dy = 0; dy < h; dy++) {
    for (let dx = 0; dx < w; dx++) writePixel(data, size, x + dx, y + dy, color, 1);
  }
}

/** Mancha circular recortada no retângulo da face (não vaza para a vizinha). */
function disc(
  data: Uint8ClampedArray, size: number,
  cx: number, cy: number, radius: number, bounds: Float32Array, color: Rgb,
): void {
  const minX = Math.max(bounds[0], Math.floor(cx - radius));
  const maxX = Math.min(bounds[0] + bounds[2] - 1, Math.ceil(cx + radius));
  const minY = Math.max(bounds[1], Math.floor(cy - radius));
  const maxY = Math.min(bounds[1] + bounds[3] - 1, Math.ceil(cy + radius));
  for (let y = minY; y <= maxY; y++) {
    for (let x = minX; x <= maxX; x++) {
      const dx = x - cx;
      const dy = y - cy;
      if (dx * dx + dy * dy > radius * radius) continue;
      writePixel(data, size, x, y, color, 1);
    }
  }
}

function scaleRect(
  data: Uint8ClampedArray, size: number, bounds: Float32Array, amount: number,
): void {
  for (let y = 0; y < bounds[3]; y++) {
    for (let x = 0; x < bounds[2]; x++) {
      const px = (bounds[0] + x) | 0;
      const py = (bounds[1] + y) | 0;
      if (px < 0 || py < 0 || px >= size || py >= size) continue;
      const o = (py * size + px) << 2;
      data[o] *= amount;
      data[o + 1] *= amount;
      data[o + 2] *= amount;
    }
  }
}

/** Hash de posição → [0,1). Mesma família do usado no gerador de blocos. */
function hash(seed: number, x: number, y: number): number {
  let h = (seed ^ Math.imul(x | 0, 0x8da6b343) ^ Math.imul(y | 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return ((h ^ (h >>> 15)) >>> 0) / 4294967296;
}
