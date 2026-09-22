/**
 * Efeitos de status e as comidas que dependem deles (doc 05 §4).
 *
 * Até 2026-09-22 não havia sistema de efeito: carne podre e frango cru eram
 * comida comum e a maçã dourada não existia. Aqui estão as regras que fazem
 * os efeitos serem justos — acúmulo, veneno que não mata, vida extra que paga
 * o golpe primeiro — e o caminho inteiro de comer, pela `Session`.
 */
import { describe, expect, it } from 'vitest';
import { StatusEffects, type EffectTarget } from '../src/game/effects';
import { EFFECT_BY_NAME, EFFECTS } from '../src/data/effects';
import { MAX_HEALTH, Survival } from '../src/game/survival';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { AIR, BLOCK_BY_NAME, blockIdOf, makeState, stateBitsOf } from '../src/data/blocks';
import { ITEM_BY_NAME, itemId, makeStack } from '../src/data/items';
import { RECIPES } from '../src/data/recipes';
import { consumeGrid } from '../src/game/crafting';

const effect = (name: string): number => EFFECT_BY_NAME.get(name)!.id;

function dummy(): EffectTarget & { healed: number; hurt: number; tired: number } {
  return {
    healed: 0, hurt: 0, tired: 0, absorption: 0,
    heal(n) { this.healed += n; },
    hurtNonLethal(n) { this.hurt += n; },
    addExhaustion(n) { this.tired += n; },
  };
}

describe('a tabela', () => {
  it('ids são a posição na tabela (vão para o save)', () => {
    EFFECTS.forEach((e, i) => expect(e.id, e.name).toBe(i));
  });
  it('tem os efeitos que o doc 05 §4 cita', () => {
    for (const name of ['hunger', 'regeneration', 'absorption']) {
      expect(EFFECT_BY_NAME.get(name), name).toBeDefined();
    }
  });
});

describe('o motor', () => {
  it('expira depois da duração', () => {
    const fx = new StatusEffects();
    const t = dummy();
    fx.add(effect('hunger'), 1, 40, t);
    for (let i = 0; i < 39; i++) fx.tick(t);
    expect(fx.has(effect('hunger'))).toBe(true);
    fx.tick(t);
    expect(fx.has(effect('hunger'))).toBe(false);
    expect(fx.active).toBe(0);
  });

  it('Fome cansa, Regeneração cura, Veneno fere', () => {
    const fx = new StatusEffects();
    const t = dummy();
    fx.add(effect('hunger'), 1, 100, t);
    fx.add(effect('regeneration'), 1, 100, t);
    fx.add(effect('poison'), 1, 100, t);
    for (let i = 0; i < 100; i++) fx.tick(t);
    expect(t.tired).toBeCloseTo(0.5, 5);
    expect(t.healed).toBe(2);
    expect(t.hurt).toBe(4);
  });

  it('nível II cura no dobro do ritmo', () => {
    const fx = new StatusEffects();
    const t = dummy();
    fx.add(effect('regeneration'), 2, 100, t);
    for (let i = 0; i < 100; i++) fx.tick(t);
    expect(t.healed).toBe(4);
  });

  it('acúmulo: nível maior substitui, mesmo nível fica com a duração mais longa', () => {
    const fx = new StatusEffects();
    const id = effect('regeneration');
    fx.add(id, 1, 100);
    expect(fx.add(id, 1, 50)).toBe(false);
    expect(fx.add(id, 1, 200)).toBe(true);
    expect(fx.ticks[id]).toBe(200);
    expect(fx.add(id, 2, 20)).toBe(true);
    expect(fx.level[id]).toBe(2);
    expect(fx.add(id, 1, 999)).toBe(false);
  });

  it('o save devolve o que estava ativo', () => {
    const fx = new StatusEffects();
    fx.add(effect('hunger'), 1, 300);
    fx.add(effect('regeneration'), 2, 80);
    const copy = new StatusEffects();
    copy.restore(fx.snapshot());
    expect(copy.ticks[effect('hunger')]).toBe(300);
    expect(copy.level[effect('regeneration')]).toBe(2);
    expect(copy.active).toBe(2);
  });
});

