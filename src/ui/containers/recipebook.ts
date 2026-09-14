/**
 * Livro de receitas (doc 05 §6.4 e doc 08 §3.6).
 *
 * Mostra o que dá para fazer **agora** com o que está na mochila, com busca por
 * nome, e preenche a grade sozinho ao clicar. Sem ele, craftar depende de o
 * jogador já saber a receita de cor — que é justamente o que trava quem está
 * começando.
 *
 * Fica em um módulo próprio porque a tela de contêiner já é grande, e porque a
 * mesma lista serve o inventário 2×2 e a bancada 3×3.
 */

import { itemDef } from '../../data/items';
import type { RecipeEntry } from '../../game/crafting';
import type { Inventory } from '../../game/inventory';

export interface RecipeBookCallbacks {
  /** Preenche a grade com a receita; devolve false se faltou ingrediente. */
  onPick: (entry: RecipeEntry) => boolean;
  /** `background-position` do item na folha de sprites, ou `null`. */
  spriteOf?: (item: number) => string | null;
  /**
   * Mostra o nome da receita com o tooltip do jogo.
   *
   * `flash` é o caminho do toque: aparece e some sozinho, porque no dedo não
   * existe "estar em cima". `text: null` esconde. Sem isto o livro dependia do
   * atributo `title` do HTML, que **nunca** aparece no toque — era a região de
   * receitas ficar sem rótulo nenhum no celular.
   */
  onHint?: (text: string | null, x: number, y: number, flash: boolean) => void;
}

export class RecipeBookPanel {
  readonly element: HTMLDivElement;
  private readonly list: HTMLDivElement;
  /**
   * Prévia da **grade** da receita (doc 08 §3.5).
   *
   * O livro mostrava só o resultado: para saber o que entra numa bancada de
   * ferro era preciso clicar e ver a grade se preencher — e, se faltasse
   * ingrediente, o clique não fazia nada e o jogador continuava sem saber o
   * que faltava. A prévia mostra as células, com o que falta em vermelho.
   *
   * É um painel só, reusado: montar um por receita encheria a lista de nós.
   */
  private readonly preview: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly onlyAvailable: HTMLInputElement;
  private readonly callbacks: RecipeBookCallbacks;
  private entries: readonly RecipeEntry[] = [];
  private inventory: Inventory | null = null;
  /** Tamanho da grade aberta: receita maior que ela não aparece. */
  private gridSize = 3;

  constructor(callbacks: RecipeBookCallbacks) {
    this.callbacks = callbacks;
    injectStyle();

    this.element = document.createElement('div');
    this.element.className = 'recipe-book';
    this.element.hidden = true;

    const header = document.createElement('div');
    header.className = 'header';

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.placeholder = 'Buscar…';
    this.search.setAttribute('aria-label', 'Buscar receita');
    this.search.addEventListener('input', () => this.render());

    const filter = document.createElement('label');
    filter.className = 'filter';
    this.onlyAvailable = document.createElement('input');
    this.onlyAvailable.type = 'checkbox';
    /*
     * Nasce **desligado**.
     *
     * Ligado, o livro de quem acabou de entrar no mundo abre dizendo "Nada para
     * fazer com o que você tem" — a única ferramenta que ensina a craftar fica
     * vazia justo na hora em que ela mais serve. Desligado, o jogador vê tudo
     * que existe, com o que não dá em cinza (doc 08 §3.5: "receitas
     * desconhecidas aparecem em silhueta cinza"), e ordenado com o possível na
     * frente.
     */
    this.onlyAvailable.checked = false;
    this.onlyAvailable.addEventListener('change', () => this.render());
    const filterText = document.createElement('span');
    filterText.textContent = 'só o que dá';
    filter.append(this.onlyAvailable, filterText);

    header.append(this.search, filter);

    this.list = document.createElement('div');
    this.list.className = 'list';

    this.preview = document.createElement('div');
    this.preview.className = 'preview';
    this.preview.hidden = true;

    this.element.append(header, this.list, this.preview);
  }

  /**
   * Preenche a prévia com a grade da receita e a mostra.
   *
   * Célula vazia fica apagada; célula cujo ingrediente falta na mochila ganha
   * borda vermelha. Receita sem forma (`shapeless`) sai como uma fileira só,
   * que é o que ela é.
   */
  private showPreview(entry: RecipeEntry, name: string): void {
    const counts = this.countInventory();
    this.preview.textContent = '';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = entry.resultCount > 1 ? `${name} ×${entry.resultCount}` : name;
    this.preview.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'grid';
    const columns = entry.shapeless ? entry.cells.length : entry.width;
    grid.style.gridTemplateColumns = `repeat(${Math.max(1, columns)}, auto)`;

    // O mesmo contador do `canCraft`: um ingrediente já gasto não conta duas
    // vezes, senão duas tábuas na receita ficariam verdes com uma na mochila.
    const used = new Map<number, number>();
    for (const cell of entry.cells) {
      const slot = document.createElement('div');
      slot.className = 'cell';
      if (cell === null || cell === undefined || cell.length === 0) {
        grid.appendChild(slot);
        continue;
      }
      const chosen = pickAvailable(cell, counts, used);
      const item = chosen ?? cell[0];
      const sprite = this.callbacks.spriteOf?.(item) ?? null;
      if (sprite !== null) {
        slot.classList.add('sprite');
        slot.style.backgroundPosition = sprite;
      } else {
        slot.textContent = (itemDef(item)?.display ?? '').slice(0, 2);
      }
      if (chosen === null) slot.classList.add('missing');
      slot.title = itemDef(item)?.display ?? '';
      grid.appendChild(slot);
    }

    this.preview.appendChild(grid);
    if (entry.shapeless) {
      const note = document.createElement('div');
      note.className = 'note';
      note.textContent = 'em qualquer posição';
      this.preview.appendChild(note);
    }
    this.preview.hidden = false;
  }

