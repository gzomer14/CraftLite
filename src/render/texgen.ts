/**
 * Motor de textura procedural (doc 13 §2).
 *
 * Uma textura é um `Uint8ClampedArray` RGBA de 16×16 sobre o qual operadores
 * compostáveis são aplicados em sequência. Tudo determinístico: a mesma receita
 * com a mesma seed sempre gera os mesmos bytes.
 *
 * Custo total no boot: ~10–15 ms para o conjunto inteiro, contra centenas de KB
 * de PNG que não baixamos.
 */

import { hash2, hash3 } from '../core/rng';

export const TEX_SIZE = 16;
const N = TEX_SIZE;
const PIXELS = N * N;

export type Rgb = readonly [number, number, number];

/** Superfície de trabalho: RGBA em [0,255], mais a seed da textura. */
export interface Canvas16 {
  data: Uint8ClampedArray;
  seed: number;
}

/** Um operador lê e escreve a superfície no lugar. */
export type TexOp = (c: Canvas16) => void;

export interface TexRecipe {
  /** Herda a superfície já pronta de outra textura (ex.: minérios sobre pedra). */
  inherit?: string;
  base?: Rgb;
  noise?: 'value' | 'cell' | 'stripes' | 'grain' | 'flat';
  scale?: number;
  variance?: number;
  alpha?: number;
  ops?: TexOp[];
  /** Quantos quadros gerar (água/lava/fogo). 1 = estática. */
  frames?: number;
}

// ---------------------------------------------------------------------------
// Utilitários internos
// ---------------------------------------------------------------------------

function idx(x: number, y: number): number {
  return (((y & (N - 1)) * N + (x & (N - 1))) << 2);
}

/** Ruído de valor com interpolação suave, tileável no período `scale`. */
function valueNoise2(seed: number, x: number, y: number, scale: number, salt: number): number {
  const fx = (x / N) * scale;
  const fy = (y / N) * scale;
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const tx = fx - x0, ty = fy - y0;
  const sx = tx * tx * (3 - 2 * tx);
  const sy = ty * ty * (3 - 2 * ty);
  const wrap = (v: number): number => ((v % scale) + scale) % scale;
  const g = (gx: number, gy: number): number =>
    hash2(seed, wrap(gx), wrap(gy), salt) / 4294967296;
  const a = g(x0, y0), b = g(x0 + 1, y0), c = g(x0, y0 + 1), d = g(x0 + 1, y0 + 1);
  return (a + (b - a) * sx) * (1 - sy) + (c + (d - c) * sx) * sy;
}

/** Ruído celular (Worley aproximado) — dá a cara de pedregulho. */
function cellNoise2(seed: number, x: number, y: number, scale: number, salt: number): number {
  const fx = (x / N) * scale;
  const fy = (y / N) * scale;
  const cx = Math.floor(fx), cy = Math.floor(fy);
  let best = 8;
  const wrap = (v: number): number => ((v % scale) + scale) % scale;
  for (let oy = -1; oy <= 1; oy++) {
    for (let ox = -1; ox <= 1; ox++) {
      const gx = cx + ox, gy = cy + oy;
      const h = hash2(seed, wrap(gx), wrap(gy), salt);
      const px = gx + (h & 255) / 255;
      const py = gy + ((h >>> 8) & 255) / 255;
      const dx = px - fx, dy = py - fy;
      const d = dx * dx + dy * dy;
      if (d < best) best = d;
    }
  }
  return Math.min(1, Math.sqrt(best));
}

function fbm(seed: number, x: number, y: number, scale: number, octaves: number, salt: number): number {
  let sum = 0;
  let amp = 1;
  let norm = 0;
  let s = scale;
  for (let o = 0; o < octaves; o++) {
    sum += valueNoise2(seed, x, y, Math.max(1, Math.round(s)), salt + o * 31) * amp;
    norm += amp;
    amp *= 0.5;
    s *= 2;
  }
  return sum / norm;
}

