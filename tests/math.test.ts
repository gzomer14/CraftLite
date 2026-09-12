/** Matrizes, spline de terreno e frustum culling. */
import { describe, expect, it } from 'vitest';
import {
  DEG2RAD, Frustum, clamp, createMat4, createVec3, forwardFrom, identity,
  lerp, lookYawPitch, multiply, perspective, smoothstep, spline,
} from '../src/core/math';

const near = (a: number, b: number, eps = 1e-5): void => {
  expect(Math.abs(a - b)).toBeLessThan(eps);
};

describe('matrizes', () => {
  it('identidade é neutra na multiplicação', () => {
    const a = createMat4();
    a[1] = 3; a[6] = -2; a[12] = 7;
    const id = createMat4();
    const out = createMat4();
    multiply(out, a, id);
    for (let i = 0; i < 16; i++) near(out[i], a[i]);
  });

  it('multiply aceita out === a sem corromper', () => {
    const a = createMat4();
    a[12] = 5;
    const b = createMat4();
    b[13] = 2;
    const expected = createMat4();
    multiply(expected, a, b);
    multiply(a, a, b);
    for (let i = 0; i < 16; i++) near(a[i], expected[i]);
  });

  it('perspectiva projeta o centro no centro do NDC', () => {
    const p = perspective(createMat4(), 70 * DEG2RAD, 16 / 9, 0.1, 100);
    // ponto em (0,0,-10) no espaço de vista
    const w = -(-10);
    const ndcX = (p[0] * 0) / w;
    const ndcY = (p[5] * 0) / w;
    near(ndcX, 0);
    near(ndcY, 0);
  });

  it('lookYawPitch em yaw=0 olha para +Z', () => {
    const f = forwardFrom(createVec3(), 0, 0);
    near(f[0], 0); near(f[1], 0); near(f[2], 1);
  });

  it('lookYawPitch em yaw=90° olha para +X', () => {
    const f = forwardFrom(createVec3(), Math.PI / 2, 0);
    near(f[0], 1); near(f[2], 0);
  });

  it('a matriz de vista leva a posição da câmera para a origem', () => {
    const v = lookYawPitch(createMat4(), 3, 4, 5, 0.7, 0.2);
    // aplica v a (3,4,5,1)
    const x = v[0] * 3 + v[4] * 4 + v[8] * 5 + v[12];
    const y = v[1] * 3 + v[5] * 4 + v[9] * 5 + v[13];
    const z = v[2] * 3 + v[6] * 4 + v[10] * 5 + v[14];
    near(x, 0, 1e-4); near(y, 0, 1e-4); near(z, 0, 1e-4);
  });

  it('identity zera o resto', () => {
    const m = createMat4();
    m.fill(9);
    identity(m);
    expect(Array.from(m)).toEqual([1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]);
  });
});

describe('utilitários numéricos', () => {
  it('clamp respeita os limites', () => {
    expect(clamp(-5, 0, 10)).toBe(0);
    expect(clamp(50, 0, 10)).toBe(10);
    expect(clamp(5, 0, 10)).toBe(5);
  });

  it('lerp interpola nos extremos', () => {
    expect(lerp(2, 6, 0)).toBe(2);
    expect(lerp(2, 6, 1)).toBe(6);
    expect(lerp(2, 6, 0.5)).toBe(4);
  });

  it('smoothstep tem derivada nula nas pontas', () => {
    expect(smoothstep(0)).toBe(0);
    expect(smoothstep(1)).toBe(1);
    near(smoothstep(0.5), 0.5);
    // crescimento perto de 0 é bem menor que no meio
    expect(smoothstep(0.05)).toBeLessThan(0.05);
  });
});

describe('spline de terreno', () => {
  const xs = [-1, -0.4, 0, 0.4, 1];
  const ys = [30, 55, 63, 90, 140];

  it('devolve os extremos fora do domínio', () => {
    expect(spline(xs, ys, -5)).toBe(30);
    expect(spline(xs, ys, 5)).toBe(140);
  });

  it('passa exatamente pelos nós', () => {
    for (let i = 0; i < xs.length; i++) near(spline(xs, ys, xs[i]), ys[i]);
  });

  it('é monotônica quando os ys são monotônicos', () => {
    let prev = -Infinity;
    for (let x = -1; x <= 1; x += 0.01) {
      const v = spline(xs, ys, x);
      expect(v).toBeGreaterThanOrEqual(prev - 1e-9);
      prev = v;
    }
  });
});

describe('frustum', () => {
  const build = (): Frustum => {
    const proj = perspective(createMat4(), 70 * DEG2RAD, 1, 0.1, 100);
    const view = lookYawPitch(createMat4(), 0, 0, 0, 0, 0); // olhando para +Z
    const vp = multiply(createMat4(), proj, view);
    const f = new Frustum();
    f.fromMatrix(vp);
    return f;
  };

  it('aceita uma caixa logo à frente', () => {
    expect(build().intersectsAabb(-1, -1, 5, 1, 1, 7)).toBe(true);
  });

  it('rejeita uma caixa atrás da câmera', () => {
    expect(build().intersectsAabb(-1, -1, -50, 1, 1, -40)).toBe(false);
  });

  it('rejeita uma caixa muito à esquerda', () => {
    expect(build().intersectsAabb(-200, -1, 5, -150, 1, 7)).toBe(false);
  });

  it('rejeita uma caixa além do plano distante', () => {
    expect(build().intersectsAabb(-1, -1, 500, 1, 1, 520)).toBe(false);
  });
});
