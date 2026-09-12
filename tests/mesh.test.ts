/**
 * O `MeshBuilder` é o alvo de todo o greedy meshing do M1 — winding, UVs e o
 * flip de AO precisam estar certos antes de qualquer chunk existir.
 */
import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../src/render/mesh';
import { FACE_NEG_X, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z, FACE_NORMALS } from '../src/render/vertex';

const AO_FLAT = [3, 3, 3, 3];

function readVertices(data: ArrayBuffer, count: number) {
  const w = new Uint32Array(data);
  const out: { x: number; y: number; z: number; face: number; u: number; v: number }[] = [];
  for (let i = 0; i < count; i++) {
    const w0 = w[i * 2];
    out.push({
      x: (w0 & 63) * 0.5,
      y: ((w0 >>> 6) & 63) * 0.5,
      z: ((w0 >>> 12) & 63) * 0.5,
      face: (w0 >>> 18) & 7,
      u: (w0 >>> 21) & 31,
      v: (w0 >>> 26) & 31,
    });
  }
  return out;
}

/** Normal geométrica dos 3 primeiros vértices, para checar o winding. */
function normalOf(v: { x: number; y: number; z: number }[]): [number, number, number] {
  const ax = v[1].x - v[0].x, ay = v[1].y - v[0].y, az = v[1].z - v[0].z;
  const bx = v[2].x - v[0].x, by = v[2].y - v[0].y, bz = v[2].z - v[0].z;
  const nx = ay * bz - az * by;
  const ny = az * bx - ax * bz;
  const nz = ax * by - ay * bx;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}

describe('MeshBuilder', () => {
  it('um quad gera 4 vértices e 6 índices', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    expect(b.vertices).toBe(4);
    expect(b.indices).toBe(6);
  });

  it('cada face aponta para a própria normal (winding CCW por fora)', () => {
    for (const face of [FACE_POS_X, FACE_NEG_X, FACE_POS_Y, FACE_NEG_Y, FACE_POS_Z, FACE_NEG_Z]) {
      const b = new MeshBuilder(true);
      b.addQuad(0, 0, 0, face, 1, 1, 0, 0, 15, AO_FLAT, 0);
      const data = b.build();
      const verts = readVertices(data.vertices, 4);
      const n = normalOf(verts);
      const expected = FACE_NORMALS[face];
      expect(n[0], `face ${face} x`).toBeCloseTo(expected[0], 5);
      expect(n[1], `face ${face} y`).toBeCloseTo(expected[1], 5);
      expect(n[2], `face ${face} z`).toBeCloseTo(expected[2], 5);
    }
  });

  it('todos os vértices ficam dentro do cubo unitário do bloco', () => {
    for (const face of [FACE_POS_X, FACE_NEG_X, FACE_POS_Y, FACE_NEG_Y, FACE_POS_Z, FACE_NEG_Z]) {
      const b = new MeshBuilder(true);
      b.addQuad(0, 0, 0, face, 1, 1, 0, 0, 15, AO_FLAT, 0);
      for (const v of readVertices(b.build().vertices, 4)) {
        for (const c of [v.x, v.y, v.z]) {
          expect(c, `face ${face}`).toBeGreaterThanOrEqual(0);
          expect(c, `face ${face}`).toBeLessThanOrEqual(1);
        }
      }
    }
  });

  it('cada face fica no plano certo do bloco (positivas em 1, negativas em 0)', () => {
    const cases: [number, 'x' | 'y' | 'z', number][] = [
      [FACE_POS_X, 'x', 1], [FACE_NEG_X, 'x', 0],
      [FACE_POS_Y, 'y', 1], [FACE_NEG_Y, 'y', 0],
      [FACE_POS_Z, 'z', 1], [FACE_NEG_Z, 'z', 0],
    ];
    for (const [face, axis, plane] of cases) {
      const b = new MeshBuilder(true);
      b.addQuad(0, 0, 0, face, 1, 1, 0, 0, 15, AO_FLAT, 0);
      for (const v of readVertices(b.build().vertices, 4)) {
        expect(v[axis], `face ${face} no eixo ${axis}`).toBe(plane);
      }
    }
  });

  it('as 6 faces de um bloco formam um cubo fechado sem faces coincidentes', () => {
    const b = new MeshBuilder(true);
    for (const face of [FACE_POS_X, FACE_NEG_X, FACE_POS_Y, FACE_NEG_Y, FACE_POS_Z, FACE_NEG_Z]) {
      b.addQuad(0, 0, 0, face, 1, 1, 0, 0, 15, AO_FLAT, 0);
    }
    const verts = readVertices(b.build().vertices, 24);
    // Todos os 8 cantos do cubo unitário aparecem, e cada um em 3 faces.
    const corners = new Map<string, number>();
    for (const v of verts) {
      const key = `${v.x},${v.y},${v.z}`;
      corners.set(key, (corners.get(key) ?? 0) + 1);
    }
    expect(corners.size).toBe(8);
    for (const count of corners.values()) expect(count).toBe(3);
  });

  it('a corrida greedy se estende nos dois eixos tangentes', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 3, 5, 0, 0, 15, AO_FLAT, 0);
    const verts = readVertices(b.build().vertices, 4);
    for (const v of verts) expect(v.y).toBe(1);
    expect(Math.max(...verts.map((v) => v.x))).toBe(3);
    expect(Math.max(...verts.map((v) => v.z))).toBe(5);
  });

  it('respeita a coordenada do bloco passada', () => {
    const b = new MeshBuilder(true);
    b.addQuad(4, 6, 8, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    for (const v of readVertices(b.build().vertices, 4)) {
      expect(v.y).toBe(7);
      expect(v.x).toBeGreaterThanOrEqual(4);
      expect(v.z).toBeGreaterThanOrEqual(8);
    }
  });

  it('as UVs seguem o tamanho da corrida greedy', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Z, 7, 4, 0, 0, 15, AO_FLAT, 0);
    const verts = readVertices(b.build().vertices, 4);
    expect(verts.map((v) => `${v.u},${v.v}`)).toEqual(['0,0', '7,0', '7,4', '0,4']);
  });

  it('faz o flip do quad quando a diagonal do AO está errada', () => {
    const normal = new MeshBuilder(true);
    normal.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, [0, 3, 0, 3], 0);
    const flipped = new MeshBuilder(true);
    flipped.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, [3, 0, 3, 0], 0);

    const a = new Uint16Array(normal.build().indices);
    const f = new Uint16Array(flipped.build().indices);
    expect(Array.from(a)).toEqual([0, 1, 2, 0, 2, 3]);
    expect(Array.from(f)).toEqual([1, 2, 3, 1, 3, 0]);
  });

  it('usa índices de 16 bits enquanto couber', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    expect(b.build().wideIndices).toBe(false);
  });

  it('cresce sozinho além da capacidade inicial', () => {
    const b = new MeshBuilder(true, 4);
    for (let i = 0; i < 500; i++) b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    expect(b.vertices).toBe(2000);
    expect(b.build().vertices.byteLength).toBe(2000 * 8);
  });

  it('reset zera sem realocar', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    b.reset();
    expect(b.vertices).toBe(0);
    expect(b.isEmpty).toBe(true);
  });

  it('o caminho em float gasta 32 bytes por vértice', () => {
    const b = new MeshBuilder(false);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    expect(b.build().vertices.byteLength).toBe(4 * 32);
  });

  it('o caminho comprimido gasta 8 bytes por vértice', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    expect(b.build().vertices.byteLength).toBe(4 * 8);
  });
});
