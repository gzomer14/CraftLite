/**
 * Receitas de textura, declarativas (doc 13 §2.2).
 *
 * Adicionar uma textura nova é uma linha aqui — nunca um `case` em um `switch`.
 * A ordem desta tabela define o índice de camada no `TEXTURE_2D_ARRAY`, mas
 * nada no código deve depender dela: use `atlas.layerOf('block/stone')`.
 */

import {
  alphaMask, blobs, border, bricks, cropRows, dither, emboss, flow, furrows,
  oreBlobs, outline, plankLines, rect, rings, speckle, stripes, tintBy,
  type Rgb, type TexOp, type TexRecipe,
} from '../render/texgen';

const STONE_DARK: [number, number, number] = [86, 86, 86];
const WOOD_DARK: [number, number, number] = [96, 78, 44];
/** Ferragem: a mesma em baú, porta e fornalha, para ler como um material só. */
const IRON_DARK: [number, number, number] = [74, 74, 80];
const IRON_LIGHT: [number, number, number] = [138, 138, 146];

/** Lombadas de uma prateleira: larguras e cores alternadas, altura de 5 px. */
function shelfBooks(y0: number): TexOp[] {
  const cores: Rgb[] = [
    [156, 48, 44], [46, 82, 156], [198, 174, 66], [58, 126, 70], [140, 70, 150],
  ];
  const larguras = [2, 1, 2, 2, 1, 2, 1, 2];
  const ops: TexOp[] = [];
  let x = 1;
  for (let i = 0; i < larguras.length && x < 15; i++) {
    const w = Math.min(larguras[i], 15 - x);
    ops.push(rect(x, y0, w, 5, cores[i % cores.length]));
    // Brilho na quina esquerda: é o que separa uma lombada da vizinha.
    ops.push(rect(x, y0, 1, 5, [236, 232, 220], 0.3));
    x += w + 1;
  }
  return ops;
}

