/** O formato de vértice é gravado em VBO e lido por bit ops no shader: um bit
 *  fora do lugar aqui vira geometria errada. */
import { describe, expect, it } from 'vitest';
import {
  AO_LEVELS, BYTES_PER_VERTEX_PACKED, FACE_NORMALS, POSITION_SCALE,
  packWord0, packWord1, writeFloatVertex,
} from '../src/render/vertex';

/** Reimplementa a descompactação do shader, para provar que ela casa. */
function unpack0(w: number) {
  return {
    x: (w & 511) / POSITION_SCALE,
    y: ((w >>> 9) & 511) / POSITION_SCALE,
    z: ((w >>> 18) & 511) / POSITION_SCALE,
    face: (w >>> 27) & 7,
  };
}
function unpack1(w: number) {
  return {
    layer: w & 255,
    blockLight: (w >>> 8) & 15,
    skyLight: (w >>> 12) & 15,
    ao: (w >>> 16) & 3,
    tint: (w >>> 18) & 15,
    u: (w >>> 22) & 31,
    v: (w >>> 27) & 31,
  };
}

describe('formato de vértice', () => {
  it('cabe em 8 bytes', () => {
    expect(BYTES_PER_VERTEX_PACKED).toBe(8);
  });

  it('ida e volta da palavra 0', () => {
    const u = unpack0(packWord0(256, 128, 8, 5));
    expect(u.x).toBe(16);
    expect(u.y).toBe(8);
    expect(u.z).toBe(0.5);
    expect(u.face).toBe(5);
  });

  /*
   * A regressão que motivou os 9 bits: com meios-blocos, toda caixa mais fina
   * que 0,5 colapsava e o poste de cerca sumia da tela.
   */
  it('representa as caixas finas do jogo sem colapsar', () => {
    const fino = [1 / 16, 2 / 16, 3 / 16, 6 / 16, 7 / 16, 9 / 16, 10 / 16, 15 / 16];
    for (const valor of fino) {
      const bloco = unpack0(packWord0(Math.round(valor * POSITION_SCALE), 0, 0, 0)).x;
      expect(bloco).toBeCloseTo(valor, 6);
    }
  });

  it('a section inteira cabe no campo de posição (0..256)', () => {
    expect(unpack0(packWord0(256, 256, 256, 0)).x).toBe(16);
    expect(unpack0(packWord0(256, 256, 256, 0)).z).toBe(16);
  });

  it('suporta corrida greedy de 16 tiles (o caso que 4 bits não cobriam)', () => {
    expect(unpack1(packWord1(0, 0, 0, 0, 0, 16, 16)).u).toBe(16);
  });

  it('ida e volta da palavra 1 com todos os campos no máximo', () => {
    const u = unpack1(packWord1(255, 15, 15, 3, 15, 31, 31));
    expect(u).toEqual({
      layer: 255, blockLight: 15, skyLight: 15, ao: 3, tint: 15, u: 31, v: 31,
    });
  });

  /*
   * M13 (2026-09-22): o tint tem 6 bits — 4 na palavra 1, 2 no topo da
   * palavra 0 —, para caber grama, folha, água e os dezesseis corantes.
   */
  it('o tint de 6 bits se divide entre as duas palavras e volta inteiro', () => {
    for (const tint of [0, 3, 4, 19, 63]) {
      const w0 = packWord0(1, 2, 3, 4, tint);
      const w1 = packWord1(7, 1, 2, 3, tint, 4, 5);
      const back = ((w1 >>> 18) & 15) | (((w0 >>> 30) & 3) << 4);
      expect(back).toBe(tint);
      expect(unpack0(w0)).toEqual(unpack0(packWord0(1, 2, 3, 4)));
    }
  });

  it('campos não vazam um no outro', () => {
    const u = unpack1(packWord1(1, 0, 0, 0, 0, 0, 0));
    expect(u.blockLight).toBe(0);
    expect(u.skyLight).toBe(0);
    expect(u.ao).toBe(0);
    expect(u.tint).toBe(0);
    const v = unpack0(packWord0(511, 0, 0, 0));
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
    expect(v.face).toBe(0);
  });

  it('as palavras são uint32 sem sinal', () => {
    expect(packWord0(511, 511, 511, 7)).toBeGreaterThan(0);
    expect(packWord1(1023, 15, 15, 3, 3, 31, 31)).toBeGreaterThan(0);
  });

  it('há 6 normais, uma por face, e são unitárias', () => {
    expect(FACE_NORMALS.length).toBe(6);
    for (const n of FACE_NORMALS) {
      expect(Math.abs(n[0]) + Math.abs(n[1]) + Math.abs(n[2])).toBe(1);
    }
  });

  it('os 4 níveis de AO batem com o doc 02 §5.2', () => {
    const expected = [0.55, 0.7, 0.85, 1];
    for (let i = 0; i < 4; i++) expect(AO_LEVELS[i]).toBeCloseTo(expected[i], 6);
  });
});

describe('fallback em float', () => {
  it('empacota luz, AO e tint em um único float recuperável', () => {
    const out = new Float32Array(8);
    writeFloatVertex(out, 0, 24, 4, 6, 2, 3, 5, 42, 7, 12, 2, 1);
    expect(out[0]).toBe(1.5); // dezesseis avos → blocos
    expect(out[3]).toBe(2);
    expect(out[6]).toBe(42);
    const packed = out[7];
    expect(packed % 16).toBe(7);
    expect(Math.floor(packed / 16) % 16).toBe(12);
    expect(Math.floor(packed / 256) % 4).toBe(2);
    expect(Math.floor(packed / 1024) % 16).toBe(1);
  });
});
