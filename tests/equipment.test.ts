/**
 * Arco, escudo e barco (doc 14 — M6).
 *
 * O foco é o que dá para verificar sem GL nem DOM: a carga do arco vira
 * flecha com força proporcional, o escudo apara só o golpe de frente, e o
 * barco flutua em vez de afundar.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Boats } from '../src/entity/boat';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { itemId, makeStack } from '../src/data/items';

const GROUND_Y = 63;
const block = (name: string): number => makeState(BLOCK_BY_NAME.get(name)!.id);

/** Plataforma de pedra, com um lago de água de 4×4 no meio. */
function testWorld(): World {
  const world = new World(4242);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, block('stone'));
        }
      }
      chunk.recomputeHeightMap();
      for (const section of chunk.sections) {
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
      }
      world.addChunk(chunk);
    }
  }
  // Lago: cava dois blocos e enche de água.
  for (let z = 6; z < 10; z++) {
    for (let x = 6; x < 10; x++) {
      world.setBlock(x, GROUND_Y, z, 0, 'player');
      world.setBlock(x, GROUND_Y - 1, z, block('water'), 'player');
      world.setBlock(x, GROUND_Y, z, block('water'), 'player');
    }
  }
  return world;
}

function harness(): { world: World; player: Player; session: Session } {
  const world = testWorld();
  const player = new Player(2.5, GROUND_Y + 1, 2.5);
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
  });
  player.mode = 'survival';
  return { world, player, session };
}

describe('arco', () => {
  it('carregar e soltar dispara uma flecha e consome munição', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('bow')));
    h.session.inventory.set(1, makeStack(itemId('arrow'), 5));
    h.session.inventory.select(0);

    for (let i = 0; i < 20; i++) h.session.useHeld();
    expect(h.session.chargeProgress).toBeCloseTo(1, 2);

    h.session.cancelEating();
    expect(h.session.projectiles.active).toBe(1);
    expect(h.session.inventory.countOf(itemId('arrow'))).toBe(4);
  });

  it('sem flecha o arco nem carrega', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('bow')));
    h.session.inventory.select(0);

    for (let i = 0; i < 20; i++) h.session.useHeld();
    expect(h.session.chargeProgress).toBe(0);
    h.session.cancelEating();
    expect(h.session.projectiles.active).toBe(0);
  });

  it('carga curta escorrega da corda e não dispara', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('bow')));
    h.session.inventory.set(1, makeStack(itemId('arrow'), 5));
    h.session.inventory.select(0);

    h.session.useHeld();
    h.session.cancelEating();
    expect(h.session.projectiles.active).toBe(0);
    expect(h.session.inventory.countOf(itemId('arrow'))).toBe(5);
  });

  it('o arco gasta durabilidade ao disparar', () => {
    const h = harness();
    const bow = makeStack(itemId('bow'));
    h.session.inventory.set(0, bow);
    h.session.inventory.set(1, makeStack(itemId('arrow'), 5));
    h.session.inventory.select(0);

    for (let i = 0; i < 20; i++) h.session.useHeld();
    h.session.cancelEating();
    expect(bow.damage).toBe(1);
  });
});

describe('escudo', () => {
  it('levantado, apara o golpe que vem de frente', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('shield')));
    h.session.inventory.select(0);
    h.player.yaw = 0; // olhando para +Z

    h.session.useHeld();
    expect(h.session.isBlocking).toBe(true);

    const before = h.session.survival.health;
    // Empurrão para −Z = o atacante está em +Z, de frente para o jogador.
    h.session.combat.explodeAt(h.player.x, h.player.y, h.player.z + 2, 2);
    const blocked = before - h.session.survival.health;

    // Mesmo golpe sem escudo machuca mais.
    const bare = harness();
    bare.player.yaw = 0;
    const beforeBare = bare.session.survival.health;
    bare.session.combat.explodeAt(bare.player.x, bare.player.y, bare.player.z + 2, 2);
    const raw = beforeBare - bare.session.survival.health;

    expect(blocked).toBeLessThan(raw);
  });

  it('baixado, não apara nada', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('shield')));
    h.session.inventory.select(0);
    expect(h.session.isBlocking).toBe(false);
  });

  it('só o escudo bloqueia; a espada na mão não', () => {
    const h = harness();
    h.session.inventory.set(0, makeStack(itemId('iron_sword')));
    h.session.inventory.select(0);
    h.session.useHeld();
    expect(h.session.isBlocking).toBe(false);
  });
});

describe('barco', () => {
  it('flutua na linha d’água em vez de afundar', () => {
    const world = testWorld();
    const boats = new Boats();
    const index = boats.spawn(8.5, GROUND_Y + 4, 8.5);
    expect(index).toBe(0);

    for (let i = 0; i < 120; i++) boats.tick(world);
    // A água vai até o topo de GROUND_Y, então a linha d'água é GROUND_Y+1.
    expect(boats.y[0]).toBeGreaterThan(GROUND_Y);
    expect(boats.y[0]).toBeLessThanOrEqual(GROUND_Y + 1.2);
  });

  it('remar acelera e o arrasto freia', () => {
    const world = testWorld();
    const boats = new Boats();
    boats.spawn(8.5, GROUND_Y + 1, 8.5);

    // Dez remadas: o bastante para acelerar sem sair do lago de 4×4.
    for (let i = 0; i < 10; i++) {
      boats.drive(0, 1, 0);
      boats.tick(world);
    }
    const moving = Math.hypot(boats.vx[0], boats.vz[0]);
    expect(moving).toBeGreaterThan(0);

    for (let i = 0; i < 60; i++) boats.tick(world);
    expect(Math.hypot(boats.vx[0], boats.vz[0])).toBeLessThan(moving);
  });

  it('montar cola o jogador no barco e desmontar o solta', () => {
    const h = harness();
    h.session.vehicles.boats.spawn(8.5, GROUND_Y + 1, 8.5);
    h.player.setPosition(8.5, GROUND_Y + 1, 9.0);

    expect(h.session.useHeld()).toBe(true);
    expect(h.session.vehicles.isRiding).toBe(true);

    h.session.tick();
    expect(h.player.x).toBeCloseTo(h.session.vehicles.boats.x[0], 3);

    expect(h.session.useHeld()).toBe(true);
    expect(h.session.vehicles.isRiding).toBe(false);
  });

  it('não monta num barco distante', () => {
    const h = harness();
    h.session.vehicles.boats.spawn(8.5, GROUND_Y + 1, 8.5);
    h.player.setPosition(2.5, GROUND_Y + 1, 2.5);
    h.session.useHeld();
    expect(h.session.vehicles.isRiding).toBe(false);
  });

  it('remover um barco não embaralha os outros', () => {
    const boats = new Boats();
    boats.spawn(1, 70, 1);
    boats.spawn(2, 70, 2);
    boats.spawn(3, 70, 3);
    boats.removeAt(0);
    expect(boats.active).toBe(2);
    // O último tomou o lugar do removido.
    expect(boats.x[0]).toBe(3);
    expect(boats.x[1]).toBe(2);
  });
});
