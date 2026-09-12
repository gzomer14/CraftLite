/**
 * Matemática do jogo: vetores, matrizes 4×4, AABB e frustum.
 *
 * Regra dura do doc 02 §2: zero alocação no caminho quente. Toda função aqui
 * escreve em um destino pré-alocado (`out`) e o devolve; nada retorna objeto novo.
 */

export type Mat4 = Float32Array;
export type Vec3 = Float32Array;

export const DEG2RAD = Math.PI / 180;
export const RAD2DEG = 180 / Math.PI;

export function createMat4(): Mat4 {
  const m = new Float32Array(16);
  m[0] = m[5] = m[10] = m[15] = 1;
  return m;
}

export function createVec3(x = 0, y = 0, z = 0): Vec3 {
  const v = new Float32Array(3);
  v[0] = x;
  v[1] = y;
  v[2] = z;
  return v;
}

export function identity(out: Mat4): Mat4 {
  out.fill(0);
  out[0] = out[5] = out[10] = out[15] = 1;
  return out;
}

/** Projeção perspectiva column-major (mesma convenção do GL). */
export function perspective(out: Mat4, fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  out.fill(0);
  out[0] = f / aspect;
  out[5] = f;
  out[10] = (far + near) * nf;
  out[11] = -1;
  out[14] = 2 * far * near * nf;
  return out;
}

/**
 * Matriz de vista a partir de posição + yaw/pitch (radianos).
 *
 * Convenção: `yaw = 0, pitch = 0` olha para **+Z** (chamado de norte no debug).
 * Como o sistema é destro com up = +Y, o vetor "direita" da câmera é −X nessa
 * pose — por isso o input subtrai o delta horizontal do mouse do yaw.
 */
export function lookYawPitch(out: Mat4, px: number, py: number, pz: number, yaw: number, pitch: number): Mat4 {
  const cy = Math.cos(yaw);
  const sy = Math.sin(yaw);
  const cp = Math.cos(pitch);
  const sp = Math.sin(pitch);

  // forward = (sy·cp, −sp, cy·cp);  right = normalize(forward × up);  up = right × forward
  const fx = sy * cp, fy = -sp, fz = cy * cp;
  const rx = -cy, ry = 0, rz = sy;
  const ux = sy * sp, uy = cp, uz = cy * sp;

  out[0] = rx; out[4] = ry; out[8] = rz; out[12] = -(rx * px + ry * py + rz * pz);
  out[1] = ux; out[5] = uy; out[9] = uz; out[13] = -(ux * px + uy * py + uz * pz);
  out[2] = -fx; out[6] = -fy; out[10] = -fz; out[14] = fx * px + fy * py + fz * pz;
  out[3] = 0; out[7] = 0; out[11] = 0; out[15] = 1;
  return out;
}

/** Escreve o vetor "para frente" da câmera em `out` (sem alocar). */
export function forwardFrom(out: Vec3, yaw: number, pitch: number): Vec3 {
  const cp = Math.cos(pitch);
  out[0] = Math.sin(yaw) * cp;
  out[1] = -Math.sin(pitch);
  out[2] = Math.cos(yaw) * cp;
  return out;
}

/** out = a × b (column-major). `out` pode ser o mesmo objeto que `a` ou `b`. */
const mulTmp = new Float32Array(16);
export function multiply(out: Mat4, a: Mat4, b: Mat4): Mat4 {
  for (let c = 0; c < 4; c++) {
    const b0 = b[c * 4], b1 = b[c * 4 + 1], b2 = b[c * 4 + 2], b3 = b[c * 4 + 3];
    mulTmp[c * 4] = a[0] * b0 + a[4] * b1 + a[8] * b2 + a[12] * b3;
    mulTmp[c * 4 + 1] = a[1] * b0 + a[5] * b1 + a[9] * b2 + a[13] * b3;
    mulTmp[c * 4 + 2] = a[2] * b0 + a[6] * b1 + a[10] * b2 + a[14] * b3;
    mulTmp[c * 4 + 3] = a[3] * b0 + a[7] * b1 + a[11] * b2 + a[15] * b3;
  }
  out.set(mulTmp);
  return out;
}

export function translate(out: Mat4, x: number, y: number, z: number): Mat4 {
  identity(out);
  out[12] = x;
  out[13] = y;
  out[14] = z;
  return out;
}

export function scaleMat(out: Mat4, x: number, y: number, z: number): Mat4 {
  identity(out);
  out[0] = x;
  out[5] = y;
  out[10] = z;
  return out;
}

export function rotateY(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  identity(out);
  out[0] = c; out[2] = -s;
  out[8] = s; out[10] = c;
  return out;
}

export function rotateX(out: Mat4, rad: number): Mat4 {
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  identity(out);
  out[5] = c; out[6] = s;
  out[9] = -s; out[10] = c;
  return out;
}

/**
 * Inversa de uma 4×4 geral. Usada para reconstruir o raio de um pixel da tela,
 * que é o que o Modo A de toque precisa: o raycast parte do dedo, não do centro.
 * Devolve `false` se a matriz for singular.
 */
