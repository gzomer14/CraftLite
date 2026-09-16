/**
 * Sprite de item transformado em **sólido** (M8).
 *
 * A espada na mão do jogador era um quad: um adesivo de espessura zero, que
 * some quando visto de lado e não tem lugar nenhum onde a luz bata diferente.
 * Era a queixa mais direta sobre o acabamento do jogo — *"as texturas das
 * ferramentas na mão são chapadas"* — e a correção é a do gênero: **extrudar a
 * silhueta**.
 *
 * O desenho continua sendo o mesmo da folha de sprites, pixel por pixel. O que
 * este módulo faz é ler a **máscara de opacidade** dele e montar uma casca:
 *
 *  - **frente e verso** — dois quads do tamanho do sprite, com a própria
 *    textura. O recorte de alfa do shader apaga o que é transparente, então
 *    não é preciso um quad por pixel;
 *  - **bordas** — um quad por aresta da silhueta, ligando a frente ao verso. É
 *    o que dá espessura: olhando de lado, a espada é uma lâmina, não uma linha.
 *
 * As arestas são **fundidas em corridas** (a mesma ideia do greedy meshing do
 * terreno): um cabo reto de 10 px vira um quad, não dez. Uma picareta de 16×16
 * sai com ~30 quads em vez de ~120, e a folha de 32 px do estilo Nítido não
 * explode o buffer.
 *
 * Cada aresta amostra a textura **no pixel da própria borda**, com UV
 * fracionário: a lateral da lâmina sai com a cor da lâmina, e a do cabo com a
 * cor do cabo. É o que separa esta extrusão de "o mesmo quad com um cinza dos
 * lados".
 *
 * Puro e sem GL: recebe máscara, devolve floats. Roda uma vez por troca de
 * item na mão — nunca por frame.
 */

/** 7 floats por vértice: posição (3), uv (2), tile (1) e sombra de face (1). */
export const ITEM_FLOATS_PER_VERTEX = 7;

/**
 * Sombra de cada orientação de face, na mesma ideia do mesher: sem ela a
 * extrusão vira uma silhueta chapada com contorno, que é o que ela veio
 * substituir.
 */
const SHADE_FRONT = 1;
const SHADE_BACK = 0.62;
const SHADE_SIDE_X = 0.78;
const SHADE_SIDE_Y = 0.88;

/** Máscara de opacidade do sprite: true onde o pixel é desenhado. */
export interface SpriteMask {
  size: number;
  opaque(x: number, y: number): boolean;
}

/**
 * Máscara a partir dos pixels de uma folha de sprites.
 *
 * `tile` é o índice do tile na folha; `columns` e `size` dizem onde ele começa.
 * O corte é em alfa 0,5 — o mesmo do `discard` do shader, senão a borda
 * geométrica não bate com a borda desenhada.
 */
export function maskFromSheet(
  pixels: Uint8ClampedArray, sheetWidth: number, columns: number, size: number, tile: number,
): SpriteMask {
  const ox = (tile % columns) * size;
  const oy = Math.floor(tile / columns) * size;
  return {
    size,
    opaque(x: number, y: number): boolean {
      if (x < 0 || y < 0 || x >= size || y >= size) return false;
      return pixels[(((oy + y) * sheetWidth) + ox + x) * 4 + 3] >= 128;
    },
  };
}

/**
 * Quantos vértices a extrusão de `mask` vai gastar, no pior caso.
 *
 * Serve para dimensionar o buffer **antes** de construir, que é o que permite
 * ao chamador alocar uma vez e nunca mais. O pior caso é um xadrez: cada pixel
 * opaco com os quatro vizinhos vazios, quatro arestas por pixel.
 */
export function extrudedVertexCapacity(size: number): number {
  // 2 faces + 4 arestas por pixel de uma linha/coluna alternada.
  const edges = 2 * size * (size + 1);
  return (2 + edges) * 6;
}

/**
 * Monta a casca extrudada em `out` e devolve quantos vértices escreveu.
 *
 * `half` é a meia-altura do sprite em unidades de modelo (o sprite fica
 * centrado na origem) e `thickness` a espessura total da chapa.
 */
