/**
 * Menu de pausa (doc 08 §3.10) e a lista de conquistas (doc 08 §5).
 *
 * Em single-player a pausa para o mundo de verdade — diferente de abrir um
 * contêiner, que só libera o pointer lock.
 *
 * A lista de conquistas mora aqui, e não numa tela própria, porque é o que o
 * doc pede no menu e porque uma tela nova para 18 linhas de texto seria um
 * módulo a mais para manter sem nada de novo dentro.
 *
 * **M32 (interface nova):** eram até oito botões cinza iguais, em coluna, e o
 * celular deitado precisava rolar. Agora são duas colunas que cabem em
 * 640×360: à esquerda a decisão (CONTINUAR, verde, e Salvar e Sair, contornado
 * de vermelho); à direita ladrilhos com ícone, palavra e uma linha que diz o
 * que há dentro ("7 de 18", "agora: Sobrevivência"). Conquistas e
 * estatísticas abrem **no lugar dos ladrilhos**, com "Voltar" — a lista rola
 * dentro da caixa, a tela não. Tocar fora do painel também continua o jogo.
 */

import { ACHIEVEMENTS, isUnlocked, objectiveFor } from '../../data/achievements';
import { STATS, formatStat } from '../../data/stats';
import { t, tf } from '../../core/i18n';
import { icon, injectTheme, themedButton } from '../theme';
import { displayOfTarget } from '../objectiveline';

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
  /** Sala na rede local (M20): abrir, ou ver quem está dentro. Sem ele, some. */
  onNetwork?: () => void;
  /** Rótulo do botão da rede, que muda com a sala aberta. */
  networkLabel?: () => string;
}

/** Ladrilho da direita: ícone, palavra e a linha que diz o que há dentro. */
interface Tile {
  readonly button: HTMLButtonElement;
  readonly label: HTMLSpanElement;
  readonly sub: HTMLSpanElement;
}

export class PauseMenu {
  private readonly root: HTMLDivElement;
  private readonly resumeButton: HTMLButtonElement;
  private readonly status: HTMLParagraphElement;
  private readonly tiles: HTMLDivElement;
  private readonly sheet: HTMLDivElement;
  private readonly sheetTitle: HTMLHeadingElement;
  private readonly sheetList: HTMLDivElement;
  private readonly achievementTile: Tile | null;
  private readonly modeTile: Tile | null;
  private readonly spectatorTile: Tile | null;
  private readonly networkTile: Tile | null;
  private readonly callbacks: PauseMenuCallbacks;

