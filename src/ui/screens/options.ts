/**
 * Tela de opções (doc 08 §3.11).
 *
 * As configurações já eram persistidas desde o M3; o que faltava era **onde
 * mexer nelas**. Sem esta tela, volume, dificuldade e acessibilidade só existiam
 * para quem sabia editar o `localStorage`.
 *
 * Os campos são declarados como dados em `optionfields.ts` e ligados por
 * `buildFields` — acrescentar uma opção é uma linha naquelas listas.
 *
 * **M32 (interface nova):** era uma coluna só com as sete seções em fila, 4 mil
 * pixels de rolagem num celular deitado, e "Voltar" e "Restaurar padrões" lá
 * no fim. Agora são abas à esquerda (ícone e palavra), o ✕ e o "Restaurar
 * esta aba" sempre à vista no alto, e só a lista da aba aberta rola, dentro da
 * própria caixa. **Desvio consciente da regra 1 do M32** ("nada rola"): Vídeo
 * tem 19 campos e Controles tem as teclas; em 360 px de altura cabem cinco
 * linhas. A moldura não rola; a lista rola como a do livro de receitas.
 */

import { buildFields, buildKeybinds, menuButton, menuRoot, menuRow } from './menu';
import type { Keybinds } from '../../input/keybinds';
import type { Gamepads } from '../../input/gamepad';
import { PadTester } from './padtester';
import type { Settings, SettingsStore } from '../../game/settings';
import { t, tf } from '../../core/i18n';
import { closeButton, icon } from '../theme';
import { OPTION_TABS, type OptionTab } from './optionfields';

/** Uma aba montada: o botão da coluna, a lista e como reler os valores. */
interface BuiltTab {
  readonly spec: OptionTab;
  readonly button: HTMLButtonElement;
  readonly pane: HTMLDivElement;
}

export class OptionsScreen {
  private readonly root: HTMLDivElement;
  private readonly title: HTMLHeadingElement;
  private readonly tabs: BuiltTab[] = [];
  private readonly syncs: (() => void)[] = [];
  private readonly padStatus: HTMLParagraphElement;
  private readonly padTester = new PadTester();
  private readonly gamepads: Gamepads | null;
  private readonly settings: SettingsStore;
  private active = 0;
  private onClose: (() => void) | null = null;

  constructor(settings: SettingsStore, keybinds: Keybinds, gamepads: Gamepads | null = null) {
    this.settings = settings;
    this.gamepads = gamepads;
    this.padStatus = document.createElement('p');
    this.padStatus.className = 'menu-empty';
    this.padStatus.setAttribute('role', 'status');
    this.root = menuRoot('options-screen');
    injectOptionsStyle();

    const panel = document.createElement('div');
    panel.className = 'menu-panel options-panel';

    const nav = document.createElement('div');
    nav.className = 'opt-tabs';
    nav.setAttribute('role', 'tablist');
    const heading = document.createElement('h1');
    heading.textContent = t('opt.title');
    nav.appendChild(heading);

    const main = document.createElement('div');
    main.className = 'opt-main';
    const head = document.createElement('div');
    head.className = 'opt-head';
    this.title = document.createElement('h2');
    const saved = document.createElement('span');
    saved.className = 'saved';
    saved.textContent = t('opt.autosave');
    const reset = document.createElement('button');
    reset.type = 'button';
    reset.className = 'reset-tab';
    const resetLabel = document.createElement('span');
    resetLabel.textContent = t('opt.reset_tab');
    reset.append(icon('undo', 'currentColor', 18), resetLabel);
    reset.addEventListener('click', () => this.resetActive());
    head.append(this.title, saved, reset, closeButton(() => this.hide()));
    main.appendChild(head);

    for (let i = 0; i < OPTION_TABS.length; i++) {
      const spec = OPTION_TABS[i];
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'opt-tab';
      button.setAttribute('role', 'tab');
      const label = document.createElement('span');
      label.textContent = spec.label;
      button.append(icon(spec.icon, 'currentColor', 20), label);
      button.addEventListener('click', () => this.select(i));
      nav.appendChild(button);

      const pane = document.createElement('div');
      pane.className = 'opt-pane';
      pane.setAttribute('role', 'tabpanel');
      pane.hidden = true;
      for (const group of spec.groups) {
        if (group.title !== undefined) pane.appendChild(groupTitle(group.title));
        this.syncs.push(...buildFields(pane, settings, group.fields));
        /*
         * A primeira pergunta de quem liga um controle é "o jogo está vendo?",
         * e a segunda é "o jogo está vendo **este botão**?". A linha de estado
         * responde a primeira; o painel de teste, lendo o controle cru, sem
         * perfil nem remapeamento, responde a segunda — é o único jeito de
         * separar "o mapeamento está errado" de "o aparelho não manda esse
         * botão".
         */
        if (group.title === t('opt.gamepad')) pane.append(this.padStatus, this.padTester.element);
      }
      // As teclas fecham Controles: são a lista mais longa, e deixá-las no
      // fim mantém os campos no alto, onde se mexe mais.
      if (spec.id === 'controls') {
        pane.appendChild(groupTitle(t('opt.keys')));
        buildKeybinds(pane, keybinds);
      }
      /*
       * Recarregar é o mesmo caminho de "Restaurar padrões" de antes: com um
       * mundo aberto, o `beforeunload` grava a rede de segurança do save.
       */
      if (spec.id === 'language') {
        pane.appendChild(menuRow(menuButton(t('opt.language_apply'), () => location.reload(), 'primary')));
      }
      main.appendChild(pane);
      this.tabs.push({ spec, button, pane });
    }

    panel.append(nav, main);
    this.root.appendChild(panel);
    // Tocar fora do painel fecha (regra 2 do M32).
    this.root.addEventListener('pointerdown', (e) => {
      if ((e as Event).target === this.root) this.hide();
    });
    this.root.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') { e.stopPropagation(); this.hide(); }
    });
    // O atalho de gráficos escreve nuvens e partículas juntas: os controles
    // releem o que mudou por fora, sem remontar nada.
    settings.onChange(() => { if (!this.root.hidden) this.syncAll(); });
    this.select(0);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(onClose?: () => void): void {
    this.onClose = onClose ?? null;
    this.root.hidden = false;
    this.syncAll();
    this.refreshPadStatus();
    this.padTester.start();
    this.tabs[this.active].button.focus();
  }

  private select(index: number): void {
    this.active = index;
    for (let i = 0; i < this.tabs.length; i++) {
      const tab = this.tabs[i];
      const on = i === index;
      tab.pane.hidden = !on;
      tab.button.classList.toggle('on', on);
      tab.button.setAttribute('aria-selected', String(on));
    }
    this.title.textContent = this.tabs[index].spec.label;
  }

  /** Volta ao padrão só os campos da aba aberta, e relê todos. */
  private resetActive(): void {
    const keys: (keyof Settings)[] = [];
    for (const group of this.tabs[this.active].spec.groups) {
      for (const field of group.fields) keys.push(field.key);
    }
    this.settings.resetKeys(keys);
    this.syncAll();
  }

  private syncAll(): void {
    for (const sync of this.syncs) sync();
  }

  /** Diz se há controle ligado, qual é, e se o navegador o normalizou. */
  private refreshPadStatus(): void {
    const pads = this.gamepads;
    if (pads === null || !pads.connected) {
      this.padStatus.textContent = t('opt.no_pad');
      return;
    }
    const warning = pads.nonStandard ? t('opt.pad_nonstandard') : '';
    /*
     * A segunda frase não é curiosidade: num Android, o sistema entrega os
     * botões do controle como tecla e o navegador fica com alguns antes de a
     * página ver — no Chrome, `L1` e `R1` trocam de aba, e o jogo nunca os
     * recebe (confirmado em campo, 2026-09-14, com o painel lendo o controle
     * cru). Não há o que corrigir do lado do jogo; o que há é dizer qual é o
     * caminho que funciona, aqui, onde o jogador está procurando.
     */
    this.padStatus.textContent = tf('opt.pad_connected', pads.labels.family, warning);
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    // Sem isto o painel continuaria lendo o controle com a tela fechada.
    this.padTester.stop();
    this.onClose?.();
  }
}

