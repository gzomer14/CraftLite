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
import { enchantDef } from '../../data/enchants';
import {
  ARMOR_START, CRAFT_RESULT, CRAFT_START, HOTBAR_END, HOTBAR_START, MAIN_END, MAIN_START,
  OFFHAND, type ClickButton, type Inventory,
} from '../../game/inventory';
import { ENCHANT_ITEM, ENCHANT_LAPIS, Furnace, type ContainerView } from '../../game/container';
import { RecipeBookPanel } from './recipebook';
import { DOLL_WIDTH_UNITS, PaperDoll } from './paperdoll';
import { ItemTooltip } from './tooltip';
import type { RecipeEntry } from '../../game/crafting';

/** Qual tela está aberta. */
export type ScreenKind = 'none' | 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting';

/** Por que uma oferta de encantamento não pôde ser comprada. */
export type EnchantResult = 'ok' | 'no-offer' | 'no-level' | 'no-lapis';

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
  /** Nível de experiência do jogador, para pintar a oferta cara de vermelho. */
  xpLevel?: () => number;
  /**
   * O jogador tirou o item da fornalha: hora de entregar o XP guardado e de
   * contar o item como obtido (conquistas).
   */
  onFurnaceOutput?: (furnace: Furnace, item: number) => void;
  /** Duração do toque longo, das opções (doc 08 §6). */
  longPressMs?: () => number;
  /** Vibração curta ao confirmar o toque longo; ausente = sem retorno tátil. */
  vibrate?: () => void;
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
  /** Rodapé com o botão de fechar — a única saída sem teclado. */
  private readonly footer: HTMLDivElement;
  /** Colunas do painel; `column` é onde `addSection` escreve agora. */
  private sideColumn!: HTMLDivElement;
  private mainColumn!: HTMLDivElement;
  private column!: HTMLDivElement;
  /** Botões das três ofertas da mesa; criados junto com a tela. */
  private readonly offerButtons: HTMLButtonElement[] = [];
  private readonly offerHint: HTMLDivElement;

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

    // Dica sob as ofertas: "faltam níveis", "faltou lápis". Um botão que não
    // funciona sem explicar por quê é o pior retorno possível.
    this.offerHint = document.createElement('div');
    this.offerHint.className = 'offer-hint';
    this.offerHint.setAttribute('role', 'status');
    this.offerHint.hidden = true;

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
      furnace: 'Fornalha', chest: 'Baú', enchanting: 'Mesa de Encantamento',
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
      this.addSection('Item', 1, [ENCHANT_ITEM], 'cont', 'Item a encantar');
      this.addSection('', 1, [ENCHANT_LAPIS], 'cont', 'Lápis-lazúli');
      this.addOffers();
    } else if (this.kind === 'chest') {
      const size = this.container?.size ?? 27;
      const indices: number[] = [];
      for (let i = 0; i < size; i++) indices.push(i);
      this.addSection(size > 27 ? 'Baú Duplo' : 'Baú', 9, indices, 'cont');
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
    if (hint !== undefined) row.dataset.hint = hint;

    for (let i = 0; i < indices.length; i++) {
      row.appendChild(this.makeSlot(source, indices[i], placeholders?.[i]));
    }
    section.appendChild(row);
    this.column.appendChild(section);
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

  /** Os três botões de oferta da mesa. */
  private addOffers(): void {
    this.offerButtons.length = 0;
    const list = document.createElement('div');
    list.className = 'offers';
    for (let slot = 0; slot < 3; slot++) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'offer';
      button.disabled = true;
      button.addEventListener('click', () => this.buyOffer(slot));
      list.appendChild(button);
      this.offerButtons.push(button);
    }
    this.grid.append(list, this.offerHint);
  }

  private buyOffer(slot: number): void {
    const result = this.callbacks.onBuyEnchant?.(slot) ?? 'no-offer';
    const messages: Record<EnchantResult, string> = {
      ok: 'Encantado!',
      'no-offer': 'Nada para encantar',
      'no-level': 'Faltam níveis de experiência',
      'no-lapis': 'Falta lápis-lazúli',
    };
    this.offerHint.textContent = messages[result];
    this.offerHint.hidden = false;
    this.refresh();
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
    return this.kind === 'furnace' && view.index === 2;
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
      this.clickContainer(view.index, button, options.shift);
    }
    this.refresh();
  }

  /**
   * Clique num slot do contêiner. O inventário do jogador é a fonte da verdade
   * do cursor, então a troca acontece manualmente aqui.
   */
  private clickContainer(index: number, button: ClickButton, shift: boolean): void {
    const inventory = this.inventory;
    const container = this.container;
    if (inventory === null || container === null) return;

    const slot = container.get(index);

    if (shift) {
      if (slot === null) return;
      const leftover = inventory.give(slot.item, slot.count, slot.damage, slot.ench ?? 0);
      if (leftover === slot.count) return;
      if (this.kind === 'furnace' && index === 2 && container instanceof Furnace) {
        this.callbacks.onFurnaceOutput?.(container, slot.item);
      }
      slot.count = leftover;
      container.set(index, slot.count > 0 ? slot : null);
      return;
    }

    const cursor = inventory.cursor;

    // Saída da fornalha só sai, nunca entra — e leva junto o XP guardado.
    if (this.kind === 'furnace' && index === 2) {
      if (slot === null || cursor !== null) return;
      inventory.cursor = slot;
      container.set(index, null);
      if (container instanceof Furnace) this.callbacks.onFurnaceOutput?.(container, slot.item);
      return;
    }

    if (cursor === null) {
      if (slot === null) return;
      if (button === 'right') {
        const take = Math.ceil(slot.count / 2);
        inventory.cursor = { item: slot.item, count: take, damage: slot.damage };
        slot.count -= take;
        container.set(index, slot.count > 0 ? slot : null);
      } else {
        inventory.cursor = slot;
        container.set(index, null);
      }
      return;
    }

    if (slot === null) {
      if (button === 'right') {
        container.set(index, { item: cursor.item, count: 1, damage: cursor.damage });
        cursor.count--;
        if (cursor.count <= 0) inventory.cursor = null;
      } else {
        container.set(index, cursor);
        inventory.cursor = null;
      }
      return;
    }

    if (slot.item === cursor.item && slot.damage === cursor.damage) {
      const max = itemDef(slot.item)?.maxStack ?? 64;
      const moved = button === 'right' ? Math.min(1, max - slot.count) : Math.min(cursor.count, max - slot.count);
      if (moved <= 0) return;
      slot.count += moved;
      cursor.count -= moved;
      if (cursor.count <= 0) inventory.cursor = null;
      container.set(index, slot);
      return;
    }

    container.set(index, cursor);
    inventory.cursor = slot;
  }

  /** Redesenha o que mudou. */
  refresh(): void {
    if (this.kind === 'none' || this.inventory === null) return;

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
    if (this.kind === 'enchanting') this.refreshOffers();
  }

  /**
   * Redesenha as três ofertas. As ofertas dependem do item no slot, então o
   * recálculo acontece a cada redesenho — são três hashes, não custa nada.
   */
  private refreshOffers(): void {
    this.callbacks.onEnchantRefresh?.();
    const offers = this.callbacks.enchantOffers?.() ?? [];
    const level = this.callbacks.xpLevel?.() ?? 0;
    const lapis = this.container?.get(ENCHANT_LAPIS)?.count ?? 0;

    for (let slot = 0; slot < this.offerButtons.length; slot++) {
      const button = this.offerButtons[slot];
      const offer = offers[slot];
      if (offer === undefined || offer.enchant < 0) {
        button.disabled = true;
        button.textContent = '—';
        button.classList.remove('affordable');
        button.setAttribute('aria-label', `Oferta ${slot + 1}: indisponível`);
        continue;
      }
      const def = enchantDef(offer.enchant);
      const name = def?.display ?? '?';
      const affordable = level >= offer.cost && lapis >= offer.lapis;
      button.disabled = !affordable;
      button.classList.toggle('affordable', affordable);
      button.textContent = `${name} ${offer.level}\n${offer.cost} níveis · ${offer.lapis} lápis`;
      button.setAttribute(
        'aria-label',
        `${name} nível ${offer.level}, custa ${offer.cost} níveis e ${offer.lapis} lápis-lazúli`,
      );
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
    let text = def?.display ?? '?';
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

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
/* Rolagem da janela (queixa de campo, 2026-09-10). Duas coisas impediam
   arrastar o inventário no celular:
   - touch-action:none no elemento raiz desliga a rolagem por toque do
     navegador. Estava aqui para o arraste de pilha entre slots não rolar a
     tela junto, mas os slots já chamam preventDefault() no pointerdown, então
     o lugar certo da regra é o slot, não a janela inteira. pan-y libera o
     arraste vertical e segue bloqueando o horizontal e o pinch.
   - place-items:center com conteúdo mais alto que a tela deixa o topo
     inalcançável: o painel é centralizado e transborda para os dois lados,
     sem como rolar para antes do começo. safe center centraliza quando cabe e
     alinha no início quando não cabe.
   overscroll-behavior:contain impede a rolagem vazar para a página atrás. */
#container-screen{position:fixed;inset:0;z-index:12;background:#00000080;
  display:grid;place-items:safe center;font:calc(4.5 * var(--px,3px))/1.2 ui-monospace,monospace;
  color:#fff;image-rendering:pixelated;touch-action:pan-y;overscroll-behavior:contain;
  -webkit-overflow-scrolling:touch;overflow:auto;padding:8px}
#container-screen .panel{background:#c6c6c6;color:#3f3f3f;padding:calc(4 * var(--px,3px));
  border-top:calc(2 * var(--px,3px)) solid #fff;border-left:calc(2 * var(--px,3px)) solid #fff;
  border-right:calc(2 * var(--px,3px)) solid #555;border-bottom:calc(2 * var(--px,3px)) solid #555;
  max-width:min(96vw,640px);outline:none}
