/**
 * Boneco do jogador na tela de inventário (doc 08 §3.5).
 *
 * O desenho em si precisa de canvas 2D, que o ambiente Node não tem — então o
 * que se testa é a **projeção**, que é pura, e o degrade: sem canvas a tela
 * continua inteira em vez de quebrar.
 */
import { describe, expect, it } from 'vitest';
import { DOLL_HEIGHT_UNITS, DOLL_WIDTH_UNITS, projectParts } from '../src/ui/containers/paperdoll';
import { MOB_SKINS } from '../src/data/mobskins';
import { MODELS } from '../src/data/mobmodels';
import { MOBS } from '../src/data/mobs';
import { generateSkin } from '../src/render/skingen';

describe('projeção do boneco', () => {
  const parts = projectParts();

  it('desenha todas as peças do modelo humanoide', () => {
    expect(parts.length).toBe(MODELS.humanoid.parts.length);
  });

  it('nada vaza do canvas', () => {
    for (const p of parts) {
      expect(p.x, p.part.name).toBeGreaterThanOrEqual(0);
      expect(p.y, p.part.name).toBeGreaterThanOrEqual(0);
      expect(p.x + p.part.box[3], p.part.name).toBeLessThanOrEqual(DOLL_WIDTH_UNITS);
      expect(p.y + p.part.box[4], p.part.name).toBeLessThanOrEqual(DOLL_HEIGHT_UNITS);
    }
  });

  it('o boneco não está de cabeça para baixo', () => {
    const head = parts.find((p) => p.part.name === 'head')!;
    const leg = parts.find((p) => p.part.name === 'legRight')!;
    // Y cresce para baixo no canvas: a cabeça tem que ter Y menor que a perna.
    expect(head.y).toBeLessThan(leg.y);
  });

  it('o braço direito do jogador aparece à esquerda de quem olha', () => {
    // A câmera está de frente: o +X do modelo (esquerda do jogador) vai para a
    // direita da tela. Trocar este sinal espelharia o boneco inteiro.
    const right = parts.find((p) => p.part.name === 'armRight')!;
    const left = parts.find((p) => p.part.name === 'armLeft')!;
    expect(right.x).toBeLessThan(left.x);
  });

  it('a ordem é do fundo para a frente', () => {
    for (let i = 1; i < parts.length; i++) {
      expect(parts[i].depth).toBeGreaterThanOrEqual(parts[i - 1].depth);
    }
  });

  it('cada peça tem um retângulo de skin com área', () => {
    for (const p of parts) {
      expect(p.src[2], p.part.name).toBeGreaterThan(0);
      expect(p.src[3], p.part.name).toBeGreaterThan(0);
    }
  });
});

describe('skin do jogador', () => {
  it('existe e é gerada por código, como a dos mobs', () => {
    expect(MOB_SKINS.player).toBeDefined();
    const pixels = generateSkin(MODELS.humanoid, MOB_SKINS.player, 0);
    expect(pixels.length).toBe(MODELS.humanoid.skinSize * MODELS.humanoid.skinSize * 4);
    // Alguma coisa foi pintada: uma skin toda transparente seria um boneco
    // invisível, que passaria em todos os outros testes.
    let opaque = 0;
    for (let i = 3; i < pixels.length; i += 4) if (pixels[i] > 0) opaque++;
    expect(opaque).toBeGreaterThan(0);
  });

  it('não entra no atlas de entidade: nenhum mob a usa', () => {
    // O atlas sobe uma camada por skin de mob; a do jogador só serve ao boneco,
    // que a desenha num canvas 2D. Se um mob passasse a usá-la, ela subiria
    // junto — e aí este teste falha para avisar.
    expect(MOBS.some((m) => m.skin === 'player')).toBe(false);
  });
});
