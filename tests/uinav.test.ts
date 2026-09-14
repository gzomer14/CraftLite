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
  up: false, down: false, left: false, right: false,
  confirm: false, cancel: false, secondary: false, cursorX: 0, cursorY: 0,
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
  id = '';
  readonly style: Record<string, string> = {};
  /** Retângulo na tela. `null` = elemento sem layout, como em Node de verdade. */
  rect: { left: number; top: number; width: number; height: number } | null = null;

  constructor(readonly tag: string) {}

  getAttribute(name: string): string | null { return this.attributes[name] ?? null; }

  getBoundingClientRect(): { left: number; top: number; width: number; height: number } {
    return this.rect ?? { left: 0, top: 0, width: 0, height: 0 };
  }

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
  const tabindex = el.attributes.tabindex;
  if (tabindex !== undefined && tabindex !== '-1') return true;
  const tags = ['button', 'input', 'select', 'textarea'];
  return tags.includes(el.tag) && !el.disabled;
}

/** Um slot de inventário: `div[role=button]` com foco, como em `containers/screen.ts`. */
function slot(x: number, y: number): FakeEl {
  const node = el('div');
  node.setAttribute('role', 'button');
  node.setAttribute('tabindex', '0');
  node.rect = { left: x, top: y, width: 20, height: 20 };
  return node;
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
  vi.stubGlobal('MouseEvent', class {
    constructor(readonly type: string, readonly init: Record<string, unknown>) {}
    get button(): unknown { return this.init.button; }
  });
});

afterEach(() => vi.unstubAllGlobals());

/**
 * Deixa a navegação com um foco de partida.
 *
 * O primeiro aperto **revela** onde o foco está e não anda com ele — é o que
 * permite pegar o controle no meio de uma tela aberta no dedo sem o cursor
 * saltar. Os testes que exercitam o andar precisam passar por esse aperto
 * antes.
 */
function inicia(nav: UiNavigator): void {
  nav.tick({ ...NOTHING, down: true });
  nav.tick(NOTHING);
}

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
    tap(nav, 'down');
    // O foco de partida vai para o primeiro item da camada de cima.
    expect(emCima.focused).toBe(true);
    expect(debaixo.focused).toBe(false);
  });
});

describe('foco', () => {
  it('o primeiro empurrão no direcional escolhe por onde começar', () => {
    const primeiro = el('button');
    dialog(primeiro, el('button'));
    const nav = new UiNavigator();
    nav.tick({ ...NOTHING, cursorX: 0, cursorY: 0, confirm: false, up: true });
    expect(primeiro.focused, 'sem foco de partida não há de onde andar').toBe(true);
  });

  it('sem controle na mão, a tela aberta não mexe no foco de ninguém', () => {
    /*
     * Relato de campo 2026-09-14: no inventário criativo do celular, pegar
     * qualquer item devolvia o foco ao campo de busca e subia o teclado
     * virtual. A causa era esta — a navegação tomava o foco a cada tick com
     * uma tela aberta, mesmo de quem nunca ligou um controle.
     */
    const primeiro = el('button');
    dialog(primeiro, el('button'));
    const nav = new UiNavigator();
    for (let i = 0; i < 20; i++) nav.tick(NOTHING);
    expect(primeiro.focused, 'o foco é do jogador até o controle ser empurrado')
      .toBe(false);
  });

  it('o foco de partida foge de campo de texto — senão sobe o teclado virtual', () => {
    const busca = el('input');
    busca.type = 'search';
    const primeiroBotao = el('button');
    dialog(busca, primeiroBotao);
    const nav = new UiNavigator();
    tap(nav, 'down');
    expect(busca.focused, 'a busca do inventário criativo é o primeiro focável')
      .toBe(false);
    expect(primeiroBotao.focused).toBe(true);
  });

  it('só de campo de texto, ele ainda é o ponto de partida', () => {
    const busca = el('input');
    busca.type = 'search';
    dialog(busca);
    const nav = new UiNavigator();
    tap(nav, 'down');
    expect(busca.focused, 'melhor um ponto de partida esquisito que nenhum').toBe(true);
  });

  it('para baixo anda um item; para cima volta', () => {
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    inicia(nav);

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
    inicia(nav);

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
    inicia(nav);
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
    inicia(nav);
    tap(nav, 'down');
    expect(c.focused).toBe(true);
  });
});

