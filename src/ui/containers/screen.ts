/**
 * Telas de contêiner: inventário, bancada, fornalha e baú (doc 08 §3.5–§3.9).
 *
 * Um módulo só porque todas compartilham a mesma grade de slots e as mesmas
 * interações — separá-las duplicaria o código que mais importa acertar.
 *
 * O DOM é criado uma vez e reusado; a cada mudança só os slots alterados são
 * reescritos (doc 08 §4.6: nada de layout thrash).
 */

import { t } from '../../core/i18n';
import type { ItemStack } from '../../data/items';
import type { EnchantOffer } from '../../game/enchanting';
import {
  ARMOR_START, CRAFT_RESULT, CRAFT_START, HOTBAR_END, HOTBAR_START, MAIN_END, MAIN_START,
  type ClickButton, type Inventory,
} from '../../game/inventory';
import { ENCHANT_ITEM, ENCHANT_LAPIS, Furnace, type ContainerView } from '../../game/container';
import { RecipeBookPanel } from './recipebook';
import { PaperDoll } from './paperdoll';
import { ItemTooltip } from './tooltip';
import { clickContainer } from './containerclick';
import { injectStyle } from './screenstyle';
import { SlotGestures } from './slotgestures';
import { describeStack, labelFor, makeSlotView, renderSlot, type SlotView } from './slotview';
import { TradePanel } from './tradepanel';
import { AnvilPanel, type AnvilStatus } from './anvilpanel';
import { EnchantPanel, type EnchantResult, type EnchantStatus } from './enchantpanel';
import { BrewPanel } from './brewpanel';
import { BREW_FUEL, BREW_INGREDIENT, BrewingStand } from '../../game/brewing';
import { closeButton, coachOnce, icon } from '../theme';
import {
  buildCraft, buildFurnace, buildLoadout, buildSection, buildStation, type SlotMaker,
} from './screenparts';
import type { TradeOfferView, TradeResult } from '../../game/trading';
import type { RecipeEntry } from '../../game/crafting';

/** Qual tela está aberta. */
export type ScreenKind =
  | 'none' | 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting' | 'trading'
  | 'anvil' | 'brewing';

export type { EnchantResult } from './enchantpanel';

export interface ContainerScreenCallbacks {
  /** Chamado quando a tela fecha, para devolver o pointer lock. */
  onClose: () => void;
  /** Cor média da textura do item, em `#rrggbb` — fundo de quem não tem sprite. */
  colorOf: (item: number) => string;
  /**
   * `background-position` do item na folha de sprites, ou `null` se ele não
   * tem sprite. Ver `render/itemsprites.ts`.
   */
  spriteOf?: (item: number) => string | null;
  /** Receitas conhecidas, para o livro (doc 05 §6.4). */
  recipes?: () => readonly RecipeEntry[];
  /** Preenche a grade com a receita escolhida; false se faltou ingrediente. */
  onPickRecipe?: (entry: RecipeEntry) => boolean;
  /** Ofertas da mesa de encantamento aberta (doc 14 — M6). */
  enchantOffers?: () => readonly EnchantOffer[];
  /** Recalcula as ofertas depois de mexer nos slots da mesa. */
  onEnchantRefresh?: () => void;
  /** Compra a oferta; a mensagem de erro vem do retorno. */
  onBuyEnchant?: (slot: number) => EnchantResult;
  /** Frase, nível, lápis e estantes da mesa aberta, para o painel. */
  enchantStatus?: () => EnchantStatus;
  /**
   * O jogador tirou o item da fornalha: hora de entregar o XP guardado e de
   * contar o item como obtido (conquistas).
   */
  onFurnaceOutput?: (furnace: Furnace, item: number) => void;
  /** Ofertas do aldeão com quem se negocia (M9). */
  tradeOffers?: () => readonly TradeOfferView[];
  /** Faz a troca; a mensagem vem do retorno. */
  onBuyTrade?: (slot: number) => TradeResult;
  /** Título da tela de troca: "Aldeão — Ferreiro". */
  tradeTitle?: () => string;
  /** Duração do toque longo, das opções (doc 08 §6). */
  longPressMs?: () => number;
  /** Vibração curta ao confirmar o toque longo; ausente = sem retorno tátil. */
  vibrate?: () => void;
  // --- bigorna (M15) ---
  /** Recalcula o resultado; `name` só quando o jogador mexeu no campo. */
  onAnvilChange?: (name?: string) => void;
  /** Tira o resultado: cobra e devolve a peça, ou `null` se não pode. */
  onAnvilTake?: () => ItemStack | null;
  /** Frase do próximo passo e nome atual, para o painel. */
  anvilStatus?: () => AnvilStatus;
}

