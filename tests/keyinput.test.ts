/**
 * Teclado e roda do mouse no computador (relatos de campo de 2026-09-27).
 *
 * - `Ctrl` + `D` segurados (correr para a direita) abriam "salvar favorito" do
 *   Chrome: a repetição da tecla passava sem `preventDefault`.
 * - A roda de alta resolução manda um dente em vários eventos, e cada evento
 *   andava uma casa: a seleção dava voltas e parecia "às vezes não funcionar".
 */
import { describe, expect, it } from 'vitest';
import { Keyboard } from '../src/input/keyboard';
import { WheelSteps } from '../src/input/wheelsteps';

/** Um alvo de eventos mínimo, com o `KeyboardEvent` que o teclado lê. */
function fakeTarget(): { target: EventTarget; press(code: string, repeat: boolean): boolean } {
  const listeners = new Map<string, (e: unknown) => void>();
  const target = {
    addEventListener: (type: string, fn: (e: unknown) => void) => { listeners.set(type, fn); },
    removeEventListener: () => undefined,
  } as unknown as EventTarget;
  return {
    target,
    press(code, repeat) {
      let prevented = false;
      listeners.get('keydown')?.({ code, repeat, target: null, preventDefault: () => { prevented = true; } });
      return prevented;
    },
  };
}

describe('teclado do jogo', () => {
  (globalThis as { window?: unknown }).window ??= { addEventListener: () => undefined };
  (globalThis as { HTMLElement?: unknown }).HTMLElement ??= class {};

  it('tecla de andar, inclusive na repetição, não vira atalho do navegador', () => {
    const { target, press } = fakeTarget();
    const keyboard = new Keyboard(target);
    keyboard.claims = (code) => code === 'KeyD';
    expect(press('KeyD', false)).toBe(true);
    expect(press('KeyD', true)).toBe(true);
    expect(keyboard.isDown('KeyD')).toBe(true);
  });

  it('tecla de ação com repetição também é segurada, e a ação não repete', () => {
    const { target, press } = fakeTarget();
    const keyboard = new Keyboard(target);
    let calls = 0;
    keyboard.bind('KeyE', (down) => { if (down) calls++; });
    expect(press('KeyE', false)).toBe(true);
    expect(press('KeyE', true)).toBe(true);
    expect(calls).toBe(1);
  });

  it('tecla que o jogo não usa continua do navegador', () => {
    const { target, press } = fakeTarget();
    const keyboard = new Keyboard(target);
    keyboard.claims = (code) => code === 'KeyD';
    expect(press('KeyT', false)).toBe(false);
  });
});

describe('roda do mouse', () => {
  it('mouse comum: um evento por dente, uma casa por dente', () => {
    const w = new WheelSteps();
    expect(w.step(100, 0, 0)).toBe(1);
    expect(w.step(100, 0, 20)).toBe(1);
    expect(w.step(-120, 0, 40)).toBe(-1);
    expect(w.step(3, 1, 400)).toBe(1); // em linhas (Firefox)
  });

  it('roda de alta resolução: um dente em dez pedaços anda uma casa só', () => {
    const w = new WheelSteps();
    let moved = 0;
    for (let i = 0; i < 10; i++) moved += w.step(12, 0, i * 8);
    expect(moved).toBe(1);
  });

  it('nove pedaços não dão mais a volta inteira na hotbar', () => {
    const w = new WheelSteps();
    let moved = 0;
    for (let i = 0; i < 9; i++) moved += w.step(13.3, 0, i * 5);
    expect(moved).toBe(1);
  });

  it('trocar de sentido zera a soma', () => {
    const w = new WheelSteps();
    w.step(40, 0, 0);
    w.step(40, 0, 10);
    expect(w.step(-30, 0, 20)).toBe(0);
    expect(w.step(40, 0, 30)).toBe(0);
  });
});