export const TEXTURES: Record<string, TexRecipe> = {
  // --- pedras -------------------------------------------------------------
  'block/stone': {
    base: [125, 125, 125], noise: 'value', scale: 4, variance: 0.12,
    ops: [dither(0.06), emboss(0.2)],
  },
  'block/cobblestone': {
    base: [122, 122, 122], noise: 'cell', scale: 3, variance: 0.22,
    ops: [emboss(0.5), dither(0.05)],
  },
  'block/granite': {
    base: [149, 103, 85], noise: 'value', scale: 4, variance: 0.14,
    ops: [speckle([176, 128, 108], 0.12, 1), dither(0.05)],
  },
  'block/diorite': {
    base: [188, 188, 190], noise: 'cell', scale: 4, variance: 0.14,
    ops: [speckle([232, 232, 234], 0.1, 1), dither(0.05)],
  },
  'block/andesite': {
    base: [136, 138, 136], noise: 'value', scale: 5, variance: 0.1,
    ops: [speckle([110, 112, 110], 0.14, 1), dither(0.05)],
  },
  'block/stone_bricks': {
    base: [122, 122, 122], noise: 'value', scale: 5, variance: 0.1,
    ops: [bricks(8, 8, STONE_DARK), emboss(0.35), dither(0.04)],
  },
  'block/bedrock': {
    base: [85, 85, 85], noise: 'cell', scale: 5, variance: 0.35,
    ops: [emboss(0.6), dither(0.08)],
  },
  'block/obsidian': {
    base: [26, 20, 38], noise: 'cell', scale: 4, variance: 0.3,
    ops: [speckle([64, 48, 92], 0.06, 1), emboss(0.3)],
  },

  // --- terra e areia ------------------------------------------------------
  'block/dirt': {
    base: [134, 96, 67], noise: 'grain', scale: 6, variance: 0.16,
    ops: [speckle([110, 78, 54], 0.15, 1), dither(0.05)],
  },
  'block/coarse_dirt': {
    inherit: 'block/dirt', ops: [speckle([92, 66, 46], 0.22, 1)],
  },
  'block/podzol_top': {
    inherit: 'block/dirt', ops: [tintBy(0.75), speckle([120, 82, 36], 0.3, 1)],
  },
  // Cinza: o shader multiplica pela cor do bioma (doc 04 §4).
  'block/grass_top': {
    base: [235, 235, 235], noise: 'value', scale: 5, variance: 0.1,
    ops: [dither(0.05)],
  },
  // Overlay lateral: só a franja de grama é opaca, o resto é recortado.
  'block/grass_side_overlay': {
    base: [235, 235, 235], noise: 'value', scale: 6, variance: 0.12,
    ops: [
      (c) => {
        // Franja irregular nos 4–6 px superiores.
        for (let x = 0; x < 16; x++) {
          const h = 3 + ((c.seed + x * 7919) % 4);
          for (let y = 0; y < 16; y++) {
            if (y > h) c.data[((y * 16 + x) << 2) + 3] = 0;
          }
        }
      },
    ],
  },
  'block/sand': {
    base: [219, 207, 163], noise: 'grain', scale: 8, variance: 0.08,
    ops: [dither(0.05)],
  },
  'block/red_sand': {
    base: [190, 102, 33], noise: 'grain', scale: 8, variance: 0.09, ops: [dither(0.05)],
  },
  'block/gravel': {
    base: [131, 127, 126], noise: 'cell', scale: 5, variance: 0.28,
    ops: [speckle([90, 88, 88], 0.18, 1), emboss(0.4)],
  },
  'block/clay': {
    base: [160, 166, 179], noise: 'value', scale: 5, variance: 0.08, ops: [dither(0.05)],
  },
  'block/sandstone_top': {
    base: [222, 211, 168], noise: 'value', scale: 6, variance: 0.07, ops: [dither(0.04)],
  },
  'block/sandstone_side': {
    base: [217, 205, 160], noise: 'value', scale: 8, variance: 0.06,
    ops: [stripes('h', 4, 0.05), dither(0.04)],
  },
  'block/snow': {
    base: [246, 250, 251], noise: 'grain', scale: 10, variance: 0.04, ops: [dither(0.03)],
  },
  'block/ice': {
    base: [146, 184, 240], noise: 'value', scale: 3, variance: 0.1,
    alpha: 0.72, ops: [dither(0.05)],
  },

  // --- minérios -----------------------------------------------------------
  'block/coal_ore': { inherit: 'block/stone', ops: [oreBlobs([32, 32, 34], 6)] },
  'block/iron_ore': { inherit: 'block/stone', ops: [oreBlobs([200, 160, 132], 6)] },
  'block/copper_ore': { inherit: 'block/stone', ops: [oreBlobs([196, 118, 78], 6)] },
  'block/gold_ore': { inherit: 'block/stone', ops: [oreBlobs([238, 194, 74], 5)] },
  'block/redstone_ore': { inherit: 'block/stone', ops: [oreBlobs([206, 44, 44], 6)] },
  'block/lapis_ore': { inherit: 'block/stone', ops: [oreBlobs([54, 92, 186], 6)] },
  'block/diamond_ore': { inherit: 'block/stone', ops: [oreBlobs([94, 225, 224], 5)] },
  'block/emerald_ore': { inherit: 'block/stone', ops: [oreBlobs([64, 204, 96], 4)] },

  // --- madeira ------------------------------------------------------------
  'block/oak_log_side': {
    base: [105, 84, 50], noise: 'stripes', scale: 2, variance: 0.18,
    ops: [dither(0.08)],
  },
  'block/oak_log_top': {
    base: [152, 122, 73], noise: 'cell', scale: 2, variance: 0.08,
    ops: [rings(4, WOOD_DARK)],
  },
  'block/birch_log_side': {
    base: [216, 214, 205], noise: 'stripes', scale: 2, variance: 0.1,
    ops: [speckle([58, 58, 54], 0.05, 2), dither(0.05)],
  },
  'block/birch_log_top': {
    base: [196, 178, 123], noise: 'cell', scale: 2, variance: 0.08, ops: [rings(4, [140, 124, 84])],
  },
  'block/spruce_log_side': {
    base: [76, 56, 32], noise: 'stripes', scale: 2, variance: 0.2, ops: [dither(0.08)],
  },
  'block/spruce_log_top': {
    base: [116, 86, 50], noise: 'cell', scale: 2, variance: 0.08, ops: [rings(4, [70, 50, 28])],
  },
  'block/oak_planks': {
    base: [159, 132, 77], noise: 'stripes', scale: 1, variance: 0.1,
    ops: [border([120, 98, 56], 1), plankLines(4, WOOD_DARK), dither(0.05)],
  },
  'block/birch_planks': {
    base: [196, 179, 123], noise: 'stripes', scale: 1, variance: 0.08,
    ops: [border([160, 145, 98], 1), plankLines(4, [150, 136, 92]), dither(0.04)],
  },
  'block/spruce_planks': {
    base: [114, 84, 48], noise: 'stripes', scale: 1, variance: 0.1,
    ops: [border([86, 62, 34], 1), plankLines(4, [80, 58, 32]), dither(0.05)],
  },

  // --- vegetação (cinza, tintada por bioma) --------------------------------
  'block/oak_leaves': {
    base: [232, 232, 232], noise: 'cell', scale: 4, variance: 0.25,
    ops: [blobs([180, 180, 180], 6, 3), alphaMask('holes', 0.22)],
  },
  'block/spruce_leaves': {
    base: [210, 210, 210], noise: 'cell', scale: 5, variance: 0.3,
    ops: [blobs([160, 160, 160], 8, 2.5), alphaMask('holes', 0.26)],
  },
  'block/tall_grass': {
    base: [230, 230, 230], noise: 'stripes', scale: 2, variance: 0.2,
    ops: [alphaMask('cross', 0), dither(0.05)],
  },
  'block/dandelion': {
    base: [92, 150, 62], noise: 'flat', scale: 1, variance: 0,
    ops: [alphaMask('cross', 0), blobs([246, 226, 68], 3, 2)],
  },
  'block/poppy': {
    base: [92, 150, 62], noise: 'flat', scale: 1, variance: 0,
    ops: [alphaMask('cross', 0), blobs([214, 62, 54], 3, 2)],
  },
  'block/cactus_side': {
    base: [86, 132, 62], noise: 'value', scale: 6, variance: 0.1,
    ops: [stripes('v', 5, 0.08), speckle([54, 88, 40], 0.06, 1)],
  },
  'block/cactus_top': {
    base: [102, 148, 74], noise: 'value', scale: 5, variance: 0.1, ops: [dither(0.05)],
  },

  // --- construídos --------------------------------------------------------
  // Bancada: o topo é a grade 3×3 gravada na madeira, que é o que o jogador
  // procura quando varre o inventário. A lateral tem a gaveta e as ferramentas
  // penduradas — sem elas, era tábua com borda.
  'block/crafting_table_top': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.88),
      rect(1, 1, 14, 14, [150, 124, 72], 0.5),
      outline(1, 1, 14, 14, [74, 58, 32]),
      // Grade 3×3 sulcada.
      rect(5, 2, 1, 12, [74, 58, 32], 0.85),
      rect(10, 2, 1, 12, [74, 58, 32], 0.85),
      rect(2, 5, 12, 1, [74, 58, 32], 0.85),
      rect(2, 10, 12, 1, [74, 58, 32], 0.85),
      dither(0.05),
    ],
  },
  'block/crafting_table_side': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.78),
      // Tampo saliente, que é o que dá a silhueta de bancada de lado.
      rect(0, 0, 16, 3, [164, 136, 80]),
      rect(0, 3, 16, 1, [72, 56, 30]),
      // Gaveta funda na metade de baixo, com puxador.
      rect(2, 9, 12, 5, [86, 68, 38]),
      outline(2, 9, 12, 5, [58, 45, 24]),
      rect(3, 10, 10, 3, [128, 102, 58]),
      rect(7, 11, 3, 1, IRON_DARK),
      // Serra e martelo pendurados entre o tampo e a gaveta.
      rect(2, 6, 6, 1, IRON_LIGHT),
      rect(2, 5, 1, 3, [104, 80, 44]),
      rect(12, 5, 1, 3, [104, 80, 44]),
      rect(11, 4, 3, 2, IRON_LIGHT),
      dither(0.04),
    ],
  },
  // Fornalha: pedra emoldurada em ferro. Antes era pedregulho 8% mais escuro,
  // indistinguível do próprio pedregulho.
  'block/furnace_side': {
    inherit: 'block/cobblestone',
    ops: [
      tintBy(0.82),
      outline(0, 0, 16, 16, IRON_DARK),
      outline(1, 1, 14, 14, [96, 96, 102], 0.6),
      rect(0, 7, 16, 1, IRON_DARK, 0.7),
      dither(0.05),
    ],
  },
  'block/furnace_front': {
    inherit: 'block/cobblestone',
    ops: [
      (c) => {
        // Boca escura no terço inferior.
        for (let y = 8; y < 14; y++) {
          for (let x = 3; x < 13; x++) {
            const o = (y * 16 + x) << 2;
            c.data[o] = 32; c.data[o + 1] = 30; c.data[o + 2] = 30;
          }
        }
      },
    ],
  },
  // Baú: madeira escura, tampa separada por uma faixa de ferro, fechadura no
  // meio. Antes era tábua com 15% menos brilho e uma borda de 1 px.
  'block/chest_side': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.7),
      outline(0, 0, 16, 16, [52, 40, 22]),
      // Tampa: o terço de cima, mais claro, fechado por cinta de ferro.
      rect(1, 1, 14, 4, [134, 106, 58], 0.55),
      rect(0, 5, 16, 2, IRON_DARK),
      rect(0, 5, 16, 1, IRON_LIGHT, 0.5),
      // Fechadura.
      rect(6, 4, 4, 5, IRON_DARK),
      rect(7, 6, 2, 2, [32, 28, 24]),
      dither(0.05),
    ],
  },
  'block/chest_top': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.72),
      outline(0, 0, 16, 16, [52, 40, 22]),
      // Duas cintas de ferro atravessando a tampa.
      rect(3, 0, 2, 16, IRON_DARK),
      rect(11, 0, 2, 16, IRON_DARK),
      rect(3, 0, 1, 16, IRON_LIGHT, 0.4),
      rect(11, 0, 1, 16, IRON_LIGHT, 0.4),
      dither(0.05),
    ],
  },
  'block/glass': {
    base: [222, 238, 244], noise: 'flat', scale: 1, variance: 0, alpha: 0.28,
    ops: [alphaMask('frame', 0), border([182, 208, 218], 1)],
  },
  'block/glowstone': {
    base: [200, 160, 96], noise: 'cell', scale: 4, variance: 0.2,
    ops: [speckle([255, 232, 168], 0.2, 1), emboss(0.3)],
  },
  // Estante: os livros ocupavam 1 px a cada 2 e sumiam contra a tábua. Agora
  // as lombadas são grossas, o fundo atrás delas é escuro e as prateleiras são
  // madeira visível em cima e embaixo.
  'block/bookshelf': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.8),
      // Vão escuro das duas prateleiras.
      rect(1, 2, 14, 5, [46, 36, 22]),
      rect(1, 9, 14, 5, [46, 36, 22]),
      ...shelfBooks(2),
      ...shelfBooks(9),
      // Bordas das prateleiras, em madeira clara.
      rect(0, 7, 16, 2, [150, 124, 72]),
      rect(0, 0, 16, 2, [150, 124, 72]),
      rect(0, 14, 16, 2, [150, 124, 72]),
      dither(0.05),
    ],
  },
  // Mesa de encantamento: obsidiana com um livro aberto no topo e runas na
  // lateral. Tudo desenhado a partir da própria obsidiana — nenhum asset.
  'block/enchanting_table_top': {
    inherit: 'block/obsidian',
    ops: [
      (c) => {
        // Livro aberto: duas páginas claras com a lombada escura no meio.
        for (let y = 4; y < 13; y++) {
          for (let x = 2; x < 14; x++) {
            const spine = x === 7 || x === 8;
            const o = (y * 16 + x) << 2;
            if (spine) {
              c.data[o] = 96; c.data[o + 1] = 24; c.data[o + 2] = 24;
            } else {
              const shade = y > 10 ? 190 : 226;
              c.data[o] = shade; c.data[o + 1] = shade - 6; c.data[o + 2] = shade - 24;
            }
          }
        }
      },
    ],
  },
  'block/enchanting_table_side': {
    inherit: 'block/obsidian',
    ops: [
      (c) => {
        // Runas: riscos magenta espalhados de forma determinística pela seed.
        for (let i = 0; i < 10; i++) {
          const x = 1 + ((c.seed + i * 6151) % 14);
          const y = 2 + ((c.seed + i * 2777) % 12);
          const o = (y * 16 + x) << 2;
          c.data[o] = 208; c.data[o + 1] = 96; c.data[o + 2] = 224;
        }
      },
    ],
  },

  // TNT: era `block/oak_planks`, cubo idêntico a tábuas — e num bloco que
  // explode isso é risco de jogo, não só feiura. Faixa vermelha com as letras,
  // topo com o pavio.
  'block/tnt_side': {
    base: [176, 54, 42], noise: 'value', scale: 5, variance: 0.08,
    ops: [
      rect(0, 0, 16, 4, [178, 150, 106]),
      rect(0, 12, 16, 4, [178, 150, 106]),
      rect(0, 4, 16, 1, [120, 34, 26]),
      rect(0, 11, 16, 1, [120, 34, 26]),
      // "TNT" em branco no meio da faixa vermelha.
      rect(2, 6, 3, 1, [240, 240, 236]), rect(3, 6, 1, 4, [240, 240, 236]),
      rect(6, 6, 1, 4, [240, 240, 236]), rect(8, 6, 1, 4, [240, 240, 236]),
      rect(7, 7, 1, 2, [240, 240, 236]),
      rect(10, 6, 3, 1, [240, 240, 236]), rect(11, 6, 1, 4, [240, 240, 236]),
      dither(0.05),
    ],
  },
  'block/tnt_top': {
    base: [178, 150, 106], noise: 'value', scale: 5, variance: 0.08,
    ops: [
      outline(0, 0, 16, 16, [132, 108, 74]),
      rect(6, 6, 4, 4, [120, 34, 26]),
      rect(7, 7, 2, 2, [44, 40, 38]),
      rect(9, 3, 1, 4, [70, 60, 44]),
      dither(0.05),
    ],
  },
  'block/tnt_bottom': {
    base: [150, 124, 86], noise: 'value', scale: 5, variance: 0.08,
    ops: [outline(0, 0, 16, 16, [116, 94, 64]), dither(0.05)],
  },
  // Cama: era `block/wool_white`, um cubo de lã. Agora travesseiro e colcha no
  // topo, e estrado de madeira com o colchão aparecendo na lateral.
  'block/bed_top': {
    base: [176, 44, 44], noise: 'grain', scale: 10, variance: 0.06,
    ops: [
      outline(0, 0, 16, 16, [108, 28, 28]),
      rect(2, 1, 12, 5, [238, 238, 232]),
      outline(2, 1, 12, 5, [198, 198, 192]),
      rect(1, 8, 14, 7, [196, 52, 52]),
      rect(1, 8, 14, 1, [232, 96, 96], 0.6),
      dither(0.04),
    ],
  },
  'block/bed_side': {
    base: [150, 124, 72], noise: 'stripes', scale: 1, variance: 0.08,
    ops: [
      plankLines(4, WOOD_DARK),
      rect(0, 3, 16, 6, [196, 52, 52]),
      rect(0, 3, 16, 1, [238, 238, 232]),
      rect(0, 9, 16, 1, [108, 28, 28]),
      border([104, 84, 48], 1),
      dither(0.04),
    ],
  },
  // Porta: era `block/oak_planks`. Dois painéis afundados e a maçaneta.
  'block/oak_door': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.88),
      outline(0, 0, 16, 16, [82, 64, 36]),
      rect(2, 2, 12, 5, [150, 124, 72], 0.6),
      outline(2, 2, 12, 5, [86, 68, 38]),
      rect(2, 9, 12, 5, [150, 124, 72], 0.6),
      outline(2, 9, 12, 5, [86, 68, 38]),
      rect(12, 7, 2, 2, IRON_LIGHT),
      dither(0.04),
    ],
  },

  // --- apoio de estrutura e decoração (M6) --------------------------------
  'block/ladder': {
    base: [140, 112, 66], noise: 'flat', scale: 1, variance: 0,
    ops: [
      (c) => {
        // Dois montantes e os degraus; o resto é vazado.
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const rail = x < 3 || x > 12;
            const rung = y % 5 < 2;
            if (!rail && !rung) c.data[((y * 16 + x) << 2) + 3] = 0;
          }
        }
      },
    ],
  },
  'block/mossy_cobblestone': {
    inherit: 'block/cobblestone',
    ops: [speckle([78, 112, 62], 0.35, 2), dither(0.05)],
  },
  'block/mob_spawner': {
    base: [28, 32, 38], noise: 'value', scale: 4, variance: 0.1,
    ops: [
      (c) => {
        // Grade de barras: o vazio entre elas é transparente, como no gênero.
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            if (x % 4 !== 0 && y % 4 !== 0) c.data[((y * 16 + x) << 2) + 3] = 0;
          }
        }
      },
      border([18, 20, 24], 1),
    ],
  },
  'block/cobweb': {
    base: [236, 236, 240], noise: 'flat', scale: 1, variance: 0,
    ops: [
      (c) => {
        // Teia: só as diagonais e a cruz central ficam opacas.
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const web = x === y || x === 15 - y || x === 8 || y === 8
              || (x + y) % 8 === 0;
            if (!web) c.data[((y * 16 + x) << 2) + 3] = 0;
          }
        }
      },
    ],
  },
  'block/rail': {
    base: [120, 100, 74], noise: 'flat', scale: 1, variance: 0,
    ops: [
      (c) => {
        // Dormentes de madeira com dois trilhos de metal por cima.
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const o = (y * 16 + x) << 2;
            const sleeper = y % 4 < 2;
            const metal = x === 4 || x === 5 || x === 10 || x === 11;
            if (metal) {
              c.data[o] = 176; c.data[o + 1] = 176; c.data[o + 2] = 184;
            } else if (!sleeper) {
              c.data[o + 3] = 0;
            }
          }
        }
      },
    ],
  },
  'block/oak_sign': {
    inherit: 'block/oak_planks',
    ops: [
      border([92, 72, 42], 1),
      (c) => {
        // Três linhas de "escrita" ilegível — o que o olho lê como placa.
        for (let line = 0; line < 3; line++) {
          const y = 5 + line * 3;
          for (let x = 3; x < 13; x += 2) {
            const o = (y * 16 + x) << 2;
            c.data[o] = 60; c.data[o + 1] = 46; c.data[o + 2] = 28;
          }
        }
      },
    ],
  },
  'block/painting': {
    base: [122, 92, 56], noise: 'flat', scale: 1, variance: 0,
    ops: [
      border([70, 50, 28], 2),
      (c) => {
        // Uma paisagem abstrata determinística: céu, morro e sol.
        for (let y = 2; y < 14; y++) {
          for (let x = 2; x < 14; x++) {
            const o = (y * 16 + x) << 2;
            const hill = y > 9 + ((x * 7 + c.seed) % 3);
            if (hill) {
              c.data[o] = 58; c.data[o + 1] = 108; c.data[o + 2] = 52;
            } else {
              c.data[o] = 122; c.data[o + 1] = 168; c.data[o + 2] = 226;
            }
          }
        }
        for (let y = 3; y < 6; y++) {
          for (let x = 10; x < 13; x++) {
            const o = (y * 16 + x) << 2;
            c.data[o] = 248; c.data[o + 1] = 226; c.data[o + 2] = 120;
          }
        }
      },
    ],
  },

  'block/iron_block': {
    base: [219, 219, 219], noise: 'value', scale: 8, variance: 0.05,
    ops: [border([180, 180, 180], 1), dither(0.03)],
  },
  'block/gold_block': {
    base: [246, 208, 62], noise: 'value', scale: 8, variance: 0.06,
    ops: [border([206, 168, 40], 1), dither(0.03)],
  },
  'block/diamond_block': {
    base: [98, 219, 214], noise: 'value', scale: 6, variance: 0.08,
    ops: [border([70, 178, 176], 1), speckle([190, 246, 244], 0.1, 1)],
  },
  'block/wool_white': {
    base: [233, 236, 236], noise: 'grain', scale: 12, variance: 0.06, ops: [dither(0.04)],
  },
  'block/torch': {
    base: [140, 108, 60], noise: 'flat', scale: 1, variance: 0,
    ops: [alphaMask('cross', 0), blobs([255, 226, 130], 2, 2)],
  },

  // --- fluidos (animados) -------------------------------------------------
  'block/water': {
    base: [63, 118, 228], noise: 'value', scale: 3, variance: 0.06, alpha: 0.75,
    frames: 8,
  },
  'block/lava': {
    base: [214, 92, 24], noise: 'value', scale: 3, variance: 0.32,
    frames: 16,
  },

  // --- agricultura (M6) ---------------------------------------------------
  'block/farmland_dry': {
    inherit: 'block/dirt', ops: [tintBy(0.92), furrows([88, 62, 40])],
  },
  'block/farmland_wet': {
    inherit: 'block/dirt', ops: [tintBy(0.62), furrows([48, 32, 20])],
  },
  ...cropTextures(),

  // --- utilidade ----------------------------------------------------------
  ...crackStages(),

  /** Textura de destaque para blocos desconhecidos — nunca deve aparecer em jogo. */
  'block/missing': {
    base: [255, 0, 220], noise: 'flat', scale: 1, variance: 0,
    ops: [bricks(8, 8, [16, 16, 16])],
  },
};

