/**
 * Clima e fases da lua (doc 03 §8).
 *
 * O que precisa ficar de pé: o clima é **função pura da seed e do dia**, não
 * estado sorteado no tick. Se isso quebrar, o save precisa de um campo novo e
 * dois jogadores no mesmo mundo veem chuvas diferentes.
 */
import { describe, expect, it } from 'vitest';
import { MOON_PHASES, RAIN_SKY_LIGHT, Weather, weatherOfDay } from '../src/game/weather';
import { DayNight, TICKS_PER_DAY } from '../src/game/daynight';

const SEED = 987654;

/** Percorre `days` dias e devolve a distribuição de climas. */
function distribution(days: number): Record<string, number> {
  const out: Record<string, number> = { clear: 0, rain: 0, thunder: 0 };
  for (let day = 0; day < days; day++) out[weatherOfDay(SEED, day).kind]++;
  return out;
}

describe('clima por dia', () => {
  it('é determinístico: o mesmo dia dá o mesmo clima', () => {
    for (let day = 0; day < 50; day++) {
      expect(weatherOfDay(SEED, day)).toEqual(weatherOfDay(SEED, day));
    }
  });

  it('seeds diferentes dão calendários diferentes', () => {
    const a = Array.from({ length: 60 }, (_, d) => weatherOfDay(SEED, d).kind).join('');
    const b = Array.from({ length: 60 }, (_, d) => weatherOfDay(SEED + 1, d).kind).join('');
    expect(a).not.toEqual(b);
  });

  it('a maioria dos dias é limpa, mas chove e troveja de vez em quando', () => {
    const counts = distribution(400);
    expect(counts.clear).toBeGreaterThan(counts.rain + counts.thunder);
    expect(counts.rain).toBeGreaterThan(0);
    expect(counts.thunder).toBeGreaterThan(0);
  });

  it('a janela de chuva cabe no dia e tem duração mínima', () => {
    for (let day = 0; day < 200; day++) {
      const window = weatherOfDay(SEED, day);
      if (window.kind === 'clear') continue;
      expect(window.start).toBeGreaterThanOrEqual(0);
      expect(window.start).toBeLessThan(TICKS_PER_DAY);
      expect(window.end - window.start).toBeGreaterThanOrEqual(4000);
    }
  });
});

describe('estado de clima', () => {
  /** Um `Weather` posicionado no meio da primeira janela de chuva da seed. */
  function insideRain(): { weather: Weather; day: number; middle: number } {
    const weather = new Weather();
    weather.setSeed(SEED);
    for (let day = 0; day < 200; day++) {
      const window = weatherOfDay(SEED, day);
      if (window.kind === 'clear') continue;
      const middle = Math.floor((window.start + Math.min(window.end, TICKS_PER_DAY)) / 2);
      weather.update(day * TICKS_PER_DAY + middle);
      return { weather, day, middle };
    }
    throw new Error('a seed de teste nunca chove');
  }

  it('chove dentro da janela e não chove fora dela', () => {
    const { weather, day } = insideRain();
    expect(weather.isRaining).toBe(true);

    // Um tick antes do início da janela ainda está seco.
    const window = weatherOfDay(SEED, day);
    weather.update(day * TICKS_PER_DAY + Math.max(0, window.start - 1));
    expect(weather.isRaining).toBe(false);
  });

  it('a intensidade sobe e desce nas bordas', () => {
    const { weather, day } = insideRain();
    const window = weatherOfDay(SEED, day);
    expect(weather.intensity).toBeGreaterThan(0);

    weather.update(day * TICKS_PER_DAY + window.start + 1);
    const edge = weather.intensity;
    weather.update(day * TICKS_PER_DAY + window.start + Weather.FADE_TICKS);
    expect(weather.intensity).toBeGreaterThan(edge);
  });

  it('a chuva derruba o teto de luz do céu (doc 03 §8)', () => {
    const { weather } = insideRain();
    expect(weather.skyLightCap(15)).toBeLessThanOrEqual(RAIN_SKY_LIGHT);

    const clear = new Weather();
    clear.setSeed(SEED);
    clear.update(0);
    if (!clear.isRaining) expect(clear.skyLightCap(15)).toBe(15);
  });

  it('avisa quando o clima muda de categoria, uma vez só', () => {
    const weather = new Weather();
    weather.setSeed(SEED);
    const changes: string[] = [];
    weather.onChange = (kind) => changes.push(kind);

    // Vinte dias: o bastante para a seed de teste passar por chuva e voltar.
    for (let t = 0; t < TICKS_PER_DAY * 20; t += 50) weather.update(t);
    expect(changes.length).toBeGreaterThan(0);
    // Nunca dois avisos iguais seguidos.
    for (let i = 1; i < changes.length; i++) expect(changes[i]).not.toBe(changes[i - 1]);
  });
});

describe('fases da lua', () => {
  it('percorre as 8 fases e volta', () => {
    const weather = new Weather();
    weather.setSeed(SEED);
    const seen = new Set<number>();
    for (let day = 0; day < MOON_PHASES * 2; day++) {
      weather.update(day * TICKS_PER_DAY);
      seen.add(weather.moonPhase);
    }
    expect(seen.size).toBe(MOON_PHASES);
  });

  it('lua cheia favorece slime e lua nova o impede', () => {
    const weather = new Weather();
    weather.setSeed(SEED);
    weather.update(0);
    expect(weather.moonPhase).toBe(0);
    expect(weather.slimeFactor).toBeGreaterThan(1);

    weather.update(TICKS_PER_DAY * 4);
    expect(weather.slimeFactor).toBe(0);
  });
});

describe('relógio do mundo', () => {
  it('conta dias inteiros além do tick do dia', () => {
    const clock = new DayNight();
    clock.totalTicks = 0;
    clock.time = 0;
    for (let i = 0; i < TICKS_PER_DAY * 3; i++) clock.tick();
    expect(clock.day).toBe(3);
    expect(clock.time).toBe(0);
  });

  it('dormir avança para o amanhecer sem voltar o dia', () => {
    const clock = new DayNight();
    clock.totalTicks = TICKS_PER_DAY * 2 + 14000;
    clock.time = 14000;
    clock.setTimeOfDay(23500);
    expect(clock.time).toBe(23500);
    expect(clock.day).toBe(2);

    // Dormir de madrugada leva para o amanhecer do dia seguinte.
    clock.setTimeOfDay(1000);
    expect(clock.day).toBe(3);
  });
});
