/** Determinismo do PRNG e dos hashes de posição — a base de "mesma seed, mesmo mundo". */
import { describe, expect, it } from 'vitest';
import { Rng, hash2, hash3, randAt, rngAt, seedFromString } from '../src/core/rng';

describe('Rng', () => {
  it('produz a mesma sequência para a mesma seed', () => {
    const a = new Rng(12345);
    const b = new Rng(12345);
    for (let i = 0; i < 200; i++) expect(a.next()).toBe(b.next());
  });

  it('produz sequências diferentes para seeds diferentes', () => {
    const a = new Rng(1);
    const b = new Rng(2);
    let equal = 0;
    for (let i = 0; i < 100; i++) if (a.next() === b.next()) equal++;
    expect(equal).toBeLessThan(3);
  });

  it('nunca sai de [0,1) em nextFloat', () => {
    const r = new Rng(99);
    for (let i = 0; i < 5000; i++) {
      const v = r.nextFloat();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('distribui nextFloat de forma razoavelmente uniforme', () => {
    const r = new Rng(7);
    const buckets = new Array<number>(10).fill(0);
    const n = 100000;
    for (let i = 0; i < n; i++) buckets[Math.floor(r.nextFloat() * 10)]++;
    for (const b of buckets) expect(Math.abs(b - n / 10)).toBeLessThan(n * 0.01);
  });

  it('sobrevive a seeds degeneradas (0, 1, 2)', () => {
    for (const seed of [0, 1, 2]) {
      const r = new Rng(seed);
      const seen = new Set<number>();
      for (let i = 0; i < 50; i++) seen.add(r.next());
      expect(seen.size).toBeGreaterThan(45);
    }
  });
});

describe('hash de posição', () => {
  it('é estável e independente da ordem de chamada', () => {
    const direct = hash2(42, 10, -7, 3);
    hash2(42, 999, 999, 999);
    expect(hash2(42, 10, -7, 3)).toBe(direct);
  });

  it('separa eixos: (x,z) e (z,x) dão valores diferentes', () => {
    expect(hash2(1, 5, 9)).not.toBe(hash2(1, 9, 5));
  });

  it('o salt muda o resultado', () => {
    expect(hash2(1, 5, 9, 0)).not.toBe(hash2(1, 5, 9, 1));
  });

  it('hash3 depende de y', () => {
    expect(hash3(1, 2, 3, 4)).not.toBe(hash3(1, 2, 5, 4));
  });

  it('randAt fica em [0,1)', () => {
    for (let x = -50; x < 50; x++) {
      const v = randAt(3, x, x * 7);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it('rngAt em posições vizinhas não correlaciona', () => {
    const a = rngAt(5, 0, 0).nextFloat();
    const b = rngAt(5, 1, 0).nextFloat();
    expect(Math.abs(a - b)).toBeGreaterThan(0.001);
  });
});

describe('seedFromString', () => {
  it('aceita seed numérica literal', () => {
    expect(seedFromString('12345')).toBe(12345);
  });

  it('converte texto de forma estável', () => {
    expect(seedFromString('vale profundo')).toBe(seedFromString('vale profundo'));
    expect(seedFromString('vale profundo')).not.toBe(seedFromString('vale rasos'));
  });

  it('ignora espaços em volta', () => {
    expect(seedFromString('  abc  ')).toBe(seedFromString('abc'));
  });
});
