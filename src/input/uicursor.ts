/**
 * Cursor virtual dos menus, movido pelo analógico direito (doc 08 §4.3).
 *
 * Fora dos menus o analógico direito é a câmera. Com uma tela aberta ele não
 * tem o que fazer — e é exatamente aí que o jogador de controle sente falta do
 * mouse: com o direcional, sair da grade de criação e chegar na mochila custa
 * uma casinha de cada vez, passando por armadura e resultado no caminho
 * (relato de campo 2026-09-14). A navegação espacial de `uinav.ts` encurta o
 * caminho; este módulo elimina o caminho.
 *
 * Duas decisões:
 *
 * 1. **O cursor move o foco, não clica.** Ele encosta no elemento e o foca; o
 *    botão de confirmar continua sendo o mesmo de sempre, e vale tanto para o
 *    que o cursor apontou quanto para o que o direcional escolheu. Ter dois
 *    caminhos de ativação seria duas regras para a mesma coisa.
 * 2. **O elemento nasce na primeira vez que o analógico é empurrado.** Quem
 *    joga de teclado ou de toque nunca paga um nó a mais no documento — e o
 *    módulo continua importável em ambiente sem DOM, que é onde os testes
 *    rodam.
 */

/** Pixels por segundo com o analógico no fim do curso. */
const SPEED = 950;
/** Some sozinho depois de parado: cursor esquecido na tela atrapalha a leitura. */
const IDLE_MS = 4000;

export class UiCursor {
  /** Posição em pixels de viewport. */
  x = 0;
  y = 0;
  /** Já foi colocado na tela alguma vez nesta abertura. */
  private placed = false;
  private element: HTMLElement | null = null;
  private lastMove = 0;

  /**
   * Empurra o cursor e devolve o elemento sob ele.
   *
   * `dx`/`dy` vêm do analógico (−1..1) e `dtMs` é o passo do laço: a
   * velocidade é por segundo, e não por tick, para o cursor andar igual num
   * laço de 20 Hz e num de 60.
   */
  move(dx: number, dy: number, dtMs: number): HTMLElement | null {
    const el = this.ensure();
    if (el === null) return null;
    const width = viewportWidth();
    const height = viewportHeight();

    if (!this.placed) {
      // Nasce no meio da tela: é o menor caminho médio até qualquer canto.
      this.x = width / 2;
      this.y = height / 2;
      this.placed = true;
    }

    const step = (SPEED * dtMs) / 1000;
    this.x = clamp(this.x + dx * step, 0, width);
    this.y = clamp(this.y + dy * step, 0, height);
    this.lastMove = now();

    el.hidden = false;
    el.style.transform = `translate(${this.x}px, ${this.y}px)`;
    return elementAt(this.x, this.y);
  }

  /** Esconde o cursor sem esquecer onde ele estava. */
  hide(): void {
    if (this.element !== null) this.element.hidden = true;
  }

  /** Esconde e esquece: a próxima abertura recomeça do meio da tela. */
  reset(): void {
    this.hide();
    this.placed = false;
  }

  /** Apaga o cursor parado há tempo demais. Chamado a cada tick da navegação. */
  fade(): void {
    if (this.element === null || this.element.hidden) return;
    if (now() - this.lastMove > IDLE_MS) this.element.hidden = true;
  }

  /** O elemento do cursor, criado na primeira vez. `null` sem DOM. */
  private ensure(): HTMLElement | null {
    if (this.element !== null) return this.element;
    if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
      return null;
    }
    const el = document.createElement('div');
    el.id = 'pad-cursor';
    el.setAttribute('aria-hidden', 'true');
    el.hidden = true;
    injectStyle();
    document.body.appendChild(el);
    this.element = el;
    return el;
  }
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

function viewportWidth(): number {
  return typeof window !== 'undefined' && window.innerWidth > 0 ? window.innerWidth : 1280;
}

function viewportHeight(): number {
  return typeof window !== 'undefined' && window.innerHeight > 0 ? window.innerHeight : 720;
}

/**
 * Quem está debaixo do cursor. O próprio cursor não conta — ele tem
 * `pointer-events: none`, então o navegador já o ignora, mas a checagem custa
 * nada e protege de um estilo perdido.
 */
function elementAt(x: number, y: number): HTMLElement | null {
  if (typeof document === 'undefined' || typeof document.elementFromPoint !== 'function') {
    return null;
  }
  const found = document.elementFromPoint(x, y);
  if (found === null || !(found instanceof HTMLElement)) return null;
  return found.id === 'pad-cursor' ? null : found;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  /*
   * A seta é desenhada em CSS, como todo o resto da interface: nenhum asset de
   * terceiros entra no repositório (PROMPT.md §6).
   */
  css.textContent = `
#pad-cursor{position:fixed;left:0;top:0;width:calc(6 * var(--px, 3px));
  height:calc(8 * var(--px, 3px));z-index:40;pointer-events:none;
  background:#fff;
  clip-path:polygon(0 0,100% 62%,55% 68%,78% 100%,58% 100%,38% 74%,0 100%);
  filter:drop-shadow(1px 1px 0 #0009)}
`;
  document.head.appendChild(css);
}
