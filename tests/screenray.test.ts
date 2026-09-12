/**
 * Conversão tela → raio de mundo. É o que faz o Modo A funcionar: o raycast
 * parte do dedo, não do centro da tela. Um erro de sinal aqui faz o jogador
 * quebrar o bloco errado, e isso é difícil de perceber só olhando.
 */
import { describe, expect, it } from 'vitest';
import { Camera } from '../src/render/camera';
import { createVec3, forwardFrom, invert, createMat4, multiply, perspective, DEG2RAD, lookYawPitch } from '../src/core/math';

function camera(yaw = 0, pitch = 0): Camera {
  const cam = new Camera();
  cam.setPosition(0, 64, 0);
  cam.yaw = yaw;
  cam.pitch = pitch;
  cam.snapshot();
  cam.update(1, 16 / 9);
  return cam;
}

describe('rayFromNdc', () => {
  it('o centro da tela dá a direção da câmera', () => {
    const cam = camera(0.7, 0.3);
    const ray = cam.rayFromNdc(0, 0);
    const expected = forwardFrom(createVec3(), 0.7, 0.3);
    for (let i = 0; i < 3; i++) expect(ray[i]).toBeCloseTo(expected[i], 4);
  });

  it('devolve um vetor unitário', () => {
    const cam = camera(0.4, -0.2);
    for (const [x, y] of [[0, 0], [0.8, 0.6], [-1, -1], [1, 1]]) {
      const ray = cam.rayFromNdc(x, y);
      expect(Math.hypot(ray[0], ray[1], ray[2])).toBeCloseTo(1, 5);
    }
  });

  it('a direita da tela aponta para a direita da câmera', () => {
    const cam = camera(0, 0); // olhando para +Z; a direita é −X
    const ray = cam.rayFromNdc(0.5, 0);
    expect(ray[0]).toBeLessThan(0);
    expect(ray[2]).toBeGreaterThan(0);
  });

  it('o topo da tela aponta para cima', () => {
    const cam = camera(0, 0);
    const ray = cam.rayFromNdc(0, 0.5);
    expect(ray[1]).toBeGreaterThan(0);
  });

  it('a base da tela aponta para baixo', () => {
    const cam = camera(0, 0);
    expect(cam.rayFromNdc(0, -0.5)[1]).toBeLessThan(0);
  });

  it('respeita o yaw da câmera', () => {
    const cam = camera(Math.PI / 2, 0); // olhando para +X
    const ray = cam.rayFromNdc(0, 0);
    expect(ray[0]).toBeCloseTo(1, 4);
    expect(ray[2]).toBeCloseTo(0, 4);
  });

  it('cantos opostos dão direções distintas', () => {
    const cam = camera(0, 0);
    const a = Array.from(cam.rayFromNdc(-1, -1));
    const b = Array.from(cam.rayFromNdc(1, 1));
    expect(a).not.toEqual(b);
  });
});

describe('toNdc', () => {
  it('o centro do canvas vira (0,0)', () => {
    const out = new Float32Array(2);
    Camera.toNdc(400, 200, 800, 400, out);
    expect(out[0]).toBeCloseTo(0, 6);
    expect(out[1]).toBeCloseTo(0, 6);
  });

  it('o canto superior esquerdo vira (−1, 1)', () => {
    const out = new Float32Array(2);
    Camera.toNdc(0, 0, 800, 400, out);
    expect(out[0]).toBeCloseTo(-1, 6);
    expect(out[1]).toBeCloseTo(1, 6);
  });

  it('o canto inferior direito vira (1, −1)', () => {
    const out = new Float32Array(2);
    Camera.toNdc(800, 400, 800, 400, out);
    expect(out[0]).toBeCloseTo(1, 6);
    expect(out[1]).toBeCloseTo(-1, 6);
  });
});

describe('inversão de matriz', () => {
  it('A × A⁻¹ = identidade', () => {
    const proj = perspective(createMat4(), 70 * DEG2RAD, 1.7, 0.05, 256);
    const view = lookYawPitch(createMat4(), 3, 70, -8, 0.9, 0.2);
    const vp = multiply(createMat4(), proj, view);
    const inv = createMat4();
    expect(invert(inv, vp)).toBe(true);

    const product = multiply(createMat4(), vp, inv);
    for (let i = 0; i < 16; i++) {
      const expected = i % 5 === 0 ? 1 : 0;
      // Tolerância de 5e-4: as matrizes são `Float32Array`, e com far=256 o
      // erro acumulado da inversão fica na casa de 1e-5. Precisão maior aqui
      // testaria o float, não o algoritmo.
      expect(product[i]).toBeCloseTo(expected, 3);
    }
  });

  it('devolve false para matriz singular', () => {
    const singular = createMat4();
    singular.fill(0);
    expect(invert(createMat4(), singular)).toBe(false);
  });
});
