/**
 * Cursor virtual dos menus (doc 08 §4.3).
 *
 * O que importa não é "o `left` mudou": é que o cursor **não saia da tela**,
 * que ele ande o mesmo tanto num laço rápido e num lento, e que ele não exista
 * para quem nunca encostou num controle.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiCursor } from '../src/input/uicursor';

class FakeEl {
  hidden = false;
  id = '';
  textContent = '';
  readonly style: Record<string, string> = {};
  readonly attributes: Record<string, string> = {};
  readonly children: FakeEl[] = [];
  constructor(readonly tag: string) {}
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  appendChild(child: FakeEl): void { this.children.push(child); }
}

let body: FakeEl;
let sob: FakeEl | null;
let criados: FakeEl[];

function comDom(): void {
  body = new FakeEl('body');
  criados = [];
  sob = null;
  vi.stubGlobal('document', {
    createElement: (tag: string) => {
      const el = new FakeEl(tag);
      criados.push(el);
      return el;
    },
    elementFromPoint: () => sob,
    body,
    head: new FakeEl('head'),
  });
  vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
  vi.stubGlobal('HTMLElement', FakeEl);
}

/** O `<div>` do cursor: o primeiro criado que não é o `<style>`. */
function cursorEl(): FakeEl {
  const el = criados.find((c) => c.tag === 'div');
  if (el === undefined) throw new Error('o cursor não foi criado');
  return el;
}

beforeEach(() => { comDom(); });
afterEach(() => vi.unstubAllGlobals());

describe('posição', () => {
  it('nasce no meio da tela', () => {
    const cursor = new UiCursor();
    cursor.move(0, 0, 50);
    expect([cursor.x, cursor.y], 'o menor caminho médio até qualquer canto')
      .toEqual([400, 300]);
  });

  it('a velocidade é por segundo, não por tick', () => {
    const rapido = new UiCursor();
    const lento = new UiCursor();
    // Um laço de 60 Hz dando três passos anda o mesmo que um de 20 Hz dando um.
    for (let i = 0; i < 3; i++) rapido.move(1, 0, 50 / 3);
    lento.move(1, 0, 50);
    expect(rapido.x).toBeCloseTo(lento.x, 6);
  });

  it('não sai da tela por mais que se empurre', () => {
    const cursor = new UiCursor();
    for (let i = 0; i < 100; i++) cursor.move(1, 1, 50);
    expect([cursor.x, cursor.y]).toEqual([800, 600]);

    for (let i = 0; i < 100; i++) cursor.move(-1, -1, 50);
    expect([cursor.x, cursor.y]).toEqual([0, 0]);
  });

  it('fechar a tela faz o próximo uso recomeçar do meio', () => {
    const cursor = new UiCursor();
    cursor.move(1, 0, 50);
    cursor.reset();
    cursor.move(0, 0, 50);
    expect(cursor.x).toBe(400);
  });
});

describe('elemento', () => {
  it('só entra no documento quando o analógico é empurrado', () => {
    const cursor = new UiCursor();
    expect(body.children.length, 'quem joga de toque não paga um nó a mais').toBe(0);
    cursor.move(1, 0, 50);
    expect(body.children.length).toBe(1);
  });

  it('devolve quem está debaixo dele', () => {
    const alvo = new FakeEl('div');
    sob = alvo;
    const cursor = new UiCursor();
    expect(cursor.move(1, 0, 50)).toBe(alvo);
  });

  it('não devolve a si mesmo', () => {
    const cursor = new UiCursor();
    cursor.move(1, 0, 50);
    sob = cursorEl();
    sob.id = 'pad-cursor';
    expect(cursor.move(1, 0, 50), 'apontar para a própria seta não é apontar para nada')
      .toBeNull();
  });

  it('esconder não esquece onde ele estava', () => {
    const cursor = new UiCursor();
    cursor.move(1, 0, 50);
    const x = cursor.x;
    cursor.hide();
    expect(cursorEl().hidden).toBe(true);
    cursor.move(0, 0, 50);
    expect(cursor.x, 'volta de onde parou').toBe(x);
    expect(cursorEl().hidden).toBe(false);
  });

  it('parado tempo demais, some da tela', () => {
    const relogio = { agora: 1000 };
    vi.stubGlobal('performance', { now: () => relogio.agora });
    const cursor = new UiCursor();
    cursor.move(1, 0, 50);

    cursor.fade();
    expect(cursorEl().hidden, 'acabou de andar').toBe(false);

    relogio.agora += 10_000;
    cursor.fade();
    expect(cursorEl().hidden, 'cursor esquecido na tela atrapalha a leitura').toBe(true);
  });
});

describe('sem DOM', () => {
  it('não quebra e não aponta para nada', () => {
    vi.unstubAllGlobals();
    vi.stubGlobal('document', undefined);
    const cursor = new UiCursor();
    expect(cursor.move(1, 1, 50)).toBeNull();
  });
});
