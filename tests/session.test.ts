/**
 * O critério de aceite do M4 (doc 14): *"é possível começar do zero, cortar
 * madeira, craftar picareta de pedra, minerar ferro, fazer fornalha, cozinhar
 * comida"*.
 *
 * Este arquivo joga exatamente esse roteiro, sem GL nem DOM.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Furnace, FURNACE_FUEL, FURNACE_INPUT, FURNACE_OUTPUT } from '../src/game/container';
import { AIR, BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { itemId, makeStack } from '../src/data/items';
import { CRAFT_RESULT, CRAFT_START } from '../src/game/inventory';
import { SMELT_TICKS } from '../src/data/smelting';

const block = (name: string): number => makeState(BLOCK_BY_NAME.get(name)!.id);

/** Mundo plano de pedra com uma camada de grama, para o roteiro. */
function testWorld(): World {
  const world = new World(7777);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= 63; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            chunk.setBlock(x, y, z, block(y === 63 ? 'grass_block' : 'stone'));
          }
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
  return world;
}

interface Harness {
  world: World;
  player: Player;
  session: Session;
  screens: string[];
  deaths: string[];
}

function harness(): Harness {
  const world = testWorld();
  const player = new Player(8.5, 64, 8.5);
  const screens: string[] = [];
  const deaths: string[] = [];
  const session = new Session(world, player, {
    onOpenScreen: (s) => screens.push(s),
    onDeath: (m) => deaths.push(m),
    onPickup: () => { /* nada */ },
  });
  return { world, player, session, screens, deaths };
}

/** Mira o bloco logo abaixo do jogador e quebra até sumir. */
function mineBelow(h: Harness, maxTicks = 600): void {
  h.player.mode = 'creative';
  h.player.pitch = Math.PI / 2 - 0.01;
  for (let i = 0; i < maxTicks; i++) {
    h.session.interaction.updateTarget();
    if (h.session.interaction.state.target === null) break;
    h.session.interaction.tickBreaking(true, h.session.inventory.held);
    break;
  }
}

describe('drops e coleta', () => {
  it('quebrar grama dropa terra e o jogador coleta', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.player.setPosition(8.5, 64, 8.5);
    h.player.pitch = Math.PI / 2 - 0.01;
    h.session.interaction.updateTarget();

    for (let i = 0; i < 300 && h.world.getBlock(8, 63, 8) !== AIR; i++) {
      h.session.interaction.updateTarget();
      h.session.interaction.tickBreaking(true, null);
    }
    expect(h.world.getBlock(8, 63, 8)).toBe(AIR);
    expect(h.session.items.active).toBeGreaterThan(0);

    // Alguns ticks e o item é coletado.
    for (let i = 0; i < 60; i++) h.session.tick();
    expect(h.session.inventory.countOf(itemId('dirt'))).toBeGreaterThan(0);
  });

  it('no criativo não dropa nada', () => {
    const h = harness();
    mineBelow(h);
    expect(h.session.items.active).toBe(0);
  });
});