// ---------------------------------------------------------------------------
// Operadores (doc 13 §2.1)
// ---------------------------------------------------------------------------

/** Preenche com a cor base modulada pelo campo de ruído escolhido. */
export function fillNoise(base: Rgb, kind: TexRecipe['noise'], scale: number, variance: number, alpha = 1): TexOp {
  return (c) => {
    const d = c.data;
    const a = Math.round(alpha * 255);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        let n: number;
        switch (kind) {
          case 'cell':
            n = cellNoise2(c.seed, x, y, Math.max(2, scale), 11);
            break;
          case 'stripes':
            // Anéis/veios verticais: ruído 1D alongado no eixo Y.
            n = fbm(c.seed, x * 3, y * 0.4, Math.max(2, scale * 2), 2, 17);
            break;
          case 'grain':
            n = hash2(c.seed, x, y, 23) / 4294967296;
            break;
          case 'flat':
            n = 0.5;
            break;
          default:
            n = fbm(c.seed, x, y, Math.max(2, scale), 2, 5);
        }
        const k = 1 + (n - 0.5) * 2 * variance;
        const o = idx(x, y);
        d[o] = base[0] * k;
        d[o + 1] = base[1] * k;
        d[o + 2] = base[2] * k;
        d[o + 3] = a;
      }
    }
  };
}

/** Pontinhos aleatórios — cascalho, minérios simples, terra. */
export function speckle(color: Rgb, density: number, size = 1): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (hash2(c.seed, x, y, 71) / 4294967296 >= density) continue;
        for (let sy = 0; sy < size; sy++) {
          for (let sx = 0; sx < size; sx++) {
            const o = idx(x + sx, y + sy);
            d[o] = color[0];
            d[o + 1] = color[1];
            d[o + 2] = color[2];
          }
        }
      }
    }
  };
}

/** Listras horizontais ou verticais — tábuas, sandstone. */
export function stripes(dir: 'h' | 'v', period: number, contrast: number): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = dir === 'h' ? y : x;
        const k = 1 + (((t / period) | 0) % 2 === 0 ? contrast : -contrast);
        const o = idx(x, y);
        d[o] *= k;
        d[o + 1] *= k;
        d[o + 2] *= k;
      }
    }
  };
}

/** Moldura de 1px ou mais — tábuas, blocos trabalhados. */
export function border(color: Rgb, width = 1): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        if (x >= width && y >= width && x < N - width && y < N - width) continue;
        const o = idx(x, y);
        d[o] = (d[o] + color[0]) * 0.5;
        d[o + 1] = (d[o + 1] + color[1]) * 0.5;
        d[o + 2] = (d[o + 2] + color[2]) * 0.5;
      }
    }
  };
}

/**
 * Retângulo cheio. É a primitiva que faltava para desenhar estrutura — faixa
 * de TNT, ferragem de baú, travesseiro de cama — sem cada receita carregar o
 * próprio closure. `mix` em 1 pinta por cima; abaixo disso mistura com o que
 * já está lá, que é o que dá sombra e desgaste sem uma op nova.
 */
export function rect(
  x0: number, y0: number, w: number, h: number, color: Rgb, mix = 1,
): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = y0; y < y0 + h; y++) {
      if (y < 0 || y >= N) continue;
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || x >= N) continue;
        const o = idx(x, y);
        d[o] += (color[0] - d[o]) * mix;
        d[o + 1] += (color[1] - d[o + 1]) * mix;
        d[o + 2] += (color[2] - d[o + 2]) * mix;
      }
    }
  };
}

