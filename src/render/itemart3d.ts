/**
 * Sprites de item com volume (doc 13 §2.4, extensão do estilo Nítido).
 *
 * A arte clássica resolve cada pixel da máscara em uma de cinco cores fixas —
 * é legível, mas chapada: uma picareta de ferro e uma de diamante são a mesma
 * silhueta com outro tom. Aqui a **mesma máscara** de `data/itemart.ts` vira um
 * sólido iluminado, sem ninguém desenhar nada novo:
 *
 *  1. **transformada de distância** — a distância de cada pixel até a borda da
 *     silhueta. É o passo que dá a forma: o miolo fica longe da borda, a quina
 *     fica perto. Corpo e acento são medidos **separados**: a cabeça da
 *     ferramenta é uma peça apoiada no cabo, não a mesma peça. Sem essa
 *     separação a pá de madeira vira um graveto — cabeça e cabo têm a mesma
 *     cor, e só o volume os distingue;
 *  2. **abaulamento** — a distância vira altura com perfil de meia-cana
 *     (`sqrt`), então o objeto ganha barriga em vez de rampa;
 *  3. **normal e luz** — gradiente da altura, Lambert com luz de cima-à-esquerda
 *     e especular de Blinn-Phong. O expoente do especular é o que separa metal
 *     (ponto duro) de gema (brilho espalhado) — ver `ITEM_FINISHES`;
 *  4. **luz de quina** fria embaixo-à-direita, que descola o item do fundo;
 *  5. **contorno** colorido, mais claro no lado iluminado e quase preto no lado
 *     da sombra. É o truque mais antigo de pixel art e o que mais rende.
 *
 * Os papéis da máscara continuam valendo, mas agora **como relevo**: `M` levanta
 * o pixel, `d` afunda, `x` é contorno chapado. O mesmo desenho serve os dois
 * estilos.
 *
 * Tudo roda uma vez no boot, quando o jogador escolheu o estilo Nítido. Em
 * jogo não custa nada: o resultado é uma folha de sprites como qualquer outra.
 */

import type { ItemFinish } from '../data/texturestyle';
import { SHAPES, type ItemArt } from '../data/itemart';
import type { Rgb } from './texgen';

/** Lado do sprite no estilo Nítido. Dobrar é o que dá espaço para o sombreado. */
export const HD_SPRITE_SIZE = 32;
/** Lado da máscara escrita em `data/itemart.ts`. */
const MASK_SIZE = 16;

/** Direção da luz, com y crescendo para baixo. Já normalizada. */
const LX = -0.5145, LY = -0.5145, LZ = 0.6860;
/** Meio-vetor de Blinn-Phong para o observador em (0,0,1). */
const HX = -0.3053, HY = -0.3053, HZ = 0.9016;
/** Direção da luz de quina: o canto oposto ao da luz principal. */
const RX = 0.6, RY = 0.6, RZ = 0.5292;
/** Cor da luz de quina — fria, para não virar um segundo sol. */
const RIM_COLOR: Rgb = [150, 178, 220];

/** Papéis da máscara, em altura relativa. */
const ROLE_HEIGHT: Record<string, number> = {
  m: 0, M: 0.22, d: -0.3, a: -0.04, A: 0.1, x: -1,
};
/** Papéis da máscara, em multiplicador de cor. */
const ROLE_SHADE: Record<string, number> = {
  m: 1, M: 1.2, d: 0.72, a: 0.96, A: 1.18, x: 0,
};
/** Peça a que cada papel pertence: 1 é o corpo, 2 é o acento. */
const ROLE_PART: Record<string, number> = {
  m: 1, M: 1, d: 1, a: 2, A: 2, x: 1,
};

/**
 * Desenha a silhueta iluminada em `out` (RGBA de `size`×`size`).
 *
 * `size` precisa ser múltiplo de 16: a máscara é ampliada por repetição de
 * pixel, então a silhueta continua quadriculada — o que muda é o sombreado, que
 * é calculado na resolução cheia.
 */
