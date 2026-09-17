/**
 * Placa com texto (doc 14 — M8): fonte, guarda do texto e geometria.
 *
 * O teste que mais paga aqui é o de **glifos repetidos**: uma tabela de 76
 * desenhos escrita à mão erra por cópia, e o sintoma — dois caracteres com o
 * mesmo desenho — é exatamente o que aconteceu com os seis blocos de tábua no
 * inventário em 2026-09-16. Errar duas vezes o mesmo erro é que seria imperdoável.
 */

import { describe, expect, it } from 'vitest';
import {
  CELL_H, CELL_W, FONT_AUTHORED, FONT_CHARS, FONT_SIZE, GLYPH_H,
  glyphCell, glyphOf, toFontText,
} from '../src/data/font';
import { buildFontSheet } from '../src/render/fontgen';
import { SIGN_COLUMNS, SIGN_LINES, SignStore, sanitizeSignLine } from '../src/game/signs';
import { writeSignQuads } from '../src/render/signtext';

describe('fonte de bitmap', () => {
  it('cabe na folha', () => {
    expect(FONT_CHARS.length).toBeLessThanOrEqual((FONT_SIZE / CELL_W) * (FONT_SIZE / CELL_H));
  });

  it('a ordem das células cobre a tabela inteira', () => {
    expect(FONT_CHARS.length).toBe(FONT_AUTHORED);
  });

  it('não tem caractere repetido', () => {
    expect(new Set(FONT_CHARS).size).toBe(FONT_CHARS.length);
  });

  it('o espaço é a primeira célula e não tem tinta', () => {
    expect(glyphCell(' ')).toBe(0);
    expect(glyphOf(' ').rows.every((row) => row === 0)).toBe(true);
  });

  it('nenhum par de caracteres tem o mesmo desenho', () => {
    const seen = new Map<string, string>();
    for (const ch of FONT_CHARS) {
      if (ch === ' ') continue;
      const glyph = glyphOf(ch);
      const key = `${glyph.rows.join(',')}|${glyph.mark?.join(',') ?? ''}|${glyph.markBelow}`;
      const previous = seen.get(key);
      expect(previous, `${ch} tem o mesmo desenho de ${previous}`).toBeUndefined();
      seen.set(key, ch);
    }
  });

  it('todo glifo tem sete linhas e nenhuma passa de cinco bits', () => {
    for (const ch of FONT_CHARS) {
      const glyph = glyphOf(ch);
      expect(glyph.rows.length).toBe(GLYPH_H);
      for (const row of glyph.rows) expect(row).toBeLessThan(1 << 5);
      if (glyph.mark !== null) {
        expect(glyph.mark.length).toBe(2);
        for (const row of glyph.mark) expect(row).toBeLessThan(1 << 5);
      }
    }
  });

  it('acentuado reusa a letra base', () => {
    expect(glyphOf('Á').rows).toBe(glyphOf('A').rows);
    expect(glyphOf('Ã').rows).toBe(glyphOf('A').rows);
    expect(glyphOf('Ç').rows).toBe(glyphOf('C').rows);
    expect(glyphOf('Ç').markBelow).toBe(true);
    expect(glyphOf('Á').markBelow).toBe(false);
  });

  it('a folha desenhada tem tinta em toda célula com glifo', () => {
    const sheet = buildFontSheet();
    expect(sheet.length).toBe(FONT_SIZE * FONT_SIZE * 4);
    const columns = FONT_SIZE / CELL_W;
    for (let cell = 1; cell < FONT_CHARS.length; cell++) {
      const cx = (cell % columns) * CELL_W;
      const cy = Math.floor(cell / columns) * CELL_H;
      let ink = 0;
      for (let y = 0; y < CELL_H; y++) {
        for (let x = 0; x < CELL_W; x++) {
          if (sheet[((cy + y) * FONT_SIZE + cx + x) * 4 + 3] > 0) ink++;
        }
      }
      expect(ink, `célula ${cell} (${FONT_CHARS[cell]}) saiu vazia`).toBeGreaterThan(0);
    }
  });

  it('a folha não escreve fora da célula', () => {
    const sheet = buildFontSheet();
    // Coluna 0 de cada célula é a folga lateral: com filtro linear ela é o que
    // impede duas letras vizinhas de se tocarem.
    for (let y = 0; y < FONT_SIZE; y++) {
      for (let cx = 0; cx < FONT_SIZE; cx += CELL_W) {
        expect(sheet[(y * FONT_SIZE + cx) * 4 + 3]).toBe(0);
      }
    }
  });
});

describe('normalização de texto', () => {
  it('sobe para caixa alta', () => {
    expect(toFontText('casa')).toBe('CASA');
  });

  it('mantém acento que a fonte tem', () => {
    expect(toFontText('sótão')).toBe('SÓTÃO');
  });

  it('o que a fonte não desenha vira espaço', () => {
    expect(toFontText('a\u0001b')).toBe('A B');
  });

  it('corta no tamanho da placa e tira o espaço do fim', () => {
    expect(sanitizeSignLine('abcdefghijklmnopqrst')).toBe('ABCDEFGHIJKLMNO');
    expect(sanitizeSignLine('oi   ')).toBe('OI');
    expect(sanitizeSignLine('abcdefghijklmn  ').length).toBeLessThanOrEqual(SIGN_COLUMNS);
  });
});

