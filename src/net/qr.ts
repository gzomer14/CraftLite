/**
 * Gerador de QR code (M20), sem dependência (doc 13: nada de terceiros).
 *
 * Só o que o pareamento usa: **modo alfanumérico** (o código de pareamento é
 * base32, `net/base32.ts`), correção de erro **nível M** (15%: aguenta reflexo
 * e dedo na frente da tela) e versões 1 a 10 (até 213 caracteres). O algoritmo
 * é o da norma ISO/IEC 18004: dados em blocos com Reed–Solomon sobre GF(256),
 * intercalados, desenhados em zigue-zague, com a máscara de menor penalidade.
 *
 * A leitura pela câmera usa o `BarcodeDetector` do navegador quando existe
 * (Chrome no Android); sem ele, o código em texto é o caminho (`net/scan.ts`).
 */

export const ALNUM = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ $%*+-./:';

/** Códigos de correção por bloco e número de blocos, nível M, versões 1–10. */
export const ECC_PER_BLOCK: readonly number[] = [0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26];
export const BLOCKS: readonly number[] = [0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5];
export const MAX_VERSION = 10;
/** Bits de formato do nível M. */
const ECL_BITS = 0;

export interface QrMatrix {
  size: number;
  version: number;
  mask: number;
  /** `true` = módulo escuro, `[y * size + x]`. */
  dark: Uint8Array;
}

/** Módulos que carregam dados, descontadas as marcas fixas. */
export function rawDataModules(version: number): number {
  let result = (16 * version + 128) * version + 64;
  if (version >= 2) {
    const align = Math.floor(version / 7) + 2;
    result -= (25 * align - 10) * align - 55;
    if (version >= 7) result -= 36;
  }
  return result;
}

export function dataCodewords(version: number): number {
  return Math.floor(rawDataModules(version) / 8) - ECC_PER_BLOCK[version] * BLOCKS[version];
}

/** Centros das marcas de alinhamento numa linha. */
export function alignmentPositions(version: number): number[] {
  if (version === 1) return [];
  const count = Math.floor(version / 7) + 2;
  const size = version * 4 + 17;
  const step = Math.ceil((version * 4 + 4) / (count * 2 - 2)) * 2;
  const out = [6];
  for (let pos = size - 7; out.length < count; pos -= step) out.splice(1, 0, pos);
  return out;
}

// --- Reed–Solomon ------------------------------------------------------------

function gfMul(x: number, y: number): number {
  let z = 0;
  for (let i = 7; i >= 0; i--) {
    z = (z << 1) ^ ((z >>> 7) * 0x11d);
    z ^= ((y >>> i) & 1) * x;
  }
  return z & 0xff;
}

function rsDivisor(degree: number): number[] {
  const result = new Array<number>(degree).fill(0);
  result[degree - 1] = 1;
  let root = 1;
  for (let i = 0; i < degree; i++) {
    for (let j = 0; j < result.length; j++) {
      result[j] = gfMul(result[j], root);
      if (j + 1 < result.length) result[j] ^= result[j + 1];
    }
    root = gfMul(root, 0x02);
  }
  return result;
}

export function rsRemainder(data: readonly number[], degree: number): number[] {
  const divisor = rsDivisor(degree);
  const result = new Array<number>(degree).fill(0);
  for (const b of data) {
    const factor = b ^ (result.shift() ?? 0);
    result.push(0);
    for (let i = 0; i < divisor.length; i++) result[i] ^= gfMul(divisor[i], factor);
  }
  return result;
}

// --- codificação -------------------------------------------------------------

/** Texto → QR. Só caracteres alfanuméricos do QR (maiúsculas, dígitos, ` $%*+-./:`). */
export function encodeQr(text: string): QrMatrix {
  for (const ch of text) {
    if (!ALNUM.includes(ch)) throw new Error(`caractere fora do modo alfanumérico do QR: ${ch}`);
  }
  let version = 1;
  for (; version <= MAX_VERSION; version++) {
    const countBits = version <= 9 ? 9 : 11;
    const bits = 4 + countBits + Math.floor(text.length / 2) * 11 + (text.length % 2) * 6;
    if (bits <= dataCodewords(version) * 8) break;
  }
  if (version > MAX_VERSION) throw new Error(`texto longo demais para o QR: ${text.length}`);

  const bits: number[] = [];
  const put = (value: number, n: number): void => {
    for (let i = n - 1; i >= 0; i--) bits.push((value >>> i) & 1);
  };
  put(0b0010, 4);
  put(text.length, version <= 9 ? 9 : 11);
  for (let i = 0; i + 1 < text.length; i += 2) {
    put(ALNUM.indexOf(text[i]) * 45 + ALNUM.indexOf(text[i + 1]), 11);
  }
  if (text.length % 2 === 1) put(ALNUM.indexOf(text[text.length - 1]), 6);
  const capacity = dataCodewords(version) * 8;
  put(0, Math.min(4, capacity - bits.length));
  put(0, (8 - (bits.length % 8)) % 8);
  const data: number[] = [];
  for (let i = 0; i < bits.length; i += 8) {
    let b = 0;
    for (let j = 0; j < 8; j++) b = (b << 1) | bits[i + j];
    data.push(b);
  }
  for (let pad = 0xec; data.length < dataCodewords(version); pad ^= 0xec ^ 0x11) data.push(pad);

  const codewords = interleave(data, version);
  return drawMatrix(version, codewords);
}

