/**
 * Persistência ligada ao jogo (doc 11, pendência P1 do M4).
 *
 * O teste que importa é o do doc 14: **quebrar um bloco, salvar, recarregar e
 * encontrar o bloco quebrado**. Junto com ele vão inventário, vida, cama e
 * baús — tudo que o jogador perde se o save não estiver realmente ligado.
 *
 * O banco é falso e vive em memória: o que está sob teste é a fiação, não o
 * IndexedDB.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AUTOSAVE_TICKS, SaveManager } from '../src/save/savemanager';
import {
  SaveGame, containerFrom, tileFrom, type ContainerRecord, type TileRecord,
} from '../src/game/savegame';
import { freeStandY, trySpawn } from '../src/game/spawnplacement';
import { newWorldMeta } from '../src/ui/menuflow';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { AIR, BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';
import { ITEM_BY_NAME, makeStack } from '../src/data/items';
import { Container, Furnace } from '../src/game/container';
import { applyEnchant, levelOf } from '../src/game/enchanting';
import { EFFICIENCY, SHARPNESS, UNBREAKING } from '../src/data/enchants';
import { totalForLevel } from '../src/game/xp';
import { ChunkPipeline, type WorkerLike } from '../src/world/pipeline';
import type { SaveDatabase } from '../src/save/db';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

const GROUND_Y = 63;
const stone = makeState(BLOCK_BY_NAME.get('stone')!.id);

/** Banco em memória com a mesma superfície do `SaveDatabase`. */
function fakeDb() {
  const stores = new Map<string, Map<string, unknown>>();
  const keyOf = (key: unknown): string => JSON.stringify(key);
  const storeOf = (name: string): Map<string, unknown> => {
    let store = stores.get(name);
    if (store === undefined) { store = new Map(); stores.set(name, store); }
    return store;
  };

  const db = {
    writes: 0,
    async get<T>(store: string, key: unknown): Promise<T | undefined> {
      return storeOf(store).get(keyOf(key)) as T | undefined;
    },
    async put(store: string, value: unknown, key?: unknown): Promise<void> {
      db.writes++;
      storeOf(store).set(keyOf(key ?? (value as { id: string }).id), value);
    },
    async getAll<T>(store: string): Promise<T[]> {
      return Array.from(storeOf(store).values()) as T[];
    },
    async putChunks(
      worldId: string, entries: readonly [number, number, Uint8Array][],
    ): Promise<void> {
      db.writes++;
      for (const [cx, cz, data] of entries) {
        storeOf('chunks').set(keyOf([worldId, cx, cz]), data);
      }
    },
    async getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
      return storeOf('chunks').get(keyOf([worldId, cx, cz])) as Uint8Array | undefined;
    },
    async delete(): Promise<void> { /* nada */ },
    async deleteWorld(): Promise<void> { /* nada */ },
  };
  return db;
}

