/**
 * O fim da jornada (M16): o olho do ender, o portal do End, a viagem, a luta
 * contra o dragão e os créditos — e os dois que atiram de novo jeito, o blaze
 * e a bruxa.
 *
 * O critério do doc 14: "um mundo novo pode ser terminado — do primeiro
 * tronco ao dragão — sem comando nem modo criativo; o dragão no tick abaixo
 * de 1 ms". A cadeia inteira de itens está em `tests/journey.test.ts`; aqui
 * cada elo roda de verdade.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, STONE, blockIdOf, makeState } from '../src/data/blocks';
import { itemId, makeStack } from '../src/data/items';
import { MOB_BY_NAME, mobDef } from '../src/data/mobs';
import { EFFECT_BY_NAME } from '../src/data/effects';
import { DIM_END, DIM_OVERWORLD } from '../src/data/dimensions';
import {
  END_ISLAND_Y, EndNoise, GATEWAY_X, GATEWAY_Z, OUTER_START, PILLAR_COUNT, endPillars, generateEndChunk,
} from '../src/world/gen/end';
import { RING, nearestStronghold } from '../src/world/gen/strongholdsites';
import { exitPortalOpen, insertEye, isEndPortal } from '../src/game/endportal';
import { DragonFight } from '../src/game/dragonfight';
import { PERCH_TICKS, PERCH_Y, PHASE_CHARGE, PHASE_LAND, PHASE_PERCH } from '../src/entity/ai/dragongoals';
import { EYE_TICKS, FLAG_IGNITES, FLAG_POTION } from '../src/entity/projectile';
import { FLAG_DYING } from '../src/entity/mobstore';
import { dragonState, BREATH_TICKS } from '../src/entity/ai/dragongoals';
import { Travel } from '../src/game/travel';
import { isUnlocked } from '../src/data/achievements';

const GROUND = 63;
const SEED = 777;
const block = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const item = (name: string): number => itemId(name);
const DRAGON = MOB_BY_NAME.get('ender_dragon')!.id;
const CRYSTAL = MOB_BY_NAME.get('end_crystal')!.id;

function events(extra: Partial<ConstructorParameters<typeof Session>[2]> = {}): ConstructorParameters<typeof Session>[2] {
  return {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
    ...extra,
  };
}

/** Chão de pedra, 5×5 chunks em volta da origem. */
function flatWorld(seed = SEED): World {
  const world = new World(seed);
  for (let cz = -2; cz <= 2; cz++) {
    for (let cx = -2; cx <= 2; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  return world;
}

/** O End de verdade, gerado da seed, em volta do centro. */
function endWorld(): World {
  const world = new World(SEED);
  world.dimension = DIM_END;
  const noise = new EndNoise(SEED);
  for (let cz = -4; cz <= 3; cz++) {
    for (let cx = -4; cx <= 3; cx++) world.addChunk(generateEndChunk(SEED, noise, cx, cz));
  }
  return world;
}

function endSession(): { world: World; session: Session; player: Player } {
  const world = endWorld();
  const player = new Player(0.5, END_ISLAND_Y + 1, 12.5);
  player.mode = 'survival';
  const session = new Session(world, player, events());
  let seed = 3;
  session.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return { world, session, player };
}

function count(session: Session, type: number): number {
  const s = session.mobs.store;
  let n = 0;
  for (let i = 0; i < s.active; i++) if (s.type[i] === type) n++;
  return n;
}

function indexOf(session: Session, type: number): number {
  const s = session.mobs.store;
  for (let i = 0; i < s.active; i++) if (s.type[i] === type) return i;
  return -1;
}

describe('olho do ender', () => {
  it('voa na direção da fortaleza mais perto e, quatro em cinco vezes, cai', () => {
    const world = flatWorld();
    const player = new Player(0.5, GROUND + 1, 0.5);
    const session = new Session(world, player, events());
    session.random = () => 0.1;
    session.inventory.set(0, makeStack(item('ender_eye'), 3));
    session.inventory.select(0);
    player.pitch = -0.6; // olhando para o alto: a mira não pega bloco nenhum
    session.interaction.updateTarget();
    expect(session.useHeld()).toBe(true);
    expect(session.projectiles.active).toBe(1);
    expect(session.inventory.get(0)?.count).toBe(2);

    const target = new Int32Array(2);
    nearestStronghold(SEED, player.x, player.z, target);
    let vx = 0;
    let vz = 0;
    session.projectiles.forEach((_x, _y, _z, dx, _dy, dz) => { vx = dx; vz = dz; });
    const want = Math.atan2(target[1] - player.z, target[0] - player.x);
    const got = Math.atan2(vz, vx);
    expect(Math.abs(Math.atan2(Math.sin(want - got), Math.cos(want - got)))).toBeLessThan(0.05);

    for (let i = 0; i <= EYE_TICKS + 1; i++) session.tick();
    expect(session.projectiles.active).toBe(0);
    expect(session.items.active).toBe(1);
    expect(isUnlocked(session.achievements.mask, 'eye_spy')).toBe(true);
  });

  it('no Nether não sai da mão', () => {
    const world = flatWorld();
    world.dimension = 1;
    const session = new Session(world, new Player(0.5, GROUND + 1, 0.5), events());
    session.inventory.set(0, makeStack(item('ender_eye')));
    session.inventory.select(0);
    session.player.pitch = -0.6;
    session.interaction.updateTarget();
    session.useHeld();
    expect(session.projectiles.active).toBe(0);
    expect(session.inventory.get(0)?.count).toBe(1);
  });
});

describe('portal do End', () => {
  /** Anel de molduras em volta de (0, GROUND+1, 0); a primeira sem olho. */
  function ring(world: World): readonly [number, number, number] {
    RING.forEach(([dx, dz], k) => {
      world.setBlock(dx, GROUND + 1, dz, makeState(block(k === 0 ? 'end_portal_frame' : 'end_portal_frame_eye')), 'player');
    });
    return [RING[0][0], GROUND + 1, RING[0][1]];
  }

  it('o décimo segundo olho acende o vão 3×3', () => {
    const world = flatWorld();
    const [x, y, z] = ring(world);
    expect(insertEye(world, x, y, z, () => { /* luz */ })).toBe('lit');
    let lit = 0;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) if (isEndPortal(world.getBlock(dx, y, dz))) lit++;
    expect(lit).toBe(9);
    // Moldura já com olho não aceita outro.
    expect(insertEye(world, x, y, z, () => { /* luz */ })).toBe('none');
  });

  it('com onze, não acende; pelo clique do jogador, o olho sai da mão', () => {
    const world = flatWorld();
    const [x, y, z] = ring(world);
    world.setBlock(RING[5][0], y, RING[5][1], makeState(block('end_portal_frame')), 'player');
    const player = new Player(x + 0.5, GROUND + 1, z - 2.5);
    player.mode = 'survival';
    const session = new Session(world, player, events());
    session.inventory.set(0, makeStack(item('ender_eye'), 2));
    session.inventory.select(0);
    const eyeY = player.y + player.eyeHeight;
    const dx = x + 0.5 - player.x;
    const dy = y + 0.9 - eyeY;
    const dz = z + 0.5 - player.z;
    const length = Math.hypot(dx, dy, dz);
    session.interaction.updateTargetAlong(dx / length, dy / length, dz / length);
    expect(session.useHeld()).toBe(true);
    expect(blockIdOf(world.getBlock(x, y, z))).toBe(block('end_portal_frame_eye'));
    expect(session.inventory.get(0)?.count).toBe(1);
    expect(isEndPortal(world.getBlock(0, y, 0))).toBe(false);
  });

  it('entrar leva ao End na hora e constrói a plataforma de obsidiana', () => {
    const world = flatWorld();
    world.setBlock(0, GROUND + 1, 0, makeState(block('end_portal')), 'player');
    const arrivals: [number, number, number, string][] = [];
    const travel = new Travel(world, {
      onDimensionChange: (dimension) => {
        world.dimension = dimension;
        const noise = new EndNoise(SEED);
        for (let cz = -1; cz <= 1; cz++) for (let cx = 5; cx <= 7; cx++) world.addChunk(generateEndChunk(SEED, noise, cx, cz));
      },
      onArrive: (x, y, z, route) => arrivals.push([x, y, z, route]),
    });
    expect(travel.tick(0.5, GROUND + 1, 0.5)).toBe(true);
    expect(world.dimension).toBe(DIM_END);
    travel.tick(0, 0, 0);
    expect(arrivals).toHaveLength(1);
    const [x, y, z, route] = arrivals[0];
    expect(route).toBe('end_in');
    expect(blockIdOf(world.getBlock(Math.floor(x), y - 1, Math.floor(z)))).toBe(block('obsidian'));
    expect(world.getBlock(Math.floor(x), y, Math.floor(z))).toBe(0);
  });
});

describe('a luta contra o dragão', () => {
  it('no End, os dez cristais e o dragão nascem; o dragão tem a barra', () => {
    const { session } = endSession();
    session.tick();
    expect(count(session, CRYSTAL)).toBe(PILLAR_COUNT);
    expect(count(session, DRAGON)).toBe(1);
    expect(session.dragonFight.bossHealth).toBe(1);
    // Cada cristal pousa no topo da sua coluna.
    const pillars = endPillars(SEED);
    const s = session.mobs.store;
    const c = indexOf(session, CRYSTAL);
    expect(pillars.some((p) => Math.abs(p.x + 0.5 - s.x[c]) < 0.01 && Math.abs(p.top + 2 - s.y[c]) < 0.5)).toBe(true);
  });

  it('os cristais curam; quebrados, não voltam, e a cura para', () => {
    const { session } = endSession();
    session.player.mode = 'creative';
    session.tick();
    const s = session.mobs.store;
    s.health[indexOf(session, DRAGON)] = 150;
    for (let i = 0; i < 40; i++) session.tick();
    expect(s.health[indexOf(session, DRAGON)]).toBeGreaterThan(150);

    for (let c = indexOf(session, CRYSTAL); c >= 0; c = indexOf(session, CRYSTAL)) {
      session.mobs.damage(c, 5, 'player');
    }
    for (let i = 0; i < 3; i++) session.tick();
    expect(session.dragonFight.state.crystalsBroken).toBe((1 << PILLAR_COUNT) - 1);
    expect(session.dragonFight.crystalsAlive).toBe(0);
    const before = s.health[indexOf(session, DRAGON)];
    for (let i = 0; i < 40; i++) session.tick();
    expect(s.health[indexOf(session, DRAGON)]).toBeLessThanOrEqual(before);
    expect(count(session, CRYSTAL)).toBe(0);
  });

  it('o dragão cai: portal de saída aceso, ovo em cima, conquista', () => {
    const { world, session } = endSession();
    session.player.mode = 'creative';
    session.tick();
    const dragon = indexOf(session, DRAGON);
    session.mobs.damage(dragon, 1000, 'player');
    session.tick();
    // A agonia (M19): continua no mundo, invulnerável, subindo; o fim vem
    // depois de `deathTicks`.
    const store = session.mobs.store;
    expect(count(session, DRAGON)).toBe(1);
    expect(store.hasFlag(indexOf(session, DRAGON), FLAG_DYING)).toBe(true);
    expect(session.mobs.damage(indexOf(session, DRAGON), 1000, 'player')).toBe(false);
    expect(session.dragonFight.state.killed).toBe(false);
    const startY = store.y[indexOf(session, DRAGON)];
    const ticks = mobDef(DRAGON).traits.deathTicks ?? 0;
    for (let t = 0; t < ticks / 2; t++) session.tick();
    expect(store.y[indexOf(session, DRAGON)]).toBeGreaterThan(startY);
    const orbsBefore = session.orbs.active;
    for (let t = 0; t < ticks; t++) session.tick();
    expect(count(session, DRAGON)).toBe(0);
    expect(session.orbs.active).toBeGreaterThan(orbsBefore);
    expect(session.dragonFight.state.killed).toBe(true);
    expect(exitPortalOpen(world)).toBe(true);
    expect(blockIdOf(world.getBlock(0, END_ISLAND_Y + 5, 0))).toBe(block('dragon_egg'));
    expect(isUnlocked(session.achievements.mask, 'free_the_end')).toBe(true);
    // Um dragão só: não nasce outro.
    for (let i = 0; i < 20; i++) session.tick();
    expect(count(session, DRAGON)).toBe(0);
  });

  it('o estado vai para o save: cristal quebrado não volta, vida guardada volta', () => {
    const { session } = endSession();
    session.tick();
    session.mobs.damage(indexOf(session, CRYSTAL), 5, 'player');
    session.mobs.store.health[indexOf(session, DRAGON)] = 77;
    session.tick();
    const saved = session.dragonFight.snapshot();
    expect(saved.dragonHealth).toBe(77);

    const again = endSession().session;
    again.dragonFight.restore(saved);
    again.tick();
    expect(count(again, CRYSTAL)).toBe(PILLAR_COUNT - 1);
    expect(again.mobs.store.health[indexOf(again, DRAGON)]).toBe(77);
  });

  it('pousa no portal, fica a janela da espada e sobe de novo', () => {
    const { session } = endSession();
    session.player.mode = 'creative';
    session.tick();
    const s = session.mobs.store;
    const d = indexOf(session, DRAGON);
    s.variant[d] = PHASE_LAND;
    let perched = -1;
    for (let t = 0; t < 600 && perched < 0; t++) {
      session.tick();
      if (s.variant[indexOf(session, DRAGON)] === PHASE_PERCH) perched = t;
    }
    expect(perched).toBeGreaterThanOrEqual(0);
    const i = indexOf(session, DRAGON);
    expect(Math.abs(s.y[i] - PERCH_Y)).toBeLessThan(3);
    expect(Math.hypot(s.x[i], s.z[i])).toBeLessThan(3);
    for (let t = 0; t < PERCH_TICKS + 5; t++) session.tick();
    expect(s.variant[indexOf(session, DRAGON)]).not.toBe(PHASE_PERCH);
  });

  it('a investida acerta o jogador', () => {
    const { session, player } = endSession();
    session.tick();
    const s = session.mobs.store;
    player.setPosition(20.5, END_ISLAND_Y + 1, 0.5);
    const d = indexOf(session, DRAGON);
    s.x[d] = 20; s.y[d] = END_ISLAND_Y + 20; s.z[d] = 30;
    // Deixa a mira achar o jogador e manda investir.
    for (let t = 0; t < 12; t++) session.tick();
    s.variant[indexOf(session, DRAGON)] = PHASE_CHARGE;
    s.fuse[indexOf(session, DRAGON)] = 200;
    const health = session.survival.health;
    for (let t = 0; t < 200 && session.survival.health === health; t++) {
      session.tick();
      if (s.variant[indexOf(session, DRAGON)] !== PHASE_CHARGE && session.survival.health === health) {
        s.variant[indexOf(session, DRAGON)] = PHASE_CHARGE;
        s.fuse[indexOf(session, DRAGON)] = 200;
      }
    }
    expect(session.survival.health).toBeLessThan(health);
  });

  it('critério do doc 14: o dragão (com os dez cristais) custa menos de 1 ms por tick', () => {
    const { session } = endSession();
    session.player.mode = 'creative';
    session.tick();
    const view = { x: 0.5, y: END_ISLAND_Y + 1, z: 12.5, eyeY: END_ISLAND_Y + 2.6, held: -1, alive: true };
    const times: number[] = [];
    for (let t = 0; t < 300; t++) {
      const t0 = performance.now();
      session.mobs.tick(view);
      times.push(performance.now() - t0);
    }
    times.sort((a, b) => a - b);
    // O terceiro pior: um tique de GC da máquina de teste não é o dragão.
    const worst = times[times.length - 3];
    console.log(`  dragão + 10 cristais: ${worst.toFixed(3)} ms no 3º pior tick de 300`);
    expect(worst).toBeLessThan(1);
    expect(count(session, DRAGON)).toBe(1);
  });
});

describe('a volta para casa e os créditos', () => {
  it('pelo portal de saída, depois do dragão: créditos uma vez só', () => {
    const world = endWorld();
    const player = new Player(0.5, END_ISLAND_Y + 1, 0.5);
    let credits = 0;
    const session = new Session(world, player, events({ onCredits: () => { credits++; } }));
    session.dragonFight.state.killed = true;
    session.worldSpawnX = 5;
    session.worldSpawnZ = 7;
    session.tick();
    expect(exitPortalOpen(world)).toBe(true);
    session.travel.begin(0, 0, 'end');
    expect(world.dimension).toBe(DIM_OVERWORLD);
    session.tick();
    expect(credits).toBe(1);
    expect(player.x).toBeCloseTo(5.5);
    expect(player.z).toBeCloseTo(7.5);
    // Segunda volta: sem créditos.
    session.enterDimension(DIM_END);
    session.travel.begin(0, 0, 'end');
    for (let i = 0; i < 90; i++) session.tick();
    expect(credits).toBe(1);
  });
});

describe('blaze e bruxa', () => {
  function rig(): { session: Session; player: Player } {
    const world = flatWorld();
    const player = new Player(0.5, GROUND + 1, 0.5);
    player.mode = 'survival';
    const session = new Session(world, player, events());
    let seed = 9;
    session.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
    return { session, player };
  }

  it('o blaze paira baixo, atira a bola que incendeia, e o jogador arde', () => {
    const { session } = rig();
    const blaze = MOB_BY_NAME.get('blaze')!;
    expect(blaze.drops.some((d) => d.item === 'blaze_rod')).toBe(true);
    session.mobs.spawn(blaze.id, 8.5, GROUND + 3, 0.5);
    let shot = false;
    for (let t = 0; t < 400 && session.survival.burnTicks === 0; t++) {
      session.tick();
      session.projectiles.forEach(() => { shot = true; });
    }
    expect(shot).toBe(true);
    expect(session.survival.burnTicks > 0 || session.survival.health < 20).toBe(true);
    expect(mobDef(blaze.id).traits.shoots).toBe('small_fireball');
    expect(FLAG_IGNITES).toBeGreaterThan(0);
  });

  it('a bruxa atira o frasco, e o efeito pega em quem está perto', () => {
    const { session } = rig();
    const witch = MOB_BY_NAME.get('witch')!;
    session.mobs.spawn(witch.id, 6.5, GROUND + 1, 0.5);
    const harmful = ['poison', 'slowness', 'weakness'].map((n) => EFFECT_BY_NAME.get(n)!.id);
    let hit = false;
    for (let t = 0; t < 800 && !hit; t++) {
      session.tick();
      hit = harmful.some((id) => session.survival.effects.has(id));
    }
    expect(hit).toBe(true);
    expect(FLAG_POTION).toBeGreaterThan(0);
  });
});

describe('guarda-costas da luta', () => {
  it('fora do End a luta não faz nada', () => {
    const world = flatWorld();
    const session = new Session(world, new Player(0.5, GROUND + 1, 0.5), events());
    for (let i = 0; i < 5; i++) session.tick();
    expect(count(session, DRAGON)).toBe(0);
    expect(session.dragonFight.bossHealth).toBe(-1);
  });

  it('DragonFight restaura mundo antigo, sem o campo', () => {
    const fight = new DragonFight({
      world: new World(1), mobs: new Session(flatWorld(), new Player(0, 70, 0), events()).mobs,
      blockChanged: () => { /* nada */ }, sound: () => { /* nada */ },
      message: () => { /* nada */ }, achievement: () => { /* nada */ },
      player: { x: 0, y: 70, z: 0 }, hurtPlayer: () => { /* nada */ },
    });
    fight.restore(undefined);
    expect(fight.state).toEqual({ killed: false, crystalsBroken: 0, dragonHealth: 0, creditsSeen: false });
  });
});

describe('enderman no End (M19)', () => {
  it('é o único que nasce na ilha, e nasce em cima da pedra do End', () => {
    const { world, session } = endSession();
    const enderman = MOB_BY_NAME.get('enderman')!.id;
    const spawner = session.spawner;
    spawner.isDay = false;
    spawner.isNight = true;
    let total = 0;
    for (let cycle = 0; cycle < 400 && total < 3; cycle++) {
      for (const category of ['hostile', 'neutral', 'passive', 'ambient', 'water'] as const) {
        total += spawner.runCycle(category, 0.5, END_ISLAND_Y + 1, 12.5);
      }
    }
    expect(total).toBeGreaterThan(0);
    const s = session.mobs.store;
    const endStone = BLOCK_BY_NAME.get('end_stone')!.id;
    for (let i = 0; i < s.active; i++) {
      // O dragão e os cristais nascem pela luta, não pelo spawner.
      if (s.type[i] === DRAGON || s.type[i] === CRYSTAL) continue;
      expect(s.type[i]).toBe(enderman);
      const below = blockIdOf(world.getBlock(Math.floor(s.x[i]), Math.floor(s.y[i]) - 1, Math.floor(s.z[i])));
      expect(below).toBe(endStone);
    }
  });
});

describe('o dragão no M19: quebra, sopro', () => {
  it('quebra o que o jogador construiu no caminho, e não a ilha nem as colunas', () => {
    const { world, session } = endSession();
    session.tick();
    const i = indexOf(session, DRAGON);
    const s = session.mobs.store;
    const x = Math.floor(s.x[i]);
    const y = Math.floor(s.centerY(i));
    const z = Math.floor(s.z[i]);
    const stone = makeState(STONE);
    const endStone = makeState(block('end_stone'));
    world.setBlock(x + 1, y, z, stone, 'player');
    world.setBlock(x - 1, y, z, endStone, 'player');
    for (let t = 0; t < 8; t++) session.tick();
    // O dragão anda; o que interessa é o que estava no corpo dele no tick.
    expect(world.getBlock(x + 1, y, z)).not.toBe(stone);
    expect(world.getBlock(x - 1, y, z)).toBe(endStone);
  });

  it('pousado, sopra onde o jogador está; a nuvem fere quem fica e passa sozinha', () => {
    const { session, player } = endSession();
    player.mode = 'survival';
    session.tick();
    const i = indexOf(session, DRAGON);
    const s = session.mobs.store;
    // Pousa no portal, com o jogador perto e alvo marcado.
    s.x[i] = 0.5; s.y[i] = PERCH_Y; s.z[i] = 0.5;
    s.hasTarget[i] = 1;
    s.variant[i] = PHASE_PERCH;
    s.fuse[i] = PERCH_TICKS;
    session.tick();
    session.tick();
    expect(dragonState.breathTicks).toBeGreaterThan(0);
    // O jogador fica na nuvem: perde vida.
    const before = session.survival.health;
    for (let t = 0; t < 40; t++) {
      player.setPosition(dragonState.breathX, dragonState.breathY, dragonState.breathZ);
      session.tick();
    }
    expect(session.survival.health).toBeLessThan(before);
    // Longe da nuvem (e fora do alcance do próximo sopro), nada.
    session.survival.health = 20;
    const cloudX = dragonState.breathX;
    for (let t = 0; t < 40; t++) {
      // No ar, longe: na altura da nuvem, a 30 blocos, cai dentro de uma coluna.
      player.setPosition(cloudX + 30, dragonState.breathY + 20, dragonState.breathZ);
      session.tick();
    }
    expect(session.survival.health).toBe(20);
    for (let t = 0; t < BREATH_TICKS * 3; t++) session.tick();
    expect(session.dragonFight.breath === null || session.dragonFight.breath.ticks <= BREATH_TICKS).toBe(true);
  });
});

describe('as ilhas de fora e o portal de passagem (M19)', () => {
  const noise = new EndNoise(SEED);
  const hasStone = (cx: number, cz: number): boolean => {
    const chunk = generateEndChunk(SEED, noise, cx, cz);
    for (let i = 0; i < 256; i++) if (chunk.heightMap[i] > 0) return true;
    return false;
  };

  it('o vazio entre a ilha principal e as de fora continua vazio', () => {
    for (let r = 10; r < 44; r += 3) {
      for (let a = 0; a < 8; a++) {
        const angle = (a * Math.PI) / 4;
        expect(hasStone(Math.round(Math.cos(angle) * r), Math.round(Math.sin(angle) * r)), `${r},${a}`).toBe(false);
      }
    }
  });

  it('a partir de ~770 blocos há ilhas, e algumas guardam um santuário com baú', () => {
    let islands = 0;
    let shrines = 0;
    // Todo chunk de uma janela de ~500 × 500 blocos a oeste: o santuário
    // ocupa 5 × 5 e cairia entre dois chunks pulados.
    for (let cz = -16; cz <= 16; cz++) {
      for (let cx = -80; cx <= -48; cx++) {
        const chunk = generateEndChunk(SEED, noise, cx, cz);
        let stone = false;
        for (let i = 0; i < 256; i++) if (chunk.heightMap[i] > 0) stone = true;
        if (stone) islands++;
        for (const marker of chunk.structures) if (marker.kind === 'chest' && marker.data === 'end_shrine') shrines++;
      }
    }
    expect(islands).toBeGreaterThan(20);
    expect(shrines).toBeGreaterThan(0);
  });

  it('o dragão caído ergue o portal de passagem, que leva a uma ilha de fora e traz de volta', () => {
    const { world, session, player } = endSession();
    session.player.mode = 'creative';
    session.tick();
    session.mobs.damage(indexOf(session, DRAGON), 1000, 'player');
    for (let t = 0; t < (mobDef(DRAGON).traits.deathTicks ?? 0) + 30; t++) session.tick();
    expect(session.dragonFight.state.killed).toBe(true);
    // O portal está de pé, na ilha principal, a oeste.
    let gatewayY = -1;
    for (let y = 40; y < 90; y++) if (blockIdOf(world.getBlock(GATEWAY_X, y, GATEWAY_Z)) === block('end_gateway')) { gatewayY = y; break; }
    expect(gatewayY).toBeGreaterThan(0);

    // Entrar: a sessão leva o jogador para longe; os chunks de lá chegam.
    player.setPosition(GATEWAY_X + 0.5, gatewayY, GATEWAY_Z + 0.5);
    session.tick();
    expect(Math.abs(player.x)).toBeGreaterThan(OUTER_START - 100);
    const cx = Math.floor(player.x) >> 4;
    const cz = Math.floor(player.z) >> 4;
    for (let dz = -1; dz <= 1; dz++) for (let dx = -1; dx <= 1; dx++) world.addChunk(generateEndChunk(SEED, noise, cx + dx, cz + dz));
    session.tick();
    const fx = Math.floor(player.x);
    const fz = Math.floor(player.z);
    // Chegou em pé sobre chão, com ar em volta da cabeça, e há um portal de volta perto.
    expect(world.getBlock(fx, Math.floor(player.y) - 1, fz)).not.toBe(0);
    expect(world.getBlock(fx, Math.floor(player.y), fz)).toBe(0);
    let back = false;
    for (let y = Math.floor(player.y) - 3; y <= Math.floor(player.y) + 3; y++) {
      if (blockIdOf(world.getBlock(fx - 2, y, fz)) === block('end_gateway')) back = true;
    }
    expect(back).toBe(true);
  });
});
