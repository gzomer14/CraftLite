/**
 * Regras de spawn (doc 07 §4).
 *
 * O ciclo é aleatório de propósito, então os testes verificam **invariantes**:
 * nunca nasce perto do jogador, nunca nasce hostil no claro, nunca passa do
 * cap, e um chunk novo às vezes já vem com bichos.
 */
import { describe, expect, it } from 'vitest';
import { ChunkColumn } from '../src/world/chunk';
import { World } from '../src/world/world';
import { Mobs } from '../src/entity/mobs';
import { MobSpawner, SPAWN_INTERVAL, capsForTier } from '../src/entity/spawn';
import { MOB_BY_NAME, SPAWN_RULES, mobDef } from '../src/data/mobs';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { BIOMES } from '../src/data/biomes';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);
const grass = makeState(BLOCK_BY_NAME.get('grass_block')!.id);

/** Planície de grama iluminada, com 9×9 chunks carregados. */
function meadow(bright: boolean, biome = 'plains'): World {
  const world = new World(5150);
  const biomeId = BIOMES.findIndex((b) => b.name === biome);
  for (let cz = -4; cz <= 4; cz++) {
    for (let cx = -4; cx <= 4; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            chunk.setBlock(x, y, z, y === GROUND_Y ? grass : stone);
          }
        }
      }
      chunk.recomputeHeightMap();
      chunk.biomeMap.fill(biomeId);
      for (let sy = 0; sy < chunk.sections.length; sy++) {
        const section = chunk.sections[sy];
        section.blockLight = new Uint8Array(2048);
        section.skyLight = new Uint8Array(2048);
        if (bright && sy > GROUND_Y >> 4) section.skyLight.fill(0xff);
      }
      world.addChunk(chunk);
    }
  }
  return world;
}

function build(
  world: World, maxMobs = 70, simulationDistance = 4,
): { mobs: Mobs; spawner: MobSpawner } {
  const mobs = new Mobs(world, {
    onDrop: () => { /* nada */ },
    onXp: () => { /* nada */ },
    onSound: () => { /* nada */ },
    onHitPlayer: () => { /* nada */ },
    onExplode: () => { /* nada */ },
    onBreakBlock: () => { /* nada */ },
    onArrow: () => { /* nada */ },
  }, 256);
  const spawner = new MobSpawner(world, mobs, capsForTier(maxMobs), simulationDistance);
  return { mobs, spawner };
}

describe('caps por tier', () => {
  // Os três tiers da tabela do doc 07 §4, que é derivada de `maxMobs / 70`.
  // Números exatos de propósito: se a fórmula mudar, a tabela do doc muda junto.
  it('T0 usa os números reduzidos da tabela do doc', () => {
    expect(capsForTier(20)).toEqual({ hostile: 20, passive: 4, water: 1, ambient: 2 });
  });

  it('T1 fica no meio', () => {
    expect(capsForTier(40)).toEqual({ hostile: 40, passive: 6, water: 3, ambient: 5 });
  });

  it('T2 usa os cheios', () => {
    expect(capsForTier(70)).toEqual({ hostile: 70, passive: 10, water: 5, ambient: 8 });
  });
});

describe('spawn de passivos no claro', () => {
  it('nasce animal de superfície e nunca a menos de 24 blocos do jogador', () => {
    const world = meadow(true);
    const { mobs, spawner } = build(world);
    spawner.isDay = true;

    let total = 0;
    for (let cycle = 0; cycle < 200 && total === 0; cycle++) {
      total = spawner.runCycle('passive', 8.5, GROUND_Y + 1, 8.5);
    }
    expect(total).toBeGreaterThan(0);

    const store = mobs.store;
    for (let i = 0; i < store.active; i++) {
      const distance = Math.hypot(store.x[i] - 8.5, store.z[i] - 8.5);
      expect(distance).toBeGreaterThanOrEqual(24);
      expect(mobDef(store.type[i]).category).toBe('passive');
      // Nasce em cima do chão, não dentro dele.
      expect(store.y[i]).toBeGreaterThan(GROUND_Y);
    }
  });

  it('sem luz do céu nenhum passivo nasce', () => {
    const world = meadow(false);
    const { mobs, spawner } = build(world);
    spawner.isDay = true;
    for (let cycle = 0; cycle < 100; cycle++) {
      spawner.runCycle('passive', 8.5, GROUND_Y + 1, 8.5);
    }
    expect(mobs.count).toBe(0);
  });

  it('bioma que a regra não permite não recebe o mob', () => {
    // Vaca só nasce em planície, floresta, taiga e savana (doc 07 §2).
    const world = meadow(true, 'desert');
    const { mobs, spawner } = build(world);
    spawner.isDay = true;
    for (let cycle = 0; cycle < 200; cycle++) {
      spawner.runCycle('passive', 8.5, GROUND_Y + 1, 8.5);
    }
    for (let i = 0; i < mobs.store.active; i++) {
      const name = mobDef(mobs.store.type[i]).name;
      expect(name).not.toBe('cow');
    }
  });
});