/** Deixa as gravações assíncronas do banco falso terminarem. */
async function settleSaves(): Promise<void> {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

function flatWorld(): World {
  const world = new World(4242);
  for (let cz = -1; cz <= 1; cz++) {
    for (let cx = -1; cx <= 1; cx++) {
      const chunk = new ChunkColumn(cx, cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) chunk.setBlock(x, y, z, stone);
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

function harness(db: ReturnType<typeof fakeDb>, meta = newWorldMeta('Teste', 'semente', 'survival', 2)) {
  const world = flatWorld();
  const player = new Player(8.5, GROUND_Y + 1, 8.5);
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
  });
  const manager = new SaveManager(db as unknown as SaveDatabase, meta.id);
  const save = new SaveGame(manager, session, player, meta);
  save.attach();
  return { world, player, session, save, manager, meta };
}

describe('mundo novo', () => {
  it('a meta nasce com seed, modo e dificuldade escolhidos', () => {
    const meta = newWorldMeta('Casa', 'oi', 'creative', 1);
    expect(meta.name).toBe('Casa');
    expect(meta.seed).toBe('oi');
    expect(meta.seedHash).toBeGreaterThan(0);
    expect(meta.gameMode).toBe('creative');
    expect(meta.difficulty).toBe(1);
    expect(meta.id.length).toBeGreaterThan(8);
  });

  it('nome vazio vira "Novo Mundo" e a mesma seed dá o mesmo hash', () => {
    expect(newWorldMeta('   ', 'x', 'survival', 2).name).toBe('Novo Mundo');
    expect(newWorldMeta('a', 'craftlite', 'survival', 2).seedHash)
      .toBe(newWorldMeta('b', 'craftlite', 'survival', 2).seedHash);
  });

  it('carregar um mundo que nunca foi jogado devolve false', async () => {
    const { save } = harness(fakeDb());
    expect(await save.load()).toBe(false);
  });
});

describe('ciclo salvar → recarregar (aceite do doc 14)', () => {
  it('o bloco quebrado continua quebrado depois de recarregar', async () => {
    const db = fakeDb();
    const first = harness(db);

    first.world.setBlock(8, GROUND_Y, 8, AIR, 'player');
    await first.save.saveAll();

    // Sessão nova, mundo novo, mesmo banco: é o que acontece ao reabrir a aba.
    const second = harness(db, first.meta);
    const chunk = await second.save.loadChunk(0, 0);

    expect(chunk).not.toBeNull();
    expect(chunk?.getBlock(8, GROUND_Y, 8)).toBe(AIR);
    // O que não foi tocado continua lá.
    expect(blockIdOf(chunk?.getBlock(9, GROUND_Y, 8) ?? 0)).toBe(BLOCK_BY_NAME.get('stone')!.id);
  });

  it('chunk nunca tocado não é salvo — volta da seed', async () => {
    const db = fakeDb();
    const { save } = harness(db);
    await save.saveAll();
    expect(await save.loadChunk(1, 1)).toBeNull();
  });

  it('a coluna que volta do disco tem luz recalculada', async () => {
    const db = fakeDb();
    const first = harness(db);
    // Abre um buraco até o céu para haver o que iluminar.
    for (let y = GROUND_Y; y > GROUND_Y - 4; y--) first.world.setBlock(4, y, 4, AIR, 'player');
    await first.save.saveAll();

    const second = harness(db, first.meta);
    const chunk = await second.save.loadChunk(0, 0);
    expect(chunk).not.toBeNull();
    if (chunk === null) return;

    // A luz não é gravada (doc 11 §2): se não fosse recalculada, a section
    // viria sem array nenhum.
    const section = chunk.sections[GROUND_Y >> 4];
    expect(section.skyLight).not.toBeNull();
  });

  it('inventário, vida e posição voltam iguais', async () => {
    const db = fakeDb();
    const first = harness(db);
    const pick = ITEM_BY_NAME.get('stone_pickaxe')!;
    first.session.inventory.set(0, makeStack(pick.id, 1));
    first.session.inventory.set(9, makeStack(ITEM_BY_NAME.get('coal')!.id, 12));
    first.session.inventory.select(3);
    first.session.survival.health = 7;
    first.session.survival.hunger = 11;
    first.player.setPosition(20.5, GROUND_Y + 1, -13.5);
    first.player.yaw = 1.25;
    await first.save.saveAll();

    const second = harness(db, first.meta);
    expect(await second.save.load()).toBe(true);

    expect(second.session.inventory.get(0)?.item).toBe(pick.id);
    expect(second.session.inventory.get(9)?.count).toBe(12);
    expect(second.session.inventory.selected).toBe(3);
    expect(second.session.survival.health).toBe(7);
    expect(second.session.survival.hunger).toBe(11);
    expect(second.player.x).toBeCloseTo(20.5, 5);
    expect(second.player.z).toBeCloseTo(-13.5, 5);
    expect(second.player.yaw).toBeCloseTo(1.25, 5);
  });

  it('experiência e encantamento voltam iguais (M6)', async () => {
    const db = fakeDb();
    const first = harness(db);
    const pick = ITEM_BY_NAME.get('diamond_pickaxe')!;
    const stack = makeStack(pick.id, 1);
    applyEnchant(stack, EFFICIENCY, 4);
    applyEnchant(stack, UNBREAKING, 2);
    first.session.inventory.set(0, stack);
    first.session.xp.setTotal(totalForLevel(17));
    await first.save.saveAll();

    const second = harness(db, first.meta);
    expect(await second.save.load()).toBe(true);

    const loaded = second.session.inventory.get(0);
    expect(levelOf(loaded, EFFICIENCY)).toBe(4);
    expect(levelOf(loaded, UNBREAKING)).toBe(2);
    expect(second.session.xp.level).toBe(17);
  });

  it('as conquistas voltam com o jogador (M6)', async () => {
    const db = fakeDb();
    const first = harness(db);
    first.session.achievements.obtain('diamond');
    first.session.achievements.event('sleep');
    const mask = first.session.achievements.mask;
    await first.save.saveAll();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(second.session.achievements.mask).toBe(mask);
    expect(second.session.achievements.count).toBe(2);
  });

  it('a hora do dia e a dificuldade voltam com o mundo', async () => {
    const db = fakeDb();
    const first = harness(db);
    // O save guarda o total desde o início do mundo, não o tick do dia: é dele
    // que saem o número do dia, o clima e a fase da lua (M6).
    first.session.dayNight.totalTicks = 24000 * 5 + 15000;
    first.session.dayNight.time = 15000;
    first.session.survival.difficulty = 3;
    await first.save.saveAll();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(second.session.dayNight.time).toBe(15000);
    expect(second.session.dayNight.day).toBe(5);
    expect(second.session.survival.difficulty).toBe(3);
  });

  it('o ponto de renascimento da cama sobrevive', async () => {
    const db = fakeDb();
    const first = harness(db);
    first.session.spawnX = 12;
    first.session.spawnY = 64;
    first.session.spawnZ = -7;
    await first.save.saveAll();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(second.session.spawnY).toBe(64);
    expect(second.session.spawnZ).toBe(-7);
  });
});

describe('tile entities', () => {
  it('baú com conteúdo volta cheio', async () => {
    const db = fakeDb();
    const first = harness(db);
    const chest = new Container('chest', 27, 3, 64, 5);
    chest.set(2, makeStack(ITEM_BY_NAME.get('diamond')!.id, 3));
    first.session.tiles.restore(chest);
    await first.save.saveAll();

    const second = harness(db, first.meta);
    await second.save.load();
    const loaded = second.session.tiles.at(3, 64, 5);
    expect(loaded?.get(2)?.count).toBe(3);
  });

  it('espada encantada guardada no baú volta encantada', async () => {
    const db = fakeDb();
    const first = harness(db);
    const chest = new Container('chest', 27, 4, 64, 6);
    const sword = makeStack(ITEM_BY_NAME.get('diamond_sword')!.id, 1);
    applyEnchant(sword, SHARPNESS, 3);
    chest.set(0, sword);
    first.session.tiles.restore(chest);
    await first.save.saveAll();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(levelOf(second.session.tiles.at(4, 64, 6)?.get(0) ?? null, SHARPNESS)).toBe(3);
  });

  it('fornalha volta com o combustível e o progresso', () => {
    const furnace = new Furnace(1, 2, 3);
    furnace.burnTicks = 40;
    furnace.burnTotal = 200;
    furnace.cookTicks = 55;
    furnace.set(0, makeStack(ITEM_BY_NAME.get('raw_iron')!.id, 2));

    const record = tileFrom(furnace);
    expect(record.kind).toBe('furnace');
    expect(record.burn).toEqual([40, 200, 55]);

    const restored = containerFrom(record) as Furnace;
    expect(restored.burnTicks).toBe(40);
    expect(restored.cookTicks).toBe(55);
    expect(restored.get(0)?.count).toBe(2);
  });

  it('registro corrompido não derruba o carregamento', () => {
    const record = { kind: 'chest', x: 0, y: 0, z: 0, slots: [] } as ContainerRecord;
    const container = containerFrom(record);
    expect(container.size).toBe(0);
  });
});

describe('autosave', () => {
  it('só grava quem foi modificado', async () => {
    const db = fakeDb();
    const { world, manager } = harness(db);

    // Nada mudou: o flush não escreve.
    await manager.flush();
    const before = db.writes;
    expect(manager.stats.pending).toBe(0);

    world.setBlock(1, GROUND_Y, 1, AIR, 'player');
    expect(manager.stats.pending).toBe(1);
    await manager.flush();
    expect(db.writes).toBeGreaterThan(before);
    expect(manager.stats.pending).toBe(0);
  });

  it('mudança da geração não suja o chunk', () => {
    const db = fakeDb();
    const { world, manager } = harness(db);
    world.setBlock(2, GROUND_Y, 2, AIR, 'gen');
    expect(manager.stats.pending).toBe(0);
  });

  it('desligar o observador para de marcar', () => {
    const db = fakeDb();
    const { world, save, manager } = harness(db);
    save.detach();
    world.setBlock(3, GROUND_Y, 3, AIR, 'player');
    expect(manager.stats.pending).toBe(0);
  });
});


/*
 * Ida e volta na MESMA sessão (pergunta de campo, 2026-09-12: "se eu construir
 * uma casa e viajar muito longe, ao voltar ela continua lá?").
 *
 * O teste de recarregar a aba já existia; este cobre o outro caminho, que é o
 * que o jogador faz o tempo todo e passa por peças diferentes:
 *
 *   afastar  → `unloadFarChunks` → `onChunkUnloaded` → `saveAndForget`
 *   voltar   → `enqueueRing` → `dispatchGen` → `loadSaved` → `acceptChunk`
 *
 * Se `loadSaved` falhasse, o chunk voltaria **regenerado da seed** — a casa
 * some e nada no console reclama. É a falha mais cara possível num jogo de
 * construir, então ela tem teste próprio.
 */
describe('viajar longe e voltar', () => {
  /** Worker duplo: gera coluna de pedra até `GROUND_Y`, sem ruído. */
  class FlatWorker implements WorkerLike {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    private readonly outbox: WorkerResponse[] = [];
    generated = 0;

    postMessage(message: unknown): void {
      const request = message as WorkerRequest;
      if (request.type === 'init') return;
      if (request.type === 'mesh') {
        // Meshing não interessa aqui; devolve vazio para o pipeline seguir.
        this.outbox.push({
          type: 'mesh', cx: request.cx, cz: request.cz, sections: [], quads: 0, ms: 0,
        });
        return;
      }
      if (request.type === 'spawn') return;
      this.generated++;
      const column = new ChunkColumn(request.cx, request.cz);
      for (let y = 0; y <= GROUND_Y; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) column.setBlock(x, y, z, stone);
        }
      }
      column.recomputeHeightMap();
      this.outbox.push({
        type: 'gen', cx: request.cx, cz: request.cz, dim: request.dim,
        sections: column.sections.map((section) => ({
          bits: section.bits, paletteLen: section.paletteLen, palette: section.palette,
          data: section.data, nonAirCount: section.nonAirCount,
          skyLight: new Uint8Array(2048), blockLight: new Uint8Array(2048),
        })),
        heightMap: column.heightMap, biomeMap: column.biomeMap, ms: 1,
      });
    }

    flush(): void {
      while (this.outbox.length > 0) {
        this.onmessage?.({ data: this.outbox.shift() as WorkerResponse });
      }
    }
    terminate(): void { /* nada */ }
  }

  /**
   * Deixa as promessas de save/load resolverem de verdade.
   *
   * Microtask não basta: `compressChunk` passa por `CompressionStream`, que é
   * stream de verdade e só avança em macrotask. Um `setTimeout(0)` por volta.
   */
  const settle = async (): Promise<void> => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  };

  it('o bloco quebrado continua quebrado ao voltar sem recarregar o jogo', async () => {
    const db = fakeDb();
    const { manager } = harness(db);
    const world = new World(4242);
    const workers: FlatWorker[] = [];
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 2, packed: true,
      createWorker: () => { const w = new FlatWorker(); workers.push(w); return w; },
    });
    // A mesma fiação do `main.ts`.
    pipeline.onChunkUnloaded = (chunk) => { void manager.saveAndForget(chunk); };
    pipeline.loadSaved = (cx, cz) => manager.loadChunk(cx, cz);

    const run = async (times: number): Promise<void> => {
      for (let i = 0; i < times; i++) {
        pipeline.enqueueDirty();
        pipeline.pump();
        for (const w of workers) w.flush();
        pipeline.drainReady(1000, () => { /* descarta */ });
        await settle();
      }
    };

    pipeline.setCenter(0, 0);
    await run(40);
    expect(world.getChunk(0, 0), 'o chunk de casa precisa estar carregado').toBeDefined();

    // Constrói: quebra o chão e põe um bloco de madeira em cima.
    const planks = BLOCK_BY_NAME.get('oak_planks');
    world.setBlock(8, GROUND_Y, 8, AIR, 'player');
    if (planks !== undefined) world.setBlock(8, GROUND_Y + 1, 8, makeState(planks.id), 'player');
    expect(world.getChunk(0, 0)?.modified).toBe(true);

    // Viaja para muito longe: a coluna sai de alcance e é gravada.
    pipeline.setCenter(4000, 4000);
    await run(40);
    expect(world.getChunk(0, 0), 'longe o bastante, a coluna sai da memória').toBeUndefined();

    // Volta.
    pipeline.setCenter(0, 0);
    await run(60);

    const back = world.getChunk(0, 0);
    expect(back, 'a coluna precisa voltar').toBeDefined();
    expect(back?.getBlock(8, GROUND_Y, 8), 'o buraco cavado continua lá').toBe(AIR);
    if (planks !== undefined) {
      expect(
        blockIdOf(back?.getBlock(8, GROUND_Y + 1, 8) ?? 0),
        'o bloco construído continua lá',
      ).toBe(planks.id);
    }
    // E o vizinho intocado voltou da seed, não do disco.
    expect(blockIdOf(back?.getBlock(9, GROUND_Y, 8) ?? 0)).toBe(BLOCK_BY_NAME.get('stone')!.id);
  });

  it('a coluna intocada não ocupa o disco ao sair de alcance', async () => {
    const db = fakeDb();
    const { manager } = harness(db);
    const world = new World(4242);
    const workers: FlatWorker[] = [];
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 1, packed: true,
      createWorker: () => { const w = new FlatWorker(); workers.push(w); return w; },
    });
    pipeline.onChunkUnloaded = (chunk) => { void manager.saveAndForget(chunk); };

    pipeline.setCenter(0, 0);
    for (let i = 0; i < 30; i++) {
      pipeline.pump();
      for (const w of workers) w.flush();
      pipeline.drainReady(1000, () => { /* descarta */ });
      await Promise.resolve();
    }
    pipeline.setCenter(4000, 4000);
    for (let i = 0; i < 20; i++) await new Promise((resolve) => setTimeout(resolve, 0));

    expect(await manager.loadChunk(0, 0), 'nada tocado, nada gravado').toBeNull();
  });
});


