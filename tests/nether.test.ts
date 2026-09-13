/**
 * Nether (M7): gerador, portal e travessia de dimensão.
 *
 * Tudo roda sem GL e sem DOM. O gerador é determinístico pela seed, o portal é
 * função de mundo, e a travessia é uma máquina de três estados com o mundo
 * injetado — nada aqui depende de pipeline, worker ou render.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn, WORLD_HEIGHT } from '../src/world/chunk';
import { World } from '../src/world/world';
import { NetherNoise, generateNetherChunk, LAVA_SEA_LEVEL } from '../src/world/gen/nether';
import {
  AXIS_X, AXIS_Z, arriveAt, buildPortalAt, destinationOf, extinguishPortal, findNearbyPortal,
  ignitePortal, isPortalBlock,
} from '../src/game/portal';
import { COOLDOWN_TICKS, PORTAL_TICKS, Travel } from '../src/game/travel';
import { DIM_NETHER, DIM_OVERWORLD, dimensionOf, scaleCoordinate } from '../src/data/dimensions';
import { AIR, BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';
import { Player } from '../src/entity/player';
import { Session } from '../src/game/session';
import { SaveGame } from '../src/game/savegame';
import { SaveManager } from '../src/save/savemanager';
import { dimensionIdFor } from '../src/save/db';
import { newWorldMeta } from '../src/ui/menuflow';
import { Mobs } from '../src/entity/mobs';
import { MOB_BY_NAME, spawnRuleOf } from '../src/data/mobs';

const SEED = 4242;
const id = (name: string): number => {
  const def = BLOCK_BY_NAME.get(name);
  if (def === undefined) throw new Error(`bloco inexistente no teste: ${name}`);
  return def.id;
};

const OBSIDIAN = id('obsidian');
const NETHERRACK = id('netherrack');
const PORTAL = id('nether_portal');
const STONE = id('stone');

// --- gerador ---------------------------------------------------------------

describe('gerador do Nether', () => {
  const noise = new NetherNoise(SEED);

  it('é determinístico: mesma seed, mesmo chunk', () => {
    const a = generateNetherChunk(SEED, noise, 3, -7);
    const b = generateNetherChunk(SEED, new NetherNoise(SEED), 3, -7);
    for (let y = 0; y < WORLD_HEIGHT; y += 7) {
      for (let z = 0; z < 16; z += 5) {
        for (let x = 0; x < 16; x += 5) {
          expect(b.getBlock(x, y, z)).toBe(a.getBlock(x, y, z));
        }
      }
    }
  });

  it('é fechado em cima e embaixo', () => {
    const chunk = generateNetherChunk(SEED, noise, 0, 0);
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) {
        expect(blockIdOf(chunk.getBlock(x, 0, z))).toBe(id('bedrock'));
        expect(blockIdOf(chunk.getBlock(x, WORLD_HEIGHT - 1, z))).toBe(id('bedrock'));
      }
    }
  });

  it('não tem água nem grama, e tem netherrack de sobra', () => {
    const chunk = generateNetherChunk(SEED, noise, 1, 1);
    const counts = new Map<number, number>();
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const block = blockIdOf(chunk.getBlock(x, y, z));
          counts.set(block, (counts.get(block) ?? 0) + 1);
        }
      }
    }
    expect(counts.get(id('water')) ?? 0).toBe(0);
    expect(counts.get(id('grass_block')) ?? 0).toBe(0);
    expect(counts.get(NETHERRACK) ?? 0).toBeGreaterThan(4000);
  });

  it('tem lava só no fundo e ar só acima dela', () => {
    const chunk = generateNetherChunk(SEED, noise, 2, 5);
    for (let y = LAVA_SEA_LEVEL + 1; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < 16; z += 4) {
        for (let x = 0; x < 16; x += 4) {
          expect(blockIdOf(chunk.getBlock(x, y, z)), `y=${y}`).not.toBe(id('lava'));
        }
      }
    }
  });

  it('gera o que o jogador vem buscar: quartzo e um caminho para andar', () => {
    let quartz = 0;
    let air = 0;
    for (let c = 0; c < 4; c++) {
      const chunk = generateNetherChunk(SEED, noise, c * 4, c * 9);
      for (let y = LAVA_SEA_LEVEL; y < WORLD_HEIGHT - 8; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const block = blockIdOf(chunk.getBlock(x, y, z));
            if (block === id('nether_quartz_ore')) quartz++;
            else if (block === AIR) air++;
          }
        }
      }
    }
    expect(quartz).toBeGreaterThan(50);
    expect(air).toBeGreaterThan(10000);
  });

  it('as opções desligam minério e decoração', () => {
    const chunk = generateNetherChunk(SEED, noise, 0, 0, { ores: false, decoration: false });
    for (let y = 0; y < WORLD_HEIGHT; y++) {
      for (let z = 0; z < 16; z += 3) {
        for (let x = 0; x < 16; x += 3) {
          const block = blockIdOf(chunk.getBlock(x, y, z));
          expect(block).not.toBe(id('nether_quartz_ore'));
          expect(block).not.toBe(id('soul_sand'));
        }
      }
    }
  });
});

// --- dimensões -------------------------------------------------------------

describe('tabela de dimensões', () => {
  it('a superfície tem céu e o Nether não', () => {
    expect(dimensionOf(DIM_OVERWORLD).hasSky).toBe(true);
    expect(dimensionOf(DIM_NETHER).hasSky).toBe(false);
  });

  it('id desconhecido cai na superfície em vez de quebrar', () => {
    expect(dimensionOf(99).name).toBe('overworld');
  });

  it('a escala é 1:8 na ida e 8:1 na volta', () => {
    expect(scaleCoordinate(800, DIM_OVERWORLD, DIM_NETHER)).toBe(100);
    expect(scaleCoordinate(100, DIM_NETHER, DIM_OVERWORLD)).toBe(800);
    expect(scaleCoordinate(-800, DIM_OVERWORLD, DIM_NETHER)).toBe(-100);
  });

  it('o destino troca de dimensão e aplica a escala', () => {
    const ida = destinationOf(160, -320, DIM_OVERWORLD);
    expect(ida).toEqual({ x: 20, z: -40, dimension: DIM_NETHER });
    const volta = destinationOf(20, -40, DIM_NETHER);
    expect(volta).toEqual({ x: 160, z: -320, dimension: DIM_OVERWORLD });
  });
});

// --- portal ----------------------------------------------------------------

const GROUND = 63;

/** Mundo de pedra plano, com ar acima — espaço para montar a moldura. */
function flatWorld(): World {
  const world = new World(SEED);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      const stone = makeState(STONE);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

/**
 * Monta uma moldura de obsidiana em volta de um vão `width × height` cujo canto
 * inferior fica em `(x, y, z)`. Sem os cantos, como no gênero.
 */
function frame(
  world: World, x: number, y: number, z: number, width: number, height: number, axis: number,
): void {
  const obsidian = makeState(OBSIDIAN);
  const dx = axis === AXIS_X ? 1 : 0;
  const dz = axis === AXIS_X ? 0 : 1;
  for (let i = -1; i <= width; i++) {
    world.setBlock(x + dx * i, y - 1, z + dz * i, obsidian, 'player');
    world.setBlock(x + dx * i, y + height, z + dz * i, obsidian, 'player');
  }
  for (let j = 0; j < height; j++) {
    world.setBlock(x - dx, y + j, z - dz, obsidian, 'player');
    world.setBlock(x + dx * width, y + j, z + dz * width, obsidian, 'player');
  }
}

/** Esvazia o vão da moldura, para o portal ter onde acender. */
function hollow(
  world: World, x: number, y: number, z: number, width: number, height: number, axis: number,
): void {
  const air = makeState(AIR);
  const dx = axis === AXIS_X ? 1 : 0;
  const dz = axis === AXIS_X ? 0 : 1;
  for (let j = 0; j < height; j++) {
    for (let i = 0; i < width; i++) {
      world.setBlock(x + dx * i, y + j, z + dz * i, air, 'player');
    }
  }
}

describe('acender o portal', () => {
  it('acende a moldura mínima de 2×3 no eixo X', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 3, AXIS_X);
    frame(world, 0, y, 0, 2, 3, AXIS_X);

    const area = ignitePortal(world, 0, y, 0);
    expect(area).not.toBeNull();
    expect(area?.width).toBe(2);
    expect(area?.height).toBe(3);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 2; i++) {
        expect(isPortalBlock(world.getBlock(i, y + j, 0))).toBe(true);
      }
    }
  });

  it('acende também no eixo Z', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 3, AXIS_Z);
    frame(world, 0, y, 0, 2, 3, AXIS_Z);

    const area = ignitePortal(world, 0, y, 0);
    expect(area?.axis).toBe(AXIS_Z);
    expect(isPortalBlock(world.getBlock(0, y + 2, 1))).toBe(true);
  });

  it('acende uma moldura maior que a mínima', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 4, 5, AXIS_X);
    frame(world, 0, y, 0, 4, 5, AXIS_X);

    const area = ignitePortal(world, 2, y + 2, 0);
    expect(area?.width).toBe(4);
    expect(area?.height).toBe(5);
  });

  it('não acende sem moldura', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 3, AXIS_X);
    expect(ignitePortal(world, 0, y, 0)).toBeNull();
  });

  it('não acende moldura baixa demais', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 2, AXIS_X);
    frame(world, 0, y, 0, 2, 2, AXIS_X);
    expect(ignitePortal(world, 0, y, 0)).toBeNull();
  });

  it('não acende moldura furada', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 3, AXIS_X);
    frame(world, 0, y, 0, 2, 3, AXIS_X);
    // Um buraco na lateral: deixa de ser moldura.
    world.setBlock(-1, y + 1, 0, makeState(AIR), 'player');
    expect(ignitePortal(world, 0, y, 0)).toBeNull();
  });

  it('quebrar um bloco apaga o portal inteiro, e a moldura fica', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 0, y, 0, 2, 3, AXIS_X);
    frame(world, 0, y, 0, 2, 3, AXIS_X);
    ignitePortal(world, 0, y, 0);

    expect(extinguishPortal(world, 0, y, 0)).toBe(6);
    for (let j = 0; j < 3; j++) {
      for (let i = 0; i < 2; i++) {
        expect(blockIdOf(world.getBlock(i, y + j, 0))).toBe(AIR);
      }
    }
    expect(blockIdOf(world.getBlock(-1, y, 0))).toBe(OBSIDIAN);
  });

  it('apagar o que não é portal não faz nada', () => {
    const world = flatWorld();
    expect(extinguishPortal(world, 0, GROUND + 1, 0)).toBe(0);
  });
});

