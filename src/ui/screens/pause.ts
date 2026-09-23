/**
 * Menu de pausa (doc 08 §3.10) e a lista de conquistas (doc 08 §5).
 *
 * Em single-player a pausa para o mundo de verdade — diferente de abrir um
 * contêiner, que só libera o pointer lock.
 *
 * A lista de conquistas mora aqui, e não numa tela própria, porque é o que o
 * doc pede no menu e porque uma tela nova para 18 linhas de texto seria um
 * módulo a mais para manter sem nada de novo dentro.
 */

import { ACHIEVEMENTS, isUnlocked, objectiveFor } from '../../data/achievements';
import { ITEM_BY_NAME } from '../../data/items';
import { MOB_BY_NAME } from '../../data/mobs';
import { STATS, formatStat } from '../../data/stats';

export interface PauseMenuCallbacks {
  onResume: () => void;
  onOptions: () => void;
  onSaveAndQuit: () => void;
  /** Máscara de conquistas do jogador; sem ela o botão não aparece. */
  achievements?: () => number;
  /**
   * Modo de jogo atual e como trocá-lo. Os dois juntos, ou nenhum: sem saber
   * o modo não dá para escrever o rótulo do botão.
   */
  gameMode?: () => 'survival' | 'creative';
  onToggleMode?: () => void;
  /** Estatísticas, na ordem de `data/stats.ts` (M10); sem elas o botão some. */
  stats?: () => ArrayLike<number>;
  /** Espectador do Criativo (M10): estado e troca. O botão só aparece no Criativo. */
  spectator?: () => boolean;
  onToggleSpectator?: () => void;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly achievementList: HTMLDivElement;
  private readonly modeButton: HTMLButtonElement | null;
  private readonly statsList: HTMLDivElement;
  private readonly spectatorButton: HTMLButtonElement | null;
  private readonly callbacks: PauseMenuCallbacks;

  constructor(callbacks: PauseMenuCallbacks) {
    this.callbacks = callbacks;
    injectStyle();
    this.root = document.createElement('div');
    this.root.id = 'pause-menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');

    const title = document.createElement('h1');
    title.textContent = 'Pausado';

    this.status = document.createElement('p');

    this.achievementList = document.createElement('div');
    this.achievementList.className = 'achievements';
    this.achievementList.hidden = true;
    this.statsList = document.createElement('div');
    this.statsList.className = 'achievements stats';
    this.statsList.hidden = true;

    this.resumeButton = button('Voltar ao Jogo', callbacks.onResume);
    const options = button('Opções', callbacks.onOptions);
    const quit = button('Salvar e Sair', callbacks.onSaveAndQuit);

    /*
     * Trocar de modo **no mesmo mundo** (pedido de campo 2026-09-14).
     *
     * Ele mora na pausa e não nas opções porque é decisão de partida, e não
     * de preferência: vale para este mundo, e o save já guarda o modo junto da
     * meta desde o M4 — o que faltava era como mudá-lo sem criar outro mundo.
     */
    const toggle = callbacks.onToggleMode;
    this.modeButton = toggle === undefined || callbacks.gameMode === undefined
      ? null
      : button('Modo', () => { toggle(); this.refreshMode(); });

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(this.resumeButton);
    if (callbacks.achievements !== undefined) {
      actions.appendChild(button('Conquistas', () => this.toggleAchievements()));
    }
    if (callbacks.stats !== undefined) {
      actions.appendChild(button('Estatísticas', () => this.toggleStats()));
    }
    if (this.modeButton !== null) actions.appendChild(this.modeButton);
    const spectate = callbacks.onToggleSpectator;
    this.spectatorButton = spectate === undefined || callbacks.spectator === undefined
      ? null
      : button('Espectador', () => { spectate(); this.refreshMode(); });
    if (this.spectatorButton !== null) actions.appendChild(this.spectatorButton);
    actions.append(options, quit);

