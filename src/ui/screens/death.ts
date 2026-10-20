/**
 * Tela de morte (doc 08 §3.12).
 *
 * Overlay vermelho translúcido, a causa da morte em texto, e dois botões.
 * Precisa funcionar por toque, teclado e gamepad — no celular é a única forma
 * de voltar ao jogo.
 *
 * **M32:** uma ação principal (REAPARECER, verde e grande) e a saída
 * contornada, no tema único. Sem ✕: morto, não há "fechar" que faça sentido.
 */

import { t } from '../../core/i18n';
import { injectTheme, themedButton } from '../theme';

export interface DeathScreenCallbacks {
  onRespawn: () => void;
  onQuit: () => void;
}

export class DeathScreen {
  private readonly root: HTMLDivElement;
  private readonly message: HTMLParagraphElement;
  private readonly respawnButton: HTMLButtonElement;

  constructor(callbacks: DeathScreenCallbacks) {
    injectTheme();
    injectStyle();
    this.root = document.createElement('div');
    this.root.id = 'death-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    const title = document.createElement('h1');
    title.textContent = t('death.title');

    this.message = document.createElement('p');

    this.respawnButton = themedButton(t('death.respawn'), callbacks.onRespawn, 'primary', 'heart');
    this.respawnButton.classList.add('respawn');
    const quit = themedButton(t('death.quit'), callbacks.onQuit, 'danger', 'exit');

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

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#death-screen{position:fixed;inset:0;z-index:16;overflow:hidden;
  background:radial-gradient(ellipse at center,rgba(120,10,20,.55) 0%,rgba(40,0,6,.85) 100%);
  display:grid;place-content:center;justify-items:center;gap:12px;
  font-family:var(--cl-font);color:var(--cl-ink);text-align:center;padding:16px}
#death-screen[hidden]{display:none}
#death-screen h1{margin:0;font:900 clamp(30px,10vh,52px)/1 var(--cl-font);color:#fff;
  text-shadow:0 4px 0 #6b0d14,0 8px 18px rgba(0,0,0,.5)}
#death-screen p{margin:0;padding:4px 14px;border-radius:999px;background:rgba(0,0,0,.35);color:#ffd9db;
  font:700 14px/1.3 var(--cl-font)}
#death-screen .actions{display:flex;flex-direction:column;gap:10px;margin-top:6px;width:min(300px,80vw)}
#death-screen .respawn{min-height:clamp(56px,18vh,70px);font-size:21px;text-transform:uppercase;letter-spacing:1px;
  border-radius:16px}
#death-screen .cl-btn.danger{color:#ffd0d2;box-shadow:inset 0 0 0 2px #8a3a48}
`;
  document.head.appendChild(css);
}
