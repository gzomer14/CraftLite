/**
 * A barra de durabilidade, que agora aparece também na hotbar do HUD e não só
 * com a mochila aberta. O desenho é o mesmo nos dois lugares (`paintDurability`);
 * aqui, com um elemento falso, o que ela diz de cada pilha.
 */
import { describe, expect, it } from 'vitest';
import { paintDurability } from '../src/ui/containers/slotview';
import { itemDef, itemId, makeStack } from '../src/data/items';

function fakeBar() {
  return { hidden: true, style: { transform: '', background: '' } } as unknown as HTMLElement;
}

const PICK = itemId('iron_pickaxe');
const MAX = itemDef(PICK)!.durability!;

describe('barra de durabilidade', () => {
  it('ferramenta nova, bloco ou vazio: sem barra', () => {
    const bar = fakeBar();
    paintDurability(bar, makeStack(PICK, 1));
    expect(bar.hidden).toBe(true);
    paintDurability(bar, makeStack(itemId('cobblestone'), 12));
    expect(bar.hidden).toBe(true);
    paintDurability(bar, null);
    expect(bar.hidden).toBe(true);
  });

  it('gasta: encolhe e muda de cor do verde ao vermelho', () => {
    const bar = fakeBar();
    const pick = makeStack(PICK, 1);
    pick.damage = Math.floor(MAX * 0.25);
    paintDurability(bar, pick);
    expect(bar.hidden).toBe(false);
    expect(bar.style.transform).toBe(`scaleX(${(1 - pick.damage / MAX).toFixed(3)})`);
    expect(bar.style.background).toBe('#5ad04a');
    pick.damage = Math.floor(MAX * 0.7);
    paintDurability(bar, pick);
    expect(bar.style.background).toBe('#d0c04a');
    pick.damage = MAX - 1;
    paintDurability(bar, pick);
    expect(bar.style.background).toBe('#d04a4a');
    // Consertada, a barra some de novo.
    pick.damage = 0;
    paintDurability(bar, pick);
    expect(bar.hidden).toBe(true);
  });
});
