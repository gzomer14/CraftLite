/**
 * Cantos de escada (doc 04 §3).
 *
 * A propriedade que define um canto correto não é o nome (interno/externo) nem
 * a rotação: é a **continuidade**. A superfície alta de duas escadas
 * perpendiculares vizinhas tem que se encontrar pela face que elas dividem, sem
 * degrau flutuando nem buraco. É isso que os testes abaixo medem, e é por isso
 * que eles não dependem de convenção de nomenclatura nenhuma.
 *
 * O outro contrato é o do cabeçalho de `mesh/shapes.ts`: desenho e colisão saem
 * da **mesma** conta.
 */
import { describe, expect, it } from 'vitest';
import {
  BOX_STRIDE, CORNER_INNER, CORNER_NONE, CORNER_OUTER, MAX_BOXES, NOT_STAIRS, SHAPE_STAIRS,
  boxesFor, collisionBoxesFor, stairCornerFrom,
} from '../src/world/mesh/shapes';

const BOXES = new Float32Array(MAX_BOXES * BOX_STRIDE);

/** Volume total das caixas de uma escada, em blocos cúbicos. */
function volumeOf(bits: number, corner: number): number {
  const count = boxesFor(SHAPE_STAIRS, bits, corner, BOXES);
  let total = 0;
  for (let b = 0; b < count; b++) {
    const o = b * BOX_STRIDE;
    total += (BOXES[o + 3] - BOXES[o]) * (BOXES[o + 4] - BOXES[o + 1])
      * (BOXES[o + 5] - BOXES[o + 2]);
  }
  return total;
}

/** true se o ponto está dentro de alguma caixa da escada. */
function contains(bits: number, corner: number, x: number, y: number, z: number): boolean {
  const count = boxesFor(SHAPE_STAIRS, bits, corner, BOXES);
  for (let b = 0; b < count; b++) {
    const o = b * BOX_STRIDE;
    if (x >= BOXES[o] && x <= BOXES[o + 3]
      && y >= BOXES[o + 1] && y <= BOXES[o + 4]
      && z >= BOXES[o + 2] && z <= BOXES[o + 5]) return true;
  }
  return false;
}

describe('geometria da escada', () => {
  it('a reta ocupa três quartos do bloco, em qualquer direção', () => {
    for (let facing = 0; facing < 4; facing++) {
      expect(volumeOf(facing, CORNER_NONE), `facing ${facing}`).toBeCloseTo(0.75, 6);
    }
  });

  it('o canto externo tira um quarto; o interno põe um quarto', () => {
    // Externo: base (0,5) + um quarto (0,125) = 0,625.
    expect(volumeOf(0, CORNER_OUTER | (2 << 2))).toBeCloseTo(0.625, 6);
    // Interno: base (0,5) + metade (0,25) + um quarto (0,125) = 0,875.
    expect(volumeOf(0, CORNER_INNER | (2 << 2))).toBeCloseTo(0.875, 6);
  });

  it('nenhuma forma passa do teto de caixas do mesher', () => {
    for (let facing = 0; facing < 4; facing++) {
      for (const kind of [CORNER_NONE, CORNER_OUTER, CORNER_INNER]) {
        for (let q = 0; q < 4; q++) {
          const count = boxesFor(SHAPE_STAIRS, facing, kind | (q << 2), BOXES);
          expect(count).toBeLessThanOrEqual(MAX_BOXES);
        }
      }
    }
  });

  it('de cabeça para baixo espelha em Y, sem mudar o volume', () => {
    expect(volumeOf(0, CORNER_NONE)).toBeCloseTo(volumeOf(4, CORNER_NONE), 6);
    // Na reta normal o degrau está em cima; na invertida, embaixo.
    expect(contains(0, CORNER_NONE, 0.25, 0.75, 0.5)).toBe(true);
    expect(contains(4, CORNER_NONE, 0.25, 0.25, 0.5)).toBe(true);
  });

  it('a base de meia altura existe nas três formas', () => {
    for (const kind of [CORNER_NONE, CORNER_OUTER, CORNER_INNER]) {
      expect(contains(0, kind | (2 << 2), 0.9, 0.25, 0.9), `kind ${kind}`).toBe(true);
    }
  });
});

