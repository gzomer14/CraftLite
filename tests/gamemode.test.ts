/**
 * Trocar de modo no mesmo mundo (doc 08 §3.10).
 *
 * O save já guardava `meta.gameMode` desde o M4 e `saveAll` já o escrevia a
 * partir de `player.mode` — o que não existia era como trocar sem criar outro
 * mundo (pedido de campo 2026-09-14). O que se testa aqui é o botão: que ele
 * diz **o que faz** e não onde o jogador está, e que ele só aparece quando há
 * como trocar.
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { PauseMenu } from '../src/ui/screens/pause';

class FakeEl {
  hidden = false;
  textContent = '';
  className = '';
  type = '';
  id = '';
  focused = false;
  readonly children: FakeEl[] = [];
  readonly attributes: Record<string, string> = {};
  private readonly handlers = new Map<string, (() => void)[]>();
  constructor(readonly tag: string) {}
  appendChild(child: FakeEl): FakeEl { this.children.push(child); return child; }
  append(...kids: FakeEl[]): void { for (const kid of kids) this.children.push(kid); }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  focus(): void { this.focused = true; }
  addEventListener(type: string, fn: () => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  click(): void { for (const fn of this.handlers.get('click') ?? []) fn(); }
  /** Todos os descendentes, em ordem de documento. */
  all(): FakeEl[] {
    const out: FakeEl[] = [];
    for (const child of this.children) { out.push(child); out.push(...child.all()); }
    return out;
  }
}

let body: FakeEl;

beforeEach(() => {
  body = new FakeEl('body');
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeEl(tag),
    body,
    head: new FakeEl('head'),
  });
});
afterEach(() => vi.unstubAllGlobals());

/** O botão de modo, achado pelo texto — é como o jogador o acha também. */
function modeButton(): FakeEl | undefined {
  return body.all().find((el) => el.tag === 'button' && el.textContent.startsWith('Mudar para'));
}

describe('o botão de modo', () => {
  it('diz para onde vai, não onde está', () => {
    let mode: 'survival' | 'creative' = 'survival';
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      gameMode: () => mode,
      onToggleMode: () => { mode = mode === 'creative' ? 'survival' : 'creative'; },
    });
    menu.show();
    expect(modeButton()?.textContent, '"Modo: Criativo" deixa dúvida de qual é o atual')
      .toBe('Mudar para Criativo');

    modeButton()?.click();
    expect(mode).toBe('creative');
    expect(modeButton()?.textContent, 'o rótulo acompanha a troca na hora')
      .toBe('Mudar para Sobrevivência');
  });

  it('o leitor de tela ouve os dois: onde está e para onde vai', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      gameMode: () => 'creative',
      onToggleMode: () => {},
    });
    menu.show();
    expect(modeButton()?.attributes['aria-label'])
      .toBe('Modo atual: Criativo. Mudar para Sobrevivência.');
  });

  it('reabrir a pausa relê o modo — ele pode ter mudado por fora', () => {
    let mode: 'survival' | 'creative' = 'survival';
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
      gameMode: () => mode,
      onToggleMode: () => {},
    });
    menu.show();
    mode = 'creative';
    menu.hide();
    menu.show();
    expect(modeButton()?.textContent).toBe('Mudar para Sobrevivência');
  });

  it('sem como trocar, o botão não existe', () => {
    const menu = new PauseMenu({
      onResume: () => {}, onOptions: () => {}, onSaveAndQuit: () => {},
    });
    menu.show();
    expect(modeButton(), 'metade da informação seria pior que nenhuma')
      .toBeUndefined();
  });
});
