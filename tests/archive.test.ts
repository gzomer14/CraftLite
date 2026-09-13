/**
 * Exportar e importar mundo (M7), e a persistência de veículo que veio junto.
 *
 * O formato é testado como bytes puros — sem IndexedDB —, e o caminho do banco
 * usa o mesmo duplo de `tests/savegame.test.ts`. A regressão que importa é a
 * volta: empacotar e desempacotar tem que devolver **o mesmo mundo**, incluindo
 * o Nether e o conteúdo dos baús.
 */
import { describe, expect, it } from 'vitest';
import {
  ARCHIVE_VERSION, ArchiveError, archiveFileName, exportWorld, importWorld, packArchive,
  unpackArchive, uniqueName, type WorldArchive,
} from '../src/save/archive';
import {
  STORE_PLAYERS, STORE_SETTINGS, STORE_WORLDS, dimensionIdFor, type SaveDatabase,
  type WorldMeta,
} from '../src/save/db';
import { newWorldMeta } from '../src/ui/menuflow';

/** Banco falso: um `Map` por store, com a chave serializada em texto. */
function fakeDb() {
  const stores = new Map<string, Map<string, unknown>>();
  const keyOf = (key: unknown): string => JSON.stringify(key);
  const storeOf = (name: string): Map<string, unknown> => {
    let store = stores.get(name);
    if (store === undefined) { store = new Map(); stores.set(name, store); }
    return store;
  };

  return {
    stores,
    async get<T>(store: string, key: unknown): Promise<T | undefined> {
      return storeOf(store).get(keyOf(key)) as T | undefined;
    },
    async getAll<T>(store: string): Promise<T[]> {
      return Array.from(storeOf(store).values()) as T[];
    },
    async put(store: string, value: unknown, key?: unknown): Promise<void> {
      // Sem chave explícita o store usa `keyPath: 'id'`, como o de mundos.
      const actual = key ?? (value as { id: string }).id;
      storeOf(store).set(keyOf(actual), value);
    },
    async putChunks(
      dimensionId: string, entries: readonly [number, number, Uint8Array][],
    ): Promise<void> {
      for (const [cx, cz, data] of entries) {
        storeOf('chunks').set(keyOf([dimensionId, cx, cz]), data);
      }
    },
    async allChunks(dimensionId: string): Promise<{ cx: number; cz: number; data: Uint8Array }[]> {
      const out: { cx: number; cz: number; data: Uint8Array }[] = [];
      for (const [key, value] of storeOf('chunks')) {
        const parsed = JSON.parse(key) as [string, number, number];
        if (parsed[0] !== dimensionId) continue;
        out.push({ cx: parsed[1], cz: parsed[2], data: value as Uint8Array });
      }
      return out;
    },
  };
}

type FakeDb = ReturnType<typeof fakeDb>;
const asDb = (db: FakeDb): SaveDatabase => db as unknown as SaveDatabase;

function sampleArchive(): WorldArchive {
  const meta = newWorldMeta('Casa', 'semente', 'survival', 2);
  return {
    version: ARCHIVE_VERSION,
    meta,
    players: [{
      worldId: meta.id, playerId: 'local',
      x: 1.5, y: 64, z: -2.5, yaw: 0.5, pitch: -0.25,
      health: 18, hunger: 15, saturation: 3, selected: 2,
      dimension: 1, inventory: [1, 2, 0], enchants: [0],
    }],
    dimensions: [
      {
        dimension: 0,
        chunks: [
          { cx: 0, cz: 0, data: new Uint8Array([1, 2, 3, 4]) },
          { cx: -3, cz: 7, data: new Uint8Array([9, 9, 9]) },
        ],
        tiles: [{ kind: 'chest', x: 1, y: 2, z: 3, slots: [5, 1, 0] }],
        vehicles: [{ kind: 'boat', x: 0.5, y: 64, z: 0.5, yaw: 1 }],
      },
      {
        dimension: 1,
        chunks: [{ cx: 12, cz: -40, data: new Uint8Array([7]) }],
        tiles: [],
        vehicles: [{ kind: 'minecart', x: 4.5, y: 40, z: 4.5, yaw: 0, dir: 2 }],
      },
    ],
  };
}

