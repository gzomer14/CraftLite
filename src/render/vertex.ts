/**
 * Formato de vértice comprimido (doc 01 §5.1).
 *
 * **8 bytes por vértice** — este é o número normativo, porque é ele que decide
 * o orçamento de memória de mesh (doc 02 §3). A divisão interna dos bits abaixo
 * ajusta o doc em dois pontos: `u`/`v` usam 5 bits (não 4) porque uma corrida do
 * greedy meshing pode ter 16 tiles de comprimento, e 4 bits só chegam a 15; e a
 * posição usa 9 bits por eixo, pelo motivo abaixo.
 *
 * palavra 0:  x:9 | y:9 | z:9 | face:3                                  (30 bits)
 * palavra 1:  texLayer:10 | blockLight:4 | skyLight:4 | ao:2 | tint:2 | u:5 | v:5
 *
 * Posições são em **dezesseis avos de bloco** dentro da section (0..256).
 *
 * **Correção de 2026-09-16.** Até aqui a posição era em *meios-blocos* (6 bits
 * por eixo), e isso não era um detalhe de compressão: era uma regra de
 * geometria. Toda caixa mais fina que meio bloco **colapsava no arredondamento**
 * — poste de cerca (2/16), grade (1/16), porta e alçapão (3/16), botão,
 * alavanca, placa de pressão, repetidor e o levantamento do trilho viravam
 * planos de espessura zero, e o poste de cerca sozinho desaparecia por
 * completo. Era a causa-raiz de "as coisas parecem chapadas": não faltava
 * textura, faltava **volume representável**.
 *
 * Os 3 bits a mais por eixo saem de onde não faziam falta: `tint` tem quatro
 * valores (2 bits bastam), `u`/`v` mudaram para a segunda palavra e o campo
 * `flags`, que nunca teve leitor, saiu. O total continua em 8 bytes, e o
 * orçamento de memória de mesh do doc 02 §3 não muda.
 */

export const BYTES_PER_VERTEX_PACKED = 8;
export const BYTES_PER_VERTEX_FLOAT = 32; // fallback WebGL1: 2 × vec4 de floats

/** Índices de face, na ordem usada pelas normais do shader. */
export const FACE_POS_X = 0;
export const FACE_NEG_X = 1;
export const FACE_POS_Y = 2;
export const FACE_NEG_Y = 3;
export const FACE_POS_Z = 4;
export const FACE_NEG_Z = 5;

/** Normais por face, na mesma ordem. */
export const FACE_NORMALS: readonly (readonly [number, number, number])[] = [
  [1, 0, 0], [-1, 0, 0], [0, 1, 0], [0, -1, 0], [0, 0, 1], [0, 0, -1],
];

/** Multiplicadores de AO (doc 02 §5.2). */
export const AO_LEVELS = new Float32Array([0.55, 0.7, 0.85, 1.0]);

/** Índices de tint: 0 = sem tint, 1 = grama, 2 = folhagem, 3 = água. */
export const TINT_NONE = 0;
export const TINT_GRASS = 1;
export const TINT_FOLIAGE = 2;
export const TINT_WATER = 3;

/** Sub-blocos por bloco na posição empacotada. */
export const POSITION_SCALE = 16;

export function packWord0(
  x16: number, y16: number, z16: number, face: number,
): number {
  return (
    (x16 & 0x1ff) |
    ((y16 & 0x1ff) << 9) |
    ((z16 & 0x1ff) << 18) |
    ((face & 0x7) << 27)
  ) >>> 0;
}

export function packWord1(
  texLayer: number, blockLight: number, skyLight: number, ao: number, tint: number,
  u: number, v: number,
): number {
  return (
    (texLayer & 0x3ff) |
    ((blockLight & 0xf) << 10) |
    ((skyLight & 0xf) << 14) |
    ((ao & 0x3) << 18) |
    ((tint & 0x3) << 20) |
    ((u & 0x1f) << 22) |
    ((v & 0x1f) << 27)
  ) >>> 0;
}

/**
 * Escreve um vértice no fallback WebGL1, onde não há atributos inteiros.
 * Custa 32 bytes em vez de 8 — aceito, porque é o caminho raro (doc 01 §5.1).
 */
export function writeFloatVertex(
  out: Float32Array, offset: number,
  x16: number, y16: number, z16: number, face: number, u: number, v: number,
  texLayer: number, blockLight: number, skyLight: number, ao: number, tint: number,
): void {
  out[offset] = x16 / POSITION_SCALE;
  out[offset + 1] = y16 / POSITION_SCALE;
  out[offset + 2] = z16 / POSITION_SCALE;
  out[offset + 3] = face;
  out[offset + 4] = u;
  out[offset + 5] = v;
  out[offset + 6] = texLayer;
  // Empacota luz/AO/tint em um float: light = b + s*16 + ao*256 + tint*1024.
  out[offset + 7] = blockLight + skyLight * 16 + ao * 256 + tint * 1024;
}