  private hidePreview(): void {
    this.preview.hidden = true;
  }

  get isOpen(): boolean {
    return !this.element.hidden;
  }

  toggle(): void {
    this.element.hidden = !this.element.hidden;
    if (!this.element.hidden) this.render();
  }

  hide(): void {
    this.element.hidden = true;
  }

  /** Reapresenta com o inventário atual. */
  update(
    entries: readonly RecipeEntry[], inventory: Inventory, gridSize: number,
  ): void {
    this.entries = entries;
    this.inventory = inventory;
    this.gridSize = gridSize;
    if (!this.element.hidden) this.render();
  }

  private render(): void {
    this.list.textContent = '';
    this.hidePreview();
    const counts = this.countInventory();
    const query = this.search.value.trim().toLowerCase();
    let shown = 0;

    // Duas passadas: o que dá primeiro, o resto em cinza depois. Sem isso a
    // receita útil se perde no meio das dezenas que faltam ingrediente.
    for (const pass of [true, false]) {
      if (!pass && this.onlyAvailable.checked) break;
      for (const entry of this.entries) {
        if (entry.width > this.gridSize || entry.height > this.gridSize) continue;

        const def = itemDef(entry.resultItem);
        const name = def?.display ?? '';
        if (query !== '' && !name.toLowerCase().includes(query)) continue;

        const available = canCraft(entry, counts);
        if (available !== pass) continue;

        this.list.appendChild(this.makeButton(entry, name, available));
        shown++;
        // Teto de segurança: a lista é rolável, mas montar 500 nós por tecla
        // digitada custaria mais que o valor de mostrar todas.
        if (shown >= 120) break;
      }
      if (shown >= 120) break;
    }

    if (shown === 0) {
      const empty = document.createElement('p');
      empty.className = 'empty';
      empty.textContent = query === ''
        ? 'Nada para fazer com o que você tem — desmarque "só o que dá" para ver tudo.'
        : 'Nenhuma receita com esse nome.';
      this.list.appendChild(empty);
    }
  }

  private makeButton(entry: RecipeEntry, name: string, available: boolean): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'recipe';
    if (!available) button.classList.add('missing');
    button.title = entry.resultCount > 1 ? `${name} ×${entry.resultCount}` : name;
    button.setAttribute('aria-label', button.title);

    const sprite = this.callbacks.spriteOf?.(entry.resultItem) ?? null;
    if (sprite !== null) {
      button.classList.add('sprite');
      button.style.backgroundPosition = sprite;
    } else {
      button.textContent = name.slice(0, 2);
    }
    if (entry.resultCount > 1) {
      const count = document.createElement('span');
      count.textContent = String(entry.resultCount);
      button.appendChild(count);
    }

    const hint = this.callbacks.onHint;
    // Mesma divisão de trabalho dos slots: no toque quem avisa é o
    // `pointerdown`; só o mouse tem entrar e sair. A prévia da grade segue os
    // mesmos gestos — no dedo ela aparece ao tocar e fica até tocar em outra.
    button.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse') hint?.(button.title, e.clientX, e.clientY, true);
      this.showPreview(entry, name);
    });
    button.addEventListener('pointerenter', (e) => {
      if (e.pointerType !== 'mouse') return;
      hint?.(button.title, e.clientX, e.clientY, false);
      this.showPreview(entry, name);
    });
    button.addEventListener('pointerleave', (e) => {
      if (e.pointerType !== 'mouse') return;
      hint?.(null, e.clientX, e.clientY, false);
      this.hidePreview();
    });
    button.addEventListener('focus', () => this.showPreview(entry, name));

    button.addEventListener('click', () => {
      if (this.callbacks.onPick(entry)) this.render();
    });
    return button;
  }

  /** Quantos de cada item existem na mochila (hotbar + principal). */
  private countInventory(): Map<number, number> {
    const counts = new Map<number, number>();
    const inventory = this.inventory;
    if (inventory === null) return counts;
    for (let i = 0; i < 36; i++) {
      const stack = inventory.get(i);
      if (stack === null) continue;
      counts.set(stack.item, (counts.get(stack.item) ?? 0) + stack.count);
    }
    return counts;
  }
}

