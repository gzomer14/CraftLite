/**
 * Mobs: IA, combate, morte e despawn (doc 07).
 *
 * Tudo roda sem GL e sem DOM — o que interessa aqui é o comportamento, não o
 * desenho. O mundo é uma plataforma de pedra plana, escura o bastante para
 * hostil ficar hostil.
 */
import { describe, expect, it } from 'vitest';
import { Rng } from '../src/core/rng';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Mobs, rayBoxDistance } from '../src/entity/mobs';
import { FLAG_ANGRY, FLAG_PERSISTENT } from '../src/entity/mobstore';
import { MOB_BY_NAME, mobDef } from '../src/data/mobs';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME } from '../src/data/items';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);

interface Recorded {
  drops: { item: number; count: number }[];
  sounds: string[];
  hits: number[];
  explosions: number[][];
  broken: number[][];
  arrows: number[][];
  xp: number[];
}

function flatWorld(radius = 2): World {
  const world = new World(1234);
  for (let cz = -radius; cz <= radius; cz++) {
    for (let cx = -radius; cx <= radius; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
        }
      }
      chunk.recomputeHeightMap();
      for (let sy = 0; sy < chunk.sections.length; sy++) {
        const section = chunk.sections[sy];
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
        // Céu aberto acima do chão: é o que faz o zumbi queimar de dia e o
        // spawn de passivo aceitar a superfície.
        if (sy > GROUND_Y >> 4) section.skyLight.fill(0xff);
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

function harness(): { world: World; mobs: Mobs; log: Recorded } {
  const world = flatWorld();
  const log: Recorded = {
    drops: [], sounds: [], hits: [], explosions: [], broken: [], arrows: [], xp: [],
  };
  const mobs = new Mobs(world, {
    onDrop: (item, count) => log.drops.push({ item, count }),
    onXp: (amount) => log.xp.push(amount),
    onSound: (name) => log.sounds.push(name),
    onHitPlayer: (damage) => log.hits.push(damage),
    onExplode: (x, y, z, power) => log.explosions.push([x, y, z, power]),
    onBreakBlock: (x, y, z) => log.broken.push([x, y, z]),
    onArrow: (x, y, z, dx, dy, dz, damage) => log.arrows.push([x, y, z, dx, dy, dz, damage]),
  });
  mobs.random = seeded();
  // Noite: os hostis precisam disso para adquirir alvo de verdade.
  mobs.isDay = false;
  return { world, mobs, log };
}

function playerAt(x: number, z: number) {
  return { x, y: GROUND_Y + 1, z, eyeY: GROUND_Y + 1 + 1.62, held: -1, alive: true };
}

const ZOMBIE = MOB_BY_NAME.get('zombie')!.id;
const COW = MOB_BY_NAME.get('cow')!.id;
const CREEPER = MOB_BY_NAME.get('creeper')!.id;
const SKELETON = MOB_BY_NAME.get('skeleton')!.id;
const SLIME = MOB_BY_NAME.get('slime')!.id;
const WOLF = MOB_BY_NAME.get('wolf')!.id;
const ENDERMAN = MOB_BY_NAME.get('enderman')!.id;

/**
 * Aleatório determinístico para os testes de mob (doc 15 §6, 2026-09-13).
 *
 * `Mobs`, `MobStore` e `MobSpawner` sorteiam yaw de nascimento, cooldown de
 * passeio, drops, despawn e teleporte. Com `Math.random` a suíte completa
 * falhava de vez em quando **sem reproduzir isolada** — o tipo de teste que
 * acaba ignorado. Semear aqui torna cada arquivo reproduzível.
 */
function seeded(seed = 20260913): () => number {
  const rng = new Rng(seed);
  return () => rng.nextFloat();
}

describe('tabela de mobs', () => {
  it('tem os 12 mobs do MVP, o aldeão e os dois do Nether, com modelo e skin válidos', () => {
    // 12 do MVP + aldeão (M6) + porco zumbi e ghast (M7).
    expect(MOB_BY_NAME.size).toBe(15);
    for (const name of MOB_BY_NAME.keys()) {
      const def = MOB_BY_NAME.get(name)!;
      expect(def.model.length).toBeGreaterThan(0);
      expect(def.skin.length).toBeGreaterThan(0);
      expect(def.health).toBeGreaterThan(0);
      expect(def.goals.length).toBeGreaterThan(0);
    }
  });

  it('todo drop de mob aponta para um item que existe', () => {
    for (const name of MOB_BY_NAME.keys()) {
      for (const drop of MOB_BY_NAME.get(name)!.drops) {
        expect(ITEM_BY_NAME.has(drop.item), `${name} → ${drop.item}`).toBe(true);
      }
    }
  });

  it('o dano escala com a dificuldade, nunca para baixo', () => {
    for (const name of MOB_BY_NAME.keys()) {
      const attack = MOB_BY_NAME.get(name)!.attack;
      if (attack === undefined) continue;
      expect(attack.damage[0]).toBeLessThanOrEqual(attack.damage[1]);
      expect(attack.damage[1]).toBeLessThanOrEqual(attack.damage[2]);
    }
  });
});

describe('física e perseguição', () => {
  it('o mob pousa no chão em vez de atravessar', () => {
    const { mobs } = harness();
    const i = mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 6, 8.5);
    expect(i).toBe(0);
    // Persistente: sem isso o zumbi despawnaria antes de terminar de cair, e o
    // teste passaria a medir a regra de despawn em vez da física.
    mobs.store.setFlag(i, FLAG_PERSISTENT, true);
    for (let t = 0; t < 60; t++) mobs.tick(playerAt(200, 200));

    expect(mobs.store.onGround[0]).toBe(1);
    expect(mobs.store.y[0]).toBeCloseTo(GROUND_Y + 1, 1);
  });

  it('o zumbi anda na direção do jogador quando o vê', () => {
    const { mobs } = harness();
    mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    const player = playerAt(18.5, 8.5);

    for (let t = 0; t < 20; t++) mobs.tick(player);
    const before = mobs.store.x[0];
    for (let t = 0; t < 60; t++) mobs.tick(player);

    expect(mobs.store.hasTarget[0]).toBe(1);
    expect(mobs.store.x[0]).toBeGreaterThan(before + 1);
  });

  it('não persegue o que está longe demais', () => {
    const { mobs } = harness();
    const i = mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    mobs.store.setFlag(i, FLAG_PERSISTENT, true);
    for (let t = 0; t < 40; t++) mobs.tick(playerAt(8.5, 40.5));
    expect(mobs.store.hasTarget[0]).toBe(0);
  });

  it('na dificuldade pacífica ninguém tem alvo', () => {
    const { mobs } = harness();
    mobs.difficulty = 0;
    mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 20; t++) mobs.tick(playerAt(10.5, 8.5));
    // Pacífico também despawna hostil (doc 06 §10).
    expect(mobs.count).toBe(0);
  });

  it('o passivo passeia sozinho, sem alvo', () => {
    const { mobs } = harness();
    mobs.spawn(COW, 8.5, GROUND_Y + 1, 8.5);
    const start = { x: mobs.store.x[0], z: mobs.store.z[0] };
    for (let t = 0; t < 400; t++) mobs.tick(playerAt(40, 40));

    expect(mobs.store.hasTarget[0]).toBe(0);
    const moved = Math.hypot(mobs.store.x[0] - start.x, mobs.store.z[0] - start.z);
    expect(moved).toBeGreaterThan(0.5);
  });
});

