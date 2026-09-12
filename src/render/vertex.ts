/**
 * Formato de vértice comprimido (doc 01 §5.1).
 *
 * **8 bytes por vértice** — este é o número normativo, porque é ele que decide
 * o orçamento de memória de mesh (doc 02 §3). A divisão interna dos bits abaixo
 * ajusta o doc em um ponto: `u`/`v` usam 5 bits (não 4) porque uma corrida do
 * greedy meshing pode ter 16 tiles de comprimento, e 4 bits só chegam a 15.
 * Os 2 bits do AO foram para a segunda palavra para compensar; o total continua 8.
 *
 * palavra 0:  x:6 | y:6 | z:6 | face:3 | u:5 | v:5              (31 bits)
 * palavra 1:  texLayer:10 | blockLight:4 | skyLight:4 | ao:2 | tint:4 | flags:8
 *
 * Posições são em **meios-blocos** dentro da section (0..32), o que permite
 * lajes, líquidos com altura e tochas sem um segundo formato.
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

export function packWord0(
  xHalf: number, yHalf: number, zHalf: number, face: number, u: number, v: number,
): number {
  return (
    (xHalf & 0x3f) |
    ((yHalf & 0x3f) << 6) |
    ((zHalf & 0x3f) << 12) |
    ((face & 0x7) << 18) |
    ((u & 0x1f) << 21) |
    ((v & 0x1f) << 26)
  ) >>> 0;
}

export function packWord1(
  texLayer: number, blockLight: number, skyLight: number, ao: number, tint: number, flags = 0,
): number {
  return (
    (texLayer & 0x3ff) |
    ((blockLight & 0xf) << 10) |
    ((skyLight & 0xf) << 14) |
    ((ao & 0x3) << 18) |
    ((tint & 0xf) << 20) |
    ((flags & 0xff) << 24)
  ) >>> 0;
}

/**
 * Escreve um vértice no fallback WebGL1, onde não há atributos inteiros.
 * Custa 32 bytes em vez de 8 — aceito, porque é o caminho raro (doc 01 §5.1).
 */
export function writeFloatVertex(
  out: Float32Array, offset: number,
  xHalf: number, yHalf: number, zHalf: number, face: number, u: number, v: number,
  texLayer: number, blockLight: number, skyLight: number, ao: number, tint: number,
): void {
  out[offset] = xHalf * 0.5;
  out[offset + 1] = yHalf * 0.5;
  out[offset + 2] = zHalf * 0.5;
  out[offset + 3] = face;
  out[offset + 4] = u;
  out[offset + 5] = v;
  out[offset + 6] = texLayer;
  // Empacota luz/AO/tint em um float: light = b + s*16 + ao*256 + tint*1024.
  out[offset + 7] = blockLight + skyLight * 16 + ao * 256 + tint * 1024;
}
