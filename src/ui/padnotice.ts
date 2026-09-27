/**
 * Aviso de controle conectado (doc 09 §3). Saiu do `main.ts` no M20.
 */

import { t, tf } from '../core/i18n';
import type { Gamepads } from '../input/gamepad';
import type { Hud } from './hud';

/**
 * Controle ligado: diz qual foi reconhecido, porque é a única forma de o
 * jogador saber que o rótulo dos botões mudou — e porque um controle que o
 * navegador **não** normalizou merece aviso, já que aí o mapeamento é
 * palpite de família e não a especificação.
 */
export function attachPadNotice(gamepads: Gamepads, hud: Hud, soundStarted: () => boolean): void {
  gamepads.onConnect((profile) => {
    hud.showMessage(tf('hud.pad_connected', profile.labels.family), 80);
    /*
     * O som não liga sozinho aqui.
     *
     * A política de autoplay pede um **gesto do usuário**, e aperto de botão de
     * controle não conta como gesto em navegador nenhum. Quem só tem o controle
     * na mão jogaria mudo sem entender por quê, então o jogo avisa o que fazer.
     */
    if (!soundStarted()) {
      hud.showMessage(t('hud.sound_gesture'), 120);
    }
  });
}
