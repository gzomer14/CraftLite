/**
 * Leitor de QR code em imagem (M20), sem dependência (doc 13).
 *
 * Existe para o computador ler o QR do celular pela webcam: o `BarcodeDetector`
 * do navegador só existe no Chrome do Android e do macOS, e sem ele o jogador
 * teria de digitar um código de ~120 letras. Lê **os códigos que o próprio jogo
 * gera** (`net/qr.ts`): nível de correção M, versões 1 a 10, modo alfanumérico
 * (e byte, por folga).
 *
 * O caminho, o mesmo dos leitores conhecidos:
 * 1. tons de cinza e limiar adaptativo por blocos de 8×8 (luz desigual na tela
 *    do celular é o caso comum);
 * 2. as três marcas de posição, pela proporção 1:1:3:1:1 numa linha,
 *    conferida na vertical e de novo na horizontal;
 * 3. a versão pela distância entre as marcas, e a marca de alinhamento do
 *    canto de baixo, para a perspectiva;
 * 4. uma transformação projetiva do quadrado de módulos para a imagem, e uma
 *    amostra no centro de cada módulo;
 * 5. formato (o mais perto dos 32 válidos, até 3 bits errados), máscara,
 *    blocos, e Reed–Solomon corrigindo até metade dos bytes de correção.
 */

import {
  ALNUM, BLOCKS, ECC_PER_BLOCK, MAX_VERSION, formatBits, functionModules,
  maskHit, rawDataModules,
} from './qr';

/** Uma imagem em tons de cinza, 0–255, `[y * width + x]`. */
export interface GrayImage {
  width: number;
  height: number;
  data: Uint8Array;
}

/** RGBA (de um `ImageData`) para cinza. */
export function toGray(rgba: Uint8ClampedArray | Uint8Array, width: number, height: number): GrayImage {
  const data = new Uint8Array(width * height);
  for (let i = 0, j = 0; i < data.length; i++, j += 4) {
    data[i] = (rgba[j] * 77 + rgba[j + 1] * 150 + rgba[j + 2] * 29) >> 8;
  }
  return { width, height, data };
}

/** Lê o QR da imagem; `null` se não achou ou não conseguiu corrigir. */
export function readQr(image: GrayImage): string | null {
  const bits = binarize(image);
  const centers = findFinders(bits, image.width, image.height);
  if (centers.length < 3) return null;
  // As três melhores; se houver mais candidatas, tenta combinações das mais vistas.
  const ranked = centers.slice().sort((a, b) => b.count - a.count).slice(0, 5);
  for (let i = 0; i < ranked.length; i++) {
    for (let j = i + 1; j < ranked.length; j++) {
      for (let k = j + 1; k < ranked.length; k++) {
        const text = tryTriple(bits, image.width, image.height, ranked[i], ranked[j], ranked[k]);
        if (text !== null) return text;
      }
    }
  }
  return null;
}

// --- binarização -------------------------------------------------------------------

const BLOCK = 8;

/** 1 = escuro. Limiar: a média dos blocos 3×3 em volta, com contraste mínimo. */
function binarize(img: GrayImage): Uint8Array {
  const { width, height, data } = img;
  const bw = Math.ceil(width / BLOCK);
  const bh = Math.ceil(height / BLOCK);
  const mean = new Float32Array(bw * bh);
  const range = new Uint8Array(bw * bh);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let n = 0;
      let lo = 255;
      let hi = 0;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y++) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x++) {
          const v = data[y * width + x];
          sum += v;
          n++;
          if (v < lo) lo = v;
          if (v > hi) hi = v;
        }
      }
      mean[by * bw + bx] = sum / n;
      range[by * bw + bx] = hi - lo;
    }
  }
  const out = new Uint8Array(width * height);
  for (let by = 0; by < bh; by++) {
    for (let bx = 0; bx < bw; bx++) {
      let sum = 0;
      let n = 0;
      let flat = true;
      for (let dy = -2; dy <= 2; dy++) {
        for (let dx = -2; dx <= 2; dx++) {
          const x = bx + dx;
          const y = by + dy;
          if (x < 0 || y < 0 || x >= bw || y >= bh) continue;
          sum += mean[y * bw + x];
          n++;
          if (range[y * bw + x] > 24) flat = false;
        }
      }
      // Região sem contraste (fundo liso): tudo claro, senão vira ruído.
      const threshold = flat ? -1 : sum / n;
      for (let y = by * BLOCK; y < Math.min(height, (by + 1) * BLOCK); y++) {
        for (let x = bx * BLOCK; x < Math.min(width, (bx + 1) * BLOCK); x++) {
          out[y * width + x] = data[y * width + x] < threshold ? 1 : 0;
        }
      }
    }
  }
  return out;
}

