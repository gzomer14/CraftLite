/**
 * Aconchego (M26): fogueira, caldeirão, lanterna, vaso, moldura de item,
 * tronco descascado, terracota e concreto.
 *
 * O critério do doc 14: cada bloco é linha de tabela; a fogueira assa carne em
 * ~30 s; 16 cores de concreto custam ≤ 2 camadas. O clique aqui é o de
 * verdade — `Session.useHeld` com o bloco mirado —, que é o caminho que o
 * jogador percorre.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { Interaction } from '../src/game/interaction';
import {
  AIR, BLOCK_BY_NAME, BLOCKS, STONE, blockIdOf, makeState, stateBitsOf,
} from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, makeStack } from '../src/data/items';
import { RECIPES, TAGS } from '../src/data/recipes';
import { USE_COOLDOWN } from '../src/game/itemuse';
import { SMELTING } from '../src/data/smelting';
import { DYES } from '../src/data/dyes';
import { CAMPFIRE_COOK_TICKS, POTTABLE } from '../src/data/cozy';
import { THING_NAMES_EN } from '../src/data/strings/names.en';
import { Campfire, campfireResult } from '../src/game/campfire';
import { containerFrom, tileFrom } from '../src/game/savegame';
import { dropBlockLoot } from '../src/game/drops';
import { emitCampfireSmoke } from '../src/game/ambient';
import { environmentHarm } from '../src/entity/mobrules';
import { MOB_BY_NAME } from '../src/data/mobs';
import {
  MAX_BOXES, MOUNT_CEILING, MOUNT_FLOOR, SHAPE_BY_NAME, boxesFor,
} from '../src/world/mesh/shapes';
import { CPLX_BOXES, CPLX_DECOR, buildBlockTables } from '../src/world/mesh/blockinfo';
import { GreedyMesher, NB_SIDE, nbIndex } from '../src/world/mesh/greedy';
import { buildLayerIndex } from '../src/render/layers';
import type { RayHit } from '../src/world/raycast';

const GROUND = 63;
const Y = GROUND + 1;
const block = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const item = (name: string): number => itemId(name);

/** Plataforma de pedra 3×3 chunks e uma sessão de Sobrevivência em cima. */
function rig(): { world: World; session: Session; player: Player } {
  const world = new World(26);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, makeState(STONE));
        }
      }
      chunk.recomputeHeightMap();
      world.addChunk(chunk);
    }
  }
  const player = new Player(0.5, Y, -6.5);
  player.mode = 'survival';
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  let seed = 1;
  session.random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed / 4294967296; };
  return { world, session, player };
}

/** Põe um bloco como o jogador poria: mundo e tile entity. */
function put(session: Session, x: number, y: number, z: number, name: string, bits = 0): void {
  session.world.setBlock(x, y, z, makeState(block(name), bits), 'player');
  session.tiles.create(x, y, z, block(name));
}

/** Clique direito no bloco, com `name` (ou nada) na mão. */
function click(session: Session, x: number, y: number, z: number, name: string | null, count = 1): boolean {
  session.inventory.set(session.inventory.selected, name === null ? null : makeStack(item(name), count));
  const hit: RayHit = {
    hit: true, x, y, z, nx: 0, ny: 1, nz: 0, px: x + 0.5, py: y + 1, pz: z + 0.5,
    distance: 3, state: session.world.getBlock(x, y, z),
  };
  session.interaction.state.target = hit;
  return session.useHeld(true);
}

const heldName = (session: Session): string | null => {
  const held = session.inventory.held;
  return held === null ? null : [...ITEM_BY_NAME.values()].find((d) => d.id === held.item)!.name;
};

const ticks = (session: Session, n: number): void => {
  for (let i = 0; i < n; i++) session.tick();
};

const itemsOnGround = (session: Session, name: string): number => {
  let n = 0;
  session.items.forEach((_x, _y, _z, id, count) => { if (id === item(name)) n += count; });
  return n;
};

