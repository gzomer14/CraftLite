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
  OFFHAND, type ClickButton, type Inventory,
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
  private readonly bookToggle: HTMLButtonElement;
  /** Ofertas do aldeão (M9), criadas na primeira tela de troca. */
  private trades: TradePanel | null = null;
  /** Campo do nome e custo da bigorna (M15). */
  private anvilPanel: AnvilPanel | null = null;
  /** Rodapé com o botão de fechar — a única saída sem teclado. */
  private readonly footer: HTMLDivElement;
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
    bookToggle.className = 'book-toggle';
    bookToggle.textContent = t('screen.recipes');
    bookToggle.addEventListener('click', () => {
      this.book?.toggle();
      this.syncBookLayout();
      this.refresh();
    });
    this.bookToggle = bookToggle;

    /*
     * Botão de fechar.
     *
     * O overlay da tela é `z-index:12` e o HUD de toque é `z-index:6`: com uma
     * tela aberta, o botão de inventário e o de pausa ficam **cobertos**. Sem
     * teclado — ou seja, no celular, que é o aparelho alvo — não havia como
     * sair de baú, fornalha, bancada ou mochila. `Esc` e `E` continuam valendo.
     */
    const closeButton = document.createElement('button');
    closeButton.type = 'button';
    closeButton.className = 'close';
    closeButton.textContent = t('common.close');
    closeButton.addEventListener('click', () => this.close());
    this.footer = document.createElement('div');
    this.footer.className = 'footer';
    this.footer.appendChild(closeButton);

    /*
     * Cabeçalho: título à esquerda, "Receitas" à direita.
     *
     * O botão era `float:right` com margem negativa, e em tela estreita ele
     * caía por cima do primeiro slot do inventário. Uma linha flex resolve sem
     * depender de o que vem depois no fluxo.
     */
    const header = document.createElement('div');
    header.className = 'panel-header';
    header.append(this.title, bookToggle);

    /*
     * Corpo em duas faixas: conteúdo à esquerda, livro de receitas à direita.
     *
     * Empilhado, o livro empurrava o painel para além da altura da tela no
     * desktop — a bancada aberta ficava com a lista de receitas cortada em
     * baixo — enquanto sobrava um vazio largo à direita da grade 3×3, que é
     * mais estreita que a fileira de 9 slots da mochila. Em tela larga o livro
     * ocupa exatamente esse vazio (relato de campo 2026-09-12). Em tela
     * estreita o CSS volta a empilhar, que é o certo no celular.
     */
    this.body = document.createElement('div');
    this.body.className = 'panel-body';
    const main = document.createElement('div');
    main.className = 'panel-main';
    main.appendChild(this.grid);
    this.body.appendChild(main);
    if (this.book !== null) this.body.appendChild(this.book.element);

    /*
     * Dica do toque longo, só no ponteiro grosso.
     *
     * O gesto não tem como ser descoberto sozinho: no mouse o botão direito é
     * convenção de trinta anos, no dedo não há convenção nenhuma. Uma linha de
     * texto é mais barata que um jogador que nunca consegue montar uma receita.
     */
    const touchHint = document.createElement('div');
    touchHint.className = 'touch-hint';
    touchHint.textContent = t('screen.touch_hint');
    touchHint.hidden = !coarsePointer();

    this.panel.append(header, this.body, touchHint, this.footer);
    this.root.append(this.panel, this.cursorEl, this.tooltip.element);
    document.body.appendChild(this.root);

    // Clicar fora do painel com o cursor cheio joga no chão (doc 08 §3.5).
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.inventory?.dropCursor();
    });
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
    // O foco vai para o painel para o Tab circular dentro dele.
    this.panel.focus();
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
       * Equipamento: 4 peças de armadura mais a mão secundária (doc 08 §3.5).
       *
       * Os slots existiam no modelo desde o M5 — `canPlaceIn` valida a peça e
       * shift+clique equipa — mas **nenhuma tela os desenhava**, então não havia
       * como vestir armadura à mão em nenhum modo. O slot vazio mostra o nome da
       * peça: sem ícone fantasma, é o que diz ao jogador o que vai ali.
       */
      this.addSection(
        t('screen.equipment'), 5,
        [ARMOR_START, ARMOR_START + 1, ARMOR_START + 2, ARMOR_START + 3, OFFHAND],
        'inv', undefined,
        [t('screen.helmet'), t('screen.chest_armor'), t('screen.legs'), t('screen.boots'), t('screen.offhand')],
      );
      this.addPaperDoll();
      this.addSection(t('screen.crafting_grid'), 2, [CRAFT_START, CRAFT_START + 1, CRAFT_START + 2, CRAFT_START + 3], 'inv');
      this.addResultSlot();
    } else if (this.kind === 'crafting') {
      const indices: number[] = [];
      for (let i = 0; i < 9; i++) indices.push(i);
      this.addSection(t('screen.crafting_grid'), 3, indices, 'cont');
      this.addResultSlot();
    } else if (this.kind === 'furnace') {
      this.addSection(t('screen.furnace'), 1, [0], 'cont', t('screen.input'));
      this.addSection('', 1, [1], 'cont', t('screen.fuel'));
      this.addSection('', 1, [2], 'cont', t('screen.output'));
      this.addFurnaceProgress();
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

    // Inventário do jogador aparece em todas as telas — e é a coluna larga.
    this.column = this.mainColumn;
    const main: number[] = [];
    for (let i = MAIN_START; i < MAIN_END; i++) main.push(i);
    this.addSection(t('touch.inventory'), 9, main, 'inv');

    const hotbar: number[] = [];
    for (let i = HOTBAR_START; i < HOTBAR_END; i++) hotbar.push(i);
    this.addSection('', 9, hotbar, 'inv');
  }

  private addSection(
    label: string, columns: number, indices: readonly number[], source: 'inv' | 'cont',
    hint?: string, placeholders?: readonly string[],
  ): void {
    /*
     * Título e fileira vão juntos num bloco.
     *
     * Não é enfeite: numa tela deitada de celular o painel inteiro em coluna
     * dava 755 px de altura contra 360 de tela. Com as seções em blocos, o CSS
     * as distribui em duas colunas quando a altura é curta — e aí sobra largura,
     * que é o que um celular deitado tem de sobra.
     */
    const section = document.createElement('div');
    section.className = 'section';
    if (label !== '') {
      const heading = document.createElement('div');
      heading.className = 'section-title';
      heading.textContent = label;
      section.appendChild(heading);
    }
    const row = document.createElement('div');
    row.className = 'slots';
    row.style.setProperty('--cols', String(columns));

    for (let i = 0; i < indices.length; i++) {
      row.appendChild(this.makeSlot(source, indices[i], placeholders?.[i]));
    }
    section.appendChild(row);
    /*
     * O rótulo do slot único ("Entrada", "Combustível") vai escrito embaixo.
     * Até 2026-09-24 ele ia para um `data-hint` que nenhum CSS lia: existia no
     * DOM e não aparecia na tela (relato de campo da mesa de encantamento).
     */
    if (hint !== undefined) {
      const caption = document.createElement('div');
      caption.className = 'slot-caption';
      caption.textContent = hint;
      section.appendChild(caption);
    }
    this.column.appendChild(section);
  }

  /**
   * Os slots de uma estação de trabalho numa fileira, cada um com o rótulo
   * embaixo, e sinais entre eles: `Item + Material → Resultado`.
   *
   * O slot vazio não serve de rótulo para si mesmo — com 18 unidades de
   * largura, "Material" não cabe dentro dele num celular. Por isso o nome
   * fica embaixo, legível, e dentro do slot só vale para o leitor de tela.
   */
  private addStation(parts: readonly (readonly [number, string] | string)[]): void {
    const row = document.createElement('div');
    row.className = 'section station';
    for (const part of parts) {
      if (typeof part === 'string') {
        const sign = document.createElement('span');
        sign.className = 'station-sign';
        sign.textContent = part;
        sign.setAttribute('aria-hidden', 'true');
        row.appendChild(sign);
        continue;
      }
      const cell = document.createElement('div');
      cell.className = 'station-cell';
      const caption = document.createElement('div');
      caption.className = 'slot-caption';
      caption.textContent = part[1];
      cell.append(this.makeSlot('cont', part[0], part[1]), caption);
      row.appendChild(cell);
    }
    this.column.appendChild(row);
  }

  /**
   * O boneco do jogador ao lado dos slots de armadura (doc 08 §3.5).
   *
   * Ele não é enfeite: a fileira de slots diz o que está **guardado** ali, e o
   * boneco diz o que está **vestido**. Com quatro peças de materiais parecidos,
   * a diferença entre "tenho o peitoral" e "estou com o peitoral" só aparecia
   * na linha de armadura do HUD, que é um número.
   */
  private addPaperDoll(): void {
    if (this.doll === null) this.doll = new PaperDoll();
    const section = document.createElement('div');
    section.className = 'section doll';
    section.appendChild(this.doll.element);
    this.column.appendChild(section);
  }

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

  private addResultSlot(): void {
    const section = document.createElement('div');
    section.className = 'section';
    const row = document.createElement('div');
    row.className = 'slots result';
    row.style.setProperty('--cols', '1');
    const arrow = document.createElement('span');
    arrow.className = 'arrow';
    arrow.textContent = '→';
    row.append(arrow, this.makeSlot('inv', CRAFT_RESULT));
    section.appendChild(row);
    this.column.appendChild(section);
  }

  private addFurnaceProgress(): void {
    const section = document.createElement('div');
    section.className = 'section';
    const row = document.createElement('div');
    row.className = 'furnace-progress';
    row.innerHTML = '<div class="flame"><i></i></div><div class="arrow-bar"><i></i></div>';
    section.appendChild(row);
    this.column.appendChild(section);
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
    this.panel.classList.toggle('with-book', this.book?.isOpen === true);
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

    if (this.book !== null && this.book.isOpen && this.callbacks.recipes !== undefined) {
      this.book.update(
        this.callbacks.recipes(), this.inventory, this.kind === 'crafting' ? 3 : 2,
      );
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
