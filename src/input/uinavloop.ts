import { NAV_STEP_MS, type UiNavigator } from './uinav';
import type { Gamepads } from './gamepad';
import type { SettingsStore } from '../game/settings';

/**
 * Laço da navegação de interface por controle.
 *
 * Roda em `requestAnimationFrame` próprio, e **não** no tick do jogo, porque a
 * tela de título existe muito antes de haver um `GameLoop`: sem isto, quem só
 * tem controle na mão não conseguiria nem entrar num mundo.
 *
 * Dentro do jogo ele continua rodando de graça — `tick` devolve `false` na
 * hora quando não há tela aberta, e o polling do controle é o mesmo que o
 * `Controls` já faria.
 */
export function startUiNavLoop(gamepads: Gamepads, uiNav: UiNavigator, settings: SettingsStore): void {
  /*
   * A navegação anda a ~20 Hz, não a 120: a repetição de `UiNavigator` é
   * contada em ticks, e num painel rápido a lista passaria seis vezes mais
   * depressa do que no lento. Amarrar ao relógio deixa o menu igual em
   * qualquer aparelho.
   */
  const stepMs = NAV_STEP_MS;
  let last = 0;
  const frame = (now: number): void => {
    requestAnimationFrame(frame);
    if (now - last < stepMs) return;
    last = now;
    gamepads.deadZone = settings.get('padDeadZone');
    gamepads.vibration = settings.get('vibration');
    // `pollNav` e não `poll`: a borda de subida é consumida no tick do jogo, e
    // lê-la aqui roubaria o aperto de lá.
    gamepads.pollNav();
    // Quem decide se o mundo recebe o analógico é esta linha: com uma tela
    // aberta, o controle é da tela.
    gamepads.uiCapture = uiNav.tick(gamepads.nav);
  };
  requestAnimationFrame(frame);
}
