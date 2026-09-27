/**
 * Tela cheia do computador com o teclado travado para o jogo.
 *
 * Correr é `Ctrl` + `W`, e `Ctrl`+`W` fecha a aba: o Chrome reserva esse
 * atalho (e `Ctrl`+`T`, `Ctrl`+`N`) e nenhuma página consegue segurá-lo com
 * `preventDefault`. A única porta é a Keyboard Lock API, que só vale com a
 * página em tela cheia **pedida por ela** — o F11 do navegador não conta,
 * porque a tela cheia é do navegador, e não da página. Por isso o F11 dentro
 * do jogo é do jogo: tela cheia pela página e teclado travado. Para sair,
 * F11 de novo, ou segurar `Esc` (o Chrome avisa no alto).
 *
 * Firefox e Safari não têm a API: lá a tela cheia vem sem a trava, e o
 * `Ctrl`+`W` continua do navegador. Os atalhos que não são reservados
 * (`Ctrl`+`D`, `Ctrl`+`S`…) o teclado do jogo segura em qualquer navegador
 * (`input/keyboard.ts`).
 *
 * Tudo falha em silêncio: sem API ou sem permissão, fica como estava.
 */

interface KeyboardLock {
  lock?: (codes?: string[]) => Promise<void>;
  unlock?: () => void;
}

function keyboardApi(): KeyboardLock | undefined {
  return (navigator as Navigator & { keyboard?: KeyboardLock }).keyboard;
}

/** Entra ou sai da tela cheia do jogo. Precisa vir de um gesto (a tecla). */
export function toggleGameFullscreen(): void {
  if (document.fullscreenElement !== null) {
    keyboardApi()?.unlock?.();
    void document.exitFullscreen().catch(() => undefined);
    return;
  }
  const root = document.documentElement;
  if (root.requestFullscreen === undefined) return;
  void root.requestFullscreen({ navigationUI: 'hide' })
    .then(() => keyboardApi()?.lock?.())
    .catch(() => undefined);
}