describe('combate', () => {
  it('o zumbi encostado bate no jogador com cooldown', () => {
    const { mobs, log } = harness();
    mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    const player = playerAt(9.2, 8.5);

    for (let t = 0; t < 100; t++) mobs.tick(player);
    expect(log.hits.length).toBeGreaterThan(0);
    // Cooldown de 20 ticks: 100 ticks não podem virar 100 golpes.
    expect(log.hits.length).toBeLessThanOrEqual(6);
    expect(log.hits[0]).toBe(mobDef(ZOMBIE).attack!.damage[1]);
  });

  it('dano mata, dropa e some do pool', () => {
    const { mobs, log } = harness();
    mobs.spawn(COW, 8.5, GROUND_Y + 1, 8.5);
    const died = mobs.damage(0, 100, 'player');

    expect(died).toBe(true);
    expect(mobs.count).toBe(0);
    expect(log.drops.length).toBeGreaterThan(0);
    expect(log.sounds).toContain('mob/cow_death');
  });

  it('atacar um passivo dá pânico; atacar um neutro dá raiva', () => {
    const { mobs } = harness();
    mobs.spawn(COW, 8.5, GROUND_Y + 1, 8.5);
    mobs.damage(0, 1, 'player');
    expect(mobs.store.panicTicks[0]).toBeGreaterThan(0);

    const wolf = mobs.spawn(WOLF, 12.5, GROUND_Y + 1, 12.5);
    mobs.damage(wolf, 1, 'player');
    expect(mobs.store.hasFlag(wolf, FLAG_ANGRY)).toBe(true);
  });

  it('lobo atacado chama o bando por perto', () => {
    const { mobs } = harness();
    mobs.spawn(WOLF, 8.5, GROUND_Y + 1, 8.5);
    mobs.spawn(WOLF, 11.5, GROUND_Y + 1, 8.5);
    mobs.damage(0, 1, 'player');
    expect(mobs.store.hasFlag(1, FLAG_ANGRY)).toBe(true);
  });

  it('o esqueleto atira em vez de encostar', () => {
    const { mobs, log } = harness();
    mobs.spawn(SKELETON, 8.5, GROUND_Y + 1, 8.5);
    const player = playerAt(18.5, 8.5);
    for (let t = 0; t < 120; t++) mobs.tick(player);

    expect(log.arrows.length).toBeGreaterThan(0);
    const arrow = log.arrows[0];
    // A direção sai normalizada e aponta para o +X, onde está o jogador.
    const length = Math.hypot(arrow[3], arrow[4], arrow[5]);
    expect(length).toBeCloseTo(1, 3);
    expect(arrow[3]).toBeGreaterThan(0.5);
  });

  it('o creeper acende o pavio e explode ao lado do jogador', () => {
    const { mobs, log } = harness();
    mobs.spawn(CREEPER, 8.5, GROUND_Y + 1, 8.5);
    const player = playerAt(10.0, 8.5);

    for (let t = 0; t < 20; t++) mobs.tick(player);
    expect(mobs.store.fuse[0]).toBeGreaterThan(0);

    for (let t = 0; t < 60; t++) mobs.tick(player);
    expect(log.explosions.length).toBe(1);
    expect(log.explosions[0][3]).toBe(3);
    // Explodiu, morreu, e não dropou nada.
    expect(mobs.count).toBe(0);
    expect(log.drops.length).toBe(0);
  });

  it('no Difícil o zumbi pede para derrubar a porta; nas outras, não (doc 06 §10)', () => {
    const DOOR = makeState(BLOCK_BY_NAME.get('oak_door')!.id);
    // Porta de dureza 3 → 3 × 80 = 240 ticks. Roda com folga.
    const TICKS = 400;

    const knockDown = (difficulty: number): boolean => {
      const { world, mobs, log } = harness();
      mobs.difficulty = difficulty;
      // Zumbi de um lado da porta, jogador do outro, tudo em linha no eixo X.
      world.setBlock(9, GROUND_Y + 1, 8, DOOR, 'gen');
      mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
      const player = playerAt(11.5, 8.5);
      for (let t = 0; t < TICKS; t++) mobs.tick(player);
      return log.broken.length > 0 && world.getBlock(9, GROUND_Y + 1, 8) === DOOR;
    };

    // Aqui só se verifica o pedido: quem apaga o voxel é a `Session`, e o
    // mundo continua com a porta de pé — é o que o `=== DOOR` garante.
    expect(knockDown(3)).toBe(true);
    expect(knockDown(2)).toBe(false);
    expect(knockDown(1)).toBe(false);
  });

  it('no Difícil a explosão do creeper tem força maior (doc 06 §10)', () => {
    const explodeAt = (difficulty: number): number => {
      const { mobs, log } = harness();
      mobs.difficulty = difficulty;
      mobs.spawn(CREEPER, 8.5, GROUND_Y + 1, 8.5);
      const player = playerAt(10.0, 8.5);
      for (let t = 0; t < 80 && log.explosions.length === 0; t++) mobs.tick(player);
      expect(log.explosions.length).toBe(1);
      return log.explosions[0][3];
    };

    expect(explodeAt(1)).toBe(3);
    expect(explodeAt(2)).toBe(3);
    expect(explodeAt(3)).toBeGreaterThan(3);
  });

  it('o slime grande se divide em dois menores ao morrer', () => {
    const { mobs } = harness();
    mobs.spawn(SLIME, 8.5, GROUND_Y + 1, 8.5, 3);
    mobs.damage(0, 100, 'player');

    expect(mobs.count).toBe(2);
    expect(mobs.store.variant[0]).toBe(2);
    expect(mobs.store.scale[0]).toBeLessThan(1.5);
  });

  it('o enderman teleporta ao levar dano', () => {
    const { mobs } = harness();
    mobs.spawn(ENDERMAN, 8.5, GROUND_Y + 1, 8.5);
    const before = { x: mobs.store.x[0], z: mobs.store.z[0] };
    mobs.damage(0, 1, 'player');
    const moved = Math.hypot(mobs.store.x[0] - before.x, mobs.store.z[0] - before.z);
    expect(moved).toBeGreaterThan(1);
  });
});