#container-screen .title{font-weight:700;margin-bottom:calc(2 * var(--px,3px))}
/* Slot de equipamento vazio: o nome da peça, apagado, some assim que entra item. */
#container-screen .slot.ghost span{font-size:calc(2.4 * var(--px,3px));color:#6b6b6b;
  position:absolute;inset:0;display:grid;place-items:center;text-shadow:none}
#container-screen .footer{display:flex;margin-top:calc(3 * var(--px,3px))}
#container-screen .close{flex:1;min-height:44px;background:#6e6e6e;color:#fff;
  border:2px solid #000;font:14px/1 ui-monospace,monospace;cursor:pointer}
#container-screen .close:hover,#container-screen .close:focus-visible{background:#7b94c7}
/* Dica do toque longo: discreta, abaixo da grade e acima dos botões. */
#container-screen .touch-hint{margin-top:calc(2 * var(--px,3px));color:#3f3f3f;
  font:calc(4 * var(--px,3px))/1.3 ui-monospace,monospace;text-align:center}
#container-screen .panel-header{display:flex;align-items:center;justify-content:space-between;
  gap:calc(4 * var(--px,3px));margin-bottom:calc(2 * var(--px,3px))}
#container-screen .panel-header .title{margin-bottom:0}
#container-screen .book-toggle{flex:none;
  min-height:32px;padding:4px 8px;background:#6e6e6e;color:#fff;border:2px solid #000;
  font:calc(4 * var(--px,3px))/1 ui-monospace,monospace;cursor:pointer}