export function drawItemArt3d(
  out: Uint8ClampedArray, size: number, art: ItemArt, finish: ItemFinish,
): void {
  const mask = SHAPES[art.shape];
  if (mask === undefined) return;

  const k = Math.max(1, Math.floor(size / MASK_SIZE));
  const count = size * size;
  const accent = art.accent ?? scale(art.color, 0.55);

  const roles = new Uint8Array(count);
  const parts = new Uint8Array(count);
  const red = new Float32Array(count);
  const green = new Float32Array(count);
  const blue = new Float32Array(count);

  for (let y = 0; y < size; y++) {
    const row = mask[Math.min(mask.length - 1, Math.floor(y / k))];
    for (let x = 0; x < size; x++) {
      const role = row[Math.min(row.length - 1, Math.floor(x / k))];
      if (role === undefined || role === '.') continue;
      const i = (y * size) + x;
      roles[i] = role.charCodeAt(0);
      parts[i] = ROLE_PART[role] ?? 1;
      const source: Rgb = role === 'a' || role === 'A' ? accent : art.color;
      const shade = ROLE_SHADE[role] ?? 1;
      red[i] = source[0] * shade;
      green[i] = source[1] * shade;
      blue[i] = source[2] * shade;
    }
  }

  const height = heightField(roles, parts, size, k, finish.volume);
  shadeSolid(out, size, roles, red, green, blue, height, finish, k);
  outline(out, size, roles, red, green, blue);
}

/**
 * Campo de altura da silhueta.
 *
 * O raio de abaulamento acompanha a máscara, não o sprite: um traço de 4 px na
 * máscara tem que ficar cheio em qualquer resolução, senão dobrar o tamanho
 * achata o desenho em vez de detalhá-lo.
 */
function heightField(
  roles: Uint8Array, parts: Uint8Array, size: number, k: number, volume: number,
): Float32Array {
  const dist = distanceByPart(parts, size);
  const radius = 2.4 * k;
  const out = new Float32Array(size * size);
  for (let i = 0; i < out.length; i++) {
    if (roles[i] === 0) continue;
    const role = String.fromCharCode(roles[i]);
    const bias = ROLE_HEIGHT[role] ?? 0;
    if (bias === -1) continue; // contorno desenhado à mão: fica chapado
    const t = Math.min(1, dist[i] / radius);
    out[i] = Math.sqrt(t) * volume + bias;
  }
  return out;
}

/**
 * Distância medida peça a peça: cada pixel mede até a borda da **sua** peça.
 *
 * É o que cria o vinco onde a cabeça encosta no cabo. Com uma peça só, os dois
 * viram um volume contínuo e a ferramenta perde a articulação.
 */
export function distanceByPart(parts: Uint8Array, size: number): Float32Array {
  const out = new Float32Array(size * size);
  const island = new Uint8Array(size * size);
  for (let part = 1; part <= 2; part++) {
    let any = false;
    for (let i = 0; i < island.length; i++) {
      island[i] = parts[i] === part ? 1 : 0;
      if (island[i] === 1) any = true;
    }
    if (!any) continue;
    const d = distanceToEdge(island, size);
    for (let i = 0; i < out.length; i++) if (island[i] === 1) out[i] = d[i];
  }
  return out;
}

/**
 * Distância de cada pixel cheio até o vazio mais próximo, em pixels.
 *
 * Chanfro 3-4 em duas varreduras: é a aproximação clássica da distância
 * euclidiana, erra menos de 2% e roda em O(n) — contra o algoritmo exato, que
 * não vale a complexidade para 1024 pixels.
 *
 * **Fora da imagem conta como vazio.** Sem isso, uma silhueta que encosta na
 * borda do sprite — ou preenche tudo — não teria borda nenhuma, a distância
 * ficaria infinita em todo canto e o desenho sairia chapado.
 */
