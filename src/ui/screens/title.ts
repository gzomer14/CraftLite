/**
 * Tela de título (doc 08 §3.1).
 *
 * **Desvio consciente:** o doc pede um panorama girando ao fundo (estático em
 * T0). Aqui o fundo é um céu com a silhueta do terreno em CSS: o panorama
 * exigiria manter o renderer vivo antes de existir mundo, e a tela de título é
 * justamente o momento em que o aparelho ainda está carregando tudo.
 *
 * **M32 (interface nova):** eram cinco botões iguais empilhados, e num celular
 * deitado o último ficava fora da tela. Agora há **uma** ação principal — o
 * JOGAR, que continua o último mundo — e os atalhos numa fileira de ladrilhos
 * com ícone e palavra. Cabe em 640×360 sem rolar.
 */

import { menuRoot } from './menu';
import { icon } from '../theme';
import { t, tf } from '../../core/i18n';

export interface TitleCallbacks {
  /** JOGAR: continua o último mundo, ou abre a lista quando não há nenhum. */
  onPlay: () => void;
  /** A lista de mundos (M32: atalho próprio, já que JOGAR continua). */
  onWorlds: () => void;
  onOptions: () => void;
  /** Pacote de texturas do jogador (M7). */
  onPacks: () => void;
  /** Mods (M21). */
  onMods: () => void;
  /** Entrar numa sala na rede local (M20). */
  onJoin: () => void;
}

export class TitleScreen {
  private readonly root: HTMLDivElement;
  private readonly playButton: HTMLButtonElement;
  private readonly playSub: HTMLSpanElement;

  constructor(callbacks: TitleCallbacks) {
    this.root = menuRoot('title-screen');
    const stage = document.createElement('div');
    stage.className = 'title-stage';

    const logo = document.createElement('h1');
    logo.className = 'logo';
    logo.textContent = 'CraftLite';

    const tagline = document.createElement('p');
    tagline.className = 'tagline';
    tagline.textContent = t('title.tagline');

    this.playButton = document.createElement('button');
    this.playButton.type = 'button';
    this.playButton.className = 'primary play';
    const label = document.createElement('span');
    label.className = 'label';
    label.textContent = t('worlds.play');
    this.playSub = document.createElement('span');
    this.playSub.className = 'sub';
    this.playSub.textContent = t('title.first');
    const words = document.createElement('span');
    words.className = 'words';
    words.append(label, this.playSub);
    this.playButton.append(icon('play', '#fff', 28), words);
    this.playButton.addEventListener('click', callbacks.onPlay);

    const tiles = document.createElement('div');
    tiles.className = 'tiles';
    tiles.append(
      tile(t('title.worlds'), 'globe', '#7fc8ff', callbacks.onWorlds),
      tile(t('title.together'), 'people', '#9be38b', callbacks.onJoin),
      tile(t('opt.title'), 'gear', '#ffd75a', callbacks.onOptions),
      tile(t('title.packs'), 'palette', '#f59ad0', callbacks.onPacks),
      tile(t('title.mods'), 'puzzle', '#c9a7ff', callbacks.onMods),
    );

    const footer = document.createElement('p');
    footer.className = 'footer';
    footer.textContent = t('title.footer');

    stage.append(logo, tagline, this.playButton, tiles);
    this.root.append(stage, footer);
    injectTitleStyle();
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  /** O nome do mundo que o JOGAR continua; `null` quando ainda não há mundo. */
  setContinue(name: string | null): void {
    this.playSub.textContent = name === null ? t('title.first') : tf('title.continue', name);
  }

  show(): void {
    this.root.hidden = false;
    this.playButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
  }
}

/** Atalho: ícone colorido em cima, palavra embaixo (regra 5 do M32). */
function tile(label: string, iconName: string, color: string, onClick: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  const text = document.createElement('span');
  text.textContent = label;
  button.append(icon(iconName, color, 26), text);
  button.addEventListener('click', onClick);
  return button;
}

let styleInjected = false;
function injectTitleStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#title-screen{overflow:hidden;background:
  radial-gradient(ellipse at center,rgba(8,14,28,.1) 0%,rgba(8,14,28,.55) 100%),
  linear-gradient(#3d7fe0 0%,#8cc8ff 56%,#4fae3c 56%,#4fae3c 62%,#6b4a2c 62%,#4b331e 100%)}
#title-screen .title-stage{display:flex;flex-direction:column;align-items:center;gap:12px;padding:8px}
#title-screen .logo{margin:0;font:900 clamp(40px,10vh,68px)/1 var(--cl-font);letter-spacing:2px;color:#ffd75a;
  text-shadow:0 4px 0 #a2620e,0 8px 0 #3b2307,0 10px 18px rgba(0,0,0,.45)}
#title-screen .tagline{margin:0;padding:4px 12px;border-radius:999px;background:rgba(8,14,28,.55);color:#cfe0ff;
  font:800 12px/1.2 var(--cl-font);letter-spacing:3px;text-transform:uppercase}
#title-screen button.play{flex:none;display:flex;align-items:center;justify-content:center;gap:14px;
  width:min(360px,80vw);min-height:clamp(54px,16vh,66px);margin-top:4px;border-radius:16px;
  box-shadow:0 6px 0 var(--cl-green-low),0 10px 22px rgba(0,0,0,.35),inset 0 2px 0 rgba(255,255,255,.35)}
#title-screen .play .words{display:flex;flex-direction:column;align-items:flex-start;line-height:1.1}
#title-screen .play .label{font:900 26px/1 var(--cl-font);letter-spacing:1px;text-transform:uppercase}
#title-screen .play .sub{font:700 12px/1.2 var(--cl-font);opacity:.92;max-width:230px;overflow:hidden;
  text-overflow:ellipsis;white-space:nowrap}
#title-screen .tiles{display:flex;gap:10px;flex-wrap:wrap;justify-content:center;margin-top:4px}
#title-screen button.tile{flex:none;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:6px;
  width:96px;height:clamp(64px,19vh,78px);padding:0 4px;border-radius:14px;font:800 13px/1.1 var(--cl-font);
  box-shadow:0 4px 0 var(--cl-raise-low),inset 0 2px 0 rgba(255,255,255,.12)}
#title-screen .footer{position:absolute;left:0;right:0;bottom:6px;margin:0;text-align:center;color:#d6e2f5;
  font:600 11px/1.2 var(--cl-font)}
`;
  document.head.appendChild(css);
}
