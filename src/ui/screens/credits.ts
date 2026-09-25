/**
 * Os créditos (doc 14 — M16): o fim da jornada.
 *
 * Aparecem uma vez, quando o jogador atravessa o portal de saída do End depois
 * de derrubar o dragão. Sobem devagar sobre o fundo escuro com o que a
 * jornada custou — os números do M10 (`data/stats.ts`) e as conquistas — e
 * um botão que volta ao jogo a qualquer momento. Com movimento reduzido nas
 * opções do sistema, não sobem: ficam parados, com rolagem.
 */

import { STATS, formatStat } from '../../data/stats';
import { t, tf } from '../../core/i18n';

export interface CreditsData {
  /** Valor de cada estatística, na ordem de `STATS`. */
  stats: ArrayLike<number>;
  achievements: number;
  achievementTotal: number;
  days: number;
}

export class CreditsScreen {
  private readonly root: HTMLDivElement;
  private readonly roll: HTMLDivElement;
  private readonly body: HTMLDivElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly onClose: () => void;

  constructor(onClose: () => void) {
    injectStyle();
    this.onClose = onClose;
    this.root = document.createElement('div');
    this.root.id = 'credits-screen';
    this.root.hidden = true;
    this.root.setAttribute('role', 'dialog');
    this.root.setAttribute('aria-modal', 'true');
    this.root.setAttribute('aria-label', t('credits.title'));

    this.roll = document.createElement('div');
    this.roll.className = 'roll';
    this.body = document.createElement('div');
    this.roll.appendChild(this.body);

    this.closeButton = document.createElement('button');
    this.closeButton.type = 'button';
    this.closeButton.textContent = t('common.continue');
    this.closeButton.addEventListener('click', () => this.hide());

    this.root.append(this.roll, this.closeButton);
    document.body.appendChild(this.root);
  }

  get isOpen(): boolean {
    return !this.root.hidden;
  }

  show(data: CreditsData): void {
    this.body.textContent = '';
    const line = (text: string, className = ''): void => {
      const el = document.createElement('p');
      if (className !== '') el.className = className;
      el.textContent = text;
      this.body.appendChild(el);
    };
    line(t('credits.end'), 'big');
    line(t('credits.dragon'));
    line(t('credits.world'));
    line(t('credits.journey'), 'head');
    line(tf(data.days === 1 ? 'credits.day' : 'credits.days', data.days));
    for (let i = 0; i < STATS.length; i++) {
      const value = data.stats[i] ?? 0;
      if (value <= 0) continue;
      line(`${STATS[i].display}: ${formatStat(STATS[i].unit, value)}`);
    }
    line(tf('credits.achievements', data.achievements, data.achievementTotal));
    line('CraftLite', 'head');
    line(t('credits.about1'));
    line(t('credits.about2'));
    line(t('credits.thanks'), 'head');
    // Recomeça a subida do topo a cada abertura.
    this.roll.classList.remove('rolling');
    void this.roll.offsetWidth;
    this.roll.classList.add('rolling');
    this.root.hidden = false;
    this.closeButton.focus();
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.onClose();
  }
}

let styleInjected = false;
function injectStyle(): void {
  if (styleInjected) return;
  styleInjected = true;
  const css = document.createElement('style');
  css.textContent = `
#credits-screen{position:fixed;inset:0;z-index:17;background:#07030c;overflow:hidden;
  display:flex;flex-direction:column;align-items:center;justify-content:space-between;
  font-family:ui-monospace,"Courier New",monospace;color:#e8e2f0;text-align:center;padding:16px}
#credits-screen .roll{flex:1;overflow:hidden;width:min(92vw,560px)}
#credits-screen .roll.rolling>div{animation:credits-roll 45s linear forwards}
#credits-screen p{margin:0 0 12px;font-size:14px;line-height:1.4}
#credits-screen p.big{font-size:clamp(32px,8vw,56px);margin:24px 0;color:#d69bf2;text-shadow:3px 3px 0 #000}
#credits-screen p.head{margin-top:28px;font-weight:700;color:#d69bf2}
#credits-screen button{min-width:200px;min-height:44px;padding:10px 18px;margin-top:12px;
  background:#6e6e6e;color:#fff;border:2px solid #000;font:14px/1 ui-monospace,monospace;cursor:pointer}
#credits-screen button:hover,#credits-screen button:focus-visible{background:#7b94c7;outline:2px solid #fff}
@keyframes credits-roll{from{transform:translateY(60vh)}to{transform:translateY(-100%)}}
@media (prefers-reduced-motion:reduce){
  #credits-screen .roll{overflow:auto}
  #credits-screen .roll.rolling>div{animation:none}
}
`;
  document.head.appendChild(css);
}
