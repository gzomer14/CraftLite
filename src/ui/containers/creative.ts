/**
 * Inventário criativo com abas e busca (doc 08 §3.7).
 *
 * No criativo o jogador não junta recurso: ele **escolhe**. Sem esta tela, o
 * modo começava com nove blocos fixos e não havia como chegar aos outros 60,
 * nem às ferramentas.
 *
 * As abas não vêm de uma tabela nova: saem dos campos que o item já declara
 * (`placesBlock`, `tool`, `armor`, `food`). Classificar de novo à mão só criaria
 * uma segunda verdade para manter em dia.
 */

import { t, tf } from '../../core/i18n';
import { ITEMS, itemDef, maxStackOf, type ItemDef } from '../../data/items';
import { HOTBAR_END, HOTBAR_START, type Inventory } from '../../game/inventory';
import { ItemTooltip } from './tooltip';

export interface CreativeCallbacks {
  onClose: () => void;
  /** Abre a mochila normal (armadura, offhand, craft 2×2) — ver `open`. */
  onOpenInventory?: () => void;
  spriteOf?: (item: number) => string | null;
  colorOf?: (item: number) => string;
  /** Duração do toque longo, das opções (doc 09 §4). */
  longPressMs?: () => number;
}

type TabId = 'blocks' | 'tools' | 'combat' | 'food' | 'materials';

const TABS: readonly { id: TabId; label: string }[] = [
  { id: 'blocks', label: t('creative.blocks') },
  { id: 'tools', label: t('creative.tools') },
  { id: 'combat', label: t('creative.combat') },
  { id: 'food', label: t('creative.food') },
  { id: 'materials', label: t('creative.materials') },
];

/** Em qual aba o item cai. */
export function tabOf(item: ItemDef): TabId {
  if (item.armor !== undefined) return 'combat';
  if (item.tool !== undefined) return item.tool.kind === 'sword' ? 'combat' : 'tools';
  if (item.food !== undefined) return 'food';
  if (item.placesBlock !== undefined) return 'blocks';
  return 'materials';
}

export class CreativeScreen {
  private readonly root: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly search: HTMLInputElement;
  private readonly tabRow: HTMLDivElement;
  private readonly hotbarRow: HTMLDivElement;
  private readonly callbacks: CreativeCallbacks;
  /** Rótulo do toque longo — o único jeito de ler o nome sem mouse. */
  private readonly tooltip = new ItemTooltip();
  private readonly longPressMs: () => number;
  private readonly byTab = new Map<TabId, ItemDef[]>();

  private inventory: Inventory | null = null;
  private tab: TabId = 'blocks';

  constructor(callbacks: CreativeCallbacks) {
    this.callbacks = callbacks;
    this.longPressMs = callbacks.longPressMs ?? ((): number => 300);
    injectStyle();

    for (const item of ITEMS) {
      if (item === undefined) continue;
      const tab = tabOf(item);
      const list = this.byTab.get(tab) ?? [];
      list.push(item);
      this.byTab.set(tab, list);
    }

    this.root = document.createElement('div');
    this.root.id = 'creative-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    const panel = document.createElement('div');
    panel.className = 'panel';

    const title = document.createElement('div');
    title.className = 'title';
    title.textContent = t('creative.title');

    this.search = document.createElement('input');
    this.search.type = 'search';
    this.search.placeholder = t('creative.search');
    this.search.setAttribute('aria-label', t('creative.search_aria'));
    this.search.addEventListener('input', () => this.render());

    this.tabRow = document.createElement('div');
    this.tabRow.className = 'tabs';
    this.tabRow.setAttribute('role', 'tablist');
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.textContent = tab.label;
      button.setAttribute('role', 'tab');
      button.dataset.tab = tab.id;
      button.addEventListener('click', () => {
        this.tab = tab.id;
        this.search.value = '';
        this.render();
      });
      this.tabRow.appendChild(button);
    }

    this.grid = document.createElement('div');
    this.grid.className = 'items';

    const hotbarLabel = document.createElement('div');
    hotbarLabel.className = 'section-title';
    hotbarLabel.textContent = t('creative.hotbar');
    this.hotbarRow = document.createElement('div');
    this.hotbarRow.className = 'hotbar';

    const close = document.createElement('button');
    close.type = 'button';
    close.className = 'close';
    close.textContent = t('common.close');
    close.addEventListener('click', () => this.close());

