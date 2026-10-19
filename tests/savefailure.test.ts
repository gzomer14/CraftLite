/**
 * Save que falha (M23): a coluna descarregada que não conseguiu ir para o disco
 * não pode sumir, a coluna que não abre não pode ser trocada calada pela seed,
 * e falta de espaço precisa chegar à UI como falta de espaço (doc 11 §4).
 */
import { describe, expect, it } from 'vitest';
import { SaveManager, isQuotaError, quarantineKey } from '../src/save/savemanager';
import { SaveGame } from '../src/game/savegame';
import { Session } from '../src/game/session';
import { Player } from '../src/entity/player';
import { World } from '../src/world/world';
import { ChunkColumn } from '../src/world/chunk';
import { BLOCK_BY_NAME, blockIdOf, makeState } from '../src/data/blocks';
import { newWorldMeta } from '../src/ui/menuflow';
import type { SaveDatabase } from '../src/save/db';
import { QuotaGate } from '../src/ui/screens/storagefull';
import { saveAlerts } from '../src/ui/savealerts';

const GOLD = makeState(BLOCK_BY_NAME.get('gold_block')!.id);

function quotaError(): Error {
  const error = new Error('cota estourada');
  error.name = 'QuotaExceededError';
  return error;
}

/** Banco em memória que pode recusar gravações de coluna. */
function fakeDb() {
  const chunks = new Map<string, Uint8Array>();
  const settings = new Map<string, unknown>();
  const db = {
    full: false,
    async putChunks(id: string, entries: readonly [number, number, Uint8Array][]): Promise<void> {
      if (db.full) throw quotaError();
      for (const [cx, cz, data] of entries) chunks.set(`${id}|${cx}|${cz}`, data);
    },
    async getChunk(id: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
      return chunks.get(`${id}|${cx}|${cz}`);
    },
    async put(_store: string, value: unknown, key?: unknown): Promise<void> {
      settings.set(String(key), value);
    },
    async get(_store: string, key: unknown): Promise<unknown> {
      return settings.get(String(key));
    },
    chunks,
    settings,
  };
  return db;
}

function goldChunk(cx: number, cz: number): ChunkColumn {
  const chunk = new ChunkColumn(cx, cz);
  chunk.setBlock(3, 70, 3, GOLD);
  chunk.modified = true;
  return chunk;
}

describe('coluna descarregada com a gravação falhando', () => {
  it('não se perde: volta ao ser pedida e vai para o disco quando houver espaço', async () => {
    const db = fakeDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    const errors: boolean[] = [];
    manager.onError = (_message, quota) => errors.push(quota);

    db.full = true;
    await manager.saveAndForget(goldChunk(2, -1));
    expect(errors, 'a falha chega como falta de espaço').toEqual([true]);
    expect(manager.orphanCount).toBe(1);
    expect(db.chunks.size).toBe(0);

    // Ainda sem espaço: o flush tenta, falha e a coluna continua na fila.
    await manager.flush();
    expect(manager.orphanCount).toBe(1);

    db.full = false;
    await manager.flush();
    expect(manager.orphanCount).toBe(0);
    const back = await manager.loadChunk(2, -1);
    expect(back).not.toBeNull();
    expect(blockIdOf(back!.getBlock(3, 70, 3))).toBe(BLOCK_BY_NAME.get('gold_block')!.id);
  });

  it('pedida antes de gravar, vem da fila — não da seed — e volta para o caminho normal', async () => {
    const db = fakeDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    db.full = true;
    await manager.saveAndForget(goldChunk(0, 0));
    const back = await manager.loadChunk(0, 0);
    expect(back, 'sem a fila, a seed geraria a coluna sem o ouro').not.toBeNull();
    expect(blockIdOf(back!.getBlock(3, 70, 3))).toBe(BLOCK_BY_NAME.get('gold_block')!.id);
    expect(manager.orphanCount).toBe(0);
    db.full = false;
    await manager.flush();
    expect(db.chunks.size, 'a coluna voltou para `dirty` e foi gravada').toBe(1);
  });

  it('o anfitrião da sala serve a coluna órfã ao convidado (M20)', async () => {
    const db = fakeDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    db.full = true;
    await manager.saveAndForget(goldChunk(5, 5));
    expect(await manager.loadChunkData(0, 5, 5)).toBeInstanceOf(Uint8Array);
  });
});

describe('coluna que não abre', () => {
  it('guarda os bytes na quarentena e avisa, em vez de trocar calada pela seed', async () => {
    const db = fakeDb();
    const manager = new SaveManager(db as unknown as SaveDatabase, 'mundo');
    const garbage = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    db.chunks.set('mundo|4|-2', garbage);
    const corrupt: [number, number][] = [];
    manager.onCorrupt = (cx, cz) => corrupt.push([cx, cz]);

    expect(await manager.loadChunk(4, -2)).toBeNull();
    expect(corrupt).toEqual([[4, -2]]);
    expect(db.settings.get(quarantineKey('mundo', 4, -2))).toBe(garbage);
  });
});

describe('falta de espaço até a UI', () => {
  it('isQuotaError reconhece pelo nome, e só ele', () => {
    expect(isQuotaError(quotaError())).toBe(true);
    expect(isQuotaError(new Error('outra'))).toBe(false);
    expect(isQuotaError(null)).toBe(false);
  });

  it('o SaveGame repassa o "é cota" do saveAll e o aviso de coluna corrompida', async () => {
    const db = fakeDb();
    const world = new World(1);
    const player = new Player(0, 70, 0);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
    });
    const meta = newWorldMeta('Teste', 'x', 'survival', 2);
    const manager = new SaveManager(db as unknown as SaveDatabase, meta.id);
    const seen: boolean[] = [];
    const corrupt: number[] = [];
    new SaveGame(manager, session, player, meta, {
      onError: (_m, quota) => seen.push(quota),
      onCorrupt: (cx) => corrupt.push(cx),
    });
    db.full = true;
    await manager.saveAndForget(goldChunk(1, 1));
    db.chunks.set(`${meta.id}|9|9`, new Uint8Array([9, 9, 9]));
    await manager.loadChunk(9, 9);
    expect(seen).toEqual([true]);
    expect(corrupt).toEqual([9]);
  });
});

describe('quando abrir a tela de cota cheia (doc 11 §4)', () => {
  it('abre na primeira falta de espaço, não reabre por cima, e volta à linha de HUD depois de "continuar"', () => {
    const gate = new QuotaGate();
    expect(gate.onFailure(false), 'falha comum: linha de HUD').toBe('message');
    expect(gate.onFailure(true)).toBe('modal');
    gate.opened();
    expect(gate.onFailure(true), 'o "tentar de novo" falhando é a tela aberta').toBe('none');
    gate.skip();
    expect(gate.onFailure(true), 'sem perguntar a cada autosave').toBe('message');
    gate.saved();
    expect(gate.onFailure(true), 'um save que deu certo rearma a tela').toBe('modal');
  });

  it('sem a tela ligada (convidado, sem banco), a falha ainda chega à linha de HUD', () => {
    const shown: string[] = [];
    const alerts = saveAlerts(null, 'mundo', { showMessage: (text) => shown.push(text) });
    alerts.options.onError!('cota estourada', true);
    alerts.options.onCorrupt!(2, -1);
    expect(shown.length).toBe(2);
    expect(shown[0]).toContain('cota estourada');
    expect(shown[1]).toContain('32');
    expect(shown[1]).toContain('-16');
  });
});
