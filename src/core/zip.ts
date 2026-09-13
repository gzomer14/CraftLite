/**
 * Leitor de ZIP, o suficiente para um resource pack (doc 13 §7).
 *
 * O doc pede que o jogador traga um `.zip` com PNGs nomeados por convenção, e
 * o projeto não tem dependência de runtime — então o formato é lido aqui. São
 * ~150 linhas porque **só a leitura interessa**: não escrevemos ZIP, não
 * tratamos ZIP64, não tratamos arquivo cifrado e não conferimos CRC (o PNG tem
 * o dele, e um pixel errado não derruba o jogo).
 *
 * A leitura é guiada pelo **diretório central**, no fim do arquivo, não pelos
 * cabeçalhos locais. É o que faz o leitor funcionar com os zips gerados em
 * streaming, cujo cabeçalho local traz tamanho zero e joga o valor real para
 * um descritor depois dos dados.
 *
 * A descompressão é a nativa do navegador (`DecompressionStream('deflate-raw')`),
 * a mesma que `save/serialize.ts` usa nos chunks: zero bytes de bundle. Onde
 * ela não existe, só entram os arquivos guardados sem compressão — e quem
 * chama recebe o erro para mostrar ao jogador.
 */

/** Erro de formato, com frase pronta para a tela. */
export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

/** Tamanho mínimo do fim de diretório, sem comentário. */
const EOCD_SIZE = 22;
/** O comentário do ZIP cabe em 16 bits, então o fim está nos últimos 64 KB. */
const MAX_COMMENT = 0xffff;

const METHOD_STORED = 0;
const METHOD_DEFLATE = 8;
/** Bit 0 das flags: conteúdo cifrado. Não abrimos. */
const FLAG_ENCRYPTED = 1;
/** Marca de tamanho que só o ZIP64 sabe resolver. */
const ZIP64_MARK = 0xffffffff;

/**
 * Descompacta um ZIP inteiro na memória.
 *
 * Devolve caminho → bytes, na ordem do diretório central. Pasta não entra.
 */
export async function readZip(bytes: Uint8Array): Promise<Map<string, Uint8Array>> {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const eocd = findEndOfDirectory(view);

  const total = view.getUint16(eocd + 10, true);
  const directory = view.getUint32(eocd + 16, true);
  if (directory >= bytes.length) throw new ZipError('Arquivo zip corrompido.');

  const out = new Map<string, Uint8Array>();
  let cursor = directory;
  for (let i = 0; i < total; i++) {
    if (cursor + 46 > bytes.length) throw new ZipError('Arquivo zip truncado.');
    if (view.getUint32(cursor, true) !== SIG_CENTRAL) {
      throw new ZipError('Arquivo zip corrompido.');
    }
    const flags = view.getUint16(cursor + 8, true);
    const method = view.getUint16(cursor + 10, true);
    const compressed = view.getUint32(cursor + 20, true);
    const nameLength = view.getUint16(cursor + 28, true);
    const extraLength = view.getUint16(cursor + 30, true);
    const commentLength = view.getUint16(cursor + 32, true);
    const localOffset = view.getUint32(cursor + 42, true);
    const name = decodeName(bytes.subarray(cursor + 46, cursor + 46 + nameLength));
    cursor += 46 + nameLength + extraLength + commentLength;

    // Pasta: entra no diretório com tamanho zero e nada a extrair.
    if (name.endsWith('/')) continue;
    if ((flags & FLAG_ENCRYPTED) !== 0) {
      throw new ZipError(`O arquivo "${name}" está protegido por senha.`);
    }
    if (compressed === ZIP64_MARK || localOffset === ZIP64_MARK) {
      throw new ZipError('Zip grande demais (ZIP64) — recompacte com menos arquivos.');
    }

    const start = dataStart(view, bytes.length, localOffset);
    const end = start + compressed;
    if (end > bytes.length) throw new ZipError('Arquivo zip truncado.');
    const raw = bytes.subarray(start, end);

    if (method === METHOD_STORED) out.set(name, raw.slice());
    else if (method === METHOD_DEFLATE) out.set(name, await inflateRaw(raw, name));
    else throw new ZipError(`O arquivo "${name}" usa uma compressão que o jogo não lê.`);
  }
  return out;
}

/** Varre de trás para frente atrás da assinatura de fim de diretório. */
function findEndOfDirectory(view: DataView): number {
  const limit = Math.max(0, view.byteLength - EOCD_SIZE - MAX_COMMENT);
  for (let at = view.byteLength - EOCD_SIZE; at >= limit; at--) {
    if (view.getUint32(at, true) === SIG_EOCD) return at;
  }
  throw new ZipError('Este arquivo não é um zip.');
}

/**
 * Onde começam os bytes de um item.
 *
 * O cabeçalho local repete nome e extra com **tamanhos próprios** — às vezes
 * diferentes dos do diretório central, porque alguns compactadores só põem o
 * campo de tempo estendido num dos dois. Ler os dois daqui é o que evita
 * começar a descompressão alguns bytes fora do lugar.
 */
function dataStart(view: DataView, length: number, localOffset: number): number {
  if (localOffset + 30 > length) throw new ZipError('Arquivo zip truncado.');
  if (view.getUint32(localOffset, true) !== SIG_LOCAL) {
    throw new ZipError('Arquivo zip corrompido.');
  }
  const nameLength = view.getUint16(localOffset + 26, true);
  const extraLength = view.getUint16(localOffset + 28, true);
  return localOffset + 30 + nameLength + extraLength;
}

const utf8 = new TextDecoder();

/** Nome do item. O ZIP moderno grava em UTF-8, e nome exótico não nos serve. */
function decodeName(bytes: Uint8Array): string {
  return utf8.decode(bytes).replace(/\\/g, '/');
}

async function inflateRaw(data: Uint8Array, name: string): Promise<Uint8Array> {
  const global = globalThis as { DecompressionStream?: typeof DecompressionStream };
  if (global.DecompressionStream === undefined) {
    throw new ZipError('Este navegador não descompacta zip. Recompacte "sem compressão".');
  }
  const stream = new global.DecompressionStream('deflate-raw');
  const writer = stream.writable.getWriter();
  void writer.write(data as BufferSource);
  void writer.close();

  const reader = stream.readable.getReader();
  const parts: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done === true) break;
      if (value !== undefined) {
        parts.push(value as Uint8Array);
        total += (value as Uint8Array).length;
      }
    }
  } catch {
    throw new ZipError(`O arquivo "${name}" está corrompido.`);
  }

  const out = new Uint8Array(total);
  let at = 0;
  for (const part of parts) { out.set(part, at); at += part.length; }
  return out;
}