describe('ambiente e despawn', () => {
  it('o zumbi pega fogo no sol e morre', () => {
    const { mobs, log } = harness();
    mobs.isDay = true;
    const i = mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    mobs.store.setFlag(i, FLAG_PERSISTENT, true);

    for (let t = 0; t < 600 && mobs.count > 0; t++) mobs.tick(playerAt(200, 200));
    expect(mobs.count).toBe(0);
    // Morreu queimado, não por despawn: o som de morte saiu.
    expect(log.sounds).toContain('mob/zombie_death');
  });

  it('hostil a mais de 128 blocos despawna na hora', () => {
    const { mobs } = harness();
    mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    mobs.tick(playerAt(400, 400));
    expect(mobs.count).toBe(0);
  });

  it('passivo nunca despawna, por longe que o jogador esteja', () => {
    const { mobs } = harness();
    mobs.spawn(COW, 8.5, GROUND_Y + 1, 8.5);
    for (let t = 0; t < 50; t++) mobs.tick(playerAt(900, 900));
    expect(mobs.count).toBe(1);
  });

  it('mob persistente não despawna', () => {
    const { mobs } = harness();
    const i = mobs.spawn(ZOMBIE, 8.5, GROUND_Y + 1, 8.5);
    mobs.store.setFlag(i, FLAG_PERSISTENT, true);
    mobs.tick(playerAt(400, 400));
    expect(mobs.count).toBe(1);
  });
});

