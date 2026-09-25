/**
 * Os gestos num slot da tela de contêiner (saíram de `screen.ts` no M18):
 * clique de mouse, toque curto e longo, arraste de distribuição e duplo
 * clique. A tela diz o que um clique faz (`SlotGestureHost.click`); aqui se
 * decide **qual** clique o gesto foi.
 */

import type { ClickButton, Inventory } from '../../game/inventory';
import type { ItemTooltip } from './tooltip';
import type { SlotView } from './slotview';

/**
 * Quanto o dedo pode escorregar antes de o toque virar rolagem, em pixels de
 * tela. Abaixo disso é tremor de mão, não intenção.
 */
const TOUCH_SLOP = 12;
/** Toque longo quando as opções não informam o valor escolhido pelo jogador. */
const DEFAULT_LONG_PRESS_MS = 300;

/**
 * true quando o evento veio de um mouse de verdade.
 *
 * `pointerType` ausente ou vazio conta como mouse, que é a mesma regra de
 * `isMouseClick` em `input/controls.ts`: evento sintetizado — por teclado, por
 * navegador antigo ou por teste — não deve cair no caminho de toque, onde a
 * ação espera um `pointerup` que talvez nunca venha.
 */
function isMousePointer(e: PointerEvent): boolean {
  const type = e.pointerType;
  return type === undefined || type === '' || type === 'mouse';
}

/** O que os gestos precisam da tela. */
export interface SlotGestureHost {
  inventory(): Inventory | null;
  /** Aplica um clique resolvido no slot e redesenha. */
  click(view: SlotView, button: ClickButton, shift: boolean): void;
  /** Slot que só entrega item (resultado, saída): sem duplo clique. */
  isOutputSlot(view: SlotView): boolean;
  describe(view: SlotView): string | null;
  refresh(): void;
  readonly tooltip: ItemTooltip;
  longPressMs?: () => number;
  vibrate?: () => void;
}

export class SlotGestures {
  private readonly host: SlotGestureHost;
  /**
   * Toque em curso num slot: de onde partiu, se o toque longo já resolveu, e o
   * relógio dele. `null` quando não há dedo na tela.
   */
  private touchPress: {
    index: number; x: number; y: number; consumed: boolean;
    timer: ReturnType<typeof setTimeout>;
  } | null = null;
  /** Slots tocados durante um arraste de distribuição. */
  private dragging: 'left' | 'right' | null = null;
  private readonly dragSlots: number[] = [];
  private lastClickAt = 0;
  private lastClickIndex = -1;

  constructor(host: SlotGestureHost) {
    this.host = host;
  }

  /** Liga os gestos ao DOM do slot. */
  attach(view: SlotView): void {
    const el = view.el;
    el.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      e.stopPropagation();

      if (isMousePointer(e)) {
        // No mouse a ação resolve já: é disso que depende o arraste de
        // distribuição entre slots, que só existe com ponteiro fino.
        this.resolve(view, e.button === 2 ? 'right' : e.button === 1 ? 'middle' : 'left',
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
      const text = this.host.describe(view);
      if (text !== null) this.host.tooltip.flash(text, e.clientX, e.clientY);
      this.armTouch(view, e);
    });
    el.addEventListener('pointerup', (e) => {
      if (isMousePointer(e)) return;
      if (this.touchPress === null || this.touchPress.index !== view.index) return;
      const consumed = this.touchPress.consumed;
      this.cancelTouch();
      // O toque longo já resolveu; soltar depois dele não pode agir de novo.
      if (!consumed) this.resolve(view, 'left', false);
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
      const text = this.host.describe(view);
      if (text === null) this.host.tooltip.hide();
      else this.host.tooltip.show(text, e.clientX, e.clientY);
    });
    el.addEventListener('pointerleave', (e) => {
      if (e.pointerType === 'mouse') this.host.tooltip.hide();
    });
    el.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      this.host.click(view, 'left', e.shiftKey);
    });
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
      this.resolve(view, 'right', false);
      this.host.vibrate?.();
    }, this.host.longPressMs?.() ?? DEFAULT_LONG_PRESS_MS);
    this.touchPress = press;
  }

  private cancelTouch(): void {
    if (this.touchPress === null) return;
    clearTimeout(this.touchPress.timer);
    this.touchPress = null;
  }

  private resolve(view: SlotView, button: ClickButton, shift: boolean): void {
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
    if (button === 'left' && !this.host.isOutputSlot(view)
      && view.index === this.lastClickIndex && now - this.lastClickAt < 350) {
      this.host.inventory()?.doubleClick();
      this.lastClickIndex = -1;
      this.host.refresh();
      return;
    }
    this.lastClickAt = now;
    this.lastClickIndex = view.index;

    // Cursor cheio inicia um arraste de distribuição.
    if ((button === 'left' || button === 'right') && this.host.inventory()?.cursor !== null) {
      this.dragging = button;
      this.dragSlots.length = 0;
      this.dragSlots.push(view.index);
    }

    this.host.click(view, button, shift);
  }

  endDrag(): void {
    if (this.dragging === null) return;
    const button = this.dragging;
    this.dragging = null;
    // Um slot só já foi tratado pelo clique; distribuir exige dois ou mais.
    const inventory = this.host.inventory();
    if (this.dragSlots.length > 1 && inventory !== null) {
      inventory.distribute(this.dragSlots, button);
      this.host.refresh();
    }
    this.dragSlots.length = 0;
  }
}
