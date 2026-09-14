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
 * Cinco decisões:
 *
 * 1. **O direcional anda pela tela, não pela ordem do documento.** Era ordem
 *    de documento até 2026-09-14, e no inventário isso obrigava a passar por
 *    armadura, boneco e resultado para ir da grade de criação até a mochila —
 *    doze casinhas para um passo que o olho vê como "para a direita" (relato
 *    de campo). Agora a escolha é geométrica: o vizinho mais próximo naquela
 *    direção. Sem geometria disponível (tela sem layout, teste sem DOM), cai
 *    na ordem do documento, que é o comportamento antigo.
 * 2. **Esquerda/direita mexem no controle, não no foco.** Num slider de volume
 *    o jogador quer mudar o valor, não pular para o próximo campo — e a tela de
 *    opções é quase toda slider. Só quando o elemento focado não tem o que
 *    ajustar é que elas andam no foco.
 * 3. **Voltar (`B`) dispara `Escape` na camada.** As telas já tratam `Escape`
 *    para fechar uma camada por vez (doc 08 §4.1); reimplementar o fechamento
 *    aqui criaria uma segunda regra para a mesma coisa.
 * 4. **A repetição é de teclado, não de jogo.** Segurar o direcional anda de
 *    item em item com atraso inicial e depois ritmo constante — sem isso,
 *    atravessar a lista de opções a 20 Hz passa vinte campos num piscar.
 * 5. **O analógico direito é um cursor** enquanto a tela está aberta
 *    (`UiCursor`). Ele não clica: encosta e foca, e quem ativa continua sendo o
 *    botão de confirmar.
 */

import type { NavState } from './gamepad';
import { UiCursor } from './uicursor';

/** Ticks antes de a repetição começar (~400 ms a 20 Hz). */
const REPEAT_DELAY = 8;
/** Ticks entre repetições depois disso (~150 ms). */
const REPEAT_RATE = 3;
/**
 * Passo do laço de navegação, em ms. Quem roda o laço importa daqui: o cursor
 * anda por segundo, e um passo diferente do combinado o deixaria mais rápido
 * ou mais lento que o desenhado.
 */
export const NAV_STEP_MS = 50;
/**
 * Quanto custa sair do eixo. Com peso 2, um vizinho duas vezes mais torto
 * perde para um mais distante mas alinhado — é o que mantém a coluna de slots
 * andando em linha reta.
 */
const ACROSS_WEIGHT = 2;
/** Menos que isto na direção pedida não conta como estar naquela direção. */
const MIN_STEP = 1;

/** As direções e botões que a navegação lê — só os campos booleanos. */
type NavKey = 'up' | 'down' | 'left' | 'right' | 'confirm' | 'cancel' | 'secondary';

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

  /** O cursor do analógico direito. */
  readonly cursor = new UiCursor();

  /** Ticks segurando cada direção, para a repetição. */
  private readonly held = new Map<NavKey, number>();

  /**
   * Um tick de navegação. Devolve `true` quando uma tela está aberta e o
   * controle foi consumido por ela.
   */
  tick(nav: NavState): boolean {
    const layer = topLayer();
    const wasActive = this.active;
    this.active = layer !== null;
    if (layer === null) {
      this.held.clear();
      // Fechou a tela: o cursor não fica pendurado sobre o mundo.
      if (wasActive) this.cursor.reset();
      return false;
    }

    const items = focusableIn(layer);
    if (items.length === 0) return true;

    // O cursor primeiro: ele decide quem está focado antes de o direcional ler
    // o foco atual, e assim os dois nunca discordam no mesmo tick.
    if (nav.cursorX !== 0 || nav.cursorY !== 0) {
      const under = this.cursor.move(nav.cursorX, nav.cursorY, NAV_STEP_MS);
      const target = focusableAncestor(under, layer, items);
      if (target !== null) target.focus();
    } else {
      this.cursor.fade();
    }

    // Sem nada focado dentro da camada, o primeiro item recebe o foco: é o que
    // dá ao jogador um ponto de partida visível ao abrir a tela.
    let current = items.indexOf(document.activeElement as HTMLElement);
    if (current < 0) {
      items[0].focus();
      current = 0;
    }

    if (this.repeat(nav, 'down')) this.moveFocus(items, current, 0, 1);
    else if (this.repeat(nav, 'up')) this.moveFocus(items, current, 0, -1);
    else if (this.repeat(nav, 'right')) this.adjust(items, current, 1);
    else if (this.repeat(nav, 'left')) this.adjust(items, current, -1);

    if (this.repeat(nav, 'confirm')) activate(items[current], 'left');
    if (this.repeat(nav, 'secondary')) activate(items[current], 'right');
    if (this.repeat(nav, 'cancel')) escape(layer);
    return true;
  }

  /**
   * true no tick em que a direção deve agir: na borda de subida e depois no
   * ritmo da repetição.
   */
  private repeat(nav: NavState, key: NavKey): boolean {
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

  /**
   * Anda no foco na direção pedida. Tenta a geometria da tela; se ela não
   * estiver disponível, ou se não houver nada naquela direção, cai na ordem do
   * documento — que dá a volta e por isso nunca deixa a seta inerte.
   */
  private moveFocus(items: HTMLElement[], current: number, dx: number, dy: number): void {
    // O direcional assume: o cursor sai da frente para não apontar para um
    // lugar que não é mais o foco.
    this.cursor.hide();
    const best = nearestIn(items, current, dx, dy);
    if (best >= 0) { items[best].focus(); return; }
    this.step(items, current, dx + dy);
  }

  /** Próximo/anterior na ordem do documento, dando a volta. */
  private step(items: HTMLElement[], current: number, delta: number): void {
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
    this.moveFocus(items, current, delta, 0);
  }
}

