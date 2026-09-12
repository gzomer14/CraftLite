/** O ciclo tem 24000 ticks (20 min a 20 Hz) e o dayFactor precisa ser contínuo. */
import { describe, expect, it } from 'vitest';
import { DayNight, TICKS_PER_DAY } from '../src/game/daynight';

describe('DayNight', () => {
  it('um dia tem 24000 ticks = 20 minutos a 20 Hz', () => {
    expect(TICKS_PER_DAY).toBe(24000);
    expect(TICKS_PER_DAY / 20 / 60).toBe(20);
  });

  it('dá a volta em 24000 ticks', () => {
    const d = new DayNight();
    d.time = TICKS_PER_DAY - 1;
    d.tick();
    expect(d.time).toBe(0);
  });

  it('é pleno dia no meio da manhã e plena noite à meia-noite', () => {
    const d = new DayNight();
    d.time = 6000;
    expect(d.dayFactor).toBe(1);
    d.time = 18000;
    expect(d.dayFactor).toBe(0);
  });

  it('o dayFactor fica sempre em [0,1] e sem saltos', () => {
    const d = new DayNight();
    let prev = d.dayFactor;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      d.time = t;
      const f = d.dayFactor;
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(1);
      expect(Math.abs(f - prev)).toBeLessThan(0.01);
      prev = f;
    }
  });

  it('escurece durante o pôr do sol', () => {
    const d = new DayNight();
    d.time = 12000;
    const start = d.dayFactor;
    d.time = 12800;
    expect(d.dayFactor).toBeLessThan(start);
  });
});
