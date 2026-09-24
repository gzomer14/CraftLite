/**
 * Orquestra o salvamento (doc 11 §3).
 *
 * Três regras que vieram do doc e que decidem o design:
 *
 * 1. **Escrita fora do frame** — `requestIdleCallback`, no máximo 8 chunks por
 *    lote, para não segurar a transação nem estourar o orçamento.
 * 2. **Autosave a cada 60 s** e ao sair.
 * 3. **Rede de segurança em `localStorage`** para posição e inventário: o
 *    IndexedDB é assíncrono e `beforeunload` não espera por ele.
 */

import { ChunkColumn } from '../world/chunk';
import { compressChunk, decompressChunk } from './serialize';
import {
  SaveDatabase, STORE_PLAYERS, STORE_SETTINGS, STORE_WORLDS, dimensionIdFor, playerKeyFor,
  type PlayerSave, type WorldMeta,
} from './db';

/** Ticks entre autosaves: 60 s a 20 Hz. */
export const AUTOSAVE_TICKS = 1200;
/** Chunks por lote — o doc pede no máximo 8. */
const CHUNKS_PER_BATCH = 8;
const LOCAL_KEY_PREFIX = 'craftlite.emergency.';

export interface SaveStats {
  /** Chunks esperando gravação. */
  pending: number;
  /** Timestamp do último autosave concluído. */
  lastSaveAt: number;
  saving: boolean;
  /** Última falha, para a UI avisar. */
  lastError: string | null;
}

export class SaveManager {
  private readonly db: SaveDatabase;
  private readonly worldId: string;
  /**
   * Dimensão cujos chunks estão sendo gravados (M7).
   *
   * Jogador, meta e tile entities continuam por mundo; só o chunk tem chave por
   * dimensão, porque só ele existe duas vezes.
   */
  private dimension = 0;
  /** Chunks sujos aguardando gravação, por chave. */
  private readonly dirty = new Map<number, ChunkColumn>();
  private ticksSinceSave = 0;
  /**
   * Gravação em andamento, ou `null`.
   *
   * É a **promessa**, não um booleano: quem chama `flush` durante outra
   * gravação precisa poder esperar por ela. Ver o comentário de `flush`.
   */
  private flushing: Promise<void> | null = null;

  readonly stats: SaveStats = { pending: 0, lastSaveAt: 0, saving: false, lastError: null };

  /**
   * Avisado quando uma gravação falha.
   *
   * `flush` e `saveAndForget` engolem a exceção para não derrubar o frame, e
   * escreviam só em `stats.lastError` — que **nada no código lia**. O grosso do
   * save é chunk, então estourar a cota parava de gravar o mundo construído em
   * silêncio absoluto (doc 11 §4 pede o oposto). Quem liga isto é o `SaveGame`.
   */
  onError: ((message: string) => void) | null = null;

  constructor(db: SaveDatabase, worldId: string) {
    this.db = db;
    this.worldId = worldId;
  }

  /**
   * Troca a dimensão dos chunks. **Grava o que estiver pendente antes**: os
   * chunks sujos da fila são do lado que está sendo deixado, e escrevê-los com
   * a chave nova os perderia dos dois lados.
   */
  async setDimension(dimension: number): Promise<void> {
    if (dimension === this.dimension) return;
    // Duas vezes de propósito: a primeira espera a gravação que já estava em
    // curso, a segunda leva o que foi sujado enquanto ela rodava (as colunas
    // que o `pipeline.setDimension` acabou de descarregar, por exemplo).
    await this.flush();
    await this.flush();
    this.dimension = dimension;
  }

  /** Id de armazenamento dos chunks da dimensão atual. */
  private get chunkStoreId(): string {
    return dimensionIdFor(this.worldId, this.dimension);
  }

  /** Marca uma coluna para gravação. Chamado por quem observa `modified`. */
  markDirty(chunk: ChunkColumn): void {
    if (!chunk.modified) return;
    this.dirty.set(chunkKey(chunk.cx, chunk.cz), chunk);
    this.stats.pending = this.dirty.size;
  }

