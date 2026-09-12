/**
 * As texturas de rachadura precisam crescer de forma monotônica e nunca cobrir
 * o bloco. A primeira versão acumulava ramos a cada estágio e virava uma mancha
 * preta sólida no meio da quebra.
 */
import { describe, expect, it } from 'vitest';
import { TEXTURES } from '../src/data/textures';
import { renderRecipe } from '../src/render/texgen';
import { crackToneFor } from '../src/render/selection';

function stageCoverage(stage: number): number {
  const data = renderRecipe(TEXTURES[`block/destroy_stage_${stage}`], stage, () =>
    new Uint8ClampedArray(16 * 16 * 4));
  let dark = 0;
  for (let i = 0; i < 256; i++) if (data[(i << 2)] < 128) dark++;
  return dark / 256;
}

describe('estágios de rachadura', () => {
  it('existem os 10 estágios', () => {
    for (let i = 0; i < 10; i++) {
      expect(TEXTURES[`block/destroy_stage_${i}`], `estágio ${i}`).toBeDefined();
    }
  });

  it('a cobertura cresce de forma monotônica', () => {
    let previous = -1;
    for (let stage = 0; stage < 10; stage++) {
      const coverage = stageCoverage(stage);
      expect(coverage, `estágio ${stage}`).toBeGreaterThanOrEqual(previous);
      previous = coverage;
    }
  });

  it('o primeiro estágio é discreto', () => {
    expect(stageCoverage(0)).toBeLessThan(0.06);
  });

  it('o último estágio ainda deixa o bloco reconhecível', () => {
    const coverage = stageCoverage(9);
    expect(coverage).toBeGreaterThan(0.08); // dá para ver
    expect(coverage).toBeLessThan(0.35);    // mas não vira mancha preta
  });

  it('o fundo é branco, para o blend de multiplicação não alterar o bloco', () => {
    const data = renderRecipe(TEXTURES['block/destroy_stage_0'], 0, () =>
      new Uint8ClampedArray(16 * 16 * 4));
    let white = 0;
    for (let i = 0; i < 256; i++) if (data[i << 2] === 255) white++;
    expect(white).toBeGreaterThan(200);
  });
});

/**
 * Tom da fissura (queixa de campo, 2026-09-10: *"blocos como o de madeira não
 * estão demarcando bem quando estamos quebrando"*).
 *
 * A fissura era sempre escura, em blend de multiplicação — em tronco,
 * obsidiana ou pedra profunda ela desaparecia, e não dava para ver se a
 * batida estava pegando. O tom agora acompanha o brilho do bloco.
 */
describe('tom da rachadura por brilho do bloco', () => {
  it('bloco claro recebe fissura escura', () => {
    expect(crackToneFor(0.8).tone).toBe(0);
    expect(crackToneFor(0.46).tone).toBe(0);
  });

  it('bloco escuro recebe fissura clara', () => {
    expect(crackToneFor(0.2).tone).toBe(1);
    expect(crackToneFor(0.44).tone).toBe(1);
  });

  it('a fissura clara é menos opaca que a escura', () => {
    expect(crackToneFor(0.1).alpha).toBeLessThan(crackToneFor(0.9).alpha);
  });

  it('os dois extremos têm contraste contra o próprio fundo', () => {
    // |tom − brilho| é o contraste cru; abaixo de 0,3 o olho não separa.
    for (const brightness of [0, 0.2, 0.44, 0.46, 0.7, 1]) {
      const { tone } = crackToneFor(brightness);
      expect(Math.abs(tone - brightness), `brilho ${brightness}`).toBeGreaterThan(0.3);
    }
  });
});
