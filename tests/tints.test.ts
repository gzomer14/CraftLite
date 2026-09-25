/**
 * Lã e cama por tint (M13, 2026-09-22).
 *
 * As oito cores custavam 4 camadas de atlas cada (lã e três da cama). Agora
 * são um desenho cinza tingido no shader, e as dezesseis custam menos do que
 * as oito custavam — o critério do doc 14.
 */
import { describe, expect, it } from 'vitest';
import { DYES } from '../src/data/dyes';
import { MAX_TINTS, TINT_COLORS, TINT_COUNT, TINT_DYE_BASE, tintIndexOf } from '../src/data/tints';
import { BLOCK_BY_NAME, BLOCKS } from '../src/data/blocks';
import { buildLayerIndex } from '../src/render/layers';
import { renderRecipe } from '../src/render/texgen';
import { TEXTURES } from '../src/data/textures';

const noResolve = (): Uint8ClampedArray => new Uint8ClampedArray(16 * 16 * 4);

describe('tints de corante', () => {
  it('dezesseis cores, dentro do teto de 6 bits', () => {
    expect(DYES.length).toBe(16);
    expect(TINT_COUNT).toBeLessThanOrEqual(MAX_TINTS);
  });

  it('cada lã e cada cama aponta o tint da sua cor', () => {
    DYES.forEach((dye, i) => {
      const wool = BLOCK_BY_NAME.get(dye.name === 'white' ? 'white_wool' : `${dye.name}_wool`)!;
      expect(tintIndexOf(wool), dye.name).toBe(TINT_DYE_BASE + i);
    });
  });

  it('cores diferentes saem diferentes (distância > 30 em 0..255)', () => {
    for (let a = 0; a < DYES.length; a++) {
      for (let b = a + 1; b < DYES.length; b++) {
        const ia = (TINT_DYE_BASE + a) * 3;
        const ib = (TINT_DYE_BASE + b) * 3;
        const d = Math.hypot(
          (TINT_COLORS[ia] - TINT_COLORS[ib]) * 255,
          (TINT_COLORS[ia + 1] - TINT_COLORS[ib + 1]) * 255,
          (TINT_COLORS[ia + 2] - TINT_COLORS[ib + 2]) * 255,
        );
        expect(d, `${DYES[a].name} × ${DYES[b].name}`).toBeGreaterThan(30);
      }
    }
  });

  it('as 16 cores de lã e cama usam 4 camadas, contra 32 das 8 antigas', () => {
    const layers = new Set<string>();
    for (const def of BLOCKS) {
      if (def === undefined || def.dye === null) continue;
      const tex = def.tex;
      if (typeof tex === 'string') layers.add(tex);
      else for (const t of [tex.top, tex.side, tex.bottom]) if (t !== undefined) layers.add(t);
    }
    expect(layers.size).toBe(4);
    // O teto do doc 02 §3. O limite antigo (< 222) era a foto do M15; o M16
    // somou 11 camadas (poção, End, fortaleza).
    expect(buildLayerIndex().count).toBeLessThanOrEqual(256);
  });

  it('a cama marca madeira e travesseiro como não-tingíveis (alfa 0,75)', () => {
    const side = renderRecipe(TEXTURES['block/bed_side'], 1, noResolve);
    const alpha = (x: number, y: number): number => side[((y * 16 + x) << 2) + 3];
    expect(alpha(8, 0), 'madeira').toBe(191);
    expect(alpha(8, 6), 'colchão').toBe(255);
  });

  it('cabeceira e pé se distinguem pelo travesseiro, que não tinge', () => {
    const head = renderRecipe(TEXTURES['block/bed_top'], 1, noResolve);
    const foot = renderRecipe(TEXTURES['block/bed_foot_top'], 1, noResolve);
    const at = (px: Uint8ClampedArray, x: number, y: number): number => px[((y * 16 + x) << 2) + 3];
    expect(at(head, 8, 3)).toBe(191);
    expect(at(foot, 8, 3)).toBe(255);
  });
});
