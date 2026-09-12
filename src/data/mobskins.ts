/**
 * Receitas de skin dos mobs (doc 13 §2 e §7: arte original, gerada por código).
 *
 * Cada receita é uma cor de base, cores por parte e uma lista de detalhes que o
 * `skingen` desenha nas faces que o próprio modelo define. Nenhuma paleta foi
 * extraída de outro jogo: as cores abaixo são escolhas do projeto.
 */

import type { SkinRecipe } from '../render/skingen';

/** Preto usado em olhos e bocas — nunca o #000 puro, que fica duro. */
const INK: [number, number, number] = [26, 24, 28];

export const MOB_SKINS: Record<string, SkinRecipe> = {
  // Barco: madeira clara com as bordas escurecidas (M6).
  boat: {
    base: [166, 130, 78], noise: 0.12,
    parts: {},
    details: [{ kind: 'shade', part: 'floor', amount: 0.15 }],
  },

  // Aldeão: túnica marrom, avental e o nariz que o identifica de longe (M6).
  villager: {
    base: [122, 88, 62], noise: 0.06,
    parts: { head: [200, 162, 132], arm: [122, 88, 62], leg: [74, 56, 40] },
    details: [
      { kind: 'eyes', part: 'head', color: INK, y: 0.32, size: 2, gap: 4 },
      { kind: 'mouth', part: 'head', color: [162, 122, 96], y: 0.62, w: 5, h: 3 },
      { kind: 'band', part: 'body', color: [96, 68, 46], y: 0.55, h: 4 },
    ],
  },

  cow: {
    base: [86, 62, 42], noise: 0.1,
    parts: { head: [74, 54, 38], leg: [56, 42, 30] },
    details: [
      { kind: 'patch', part: 'body', color: [226, 220, 210], count: 3, radius: 3.5 },
      { kind: 'eyes', part: 'head', color: INK, y: 0.28, size: 2, gap: 3 },
      { kind: 'mouth', part: 'head', color: [150, 118, 100], y: 0.68, w: 4, h: 2 },
    ],
  },

  pig: {
    base: [222, 140, 148], noise: 0.08,
    parts: { leg: [196, 116, 124] },
    details: [
      { kind: 'eyes', part: 'head', color: INK, y: 0.24, size: 2, gap: 3 },
      { kind: 'mouth', part: 'head', color: [196, 108, 118], y: 0.55, w: 4, h: 3 },
    ],
  },

  sheep: {
    base: [234, 231, 224], noise: 0.12,
    parts: { head: [216, 206, 192], leg: [68, 58, 50] },
    details: [
      { kind: 'patch', part: 'body', color: [246, 244, 240], count: 5, radius: 3 },
      { kind: 'eyes', part: 'head', color: INK, y: 0.3, size: 2, gap: 3 },
    ],
  },

  chicken: {
    base: [240, 238, 232], noise: 0.07,
    parts: { beak: [234, 152, 52], leg: [234, 152, 52] },
    details: [
      { kind: 'band', part: 'head', color: [206, 56, 48], y: 0, h: 1 },
      { kind: 'eyes', part: 'head', color: INK, y: 0.35, size: 1, gap: 2 },
    ],
  },

  squid: {
    base: [44, 70, 116], noise: 0.1,
    parts: { tentacle: [36, 58, 98] },
    details: [
      { kind: 'eyes', part: 'body', color: [226, 226, 236], y: 0.35, size: 2, gap: 4 },
    ],
  },

  wolf: {
    base: [148, 146, 144], noise: 0.12,
    parts: { snout: [226, 224, 218], leg: [128, 126, 124], tail: [134, 132, 130] },
    details: [
      { kind: 'eyes', part: 'head', color: [186, 148, 60], y: 0.3, size: 1, gap: 2 },
    ],
  },

  enderman: {
    base: [20, 18, 26], noise: 0.06,
    details: [
      { kind: 'eyes', part: 'head', color: [206, 96, 238], y: 0.4, size: 2, gap: 2 },
    ],
  },

  spider: {
    base: [58, 42, 38], noise: 0.14,
    parts: { head: [46, 32, 28], leg: [40, 28, 24] },
    details: [
      { kind: 'eyes', part: 'head', color: [204, 46, 40], y: 0.28, size: 2, gap: 4 },
      { kind: 'eyes', part: 'head', color: [204, 46, 40], y: 0.52, size: 1, gap: 2 },
    ],
  },

  zombie: {
    base: [62, 108, 70], noise: 0.12,
    parts: { head: [76, 122, 82], leg: [52, 60, 96], body: [58, 78, 110] },
    details: [
      { kind: 'eyes', part: 'head', color: [18, 26, 20], y: 0.3, size: 2, gap: 2 },
      { kind: 'mouth', part: 'head', color: [18, 26, 20], y: 0.66, w: 4, h: 1 },
    ],
  },

  skeleton: {
    base: [204, 204, 198], noise: 0.1,
    parts: { arm: [188, 188, 182], leg: [188, 188, 182] },
    details: [
      { kind: 'eyes', part: 'head', color: [22, 22, 22], y: 0.28, size: 2, gap: 2 },
      { kind: 'mouth', part: 'head', color: [22, 22, 22], y: 0.66, w: 5, h: 1 },
    ],
  },

  creeper: {
    base: [88, 168, 76], noise: 0.16,
    parts: { leg: [76, 148, 66] },
    details: [
      { kind: 'patch', part: 'body', color: [72, 142, 62], count: 4, radius: 3 },
      { kind: 'patch', part: 'head', color: [76, 150, 66], count: 3, radius: 2 },
      { kind: 'eyes', part: 'head', color: [16, 20, 16], y: 0.22, size: 3, gap: 2 },
      { kind: 'mouth', part: 'head', color: [16, 20, 16], y: 0.5, w: 4, h: 4 },
    ],
  },

  arrow: {
    base: [206, 204, 198], noise: 0.06,
    details: [
      { kind: 'band', part: 'shaft', color: [120, 116, 110], y: 0.5, h: 1 },
    ],
  },

  slime: {
    base: [112, 198, 112], noise: 0.14,
    details: [
      { kind: 'patch', part: 'body', color: [92, 178, 96], count: 4, radius: 2.5 },
      { kind: 'eyes', part: 'body', color: INK, y: 0.35, size: 1, gap: 3 },
      { kind: 'mouth', part: 'body', color: INK, y: 0.62, w: 2, h: 1 },
    ],
  },
};