describe('tabela (critério: cada bloco é linha de tabela)', () => {
  const NEW = [
    'campfire', 'campfire_off', 'cauldron', 'lantern', 'flower_pot', 'item_frame',
    'stripped_oak_log', 'stripped_birch_log', 'stripped_spruce_log', 'stripped_acacia_log',
    'stripped_jungle_log', 'terracotta',
    ...DYES.map((d) => `${d.name}_terracotta`), ...DYES.map((d) => `${d.name}_concrete`),
  ];

  it('os ids nascem no fim, a partir de 245, na ordem da tabela', () => {
    NEW.forEach((name, i) => expect(block(name), name).toBe(245 + i));
  });

  it('todo bloco novo tem nome em inglês e, menos a fogueira apagada, item', () => {
    for (const name of NEW) {
      expect(THING_NAMES_EN[name], name).toBeDefined();
      expect(ITEM_BY_NAME.has(name), name).toBe(name !== 'campfire_off');
    }
    expect(ITEM_BY_NAME.has('iron_nugget')).toBe(true);
  });

  it('todo bloco novo com item sai de uma receita, da fornalha ou do machado', () => {
    const crafted = new Set(RECIPES.map((r) => r.result.item));
    const smelted = new Set(SMELTING.map((r) => r.output));
    for (const name of NEW) {
      if (name === 'campfire_off' || name.startsWith('stripped_')) continue;
      expect(crafted.has(name) || smelted.has(name), name).toBe(true);
    }
  });

  it('critério: as 16 cores de concreto custam ≤ 2 camadas — e as de terracota, outra', () => {
    const concrete = new Set<string>();
    const terracotta = new Set<string>();
    for (const dye of DYES) {
      concrete.add(BLOCKS[block(`${dye.name}_concrete`)]!.tex as string);
      terracotta.add(BLOCKS[block(`${dye.name}_terracotta`)]!.tex as string);
    }
    expect(concrete.size).toBe(1);
    expect(terracotta.size).toBe(1);
    // Cada cor aponta o próprio corante: é o tint que faz as dezesseis.
    expect(new Set(DYES.map((d) => BLOCKS[block(`${d.name}_concrete`)]!.dye)).size).toBe(16);
  });

  it('as formas novas cabem nas caixas e no bloco', () => {
    const out = new Float32Array(MAX_BOXES * 6);
    for (const name of ['campfire', 'cauldron', 'lantern', 'flower_pot', 'item_frame']) {
      const shape = SHAPE_BY_NAME[BLOCKS[block(name)]!.shape];
      for (const bits of [0, 1, 2, 3, MOUNT_FLOOR, MOUNT_CEILING]) {
        const count = boxesFor(shape, bits, 0, out);
        expect(count, name).toBeGreaterThan(0);
        expect(count, name).toBeLessThanOrEqual(MAX_BOXES);
        for (let i = 0; i < count * 6; i++) {
          expect(out[i]).toBeGreaterThanOrEqual(0);
          expect(out[i]).toBeLessThanOrEqual(1);
        }
      }
    }
  });
});