/** true no aparelho de dedo. Falha fechado: sem `matchMedia`, esconde a dica. */
function coarsePointer(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

/** Cores das quatro peças vestidas, reusado a cada `refresh` para não alocar. */
const DOLL_ARMOR: (string | null)[] = [null, null, null, null];

export class ContainerScreen {
  private readonly root: HTMLDivElement;
  private readonly panel: HTMLDivElement;
  /** Faixa que põe o livro ao lado do conteúdo quando a tela é larga. */
  private readonly body: HTMLDivElement;
  private readonly title: HTMLDivElement;
  private readonly grid: HTMLDivElement;
  private readonly cursorEl: HTMLDivElement;
  private readonly tooltip = new ItemTooltip();
  private readonly slots: SlotView[] = [];
  /**
   * Boneco do jogador, criado só quando a tela de inventário é montada e
   * mantido daí em diante — recriar o canvas a cada abertura regeraria a skin.
   */
  private doll: PaperDoll | null = null;
  private readonly book: RecipeBookPanel | null;
  /** Aba "Receitas" do cabeçalho (M32): abre o livro em coluna, com o número do que dá. */
  private readonly bookToggle: HTMLButtonElement;
  private readonly bookBadge: HTMLSpanElement;
  /** Coluna do livro: só dá largura, a altura é a da mochila (o livro rola dentro). */
  private readonly bookSlot: HTMLDivElement;
  /** Balão de dica do toque, que aparece uma vez (regra 6 do M32). */
  private coach: HTMLElement | null = null;
  /** Ofertas do aldeão (M9), criadas na primeira tela de troca. */
  private trades: TradePanel | null = null;
  /** Campo do nome e custo da bigorna (M15). */
  private anvilPanel: AnvilPanel | null = null;
  /** Colunas do painel; `column` é onde `addSection` escreve agora. */
  private sideColumn!: HTMLDivElement;
  private mainColumn!: HTMLDivElement;
  private column!: HTMLDivElement;
  /** Ofertas e frase da mesa de encantamento, criadas na primeira abertura. */
  private enchantPanel: EnchantPanel | null = null;
  /** Barra e frase do suporte de preparo (M16). */
  private brewPanel: BrewPanel | null = null;

  private inventory: Inventory | null = null;
  private container: ContainerView | null = null;
  private kind: ScreenKind = 'none';
  private readonly callbacks: ContainerScreenCallbacks;

  /** Toque, arraste e duplo clique nos slots (`slotgestures.ts`). */
  private readonly gestures: SlotGestures;

  constructor(callbacks: ContainerScreenCallbacks) {
    this.callbacks = callbacks;
    injectStyle();
    this.gestures = new SlotGestures({
      inventory: () => this.inventory,
      click: (view, button, shift) => this.handleClick(view, button, { shift }),
      isOutputSlot: (view) => this.isOutputSlot(view),
      describe: (view) => this.describeSlot(view),
      refresh: () => this.refresh(),
      tooltip: this.tooltip,
      ...(callbacks.longPressMs !== undefined ? { longPressMs: callbacks.longPressMs } : {}),
      ...(callbacks.vibrate !== undefined ? { vibrate: callbacks.vibrate } : {}),
    });

    this.root = document.createElement('div');
    this.root.id = 'container-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    this.panel = document.createElement('div');
    this.panel.className = 'panel';

    this.title = document.createElement('div');
    this.title.className = 'title';

    this.grid = document.createElement('div');
    this.grid.className = 'grid';

    this.cursorEl = document.createElement('div');
    this.cursorEl.className = 'cursor';
    this.cursorEl.hidden = true;


    // Livro de receitas: só existe se quem abriu a tela souber listar receitas.
    this.book = callbacks.recipes === undefined || callbacks.onPickRecipe === undefined
      ? null
      : new RecipeBookPanel({
        /*
         * O `refresh()` aqui não é enfeite.
         *
         * `autoFillRecipe` enche a grade escrevendo direto em
         * `inventory.slots` e `refreshCraftResult` idem, sem passar por
         * `changed()` — então `inventory.onChange` não dispara e a tela nunca
         * redesenhava. A grade ficava cheia no modelo e vazia na tela, o que
         * de fora é indistinguível de "clicar na receita não faz nada"
         * (relato de campo 2026-09-12).
         */
        onPick: (entry) => {
          const filled = callbacks.onPickRecipe?.(entry) ?? false;
          if (filled) this.refresh();
          return filled;
        },
        onHint: (text, x, y, flash) => {
          if (text === null) this.tooltip.hide();
          else if (flash) this.tooltip.flash(text, x, y);
          else this.tooltip.show(text, x, y);
        },
        ...(callbacks.spriteOf !== undefined ? { spriteOf: callbacks.spriteOf } : {}),
      });

    const bookToggle = document.createElement('button');
    bookToggle.type = 'button';
    bookToggle.className = 'cl-tab book-toggle';
    const bookLabel = document.createElement('span');
    bookLabel.textContent = t('screen.recipes');
    this.bookBadge = document.createElement('span');
    this.bookBadge.className = 'badge';
    bookToggle.append(icon('book'), bookLabel, this.bookBadge);
    bookToggle.addEventListener('click', () => {
      this.book?.toggle();
      this.syncBookLayout();
      this.refresh();
      this.fit();
    });
    this.bookToggle = bookToggle;

    /*
     * Cabeçalho (M32): título, a aba "Receitas" e o ✕ no canto.
     *
     * O botão "Fechar" grande do rodapé saiu (regra 2): fecha-se no ✕, tocando
     * fora do painel, no mesmo botão que abriu (`E`, a mochila do HUD) ou no
     * `Esc`. O ✕ continua sendo a saída garantida sem teclado — o overlay
     * cobre o HUD de toque, e era por isso que o rodapé existia.
     */
    const header = document.createElement('div');
    header.className = 'panel-header';
    const tabs = document.createElement('div');
    tabs.className = 'tabs';
    tabs.appendChild(bookToggle);
    const spacer = document.createElement('div');
    spacer.className = 'spacer';
    header.append(this.title, tabs, spacer, closeButton(() => this.close()));

    this.body = document.createElement('div');
    this.body.className = 'panel-body';
    const main = document.createElement('div');
    main.className = 'panel-main';
    main.appendChild(this.grid);
    this.bookSlot = document.createElement('div');
    this.bookSlot.className = 'book-slot';
    this.bookSlot.hidden = true;
    if (this.book !== null) this.bookSlot.appendChild(this.book.element);
    this.body.append(this.bookSlot, main);

    this.panel.append(header, this.body);
    this.root.append(this.panel, this.cursorEl, this.tooltip.element);
    document.body.appendChild(this.root);

    /*
     * Tocar fora do painel: com item no cursor, joga no chão (doc 08 §3.5);
     * de mão vazia, fecha (M32, regra 2).
     */
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target !== this.root) return;
      if (this.inventory?.cursor !== null && this.inventory?.cursor !== undefined) {
        this.inventory.dropCursor();
        this.refresh();
      } else {
        this.close();
      }
    });
    window.addEventListener('resize', () => { if (this.kind !== 'none') this.fit(); });
    this.root.addEventListener('pointermove', (e) => this.moveCursor(e.clientX, e.clientY));
    window.addEventListener('pointerup', () => this.gestures.endDrag());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return this.kind !== 'none';
  }

  get openKind(): ScreenKind {
    return this.kind;
  }

  /**
   * Redesenha a tela que muda sozinha: fornalha e suporte de preparo, cujo
   * conteúdo anda no tick do mundo. Até 2026-09-24 nada chamava isto — a
   * barra da fornalha ficava parada e a saída pronta só aparecia no próximo
   * toque (M4). O `main.ts` chama a cada poucos ticks com a tela aberta.
   */
  tickLive(): void {
    if (this.kind === 'furnace' || this.kind === 'brewing') this.refresh();
  }

  /** Abre uma tela. `container` só é usado por fornalha, baú e bancada. */
  open(kind: ScreenKind, inventory: Inventory, container: ContainerView | null = null): void {
    if (kind === 'none') { this.close(); return; }
    this.kind = kind;
    this.inventory = inventory;
    this.container = container;
    // O livro só faz sentido onde existe grade de criação.
    const craftable = kind === 'inventory' || kind === 'crafting';
    this.bookToggle.hidden = this.book === null || !craftable;
    if (!craftable) this.book?.hide();
    this.syncBookLayout();
    this.build();
    this.root.hidden = false;
    this.refresh();
    this.fit();
    // O gesto de dividir pilha não se descobre sozinho no dedo: um balão, uma vez.
    if (this.coach === null && coarsePointer()) {
      this.coach = coachOnce('slots', t('screen.touch_hint'), this.panel, () => this.fit());
      this.coach?.classList.add('inline');
      this.fit();
    }
    // O foco vai para o painel para o Tab circular dentro dele.
    this.panel.focus();
  }

  /**
   * Escala que faz o painel caber na janela (M32, regra 1: nada rola).
   *
   * Parte da escala da interface (`--gui-scale`) e encolhe o `--px` local até
   * o painel caber, com uma folga. São no máximo quatro medições, e só ao
   * abrir, ao abrir o livro e ao girar a tela — nunca por quadro.
   */
  private fit(): void {
    const root = this.root;
    if (typeof getComputedStyle !== 'function' || document.documentElement === undefined) return;
    const scale = Number.parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--gui-scale')) || 2;
    let px = Math.max(2, scale);
    const availW = window.innerWidth - 16;
    const availH = window.innerHeight - 16;
    for (let i = 0; i < 4; i++) {
      root.style.setProperty('--px', `${px.toFixed(2)}px`);
      const ratio = Math.min(availW / this.panel.offsetWidth, availH / this.panel.offsetHeight);
      if (!(ratio < 1)) break;
      px = Math.max(1.1, px * ratio * 0.99);
    }
  }

  close(): void {
    if (this.kind === 'none') return;
    // Guarda o que estiver no cursor na mochila; só o que não cabe vai ao chão.
    this.inventory?.stowCursor();
    this.kind = 'none';
    this.container = null;
    this.root.hidden = true;
    this.tooltip.hide();
    this.callbacks.onClose();
  }

  /** Reconstrói a grade de slots para a tela atual. */
  private build(): void {
    this.grid.textContent = '';
    this.slots.length = 0;

    /*
     * Duas colunas explícitas no DOM, não multi-coluna do CSS.
     *
     * O multi-coluna do CSS divide a largura em partes **iguais**, e a fileira
     * de 9 slots da mochila é mais larga que metade do painel: ela transbordava
     * para fora da borda do painel. Com dois contêineres, cada um toma a largura que
     * precisa, e o `flex-wrap` decide sozinho se cabem lado a lado (mochila,
     * onde a esquerda é estreita) ou se empilham (baú, onde as duas são largas).
     */
    this.sideColumn = document.createElement('div');
    this.sideColumn.className = 'grid-col';
    this.mainColumn = document.createElement('div');
    this.mainColumn.className = 'grid-col';
    this.grid.append(this.sideColumn, this.mainColumn);
    // Mochila (M32): armadura e criação lado a lado, não empilhadas.
    this.sideColumn.classList.toggle('side-row', this.kind === 'inventory');
    this.column = this.sideColumn;

    const titles: Record<ScreenKind, string> = {
      none: '', inventory: t('touch.inventory'), crafting: t('screen.crafting'),
      furnace: t('screen.furnace'), chest: t('screen.chest'), enchanting: t('screen.enchanting'),
      anvil: t('screen.anvil'), brewing: t('screen.brewing'),
      trading: this.callbacks.tradeTitle?.() ?? t('trade.villager'),
    };
    this.title.textContent = titles[this.kind];

    if (this.kind === 'inventory') {
      /*
       * Equipamento: 4 peças de armadura mais a mão secundária (doc 08 §3.5),
       * agora em coluna ao lado do boneco (M32), com o contorno da peça na
       * casa vazia — o nome escrito dentro não cabia nem se lia no celular.
       */
      this.addLoadout();
      this.addCraft(2, [CRAFT_START, CRAFT_START + 1, CRAFT_START + 2, CRAFT_START + 3], 'inv');
    } else if (this.kind === 'crafting') {
      const indices: number[] = [];
      for (let i = 0; i < 9; i++) indices.push(i);
      this.addCraft(3, indices, 'cont');
    } else if (this.kind === 'furnace') {
      this.addFurnace();
    } else if (this.kind === 'enchanting') {
      this.addStation([[ENCHANT_ITEM, t('screen.slot_item')], [ENCHANT_LAPIS, t('screen.slot_lapis')]]);
      this.enchantPanel ??= new EnchantPanel({
        offers: () => this.callbacks.enchantOffers?.() ?? [],
        status: () => this.callbacks.enchantStatus?.()
          ?? { help: '', level: 0, lapis: 0, shelves: 0, creative: false },
        buy: (slot) => {
          const result = this.callbacks.onBuyEnchant?.(slot) ?? 'no-offer';
          this.refresh();
          return result;
        },
      });
      this.enchantPanel.reset();
      this.column.appendChild(this.enchantPanel.element);
    } else if (this.kind === 'trading') {
      this.trades ??= new TradePanel({
        offers: () => this.callbacks.tradeOffers?.() ?? [],
        buy: (slot) => {
          const result = this.callbacks.onBuyTrade?.(slot) ?? 'closed';
          this.refresh();
          return result;
        },
        spriteOf: this.callbacks.spriteOf,
        colorOf: this.callbacks.colorOf,
      });
      this.trades.reset();
      this.column.appendChild(this.trades.element);
    } else if (this.kind === 'anvil') {
      this.addStation([
        [0, t('screen.slot_item')], '+', [1, t('screen.slot_material')], '→', [2, t('screen.slot_result')],
      ]);
      this.anvilPanel ??= new AnvilPanel({
        onName: (name) => { this.callbacks.onAnvilChange?.(name); this.refresh(); },
      });
      this.anvilPanel.reset();
      this.column.appendChild(this.anvilPanel.element);
    } else if (this.kind === 'brewing') {
      this.addStation([[BREW_INGREDIENT, t('screen.slot_ingredient')], [BREW_FUEL, t('screen.fuel')]]);
      this.brewPanel ??= new BrewPanel();
      this.column.appendChild(this.brewPanel.element);
      const bottle = t('screen.slot_bottle');
      this.addStation([[0, bottle], [1, bottle], [2, bottle]]);
    } else if (this.kind === 'chest') {
      // Baú, e desde o M15 também funil, dispensador e liberador: a mesma
      // grade, com a largura e o título do contêiner.
      const size = this.container?.size ?? 27;
      const indices: number[] = [];
      for (let i = 0; i < size; i++) indices.push(i);
      const kind = this.container?.kind;
      const title = kind === 'hopper' ? t('screen.hopper') : kind === 'dispenser' ? t('screen.dispenser')
        : kind === 'dropper' ? t('screen.dropper') : size > 27 ? t('screen.double_chest') : t('screen.chest');
      const columns = kind === 'hopper' ? 5 : kind === 'dispenser' || kind === 'dropper' ? 3 : 9;
      this.addSection(title, columns, indices, 'cont');
    }

    /*
     * A mochila aparece em todas as telas — e é a coluna da direita. Só ganha
     * título onde há outra grade para confundir com ela (baú, funil); na
     * própria mochila o cabeçalho já diz o que é.
     */
    this.column = this.mainColumn;
    const main: number[] = [];
    for (let i = MAIN_START; i < MAIN_END; i++) main.push(i);
    this.addSection(this.kind === 'chest' ? t('touch.inventory') : '', 9, main, 'inv');

    const hotbar: number[] = [];
    for (let i = HOTBAR_START; i < HOTBAR_END; i++) hotbar.push(i);
    this.addSection('', 9, hotbar, 'inv').classList.add('hotbar');
  }

  /** Monta um bloco de `screenparts.ts` na coluna atual. */
  private add<T extends HTMLElement>(part: T): T {
    this.column.appendChild(part);
    return part;
  }

  private addLoadout(): void {
    if (this.doll === null) this.doll = new PaperDoll();
    this.add(buildLoadout(this.make, this.doll.element));
  }

  private addCraft(columns: number, indices: readonly number[], source: 'inv' | 'cont'): void {
    this.add(buildCraft(this.make, columns, indices, source));
  }

  private addFurnace(): void {
    this.add(buildFurnace(this.make));
  }

  private addSection(
    label: string, columns: number, indices: readonly number[], source: 'inv' | 'cont',
    hint?: string, placeholders?: readonly string[],
  ): HTMLDivElement {
    return this.add(buildSection(this.make, label, columns, indices, source, hint, placeholders));
  }

  private addStation(parts: readonly (readonly [number, string] | string)[]): void {
    this.add(buildStation(this.make, parts));
  }

  /** `makeSlot` como função solta, para os montadores de `screenparts.ts`. */
  private readonly make: SlotMaker = (source, index, placeholder) => this.makeSlot(source, index, placeholder);

  /** Redesenha o boneco com as peças vestidas agora. */
  private refreshPaperDoll(): void {
    const doll = this.doll;
    const inventory = this.inventory;
    if (doll === null || inventory === null || this.kind !== 'inventory') return;
    for (let i = 0; i < 4; i++) {
      const stack = inventory.get(ARMOR_START + i);
      DOLL_ARMOR[i] = stack === null ? null : (this.callbacks.colorOf?.(stack.item) ?? null);
    }
    doll.draw(DOLL_ARMOR);
  }

  /** Um slot novo na tela atual, com os gestos ligados. */
  private makeSlot(source: 'inv' | 'cont', index: number, placeholder?: string): HTMLDivElement {
    const view = makeSlotView(source, index, placeholder);
    this.slots.push(view);
    this.gestures.attach(view);
    return view.el;
  }

  /**
   * Slot que só entrega item e nunca recebe: resultado do craft e saída da
   * fornalha. Tocar neles em série é a forma normal de jogar, não um gesto.
   */
  private isOutputSlot(view: SlotView): boolean {
    if (view.source === 'inv') return view.index === CRAFT_RESULT;
    return (this.kind === 'furnace' || this.kind === 'anvil') && view.index === 2;
  }

  /** Nome, encantamentos e durabilidade do slot, ou `null` se estiver vazio. */
  private describeSlot(view: SlotView): string | null {
    return describeStack(view.source === 'inv'
      ? this.inventory?.get(view.index) ?? null
      : this.container?.get(view.index) ?? null);
  }

  /**
   * Avisa o CSS que o livro está aberto. A largura do painel só cresce quando
   * ele aparece — fechado, a tela continua do tamanho de antes.
   */
  private syncBookLayout(): void {
    const open = this.book?.isOpen === true;
    this.bookSlot.hidden = !open;
    this.bookToggle.classList.toggle('on', open);
  }

  private handleClick(
    view: SlotView, button: ClickButton, options: { shift: boolean },
  ): void {
    const inventory = this.inventory;
    if (inventory === null) return;

    if (view.source === 'inv') {
      inventory.click(view.index, button, { shift: options.shift });
    } else {
      clickContainer(
        inventory, this.container, this.kind, view.index, button, options.shift,
        this.callbacks.onFurnaceOutput, this.callbacks.onAnvilTake,
      );
    }
    this.refresh();
  }

  /** Redesenha o que mudou. */
  refresh(): void {
    if (this.kind === 'none' || this.inventory === null) return;
    // A bigorna recalcula o resultado antes de os slots serem desenhados (M15).
    if (this.kind === 'anvil') this.callbacks.onAnvilChange?.();

    for (const view of this.slots) {
      const stack = view.source === 'inv'
        ? this.inventory.get(view.index)
        : (this.container?.get(view.index) ?? null);
      renderSlot(view, stack, this.callbacks.spriteOf, this.callbacks.colorOf);
    }

    if (this.book !== null && this.callbacks.recipes !== undefined && !this.bookToggle.hidden) {
      const recipes = this.callbacks.recipes();
      const gridSize = this.kind === 'crafting' ? 3 : 2;
      if (this.book.isOpen) this.book.update(recipes, this.inventory, gridSize);
      const can = this.book.craftableCount(recipes, this.inventory, gridSize);
      this.bookBadge.textContent = String(can);
      this.bookBadge.hidden = can === 0;
    }

    this.refreshPaperDoll();

    const cursor = this.inventory.cursor;
    this.cursorEl.hidden = cursor === null;
    if (cursor !== null) {
      const sprite = this.callbacks.spriteOf?.(cursor.item) ?? null;
      this.cursorEl.classList.toggle('sprite', sprite !== null);
      if (sprite !== null) {
        this.cursorEl.style.backgroundPosition = sprite;
        this.cursorEl.textContent = cursor.count > 1 ? String(cursor.count) : '';
      } else {
        this.cursorEl.style.removeProperty('background-position');
        this.cursorEl.textContent = labelFor(cursor);
      }
    }

    if (this.kind === 'furnace') this.refreshFurnace();
    if (this.kind === 'brewing' && this.container instanceof BrewingStand) {
      this.brewPanel?.refresh(this.container);
    }
    if (this.kind === 'enchanting') {
      // As ofertas dependem do item no slot: três hashes por redesenho.
      this.callbacks.onEnchantRefresh?.();
      this.enchantPanel?.refresh();
    }
    if (this.kind === 'trading') this.trades?.refresh();
    if (this.kind === 'anvil') {
      const status = this.callbacks.anvilStatus?.();
      if (status !== undefined) this.anvilPanel?.refresh(status);
    }
  }

  private refreshFurnace(): void {
    const furnace = this.container as Furnace | null;
    if (furnace === null) return;
    const flame = this.grid.querySelector<HTMLElement>('.flame i');
    const arrow = this.grid.querySelector<HTMLElement>('.arrow-bar i');
    if (flame !== null) flame.style.transform = `scaleY(${furnace.fuelProgress.toFixed(3)})`;
    if (arrow !== null) arrow.style.transform = `scaleX(${furnace.cookProgress.toFixed(3)})`;
  }

  private moveCursor(x: number, y: number): void {
    this.cursorEl.style.transform = `translate(${x + 8}px, ${y + 8}px)`;
    this.tooltip.position(x, y);
  }
}
