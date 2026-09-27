/**
 * Roda do mouse → casas da hotbar.
 *
 * Um evento por dente da roda era a suposição, e ela vale para mouse comum no
 * Windows (`deltaY` de 100 ou 120 por dente). Não vale para a roda de alta
 * resolução, o touchpad e o Chrome no Linux: um dente chega como **vários**
 * eventos pequenos, e cada evento andava uma casa. A casa final dependia de
 * quantos pedaços o sistema mandou — com nove, a seleção dava a volta inteira
 * e parava onde estava, e a roda parecia "às vezes não funcionar" (relato de
 * campo, 2026-09-27).
 *
 * Agora: evento grande (um dente de verdade) anda uma casa; eventos pequenos
 * somam até um dente e andam uma. Mudar de sentido ou parar um instante zera a
 * soma.
 */

/** O que conta como um dente, em pixels. */
const NOTCH_PX = 100;
/** Evento a partir deste tamanho já é um dente inteiro. */
const WHOLE_PX = 50;
/** Sem evento por este tempo, a soma recomeça. */
const IDLE_MS = 250;

export class WheelSteps {
  private sum = 0;
  private last = -Infinity;

  /** Casas a andar (−1, 0 ou 1) para um evento `wheel`. */
  step(deltaY: number, deltaMode: number, now: number): number {
    // `deltaMode`: 0 pixel, 1 linha, 2 página.
    const px = deltaMode === 1 ? deltaY * 40 : deltaMode === 2 ? deltaY * 800 : deltaY;
    if (px === 0) return 0;
    const dir = px > 0 ? 1 : -1;
    if (now - this.last > IDLE_MS || this.sum * dir < 0) this.sum = 0;
    this.last = now;
    if (px * dir >= WHOLE_PX) {
      this.sum = 0;
      return dir;
    }
    this.sum += px;
    if (this.sum * dir < NOTCH_PX) return 0;
    this.sum -= dir * NOTCH_PX;
    return dir;
  }
}
