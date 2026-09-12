/**
 * Rótulo flutuante de item, e o toque longo que o revela (doc 08 §3.5).
 *
 * No desktop o nome sai do `hover`, e isso sempre funcionou. No celular não há
 * hover, e o `title` do HTML nunca aparece: tocar um item da paleta criativa
 * já o mandava para a hotbar **sem nunca dizer o que ele era**. Quem não
 * reconhece o sprite não tinha como descobrir.
 *
 * A saída é o vocabulário que o jogo já usa no mundo — segurar o dedo. Toque
 * longo mostra o nome e **cancela** a ação daquele toque; toque curto continua
 * fazendo exatamente o que fazia. Nada muda para quem usa mouse.
 */

/** Padrão de `longPressMs` nas opções, para quem não passa o de verdade. */
const DEFAULT_LONG_PRESS = 300;
/** Quanto o rótulo fica na tela depois de um toque, em ms. */
const FLASH_MS = 1800;
/** Quanto o dedo pode escorregar antes de deixar de ser "segurar". */
const SLOP_PX = 12;

export class ItemTooltip {
  readonly element: HTMLDivElement;
  private timer = 0;
  private hideTimer = 0;

  constructor(className = 'tooltip') {
    this.element = document.createElement('div');
    this.element.className = className;
    this.element.setAttribute('role', 'status');
    this.element.hidden = true;
  }

  show(text: string, x: number, y: number): void {
    this.clearHide();
    this.element.textContent = text;
    this.element.hidden = false;
    this.position(x, y);
  }

  /**
   * Mostra e some sozinho. O toque não tem "sair de cima": sem o prazo, o
   * rótulo ficaria na tela até o próximo toque.
   */
  flash(text: string, x: number, y: number, ms = FLASH_MS): void {
    this.show(text, x, y);
    this.hideTimer = setTimeout(() => { this.element.hidden = true; }, ms) as unknown as number;
  }

  hide(): void {
    this.clearHide();
    this.element.hidden = true;
  }

  /** Reposiciona sem mexer no texto — o mouse arrasta o rótulo junto. */
  position(x: number, y: number): void {
    this.element.style.transform = `translate(${x + 14}px, ${y + 14}px)`;
  }

  /**
   * Liga o toque longo num elemento clicável.
   *
   * **Chame antes de registrar o `click` que executa a ação.** Ouvintes do
   * mesmo elemento rodam na ordem de registro, e é assim que o guarda aqui
   * consegue engolir o clique de um toque longo com `stopImmediatePropagation`.
   *
   * `describe` devolve o texto, ou `null` quando não há o que mostrar.
   */
  bindLongPress(
    el: HTMLElement,
    describe: () => string | null,
    delayMs: () => number = () => DEFAULT_LONG_PRESS,
  ): void {
    let fired = false;
    let startX = 0;
    let startY = 0;

    const cancel = (): void => {
      if (this.timer !== 0) {
        clearTimeout(this.timer);
        this.timer = 0;
      }
    };

    el.addEventListener('pointerdown', (e) => {
      // Mouse tem hover; segurar o botão ali é arraste de pilha, não consulta.
      if (e.pointerType === 'mouse') return;
      fired = false;
      startX = e.clientX;
      startY = e.clientY;
      cancel();
      this.timer = setTimeout(() => {
        this.timer = 0;
        const text = describe();
        if (text === null) return;
        fired = true;
        this.flash(text, startX, startY);
      }, delayMs()) as unknown as number;
    });

    el.addEventListener('pointermove', (e) => {
      if (e.pointerType === 'mouse' || this.timer === 0) return;
      if (Math.abs(e.clientX - startX) > SLOP_PX || Math.abs(e.clientY - startY) > SLOP_PX) {
        cancel();
      }
    });
    el.addEventListener('pointerup', cancel);
    el.addEventListener('pointercancel', cancel);

    // O guarda: engole o clique nascido de um toque longo.
    el.addEventListener('click', (e) => {
      if (!fired) return;
      fired = false;
      e.preventDefault();
      e.stopImmediatePropagation();
    });
  }

  private clearHide(): void {
    if (this.hideTimer !== 0) {
      clearTimeout(this.hideTimer);
      this.hideTimer = 0;
    }
  }
}
