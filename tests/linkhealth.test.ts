/**
 * Quando a ligação da sala caiu de verdade (relato de campo de 2026-09-28: com
 * um J7 Metal de anfitrião, o convidado caía a cada 2–3 minutos, porque o
 * `disconnected` passageiro do WebRTC era tratado como o fim).
 */
import { describe, expect, it } from 'vitest';
import { GRACE_MS, LinkHealth } from '../src/net/linkhealth';

describe('saúde da ligação', () => {
  it('disconnected que volta a connected não derruba', () => {
    const h = new LinkHealth();
    expect(h.observe('connected', 0)).toBe('ok');
    expect(h.observe('disconnected', 1000)).toBe('unstable');
    expect(h.check(1000 + GRACE_MS - 1)).toBe('unstable');
    expect(h.observe('connected', 1000 + GRACE_MS - 1)).toBe('ok');
    expect(h.check(1000 + GRACE_MS * 3)).toBe('ok');
    expect(h.reason).toBe('');
  });

  it('disconnected por mais que a espera derruba, com o motivo', () => {
    const h = new LinkHealth();
    h.observe('connected', 0);
    h.observe('disconnected', 5000);
    expect(h.check(5000 + GRACE_MS)).toBe('dead');
    expect(h.reason).toBe(`disconnected for ${GRACE_MS / 1000} s`);
  });

  it('failed e closed derrubam na hora', () => {
    for (const s of ['failed', 'closed']) {
      const h = new LinkHealth();
      h.observe('connected', 0);
      expect(h.observe(s, 10)).toBe('dead');
      expect(h.reason).toBe(s);
    }
  });

  it('canal fechado derruba, e depois de morta ela não revive', () => {
    const h = new LinkHealth();
    h.observe('connected', 0);
    expect(h.channelClosed('r')).toBe('dead');
    expect(h.observe('connected', 50)).toBe('dead');
    expect(h.reason).toBe('channel r closed');
  });

  it('várias quedas curtas seguidas: cada uma com a sua espera', () => {
    const h = new LinkHealth();
    let t = 0;
    for (let i = 0; i < 10; i++) {
      h.observe('disconnected', t);
      t += GRACE_MS / 2;
      expect(h.observe('connected', t)).toBe('ok');
      t += 60000;
    }
    expect(h.state).toBe('ok');
  });
});