describe('escolha do canto a partir dos vizinhos', () => {
  /** Escada com o lado alto em `tall` (índice de `FACING_STEP`). */
  const stairWithTall = (tall: number): number => tall ^ 1;

  it('sem escada em volta, é reta', () => {
    const bits = stairWithTall(1);
    expect(stairCornerFrom(bits, NOT_STAIRS, NOT_STAIRS, NOT_STAIRS, NOT_STAIRS))
      .toBe(CORNER_NONE);
  });

  it('vizinho do mesmo eixo não faz canto', () => {
    // Lado alto em −X; vizinho em −X também com eixo X: é degrau, não curva.
    const bits = stairWithTall(1);
    const neighbor = stairWithTall(0);
    expect(stairCornerFrom(bits, NOT_STAIRS, neighbor, NOT_STAIRS, NOT_STAIRS))
      .toBe(CORNER_NONE);
  });

  it('vizinho perpendicular do lado alto faz canto externo (M23: estava trocado)', () => {
    // Nossa metade alta em −X; vizinho em −X com metade alta em +Z.
    const bits = stairWithTall(1);
    const corner = stairCornerFrom(bits, NOT_STAIRS, stairWithTall(2), NOT_STAIRS, NOT_STAIRS);
    expect(corner & 3).toBe(CORNER_OUTER);
    // O quarto escolhido é o lado alto do vizinho.
    expect((corner >>> 2) & 3).toBe(2);
  });

  it('vizinho perpendicular do lado aberto faz canto interno', () => {
    // Lado alto em −X ⇒ lado aberto em +X.
    const bits = stairWithTall(1);
    const corner = stairCornerFrom(bits, stairWithTall(3), NOT_STAIRS, NOT_STAIRS, NOT_STAIRS);
    expect(corner & 3).toBe(CORNER_INNER);
    expect((corner >>> 2) & 3).toBe(3);
  });

  it('entre duas perpendiculares, o externo vence, como no gênero', () => {
    const bits = stairWithTall(1);
    const corner = stairCornerFrom(bits, stairWithTall(3), stairWithTall(2), NOT_STAIRS, NOT_STAIRS);
    expect(corner & 3).toBe(CORNER_OUTER);
  });

  it('quina de três: com uma escada igual do lado da curva, continua reta', () => {
    // Externo: vizinho do lado alto (−X) com metade alta em +Z; a curva sairia
    // para −Z, e lá está uma escada igual à nossa — a fila reta continua.
    const bits = stairWithTall(1);
    expect(stairCornerFrom(bits, NOT_STAIRS, stairWithTall(2), NOT_STAIRS, bits))
      .toBe(CORNER_NONE);
    // Uma escada diferente ali não impede.
    expect(stairCornerFrom(bits, NOT_STAIRS, stairWithTall(2), NOT_STAIRS, stairWithTall(2)) & 3)
      .toBe(CORNER_OUTER);
    // Interno: vizinho do lado aberto (+X) com metade alta em −Z; a curva
    // encosta em −Z, e uma escada igual lá mantém a reta.
    expect(stairCornerFrom(bits, stairWithTall(3), NOT_STAIRS, NOT_STAIRS, bits))
      .toBe(CORNER_NONE);
  });

  it('lado de cima diferente não faz canto', () => {
    // Uma normal e uma invertida não têm superfície alta na mesma altura.
    const bits = stairWithTall(1);
    const upsideDown = stairWithTall(2) | 4;
    expect(stairCornerFrom(bits, NOT_STAIRS, upsideDown, NOT_STAIRS, NOT_STAIRS))
      .toBe(CORNER_NONE);
  });
});

