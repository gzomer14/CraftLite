/**
 * Telas de contêiner: inventário, bancada, fornalha e baú (doc 08 §3.5–§3.9).
 *
 * Um módulo só porque todas compartilham a mesma grade de slots e as mesmas
 * interações — separá-las duplicaria o código que mais importa acertar.
 *
 * O DOM é criado uma vez e reusado; a cada mudança só os slots alterados são
 * reescritos (doc 08 §4.6: nada de layout thrash).
 */

import { itemDef, type ItemStack } from '../../data/items';
import { describeEnchants, type EnchantOffer } from '../../game/enchanting';
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
import { TradePanel } from './tradepanel';
import { AnvilPanel, type AnvilStatus } from './anvilpanel';
import { EnchantPanel, type EnchantResult, type EnchantStatus } from './enchantpanel';
import type { TradeOfferView, TradeResult } from '../../game/trading';
import type { RecipeEntry } from '../../game/crafting';

/** Qual tela está aberta. */
export type ScreenKind =
  | 'none' | 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting' | 'trading'
  | 'anvil';

export type { EnchantResult } from './enchantpanel';

/** Um slot desenhado: de onde vem o item e para onde vai o clique. */
interface SlotView {
  el: HTMLDivElement;
  label: HTMLSpanElement;
  bar: HTMLDivElement;
  /** `'inv'` = inventário do jogador, `'cont'` = contêiner aberto. */
  source: 'inv' | 'cont';
  index: number;
  /** Última chave desenhada, para pular redesenho. */
  rendered: string;
  /** Texto mostrado quando o slot está vazio — o que vai ali (armadura). */
  placeholder?: string;
}

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

/**
 * Quanto o dedo pode escorregar antes de o toque virar rolagem, em pixels de
 * tela. Abaixo disso é tremor de mão, não intenção.
 */
const TOUCH_SLOP = 12;

/**
 * true quando o evento veio de um mouse de verdade.
 *
 * `pointerType` ausente ou vazio conta como mouse, que é a mesma regra de
 * `isMouseClick` em `input/controls.ts`: evento sintetizado — por teclado, por
 * navegador antigo ou por teste — não deve cair no caminho de toque, onde a
 * ação espera um `pointerup` que talvez nunca venha.
 */
/** true no aparelho de dedo. Falha fechado: sem `matchMedia`, esconde a dica. */
function coarsePointer(): boolean {
  try {
    return matchMedia('(pointer: coarse)').matches;
  } catch {
    return false;
  }
}

