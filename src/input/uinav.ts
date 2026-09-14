/**
 * Navegação de interface por controle (doc 08 §4.3).
 *
 * O doc pede que **toda** tela seja navegável por teclado (Tab/setas/Enter) e
 * por gamepad (D-pad/A/B). O Tab e o Enter saem de graça — as telas são
 * `<button>` de verdade —, mas o gamepad não fala com o DOM: nada no navegador
 * transforma um botão de controle em foco. É o que este módulo faz.
 *
 * Ele não conhece nenhuma tela. O que ele sabe é achar a **camada de cima**
 * (o último diálogo visível) e percorrer o que dá foco dentro dela. Tela nova
 * funciona sozinha, desde que use `<button>` e `role="dialog"`, que é o que o
 * doc 08 §4.4 já exige.
 *
 * Três decisões:
 *
 * 1. **Esquerda/direita mexem no controle, não no foco.** Num slider de volume
 *    o jogador quer mudar o valor, não pular para o próximo campo — e a tela de
 *    opções é quase toda slider. Só quando o elemento focado não tem o que
 *    ajustar é que elas andam no foco.
 * 2. **Voltar (`B`) dispara `Escape` na camada.** As telas já tratam `Escape`
 *    para fechar uma camada por vez (doc 08 §4.1); reimplementar o fechamento
 *    aqui criaria uma segunda regra para a mesma coisa.
 * 3. **A repetição é de teclado, não de jogo.** Segurar o direcional anda de
 *    item em item com atraso inicial e depois ritmo constante — sem isso,
 *    atravessar a lista de opções a 20 Hz passa vinte campos num piscar.
 */

import type { NavState } from './gamepad';

/** Ticks antes de a repetição começar (~400 ms a 20 Hz). */
const REPEAT_DELAY = 8;
/** Ticks entre repetições depois disso (~150 ms). */
const REPEAT_RATE = 3;

/** O que dá foco. Mesma lista que o `Tab` do navegador percorre. */
const FOCUSABLE =
  'button:not([disabled]), input:not([disabled]), select:not([disabled]), '
  + 'textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Camadas de interface. A **última** visível no documento é a que está por
 * cima e recebe a navegação.
 *
 * O seletor é `role="dialog"` e não uma lista de ids: o doc 08 §4.4 já exige
 * `role="dialog"` + foco preso em todo modal, e as sete telas do jogo já o
 * declaram. Tela nova entra na navegação sem ninguém lembrar de cadastrá-la
 * aqui — e uma que esquecer o atributo perde a navegação **e** o leitor de
 * tela junto, que é o tipo de erro que se quer que doa em dois lugares.
 */
const LAYERS = '[role="dialog"]';

export class UiNavigator {
  /** Há uma tela aberta agora — é o que manda o controle parar de andar. */
  active = false;

  /** Ticks segurando cada direção, para a repetição. */
  private readonly held = new Map<keyof NavState, number>();

  /**
   * Um tick de navegação. Devolve `true` quando uma tela está aberta e o
   * controle foi consumido por ela.
   */
  tick(nav: NavState): boolean {
    const layer = topLayer();
    this.active = layer !== null;
    if (layer === null) {
      this.held.clear();
      return false;
    }

    const items = focusableIn(layer);
    if (items.length === 0) return true;

    // Sem nada focado dentro da camada, o primeiro item recebe o foco: é o que
    // dá ao jogador um ponto de partida visível ao abrir a tela.
    let current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      items[0].focus();
      current = 0;
    }

    if (this.repeat(nav, 'down')) this.move(items, current, 1);
    else if (this.repeat(nav, 'up')) this.move(items, current, -1);
    else if (this.repeat(nav, 'right')) this.adjust(items, current, 1);
    else if (this.repeat(nav, 'left')) this.adjust(items, current, -1);

    if (this.repeat(nav, 'confirm')) activate(items[current]);
    if (this.repeat(nav, 'cancel')) escape(layer);
    return true;
  }

  /**
   * true no tick em que a direção deve agir: na borda de subida e depois no
   * ritmo da repetição.
   */
  private repeat(nav: NavState, key: keyof NavState): boolean {
    const down = nav[key];
    const ticks = this.held.get(key) ?? 0;
    if (!down) {
      if (ticks !== 0) this.held.set(key, 0);
      return false;
    }
    this.held.set(key, ticks + 1);
    if (ticks === 0) return true;
    if (ticks < REPEAT_DELAY) return false;
    return (ticks - REPEAT_DELAY) % REPEAT_RATE === 0;
  }

  private move(items: HTMLElement[], current: number, delta: number): void {
    // Dá a volta: chegar ao fim da lista e continuar leva ao começo, que é o
    // que se espera de uma lista curta percorrida com o polegar.
    const next = (current + delta + items.length) % items.length;
    items[next].focus();
  }

  /**
   * Esquerda/direita: mexe no valor do controle focado. Se ele não tiver valor
   * para mexer, anda no foco, para a seta nunca ficar inerte.
   */
  private adjust(items: HTMLElement[], current: number, delta: number): void {
    const el = items[current];
    if (el instanceof HTMLInputElement && el.type === 'range') {
      const step = Number(el.step) || 1;
      const min = Number(el.min);
      const max = Number(el.max);
      const value = Math.min(max, Math.max(min, Number(el.value) + step * delta));
      if (value === Number(el.value)) return;
      el.value = String(value);
      el.dispatchEvent(new Event('input', { bubbles: true }));
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    if (el instanceof HTMLSelectElement && el.options.length > 0) {
      const next = Math.min(el.options.length - 1, Math.max(0, el.selectedIndex + delta));
      if (next === el.selectedIndex) return;
      el.selectedIndex = next;
      el.dispatchEvent(new Event('change', { bubbles: true }));
      return;
    }
    this.move(items, current, delta);
  }
}

/** A camada visível mais acima, ou `null` se o jogo está sem tela aberta. */
function topLayer(): HTMLElement | null {
  const found = document.querySelectorAll<HTMLElement>(LAYERS);
  let top: HTMLElement | null = null;
  for (const el of found) {
    if (isHidden(el)) continue;
    top = el;
  }
  return top;
}

/** Elementos focáveis e visíveis dentro da camada, em ordem de documento. */
function focusableIn(layer: HTMLElement): HTMLElement[] {
  const out: HTMLElement[] = [];
  for (const el of layer.querySelectorAll<HTMLElement>(FOCUSABLE)) {
    if (!isHidden(el)) out.push(el);
  }
  return out;
}

/**
 * Escondido de verdade: o atributo `hidden` de qualquer ancestral até a camada.
 *
 * `offsetParent` seria mais preciso, mas força o navegador a calcular layout —
 * e isto roda a cada tick com uma tela aberta.
 */
function isHidden(el: HTMLElement): boolean {
  let node: HTMLElement | null = el;
  while (node !== null) {
    if (node.hidden) return true;
    node = node.parentElement;
  }
  return false;
}

/** Aperta o elemento focado. Caixa de seleção alterna em vez de "clicar". */
function activate(el: HTMLElement): void {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  el.click();
}

/** Manda `Escape` para a camada: ela já sabe fechar uma de cada vez. */
function escape(layer: HTMLElement): void {
  layer.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
  }));
}