// --- marcas de posição ----------------------------------------------------------------

interface Finder {
  x: number;
  y: number;
  module: number;
  count: number;
}

/** Proporção 1:1:3:1:1, com meio módulo de folga por faixa. */
function ratioOk(c: readonly number[]): boolean {
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (total < 7) return false;
  const m = total / 7;
  const v = m / 1.5;
  return Math.abs(m - c[0]) < v && Math.abs(m - c[1]) < v && Math.abs(3 * m - c[2]) < 3 * v
    && Math.abs(m - c[3]) < v && Math.abs(m - c[4]) < v;
}

function findFinders(bits: Uint8Array, width: number, height: number): Finder[] {
  const found: Finder[] = [];
  const step = Math.max(1, Math.floor(height / 300));
  const c = [0, 0, 0, 0, 0];
  for (let y = 0; y < height; y += step) {
    c.fill(0);
    let state = 0;
    for (let x = 0; x <= width; x++) {
      const dark = x < width && bits[y * width + x] === 1;
      if (dark === ((state & 1) === 0)) {
        c[state]++;
        continue;
      }
      // Mudou de cor.
      if (state < 4) {
        state++;
        if (x < width) c[state] = 1;
        continue;
      }
      if (ratioOk(c)) {
        const total = c[0] + c[1] + c[2] + c[3] + c[4];
        const cx = x - c[4] - c[3] - c[2] / 2;
        confirm(bits, width, height, cx, y, total, found);
      }
      // Desliza: as duas últimas faixas viram as duas primeiras.
      c[0] = c[2]; c[1] = c[3]; c[2] = c[4]; c[3] = 1; c[4] = 0;
      state = 3;
    }
  }
  return found.filter((f) => f.count >= 2 || found.length <= 3);
}

/** Confere na vertical e de novo na horizontal; junta com uma marca já vista. */
function confirm(bits: Uint8Array, width: number, height: number, cx: number, y: number, total: number, found: Finder[]): void {
  const vy = crossCheck(bits, width, height, Math.round(cx), y, 0, 1, total);
  if (vy === null) return;
  const hx = crossCheck(bits, width, height, Math.round(cx), Math.round(vy.center), 1, 0, total);
  if (hx === null) return;
  const module = (vy.total + hx.total) / 14;
  const fx = hx.center;
  const fy = vy.center;
  for (const f of found) {
    if (Math.abs(f.x - fx) <= f.module * 2 && Math.abs(f.y - fy) <= f.module * 2) {
      f.x = (f.x * f.count + fx) / (f.count + 1);
      f.y = (f.y * f.count + fy) / (f.count + 1);
      f.module = (f.module * f.count + module) / (f.count + 1);
      f.count++;
      return;
    }
  }
  found.push({ x: fx, y: fy, module, count: 1 });
}