describe('fogueira', () => {
  it('critério: assa carne em 30 s, sem combustível, e solta o bife pronto', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'campfire');
    expect(click(session, 0, Y, 0, 'beef', 3)).toBe(true);
    expect(session.inventory.held?.count).toBe(2);
    ticks(session, CAMPFIRE_COOK_TICKS - 1);
    expect(itemsOnGround(session, 'cooked_beef')).toBe(0);
    ticks(session, 1);
    expect(itemsOnGround(session, 'cooked_beef')).toBe(1);
    expect(CAMPFIRE_COOK_TICKS / 20).toBe(30);
  });

  it('assa quatro de uma vez, e só o que a fornalha transforma em comida', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'campfire');
    for (let i = 0; i < 4; i++) expect(click(session, 0, Y, 0, 'chicken')).toBe(true);
    const tile = session.tiles.at(0, Y, 0) as Campfire;
    expect(tile.isEmpty).toBe(false);
    expect(tile.place(item('mutton'))).toBe(false);
    expect(campfireResult(item('cod'))).toBe(item('cooked_cod'));
    expect(campfireResult(item('raw_iron'))).toBe(-1);
    expect(campfireResult(item('cobblestone'))).toBe(-1);
  });

  it('balde de água apaga (a comida para de assar); o isqueiro acende de novo', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'campfire');
    click(session, 0, Y, 0, 'porkchop');
    expect(click(session, 0, Y, 0, 'water_bucket')).toBe(true);
    expect(blockIdOf(world.getBlock(0, Y, 0))).toBe(block('campfire_off'));
    expect(heldName(session)).toBe('bucket');
    ticks(session, CAMPFIRE_COOK_TICKS);
    expect(itemsOnGround(session, 'cooked_porkchop')).toBe(0);
    expect(click(session, 0, Y, 0, 'flint_and_steel')).toBe(true);
    expect(blockIdOf(world.getBlock(0, Y, 0))).toBe(block('campfire'));
    ticks(session, CAMPFIRE_COOK_TICKS);
    expect(itemsOnGround(session, 'cooked_porkchop')).toBe(1);
  });

  it('a pá também apaga', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'campfire');
    expect(click(session, 0, Y, 0, 'iron_shovel')).toBe(true);
    expect(blockIdOf(world.getBlock(0, Y, 0))).toBe(block('campfire_off'));
  });

  it('fere quem está em cima, sem acender; ao lado, não', () => {
    const { session, player } = rig();
    put(session, 0, Y, 0, 'campfire');
    player.setPosition(0.5, Y + 7 / 16, 0.5);
    ticks(session, 20);
    expect(session.survival.health).toBeLessThan(20);
    expect(session.survival.burnTicks).toBe(0);
    const { session: beside, player: p2 } = rig();
    put(beside, 0, Y, 0, 'campfire');
    p2.setPosition(2.5, Y, 0.5);
    ticks(beside, 20);
    expect(beside.survival.health).toBe(20);
  });

  it('fere o mob em cima dela, e o resistente ao fogo não', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'campfire');
    const s = session.mobs.store;
    const cow = session.mobs.spawn(MOB_BY_NAME.get('cow')!.id, 0.5, Y + 7 / 16, 0.5, 0);
    expect(environmentHarm(s, cow, world, true, 15, 10)).toBe(1);
    expect(s.fireTicks[cow]).toBe(0);
    const blaze = session.mobs.spawn(MOB_BY_NAME.get('blaze')!.id, 0.5, Y + 7 / 16, 0.5, 0);
    expect(environmentHarm(s, blaze, world, true, 15, 10)).toBe(0);
  });

  it('quebrar solta o que estava assando; o save guarda a comida e o ponto', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'campfire');
    click(session, 0, Y, 0, 'beef');
    ticks(session, 100);
    const tile = session.tiles.at(0, Y, 0) as Campfire;
    const back = containerFrom(JSON.parse(JSON.stringify(tileFrom(tile)))) as Campfire;
    expect(back).toBeInstanceOf(Campfire);
    expect(back.get(0)?.item).toBe(item('beef'));
    expect(back.cookTicks[0]).toBe(100);
    session.tiles.remove(0, Y, 0);
    expect(itemsOnGround(session, 'beef')).toBe(1);
  });

  it('a fumaça sobe só da fogueira acesa e perto', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'campfire');
    put(session, 3, Y, 0, 'campfire_off');
    const always = (): number => 0;
    const at: number[] = [];
    const n = emitCampfireSmoke(world, session.tiles.shown, 0, 0, (x, y, z) => at.push(x, y, z), always);
    expect(n).toBe(1);
    expect(at[0]).toBe(0.5);
    expect(emitCampfireSmoke(world, session.tiles.shown, 500, 500, () => {}, always)).toBe(0);
  });
});