/** Divide em blocos, calcula a correção de cada um e intercala. */
export function interleave(data: readonly number[], version: number): number[] {
  const numBlocks = BLOCKS[version];
  const ecc = ECC_PER_BLOCK[version];
  const raw = Math.floor(rawDataModules(version) / 8);
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const blocks: number[][] = [];
  for (let i = 0, k = 0; i < numBlocks; i++) {
    const len = shortLen - ecc + (i < numShort ? 0 : 1);
    const dat = data.slice(k, k + len);
    k += len;
    const rem = rsRemainder(dat, ecc);
    // Bloco curto ganha um byte fantasma para intercalar por índice.
    if (i < numShort) dat.push(-1);
    blocks.push(dat.concat(rem));
  }
  const out: number[] = [];
  for (let i = 0; i < blocks[0].length; i++) {
    for (const block of blocks) {
      if (block[i] !== -1) out.push(block[i]);
    }
  }
  return out;
}

function drawMatrix(version: number, codewords: readonly number[]): QrMatrix {
  const size = version * 4 + 17;
  const dark = new Uint8Array(size * size);
  const fixed = new Uint8Array(size * size);
  const set = (x: number, y: number, on: boolean): void => {
    dark[y * size + x] = on ? 1 : 0;
    fixed[y * size + x] = 1;
  };
  drawFunctionPatterns(version, set);

  // Dados em zigue-zague, de duas em duas colunas, da direita para a esquerda.
  let bit = 0;
  const total = codewords.length * 8;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y * size + x] === 1 || bit >= total) continue;
        dark[y * size + x] = (codewords[bit >>> 3] >>> (7 - (bit & 7))) & 1;
        bit++;
      }
    }
  }

  // Máscara de menor penalidade.
  let best = 0;
  let bestScore = Infinity;
  for (let mask = 0; mask < 8; mask++) {
    applyMask(dark, fixed, size, mask);
    drawFormat(set, size, mask);
    const score = penalty(dark, size);
    if (score < bestScore) {
      bestScore = score;
      best = mask;
    }
    applyMask(dark, fixed, size, mask);
  }
  applyMask(dark, fixed, size, best);
  drawFormat(set, size, best);
  return { size, version, mask: best, dark };
}

/**
 * As marcas fixas: sincronismo, posição (com o separador), alinhamento e as
 * áreas de formato e versão (formato com valor provisório). O gerador as
 * desenha; o leitor (`net/qrread.ts`) as usa para saber o que não é dado.
 */
function drawFunctionPatterns(version: number, set: (x: number, y: number, on: boolean) => void): void {
  const size = version * 4 + 17;
  // Linhas de sincronismo.
  for (let i = 0; i < size; i++) {
    set(6, i, i % 2 === 0);
    set(i, 6, i % 2 === 0);
  }
  // Marcas de posição, com o separador branco em volta.
  for (const [cx, cy] of [[3, 3], [size - 4, 3], [3, size - 4]]) {
    for (let dy = -4; dy <= 4; dy++) {
      for (let dx = -4; dx <= 4; dx++) {
        const x = cx + dx;
        const y = cy + dy;
        if (x < 0 || y < 0 || x >= size || y >= size) continue;
        const d = Math.max(Math.abs(dx), Math.abs(dy));
        set(x, y, d !== 2 && d !== 4);
      }
    }
  }
  // Marcas de alinhamento, menos as que cairiam sobre as de posição.
  const align = alignmentPositions(version);
  for (let i = 0; i < align.length; i++) {
    for (let j = 0; j < align.length; j++) {
      const corner = (i === 0 && j === 0) || (i === 0 && j === align.length - 1)
        || (i === align.length - 1 && j === 0);
      if (corner) continue;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          set(align[i] + dx, align[j] + dy, Math.max(Math.abs(dx), Math.abs(dy)) !== 1);
        }
      }
    }
  }
  // Reserva das áreas de formato e versão (valor provisório).
  drawFormat(set, size, 0);
  drawVersion(set, size, version);

}

/** Quais módulos são marca fixa (1) e quais carregam dado (0). */
export function functionModules(version: number): Uint8Array {
  const size = version * 4 + 17;
  const fixed = new Uint8Array(size * size);
  drawFunctionPatterns(version, (x, y) => { fixed[y * size + x] = 1; });
  return fixed;
}

