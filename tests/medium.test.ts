/**
 * Visão de dentro da água e da lava (M14).
 *
 * Mergulhar não mudava nada na tela. O critério do doc 14 é que a tela mude
 * **no quadro** em que o olho entra no fluido — aqui se prova a parte que não
 * precisa de GL: o meio sai do bloco do olho e troca névoa e tom.
 */
import { describe, expect, it } from 'vitest';
import {
  MEDIUM_AIR, MEDIUM_LAVA, MEDIUM_WATER, applyMedium, mediumOfBlock,
} from '../src/render/medium';
import type { SkyParams } from '../src/render/terrain';

function params(): SkyParams {
  return {
    fogColor: new Float32Array([0.5, 0.7, 1]),
    fogDensity: 0.006,
    dayFactor: 1,
    minSkyLight: 0.06,
    tint: new Float32Array([1, 1, 1]),
  };
}

/** Fração de névoa a `d` blocos, com a mesma curva do shader. */
function fogAt(density: number, d: number): number {
  const f = d * density;
  return 1 - Math.exp(-f * f);
}

describe('meio do olho', () => {
  it('o nome do bloco decide o meio', () => {
    expect(mediumOfBlock('water')).toBe(MEDIUM_WATER);
    expect(mediumOfBlock('lava')).toBe(MEDIUM_LAVA);
    expect(mediumOfBlock('air')).toBe(MEDIUM_AIR);
    expect(mediumOfBlock('stone')).toBe(MEDIUM_AIR);
  });

  it('no ar nada muda', () => {
    const base = params();
    const out = params();
    out.fogDensity = 123;
    expect(applyMedium(MEDIUM_AIR, 1, base, out)).toBe(false);
    expect(out.fogDensity).toBe(123);
  });

  it('debaixo d\'água a névoa é azul e curta, e o tom esfria', () => {
    const base = params();
    const out = params();
    expect(applyMedium(MEDIUM_WATER, 1, base, out)).toBe(true);
    expect(out.fogColor[2]).toBeGreaterThan(out.fogColor[0] * 3);
    // A 8 blocos ainda se vê; a 24, não.
    expect(fogAt(out.fogDensity, 8)).toBeLessThan(0.6);
    expect(fogAt(out.fogDensity, 24)).toBeGreaterThan(0.95);
    expect(out.tint[0]).toBeLessThan(out.tint[2]);
    // O céu do quadro não é tocado: sair da água volta ao que era.
    expect(base.fogDensity).toBe(0.006);
    expect(base.tint[0]).toBe(1);
  });

  it('a água escurece com a luz que chega ao olho', () => {
    const lit = params();
    const dark = params();
    applyMedium(MEDIUM_WATER, 1, params(), lit);
    applyMedium(MEDIUM_WATER, 0, params(), dark);
    expect(dark.fogColor[2]).toBeLessThan(lit.fogColor[2] * 0.3);
    expect(dark.fogColor[2]).toBeGreaterThan(0);
  });

  it('na lava a névoa é laranja e quase opaca a dois blocos, com ou sem luz', () => {
    const lit = params();
    const dark = params();
    applyMedium(MEDIUM_LAVA, 1, params(), lit);
    applyMedium(MEDIUM_LAVA, 0, params(), dark);
    expect(lit.fogColor[0]).toBeGreaterThan(lit.fogColor[2] * 5);
    expect(fogAt(lit.fogDensity, 2)).toBeGreaterThan(0.95);
    expect(dark.fogColor[0]).toBeCloseTo(lit.fogColor[0]);
  });

  it('a água nunca é mais rala que o ar de uma distância de render curta', () => {
    const base = params();
    base.fogDensity = 0.5;
    const out = params();
    applyMedium(MEDIUM_WATER, 1, base, out);
    expect(out.fogDensity).toBe(0.5);
  });
});