describe('repetição', () => {
  it('segurar não dispara a cada tick — a lista não passa num piscar', () => {
    const botoes = [el('button'), el('button'), el('button'), el('button')];
    dialog(...botoes);
    const nav = new UiNavigator();
    inicia(nav);

    // Cinco ticks segurando: um na borda, e a repetição ainda não começou.
    for (let i = 0; i < 5; i++) nav.tick({ ...NOTHING, down: true });
    expect(botoes[1].focused, 'andou uma vez só').toBe(true);
  });

  it('segurar mais tempo começa a repetir', () => {
    const botoes = Array.from({ length: 8 }, () => el('button'));
    dialog(...botoes);
    const nav = new UiNavigator();
    inicia(nav);

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
    inicia(nav);
    tap(nav, 'confirm');
    expect(botao.clicks).toBe(1);
  });

  it('confirmar numa caixa de seleção alterna, não "clica"', () => {
    const caixa = el('input');
    caixa.type = 'checkbox';
    dialog(caixa);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'confirm');
    expect(caixa.checked).toBe(true);
    expect(caixa.events).toContain('change');
  });

  it('voltar manda Escape para a camada — quem fecha é a tela', () => {
    const layer = dialog(el('button'));
    const nav = new UiNavigator();
    inicia(nav);
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
    inicia(nav);
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
    inicia(nav);
    tap(nav, 'right');
    expect(Number(slider.value)).toBe(1);
  });

  it('num select elas trocam a opção', () => {
    const select = el('select');
    select.options = [{}, {}, {}];
    select.selectedIndex = 0;
    dialog(select);

    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'right');
    expect(select.selectedIndex).toBe(1);
    expect(select.events).toContain('change');
  });

  it('num botão, que não tem valor, elas andam no foco', () => {
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'right');
    expect(b.focused, 'a seta não pode ficar inerte').toBe(true);
  });
});

describe('navegação espacial', () => {
  /*
   * Relato de campo 2026-09-14: com o inventário aberto, ir da grade de
   * criação até a mochila custava passar por armadura, boneco e resultado —
   * o direcional andava na ordem do documento e a ordem do documento não é a
   * ordem que o olho vê.
   *
   * O layout aqui é o do inventário em miniatura: coluna da esquerda com
   * armadura e criação, coluna da direita com a mochila. Na ordem do
   * documento a mochila vem por último; na tela ela está **ao lado**.
   */
  function inventario(): { craft: FakeEl; armadura: FakeEl; mochila: FakeEl } {
    const armadura = slot(10, 10);
    const craft = slot(10, 40);
    const mochila = slot(200, 40);
    dialog(armadura, craft, mochila);
    return { craft, armadura, mochila };
  }

  it('para a direita corta caminho até a coluna do lado', () => {
    const { craft, mochila } = inventario();
    const nav = new UiNavigator();
    inicia(nav);
    craft.focus();

    tap(nav, 'right');
    expect(mochila.focused, 'um passo, e não três').toBe(true);
  });

  it('para cima e para baixo seguem a coluna, não a ordem do documento', () => {
    const { craft, armadura } = inventario();
    const nav = new UiNavigator();
    inicia(nav);
    craft.focus();

    tap(nav, 'up');
    expect(armadura.focused, 'o de cima na mesma coluna').toBe(true);
    tap(nav, 'down');
    expect(craft.focused).toBe(true);
  });

  it('o mais alinhado ganha do mais perto mas torto', () => {
    const origem = slot(0, 100);
    const torto = slot(40, 10);
    const alinhado = slot(90, 100);
    dialog(origem, torto, alinhado);

    const nav = new UiNavigator();
    inicia(nav);
    origem.focus();
    tap(nav, 'right');
    expect(alinhado.focused, 'a linha reta é o que o polegar espera').toBe(true);
  });

  it('sem nada daquele lado, cai na ordem do documento e dá a volta', () => {
    const { mochila, armadura } = inventario();
    const nav = new UiNavigator();
    inicia(nav);
    mochila.focus();

    tap(nav, 'right');
    expect(armadura.focused, 'a seta nunca fica inerte').toBe(true);
  });

  it('sem layout nenhum a travessia continua sendo a da ordem do documento', () => {
    // É o caso dos testes acima e de qualquer tela ainda não desenhada: sem
    // geometria não dá para escolher pela tela, e o comportamento antigo vale.
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'down');
    expect(b.focused).toBe(true);
  });
});

describe('slots do inventário', () => {
  /*
   * Os slots não são `<button>`: são `div[role="button"]` que agem no `keydown`
   * de Enter e no `pointerdown` (doc 08 §3.5). `click()` neles dispara um
   * evento que ninguém escuta — confirmar num slot com o controle não fazia
   * nada até 2026-09-14.
   */
  it('confirmar num slot manda Enter, que é o que ele escuta', () => {
    const casa = slot(0, 0);
    dialog(casa);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'confirm');
    expect(casa.events, 'o slot age no keydown').toContain('keydown');
    expect(casa.clicks, 'e não num click que ninguém ouve').toBe(0);
  });

  it('o clique secundário manda pointerdown de botão direito', () => {
    const casa = slot(0, 0);
    dialog(casa);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'secondary');
    expect(casa.events, 'é como se pegar metade da pilha fosse no mouse')
      .toContain('pointerdown');
  });

  it('num botão comum o secundário não faz nada', () => {
    const botao = el('button');
    dialog(botao);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'secondary');
    expect(botao.clicks, 'botão de menu não tem clique direito').toBe(0);
  });
});