describe('mira em mob', () => {
  it('o raio acerta a caixa e devolve a distância', () => {
    const distance = rayBoxDistance(
      0, 0, 0, 1, 0, 0,
      4, -1, -1, 5, 1, 1,
    );
    expect(distance).toBeCloseTo(4, 5);
  });

  it('o raio que passa ao lado não acerta', () => {
    const distance = rayBoxDistance(
      0, 0, 0, 1, 0, 0,
      4, 5, -1, 5, 6, 1,
    );
    expect(distance).toBe(-1);
  });

  it('pickTarget escolhe o mob mais próximo na direção do olhar', () => {
    const { mobs } = harness();
    mobs.spawn(ZOMBIE, 12.5, GROUND_Y + 1, 8.5);
    mobs.spawn(ZOMBIE, 10.5, GROUND_Y + 1, 8.5);

    const hit = mobs.pickTarget(8.5, GROUND_Y + 2, 8.5, 1, 0, 0, 4.5);
    expect(hit).toBe(1);
    // Fora do alcance de 4.5 não acerta ninguém.
    expect(mobs.pickTarget(8.5, GROUND_Y + 2, 8.5, -1, 0, 0, 4.5)).toBe(-1);
  });
});

describe('determinismo', () => {
  /**
   * Regressão da dívida fechada em 2026-09-13: `Mobs`, `MobStore` e
   * `MobSpawner` chamavam `Math.random()` direto, e a suíte completa falhava de
   * vez em quando sem reproduzir isolada. Se alguém voltar a chamar o aleatório
   * global em qualquer ponto do nascimento de um mob, este teste cai.
   */
  it('com o mesmo aleatório, dois mobs nascem exatamente iguais', () => {
    const primeiro = harness();
    primeiro.mobs.random = seeded(1234);
    primeiro.mobs.spawn(ZOMBIE, 4, GROUND_Y + 1, 4);
    primeiro.mobs.spawn(COW, 6, GROUND_Y + 1, 6);

    const segundo = harness();
    segundo.mobs.random = seeded(1234);
    segundo.mobs.spawn(ZOMBIE, 4, GROUND_Y + 1, 4);
    segundo.mobs.spawn(COW, 6, GROUND_Y + 1, 6);

    for (let i = 0; i < 2; i++) {
      expect(segundo.mobs.store.yaw[i]).toBe(primeiro.mobs.store.yaw[i]);
      expect(segundo.mobs.store.wanderCooldown[i])
        .toBe(primeiro.mobs.store.wanderCooldown[i]);
    }
  });

  it('trocar o aleatório do `Mobs` troca o do store e o da IA junto', () => {
    const { mobs } = harness();
    const fonte = seeded(99);
    mobs.random = fonte;
    expect(mobs.random).toBe(fonte);
    expect(mobs.store.random).toBe(fonte);
  });

  it('dois ticks completos com a mesma semente dão o mesmo estado', () => {
    const posicoes: number[][] = [];
    for (let run = 0; run < 2; run++) {
      const h = harness();
      h.mobs.random = seeded(7);
      h.mobs.spawn(COW, 4, GROUND_Y + 1, 4);
      h.mobs.spawn(COW, 6, GROUND_Y + 1, 6);
      for (let t = 0; t < 40; t++) h.mobs.tick(playerAt(0, 0));
      posicoes.push([
        h.mobs.store.x[0], h.mobs.store.z[0], h.mobs.store.x[1], h.mobs.store.z[1],
      ]);
    }
    expect(posicoes[1]).toEqual(posicoes[0]);
  });
});

