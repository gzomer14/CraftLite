/**
 * Navegação de interface por controle (doc 08 §4.3).
 *
 * É o que separa "o controle move o boneco" de "dá para jogar de controle":
 * sem isto, quem só tem o controle na mão não entra num mundo, não abre o
 * inventário e não sai de uma tela.
 *
 * O DOM falso implementa só o que o módulo usa. Ele é mais completo que o das
 * outras telas porque aqui o que se testa **é** a travessia do documento.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { UiNavigator } from '../src/input/uinav';
import type { NavState } from '../src/input/gamepad';

const NOTHING: NavState = {
  up: false, down: false, left: false, right: false, confirm: false, cancel: false,
};

class FakeEl {
  hidden = false;
  disabled = false;
  type = '';
  value = '';
  min = '';
  max = '';
  step = '';
  checked = false;
  selectedIndex = 0;
  options: unknown[] = [];
  parentElement: FakeEl | null = null;
  readonly children: FakeEl[] = [];
  readonly attributes: Record<string, string> = {};
  readonly events: string[] = [];
  clicks = 0;
  focused = false;

  constructor(readonly tag: string) {}

  appendChild(child: FakeEl): FakeEl {
    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  focus(): void {
    for (const el of allElements) el.focused = false;
    this.focused = true;
    activeElement = this;
  }
  click(): void { this.clicks++; }
  dispatchEvent(event: { type: string }): boolean {
    this.events.push(event.type);
    return true;
  }
  /** Descendentes que casam com o seletor, em ordem de documento. */
  querySelectorAll(selector: string): FakeEl[] {
    const out: FakeEl[] = [];
    for (const child of this.children) {
      if (matches(child, selector)) out.push(child);
      out.push(...child.querySelectorAll(selector));
    }
    return out;
  }
}

/** Casamento de seletor suficiente para os dois seletores do módulo. */
function matches(el: FakeEl, selector: string): boolean {
  if (selector.includes('role="dialog"')) return el.attributes.role === 'dialog';
  const tags = ['button', 'input', 'select', 'textarea'];
  return tags.includes(el.tag) && !el.disabled;
}

let allElements: FakeEl[] = [];
let activeElement: FakeEl | null = null;
let root: FakeEl;

function el(tag: string): FakeEl {
  const node = new FakeEl(tag);
  allElements.push(node);
  return node;
}

/** Diálogo com `n` botões, já montado no documento. */
function dialog(...children: FakeEl[]): FakeEl {
  const layer = el('div');
  layer.setAttribute('role', 'dialog');
  for (const child of children) layer.appendChild(child);
  root.appendChild(layer);
  return layer;
}

beforeEach(() => {
  allElements = [];
  activeElement = null;
  root = new FakeEl('body');
  vi.stubGlobal('document', {
    get activeElement() { return activeElement; },
    querySelectorAll: (selector: string) => root.querySelectorAll(selector),
  });
  vi.stubGlobal('KeyboardEvent', class {
    constructor(readonly type: string, readonly init: Record<string, unknown>) {}
    get key(): unknown { return this.init.key; }
  });
  vi.stubGlobal('Event', class {
    constructor(readonly type: string) {}
  });
  vi.stubGlobal('HTMLInputElement', FakeEl);
  vi.stubGlobal('HTMLSelectElement', FakeEl);
});

afterEach(() => vi.unstubAllGlobals());

/** Aperta a direção por um tick e solta. */
function tap(nav: UiNavigator, key: keyof NavState): void {
  nav.tick({ ...NOTHING, [key]: true });
  nav.tick(NOTHING);
}

describe('quando a navegação está ativa', () => {
  it('sem tela aberta ela não faz nada e devolve o controle ao jogo', () => {
    const nav = new UiNavigator();
    expect(nav.tick(NOTHING)).toBe(false);
    expect(nav.active).toBe(false);
  });

  it('diálogo escondido não conta como tela aberta', () => {
    const layer = dialog(el('button'));
    layer.hidden = true;
    const nav = new UiNavigator();
    expect(nav.tick(NOTHING)).toBe(false);
  });

  it('com tela aberta ela toma o controle', () => {
    dialog(el('button'));
    const nav = new UiNavigator();
    expect(nav.tick(NOTHING)).toBe(true);
    expect(nav.active).toBe(true);
  });

  it('a de cima vence quando há duas abertas', () => {
    const debaixo = el('button');
    const emCima = el('button');
    dialog(debaixo);
    dialog(emCima);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    // O foco inicial vai para o primeiro item da camada de cima.
    expect(emCima.focused).toBe(true);
    expect(debaixo.focused).toBe(false);
  });
});