/**
 * Texturas de plantação, uma por estágio (doc 04 §2.5: `crops: age 0..7`).
 *
 * Trigo tem 8 estágios, cenoura e batata 4 — o bloco mapeia idade → estágio na
 * própria tabela de blocos, então acrescentar uma plantação nova não mexe aqui.
 */
function cropTextures(): Record<string, TexRecipe> {
  const crops: readonly { name: string; steps: number; stalk: Rgb; tip: Rgb }[] = [
    { name: 'wheat', steps: 8, stalk: [110, 156, 62], tip: [216, 186, 86] },
    { name: 'carrots', steps: 4, stalk: [72, 148, 62], tip: [232, 132, 44] },
    { name: 'potatoes', steps: 4, stalk: [88, 152, 72], tip: [214, 206, 108] },
  ];
  const out: Record<string, TexRecipe> = {};
  for (const crop of crops) {
    for (let step = 0; step < crop.steps; step++) {
      out[`block/${crop.name}_${step}`] = {
        base: crop.stalk, noise: 'flat', scale: 1, variance: 0,
        ops: [cropRows(step / (crop.steps - 1), crop.stalk, crop.tip)],
      };
    }
  }
  return out;
}

/**
 * Os 10 estágios de rachadura desenhados sobre o bloco sendo quebrado
 * (doc 06 §4).
 *
 * É **um único padrão** de fissuras, revelado progressivamente: cada pixel
 * ganha um "estágio de revelação" pela distância que percorreu ao longo do
 * ramo, e o estágio N desenha tudo que tem revelação ≤ N. Assim a rachadura
 * cresce do centro para fora e nunca some.
 *
 * A primeira versão fazia cada estágio herdar o anterior e somar ramos novos;
 * no estágio 6 já eram ~35 ramos e a textura virava uma mancha preta sólida.
 * O bloco tem que continuar reconhecível até o último estágio.
 */
