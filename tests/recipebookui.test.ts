/**
 * Livro de receitas e slot de resultado: as três queixas de campo de
 * 2026-09-12, todas no celular, todas na tela de inventário do sobrevivência.
 *
 *  1. *"Segurando no item o tooltip com o nome não aparece, na região de
 *     receitas"* — o botão usava o atributo `title` do HTML, que só existe
 *     para o mouse parado em cima. No dedo, nunca aparecia nada.
 *  2. *"Ao clicar em cima de uma receita ele poderia auto-completar... porém
 *     parece que não está fazendo"* — `autoFillRecipe` enchia a grade de
 *     verdade, mas escrevendo direto em `inventory.slots`, sem passar por
 *     `changed()`. Sem `onChange`, a tela não redesenhava: cheio no modelo,
 *     vazio na tela.
 *  3. *"Ao atingir os 64 itens... ele buga completamente, fica pegando os 64
 *     no lugar como se eu ainda tivesse ele selecionado"* — craftar em série é
 *     tocar repetido no slot de resultado, e dois toques em 350 ms caíam na
 *     janela do duplo clique, que varre o inventário inteiro para o cursor.
 *
 * Ambiente Node, sem DOM: o stub implementa só o que a tela usa, que é o
 * combinado do projeto para interface.
 */
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { ContainerScreen } from '../src/ui/containers/screen';
import { CRAFT_RESULT, CRAFT_START, Inventory } from '../src/game/inventory';
import { RecipeBook } from '../src/game/crafting';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';

class FakeElement {
  children: FakeElement[] = [];
  parent: FakeElement | null = null;
  hidden = false;
  textContent = '';
  value = '';
  className = '';
  id = '';
  type = '';
  title = '';
  placeholder = '';
  checked = false;
  tabIndex = 0;
  innerHTML = '';
  focused = false;
  readonly dataset: Record<string, string> = {};
  readonly style: Record<string, string> & {
    setProperty(k: string, v: string): void;
    removeProperty(k: string): void;
  } = Object.assign(Object.create(null) as Record<string, string>, {
    setProperty(this: Record<string, string>, k: string, v: string): void { this[k] = v; },
    removeProperty(this: Record<string, string>, k: string): void { delete this[k]; },
  });
  readonly attributes: Record<string, string> = {};
  private readonly handlers = new Map<string, ((e: unknown) => void)[]>();
  readonly classes = new Set<string>();
  readonly classList = {
    add: (...n: string[]): void => { for (const x of n) this.classes.add(x); },
    remove: (...n: string[]): void => { for (const x of n) this.classes.delete(x); },
    toggle: (n: string, on?: boolean): void => {
      if (on ?? !this.classes.has(n)) this.classes.add(n); else this.classes.delete(n);
    },
    contains: (n: string): boolean => this.classes.has(n),
  };

  constructor(readonly tag: string) {}

  appendChild(child: FakeElement): FakeElement {
    child.parent = this; this.children.push(child); return child;
  }
  append(...kids: FakeElement[]): void {
    for (const k of kids) { k.parent = this; this.children.push(k); }
  }
  remove(): void { /* não usado */ }
  setAttribute(name: string, value: string): void { this.attributes[name] = value; }
  removeAttribute(name: string): void { delete this.attributes[name]; }
  addEventListener(type: string, fn: (e: unknown) => void): void {
    const list = this.handlers.get(type) ?? [];
    list.push(fn); this.handlers.set(type, list);
  }
  focus(): void { this.focused = true; }
  click(): void { this.dispatch('click'); }
  dispatch(type: string, event: Record<string, unknown> = {}): void {
    const e = {
      preventDefault: () => {}, stopPropagation: () => {}, stopImmediatePropagation: () => {},
      clientX: 0, clientY: 0, button: 0, pointerType: 'mouse', shiftKey: false,
      ...event,
    };
    for (const fn of this.handlers.get(type) ?? []) fn(e);
  }
  /** Todos os descendentes que satisfazem o teste, em ordem de documento. */
  collect(test: (el: FakeElement) => boolean, out: FakeElement[] = []): FakeElement[] {
    if (test(this)) out.push(this);
    for (const c of this.children) c.collect(test, out);
    return out;
  }
  find(test: (el: FakeElement) => boolean): FakeElement | undefined {
    return this.collect(test)[0];
  }
}

