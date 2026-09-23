/**
 * Exportar e importar mundo (doc 14 — M7).
 *
 * Responde a uma pergunta que o jogador fez em 2026-09-12 e que até aqui se
 * respondia "não dá": **levar um mundo do celular para o computador**. Nada
 * neste projeto vai para um servidor (doc 11 §1), então o transporte é um
 * arquivo que o jogador guarda onde quiser.
 *
 * O formato é binário e **reaproveita o que já existe**: cada chunk entra no
 * arquivo exatamente como está no banco, já serializado e já comprimido por
 * `save/serialize.ts`. Reserializar seria pagar duas vezes por nada, e um mundo
 * de 500 chunks em JSON com base64 ficaria três vezes maior.
 *
 * O resto — meta, jogador, baús, veículos — é JSON, porque é pouco e porque
 * assim um formato novo de baú não quebra o arquivo antigo.
 *
 * ```
 *  "CRAFTLITE" (9 bytes)  u8 versão
 *  meta:      varint tamanho + JSON utf8
 *  jogadores: varint tamanho + JSON utf8
 *  varint     número de dimensões
 *    por dimensão:
 *      varint  id da dimensão
 *      varint  tamanho do JSON de baús      + bytes
 *      varint  tamanho do JSON de veículos  + bytes
 *      varint  número de chunks
 *        por chunk: i32 cx, i32 cz, varint tamanho + bytes (já comprimidos)
 *  miniatura (v2+): varint tamanho + bytes do PNG (0 = sem miniatura)
 * ```
 *
 * Este módulo é **puro** no que dá: `packArchive` e `unpackArchive` só mexem em
 * bytes, e é por isso que o formato é testável sem IndexedDB nenhum.
 */

import { regionKey, regionOfKey } from '../game/worldmap';
import { ByteReader, ByteWriter } from './serialize';
import {
  DIMENSION_COUNT, STORE_PLAYERS, STORE_SETTINGS, STORE_WORLDS, dimensionIdFor, newWorldId,
  type PlayerSave, type SaveDatabase, type WorldMeta,
} from './db';

/** Assinatura do arquivo. Nove bytes, legíveis num editor hexadecimal. */
export const MAGIC = 'CRAFTLITE';
/**
 * Versão do formato. Subir aqui obriga a tratar as anteriores em `unpack`.
 *
 * **v2** acrescenta a miniatura no **fim** do arquivo, depois das dimensões.
 * No fim de propósito: um leitor de v1 encontra tudo que conhece na mesma
 * ordem e nos mesmos offsets, e o campo novo é lido só quando a versão pede.
 */
export const ARCHIVE_VERSION = 3;
/** Primeira versão com miniatura. */
const VERSION_WITH_THUMBNAIL = 2;
/**
 * Primeira versão com itens no chão e mapa explorado (M10). Vêm **depois** da
 * miniatura, pela mesma razão dela: o leitor de v2 acha tudo no lugar.
 */
const VERSION_WITH_JOURNAL = 3;
/** Extensão sugerida ao jogador. */
export const ARCHIVE_EXTENSION = '.clw';

export interface ArchiveChunk {
  cx: number;
  cz: number;
  /** Bytes exatamente como estão no banco: já serializados e comprimidos. */
  data: Uint8Array;
}

export interface ArchiveDimension {
  dimension: number;
  chunks: ArchiveChunk[];
  tiles: unknown[];
  vehicles: unknown[];
}

export interface WorldArchive {
  version: number;
  meta: WorldMeta;
  players: PlayerSave[];
  dimensions: ArchiveDimension[];
  /** Miniatura do mundo em PNG (v2+); ausente quando o mundo não tem uma. */
  thumbnail?: Uint8Array;
  /** Itens no chão por dimensão, achatados por `ItemEntities` (v3+). */
  items?: ArchiveItems[];
  /** Regiões do mapa explorado, comprimidas por `encodeRegion` (v3+). */
  map?: ArchiveMapRegion[];
}

export interface ArchiveItems {
  dimension: number;
  items: number[];
}

