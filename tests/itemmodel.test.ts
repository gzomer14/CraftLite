/**
 * Extrusão do sprite de item (M8).
 *
 * O que estes testes protegem é a razão de o módulo existir: a ferramenta na
 * mão tinha espessura zero e sumia de perfil. Então o que se verifica é
 * **volume** — que existe geometria fora do plano z = 0, que a borda sai onde a
 * silhueta termina, e que as corridas fundem em vez de emitir um quad por pixel.
 */
import { describe, expect, it } from 'vitest';
import {
  ITEM_FLOATS_PER_VERTEX, buildExtrudedSprite, extrudedVertexCapacity, maskFromSheet,
} from '../src/render/itemmodel';

const HALF = 0.75;
const THICK = 0.1875;

/** Máscara de `size`×`size` a partir de linhas de texto (`#` = opaco). */
function maskOf(rows: string[]) {
  return {
    size: rows.length,
    opaque(x: number, y: number): boolean {
      if (y < 0 || y >= rows.length) return false;
      const row = rows[y];
      if (x < 0 || x >= row.length) return false;
      return row[x] === '#';
    },
  };
}

function build(rows: string[]) {
  const out = new Float32Array(extrudedVertexCapacity(rows.length) * ITEM_FLOATS_PER_VERTEX);
  const count = buildExtrudedSprite(out, maskOf(rows), 3, HALF, THICK);
  const verts: { x: number; y: number; z: number; u: number; v: number; tile: number; shade: number }[] = [];
  for (let i = 0; i < count; i++) {
    const o = i * ITEM_FLOATS_PER_VERTEX;
    verts.push({
      x: out[o], y: out[o + 1], z: out[o + 2],
      u: out[o + 3], v: out[o + 4], tile: out[o + 5], shade: out[o + 6],
    });
  }
  return { count, verts };
}

/** Um bloco 2×2 no meio de uma máscara 4×4. */
const SQUARE = ['....', '.##.', '.##.', '....'];

describe('extrusão do sprite', () => {
  it('tem frente, verso e espessura entre os dois', () => {
    const { verts } = build(SQUARE);
    const front = verts.filter((v) => v.z > 0);
    const back = verts.filter((v) => v.z < 0);
    expect(front.length).toBeGreaterThan(0);
    expect(back.length).toBeGreaterThan(0);
    // Nenhum vértice fica no plano zero: o adesivo virou chapa.
    expect(verts.some((v) => v.z === 0)).toBe(false);
    expect(Math.max(...verts.map((v) => v.z)) - Math.min(...verts.map((v) => v.z)))
      .toBeCloseTo(THICK, 6);
  });

  it('o quadrado 2×2 gasta 6 quads: frente, verso e 4 bordas', () => {
    const { count } = build(SQUARE);
    expect(count).toBe(6 * 6);
  });

  /*
   * A fusão de corridas é o que mantém a picareta de 32 px viável: sem ela
   * cada pixel de borda vira um quad.
   */
  it('uma coluna de 4 pixels fica com uma borda por lado, não quatro', () => {
    const coluna = build(['.#..', '.#..', '.#..', '.#..']);
    const pixel = build(['.#..', '....', '....', '....']);
    // Coluna: 2 faces + 2 laterais longas + topo + base = 6 quads.
    expect(coluna.count).toBe(6 * 6);
    expect(pixel.count).toBe(6 * 6);
  });

  it('a borda sai na divisa da silhueta, não na do sprite', () => {
    const { verts } = build(SQUARE);
    // Só as bordas laterais: a frente e o verso cobrem o tile inteiro.
    const laterais = verts.filter((v) => Math.abs(v.shade - 0.78) < 1e-6);
    const xs = laterais.map((v) => v.x);
    // O quadrado ocupa as colunas 1 e 2 de 4: −0,375 e +0,375 em modelo.
    expect(Math.min(...xs)).toBeCloseTo(-HALF / 2, 6);
    expect(Math.max(...xs)).toBeCloseTo(HALF / 2, 6);
  });

  it('a borda amostra o pixel de dentro, para pegar a cor da peça', () => {
    const { verts } = build(SQUARE);
    // Borda esquerda do quadrado: amostra a coluna 1 (centro em 1,5/4).
    const esquerda = verts.filter(
      (v) => Math.abs(v.x + HALF / 2) < 1e-6 && Math.abs(v.shade - 0.78) < 1e-6,
    );
    expect(esquerda.length).toBeGreaterThan(0);
    for (const v of esquerda) expect(v.u).toBeCloseTo(1.5 / 4, 6);
  });

  it('as faces têm sombras diferentes, senão a silhueta fica chapada', () => {
    const { verts } = build(SQUARE);
    const shades = new Set(verts.map((v) => v.shade));
    expect(shades.size).toBeGreaterThanOrEqual(3);
  });

  it('máscara vazia não gera geometria de borda', () => {
    const { count } = build(['....', '....', '....', '....']);
    expect(count).toBe(12); // só frente e verso
  });

  it('o sprite cheio tem borda só no contorno do tile', () => {
    const { count } = build(['####', '####', '####', '####']);
    expect(count).toBe(6 * 6);
  });

  it('o índice do tile vai em todos os vértices', () => {
    const { verts } = build(SQUARE);
    for (const v of verts) expect(v.tile).toBe(3);
  });

  it('a capacidade calculada cobre o pior caso, o xadrez', () => {
    const size = 8;
    const rows: string[] = [];
    for (let y = 0; y < size; y++) {
      let row = '';
      for (let x = 0; x < size; x++) row += (x + y) % 2 === 0 ? '#' : '.';
      rows.push(row);
    }
    const out = new Float32Array(extrudedVertexCapacity(size) * ITEM_FLOATS_PER_VERTEX);
    const count = buildExtrudedSprite(out, maskOf(rows), 0, HALF, THICK);
    // 32 pixels isolados × 4 bordas + frente e verso.
    expect(count).toBe((32 * 4 + 2) * 6);
    expect(count).toBeLessThanOrEqual(extrudedVertexCapacity(size));
  });
});

describe('máscara vinda da folha de sprites', () => {
  it('lê o tile certo e corta em alfa 0,5', () => {
    // Folha de 2 colunas × 1 linha, tiles de 2×2.
    const pixels = new Uint8ClampedArray(4 * 2 * 4);
    const set = (x: number, y: number, a: number) => { pixels[((y * 4) + x) * 4 + 3] = a; };
    set(2, 0, 255); // primeiro pixel do tile 1
    set(3, 0, 100); // abaixo do corte
    const mask = maskFromSheet(pixels, 4, 2, 2, 1);
    expect(mask.opaque(0, 0)).toBe(true);
    expect(mask.opaque(1, 0)).toBe(false);
    expect(mask.opaque(0, 1)).toBe(false);
    // Fora do tile é sempre vazio: a borda do sprite é borda de verdade.
    expect(mask.opaque(-1, 0)).toBe(false);
    expect(mask.opaque(2, 0)).toBe(false);
  });
});