describe('formato do arquivo', () => {
  it('empacotar e desempacotar devolve o mesmo mundo', () => {
    const archive = sampleArchive();
    const back = unpackArchive(packArchive(archive));

    expect(back.version).toBe(ARCHIVE_VERSION);
    expect(back.meta).toEqual(archive.meta);
    expect(back.players).toEqual(archive.players);
    expect(back.dimensions.length).toBe(2);
    expect(back.dimensions[1].dimension).toBe(1);
    expect(back.dimensions[0].tiles).toEqual(archive.dimensions[0].tiles);
    expect(back.dimensions[1].vehicles).toEqual(archive.dimensions[1].vehicles);
  });

  it('os bytes do chunk voltam iguais, inclusive com coordenada negativa', () => {
    const back = unpackArchive(packArchive(sampleArchive()));
    const chunks = back.dimensions[0].chunks;
    expect(chunks[0]).toEqual({ cx: 0, cz: 0, data: new Uint8Array([1, 2, 3, 4]) });
    expect(chunks[1].cx).toBe(-3);
    expect(chunks[1].cz).toBe(7);
    expect(Array.from(chunks[1].data)).toEqual([9, 9, 9]);
  });

  it('o chunk desempacotado não fica preso ao buffer do arquivo', () => {
    const packed = packArchive(sampleArchive());
    const back = unpackArchive(packed);
    // Mexer no arquivo depois não pode mexer no que já saiu dele.
    packed.fill(0);
    expect(Array.from(back.dimensions[0].chunks[0].data)).toEqual([1, 2, 3, 4]);
  });

  it('mundo vazio empacota e volta vazio', () => {
    const meta = newWorldMeta('Vazio', '', 'creative', 0);
    const back = unpackArchive(packArchive({
      version: ARCHIVE_VERSION, meta, players: [], dimensions: [],
    }));
    expect(back.dimensions).toEqual([]);
    expect(back.players).toEqual([]);
  });

  it('arquivo de outro programa é recusado com mensagem legível', () => {
    const bytes = new TextEncoder().encode('PK\\u0003\\u0004qualquer coisa aqui');
    expect(() => unpackArchive(bytes)).toThrow(ArchiveError);
    expect(() => unpackArchive(bytes)).toThrow(/não é um mundo/);
  });

  it('arquivo curto demais é recusado', () => {
    expect(() => unpackArchive(new Uint8Array([1, 2]))).toThrow(ArchiveError);
  });

  it('arquivo truncado no meio de um chunk é recusado', () => {
    const packed = packArchive(sampleArchive());
    expect(() => unpackArchive(packed.subarray(0, packed.length - 3))).toThrow(ArchiveError);
  });

  it('arquivo de versão futura é recusado dizendo o porquê', () => {
    const packed = packArchive(sampleArchive());
    packed[9] = ARCHIVE_VERSION + 1; // o byte de versão, logo após a assinatura
    expect(() => unpackArchive(packed)).toThrow(/este jogo lê até/i);
  });
});

describe('nome de arquivo', () => {
  it('vira um nome de arquivo seguro', () => {
    expect(archiveFileName('Minha Casa')).toBe('Minha-Casa.clw');
    expect(archiveFileName('a/b\\\\c:d')).toBe('abcd.clw');
    expect(archiveFileName('Ilha Grande 2')).toBe('Ilha-Grande-2.clw');
  });

  it('nome que só tinha caractere proibido vira `mundo`', () => {
    expect(archiveFileName('///')).toBe('mundo.clw');
    expect(archiveFileName('   ')).toBe('mundo.clw');
  });

  it('acento não é caractere proibido', () => {
    expect(archiveFileName('Sertão')).toBe('Sertão.clw');
  });
});

describe('nome único', () => {
  it('devolve o mesmo nome quando ninguém o usa', () => {
    expect(uniqueName('Casa', ['Praia'])).toBe('Casa');
  });

  it('acrescenta o contador quando já existe', () => {
    expect(uniqueName('Casa', ['Casa'])).toBe('Casa (2)');
    expect(uniqueName('Casa', ['Casa', 'Casa (2)'])).toBe('Casa (3)');
  });
});