/** As cinco faixas passando por `(x, y)` na direção `(dx, dy)`. */
function crossCheck(
  bits: Uint8Array, width: number, height: number, x: number, y: number, dx: number, dy: number, expect: number,
): { center: number; total: number } | null {
  const at = (i: number): number => {
    const px = x + dx * i;
    const py = y + dy * i;
    if (px < 0 || py < 0 || px >= width || py >= height) return -1;
    return bits[py * width + px];
  };
  if (at(0) !== 1) return null;
  const c = [0, 0, 0, 0, 0];
  let i = 0;
  while (at(i) === 1) { c[2]++; i--; }
  while (at(i) === 0) { c[1]++; i--; }
  while (at(i) === 1) { c[0]++; i--; }
  i = 1;
  while (at(i) === 1) { c[2]++; i++; }
  while (at(i) === 0) { c[3]++; i++; }
  const end0 = i;
  while (at(i) === 1) { c[4]++; i++; }
  const total = c[0] + c[1] + c[2] + c[3] + c[4];
  if (Math.abs(total - expect) > expect || !ratioOk(c)) return null;
  const center = (dx !== 0 ? x : y) + (end0 - c[3] - c[2] / 2);
  return { center, total };
}

// --- geometria --------------------------------------------------------------------------

function tryTriple(bits: Uint8Array, width: number, height: number, a: Finder, b: Finder, c: Finder): string | null {
  // Módulos parecidos: são marcas do mesmo código.
  const mods = [a.module, b.module, c.module];
  if (Math.max(...mods) > Math.min(...mods) * 1.8) return null;
  // O canto de cima à esquerda é o oposto do lado mais longo.
  const dab = dist(a, b);
  const dac = dist(a, c);
  const dbc = dist(b, c);
  let tl: Finder;
  let p: Finder;
  let q: Finder;
  if (dbc >= dab && dbc >= dac) { tl = a; p = b; q = c; }
  else if (dac >= dab) { tl = b; p = a; q = c; }
  else { tl = c; p = a; q = b; }
  // Sentido: em coordenadas de tela, (TR − TL) × (BL − TL) > 0.
  const cross = (p.x - tl.x) * (q.y - tl.y) - (p.y - tl.y) * (q.x - tl.x);
  const tr = cross > 0 ? p : q;
  const bl = cross > 0 ? q : p;
  const module = (tl.module + tr.module + bl.module) / 3;
  const estimate = Math.round((dist(tl, tr) + dist(tl, bl)) / (2 * module)) + 7;
  // O tamanho é 4v+17: tenta o estimado e os vizinhos válidos.
  const sizes: number[] = [];
  for (const d of [0, -1, 1, -2, 2, -3, 3, -4, 4]) {
    const size = estimate + d;
    if ((size - 17) % 4 === 0 && size >= 21 && size <= MAX_VERSION * 4 + 17) sizes.push(size);
  }
  for (const size of sizes) {
    for (const fourth of alignmentCandidates(bits, width, height, tl, tr, bl, size)) {
      const matrix = sample(bits, width, height, tl, tr, bl, fourth, size);
      if (matrix === null) continue;
      const text = decodeMatrix(matrix, size) ?? decodeMatrix(transpose(matrix, size), size);
      if (text !== null) return text;
    }
  }
  return null;
}

