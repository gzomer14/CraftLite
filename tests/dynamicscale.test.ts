/** A escala dinâmica precisa reagir devagar: oscilar é pior que ficar lento. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { DynamicScale } from '../src/render/dynamicscale';

/**
 * O cooldown entre mudanças usa `performance.now()`; um relógio controlado
 * deixa os testes determinísticos e permite exercitá-lo de propósito.
 */
let clock = 0;
beforeEach(() => {
  clock = 0;
  vi.stubGlobal('performance', { now: () => clock });
});
afterEach(() => vi.unstubAllGlobals());

const run = (
  ds: DynamicScale, frameMs: number, frames: number, start = 1, loading = false,
): number => {
  let scale = start;
  for (let i = 0; i < frames; i++) {
    clock += frameMs;
    scale = ds.update(frameMs, scale, loading);
  }
  return scale;
};

describe('DynamicScale', () => {
  it('não mexe em nada quando o frame time está no alvo', () => {
    expect(run(new DynamicScale(60), 16.6, 600)).toBe(1);
  });

  it('baixa a escala depois de frames lentos sustentados', () => {
    expect(run(new DynamicScale(60), 40, 200)).toBeLessThan(1);
  });

  it('não desce abaixo de 0,6', () => {
    expect(run(new DynamicScale(60), 200, 5000)).toBeCloseTo(0.6, 5);
  });

  it('volta a subir quando sobra folga', () => {
    const ds = new DynamicScale(60);
    const raised = run(ds, 5, 600, 0.7);
    expect(raised).toBeGreaterThan(0.7);
  });

  it('não passa de 1,0', () => {
    expect(run(new DynamicScale(60), 1, 5000, 0.9)).toBeCloseTo(1, 5);
  });

  it('um único frame lento não muda nada', () => {
    const ds = new DynamicScale(60);
    let scale = 1;
    scale = ds.update(500, scale);
    expect(scale).toBe(1);
  });

  it('ignora frames lentos enquanto o mundo carrega', () => {
    // Era o que fazia a tela piscar no celular: os picos de geração e upload
    // de malha derrubavam a escala, e cada troca realoca o backbuffer.
    expect(run(new DynamicScale(60), 60, 2000, 1, true)).toBe(1);
  });

  it('volta a reagir quando o carregamento termina', () => {
    const ds = new DynamicScale(60);
    let scale = run(ds, 60, 500, 1, true);
    expect(scale).toBe(1);
    scale = run(ds, 60, 400, scale, false);
    expect(scale).toBeLessThan(1);
  });

  it('respeita o cooldown entre mudanças', () => {
    const ds = new DynamicScale(60);
    // 200 frames de 60 ms = 12 s, tempo para várias quedas sem o cooldown.
    const scale = run(ds, 60, 200);
    // Com cooldown de 3 s, no máximo ~4 quedas — nunca desabar de uma vez.
    expect(scale).toBeGreaterThanOrEqual(0.6);
    expect(scale).toBeLessThan(1);
  });

  it('respeita o alvo de 30 FPS do T0', () => {
    // 25 ms cabe em 33,3 ms: não deve baixar a escala.
    expect(run(new DynamicScale(30), 25, 600)).toBe(1);
  });

  /*
   * Oscilação (bug de campo, 2026-09-10: "a textura do mundo fica piscando
   * mesmo com a câmera parada").
   *
   * Num aparelho que fica em cima do alvo, a escala caía, sobrava folga,
   * subia, não aguentava, caía de novo — e cada troca realoca o backbuffer,
   * que é a piscada. O cooldown limitava a frequência; não o ciclo.
   */
  it('não sobe de volta logo depois de cair', () => {
    const ds = new DynamicScale(60);
    // 100 frames de 40 ms = exatamente uma queda (o gatilho são 90 frames).
    const dropped = run(ds, 40, 100);
    expect(dropped).toBeLessThan(1);
    // Frames rápidos logo em seguida: a escala anterior está de castigo.
    const after = run(ds, 5, 600, dropped);
    expect(after).toBe(dropped);
  });

  it('tenta subir de novo depois do tempo de recuo', () => {
    const ds = new DynamicScale(60);
    const dropped = run(ds, 40, 100);
    clock += 25000; // passa dos 20 s de recuo da primeira queda
    const after = run(ds, 5, 600, dropped);
    expect(after).toBeGreaterThan(dropped);
  });

  it('o recuo dobra a cada queda, até parar de tentar', () => {
    const ds = new DynamicScale(60);
    let scale = 1;
    let changes = 0;
    // Uma hora de aparelho oscilando em cima do alvo: alterna lento e rápido.
    for (let round = 0; round < 60; round++) {
      const before = scale;
      scale = run(ds, 40, 200, scale);
      scale = run(ds, 5, 600, scale);
      if (scale !== before) changes++;
    }
    // Sem o recuo isto passava de 100 trocas — 100 piscadas.
    expect(changes).toBeLessThan(20);
  });

  it('pode ser desligada', () => {
    const ds = new DynamicScale(60);
    ds.enabled = false;
    expect(run(ds, 500, 600)).toBe(1);
  });
});
