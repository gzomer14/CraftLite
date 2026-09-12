/**
 * Ruído procedural: Perlin melhorado (2D e 3D) com FBM e domain warping.
 *
 * Determinístico a partir da seed: a tabela de permutação é derivada dela, e
 * nenhuma amostra depende de estado externo. É isso que permite gerar chunks
 * fora de ordem, em N workers, e obter sempre o mesmo mundo (doc 03 §2).
 *
 * Nenhuma função aqui aloca — todas trabalham sobre a tabela pré-computada.
 */

import { Rng } from './rng';

const PERM_SIZE = 512;

/** Curva de suavização de Ken Perlin: 6t⁵ − 15t⁴ + 10t³ (derivada 2ª nula nas pontas). */
function fade(t: number): number {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/** Gradiente 3D a partir dos bits baixos do hash — os 12 vetores clássicos. */
function grad3(hash: number, x: number, y: number, z: number): number {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : h === 12 || h === 14 ? x : z;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

/** Gradiente 2D: 8 direções, suficiente e mais barato que 3D. */
function grad2(hash: number, x: number, y: number): number {
  const h = hash & 7;
  const u = h < 4 ? x : y;
  const v = h < 4 ? y : x;
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? 2 * v : -2 * v);
}

export class Noise {
  /** Permutação duplicada para evitar `% 256` nas buscas. */
  private readonly perm = new Uint8Array(PERM_SIZE);

  constructor(seed: number, salt = 0) {
    const rng = new Rng(seed, salt);
    const p = new Uint8Array(256);
    for (let i = 0; i < 256; i++) p[i] = i;
    // Fisher-Yates com o PRNG da seed: a tabela é sempre a mesma para a seed.
    for (let i = 255; i > 0; i--) {
      const j = rng.nextInt(i + 1);
      const tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (let i = 0; i < PERM_SIZE; i++) this.perm[i] = p[i & 255];
  }

  /** Perlin 2D em [-1, 1]. */
  noise2(x: number, y: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const u = fade(xf);
    const v = fade(yf);
    const p = this.perm;

    const a = p[xi] + yi;
    const b = p[xi + 1] + yi;

    const x1 = lerp(grad2(p[a], xf, yf), grad2(p[b], xf - 1, yf), u);
    const x2 = lerp(grad2(p[a + 1], xf, yf - 1), grad2(p[b + 1], xf - 1, yf - 1), u);
    return lerp(x1, x2, v);
  }

  /** Perlin 3D em [-1, 1]. Usado pelas cavernas. */
  noise3(x: number, y: number, z: number): number {
    const xi = Math.floor(x) & 255;
    const yi = Math.floor(y) & 255;
    const zi = Math.floor(z) & 255;
    const xf = x - Math.floor(x);
    const yf = y - Math.floor(y);
    const zf = z - Math.floor(z);
    const u = fade(xf);
    const v = fade(yf);
    const w = fade(zf);
    const p = this.perm;

    const a = p[xi] + yi;
    const aa = p[a & 255] + zi;
    const ab = p[(a + 1) & 255] + zi;
    const b = p[xi + 1] + yi;
    const ba = p[b & 255] + zi;
    const bb = p[(b + 1) & 255] + zi;

    const x1 = lerp(grad3(p[aa & 255], xf, yf, zf), grad3(p[ba & 255], xf - 1, yf, zf), u);
    const x2 = lerp(grad3(p[ab & 255], xf, yf - 1, zf), grad3(p[bb & 255], xf - 1, yf - 1, zf), u);
    const y1 = lerp(x1, x2, v);

    const x3 = lerp(grad3(p[(aa + 1) & 255], xf, yf, zf - 1), grad3(p[(ba + 1) & 255], xf - 1, yf, zf - 1), u);
    const x4 = lerp(grad3(p[(ab + 1) & 255], xf, yf - 1, zf - 1), grad3(p[(bb + 1) & 255], xf - 1, yf - 1, zf - 1), u);
    const y2 = lerp(x3, x4, v);

    return lerp(y1, y2, w);
  }

  /**
   * FBM 2D: soma de oitavas com amplitude caindo pela metade e frequência
   * dobrando. Normalizado para [-1, 1].
   */
  fbm2(x: number, y: number, octaves: number, frequency: number, persistence = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = frequency;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise2(x * f, y * f) * amp;
      norm += amp;
      amp *= persistence;
      f *= 2;
    }
    return sum / norm;
  }

  /** FBM 3D, idem. */
  fbm3(x: number, y: number, z: number, octaves: number, frequency: number, persistence = 0.5): number {
    let sum = 0;
    let amp = 1;
    let norm = 0;
    let f = frequency;
    for (let o = 0; o < octaves; o++) {
      sum += this.noise3(x * f, y * f, z * f) * amp;
      norm += amp;
      amp *= persistence;
      f *= 2;
    }
    return sum / norm;
  }

  /**
   * FBM com domain warping: desloca as coordenadas de amostragem por outro
   * ruído antes de amostrar. Custa duas amostras a mais e transforma colinas
   * redondas em formas orgânicas (doc 03 §4.1).
   */
  warpedFbm2(
    x: number, y: number, octaves: number, frequency: number, warpStrength: number,
  ): number {
    const wf = frequency * 2;
    const wx = this.noise2(x * wf, y * wf) * warpStrength;
    const wy = this.noise2(x * wf + 137.13, y * wf - 91.7) * warpStrength;
    return this.fbm2(x + wx, y + wy, octaves, frequency);
  }
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/**
 * Ruído de valor 3D barato, sem tabela — usado onde a qualidade do Perlin não
 * compensa o custo (jitter de posição de minério, por exemplo).
 */
export function valueNoise3(seed: number, x: number, y: number, z: number): number {
  let h = seed ^ 0x9e3779b9;
  h = Math.imul(h ^ (x | 0), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (y | 0), 0xc2b2ae35) >>> 0;
  h = Math.imul(h ^ (z | 0), 0x27d4eb2f) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2545f491) >>> 0;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
