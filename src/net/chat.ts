/**
 * Chat da sala (M20, doc 14: "chat curto, com teclado virtual no celular").
 *
 * No computador, `T` ou `Enter` abre a linha de digitar; `Enter` manda e `Esc`
 * desiste. No toque, o botão 💬 no canto abre a mesma linha, e o teclado do
 * aparelho sobe sozinho. As últimas mensagens ficam no canto de baixo e somem
 * em 10 s; com a linha aberta, todas as recentes aparecem.
 *
 * Só existe com a sala aberta. O texto entra como `textContent` — nunca HTML —
 * e com teto de tamanho, dos dois lados.
 */

import { t } from '../core/i18n';

/** Teto de uma mensagem, em caracteres. */
export const CHAT_MAX = 100;
/** Quanto uma mensagem fica visível fora da linha de digitar. */
const SHOW_MS = 10000;
/** Quantas mensagens ficam guardadas na tela. */
const KEEP = 30;

const STYLE = `#chat{position:fixed;left:8px;bottom:96px;width:min(440px,70vw);z-index:7;pointer-events:none;
font:14px/1.35 monospace;color:#fff}
#chat .lines div{background:#00000080;padding:1px 6px;margin-top:2px;width:fit-content;max-width:100%;
overflow-wrap:anywhere;transition:opacity .4s}
#chat .lines div.old{opacity:0}
#chat.typing .lines div.old{opacity:1}
#chat input{display:none;width:100%;margin-top:4px;box-sizing:border-box;font:inherit;color:#fff;
background:#000000b0;border:1px solid #ffffff60;padding:4px 6px;pointer-events:auto}
#chat.typing input{display:block}
#chat-open{position:fixed;left:8px;top:48px;z-index:7;width:40px;height:40px;border-radius:6px;
border:1px solid #ffffff60;background:#00000080;color:#fff;font-size:20px;pointer-events:auto}`;

/** Tela de toque: mostra o botão 💬 (no computador, `T` basta). */
export function touchScreen(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(pointer: coarse)').matches;
}

/** Limpa o que chegou pela rede: sem quebra de linha, sem controle, no teto. */
export function cleanChat(text: string): string {
  return text.replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, CHAT_MAX);
}

export class ChatBox {
  private readonly root: HTMLDivElement;
  private readonly lines: HTMLDivElement;
  private readonly input: HTMLInputElement;
  private readonly button: HTMLButtonElement;
  private readonly onKey: (e: KeyboardEvent) => void;

  /**
   * `send` recebe o texto já limpo. `touch` mostra o botão 💬 (no computador,
   * a tecla basta e o botão só atrapalharia a mira).
   */
  constructor(private readonly send: (text: string) => void, touch: boolean) {
    this.root = document.createElement('div');
    this.root.id = 'chat';
    const style = document.createElement('style');
    style.textContent = STYLE;
    this.lines = document.createElement('div');
    this.lines.className = 'lines';
    this.lines.setAttribute('aria-live', 'polite');
    this.input = document.createElement('input');
    this.input.maxLength = CHAT_MAX;
    this.input.placeholder = t('net.chat_placeholder');
    this.input.enterKeyHint = 'send';
    this.root.append(style, this.lines, this.input);
    this.button = document.createElement('button');
    this.button.id = 'chat-open';
    this.button.type = 'button';
    this.button.textContent = '💬';
    this.button.setAttribute('aria-label', t('net.chat_open'));
    this.button.hidden = !touch;
    this.button.addEventListener('click', () => this.open());
    document.body.append(this.root, this.button);

    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = cleanChat(this.input.value);
        if (text !== '') this.send(text);
        this.close();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.close();
      }
    });
    this.input.addEventListener('blur', () => this.close());
    // `T` ou `Enter` com o jogo na mão (mouse travado) abre a linha. O
    // `keydown` já foi para o jogo; a letra não, porque a linha abre depois.
    this.onKey = (e) => {
      if (this.typing || document.pointerLockElement === null) return;
      if (e.code !== 'KeyT' && e.code !== 'Enter') return;
      e.preventDefault();
      this.open();
    };
    window.addEventListener('keydown', this.onKey);
  }

  get typing(): boolean {
    return this.root.classList.contains('typing');
  }

  /** Uma linha nova: `who` em negrito, se houver. */
  add(who: string | null, text: string): void {
    const line = document.createElement('div');
    if (who !== null) {
      const name = document.createElement('b');
      name.textContent = `${who}: `;
      line.append(name);
    }
    line.append(text);
    this.lines.append(line);
    while (this.lines.childElementCount > KEEP) this.lines.firstElementChild?.remove();
    setTimeout(() => line.classList.add('old'), SHOW_MS);
  }

  open(): void {
    this.root.classList.add('typing');
    this.input.value = '';
    this.input.focus();
  }

  close(): void {
    if (!this.typing) return;
    this.root.classList.remove('typing');
    this.input.blur();
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKey);
    this.root.remove();
    this.button.remove();
  }
}