let body: FakeElement;

function stubDom(): void {
  body = new FakeElement('body');
  vi.stubGlobal('document', {
    createElement: (tag: string) => new FakeElement(tag),
    body, head: new FakeElement('head'),
  });
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener: () => {} }));
  vi.stubGlobal('window', { addEventListener: () => {}, matchMedia: () => ({ matches: false }) });
}

beforeEach(stubDom);
afterEach(() => vi.unstubAllGlobals());

const PLANKS = ITEM_BY_NAME.get('oak_planks')!.id;
const LOG = ITEM_BY_NAME.get('oak_log')!.id;

interface Harness {
  screen: ContainerScreen;
  inventory: Inventory;
  root: FakeElement;
  filled: number;
}

/** Tela de inventário aberta, com livro de receitas ligado. */
function harness(): Harness {
  const inventory = new Inventory();
  const recipes = new RecipeBook();
  const h: Harness = {
    screen: null as unknown as ContainerScreen, inventory,
    root: null as unknown as FakeElement, filled: 0,
  };
  h.screen = new ContainerScreen({
    onClose: () => {},
    colorOf: () => '#888888',
    recipes: () => recipes.entries(),
    onPickRecipe: () => { h.filled++; return true; },
  });
  inventory.onChange = () => h.screen.refresh();
  h.screen.open('inventory', inventory);
  h.root = body.children[0];
  return h;
}

/** O elemento do slot marcado com `data-slot`. */
function slotEl(root: FakeElement, source: string, index: number): FakeElement {
  const el = root.find((e) => e.dataset.slot === `${source}:${index}`);
  expect(el, `slot ${source}:${index} não existe na tela`).toBeDefined();
  return el!;
}

describe('livro de receitas no toque', () => {
  it('mostra o nome da receita ao tocar, não só no title do HTML', () => {
    const h = harness();
    h.root.find((e) => e.textContent === 'Receitas')!.click();

    const button = h.root.find((e) => e.className === 'recipe');
    expect(button, 'o livro precisa listar alguma receita').toBeDefined();
    expect(button!.title, 'o title continua, para o mouse').not.toBe('');

    const tooltip = h.root.find((e) => e.className === 'tooltip');
    expect(tooltip).toBeDefined();
    expect(tooltip!.hidden).toBe(true);

    button!.dispatch('pointerdown', { pointerType: 'touch', clientX: 40, clientY: 60 });
    expect(tooltip!.hidden, 'no toque o rótulo tem que aparecer').toBe(false);
    expect(tooltip!.textContent).toBe(button!.title);
  });

  it('redesenha a tela depois de preencher a grade', () => {
    const h = harness();
    h.root.find((e) => e.textContent === 'Receitas')!.click();
    const button = h.root.find((e) => e.className === 'recipe')!;

    // O callback escreve direto no modelo, como `autoFillRecipe` faz: sem o
    // refresh da tela o jogador não veria nada mudar.
    let refreshed = false;
    const original = h.screen.refresh.bind(h.screen);
    h.screen.refresh = (): void => { refreshed = true; original(); };

    button.click();
    expect(h.filled, 'o clique precisa chegar no preenchimento').toBe(1);
    expect(refreshed, 'preencher a grade tem que redesenhar a tela').toBe(true);
  });
});