function isMousePointer(e: PointerEvent): boolean {
  const type = e.pointerType;
  return type === undefined || type === '' || type === 'mouse';
}
/** Toque longo quando as opções não informam o valor escolhido pelo jogador. */
const DEFAULT_LONG_PRESS_MS = 300;

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
  /**
   * Toque em curso num slot: de onde partiu, se o toque longo já resolveu, e o
   * relógio dele. `null` quando não há dedo na tela.
   */
  private touchPress: {
    index: number; x: number; y: number; consumed: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
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

  private inventory: Inventory | null = null;
  private container: ContainerView | null = null;
  private kind: ScreenKind = 'none';
  private readonly callbacks: ContainerScreenCallbacks;

  /** Slots tocados durante um arraste de distribuição. */
  private dragging: 'left' | 'right' | null = null;
  private readonly dragSlots: number[] = [];
  private lastClickAt = 0;
  private lastClickIndex = -1;

  constructor(callbacks: ContainerScreenCallbacks) {
    this.callbacks = callbacks;
    injectStyle();

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
    bookToggle.textContent = 'Receitas';
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
    closeButton.textContent = 'Fechar';
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
    touchHint.textContent = 'Toque longo num slot: pega metade · solta 1 de cada vez';
    touchHint.hidden = !coarsePointer();

    this.panel.append(header, this.body, touchHint, this.footer);
    this.root.append(this.panel, this.cursorEl, this.tooltip.element);
    document.body.appendChild(this.root);

    // Clicar fora do painel com o cursor cheio joga no chão (doc 08 §3.5).
    this.root.addEventListener('pointerdown', (e) => {
      if (e.target === this.root) this.inventory?.dropCursor();
    });
    this.root.addEventListener('pointermove', (e) => this.moveCursor(e.clientX, e.clientY));
    window.addEventListener('pointerup', () => this.endDrag());
    this.root.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  get isOpen(): boolean {
    return this.kind !== 'none';
  }

  get openKind(): ScreenKind {
    return this.kind;
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
    // Devolve o que estiver no cursor, senão o item some.
    this.inventory?.dropCursor();
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
      none: '', inventory: 'Inventário', crafting: 'Bancada',
      furnace: 'Fornalha', chest: 'Baú', enchanting: 'Mesa de Encantamento', anvil: 'Bigorna',
      trading: this.callbacks.tradeTitle?.() ?? 'Aldeão',
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
        'Equipamento', 5,
        [ARMOR_START, ARMOR_START + 1, ARMOR_START + 2, ARMOR_START + 3, OFFHAND],
        'inv', undefined,
        ['Elmo', 'Peito', 'Calça', 'Bota', 'Mão'],
      );
      this.addPaperDoll();
      this.addSection('Criação', 2, [CRAFT_START, CRAFT_START + 1, CRAFT_START + 2, CRAFT_START + 3], 'inv');
      this.addResultSlot();
    } else if (this.kind === 'crafting') {
      const indices: number[] = [];
      for (let i = 0; i < 9; i++) indices.push(i);
      this.addSection('Criação', 3, indices, 'cont');
      this.addResultSlot();
    } else if (this.kind === 'furnace') {
      this.addSection('Fornalha', 1, [0], 'cont', 'Entrada');
      this.addSection('', 1, [1], 'cont', 'Combustível');
      this.addSection('', 1, [2], 'cont', 'Saída');
      this.addFurnaceProgress();
    } else if (this.kind === 'enchanting') {
      this.addStation([[ENCHANT_ITEM, 'Item'], [ENCHANT_LAPIS, 'Lápis']]);
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
      this.addStation([[0, 'Item'], '+', [1, 'Material'], '→', [2, 'Resultado']]);
      this.anvilPanel ??= new AnvilPanel({
        onName: (name) => { this.callbacks.onAnvilChange?.(name); this.refresh(); },
      });
      this.anvilPanel.reset();
      this.column.appendChild(this.anvilPanel.element);
    } else if (this.kind === 'chest') {
      // Baú, e desde o M15 também funil, dispensador e liberador: a mesma
      // grade, com a largura e o título do contêiner.
      const size = this.container?.size ?? 27;
      const indices: number[] = [];
      for (let i = 0; i < size; i++) indices.push(i);
      const kind = this.container?.kind;
      const title = kind === 'hopper' ? 'Funil' : kind === 'dispenser' ? 'Dispensador'
        : kind === 'dropper' ? 'Liberador' : size > 27 ? 'Baú Duplo' : 'Baú';
      const columns = kind === 'hopper' ? 5 : kind === 'dispenser' || kind === 'dropper' ? 3 : 9;
      this.addSection(title, columns, indices, 'cont');
    }

    // Inventário do jogador aparece em todas as telas — e é a coluna larga.
    this.column = this.mainColumn;
    const main: number[] = [];
    for (let i = MAIN_START; i < MAIN_END; i++) main.push(i);
    this.addSection('Inventário', 9, main, 'inv');

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

  private makeSlot(source: 'inv' | 'cont', index: number, placeholder?: string): HTMLDivElement {
    const el = document.createElement('div');
    el.className = 'slot';
    // Identifica o slot no DOM: serve para depurar a tela no aparelho e é como
    // os testes acham o slot de resultado sem depender da ordem de montagem.
    el.dataset.slot = `${source}:${index}`;
    el.setAttribute('role', 'button');
    el.tabIndex = 0;
    // Rótulo inicial: `renderSlot` sai cedo quando a chave não mudou, e para um
    // slot que nasce vazio a chave inicial já é a final — sem isto o leitor de
    // tela encontraria um botão sem nome.
    el.setAttribute('aria-label', placeholder ?? 'Vazio');

    const label = document.createElement('span');
    if (placeholder !== undefined) {
      el.classList.add('ghost');
      label.textContent = placeholder;
    }
    const bar = document.createElement('div');
    bar.className = 'durability';
    // Nasce escondida: `renderSlot` sai cedo quando a chave não mudou, e para
    // um slot vazio a chave inicial já é a final — a barra nunca seria ocultada.
    bar.hidden = true;
    el.append(label, bar);

    const view: SlotView = {
      el, label, bar, source, index, rendered: '',
      ...(placeholder !== undefined ? { placeholder } : {}),
    };
    this.slots.push(view);

    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isMousePointer(e)) {
        // No mouse a ação resolve já: é disso que depende o arraste de
        // distribuição entre slots, que só existe com ponteiro fino.
        this.resolveSlot(view, e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
          e.shiftKey);
        return;
      }

      /*
       * No toque a ação resolve **ao soltar**, e não ao encostar.
       *
       * É o que abre espaço para o toque longo valer como botão direito —
       * pegar metade da pilha e soltar uma unidade de cada vez (doc 08 §3.5).
       * Sem ele, no celular **todo** toque movia a pilha inteira, e montar uma
       * receita que pede uma tábua em cada célula era impossível: o jogador
       * colocava as 24 de uma vez (relato de campo 2026-09-14).
       *
       * O arraste de distribuição não é perdido nessa troca porque ele **nunca
       * funcionou no toque**: o ponteiro de toque recebe captura implícita no
       * elemento do `pointerdown`, então `pointerenter` não dispara nos outros
       * slots. Ele era, e continua, um gesto de mouse.
       */
      const text = this.describeSlot(view);
      if (text !== null) this.tooltip.flash(text, e.clientX, e.clientY);
      this.armTouch(view, e);
    });
    el.addEventListener('pointerup', (e) => {
      if (isMousePointer(e)) return;
      if (this.touchPress === null || this.touchPress.index !== view.index) return;
      const consumed = this.touchPress.consumed;
      this.cancelTouch();
      // O toque longo já resolveu; soltar depois dele não pode agir de novo.
      if (!consumed) this.resolveSlot(view, 'left', false);
    });
    el.addEventListener('pointermove', (e) => {
      if (isMousePointer(e) || this.touchPress === null) return;
      // Escorregar o dedo é rolagem, não escolha: cancela o toque longo e a
      // ação curta junto.
      const dx = e.clientX - this.touchPress.x;
      const dy = e.clientY - this.touchPress.y;
      if (dx * dx + dy * dy > TOUCH_SLOP * TOUCH_SLOP) this.cancelTouch();
    });
    el.addEventListener('pointercancel', () => this.cancelTouch());
    el.addEventListener('pointerenter', (e) => {
      if (this.dragging !== null) this.dragSlots.push(view.index);
      // Só o mouse tem "estar em cima"; no toque quem mostra é o `pointerdown`.
      if (e.pointerType !== 'mouse') return;
      const text = this.describeSlot(view);
      if (text === null) this.tooltip.hide();
      else this.tooltip.show(text, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.tooltip.hide();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.handleClick(view, 'left', { shift: e.shiftKey });
    });

    return el;
  }

  /**
   * Arma o toque: o relógio do toque longo começa aqui, e a ação curta espera
   * o dedo sair.
   */
  private armTouch(view: SlotView, e: PointerEvent): void {
    this.cancelTouch();
    // `setTimeout` global e não `window.setTimeout`: a tela é montada em
    // ambiente sem `window` nos testes, e o relógio é o mesmo.
    const press = {
      index: view.index, x: e.clientX, y: e.clientY, consumed: false,
      timer: null as unknown as ReturnType<typeof setTimeout>,
    };
    press.timer = setTimeout(() => {
      press.consumed = true;
      // Toque longo = botão direito: pega metade, ou solta uma unidade.
      this.resolveSlot(view, 'right', false);
      this.callbacks.vibrate?.();
    }, this.callbacks.longPressMs?.() ?? DEFAULT_LONG_PRESS_MS);
    this.touchPress = press;
  }

  private cancelTouch(): void {
    if (this.touchPress === null) return;
    clearTimeout(this.touchPress.timer);
    this.touchPress = null;
  }

  private resolveSlot(view: SlotView, button: ClickButton, shift: boolean): void {
    /*
     * Duplo clique junta os stacks iguais (doc 08 §3.5) — menos nos slots que
     * só produzem saída.
     *
     * Craftar em série é tocar repetidamente no mesmo slot de resultado, e dois
     * toques dentro de 350 ms caem exatamente na janela do duplo clique. O
     * `doubleClick` então varria o inventário inteiro para o cursor: quem tinha
     * acabado de guardar 64 tábuas via as 64 voltarem para a mão sozinhas
     * (relato de campo 2026-09-12, "fica pegando os 64 no lugar como se eu
     * ainda tivesse ele selecionado"). Em slot de saída o gesto não existe.
     */
    const now = performance.now();
    if (button === 'left' && !this.isOutputSlot(view)
      && view.index === this.lastClickIndex && now - this.lastClickAt < 350) {
      this.inventory?.doubleClick();
      this.lastClickIndex = -1;
      this.refresh();
      return;
    }
    this.lastClickAt = now;
    this.lastClickIndex = view.index;

    // Cursor cheio inicia um arraste de distribuição.
    if ((button === 'left' || button === 'right') && this.inventory?.cursor !== null) {
      this.dragging = button;
      this.dragSlots.length = 0;
      this.dragSlots.push(view.index);
    }

    this.handleClick(view, button, { shift });
  }

  /**
   * Slot que só entrega item e nunca recebe: resultado do craft e saída da
   * fornalha. Tocar neles em série é a forma normal de jogar, não um gesto.
   */
  private isOutputSlot(view: SlotView): boolean {
    if (view.source === 'inv') return view.index === CRAFT_RESULT;
    return (this.kind === 'furnace' || this.kind === 'anvil') && view.index === 2;
  }

  /**
   * Avisa o CSS que o livro está aberto. A largura do painel só cresce quando
   * ele aparece — fechado, a tela continua do tamanho de antes.
   */
  private syncBookLayout(): void {
    this.panel.classList.toggle('with-book', this.book?.isOpen === true);
  }

  private endDrag(): void {
    if (this.dragging === null) return;
    const button = this.dragging;
    this.dragging = null;
    // Um slot só já foi tratado pelo clique; distribuir exige dois ou mais.
    if (this.dragSlots.length > 1 && this.inventory !== null) {
      this.inventory.distribute(this.dragSlots, button);
      this.refresh();
    }
    this.dragSlots.length = 0;
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
      this.renderSlot(view, stack);
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

  private renderSlot(view: SlotView, stack: ItemStack | null): void {
    const key = stack === null
      ? ''
      : `${stack.item}:${stack.count}:${stack.damage}:${stack.ench ?? 0}`;
    if (view.rendered === key) return;
    view.rendered = key;

    if (stack === null) {
      view.label.textContent = view.placeholder ?? '';
      view.bar.hidden = true;
      view.el.classList.remove('filled', 'sprite', 'enchanted');
      view.el.classList.toggle('ghost', view.placeholder !== undefined);
      view.el.style.removeProperty('--item-color');
      view.el.style.removeProperty('background-position');
      view.el.setAttribute('aria-label', view.placeholder ?? 'Vazio');
      return;
    }
    view.el.classList.remove('ghost');
    const def = itemDef(stack.item);
    view.el.setAttribute('aria-label', `${def?.display ?? '?'} ×${stack.count}`);

    // Com sprite, o slot mostra o desenho e só o número; sem, cai na cor média
    // do bloco com as duas primeiras letras do nome.
    const sprite = this.callbacks.spriteOf?.(stack.item) ?? null;
    if (sprite !== null) {
      view.el.classList.add('sprite');
      view.el.style.backgroundPosition = sprite;
      view.el.style.removeProperty('--item-color');
      view.label.textContent = stack.count > 1 ? String(stack.count) : '';
    } else {
      view.el.classList.remove('sprite');
      view.el.style.removeProperty('background-position');
      view.el.style.setProperty('--item-color', this.callbacks.colorOf(stack.item));
      view.label.textContent = labelFor(stack);
    }
    view.el.classList.add('filled');
    // Item encantado ganha um brilho arroxeado — é o único sinal na grade de
    // que aquela picareta não é uma picareta comum.
    view.el.classList.toggle('enchanted', (stack.ench ?? 0) !== 0);

    const durability = def?.durability;
    if (durability !== undefined && stack.damage > 0) {
      view.bar.hidden = false;
      const remaining = 1 - stack.damage / durability;
      view.bar.style.transform = `scaleX(${remaining.toFixed(3)})`;
      view.bar.style.background = remaining > 0.5 ? '#5ad04a' : remaining > 0.2 ? '#d0c04a' : '#d04a4a';
    } else {
      view.bar.hidden = true;
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

  /** Nome, encantamentos e durabilidade do slot, ou `null` se estiver vazio. */
  private describeSlot(view: SlotView): string | null {
    const stack = view.source === 'inv'
      ? this.inventory?.get(view.index) ?? null
      : this.container?.get(view.index) ?? null;
    if (stack === null) return null;

    const def = itemDef(stack.item);
    // Nome da bigorna em cima, com o nome do item embaixo (M15).
    let text = stack.name !== undefined ? `"${stack.name}"\n${def?.display ?? '?'}` : def?.display ?? '?';
    // Encantamentos em cima da durabilidade, como no doc 08 §3.5.
    const enchants = describeEnchants(stack.ench ?? 0);
    if (enchants !== '') text += `\n${enchants}`;
    if (def?.durability !== undefined) {
      text += `\nDurabilidade: ${def.durability - stack.damage} / ${def.durability}`;
    }
    return text;
  }

  private moveCursor(x: number, y: number): void {
    this.cursorEl.style.transform = `translate(${x + 8}px, ${y + 8}px)`;
    this.tooltip.position(x, y);
  }
}

/** Texto do slot. Sem sprites de item ainda: inicial + contagem. */
function labelFor(stack: ItemStack): string {
  const def = itemDef(stack.item);
  const name = def?.display ?? '?';
  const short = name.replace(/^(de |da |do )/, '').slice(0, 2);
  return stack.count > 1 ? `${short}\n${stack.count}` : short;
}
