/**
 * Experiência e orbes (M6): a curva de nível do doc 06 §8, o gasto na mesa e a
 * física de atração do orbe.
 *
 * O mundo dos orbes é uma plataforma sólida com ar em cima — o suficiente para
 * o orbe pousar em vez de cair para sempre.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Experience, totalForLevel, xpToNext } from '../src/game/xp';
import { ATTRACT_RADIUS, XpOrbs } from '../src/entity/xporb';
import { DIRT, makeState } from '../src/data/blocks';

const GROUND_Y = 63;

function flatWorld(): World {
  const world = new World(99);
  const dirt = makeState(DIRT);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, dirt);
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

describe('curva de experiência (doc 06 §8)', () => {
  it('segue as três faixas da fórmula', () => {
    expect(xpToNext(0)).toBe(7);
    expect(xpToNext(15)).toBe(37);
    expect(xpToNext(16)).toBe(42);
    expect(xpToNext(30)).toBe(112);
    expect(xpToNext(31)).toBe(121);
  });

  it('o total acumulado bate com a soma dos níveis', () => {
    expect(totalForLevel(0)).toBe(0);
    expect(totalForLevel(1)).toBe(7);
    expect(totalForLevel(3)).toBe(7 + 9 + 11);
  });
});

describe('Experience', () => {
  it('sobe de nível ao acumular e avisa uma vez por nível', () => {
    const xp = new Experience();
    const levels: number[] = [];
    xp.onLevelUp = (level) => levels.push(level);

    xp.add(7);
    expect(xp.level).toBe(1);
    expect(xp.progress).toBe(0);
    expect(levels).toEqual([1]);

    xp.add(9);
    expect(xp.level).toBe(2);
  });

  it('a barra mostra a fração dentro do nível atual', () => {
    const xp = new Experience();
    xp.add(7 + 4); // nível 1 e 4 de 9 do nível 2
    expect(xp.level).toBe(1);
    expect(xp.progress).toBeCloseTo(4 / 9, 5);
  });

  it('gastar níveis leva ao começo do nível resultante', () => {
    const xp = new Experience();
    xp.add(totalForLevel(10) + 5);
    expect(xp.level).toBe(10);

    expect(xp.spend(3)).toBe(true);
    expect(xp.level).toBe(7);
    // A sobra de barra some: não se acumula progresso entre compras.
    expect(xp.progress).toBe(0);
    expect(xp.total).toBe(totalForLevel(7));
  });

  it('não gasta o que não tem', () => {
    const xp = new Experience();
    xp.add(totalForLevel(2));
    expect(xp.canAfford(5)).toBe(false);
    expect(xp.spend(5)).toBe(false);
    expect(xp.level).toBe(2);
  });

  it('morrer zera tudo', () => {
    const xp = new Experience();
    xp.add(500);
    xp.reset();
    expect(xp.level).toBe(0);
    expect(xp.total).toBe(0);
  });

  it('restaura do save pelo total', () => {
    const xp = new Experience();
    xp.setTotal(totalForLevel(12));
    expect(xp.level).toBe(12);
    expect(xp.progress).toBe(0);
  });
});

describe('orbes de XP', () => {
  it('voa até o jogador e entrega o valor', () => {
    const world = flatWorld();
    const orbs = new XpOrbs();
    let collected = 0;
    orbs.onCollect = (amount) => { collected += amount; };

    orbs.spawn(4.5, GROUND_Y + 1.5, 4.5, 5);
    expect(orbs.active).toBe(1);

    // O jogador está a 3 blocos: dentro do raio de atração.
    for (let i = 0; i < 60 && orbs.active > 0; i++) {
      orbs.tick(world, 7.5, GROUND_Y + 1, 4.5);
    }
    expect(collected).toBe(5);
    expect(orbs.active).toBe(0);
  });

  it('fica no chão enquanto o jogador está longe', () => {
    const world = flatWorld();
    const orbs = new XpOrbs();
    orbs.spawn(4.5, GROUND_Y + 1.5, 4.5, 3);

    const far = 4.5 + ATTRACT_RADIUS + 5;
    for (let i = 0; i < 40; i++) orbs.tick(world, far, GROUND_Y + 1, 4.5);
    expect(orbs.active).toBe(1);

    // E pousou em vez de atravessar o chão.
    let y = -1;
    orbs.forEach((_x, oy) => { y = oy; });
    expect(y).toBeGreaterThanOrEqual(GROUND_Y + 1);
  });

  it('funde orbes próximos numa entidade só', () => {
    const world = flatWorld();
    const orbs = new XpOrbs();
    for (let i = 0; i < 5; i++) orbs.spawn(4.5, GROUND_Y + 1.2, 4.5, 2);
    expect(orbs.active).toBe(5);

    const far = 4.5 + ATTRACT_RADIUS + 5;
    orbs.tick(world, far, GROUND_Y + 1, 4.5);
    expect(orbs.active).toBe(1);

    let value = 0;
    orbs.forEach((_x, _y, _z, v) => { value = v; });
    expect(value).toBe(10);
  });

  it('não estoura o pool nem aceita valor zero', () => {
    const orbs = new XpOrbs(4);
    expect(orbs.spawn(0, 0, 0, 0)).toBe(false);
    for (let i = 0; i < 4; i++) expect(orbs.spawn(i, 70, 0, 1)).toBe(true);
    expect(orbs.spawn(9, 70, 0, 1)).toBe(false);
    expect(orbs.active).toBe(4);
  });
});
