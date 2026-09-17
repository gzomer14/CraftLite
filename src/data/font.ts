/**
 * Fonte de bitmap do mundo 3D (doc 13 §1: nenhum asset de terceiros).
 *
 * O HUD é DOM e usa a fonte do sistema. O que **não** dá para escrever com DOM
 * é texto que existe dentro do mundo, preso a um bloco, com perspectiva e
 * oclusão — a placa. Para isso é preciso uma fonte que o renderizador consiga
 * amostrar, e ela nasce aqui, como dado.
 *
 * **Por que 5×7 e não uma fonte vetorial.** A placa tem 14 pixels de altura no
 * mundo e cabe quatro linhas; cada linha tem sete texels de altura no melhor
 * caso. Vetor não ajuda nesse tamanho — o que decide a legibilidade é o desenho
 * do glifo no pixel exato, e isso se escreve à mão.
 *
 * **Acento é composição, não glifo.** Á, Â, Ã, À e Ü são a mesma letra com uma
 * marca de duas linhas em cima, e Ç é o C com a cedilha embaixo. Guardar os 13
 * acentuados inteiros seria repetir a letra 13 vezes e deixar o Â divergir do A
 * na primeira correção. A célula tem folga em cima e embaixo exatamente para
 * isso caber.
 */

/** Tamanho do glifo desenhado, em pixels. */
export const GLYPH_W = 5;
export const GLYPH_H = 7;

/**
 * Célula na textura: 8×12 dá 1 px de folga lateral (senão duas letras vizinhas
 * se tocam com filtro linear), 3 px em cima para o acento e 2 embaixo para a
 * cedilha.
 */
export const CELL_W = 8;
export const CELL_H = 12;
/** Onde o glifo começa dentro da célula. */
export const GLYPH_X = 1;
export const GLYPH_Y = 3;
/** Onde a marca de cima e a de baixo começam. */
export const MARK_TOP_Y = 0;
export const MARK_BOTTOM_Y = GLYPH_Y + GLYPH_H;

/** Textura da fonte: 16×10 células numa folha quadrada. */
export const FONT_COLUMNS = 16;
export const FONT_ROWS = 10;
export const FONT_SIZE = 128;

/**
 * Glifos base, sete linhas de cinco bits cada, bit 4 = pixel da esquerda.
 * Escritos em binário porque assim a letra aparece no próprio código.
 */