  constructor(callbacks: PauseMenuCallbacks) {
    this.callbacks = callbacks;
    injectTheme();
    injectStyle();
    this.root = document.createElement('div');
    this.root.id = 'pause-menu';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    // Tocar no escuro em volta continua o jogo (regra 2 do M32).
    this.root.addEventListener('pointerdown', (e) => {
      if ((e as Event).target === this.root) callbacks.onResume();
    });

    const panel = document.createElement('div');
    panel.className = 'pause-panel';

    const left = document.createElement('div');
    left.className = 'pause-left';
    const title = document.createElement('h1');
    title.textContent = t('pause.title');
    this.status = document.createElement('p');
    this.status.className = 'status';
    this.resumeButton = themedButton(t('pause.resume'), callbacks.onResume, 'primary', 'play');
    this.resumeButton.classList.add('resume');
    const quit = themedButton(t('pause.save_quit'), callbacks.onSaveAndQuit, 'danger', 'exit');
    left.append(title, this.resumeButton, quit, this.status);

    this.tiles = document.createElement('div');
    this.tiles.className = 'pause-tiles';
    this.tiles.appendChild(
      makeTile(t('opt.title'), 'gear', '#ffd75a', t('pause.options_hint'), callbacks.onOptions).button,
    );
    this.achievementTile = callbacks.achievements === undefined
      ? null
      : makeTile(t('pause.achievements'), 'trophy', '#ffc83d', '', () => this.openAchievements());
    if (this.achievementTile !== null) this.tiles.appendChild(this.achievementTile.button);
    if (callbacks.stats !== undefined) {
      this.tiles.appendChild(
        makeTile(t('pause.stats'), 'chart', '#7fc8ff', '', () => this.openStats()).button,
      );
    }
    const network = callbacks.onNetwork;
    this.networkTile = network === undefined
      ? null
      : makeTile(t('net.open_room'), 'people', '#9be38b', t('pause.room_hint'), network);
    if (this.networkTile !== null) this.tiles.appendChild(this.networkTile.button);

    /*
     * Trocar de modo **no mesmo mundo** (pedido de campo 2026-09-14).
     *
     * Ele mora na pausa e não nas opções porque é decisão de partida, e não
     * de preferência: vale para este mundo, e o save já guarda o modo junto da
     * meta desde o M4 — o que faltava era como mudá-lo sem criar outro mundo.
     */
    const toggle = callbacks.onToggleMode;
    this.modeTile = toggle === undefined || callbacks.gameMode === undefined
      ? null
      : makeTile(t('pause.mode'), 'cube', '#c9a7ff', '', () => { toggle(); this.refreshMode(); });
    if (this.modeTile !== null) this.tiles.appendChild(this.modeTile.button);
    const spectate = callbacks.onToggleSpectator;
    this.spectatorTile = spectate === undefined || callbacks.spectator === undefined
      ? null
      : makeTile(t('mode.spectator'), 'search', '#f59ad0', '', () => { spectate(); this.refreshMode(); });
    if (this.spectatorTile !== null) this.tiles.appendChild(this.spectatorTile.button);

    // A folha que ocupa o lugar dos ladrilhos: conquistas ou estatísticas.
    this.sheet = document.createElement('div');
    this.sheet.className = 'pause-sheet';
    this.sheet.hidden = true;
    const sheetHead = document.createElement('div');
    sheetHead.className = 'sheet-head';
    const back = themedButton(t('common.back'), () => this.closeSheet(), 'secondary', 'back');
    back.classList.add('back');
    this.sheetTitle = document.createElement('h2');
    sheetHead.append(back, this.sheetTitle);
    this.sheetList = document.createElement('div');
    this.sheetList.className = 'achievements';
    this.sheet.append(sheetHead, this.sheetList);

    const right = document.createElement('div');
    right.className = 'pause-right';
    right.append(this.tiles, this.sheet);
    panel.append(left, right);
    this.root.appendChild(panel);
    document.body.appendChild(this.root);
  }

  private openSheet(title: string): void {
    this.sheetTitle.textContent = title;
    this.sheetList.textContent = '';
    this.tiles.hidden = true;
    this.sheet.hidden = false;
  }

  private closeSheet(): void {
    this.sheet.hidden = true;
    this.tiles.hidden = false;
  }

  /** Estatísticas (M10), no lugar dos ladrilhos. */
  private openStats(): void {
    this.openSheet(t('pause.stats'));
    this.sheetList.className = 'achievements stats';
    const values = this.callbacks.stats?.() ?? [];
    for (let i = 0; i < STATS.length; i++) {
      const def = STATS[i];
      this.sheetList.appendChild(row('row unlocked', def.display, formatStat(def.unit, values[i] ?? 0)));
    }
  }

