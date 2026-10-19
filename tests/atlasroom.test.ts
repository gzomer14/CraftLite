/**
 * Folga do atlas (M25): o critério do marco é **64 camadas ou mais** livres
 * para o conteúdo dos M26–M29. Até o M25 o teto era 256 (o campo de 8 bits do
 * vértice) e o jogo usava 223.
 */
import { describe, expect, it } from 'vitest';
import { buildLayerIndex } from '../src/render/layers';
import { MAX_ATLAS_LAYERS } from '../src/render/vertex';
import { MAX_TINTS, TINT_COUNT } from '../src/data/tints';

describe('folga do atlas', () => {
  it('sobram pelo menos 64 camadas no vértice', () => {
    const used = buildLayerIndex().count;
    console.log(`atlas: ${used} de ${MAX_ATLAS_LAYERS} camadas`);
    expect(MAX_ATLAS_LAYERS - used).toBeGreaterThanOrEqual(64);
  });

  it('o tint que cedeu o bit ainda cabe, com folga para as cores do M26', () => {
    expect(TINT_COUNT).toBeLessThanOrEqual(MAX_TINTS);
    expect(MAX_TINTS).toBe(32);
  });
});
