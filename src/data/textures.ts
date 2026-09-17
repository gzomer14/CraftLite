/**
 * Receitas de textura, declarativas (doc 13 §2.2).
 *
 * Adicionar uma textura nova é uma linha aqui — nunca um `case` em um `switch`.
 * A ordem desta tabela define o índice de camada no `TEXTURE_2D_ARRAY`, mas
 * nada no código deve depender dela: use `atlas.layerOf('block/stone')`.
 */

import {
  alphaMask, blobs, border, bricks, cropRows, dither, emboss, flow, furrows,
  oreBlobs, outline, pattern, plankLines, rect, rings, speckle, stripes, tintBy,
  type Rgb, type TexOp, type TexRecipe,
} from '../render/texgen';
import { DYES, type DyeDef } from './dyes';

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

/**
 * Cruz de pó de redstone sobre fundo vazado (M7).
 *
 * O pó é desenhado como um ladrilho inteiro deitado no chão, não como uma
 * geometria que muda com a conexão: é a mesma escolha do gênero e custa 6 quads
 * por bloco em vez de 30. O núcleo central sai mais claro, para o cruzamento
 * ler como cruzamento.
 */
function dustCross(color: Rgb): TexOp {
  return (c) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const o = (y * 16 + x) << 2;
        const inX = x >= 6 && x <= 9;
        const inY = y >= 6 && y <= 9;
        if (!inX && !inY) { c.data[o + 3] = 0; continue; }
        const core = inX && inY ? 1.3 : 1;
        c.data[o] = color[0] * core;
        c.data[o + 1] = color[1] * core;
        c.data[o + 2] = color[2] * core;
        c.data[o + 3] = 255;
      }
    }
  };
}

/**
 * Portas das outras madeiras (M8): a mesma marcenaria do carvalho, sobre a
 * tábua de cada uma. Escrever à mão seria copiar o mesmo bloco de `ops` três
 * vezes e deixar as três divergirem na primeira mudança.
 */
function doorOps(top: boolean): TexOp[] {
  if (top) {
    return [
      tintBy(0.88),
      outline(0, 0, 16, 16, [82, 64, 36]),
      rect(2, 2, 12, 9, [150, 124, 72], 0.6),
      outline(2, 2, 12, 9, [86, 68, 38]),
      rect(1, 12, 14, 2, [118, 96, 54]),
      rect(11, 13, 3, 2, IRON_LIGHT),
      dither(0.04),
    ];
  }
  return [
    tintBy(0.88),
    outline(0, 0, 16, 16, [82, 64, 36]),
    rect(2, 4, 12, 10, [150, 124, 72], 0.6),
    outline(2, 4, 12, 10, [86, 68, 38]),
    rect(11, 1, 3, 2, IRON_LIGHT),
    rect(11, 1, 3, 1, [196, 196, 204], 0.7),
    dither(0.04),
  ];
}

function woodDoorTextures(): Record<string, TexRecipe> {
  const out: Record<string, TexRecipe> = {};
  for (const wood of ['birch', 'spruce']) {
    out[`block/${wood}_door`] = { inherit: `block/${wood}_planks`, ops: doorOps(false) };
    out[`block/${wood}_door_top`] = { inherit: `block/${wood}_planks`, ops: doorOps(true) };
  }
  return out;
}

/** Uma receita de pó por nível de brilho. */
function dustTextures(): Record<string, TexRecipe> {
  const cores: Rgb[] = [[72, 14, 14], [132, 26, 24], [186, 38, 32], [244, 68, 52]];
  const out: Record<string, TexRecipe> = {};
  for (let i = 0; i < cores.length; i++) {
    out[`block/redstone_dust_${i}`] = {
      base: cores[i], noise: 'flat', scale: 1, variance: 0, ops: [dustCross(cores[i])],
    };
  }
  return out;
}

/**
 * Leito de trilho reto: dormentes de madeira com dois trilhos de metal por
 * cima, o resto vazado. Só a cor do metal muda entre comum e motorizado.
 */
function railBed(metalColor: Rgb): TexOp {
  return (c) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 0; x < 16; x++) {
        const o = (y * 16 + x) << 2;
        const sleeper = y % 4 < 2;
        const metal = x === 4 || x === 5 || x === 10 || x === 11;
        if (metal) {
          c.data[o] = metalColor[0]; c.data[o + 1] = metalColor[1]; c.data[o + 2] = metalColor[2];
        } else if (!sleeper) {
          c.data[o + 3] = 0;
        }
      }
    }
  };
}

