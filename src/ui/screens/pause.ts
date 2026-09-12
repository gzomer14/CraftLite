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

export interface PauseMenuCallbacks {
  onResume: () => void;
  onOptions: () => void;
  onSaveAndQuit: () => void;
  /** Máscara de conquistas do jogador; sem ela o botão não aparece. */
  achievements?: () => number;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly achievementList: HTMLDivElement;
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

    this.resumeButton = button('Voltar ao Jogo', callbacks.onResume);
    const options = button('Opções', callbacks.onOptions);
    const quit = button('Salvar e Sair', callbacks.onSaveAndQuit);

    const actions = document.createElement('div');
    actions.className = 'actions';
    actions.append(this.resumeButton);
    if (callbacks.achievements !== undefined) {
      actions.appendChild(button('Conquistas', () => this.toggleAchievements()));
    }
    actions.append(options, quit);

    this.root.append(title, this.status, actions, this.achievementList);
    document.body.appendChild(this.root);
  }

  /** Abre e fecha a lista de conquistas (doc 08 §5). */
  private toggleAchievements(): void {
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
    this.resumeButton.focus();
  }

  hide(): void {
    this.root.hidden = true;
    this.achievementList.hidden = true;
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
