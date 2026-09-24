/**
 * Plantas vivas (doc 03 §9: crescimento, espalhamento e suporte).
 *
 * Até 2026-09-22 só a roça crescia. A muda nunca virava árvore, cana e cacto
 * ficavam do tamanho em que nasceram, a grama não voltava a um caminho pisado
 * e uma flor boiava sobre o buraco onde antes havia terra — e, somado, isso
 * fazia da madeira um recurso que acabava. Os testes cobrem cada regra e o
 * contrato que protege os mundos salvos: a árvore da geração continua sendo a
 * mesma, sorteio por sorteio.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Growth, isGrowing } from '../src/world/growth';
import { Redstone } from '../src/world/redstone';
import { TREE_BLOCKS, TREE_MAX_HEIGHT, growTree } from '../src/world/trees';
import { PLANTS, plantOfState } from '../src/data/plants';
import { BLOCK_LOOT } from '../src/data/loot';
import { Rng } from '../src/core/rng';
import {
  AIR, BLOCK_BY_NAME, DIRT, GRASS_BLOCK, WATER, blockIdOf, makeState,
} from '../src/data/blocks';

const id = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const SAND = id('sand');
const STONE = id('stone');
const CANE = id('sugar_cane');
const CACTUS = id('cactus');
const POPPY = id('poppy');
const GROUND = 63;

/** Terra (ou `top`) até y=63, céu aberto em cima. */
function makeWorld(top = DIRT): World {
  const world = new World(7);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          for (let y = 60; y < GROUND; y++) chunk.setBlock(x, y, z, makeState(DIRT));
          chunk.setBlock(x, GROUND, z, makeState(top));
        }
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

/** Crescimento com sorte sempre boa, ligado ao mundo. */
function growth(world: World, luck = 0): Growth {
  const g = new Growth(world);
  g.random = () => luck;
  g.attach();
  return g;
}

function run(g: Growth, ticks: number): void {
  for (let i = 0; i < ticks; i++) g.tick();
}

const at = (world: World, x: number, y: number, z: number): number =>
  blockIdOf(world.getBlock(x, y, z));

describe('a tabela', () => {
  it('as cinco mudas existem e cada uma vira a sua árvore', () => {
    for (const kind of ['oak', 'birch', 'spruce', 'acacia', 'jungle'] as const) {
      const sapling = BLOCK_BY_NAME.get(`${kind}_sapling`);
      expect(sapling, kind).toBeDefined();
      expect(plantOfState(makeState(sapling!.id))?.tree).toBe(kind);
      expect(isGrowing(makeState(sapling!.id))).toBe(true);
    }
  });

  it('cada folha dá a muda da própria árvore', () => {
    for (const kind of ['oak', 'birch', 'spruce', 'acacia', 'jungle']) {
      const drops = BLOCK_LOOT[`${kind}_leaves`]?.drops ?? [];
      expect(drops.some((d) => d.item === `${kind}_sapling`), kind).toBe(true);
    }
  });

  it('a folha de acácia não custa camada de atlas: usa o desenho da de carvalho', () => {
    expect(BLOCK_BY_NAME.get('acacia_leaves')?.tex).toBe(BLOCK_BY_NAME.get('oak_leaves')?.tex);
  });

  it('toda planta da tabela aponta para um bloco que existe', () => {
    for (const plant of PLANTS) expect(BLOCK_BY_NAME.get(plant.block), plant.block).toBeDefined();
  });
});

describe('a muda vira árvore', () => {
  it('com luz e chão de terra, o carvalho cresce com tronco e copa', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(id('oak_sapling')), 'player');
    run(g, 5);
    expect(at(world, 0, GROUND + 1, 0), 'o tronco nasce onde estava a muda').toBe(id('oak_log'));
    expect(at(world, 0, GROUND + 4, 0)).toBe(id('oak_log'));
    let leaves = 0;
    for (let y = GROUND; y < GROUND + 10; y++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) if (at(world, dx, y, dz) === id('oak_leaves')) leaves++;
      }
    }
    expect(leaves).toBeGreaterThan(20);
  });

  it('cada espécie dá o seu tronco', () => {
    for (const kind of ['birch', 'spruce', 'acacia', 'jungle'] as const) {
      const world = makeWorld(GRASS_BLOCK);
      const g = growth(world);
      world.setBlock(0, GROUND + 1, 0, makeState(id(`${kind}_sapling`)), 'player');
      run(g, 5);
      expect(at(world, 0, GROUND + 1, 0), kind).toBe(id(`${kind}_log`));
    }
  });

  it('não cresce sem espaço: um teto baixo segura a árvore', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world);
    world.setBlock(0, GROUND + 4, 0, makeState(STONE), 'player');
    world.setBlock(0, GROUND + 1, 0, makeState(id('oak_sapling')), 'player');
    run(g, 100);
    expect(at(world, 0, GROUND + 1, 0)).toBe(id('oak_sapling'));
  });

  it('não cresce sem sorte', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world, 0.99);
    world.setBlock(0, GROUND + 1, 0, makeState(id('oak_sapling')), 'player');
    run(g, 100);
    expect(at(world, 0, GROUND + 1, 0)).toBe(id('oak_sapling'));
  });

  it('a árvore não passa por cima do que o jogador construiu', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world);
    // Um bloco de pedra onde a copa passaria.
    world.setBlock(1, GROUND + 5, 0, makeState(STONE), 'player');
    world.setBlock(0, GROUND + 1, 0, makeState(id('oak_sapling')), 'player');
    run(g, 5);
    expect(at(world, 1, GROUND + 5, 0)).toBe(STONE);
  });

  it('a altura declarada cobre a árvore mais alta de cada espécie', () => {
    for (const kind of ['oak', 'birch', 'spruce', 'acacia', 'jungle'] as const) {
      let top = 0;
      for (let seed = 0; seed < 64; seed++) {
        growTree(
          {
            trunk: (_x, y) => { top = Math.max(top, y); },
            leaf: (_x, y) => { top = Math.max(top, y); },
          },
          new Rng(seed, 1), kind, 0, 0, 0,
        );
      }
      expect(top, kind).toBeLessThan(TREE_MAX_HEIGHT[kind]);
    }
  });

  it('a acácia da geração usa a folha de acácia (dá a muda certa)', () => {
    expect(TREE_BLOCKS.acacia.leaves).toBe(makeState(id('acacia_leaves')));
  });
});