describe('caldeirão', () => {
  it('balde enche, frasco tira um nível, frasco d’água devolve, balde esvazia o cheio', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'cauldron');
    const level = (): number => stateBitsOf(world.getBlock(0, Y, 0)) & 3;
    expect(click(session, 0, Y, 0, 'glass_bottle')).toBe(false);
    expect(click(session, 0, Y, 0, 'water_bucket')).toBe(true);
    expect(level()).toBe(3);
    expect(heldName(session)).toBe('bucket');
    expect(click(session, 0, Y, 0, 'glass_bottle')).toBe(true);
    expect(level()).toBe(2);
    expect(heldName(session)).toBe('water_bottle');
    // Balde vazio só pega o caldeirão cheio.
    expect(click(session, 0, Y, 0, 'bucket')).toBe(false);
    expect(click(session, 0, Y, 0, 'water_bottle')).toBe(true);
    expect(level()).toBe(3);
    expect(click(session, 0, Y, 0, 'bucket')).toBe(true);
    expect(level()).toBe(0);
    expect(heldName(session)).toBe('water_bucket');
  });

  it('apaga quem entra pegando fogo — com água; seco, não', () => {
    const { session, player, world } = rig();
    put(session, 0, Y, 0, 'cauldron');
    player.setPosition(0.5, Y + 4 / 16, 0.5);
    session.survival.burnTicks = 100;
    ticks(session, 1);
    expect(session.survival.burnTicks).toBe(99);
    world.setBlock(0, Y, 0, makeState(block('cauldron'), 2), 'player');
    ticks(session, 1);
    expect(session.survival.burnTicks).toBe(0);
  });
});

describe('vaso de flor', () => {
  it('a planta entra, sai de volta e cai junto quando o vaso quebra', () => {
    const { session, world } = rig();
    put(session, 0, Y, 0, 'flower_pot');
    // Pedra não é planta: o vaso não responde, e o clique segue para colocar.
    click(session, 0, Y, 0, 'stone');
    expect(stateBitsOf(world.getBlock(0, Y, 0))).toBe(0);
    world.setBlock(0, Y + 1, 0, makeState(AIR), 'player');
    expect(click(session, 0, Y, 0, 'poppy')).toBe(true);
    expect(stateBitsOf(world.getBlock(0, Y, 0))).toBe(POTTABLE.indexOf('poppy') + 1);
    expect(session.inventory.held).toBeNull();
    expect(click(session, 0, Y, 0, null)).toBe(true);
    expect(stateBitsOf(world.getBlock(0, Y, 0))).toBe(0);
    expect(session.inventory.countOf(item('poppy'))).toBe(1);

    click(session, 0, Y, 0, 'birch_sapling');
    const state = world.getBlock(0, Y, 0);
    session.inventory.set(session.inventory.selected, null);
    dropBlockLoot(session, 0, Y, 0, state);
    expect(itemsOnGround(session, 'flower_pot')).toBe(1);
    expect(itemsOnGround(session, 'birch_sapling')).toBe(1);
  });

  it('toda planta da tabela tem textura no vaso', () => {
    const pot = BLOCKS[block('flower_pot')]!;
    expect(pot.stages.length).toBe(POTTABLE.length + 1);
    expect(pot.stages).not.toContain('block/missing');
  });
});

describe('moldura de item', () => {
  it('guarda um do item da mão, devolve no clique seguinte, e vai para o save', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'item_frame', 2);
    expect(click(session, 0, Y, 0, null)).toBe(false);
    expect(click(session, 0, Y, 0, 'diamond', 5)).toBe(true);
    expect(session.inventory.held?.count).toBe(4);
    const tile = session.tiles.at(0, Y, 0)!;
    expect(tile.get(0)?.item).toBe(item('diamond'));
    expect(session.tiles.shown).toContain(tile);
    expect(containerFrom(JSON.parse(JSON.stringify(tileFrom(tile)))).get(0)?.item).toBe(item('diamond'));
    expect(click(session, 0, Y, 0, null)).toBe(true);
    expect(tile.get(0)).toBeNull();
    expect(session.inventory.countOf(item('diamond'))).toBe(1);
  });

  it('no convidado de uma sala, o clique é engolido e o item fica na mão', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'item_frame');
    put(session, 2, Y, 0, 'campfire');
    session.cozy.remoteTiles = true;
    expect(click(session, 0, Y, 0, 'diamond')).toBe(true);
    expect(session.inventory.held?.count).toBe(1);
    expect(session.tiles.at(0, Y, 0)!.get(0)).toBeNull();
    // A comida não vai para a fogueira — e o clique não vira mordida.
    expect(click(session, 2, Y, 0, 'beef')).toBe(true);
    expect(session.inventory.held?.count).toBe(1);
    expect(session.tiles.at(2, Y, 0)!.isEmpty).toBe(true);
  });

  it('quebrar solta o item; a moldura sai da lista do render', () => {
    const { session } = rig();
    put(session, 0, Y, 0, 'item_frame');
    click(session, 0, Y, 0, 'iron_sword');
    session.tiles.remove(0, Y, 0);
    expect(itemsOnGround(session, 'iron_sword')).toBe(1);
    expect(session.tiles.shown.length).toBe(0);
  });
});

