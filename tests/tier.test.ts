/** A detecção de tier decide render distance e workers — errar para cima deixa
 *  o celular alvo injogável, então os testes fixam o comportamento. */
import { describe, expect, it } from 'vitest';
import { detectTier, presetFor, type DeviceInfo } from '../src/core/tier';

const device = (over: Partial<DeviceInfo> = {}): DeviceInfo => ({
  hasWebGL2: true,
  memGB: 8,
  cores: 8,
  isMobile: false,
  maxTexSize: 8192,
  renderer: 'Mesa Intel(R) UHD Graphics',
  ...over,
});

describe('detectTier', () => {
  it('classifica um desktop moderno como T2', () => {
    expect(detectTier(device())).toBe(2);
  });

  it('classifica o celular alvo de 2016 como T0', () => {
    expect(detectTier(device({
      memGB: 2, cores: 4, isMobile: true, maxTexSize: 4096,
      renderer: 'Adreno (TM) 405',
    }))).toBe(0);
  });

  it('classifica um celular de 2020 como T1', () => {
    expect(detectTier(device({
      memGB: 4, cores: 8, isMobile: true, renderer: 'Adreno (TM) 610',
    }))).toBe(1);
  });

  it('rebaixa quando não há WebGL2', () => {
    expect(detectTier(device({ hasWebGL2: false }))).toBeLessThan(2);
  });

  it('rebaixa GPUs Mali antigas conhecidas', () => {
    expect(detectTier(device({
      memGB: 4, cores: 8, isMobile: true, renderer: 'Mali-T720',
    }))).toBe(0);
  });

  it('sobrevive a informação ausente sem estourar', () => {
    const t = detectTier(device({ memGB: 0, cores: 0, renderer: '' }));
    expect([0, 1, 2]).toContain(t);
  });
});

describe('presetFor', () => {
  it('T0 usa render distance 4 e alvo de 30 FPS', () => {
    const p = presetFor(0, device({ cores: 4 }));
    expect(p.renderDistance).toBe(4);
    expect(p.targetFps).toBe(30);
    expect(p.maxMobs).toBe(20);
    expect(p.clouds).toBe('off');
  });

  it('mantém AO ligado mesmo em T0 (é feito no mesh, é barato)', () => {
    expect(presetFor(0, device()).smoothLighting).toBe(true);
  });

  it('limita os workers a cores-1', () => {
    expect(presetFor(2, device({ cores: 2 })).workers).toBe(1);
    expect(presetFor(2, device({ cores: 8 })).workers).toBe(4);
  });

  it('nunca desce abaixo de 1 worker', () => {
    expect(presetFor(2, device({ cores: 1 })).workers).toBe(1);
  });

  it('devolve um objeto novo a cada chamada (o chamador pode mutar)', () => {
    const a = presetFor(1, device());
    a.renderDistance = 99;
    expect(presetFor(1, device()).renderDistance).toBe(8);
  });
});
