/**
 * Serialização de chunk (doc 11 §2).
 *
 * **Só chunks modificados pelo jogador são salvos** — o resto é regenerado da
 * seed, e é isso que mantém o save pequeno. Três camadas de compressão:
 *
 * 1. **Paleta** — a maioria das sections tem menos de 16 estados distintos.
 * 2. **RLE** sobre os bytes empacotados — terreno tem corridas enormes de
 *    pedra e de ar.
 * 3. **`CompressionStream('deflate-raw')`** por cima, quando existe: nativo,
 *    ~2× a mais, zero bytes de bundle.
 *
 * Resultado típico: 1–4 KB por chunk modificado.
 */

import { ChunkColumn, SECTIONS_PER_COLUMN, packedLength, type BitsPerBlock } from '../world/chunk';

export const MAGIC = 0x434c4b31; // 'CLK1'
export const FORMAT_VERSION = 1;

/** Bit 0 do byte de flags: o corpo está comprimido com deflate-raw. */
const FLAG_DEFLATED = 1;

/** Escreve inteiros de tamanho variável — economiza nos comprimentos pequenos. */
class ByteWriter {
  private buffer: Uint8Array;
  private length = 0;

  constructor(initial = 4096) {
    this.buffer = new Uint8Array(initial);
  }

  private ensure(extra: number): void {
    if (this.length + extra <= this.buffer.length) return;
    let size = this.buffer.length * 2;
    while (size < this.length + extra) size *= 2;
    const next = new Uint8Array(size);
    next.set(this.buffer.subarray(0, this.length));
    this.buffer = next;
  }

  u8(value: number): void {
    this.ensure(1);
    this.buffer[this.length++] = value & 0xff;
  }

  u16(value: number): void {
    this.ensure(2);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
  }

  i32(value: number): void {
    this.ensure(4);
    this.buffer[this.length++] = value & 0xff;
    this.buffer[this.length++] = (value >>> 8) & 0xff;
    this.buffer[this.length++] = (value >>> 16) & 0xff;
    this.buffer[this.length++] = (value >>> 24) & 0xff;
  }

  varint(value: number): void {
    let v = value >>> 0;
    while (v >= 0x80) {
      this.u8((v & 0x7f) | 0x80);
      v >>>= 7;
    }
    this.u8(v);
  }

  bytes(data: Uint8Array): void {
    this.ensure(data.length);
    this.buffer.set(data, this.length);
    this.length += data.length;
  }

  finish(): Uint8Array {
    return this.buffer.slice(0, this.length);
  }
}

class ByteReader {
  private offset = 0;
  constructor(private readonly data: Uint8Array) {}

  u8(): number {
    return this.data[this.offset++];
  }

  u16(): number {
    const v = this.data[this.offset] | (this.data[this.offset + 1] << 8);
    this.offset += 2;
    return v;
  }

  i32(): number {
    const v = this.data[this.offset] | (this.data[this.offset + 1] << 8)
      | (this.data[this.offset + 2] << 16) | (this.data[this.offset + 3] << 24);
    this.offset += 4;
    return v | 0;
  }

  varint(): number {
    let result = 0;
    let shift = 0;
    for (;;) {
      const byte = this.u8();
      result |= (byte & 0x7f) << shift;
      if ((byte & 0x80) === 0) break;
      shift += 7;
    }
    return result >>> 0;
  }

