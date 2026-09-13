/**
 * Acabamento de textura: a passada que transforma o procedural cru no estilo
 * **Nítido** (doc 13 §2, extensão).
 *
 * A ideia é não ter duas tabelas de textura. `data/textures.ts` continua sendo
 * a única receita de cada bloco; o estilo é um **pós-processamento genérico**
 * aplicado ao ladrilho já pronto, no boot. Assim nenhuma textura nova precisa
 * ser desenhada duas vezes, e um bloco acrescentado amanhã ganha o estilo de
 * graça.
 *
 * Quatro passadas, nesta ordem — a ordem importa:
 *
 *  1. **relevo** — a própria luminância do ladrilho vira campo de altura e é
 *     iluminada de cima-à-esquerda. É o que faz o pedregulho parecer escavado e
 *     a tábua parecer ter sulco, sem ninguém desenhar sombra à mão.
 *  2. **realce** — máscara de nitidez (o pixel menos a média dos vizinhos), que
 *     devolve o detalhe que o ruído suave come.
 *  3. **tom** — contraste e saturação, mais um empurrão de cor por textura.
 *     É o que separa granito de diorito de andesito num olhar. O contraste
 *     gira em torno da **média da própria textura**, não do cinza fixo: com
 *     pivô fixo, neve, lã e o topo da grama — que já nascem claros — seriam
 *     empurrados para o branco e perderiam o pouco de detalhe que têm.
 *  4. **chanfro** — borda de cima/esquerda clara e de baixo/direita escura. Com
 *     greedy meshing a UV repete por bloco, então o chanfro desenha a grade do
 *     mundo: cada cubo vira um cubo distinto em vez de uma parede lisa.
 *
 * **Custo: zero em jogo.** Tudo roda uma vez no boot, sobre 152 ladrilhos de
 * 16×16 — e só roda se o jogador escolheu o estilo.
 *
 * Textura vazada (vidro, folha, trilho) é detectada pelo alfa e **não leva
 * chanfro**: numa textura recortada a borda não é borda de cubo, é recorte.
 */

import type { Rgb } from './texgen';

export interface FinishStyle {
  /** Força do relevo direcional. 0 desliga. */
  relief: number;
  /** Força do chanfro de borda. 0 desliga. */
  rim: number;
  /** Força da máscara de nitidez. 0 desliga. */
  sharpen: number;
  /** Saturação: 1 mantém, >1 satura. */
  saturation: number;
  /** Contraste em torno do cinza médio: 1 mantém. */
  contrast: number;
  /** Multiplicador por canal, para separar famílias parecidas. */
  tint?: Rgb;
}

/** Estilo neutro — usado como base dos ajustes por textura. */
export const NO_FINISH: FinishStyle = {
  relief: 0, rim: 0, sharpen: 0, saturation: 1, contrast: 1,
};

const LUMA_R = 0.299;
const LUMA_G = 0.587;
const LUMA_B = 0.114;
/** Abaixo disto o pixel é vazado: não entra no relevo nem recebe chanfro. */
const OPAQUE = 250;

/**
 * Aplica o acabamento **no lugar** e devolve o mesmo buffer.
 *
 * `size` é o lado do ladrilho e precisa ser potência de 2: o relevo amostra os
 * vizinhos com `& (size - 1)`, porque a textura é ladrilhada no mundo e a borda
 * direita encosta na esquerda de verdade.
 */
export function applyFinish(
  data: Uint8ClampedArray, size: number, style: FinishStyle,
): Uint8ClampedArray {
  const count = size * size;
  const mask = size - 1;
  const luma = new Float32Array(count);
  let cutout = false;

  for (let i = 0; i < count; i++) {
    const o = i << 2;
    if (data[o + 3] < OPAQUE) cutout = true;
    luma[i] = (data[o] * LUMA_R + data[o + 1] * LUMA_G + data[o + 2] * LUMA_B) / 255;
  }

  let mean = 0;
  let opaque = 0;
  for (let i = 0; i < count; i++) {
    if (data[(i << 2) + 3] === 0) continue;
    mean += luma[i];
    opaque++;
  }
  mean = opaque === 0 ? 0.5 : mean / opaque;

  if (style.relief > 0) relief(data, luma, size, mask, style.relief);
  if (style.sharpen > 0) sharpen(data, size, mask, style.sharpen);
  tone(data, count, style, mean * 255);
  if (style.rim > 0 && !cutout) bevel(data, size, style.rim);
  return data;
}

