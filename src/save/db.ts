/**
 * IndexedDB via wrapper próprio (doc 01 §1: sem `idb`/`dexie`).
 *
 * `localStorage` não serve: tem ~5 MB e é síncrono, então travaria o frame.
 * A OPFS seria mais rápida mas não existe no Android 7, que é o alvo.
 *
 * Toda a API é `Promise`, e nenhuma escrita acontece dentro do frame — quem
 * chama agenda pelo `SaveManager`.
 */

export const DB_NAME = 'craftlite';
export const DB_VERSION = 1;

export const STORE_WORLDS = 'worlds';
export const STORE_CHUNKS = 'chunks';
export const STORE_PLAYERS = 'players';
export const STORE_SETTINGS = 'settings';
export const STORE_THUMBS = 'thumbs';

/**
 * Quantas dimensões o apagamento de mundo varre.
 *
 * É um teto, não a contagem real: `data/dimensions.ts` é a fonte da verdade, e
 * varrer alguns prefixos a mais num `delete` custa nada. Importa que nunca seja
 * **menor** que o número de dimensões, senão apagar um mundo deixa lixo.
 */
const MAX_DIMENSIONS = 8;

export interface WorldMeta {
  id: string;
  name: string;
  /** Texto original digitado pelo jogador. */
  seed: string;
  seedHash: number;
  version: number;
  worldHeight: number;
  gameMode: 'survival' | 'creative';
  difficulty: 0 | 1 | 2 | 3;
  time: number;
  totalTicks: number;
  spawn: [number, number, number];
  createdAt: number;
  lastPlayed: number;
  sizeBytes: number;
}

export interface PlayerSave {
  worldId: string;
  playerId: string;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  health: number;
  hunger: number;
  saturation: number;
  selected: number;
  /** Inventário serializado como triplas [item, count, damage]. */
  inventory: number[];
  /**
   * Encantamentos, um inteiro por slot, na mesma ordem do inventário (M6).
   *
   * Array **paralelo** em vez de um quarto número nas triplas: save de mundo
   * antigo não tem o campo, e `undefined` vira 0 sem precisar de versão nova
   * nem de migração.
   */
  enchants?: number[];
  /**
   * Dimensão em que o jogador estava (M7). Ausente = superfície, que é o que
   * todo save anterior ao M7 significa — sem migração.
   */
  dimension?: number;
  /** Experiência total acumulada (doc 06 §8). */
  xp?: number;
  /** Conquistas como máscara de bits (doc 08 §3.4). Ausente = nenhuma. */
  achievements?: number;
  /** Ponto de renascimento definido pela cama, se houver. */
  bedSpawn?: [number, number, number];
  /**
   * Quando este registro foi escrito (`Date.now()`).
   *
   * Existe para desempatar o registro do IndexedDB com o de emergência do
   * `localStorage`: eles são escritos em momentos diferentes e qualquer um dos
   * dois pode ser o mais recente. Save antigo não tem o campo e vale 0, que
   * perde para qualquer registro novo — sem migração.
   */
  savedAt?: number;
}

/** true se o navegador tem IndexedDB utilizável (modo privado pode não ter). */
export function isAvailable(): boolean {
  try {
    return typeof indexedDB !== 'undefined' && indexedDB !== null;
  } catch {
    return false;
  }
}

export class SaveDatabase {
  private db: IDBDatabase | null = null;
  private opening: Promise<IDBDatabase> | null = null;