function dist(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/** O quarto ponto da perspectiva, na imagem e na grade de módulos. */
interface Fourth {
  x: number;
  y: number;
  /** Coordenada do ponto na grade (os dois eixos são iguais). */
  m: number;
}

/**
 * Candidatos ao quarto ponto da perspectiva, do mais provável ao menos: as
 * posições perto da estimativa que têm o desenho da marca de alinhamento
 * (5×5: centro escuro, anel claro, anel escuro), e por último o canto do
 * paralelogramo, que só vale sem inclinação. Quem decide é a decodificação:
 * trecho de dado às vezes imita a marca, e só o Reed–Solomon sabe.
 */
function alignmentCandidates(
  bits: Uint8Array, width: number, height: number, tl: Finder, tr: Finder, bl: Finder, size: number,
): Fourth[] {
  const brx = tr.x + bl.x - tl.x;
  const bry = tr.y + bl.y - tl.y;
  const corner: Fourth = { x: brx, y: bry, m: size - 3.5 };
  if (size === 21) return [corner];
  // Perto do canto de baixo o módulo é o das marcas de lá, não a média: com o
  // celular inclinado, o lado mais perto da câmera tem módulos maiores.
  const module = (tr.module + bl.module) / 2;
  const k = 1 - 3 / (size - 7);
  const ex = tl.x + k * (brx - tl.x);
  const ey = tl.y + k * (bry - tl.y);
  const at = (x: number, y: number): number => {
    const px = Math.round(x);
    const py = Math.round(y);
    return px < 0 || py < 0 || px >= width || py >= height ? -1 : bits[py * width + px];
  };
  const found: { x: number; y: number; score: number }[] = [];
  const reach = Math.ceil(module * 12);
  const stepPx = Math.max(1, Math.floor(module / 3));
  for (let dy = -reach; dy <= reach; dy += stepPx) {
    for (let dx = -reach; dx <= reach; dx += stepPx) {
      const x = ex + dx;
      const y = ey + dy;
      if (at(x, y) !== 1) continue;
      let score = 0;
      for (let my = -2; my <= 2; my++) {
        for (let mx = -2; mx <= 2; mx++) {
          const ring = Math.max(Math.abs(mx), Math.abs(my));
          if (at(x + mx * module, y + my * module) === (ring === 1 ? 0 : 1)) score++;
        }
      }
      if (score >= 22) found.push({ x, y, score });
    }
  }
  // Uma por região (a mesma marca é vista de vários pixels), a melhor nota.
  found.sort((a, b) => b.score - a.score
    || ((a.x - ex) ** 2 + (a.y - ey) ** 2) - ((b.x - ex) ** 2 + (b.y - ey) ** 2));
  const out: Fourth[] = [];
  for (const f of found) {
    if (out.some((o) => Math.abs(o.x - f.x) < module * 2 && Math.abs(o.y - f.y) < module * 2)) continue;
    out.push({ x: f.x, y: f.y, m: size - 6.5 });
    if (out.length === 4) break;
  }
  out.push(corner);
  return out;
}

/** Amostra o centro de cada módulo pela transformação projetiva. */
function sample(
  bits: Uint8Array, width: number, height: number,
  tl: Finder, tr: Finder, bl: Finder, fourth: Fourth, size: number,
): Uint8Array | null {
  // Os centros das marcas de posição estão a 3,5 módulos das bordas.
  const t = quadToQuad(
    3.5, 3.5, size - 3.5, 3.5, fourth.m, fourth.m, 3.5, size - 3.5,
    tl.x, tl.y, tr.x, tr.y, fourth.x, fourth.y, bl.x, bl.y,
  );
  const out = new Uint8Array(size * size);
  let outside = 0;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const [px, py] = apply(t, x + 0.5, y + 0.5);
      const ix = Math.round(px);
      const iy = Math.round(py);
      if (ix < 0 || iy < 0 || ix >= width || iy >= height) { outside++; continue; }
      out[y * size + x] = bits[iy * width + ix];
    }
  }
  return outside > size ? null : out;
}

type Transform = number[];

/** Quadrado unitário → quadrilátero (Heckbert). */
function squareToQuad(x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): Transform {
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  if (dx3 === 0 && dy3 === 0) {
    return [x1 - x0, x2 - x1, x0, y1 - y0, y2 - y1, y0, 0, 0, 1];
  }
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den;
  const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [
    x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0,
    y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0,
    a13, a23, 1,
  ];
}

function adjoint(m: Transform): Transform {
  return [
    m[4] * m[8] - m[5] * m[7], m[2] * m[7] - m[1] * m[8], m[1] * m[5] - m[2] * m[4],
    m[5] * m[6] - m[3] * m[8], m[0] * m[8] - m[2] * m[6], m[2] * m[3] - m[0] * m[5],
    m[3] * m[7] - m[4] * m[6], m[1] * m[6] - m[0] * m[7], m[0] * m[4] - m[1] * m[3],
  ];
}