/** Contorno de 1 px de um retângulo — moldura de painel, chapa de fechadura. */
export function outline(
  x0: number, y0: number, w: number, h: number, color: Rgb, mix = 1,
): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = y0; y < y0 + h; y++) {
      if (y < 0 || y >= N) continue;
      for (let x = x0; x < x0 + w; x++) {
        if (x < 0 || x >= N) continue;
        if (x > x0 && x < x0 + w - 1 && y > y0 && y < y0 + h - 1) continue;
        const o = idx(x, y);
        d[o] += (color[0] - d[o]) * mix;
        d[o + 1] += (color[1] - d[o + 1]) * mix;
        d[o + 2] += (color[2] - d[o + 2]) * mix;
      }
    }
  };
}

/** Padrão de tijolo deslocado, com argamassa. */
export function bricks(w: number, h: number, mortar: Rgb): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      const row = (y / h) | 0;
      const shift = (row & 1) === 1 ? (w >> 1) : 0;
      for (let x = 0; x < N; x++) {
        const isMortar = y % h === 0 || (x + shift) % w === 0;
        if (!isMortar) continue;
        const o = idx(x, y);
        d[o] = mortar[0];
        d[o + 1] = mortar[1];
        d[o + 2] = mortar[2];
      }
    }
  };
}

/** Manchas orgânicas — folhas, grama. */
export function blobs(color: Rgb, count: number, radius: number): TexOp {
  return (c) => {
    const d = c.data;
    for (let i = 0; i < count; i++) {
      const h = hash2(c.seed, i, 0, 91);
      const bx = h % N;
      const by = (h >>> 8) % N;
      const r = radius * (0.6 + ((h >>> 16) & 255) / 512);
      const r2 = r * r;
      const ri = Math.ceil(r);
      for (let oy = -ri; oy <= ri; oy++) {
        for (let ox = -ri; ox <= ri; ox++) {
          if (ox * ox + oy * oy > r2) continue;
          const o = idx(bx + ox, by + oy);
          d[o] = (d[o] + color[0]) * 0.5;
          d[o + 1] = (d[o + 1] + color[1]) * 0.5;
          d[o + 2] = (d[o + 2] + color[2]) * 0.5;
        }
      }
    }
  };
}

/** Degradê vertical, do topo para a base. */
export function gradientV(top: Rgb, bottom: Rgb, strength = 1): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      const t = y / (N - 1);
      const r = top[0] + (bottom[0] - top[0]) * t;
      const g = top[1] + (bottom[1] - top[1]) * t;
      const b = top[2] + (bottom[2] - top[2]) * t;
      for (let x = 0; x < N; x++) {
        const o = idx(x, y);
        d[o] += (r - d[o]) * strength;
        d[o + 1] += (g - d[o + 1]) * strength;
        d[o + 2] += (b - d[o + 2]) * strength;
      }
    }
  };
}

const BAYER4 = new Int8Array([
  0, 8, 2, 10,
  12, 4, 14, 6,
  3, 11, 1, 9,
  15, 7, 13, 5,
]);

/** Dithering ordenado 4×4 — é o que dá cara de pixel art. */
export function dither(intensity: number): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const t = (BAYER4[(y & 3) * 4 + (x & 3)] / 15 - 0.5) * 2 * intensity * 255;
        const o = idx(x, y);
        d[o] += t;
        d[o + 1] += t;
        d[o + 2] += t;
      }
    }
  };
}

/** Relevo falso pela derivada horizontal/vertical da luminância. */
export function emboss(strength: number): TexOp {
  return (c) => {
    const src = c.data.slice();
    const d = c.data;
    const lum = (o: number): number => src[o] * 0.299 + src[o + 1] * 0.587 + src[o + 2] * 0.114;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = idx(x, y);
        const dx = lum(idx(x - 1, y)) - lum(idx(x + 1, y));
        const dy = lum(idx(x, y - 1)) - lum(idx(x, y + 1));
        const k = (dx + dy) * 0.5 * strength;
        d[o] += k;
        d[o + 1] += k;
        d[o + 2] += k;
      }
    }
  };
}

