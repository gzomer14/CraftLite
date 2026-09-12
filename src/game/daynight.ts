/**
 * Ciclo dia/noite: 20 minutos reais = 24000 ticks (doc 03).
 *
 * O tempo é contado em ticks inteiros para ser determinístico e serializável;
 * o render usa só o `dayFactor` derivado.
 */

export const TICKS_PER_DAY = 24000;
const SUNRISE = 23000;
const DAY_START = 0;
const SUNSET = 12000;
const NIGHT_START = 13000;

export class DayNight {
  /** Tick atual dentro do dia, 0..23999. Nascer do sol em 23000, pôr em 12000. */
  time = 1000;
  /**
   * Ticks desde o início do mundo. É daqui que sai o **número do dia**, de que
   * o clima e a fase da lua dependem (doc 03 §8) — `time` sozinho não distingue
   * o dia 3 do dia 300.
   */
  totalTicks = 1000;

  tick(): void {
    this.time = (this.time + 1) % TICKS_PER_DAY;
    this.totalTicks++;
  }

  /** Dia inteiro desde o início do mundo. */
  get day(): number {
    return Math.floor(this.totalTicks / TICKS_PER_DAY);
  }

  /**
   * Move o relógio para um instante do dia **corrente** (dormir).
   * Mantém `totalTicks` coerente para o dia não voltar atrás.
   */
  setTimeOfDay(target: number): void {
    const wrapped = ((target % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
    const delta = wrapped - this.time;
    this.totalTicks += delta >= 0 ? delta : delta + TICKS_PER_DAY;
    this.time = wrapped;
  }

  /** 1 = pleno dia, 0 = plena noite, com transição suave no crepúsculo. */
  get dayFactor(): number {
    const t = this.time;
    if (t >= DAY_START && t < SUNSET) return 1;
    if (t >= NIGHT_START && t < SUNRISE) return 0;
    if (t >= SUNSET && t < NIGHT_START) return 1 - (t - SUNSET) / (NIGHT_START - SUNSET);
    return (t - SUNRISE) / (TICKS_PER_DAY - SUNRISE);
  }

  /** Hora legível para a tela de debug. */
  get clock(): string {
    const hours = Math.floor(((this.time + 6000) % TICKS_PER_DAY) / 1000);
    const minutes = Math.floor((((this.time + 6000) % 1000) / 1000) * 60);
    return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  }
}