describe('continuidade entre duas escadas vizinhas', () => {
  /**
   * A propriedade que define o canto certo, medida **dos dois lados** da face
   * compartilhada (M23). Até o M23 o teste olhava só o nosso lado, e a regra
   * de interno e externo saiu trocada sem ninguém ver: a nossa faixa alta
   * batia numa parede baixa do vizinho.
   *
   * Para cada direção nossa e cada vizinho perpendicular, dos dois lados (alto
   * e aberto): ao longo da face, a parte alta de cá e a de lá cobrem os mesmos
   * pontos. O vizinho é reto (ele não vê a nossa escada no eixo dele).
   */
  const STEP = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const UPPER = 0.75;

  it('dos dois lados da face, a parte alta cobre a mesma faixa', () => {
    for (let ourTall = 0; ourTall < 4; ourTall++) {
      const ours = ourTall ^ 1;
      for (const side of [ourTall, ourTall ^ 1]) {
        for (let theirTall = 0; theirTall < 4; theirTall++) {
          if ((theirTall >> 1) === (ourTall >> 1)) continue; // mesmo eixo: não é canto
          const theirs = theirTall ^ 1;
          const nb = [NOT_STAIRS, NOT_STAIRS, NOT_STAIRS, NOT_STAIRS];
          nb[side] = theirs;
          const corner = stairCornerFrom(ours, nb[0], nb[1], nb[2], nb[3]);
          const [sx, sz] = STEP[side];
          for (const t of [0.1, 0.4, 0.6, 0.9]) {
            // Ponto junto à face, do nosso lado e do lado do vizinho.
            const ox = sx === 0 ? t : sx > 0 ? 0.99 : 0.01;
            const oz = sz === 0 ? t : sz > 0 ? 0.99 : 0.01;
            const tx = sx === 0 ? t : sx > 0 ? 0.01 : 0.99;
            const tz = sz === 0 ? t : sz > 0 ? 0.01 : 0.99;
            const here = contains(ours, corner, ox, UPPER, oz);
            const there = contains(theirs, CORNER_NONE, tx, UPPER, tz);
            expect(here, `alto ${ourTall}, vizinho em ${side} com alto ${theirTall}, t ${t}`).toBe(there);
          }
        }
      }
    }
  });

  it('telhado em pirâmide: a quina fica com o quarto de dentro, não com o degrau cheio', () => {
    // Quina NE de uma pirâmide: a nossa sobe para +Z (o centro), o vizinho em
    // +Z é da beira leste e sobe para −X. Sobra só o quarto (−X, +Z).
    const ours = 2 ^ 1;
    const corner = stairCornerFrom(ours, NOT_STAIRS, NOT_STAIRS, 1 ^ 1, NOT_STAIRS);
    expect(corner & 3).toBe(CORNER_OUTER);
    expect(contains(ours, corner, 0.25, UPPER, 0.75)).toBe(true);
    expect(contains(ours, corner, 0.75, UPPER, 0.75)).toBe(false);
  });
});

describe('desenho e colisão saem da mesma conta', () => {
  it('a colisão da escada é idêntica ao desenho, canto por canto', () => {
    const draw = new Float32Array(MAX_BOXES * BOX_STRIDE);
    const collide = new Float32Array(MAX_BOXES * BOX_STRIDE);
    for (let bits = 0; bits < 8; bits++) {
      for (const kind of [CORNER_NONE, CORNER_OUTER, CORNER_INNER]) {
        for (let q = 0; q < 4; q++) {
          const corner = kind | (q << 2);
          const a = boxesFor(SHAPE_STAIRS, bits, corner, draw);
          const b = collisionBoxesFor(SHAPE_STAIRS, bits, collide, corner);
          expect(b, `bits ${bits} corner ${corner}`).toBe(a);
          for (let i = 0; i < a * BOX_STRIDE; i++) {
            expect(collide[i], `bits ${bits} corner ${corner} n${i}`).toBe(draw[i]);
          }
        }
      }
    }
  });
});