/*
 * Fechar a aba sem "Salvar e sair" (perguntas de campo, 2026-09-12).
 *
 * O autosave de 60 s chamava só `manager.tick()`, que despeja **apenas
 * chunks**. Jogador, baús e meta do mundo tinham um único caminho de gravação:
 * o botão de sair. Fechar a aba — no celular, o caso comum, porque
 * `beforeunload` não dispara ao trocar de app — perdia o conteúdo dos baús e a
 * hora do dia, e trazia de volta a posição da última saída limpa.
 */
afterEach(() => vi.unstubAllGlobals());

describe('autosave grava o mundo inteiro', () => {
  it('o tick de 60 s grava jogador, baús e meta, não só chunks', async () => {
    const db = fakeDb();
    const h = harness(db);

    h.player.setPosition(123.5, 70, -45.5);
    h.session.dayNight.totalTicks = 9000;
    const chest = new Container('chest', 27, 4, 64, 4);
    chest.set(0, makeStack(ITEM_BY_NAME.get('oak_planks')!.id, 12));
    h.session.tiles.restore(chest);
    h.world.setBlock(8, GROUND_Y, 8, AIR, 'player');

    // Um tick a menos que o intervalo: ainda não gravou nada.
    for (let i = 0; i < AUTOSAVE_TICKS - 1; i++) h.save.tick();
    await settleSaves();
    expect(await h.manager.loadPlayer('local')).toBeUndefined();

    h.save.tick(); // o tick que fecha o intervalo
    await settleSaves();

    const saved = await h.manager.loadPlayer('local');
    expect(saved, 'o autosave tem que gravar o jogador').toBeDefined();
    expect(saved?.x).toBeCloseTo(123.5, 3);
    expect(saved?.z).toBeCloseTo(-45.5, 3);

    const tiles = await h.manager.loadTiles<TileRecord>();
    expect(tiles.length, 'e os baús junto').toBeGreaterThan(0);
  });

  it('o registro mais novo vence entre banco e emergência', async () => {
    // O ambiente é Node: sem este duplo, `writeEmergency` engole a exceção e o
    // teste passaria sem nunca exercitar a rede de segurança.
    const shelf: Record<string, string> = {};
    vi.stubGlobal('localStorage', {
      getItem: (k: string) => shelf[k] ?? null,
      setItem: (k: string, v: string) => { shelf[k] = v; },
      removeItem: (k: string) => { delete shelf[k]; },
    });

    const db = fakeDb();
    const h = harness(db);

    // Saída limpa: grava no banco com a posição antiga.
    h.player.setPosition(10.5, 70, 10.5);
    await h.save.saveAll();

    // Continua jogando e fecha a aba: só a rede de emergência corre.
    h.player.setPosition(900.5, 70, -900.5);
    await new Promise((resolve) => setTimeout(resolve, 5));
    h.save.writeEmergency();

    const loaded = await h.manager.loadPlayer('local');
    expect(loaded?.x, 'a posição mais recente é a que vale').toBeCloseTo(900.5, 3);
    expect(loaded?.z).toBeCloseTo(-900.5, 3);
  });
});