function multiply(a: Transform, b: Transform): Transform {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) {
    for (let c = 0; c < 3; c++) {
      out.push(a[r * 3] * b[c] + a[r * 3 + 1] * b[3 + c] + a[r * 3 + 2] * b[6 + c]);
    }
  }
  return out;
}

/** Leva o quadrilátero de origem ao de destino (os dois em sentido horário). */
function quadToQuad(
  sx0: number, sy0: number, sx1: number, sy1: number, sx2: number, sy2: number, sx3: number, sy3: number,
  dx0: number, dy0: number, dx1: number, dy1: number, dx2: number, dy2: number, dx3: number, dy3: number,
): Transform {
  const toSquare = adjoint(squareToQuad(sx0, sy0, sx1, sy1, sx2, sy2, sx3, sy3));
  const fromSquare = squareToQuad(dx0, dy0, dx1, dy1, dx2, dy2, dx3, dy3);
  return multiply(fromSquare, toSquare);
}

function apply(m: Transform, x: number, y: number): [number, number] {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

function transpose(m: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size * size);
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) out[x * size + y] = m[y * size + x];
  return out;
}

// --- da matriz ao texto --------------------------------------------------------------------

/** Os 32 formatos válidos: nível (L, M, Q, H) × máscara. */
const FORMATS: { bits: number; ecl: number; mask: number }[] = [];
for (const ecl of [1, 0, 3, 2]) for (let mask = 0; mask < 8; mask++) FORMATS.push({ bits: formatBits(mask, ecl), ecl, mask });

function popcount(v: number): number {
  let n = 0;
  for (; v !== 0; v &= v - 1) n++;
  return n;
}

/** Uma matriz de módulos (1 = escuro) → texto, ou `null`. Exportada para teste. */
export function decodeMatrix(m: Uint8Array, size: number): string | null {
  const version = (size - 17) / 4;
  if (!Number.isInteger(version) || version < 1 || version > MAX_VERSION) return null;
  const at = (x: number, y: number): number => m[y * size + x];
  // As duas cópias do formato; vale a mais perto de um formato válido.
  let a = 0;
  const cells: [number, number][] = [[8, 0], [8, 1], [8, 2], [8, 3], [8, 4], [8, 5], [8, 7], [8, 8], [7, 8],
    [5, 8], [4, 8], [3, 8], [2, 8], [1, 8], [0, 8]];
  cells.forEach(([x, y], i) => { a |= at(x, y) << i; });
  let b = 0;
  for (let i = 0; i < 8; i++) b |= at(size - 1 - i, 8) << i;
  for (let i = 8; i < 15; i++) b |= at(8, size - 15 + i) << i;
  let best: { ecl: number; mask: number } | null = null;
  let bestDistance = 4;
  for (const f of FORMATS) {
    const d = Math.min(popcount(f.bits ^ a), popcount(f.bits ^ b));
    if (d < bestDistance) { bestDistance = d; best = f; }
  }
  // Só o nível M: é o único que o jogo gera.
  if (best === null || best.ecl !== 0) return null;
  const fixed = functionModules(version);
  const total = Math.floor(rawDataModules(version) / 8);
  const codewords = new Array<number>(total).fill(0);
  let bit = 0;
  for (let right = size - 1; right >= 1; right -= 2) {
    if (right === 6) right = 5;
    for (let vert = 0; vert < size; vert++) {
      for (let j = 0; j < 2; j++) {
        const x = right - j;
        const upward = ((right + 1) & 2) === 0;
        const y = upward ? size - 1 - vert : vert;
        if (fixed[y * size + x] === 1 || bit >= total * 8) continue;
        const v = at(x, y) ^ (maskHit(best.mask, x, y) ? 1 : 0);
        codewords[bit >>> 3] |= v << (7 - (bit & 7));
        bit++;
      }
    }
  }
  const data = deinterleave(codewords, version);
  return data === null ? null : parseSegments(data, version);
}