describe('foco', () => {
  it('abrir a tela já deixa alguma coisa focada', () => {
    const primeiro = el('button');
    dialog(primeiro, el('button'));
    new UiNavigator().tick(NOTHING);
    expect(primeiro.focused, 'sem foco inicial não há de onde partir').toBe(true);
  });

  it('para baixo anda um item; para cima volta', () => {
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    nav.tick(NOTHING);

    tap(nav, 'down');
    expect(b.focused).toBe(true);
    tap(nav, 'up');
    expect(a.focused).toBe(true);
  });

  it('dá a volta no fim da lista', () => {
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    nav.tick(NOTHING);

    tap(nav, 'down');
    tap(nav, 'down');
    expect(a.focused, 'passar do último volta ao primeiro').toBe(true);
    tap(nav, 'up');
    expect(b.focused, 'e subir do primeiro vai ao último').toBe(true);
  });

  it('botão desligado fica fora do caminho', () => {
    const a = el('button');
    const desligado = el('button');
    desligado.disabled = true;
    const c = el('button');
    dialog(a, desligado, c);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'down');
    expect(c.focused).toBe(true);
  });

  it('item escondido dentro da tela também fica fora', () => {
    const a = el('button');
    const escondido = el('button');
    escondido.hidden = true;
    const c = el('button');
    dialog(a, escondido, c);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'down');
    expect(c.focused).toBe(true);
  });
});

describe('repetição', () => {
  it('segurar não dispara a cada tick — a lista não passa num piscar', () => {
    const botoes = [el('button'), el('button'), el('button'), el('button')];
    dialog(...botoes);
    const nav = new UiNavigator();
    nav.tick(NOTHING);

    // Cinco ticks segurando: um na borda, e a repetição ainda não começou.
    for (let i = 0; i < 5; i++) nav.tick({ ...NOTHING, down: true });
    expect(botoes[1].focused, 'andou uma vez só').toBe(true);
  });

  it('segurar mais tempo começa a repetir', () => {
    const botoes = Array.from({ length: 8 }, () => el('button'));
    dialog(...botoes);
    const nav = new UiNavigator();
    nav.tick(NOTHING);

    for (let i = 0; i < 20; i++) nav.tick({ ...NOTHING, down: true });
    const focado = botoes.findIndex((b) => b.focused);
    expect(focado, 'a repetição precisa ter andado além do primeiro passo')
      .toBeGreaterThan(1);
  });
});

describe('confirmar e voltar', () => {
  it('confirmar aperta o botão focado', () => {
    const botao = el('button');
    dialog(botao);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'confirm');
    expect(botao.clicks).toBe(1);
  });

  it('confirmar numa caixa de seleção alterna, não "clica"', () => {
    const caixa = el('input');
    caixa.type = 'checkbox';
    dialog(caixa);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'confirm');
    expect(caixa.checked).toBe(true);
    expect(caixa.events).toContain('change');
  });

  it('voltar manda Escape para a camada — quem fecha é a tela', () => {
    const layer = dialog(el('button'));
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'cancel');
    expect(layer.events, 'a tela já sabe tratar Escape (doc 08 §4.1)')
      .toContain('keydown');
  });
});

describe('esquerda e direita mexem no valor', () => {
  it('num slider elas mudam o valor em vez de pular de campo', () => {
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.05';
    slider.value = '0.5';
    const outro = el('button');
    dialog(slider, outro);

    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'right');
    expect(Number(slider.value)).toBeCloseTo(0.55, 5);
    expect(outro.focused, 'o foco não pode ter escapado').toBe(false);
    expect(slider.events).toContain('input');
  });

  it('o slider respeita os limites', () => {
    const slider = el('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '1';
    slider.step = '0.5';
    slider.value = '1';
    dialog(slider);

    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'right');
    expect(Number(slider.value)).toBe(1);
  });

  it('num select elas trocam a opção', () => {
    const select = el('select');
    select.options = [{}, {}, {}];
    select.selectedIndex = 0;
    dialog(select);

    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'right');
    expect(select.selectedIndex).toBe(1);
    expect(select.events).toContain('change');
  });

  it('num botão, que não tem valor, elas andam no foco', () => {
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    nav.tick(NOTHING);
    tap(nav, 'right');
    expect(b.focused, 'a seta não pode ficar inerte').toBe(true);
  });
});