describe('falha de gravação não é silenciosa', () => {
  it('erro ao gravar chunk chega a quem escuta', async () => {
    const db = fakeDb();
    const errors: string[] = [];
    const meta = newWorldMeta('Teste', 'semente', 'survival', 2);
    const world = flatWorld();
    const player = new Player(8.5, GROUND_Y + 1, 8.5);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ },
      onDeath: () => { /* nada */ },
      onPickup: () => { /* nada */ },
    });
    const manager = new SaveManager(db as unknown as SaveDatabase, meta.id);
    const save = new SaveGame(manager, session, player, meta, {
      onError: (message) => errors.push(message),
    });
    save.attach();

    // Cota estourada no meio da partida.
    db.putChunks = async (): Promise<void> => {
      throw new Error('QuotaExceededError');
    };
    world.setBlock(8, GROUND_Y, 8, AIR, 'player');
    await manager.flush();

    expect(errors, 'o jogador precisa saber que parou de salvar').toContain('QuotaExceededError');
  });
});


/*
 * Sair do mundo e voltar (relato de campo, 2026-09-12: "ao sair desse mundo e
 * voltar para ele, meu jogador é teletransportado para a primeira posição onde
 * iniciou no mundo").
 *
 * `trySpawn` tem duas funções: segurar a simulação até existir chão — senão o
 * jogador cai pelo vazio enquanto os chunks carregam — e posicioná-lo em mundo
 * novo. Ela reposicionava **sempre**, inclusive quando o save acabara de
 * devolver a posição, e a coluna (0,0) é justamente onde toda partida começa.
 */
