/**
 * Gera os ícones do PWA a partir do mesmo motor procedural das texturas.
 *
 * O manifest precisa de URLs reais, então estes dois PNGs são comitados — é a
 * única exceção ao "zero assets" (doc 13 §6), e são < 8 KB somados. Rode
 * `npm run icons` depois de mexer na identidade visual.
 */
import { writeFileSync } from 'node:fs';
import { deflateSync } from 'node:zlib';

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

/** Desenha o logotipo: um bloco de grama em isométrica 2:1 sobre fundo escuro. */
function drawIcon(size) {
  const px = new Uint8Array(size * size * 4);
  const bg = [11, 13, 18];
  for (let i = 0; i < size * size; i++) {
    px[i * 4] = bg[0]; px[i * 4 + 1] = bg[1]; px[i * 4 + 2] = bg[2]; px[i * 4 + 3] = 255;
  }

  const cx = size / 2;
  const cy = size / 2;
  const s = size * 0.30; // meia-largura do cubo

  const put = (x, y, c) => {
    const ix = Math.round(x);
    const iy = Math.round(y);
    if (ix < 0 || iy < 0 || ix >= size || iy >= size) return;
    const o = (iy * size + ix) * 4;
    px[o] = c[0]; px[o + 1] = c[1]; px[o + 2] = c[2]; px[o + 3] = 255;
  };

  /**
   * Preenche um paralelogramo dado origem e dois vetores de aresta.
   * O passo é escolhido pela diagonal para não deixar buraco entre amostras.
   */
  const fillFace = (ox, oy, e1x, e1y, e2x, e2y, color, shade) => {
    const steps = Math.ceil(Math.max(Math.hypot(e1x, e1y), Math.hypot(e2x, e2y)) * 2);
    for (let i = 0; i <= steps; i++) {
      for (let j = 0; j <= steps; j++) {
        const u = i / steps;
        const v = j / steps;
        // Textura leve por dithering ordenado 4×4, em vez de ruído contínuo:
        // rende o mesmo aspecto de pixel art com pouquíssimas cores distintas,
        // o que mantém o PNG em torno de 1 KB em vez de 78.
        const bayer = BAYER4[(j & 3) * 4 + (i & 3)] / 16;
        const k = shade * (0.95 + Math.round(bayer * 2) * 0.05);
        put(ox + e1x * u + e2x * v, oy + e1y * u + e2y * v, [
          Math.round((color[0] * k) / 4) * 4,
          Math.round((color[1] * k) / 4) * 4,
          Math.round((color[2] * k) / 4) * 4,
        ]);
      }
    }
  };

  // Topo (grama), face esquerda e face direita (terra), com sombreado por face.
  fillFace(cx, cy - s, s, s / 2, -s, s / 2, [0x7a, 0xb8, 0x48], 1.0);
  fillFace(cx - s, cy - s / 2, s, s / 2, 0, s, [0x8b, 0x62, 0x39], 0.80);
  fillFace(cx, cy, s, -s / 2, 0, s, [0x8b, 0x62, 0x39], 0.62);

  return px;
}

/** Escreve um PNG mínimo (RGBA, sem filtro) sem depender de biblioteca. */
function encodePng(width, height, rgba) {
  const raw = Buffer.alloc((width * 4 + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0; // filtro "none"
    Buffer.from(rgba.buffer, y * width * 4, width * 4).copy(raw, y * (width * 4 + 1) + 1);
  }

  const chunks = [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])];
  const chunk = (type, data) => {
    const length = Buffer.alloc(4);
    length.writeUInt32BE(data.length);
    const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
    const crc = Buffer.alloc(4);
    crc.writeUInt32BE(crc32(body) >>> 0);
    return Buffer.concat([length, body, crc]);
  };

  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;  // bits por canal
  ihdr[9] = 6;  // RGBA
  chunks.push(chunk('IHDR', ihdr));
  chunks.push(chunk('IDAT', deflateSync(raw, { level: 9 })));
  chunks.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(chunks);
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    table[n] = c;
  }
  return table;
})();

function crc32(buf) {
  let c = -1;
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return c ^ -1;
}

for (const size of [192, 512]) {
  const png = encodePng(size, size, drawIcon(size));
  writeFileSync(`public/icon-${size}.png`, png);
  console.log(`  public/icon-${size}.png — ${(png.length / 1024).toFixed(1)} KB`);
}