describe('chegada do outro lado', () => {
  it('acha um portal já aceso em vez de construir outro', () => {
    const world = flatWorld();
    const y = GROUND + 1;
    hollow(world, 4, y, 0, 2, 3, AXIS_X);
    frame(world, 4, y, 0, 2, 3, AXIS_X);
    ignitePortal(world, 4, y, 0);

    const found = findNearbyPortal(world, 0, 0, 12);
    expect(found).not.toBeNull();
    expect(found?.x).toBe(4);

    const spot = arriveAt(world, 0, 0, DIM_OVERWORLD);
    expect(spot?.x).toBe(4.5);
  });

  it('constrói um portal quando não há nenhum por perto', () => {
    const world = flatWorld();
    const spot = arriveAt(world, 0, 0, DIM_OVERWORLD);
    expect(spot).not.toBeNull();
    expect(isPortalBlock(world.getBlock(0, spot!.y, 0))).toBe(true);
    // E o que ele constrói é reconhecido como portal por quem procura depois.
    expect(findNearbyPortal(world, 0, 0, 2)).not.toBeNull();
  });

  it('o portal construído tem chão firme embaixo', () => {
    const world = flatWorld();
    const spot = arriveAt(world, 0, 0, DIM_OVERWORLD)!;
    expect(blockIdOf(world.getBlock(0, spot.y - 1, 0))).toBe(OBSIDIAN);
  });

  it('constrói dentro do Nether, acima do mar de lava', () => {
    const world = new World(SEED);
    const noise = new NetherNoise(SEED);
    world.dimension = DIM_NETHER;
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) world.addChunk(generateNetherChunk(SEED, noise, cx, cz));
    }
    const spot = arriveAt(world, 4, 4, DIM_NETHER);
    expect(spot).not.toBeNull();
    expect(spot!.y).toBeGreaterThan(LAVA_SEA_LEVEL);
    expect(isPortalBlock(world.getBlock(4, spot!.y, 4))).toBe(true);
  });

  it('a moldura construída é reacendível: o vão é válido', () => {
    const world = flatWorld();
    const area = buildPortalAt(world, 0, GROUND + 2, 0);
    extinguishPortal(world, area.x, area.y, area.z);
    expect(ignitePortal(world, area.x, area.y, area.z)).not.toBeNull();
  });
});