    /*
     * Atalho para a mochila normal.
     *
     * No criativo o `E` abre esta paleta, e até agora era só isso: os slots de
     * armadura, o offhand e a grade 2×2 ficavam inalcançáveis, então não dava
     * para vestir nada. A paleta escolhe o item; a mochila é quem equipa.
     */
    const backpack = document.createElement('button');
    backpack.type = 'button';
    backpack.className = 'close backpack';
    backpack.textContent = t('creative.backpack');
    backpack.addEventListener('click', () => {
      this.close();
      this.callbacks.onOpenInventory?.();
    });

    const footer = document.createElement('div');
    footer.className = 'footer';
    footer.append(backpack, close);

    panel.append(title, this.search, this.tabRow, this.grid, hotbarLabel, this.hotbarRow, footer);
    this.root.appendChild(panel);
    this.root.appendChild(this.tooltip.element);
    document.body.appendChild(this.root);

    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  open(inventory: Inventory): void {
    this.inventory = inventory;
    this.root.hidden = false;
    this.render();
    /*
     * Foco na busca **só com teclado físico**.
     *
     * No celular, focar um `input` ao abrir a tela sobe o teclado virtual por
     * cima do inventário e ainda encolhe a viewport — o jogador abre a paleta
     * de itens e recebe um teclado que não pediu. No desktop, começar a
     * digitar direto é exatamente o que se espera.
     */
    if (!matchMedia('(pointer: coarse)').matches) this.search.focus();
  }

  close(): void {
    this.tooltip.hide();
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.callbacks.onClose();
  }

  /** Redesenha a aba atual (ou o resultado da busca). */
  render(): void {
    const query = this.search.value.trim().toLowerCase();
    const source = query === ''
      ? this.byTab.get(this.tab) ?? []
      : allMatching(query);

    for (const button of Array.from(this.tabRow.children)) {
      const el = button as HTMLButtonElement;
      el.classList.toggle('active', query === '' && el.dataset.tab === this.tab);
    }

    this.grid.textContent = '';
    for (const item of source.slice(0, 240)) this.grid.appendChild(this.makeSlot(item));
    this.renderHotbar();
  }

  private makeSlot(item: ItemDef): HTMLButtonElement {
    const el = document.createElement('button');
    el.type = 'button';
    el.className = 'slot';
    el.title = item.display;
    el.setAttribute('aria-label', item.display);

    /*
     * Toque longo revela o nome e cancela o `give` daquele toque.
     *
     * Sem isto, no celular tocar um item já o mandava para a hotbar sem nunca
     * dizer o que era: não há hover, e o `title` acima só existe para mouse e
     * leitor de tela. Vem **antes** do `click` de propósito — é a ordem de
     * registro que deixa o guarda do toque longo engolir o clique.
     */
    this.tooltip.bindLongPress(el, () => item.display, this.longPressMs);

    const sprite = this.callbacks.spriteOf?.(item.id) ?? null;
    if (sprite !== null) {
      el.classList.add('sprite');
      el.style.backgroundPosition = sprite;
    } else {
      el.textContent = item.display.slice(0, 2);
      if (this.callbacks.colorOf !== undefined) {
        el.style.background = this.callbacks.colorOf(item.id);
      }
    }

    el.addEventListener('click', () => this.give(item));
    return el;
  }

  /** Põe uma pilha cheia na hotbar — no slot selecionado, ou no primeiro vazio. */
  private give(item: ItemDef): void {
    const inventory = this.inventory;
    if (inventory === null) return;
    const count = maxStackOf(item.id);

    let target = inventory.selected;
    for (let i = HOTBAR_START; i < HOTBAR_END; i++) {
      if (inventory.get(i) === null) { target = i; break; }
    }
    inventory.set(target, { item: item.id, count, damage: 0 });
    this.renderHotbar();
  }

  private renderHotbar(): void {
    const inventory = this.inventory;
    this.hotbarRow.textContent = '';
    if (inventory === null) return;

    for (let i = HOTBAR_START; i < HOTBAR_END; i++) {
      const stack = inventory.get(i);
      const el = document.createElement('button');
      el.type = 'button';
      el.className = 'slot';
      if (i === inventory.selected) el.classList.add('selected');

      if (stack !== null) {
        const def = itemDef(stack.item);
        el.title = def?.display ?? '';
        el.setAttribute('aria-label', `${def?.display ?? '?'} ×${stack.count}`);
        const sprite = this.callbacks.spriteOf?.(stack.item) ?? null;
        if (sprite !== null) {
          el.classList.add('sprite');
          el.style.backgroundPosition = sprite;
        } else {
          el.textContent = (def?.display ?? '?').slice(0, 2);
        }
      } else {
        el.setAttribute('aria-label', tf('hud.slot_empty', i + 1));
      }

      // Clicar na hotbar esvazia o slot: é como se joga fora no criativo.
      el.addEventListener('click', () => {
        inventory.set(i, null);
        this.renderHotbar();
      });
      this.hotbarRow.appendChild(el);
    }
  }
}

