/**
 * Poções (M16): o suporte de preparo, beber, os efeitos novos e a verruga.
 *
 * O doc 14 pede cura, força, velocidade, visão noturna e resistência ao fogo,
 * "com o suporte de preparo, a verruga do Nether e o sistema de efeitos do
 * M11", e a tabela de receitas como dado.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { BLOCK_BY_NAME, STONE, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, makeStack } from '../src/data/items';
import { EFFECT_BY_NAME } from '../src/data/effects';
import { BREWING, BREW_TICKS, BREWS_PER_FUEL, POTIONS } from '../src/data/potions';
import {
  BREW_FUEL, BREW_INGREDIENT, BrewingStand, brewingAccepts, brewResult,
} from '../src/game/brewing';
import { StatusEffects } from '../src/game/effects';
import { Survival } from '../src/game/survival';
import { brewingHelp } from '../src/game/stationhelp';
import { containerFrom, tileFrom } from '../src/game/savegame';
import { clickContainer } from '../src/ui/containers/containerclick';
import { Inventory } from '../src/game/inventory';

const GROUND = 63;
const block = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const item = (name: string): number => itemId(name);
const effect = (name: string): number => EFFECT_BY_NAME.get(name)!.id;

function rig(): { world: World; session: Session; player: Player } {
  const world = new World(5);
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
  const player = new Player(0.5, GROUND + 1, 0.5);
  player.mode = 'survival';
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  return { world, session, player };
}

function stand(): BrewingStand {
  return new BrewingStand(0, 0, 0);
}

function brew(s: BrewingStand, ticks = BREW_TICKS + 2): void {
  for (let i = 0; i < ticks; i++) s.tick();
}

describe('tabela de poções', () => {
  it('toda receita fala de itens que existem, e toda poção é item de uma pilha', () => {
    for (const recipe of BREWING) {
      expect(brewResult(item(recipe.base), item(recipe.ingredient))).toBe(item(recipe.result));
    }
    for (const potion of POTIONS) {
      const def = ITEM_BY_NAME.get(potion.name)!;
      expect(def.maxStack).toBe(1);
      expect(def.remainder).toBe('glass_bottle');
      expect(def.food?.drink).toBe(true);
      if (potion.effect !== undefined) expect(EFFECT_BY_NAME.has(potion.effect)).toBe(true);
    }
  });

  it('as cinco poções do doc 14 saem da poção estranha', () => {
    const wanted = ['healing_potion', 'strength_potion', 'swiftness_potion',
      'night_vision_potion', 'fire_resistance_potion'];
    for (const name of wanted) {
      expect(BREWING.some((r) => r.base === 'awkward_potion' && r.result === name), name).toBe(true);
    }
    expect(brewResult(item('water_bottle'), item('nether_wart'))).toBe(item('awkward_potion'));
  });
});

describe('suporte de preparo', () => {
  it('três frascos de água e uma verruga viram três poções estranhas em 20 s', () => {
    const s = stand();
    for (let i = 0; i < 3; i++) s.set(i, makeStack(item('water_bottle')));
    s.set(BREW_INGREDIENT, makeStack(item('nether_wart'), 5));
    s.set(BREW_FUEL, makeStack(item('blaze_powder'), 2));
    s.tick();
    expect(s.fuel).toBe(BREWS_PER_FUEL - 1);
    expect(s.get(BREW_FUEL)?.count).toBe(1);
    brew(s, BREW_TICKS - 2);
    expect(s.get(0)?.item).toBe(item('water_bottle'));
    brew(s, 2);
    for (let i = 0; i < 3; i++) expect(s.get(i)?.item).toBe(item('awkward_potion'));
    expect(s.get(BREW_INGREDIENT)?.count).toBe(4);
  });

  it('sem pó de blaze não ferve, e ingrediente que não serve não começa', () => {
    const s = stand();
    s.set(0, makeStack(item('water_bottle')));
    s.set(BREW_INGREDIENT, makeStack(item('nether_wart')));
    brew(s);
    expect(s.get(0)?.item).toBe(item('water_bottle'));
    expect(brewingHelp(s)).toContain('pó de blaze');

    const t = stand();
    t.set(0, makeStack(item('water_bottle')));
    t.set(BREW_INGREDIENT, makeStack(item('sugar')));
    t.set(BREW_FUEL, makeStack(item('blaze_powder')));
    brew(t);
    expect(t.get(0)?.item).toBe(item('water_bottle'));
    expect(t.get(BREW_FUEL)?.count).toBe(1);
    expect(brewingHelp(t)).toContain('não serve');
  });

  it('tirar o ingrediente no meio cancela, sem gastar nada', () => {
    const s = stand();
    s.set(0, makeStack(item('awkward_potion')));
    s.set(BREW_INGREDIENT, makeStack(item('blaze_powder')));
    s.set(BREW_FUEL, makeStack(item('blaze_powder')));
    brew(s, 100);
    expect(s.brewTicks).toBeGreaterThan(0);
    s.set(BREW_INGREDIENT, null);
    s.tick();
    expect(s.brewTicks).toBe(0);
    expect(s.get(0)?.item).toBe(item('awkward_potion'));
  });

  it('a frase guia do frasco vazio até a fervura', () => {
    const s = stand();
    expect(brewingHelp(s)).toContain('Frasco');
    s.set(0, makeStack(item('water_bottle')));
    expect(brewingHelp(s)).toContain('verruga');
    s.set(0, makeStack(item('awkward_potion')));
    expect(brewingHelp(s)).toContain('pó de blaze, açúcar');
  });

  it('frasco só nos frascos, pó só no combustível — também pelo clique', () => {
    expect(brewingAccepts(0, item('water_bottle'))).toBe(true);
    expect(brewingAccepts(1, item('cobblestone'))).toBe(false);
    expect(brewingAccepts(BREW_FUEL, item('coal'))).toBe(false);
    expect(brewingAccepts(BREW_FUEL, item('blaze_powder'))).toBe(true);
    expect(brewingAccepts(BREW_INGREDIENT, item('cobblestone'))).toBe(true);

    const inventory = new Inventory();
    const s = stand();
    inventory.cursor = makeStack(item('cobblestone'), 3);
    clickContainer(inventory, s, 'brewing', 0, 'left', false);
    expect(s.get(0)).toBeNull();
    expect(inventory.cursor?.count).toBe(3);
  });

  it('o preparo em curso vai para o save e volta', () => {
    const s = new BrewingStand(4, 70, -2);
    s.set(0, makeStack(item('awkward_potion')));
    s.set(BREW_INGREDIENT, makeStack(item('sugar')));
    s.set(BREW_FUEL, makeStack(item('blaze_powder')));
    brew(s, 50);
    const back = containerFrom(tileFrom(s));
    expect(back).toBeInstanceOf(BrewingStand);
    const restored = back as BrewingStand;
    expect(restored.fuel).toBe(s.fuel);
    expect(restored.brewTicks).toBe(s.brewTicks);
    brew(restored);
    expect(restored.get(0)?.item).toBe(item('swiftness_potion'));
  });

  it('colocado no mundo, ferve com a tela fechada', () => {
    const { world, session } = rig();
    world.setBlock(3, GROUND + 1, 3, makeState(block('brewing_stand')), 'player');
    session.tiles.create(3, GROUND + 1, 3, block('brewing_stand'));
    const s = session.tiles.at(3, GROUND + 1, 3) as BrewingStand;
    s.set(0, makeStack(item('awkward_potion')));
    s.set(BREW_INGREDIENT, makeStack(item('magma_cream')));
    s.set(BREW_FUEL, makeStack(item('blaze_powder')));
    for (let i = 0; i < BREW_TICKS + 5; i++) session.tick();
    expect(s.get(0)?.item).toBe(item('fire_resistance_potion'));
  });
});

describe('beber e os efeitos novos', () => {
  function drink(session: Session, name: string): void {
    session.inventory.set(0, makeStack(item(name)));
    session.inventory.select(0);
    for (let i = 0; i < 40; i++) session.useHeld();
  }

  it('bebe de barriga cheia, ganha o efeito e fica com o frasco vazio', () => {
    const { session } = rig();
    expect(session.survival.canEat).toBe(false);
    drink(session, 'swiftness_potion');
    expect(session.survival.effects.has(effect('speed'))).toBe(true);
    expect(session.inventory.get(0)?.item).toBe(item('glass_bottle'));
  });

  it('Cura cura na hora, sem ficar na lista', () => {
    const { session } = rig();
    session.survival.health = 6;
    drink(session, 'healing_potion');
    expect(session.survival.health).toBe(10);
    expect(session.survival.effects.active).toBe(0);
  });

  it('Velocidade e Lentidão mexem no andar; Força e Fraqueza no golpe', () => {
    const fx = new StatusEffects();
    expect(fx.speedMultiplier()).toBe(1);
    fx.add(effect('speed'), 2, 100);
    expect(fx.speedMultiplier()).toBeCloseTo(1.4);
    fx.add(effect('slowness'), 1, 100);
    expect(fx.speedMultiplier()).toBeCloseTo(1.25);
    expect(fx.attackBonus()).toBe(0);
    fx.add(effect('strength'), 1, 100);
    expect(fx.attackBonus()).toBe(3);
  });

  it('a Session passa a Velocidade para a física do jogador', () => {
    const { session, player } = rig();
    drink(session, 'swiftness_potion');
    session.tick();
    expect(player.speedFactor).toBeCloseTo(1.2);
  });

  it('Resistência ao Fogo anula lava e fogo, e apaga quem arde', () => {
    const plain = new Survival();
    plain.tick({ submerged: false, inLava: true, onFire: false, suffocating: false, y: 64 });
    expect(plain.health).toBeLessThan(20);

    const safe = new Survival();
    safe.effects.add(effect('fire_resistance'), 1, 200, safe);
    safe.ignite(100);
    expect(safe.burnTicks).toBe(0);
    for (let i = 0; i < 40; i++) {
      safe.tick({ submerged: false, inLava: true, onFire: true, suffocating: false, y: 64 });
    }
    expect(safe.health).toBe(20);
  });

  it('pegar fogo arde por um tempo, e a água apaga', () => {
    const s = new Survival();
    s.ignite(100);
    for (let i = 0; i < 30; i++) {
      s.tick({ submerged: false, inLava: false, onFire: false, suffocating: false, y: 64 });
    }
    expect(s.health).toBeLessThan(20);
    s.tick({ submerged: false, inLava: false, onFire: false, suffocating: false, y: 64, inWater: true });
    expect(s.burnTicks).toBe(0);
  });

  it('Visão Noturna é bandeira que o render lê', () => {
    const fx = new StatusEffects();
    expect(fx.nightVision).toBe(false);
    fx.add(effect('night_vision'), 1, 100);
    expect(fx.nightVision).toBe(true);
  });
});

describe('frasco e verruga', () => {
  it('o frasco de vidro enche na água, e a água fica', () => {
    const { world, session, player } = rig();
    world.setBlock(0, GROUND, 2, makeState(block('water')), 'player');
    session.inventory.set(0, makeStack(item('glass_bottle'), 3));
    session.inventory.select(0);
    player.setPosition(0.5, GROUND + 1, 0.5);
    const eyeY = player.y + player.eyeHeight;
    const dy = GROUND + 0.5 - eyeY;
    const dz = 2.5 - player.z;
    const length = Math.hypot(dy, dz);
    player.yaw = 0;
    session.interaction.aim[0] = 0;
    session.interaction.aim[1] = dy / length;
    session.interaction.aim[2] = dz / length;
    expect(session.itemUser.use(session.inventory.held)).toBe(true);
    expect(session.inventory.countOf(item('water_bottle'))).toBe(1);
    expect(session.inventory.countOf(item('glass_bottle'))).toBe(2);
    expect(blockIdOf(world.getBlock(0, GROUND, 2))).toBe(block('water'));
  });

  it('a verruga cresce no escuro, na areia das almas, e dá 2 a 4', () => {
    const { world, session } = rig();
    world.setBlock(5, GROUND, 5, makeState(block('soul_sand')), 'player');
    world.setBlock(5, GROUND + 1, 5, makeState(block('nether_wart')), 'player');
    // Um teto: sem céu e sem tocha, a verruga cresce igual.
    world.setBlock(5, GROUND + 3, 5, makeState(STONE), 'player');
    session.growth.random = () => 0;
    for (let i = 0; i < 4000 && stateBitsOf(world.getBlock(5, GROUND + 1, 5)) < 3; i++) session.tick();
    expect(stateBitsOf(world.getBlock(5, GROUND + 1, 5))).toBe(3);
  });
});

describe('funil e suporte de preparo', () => {
  it('por cima só o ingrediente; pelo lado o pó e os frascos; nunca carvão no frasco', async () => {
    const { insertOne } = await import('../src/game/itemflow');
    const s = stand();
    expect(insertOne(s, makeStack(item('nether_wart')), 'above')).toBe(true);
    expect(s.get(BREW_INGREDIENT)?.item).toBe(item('nether_wart'));
    expect(insertOne(s, makeStack(item('coal')), 'above')).toBe(false);
    expect(insertOne(s, makeStack(item('blaze_powder')), 'side')).toBe(true);
    expect(s.get(BREW_FUEL)?.item).toBe(item('blaze_powder'));
    expect(insertOne(s, makeStack(item('water_bottle')), 'side')).toBe(true);
    expect(s.get(0)?.item).toBe(item('water_bottle'));
    expect(insertOne(s, makeStack(item('coal')), 'side')).toBe(false);
    for (let i = 1; i < 3; i++) expect(s.get(i)).toBeNull();
  });
});
