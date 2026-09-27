/**
 * Estado de teclado. Guarda as teclas em um `Uint8Array` indexado pelo
 * `keyCode` legado para consulta O(1) sem alocar no caminho quente.
 *
 * Usa `event.code` (posição física) e não `event.key`, para que WASD continue
 * funcionando em teclado AZERTY/ABNT.
 */

export type KeyAction = (down: boolean) => void;

export class Keyboard {
  private readonly down = new Set<string>();
  private readonly actions = new Map<string, KeyAction>();
  private readonly onDown: (e: KeyboardEvent) => void;
  private readonly onUp: (e: KeyboardEvent) => void;
  private readonly onBlur: () => void;
  /**
   * Teclas lidas por `isDown` (andar, pular, correr) que o navegador não pode
   * usar como atalho. Quem monta os controles decide — só durante o jogo.
   */
  claims: (code: string) => boolean = () => false;

  constructor(target: EventTarget = window) {
    this.onDown = (e) => {
      if (isTypingTarget(e.target)) return;
      const action = this.actions.get(e.code);
      // A tecla do jogo é do jogo **também na repetição e com Ctrl**: correr
      // (`Ctrl`) indo para a direita (`D`) repetia a tecla, a repetição
      // passava sem `preventDefault`, e o Chrome salvava a página nos
      // favoritos (relato de campo, 2026-09-27). `Ctrl`+`W` o Chrome não
      // entrega a página nenhuma: ver `input/keylock.ts`.
      if (action !== undefined || this.claims(e.code)) e.preventDefault();
      if (e.repeat) return;
      this.down.add(e.code);
      if (action !== undefined) action(true);
    };
    this.onUp = (e) => {
      this.down.delete(e.code);
      const action = this.actions.get(e.code);
      if (action !== undefined) action(false);
    };
    // Perder o foco com uma tecla pressionada deixaria o jogador andando sozinho.
    this.onBlur = () => this.down.clear();

    target.addEventListener('keydown', this.onDown as EventListener);
    target.addEventListener('keyup', this.onUp as EventListener);
    window.addEventListener('blur', this.onBlur);
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** Eixo -1/0/+1 a partir de duas teclas — evita `if` espalhado na física. */
  axis(negative: string, positive: string): number {
    return (this.down.has(positive) ? 1 : 0) - (this.down.has(negative) ? 1 : 0);
  }

  bind(code: string, action: KeyAction): void {
    if (code === '') return;
    this.actions.set(code, action);
  }

  /**
   * Desfaz um `bind`. É o que o remapeamento precisa: sem isto, trocar a tecla
   * de inventário de `E` para `I` deixaria as duas abrindo o inventário.
   */
  unbind(code: string): void {
    this.actions.delete(code);
  }

  dispose(target: EventTarget = window): void {
    target.removeEventListener('keydown', this.onDown as EventListener);
    target.removeEventListener('keyup', this.onUp as EventListener);
    window.removeEventListener('blur', this.onBlur);
  }
}

/** Não sequestra teclas enquanto o jogador digita o nome de um mundo. */
function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || target.isContentEditable;
}