describe('spawn de hostis no escuro', () => {
  it('nasce hostil de noite e nunca a mais de 128 blocos', () => {
    const world = meadow(false);
    const { mobs, spawner } = build(world);
    spawner.isDay = false;
    spawner.isNight = true;

    let total = 0;
    for (let cycle = 0; cycle < 300 && total === 0; cycle++) {
      total = spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
    }
    expect(total).toBeGreaterThan(0);

    const store = mobs.store;
    for (let i = 0; i < store.active; i++) {
      const distance = Math.hypot(store.x[i] - 8.5, store.z[i] - 8.5);
      expect(distance).toBeGreaterThanOrEqual(24);
      expect(distance).toBeLessThanOrEqual(128);
    }
  });

  it('de noite a maioria nasce na superfície, não enterrada na pedra', () => {
    // Regressão: o Y era sorteado uniformemente de `minY` até a superfície, e
    // com o chão em y=63 quase todo hostil caía dentro da pedra. A noite a céu
    // aberto ficava vazia — ninguém encontrava monstro nenhum.
    const world = meadow(false);
    const { mobs, spawner } = build(world);
    spawner.isDay = false;
    spawner.isNight = true;
    for (let cycle = 0; cycle < 400; cycle++) {
      spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
    }

    const store = mobs.store;
    expect(store.active).toBeGreaterThan(10);
    let surface = 0;
    for (let i = 0; i < store.active; i++) if (store.y[i] > GROUND_Y) surface++;
    expect(surface / store.active).toBeGreaterThan(0.4);
  });

  it('hostil chega a nascer dentro dos 32 blocos, onde o despawn suave não pega', () => {
    // Regressão: o chunk sorteado precisava estar a 2 chunks do jogador, o que
    // empurrava todo spawn para ≥32 blocos — exatamente onde o despawn suave
    // começa (1/800 por tick). Nenhum hostil vivia o bastante para chegar perto.
    // O cap é pequeno neste mundo, então mede-se o mínimo ao longo de vários
    // spawners independentes em vez de contar um único lote.
    const world = meadow(false);
    let closest = Infinity;
    for (let round = 0; round < 40; round++) {
      const { mobs, spawner } = build(world);
      spawner.isDay = false;
      spawner.isNight = true;
      for (let cycle = 0; cycle < 100; cycle++) {
        spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
      }
      const store = mobs.store;
      for (let i = 0; i < store.active; i++) {
        closest = Math.min(closest, Math.hypot(store.x[i] - 8.5, store.z[i] - 8.5));
      }
    }
    expect(closest).toBeLessThan(32);
    // E o piso de 24 blocos do passo 6 continua valendo.
    expect(closest).toBeGreaterThanOrEqual(24);
  });

  it('de dia, com céu aberto, hostil não nasce na superfície', () => {
    const world = meadow(true);
    const { mobs, spawner } = build(world);
    spawner.isDay = true;
    for (let cycle = 0; cycle < 200; cycle++) {
      spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
    }
    // Pode nascer em caverna, mas neste mundo maciço não há caverna nenhuma.
    expect(mobs.count).toBe(0);
  });

  it('o cap corta o spawn', () => {
    const world = meadow(false);
    const { mobs, spawner } = build(world, 20);
    spawner.isDay = false;
    spawner.isNight = true;

    for (let cycle = 0; cycle < 600; cycle++) {
      spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
    }
    /*
     * Mundo carregado: o cap é o teto do tier, e ponto.
     *
     * A escala por chunks carregados era `carregados / 289` **sem teto**, e
     * punia duas vezes — `capsForTier` já reduz pelo tier. Em T0 sobravam 8
     * hostis para 113 colunas (a caverna parecia vazia) enquanto T2 chegava a
     * 148, acima do próprio teto de 70 do doc 02 §1. Agora ela satura em 1.
     */
    expect(world.chunkCount).toBe(81); // 9×9, a área simulada inteira
    const cap = capsForTier(20).hostile;
    expect(cap).toBe(20);
    // O último pack pode passar um pouco do cap; nunca o dobro.
    expect(mobs.countCategory('hostile')).toBeLessThanOrEqual(cap + 4);
    expect(mobs.countCategory('hostile')).toBeGreaterThan(10);
  });

  it('mundo ainda carregando segura o cap para baixo', () => {
    const world = meadow(false);
    // Distância de simulação 8 pede 289 colunas; só 81 estão carregadas.
    const { mobs, spawner } = build(world, 20, 8);
    spawner.isDay = false;
    spawner.isNight = true;

    for (let cycle = 0; cycle < 600; cycle++) {
      spawner.runCycle('hostile', 8.5, GROUND_Y + 1, 8.5);
    }
    // 20 × (81/289) ≈ 6: com um punhado de chunks, não se enche de zumbi.
    expect(mobs.countCategory('hostile')).toBeLessThanOrEqual(10);
  });

  it('pacífico não spawna nada', () => {
    const world = meadow(false);
    const { mobs, spawner } = build(world);
    spawner.difficulty = 0;
    for (let t = 0; t < SPAWN_INTERVAL * 50; t++) spawner.tick(8.5, GROUND_Y + 1, 8.5);
    expect(mobs.count).toBe(0);
  });
});