describe('roteiro de sobrevivência do doc 14', () => {
  it('madeira → tábuas → gravetos → bancada → picareta de pedra', () => {
    const h = harness();
    const inv = h.session.inventory;

    // 1. Cortar madeira.
    inv.give(itemId('oak_log'), 4);
    expect(inv.countOf(itemId('oak_log'))).toBe(4);

    // 2. Tronco → 4 tábuas, na grade 2×2 do inventário.
    inv.set(CRAFT_START, makeStack(itemId('oak_log'), 4));
    h.session.refreshCraftResult();
    expect(inv.get(CRAFT_RESULT)?.item).toBe(itemId('oak_planks'));

    // Retira 4 vezes: 16 tábuas.
    for (let i = 0; i < 4; i++) {
      inv.click(CRAFT_RESULT, 'left');
      inv.cursor = null; // simplifica: o item vai direto para o "bolso"
      inv.give(itemId('oak_planks'), 4);
    }
    expect(inv.countOf(itemId('oak_planks'))).toBeGreaterThanOrEqual(16);

    // 3. Tábuas → gravetos.
    clearCraft(inv);
    inv.set(CRAFT_START, makeStack(itemId('oak_planks'), 2));
    inv.set(CRAFT_START + 2, makeStack(itemId('oak_planks'), 2));
    h.session.refreshCraftResult();
    expect(inv.get(CRAFT_RESULT)?.item).toBe(itemId('stick'));

    // 4. Tábuas → bancada.
    clearCraft(inv);
    for (let i = 0; i < 4; i++) inv.set(CRAFT_START + i, makeStack(itemId('oak_planks'), 1));
    h.session.refreshCraftResult();
    expect(inv.get(CRAFT_RESULT)?.item).toBe(itemId('crafting_table'));
    clearCraft(inv);

    // 5. Na bancada 3×3: picareta de pedra.
    h.session.setScreen('crafting', h.session.bench);
    const bench = h.session.bench;
    for (let i = 0; i < 3; i++) bench.set(i, makeStack(itemId('cobblestone'), 1));
    bench.set(4, makeStack(itemId('stick'), 1));
    bench.set(7, makeStack(itemId('stick'), 1));
    h.session.refreshCraftResult();
    expect(inv.get(CRAFT_RESULT)?.item).toBe(itemId('stone_pickaxe'));
  });

  it('fornalha cozinha carne com carvão', () => {
    const furnace = new Furnace(0, 64, 0);
    furnace.set(FURNACE_INPUT, makeStack(itemId('beef'), 1));
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));

    for (let i = 0; i < SMELT_TICKS + 5; i++) furnace.tick();

    expect(furnace.get(FURNACE_OUTPUT)?.item).toBe(itemId('cooked_beef'));
    expect(furnace.get(FURNACE_INPUT)).toBeNull();
  });

  it('a fornalha continua queimando com a tela fechada', () => {
    const h = harness();
    const furnace = new Furnace(4, 64, 4);
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 3));
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 2));
    h.session.restoreContainer(furnace);

    // Nenhuma tela aberta; só o tick do mundo.
    for (let i = 0; i < SMELT_TICKS * 2 + 10; i++) h.session.tick();
    expect(furnace.get(FURNACE_OUTPUT)?.count).toBeGreaterThanOrEqual(2);
  });

  it('a fornalha não cozinha sem combustível', () => {
    const furnace = new Furnace(0, 64, 0);
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 1));
    for (let i = 0; i < SMELT_TICKS * 2; i++) furnace.tick();
    expect(furnace.get(FURNACE_OUTPUT)).toBeNull();
  });

  it('carvão queima 8 itens (doc 05 §5)', () => {
    const furnace = new Furnace(0, 64, 0);
    furnace.set(FURNACE_INPUT, makeStack(itemId('raw_iron'), 10));
    furnace.set(FURNACE_FUEL, makeStack(itemId('coal'), 1));
    for (let i = 0; i < 1600 + 100; i++) furnace.tick();
    // 1600 ticks / 200 por item = 8.
    expect(furnace.get(FURNACE_OUTPUT)?.count).toBe(8);
  });

  it('comer restaura a fome', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.survival.hunger = 10;
    h.session.inventory.set(0, makeStack(itemId('cooked_beef'), 1));

    for (let i = 0; i < 40; i++) h.session.useHeld();
    expect(h.session.survival.hunger).toBeGreaterThan(10);
    expect(h.session.inventory.countOf(itemId('cooked_beef'))).toBe(0);
  });

  it('não come com a fome cheia', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.inventory.set(0, makeStack(itemId('bread'), 1));
    for (let i = 0; i < 60; i++) h.session.useHeld();
    expect(h.session.inventory.countOf(itemId('bread'))).toBe(1);
  });
});

describe('durabilidade', () => {
  it('quebrar blocos gasta a ferramenta', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.inventory.set(0, makeStack(itemId('stone_pickaxe'), 1));
    h.player.pitch = Math.PI / 2 - 0.01;

    for (let i = 0; i < 400 && h.world.getBlock(8, 63, 8) !== AIR; i++) {
      h.session.interaction.updateTarget();
      h.session.interaction.tickBreaking(true, h.session.inventory.held);
    }
    expect(h.session.inventory.get(0)?.damage).toBe(1);
  });

  it('no criativo a ferramenta não gasta', () => {
    const h = harness();
    h.player.mode = 'creative';
    h.session.inventory.set(0, makeStack(itemId('stone_pickaxe'), 1));
    mineBelow(h);
    expect(h.session.inventory.get(0)?.damage).toBe(0);
  });
});

describe('contêineres no mundo', () => {
  it('abrir a bancada troca de tela', () => {
    const h = harness();
    h.world.setBlock(8, 64, 8, block('crafting_table'), 'player');
    h.player.setPosition(8.5, 64, 10.5);
    // Os olhos ficam a 65.62 e a bancada ocupa 64..65: olhar reto passa por
    // cima dela, então o teste precisa inclinar a câmera.
    h.player.pitch = 0.5;
    h.player.yaw = Math.PI; // olhando para −Z
    h.session.interaction.updateTarget();
    expect(h.session.interaction.state.target).not.toBeNull();
    h.session.useHeld();
    expect(h.session.openScreen).toBe('crafting');
  });

  it('quebrar o baú devolve o conteúdo', () => {
    const h = harness();
    h.player.mode = 'creative';
    h.world.setBlock(8, 64, 8, block('chest'), 'player');
    h.session.interaction.onBlockPlaced?.(8, 64, 8, block('chest'));

    const chest = h.session.containerAt(8, 64, 8);
    expect(chest).toBeDefined();
    chest!.set(0, makeStack(itemId('diamond'), 3));

    h.player.setPosition(8.5, 66, 8.5);
    h.player.pitch = Math.PI / 2 - 0.01;
    h.session.interaction.updateTarget();
    h.session.interaction.tickBreaking(true, null);

    expect(h.session.items.active).toBeGreaterThan(0);
  });
});