describe('voltar ao mundo não teletransporta', () => {
  it('a posição do save é preservada', () => {
    const world = flatWorld();
    const player = new Player(8.5, GROUND_Y + 1, 8.5);
    // Longe do spawn, como quem construiu longe. `flatWorld` cobre −1..1.
    player.setPosition(20.5, GROUND_Y + 1, -10.5);

    expect(trySpawn(world, player, true), 'a coluna está carregada').toBe(true);
    expect(player.x).toBeCloseTo(20.5, 3);
    expect(player.z).toBeCloseTo(-10.5, 3);
  });

  /*
   * Mudou em 2026-09-22: o mundo novo nascia sempre na coluna (0, 0), e metade
   * das seeds põe mar ali. Agora o `main.ts` põe o jogador na coluna achada
   * pela busca (`world/gen/spawnsearch.ts`) antes do primeiro chunk chegar, e
   * `trySpawn` só o assenta no chão **daquela** coluna.
   */
  it('mundo novo assenta o jogador no chão da coluna em que foi posto', () => {
    const world = flatWorld();
    const player = new Player(20.5, 200, -10.5);

    expect(trySpawn(world, player, false)).toBe(true);
    expect(player.x).toBeCloseTo(20.5, 3);
    expect(player.z).toBeCloseTo(-10.5, 3);
    expect(player.y).toBeCloseTo(GROUND_Y + 1, 3);
  });

  it('espera o chão antes de simular, nos dois casos', () => {
    const empty = new World(1);
    const player = new Player(20.5, 70, -10.5);
    expect(trySpawn(empty, player, true), 'sem chunk, não simula').toBe(false);
    expect(trySpawn(empty, player, false)).toBe(false);
    // E não mexeu em ninguém enquanto esperava.
    expect(player.x).toBeCloseTo(20.5, 3);
  });
});