  /** A lista de conquistas (doc 08 §5), no lugar dos ladrilhos. */
  private openAchievements(): void {
    this.openSheet(t('pause.achievements'));
    this.sheetList.className = 'achievements';
    const mask = this.callbacks.achievements?.() ?? 0;
    for (const def of ACHIEVEMENTS) {
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
      // Obtida mostra o texto de vitória; à vista mostra o que fazer.
      const detail = unlocked
        ? def.description
        : revealed ? capitalize(objectiveFor(def, displayOfTarget)) : hintFor(def.trigger);
      this.sheetList.appendChild(row(
        unlocked ? 'row unlocked' : revealed ? 'row next' : 'row',
        revealed ? def.display : '???',
        detail,
      ));
    }
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(): void {
    this.root.hidden = false;
    this.closeSheet();
    this.refreshMode();
    const label = this.callbacks.networkLabel;
    if (this.networkTile !== null && label !== undefined) this.networkTile.label.textContent = label();
    const achievements = this.callbacks.achievements;
    if (this.achievementTile !== null && achievements !== undefined) {
      this.achievementTile.sub.textContent = tf('pause.of', countBits(achievements()), ACHIEVEMENTS.length);
    }
    this.resumeButton.focus();
  }

  /**
   * O rótulo diz o que o botão **faz**, não onde o jogador está: "Mudar para
   * Criativo" não deixa dúvida de qual dos dois é o estado atual, e
   * "Modo: Criativo" deixa. A linha de baixo ("agora: …") confirma o atual.
   */
  private refreshMode(): void {
    const spectator = this.spectatorTile;
    if (spectator !== null) {
      spectator.button.hidden = this.callbacks.gameMode?.() !== 'creative';
      const on = this.callbacks.spectator?.() === true;
      spectator.label.textContent = on ? t('pause.leave_spectator') : t('mode.spectator');
      spectator.button.setAttribute('aria-pressed', on ? 'true' : 'false');
    }
    const tile = this.modeTile;
    const mode = this.callbacks.gameMode?.();
    if (tile === null || mode === undefined) return;
    const now = mode === 'creative' ? t('mode.creative') : t('mode.survival');
    const next = mode === 'creative' ? t('mode.survival') : t('mode.creative');
    tile.label.textContent = tf('pause.switch_to', next);
    tile.sub.textContent = tf('pause.mode_now', now);
    tile.button.setAttribute('aria-label', tf('pause.mode_aria', now, next));
  }

  hide(): void {
    this.root.hidden = true;
    this.closeSheet();
  }

  /** Mensagem de estado, como "salvando…". */
  setStatus(text: string): void {
    this.status.textContent = text;
  }
}

function makeTile(
  label: string, iconName: string, color: string, sub: string, onClick: () => void,
): Tile {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'tile';
  const labelEl = document.createElement('span');
  labelEl.className = 'label';
  labelEl.textContent = label;
  const subEl = document.createElement('span');
  subEl.className = 'sub';
  subEl.textContent = sub;
  button.append(icon(iconName, color, 24), labelEl, subEl);
  button.addEventListener('click', onClick);
  return { button, label: labelEl, sub: subEl };
}

function row(className: string, title: string, detail: string): HTMLDivElement {
  const el = document.createElement('div');
  el.className = className;
  const name = document.createElement('strong');
  name.textContent = title;
  const text = document.createElement('span');
  text.textContent = detail;
  el.append(name, text);
  return el;
}

function countBits(mask: number): number {
  let n = 0;
  for (let m = mask >>> 0; m !== 0; m &= m - 1) n++;
  return n;
}

/** A frase de objetivo vem em minúscula para caber depois de "Objetivo —". */
function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

/** Dica genérica da conquista trancada, sem entregar o alvo. */
function hintFor(trigger: string): string {
  if (trigger === 'obtain') return t('pause.hint_obtain');
  if (trigger === 'kill') return t('pause.hint_kill');
  if (trigger === 'place') return t('pause.hint_place');
  if (trigger === 'depth') return t('pause.hint_depth');
  if (trigger === 'level') return t('pause.hint_level');
  return t('pause.hint_event');
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  /*
   * Celular deitado (campo, 2026-09-23): a página inteira tem
   * touch-action:none (doc 09 §2.3), então nada aqui pode depender de rolar a
   * tela. O painel é medido para 640×360; só a lista de conquistas rola, por
   * dentro da própria caixa (pan-y nela).
   */
  css.textContent = `
#pause-menu{position:fixed;inset:0;z-index:15;background:var(--cl-dim);display:grid;place-items:center;
  overflow:hidden;padding:8px;font-family:var(--cl-font);color:var(--cl-ink)}
#pause-menu[hidden]{display:none}
#pause-menu .pause-panel{display:flex;gap:16px;width:min(720px,100%);max-height:100%;padding:16px;
  border-radius:20px;background:var(--cl-panel);box-shadow:0 0 0 2px var(--cl-edge),0 18px 40px rgba(0,0,0,.5)}
#pause-menu .pause-left{flex:0 0 clamp(190px,34%,250px);display:flex;flex-direction:column;gap:10px;
  justify-content:center}
#pause-menu h1{margin:0 0 2px;font:900 13px/1 var(--cl-font);letter-spacing:3px;text-transform:uppercase;
  color:var(--cl-gold)}
#pause-menu .resume{min-height:clamp(60px,22vh,86px);font-size:22px;letter-spacing:1px;text-transform:uppercase;
  border-radius:16px}
#pause-menu .resume .cl-icon{width:26px;height:26px}
#pause-menu .status{margin:0;min-height:1.2em;color:var(--cl-muted);font:600 12px/1.2 var(--cl-font)}
#pause-menu .pause-right{flex:1;min-width:0;display:flex;flex-direction:column;min-height:0}
#pause-menu .pause-tiles{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px;align-content:center;
  flex:1}
#pause-menu .pause-tiles[hidden],#pause-menu .pause-sheet[hidden],#pause-menu .tile[hidden]{display:none}
#pause-menu .tile{display:grid;grid-template-columns:auto 1fr;grid-template-rows:auto auto;column-gap:10px;
  align-items:center;text-align:left;min-height:clamp(52px,17vh,64px);padding:8px 12px;border:0;border-radius:14px;
  background:var(--cl-raise);color:var(--cl-ink);cursor:pointer;
  box-shadow:0 4px 0 var(--cl-raise-low),inset 0 2px 0 rgba(255,255,255,.12)}
#pause-menu .tile .cl-icon{grid-row:1 / span 2}
#pause-menu .tile .label{font:800 14px/1.15 var(--cl-font)}
#pause-menu .tile .sub{font:600 11px/1.2 var(--cl-font);color:var(--cl-muted)}
#pause-menu .tile .sub:empty{display:none}
#pause-menu .tile:hover,#pause-menu .tile:focus-visible{filter:brightness(1.12);outline:none}
#pause-menu .tile:focus-visible{box-shadow:0 4px 0 var(--cl-raise-low),0 0 0 3px var(--cl-gold)}
#pause-menu .tile:active{transform:translateY(3px);box-shadow:0 1px 0 var(--cl-raise-low)}
#pause-menu .tile[aria-pressed=true]{background:#4a3a14;box-shadow:0 4px 0 var(--cl-gold-low)}
#pause-menu .pause-sheet{display:flex;flex-direction:column;gap:8px;flex:1;min-height:0}
#pause-menu .sheet-head{display:flex;align-items:center;gap:12px}
#pause-menu .sheet-head .back{min-height:40px;padding:0 12px}
#pause-menu h2{margin:0;font:800 16px/1 var(--cl-font)}
#pause-menu .achievements{display:grid;gap:4px;align-content:start;flex:1;min-height:0;
  max-height:calc(100vh - 128px);overflow:auto;touch-action:pan-y;overscroll-behavior:contain;
  padding:6px;border-radius:12px;background:var(--cl-slot)}
#pause-menu .achievements .row{display:grid;gap:2px;padding:6px 8px;border-radius:8px;opacity:.45}
#pause-menu .achievements .row.unlocked{opacity:1;background:var(--cl-raise)}
/* À vista mas não obtida: legível, sem competir com as que já são suas. */
#pause-menu .achievements .row.next{opacity:.85}
#pause-menu .achievements .row.next strong{color:#d9c27a}
#pause-menu .achievements strong{color:var(--cl-gold);font-size:13px}
#pause-menu .achievements span{color:#cdd6e6;font-size:11px}
#pause-menu .stats .row{grid-template-columns:1fr auto;align-items:center}
#pause-menu .stats strong{color:var(--cl-ink)}
@media (max-height:420px){
  #pause-menu .pause-panel{padding:12px;gap:12px}
  #pause-menu .pause-tiles{gap:8px}
}
`;
  document.head.appendChild(css);
}