  bytes(length: number): Uint8Array {
    const slice = this.data.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  get remaining(): number {
    return this.data.length - this.offset;
  }
}

/**
 * RLE simples orientado a byte: `[contagem, valor]` para corridas de 2 ou mais,
 * `[0, quantidade, bytes...]` para trechos sem repetição.
 *
 * Terreno rende muito bem aqui — uma section de pedra maciça vira poucos bytes.
 */
export function rleEncode(data: Uint8Array): Uint8Array {
  const out = new ByteWriter(data.length);
  let i = 0;
  while (i < data.length) {
    const value = data[i];
    let run = 1;
    while (i + run < data.length && data[i + run] === value && run < 255) run++;

    if (run >= 2) {
      out.u8(run);
      out.u8(value);
      i += run;
      continue;
    }

    // Trecho literal: acumula até encontrar uma corrida que valha a pena.
    const start = i;
    let literal = 0;
    while (i < data.length && literal < 255) {
      const next = data[i];
      let ahead = 1;
      while (i + ahead < data.length && data[i + ahead] === next && ahead < 3) ahead++;
      if (ahead >= 3) break;
      i++;
      literal++;
    }
    out.u8(0);
    out.u8(literal);
    out.bytes(data.subarray(start, start + literal));
  }
  return out.finish();
}

export function rleDecode(data: Uint8Array, expectedLength: number): Uint8Array {
  const out = new Uint8Array(expectedLength);
  let read = 0;
  let write = 0;
  while (write < expectedLength && read < data.length) {
    const count = data[read++];
    if (count === 0) {
      const literal = data[read++];
      out.set(data.subarray(read, read + literal), write);
      read += literal;
      write += literal;
    } else {
      const value = data[read++];
      out.fill(value, write, write + count);
      write += count;
    }
  }
  return out;
}

/** Serializa uma coluna. Não comprime — `compressChunk` faz isso. */
export function serializeChunk(chunk: ChunkColumn): Uint8Array {
  const writer = new ByteWriter();

  // Quais sections têm dados.
  let bitmap = 0;
  for (let i = 0; i < SECTIONS_PER_COLUMN; i++) {
    if (chunk.sections[i].data !== null) bitmap |= 1 << i;
  }

  writer.i32(MAGIC);
  writer.u8(FORMAT_VERSION);
  writer.u8(SECTIONS_PER_COLUMN);
  writer.u16(bitmap);
  writer.i32(chunk.cx);
  writer.i32(chunk.cz);
  writer.u16(0); // reservado

  for (let i = 0; i < SECTIONS_PER_COLUMN; i++) {
    const section = chunk.sections[i];
    if (section.data === null) continue;

    writer.u8(section.bits);
    writer.u16(section.paletteLen);
    for (let p = 0; p < section.paletteLen; p++) writer.u16(section.palette[p]);

    const raw = section.bits === 16
      ? new Uint8Array((section.data as Uint16Array).buffer.slice(0))
      : (section.data as Uint8Array);
    const encoded = rleEncode(raw);
    writer.varint(encoded.length);
    writer.bytes(encoded);
    writer.u16(section.nonAirCount);
  }

  writer.bytes(chunk.biomeMap);
  return writer.finish();
}

/** Reconstrói a coluna. A luz é recalculada, não salva (doc 11 §2). */
export function deserializeChunk(data: Uint8Array): ChunkColumn {
  const reader = new ByteReader(data);

  const magic = reader.i32();
  if (magic !== MAGIC) throw new Error('Chunk com assinatura inválida.');
  const version = reader.u8();
  if (version > FORMAT_VERSION) {
    throw new Error(`Chunk de versão futura (${version}); atualize o jogo.`);
  }
  const sectionCount = reader.u8();
  const bitmap = reader.u16();
  const cx = reader.i32();
  const cz = reader.i32();
  reader.u16();

  const chunk = new ChunkColumn(cx, cz);
  for (let i = 0; i < sectionCount; i++) {
    if ((bitmap & (1 << i)) === 0) continue;
    const section = chunk.sections[i];

    const bits = reader.u8() as BitsPerBlock;
    const paletteLen = reader.u16();
    const palette = new Uint16Array(Math.max(4, paletteLen));
    for (let p = 0; p < paletteLen; p++) palette[p] = reader.u16();

    const encodedLength = reader.varint();
    const encoded = reader.bytes(encodedLength);
    const rawLength = bits === 16 ? 4096 * 2 : packedLength(bits);
    const raw = rleDecode(encoded, rawLength);

    section.bits = bits;
    section.paletteLen = paletteLen;
    section.palette = palette;
    section.data = bits === 16
      ? new Uint16Array(raw.buffer, raw.byteOffset, 4096)
      : raw;
    section.nonAirCount = reader.u16();
  }

  if (reader.remaining >= 256) chunk.biomeMap.set(reader.bytes(256));
  chunk.recomputeHeightMap();
  return chunk;
}

/**
 * Comprime com `deflate-raw` quando disponível. O primeiro byte é o flag,
 * então a descompressão sabe o que fazer sem consultar nada.
 */
export async function compressChunk(chunk: ChunkColumn): Promise<Uint8Array> {
  const raw = serializeChunk(chunk);
  const deflated = await deflate(raw);
  if (deflated === null) return prefix(0, raw);
  // Só vale a pena se realmente encolheu.
  if (deflated.length >= raw.length) return prefix(0, raw);
  return prefix(FLAG_DEFLATED, deflated);
}

export async function decompressChunk(data: Uint8Array): Promise<ChunkColumn> {
  const flags = data[0];
  const body = data.subarray(1);
  const raw = (flags & FLAG_DEFLATED) !== 0 ? await inflate(body) : body;
  return deserializeChunk(raw);
}

function prefix(flags: number, body: Uint8Array): Uint8Array {
  const out = new Uint8Array(body.length + 1);
  out[0] = flags;
  out.set(body, 1);
  return out;
}

/** `null` quando o navegador não tem `CompressionStream`. */
async function deflate(data: Uint8Array): Promise<Uint8Array | null> {
  const global = globalThis as { CompressionStream?: typeof CompressionStream };
  if (global.CompressionStream === undefined) return null;
  try {
    const stream = new global.CompressionStream('deflate-raw');
    return await pipeThrough(data, stream);
  } catch {
    return null;
  }
}

async function inflate(data: Uint8Array): Promise<Uint8Array> {
  const global = globalThis as { DecompressionStream?: typeof DecompressionStream };
  if (global.DecompressionStream === undefined) {
    throw new Error('Save comprimido, mas o navegador não sabe descomprimir.');
  }
  const stream = new global.DecompressionStream('deflate-raw');
  return pipeThrough(data, stream);
}

async function pipeThrough(
  data: Uint8Array, stream: { readable: ReadableStream; writable: WritableStream },
): Promise<Uint8Array> {
  const writer = stream.writable.getWriter();
  void writer.write(data);
  void writer.close();

  const reader = stream.readable.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done === true) break;
    if (value !== undefined) {
      chunks.push(value as Uint8Array);
      total += (value as Uint8Array).length;
    }
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const part of chunks) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}