describe('veículos e dimensão no save (M7)', () => {
  /**
   * Regressão de duas coisas que sumiam sozinhas:
   *
   * 1. **Barco e carrinho nunca foram salvos** desde que existem. Sair do mundo
   *    e voltar sumia com os dois — o trilho ficava, o carrinho não.
   * 2. **Baú do Nether sobrescrevia o da superfície.** A lista de tile entities
   *    tinha uma chave só por mundo; atravessar o portal gravava a lista de lá
   *    por cima da de cá, e o conteúdo de todo baú de casa ia junto.
   */
  it('barco e carrinho vão para o save e voltam dele', async () => {
    const db = fakeDb();
    const first = harness(db);
    first.session.vehicles.boats.spawn(1.5, GROUND_Y + 1, 2.5, 0.75);
    first.session.vehicles.carts.spawn(4.5, GROUND_Y + 1, 4.5, 2);
    await first.save.saveAll();
    await settleSaves();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(second.session.vehicles.boats.active).toBe(1);
    expect(second.session.vehicles.carts.active).toBe(1);
    expect(second.session.vehicles.boats.x[0]).toBeCloseTo(1.5);
    expect(second.session.vehicles.carts.z[0]).toBeCloseTo(4.5);
    expect(second.session.vehicles.carts.dir[0]).toBe(2);
  });

  it('mundo sem veículo nenhum volta sem veículo, e não quebra', async () => {
    const db = fakeDb();
    const first = harness(db);
    await first.save.saveAll();
    await settleSaves();

    const second = harness(db, first.meta);
    await second.save.load();
    expect(second.session.vehicles.boats.active).toBe(0);
    expect(second.session.vehicles.carts.active).toBe(0);
  });

  it('cada dimensão tem a sua lista de baús e de veículos', async () => {
    const db = fakeDb();
    const { session, save } = harness(db);

    // Um barco na superfície, gravado pelo caminho normal.
    session.vehicles.boats.spawn(1.5, GROUND_Y + 1, 1.5, 0);
    await save.saveAll();
    await settleSaves();

    // Atravessa: o save grava o da superfície e passa a olhar o do Nether.
    save.switchDimension(1);
    session.enterDimension(1);
    await settleSaves();
    expect(session.vehicles.boats.active).toBe(0);

    // Um carrinho do lado de lá, e de volta para casa.
    session.vehicles.carts.spawn(9.5, GROUND_Y + 1, 9.5, 0);
    save.switchDimension(0);
    session.enterDimension(0);
    await settleSaves();

    // O barco da superfície voltou; o carrinho do Nether não veio junto.
    expect(session.vehicles.boats.active).toBe(1);
    expect(session.vehicles.carts.active).toBe(0);
  });

  it('a dimensão do jogador entra no instantâneo', () => {
    const db = fakeDb();
    const { session, save } = harness(db);
    expect(save.snapshot().dimension).toBe(0);
    session.enterDimension(1);
    expect(save.snapshot().dimension).toBe(1);
  });
});