  /** Um tick: conta para o autosave. */
  tick(): void {
    this.ticksSinceSave++;
    if (this.ticksSinceSave >= AUTOSAVE_TICKS) {
      this.ticksSinceSave = 0;
      void this.flush();
    }
  }

  /**
   * Grava tudo que está sujo, em lotes, fora do frame.
   *
   * Chamada concorrente **espera** a gravação em curso em vez de voltar na
   * hora. Voltar na hora custou caro: `setDimension` faz `await this.flush()`
   * justamente para gravar as colunas que estão saindo **com a chave antiga**,
   * e se um autosave já estivesse rodando esse `await` não esperava nada — a
   * dimensão virava no meio, e o lote em voo ia para o disco com a chave
   * **nova**. Chunk do Nether gravado como chunk da superfície: ao voltar para
   * lá, o mundo tinha uma coluna de netherrack no meio da grama (relato de
   * campo 2026-09-13).
   */
  flush(): Promise<void> {
    if (this.flushing !== null) return this.flushing;
    if (this.dirty.size === 0) return Promise.resolve();
    this.flushing = this.runFlush().finally(() => { this.flushing = null; });
    return this.flushing;
  }

  private async runFlush(): Promise<void> {
    this.stats.saving = true;
    this.stats.lastError = null;
    // Uma vez só, antes de qualquer `await`: a dimensão não pode mudar no meio
    // de uma gravação, e ler a chave a cada lote deixaria isso possível.
    const storeId = this.chunkStoreId;

    try {
      while (this.dirty.size > 0) {
        const batch: [number, number, Uint8Array][] = [];
        const keys: number[] = [];

        for (const [key, chunk] of this.dirty) {
          batch.push([chunk.cx, chunk.cz, await compressChunk(chunk)]);
          keys.push(key);
          if (batch.length >= CHUNKS_PER_BATCH) break;
        }

        await this.db.putChunks(storeId, batch);
        for (const key of keys) this.dirty.delete(key);
        this.stats.pending = this.dirty.size;

        // Devolve o controle ao navegador entre lotes.
        if (this.dirty.size > 0) await idle();
      }
      this.stats.lastSaveAt = Date.now();
    } catch (error) {
      this.reportError(error);
    } finally {
      this.stats.saving = false;
    }
  }

  /**
   * Grava uma coluna que está sendo descarregada e já era modificada.
   *
   * A chave é capturada **antes** do `await` de compressão, pela mesma razão do
   * `flush`: quem descarrega é o `pipeline.setDimension`, e a dimensão vira
   * logo depois. Depender da ordem de avaliação dos argumentos para isso dar
   * certo seria correto por acidente.
   */
  async saveAndForget(chunk: ChunkColumn): Promise<void> {
    if (!chunk.modified) return;
    this.dirty.delete(chunkKey(chunk.cx, chunk.cz));
    const storeId = this.chunkStoreId;
    try {
      await this.db.putChunks(storeId, [[chunk.cx, chunk.cz, await compressChunk(chunk)]]);
    } catch (error) {
      this.reportError(error);
    }
  }

  /** Guarda e propaga a falha: o jogador precisa saber que parou de salvar. */
  private reportError(error: unknown): void {
    const message = error instanceof Error ? error.message : String(error);
    this.stats.lastError = message;
    this.onError?.(message);
  }

  /** Carrega uma coluna salva, ou `null` se nunca foi modificada. */
  async loadChunk(cx: number, cz: number): Promise<ChunkColumn | null> {
    try {
      const data = await this.db.getChunk(this.chunkStoreId, cx, cz);
      if (data === undefined) return null;
      const chunk = await decompressChunk(data);
      chunk.modified = true; // veio do disco: continua sendo responsabilidade do save
      return chunk;
    } catch {
      // Chunk corrompido: melhor regenerar da seed que travar o mundo.
      return null;
    }
  }