/**
 * O vizinho mais próximo na direção pedida, ou −1 quando não há geometria ou
 * não há ninguém daquele lado.
 *
 * O custo é a distância no eixo pedido mais a distância fora dele, pesada: o
 * que está à direita e na mesma linha ganha do que está à direita e três
 * linhas abaixo, mesmo que o segundo esteja mais perto em linha reta.
 */
function nearestIn(items: HTMLElement[], current: number, dx: number, dy: number): number {
  if (!centerOf(items[current], FROM)) return -1;
  let best = -1;
  let bestCost = Infinity;
  for (let i = 0; i < items.length; i++) {
    if (i === current) continue;
    if (!centerOf(items[i], TO)) continue;
    const ax = TO.x - FROM.x;
    const ay = TO.y - FROM.y;
    const along = dx !== 0 ? ax * dx : ay * dy;
    if (along < MIN_STEP) continue;
    const across = dx !== 0 ? Math.abs(ay) : Math.abs(ax);
    const cost = along + across * ACROSS_WEIGHT;
    if (cost < bestCost) { bestCost = cost; best = i; }
  }
  return best;
}

/** Centros pré-alocados: a varredura roda uma vez por passo, sem deixar lixo. */
const FROM = { x: 0, y: 0 };
const TO = { x: 0, y: 0 };

/**
 * Escreve o centro do elemento em `out`. Devolve `false` quando ele não tem
 * tamanho.
 *
 * "Sem tamanho" cobre os dois casos que importam: ambiente sem layout (os
 * testes rodam em Node) e elemento que ainda não foi desenhado. Nos dois, a
 * navegação volta para a ordem do documento em vez de escolher às cegas.
 */
function centerOf(el: HTMLElement, out: { x: number; y: number }): boolean {
  if (typeof el.getBoundingClientRect !== 'function') return false;
  const rect = el.getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) return false;
  out.x = rect.left + rect.width / 2;
  out.y = rect.top + rect.height / 2;
  return true;
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
 * Sobe do elemento apontado pelo cursor até achar um que seja navegável nesta
 * camada. O cursor cai com frequência num `<span>` de rótulo dentro do slot —
 * e o slot é que recebe o foco.
 */
function focusableAncestor(
  el: HTMLElement | null, layer: HTMLElement, items: HTMLElement[],
): HTMLElement | null {
  let node: HTMLElement | null = el;
  while (node !== null && node !== layer) {
    if (items.includes(node)) return node;
    node = node.parentElement;
  }
  return null;
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

/**
 * Aperta o elemento focado.
 *
 * `button` distingue o clique esquerdo do direito, que no inventário são
 * coisas diferentes: esquerdo move a pilha, direito pega metade e solta uma
 * unidade de cada vez (doc 08 §3.5).
 *
 * Os slots **não são `<button>`**: são `div[role="button"]` que agem no
 * `keydown` de Enter e no `pointerdown`. Chamar `click()` neles dispara um
 * evento que ninguém escuta — era o que acontecia até 2026-09-14, e por isso
 * confirmar num slot com o controle não fazia nada. Aqui se fala a língua que
 * cada um entende.
 */
function activate(el: HTMLElement, button: 'left' | 'right'): void {
  if (el instanceof HTMLInputElement && (el.type === 'checkbox' || el.type === 'radio')) {
    if (button === 'right') return;
    el.checked = !el.checked;
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return;
  }
  if (el.getAttribute('role') === 'button') {
    if (button === 'right') {
      fireMouse(el, 'pointerdown', 2);
      return;
    }
    el.dispatchEvent(new KeyboardEvent('keydown', {
      key: 'Enter', code: 'Enter', bubbles: true, cancelable: true,
    }));
    return;
  }
  // Um botão comum não tem clique direito: o secundário não faz nada nele.
  if (button === 'right') return;
  el.click();
}

/**
 * Manda um evento de mouse sintético. `MouseEvent` e não `PointerEvent` de
 * propósito: quem escuta trata `pointerType` ausente como mouse (mesma regra
 * de `isMouseClick` em `controls.ts`), e `MouseEvent` existe em mais lugares.
 */
function fireMouse(el: HTMLElement, type: string, button: number): void {
  if (typeof MouseEvent !== 'function') return;
  el.dispatchEvent(new MouseEvent(type, { button, bubbles: true, cancelable: true }));
}

/** Manda `Escape` para a camada: ela já sabe fechar uma de cada vez. */
function escape(layer: HTMLElement): void {
  layer.dispatchEvent(new KeyboardEvent('keydown', {
    key: 'Escape', code: 'Escape', bubbles: true, cancelable: true,
  }));
}