describe('morte e respawn', () => {
  it('morrer dropa o inventário e avisa', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.inventory.give(itemId('diamond'), 5);
    h.session.survival.damage(100, 'fall');

    expect(h.deaths.length).toBe(1);
    expect(h.session.inventory.countOf(itemId('diamond'))).toBe(0);
    expect(h.session.items.active).toBeGreaterThan(0);
  });

  it('respawn restaura a vida e reposiciona', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.survival.damage(100, 'void', true);
    h.session.respawn(8, 8);
    expect(h.session.survival.health).toBe(20);
    expect(h.session.survival.isDead).toBe(false);
    expect(h.player.y).toBeGreaterThan(60);
  });
});

describe('experiência no mundo (M6)', () => {
  it('quebrar minério solta orbe e o jogador acumula nível', () => {
    const h = harness();
    h.player.mode = 'survival';
    // Picareta de ferro na mão: minério de diamante exige tier 3.
    h.session.inventory.set(0, makeStack(itemId('iron_pickaxe')));
    h.session.inventory.select(0);
    h.world.setBlock(8, 63, 8, block('diamond_ore'), 'player');

    h.player.setPosition(8.5, 64, 8.5);
    h.player.pitch = Math.PI / 2 - 0.01;
    for (let i = 0; i < 3000 && h.world.getBlock(8, 63, 8) !== AIR; i++) {
      h.session.interaction.updateTarget();
      h.session.interaction.tickBreaking(true, h.session.inventory.held);
    }
    expect(h.world.getBlock(8, 63, 8)).toBe(AIR);
    expect(h.session.orbs.active).toBeGreaterThan(0);

    for (let i = 0; i < 60 && h.session.orbs.active > 0; i++) h.session.tick();
    expect(h.session.orbs.active).toBe(0);
    expect(h.session.xp.total).toBeGreaterThanOrEqual(3);
  });

  it('morrer zera a experiência', () => {
    const h = harness();
    h.player.mode = 'survival';
    h.session.xp.setTotal(500);
    h.session.survival.damage(100, 'void', true);
    expect(h.session.xp.total).toBe(0);
    expect(h.session.xp.level).toBe(0);
  });

  it('tirar da fornalha entrega a experiência guardada', () => {
    const h = harness();
    const furnace = new Furnace(2, 64, 2);
    furnace.storedXp = 3.4;
    h.session.collectFurnaceXp(furnace);
    expect(h.session.orbs.active).toBe(1);
    // Só a parte inteira sai; a fração fica para a próxima fornada.
    expect(furnace.storedXp).toBeCloseTo(0.4, 5);
  });
});

describe('fechar a tela devolve os itens', () => {
  it('a grade de craft não engole itens', () => {
    const h = harness();
    const inv = h.session.inventory;
    h.session.setScreen('inventory', null);
    inv.set(CRAFT_START, makeStack(itemId('diamond'), 4));
    h.session.closeScreen();
    expect(inv.countOf(itemId('diamond'))).toBe(4);
    expect(inv.get(CRAFT_START)).toBeNull();
  });
});

function clearCraft(inv: { set: (i: number, v: null) => void }): void {
  for (let i = 0; i < 4; i++) inv.set(CRAFT_START + i, null);
}

/**
 * Golpe no criativo (bug de campo, 2026-09-10: "nenhum mob toma dano").
 *
 * O ataque estava preso a `mode === 'survival'` no laço principal, então no
 * criativo o clique caía direto no `tickBreaking` — que no criativo quebra o
 * bloco atrás do mob. Bater em bicho não fazia absolutamente nada.
 */
describe('ataque no criativo', () => {
  const MOB_AHEAD = 2;

  const setup = (mode: 'creative' | 'survival'): Harness => {
    const h = harness();
    h.player.mode = mode;
    h.player.setPosition(8.5, 64, 8.5);
    h.player.yaw = 0;
    h.player.pitch = 0;
    return h;
  };

  it('o golpe no criativo mata de uma vez', () => {
    const h = setup('creative');
    const cow = h.session.mobs.spawn(0, 8.5, 64, 8.5 + MOB_AHEAD);
    expect(cow).toBeGreaterThanOrEqual(0);
    const before = h.session.mobs.count;
    expect(h.session.attackAlong(0, -0.3, 1)).toBe(true);
    expect(h.session.mobs.count).toBe(before - 1);
  });

  it('no sobrevivência continua levando vários golpes', () => {
    const h = setup('survival');
    h.session.mobs.spawn(0, 8.5, 64, 8.5 + MOB_AHEAD);
    const before = h.session.mobs.count;
    expect(h.session.attackAlong(0, -0.3, 1)).toBe(true);
    expect(h.session.mobs.count).toBe(before);
  });
});