describe('cursor do analógico direito', () => {
  /** Documento com `createElement` e `elementFromPoint`, que o cursor usa. */
  function comCursor(sob: FakeEl | null): void {
    const body = new FakeEl('body');
    const head = new FakeEl('head');
    vi.stubGlobal('document', {
      get activeElement() { return activeElement; },
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
      createElement: (tag: string) => new FakeEl(tag),
      elementFromPoint: () => sob,
      body,
      head,
    });
    vi.stubGlobal('window', { innerWidth: 800, innerHeight: 600 });
    vi.stubGlobal('HTMLElement', FakeEl);
  }

  it('empurrar o analógico foca quem está debaixo do cursor', () => {
    const a = slot(0, 0);
    const longe = slot(600, 400);
    dialog(a, longe);
    comCursor(longe);

    const nav = new UiNavigator();
    tap(nav, 'down');
    a.focus();

    nav.tick({ ...NOTHING, cursorX: 1, cursorY: 1 });
    expect(longe.focused, 'o cursor vai direto na casa apontada').toBe(true);
  });

  it('o cursor sobe do rótulo até o slot que recebe o foco', () => {
    // `elementFromPoint` devolve o `<span>` de dentro do slot muito mais vezes
    // do que o slot em si.
    const casa = slot(0, 0);
    const rotulo = el('span');
    casa.appendChild(rotulo);
    const outro = slot(600, 400);
    dialog(casa, outro);
    comCursor(rotulo);

    const nav = new UiNavigator();
    outro.focus();
    nav.tick({ ...NOTHING, cursorX: -1, cursorY: -1 });
    expect(casa.focused).toBe(true);
  });

  it('analógico parado não mexe no foco', () => {
    const a = slot(0, 0);
    const b = slot(600, 400);
    dialog(a, b);
    comCursor(b);

    const nav = new UiNavigator();
    a.focus();
    nav.tick(NOTHING);
    expect(a.focused, 'sem empurrar o analógico, o foco fica onde está').toBe(true);
    expect(b.focused).toBe(false);
  });

  it('sem DOM para criar o cursor, nada quebra', () => {
    // É o ambiente dos outros testes: `document` sem `createElement`.
    const a = el('button');
    dialog(a);
    const nav = new UiNavigator();
    expect(() => nav.tick({ ...NOTHING, cursorX: 1, cursorY: 0 })).not.toThrow();
  });
});

describe('o que está fora da tela', () => {
  /*
   * Relato de campo 2026-09-14: *"parece que muitas vezes indo para botões nem
   * existentes em tela"*. O atributo `hidden` não pega tudo — um painel
   * fechado por CSS deixa os botões dele no documento.
   */
  it('quem não ocupa espaço fica fora do caminho', () => {
    const a = slot(0, 0);
    const fantasma = el('button');
    const b = slot(0, 30);
    dialog(a, fantasma, b);

    const nav = new UiNavigator();
    inicia(nav);
    a.focus();
    tap(nav, 'down');
    expect(b.focused, 'o botão sem caixa de layout não está na tela').toBe(true);
    expect(fantasma.focused).toBe(false);
  });

  it('se ninguém tem caixa, a lista vai inteira', () => {
    // É o ambiente sem layout: não há o que consultar, e sumir com tudo
    // deixaria a navegação morta.
    const a = el('button');
    const b = el('button');
    dialog(a, b);
    const nav = new UiNavigator();
    inicia(nav);
    tap(nav, 'down');
    expect(b.focused).toBe(true);
  });
});

describe('o foco precisa aparecer', () => {
  /*
   * `:focus-visible` é decidido pela modalidade do último input, e gamepad não
   * é uma modalidade que o navegador conheça: o foco andava certo e ficava
   * invisível, que de dentro do jogo é igual a não andar.
   */
  function comRaiz(): { classes: Set<string>; ouvintes: string[] } {
    const classes = new Set<string>();
    const ouvintes: string[] = [];
    const head = new FakeEl('head');
    vi.stubGlobal('document', {
      get activeElement() { return activeElement; },
      querySelectorAll: (selector: string) => root.querySelectorAll(selector),
      createElement: (tag: string) => new FakeEl(tag),
      documentElement: {
        classList: {
          add: (name: string) => classes.add(name),
          remove: (name: string) => classes.delete(name),
          contains: (name: string) => classes.has(name),
        },
      },
      head,
    });
    vi.stubGlobal('window', {
      addEventListener: (type: string) => ouvintes.push(type),
      removeEventListener: () => {},
    });
    return { classes, ouvintes };
  }

  it('navegar de controle marca o documento', () => {
    const marca = comRaiz();
    dialog(el('button'));
    const nav = new UiNavigator();
    nav.tick({ ...NOTHING, down: true });
    expect(marca.classes.has('pad-nav'), 'sem a marca o anel de foco não acende')
      .toBe(true);
  });

  it('a marca sai no primeiro toque ou tecla — a decisão volta ao navegador', () => {
    const marca = comRaiz();
    dialog(el('button'));
    new UiNavigator().tick({ ...NOTHING, down: true });
    expect(marca.ouvintes).toEqual(['pointerdown', 'keydown']);
  });

  it('sem controle empurrado, nada é marcado', () => {
    const marca = comRaiz();
    dialog(el('button'));
    const nav = new UiNavigator();
    for (let i = 0; i < 10; i++) nav.tick(NOTHING);
    expect(marca.classes.has('pad-nav')).toBe(false);
  });
});
