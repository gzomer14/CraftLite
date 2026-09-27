/**
 * Leitor de QR próprio (M20): o computador lendo o QR do celular pela webcam.
 *
 * As imagens aqui são sintéticas, mas com o que a webcam faz de pior: o código
 * girado, em perspectiva (celular inclinado), borrado, com ruído de sensor e
 * luz desigual. O gerador é o do próprio jogo (`net/qr.ts`), e o texto é um
 * código de pareamento de verdade.
 */
import { describe, expect, it } from 'vitest';
import { encodeQr, rsRemainder, ECC_PER_BLOCK } from '../src/net/qr';
import { decodeMatrix, readQr, rsCorrect, toGray, type GrayImage } from '../src/net/qrread';
import { encodeCode } from '../src/net/base32';

/** Aleatório determinístico: o teste falha igual em qualquer máquina. */
function rng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function code(bytes: number, seed: number): string {
  const r = rng(seed);
  return encodeCode(Uint8Array.from({ length: bytes }, () => Math.floor(r() * 256)));
}

type Pt = [number, number];

/** Homografia do quadrado unitário para o quadrilátero `q` (horário a partir do canto de cima). */
function squareTo(q: [Pt, Pt, Pt, Pt]): number[] {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = q;
  const dx3 = x0 - x1 + x2 - x3;
  const dy3 = y0 - y1 + y2 - y3;
  const dx1 = x1 - x2;
  const dx2 = x3 - x2;
  const dy1 = y1 - y2;
  const dy2 = y3 - y2;
  const den = dx1 * dy2 - dx2 * dy1;
  const a13 = (dx3 * dy2 - dx2 * dy3) / den;
  const a23 = (dx1 * dy3 - dx3 * dy1) / den;
  return [x1 - x0 + a13 * x1, x3 - x0 + a23 * x3, x0, y1 - y0 + a13 * y1, y3 - y0 + a23 * y3, y0, a13, a23, 1];
}

function invert(m: number[]): number[] {
  const [a, b, c, d, e, f, g, h, i] = m;
  return [e * i - f * h, c * h - b * i, b * f - c * e, f * g - d * i, a * i - c * g, c * d - a * f,
    d * h - e * g, b * g - a * h, a * e - b * d];
}

interface Scene {
  width: number;
  height: number;
  /** Onde os quatro cantos do código (com a margem branca) caem na imagem. */
  corners: [Pt, Pt, Pt, Pt];
  blur?: boolean;
  noise?: number;
  /** Luz caindo da esquerda para a direita: 1 = nada, 0,5 = metade no lado escuro. */
  light?: number;
  seed?: number;
}

/** Desenha o QR de `text` numa foto sintética. */
function photograph(text: string, scene: Scene): GrayImage {
  const qr = encodeQr(text);
  const quiet = 4;
  const n = qr.size + quiet * 2;
  const inv = invert(squareTo(scene.corners));
  const { width, height } = scene;
  const r = rng(scene.seed ?? 1);
  let data = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const w = inv[6] * x + inv[7] * y + inv[8];
      const u = (inv[0] * x + inv[1] * y + inv[2]) / w;
      const v = (inv[3] * x + inv[4] * y + inv[5]) / w;
      let value = 90; // fundo: a mesa, a mão
      if (u >= 0 && u < 1 && v >= 0 && v < 1) {
        const mx = Math.floor(u * n) - quiet;
        const my = Math.floor(v * n) - quiet;
        const dark = mx >= 0 && my >= 0 && mx < qr.size && my < qr.size && qr.dark[my * qr.size + mx] === 1;
        value = dark ? 30 : 225;
      }
      const light = 1 - (1 - (scene.light ?? 1)) * (x / width);
      value = value * light + (r() - 0.5) * 2 * (scene.noise ?? 0);
      data[y * width + x] = Math.max(0, Math.min(255, Math.round(value)));
    }
  }
  if (scene.blur === true) {
    const out = new Uint8Array(data.length);
    for (let y = 1; y < height - 1; y++) {
      for (let x = 1; x < width - 1; x++) {
        let s = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) s += data[(y + dy) * width + x + dx];
        out[y * width + x] = Math.round(s / 9);
      }
    }
    data = out;
  }
  return { width, height, data };
}

function rotated(cx: number, cy: number, half: number, angle: number): [Pt, Pt, Pt, Pt] {
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const pt = (x: number, y: number): Pt => [cx + x * c - y * s, cy + x * s + y * c];
  return [pt(-half, -half), pt(half, -half), pt(half, half), pt(-half, half)];
}

describe('Reed–Solomon', () => {
  it('corrige até metade dos bytes de correção, em qualquer lugar do bloco', () => {
    const r = rng(7);
    for (const ecc of [10, 16, 18, 22, 26]) {
      const data = Array.from({ length: 30 }, () => Math.floor(r() * 256));
      const block = data.concat(rsRemainder(data, ecc));
      const broken = block.slice();
      const positions = new Set<number>();
      while (positions.size < ecc / 2) positions.add(Math.floor(r() * block.length));
      for (const p of positions) broken[p] ^= 1 + Math.floor(r() * 255);
      expect(rsCorrect(broken, ecc), `ecc ${ecc}`).toEqual(block);
    }
  });

  it('bloco sem erro volta igual, sem trabalho', () => {
    const data = [1, 2, 3, 4, 5, 6, 7, 8];
    const block = data.concat(rsRemainder(data, 10));
    expect(rsCorrect(block, 10)).toEqual(block);
  });

  it('erro demais não vira texto errado: devolve null ou o original', () => {
    const r = rng(11);
    const data = Array.from({ length: 20 }, () => Math.floor(r() * 256));
    const block = data.concat(rsRemainder(data, 10));
    const broken = block.slice();
    for (let i = 0; i < 9; i++) broken[i * 3] ^= 0x5a;
    const fixed = rsCorrect(broken, 10);
    expect(fixed === null || fixed.join() === block.join()).toBe(true);
  });
});

