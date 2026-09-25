/**
 * Conquistas com toast (doc 08 §3.4).
 *
 * Duas coisas precisam ficar de pé: a medalha dispara **uma vez só**, e o
 * estado cabe na máscara de bits que vai para o save.
 */
import { TAGS } from '../src/data/recipes';
import { describe, expect, it } from 'vitest';
import { Achievements, MAX_ACHIEVEMENTS } from '../src/game/achievements';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_NAME } from '../src/data/achievements';
import { ITEM_BY_NAME, itemId, makeStack } from '../src/data/items';
import { BLOCK_BY_NAME } from '../src/data/blocks';
import { MOB_BY_NAME } from '../src/data/mobs';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { Player } from '../src/entity/player';

describe('tabela de conquistas', () => {
  it('cabe na máscara de bits do save', () => {
    expect(ACHIEVEMENTS.length).toBeLessThanOrEqual(MAX_ACHIEVEMENTS);
  });

  it('os ids são sequenciais e os nomes únicos', () => {
    const names = new Set<string>();
    for (let i = 0; i < ACHIEVEMENTS.length; i++) {
      expect(ACHIEVEMENTS[i].id).toBe(i);
      expect(names.has(ACHIEVEMENTS[i].name)).toBe(false);
      names.add(ACHIEVEMENTS[i].name);
    }
  });

  it('todo alvo aponta para algo que existe', () => {
    for (const def of ACHIEVEMENTS) {
      if (def.trigger === 'obtain' && def.target.startsWith('#')) {
        // Tag (M17): tem de existir e ter item.
        expect(TAGS[def.target.slice(1)]?.length ?? 0, def.name).toBeGreaterThan(0);
      } else if (def.trigger === 'obtain') {
        expect(ITEM_BY_NAME.get(def.target), def.name).toBeDefined();
      } else if (def.trigger === 'place') {
        expect(BLOCK_BY_NAME.get(def.target), def.name).toBeDefined();
      } else if (def.trigger === 'kill') {
        expect(MOB_BY_NAME.get(def.target), def.name).toBeDefined();
      } else if (def.trigger === 'depth' || def.trigger === 'level') {
        expect(Number.isFinite(Number(def.target)), def.name).toBe(true);
      }
    }
  });

  it('todo `parent` aponta para uma conquista real', () => {
    for (const def of ACHIEVEMENTS) {
      if (def.parent === undefined) continue;
      expect(ACHIEVEMENT_BY_NAME.get(def.parent), def.name).toBeDefined();
    }
  });
});

describe('rastreio', () => {
  it('desbloqueia no gatilho certo e avisa uma vez só', () => {
    const tracker = new Achievements();
    const unlocked: string[] = [];
    tracker.onUnlock = (def) => unlocked.push(def.name);

    tracker.obtain('oak_log');
    tracker.obtain('oak_log');
    expect(unlocked).toEqual(['get_wood']);
    expect(tracker.count).toBe(1);
  });

  it('item errado não desbloqueia nada', () => {
    const tracker = new Achievements();
    let fired = 0;
    tracker.onUnlock = () => { fired++; };
    tracker.obtain('stone');
    tracker.kill('cow');
    tracker.place('dirt');
    expect(fired).toBe(0);
  });

  it('descer fundo de uma vez não pula medalha', () => {
    const tracker = new Achievements();
    const unlocked: string[] = [];
    tracker.onUnlock = (def) => unlocked.push(def.name);
    // Cair direto para Y=5 tem que valer a conquista de Y=12.
    tracker.depth(5);
    expect(unlocked).toContain('on_a_rail');
  });

  it('ficar na superfície não dispara profundidade', () => {
    const tracker = new Achievements();
    let fired = 0;
    tracker.onUnlock = () => { fired++; };
    tracker.depth(70);
    expect(fired).toBe(0);
  });

  it('nível de experiência dispara pelo alvo', () => {
    const tracker = new Achievements();
    const unlocked: string[] = [];
    tracker.onUnlock = (def) => unlocked.push(def.name);
    tracker.level(29);
    expect(unlocked).toHaveLength(0);
    tracker.level(30);
    expect(unlocked).toContain('overkill');
  });

  it('a máscara vai e volta do save', () => {
    const tracker = new Achievements();
    tracker.obtain('diamond');
    tracker.event('sleep');
    const mask = tracker.mask;

    const restored = new Achievements();
    restored.setMask(mask);
    expect(restored.has(ACHIEVEMENT_BY_NAME.get('diamonds')!.id)).toBe(true);
    expect(restored.has(ACHIEVEMENT_BY_NAME.get('sweet_dreams')!.id)).toBe(true);
    expect(restored.has(ACHIEVEMENT_BY_NAME.get('get_wood')!.id)).toBe(false);
  });

  it('restaurado do save, não avisa de novo', () => {
    const tracker = new Achievements();
    tracker.obtain('diamond');
    const restored = new Achievements();
    restored.setMask(tracker.mask);
    let fired = 0;
    restored.onUnlock = () => { fired++; };
    restored.obtain('diamond');
    expect(fired).toBe(0);
  });
});

describe('na sessão', () => {
  function harness(): Session {
    const world = new World(1234);
    for (let cz = -1; cz <= 1; cz++) {
      for (let cx = -1; cx <= 1; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        chunk.recomputeHeightMap();
        world.addChunk(chunk);
      }
    }
    const player = new Player(8.5, 70, 8.5);
    return new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
    });
  }

  it('coletar um tronco do chão desbloqueia a primeira conquista', () => {
    const session = harness();
    const toasts: string[] = [];
    session.achievements.onUnlock = (def) => toasts.push(def.name);

    session.items.spawn(8.5, 70, 8.5, makeStack(itemId('oak_log'), 1));
    for (let i = 0; i < 30; i++) session.tick();

    expect(session.inventory.countOf(itemId('oak_log'))).toBe(1);
    expect(toasts).toContain('get_wood');
  });

  it('cair para o fundo do mundo dispara a conquista de profundidade', () => {
    const session = harness();
    const toasts: string[] = [];
    session.achievements.onUnlock = (def) => toasts.push(def.name);
    session.player.setPosition(8.5, 10, 8.5);
    session.tick();
    expect(toasts).toContain('on_a_rail');
  });
});

describe('alvo por tag (M17)', () => {
  it('qualquer tronco vale a primeira medalha, não só o de carvalho', () => {
    for (const log of ['birch_log', 'spruce_log', 'jungle_log', 'acacia_log', 'oak_log']) {
      const tracker = new Achievements();
      const unlocked: string[] = [];
      tracker.onUnlock = (def) => unlocked.push(def.name);
      tracker.obtain(log);
      expect(unlocked, log).toEqual(['get_wood']);
    }
  });
});