    this.root.append(title, this.status, actions, this.achievementList, this.statsList);
    document.body.appendChild(this.root);
  }

  /** Abre e fecha a tela de estatísticas (M10). */
  private toggleStats(): void {
    this.achievementList.hidden = true;
    if (!this.statsList.hidden) {
      this.statsList.hidden = true;
      return;
    }
    const values = this.callbacks.stats?.() ?? [];
    this.statsList.textContent = '';
    for (let i = 0; i < STATS.length; i++) {
      const def = STATS[i];
      const row = document.createElement('div');
      row.className = 'row unlocked';
      const name = document.createElement('strong');
      name.textContent = def.display;
      const value = document.createElement('span');
      value.textContent = formatStat(def.unit, values[i] ?? 0);
      row.append(name, value);
      this.statsList.appendChild(row);
    }
    this.statsList.hidden = false;
  }

  /** Abre e fecha a lista de conquistas (doc 08 §5). */
  private toggleAchievements(): void {
    this.statsList.hidden = true;
    if (!this.achievementList.hidden) {
      this.achievementList.hidden = true;
      return;
    }
    const mask = this.callbacks.achievements?.() ?? 0;
    const displayOf = (target: string): string =>
      ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;
    this.achievementList.textContent = '';
    for (const def of ACHIEVEMENTS) {
      const row = document.createElement('div');
      const unlocked = (mask & (1 << def.id)) !== 0;
      /*
       * O que aparece, e por quê.
       *
       * Antes **toda** conquista trancada era "???" com uma dica genérica
       * ("Consiga um certo item"), nas 18 linhas — a única tela que podia dizer
       * ao jogador o que fazer não dizia nada. Agora a árvore se revela um
       * passo à frente: sem `parent`, ou com o `parent` já obtido, a conquista
       * mostra nome e objetivo. O resto continua escondido, senão a lista
       * entrega o jogo inteiro de uma vez.
       */
      const revealed = unlocked || def.parent === undefined
        || isUnlocked(mask, def.parent);
      row.className = unlocked ? 'row unlocked' : revealed ? 'row next' : 'row';
      const name = document.createElement('strong');
      name.textContent = revealed ? def.display : '???';
      const detail = document.createElement('span');
      // Obtida mostra o texto de vitória; à vista mostra o que fazer.
      detail.textContent = unlocked
        ? def.description
        : revealed ? capitalize(objectiveFor(def, displayOf)) : hintFor(def.trigger);
      row.append(name, detail);
      this.achievementList.appendChild(row);
    }
    this.achievementList.hidden = false;
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.refreshMode();
    this.resumeButton.focus();
  }

  /**
   * O rótulo diz o que o botão **faz**, não onde o jogador está: "Mudar para
   * Criativo" não deixa dúvida de qual dos dois é o estado atual, e
   * "Modo: Criativo" deixa.
   */
  private refreshMode(): void {
    const spectator = this.spectatorButton;
    if (spectator !== null) {
      spectator.hidden = this.callbacks.gameMode?.() !== 'creative';
      const on = this.callbacks.spectator?.() === true;
      spectator.textContent = on ? 'Sair do Espectador' : 'Espectador';
      spectator.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const button = this.modeButton;
    const mode = this.callbacks.gameMode?.();
    if (button === null || mode === undefined) return;
    const next = mode === 'creative' ? 'Sobrevivência' : 'Criativo';
    button.textContent = `Mudar para ${next}`;
    button.setAttribute(
      'aria-label',
      `Modo atual: ${mode === 'creative' ? 'Criativo' : 'Sobrevivência'}. Mudar para ${next}.`,
    );
  }

  hide(): void {
    this.root.hidden = true;
    this.achievementList.hidden = true;
    this.statsList.hidden = true;
  }

  /** Mensagem de estado, como "salvando…". */
  setStatus(text: string): void {
    this.status.textContent = text;
  }
}

/** Dica genérica da conquista trancada, sem entregar o alvo. */
/** A frase de objetivo vem em minúscula para caber depois de "Objetivo —". */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function hintFor(trigger: string): string {
  if (trigger === 'obtain') return 'Consiga um certo item.';
  if (trigger === 'kill') return 'Derrube uma certa criatura.';
  if (trigger === 'place') return 'Coloque um certo bloco.';
  if (trigger === 'depth') return 'Desça mais fundo.';
  if (trigger === 'level') return 'Acumule experiência.';
  return 'Faça algo novo.';
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
#pause-menu{position:fixed;inset:0;z-index:15;background:#00000099;
  display:grid;place-content:center;justify-items:center;gap:14px;
  font-family:ui-monospace,"Courier New",monospace;color:#fff;text-align:center;padding:24px}
#pause-menu h1{margin:0;font-size:clamp(22px,5vw,36px);text-shadow:2px 2px 0 #000}
#pause-menu p{margin:0;min-height:1.2em;opacity:.75;font-size:12px}
#pause-menu .actions{display:flex;flex-direction:column;gap:8px}
#pause-menu button{min-width:200px;min-height:44px;padding:10px 18px;
  background:#6e6e6e;color:#fff;border:2px solid #000;
  box-shadow:inset 2px 2px 0 #ffffff40,inset -2px -2px 0 #00000040;
  font:14px/1 ui-monospace,monospace;cursor:pointer;
  -webkit-tap-highlight-color:transparent}
#pause-menu button:hover,#pause-menu button:focus-visible{background:#7b94c7;outline:2px solid #fff}
#pause-menu .achievements{display:grid;gap:4px;max-height:min(50vh,340px);overflow:auto;
  width:min(90vw,420px);padding:8px;background:#1c1420dd;border:2px solid #b46ee8;text-align:left}
#pause-menu .achievements .row{display:grid;gap:2px;padding:4px 6px;opacity:.45}
#pause-menu .achievements .row.unlocked{opacity:1;background:#00000055}
/* À vista mas não obtida: legível, sem competir com as que já são suas. */
#pause-menu .achievements .row.next{opacity:.8}
#pause-menu .achievements .row.next strong{color:#d9c27a}
#pause-menu .achievements strong{color:#f7d94c;font-size:13px}
#pause-menu .achievements span{color:#d8d0e0;font-size:11px}
`;
  document.head.appendChild(css);
}