/**
 * Luz direcional a partir do campo de altura.
 *
 * O gradiente é central (vizinho da direita menos o da esquerda). Pixel vazado
 * não tem altura: amostrar nele puxaria o gradiente para o zero e desenharia um
 * halo em volta do recorte, então o vizinho transparente é substituído pela
 * altura do próprio pixel — gradiente zero, sem halo.
 */
function relief(
  data: Uint8ClampedArray, luma: Float32Array, size: number, mask: number, strength: number,
): void {
  const at = (x: number, y: number, own: number): number => {
    const i = ((y & mask) * size) + (x & mask);
    return data[(i << 2) + 3] < OPAQUE ? own : luma[i];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      const o = i << 2;
      if (data[o + 3] < OPAQUE) continue;
      const own = luma[i];
      const dx = at(x + 1, y, own) - at(x - 1, y, own);
      const dy = at(x, y + 1, own) - at(x, y - 1, own);
      // Luz de cima-à-esquerda: subir para a direita ou para baixo é virar as
      // costas para ela.
      let k = 1 - strength * (dx + dy) * 1.7;
      if (k < 0.5) k = 0.5;
      else if (k > 1.7) k = 1.7;
      data[o] *= k;
      data[o + 1] *= k;
      data[o + 2] *= k;
    }
  }
}

/** Máscara de nitidez com kernel em cruz. */
function sharpen(data: Uint8ClampedArray, size: number, mask: number, strength: number): void {
  const copy = data.slice();
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const o = ((y * size) + x) << 2;
      if (copy[o + 3] < OPAQUE) continue;
      for (let c = 0; c < 3; c++) {
        const around = (
          copy[((((y & mask) * size) + ((x + 1) & mask)) << 2) + c]
          + copy[((((y & mask) * size) + ((x - 1) & mask)) << 2) + c]
          + copy[(((((y + 1) & mask) * size) + x) << 2) + c]
          + copy[(((((y - 1) & mask) * size) + x) << 2) + c]
        ) * 0.25;
        data[o + c] = copy[o + c] + (copy[o + c] - around) * strength;
      }
    }
  }
}

/** Contraste, saturação e empurrão de cor — tudo num passo só. */
function tone(
  data: Uint8ClampedArray, count: number, style: FinishStyle, pivot: number,
): void {
  const { contrast, saturation } = style;
  const tint = style.tint;
  if (contrast === 1 && saturation === 1 && tint === undefined) return;

  for (let i = 0; i < count; i++) {
    const o = i << 2;
    if (data[o + 3] === 0) continue;
    let r = data[o], g = data[o + 1], b = data[o + 2];

    if (contrast !== 1) {
      r = pivot + (r - pivot) * contrast;
      g = pivot + (g - pivot) * contrast;
      b = pivot + (b - pivot) * contrast;
    }
    if (saturation !== 1) {
      const gray = r * LUMA_R + g * LUMA_G + b * LUMA_B;
      r = gray + (r - gray) * saturation;
      g = gray + (g - gray) * saturation;
      b = gray + (b - gray) * saturation;
    }
    if (tint !== undefined) {
      r *= tint[0];
      g *= tint[1];
      b *= tint[2];
    }
    data[o] = r;
    data[o + 1] = g;
    data[o + 2] = b;
  }
}

/** Chanfro: borda de cima/esquerda clara, de baixo/direita escura. */
function bevel(data: Uint8ClampedArray, size: number, strength: number): void {
  const last = size - 1;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let k = 1;
      if (x === 0 || y === 0) k *= 1 + strength * 0.5;
      if (x === last || y === last) k *= 1 - strength * 0.8;
      if (k === 1) continue;
      const o = ((y * size) + x) << 2;
      data[o] *= k;
      data[o + 1] *= k;
      data[o + 2] *= k;
    }
  }
}
