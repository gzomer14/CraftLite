/**
 * Fogo que se espalha (doc 04 `flammable`, doc 03 §8 "a chuva apaga fogo").
 *
 * `flammable` existia na tabela de blocos desde o M1 e **nada o lia** — a
 * floresta não pegava fogo e o número era enfeite. Os testes aqui cobrem as
 * quatro propriedades que fazem o sistema ser jogável em vez de destrutivo:
 * ele anda, ele acaba, ele não boia no ar e ele respeita o orçamento de tick.
 */
import { describe, expect, it } from 'vitest';
import { Fire, MAX_FIRES, MAX_PER_TICK, fireBlockId } from '../src/world/fire';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, blockIdOf, defOf, makeState } from '../src/data/blocks';

const FIRE = fireBlockId();
const STONE = BLOCK_BY_NAME.get('stone')!.id;
const PLANKS = BLOCK_BY_NAME.get('oak_planks')!.id;
const WOOL = BLOCK_BY_NAME.get('white_wool')?.id ?? BLOCK_BY_NAME.get('oak_planks')!.id;

/** Mundo pequeno com um piso de pedra em y=63, chunks já carregados. */
function makeWorld(radius = 1): World {
  const world = new World(1);
  for (let cx = -radius; cx <= radius; cx++) {
    for (let cz = -radius; cz <= radius; cz++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let x = 0; x < 16; x++) {
        for (let z = 0; z < 16; z++) chunk.setBlock(x, 63, z, makeState(STONE));
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Fogo com aleatório determinístico: `value` decide toda chance. */
function makeFire(world: World, value = 0): Fire {
  const fire = new Fire(world);
  fire.random = () => value;
  fire.attach();
  return fire;
}

describe('acender', () => {
  it('a tabela tem o bloco, e ele não é item', () => {
    const def = BLOCK_BY_NAME.get('fire');
    expect(def).toBeDefined();
    expect(def?.itemless, 'fogo não pode ir para a mochila').toBe(true);
    expect(def?.solid, 'fogo não empurra o jogador').toBe(false);
    expect(def?.emission, 'fogo ilumina').toBeGreaterThan(0);
    expect(def?.replaceable, 'colocar bloco por cima apaga').toBe(true);
  });

  it('pega em cima de chão sólido', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    expect(fire.ignite(0, 64, 0)).toBe(true);
    expect(blockIdOf(world.getBlock(0, 64, 0))).toBe(FIRE);
    expect(fire.burning).toBe(1);
  });

  it('não pega boiando no ar, sem chão nem combustível', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    expect(fire.ignite(0, 80, 0)).toBe(false);
    expect(blockIdOf(world.getBlock(0, 80, 0))).not.toBe(FIRE);
  });

  it('pega no ar se houver algo inflamável ao lado', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    world.setBlock(1, 80, 0, makeState(PLANKS), 'player');
    expect(fire.ignite(0, 80, 0)).toBe(true);
  });

  it('não pega dentro de um bloco cheio', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    expect(fire.ignite(0, 63, 0)).toBe(false);
  });

  it('não pega na chuva', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    fire.raining = true;
    expect(fire.ignite(0, 64, 0)).toBe(false);
  });
});

describe('propagação', () => {
  it('pega no vizinho inflamável e o consome', () => {
    const world = makeWorld();
    // `random` em 0: toda chance passa, e o primeiro vizinho é sorteado.
    const fire = makeFire(world, 0);
    world.setBlock(1, 64, 0, makeState(PLANKS), 'player');
    fire.ignite(0, 64, 0);

    for (let t = 0; t < 4; t++) fire.tick();
    expect(blockIdOf(world.getBlock(1, 64, 0)), 'a tábua tinha que ter pegado').toBe(FIRE);
  });

  it('nada pega quando o sorteio sempre falha', () => {
    const world = makeWorld();
    const fire = makeFire(world, 0.999);
    world.setBlock(1, 64, 0, makeState(PLANKS), 'player');
    fire.ignite(0, 64, 0);

    for (let t = 0; t < 10; t++) fire.tick();
    expect(blockIdOf(world.getBlock(1, 64, 0))).toBe(PLANKS);
  });

  it('a lã pega mais fácil que o tronco — a chance sai da tabela', () => {
    const wool = defOf(makeState(WOOL)).flammable;
    const log = defOf(makeState(BLOCK_BY_NAME.get('oak_log')!.id)).flammable;
    expect(wool).toBeGreaterThan(log);
  });
});

describe('o fogo acaba', () => {
  it('sobre pedra, sem combustível, ele se apaga sozinho', () => {
    const world = makeWorld();
    const fire = makeFire(world, 0.999);
    fire.ignite(0, 64, 0);

    for (let t = 0; t < 30; t++) fire.tick();
    expect(blockIdOf(world.getBlock(0, 64, 0))).not.toBe(FIRE);
    expect(fire.burning).toBe(0);
  });

  it('a chuva apaga o que já estava aceso', () => {
    const world = makeWorld();
    const fire = makeFire(world, 0.999);
    world.setBlock(1, 64, 0, makeState(PLANKS), 'player');
    fire.ignite(0, 64, 0);
    expect(fire.burning).toBe(1);

    fire.raining = true;
    for (let t = 0; t < 5; t++) fire.tick();
    expect(blockIdOf(world.getBlock(0, 64, 0))).not.toBe(FIRE);
    // E a tábua continua ali: a chuva apagou antes de ela pegar.
    expect(blockIdOf(world.getBlock(1, 64, 0))).toBe(PLANKS);
  });

  it('tirar o chão apaga a chama', () => {
    const world = makeWorld();
    const fire = makeFire(world, 0.999);
    fire.ignite(0, 64, 0);
    world.setBlock(0, 63, 0, 0, 'player');

    for (let t = 0; t < 3; t++) fire.tick();
    expect(blockIdOf(world.getBlock(0, 64, 0))).not.toBe(FIRE);
  });

  it('quebrar o fogo o tira do registro', () => {
    const world = makeWorld();
    const fire = makeFire(world);
    fire.ignite(0, 64, 0);
    expect(fire.burning).toBe(1);
    world.setBlock(0, 64, 0, 0, 'player');
    expect(fire.burning).toBe(0);
  });
});

describe('orçamento', () => {
  it('nunca visita mais que o teto por tick, nem com o mundo em chamas', () => {
    const world = makeWorld(2);
    const fire = makeFire(world, 0.999);
    for (let x = 0; x < 20; x++) {
      for (let z = 0; z < 20; z++) fire.ignite(x, 64, z);
    }
    expect(fire.burning).toBeGreaterThan(MAX_PER_TICK);
    fire.tick();
    expect(fire.lastVisited).toBeLessThanOrEqual(MAX_PER_TICK);
  });

  it('há um teto de chamas vivas — um incêndio não cresce sem fim', () => {
    const world = makeWorld(2);
    const fire = makeFire(world, 0.999);
    for (let x = 0; x < 30; x++) {
      for (let z = 0; z < 30; z++) fire.ignite(x, 64, z);
    }
    expect(fire.burning).toBeLessThanOrEqual(MAX_FIRES);
  });
});