// --- travessia -------------------------------------------------------------

interface TravelRig {
  world: World;
  travel: Travel;
  dimensions: number[];
  arrivals: number[][];
}

function travelRig(): TravelRig {
  const world = flatWorld();
  const dimensions: number[] = [];
  const arrivals: number[][] = [];
  const travel = new Travel(world, {
    onDimensionChange: (dimension) => {
      dimensions.push(dimension);
      world.dimension = dimension;
    },
    onArrive: (x, y, z) => arrivals.push([x, y, z]),
  });
  return { world, travel, dimensions, arrivals };
}

/** Põe o jogador dentro de um portal aceso em (0, GROUND+1, 0). */
function standInPortal(world: World): void {
  const y = GROUND + 1;
  hollow(world, 0, y, 0, 2, 3, AXIS_X);
  frame(world, 0, y, 0, 2, 3, AXIS_X);
  ignitePortal(world, 0, y, 0);
}

describe('travessia', () => {
  it('fora do portal nada acontece', () => {
    const r = travelRig();
    for (let t = 0; t < 100; t++) r.travel.tick(8.5, GROUND + 1, 8.5);
    expect(r.dimensions.length).toBe(0);
    expect(r.travel.isTravelling).toBe(false);
  });

  it('parado no portal por um segundo, a dimensão troca', () => {
    const r = travelRig();
    standInPortal(r.world);

    for (let t = 0; t < PORTAL_TICKS - 1; t++) {
      expect(r.travel.tick(0.5, GROUND + 1, 0.5)).toBe(false);
    }
    expect(r.travel.tick(0.5, GROUND + 1, 0.5)).toBe(true);
    expect(r.dimensions).toEqual([DIM_NETHER]);
  });

  it('sair do portal antes da hora zera a contagem', () => {
    const r = travelRig();
    standInPortal(r.world);
    for (let t = 0; t < PORTAL_TICKS - 2; t++) r.travel.tick(0.5, GROUND + 1, 0.5);
    r.travel.tick(8.5, GROUND + 1, 8.5);
    expect(r.travel.progress).toBe(0);
    for (let t = 0; t < PORTAL_TICKS - 1; t++) r.travel.tick(0.5, GROUND + 1, 0.5);
    expect(r.dimensions.length).toBe(0);
  });

  it('a chegada espera o chunk de destino e reposiciona o jogador', () => {
    const r = travelRig();
    standInPortal(r.world);
    for (let t = 0; t < PORTAL_TICKS; t++) r.travel.tick(0.5, GROUND + 1, 0.5);
    expect(r.travel.isTravelling).toBe(true);

    // O mundo de destino é o mesmo objeto neste teste, e já está carregado:
    // o próximo tick encontra o chunk e conclui.
    r.travel.tick(0.5, GROUND + 1, 0.5);
    expect(r.arrivals.length).toBe(1);
    expect(r.travel.isTravelling).toBe(false);
  });

  it('a carência impede o vaivém entre as dimensões', () => {
    const r = travelRig();
    standInPortal(r.world);
    for (let t = 0; t < PORTAL_TICKS + 1; t++) r.travel.tick(0.5, GROUND + 1, 0.5);
    expect(r.dimensions.length).toBe(1);

    // Sai do portal do outro lado ainda dentro de um portal: não pode voltar.
    for (let t = 0; t < COOLDOWN_TICKS - 2; t++) r.travel.tick(0.5, GROUND + 1, 0.5);
    expect(r.dimensions.length).toBe(1);
  });

  it('destino sem saída aborta a viagem em vez de deixar o jogador no vazio', () => {
    const world = new World(SEED);
    // Mundo de uma coluna só, e ela não é o destino: o chunk nunca carrega.
    world.addChunk(new ChunkColumn(50, 50));
    const dimensions: number[] = [];
    const messages: string[] = [];
    const travel = new Travel(world, {
      onDimensionChange: (d) => { dimensions.push(d); world.dimension = d; },
      onArrive: () => { throw new Error('não devia chegar'); },
      onMessage: (text) => messages.push(text),
    });

    travel.begin(0, 0);
    for (let t = 0; t < 700; t++) travel.tick(0.5, 64, 0.5);
    expect(travel.isTravelling).toBe(false);
    expect(messages.some((m) => m.includes('não encontrou saída'))).toBe(true);
  });
});

