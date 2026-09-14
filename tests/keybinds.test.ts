/**
 * Remapeamento de teclas (doc 08 §3.11).
 *
 * O que importa testar é o que o jogador consegue quebrar: perder a tecla de
 * andar, ficar sem saída de uma tela, ou trocar duas de lugar e o jogo não
 * contar que elas colidiram.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { KEYBINDS, RESERVED_CODES, keyLabel } from '../src/data/keybinds';
import { Keybinds } from '../src/input/keybinds';

/** `localStorage` de mentira: o módulo grava nele a cada troca. */
function stubStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
  };
}

beforeEach(() => stubStorage());

describe('tabela de teclas', () => {
  it('toda ação tem rótulo e uma tecla de fábrica única', () => {
    const codes = new Set<string>();
    for (const bind of KEYBINDS) {
      expect(bind.label, bind.id).toBeTruthy();
      expect(bind.code, bind.id).toBeTruthy();
      expect(codes.has(bind.code), `${bind.id} repete ${bind.code}`).toBe(false);
      codes.add(bind.code);
    }
  });

  it('nenhuma tecla de fábrica é reservada', () => {
    for (const bind of KEYBINDS) {
      expect(RESERVED_CODES).not.toContain(bind.code);
    }
  });

  it('o rótulo é legível para as famílias que o jogador vê', () => {
    expect(keyLabel('KeyW')).toBe('W');
    expect(keyLabel('Digit5')).toBe('5');
    expect(keyLabel('Space')).toBe('Espaço');
    expect(keyLabel('ShiftLeft')).toBe('Shift esq.');
    expect(keyLabel('F3')).toBe('F3');
    expect(keyLabel('')).toBe('—');
  });
});

describe('mapa do jogador', () => {
  it('começa na tabela de fábrica', () => {
    const keys = new Keybinds();
    expect(keys.codeFor('forward')).toBe('KeyW');
    expect(keys.hasConflict).toBe(false);
  });

  it('troca, persiste e volta com o mesmo mapa', () => {
    const keys = new Keybinds();
    expect(keys.set('forward', 'ArrowUp')).toBe(true);
    expect(new Keybinds().codeFor('forward')).toBe('ArrowUp');
  });

  it('recusa tecla reservada — Escape é a saída de toda tela', () => {
    const keys = new Keybinds();
    expect(keys.set('jump', 'Escape')).toBe(false);
    expect(keys.codeFor('jump')).toBe('Space');
  });

  it('aceita conflito e o aponta nas duas ações', () => {
    // Recusar o conflito prenderia o jogador: trocar duas teclas de lugar
    // passa obrigatoriamente por um estado em que as duas estão na mesma.
    const keys = new Keybinds();
    keys.set('sneak', 'KeyW');
    expect(keys.hasConflict).toBe(true);
    expect(keys.conflicts('sneak')).toContain('forward');
    expect(keys.conflicts('forward')).toContain('sneak');
    expect(keys.conflicts('jump')).toEqual([]);
  });

  it('restaurar devolve a tabela de fábrica e limpa o conflito', () => {
    const keys = new Keybinds();
    keys.set('sneak', 'KeyW');
    keys.reset();
    expect(keys.codeFor('sneak')).toBe('ShiftLeft');
    expect(keys.hasConflict).toBe(false);
  });

  it('avisa quem depende do mapa a cada troca', () => {
    const keys = new Keybinds();
    let calls = 0;
    const off = keys.onChange(() => { calls++; });
    keys.set('drop', 'KeyG');
    expect(calls).toBe(1);
    off();
    keys.set('drop', 'KeyH');
    expect(calls).toBe(1);
  });

  it('descarta tecla reservada que tenha ido parar no armazenamento', () => {
    localStorage.setItem(
      'craftlite.keybinds.v1', JSON.stringify({ jump: 'Escape', forward: 'KeyZ', nada: 'KeyX' }),
    );
    const keys = new Keybinds();
    expect(keys.codeFor('jump')).toBe('Space');
    expect(keys.codeFor('forward')).toBe('KeyZ');
  });
});