export function distanceToEdge(roles: Uint8Array, size: number): Float32Array {
  const BIG = 1e6;
  const d = new Float32Array(size * size);
  for (let i = 0; i < d.length; i++) d[i] = roles[i] === 0 ? 0 : BIG;

  const relax = (i: number, from: number, w: number): void => {
    const v = d[from] + w;
    if (v < d[i]) d[i] = v;
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      if (d[i] === 0) continue;
      if (x === 0 || y === 0) d[i] = Math.min(d[i], 3);
      if (x > 0) relax(i, i - 1, 3);
      if (y > 0) relax(i, i - size, 3);
      if (x > 0 && y > 0) relax(i, i - size - 1, 4);
      if (x < size - 1 && y > 0) relax(i, i - size + 1, 4);
    }
  }
  for (let y = size - 1; y >= 0; y--) {
    for (let x = size - 1; x >= 0; x--) {
      const i = (y * size) + x;
      if (d[i] === 0) continue;
      if (x === size - 1 || y === size - 1) d[i] = Math.min(d[i], 3);
      if (x < size - 1) relax(i, i + 1, 3);
      if (y < size - 1) relax(i, i + size, 3);
      if (x < size - 1 && y < size - 1) relax(i, i + size + 1, 4);
      if (x > 0 && y < size - 1) relax(i, i + size - 1, 4);
    }
  }

  // Fora da silhueta a distância não interessa; dentro, volta a ser pixel.
  for (let i = 0; i < d.length; i++) d[i] = d[i] === BIG ? 0 : d[i] / 3;
  return d;
}

/** Lambert + especular + luz de quina, pixel a pixel. */
function shadeSolid(
  out: Uint8ClampedArray, size: number, roles: Uint8Array,
  red: Float32Array, green: Float32Array, blue: Float32Array,
  height: Float32Array, finish: ItemFinish, k: number,
): void {
  const slope = 2.2 * k;
  const at = (x: number, y: number, own: number): number => {
    if (x < 0 || y < 0 || x >= size || y >= size) return own;
    const i = (y * size) + x;
    return roles[i] === 0 ? own : height[i];
  };

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      if (roles[i] === 0) continue;
      const o = i << 2;
      out[o + 3] = 255;

      // Contorno já desenhado na máscara: cor crua, sem luz.
      if (roles[i] === 120 /* 'x' */) {
        out[o] = 24; out[o + 1] = 22; out[o + 2] = 28;
        continue;
      }

      const own = height[i];
      let nx = -(at(x + 1, y, own) - at(x - 1, y, own)) * slope;
      let ny = -(at(x, y + 1, own) - at(x, y - 1, own)) * slope;
      let nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      nx /= len; ny /= len; nz /= len;

      const diffuse = Math.max(0, nx * LX + ny * LY + nz * LZ);
      const lit = finish.ambient + (1 - finish.ambient) * diffuse;

      const half = Math.max(0, nx * HX + ny * HY + nz * HZ);
      const spec = Math.pow(half, finish.shininess) * finish.specular * 255;

      // A quina é onde a normal mais se deita; ali a luz fria aparece.
      const edge = 1 - nz;
      const rimDot = Math.max(0, nx * RX + ny * RY + nz * RZ);
      const rim = edge * edge * rimDot * finish.rimLight;

      out[o] = red[i] * lit + spec + RIM_COLOR[0] * rim;
      out[o + 1] = green[i] * lit + spec + RIM_COLOR[1] * rim;
      out[o + 2] = blue[i] * lit + spec + RIM_COLOR[2] * rim;
    }
  }
}

/**
 * Contorno de um pixel em volta da silhueta.
 *
 * Ele é **tingido pelo próprio item** e muda de força com o lado: em cima e à
 * esquerda, onde a luz bate, fica mais claro; embaixo e à direita, quase preto.
 * Contorno preto uniforme faz todo item parecer adesivo.
 */
function outline(
  out: Uint8ClampedArray, size: number, roles: Uint8Array,
  red: Float32Array, green: Float32Array, blue: Float32Array,
): void {
  const LIT = 0.42;
  const SHADOW = 0.18;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size) + x;
      if (roles[i] !== 0) continue;

      let source = -1;
      let strength = 0;
      // O vizinho de cima ou da esquerda põe o contorno no lado da luz.
      if (y > 0 && roles[i - size] !== 0) { source = i - size; strength = SHADOW; }
      else if (x > 0 && roles[i - 1] !== 0) { source = i - 1; strength = SHADOW; }
      else if (y < size - 1 && roles[i + size] !== 0) { source = i + size; strength = LIT; }
      else if (x < size - 1 && roles[i + 1] !== 0) { source = i + 1; strength = LIT; }
      if (source < 0) continue;

      const o = i << 2;
      out[o] = red[source] * strength;
      out[o + 1] = green[source] * strength;
      out[o + 2] = blue[source] * strength;
      out[o + 3] = 255;
    }
  }
}

function scale(color: Rgb, mul: number): Rgb {
  return [color[0] * mul, color[1] * mul, color[2] * mul];
}