describe('cana e cacto', () => {
  it('a cana cresce até 3 com água encostada no chão', () => {
    const world = makeWorld(SAND);
    const g = growth(world);
    world.setBlock(1, GROUND, 0, makeState(WATER), 'gen');
    world.setBlock(0, GROUND + 1, 0, makeState(CANE), 'player');
    run(g, 200);
    expect(at(world, 0, GROUND + 2, 0)).toBe(CANE);
    expect(at(world, 0, GROUND + 3, 0)).toBe(CANE);
    expect(at(world, 0, GROUND + 4, 0), 'para em 3').toBe(AIR);
  });

  it('a cana não cresce sem água', () => {
    const world = makeWorld(SAND);
    const g = growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(CANE), 'player');
    run(g, 200);
    expect(at(world, 0, GROUND + 2, 0)).toBe(AIR);
  });

  it('o cacto cresce até 3 e não cresce encostado em bloco', () => {
    const world = makeWorld(SAND);
    const g = growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(CACTUS), 'player');
    world.setBlock(5, GROUND + 1, 0, makeState(CACTUS), 'player');
    world.setBlock(6, GROUND + 2, 0, makeState(STONE), 'player');
    run(g, 200);
    expect(at(world, 0, GROUND + 3, 0)).toBe(CACTUS);
    expect(at(world, 0, GROUND + 4, 0)).toBe(AIR);
    expect(at(world, 5, GROUND + 2, 0), 'o vizinho de pedra impede').toBe(AIR);
  });
});

describe('a grama volta', () => {
  it('terra exposta ao lado da grama vira grama', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world);
    // O jogador cava e devolve terra: o caminho pisado.
    world.setBlock(0, GROUND, 0, makeState(DIRT), 'player');
    run(g, 400);
    expect(at(world, 0, GROUND, 0)).toBe(GRASS_BLOCK);
  });

  it('a grama anda em cadeia por um trecho de terra', () => {
    const world = makeWorld(DIRT);
    const g = growth(world);
    // Uma grama só no canto de um campo de terra.
    world.setBlock(0, GROUND, 0, makeState(GRASS_BLOCK), 'player');
    run(g, 3000);
    expect(at(world, 3, GROUND, 0), 'três blocos adiante').toBe(GRASS_BLOCK);
  });

  it('terra sem grama perto não entra no registro', () => {
    const world = makeWorld(DIRT);
    const g = growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(DIRT), 'player');
    run(g, 100);
    expect(g.registered).toBe(0);
  });

  it('bloco opaco em cima da grama a transforma em terra', () => {
    const world = makeWorld(GRASS_BLOCK);
    growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(STONE), 'player');
    expect(at(world, 0, GROUND, 0)).toBe(DIRT);
  });

  it('geração não mexe na grama', () => {
    const world = makeWorld(GRASS_BLOCK);
    const g = growth(world);
    world.setBlock(0, GROUND + 1, 0, makeState(STONE), 'gen');
    expect(at(world, 0, GROUND, 0)).toBe(GRASS_BLOCK);
    expect(g.registered).toBe(0);
  });
});

describe('planta precisa de chão', () => {
  function redstone(world: World, broken: number[]): Redstone {
    const r = new Redstone(world, { onBroken: (_x, _y, _z, s) => { broken.push(blockIdOf(s)); } });
    r.attach();
    return r;
  }

  it('uma flor cai como item quando a terra embaixo some', () => {
    const world = makeWorld(GRASS_BLOCK);
    const broken: number[] = [];
    const r = redstone(world, broken);
    world.setBlock(0, GROUND + 1, 0, makeState(POPPY), 'player');
    world.setBlock(0, GROUND, 0, makeState(AIR), 'player');
    for (let i = 0; i < 4; i++) r.tick();
    expect(at(world, 0, GROUND + 1, 0)).toBe(AIR);
    expect(broken).toContain(POPPY);
  });

  it('cana em coluna se segura em si mesma; tirar a base derruba o resto', () => {
    const world = makeWorld(SAND);
    const broken: number[] = [];
    const r = redstone(world, broken);
    for (let y = 1; y <= 3; y++) world.setBlock(0, GROUND + y, 0, makeState(CANE), 'player');
    for (let i = 0; i < 4; i++) r.tick();
    expect(at(world, 0, GROUND + 3, 0), 'a coluna fica de pé').toBe(CANE);
    world.setBlock(0, GROUND + 1, 0, makeState(AIR), 'player');
    for (let i = 0; i < 10; i++) r.tick();
    expect(at(world, 0, GROUND + 2, 0)).toBe(AIR);
    expect(at(world, 0, GROUND + 3, 0)).toBe(AIR);
  });

  it('a trepadeira não pede chão', () => {
    expect(BLOCK_BY_NAME.get('vine')?.support).toBe('none');
  });
});