/** Separa os blocos, corrige cada um e junta os bytes de dado. */
function deinterleave(codewords: number[], version: number): number[] | null {
  const numBlocks = BLOCKS[version];
  const ecc = ECC_PER_BLOCK[version];
  const raw = codewords.length;
  const numShort = numBlocks - (raw % numBlocks);
  const shortLen = Math.floor(raw / numBlocks);
  const dataLen = (i: number): number => shortLen - ecc + (i < numShort ? 0 : 1);
  const blocks: number[][] = [];
  for (let i = 0; i < numBlocks; i++) blocks.push([]);
  let k = 0;
  for (let i = 0; i < shortLen - ecc + 1; i++) {
    for (let j = 0; j < numBlocks; j++) if (i < dataLen(j)) blocks[j].push(codewords[k++]);
  }
  for (let i = 0; i < ecc; i++) for (let j = 0; j < numBlocks; j++) blocks[j].push(codewords[k++]);
  const out: number[] = [];
  for (let j = 0; j < numBlocks; j++) {
    const fixed = rsCorrect(blocks[j], ecc);
    if (fixed === null) return null;
    for (let i = 0; i < dataLen(j); i++) out.push(fixed[i]);
  }
  return out;
}

function parseSegments(data: number[], version: number): string | null {
  let pos = 0;
  const read = (n: number): number => {
    let v = 0;
    for (let i = 0; i < n; i++, pos++) {
      if (pos >= data.length * 8) return -1;
      v = (v << 1) | ((data[pos >>> 3] >>> (7 - (pos & 7))) & 1);
    }
    return v;
  };
  let text = '';
  for (;;) {
    if (data.length * 8 - pos < 4) break;
    const mode = read(4);
    if (mode === 0) break;
    if (mode === 0b0010) {
      let count = read(version <= 9 ? 9 : 11);
      while (count >= 2) {
        const v = read(11);
        if (v < 0 || v >= 45 * 45) return null;
        text += ALNUM[Math.floor(v / 45)] + ALNUM[v % 45];
        count -= 2;
      }
      if (count === 1) {
        const v = read(6);
        if (v < 0 || v >= 45) return null;
        text += ALNUM[v];
      }
    } else if (mode === 0b0100) {
      const count = read(version <= 9 ? 8 : 16);
      for (let i = 0; i < count; i++) {
        const v = read(8);
        if (v < 0) return null;
        text += String.fromCharCode(v);
      }
    } else {
      return null;
    }
  }
  return text;
}

// --- Reed–Solomon, GF(256) com 0x11D, raízes α^0… ------------------------------------------

const EXP = new Uint8Array(512);
const LOG = new Uint8Array(256);
{
  let x = 1;
  for (let i = 0; i < 255; i++) {
    EXP[i] = x;
    LOG[x] = i;
    x <<= 1;
    if (x & 0x100) x ^= 0x11d;
  }
  for (let i = 255; i < 512; i++) EXP[i] = EXP[i - 255];
}

function mul(a: number, b: number): number {
  return a === 0 || b === 0 ? 0 : EXP[LOG[a] + LOG[b]];
}

function div(a: number, b: number): number {
  if (b === 0) throw new Error('divisão por zero em GF(256)');
  return a === 0 ? 0 : EXP[(LOG[a] + 255 - LOG[b]) % 255];
}

function pow2(e: number): number {
  return EXP[((e % 255) + 255) % 255];
}

/** Polinômios com o coeficiente de maior grau primeiro, como a mensagem. */
function polyEval(p: readonly number[], x: number): number {
  let y = p[0];
  for (let i = 1; i < p.length; i++) y = mul(y, x) ^ p[i];
  return y;
}