  async saveWorldMeta(meta: WorldMeta): Promise<void> {
    meta.lastPlayed = Date.now();
    await this.db.put(STORE_WORLDS, meta);
  }

  /**
   * Mede o mundo no banco e grava o número na meta (doc 11 §5).
   *
   * `sizeBytes` nascia 0 e ficava 0 para sempre: a tela de seleção mostrava
   * "—" em todo mundo, e não havia como o jogador saber qual apagar quando o
   * aviso de cota do doc 11 §4 aparecesse. A medição é uma varredura, então
   * acontece junto do `saveAll` e não a cada autosave de chunk.
   *
   * Falhar aqui não pode derrubar o salvamento: o tamanho é informação, o
   * mundo é o dado.
   */
  async measureWorld(meta: WorldMeta): Promise<void> {
    try {
      meta.sizeBytes = await this.db.worldSize(this.worldId);
    } catch {
      // Banco ocupado ou indisponível: fica com o número anterior.
    }
  }

  /** Grava a miniatura do mundo (PNG). Falha em silêncio: é enfeite. */
  async saveThumbnail(png: Uint8Array): Promise<void> {
    try {
      await this.db.saveThumbnail(this.worldId, png);
    } catch {
      // Sem miniatura a tela de seleção mostra o quadro vazio de sempre.
    }
  }

  async savePlayer(player: PlayerSave): Promise<void> {
    await this.db.put(STORE_PLAYERS, player, playerKeyFor(this.worldId, player.playerId));
    this.writeEmergency(player);
  }

  /**
   * Tile entities do mundo (baús e fornalhas com conteúdo).
   *
   * Ficam num registro só, fora dos chunks: são poucas dezenas por mundo e
   * embuti-las no formato de chunk obrigaria a subir a versão do save por uma
   * coisa que cabe em um `put`.
   */
  /**
   * Tile entities da **dimensão atual**.
   *
   * A chave é a de dimensão, não a do mundo: baú no Nether e baú na superfície
   * são listas diferentes. Com a chave única de antes, atravessar o portal
   * gravava a lista do Nether por cima da da superfície e o conteúdo de todo
   * baú de casa sumia (bug do M7, corrigido antes de sair).
   *
   * Para a superfície `dimensionIdFor` devolve o `worldId` puro, então mundo
   * salvo antes do M7 continua abrindo sem migração.
   */
  async saveTiles(tiles: readonly unknown[]): Promise<void> {
    await this.db.put(STORE_SETTINGS, tiles, `${this.chunkStoreId}.tiles`);
  }

  async loadTiles<T>(): Promise<T[]> {
    const stored = await this.db.get<T[]>(STORE_SETTINGS, `${this.chunkStoreId}.tiles`);
    return stored ?? [];
  }

  /** Veículos da dimensão atual — barco e carrinho (M7). Mesma regra de chave. */
  async saveVehicles(vehicles: readonly unknown[]): Promise<void> {
    await this.db.put(STORE_SETTINGS, vehicles, `${this.chunkStoreId}.vehicles`);
  }

  async loadVehicles<T>(): Promise<T[]> {
    const stored = await this.db.get<T[]>(STORE_SETTINGS, `${this.chunkStoreId}.vehicles`);
    return stored ?? [];
  }

  /**
   * Itens no chão da dimensão atual (M10), achatados por `ItemEntities`.
   * Mesma regra de chave dos veículos: o monte da morte no Nether não aparece
   * na superfície.
   */
  /** Itens no chão: números por item e, no fim, os nomes (M15, ver `ItemEntities`). */
  async saveItems(items: readonly (number | string)[]): Promise<void> {
    await this.db.put(STORE_SETTINGS, items, `${this.chunkStoreId}.items`);
  }

  async loadItems(): Promise<(number | string)[]> {
    const stored = await this.db.get<(number | string)[]>(STORE_SETTINGS, `${this.chunkStoreId}.items`);
    return stored ?? [];
  }

