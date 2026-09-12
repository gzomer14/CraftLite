/**
 * Inventário criativo: as duas queixas de campo de 2026-09-10.
 *
 *  1. *"No criativo perco acesso ao meu inventário, não consigo equipar
 *     armadura"* — o `E` abria só a paleta de itens, e os slots de armadura,
 *     o offhand e a grade 2×2 ficavam inalcançáveis.
 *  2. *"Ele já abre com a pesquisa selecionada"* — focar o campo de busca sobe
 *     o teclado virtual por cima da tela no celular.
 *
 * O ambiente de teste é Node, sem DOM: o stub abaixo implementa só o que a
 * tela usa de verdade, que é o combinado do projeto para UI.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { CreativeScreen } from '../src/ui/containers/creative';
import { ContainerScreen } from '../src/ui/containers/screen';
import { ARMOR_START, HOTBAR_START, Inventory } from '../src/game/inventory';
import { readFileSync } from 'node:fs';
import { itemId, makeStack } from '../src/data/items';

class FakeElement {
  children: FakeElement[] = [];
  hidden = false;
  textContent = '';
  value = '';
  className = '';
  id = '';
  type = '';
  title = '';
  placeholder = '';
  focused = false;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & {
    setProperty(k: string, v: string): void;
    removeProperty(k: string): void;
  } =
    Object.assign(Object.create(null) as Record<string, string>, {
      setProperty(this: Record<string, string>, k: string, v: string): void { this[k] = v; },
      removeProperty(this: Record<string, string>, k: string): void { delete this[k]; },
    });
  readonly attributes: Record<string, string> = {};
  private readonly handlers = new Map<string, (() => void)[]>();

  readonly classes = new Set<string>();
  readonly classList = {
    add: (...names: string[]): void => { for (const n of names) this.classes.add(n); },
    remove: (...names: string[]): void => { for (const n of names) this.classes.delete(n); },
    toggle: (name: string, on?: boolean): void => {
      if (on ?? !this.classes.has(name)) this.classes.add(name);
      else this.classes.delete(name);
    },
    contains: (name: string): boolean => this.classes.has(name),
  };

  constructor(readonly tag: string) {}

  appendChild(child: FakeElement): FakeElement { this.children.push(child); return child; }
  append(...kids: FakeElement[]): void { this.children.push(...kids); }
  remove(): void { /* não usado */ }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  addEventListener(type: string, fn: () => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn);
    this.handlers.set(type, list);
  }
  focus(): void { this.focused = true; }
  click(): void { for (const fn of this.handlers.get('click') ?? []) fn(); }
  /**
   * Dispara um evento com carga — `pointerdown` com `shiftKey`, por exemplo.
   * Respeita `stopImmediatePropagation`, que é como o guarda do toque longo
   * engole o clique nascido de uma consulta.
   */
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    let stopped = false;
    const e = {
      preventDefault: () => {},
      stopPropagation: () => {},
      stopImmediatePropagation: () => { stopped = true; },
      ...event,
    };
    for (const fn of this.handlers.get(type) ?? []) {
      (fn as (ev: unknown) => void)(e);
      if (stopped) return;
    }
  }

  /** Primeiro descendente cujo texto bate — é como os testes acham botões. */
  find(text: string): FakeElement | undefined {
    if (this.textContent === text) return this;
    for (const child of this.children) {
      const hit = child.find(text);
      if (hit !== undefined) return hit;
    }
    return undefined;
  }
  /** Todos os descendentes de uma tag. */
  all(tag: string, out: FakeElement[] = []): FakeElement[] {
    if (this.tag === tag) out.push(this);
    for (const child of this.children) child.all(tag, out);
    return out;
  }
}

let body: FakeElement;

/** `coarse` liga o modo "celular" do `matchMedia`. */
function stubDom(coarse: boolean): void {
  body = new FakeElement('body');
  const head = new FakeElement('head');
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    body,
    head,
  });
  vi.stubGlobal('matchMedia', (query: string) => ({
    matches: coarse && query.includes('coarse'),
    addEventListener: () => {},
  }));
  // A tela de container escuta `pointerup` na janela para encerrar o arraste.
  vi.stubGlobal('window', { addEventListener: () => {}, matchMedia: () => ({ matches: coarse }) });
}