/** Blobs de minério com contorno escuro — o que dá reconhecimento imediato. */
export function oreBlobs(color: Rgb, count: number): TexOp {
  const dark: Rgb = [color[0] * 0.45, color[1] * 0.45, color[2] * 0.45];
  const light: Rgb = [
    Math.min(255, color[0] * 1.35),
    Math.min(255, color[1] * 1.35),
    Math.min(255, color[2] * 1.35),
  ];
  return (c) => {
    const d = c.data;
    for (let i = 0; i < count; i++) {
      const h = hash2(c.seed, i, 7, 131);
      const bx = 2 + (h % (N - 5));
      const by = 2 + ((h >>> 7) % (N - 5));
      const r = 1.2 + ((h >>> 15) & 3) * 0.5;
      const ri = Math.ceil(r) + 1;
      for (let oy = -ri; oy <= ri; oy++) {
        for (let ox = -ri; ox <= ri; ox++) {
          const dist = Math.sqrt(ox * ox + oy * oy);
          if (dist > r + 1) continue;
          const o = idx(bx + ox, by + oy);
          if (dist > r) {
            // contorno
            d[o] = dark[0]; d[o + 1] = dark[1]; d[o + 2] = dark[2];
          } else {
            // corpo, com um brilho no canto superior esquerdo
            const hi = ox <= 0 && oy <= 0 ? light : color;
            d[o] = hi[0]; d[o + 1] = hi[1]; d[o + 2] = hi[2];
          }
        }
      }
    }
  };
}

/** Anéis concêntricos — topo de tronco. */
export function rings(count: number, dark: Rgb): TexOp {
  return (c) => {
    const d = c.data;
    const cx = (N - 1) / 2, cy = (N - 1) / 2;
    const step = (N / 2) / count;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const dist = Math.hypot(x - cx, y - cy);
        const phase = (dist / step) % 1;
        if (phase >= 0.45) continue;
        const o = idx(x, y);
        d[o] = (d[o] + dark[0]) * 0.5;
        d[o + 1] = (d[o + 1] + dark[1]) * 0.5;
        d[o + 2] = (d[o + 2] + dark[2]) * 0.5;
      }
    }
  };
}

/** Linhas de junção entre tábuas. */
export function plankLines(period: number, dark: Rgb): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y += period) {
      for (let x = 0; x < N; x++) {
        const o = idx(x, y);
        d[o] = dark[0]; d[o + 1] = dark[1]; d[o + 2] = dark[2];
      }
    }
  };
}

/** Recorta o alfa — folhas com buracos, vidro, grade. */
export function alphaMask(shape: 'holes' | 'frame' | 'cross' | 'none', amount = 0.25): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const o = idx(x, y);
        let visible = true;
        switch (shape) {
          case 'holes':
            visible = hash2(c.seed, x, y, 211) / 4294967296 >= amount;
            break;
          case 'frame':
            visible = x < 1 || y < 1 || x >= N - 1 || y >= N - 1;
            break;
          case 'cross':
            visible = Math.abs(x - y) < 3 || Math.abs(x + y - (N - 1)) < 3;
            break;
          case 'none':
            visible = true;
            break;
        }
        if (!visible) d[o + 3] = 0;
      }
    }
  };
}

/**
 * Plantação num estágio de crescimento (doc 13 §2.2).
 *
 * Quatro talos verticais que sobem do chão da textura conforme `progress`
 * (0 = recém-plantado, 1 = maduro), com folhas laterais a partir da metade e a
 * ponta na cor do fruto quando maduro. O fundo fica transparente: o bloco é
 * desenhado como cruz, então tudo que não é talo tem que sumir.
 */
