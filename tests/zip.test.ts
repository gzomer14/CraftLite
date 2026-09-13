/**
 * Leitor de ZIP (M7 — resource pack).
 *
 * Os zips do teste são montados aqui, byte a byte, porque o projeto não tem
 * dependência de runtime nem arquivo binário no repositório (doc 13 §1). O
 * ajudante escreve os dois modos que o leitor aceita — guardado e deflate —,
 * e é o mesmo layout que qualquer compactador gera.
 */
import { describe, expect, it } from 'vitest';
import { ZipError, readZip } from '../src/core/zip';

const encoder = new TextEncoder();
const decoder = new TextDecoder();

interface Entry {
  name: string;
  data: Uint8Array;
  /** 0 = guardado, 8 = deflate. */
  method: number;
  /** Bytes efetivamente gravados (comprimidos, quando for o caso). */
  stored: Uint8Array;
}

async function deflateRaw(data: Uint8Array): Promise<Uint8Array> {
  const stream = new CompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();
  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { value, done } = await reader.read();
    if (done === true) break;
    if (value !== undefined) { parts.push(value); total += value.length; }
  }
  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}

async function entry(name: string, text: string, method = 0): Promise<Entry> {
  const data = encoder.encode(text);
  const stored = method === 8 ? await deflateRaw(data) : data;
  return { name, data, method, stored };
}

/** Monta um zip válido a partir das entradas. */
function buildZip(entries: readonly Entry[], options: { flags?: number } = {}): Uint8Array {
  const parts: Uint8Array[] = [];
  const offsets: number[] = [];
  let at = 0;

  for (const e of entries) {
    const name = encoder.encode(e.name);
    const header = new Uint8Array(30 + name.length);
    const view = new DataView(header.buffer);
    view.setUint32(0, 0x04034b50, true);
    view.setUint16(6, options.flags ?? 0, true);
    view.setUint16(8, e.method, true);
    view.setUint32(18, e.stored.length, true);
    view.setUint32(22, e.data.length, true);
    view.setUint16(26, name.length, true);
    header.set(name, 30);
    offsets.push(at);
    parts.push(header, e.stored);
    at += header.length + e.stored.length;
  }

  const directoryAt = at;
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    const name = encoder.encode(e.name);
    const central = new Uint8Array(46 + name.length);
    const view = new DataView(central.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(8, options.flags ?? 0, true);
    view.setUint16(10, e.method, true);
    view.setUint32(20, e.stored.length, true);
    view.setUint32(24, e.data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offsets[i], true);
    central.set(name, 46);
    parts.push(central);
    at += central.length;
  }

  const end = new Uint8Array(22);
  const endView = new DataView(end.buffer);
  endView.setUint32(0, 0x06054b50, true);
  endView.setUint16(8, entries.length, true);
  endView.setUint16(10, entries.length, true);
  endView.setUint32(12, at - directoryAt, true);
  endView.setUint32(16, directoryAt, true);
  parts.push(end);

  const total = parts.reduce((sum, p) => sum + p.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const part of parts) { out.set(part, cursor); cursor += part.length; }
  return out;
}

const textOf = (files: Map<string, Uint8Array>, name: string): string =>
  decoder.decode(files.get(name));

describe('leitura', () => {
  it('lê um arquivo guardado sem compressão', async () => {
    const zip = buildZip([await entry('block/stone.png', 'pedra')]);
    const files = await readZip(zip);
    expect(files.size).toBe(1);
    expect(textOf(files, 'block/stone.png')).toBe('pedra');
  });

  it('lê um arquivo comprimido com deflate', async () => {
    const long = 'areia '.repeat(200);
    const e = await entry('block/sand.png', long, 8);
    // Só vale como teste se o deflate realmente encolheu.
    expect(e.stored.length).toBeLessThan(e.data.length);
    const files = await readZip(buildZip([e]));
    expect(textOf(files, 'block/sand.png')).toBe(long);
  });

  it('lê vários arquivos e mantém a ordem do diretório', async () => {
    const files = await readZip(buildZip([
      await entry('a.png', 'um'),
      await entry('b.png', 'dois', 8),
      await entry('c.png', 'três'),
    ]));
    expect(Array.from(files.keys())).toEqual(['a.png', 'b.png', 'c.png']);
    expect(textOf(files, 'c.png')).toBe('três');
  });

  it('pasta não vira arquivo', async () => {
    const files = await readZip(buildZip([
      await entry('texturas/', ''),
      await entry('texturas/stone.png', 'x'),
    ]));
    expect(Array.from(files.keys())).toEqual(['texturas/stone.png']);
  });

  it('arquivo vazio dentro do zip volta vazio, não some', async () => {
    const files = await readZip(buildZip([await entry('vazio.png', '')]));
    expect(files.get('vazio.png')?.length).toBe(0);
  });

  it('os bytes não ficam presos ao buffer do zip', async () => {
    const zip = buildZip([await entry('block/stone.png', 'pedra')]);
    const files = await readZip(zip);
    zip.fill(0);
    expect(textOf(files, 'block/stone.png')).toBe('pedra');
  });

  it('barra invertida no nome vira barra normal', async () => {
    const files = await readZip(buildZip([await entry('block\\stone.png', 'x')]));
    expect(files.has('block/stone.png')).toBe(true);
  });
});

describe('arquivo inválido', () => {
  it('o que não é zip é recusado com mensagem legível', async () => {
    await expect(readZip(encoder.encode('só um texto qualquer')))
      .rejects.toThrow(/não é um zip/);
  });

  it('arquivo curto demais é recusado', async () => {
    await expect(readZip(new Uint8Array([1, 2, 3]))).rejects.toThrow(ZipError);
  });

  it('diretório apontando para fora do arquivo é recusado', async () => {
    const zip = buildZip([await entry('a.png', 'conteúdo grande o suficiente')]);
    // Campo de posição do diretório central, dentro do fim de diretório.
    new DataView(zip.buffer).setUint32(zip.length - 6, zip.length + 100, true);
    await expect(readZip(zip)).rejects.toThrow(ZipError);
  });

  it('item que diz ser maior que o arquivo é recusado como truncado', async () => {
    const e = await entry('a.png', 'conteúdo');
    const zip = buildZip([e]);
    // Tamanho comprimido no diretório central: 46+nome atrás do fim de diretório.
    const central = zip.length - 22 - (46 + e.name.length);
    new DataView(zip.buffer).setUint32(central + 20, 1_000_000, true);
    await expect(readZip(zip)).rejects.toThrow(/truncado/);
  });

  it('compressão desconhecida é recusada dizendo qual arquivo', async () => {
    const e = await entry('block/stone.png', 'x');
    const zip = buildZip([{ ...e, method: 12 }]);
    await expect(readZip(zip)).rejects.toThrow(/block\/stone\.png/);
  });

  it('arquivo com senha é recusado dizendo o porquê', async () => {
    const zip = buildZip([await entry('block/stone.png', 'x')], { flags: 1 });
    await expect(readZip(zip)).rejects.toThrow(/senha/);
  });
});