/**
 * Primeiro candidato da célula que ainda sobra na mochila, ou `null`.
 *
 * `used` é compartilhado entre as células da mesma receita: sem ele, uma
 * receita que pede duas tábuas apareceria completa com uma só na mochila.
 */
function pickAvailable(
  cell: readonly number[], counts: Map<number, number>, used: Map<number, number>,
): number | null {
  for (const candidate of cell) {
    const have = counts.get(candidate) ?? 0;
    const spent = used.get(candidate) ?? 0;
    if (have - spent <= 0) continue;
    used.set(candidate, spent + 1);
    return candidate;
  }
  return null;
}

/** true se cada célula da receita tem um ingrediente disponível. */
function canCraft(entry: RecipeEntry, counts: Map<number, number>): boolean {
  const used = new Map<number, number>();
  for (const cell of entry.cells) {
    if (cell === null || cell === undefined) continue;
    let ok = false;
    for (const candidate of cell) {
      const have = counts.get(candidate) ?? 0;
      const spent = used.get(candidate) ?? 0;
      if (have - spent <= 0) continue;
      used.set(candidate, spent + 1);
      ok = true;
      break;
    }
    if (!ok) return false;
  }
  return true;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
.recipe-book{margin-top:calc(2 * var(--px,3px));border-top:var(--px,3px) solid #555;
  padding-top:calc(2 * var(--px,3px));display:flex;flex-direction:column;gap:6px}
.recipe-book .header{display:flex;gap:8px;align-items:center}
.recipe-book input[type=search]{flex:1 1 auto;min-height:32px;background:#8b8b8b;color:#fff;
  border:var(--px,3px) solid #373737;padding:4px 6px;
  font:calc(4.5 * var(--px,3px))/1 ui-monospace,monospace}
.recipe-book .filter{display:flex;align-items:center;gap:4px;font-size:calc(4 * var(--px,3px));
  color:#3f3f3f;white-space:nowrap}
.recipe-book .filter input{width:20px;height:20px;accent-color:#3f7d3f}
.recipe-book .list{display:flex;flex-wrap:wrap;gap:calc(1 * var(--px,3px));
  max-height:calc(56 * var(--px,3px));overflow:auto}
.recipe-book .empty{margin:6px 0;color:#3f3f3f;font-size:calc(4 * var(--px,3px))}
.recipe-book .recipe{position:relative;width:calc(18 * var(--px,3px));
  height:calc(18 * var(--px,3px));min-width:32px;min-height:32px;background:#8b8b8b;
  border-top:var(--px,3px) solid #373737;border-left:var(--px,3px) solid #373737;
  border-right:var(--px,3px) solid #fff;border-bottom:var(--px,3px) solid #fff;
  color:#fff;cursor:pointer;display:grid;place-items:end;padding:0;
  font:calc(4.5 * var(--px,3px))/1 ui-monospace,monospace;
  text-shadow:0 0 2px #000,var(--px,3px) var(--px,3px) 0 #000}
.recipe-book .recipe.sprite{background-image:var(--item-sheet);
  background-size:var(--item-sheet-size);background-repeat:no-repeat;image-rendering:pixelated}
.recipe-book .recipe.missing{filter:grayscale(1) brightness(.7)}
.recipe-book .recipe:hover,.recipe-book .recipe:focus-visible{outline:2px solid #7b94c7}
.recipe-book .recipe span{padding:0 var(--px,3px)}
/* Prévia da grade: fica embaixo da lista, para não tapar as receitas. */
.recipe-book .preview{display:flex;flex-direction:column;gap:calc(1 * var(--px,3px));
  align-items:flex-start;border-top:var(--px,3px) solid #555;
  padding-top:calc(2 * var(--px,3px));color:#3f3f3f}
.recipe-book .preview .title{font:calc(4.5 * var(--px,3px))/1.2 ui-monospace,monospace}
.recipe-book .preview .note{font:calc(4 * var(--px,3px))/1.2 ui-monospace,monospace;opacity:.7}
.recipe-book .preview .grid{display:grid;gap:calc(1 * var(--px,3px))}
.recipe-book .preview .cell{width:calc(16 * var(--px,3px));height:calc(16 * var(--px,3px));
  min-width:26px;min-height:26px;background:#8b8b8b;
  border-top:var(--px,3px) solid #373737;border-left:var(--px,3px) solid #373737;
  border-right:var(--px,3px) solid #fff;border-bottom:var(--px,3px) solid #fff;
  display:grid;place-items:center;color:#fff;
  font:calc(4 * var(--px,3px))/1 ui-monospace,monospace;
  text-shadow:0 0 2px #000}
.recipe-book .preview .cell.sprite{background-image:var(--item-sheet);
  background-size:var(--item-sheet-size);background-repeat:no-repeat;image-rendering:pixelated}
/* Falta na mochila: vermelho e apagado, que é o que o jogador precisa ver. */
.recipe-book .preview .cell.missing{border-color:#a33;filter:grayscale(1) brightness(.75)}
`;
  document.head.appendChild(css);
}