describe('orçamento de tick com 20 mobs (aceite do M5)', () => {
  it('20 mobs ticam em menos de 4 ms', () => {
    const { mobs } = harness();
    for (let i = 0; i < 20; i++) {
      mobs.spawn(i % 2 === 0 ? ZOMBIE : COW, 8.5 + (i % 5) * 2, GROUND_Y + 1, 8.5 + ((i / 5) | 0) * 2);
    }
    const player = playerAt(20.5, 20.5);
    for (let t = 0; t < 20; t++) mobs.tick(player);

    const samples: number[] = [];
    for (let t = 0; t < 40; t++) {
      const t0 = performance.now();
      mobs.tick(player);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const ms = samples[samples.length >> 1];
    console.log(`  20 mobs: ${ms.toFixed(3)} ms/tick (mediana de 40)`);
    // O tick inteiro em T0 tem 50 ms; mob não pode passar de uma fração disso.
    expect(ms).toBeLessThan(4);
  });
});


/*
 * Perseguição (relato de campo, 2026-09-12: "os monstros estão muito lentos" e
 * "só o zumbi começa a me seguir quando chego próximo dele").
 *
 * Eram dois defeitos somados:
 *
 * 1. **A velocidade da tabela não era atingida.** A ordem do tick é mesclar,
 *    mover, atritar — então a velocidade estabiliza em `blend / (1 − atrito ×
 *    (1 − blend))` do alvo, **46%** no chão. O zumbi de 1,15 blocos/s do doc
 *    andava a 0,53.
 * 2. **A tabela era lenta demais.** Mesmo atingida, 1,15 blocos/s é um quarto
 *    dos 4,317 do jogador caminhando: de dentro do jogo, um mob que leva oito
 *    segundos para cruzar dez blocos não parece estar perseguindo ninguém.
 *
 * O alvo nunca foi o problema: todo hostil já adquiria: o que enganava era a
 * lentidão. O teste abaixo trava as duas coisas.
 */
describe('perseguição', () => {
  /** Velocidade de aproximação em regime, medida entre 12 e 4 blocos. */
  function chaseSpeed(name: string): number {
    const { mobs } = harness();
    const player = playerAt(8.5, 8.5);
    const id = MOB_BY_NAME.get(name)!.id;
    const i = mobs.spawn(id, 23.5, GROUND_Y + 1, 8.5);
    let tAt12 = -1;
    for (let t = 1; t <= 600; t++) {
      mobs.tick(player);
      const d = Math.abs(mobs.store.x[i] - player.x);
      if (tAt12 < 0 && d <= 12) tAt12 = t;
      else if (tAt12 > 0 && d <= 4) return 8 / ((t - tAt12) / 20);
    }
    return 0;
  }

  it('todo hostil adquire o jogador por proximidade, não só o zumbi', () => {
    for (const name of ['zombie', 'skeleton', 'creeper', 'slime']) {
      const { mobs } = harness();
      const player = playerAt(8.5, 8.5);
      const i = mobs.spawn(MOB_BY_NAME.get(name)!.id, 16.5, GROUND_Y + 1, 8.5);
      for (let t = 0; t < 20; t++) mobs.tick(player);
      expect(mobs.store.hasTarget[i], `${name} precisa mirar o jogador`).toBe(1);
    }
  });

  it('a velocidade da tabela é a que o mob realmente anda', () => {
    for (const name of ['zombie', 'creeper', 'slime']) {
      const declared = MOB_BY_NAME.get(name)!.speed;
      const measured = chaseSpeed(name);
      // Antes da compensação de atrito, medido dava 46% do declarado.
      expect(measured, `${name} anda a ${measured.toFixed(2)} e declara ${declared}`)
        .toBeGreaterThan(declared * 0.85);
      expect(measured).toBeLessThan(declared * 1.15);
    }
  });

  it('hostil não alcança quem corre, mas alcança quem caminha parado', () => {
    // Jogador: 4,317 caminhando, 5,612 correndo (doc 06 §2).
    for (const name of ['zombie', 'skeleton', 'creeper', 'spider']) {
      const speed = MOB_BY_NAME.get(name)!.speed;
      expect(speed, `${name} não pode ultrapassar quem corre`).toBeLessThan(5.612);
      expect(speed, `${name} precisa ser ameaça de verdade`).toBeGreaterThan(4.317 * 0.7);
    }
  });
});
