/**
 * Teto de FPS. O `requestAnimationFrame` acompanha o display, não 60 Hz — num
 * painel de 120 Hz o jogo desenha 120 vezes por segundo. O teto é opcional e
 * não pode alterar o ritmo da simulação.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameLoop, TICK_MS } from '../src/core/loop';

let now = 0;
let frameCallback: ((t: number) => void) | null = null;

beforeEach(() => {
  now = 0;
  frameCallback = null;
  vi.stubGlobal('performance', { now: () => now });
  vi.stubGlobal('requestAnimationFrame', (cb: (t: number) => void) => {
    frameCallback = cb;
    return 1;
  });
  vi.stubGlobal('cancelAnimationFrame', () => { frameCallback = null; });
});
afterEach(() => vi.unstubAllGlobals());

/** Avança o relógio e dispara um quadro, como faria o navegador. */
function frame(ms: number): void {
  now += ms;
  const cb = frameCallback;
  frameCallback = null;
  if (cb !== null) cb(now);
}

describe('teto de FPS', () => {
  it('sem teto, desenha em todo quadro do display', () => {
    let renders = 0;
    const loop = new GameLoop({ tick: () => {}, pump: () => {}, render: () => renders++ });
    loop.start();
    for (let i = 0; i < 120; i++) frame(8.33); // display de 120 Hz
    expect(renders).toBe(120);
  });

  it('com teto de 60, desenha metade dos quadros num display de 120 Hz', () => {
    let renders = 0;
    const loop = new GameLoop({ tick: () => {}, pump: () => {}, render: () => renders++ });
    loop.maxFps = 60;
    loop.start();
    for (let i = 0; i < 120; i++) frame(8.33);
    expect(renders).toBeGreaterThan(55);
    expect(renders).toBeLessThan(65);
  });

  it('o teto não altera o ritmo da simulação', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.maxFps = 30;
    loop.start();
    // 2 segundos de display a 120 Hz.
    for (let i = 0; i < 240; i++) frame(8.33);
    // 20 ticks por segundo → ~40 ticks em 2 s.
    expect(ticks).toBeGreaterThan(36);
    expect(ticks).toBeLessThan(44);
  });

  it('teto maior que o display não muda nada', () => {
    let renders = 0;
    const loop = new GameLoop({ tick: () => {}, pump: () => {}, render: () => renders++ });
    loop.maxFps = 240;
    loop.start();
    for (let i = 0; i < 60; i++) frame(16.6);
    expect(renders).toBe(60);
  });

  it('o tempo continua sendo contado nos quadros descartados', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.maxFps = 10; // bem abaixo do display
    loop.start();
    for (let i = 0; i < 60; i++) frame(TICK_MS / 2);
    // 60 × 25 ms = 1,5 s → ~30 ticks, mesmo desenhando pouco.
    expect(ticks).toBeGreaterThan(26);
  });
});