function allMatching(query: string): ItemDef[] {
  const out: ItemDef[] = [];
  for (const item of ITEMS) {
    if (item === undefined) continue;
    if (item.display.toLowerCase().includes(query) || item.name.includes(query)) out.push(item);
  }
  return out;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
/* safe center: quando o painel passa da altura da tela, alinhar no topo em
   vez de centralizar — centralizado, o começo dele fica fora de alcance. */
/* Rótulo do toque longo: acima do painel, e nunca roubando o toque. */
#creative-screen .tooltip{position:fixed;left:0;top:0;pointer-events:none;z-index:14;
  max-width:60vw;padding:4px 8px;background:#101014ee;color:#fff;
  border:1px solid #5a5a66;font:13px/1.3 ui-monospace,monospace;white-space:pre-line}
#creative-screen{position:fixed;inset:0;z-index:12;background:#00000080;display:grid;
  place-items:safe center;padding:8px;overflow:auto;overscroll-behavior:contain;
  font:calc(4.5 * var(--px,3px))/1.2 ui-monospace,monospace;color:#fff;image-rendering:pixelated}
#creative-screen .panel{background:#c6c6c6;color:#3f3f3f;padding:calc(4 * var(--px,3px));
  border-top:calc(2 * var(--px,3px)) solid #fff;border-left:calc(2 * var(--px,3px)) solid #fff;
  border-right:calc(2 * var(--px,3px)) solid #555;border-bottom:calc(2 * var(--px,3px)) solid #555;
  max-width:min(96vw,640px);display:flex;flex-direction:column;gap:calc(2 * var(--px,3px))}
#creative-screen .title{font-weight:700}
#creative-screen .section-title{font-size:calc(4 * var(--px,3px))}
#creative-screen input[type=search]{min-height:36px;background:#8b8b8b;color:#fff;
  border:var(--px,3px) solid #373737;padding:4px 6px;
  font:calc(4.5 * var(--px,3px))/1 ui-monospace,monospace}
#creative-screen .tabs{display:flex;flex-wrap:wrap;gap:calc(1 * var(--px,3px))}
#creative-screen .tabs button{min-height:36px;padding:4px 10px;background:#8b8b8b;color:#fff;
  border:2px solid #373737;font:calc(4 * var(--px,3px))/1 ui-monospace,monospace;cursor:pointer}
#creative-screen .tabs button.active{background:#7b94c7}
#creative-screen .tabs button:focus-visible{outline:2px solid #fff}
#creative-screen .items{display:grid;grid-template-columns:repeat(auto-fill,
  minmax(calc(18 * var(--px,3px)),1fr));gap:calc(1 * var(--px,3px));
  max-height:46vh;overflow:auto}
#creative-screen .hotbar{display:flex;gap:calc(1 * var(--px,3px))}
#creative-screen .slot{position:relative;width:calc(18 * var(--px,3px));
  height:calc(18 * var(--px,3px));min-width:32px;min-height:32px;background:#8b8b8b;
  border-top:var(--px,3px) solid #373737;border-left:var(--px,3px) solid #373737;
  border-right:var(--px,3px) solid #fff;border-bottom:var(--px,3px) solid #fff;
  color:#fff;cursor:pointer;padding:0;display:grid;place-items:center;
  font:calc(4.5 * var(--px,3px))/1 ui-monospace,monospace;
  text-shadow:0 0 2px #000,var(--px,3px) var(--px,3px) 0 #000}
#creative-screen .slot.sprite{background-image:var(--item-sheet);
  background-size:var(--item-sheet-size);background-repeat:no-repeat}
#creative-screen .slot.selected{outline:calc(2 * var(--px,3px)) solid #fff;
  outline-offset:calc(-1 * var(--px,3px))}
#creative-screen .slot:hover,#creative-screen .slot:focus-visible{outline:2px solid #7b94c7}
#creative-screen .close{min-height:44px;background:#6e6e6e;color:#fff;border:2px solid #000;
  font:14px/1 ui-monospace,monospace;cursor:pointer}
#creative-screen .close:hover,#creative-screen .close:focus-visible{background:#7b94c7}
#creative-screen .footer{display:flex;gap:8px}
#creative-screen .footer .close{flex:1}
#creative-screen .backpack{background:#4a6b3f}
`;
  document.head.appendChild(css);
}