function crackStages(): Record<string, TexRecipe> {
  const pattern = buildCrackPattern();
  const out: Record<string, TexRecipe> = {};
  for (let stage = 0; stage < 10; stage++) {
    out[`block/destroy_stage_${stage}`] = {
      // Branco: com blend de multiplicação, só as fissuras escurecem o bloco.
      base: [255, 255, 255],
      noise: 'flat',
      variance: 0,
      ops: [drawCracks(pattern, stage)],
    };
  }
  return out;
}

/** Estágio de revelação de cada pixel; 255 = nunca faz parte da rachadura. */
function buildCrackPattern(): Uint8Array {
  const reveal = new Uint8Array(256).fill(255);
  const BRANCHES = 5;
  const STEPS = 8;

  for (let b = 0; b < BRANCHES; b++) {
    let x = 7.5;
    let y = 7.5;
    // Ângulo áureo: espalha os ramos sem precisar de tabela.
    const angle = b * 2.399963;
    let dx = Math.cos(angle);
    let dy = Math.sin(angle);

    for (let step = 0; step < STEPS; step++) {
      // Desvio determinístico: a mesma rachadura em qualquer máquina.
      const h = (Math.imul(b * 131 + step * 17 + 0x9e37, 2654435761) >>> 0);
      dx += ((h & 255) / 255 - 0.5) * 0.8;
      dy += (((h >>> 8) & 255) / 255 - 0.5) * 0.8;
      const norm = Math.hypot(dx, dy) || 1;
      dx /= norm;
      dy /= norm;
      x += dx;
      y += dy;

      const px = Math.round(x) & 15;
      const py = Math.round(y) & 15;
      const stage = Math.min(9, Math.floor((step * 10) / STEPS));
      const i = py * 16 + px;
      if (stage < reveal[i]) reveal[i] = stage;

      // A partir da metade, um pixel lateral engrossa a fissura.
      if (step >= STEPS / 2) {
        const sideX = (Math.round(x + dy) & 15);
        const sideY = (Math.round(y - dx) & 15);
        const side = sideY * 16 + sideX;
        const sideStage = Math.min(9, stage + 1);
        if (sideStage < reveal[side]) reveal[side] = sideStage;
      }
    }
  }
  return reveal;
}

/** Pinta os pixels cuja revelação já chegou em `stage`. */
function drawCracks(reveal: Uint8Array, stage: number): TexOp {
  return (c) => {
    const d = c.data;
    for (let i = 0; i < 256; i++) {
      if (reveal[i] > stage) continue;
      const o = i << 2;
      d[o] = 42; d[o + 1] = 42; d[o + 2] = 44;
    }
  };
}

/** Operador aplicado a cada quadro extra de uma textura animada. */
export const ANIMATED_OPS: Record<string, (frame: number, total: number) => TexOp> = {
  'block/water': (frame, total) => flow(2, frame, total),
  'block/lava': (frame, total) => flow(4, frame, total),
};

/** Ordem estável de geração — o índice de camada é resolvido por nome. */
export const TEXTURE_NAMES: readonly string[] = Object.keys(TEXTURES);

/** Tints de bioma padrão, usados enquanto os biomas não existem (M1). */
export const DEFAULT_TINTS = {
  grass: [0x79, 0xc0, 0x5a] as const,
  foliage: [0x59, 0xae, 0x30] as const,
  water: [0x3f, 0x76, 0xe4] as const,
};
