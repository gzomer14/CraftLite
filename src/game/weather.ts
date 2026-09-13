/**
 * Clima e fases da lua (doc 03 §8).
 *
 * **Determinístico a partir da seed e do dia**, não sorteado no tick. Um estado
 * de clima com timer aleatório teria que ir para o save, e dois jogadores no
 * mesmo mundo (doc 12, M7) veriam chuvas diferentes. Aqui, `climaEm(dia)` é uma
 * função pura: o dia 37 daquela seed chove, sempre, para todo mundo, e o save
 * não ganha um campo sequer.
 *
 * O que o clima muda no jogo:
 * - **Céu escurece** e a luz do céu cai para 12 (doc 03 §8), o que faz hostil
 *   nascer de dia em lugar aberto — é o efeito que dá peso à tempestade.
 * - **Partículas verticais** em volta do jogador, emitidas pelo render.
 * - **Fases da lua** (8) mudam o teto de spawn de slime, como no gênero.
 */

import { TICKS_PER_DAY } from './daynight';
import { hash2 } from '../core/rng';

export type WeatherKind = 'clear' | 'rain' | 'thunder';

/** Chance de um dia ser chuvoso, e de a chuva virar tempestade. */
const RAIN_CHANCE = 0.28;
const THUNDER_CHANCE = 0.3;
/** Sal do RNG de clima. */
const SALT_WEATHER = 60;

/** Quantas fases a lua tem (doc 03 §8). */
export const MOON_PHASES = 8;

/** Luz do céu durante a chuva (doc 03 §8). */
export const RAIN_SKY_LIGHT = 12;

/**
 * A chuva não começa e acaba na virada do dia: ela ocupa uma **janela** dentro
 * dele, com início e duração sorteados. Sem isso, todo dia chuvoso começaria
 * exatamente ao amanhecer.
 */
const MIN_DURATION = 4000;
const MAX_DURATION = 14000;

export interface WeatherWindow {
  kind: WeatherKind;
  /** Tick do dia em que começa. */
  start: number;
  /** Tick do dia em que termina (pode passar de `TICKS_PER_DAY`). */
  end: number;
}

/** A janela de clima do dia `day` naquela seed. Pura e barata. */
export function weatherOfDay(seed: number, day: number): WeatherWindow {
  const roll = hash2(seed, day, 0, SALT_WEATHER);
  if (roll / 4294967296 >= RAIN_CHANCE) {
    return { kind: 'clear', start: 0, end: 0 };
  }
  const thunder = hash2(seed, day, 1, SALT_WEATHER) / 4294967296 < THUNDER_CHANCE;
  const start = (roll >>> 8) % (TICKS_PER_DAY - MIN_DURATION);
  const duration = MIN_DURATION
    + (hash2(seed, day, 2, SALT_WEATHER) % (MAX_DURATION - MIN_DURATION));
  return { kind: thunder ? 'thunder' : 'rain', start, end: start + duration };
}

/**
 * Estado de clima do mundo.
 *
 * Guarda só o dia e o tick correntes; tudo o mais é derivado. `intensity` é
 * 0..1 e sobe e desce nas bordas da janela, para a chuva não aparecer e sumir
 * num frame.
 */
export class Weather {
  /** Ticks de transição na entrada e na saída da chuva (15 s). */
  static readonly FADE_TICKS = 300;

  private seed = 0;
  private day = 0;
  private timeOfDay = 0;
  private window: WeatherWindow = { kind: 'clear', start: 0, end: 0 };

  /** Chamado quando o clima muda de categoria — som e aviso. */
  onChange: ((kind: WeatherKind) => void) | null = null;

  private lastKind: WeatherKind = 'clear';

  /**
   * A dimensão tem céu (`data/dimensions.ts`). Sem céu não chove.
   *
   * `hasSky` estava na tabela de dimensões desde que o Nether nasceu e **nada
   * no código a lia** — então chovia no Nether, com partícula caindo do teto de
   * rocha-mãe e névoa cinza por cima da vermelha (relato de campo 2026-09-13).
   * O corte é aqui, em `kind`, e não em cada efeito: `isRaining`, `intensity` e
   * o teto de luz do céu saem todos dele.
   */
  hasSky = true;

  setSeed(seed: number): void {
    this.seed = seed;
    this.window = weatherOfDay(seed, this.day);
  }

  /**
   * Atualiza a partir do relógio do mundo. `totalTicks` é o tempo absoluto
   * desde o início do mundo, que é o que dá o número do dia.
   */
  update(totalTicks: number): void {
    const day = Math.floor(totalTicks / TICKS_PER_DAY);
    if (day !== this.day) {
      this.day = day;
      this.window = weatherOfDay(this.seed, day);
    }
    this.timeOfDay = totalTicks - day * TICKS_PER_DAY;

    const kind = this.kind;
    if (kind !== this.lastKind) {
      this.lastKind = kind;
      this.onChange?.(kind);
    }
  }

  /** Clima agora. Fora da janela do dia é sempre `clear`. */
  get kind(): WeatherKind {
    if (!this.hasSky) return 'clear';
    if (this.window.kind === 'clear') return 'clear';
    if (this.timeOfDay < this.window.start || this.timeOfDay >= this.window.end) return 'clear';
    return this.window.kind;
  }

  get isRaining(): boolean {
    return this.kind !== 'clear';
  }

  get isThundering(): boolean {
    return this.kind === 'thunder';
  }

  /**
   * 0..1 de quanto a chuva está "ligada", com rampa nas bordas.
   * O render usa isso para a densidade das partículas e para escurecer o céu.
   */
  get intensity(): number {
    if (!this.hasSky || this.window.kind === 'clear') return 0;
    const { start, end } = this.window;
    if (this.timeOfDay < start || this.timeOfDay >= end) return 0;
    const inRamp = (this.timeOfDay - start) / Weather.FADE_TICKS;
    const outRamp = (end - this.timeOfDay) / Weather.FADE_TICKS;
    const level = Math.min(1, inRamp, outRamp);
    return Math.max(0, level) * (this.window.kind === 'thunder' ? 1 : 0.7);
  }

  /**
   * Teto de luz do céu com o clima atual (doc 03 §8).
   * É por aqui que a tempestade deixa hostil nascer de dia.
   */
  skyLightCap(base: number): number {
    if (!this.isRaining) return base;
    return Math.min(base, RAIN_SKY_LIGHT - Math.round(this.intensity * 4));
  }

  /** Fase da lua, 0..7. 0 = cheia (doc 03 §8). */
  get moonPhase(): number {
    return ((this.day % MOON_PHASES) + MOON_PHASES) % MOON_PHASES;
  }

  /**
   * Multiplicador do teto de slime pela fase da lua.
   *
   * Lua cheia dobra, lua nova zera — é o que faz valer a pena olhar para o céu
   * antes de descer para a caverna.
   */
  get slimeFactor(): number {
    return SLIME_BY_PHASE[this.moonPhase];
  }

  /** Dia corrente desde o início do mundo, para a tela de debug. */
  get dayNumber(): number {
    return this.day;
  }
}

/** Fator de slime por fase, de cheia (0) a nova (4) e de volta. */
const SLIME_BY_PHASE: readonly number[] = [2, 1.5, 1, 0.5, 0, 0.5, 1, 1.5];