export function buildExtrudedSprite(
  out: Float32Array, mask: SpriteMask, tile: number, half: number, thickness: number,
): number {
  const size = mask.size;
  const px = (half * 2) / size;
  const z = thickness / 2;
  let n = 0;

  // Frente e verso: um quad cada, com o recorte de alfa fazendo o resto.
  n = quad(out, n, tile, SHADE_FRONT,
    -half, -half, z, 0, 0,
    half, -half, z, 1, 0,
    half, half, z, 1, 1,
    -half, half, z, 0, 1);
  n = quad(out, n, tile, SHADE_BACK,
    half, -half, -z, 1, 0,
    -half, -half, -z, 0, 0,
    -half, half, -z, 0, 1,
    half, half, -z, 1, 1);

  /*
   * Bordas verticais (normal em ±X), fundidas ao longo de Y.
   *
   * Uma borda existe onde um pixel opaco encosta num vazio. A corrida junta
   * linhas seguidas com a mesma borda na mesma coluna — é o cabo da ferramenta
   * virando um quad só.
   */
  for (let x = 0; x <= size; x++) {
    let runStart = -1;
    let runDir = 0;
    for (let y = 0; y <= size; y++) {
      const left = mask.opaque(x - 1, y);
      const right = mask.opaque(x, y);
      // +1 = a peça está à esquerda (face olha para +X); −1 = o contrário.
      const dir = y < size ? (left && !right ? 1 : (!left && right ? -1 : 0)) : 0;
      if (dir !== runDir) {
        if (runDir !== 0) {
          n = sideX(out, n, tile, x, runStart, y, runDir, size, px, half, z);
        }
        runDir = dir;
        runStart = y;
      }
    }
  }

  // Bordas horizontais (normal em ±Y), fundidas ao longo de X.
  for (let y = 0; y <= size; y++) {
    let runStart = -1;
    let runDir = 0;
    for (let x = 0; x <= size; x++) {
      const above = mask.opaque(x, y - 1);
      const below = mask.opaque(x, y);
      const dir = x < size ? (above && !below ? 1 : (!above && below ? -1 : 0)) : 0;
      if (dir !== runDir) {
        if (runDir !== 0) {
          n = sideY(out, n, tile, y, runStart, x, runDir, size, px, half, z);
        }
        runDir = dir;
        runStart = x;
      }
    }
  }
  return n;
}

/**
 * Aresta vertical na divisa `x`, das linhas `y0` a `y1`.
 *
 * `dir` +1 quer dizer que a peça está do lado de `x−1` e a face olha para +X.
 * A UV fica no **meio do pixel de dentro**, que é de onde vem a cor da borda.
 */
function sideX(
  out: Float32Array, n: number, tile: number, x: number, y0: number, y1: number,
  dir: number, size: number, px: number, half: number, z: number,
): number {
  const mx = -half + x * px;
  const top = half - y0 * px;
  const bottom = half - y1 * px;
  const u = (dir > 0 ? x - 0.5 : x + 0.5) / size;
  const v0 = 1 - (y0 + 0.5) / size;
  const v1 = 1 - (y1 - 0.5) / size;
  if (dir > 0) {
    return quad(out, n, tile, SHADE_SIDE_X,
      mx, bottom, z, u, v1,
      mx, bottom, -z, u, v1,
      mx, top, -z, u, v0,
      mx, top, z, u, v0);
  }
  return quad(out, n, tile, SHADE_SIDE_X,
    mx, bottom, -z, u, v1,
    mx, bottom, z, u, v1,
    mx, top, z, u, v0,
    mx, top, -z, u, v0);
}

/** Aresta horizontal na divisa `y`, das colunas `x0` a `x1`. */
function sideY(
  out: Float32Array, n: number, tile: number, y: number, x0: number, x1: number,
  dir: number, size: number, px: number, half: number, z: number,
): number {
  const my = half - y * px;
  const left = -half + x0 * px;
  const right = -half + x1 * px;
  const v = 1 - (dir > 0 ? y - 0.5 : y + 0.5) / size;
  const u0 = (x0 + 0.5) / size;
  const u1 = (x1 - 0.5) / size;
  if (dir > 0) {
    return quad(out, n, tile, SHADE_SIDE_Y,
      left, my, z, u0, v,
      right, my, z, u1, v,
      right, my, -z, u1, v,
      left, my, -z, u0, v);
  }
  return quad(out, n, tile, SHADE_SIDE_Y,
    left, my, -z, u0, v,
    right, my, -z, u1, v,
    right, my, z, u1, v,
    left, my, z, u0, v);
}

/** Dois triângulos a partir de quatro cantos, na ordem dada. */
function quad(
  out: Float32Array, n: number, tile: number, shade: number,
  ax: number, ay: number, az: number, au: number, av: number,
  bx: number, by: number, bz: number, bu: number, bv: number,
  cx: number, cy: number, cz: number, cu: number, cv: number,
  dx: number, dy: number, dz: number, du: number, dv: number,
): number {
  n = vertex(out, n, tile, shade, ax, ay, az, au, av);
  n = vertex(out, n, tile, shade, bx, by, bz, bu, bv);
  n = vertex(out, n, tile, shade, cx, cy, cz, cu, cv);
  n = vertex(out, n, tile, shade, ax, ay, az, au, av);
  n = vertex(out, n, tile, shade, cx, cy, cz, cu, cv);
  n = vertex(out, n, tile, shade, dx, dy, dz, du, dv);
  return n;
}

function vertex(
  out: Float32Array, n: number, tile: number, shade: number,
  x: number, y: number, z: number, u: number, v: number,
): number {
  const o = n * ITEM_FLOATS_PER_VERTEX;
  if (o + ITEM_FLOATS_PER_VERTEX > out.length) return n;
  out[o] = x;
  out[o + 1] = y;
  out[o + 2] = z;
  out[o + 3] = u;
  out[o + 4] = v;
  out[o + 5] = tile;
  out[o + 6] = shade;
  return n + 1;
}