/** Bits de formato (nível + máscara, BCH, máscara fixa 0x5412). */
export function formatBits(mask: number, ecl = ECL_BITS): number {
  const data = (ecl << 3) | mask;
  let rem = data;
  for (let i = 0; i < 10; i++) rem = (rem << 1) ^ ((rem >>> 9) * 0x537);
  return ((data << 10) | rem) ^ 0x5412;
}

function drawFormat(set: (x: number, y: number, on: boolean) => void, size: number, mask: number): void {
  const bits = formatBits(mask);
  const bitAt = (i: number): boolean => ((bits >>> i) & 1) !== 0;
  for (let i = 0; i <= 5; i++) set(8, i, bitAt(i));
  set(8, 7, bitAt(6));
  set(8, 8, bitAt(7));
  set(7, 8, bitAt(8));
  for (let i = 9; i < 15; i++) set(14 - i, 8, bitAt(i));
  for (let i = 0; i < 8; i++) set(size - 1 - i, 8, bitAt(i));
  for (let i = 8; i < 15; i++) set(8, size - 15 + i, bitAt(i));
  set(8, size - 8, true);
}

function drawVersion(set: (x: number, y: number, on: boolean) => void, size: number, version: number): void {
  if (version < 7) return;
  let rem = version;
  for (let i = 0; i < 12; i++) rem = (rem << 1) ^ ((rem >>> 11) * 0x1f25);
  const bits = (version << 12) | rem;
  for (let i = 0; i < 18; i++) {
    const on = ((bits >>> i) & 1) !== 0;
    const a = size - 11 + (i % 3);
    const b = Math.floor(i / 3);
    set(a, b, on);
    set(b, a, on);
  }
}

/** A condição de cada máscara: onde ela é verdadeira, o módulo inverte. */
export function maskHit(mask: number, x: number, y: number): boolean {
  switch (mask) {
    case 0: return (x + y) % 2 === 0;
    case 1: return y % 2 === 0;
    case 2: return x % 3 === 0;
    case 3: return (x + y) % 3 === 0;
    case 4: return (Math.floor(x / 3) + Math.floor(y / 2)) % 2 === 0;
    case 5: return ((x * y) % 2) + ((x * y) % 3) === 0;
    case 6: return (((x * y) % 2) + ((x * y) % 3)) % 2 === 0;
    default: return (((x + y) % 2) + ((x * y) % 3)) % 2 === 0;
  }
}

function applyMask(dark: Uint8Array, fixed: Uint8Array, size: number, mask: number): void {
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      if (fixed[y * size + x] === 0 && maskHit(mask, x, y)) dark[y * size + x] ^= 1;
    }
  }
}

/** Penalidade da norma: corridas, blocos 2×2, padrões de posição e equilíbrio. */
function penalty(dark: Uint8Array, size: number): number {
  let score = 0;
  const at = (x: number, y: number): number => dark[y * size + x];
  for (let pass = 0; pass < 2; pass++) {
    for (let a = 0; a < size; a++) {
      let run = 1;
      let pattern = 0;
      for (let b = 0; b < size; b++) {
        const v = pass === 0 ? at(b, a) : at(a, b);
        if (b > 0) {
          const prev = pass === 0 ? at(b - 1, a) : at(a, b - 1);
          if (v === prev) {
            run++;
            if (run === 5) score += 3;
            else if (run > 5) score++;
          } else {
            run = 1;
          }
        }
        // Padrão 1:1:3:1:1 com quatro claros de um lado (N3).
        pattern = ((pattern << 1) | v) & 0x7ff;
        if (b >= 10 && (pattern === 0x05d || pattern === 0x5d0)) score += 40;
      }
    }
  }
  let blackCount = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const v = at(x, y);
      blackCount += v;
      if (x + 1 < size && y + 1 < size && v === at(x + 1, y) && v === at(x, y + 1) && v === at(x + 1, y + 1)) {
        score += 3;
      }
    }
  }
  const total = size * size;
  const k = Math.ceil(Math.abs(blackCount * 20 - total * 10) / total) - 1;
  return score + Math.max(0, k) * 10;
}

/** Desenha o QR num canvas, com a margem branca de 4 módulos que a norma pede. */
export function paintQr(canvas: HTMLCanvasElement, qr: QrMatrix, pixels: number): void {
  const quiet = 4;
  const cells = qr.size + quiet * 2;
  const scale = Math.max(1, Math.floor(pixels / cells));
  canvas.width = canvas.height = cells * scale;
  const g = canvas.getContext('2d');
  if (g === null) return;
  g.fillStyle = '#fff';
  g.fillRect(0, 0, canvas.width, canvas.height);
  g.fillStyle = '#000';
  for (let y = 0; y < qr.size; y++) {
    for (let x = 0; x < qr.size; x++) {
      if (qr.dark[y * qr.size + x] === 1) g.fillRect((x + quiet) * scale, (y + quiet) * scale, scale, scale);
    }
  }
}
