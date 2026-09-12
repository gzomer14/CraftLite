/**
 * Modelos e skins de mob (doc 07 §5, doc 13).
 *
 * Estes testes existem porque o "box mapping" é o tipo de coisa que erra em
 * silêncio: um retângulo de face que vaza para o vizinho não quebra nada, só
 * deixa o bicho com a textura errada num canto que ninguém olha. Aqui a
 * verificação é geométrica e roda em CI.
 */
import { describe, expect, it } from 'vitest';
import {
  FACE_ORDER, MODELS, faceRect, modelOf, type PartDef,
} from '../src/data/mobmodels';
import { MOB_SKINS } from '../src/data/mobskins';
import { MOBS } from '../src/data/mobs';
import { generateSkin } from '../src/render/skingen';

/** Largura e altura que o "box mapping" de uma caixa ocupa na skin. */
function uvSize(part: PartDef): [number, number] {
  const [, , , sx, sy, sz] = part.box;
  return [2 * (sx + sz), sz + sy];
}

describe('modelos', () => {
  it('todo mob aponta para um modelo e uma skin que existem', () => {
    for (const mob of MOBS) {
      expect(MODELS[mob.model], mob.name).toBeDefined();
      expect(MOB_SKINS[mob.skin], mob.name).toBeDefined();
    }
  });

  it('nenhum retângulo de UV sai da skin', () => {
    const rect = new Float32Array(4);
    for (const name of Object.keys(MODELS)) {
      const model = MODELS[name];
      for (const part of model.parts) {
        for (const face of FACE_ORDER) {
          faceRect(part, face, rect);
          expect(rect[0], `${name}.${part.name}.${face} x`).toBeGreaterThanOrEqual(0);
          expect(rect[1], `${name}.${part.name}.${face} y`).toBeGreaterThanOrEqual(0);
          expect(rect[0] + rect[2], `${name}.${part.name}.${face} w`)
            .toBeLessThanOrEqual(model.skinSize);
          expect(rect[1] + rect[3], `${name}.${part.name}.${face} h`)
            .toBeLessThanOrEqual(model.skinSize);
        }
      }
    }
  });

  it('as seis faces de uma caixa cabem no bloco de UV declarado', () => {
    const rect = new Float32Array(4);
    for (const name of Object.keys(MODELS)) {
      for (const part of MODELS[name].parts) {
        const [width, height] = uvSize(part);
        for (const face of FACE_ORDER) {
          faceRect(part, face, rect);
          expect(rect[0] - part.uv[0]).toBeGreaterThanOrEqual(0);
          expect(rect[1] - part.uv[1]).toBeGreaterThanOrEqual(0);
          expect(rect[0] - part.uv[0] + rect[2]).toBeLessThanOrEqual(width);
          expect(rect[1] - part.uv[1] + rect[3]).toBeLessThanOrEqual(height);
        }
      }
    }
  });

  it('a altura do modelo bate com a hitbox do mob (±25%)', () => {
    for (const mob of MOBS) {
      const model = modelOf(mob.model);
      // O slime é escalado pelo tamanho, então o modelo base é o menor.
      if (mob.traits.splitsOnDeath === true) continue;
      const modelBlocks = model.height / 16;
      expect(Math.abs(modelBlocks - mob.height) / mob.height, mob.name).toBeLessThan(0.25);
    }
  });

  it('modelo desconhecido falha alto, não em silêncio', () => {
    expect(() => modelOf('cavalo_de_troia')).toThrow();
  });

  it('as partes animadas declaram amplitude', () => {
    for (const name of Object.keys(MODELS)) {
      for (const part of MODELS[name].parts) {
        if (part.anim === 'swing' || part.anim === 'flap') {
          expect(part.amp, `${name}.${part.name}`).toBeDefined();
          expect(Math.abs(part.amp ?? 0)).toBeGreaterThan(0);
        }
      }
    }
  });
});

describe('skins geradas', () => {
  it('gera uma skin opaca do tamanho certo para cada mob', () => {
    for (const mob of MOBS) {
      const model = modelOf(mob.model);
      const data = generateSkin(model, MOB_SKINS[mob.skin], 1234);
      expect(data.length).toBe(model.skinSize * model.skinSize * 4);

      // Todo texel usado pelo modelo é opaco: alfa 0 no meio de um mob
      // apareceria como buraco, e o shader descarta abaixo de 0.5.
      const rect = new Float32Array(4);
      for (const part of model.parts) {
        faceRect(part, 'front', rect);
        const x = Math.floor(rect[0] + rect[2] / 2);
        const y = Math.floor(rect[1] + rect[3] / 2);
        const alpha = data[((y * model.skinSize + x) << 2) + 3];
        expect(alpha, `${mob.name}.${part.name}`).toBe(255);
      }
    }
  });

  it('é determinística: mesma receita e seed, mesmos pixels', () => {
    const model = modelOf('zombie');
    const a = generateSkin(model, MOB_SKINS.zombie, 7);
    const b = generateSkin(model, MOB_SKINS.zombie, 7);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('seeds diferentes mudam o ruído, não a cor de base', () => {
    const model = modelOf('zombie');
    const a = generateSkin(model, MOB_SKINS.zombie, 1);
    const b = generateSkin(model, MOB_SKINS.zombie, 2);
    expect(Array.from(a)).not.toEqual(Array.from(b));

    // A média continua parecida: o ruído é ±8%, não uma cor nova.
    const meanA = average(a);
    const meanB = average(b);
    for (let c = 0; c < 3; c++) expect(Math.abs(meanA[c] - meanB[c])).toBeLessThan(6);
  });

  it('a cor por parte vence a cor de base', () => {
    const model = modelOf('quadruped');
    const data = generateSkin(model, {
      base: [255, 0, 0],
      noise: 0,
      parts: { head: [0, 255, 0] },
    }, 9);

    const rect = new Float32Array(4);
    const head = model.parts.find((p) => p.name === 'head');
    expect(head).toBeDefined();
    if (head === undefined) return;
    faceRect(head, 'front', rect);
    const x = Math.floor(rect[0] + rect[2] / 2);
    const y = Math.floor(rect[1] + rect[3] / 2);
    const o = (y * model.skinSize + x) << 2;
    expect(data[o + 1]).toBeGreaterThan(data[o]);
  });

  it('o detalhe de olhos escurece a face frontal da cabeça', () => {
    const model = modelOf('zombie');
    const plain = generateSkin(model, { base: [200, 200, 200], noise: 0 }, 3);
    const eyed = generateSkin(model, {
      base: [200, 200, 200], noise: 0,
      details: [{ kind: 'eyes', part: 'head', color: [0, 0, 0] }],
    }, 3);
    expect(average(eyed)[0]).toBeLessThan(average(plain)[0]);
  });
});

function average(data: Uint8ClampedArray): [number, number, number] {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i + 3] === 0) continue;
    r += data[i];
    g += data[i + 1];
    b += data[i + 2];
    n++;
  }
  return n === 0 ? [0, 0, 0] : [r / n, g / n, b / n];
}