describe('guarda das placas', () => {
  it('grava e lê pelo lugar', () => {
    const store = new SignStore();
    store.set(3, 70, -5, ['casa', 'do', 'joao']);
    expect(store.get(3, 70, -5)).toEqual(['CASA', 'DO', 'JOAO', '']);
    expect(store.get(3, 70, -4)).toBeNull();
  });

  it('placa em branco não ocupa registro', () => {
    const store = new SignStore();
    store.set(0, 0, 0, ['', '', '', '']);
    expect(store.size).toBe(0);
    store.set(0, 0, 0, ['oi']);
    expect(store.size).toBe(1);
    // Apagar o texto apaga o registro: senão o save cresceria com placas vazias.
    store.set(0, 0, 0, ['']);
    expect(store.size).toBe(0);
  });

  it('quebrar a placa leva o texto', () => {
    const store = new SignStore();
    store.set(1, 2, 3, ['oi']);
    store.remove(1, 2, 3);
    expect(store.get(1, 2, 3)).toBeNull();
  });

  it('coordenada negativa não colide com positiva', () => {
    const store = new SignStore();
    store.set(-1, 64, -1, ['esquerda']);
    store.set(1, 64, 1, ['direita']);
    expect(store.get(-1, 64, -1)?.[0]).toBe('ESQUERDA');
    expect(store.get(1, 64, 1)?.[0]).toBe('DIREITA');
  });

  it('sobrevive a um round-trip de save', () => {
    const store = new SignStore();
    store.set(10, 70, -20, ['bem-vindo', 'à', 'fazenda']);
    const records = store.records();
    expect(records).toHaveLength(1);
    expect(records[0].kind).toBe('sign');

    const restored = new SignStore();
    for (const record of records) restored.restore(record);
    expect(restored.get(10, 70, -20)).toEqual(store.get(10, 70, -20));
  });
});

/** Quantos vértices `writeSignQuads` escreveu. */
function vertexCount(floats: number): number {
  return floats / 5;
}

describe('geometria do texto', () => {
  const buffer = new Float32Array(1024 * 6 * 5);

  it('um quad por letra, e nenhum pelo espaço', () => {
    const write = writeSignQuads(buffer, 0, 0, 64, 0, 0, ['AB C', '', '', '']);
    // 3 letras × 6 vértices; o espaço não vira quad.
    expect(vertexCount(write)).toBe(18);
  });

  it('placa vazia não escreve nada', () => {
    expect(writeSignQuads(buffer, 0, 0, 64, 0, 0, ['', '', '', ''])).toBe(0);
  });

  it('respeita o teto do buffer em vez de estourar', () => {
    const tiny = new Float32Array(6 * 5 * 2);
    const write = writeSignQuads(tiny, 0, 0, 64, 0, 0, ['ABCDEFGHIJ', '', '', '']);
    expect(write).toBeLessThanOrEqual(tiny.length);
    expect(vertexCount(write)).toBe(12);
  });

  it('o texto fica na face que olha de volta para quem plantou', () => {
    // facing 0 = jogador olhava +X, então a face escrita é a de −X.
    let write = writeSignQuads(buffer, 0, 10, 64, 20, 0, ['A', '', '', '']);
    for (let i = 0; i < write; i += 5) expect(buffer[i]).toBeCloseTo(10 + 0.5 - 1 / 16 - 0.002, 5);

    write = writeSignQuads(buffer, 0, 10, 64, 20, 1, ['A', '', '', '']);
    for (let i = 0; i < write; i += 5) expect(buffer[i]).toBeCloseTo(10 + 0.5 + 1 / 16 + 0.002, 5);

    write = writeSignQuads(buffer, 0, 10, 64, 20, 3, ['A', '', '', '']);
    for (let i = 0; i < write; i += 5) {
      expect(buffer[i + 2]).toBeCloseTo(20 + 0.5 + 1 / 16 + 0.002, 5);
    }
  });

  it('nenhuma letra sai da tábua', () => {
    const lines = ['ABCDEFGHIJKLMNO', 'ABCDEFGHIJKLMNO', 'ABCDEFGHIJKLMNO', 'ABCDEFGHIJKLMNO'];
    for (let facing = 0; facing < 4; facing++) {
      const write = writeSignQuads(buffer, 0, 0, 64, 0, facing, lines);
      expect(vertexCount(write)).toBe(SIGN_COLUMNS * SIGN_LINES * 6);
      for (let i = 0; i < write; i += 5) {
        const x = buffer[i];
        const y = buffer[i + 1];
        const z = buffer[i + 2];
        expect(y).toBeGreaterThanOrEqual(64 + 0.5);
        expect(y).toBeLessThanOrEqual(65);
        // O eixo que corre com o texto tem de caber na largura da tábua.
        const horizontal = facing < 2 ? z : x;
        expect(horizontal).toBeGreaterThanOrEqual(1 / 8 - 1e-6);
        expect(horizontal).toBeLessThanOrEqual(7 / 8 + 1e-6);
      }
    }
  });

  it('as linhas ficam em alturas diferentes e na ordem certa', () => {
    const write = writeSignQuads(buffer, 0, 0, 64, 0, 0, ['A', 'B', 'C', 'D']);
    expect(vertexCount(write)).toBe(24);
    // Primeiro vértice de cada letra é o canto de cima; linha 1 acima da 2.
    const tops: number[] = [];
    for (let letter = 0; letter < 4; letter++) tops.push(buffer[letter * 30 + 1]);
    for (let i = 1; i < tops.length; i++) expect(tops[i]).toBeLessThan(tops[i - 1]);
  });
});