/** Faixa entre os dois trilhos: a brasa do motorizado e a placa do detector. */
function railGlow(color: Rgb): TexOp {
  return (c) => {
    for (let y = 0; y < 16; y++) {
      for (let x = 7; x <= 8; x++) {
        const o = (y * 16 + x) << 2;
        c.data[o] = color[0]; c.data[o + 1] = color[1]; c.data[o + 2] = color[2];
        c.data[o + 3] = 255;
      }
    }
  };
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
  /*
   * Grama alta e flores (M8): silhueta, não um X.
   *
   * As três usavam `alphaMask('cross')`, que recorta **as duas diagonais do
   * ladrilho**. Isso vinha de confundir a máscara com a geometria: a planta é
   * desenhada em dois quads cruzados, e cada quad mostra o ladrilho inteiro —
   * se o ladrilho também é um X, o resultado é uma estrela amarela, não uma
   * flor. No inventário, onde o sprite passou a ser o ladrilho de frente, o X
   * ficou impossível de ignorar.
   *
   * Agora são desenhos: touceira que nasce do chão, dente-de-leão com haste e
   * papoula com botão. Continuam vazadas em volta, que é o que a cruz precisa.
   *
   * A grama continua **cinza** de propósito: ela é tingida pela cor do bioma
   * (doc 04 §4), e tingir um desenho colorido daria verde sobre verde.
   */
  'block/tall_grass': {
    base: [230, 230, 230], noise: 'flat', scale: 1, variance: 0,
    ops: [
      pattern([
        '................',
        '..M.........M...',
        '..M....M....M...',
        '..M...MM....M...',
        '.dM..MM.M..Md...',
        '.dM..M..M..Md...',
        '.dM.MM..M.MMd...',
        '.dM.M...M.M.d...',
        '.dM.M...MMM.d...',
        '.dMMM...MM..d...',
        '..dM.....M..d...',
        '..dM.....M.dd...',
        '...d.....M.d....',
        '...d.....d.d....',
        '................',
        '................',
      ], { M: [230, 230, 230], d: [176, 176, 176] }),
      dither(0.05),
    ],
  },
  'block/dandelion': {
    base: [92, 150, 62], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '................',
      '................',
      '.......FF.......',
      '......FAAF......',
      '.....FAAAAF.....',
      '......FAAF......',
      '.......FF.......',
      '.......h........',
      '.......h........',
      '....L..h........',
      '...LLL.h..LL....',
      '....L..hLLLL....',
      '.......h..LL....',
      '......hh........',
      '................',
      '................',
    ], {
      A: [246, 226, 68], F: [214, 186, 44], h: [78, 132, 54], L: [92, 150, 62],
    })],
  },
  'block/poppy': {
    base: [92, 150, 62], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '................',
      '................',
      '......FAAF......',
      '.....FAAAAF.....',
      '.....AAddAA.....',
      '.....FAAAAF.....',
      '......FAAF......',
      '.......h........',
      '.......h........',
      '....L..h........',
      '...LLL.h..LL....',
      '....L..hLLLL....',
      '.......h..LL....',
      '......hh........',
      '................',
      '................',
    ], {
      A: [214, 62, 54], F: [166, 40, 36], d: [52, 40, 36],
      h: [78, 132, 54], L: [92, 150, 62],
    })],
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
      tintBy(1.08),
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
      tintBy(1.02),
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
  /*
   * Fornalha (redesenhada no M8): **boca**, grelha e moldura de ferro.
   *
   * O desenho anterior era pedregulho 18% mais escuro com uma moldura fina —
   * de relance, uma pedra. Relato do jogador: *"a fornalha está muito feia,
   * parece um bloco normal de pedra tanto no chão quanto no inventário"*.
   *
   * O que identifica uma fornalha é a **boca**: um buraco escuro com grelha na
   * metade de baixo. Ela aparece nos quatro lados, e não só na frente como no
   * gênero — o formato de vértice não guarda rotação de textura (doc 01 §5.1),
   * então "frente" não é representável. Quatro bocas lêem como fornalha; uma
   * pedra lisa não lê como nada.
   */
  'block/furnace_side': {
    inherit: 'block/cobblestone',
    ops: [
      tintBy(0.78),
      // Moldura de ferro rebatida, com luz em cima e sombra embaixo.
      border(IRON_DARK, 2),
      rect(2, 2, 12, 1, [150, 150, 158], 0.7),
      rect(2, 13, 12, 1, [52, 52, 58], 0.8),
      // Boca: o buraco escuro que faz a peça ser reconhecida.
      rect(3, 7, 10, 6, [30, 26, 26]),
      outline(3, 7, 10, 6, IRON_DARK),
      // Grelha: três barras verticais dentro da boca.
      rect(5, 8, 1, 4, [92, 88, 92]),
      rect(8, 8, 1, 4, [92, 88, 92]),
      rect(11, 8, 1, 4, [92, 88, 92]),
      // Soleira clara embaixo da boca, que dá profundidade ao buraco.
      rect(3, 12, 10, 1, [120, 118, 124], 0.8),
      dither(0.04),
    ],
  },
  /** Topo: a mesma pedra com a boca de carga no meio. */
  'block/furnace_top': {
    inherit: 'block/cobblestone',
    ops: [
      tintBy(0.78),
      border(IRON_DARK, 2),
      rect(5, 5, 6, 6, [42, 38, 38]),
      outline(5, 5, 6, 6, [124, 122, 128]),
      rect(6, 6, 4, 1, [96, 92, 96], 0.7),
      dither(0.04),
    ],
  },
  /*
   * Fornalha acesa (M8): a mesma pedra, com a boca cheia de brasa.
   *
   * A diferença tem que ser visível **de longe e de relance** — é o que diz ao
   * jogador que a fundição está andando sem ele abrir a tela. Daí a boca
   * inteira acesa, e não uma fagulha.
   */
  'block/furnace_lit': {
    inherit: 'block/furnace_side',
    ops: [
      // A boca **inteira** cheia de brasa: é o contraste com a apagada que
      // avisa, de longe e de relance, que a fundição está andando.
      rect(4, 8, 9, 5, [214, 86, 22]),
      rect(4, 9, 9, 4, [244, 146, 44]),
      rect(5, 10, 7, 3, [255, 202, 100]),
      rect(6, 11, 5, 2, [255, 242, 190]),
      // As barras da grelha continuam visíveis, agora contra a brasa.
      rect(5, 8, 1, 5, [138, 56, 20]),
      rect(8, 8, 1, 5, [138, 56, 20]),
      rect(11, 8, 1, 5, [138, 56, 20]),
      dither(0.04),
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
  /*
   * Baú: madeira **escura** com muito ferro.
   *
   * Ele e a bancada eram dois cubos de tábua clara com detalhes finos, e no
   * slot de 16 px isso é o mesmo desenho — relato do jogador: *"a mesa de
   * trabalho e o baú estão com textura muito semelhante, difícil distinguir
   * batendo o olho"*. A separação agora é de **valor**, não de detalhe: o baú é
   * escuro e ferrado, a bancada é clara com a grade sulcada. A forma ajuda o
   * resto — o baú é menor que o bloco desde o M8 e tem tranca.
   */
  'block/chest_side': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.44),
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
      tintBy(0.48),
      outline(0, 0, 16, 16, [52, 40, 22]),
      // Duas cintas de ferro atravessando a tampa.
      rect(3, 0, 2, 16, IRON_DARK),
      rect(11, 0, 2, 16, IRON_DARK),
      rect(3, 0, 1, 16, IRON_LIGHT, 0.4),
      rect(11, 0, 1, 16, IRON_LIGHT, 0.4),
      dither(0.05),
    ],
  },
  /*
   * Vidro (corrigido no M8): moldura opaca, brilho de canto, miolo vazado.
   *
   * **Era invisível.** A receita antiga pintava o ladrilho inteiro com
   * `alpha: 0.28` e recortava tudo fora da moldura — só que o vidro é desenhado
   * no passe **recortado**, cujo shader descarta qualquer pixel abaixo de
   * alfa 0,5. Nenhum pixel passava: uma janela colocada não deixava rastro
   * nenhum na tela, e no inventário o slot parecia vazio.
   *
   * A correção não é "deixar opaco". O que o jogador precisa é **ver através e
   * saber que há vidro ali**, e quem resolve isso em 16 px é o que a pixel art
   * sempre fez: uma **moldura** de 1 px e um **reflexo** em diagonal. Tudo o
   * mais fica com alfa zero, então a janela continua sendo janela — ~80% do
   * ladrilho é buraco de verdade, não translucidez.
   *
   * Vale notar por que não foi para o passe translúcido, que daria um véu
   * azulado bonito: lá o desenho é ordenado de trás para frente e não escreve
   * profundidade, e vidro é justamente o bloco que o jogador empilha em parede
   * inteira. Numa GPU de 2016 isso é preenchimento caro por um ganho que a
   * moldura já entrega.
   */
  'block/glass': {
    base: [226, 240, 246], noise: 'flat', scale: 1, variance: 0, alpha: 0,
    ops: [
      // Moldura: as quatro bordas do ladrilho, opacas.
      (c) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            if (x !== 0 && y !== 0 && x !== 15 && y !== 15) continue;
            const o = (y * 16 + x) << 2;
            const canto = (x === 0 || x === 15) && (y === 0 || y === 15);
            c.data[o] = canto ? 236 : 196;
            c.data[o + 1] = canto ? 246 : 222;
            c.data[o + 2] = canto ? 250 : 232;
            c.data[o + 3] = 255;
          }
        }
      },
      // Reflexo: duas riscas na diagonal, como luz batendo na vidraça.
      (c) => {
        const risca = (x0: number, y0: number, n: number, cor: Rgb) => {
          for (let i = 0; i < n; i++) {
            const x = x0 + i;
            const y = y0 + i;
            if (x < 1 || y < 1 || x > 14 || y > 14) continue;
            const o = (y * 16 + x) << 2;
            c.data[o] = cor[0];
            c.data[o + 1] = cor[1];
            c.data[o + 2] = cor[2];
            c.data[o + 3] = 255;
          }
        };
        risca(3, 10, 5, [244, 250, 252]);
        risca(4, 10, 5, [214, 232, 240]);
        risca(9, 3, 3, [244, 250, 252]);
      },
    ],
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
  /*
   * Porta (M8): duas folhas, uma por metade do bloco.
   *
   * Ela ocupa dois blocos desde 2026-09-16, então **a textura foi partida em
   * duas**: a de baixo tem a maçaneta encostada na divisa, a de cima tem a
   * almofada alta e a travessa. Com a mesma textura nas duas metades a porta
   * lia como dois quadros empilhados, que é o defeito que ela tinha.
   */
  'block/oak_door': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.88),
      outline(0, 0, 16, 16, [82, 64, 36]),
      rect(2, 4, 12, 10, [150, 124, 72], 0.6),
      outline(2, 4, 12, 10, [86, 68, 38]),
      rect(11, 1, 3, 2, IRON_LIGHT),
      rect(11, 1, 3, 1, [196, 196, 204], 0.7),
      dither(0.04),
    ],
  },
  ...woodDoorTextures(),
  'block/oak_door_top': {
    inherit: 'block/oak_planks',
    ops: [
      tintBy(0.88),
      outline(0, 0, 16, 16, [82, 64, 36]),
      rect(2, 2, 12, 9, [150, 124, 72], 0.6),
      outline(2, 2, 12, 9, [86, 68, 38]),
      rect(1, 12, 14, 2, [118, 96, 54]),
      rect(11, 13, 3, 2, IRON_LIGHT),
      dither(0.04),
    ],
  },

  // --- apoio de estrutura e decoração (M6) --------------------------------
  /*
   * Escada de mão (M8): madeira lisa, sem recorte.
   *
   * A textura **era** a escada inteira desenhada com o vão vazado, porque a
   * geometria era uma chapa só. Agora montante e degrau são caixas de verdade
   * (`world/mesh/shapes.ts`), e cada caixa mostra o ladrilho inteiro espremido
   * na largura dela — com o recorte antigo, um montante de 2/16 podia calhar
   * de amostrar o vão e sumir. Aqui é madeira, e quem desenha a escada é a
   * forma.
   */
  'block/ladder': {
    base: [146, 116, 68], noise: 'grain', scale: 5, variance: 0.12,
    ops: [border([104, 82, 46], 1), dither(0.04)],
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
    ops: [railBed([176, 176, 184])],
  },
  // Curva: os dois trilhos viram no meio do ladrilho, em diagonal.
  'block/rail_curved': {
    base: [120, 100, 74], noise: 'flat', scale: 1, variance: 0,
    ops: [
      (c) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const o = (y * 16 + x) << 2;
            // Duas diagonais paralelas ligando a borda +Z à borda +X.
            const d = Math.abs(x + y - 10);
            const metal = d <= 1 || Math.abs(x + y - 16) <= 1;
            const sleeper = (x + y) % 4 < 2;
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
  // Motorizado: dormente escuro e trilho dourado; aceso, brasa entre eles.
  'block/powered_rail': {
    base: [92, 70, 52], noise: 'flat', scale: 1, variance: 0,
    ops: [railBed([206, 172, 74])],
  },
  'block/powered_rail_on': {
    base: [92, 70, 52], noise: 'flat', scale: 1, variance: 0,
    ops: [railBed([246, 214, 96]), railGlow([230, 96, 48])],
  },
  // Detector: trilho comum com a placa de pressão entre os trilhos.
  'block/detector_rail': {
    base: [120, 100, 74], noise: 'flat', scale: 1, variance: 0,
    ops: [railBed([176, 176, 184]), railGlow([108, 108, 116])],
  },
  'block/detector_rail_on': {
    base: [120, 100, 74], noise: 'flat', scale: 1, variance: 0,
    ops: [railBed([176, 176, 184]), railGlow([226, 72, 60])],
  },
  /*
   * Placa (M8, retrabalhada em 2026-09-17).
   *
   * Ela era tábua de carvalho com **três linhas de rabisco** desenhadas por
   * cima — a "escrita" ilegível que fazia o olho ler "placa" quando não havia
   * texto de verdade. Agora há: o jogador escreve, e o rabisco virou justamente
   * o ruído que escondia o que ele escreveu. Relato de campo: *"por conta de
   * sua textura mal dá para visualizar o texto escrito"*.
   *
   * Então a tábua desta placa é **lisa e clara**, e é a única superfície do
   * jogo desenhada para servir de fundo de leitura: sem sulco de tábua (o
   * `plankLines` da tábua comum corta a letra na horizontal), com o grão em
   * variância baixa e uma moldura de 1 px.
   *
   * Medido na área de escrita: a tábua de carvalho tinha luminância média 118
   * com desvio de **25,9** — e o rabisco escuro por cima —, contra uma tinta de
   * 24,8. Esta tem média **172 com desvio 4,7**: mais clara e, sobretudo,
   * **calma**. O que escondia a letra não era só o tom, era a agitação do
   * fundo competindo com ela no mesmo tamanho de pixel.
   */
  'block/oak_sign': {
    base: [196, 170, 118], noise: 'grain', scale: 14, variance: 0.035,
    ops: [
      border([132, 106, 62], 1),
      // Um fio claro logo dentro da moldura: dá relevo de tábua aplainada sem
      // pôr nenhuma linha escura dentro da área de escrita.
      outline(1, 1, 14, 14, [214, 192, 146]),
      dither(0.02),
    ],
  },
  /*
   * Quadros (M8). Eram **um** desenho só: um morro e um sol, redesenhados por
   * um laço, e uma parede de quadros repetia a mesma imagem. Agora são quatro
   * telas escritas pixel a pixel com o operador `pattern` — que é a forma
   * legível de desenhar 16×16 no código — e qual delas aparece sai da posição
   * do bloco (`stateForPlacement`), então o mural nasce variado sozinho.
   *
   * A moldura de 1 px é a mesma nas quatro: é ela que faz o quadro ler como
   * quadro, e não como adesivo colado na parede.
   */
  'block/painting': {
    base: [70, 50, 28], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      'WWWWWWWWWWWWWWWW',
      'WssssssssssssssW',
      'WsssssssssSSSssW',
      'WssssssssSSSSSsW',
      'WssssssssSSSSSsW',
      'WsssssssssSSSssW',
      'WssssssssssssssW',
      'WssslllssssssssW',
      'WsslllllsssssssW',
      'WsslllllsssssssW',
      'WsssstsssssssssW',
      'WsssstsssssssssW',
      'WggggggggggggggW',
      'WggGgggggggGgggW',
      'WGGGGGGGGGGGGGGW',
      'WWWWWWWWWWWWWWWW',
    ], {
      W: [70, 50, 28], s: [122, 168, 226], S: [248, 226, 120],
      g: [88, 150, 60], G: [58, 108, 52], t: [92, 66, 38], l: [60, 124, 50],
    })],
  },
  'block/painting_sunflower': {
    base: [70, 50, 28], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      'WWWWWWWWWWWWWWWW',
      'WbbbbbbbbbbbbbbW',
      'WbbbbbPPPPbbbbbW',
      'WbbbPPPPPPPPbbbW',
      'WbbPPPPCCPPPPbbW',
      'WbPPPPCCCCPPPPbW',
      'WbPPPCCCCCCPPPbW',
      'WbPPPCCCCCCPPPbW',
      'WbPPPPCCCCPPPPbW',
      'WbbPPPPCCPPPPbbW',
      'WbbbPPPPPPPPbbbW',
      'WbbbbbPPPPbbbbbW',
      'WbbbbbbttbbbbbbW',
      'WbbbbLLttbbbbbbW',
      'WbbbbbbttLLbbbbW',
      'WWWWWWWWWWWWWWWW',
    ], {
      W: [70, 50, 28], b: [44, 68, 40], P: [248, 204, 64],
      C: [110, 74, 36], t: [60, 120, 50], L: [78, 150, 60],
    })],
  },
  'block/painting_skull': {
    base: [70, 50, 28], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      'WWWWWWWWWWWWWWWW',
      'WkkkkkkkkkkkkkkW',
      'WkkkkBBBBBBkkkkW',
      'WkkkBBBBBBBBkkkW',
      'WkkBBBBBBBBBBkkW',
      'WkkBBeeBBeeBBkkW',
      'WkkBBeeBBeeBBkkW',
      'WkkBBBBBBBBBBkkW',
      'WkkBBBBeeBBBBkkW',
      'WkkkBBBBBBBBkkkW',
      'WkkkkBBBBBBkkkkW',
      'WkkkkBdBdBBkkkkW',
      'WkkkkkkkkkkkkkkW',
      'WkkkkkkkkkkkkkkW',
      'WkkkkkkkkkkkkkkW',
      'WWWWWWWWWWWWWWWW',
    ], {
      W: [70, 50, 28], k: [18, 16, 20], B: [226, 220, 200],
      e: [26, 22, 26], d: [150, 144, 128],
    })],
  },
  'block/painting_night': {
    base: [70, 50, 28], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      'WWWWWWWWWWWWWWWW',
      'WnnnnnnnnnnnnnnW',
      'WnnrnnnnnnnnrnnW',
      'WnnnnnnmmnnnnnnW',
      'WnnnnnmmmmnnnnnW',
      'WnnnnnmmmmnnnnnW',
      'WnnnnnnmmnnnnnrW',
      'WnnnnnnnnnnnnnnW',
      'WnnnnnnppnnnnnnW',
      'WnnnnnMMMMnnppnW',
      'WnnnnMMMMMMMMMnW',
      'WnnnMMMMMMMMMMMW',
      'WnnMMMMMMMMMMMMW',
      'WnMMMMMMMMMMMMMW',
      'WMMMMMMMMMMMMMMW',
      'WWWWWWWWWWWWWWWW',
    ], {
      W: [70, 50, 28], n: [24, 28, 58], m: [232, 232, 216],
      M: [52, 56, 84], p: [200, 206, 222], r: [200, 200, 230],
    })],
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
  /*
   * Tocha (M8): faixas horizontais, não uma cruz.
   *
   * A tocha deixou de ser dois quads cruzados e virou um poste de 2/16 de
   * lado (`world/mesh/complex.ts`). A lateral do poste mostra a textura
   * **inteira** espremida em dois pixels de largura — o formato de vértice não
   * guarda recorte de UV —, então tudo que é detalhe horizontal se perde. Daí
   * o desenho em faixas: cabo embaixo, carvão no meio, chama em cima. É a
   * única leitura que sobrevive à compressão.
   */
  'block/torch': {
    base: [140, 108, 60], noise: 'grain', scale: 3, variance: 0.1,
    ops: [
      rect(0, 5, 16, 11, [132, 100, 56]),
      rect(0, 4, 16, 2, [74, 52, 28]),
      rect(0, 1, 16, 3, [255, 184, 64]),
      rect(0, 0, 16, 1, [255, 242, 186]),
      dither(0.04),
    ],
  },
  /** Brasa vista de cima: o quadradinho de 2×2 no topo do poste. */
  'block/torch_top': {
    base: [255, 184, 64], noise: 'value', scale: 2, variance: 0.12,
    ops: [rect(4, 4, 8, 8, [255, 242, 186]), dither(0.05)],
  },
  /** Corte do cabo, visto por baixo — só madeira, sem brasa. */
  'block/torch_bottom': {
    base: [116, 88, 48], noise: 'grain', scale: 3, variance: 0.1,
    ops: [border([78, 58, 32], 1), dither(0.04)],
  },

  /*
   * Abóbora e melancia (M8): as duas eram **`block/oak_planks`**.
   *
   * Não é exagero de linguagem: a tabela de blocos apontava a textura da tábua
   * de carvalho, então uma abóbora plantada no campo era um caixote de madeira
   * com outro nome no tooltip. É a mesma classe de coisa que a cama ser lã e o
   * TNT ser tábua, corrigidas antes — esta ficou para trás.
   */
  /** Acácia: era tronco e tábua de carvalho com outro nome. */
  'block/acacia_log_side': {
    base: [156, 116, 72], noise: 'grain', scale: 5, variance: 0.14,
    ops: [stripes('v', 5, 0.18), border([96, 66, 40], 1), dither(0.05)],
  },
  'block/acacia_log_top': {
    base: [186, 150, 96], noise: 'value', scale: 4, variance: 0.1,
    ops: [rings(4, [124, 88, 52]), border([96, 66, 40], 1), dither(0.04)],
  },
  'block/acacia_planks': {
    base: [196, 112, 62], noise: 'grain', scale: 6, variance: 0.1,
    ops: [plankLines(5, [146, 76, 40]), dither(0.05)],
  },
  'block/pumpkin_side': {
    base: [214, 126, 30], noise: 'value', scale: 6, variance: 0.08,
    ops: [
      // Gomos: sulcos verticais, que é o que faz abóbora ser abóbora.
      rect(2, 0, 1, 16, [156, 84, 18]),
      rect(7, 0, 1, 16, [156, 84, 18]),
      rect(12, 0, 1, 16, [156, 84, 18]),
      rect(3, 0, 1, 16, [236, 152, 52], 0.5),
      rect(8, 0, 1, 16, [236, 152, 52], 0.5),
      rect(13, 0, 1, 16, [236, 152, 52], 0.5),
      border([138, 74, 16], 1),
      dither(0.05),
    ],
  },
  'block/pumpkin_top': {
    inherit: 'block/pumpkin_side',
    ops: [
      tintBy(0.94),
      // Cabinho no meio.
      rect(6, 6, 4, 4, [128, 106, 44]),
      rect(7, 7, 2, 2, [162, 138, 62]),
      outline(6, 6, 4, 4, [86, 70, 30]),
      dither(0.04),
    ],
  },
  'block/melon_side': {
    base: [96, 146, 46], noise: 'value', scale: 5, variance: 0.07,
    ops: [
      // Listras da casca, em zigue-zague largo.
      rect(1, 0, 2, 16, [52, 96, 32]),
      rect(6, 0, 2, 16, [52, 96, 32]),
      rect(11, 0, 2, 16, [52, 96, 32]),
      rect(3, 0, 1, 16, [138, 184, 70], 0.6),
      rect(8, 0, 1, 16, [138, 184, 70], 0.6),
      rect(13, 0, 1, 16, [138, 184, 70], 0.6),
      border([40, 76, 26], 1),
      dither(0.05),
    ],
  },
  'block/melon_top': {
    base: [110, 158, 52], noise: 'value', scale: 4, variance: 0.06,
    ops: [
      rect(3, 3, 10, 10, [206, 78, 72]),
      outline(3, 3, 10, 10, [240, 238, 222]),
      speckle([40, 34, 30], 0.08, 1),
      border([40, 76, 26], 1),
      dither(0.05),
    ],
  },

  /*
   * Plantas com silhueta própria (M8).
   *
   * Muda, samambaia, cana e arbusto seco apontavam **a mesma textura**: muda e
   * trepadeira usavam `block/oak_leaves`, e as outras três `block/tall_grass`.
   * No mundo isso vira quatro plantas idênticas com nomes diferentes, e no
   * inventário, quatro cubos verdes iguais.
   *
   * Aqui elas são desenho, não ruído com máscara: `pattern` escreve o pixel a
   * pixel, e dá para ler a planta no próprio código.
   */
  'block/oak_sapling': {
    base: [96, 140, 52], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '................',
      '................',
      '.......ff.......',
      '......fMMf......',
      '.....fMMMMf.....',
      '....fMMddMMf....',
      '....fMdMMdMf....',
      '.....fMMMMf.....',
      '......fMMf......',
      '.......tt.......',
      '.......tt.......',
      '......ftt.......',
      '.......tt.......',
      '......tddt......',
      '................',
      '................',
    ], {
      M: [110, 164, 58], f: [74, 118, 40], d: [58, 94, 32],
      t: [104, 76, 42],
    })],
  },
  'block/fern': {
    base: [96, 140, 52], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '................',
      '.......f........',
      '......fMf.......',
      '.....f.M.f......',
      '....fM.M.Mf.....',
      '...f.M.M.M.f....',
      '..fM..MMM..Mf...',
      '...f.M.M.M.f....',
      '....fM.M.Mf.....',
      '.....f.M.f......',
      '......fMf.......',
      '.......M........',
      '.......M........',
      '......dMd.......',
      '................',
      '................',
    ], { M: [88, 136, 48], f: [62, 104, 36], d: [48, 82, 30] })],
  },
  'block/sugar_cane': {
    base: [148, 190, 92], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '....C..C........',
      '....C..C...C....',
      '....C..C...C....',
      '...dC.dC...C....',
      '....C..C..dC....',
      '....C..C...C....',
      '....C..C...C....',
      '...dC..C...C....',
      '....C.dC..dC....',
      '....C..C...C....',
      '....C..C...C....',
      '....C..C..dC....',
      '...dC..C...C....',
      '....C..C...C....',
      '....C..C...C....',
      '....C..C...C....',
    ], { C: [150, 194, 96], d: [104, 148, 62] })],
  },
  'block/dead_bush': {
    base: [126, 96, 52], noise: 'flat', scale: 1, variance: 0,
    ops: [pattern([
      '................',
      '................',
      '..t.........t...',
      '...t...t...t....',
      '....t..t..t.....',
      '.....t.t.t......',
      '..t...ttt.......',
      '...t..ttt..t....',
      '....t.tTt.t.....',
      '.......T.t......',
      '.......T........',
      '.......T........',
      '......dTd.......',
      '................',
      '................',
      '................',
    ], { t: [134, 100, 54], T: [108, 78, 42], d: [86, 62, 34] })],
  },
  'block/vine': {
    inherit: 'block/oak_leaves',
    ops: [
      tintBy(0.86),
      // Fios pendurados: o resto vaza, senão a trepadeira é uma parede verde.
      (c) => {
        for (let y = 0; y < 16; y++) {
          for (let x = 0; x < 16; x++) {
            const fio = x % 5 < 2 && (x % 5 === 0 || (y + x) % 7 < 5);
            if (!fio) c.data[((y * 16 + x) << 2) + 3] = 0;
          }
        }
      },
    ],
  },
  /** Folha de bétula: a mesma folhagem, mais clara e mais amarelada. */
  'block/birch_leaves': {
    inherit: 'block/oak_leaves', ops: [tintBy(1.12)],
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

  // --- redstone (M7) ------------------------------------------------------
  ...dustTextures(),
  'block/redstone_torch': {
    inherit: 'block/torch',
    ops: [
      rect(0, 5, 16, 11, [132, 100, 56]),
      rect(0, 4, 16, 2, [74, 52, 28]),
      rect(0, 1, 16, 3, [226, 58, 44]),
      rect(0, 0, 16, 1, [255, 132, 110]),
      dither(0.04),
    ],
  },
  'block/redstone_torch_top': {
    base: [226, 58, 44], noise: 'value', scale: 2, variance: 0.12,
    ops: [rect(4, 4, 8, 8, [255, 132, 110]), dither(0.05)],
  },
  'block/redstone_torch_off': {
    inherit: 'block/torch',
    ops: [
      rect(0, 5, 16, 11, [132, 100, 56]),
      rect(0, 4, 16, 2, [74, 52, 28]),
      rect(0, 1, 16, 3, [104, 34, 30]),
      rect(0, 0, 16, 1, [134, 48, 42]),
      dither(0.04),
    ],
  },
  'block/redstone_torch_off_top': {
    base: [104, 34, 30], noise: 'value', scale: 2, variance: 0.1,
    ops: [rect(4, 4, 8, 8, [134, 48, 42]), dither(0.05)],
  },
  'block/lever': {
    inherit: 'block/cobblestone',
    ops: [rect(6, 2, 4, 12, [126, 96, 54]), outline(6, 2, 4, 12, [82, 60, 32])],
  },
  'block/repeater': {
    base: [186, 186, 190], noise: 'value', scale: 6, variance: 0.06,
    ops: [
      border([142, 142, 148], 1),
      rect(2, 7, 12, 2, [110, 110, 116]),
      rect(4, 3, 2, 3, [196, 58, 48]),
      rect(10, 10, 2, 3, [196, 58, 48]),
      dither(0.04),
    ],
  },
  'block/piston': {
    base: [150, 122, 74], noise: 'grain', scale: 6, variance: 0.1,
    ops: [plankLines(8, WOOD_DARK), border(IRON_DARK, 2), dither(0.04)],
  },
  'block/piston_sticky': {
    inherit: 'block/piston', ops: [rect(5, 5, 6, 6, [126, 176, 84], 0.85)],
  },
  'block/piston_head': {
    base: [160, 132, 82], noise: 'grain', scale: 6, variance: 0.1,
    ops: [border(IRON_LIGHT, 1), rect(6, 0, 4, 16, IRON_LIGHT, 0.5), dither(0.04)],
  },
  'block/redstone_lamp': {
    base: [108, 74, 42], noise: 'value', scale: 5, variance: 0.1,
    ops: [bricks(8, 8, [72, 48, 26]), speckle([140, 96, 54], 0.12, 1), dither(0.05)],
  },
  'block/redstone_lamp_on': {
    base: [246, 200, 112], noise: 'value', scale: 5, variance: 0.08,
    ops: [bricks(8, 8, [214, 154, 68]), speckle([255, 238, 180], 0.14, 1), dither(0.04)],
  },
  'block/redstone_block': {
    base: [172, 26, 22], noise: 'cell', scale: 4, variance: 0.2,
    ops: [speckle([226, 62, 48], 0.16, 1), emboss(0.3), dither(0.05)],
  },

  // --- Nether (M7) --------------------------------------------------------
  'block/netherrack': {
    base: [111, 54, 52], noise: 'cell', scale: 4, variance: 0.28,
    ops: [speckle([78, 34, 34], 0.22, 1), emboss(0.3), dither(0.06)],
  },
  'block/soul_sand': {
    base: [82, 62, 52], noise: 'grain', scale: 5, variance: 0.16,
    ops: [
      blobs([54, 40, 34], 3, 3),
      // Três covinhas escuras: o olho lê "rostos" sem desenhar nenhum.
      speckle([40, 30, 26], 0.1, 2),
      dither(0.05),
    ],
  },
  'block/nether_quartz_ore': {
    inherit: 'block/netherrack', ops: [oreBlobs([238, 232, 226], 6)],
  },
  'block/nether_bricks': {
    base: [58, 28, 33], noise: 'value', scale: 5, variance: 0.12,
    ops: [bricks(8, 8, [38, 18, 22]), emboss(0.35), dither(0.05)],
  },
  'block/magma_block': {
    base: [142, 62, 30], noise: 'cell', scale: 3, variance: 0.35,
    ops: [speckle([246, 176, 62], 0.18, 2), emboss(0.4), dither(0.05)],
  },
  'block/nether_portal': {
    base: [116, 48, 186], noise: 'value', scale: 3, variance: 0.3, alpha: 0.78,
    ops: [speckle([196, 132, 246], 0.2, 1), dither(0.08)],
  },

  /*
   * Fogo: cruz com a base laranja e a ponta amarela, animada em 4 quadros.
   *
   * A máscara de cruz é a mesma da tocha; o que muda é a paleta quente e o
   * número de quadros, que é o que faz a chama tremer sem ninguém desenhar
   * quadro nenhum.
   */
  'block/fire': {
    base: [226, 106, 24], noise: 'value', scale: 3, variance: 0.34, frames: 4,
    ops: [alphaMask('cross', 0), blobs([252, 220, 96], 3, 2)],
  },

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

/*
 * Lã e cama coloridas (M8), geradas a partir de `data/dyes.ts`.
 *
 * Ficam **depois** da tabela escrita à mão porque a ordem dela define o índice
 * de camada: acrescentar no fim não move nenhuma textura existente de lugar.
 *
 * As três receitas de cama eram escritas à mão, em vermelho, e viraram estas —
 * uma cama vermelha continua saindo igual, só que agora pela mesma conta que
 * faz a azul. Era esse o desvio que impedia a cama de ter cor: o vermelho
 * estava no desenho, não no dado.
 */

/** Lã: o tecido é o ruído `grain`, que é o que lê como fio. */
function woolRecipe(dye: DyeDef): TexRecipe {
  return { base: dye.wool, noise: 'grain', scale: 12, variance: 0.06, ops: [dither(0.04)] };
}

/** Cabeceira: travesseiro em cima, colcha embaixo. */
function bedHeadRecipe(dye: DyeDef): TexRecipe {
  return {
    base: dye.wool, noise: 'grain', scale: 10, variance: 0.06,
    ops: [
      outline(0, 0, 16, 16, dye.shade),
      rect(2, 1, 12, 5, [238, 238, 232]),
      outline(2, 1, 12, 5, [198, 198, 192]),
      rect(1, 8, 14, 7, dye.quilt),
      rect(1, 8, 14, 1, dye.highlight, 0.6),
      dither(0.04),
    ],
  };
}

/** Pé da cama: colcha inteira, sem travesseiro. */
function bedFootRecipe(dye: DyeDef): TexRecipe {
  return {
    base: dye.wool, noise: 'grain', scale: 10, variance: 0.06,
    ops: [
      outline(0, 0, 16, 16, dye.shade),
      rect(1, 1, 14, 14, dye.quilt),
      rect(1, 1, 14, 1, dye.highlight, 0.6),
      dither(0.04),
    ],
  };
}

/** Lateral: estrado de madeira com o colchão aparecendo. */
function bedSideRecipe(dye: DyeDef): TexRecipe {
  return {
    base: [150, 124, 72], noise: 'stripes', scale: 1, variance: 0.08,
    ops: [
      plankLines(4, WOOD_DARK),
      rect(0, 3, 16, 6, dye.quilt),
      rect(0, 3, 16, 1, [238, 238, 232]),
      rect(0, 9, 16, 1, dye.shade),
      border([104, 84, 48], 1),
      dither(0.04),
    ],
  };
}

for (const dye of DYES) {
  // A branca já existe escrita à mão desde o M4 e é a base do tingimento.
  if (dye.name !== 'white') TEXTURES[`block/wool_${dye.name}`] = woolRecipe(dye);
  TEXTURES[`block/bed_${dye.name}_top`] = bedHeadRecipe(dye);
  TEXTURES[`block/bed_${dye.name}_foot_top`] = bedFootRecipe(dye);
  TEXTURES[`block/bed_${dye.name}_side`] = bedSideRecipe(dye);
}

/** Ordem estável de geração — o índice de camada é resolvido por nome. */
export const TEXTURE_NAMES: readonly string[] = Object.keys(TEXTURES);

/** Tints de bioma padrão, usados enquanto os biomas não existem (M1). */
export const DEFAULT_TINTS = {
  grass: [0x79, 0xc0, 0x5a] as const,
  foliage: [0x59, 0xae, 0x30] as const,
  water: [0x3f, 0x76, 0xe4] as const,
};
