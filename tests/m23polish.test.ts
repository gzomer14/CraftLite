/**
 * Pontas pequenas do M23: a dica de controle fora da faixa da vida, e o save do
 * convidado da sala saindo quando o inventário muda.
 */
import { describe, expect, it } from 'vitest';
import { HINT_CSS } from '../src/ui/controlhint';
import { CHECK_EVERY, SAVE_EVERY, SaveCadence, signature } from '../src/net/savecadence';
import type { ItemStack } from '../src/data/items';

describe('dica de controle', () => {
  it('fica abaixo da mira, e não presa ao chão sobre a vida e a fome', () => {
    // Era `bottom: 30 × --px`, e a faixa de vida e fome do HUD fica em 33.
    expect(HINT_CSS).not.toMatch(/bottom:/);
    expect(HINT_CSS).toMatch(/top:calc\(50% \+/);
  });
});

describe('save do convidado (M20, corrigido no M23)', () => {
  const slots = (): (ItemStack | null)[] => Array.from({ length: 46 }, () => null);

  it('sem mudança, sai só a cada 10 s', () => {
    const cadence = new SaveCadence();
    const inv = slots();
    let sent = 0;
    for (let t = 1; t <= SAVE_EVERY * 2; t++) if (cadence.tick(inv, 0)) sent++;
    expect(sent).toBe(2);
  });

  it('o diamante que entra na mochila sai no segundo seguinte, e não 10 s depois', () => {
    const cadence = new SaveCadence();
    const inv = slots();
    for (let t = 1; t <= 30; t++) cadence.tick(inv, 0);
    inv[5] = { item: 264, count: 1, damage: 0 };
    let after = -1;
    for (let t = 1; t <= SAVE_EVERY; t++) {
      if (cadence.tick(inv, 0)) { after = t; break; }
    }
    expect(after).toBeGreaterThan(0);
    expect(after).toBeLessThanOrEqual(CHECK_EVERY);
  });

  it('quebrar bloco a cada tick não manda mais de um save por segundo', () => {
    const cadence = new SaveCadence();
    const inv = slots();
    let sent = 0;
    for (let t = 1; t <= 100; t++) {
      inv[0] = { item: 4, count: t, damage: 0 };
      if (cadence.tick(inv, 0)) sent++;
    }
    expect(sent).toBeLessThanOrEqual(100 / CHECK_EVERY);
  });

  it('a assinatura muda com item, quantidade, desgaste, encantamento e nível', () => {
    const inv = slots();
    inv[3] = { item: 10, count: 1, damage: 0 };
    const base = signature(inv, 0);
    expect(signature(inv, 1)).not.toBe(base);
    for (const change of [{ count: 2 }, { damage: 5 }, { ench: 3 }, { item: 11 }]) {
      const copy = inv.slice();
      copy[3] = { ...inv[3]!, ...change };
      expect(signature(copy, 0), JSON.stringify(change)).not.toBe(base);
    }
  });
});