// --- integração com o mundo -------------------------------------------------

describe('regras da dimensão', () => {
  it('o mundo sabe em que dimensão está', () => {
    const world = flatWorld();
    expect(world.dimensionDef.name).toBe('overworld');
    world.dimension = DIM_NETHER;
    expect(world.dimensionDef.name).toBe('nether');
    expect(world.dimensionDef.waterEvaporates).toBe(true);
    expect(world.dimensionDef.lavaRange).toBe(4);
  });

  it('esvaziar o mundo devolve todas as colunas', () => {
    const world = flatWorld();
    const before = world.chunkCount;
    const taken: ChunkColumn[] = [];
    expect(world.takeAllChunks(taken)).toBe(before);
    expect(world.chunkCount).toBe(0);
  });

  it('o bloco de portal é indestrutível pela mão e não vira item', () => {
    const def = BLOCK_BY_NAME.get('nether_portal')!;
    expect(def.hardness).toBe(-1);
    expect(def.itemless).toBe(true);
    expect(def.solid).toBe(false);
    expect(blockIdOf(makeState(PORTAL))).toBe(PORTAL);
  });
});

// --- save por dimensão ------------------------------------------------------

describe('mobs do Nether', () => {
  it('o porco zumbi e o ghast são imunes ao fogo', () => {
    for (const name of ['zombified_piglin', 'ghast']) {
      expect(MOB_BY_NAME.get(name)!.traits.fireImmune, name).toBe(true);
    }
  });

  it('os dois só nascem no Nether, e nenhum mob da superfície nasce lá', () => {
    expect(spawnRuleOf('zombified_piglin')?.dimension).toBe(DIM_NETHER);
    expect(spawnRuleOf('ghast')?.dimension).toBe(DIM_NETHER);
    for (const name of ['zombie', 'cow', 'creeper', 'skeleton']) {
      expect(spawnRuleOf(name)?.dimension ?? DIM_OVERWORLD, name).toBe(DIM_OVERWORLD);
    }
  });

  it('a lava mata quem não é imune, e não toca em quem é', () => {
    const world = flatWorld();
    // Poça de lava na superfície do mundo de teste.
    const lava = makeState(id('lava'));
    for (let x = 0; x < 4; x++) {
      for (let z = 0; z < 4; z++) world.setBlock(x, GROUND, z, lava, 'player');
    }
    const mobs = new Mobs(world, {
      onDrop: () => {}, onXp: () => {}, onSound: () => {}, onHitPlayer: () => {},
      onExplode: () => {}, onBreakBlock: () => {}, onArrow: () => {},
    }, 8);
    mobs.random = () => 0.5;

    const zombie = mobs.spawn(MOB_BY_NAME.get('zombie')!.id, 1.5, GROUND, 1.5);
    const piglin = mobs.spawn(MOB_BY_NAME.get('zombified_piglin')!.id, 2.5, GROUND, 2.5);
    const piglinHealth = mobs.store.health[piglin];
    const view = { x: 100, y: GROUND, z: 100, eyeY: GROUND + 1.6, held: -1, alive: false };

    for (let t = 0; t < 40; t++) mobs.tick(view);
    // O zumbi ou morreu, ou está bem machucado; o porco zumbi, intacto.
    expect(mobs.count).toBeLessThan(2);
    expect(mobs.store.health[0]).toBe(piglinHealth);
    expect(zombie).toBeGreaterThanOrEqual(0);
  });

  it('o ghast voa: escala o modelo em vez de inchar a caixa de 4 blocos', () => {
    const ghast = MOB_BY_NAME.get('ghast')!;
    expect(ghast.traits.flies).toBe(true);
    expect(ghast.traits.modelScale).toBe(4);
    expect(ghast.height * (ghast.traits.modelScale ?? 1)).toBe(4);
  });
});

