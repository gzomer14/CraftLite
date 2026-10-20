/**
 * Texturas dos blocos de casa (M26). Ficam fora de `data/textures.ts` pelo
 * tamanho daquela tabela; entram nela no fim das do jogo, antes das de mod.
 *
 * **Lembrete de `mesh/complex.ts`:** uma caixa parcial mostra o ladrilho
 * **inteiro** em cada face, espremido. Por isso a lanterna é desenhada em
 * faixas (moldura escura, vidro aceso no meio) e não como um recorte, e a tora
 * da fogueira é casca nas bordas e cerne no meio.
 *
 * Custo de atlas: 21 camadas — fogueira 1, caldeirão 2, lanterna 2, vaso 2,
 * moldura 1, troncos descascados 10 (lado e topo de cinco madeiras),
 * terracota 1, terracota tingida 1, concreto 1 (de 223 para 244, de 512). As dezesseis cores de
 * terracota e de concreto saem do tint (`data/tints.ts`).
 */

import { border, dither, outline, rect, rings, speckle, stripes, type Rgb, type TexRecipe } from '../render/texgen';

const IRON: Rgb = [60, 60, 66];
const IRON_EDGE: Rgb = [38, 38, 42];
const CLAY_POT: Rgb = [150, 82, 58];

/** Lado e topo de um tronco descascado: o cerne, sem a casca. */
function strippedLog(side: Rgb, rings_: Rgb): Record<'side' | 'top', TexRecipe> {
  return {
    side: {
      base: side, noise: 'grain', scale: 4, variance: 0.08,
      ops: [stripes('v', 4, 0.12), dither(0.04)],
    },
    top: {
      base: side, noise: 'cell', scale: 2, variance: 0.06,
      ops: [rings(4, rings_), border(rings_, 1), dither(0.03)],
    },
  };
}

const STRIPPED: readonly [string, Rgb, Rgb][] = [
  ['oak', [178, 144, 88], [132, 104, 60]],
  ['birch', [208, 188, 130], [162, 142, 94]],
  ['spruce', [134, 98, 58], [92, 66, 38]],
  ['acacia', [184, 98, 56], [134, 68, 38]],
  ['jungle', [172, 130, 86], [126, 94, 60]],
];

export const COZY_TEXTURES: Record<string, TexRecipe> = {
  /** Tora da fogueira: casca escura nas pontas, chamuscada no meio. */
  'block/campfire_log': {
    base: [92, 70, 42], noise: 'grain', scale: 4, variance: 0.16,
    ops: [
      stripes('h', 3, 0.18),
      rect(0, 6, 16, 4, [52, 38, 26], 0.7),
      speckle([236, 122, 40], 0.05, 1),
      dither(0.06),
    ],
  },
  /** Ferro fundido com rebites; o topo é a borda e o fundo escuro de dentro. */
  'block/cauldron': {
    base: IRON, noise: 'value', scale: 5, variance: 0.1,
    ops: [
      border(IRON_EDGE, 1),
      rect(0, 3, 16, 1, [82, 82, 90]),
      speckle([96, 96, 104], 0.08, 1),
      rect(3, 5, 1, 1, [120, 120, 128]), rect(12, 5, 1, 1, [120, 120, 128]),
      dither(0.04),
    ],
  },
  'block/cauldron_top': {
    base: [74, 74, 80], noise: 'value', scale: 4, variance: 0.08,
    ops: [border(IRON_EDGE, 1), rect(2, 2, 12, 12, [32, 32, 36]), dither(0.04)],
  },
  /** Lanterna: moldura de ferro escuro e o vidro aceso no meio. */
  'block/lantern': {
    base: IRON, noise: 'flat', scale: 1, variance: 0,
    ops: [
      rect(3, 3, 10, 10, [255, 206, 104]),
      rect(5, 5, 6, 6, [255, 238, 168]),
      outline(3, 3, 10, 10, [186, 132, 52]),
      border(IRON_EDGE, 1),
      dither(0.03),
    ],
  },
  'block/lantern_top': {
    base: [72, 72, 78], noise: 'value', scale: 4, variance: 0.06,
    ops: [border(IRON_EDGE, 1), rect(6, 6, 4, 4, [112, 112, 120])],
  },
  /** Vaso: barro com a borda mais clara; por cima, a terra dentro da boca. */
  'block/flower_pot': {
    base: CLAY_POT, noise: 'value', scale: 6, variance: 0.06,
    ops: [rect(0, 0, 16, 3, [178, 102, 72]), rect(0, 3, 16, 1, [116, 62, 44]), dither(0.04)],
  },
  'block/flower_pot_top': {
    base: CLAY_POT, noise: 'value', scale: 6, variance: 0.06,
    ops: [rect(3, 3, 10, 10, [86, 60, 40]), speckle([62, 44, 30], 0.2, 1), outline(3, 3, 10, 10, [116, 62, 44])],
  },
  /** Moldura: ripas de madeira em volta do couro onde o item se apoia. */
  'block/item_frame': {
    base: [150, 100, 62], noise: 'grain', scale: 8, variance: 0.08,
    ops: [
      rect(0, 0, 16, 2, [122, 94, 54]), rect(0, 14, 16, 2, [122, 94, 54]),
      rect(0, 0, 2, 16, [122, 94, 54]), rect(14, 0, 2, 16, [122, 94, 54]),
      outline(0, 0, 16, 16, [84, 64, 36]),
      outline(2, 2, 12, 12, [104, 70, 42]),
      dither(0.04),
    ],
  },
  'block/terracotta': {
    base: [152, 94, 67], noise: 'value', scale: 6, variance: 0.06, ops: [dither(0.04)],
  },
  /**
   * Terracota tingida: cinza **quente e escuro**. O tint multiplica, então o
   * corante sai nela mais terroso que na lã — é o que separa as duas na mesma
   * cor, sem gastar dezesseis tints a mais.
   */
  'block/terracotta_dyed': {
    base: [208, 184, 168], noise: 'value', scale: 6, variance: 0.06, ops: [dither(0.04)],
  },
  /** Concreto: liso, quase sem grão — a cor do corante inteira. */
  'block/concrete': {
    base: [232, 232, 232], noise: 'value', scale: 8, variance: 0.02, ops: [dither(0.015)],
  },
};

for (const [wood, side, ring] of STRIPPED) {
  const recipes = strippedLog(side, ring);
  COZY_TEXTURES[`block/stripped_${wood}_log_side`] = recipes.side;
  COZY_TEXTURES[`block/stripped_${wood}_log_top`] = recipes.top;
}
