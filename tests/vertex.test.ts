/** O formato de vértice é gravado em VBO e lido por bit ops no shader: um bit
 *  fora do lugar aqui vira geometria errada. */
import { describe, expect, it } from 'vitest';
import {
  AO_LEVELS, BYTES_PER_VERTEX_PACKED, FACE_NORMALS, packWord0, packWord1, writeFloatVertex,
} from '../src/render/vertex';

/** Reimplementa a descompactação do shader, para provar que ela casa. */
function unpack0(w: number) {
  return {
    x: (w & 63) * 0.5,
    y: ((w >>> 6) & 63) * 0.5,
    z: ((w >>> 12) & 63) * 0.5,
    face: (w >>> 18) & 7,
    u: (w >>> 21) & 31,
    v: (w >>> 26) & 31,
  };
}
function unpack1(w: number) {
  return {
    layer: w & 1023,
    blockLight: (w >>> 10) & 15,
    skyLight: (w >>> 14) & 15,
    ao: (w >>> 18) & 3,
    tint: (w >>> 20) & 15,
    flags: (w >>> 24) & 255,
  };
}

describe('formato de vértice', () => {
  it('cabe em 8 bytes', () => {
    expect(BYTES_PER_VERTEX_PACKED).toBe(8);
  });

  it('ida e volta da palavra 0', () => {
    const w = packWord0(32, 32, 32, 5, 16, 16);
    const u = unpack0(w);
    expect(u.x).toBe(16);
    expect(u.y).toBe(16);
    expect(u.z).toBe(16);
    expect(u.face).toBe(5);
    expect(u.u).toBe(16);
    expect(u.v).toBe(16);
  });

  it('suporta corrida greedy de 16 tiles (o caso que 4 bits não cobriam)', () => {
    expect(unpack0(packWord0(0, 0, 0, 0, 16, 16)).u).toBe(16);
  });

  it('ida e volta da palavra 1 com todos os campos no máximo', () => {
    const w = packWord1(1023, 15, 15, 3, 15, 255);
    const u = unpack1(w);
    expect(u).toEqual({ layer: 1023, blockLight: 15, skyLight: 15, ao: 3, tint: 15, flags: 255 });
  });

  it('campos não vazam um no outro', () => {
    const u = unpack1(packWord1(1, 0, 0, 0, 0, 0));
    expect(u.blockLight).toBe(0);
    expect(u.skyLight).toBe(0);
    expect(u.ao).toBe(0);
    const v = unpack0(packWord0(63, 0, 0, 0, 0, 0));
    expect(v.y).toBe(0);
    expect(v.z).toBe(0);
    expect(v.face).toBe(0);
  });

  it('as palavras são uint32 sem sinal', () => {
    expect(packWord0(63, 63, 63, 7, 31, 31)).toBeGreaterThan(0);
    expect(packWord1(1023, 15, 15, 3, 15, 255)).toBeGreaterThan(0);
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
    writeFloatVertex(out, 0, 10, 4, 6, 2, 3, 5, 42, 7, 12, 2, 1);
    expect(out[0]).toBe(5); // meios-blocos → blocos
    expect(out[3]).toBe(2);
    expect(out[6]).toBe(42);
    const packed = out[7];
    expect(packed % 16).toBe(7);
    expect(Math.floor(packed / 16) % 16).toBe(12);
    expect(Math.floor(packed / 256) % 4).toBe(2);
    expect(Math.floor(packed / 1024) % 16).toBe(1);
  });
});