describe('machado descasca o tronco', () => {
  it('no mesmo eixo, gastando o machado; a tábua sai dele também', () => {
    const { session, world } = rig();
    world.setBlock(0, Y, 0, makeState(block('birch_log'), 1), 'player');
    expect(click(session, 0, Y, 0, 'stone_axe')).toBe(true);
    expect(blockIdOf(world.getBlock(0, Y, 0))).toBe(block('stripped_birch_log'));
    expect(stateBitsOf(world.getBlock(0, Y, 0))).toBe(1);
    expect(session.inventory.held?.damage).toBe(1);
    // Descascado não descasca de novo, e o machado não é bloco: o clique não faz nada.
    ticks(session, USE_COOLDOWN);
    expect(click(session, 0, Y, 0, 'stone_axe')).toBe(false);
    expect(blockIdOf(world.getBlock(0, Y, 0))).toBe(block('stripped_birch_log'));
    // O descascado é tronco para a tábua, o carvão e a fogueira (`#logs`).
    expect(TAGS.logs).toContain('stripped_birch_log');
  });
});

describe('lanterna', () => {
  it('pendura com o clique por baixo; no chão com o clique por cima', () => {
    const { world, player } = rig();
    const interaction = new Interaction(world, player, { onBlockChanged: () => { /* nada */ } });
    world.setBlock(4, Y + 2, 4, makeState(STONE), 'player');
    const hit = (x: number, y: number, z: number, ny: number): RayHit => ({
      hit: true, x, y, z, nx: 0, ny, nz: 0, px: x + 0.5, py: y + 0.5, pz: z + 0.5,
      distance: 3, state: world.getBlock(x, y, z),
    });
    interaction.state.target = hit(4, Y + 2, 4, -1);
    expect(interaction.tryPlace(makeStack(item('lantern')))).toBe(true);
    expect(stateBitsOf(world.getBlock(4, Y + 1, 4)) & 7).toBe(MOUNT_CEILING);
    // O intervalo entre duas colocações corre no tick de quebrar.
    for (let i = 0; i < 10; i++) interaction.tickBreaking(false, null);
    interaction.state.target = hit(6, GROUND, 6, 1);
    expect(interaction.tryPlace(makeStack(item('lantern')))).toBe(true);
    expect(stateBitsOf(world.getBlock(6, Y, 6)) & 7).toBe(MOUNT_FLOOR);
    expect(BLOCKS[block('lantern')]!.emission).toBe(15);
  });
});

describe('malha', () => {
  const index = buildLayerIndex();
  const tables = buildBlockTables(index);
  const mesher = new GreedyMesher(tables, true);
  const VOL = NB_SIDE * NB_SIDE * NB_SIDE;
  const quadsOf = (state: number): number => {
    const blocks = new Uint16Array(VOL);
    blocks[nbIndex(8, 8, 8)] = state;
    return mesher.mesh(blocks, new Uint8Array(VOL).fill(0xf0)).quads;
  };

  it('fogueira, vaso e caldeirão têm recheio; lanterna e moldura são caixas', () => {
    for (const name of ['campfire', 'campfire_off', 'flower_pot', 'cauldron']) {
      expect(tables.complex[block(name)], name).toBe(CPLX_DECOR);
    }
    expect(tables.complex[block('lantern')]).toBe(CPLX_BOXES);
    expect(tables.complex[block('item_frame')]).toBe(CPLX_BOXES);
  });

  it('a chama, a planta e a água entram como quads a mais', () => {
    expect(quadsOf(makeState(block('campfire'))) - quadsOf(makeState(block('campfire_off')))).toBe(2);
    expect(quadsOf(makeState(block('flower_pot'), 1)) - quadsOf(makeState(block('flower_pot')))).toBe(2);
    expect(quadsOf(makeState(block('cauldron'), 3)) - quadsOf(makeState(block('cauldron')))).toBe(1);
  });
});
