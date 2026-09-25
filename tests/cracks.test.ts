/**
 * As texturas de rachadura precisam crescer de forma monotônica e nunca cobrir
 * o bloco. A primeira versão acumulava ramos a cada estágio e virava uma mancha
 * preta sólida no meio da quebra.
 */
import { describe, expect, it } from 'vitest';
import { TEXTURES } from '../src/data/textures';
import { renderRecipe } from '../src/render/texgen';
import { buildCrackCube, crackToneFor } from '../src/render/selection';

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

/**
 * Queixa de campo (2026-09-25): *"você começa a quebrar a árvore e ele não
 * muda a textura […], eu só consigo ver na parte de cima ou de baixo do
 * tronco"*. As faces laterais do cubo da rachadura estavam enroladas para
 * dentro, e o passe desenha com `CULL_FACE`.
 */
describe('cubo da rachadura', () => {
  it('regressão: toda face é anti-horária vista de fora (sobrevive ao culling)', () => {
    const v = buildCrackCube();
    const triangles = v.length / 15;
    expect(triangles).toBe(12);
    const outward = new Set<string>();
    for (let t = 0; t < triangles; t++) {
      const o = t * 15;
      const ax = v[o + 5] - v[o], ay = v[o + 6] - v[o + 1], az = v[o + 7] - v[o + 2];
      const bx = v[o + 10] - v[o], by = v[o + 11] - v[o + 1], bz = v[o + 12] - v[o + 2];
      const nx = ay * bz - az * by, ny = az * bx - ax * bz, nz = ax * by - ay * bx;
      // Do centro do cubo ao centro do triângulo: a normal tem que apontar para lá.
      const cx = (v[o] + v[o + 5] + v[o + 10]) / 3 - 0.5;
      const cy = (v[o + 1] + v[o + 6] + v[o + 11]) / 3 - 0.5;
      const cz = (v[o + 2] + v[o + 7] + v[o + 12]) / 3 - 0.5;
      expect(nx * cx + ny * cy + nz * cz, `triângulo ${t}`).toBeGreaterThan(0);
      outward.add(`${Math.sign(nx)},${Math.sign(ny)},${Math.sign(nz)}`);
    }
    expect(outward.size, 'as seis direções').toBe(6);
  });

  it('nas laterais, a textura fica de pé (v cresce para cima)', () => {
    const v = buildCrackCube();
    for (let t = 0; t < 12; t++) {
      const o = t * 15;
      const sameY = v[o + 1] === v[o + 6] && v[o + 6] === v[o + 11];
      if (sameY) continue; // topo e base
      for (let k = 0; k < 3; k++) expect(v[o + k * 5 + 4]).toBe(v[o + k * 5 + 1]);
    }
  });
});

/**
 * O contorno da fissura: textura de dois tons (a casca do tronco, a tábua de
 * carvalho) tem pixel dos dois lados do corte de brilho, e fissura de um tom
 * só some numa parte deles. O contorno de um pixel no tom oposto aparece onde
 * a fissura some.
 */
describe('contorno da fissura', () => {
  const stage = (n: number) => renderRecipe(TEXTURES[`block/destroy_stage_${n}`], n, () =>
    new Uint8ClampedArray(16 * 16 * 4));

  it('o verde marca a fissura e só os vizinhos de lado dela', () => {
    for (let n = 0; n < 10; n++) {
      const d = stage(n);
      const core = (x: number, y: number) =>
        x >= 0 && x < 16 && y >= 0 && y < 16 && d[((y << 4) | x) << 2] === 0;
      let ring = 0;
      for (let y = 0; y < 16; y++) {
        for (let x = 0; x < 16; x++) {
          const green = d[(((y << 4) | x) << 2) + 1];
          const nearCore = core(x, y) || core(x - 1, y) || core(x + 1, y) || core(x, y - 1) || core(x, y + 1);
          expect(green === 0, `estágio ${n} (${x},${y})`).toBe(nearCore);
          if (green === 0 && !core(x, y)) ring++;
        }
      }
      expect(ring, `estágio ${n}`).toBeGreaterThan(0);
    }
  });
});
