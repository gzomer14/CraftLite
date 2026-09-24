/**
 * Lua com fases (M14, doc 03 §8: "Lua com 8 fases").
 *
 * A fase já existia para o spawn de slime (`game/weather.ts`); no céu a lua
 * era sempre cheia. O shader acende o ponto do disco cuja normal olha para a
 * luz — aqui se confere o vetor de luz e, com a mesma conta do shader, quanto
 * do disco fica aceso em cada fase.
 */
import { describe, expect, it } from 'vitest';
import { moonPhaseVector, sunDirection } from '../src/render/sky';
import { MOON_PHASES } from '../src/game/weather';

/** Fração do disco acesa, com a conta de `moonColor` em `sky.glsl.ts`. */
function litFraction(phase: number): { total: number; leading: number } {
  const light = moonPhaseVector(phase, new Float32Array(2));
  let lit = 0;
  let disc = 0;
  let leading = 0;
  const N = 60;
  for (let i = 0; i < N; i++) {
    for (let j = 0; j < N; j++) {
      const u = (i + 0.5) / N * 2 - 1;
      const v = (j + 0.5) / N * 2 - 1;
      const r2 = u * u + v * v;
      if (r2 >= 1) continue;
      disc++;
      const z = Math.sqrt(1 - r2);
      if (v * light[0] + z * light[1] > 0) {
        lit++;
        if (v > 0) leading++;
      }
    }
  }
  return { total: lit / disc, leading: lit === 0 ? 0 : leading / lit };
}

describe('sol e lua no céu', () => {
  // Até o M14 o Y do sol saía com o sinal trocado: sol a pino à meia-noite,
  // debaixo do chão ao meio-dia, e a lua (oposta) nunca subia à noite.
  it('o sol está a pino ao meio-dia e a lua, à meia-noite', () => {
    const sun = sunDirection(6000, new Float32Array(3));
    expect(sun[1]).toBeCloseTo(1);
    const midnight = sunDirection(18000, new Float32Array(3));
    expect(-midnight[1]).toBeCloseTo(1); // a lua é o oposto do sol
  });

  it('o sol nasce e se põe no horizonte, e fica acima dele o dia inteiro', () => {
    expect(sunDirection(0, new Float32Array(3))[1]).toBeCloseTo(0);
    expect(sunDirection(12000, new Float32Array(3))[1]).toBeCloseTo(0);
    for (let t = 500; t < 12000; t += 500) {
      expect(sunDirection(t, new Float32Array(3))[1], `tick ${t}`).toBeGreaterThan(0);
    }
    for (let t = 12500; t < 24000; t += 500) {
      expect(sunDirection(t, new Float32Array(3))[1], `tick ${t}`).toBeLessThan(0);
    }
  });
});

describe('lua com fases', () => {
  it('são as oito fases do clima', () => {
    expect(MOON_PHASES).toBe(8);
  });

  it('cheia acende o disco todo, nova apaga', () => {
    expect(litFraction(0).total).toBeCloseTo(1, 2);
    expect(litFraction(4).total).toBeCloseTo(0, 2);
  });

  it('a luz míngua de 0 a 4 e cresce de 4 a 8', () => {
    const lit = [0, 1, 2, 3, 4, 5, 6, 7].map((p) => litFraction(p).total);
    for (let p = 0; p < 4; p++) expect(lit[p + 1]).toBeLessThan(lit[p]);
    for (let p = 4; p < 7; p++) expect(lit[p + 1]).toBeGreaterThan(lit[p]);
  });

  it('os quartos acendem metades opostas do disco', () => {
    const waning = litFraction(2);
    const waxing = litFraction(6);
    expect(waning.total).toBeCloseTo(0.5, 1);
    expect(waxing.total).toBeCloseTo(0.5, 1);
    expect(waning.leading).toBeGreaterThan(0.95);
    expect(waxing.leading).toBeLessThan(0.05);
  });

  it('a fase dá a volta: 8 é a 0, −1 é a 7', () => {
    const a = moonPhaseVector(8, new Float32Array(2));
    const b = moonPhaseVector(0, new Float32Array(2));
    expect(a[0]).toBeCloseTo(b[0]);
    expect(a[1]).toBeCloseTo(b[1]);
    const c = moonPhaseVector(-1, new Float32Array(2));
    const d = moonPhaseVector(7, new Float32Array(2));
    expect(c[0]).toBeCloseTo(d[0]);
  });
});