function groupTitle(text: string): HTMLHeadingElement {
  const h = document.createElement('h3');
  h.textContent = text;
  return h;
}

let styleInjected = false;
function injectOptionsStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#options-screen{overflow:hidden;touch-action:none;padding:8px}
#options-screen .options-panel{display:flex;gap:14px;width:min(880px,100%);margin:0;padding:12px;
  height:min(560px,calc(100vh - 16px));height:min(560px,calc(100dvh - 16px))}
#options-screen .opt-tabs{flex:0 0 clamp(150px,24vw,200px);display:flex;flex-direction:column;gap:4px;min-height:0}
#options-screen .opt-tabs h1{margin:2px 4px 8px;font-size:20px}
#options-screen button.opt-tab{flex:0 0 auto;display:flex;align-items:center;justify-content:flex-start;gap:10px;
  min-height:40px;padding:0 12px;background:transparent;box-shadow:none;color:#cfdbef;font-size:14px;text-align:left}
#options-screen button.opt-tab.on{background:var(--cl-gold);color:#1a1406;box-shadow:0 4px 0 var(--cl-gold-low)}
#options-screen .opt-main{flex:1;min-width:0;display:flex;flex-direction:column;gap:8px;min-height:0}
#options-screen .opt-head{display:flex;align-items:center;gap:10px;flex:none}
#options-screen .opt-head h2{margin:0;font-size:16px;color:var(--cl-ink);text-transform:none;letter-spacing:0}
#options-screen .opt-head .saved{flex:1;font-size:12px;color:var(--cl-muted)}
#options-screen button.reset-tab{flex:none;display:flex;align-items:center;gap:6px;min-height:40px;padding:0 12px;
  background:transparent;box-shadow:inset 0 0 0 2px var(--cl-edge);color:#cfdbef;font-size:13px}
#options-screen .opt-head .cl-close{position:static}
#options-screen .opt-pane{flex:1;min-height:0;display:flex;flex-direction:column;gap:6px;overflow:auto;
  touch-action:pan-y;overscroll-behavior:contain;padding-right:2px}
#options-screen .opt-pane[hidden]{display:none}
#options-screen .opt-pane .menu-field{flex:none}
#options-screen .opt-pane h3{margin:8px 2px 0;font:800 12px/1.2 var(--cl-font);color:#9fb4d6;text-transform:uppercase;
  letter-spacing:.08em}
@media (max-width:700px){
  #options-screen .opt-head .saved{display:none}
  #options-screen .opt-head h2{flex:1}
}
`;
  document.head.appendChild(css);
}
