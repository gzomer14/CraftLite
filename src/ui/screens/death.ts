/**
 * Tela de morte (doc 08 §3.12).
 *
 * Overlay vermelho translúcido, a causa da morte em texto, e dois botões.
 * Precisa funcionar por toque, teclado e gamepad — no celular é a única forma
 * de voltar ao jogo.
 */

export interface DeathScreenCallbacks {
  onRespawn: () => void;
  onQuit: () => void;
}

export class DeathScreen {
  private readonly root: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private readonly respawnButton: HTMLButtonElement;

  constructor(callbacks: DeathScreenCallbacks) {
    injectStyle();
    this.root = document.createElement('div');
    this.root.id = 'death-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    const title = document.createElement('h1');
    title.textContent = 'Você morreu!';

    this.message = document.createElement('p');

    this.respawnButton = button('Reaparecer', callbacks.onRespawn);
    const quit = button('Sair do Mundo', callbacks.onQuit);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(this.respawnButton, quit);

    this.root.append(title, this.message, actions);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(cause: string): void {
    this.message.textContent = cause;
    this.root.hidden = false;
    // O foco vai para "Reaparecer": Enter ou A do gamepad volta ao jogo.
    this.respawnButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }
}

function button(label: string, onClick: () => void): HTMLButtonElement {
  const el = document.createElement('button');
  el.type = 'button';
  el.textContent = label;
  el.addEventListener('click', onClick);
  return el;
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#death-screen{position:fixed;inset:0;z-index:16;background:#5a0000a0;
  display:grid;place-content:center;justify-items:center;gap:16px;
  font-family:ui-monospace,"Courier New",monospace;color:#fff;text-align:center;padding:24px}
#death-screen h1{margin:0;font-size:clamp(28px,6vw,48px);text-shadow:2px 2px 0 #000}
#death-screen p{margin:0;opacity:.85;font-size:14px}
#death-screen .actions{display:flex;flex-direction:column;gap:8px;margin-top:8px}
#death-screen button{min-width:200px;min-height:44px;padding:10px 18px;
  background:#6e6e6e;color:#fff;border:2px solid #000;
  box-shadow:inset 2px 2px 0 #ffffff40,inset -2px -2px 0 #00000040;
  font:14px/1 ui-monospace,monospace;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
#death-screen button:hover,#death-screen button:focus-visible{background:#7b94c7;outline:2px solid #fff}
`;
  document.head.appendChild(css);
}