  /** Abre (e migra) o banco. Chamadas concorrentes compartilham a promessa. */
  open(): Promise<IDBDatabase> {
    if (this.db !== null) return Promise.resolve(this.db);
    if (this.opening !== null) return this.opening;

    this.opening = new Promise<IDBDatabase>((resolve, reject) => {
      if (!isAvailable()) {
        reject(new Error('IndexedDB indisponível neste navegador.'));
        return;
      }
      const request = indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = () => {
        const db = request.result;
        // A cadeia de migração vive aqui (doc 11 §6). Hoje só existe a v1.
        if (!db.objectStoreNames.contains(STORE_WORLDS)) {
          db.createObjectStore(STORE_WORLDS, { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains(STORE_CHUNKS)) {
          db.createObjectStore(STORE_CHUNKS);
        }
        if (!db.objectStoreNames.contains(STORE_PLAYERS)) {
          db.createObjectStore(STORE_PLAYERS);
        }
        if (!db.objectStoreNames.contains(STORE_SETTINGS)) {
          db.createObjectStore(STORE_SETTINGS);
        }
        if (!db.objectStoreNames.contains(STORE_THUMBS)) {
          db.createObjectStore(STORE_THUMBS);
        }
      };

      request.onsuccess = () => {
        this.db = request.result;
        // A aba perde o banco se outra aba pedir upgrade; fechar evita erro feio.
        this.db.onversionchange = () => this.close();
        resolve(this.db);
      };
      request.onerror = () => reject(request.error ?? new Error('Falha ao abrir o banco.'));
    });

    return this.opening;
  }

  close(): void {
    this.db?.close();
    this.db = null;
    this.opening = null;
  }

  async get<T>(store: string, key: IDBValidKey): Promise<T | undefined> {
    const db = await this.open();
    return wrap<T | undefined>(db.transaction(store, 'readonly').objectStore(store).get(key));
  }

  async put(store: string, value: unknown, key?: IDBValidKey): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    if (key === undefined) tx.objectStore(store).put(value);
    else tx.objectStore(store).put(value, key);
    await done(tx);
  }

  async delete(store: string, key: IDBValidKey): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).delete(key);
    await done(tx);
  }

  async getAll<T>(store: string): Promise<T[]> {
    const db = await this.open();
    return wrap<T[]>(db.transaction(store, 'readonly').objectStore(store).getAll());
  }

  /**
   * Grava vários chunks numa transação só (doc 11 §3). Uma transação por chunk
   * seria ordens de grandeza mais lenta e ainda arriscaria save parcial.
   */
  async putChunks(worldId: string, entries: readonly [number, number, Uint8Array][]): Promise<void> {
    if (entries.length === 0) return;
    const db = await this.open();
    const tx = db.transaction(STORE_CHUNKS, 'readwrite');
    const store = tx.objectStore(STORE_CHUNKS);
    for (const [cx, cz, data] of entries) store.put(data, chunkKeyFor(worldId, cx, cz));
    await done(tx);
  }

  async getChunk(worldId: string, cx: number, cz: number): Promise<Uint8Array | undefined> {
    return this.get<Uint8Array>(STORE_CHUNKS, chunkKeyFor(worldId, cx, cz));
  }

  /**
   * Todos os chunks gravados de uma dimensão (M7: exportar mundo).
   *
   * Usa a faixa de chaves `[dimId] .. [dimId, []]`, a mesma que `deleteWorld`
   * usa para apagar — é o que o IndexedDB oferece de busca por prefixo sobre
   * chave composta. A coordenada volta da própria chave, então nada precisa
   * decodificar o chunk para saber onde ele fica.
   */
  async allChunks(dimensionId: string): Promise<{ cx: number; cz: number; data: Uint8Array }[]> {
    const db = await this.open();
    const store = db.transaction(STORE_CHUNKS, 'readonly').objectStore(STORE_CHUNKS);
    const range = IDBKeyRange.bound([dimensionId], [dimensionId, []], false, false);
    const keys = await wrap<IDBValidKey[]>(store.getAllKeys(range));
    const values = await wrap<Uint8Array[]>(store.getAll(range));

    const out: { cx: number; cz: number; data: Uint8Array }[] = [];
    for (let i = 0; i < keys.length; i++) {
      const key = keys[i] as [string, number, number];
      out.push({ cx: key[1], cz: key[2], data: values[i] });
    }
    return out;
  }

  /** Apaga o mundo e tudo que pertence a ele. */
  async deleteWorld(worldId: string): Promise<void> {
    const db = await this.open();
    const tx = db.transaction(
      [STORE_WORLDS, STORE_CHUNKS, STORE_PLAYERS, STORE_THUMBS], 'readwrite',
    );
    tx.objectStore(STORE_WORLDS).delete(worldId);
    tx.objectStore(STORE_THUMBS).delete(worldId);
    // Chunks e jogadores usam chave composta por prefixo do worldId. As outras
    // dimensões têm prefixo próprio (`dimensionIdFor`) e saem junto — deixar o
    // Nether para trás vazaria um mundo inteiro no banco a cada apagamento.
    deleteByPrefix(tx.objectStore(STORE_CHUNKS), worldId);
    for (let dim = 1; dim < MAX_DIMENSIONS; dim++) {
      deleteByPrefix(tx.objectStore(STORE_CHUNKS), dimensionIdFor(worldId, dim));
    }
    deleteByPrefix(tx.objectStore(STORE_PLAYERS), worldId);
    await done(tx);
  }

  /** Uso e cota do armazenamento (doc 11 §4). */
  async estimate(): Promise<{ usage: number; quota: number } | null> {
    if (navigator.storage?.estimate === undefined) return null;
    try {
      const { usage, quota } = await navigator.storage.estimate();
      return { usage: usage ?? 0, quota: quota ?? 0 };
    } catch {
      return null;
    }
  }

  /** Pede armazenamento persistente, para o navegador não limpar sozinho. */
  async requestPersistence(): Promise<boolean> {
    if (navigator.storage?.persist === undefined) return false;
    try {
      return await navigator.storage.persist();
    } catch {
      return false;
    }
  }
}

/**
 * Identificador de armazenamento de uma dimensão do mundo (M7).
 *
 * O Overworld **continua sendo o `worldId` puro** — mundo salvo antes do M7
 * abre sem migração nenhuma. As outras dimensões ganham sufixo, e
 * `deleteWorld` apaga todas elas.
 */
export function dimensionIdFor(worldId: string, dimension: number): string {
  return dimension === 0 ? worldId : `${worldId}#${dimension}`;
}

/** Chave de chunk: `[dimensionId, cx, cz]` como array, que o IndexedDB ordena bem. */
export function chunkKeyFor(worldId: string, cx: number, cz: number): IDBValidKey {
  return [worldId, cx, cz];
}

export function playerKeyFor(worldId: string, playerId: string): IDBValidKey {
  return [worldId, playerId];
}

/** Quantas dimensões um mundo pode ter, para quem precisa varrer todas. */
export const DIMENSION_COUNT = MAX_DIMENSIONS;

function deleteByPrefix(store: IDBObjectStore, prefix: string): void {
  // IDBKeyRange sobre array: tudo que começa com o worldId.
  const range = IDBKeyRange.bound([prefix], [prefix, []], false, false);
  store.delete(range);
}

function wrap<T>(request: IDBRequest): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result as T);
    request.onerror = () => reject(request.error ?? new Error('Erro no IndexedDB.'));
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise<void>((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('Transação falhou.'));
    tx.onabort = () => reject(tx.error ?? new Error('Transação abortada.'));
  });
}

/** Gera um id de mundo. `crypto.randomUUID` não existe em WebView antigo. */
export function newWorldId(): string {
  const uuid = (crypto as Crypto & { randomUUID?: () => string }).randomUUID;
  if (uuid !== undefined) return uuid.call(crypto);
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}