#container-screen .book-toggle:hover,#container-screen .book-toggle:focus-visible{
  background:#7b94c7;outline:2px solid #fff}
#container-screen .section-title{margin:calc(2 * var(--px,3px)) 0 calc(1 * var(--px,3px));
  font-size:calc(4 * var(--px,3px))}
#container-screen .grid{display:flex;flex-direction:column}
#container-screen .grid-col{display:flex;flex-direction:column;min-width:0}
#container-screen .grid-col:empty{display:none}
#container-screen .panel-body{display:flex;flex-direction:column;align-items:stretch}
#container-screen .panel-main{min-width:0}
/*
 * Tela larga: o livro vira coluna à direita e a grade deita.
 *
 * São os dois lados do mesmo desperdício. A fileira de 9 slots da mochila
 * manda na largura do painel, e a grade 3×3 da bancada, empilhada em cima
 * dela, deixava metade da linha vazia; o livro, empilhado embaixo, estourava a
 * altura da tela. Deitando a grade o vazio some, e o livro passa a ocupar a
 * faixa que sobra à direita, na altura do próprio botão que o abre.
 *
 * 900px é onde as três faixas (criação + mochila + livro) cabem sem apertar.
 */
@media (min-width:900px){
  #container-screen .panel-body{flex-direction:row;align-items:flex-start;
    column-gap:calc(4 * var(--px,3px))}
  #container-screen .panel.with-book{max-width:min(96vw,960px)}
  #container-screen .panel-body .recipe-book{flex:none;width:calc(84 * var(--px,3px));
    margin-top:0;border-top:none;padding-top:0;
    border-left:var(--px,3px) solid #555;padding-left:calc(4 * var(--px,3px));
    align-self:stretch}
  #container-screen .panel-body .recipe-book .list{max-height:calc(96 * var(--px,3px))}
  #container-screen .grid{flex-flow:row wrap;align-items:flex-start;
    column-gap:calc(6 * var(--px,3px))}
}
/*
 * Celular deitado: ~360 px de altura e largura de sobra. Em coluna única o
 * painel do inventário passava de 700 px e o jogador nunca via a grade de
 * criação e a mochila ao mesmo tempo.
 *
 * flex-wrap, e nao multi-coluna do CSS: aquele reparte a largura em partes
 * iguais, e a fileira de 9 slots da mochila é mais larga que metade do painel
 * — ela vazava para fora da borda. Aqui cada coluna toma a largura que precisa
 * e, quando as duas são largas (baú), elas empilham em vez de transbordar.
 */
