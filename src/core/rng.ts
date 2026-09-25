/**
 * PRNG determinístico (xoroshiro128**) e funções de hash por posição.
 *
 * Regra do projeto: todo conteúdo do mundo vem de `rngAt(seed, x, z, salt)`.
 * Chunks são gerados fora de ordem, em número variável de workers — a mesma
 * seed precisa produzir o mesmo mundo sempre.
 */

import { parseSeedCode } from './seedcode';

/** Estado de 128 bits guardado como 4 lanes de 32 bits (evita BigInt, que é lento). */
export class Rng {
  private s0 = 0;
  private s1 = 0;
  private s2 = 0;
  private s3 = 0;

  constructor(seed: number, salt = 0) {
    this.seedWith(seed, salt);
  }

  /** Semeia com SplitMix32 — espalha bits ruins (seed 1, 2, 3…) antes de usar. */
  seedWith(seed: number, salt = 0): void {
    let z = (seed ^ Math.imul(salt, 0x9e3779b9)) >>> 0;
    const next = (): number => {
      z = (z + 0x9e3779b9) >>> 0;
      let t = z;
      t = Math.imul(t ^ (t >>> 16), 0x21f0aaad) >>> 0;
      t = Math.imul(t ^ (t >>> 15), 0x735a2d97) >>> 0;
      return (t ^ (t >>> 15)) >>> 0;
    };
    this.s0 = next();
    this.s1 = next();
    this.s2 = next();
    this.s3 = next();
    // Estado todo-zero é um ponto fixo do gerador.
    if ((this.s0 | this.s1 | this.s2 | this.s3) === 0) this.s0 = 0x9e3779b9;
  }

  /** Próximo uint32. */
  next(): number {
    // xoroshiro128** sobre pares (s0,s1) e (s2,s3) representando dois 64 bits.
    const s1lo = this.s1;
    let rlo = Math.imul(s1lo, 5) >>> 0;
    rlo = ((rlo << 7) | (rlo >>> 25)) >>> 0;
    const result = Math.imul(rlo, 9) >>> 0;

    const t = (this.s1 << 9) >>> 0;
    this.s2 = (this.s2 ^ this.s0) >>> 0;
    this.s3 = (this.s3 ^ this.s1) >>> 0;
    this.s1 = (this.s1 ^ this.s2) >>> 0;
    this.s0 = (this.s0 ^ this.s3) >>> 0;
    this.s2 = (this.s2 ^ t) >>> 0;
    this.s3 = ((this.s3 << 11) | (this.s3 >>> 21)) >>> 0;
    return result;
  }

  /** float em [0, 1). */
  nextFloat(): number {
    return this.next() / 4294967296;
  }

  /** inteiro em [0, max). */
  nextInt(max: number): number {
    return (this.next() % max) >>> 0;
  }

  /** float em [min, max). */
  range(min: number, max: number): number {
    return min + this.nextFloat() * (max - min);
  }
}

/**
 * Hash determinístico de posição → uint32. Não guarda estado, então pode ser
 * chamado no caminho quente sem alocar nada.
 */
export function hash2(seed: number, x: number, z: number, salt = 0): number {
  let h = (seed ^ Math.imul(salt, 0x27d4eb2d)) >>> 0;
  h = (h ^ Math.imul(x | 0, 0x8da6b343)) >>> 0;
  h = (h ^ Math.imul(z | 0, 0xd8163841)) >>> 0;
  h = Math.imul(h ^ (h >>> 15), 0x2c1b3c6d) >>> 0;
  h = Math.imul(h ^ (h >>> 12), 0x297a2d39) >>> 0;
  return (h ^ (h >>> 15)) >>> 0;
}

/** Idem para 3 eixos. */
export function hash3(seed: number, x: number, y: number, z: number, salt = 0): number {
  let h = hash2(seed, x, z, salt);
  h = (h ^ Math.imul(y | 0, 0xcb1ab31f)) >>> 0;
  h = Math.imul(h ^ (h >>> 13), 0x165667b1) >>> 0;
  return (h ^ (h >>> 16)) >>> 0;
}

/** float em [0,1) derivado de uma posição — determinístico e sem estado. */
export function randAt(seed: number, x: number, z: number, salt = 0): number {
  return hash2(seed, x, z, salt) / 4294967296;
}

/** Rng semeado por posição, para geração de features (árvores, minérios). */
export function rngAt(seed: number, x: number, z: number, salt = 0): Rng {
  return new Rng(hash2(seed, x, z, salt), salt);
}

/**
 * Converte uma seed digitada pelo jogador em uint32 estável.
 *
 * Um código curto (`core/seedcode.ts`, M17) vale pelo número que ele guarda:
 * é assim que o mundo de quem compartilhou chega igual em outro aparelho.
 */
export function seedFromString(text: string): number {
  const trimmed = text.trim();
  if (trimmed === '') return (Math.random() * 4294967296) >>> 0;
  const code = parseSeedCode(trimmed);
  if (code !== null) return code;
  const asNumber = Number(trimmed);
  if (Number.isFinite(asNumber) && trimmed.match(/^-?\d+$/)) return asNumber >>> 0;
  let h = 0x811c9dc5;
  for (let i = 0; i < trimmed.length; i++) {
    h = Math.imul(h ^ trimmed.charCodeAt(i), 0x01000193) >>> 0;
  }
  return h >>> 0;
}