describe('ida e volta pelo banco', () => {
  /** Grava um mundo completo no banco falso e devolve a meta. */
  async function seed(db: FakeDb, name = 'Casa'): Promise<WorldMeta> {
    const meta = newWorldMeta(name, 'semente', 'survival', 2);
    await db.put(STORE_WORLDS, meta);
    await db.putChunks(dimensionIdFor(meta.id, 0), [[0, 0, new Uint8Array([1, 2, 3])]]);
    await db.putChunks(dimensionIdFor(meta.id, 1), [[5, 5, new Uint8Array([4, 5])]]);
    await db.put(
      STORE_SETTINGS, [{ kind: 'chest', x: 1, y: 2, z: 3, slots: [] }],
      `${dimensionIdFor(meta.id, 0)}.tiles`,
    );
    await db.put(
      STORE_SETTINGS, [{ kind: 'minecart', x: 0.5, y: 64, z: 0.5, yaw: 0, dir: 1 }],
      `${dimensionIdFor(meta.id, 0)}.vehicles`,
    );
    await db.put(STORE_PLAYERS, { worldId: meta.id, playerId: 'local', x: 1, y: 2, z: 3 },
      [meta.id, 'local']);
    return meta;
  }

  it('exporta e importa preservando chunks, baús, veículos e jogador', async () => {
    const db = fakeDb();
    const original = await seed(db);
    const bytes = await exportWorld(asDb(db), original.id);
    const imported = await importWorld(asDb(db), bytes);

    expect(imported.id).not.toBe(original.id);
    expect(imported.seedHash).toBe(original.seedHash);

    expect(await db.allChunks(dimensionIdFor(imported.id, 0))).toHaveLength(1);
    expect(await db.allChunks(dimensionIdFor(imported.id, 1))).toHaveLength(1);
    const tiles = await db.get<unknown[]>(
      STORE_SETTINGS, `${dimensionIdFor(imported.id, 0)}.tiles`,
    );
    expect(tiles).toHaveLength(1);
    const vehicles = await db.get<{ kind: string }[]>(
      STORE_SETTINGS, `${dimensionIdFor(imported.id, 0)}.vehicles`,
    );
    expect(vehicles?.[0].kind).toBe('minecart');
  });

  it('o mundo importado **não** sobrescreve o original', async () => {
    const db = fakeDb();
    const original = await seed(db);
    await importWorld(asDb(db), await exportWorld(asDb(db), original.id));

    const worlds = await db.getAll<WorldMeta>(STORE_WORLDS);
    expect(worlds).toHaveLength(2);
    expect(await db.allChunks(dimensionIdFor(original.id, 0))).toHaveLength(1);
  });

  it('importar duas vezes gera nomes distintos', async () => {
    const db = fakeDb();
    const original = await seed(db);
    const bytes = await exportWorld(asDb(db), original.id);
    const first = await importWorld(asDb(db), bytes);
    const second = await importWorld(asDb(db), bytes);

    expect(first.name).toBe('Casa (2)');
    expect(second.name).toBe('Casa (3)');
    expect(first.id).not.toBe(second.id);
  });

  it('o jogador importado aponta para o mundo novo', async () => {
    const db = fakeDb();
    const original = await seed(db);
    const imported = await importWorld(asDb(db), await exportWorld(asDb(db), original.id));
    const player = await db.get<{ worldId: string }>('players', [imported.id, 'local']);
    expect(player?.worldId).toBe(imported.id);
  });

  it('dimensão nunca visitada não entra no arquivo', async () => {
    const db = fakeDb();
    const meta = newWorldMeta('Só superfície', 'x', 'survival', 2);
    await db.put(STORE_WORLDS, meta);
    await db.putChunks(dimensionIdFor(meta.id, 0), [[0, 0, new Uint8Array([1])]]);

    const archive = unpackArchive(await exportWorld(asDb(db), meta.id));
    expect(archive.dimensions).toHaveLength(1);
    expect(archive.dimensions[0].dimension).toBe(0);
  });

  it('exportar um mundo que não existe falha com mensagem clara', async () => {
    const db = fakeDb();
    await expect(exportWorld(asDb(db), 'nada')).rejects.toThrow(/não encontrado/i);
  });
});