export interface ArchiveMapRegion {
  rx: number;
  rz: number;
  data: Uint8Array;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/** Erro de formato, para a UI dizer ao jogador o que houve. */
export class ArchiveError extends Error {}

// --- formato ---------------------------------------------------------------

export function packArchive(archive: WorldArchive): Uint8Array {
  const writer = new ByteWriter(1 << 16);
  writer.bytes(encoder.encode(MAGIC));
  writer.u8(ARCHIVE_VERSION);
  writeJson(writer, archive.meta);
  writeJson(writer, archive.players);

  writer.varint(archive.dimensions.length);
  for (const dim of archive.dimensions) {
    writer.varint(dim.dimension);
    writeJson(writer, dim.tiles);
    writeJson(writer, dim.vehicles);
    writer.varint(dim.chunks.length);
    for (const chunk of dim.chunks) {
      writer.i32(chunk.cx);
      writer.i32(chunk.cz);
      writer.varint(chunk.data.length);
      writer.bytes(chunk.data);
    }
  }

  const thumbnail = archive.thumbnail;
  writer.varint(thumbnail?.length ?? 0);
  if (thumbnail !== undefined && thumbnail.length > 0) writer.bytes(thumbnail);

  writeJson(writer, archive.items ?? []);
  const map = archive.map ?? [];
  writer.varint(map.length);
  for (const region of map) {
    writer.i32(region.rx);
    writer.i32(region.rz);
    writer.varint(region.data.length);
    writer.bytes(region.data);
  }
  return writer.finish();
}

export function unpackArchive(data: Uint8Array): WorldArchive {
  if (data.length < MAGIC.length + 1) throw new ArchiveError('Arquivo curto demais.');
  const reader = new ByteReader(data);
  if (decoder.decode(reader.bytes(MAGIC.length)) !== MAGIC) {
    throw new ArchiveError('Este arquivo não é um mundo do CraftLite.');
  }
  const version = reader.u8();
  if (version > ARCHIVE_VERSION) {
    throw new ArchiveError(`Arquivo da versão ${version}; este jogo lê até ${ARCHIVE_VERSION}.`);
  }

  const meta = readJson<WorldMeta>(reader);
  const players = readJson<PlayerSave[]>(reader);
  const dimensions: ArchiveDimension[] = [];

  const dimCount = reader.varint();
  for (let d = 0; d < dimCount; d++) {
    const dimension = reader.varint();
    const tiles = readJson<unknown[]>(reader);
    const vehicles = readJson<unknown[]>(reader);
    const chunks: ArchiveChunk[] = [];
    const chunkCount = reader.varint();
    for (let c = 0; c < chunkCount; c++) {
      const cx = reader.i32();
      const cz = reader.i32();
      const length = reader.varint();
      if (length > reader.remaining) throw new ArchiveError('Arquivo truncado.');
      // `slice`, não `subarray`: o pedaço vai para o banco e não pode ficar
      // preso ao buffer inteiro do arquivo.
      chunks.push({ cx, cz, data: reader.bytes(length).slice() });
    }
    dimensions.push({ dimension, chunks, tiles, vehicles });
  }

  /*
   * Miniatura: só existe da v2 em diante. Ler incondicionalmente faria um
   * arquivo v1 — que acaba exatamente aqui — estourar em "truncado".
   */
  const archive: WorldArchive = { version, meta, players, dimensions };
  if (version < VERSION_WITH_THUMBNAIL || reader.remaining === 0) return archive;
  const thumbLength = reader.varint();
  if (thumbLength > reader.remaining) throw new ArchiveError('Arquivo truncado.');
  if (thumbLength > 0) archive.thumbnail = reader.bytes(thumbLength).slice();

  if (version < VERSION_WITH_JOURNAL || reader.remaining === 0) return archive;
  archive.items = readJson<ArchiveItems[]>(reader);
  const regions: ArchiveMapRegion[] = [];
  const regionCount = reader.varint();
  for (let r = 0; r < regionCount; r++) {
    const rx = reader.i32();
    const rz = reader.i32();
    const length = reader.varint();
    if (length > reader.remaining) throw new ArchiveError('Arquivo truncado.');
    regions.push({ rx, rz, data: reader.bytes(length).slice() });
  }
  archive.map = regions;
  return archive;
}

function writeJson(writer: ByteWriter, value: unknown): void {
  const bytes = encoder.encode(JSON.stringify(value ?? null));
  writer.varint(bytes.length);
  writer.bytes(bytes);
}

function readJson<T>(reader: ByteReader): T {
  const length = reader.varint();
  if (length > reader.remaining) throw new ArchiveError('Arquivo truncado.');
  try {
    return JSON.parse(decoder.decode(reader.bytes(length))) as T;
  } catch {
    throw new ArchiveError('Arquivo corrompido.');
  }
}

// --- banco -----------------------------------------------------------------

/**
 * Lê um mundo inteiro do banco, com todas as dimensões.
 *
 * Dimensão vazia não entra no arquivo: quem nunca abriu um portal não carrega
 * um Nether vazio junto.
 */
export async function exportWorld(db: SaveDatabase, worldId: string): Promise<Uint8Array> {
  const metas = await db.getAll<WorldMeta>(STORE_WORLDS);
  const meta = metas.find((m) => m.id === worldId);
  if (meta === undefined) throw new ArchiveError('Mundo não encontrado.');

  const allPlayers = await db.getAll<PlayerSave>(STORE_PLAYERS);
  const players = allPlayers.filter((p) => p.worldId === worldId);

  const dimensions: ArchiveDimension[] = [];
  const items: ArchiveItems[] = [];
  for (let dimension = 0; dimension < DIMENSION_COUNT; dimension++) {
    const id = dimensionIdFor(worldId, dimension);
    const floor = (await db.get<number[]>(STORE_SETTINGS, `${id}.items`)) ?? [];
    if (floor.length > 0) items.push({ dimension, items: floor });
    const chunks = await db.allChunks(id);
    const tiles = (await db.get<unknown[]>(STORE_SETTINGS, `${id}.tiles`)) ?? [];
    const vehicles = (await db.get<unknown[]>(STORE_SETTINGS, `${id}.vehicles`)) ?? [];
    if (chunks.length === 0 && tiles.length === 0 && vehicles.length === 0) continue;
    dimensions.push({ dimension, chunks, tiles, vehicles });
  }

  const map: ArchiveMapRegion[] = [];
  for (const key of (await db.get<number[]>(STORE_SETTINGS, `${worldId}.map`)) ?? []) {
    const data = await db.get<Uint8Array>(STORE_SETTINGS, `${worldId}.map.${key}`);
    if (data === undefined) continue;
    const [rx, rz] = regionOfKey(key);
    map.push({ rx, rz, data });
  }

  const thumbnail = await db.loadThumbnail(worldId);
  return packArchive({
    version: ARCHIVE_VERSION, meta, players, dimensions, items, map,
    ...(thumbnail !== undefined ? { thumbnail } : {}),
  });
}

/**
 * Grava um arquivo como mundo novo e devolve a meta gravada.
 *
 * **O mundo importado sempre ganha um id novo.** Reaproveitar o do arquivo
 * sobrescreveria em silêncio um mundo de mesmo nome que o jogador já tem — o
 * pior resultado possível para uma função cujo ponto é não perder nada. O nome
 * ganha um sufixo quando já existe outro igual, pelo mesmo motivo.
 */
export async function importWorld(db: SaveDatabase, data: Uint8Array): Promise<WorldMeta> {
  const archive = unpackArchive(data);
  const existing = await db.getAll<WorldMeta>(STORE_WORLDS);

  const meta: WorldMeta = {
    ...archive.meta,
    id: newWorldId(),
    name: uniqueName(archive.meta.name, existing.map((m) => m.name)),
    lastPlayed: Date.now(),
  };

  for (const dim of archive.dimensions) {
    const id = dimensionIdFor(meta.id, dim.dimension);
    if (dim.chunks.length > 0) {
      await db.putChunks(id, dim.chunks.map((c) => [c.cx, c.cz, c.data] as [number, number, Uint8Array]));
    }
    if (dim.tiles.length > 0) await db.put(STORE_SETTINGS, dim.tiles, `${id}.tiles`);
    if (dim.vehicles.length > 0) await db.put(STORE_SETTINGS, dim.vehicles, `${id}.vehicles`);
  }

  for (const floor of archive.items ?? []) {
    await db.put(STORE_SETTINGS, floor.items, `${dimensionIdFor(meta.id, floor.dimension)}.items`);
  }
  if (archive.map !== undefined && archive.map.length > 0) {
    const index: number[] = [];
    for (const region of archive.map) {
      const key = regionKey(region.rx, region.rz);
      await db.put(STORE_SETTINGS, region.data, `${meta.id}.map.${key}`);
      index.push(key);
    }
    await db.put(STORE_SETTINGS, index, `${meta.id}.map`);
  }

  for (const player of archive.players) {
    await db.put(STORE_PLAYERS, { ...player, worldId: meta.id }, [meta.id, player.playerId]);
  }
  // A miniatura viaja junto: sem ela, o mundo importado abriria a lista com o
  // quadro vazio até o jogador entrar nele e salvar uma vez.
  if (archive.thumbnail !== undefined && archive.thumbnail.length > 0) {
    await db.saveThumbnail(meta.id, archive.thumbnail);
  }
  await db.put(STORE_WORLDS, meta);
  return meta;
}

/** `Casa` → `Casa (2)` quando já existe. Determinístico e sem surpresa. */
export function uniqueName(name: string, taken: readonly string[]): string {
  if (!taken.includes(name)) return name;
  for (let n = 2; n < 1000; n++) {
    const candidate = `${name} (${n})`;
    if (!taken.includes(candidate)) return candidate;
  }
  return `${name} (${Date.now()})`;
}

/** Nome de arquivo sugerido para um mundo. Sem caractere que atrapalhe. */
export function archiveFileName(name: string): string {
  const clean = name.replace(/[^\p{L}\p{N} _-]/gu, '').trim().replace(/\s+/g, '-');
  return `${clean.length > 0 ? clean : 'mundo'}${ARCHIVE_EXTENSION}`;
}
