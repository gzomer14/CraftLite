/**
 * Faixa de efeitos do HUD (2026-09-22): um selo por efeito ativo, com a cor
 * da tabela, o nome e o tempo que falta, e a vida extra da Absorção em
 * corações dourados.
 *
 * Fica fora de `hud.ts`, que já passa do tamanho de um módulo só. O custo por
 * quadro é uma comparação de número: o DOM só é tocado quando o conjunto de
 * efeitos muda (`StatusEffects.version`) ou quando o segundo exibido vira.
 */

import { EFFECTS } from '../data/effects';
import type { StatusEffects } from '../game/effects';

export class EffectsBar {
  readonly el: HTMLDivElement;
  private readonly hearts: HTMLDivElement;
  private readonly badges: HTMLDivElement[] = [];
  private readonly times: HTMLSpanElement[] = [];
  private lastVersion = -1;
  private lastAbsorption = -1;
  /** Segundo exibido por efeito, para só reescrever o texto quando ele vira. */
  private readonly lastSeconds = new Int32Array(EFFECTS.length).fill(-1);

  constructor() {
    injectStyle();
    this.el = document.createElement('div');
    this.el.className = 'effects';
    this.el.setAttribute('aria-live', 'polite');
    this.hearts = document.createElement('div');
    this.hearts.className = 'absorption';
    this.hearts.hidden = true;
    this.el.appendChild(this.hearts);
    for (const def of EFFECTS) {
      const badge = document.createElement('div');
      badge.className = def.harmful ? 'effect harmful' : 'effect';
      badge.hidden = true;
      badge.style.setProperty('--effect', `rgb(${def.color.join(',')})`);
      const name = document.createElement('span');
      name.textContent = def.display;
      const time = document.createElement('span');
      time.className = 'time';
      badge.append(name, time);
      this.el.appendChild(badge);
      this.badges.push(badge);
      this.times.push(time);
    }
  }

  update(effects: StatusEffects, absorption: number): void {
    const half = Math.ceil(absorption);
    if (half !== this.lastAbsorption) {
      this.lastAbsorption = half;
      this.hearts.hidden = half <= 0;
      this.hearts.textContent = '♥'.repeat(Math.ceil(half / 2));
      this.hearts.setAttribute('aria-label', `Vida extra: ${half}`);
    }
    if (effects.version !== this.lastVersion) {
      this.lastVersion = effects.version;
      for (let id = 0; id < this.badges.length; id++) {
        this.badges[id].hidden = !effects.has(id);
        this.lastSeconds[id] = -1;
      }
    }
    if (effects.active === 0) return;
    for (let id = 0; id < this.badges.length; id++) {
      if (!effects.has(id)) continue;
      const seconds = Math.ceil(effects.ticks[id] / 20);
      if (seconds === this.lastSeconds[id]) continue;
      this.lastSeconds[id] = seconds;
      const level = effects.level[id];
      const roman = level > 1 ? ` ${'I'.repeat(Math.min(level, 3))}` : '';
      const m = Math.floor(seconds / 60);
      const s = seconds % 60;
      this.times[id].textContent = `${roman} ${m}:${s < 10 ? '0' : ''}${s}`;
    }
  }
}

function injectStyle(): void {
  if (document.getElementById('effects-style') !== null) return;
  const css = document.createElement('style');
  css.id = 'effects-style';
  css.textContent = `
#hud .effects{position:absolute;top:calc(env(safe-area-inset-top,0px) + 8px);
right:calc(env(safe-area-inset-right,0px) + 8px);display:flex;flex-direction:column;
align-items:flex-end;gap:4px;pointer-events:none;font-size:calc(7 * var(--px,3px))}
#hud .effects .absorption{color:#f2c230;text-shadow:1px 1px 0 #000}
#hud .effects .effect{display:flex;gap:6px;align-items:center;padding:2px 6px;
background:rgba(0,0,0,.55);border-left:4px solid var(--effect);color:#fff;
text-shadow:1px 1px 0 #000}
#hud .effects .effect.harmful{box-shadow:inset 0 0 0 1px rgba(220,60,60,.8)}
#hud .effects .effect[hidden],#hud .effects .absorption[hidden]{display:none}
#hud .effects .time{opacity:.85}`;
  document.head.appendChild(css);
}