export function cropRows(progress: number, stalk: Rgb, tip: Rgb): TexOp {
  return (c) => {
    const d = c.data;
    for (let i = 0; i < PIXELS; i++) d[(i << 2) + 3] = 0;

    const height = Math.max(2, Math.round(2 + progress * 13));
    const top = N - height;
    const tipStart = progress >= 0.99 ? top : N;

    for (let column = 0; column < 4; column++) {
      const x = 1 + column * 4;
      // Cada talo cresce um pixel diferente: fileira perfeitamente alinhada
      // parece grade, não plantação.
      const jitter = (hash2(c.seed, column, 0, 977) & 1);
      for (let y = Math.min(N - 1, top + jitter); y < N; y++) {
        const color = y < tipStart + 4 ? tip : stalk;
        paint(d, x, y, color);
        paint(d, x + 1, y, darken(color, 0.82));
        // Folhas: um pixel para os lados, em duas alturas do talo.
        if (progress > 0.35 && (y === top + 2 || y === top + 5)) {
          paint(d, x - 1, y, darken(stalk, 0.9));
          paint(d, x + 2, y, darken(stalk, 0.7));
        }
      }
    }
  };
}

function paint(d: Uint8ClampedArray, x: number, y: number, color: Rgb): void {
  if (x < 0 || x >= N || y < 0 || y >= N) return;
  const o = idx(x, y);
  d[o] = color[0]; d[o + 1] = color[1]; d[o + 2] = color[2]; d[o + 3] = 255;
}

function darken(color: Rgb, mul: number): Rgb {
  return [color[0] * mul, color[1] * mul, color[2] * mul];
}

/** Sulcos horizontais da terra arada — dois riscos escuros e um claro. */
export function furrows(dark: Rgb): TexOp {
  return (c) => {
    const d = c.data;
    for (let y = 0; y < N; y++) {
      if (y % 5 !== 2 && y % 5 !== 3) continue;
      for (let x = 0; x < N; x++) {
        const o = idx(x, y);
        const mul = y % 5 === 2 ? 0.72 : 0.86;
        d[o] = d[o] * mul + dark[0] * (1 - mul);
        d[o + 1] = d[o + 1] * mul + dark[1] * (1 - mul);
        d[o + 2] = d[o + 2] * mul + dark[2] * (1 - mul);
      }
    }
  };
}

/** Escurece/clareia globalmente — variantes de material. */
export function tintBy(mul: number): TexOp {
  return (c) => {
    const d = c.data;
    for (let i = 0; i < PIXELS; i++) {
      const o = i << 2;
      d[o] *= mul;
      d[o + 1] *= mul;
      d[o + 2] *= mul;
    }
  };
}

/** Deslocamento animado no eixo Y por ruído 3D — água, lava. */
export function flow(amount: number, frame: number, totalFrames: number): TexOp {
  return (c) => {
    const src = c.data.slice();
    const d = c.data;
    const phase = (frame / totalFrames) * N;
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const n = hash3(c.seed, x, (y + Math.round(phase)) & (N - 1), 0, 41) / 4294967296;
        const sy = Math.round(y + phase + (n - 0.5) * amount);
        const o = idx(x, y);
        const s = idx(x, sy);
        d[o] = src[s];
        d[o + 1] = src[s + 1];
        d[o + 2] = src[s + 2];
        d[o + 3] = src[s + 3];
      }
    }
  };
}

// ---------------------------------------------------------------------------
// Execução de receitas
// ---------------------------------------------------------------------------

/** Renderiza uma receita em um buffer RGBA novo de 16×16. */
export function renderRecipe(
  recipe: TexRecipe,
  seed: number,
  resolve: (name: string) => Uint8ClampedArray,
): Uint8ClampedArray {
  const c: Canvas16 = {
    data: new Uint8ClampedArray(PIXELS * 4),
    seed,
  };

  if (recipe.inherit !== undefined) {
    c.data.set(resolve(recipe.inherit));
  } else {
    const base = recipe.base ?? [128, 128, 128];
    fillNoise(base, recipe.noise ?? 'value', recipe.scale ?? 4, recipe.variance ?? 0.1, recipe.alpha ?? 1)(c);
  }

  if (recipe.ops !== undefined) {
    for (let i = 0; i < recipe.ops.length; i++) recipe.ops[i](c);
  }

  return c.data;
}
