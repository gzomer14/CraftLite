/**
 * Tela de título (doc 08 §3.1).
 *
 * **Desvio consciente:** o doc pede um panorama girando ao fundo (estático em
 * T0). Aqui o fundo é um gradiente de céu com a silhueta do terreno em CSS: o
 * panorama exigiria manter o renderer vivo antes de existir mundo, e a tela de
 * título é justamente o momento em que o aparelho ainda está carregando tudo.
 */

import { menuButton, menuPanel, menuRoot } from './menu';

export interface TitleCallbacks {
  onPlay: () => void;
  onOptions: () => void;
}

export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;

  constructor(callbacks: TitleCallbacks) {
    this.root = menuRoot('title-screen');
    const { panel, body } = menuPanel('CraftLite');

    const tagline = document.createElement('p');
    tagline.className = 'tagline';
    tagline.textContent = 'minerar · craftar · sobreviver';

    this.playButton = menuButton('Jogar', callbacks.onPlay, 'primary');
    const options = menuButton('Opções', callbacks.onOptions);

    const footer = document.createElement('p');
    footer.className = 'footer';
    footer.textContent = 'Projeto independente, sem afiliação com nenhuma empresa de jogos.';

    body.append(tagline, this.playButton, options, footer);
    this.root.appendChild(panel);
    injectTitleStyle();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.playButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }
}

let styleInjected = false;
function injectTitleStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#title-screen{background:linear-gradient(#4a83d6 0%,#8ec5ff 55%,#3c6b34 55%,#2c4f27 100%)}
#title-screen .menu-panel{background:#1c2530e6}
#title-screen .tagline{margin:0 0 10px;text-align:center;opacity:.75;font-size:13px;
  letter-spacing:2px}
#title-screen .footer{margin:14px 0 0;text-align:center;opacity:.5;font-size:11px}
`;
  document.head.appendChild(css);
}