describe('da matriz ao texto', () => {
  it('lê de volta o que o gerador escreveu, das versões 1 a 8', () => {
    for (const bytes of [2, 20, 40, 60, 75, 90, 110, 128]) {
      const text = code(bytes, bytes);
      const qr = encodeQr(text);
      expect(decodeMatrix(qr.dark, qr.size), `v${qr.version}`).toBe(text);
    }
  });

  it('com módulos trocados (mancha, reflexo), ainda lê', () => {
    const text = code(84, 3);
    const qr = encodeQr(text);
    const r = rng(5);
    const dark = qr.dark.slice();
    // Uma mancha de 4×4 módulos no meio e alguns pontos soltos.
    const c = Math.floor(qr.size / 2);
    for (let y = c; y < c + 4; y++) for (let x = c; x < c + 4; x++) dark[y * qr.size + x] ^= 1;
    for (let i = 0; i < 6; i++) dark[Math.floor(r() * dark.length)] ^= 1;
    expect(decodeMatrix(dark, qr.size)).toBe(text);
  });
});

describe('da foto ao texto', () => {
  const text = code(84, 42); // um código de sala de verdade: ~138 letras, QR versão 7–8

  it('reto e nítido', () => {
    const img = photograph(text, { width: 480, height: 480, corners: rotated(240, 240, 200, 0) });
    expect(readQr(img)).toBe(text);
  });

  it('girado, borrado e com ruído de sensor', () => {
    const img = photograph(text, {
      width: 640, height: 480, corners: rotated(330, 240, 190, 0.35), blur: true, noise: 18, seed: 3,
    });
    expect(readQr(img)).toBe(text);
  });

  it('celular inclinado: perspectiva de verdade', () => {
    const img = photograph(text, {
      width: 640, height: 480, corners: [[150, 60], [470, 90], [455, 420], [170, 440]], blur: true, noise: 10,
    });
    expect(readQr(img)).toBe(text);
  });

  it('inclinação forte: a borda de cima com 70% da de baixo', () => {
    // A marca de alinhamento cai longe da estimativa do paralelogramo, e um
    // trecho de dado a imita: quem decide entre as candidatas é o Reed–Solomon.
    const c = rotated(320, 240, 160, 0.3);
    const mid: Pt = [(c[0][0] + c[1][0]) / 2, (c[0][1] + c[1][1]) / 2];
    c[0] = [mid[0] + (c[0][0] - mid[0]) * 0.7, mid[1] + (c[0][1] - mid[1]) * 0.7];
    c[1] = [mid[0] + (c[1][0] - mid[0]) * 0.7, mid[1] + (c[1][1] - mid[1]) * 0.7];
    const img = photograph(text, { width: 640, height: 480, corners: c, blur: true, noise: 15, seed: 5 });
    expect(readQr(img)).toBe(text);
  });

  it('luz desigual: um lado com metade da luz', () => {
    const img = photograph(text, {
      width: 640, height: 480, corners: rotated(320, 240, 200, -0.2), light: 0.5, noise: 8,
    });
    expect(readQr(img)).toBe(text);
  });

  it('imagem espelhada (webcam que devolve o quadro invertido)', () => {
    const img = photograph(text, { width: 480, height: 480, corners: rotated(240, 240, 200, 0) });
    const mirrored = new Uint8Array(img.data.length);
    for (let y = 0; y < img.height; y++) {
      for (let x = 0; x < img.width; x++) mirrored[y * img.width + x] = img.data[y * img.width + img.width - 1 - x];
    }
    expect(readQr({ ...img, data: mirrored })).toBe(text);
  });

  it('sem QR na imagem: null, e rápido', () => {
    const img = photograph(text, { width: 640, height: 480, corners: [[-900, -900], [-800, -900], [-800, -800], [-900, -800]], noise: 30 });
    const t0 = performance.now();
    expect(readQr(img)).toBeNull();
    expect(performance.now() - t0).toBeLessThan(200);
  });

  it('um quadro de 640×480 custa pouco: dá para tentar várias vezes por segundo', () => {
    const img = photograph(text, { width: 640, height: 480, corners: rotated(320, 240, 180, 0.2), blur: true, noise: 10 });
    readQr(img);
    const t0 = performance.now();
    for (let i = 0; i < 5; i++) expect(readQr(img)).toBe(text);
    expect((performance.now() - t0) / 5).toBeLessThan(120);
  });

  it('toGray converte RGBA', () => {
    const g = toGray(Uint8ClampedArray.from([255, 255, 255, 255, 0, 0, 0, 255]), 2, 1);
    expect(Array.from(g.data)).toEqual([255, 0]);
  });

  it('as versões de ECC do leitor são as do gerador', () => {
    expect(ECC_PER_BLOCK[1]).toBe(10);
  });
});