describe('população inicial do chunk', () => {
  it('depois de muitos chunks, algum vem com bichos', () => {
    const world = meadow(true);
    const { mobs, spawner } = build(world);
    spawner.isDay = true;

    for (let n = 0; n < 400 && mobs.count === 0; n++) {
      const chunk = world.getChunk((n % 9) - 4, (((n / 9) | 0) % 9) - 4);
      if (chunk !== undefined) spawner.populateChunk(chunk);
    }
    expect(mobs.count).toBeGreaterThan(0);
    expect(mobDef(mobs.store.type[0]).category).toBe('passive');
  });
});

describe('regras declaradas', () => {
  it('toda regra de spawn é coerente e aponta para bloco e bioma que existem', () => {
    for (const name of Object.keys(SPAWN_RULES)) {
      const rule = SPAWN_RULES[name];
      expect(MOB_BY_NAME.has(name), name).toBe(true);
      expect(rule.minY, name).toBeLessThan(rule.maxY);
      expect(rule.packMin, name).toBeLessThanOrEqual(rule.packMax);
      expect(rule.weight, name).toBeGreaterThan(0);
      for (const block of rule.ground) {
        expect(BLOCK_BY_NAME.has(block), `${name} → ${block}`).toBe(true);
      }
      for (const biome of rule.biomes) {
        expect(BIOMES.some((b) => b.name === biome), `${name} → ${biome}`).toBe(true);
      }
    }
  });
});


/*
 * Spawn em caverna (relato de campo 2026-09-12, aparelho T0: "fiquei andando
 * um bom tempo nas cavernas e não encontrei nada").
 *
 * `runCycle` recebia o Y do jogador e o **ignorava** (`_playerY`): o Y saía
 * uniforme de `minY` até a superfície. Quase todo sorteio caía dentro de pedra
 * maciça e era rejeitado; a superfície, que sempre tem ar, aceitava. Medido com
 * o jogador a 30 de altura, os hostis nasciam a até 38 blocos **acima** dele.
 * De dentro da caverna, o mundo parecia não ter monstro.
 */
describe('hostil nasce perto do jogador que está na caverna', () => {
  /** Pedra maciça com uma galeria de 3 blocos de altura em `caveY`. */
  function cavern(caveY: number): World {
    const world = new World(99);
    for (let cz = -4; cz <= 4; cz++) {
      for (let cx = -4; cx <= 4; cx++) {
        const chunk = new ChunkColumn(cx, cz);
        for (let y = 0; y <= GROUND_Y; y++) {
          const open = y > caveY && y <= caveY + 3;
          for (let z = 0; z < 16; z++) {
            for (let x = 0; x < 16; x++) {
              if (!open) chunk.setBlock(x, y, z, stone);
            }
          }
        }
        chunk.recomputeHeightMap();
        chunk.biomeMap.fill(Math.max(0, BIOMES.findIndex((b) => b.name === 'plains')));
        for (const section of chunk.sections) {
          section.blockLight = new Uint8Array(2048);
          section.skyLight = new Uint8Array(2048);
        }
        world.addChunk(chunk);
      }
    }
    return world;
  }

  it('nasce na altura da caverna, não lá em cima na superfície', () => {
    const caveY = 30;
    const world = cavern(caveY);
    const { mobs, spawner } = build(world, 70);
    spawner.isDay = true;
    spawner.isNight = false;

    const playerY = caveY + 1;
    for (let i = 0; i < 400; i++) spawner.runCycle('hostile', 8.5, playerY, 8.5);

    let hostis = 0;
    let longeNaVertical = 0;
    for (let i = 0; i < mobs.store.active; i++) {
      if (mobDef(mobs.store.type[i]).category !== 'hostile') continue;
      hostis++;
      if (Math.abs(mobs.store.y[i] - playerY) > 20) longeNaVertical++;
    }

    expect(hostis, 'a galeria precisa receber hostil').toBeGreaterThan(0);
    // Antes da correção quase todos saíam ~33 blocos acima, na superfície.
    expect(longeNaVertical, 'nenhum hostil pode nascer fora da faixa do jogador').toBe(0);
  });
});