const BASE: Record<string, readonly number[]> = {
  ' ': [0, 0, 0, 0, 0, 0, 0],

  A: [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  B: [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
  C: [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
  D: [0b11110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b11110],
  E: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
  F: [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
  G: [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
  H: [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
  I: [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  J: [0b00111, 0b00010, 0b00010, 0b00010, 0b00010, 0b10010, 0b01100],
  K: [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
  L: [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
  M: [0b10001, 0b11011, 0b10101, 0b10001, 0b10001, 0b10001, 0b10001],
  N: [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
  O: [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  P: [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
  Q: [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
  R: [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
  S: [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
  T: [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
  U: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
  V: [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
  W: [0b10001, 0b10001, 0b10001, 0b10001, 0b10101, 0b11011, 0b10001],
  X: [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
  Y: [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
  Z: [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],

  '0': [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
  '1': [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
  '2': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0b01000, 0b11111],
  '3': [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
  '4': [0b10010, 0b10010, 0b10010, 0b11111, 0b00010, 0b00010, 0b00010],
  '5': [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
  '6': [0b01110, 0b10000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
  '7': [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
  '8': [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
  '9': [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00001, 0b01110],

  '.': [0, 0, 0, 0, 0, 0b01100, 0b01100],
  ',': [0, 0, 0, 0, 0b01100, 0b01100, 0b01000],
  '!': [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0, 0b00100],
  '?': [0b01110, 0b10001, 0b00001, 0b00010, 0b00100, 0, 0b00100],
  ':': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0],
  ';': [0, 0b01100, 0b01100, 0, 0b01100, 0b01100, 0b01000],
  "'": [0b00100, 0b00100, 0, 0, 0, 0, 0],
  '"': [0b01010, 0b01010, 0, 0, 0, 0, 0],
  '-': [0, 0, 0, 0b11111, 0, 0, 0],
  '_': [0, 0, 0, 0, 0, 0, 0b11111],
  '+': [0, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0],
  '/': [0b00001, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b10000],
  '(': [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
  ')': [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
  '[': [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
  ']': [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
  '<': [0b00010, 0b00100, 0b01000, 0b10000, 0b01000, 0b00100, 0b00010],
  '>': [0b01000, 0b00100, 0b00010, 0b00001, 0b00010, 0b00100, 0b01000],
  '=': [0, 0, 0b11111, 0, 0b11111, 0, 0],
  '*': [0, 0b10101, 0b01110, 0b11111, 0b01110, 0b10101, 0],
  '#': [0b01010, 0b01010, 0b11111, 0b01010, 0b11111, 0b01010, 0b01010],
  '%': [0b11001, 0b11010, 0b00100, 0b01000, 0b10011, 0b10011, 0],
  '&': [0b01100, 0b10010, 0b10010, 0b01100, 0b10101, 0b10010, 0b01101],
  '@': [0b01110, 0b10001, 0b10111, 0b10101, 0b10111, 0b10000, 0b01110],
};

/** Marcas de duas linhas, aplicadas acima ou abaixo da letra. */
const MARKS: Record<string, readonly number[]> = {
  acute: [0b00010, 0b00100],
  grave: [0b01000, 0b00100],
  circumflex: [0b00100, 0b01010],
  tilde: [0b01101, 0b10110],
  diaeresis: [0b01010, 0],
  cedilla: [0b00100, 0b01100],
};

/** Acentuado = letra base + marca. A letra nunca é redesenhada. */
const COMPOSED: Record<string, readonly [string, string, boolean]> = {
  // [letra, marca, marca embaixo?]
  'Á': ['A', 'acute', false],
  'À': ['A', 'grave', false],
  'Â': ['A', 'circumflex', false],
  'Ã': ['A', 'tilde', false],
  'É': ['E', 'acute', false],
  'Ê': ['E', 'circumflex', false],
  'Í': ['I', 'acute', false],
  'Ó': ['O', 'acute', false],
  'Ô': ['O', 'circumflex', false],
  'Õ': ['O', 'tilde', false],
  'Ú': ['U', 'acute', false],
  'Ü': ['U', 'diaeresis', false],
  'Ñ': ['N', 'tilde', false],
  'Ç': ['C', 'cedilla', true],
};

/**
 * A ordem das células na folha, escrita à mão.
 *
 * **Não** sai de `Object.keys`: em JavaScript, chave que parece índice de array
 * vem primeiro e em ordem numérica, então `'0'..'9'` furariam a fila e o espaço
 * deixaria de ser a célula 0 — de que o render depende para não desenhar quad
 * de espaço em branco.
 */
const BASE_ORDER = ' ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.,!?:;\'"-_+/()[]<>=*#%&@';
const ACCENTED_ORDER = 'ÁÀÂÃÉÊÍÓÔÕÚÜÑÇ';

/**
 * Todos os caracteres que a fonte desenha, na ordem em que ocupam a folha.
 * O índice nesta lista **é** a célula na textura.
 */
export const FONT_CHARS: readonly string[] = [...BASE_ORDER, ...ACCENTED_ORDER];

/**
 * Quantos desenhos existem na tabela. A ordem acima é escrita à mão e a tabela
 * também: se as duas divergirem, um caractere fica sem célula ou uma célula
 * fica sem desenho. O teste compara os dois números.
 */
export const FONT_AUTHORED = Object.keys(BASE).length + Object.keys(COMPOSED).length;

/**
 * Índice → caractere é lista; caractere → índice é mapa. O render consulta
 * milhares de vezes por quadro e um `indexOf` linear em 76 entradas seria
 * varredura pura no caminho quente.
 */
const CELL_OF = new Map<string, number>();
for (let i = 0; i < FONT_CHARS.length; i++) CELL_OF.set(FONT_CHARS[i], i);

/** Índice de célula de um caractere, ou −1 se a fonte não o tem. */
export function glyphCell(ch: string): number {
  return CELL_OF.get(ch) ?? -1;
}

/** Desenho de um caractere: linhas da letra e, se houver, a marca. */
export interface Glyph {
  /** Sete linhas de cinco bits. */
  readonly rows: readonly number[];
  /** Duas linhas de cinco bits, ou `null`. */
  readonly mark: readonly number[] | null;
  /** true = a marca vai embaixo da letra (cedilha). */
  readonly markBelow: boolean;
}

const EMPTY_GLYPH: Glyph = { rows: BASE[' '], mark: null, markBelow: false };

/** O desenho de um caractere. Desconhecido vira espaço. */
export function glyphOf(ch: string): Glyph {
  const base = BASE[ch];
  if (base !== undefined) return { rows: base, mark: null, markBelow: false };
  const composed = COMPOSED[ch];
  if (composed === undefined) return EMPTY_GLYPH;
  return {
    rows: BASE[composed[0]],
    mark: MARKS[composed[1]],
    markBelow: composed[2],
  };
}

/**
 * Passa um texto para o que a fonte sabe desenhar: maiúsculas, sem caractere de
 * controle, e o que não existir vira espaço.
 *
 * A placa é em caixa alta porque a fonte é: minúscula em 5×7 com acento não
 * cabe, e meia fonte desenhada seria pior que nenhuma.
 */
export function toFontText(text: string): string {
  const upper = text.toUpperCase();
  let out = '';
  for (let i = 0; i < upper.length; i++) {
    const ch = upper[i];
    out += glyphCell(ch) >= 0 ? ch : ' ';
  }
  return out;
}