export function invert(out: Mat4, m: Mat4): boolean {
  const a00 = m[0], a01 = m[1], a02 = m[2], a03 = m[3];
  const a10 = m[4], a11 = m[5], a12 = m[6], a13 = m[7];
  const a20 = m[8], a21 = m[9], a22 = m[10], a23 = m[11];
  const a30 = m[12], a31 = m[13], a32 = m[14], a33 = m[15];

  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;

  let det = b00 * b11 - b01 * b10 + b02 * b09 + b03 * b08 - b04 * b07 + b05 * b06;
  if (det === 0) return false;
  det = 1 / det;

  out[0] = (a11 * b11 - a12 * b10 + a13 * b09) * det;
  out[1] = (a02 * b10 - a01 * b11 - a03 * b09) * det;
  out[2] = (a31 * b05 - a32 * b04 + a33 * b03) * det;
  out[3] = (a22 * b04 - a21 * b05 - a23 * b03) * det;
  out[4] = (a12 * b08 - a10 * b11 - a13 * b07) * det;
  out[5] = (a00 * b11 - a02 * b08 + a03 * b07) * det;
  out[6] = (a32 * b02 - a30 * b05 - a33 * b01) * det;
  out[7] = (a20 * b05 - a22 * b02 + a23 * b01) * det;
  out[8] = (a10 * b10 - a11 * b08 + a13 * b06) * det;
  out[9] = (a01 * b08 - a00 * b10 - a03 * b06) * det;
  out[10] = (a30 * b04 - a31 * b02 + a33 * b00) * det;
  out[11] = (a21 * b02 - a20 * b04 - a23 * b00) * det;
  out[12] = (a11 * b07 - a10 * b09 - a12 * b06) * det;
  out[13] = (a00 * b09 - a01 * b07 + a02 * b06) * det;
  out[14] = (a31 * b01 - a30 * b03 - a32 * b00) * det;
  out[15] = (a20 * b03 - a21 * b01 + a22 * b00) * det;
  return true;
}

/** Interpolação linear — usada para o `alpha` entre ticks. */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** Suavização de Hermite, base das splines de terreno. */
export function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

/** Interpola em uma spline linear por partes definida por pontos (x crescente). */
export function spline(xs: readonly number[], ys: readonly number[], x: number): number {
  const n = xs.length;
  if (x <= xs[0]) return ys[0];
  if (x >= xs[n - 1]) return ys[n - 1];
  let i = 1;
  while (i < n && xs[i] < x) i++;
  const x0 = xs[i - 1], x1 = xs[i];
  const t = smoothstep((x - x0) / (x1 - x0));
  return ys[i - 1] + (ys[i] - ys[i - 1]) * t;
}

/**
 * Frustum de 6 planos extraído da matriz view-projection (Gribb/Hartmann).
 * Guarda em um Float32Array de 24 para não alocar por frame.
 */
export class Frustum {
  readonly planes = new Float32Array(24);

  /** Extrai os planos de `vp` (já normalizados). */
  fromMatrix(vp: Mat4): void {
    const p = this.planes;
    const m0 = vp[0], m1 = vp[1], m2 = vp[2], m3 = vp[3];
    const m4 = vp[4], m5 = vp[5], m6 = vp[6], m7 = vp[7];
    const m8 = vp[8], m9 = vp[9], m10 = vp[10], m11 = vp[11];
    const m12 = vp[12], m13 = vp[13], m14 = vp[14], m15 = vp[15];

    // esquerda, direita, baixo, cima, perto, longe
    p[0] = m3 + m0; p[1] = m7 + m4; p[2] = m11 + m8; p[3] = m15 + m12;
    p[4] = m3 - m0; p[5] = m7 - m4; p[6] = m11 - m8; p[7] = m15 - m12;
    p[8] = m3 + m1; p[9] = m7 + m5; p[10] = m11 + m9; p[11] = m15 + m13;
    p[12] = m3 - m1; p[13] = m7 - m5; p[14] = m11 - m9; p[15] = m15 - m13;
    p[16] = m3 + m2; p[17] = m7 + m6; p[18] = m11 + m10; p[19] = m15 + m14;
    p[20] = m3 - m2; p[21] = m7 - m6; p[22] = m11 - m10; p[23] = m15 - m14;

    for (let i = 0; i < 6; i++) {
      const o = i * 4;
      const inv = 1 / Math.hypot(p[o], p[o + 1], p[o + 2]);
      p[o] *= inv; p[o + 1] *= inv; p[o + 2] *= inv; p[o + 3] *= inv;
    }
  }

  /** Testa uma AABB em coordenadas de mundo. */
  intersectsAabb(x0: number, y0: number, z0: number, x1: number, y1: number, z1: number): boolean {
    const p = this.planes;
    for (let i = 0; i < 6; i++) {
      const o = i * 4;
      const nx = p[o], ny = p[o + 1], nz = p[o + 2], d = p[o + 3];
      // Vértice "positivo" da caixa em relação à normal do plano.
      const vx = nx >= 0 ? x1 : x0;
      const vy = ny >= 0 ? y1 : y0;
      const vz = nz >= 0 ? z1 : z0;
      if (nx * vx + ny * vy + nz * vz + d < 0) return false;
    }
    return true;
  }
}