describe('na sobrevivência', () => {
  it('Absorção paga o golpe antes da vida e acaba quando gasta', () => {
    const s = new Survival();
    s.effects.add(effect('absorption'), 1, 2400, s);
    expect(s.absorption).toBe(4);
    s.damage(3, 'fall');
    expect(s.health).toBe(MAX_HEALTH);
    expect(s.absorption).toBe(1);
    s.invulnerable = 0;
    s.damage(3, 'fall');
    expect(s.health).toBe(MAX_HEALTH - 2);
    s.tick({ submerged: false, inLava: false, onFire: false, suffocating: false, y: 64 });
    expect(s.effects.has(effect('absorption'))).toBe(false);
  });

  it('Veneno para em meio coração', () => {
    const s = new Survival();
    s.health = 3;
    s.effects.add(effect('poison'), 3, 400, s);
    for (let i = 0; i < 400; i++) {
      s.tick({ submerged: false, inLava: false, onFire: false, suffocating: false, y: 64 });
    }
    expect(s.health).toBe(1);
    expect(s.isDead).toBe(false);
  });

  it('renascer limpa os efeitos', () => {
    const s = new Survival();
    s.effects.add(effect('hunger'), 1, 600, s);
    s.respawn();
    expect(s.effects.active).toBe(0);
  });
});

// --- pela Session ----------------------------------------------------------

function harness(): { world: World; player: Player; session: Session } {
  const world = new World(99);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) chunk.setBlock(x, 63, z, makeState(BLOCK_BY_NAME.get('stone')!.id));
      }
      world.addChunk(chunk);
    }
  }
  const player = new Player(8.5, 64, 8.5);
  player.mode = 'survival';
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
  });
  return { world, player, session };
}

function eat(session: Session, item: string): void {
  session.inventory.set(0, makeStack(itemId(item)));
  session.inventory.select(0);
  for (let i = 0; i < 40; i++) session.useHeld();
}

describe('comer', () => {
  it('maçã dourada se come de barriga cheia e dá Regeneração II e Absorção', () => {
    const { session } = harness();
    expect(session.survival.canEat).toBe(false);
    eat(session, 'golden_apple');
    expect(session.survival.effects.level[effect('regeneration')]).toBe(2);
    expect(session.survival.absorption).toBe(4);
  });

  it('carne podre dá Fome quando o sorteio cai nos 80%', () => {
    const { session } = harness();
    session.survival.hunger = 10;
    session.random = () => 0.5;
    eat(session, 'rotten_flesh');
    expect(session.survival.effects.has(effect('hunger'))).toBe(true);
    const again = harness().session;
    again.survival.hunger = 10;
    again.random = () => 0.9;
    eat(again, 'rotten_flesh');
    expect(again.survival.effects.has(effect('hunger'))).toBe(false);
  });

  it('o ensopado vira tigela na mesma casinha', () => {
    const { session } = harness();
    session.survival.hunger = 10;
    eat(session, 'mushroom_stew');
    expect(session.inventory.get(0)?.item).toBe(itemId('bowl'));
  });

  it('o bolo se come pelo bloco, uma fatia por clique, e some na sétima', () => {
    const { world, player, session } = harness();
    const cake = BLOCK_BY_NAME.get('cake')!.id;
    world.setBlock(8, 64, 9, makeState(cake), 'player');
    player.setPosition(8.5, 64, 7.5);
    player.pitch = 0.5;
    player.yaw = 0;
    session.inventory.set(0, null);
    session.survival.hunger = 0;
    session.interaction.updateTarget();
    const target = session.interaction.state.target;
    // A mira do teste depende da convenção de yaw; se não pegou o bolo, o
    // resto do teste não diz nada.
    expect(target === null ? -1 : blockIdOf(world.getBlock(target.x, target.y, target.z))).toBe(cake);
    session.useHeld();
    expect(stateBitsOf(world.getBlock(8, 64, 9))).toBe(1);
    expect(session.survival.hunger).toBe(2);
    for (let i = 0; i < 6; i++) session.useHeld();
    expect(world.getBlock(8, 64, 9)).toBe(makeState(AIR));
  });
});

describe('restos de receita', () => {
  it('o bolo devolve os três baldes vazios na grade', () => {
    const recipe = RECIPES.find((r) => r.result.item === 'cake');
    expect(recipe).toBeDefined();
    const milk = itemId('milk_bucket');
    const grid = {
      size: 3 as const,
      slots: [
        makeStack(milk), makeStack(milk), makeStack(milk),
        makeStack(itemId('sugar')), makeStack(itemId('egg')), makeStack(itemId('sugar')),
        makeStack(itemId('wheat')), makeStack(itemId('wheat')), makeStack(itemId('wheat')),
      ],
    };
    consumeGrid(grid);
    expect(grid.slots.slice(0, 3).map((s) => s?.item)).toEqual(
      [itemId('bucket'), itemId('bucket'), itemId('bucket')],
    );
    expect(grid.slots[4]).toBeNull();
  });

  it('todo item com resto aponta para um item que existe', () => {
    for (const def of ITEM_BY_NAME.values()) {
      if (def.remainder !== undefined) expect(ITEM_BY_NAME.get(def.remainder), def.name).toBeDefined();
    }
  });
});
