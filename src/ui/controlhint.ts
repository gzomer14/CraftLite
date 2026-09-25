/**
 * A dica de controles que aparece ao entrar no mundo — teclado, toque ou o
 * controle ligado, com os rótulos do controle na mão. Saiu do `main.ts` em
 * 2026-09-22 (M13).
 */

import { t, tf } from '../core/i18n';
import type { Controls } from '../input/controls';
import type { Gamepads } from '../input/gamepad';
import type { TouchMode } from '../game/settings';

export function showHint(
  controls: Controls, isTouch: boolean, gamepads: Gamepads, touchMode: TouchMode,
): void {
  const hint = document.createElement('div');
  hint.id = 'hint';
  /*
   * O toque tem dois modos (doc 09 §2.2), e a dica descrevia só o A — "toque
   * longo quebra" — desde que o B virou o padrão (2026-09-14). No B quem
   * quebra é o botão ⛏, e o toque longo na tela não faz nada (M17).
   */
  const touchHint = touchMode === 'A' ? t('hint.touch') : t('hint.touch_b');
  const base = isTouch ? touchHint : t('hint.keyboard');
  hint.textContent = base;

  /*
   * A dica de controle só aparece quando há um ligado, e com os rótulos **do
   * controle na mão**: dizer "aperte A" para quem segura um DualSense manda o
   * jogador procurar um botão que não existe no aparelho dele.
   */
  const showPadHint = (): void => {
    if (!gamepads.connected) return;
    const l = gamepads.labels;
    hint.textContent = `${base}\n${tf(
      'hint.pad', l.faceDown, l.faceRight, l.l2, l.r2, l.faceUp, l.l1, l.r1, l.start, l.faceLeft,
    )}`;
  };
  gamepads.onConnect(showPadHint);
  showPadHint();

  document.body.appendChild(hint);
  const style = document.createElement('style');
  // `pre-line` porque a linha do controle entra como um segundo parágrafo.
  style.textContent = `#hint{position:fixed;left:50%;bottom:calc(30 * var(--px, 3px));
    transform:translateX(-50%);padding:6px 12px;background:#00000080;color:#fff;
    font:12px/1.4 ui-monospace,monospace;pointer-events:none;transition:opacity .3s;
    text-align:center;max-width:90vw;z-index:5;white-space:pre-line}`;
  document.head.appendChild(style);

  if (isTouch) {
    // No toque a dica some sozinha; não há pointer lock para servir de sinal.
    setTimeout(() => { hint.style.opacity = '0'; }, 6000);
  } else {
    controls.mouse.onLockChange = (locked) => { hint.style.opacity = locked ? '0' : '1'; };
    /*
     * Quem joga **só de controle** no computador nunca trava o ponteiro, e a
     * dica ficaria na tela para sempre. Com um controle ligado ela some pelo
     * relógio, como no toque — e um pouco mais devagar, porque ela tem uma
     * linha a mais para ler.
     */
    gamepads.onConnect(() => {
      setTimeout(() => {
        if (!controls.mouse.locked) hint.style.opacity = '0';
      }, 9000);
    });
  }
}