beforeEach(() => stubDom(false));
afterEach(() => vi.unstubAllGlobals());

/** A tela recém-criada, mais o campo de busca que ela pendurou no corpo. */
function open(coarse: boolean, onOpenInventory?: () => void): FakeElement {
  stubDom(coarse);
  const screen = new CreativeScreen({ onClose: () => {}, onOpenInventory });
  screen.open(new Inventory());
  return body.children[0];
}

describe('busca não rouba o foco no celular', () => {
  it('com ponteiro grosso, a busca NÃO recebe foco', () => {
    const root = open(true);
    const search = root.all('input')[0];
    expect(search).toBeDefined();
    expect(search.focused).toBe(false);
  });

  it('no desktop a busca continua focada ao abrir', () => {
    const root = open(false);
    expect(root.all('input')[0].focused).toBe(true);
  });
});

describe('ponte para a mochila', () => {
  it('existe um botão que leva ao inventário normal', () => {
    const root = open(false);
    expect(root.find('Mochila e armadura')).toBeDefined();
  });

  it('o botão fecha a paleta e avisa quem abre a mochila', () => {
    let opened = 0;
    const root = open(false, () => { opened++; });
    root.find('Mochila e armadura')!.click();
    expect(opened).toBe(1);
    expect(root.hidden).toBe(true);
  });
});

/**
 * Saída sem teclado (queixa de campo, 2026-09-11: *"no criativo, ao abrir a
 * parte de inventário não existe um botão para fechar a janela aberta de
 * Mochila"*).
 *
 * O alcance é maior do que a queixa: o overlay da tela é `z-index:12` e o HUD
 * de toque é `z-index:6`, então com **qualquer** container aberto — baú,
 * fornalha, bancada ou mochila, nos dois modos — o botão de inventário e o de
 * pausa ficam cobertos. Num aparelho sem teclado não havia como sair.
 */
describe('toda tela de container fecha sem teclado', () => {
  /** A tela aberta num tipo, mais a raiz que ela pendurou no corpo. */
  const openScreen = (kind: 'inventory' | 'chest' | 'furnace' | 'crafting') => {
    stubDom(true);
    let closed = 0;
    const screen = new ContainerScreen({
      onClose: () => { closed++; },
      colorOf: () => '#808080',
    } as never);
    screen.open(kind as never, new Inventory() as never);
    return { root: body.children[0], screen, closed: () => closed };
  };

  for (const kind of ['inventory', 'chest', 'furnace', 'crafting'] as const) {
    it(`${kind} tem botão de fechar`, () => {
      const { root } = openScreen(kind);
      expect(root.find('Fechar'), `${kind} sem botão de fechar`).toBeDefined();
    });
  }

  it('o botão fecha de verdade e avisa quem devolve o pointer lock', () => {
    const { root, screen, closed } = openScreen('chest');
    expect(screen.isOpen).toBe(true);
    root.find('Fechar')!.click();
    expect(screen.isOpen).toBe(false);
    expect(closed()).toBe(1);
  });

  it('o botão é alvo de toque de 44 px, como manda o doc 09', () => {
    const source = readFileSync('src/ui/containers/screen.ts', 'utf8').replace(/\s+/g, '');
    expect(source).toContain('#container-screen.close{flex:1;min-height:44px');
  });
});

/**
 * Slots de equipamento (queixa de campo, 2026-09-10: *"no criativo perco acesso
 * ao meu inventário, não consigo equipar armadura"*).
 *
 * A correção daquele dia pôs o botão "Mochila e armadura" na paleta criativa —
 * mas a tela de destino nunca desenhou os slots. `ARMOR_START` e `OFFHAND`
 * existiam no modelo desde o M5, `canPlaceIn` validava a peça e shift+clique
 * equipava; só a interface faltava. Na prática não havia como vestir armadura à
 * mão em nenhum modo.
 */