@media (max-height:560px) and (orientation:landscape){
  #container-screen .grid{flex-flow:row wrap;align-items:flex-start;
    column-gap:calc(6 * var(--px,3px))}
}
/* Boneco: largura em unidades de modelo, para acompanhar a escala da GUI. */
#container-screen .section.doll{align-items:flex-start}
#container-screen .paperdoll{width:calc(${DOLL_WIDTH_UNITS} * var(--px,3px));height:auto;
  image-rendering:pixelated;touch-action:none}
#container-screen .slots{display:grid;grid-template-columns:repeat(var(--cols),auto);
  gap:calc(1 * var(--px,3px));justify-content:start;margin-bottom:calc(2 * var(--px,3px))}
#container-screen .slots.result{grid-template-columns:auto auto;align-items:center;
  gap:calc(3 * var(--px,3px))}
#container-screen .arrow{font-size:calc(6 * var(--px,3px));color:#555}
#container-screen .slot{position:relative;touch-action:none;width:calc(18 * var(--px,3px));
  height:calc(18 * var(--px,3px));background:#8b8b8b;
  border-top:var(--px,3px) solid #373737;border-left:var(--px,3px) solid #373737;
  border-right:var(--px,3px) solid #fff;border-bottom:var(--px,3px) solid #fff;
  display:grid;place-items:center;color:#fff;white-space:pre-line;text-align:center;
  cursor:pointer;-webkit-tap-highlight-color:transparent;user-select:none;
  text-shadow:var(--px,3px) var(--px,3px) 0 #3f3f3f;min-width:32px;min-height:32px}