describe('save por dimensão', () => {
  it('cada dimensão tem seu próprio espaço de chunks, e a superfície não muda', () => {
    expect(dimensionIdFor('mundo-1', DIM_OVERWORLD)).toBe('mundo-1');
    expect(dimensionIdFor('mundo-1', DIM_NETHER)).not.toBe('mundo-1');
    expect(dimensionIdFor('mundo-1', DIM_NETHER).startsWith('mundo-1')).toBe(true);
  });

  it('a dimensão do jogador vai para o save e volta dele', () => {
    const world = flatWorld();
    const player = new Player(8.5, GROUND + 1, 8.5);
    const changes: number[] = [];
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
      onDimensionChange: (dimension) => changes.push(dimension),
    });
    const meta = newWorldMeta('Teste', 'semente', 'survival', 2);
    const save = new SaveGame(
      new SaveManager({} as never, meta.id), session, player, meta,
    );

    session.enterDimension(DIM_NETHER);
    expect(changes).toEqual([DIM_NETHER]);
    const snapshot = save.snapshot();
    expect(snapshot.dimension).toBe(DIM_NETHER);

    // Volta à superfície e restaura: a dimensão salva tem que ser reaplicada.
    session.enterDimension(DIM_OVERWORLD);
    save.restore(snapshot);
    expect(world.dimension).toBe(DIM_NETHER);
  });

  it('save antigo, sem o campo, abre na superfície', () => {
    const world = flatWorld();
    world.dimension = DIM_NETHER;
    const player = new Player(8.5, GROUND + 1, 8.5);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
    });
    const meta = newWorldMeta('Teste', 'semente', 'survival', 2);
    const save = new SaveGame(
      new SaveManager({} as never, meta.id), session, player, meta,
    );
    const legacy = { ...save.snapshot() };
    delete (legacy as { dimension?: number }).dimension;

    save.restore(legacy);
    expect(world.dimension).toBe(DIM_OVERWORLD);
  });

  it('morrer no Nether devolve o jogador à superfície', () => {
    const world = flatWorld();
    const player = new Player(8.5, GROUND + 1, 8.5);
    const changes: number[] = [];
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
      onDimensionChange: (dimension) => changes.push(dimension),
    });

    session.enterDimension(DIM_NETHER);
    session.respawn(0, 0);
    expect(world.dimension).toBe(DIM_OVERWORLD);
    expect(changes).toEqual([DIM_NETHER, DIM_OVERWORLD]);
  });
});
