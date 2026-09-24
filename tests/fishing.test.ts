/**
 * Pesca (M14).
 *
 * A vara arremessa a boia; na água, um relógio sorteia a mordida; puxar na
 * fisgada traz o peixe e XP. O critério do doc 14: pescar 10 peixes em 5
 * minutos de jogo.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, WATER, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, makeStack } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { SMELTING } from '../src/data/smelting';
import { FISHING_LOOT, rollCatch } from '../src/data/fishing';
import { LINE_GROUND, LINE_IDLE, LINE_WATER } from '../src/game/fishing';
import { ITEM_USES } from '../src/game/itemuse';
import { makeFluid } from '../src/world/fluids';

const STONE = BLOCK_BY_NAME.get('stone')!.id;

/** Gerador pequeno e determinístico, para o teste não depender da sorte. */
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

/**
 * Chão de pedra em Y=63 e um lago de 3 de fundo a leste do jogador (x ≥ 12).
 * O jogador olha para +X, um pouco para cima: o arremesso cai no lago.
 */
function pond(): { world: World; player: Player; session: Session } {
  const world = new World(9);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          const wx = cx * 16 + x;
          chunk.setBlock(x, 60, z, makeState(STONE));
          for (let y = 61; y <= 63; y++) {
            chunk.setBlock(x, y, z, wx >= 12 ? makeFluid(WATER, 0) : makeState(STONE));
          }
        }
      }
      world.addChunk(chunk);
    }
  }
  const player = new Player(8.5, 64, 8.5);
  player.mode = 'survival';
  player.yaw = Math.PI / 2; // olhando para +X
  player.pitch = -0.35;     // um pouco para cima
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  session.random = lcg(42);
  session.inventory.set(0, makeStack(itemId('fishing_rod')));
  session.inventory.select(0);
  session.interaction.updateTarget();
  return { world, player, session };
}

describe('itens da pesca', () => {
  it('vara, bacalhau e bacalhau assado existem, e a vara tem ação', () => {
    const rod = ITEM_BY_NAME.get('fishing_rod')!;
    expect(rod.maxStack).toBe(1);
    expect(rod.durability).toBeGreaterThan(0);
    expect(rod.uses).toContain('fish');
    expect(ITEM_USES.fish.use).toBeDefined();
    // Doc 05 §4: bacalhau assado mata 5 de fome com 6,0 de saturação.
    expect(ITEM_BY_NAME.get('cooked_cod')!.food).toMatchObject({ hunger: 5, saturation: 6 });
    expect(ITEM_BY_NAME.get('cod')!.food).toBeDefined();
  });

  it('a vara se fabrica com graveto e linha, e o bacalhau assa na fornalha', () => {
    expect(RECIPES.some((r) => r.result.item === 'fishing_rod')).toBe(true);
    expect(SMELTING.find((r) => r.input === 'cod')?.output).toBe('cooked_cod');
  });

  it('o anzol traz quase sempre peixe, e todo item da tabela existe', () => {
    for (const entry of FISHING_LOOT) expect(ITEM_BY_NAME.has(entry.item), entry.item).toBe(true);
    const rng = lcg(7);
    let cod = 0;
    for (let i = 0; i < 1000; i++) if (rollCatch(rng()) === 'cod') cod++;
    expect(cod).toBeGreaterThan(780);
    expect(cod).toBeLessThan(920);
  });
});

describe('a linha', () => {
  it('o arremesso cai na água, a boia fica na superfície e o peixe morde', () => {
    const { session } = pond();
    const line = session.fishing;
    expect(session.useHeld()).toBe(true);
    expect(line.state).not.toBe(LINE_IDLE);
    let bites = 0;
    line.onBite = () => { bites++; };
    for (let t = 0; t < 400 && bites === 0; t++) session.tick();
    expect(line.state).toBe(LINE_WATER);
    // Superfície do lago em Y=64 (topo do bloco 63): a boia boia ali.
    expect(line.y).toBeGreaterThan(63.3);
    expect(line.y).toBeLessThan(64.1);
    expect(line.x).toBeGreaterThan(12);
    expect(bites).toBe(1);
    expect(line.bite).toBeGreaterThan(0);
  });

  it('puxar fora da fisgada só recolhe; puxar nela traz o peixe, XP e gasta a vara', () => {
    const { session } = pond();
    const line = session.fishing;
    session.useHeld();
    for (let t = 0; t < 30; t++) session.tick();
    expect(line.state).toBe(LINE_WATER);
    // Sem mordida: recolhe sem nada.
    for (let t = 0; t < 5; t++) session.tick();
    session.useHeld();
    expect(line.state).toBe(LINE_IDLE);
    expect(session.items.active).toBe(0);

    for (let t = 0; t < 5; t++) session.tick();
    session.useHeld();
    for (let t = 0; t < 400 && line.bite === 0; t++) session.tick();
    expect(line.bite).toBeGreaterThan(0);
    const orbs = session.orbs.active;
    session.useHeld();
    expect(line.state).toBe(LINE_IDLE);
    expect(session.items.active + session.inventory.countOf(itemId('cod'))).toBeGreaterThan(0);
    expect(session.orbs.active).toBeGreaterThan(orbs);
    expect(session.inventory.held?.damage).toBe(1);
  });

  it('largar a vara ou se afastar arrebenta a linha', () => {
    const { session, player } = pond();
    const line = session.fishing;
    session.useHeld();
    for (let t = 0; t < 30; t++) session.tick();
    session.inventory.select(1);
    session.tick();
    expect(line.state).toBe(LINE_IDLE);

    session.inventory.select(0);
    for (let t = 0; t < 5; t++) session.tick();
    session.interaction.updateTarget();
    session.useHeld();
    for (let t = 0; t < 30; t++) session.tick();
    expect(line.active).toBe(true);
    // Mais longe que a linha alcança.
    player.setPosition(line.x - 40, 64, 8.5);
    session.tick();
    expect(line.state).toBe(LINE_IDLE);
  });

  it('no chão a boia para e não pesca nada', () => {
    const { session, player } = pond();
    player.yaw = -Math.PI / 2; // de costas para o lago
    session.interaction.updateTarget();
    const line = session.fishing;
    session.useHeld();
    for (let t = 0; t < 60; t++) session.tick();
    expect(line.state).toBe(LINE_GROUND);
    for (let t = 0; t < 400; t++) session.tick();
    expect(line.bite).toBe(0);
    session.useHeld();
    expect(session.items.active).toBe(0);
  });
});

describe('critério do doc 14', () => {
  it('10 peixes em 5 minutos de jogo', () => {
    const { session } = pond();
    const line = session.fishing;
    const FIVE_MINUTES = 5 * 60 * 20;
    let caught = 0;
    let reaction = -1;
    for (let t = 0; t < FIVE_MINUTES; t++) {
      if (!line.active) {
        session.useHeld();
      } else if (line.bite > 0) {
        // Um jogador leva ~0,3 s para reagir à fisgada.
        if (reaction < 0) reaction = 6;
        else if (--reaction === 0) {
          const before = session.journal.stats.get('fish_caught');
          session.useHeld();
          if (session.journal.stats.get('fish_caught') > before) caught++;
          reaction = -1;
        }
      }
      session.tick();
    }
    expect(caught).toBeGreaterThanOrEqual(10);
  }, 60_000);
});
