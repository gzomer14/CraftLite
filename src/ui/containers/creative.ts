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
 *
 * **M32 (interface nova):** título, busca, Mochila e ✕ numa linha só; abas
 * com ícone; só a grade de itens rola, dentro da própria caixa — a janela
 * cabe inteira num celular deitado. Tocar fora do painel fecha.
 */

import { t, tf } from '../../core/i18n';
import { ITEMS, itemDef, maxStackOf, type ItemDef } from '../../data/items';
import { HOTBAR_END, HOTBAR_START, type Inventory } from '../../game/inventory';
import { ItemTooltip } from './tooltip';
import { closeButton, icon, injectTheme, themedButton } from '../theme';

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

const TABS: readonly { id: TabId; label: string; icon: string }[] = [
  { id: 'blocks', label: t('creative.blocks'), icon: 'cube' },
  { id: 'tools', label: t('creative.tools'), icon: 'pick' },
  { id: 'combat', label: t('creative.combat'), icon: 'sword' },
  { id: 'food', label: t('creative.food'), icon: 'apple' },
  { id: 'materials', label: t('creative.materials'), icon: 'gem' },
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
    injectTheme();
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

    /*
     * Atalho para a mochila normal.
     *
     * No criativo o `E` abre esta paleta, e até agora era só isso: os slots de
     * armadura, o offhand e a grade 2×2 ficavam inalcançáveis, então não dava
     * para vestir nada. A paleta escolhe o item; a mochila é quem equipa.
     */
    const backpack = themedButton(t('creative.backpack'), () => {
      this.close();
      this.callbacks.onOpenInventory?.();
    }, 'secondary', 'bag');
    backpack.classList.add('backpack');

    const head = document.createElement('div');
    head.className = 'head';
    head.append(title, this.search, backpack, closeButton(() => this.close()));

    this.tabRow = document.createElement('div');
    this.tabRow.className = 'tabs';
    this.tabRow.setAttribute('role', 'tablist');
    for (const tab of TABS) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cl-tab';
      const label = document.createElement('span');
      label.textContent = tab.label;
      button.append(icon(tab.icon, 'currentColor', 18), label);
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
    const bottom = document.createElement('div');
    bottom.className = 'bottom';
    bottom.append(hotbarLabel, this.hotbarRow);

    panel.append(head, this.tabRow, this.grid, bottom);
    this.root.appendChild(panel);
    this.root.appendChild(this.tooltip.element);
    document.body.appendChild(this.root);

    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
    // Tocar no escuro em volta fecha (regra 2 do M32).
    this.root.addEventListener('pointerdown', (e) => {
      if ((e as Event).target === this.root) this.close();
    });
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
      el.classList.toggle('on', query === '' && el.dataset.tab === this.tab);
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
/* Rótulo do toque longo: acima do painel, e nunca roubando o toque. */
#creative-screen .tooltip{position:fixed;left:0;top:0;pointer-events:none;z-index:14;
  max-width:60vw;padding:6px 10px;border-radius:8px;background:#0b1220f0;color:#fff;
  box-shadow:0 0 0 2px var(--cl-edge);font:700 13px/1.3 var(--cl-font);white-space:pre-line}
/* M32: a janela não rola; quem rola é a grade, dentro da caixa dela. */
#creative-screen{position:fixed;inset:0;z-index:12;background:var(--cl-dim);display:grid;
  place-items:center;padding:8px;overflow:hidden;overscroll-behavior:contain;touch-action:none;
  font:700 14px/1.2 var(--cl-font);color:var(--cl-ink)}
#creative-screen[hidden]{display:none}
#creative-screen .panel{display:flex;flex-direction:column;gap:8px;width:min(760px,100%);
  height:min(600px,calc(100vh - 16px));height:min(600px,calc(100dvh - 16px));
  box-sizing:border-box;padding:12px;border-radius:20px;background:var(--cl-panel);
  box-shadow:0 0 0 2px var(--cl-edge),0 18px 40px rgba(0,0,0,.5)}
#creative-screen .head{display:flex;align-items:center;gap:10px;flex:none}
#creative-screen .title{font:900 18px/1 var(--cl-font)}
#creative-screen input[type=search]{flex:1;min-width:0;min-height:40px;box-sizing:border-box;border:0;border-radius:12px;
  background:#0d1626;color:#fff;box-shadow:0 0 0 2px var(--cl-edge);padding:0 12px;font:700 15px/1 var(--cl-font)}
#creative-screen .backpack{flex:none;min-height:44px}
#creative-screen .tabs{display:flex;gap:6px;flex:none;overflow:hidden}
#creative-screen .tabs .cl-tab{flex:1 1 0;min-width:0;justify-content:center;padding:0 8px}
#creative-screen .tabs .cl-tab span{overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
#creative-screen .items{flex:1;min-height:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(var(--cslot),1fr));
  grid-auto-rows:var(--cslot);gap:4px;align-content:start;overflow:auto;touch-action:pan-y;padding:6px;border-radius:12px;
  background:var(--cl-slot);--cslot:clamp(36px,10.5vh,52px)}
#creative-screen .bottom{display:flex;align-items:center;gap:10px;flex:none;--cslot:clamp(34px,10vh,48px)}
#creative-screen .section-title{flex:0 1 auto;color:var(--cl-muted);font:700 12px/1.2 var(--cl-font)}
#creative-screen .hotbar{display:flex;gap:4px;margin-left:auto}
#creative-screen .slot{position:relative;width:var(--cslot);height:var(--cslot);min-width:32px;min-height:32px;box-sizing:border-box;
  background-color:#1a2740;border:0;border-radius:6px;box-shadow:inset 0 0 0 2px var(--cl-slot-edge);
  color:#fff;cursor:pointer;padding:0;display:grid;place-items:center;image-rendering:pixelated;
  font:800 13px/1 var(--cl-font);text-shadow:0 1px 2px #000}
#creative-screen .items .slot{width:100%;height:100%}
#creative-screen .slot.sprite{background-image:var(--item-sheet);
  background-size:var(--item-sheet-size);background-repeat:no-repeat}
#creative-screen .slot.selected{box-shadow:inset 0 0 0 3px var(--cl-gold)}
#creative-screen .slot:hover,#creative-screen .slot:focus-visible{outline:none;box-shadow:inset 0 0 0 3px #7fc8ff}
@media (max-height:420px){
  #creative-screen .panel{padding:10px;gap:6px}
  #creative-screen .title{display:none}
}
`;
  document.head.appendChild(css);
}
