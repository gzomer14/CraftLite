/** O loop precisa acumular ticks corretamente e não entrar em espiral da morte. */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GameLoop, TICK_MS, FRAME_HISTORY } from '../src/core/loop';

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

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Avança o relógio e dispara um frame. */
function advance(ms: number): void {
  now += ms;
  const cb = frameCallback;
  frameCallback = null;
  if (cb !== null) cb(now);
}

describe('GameLoop', () => {
  it('roda exatamente um tick por 50 ms', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.start();
    for (let i = 0; i < 10; i++) advance(TICK_MS);
    expect(ticks).toBe(10);
  });

  it('não roda tick nenhum abaixo de 50 ms acumulados', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.start();
    advance(20);
    advance(20);
    expect(ticks).toBe(0);
    advance(20);
    expect(ticks).toBe(1);
  });

  it('limita o catch-up a 5 ticks por frame', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.start();
    advance(5000); // uma aba em segundo plano por 5 segundos
    expect(ticks).toBe(5);
  });

  it('descarta a dívida em vez de acumular', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.start();
    advance(5000);
    ticks = 0;
    advance(TICK_MS);
    expect(ticks).toBe(1); // sem dívida represada do frame anterior
  });

  it('entrega alpha em [0,1)', () => {
    const alphas: number[] = [];
    const loop = new GameLoop({ tick: () => {}, pump: () => {}, render: (a) => alphas.push(a) });
    loop.start();
    for (let i = 0; i < 20; i++) advance(17);
    for (const a of alphas) {
      expect(a).toBeGreaterThanOrEqual(0);
      expect(a).toBeLessThan(1);
    }
  });

  it('chama pump antes de render, com o orçamento configurado', () => {
    const order: string[] = [];
    const loop = new GameLoop({
      tick: () => order.push('tick'),
      pump: (b) => order.push(`pump:${b}`),
      render: () => order.push('render'),
    });
    loop.pumpBudgetMs = 2;
    loop.start();
    advance(TICK_MS);
    expect(order).toEqual(['tick', 'pump:2', 'render']);
  });

  it('preenche o histórico de frame time de forma circular', () => {
    const loop = new GameLoop({ tick: () => {}, pump: () => {}, render: () => {} });
    loop.start();
    for (let i = 0; i < FRAME_HISTORY + 5; i++) advance(16);
    expect(loop.stats.history.length).toBe(FRAME_HISTORY);
    expect(loop.stats.historyIndex).toBe(5);
    expect(loop.stats.history[0]).toBe(16);
  });

  it('stop interrompe os ticks', () => {
    let ticks = 0;
    const loop = new GameLoop({ tick: () => ticks++, pump: () => {}, render: () => {} });
    loop.start();
    advance(TICK_MS);
    loop.stop();
    advance(TICK_MS * 5);
    expect(ticks).toBe(1);
  });
});