function polyScale(p: readonly number[], s: number): number[] {
  return p.map((c) => mul(c, s));
}

function polyAdd(p: readonly number[], q: readonly number[]): number[] {
  const out = new Array<number>(Math.max(p.length, q.length)).fill(0);
  for (let i = 0; i < p.length; i++) out[i + out.length - p.length] = p[i];
  for (let i = 0; i < q.length; i++) out[i + out.length - q.length] ^= q[i];
  return out;
}

function polyMul(p: readonly number[], q: readonly number[]): number[] {
  const out = new Array<number>(p.length + q.length - 1).fill(0);
  for (let j = 0; j < q.length; j++) for (let i = 0; i < p.length; i++) out[i + j] ^= mul(p[i], q[j]);
  return out;
}

/**
 * Corrige um bloco (dado + correção). Devolve o bloco corrigido, ou `null` se
 * houver mais erros do que a correção dá conta. Berlekamp–Massey, Chien e
 * Forney, com a primeira raiz em α^0 (a do gerador de `net/qr.ts`).
 */
export function rsCorrect(block: readonly number[], nsym: number): number[] | null {
  const msg = block.slice();
  const synd = [0];
  let clean = true;
  for (let i = 0; i < nsym; i++) {
    const s = polyEval(msg, pow2(i));
    synd.push(s);
    if (s !== 0) clean = false;
  }
  if (clean) return msg;

  // Berlekamp–Massey: o localizador de erros.
  let errLoc = [1];
  let oldLoc = [1];
  for (let i = 0; i < nsym; i++) {
    const kk = i + 1;
    let delta = synd[kk];
    for (let j = 1; j < errLoc.length; j++) delta ^= mul(errLoc[errLoc.length - 1 - j], synd[kk - j]);
    oldLoc = oldLoc.concat([0]);
    if (delta !== 0) {
      if (oldLoc.length > errLoc.length) {
        const newLoc = polyScale(oldLoc, delta);
        oldLoc = polyScale(errLoc, div(1, delta));
        errLoc = newLoc;
      }
      errLoc = polyAdd(errLoc, polyScale(oldLoc, delta));
    }
  }
  while (errLoc.length > 1 && errLoc[0] === 0) errLoc.shift();
  const errs = errLoc.length - 1;
  if (errs * 2 > nsym) return null;

  // Chien: as posições.
  const rev = errLoc.slice().reverse();
  const errPos: number[] = [];
  for (let i = 0; i < msg.length; i++) {
    if (polyEval(rev, pow2(i)) === 0) errPos.push(msg.length - 1 - i);
  }
  if (errPos.length !== errs) return null;

  // Forney: os valores.
  const coefPos = errPos.map((p) => msg.length - 1 - p);
  let loc = [1];
  for (const c of coefPos) loc = polyMul(loc, polyAdd([1], [pow2(c), 0]));
  const syndRev = synd.slice().reverse();
  const product = polyMul(syndRev, loc);
  const divisorLen = loc.length + 1;
  const remainder = product.slice(product.length - (divisorLen - 1));
  const errEval = remainder;
  const X = coefPos.map((c) => pow2(c));
  const E = new Array<number>(msg.length).fill(0);
  for (let i = 0; i < X.length; i++) {
    const xiInv = div(1, X[i]);
    let prime = 1;
    for (let j = 0; j < X.length; j++) if (j !== i) prime = mul(prime, 1 ^ mul(xiInv, X[j]));
    if (prime === 0) return null;
    const y = mul(X[i], polyEval(errEval, xiInv));
    E[errPos[i]] = div(y, prime);
  }
  const fixed = polyAdd(msg, E);
  // Confere: sem síndrome sobrando.
  for (let i = 0; i < nsym; i++) if (polyEval(fixed, pow2(i)) !== 0) return null;
  return fixed;
}