describe('a mochila mostra armadura e mão secundária', () => {
  const openInventory = () => {
    stubDom(false);
    const inventory = new Inventory();
    const screen = new ContainerScreen({
      onClose: () => {},
      colorOf: () => '#808080',
    } as never);
    screen.open('inventory' as never, inventory as never);
    return { root: body.children[0], screen, inventory };
  };

  it('desenha os 4 slots de armadura e o offhand', () => {
    const { root } = openInventory();
    expect(root.find('Equipamento')).toBeDefined();
    for (const peca of ['Elmo', 'Peito', 'Calça', 'Bota', 'Mão']) {
      expect(root.find(peca), `slot ${peca} não desenhado`).toBeDefined();
    }
  });

  it('o painel monta duas colunas, com a mochila na larga', () => {
    // O 9-slot da mochila precisa de uma coluna própria: espremido em metade
    // do painel, ele vazava para fora da borda.
    const { root } = openInventory();
    const cols = root.all('div').filter((d) => d.className === 'grid-col');
    expect(cols.length).toBe(2);
    expect(cols[0].find('Equipamento'), 'equipamento na coluna estreita').toBeDefined();
    expect(cols[1].find('Inventário'), 'mochila na coluna larga').toBeDefined();
    expect(cols[0].find('Inventário')).toBeUndefined();
  });

  it('a tela tem os 46 slots do doc 08 §3.5', () => {
    const { screen } = openInventory();
    // 5 equipamento + 4 craft + 1 resultado + 27 mochila + 9 hotbar = 46.
    expect((screen as unknown as { slots: unknown[] }).slots.length).toBe(46);
  });

  it('shift+clique num capacete equipa no slot do elmo', () => {
    // O caminho inteiro: o slot escuta `pointerdown`, repassa `shiftKey`, e o
    // `shiftMove` do inventário manda a peça para o lugar dela.
    const { root, screen, inventory } = openInventory();
    inventory.slots[HOTBAR_START] = makeStack(itemId('iron_helmet'), 1);
    screen.refresh();

    const hotbarSlot = root.all('div')
      .find((d) => /Capacete de Ferro/.test(d.attributes['aria-label'] ?? ''));
    expect(hotbarSlot, 'capacete não apareceu em nenhum slot').toBeDefined();
    hotbarSlot!.dispatch('pointerdown', {
      button: 0, shiftKey: true, preventDefault: () => {}, stopPropagation: () => {},
    });

    expect(inventory.slots[ARMOR_START]?.item).toBe(itemId('iron_helmet'));
    expect(inventory.slots[HOTBAR_START]).toBe(null);
  });

  it('o rótulo do slot vazio some quando a peça entra', () => {
    const { root, screen, inventory } = openInventory();
    const elmo = root.find('Elmo')!;
    inventory.slots[ARMOR_START] = makeStack(itemId('iron_helmet'), 1);
    screen.refresh();
    expect(elmo.textContent).not.toBe('Elmo');
  });
});

/**
 * Rolagem das janelas no celular (queixa de campo, 2026-09-10: *"não consigo
 * mover a janela para cima e baixo"*).
 *
 * O CSS vive dentro do módulo, e não há DOM de verdade no ambiente de teste —
 * então a checagem é sobre a fonte, como já se faz com o `index.html` em
 * `uihidden.test.ts`. Duas regras, as duas invisíveis num code review:
 * `touch-action:none` na janela **desliga a rolagem por toque**, e
 * `place-items:center` com conteúdo mais alto que a tela deixa o topo
 * inalcançável.
 */
describe('CSS de rolagem das janelas', () => {
  const screenSrc = readFileSync('src/ui/containers/screen.ts', 'utf8');
  const creativeSrc = readFileSync('src/ui/containers/creative.ts', 'utf8');

  /** Só o bloco de regra do seletor raiz, sem os filhos. */
  const rootRule = (source: string, id: string): string => {
    const start = source.indexOf(`#${id}{`);
    expect(start, `regra de #${id} não encontrada`).toBeGreaterThan(-1);
    return source.slice(start, source.indexOf('}', start)).replace(/\s+/g, '');
  };

  it('a janela de inventário não bloqueia a rolagem por toque', () => {
    const rule = rootRule(screenSrc, 'container-screen');
    expect(rule).not.toContain('touch-action:none');
    expect(rule).toContain('touch-action:pan-y');
  });

  it('o slot continua bloqueando, para arrastar pilha não rolar a janela', () => {
    expect(screenSrc.replace(/\s+/g, '')).toContain('#container-screen.slot{position:relative;touch-action:none');
  });

  it('as duas janelas alinham no topo quando não cabem', () => {
    expect(rootRule(screenSrc, 'container-screen')).toContain('place-items:safecenter');
    expect(rootRule(creativeSrc, 'creative-screen')).toContain('place-items:safecenter');
  });

  it('a rolagem não vaza para a página atrás', () => {
    expect(rootRule(screenSrc, 'container-screen')).toContain('overscroll-behavior:contain');
    expect(rootRule(creativeSrc, 'creative-screen')).toContain('overscroll-behavior:contain');
  });
});