#container-screen .slot.filled{background:var(--item-color,#8b8b8b)}
/* Brilho do encantamento: um véu roxo por cima do sprite, sem animação para
   não custar frame em aparelho fraco. */
#container-screen .slot.enchanted{box-shadow:inset 0 0 calc(4 * var(--px,3px)) #b46ee8}
#container-screen .offers{display:flex;flex-direction:column;gap:calc(1 * var(--px,3px));
  margin-bottom:calc(2 * var(--px,3px))}
#container-screen .offer{min-height:36px;padding:4px 8px;text-align:left;white-space:pre-line;
  background:#4a3a5e;color:#cfcfcf;border:2px solid #000;cursor:pointer;
  font:calc(4 * var(--px,3px))/1.25 ui-monospace,monospace}
#container-screen .offer.affordable{background:#5b2a8a;color:#fff}
#container-screen .offer:disabled{cursor:not-allowed;opacity:.6}
#container-screen .offer:focus-visible{outline:2px solid #fff}
#container-screen .offer-hint{margin-bottom:calc(2 * var(--px,3px));color:#3f3f3f;
  font-size:calc(4 * var(--px,3px))}
/* Sprite: a folha inteira é o fundo e o background-position escolhe o tile. */
#container-screen .slot.sprite,#container-screen .cursor.sprite{
  background-image:var(--item-sheet);background-size:var(--item-sheet-size);
  background-repeat:no-repeat;background-color:#8b8b8b;image-rendering:pixelated}
#container-screen .slot.sprite span{align-self:end;justify-self:end;
  padding:0 calc(1 * var(--px,3px));font-size:calc(5 * var(--px,3px))}
#container-screen .cursor.sprite{width:calc(16 * var(--px,3px));
  height:calc(16 * var(--px,3px));background-color:transparent;padding:0;
  display:grid;place-items:end}
#container-screen .slot.filled span{
  /* Contorno escuro para o texto ficar legível sobre qualquer cor de bloco. */
  text-shadow:0 0 2px #000,var(--px,3px) var(--px,3px) 0 #000}
#container-screen .slot:hover{filter:brightness(1.2)}
#container-screen .slot:focus-visible{outline:calc(2 * var(--px,3px)) solid #7b94c7}
#container-screen .durability{position:absolute;left:var(--px,3px);right:var(--px,3px);
  bottom:var(--px,3px);height:calc(1.5 * var(--px,3px));background:#5ad04a;
  transform-origin:left center}
#container-screen .cursor{position:fixed;left:0;top:0;pointer-events:none;z-index:14;
  background:#00000099;padding:2px 4px;white-space:pre-line;text-align:center;
  font:calc(4.5 * var(--px,3px))/1.1 ui-monospace,monospace;color:#fff}
#container-screen .tooltip{position:fixed;left:0;top:0;pointer-events:none;z-index:13;
  background:#100010f0;border:1px solid #5b2a8a;padding:4px 6px;white-space:pre-line;
  font:12px/1.35 ui-monospace,monospace;color:#fff;max-width:240px}
#container-screen .furnace-progress{display:flex;align-items:center;gap:8px;
  margin-bottom:calc(2 * var(--px,3px))}
#container-screen .flame{width:calc(8 * var(--px,3px));height:calc(8 * var(--px,3px));
  background:#555;position:relative;overflow:hidden}
#container-screen .flame i{position:absolute;inset:0;background:#ff9d2e;
  transform-origin:bottom center;transform:scaleY(0)}
#container-screen .arrow-bar{width:calc(22 * var(--px,3px));height:calc(6 * var(--px,3px));
  background:#555;position:relative;overflow:hidden}
#container-screen .arrow-bar i{position:absolute;inset:0;background:#fff;
  transform-origin:left center;transform:scaleX(0)}
@media (prefers-reduced-motion:reduce){#container-screen *{transition:none!important}}
`;
  document.head.appendChild(css);
}