describe('renascer não enterra o jogador', () => {
  /*
   * Campo, 2026-09-23: nasceu em cima de uma árvore, morreu longe, e renasceu
   * "dentro da árvore tomando dano". A coluna de renascimento não estava
   * carregada e a altura saía de um 70 de reserva.
   */
  it('a altura livre sobe até sair do tronco', () => {
    const world = flatWorld();
    const log = makeState(BLOCK_BY_NAME.get('oak_log')!.id);
    for (let y = GROUND_Y + 1; y <= GROUND_Y + 5; y++) world.setBlock(4, y, 4, log, 'gen');
    expect(freeStandY(world, 4, GROUND_Y + 2, 4)).toBe(GROUND_Y + 6);
    expect(freeStandY(world, 5, GROUND_Y + 1, 4)).toBe(GROUND_Y + 1);
  });

  it('sem cama e com a coluna longe, o renascimento avisa que a altura é palpite', () => {
    const world = flatWorld();
    const player = new Player(8.5, GROUND_Y + 1, 8.5);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
    });
    // O spawn do mundo fora das colunas carregadas: quem chama segura a física
    // e deixa `trySpawn` assentar o jogador quando a coluna chegar.
    expect(session.respawn(500, 500)).toBe(false);
    expect(trySpawn(world, player, false)).toBe(false);
  });
});