  /**
   * Mapa explorado (M10): um registro por região, mais um índice com as chaves
   * de todas. Só a superfície tem mapa, então a chave é a do mundo.
   *
   * Por região, e não num registro só: o mapa pode chegar a 2 MB, e regravar
   * tudo a cada autosave por causa de uma região mudada seria o save inteiro
   * do mundo de novo. O índice existe para carregar sem busca por prefixo.
   */
  async saveMapRegions(
    changed: readonly (readonly [number, Uint8Array])[], forgotten: readonly number[],
    index: readonly number[],
  ): Promise<void> {
    for (const [key, bytes] of changed) {
      await this.db.put(STORE_SETTINGS, bytes, `${this.worldId}.map.${key}`);
    }
    for (const key of forgotten) await this.db.delete(STORE_SETTINGS, `${this.worldId}.map.${key}`);
    await this.db.put(STORE_SETTINGS, [...index], `${this.worldId}.map`);
  }

  async loadMapRegions(): Promise<[number, Uint8Array][]> {
    const index = await this.db.get<number[]>(STORE_SETTINGS, `${this.worldId}.map`);
    const out: [number, Uint8Array][] = [];
    for (const key of index ?? []) {
      const bytes = await this.db.get<Uint8Array>(STORE_SETTINGS, `${this.worldId}.map.${key}`);
      if (bytes !== undefined) out.push([key, bytes]);
    }
    return out;
  }

  /**
   * O registro do jogador, **o mais recente dos dois**.
   *
   * Antes o do IndexedDB vencia sempre e o de emergência era só o plano B para
   * quando ele não existisse. Mas os dois são escritos em momentos diferentes —
   * o do banco em `saveAll`, o de emergência ao sair da página — e fechar a aba
   * depois de jogar deixava o de emergência **mais novo**, com a posição e o
   * inventário atuais, enquanto o jogo carregava o do banco, parado na última
   * saída limpa. O jogador voltava para onde tinha saído da vez anterior.
   */
  async loadPlayer(playerId: string): Promise<PlayerSave | undefined> {
    const stored = await this.db.get<PlayerSave>(
      STORE_PLAYERS, playerKeyFor(this.worldId, playerId),
    );
    const emergency = this.readEmergency(playerId);
    if (stored === undefined) return emergency;
    if (emergency === undefined) return stored;
    return (emergency.savedAt ?? 0) > (stored.savedAt ?? 0) ? emergency : stored;
  }

  /**
   * Rede de segurança síncrona (doc 11 §3): `beforeunload` não espera o
   * IndexedDB, mas `localStorage` grava na hora. É pequeno o bastante para caber.
   */
  writeEmergency(player: PlayerSave): void {
    try {
      player.savedAt = Date.now();
      localStorage.setItem(
        LOCAL_KEY_PREFIX + this.worldId + '.' + player.playerId,
        JSON.stringify(player),
      );
    } catch {
      // Cota ou modo privado: seguir sem a rede de segurança.
    }
  }

  private readEmergency(playerId: string): PlayerSave | undefined {
    try {
      const raw = localStorage.getItem(LOCAL_KEY_PREFIX + this.worldId + '.' + playerId);
      if (raw === null) return undefined;
      return JSON.parse(raw) as PlayerSave;
    } catch {
      return undefined;
    }
  }

  clearEmergency(playerId: string): void {
    try {
      localStorage.removeItem(LOCAL_KEY_PREFIX + this.worldId + '.' + playerId);
    } catch {
      // nada a fazer
    }
  }
}

function chunkKey(cx: number, cz: number): number {
  return (cx & 0x3fffff) * 0x400000 + (cz & 0x3fffff);
}

/** `requestIdleCallback` com fallback — Safari antigo não tem. */
function idle(): Promise<void> {
  return new Promise<void>((resolve) => {
    const ric = (globalThis as { requestIdleCallback?: (cb: () => void) => number })
      .requestIdleCallback;
    if (ric !== undefined) ric(() => resolve());
    else setTimeout(resolve, 0);
  });
}