/**
 * Nome do item no celular (queixa de campo, 2026-09-11: *"na versão mobile, ao
 * clicar em cima do item no modo criativo ele já traz o item para a minha
 * barra de seleção, não me informa qual o nome do item"*).
 *
 * No desktop o nome vem do hover. No toque não há hover, e o `title` do HTML
 * nunca aparece: quem não reconhecia o sprite não tinha como descobrir. O
 * toque longo resolve **sem tirar nada**: o toque curto continua dando o item.
 */
describe('toque longo revela o nome do item', () => {
  const slotFor = (root: FakeElement): FakeElement =>
    root.all('button').find((b) => b.className === 'slot')!;

  /** Um toque de `ms` no primeiro slot da paleta. */
  function toque(root: FakeElement, ms: number): void {
    const slot = slotFor(root);
    slot.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(ms);
    slot.dispatch('pointerup', { pointerType: 'touch' });
    slot.dispatch('click', {});
  }

  const tooltipDe = (root: FakeElement): FakeElement | undefined =>
    root.all('div').find((d) => d.className === 'tooltip');

  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('segurar mostra o nome', () => {
    const root = open(true);
    toque(root, 500);
    const tip = tooltipDe(root)!;
    expect(tip.hidden).toBe(false);
    expect(tip.textContent.length).toBeGreaterThan(0);
    expect(tip.textContent).toBe(slotFor(root).attributes['aria-label']);
  });

  it('segurar NÃO manda o item para a hotbar', () => {
    stubDom(true);
    const inventory = new Inventory();
    const screen = new CreativeScreen({ onClose: () => {} });
    screen.open(inventory);
    expect(inventory.get(HOTBAR_START)).toBe(null);

    const root = body.children[0];
    toque(root, 500);
    expect(inventory.get(HOTBAR_START), 'segurar não pode dar o item').toBe(null);
  });

  it('o toque curto continua dando o item — nada foi tirado', () => {
    stubDom(true);
    const inventory = new Inventory();
    const screen = new CreativeScreen({ onClose: () => {} });
    screen.open(inventory);

    // Sem isto o teste passaria mesmo se o toque curto parasse de funcionar.
    expect(inventory.get(HOTBAR_START)).toBe(null);

    const root = body.children[0];
    toque(root, 50);
    const pego = inventory.get(HOTBAR_START);
    expect(pego).not.toBe(null);
    expect(pego!.count).toBeGreaterThan(0);
  });

  it('o rótulo some sozinho: o toque não tem "sair de cima"', () => {
    const root = open(true);
    toque(root, 500);
    expect(tooltipDe(root)!.hidden).toBe(false);
    vi.advanceTimersByTime(3000);
    expect(tooltipDe(root)!.hidden).toBe(true);
  });

  it('o mouse não dispara o toque longo — lá quem informa é o hover', () => {
    const root = open(false);
    const slot = slotFor(root);
    slot.dispatch('pointerdown', { pointerType: 'mouse', clientX: 10, clientY: 20 });
    vi.advanceTimersByTime(1000);
    expect(tooltipDe(root)!.hidden).toBe(true);
  });

  it('escorregar o dedo cancela a consulta — é rolagem, não consulta', () => {
    const root = open(true);
    const slot = slotFor(root);
    slot.dispatch('pointerdown', { pointerType: 'touch', clientX: 10, clientY: 20 });
    slot.dispatch('pointermove', { pointerType: 'touch', clientX: 10, clientY: 80 });
    vi.advanceTimersByTime(1000);
    expect(tooltipDe(root)!.hidden).toBe(true);
  });
});