describe('prévia da grade da receita', () => {
  /** Abre o livro e devolve o primeiro botão de receita e a prévia. */
  function openBook(h: Harness): { button: FakeElement; preview: FakeElement } {
    h.root.find((e) => e.textContent === 'Receitas')!.click();
    const button = h.root.find((e) => e.className === 'recipe');
    const preview = h.root.find((e) => e.className === 'preview');
    expect(button, 'o livro precisa listar alguma receita').toBeDefined();
    expect(preview, 'o painel de prévia precisa existir').toBeDefined();
    return { button: button!, preview: preview! };
  }

  it('nasce escondida e aparece ao passar o mouse na receita', () => {
    const h = harness();
    const { button, preview } = openBook(h);
    expect(preview.hidden).toBe(true);

    button.dispatch('pointerenter', { pointerType: 'mouse' });
    expect(preview.hidden, 'passar o mouse tem que mostrar a grade').toBe(false);
    expect(preview.collect((e) => e.className.startsWith('cell')).length)
      .toBeGreaterThan(0);

    button.dispatch('pointerleave', { pointerType: 'mouse' });
    expect(preview.hidden).toBe(true);
  });

  it('no toque ela aparece e fica — não há "sair de cima" no dedo', () => {
    const h = harness();
    const { button, preview } = openBook(h);
    button.dispatch('pointerdown', { pointerType: 'touch' });
    expect(preview.hidden).toBe(false);
  });

  it('marca em vermelho o ingrediente que falta na mochila', () => {
    const h = harness();
    const { button, preview } = openBook(h);
    button.dispatch('pointerenter', { pointerType: 'mouse' });
    const cells = preview.collect((e) => e.className.startsWith('cell'));
    const filled = cells.filter((c) => c.title !== '');
    expect(filled.length, 'a receita precisa ter ingrediente').toBeGreaterThan(0);
    // Mochila vazia: tudo que a receita pede está faltando.
    expect(filled.every((c) => c.classes.has('missing'))).toBe(true);
  });

  it('o mesmo ingrediente não conta duas vezes com uma unidade só', () => {
    // Uma tábua na mochila não pode deixar verde uma receita que pede duas.
    const h = harness();
    h.inventory.set(0, makeStack(PLANKS, 1));
    const { button, preview } = openBook(h);

    const twoPlanks = h.root.collect((e) => e.className === 'recipe')
      .find((b) => b.title.includes('Graveto') || b.title.includes('Vara'));
    (twoPlanks ?? button).dispatch('pointerenter', { pointerType: 'mouse' });

    const cells = preview.collect((e) => e.className.startsWith('cell') && e.title !== '');
    const plankCells = cells.filter((c) => c.title.includes('Tábua'));
    if (plankCells.length >= 2) {
      expect(plankCells.some((c) => c.classes.has('missing'))).toBe(true);
    }
  });

  it('a prévia some ao redesenhar a lista', () => {
    const h = harness();
    const { button, preview } = openBook(h);
    button.dispatch('pointerenter', { pointerType: 'mouse' });
    expect(preview.hidden).toBe(false);
    // Preencher a grade redesenha o livro; a prévia antiga não pode ficar.
    button.click();
    expect(preview.hidden).toBe(true);
  });
});

describe('slot de resultado do craft', () => {
  it('tocar duas vezes rápido não varre o inventário para o cursor', () => {
    const h = harness();
    // 64 tábuas já guardadas e 4 saindo da grade, que é o estado do relato.
    h.inventory.set(0, makeStack(PLANKS, 64));
    h.inventory.slots[CRAFT_RESULT] = makeStack(PLANKS, 4);
    h.inventory.slots[CRAFT_START] = makeStack(LOG, 1);

    const result = slotEl(h.root, 'inv', CRAFT_RESULT);
    result.dispatch('pointerdown', { pointerType: 'touch' });
    expect(h.inventory.cursor?.count, 'o primeiro toque pega o resultado').toBe(4);

    // Segundo toque logo em seguida: é craftar de novo, não um gesto.
    result.dispatch('pointerdown', { pointerType: 'touch' });
    expect(
      h.inventory.get(0)?.count,
      'as 64 guardadas não podem voltar para a mão sozinhas',
    ).toBe(64);
  });

  it('em slot comum o duplo clique continua juntando os stacks', () => {
    const h = harness();
    h.inventory.set(0, makeStack(PLANKS, 32));
    h.inventory.set(1, makeStack(PLANKS, 20));

    const slot = slotEl(h.root, 'inv', 0);
    slot.dispatch('pointerdown', {});
    expect(h.inventory.cursor?.count).toBe(32);

    slot.dispatch('pointerdown', {});
    expect(h.inventory.cursor?.count, 'o gesto de juntar não pode ter morrido').toBe(52);
  });
});
