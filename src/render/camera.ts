/**
 * Câmera. Guarda posição do tick anterior e do atual para interpolar no render
 * (doc 01 §3.3) — sem isso o movimento fica travado a 20 Hz.
 */

import {
  createMat4, createVec3, invert, lookYawPitch, multiply, perspective,
  DEG2RAD, Frustum, type Mat4, type Vec3,
} from '../core/math';

export class Camera {
  /** Posição no tick anterior e no atual, para interpolação. */
  prevX = 0; prevY = 0; prevZ = 0;
  x = 0; y = 0; z = 0;
  prevYaw = 0; prevPitch = 0;
  yaw = 0; pitch = 0;

  fovDeg = 70;
  near = 0.05;
  far = 320;

  readonly view: Mat4 = createMat4();
  readonly proj: Mat4 = createMat4();
  readonly viewProj: Mat4 = createMat4();
  readonly frustum = new Frustum();

  /** Posição interpolada usada no frame atual — lida pelo debug e pelo fog. */
  renderX = 0; renderY = 0; renderZ = 0;

  /**
   * Balanço da câmera ao andar (doc 08 §3.11).
   *
   * `bobPhase` é a distância andada acumulada, em blocos — quem a alimenta é o
   * tick, porque é lá que se sabe o quanto o jogador andou. `bobStrength` é
   * 0..1 e sai da opção: zero desliga sem custar um `if` por frame no chamador.
   *
   * O balanço mexe **na posição do olho**, não na projeção: girar a câmera
   * (roll) exigiria um eixo a mais em `lookYawPitch` e embrulha mais gente do
   * que agrada.
   */
  bobPhase = 0;
  bobStrength = 0;

  /** Inversa da view-projection, recalculada junto com as matrizes do frame. */
  private readonly invViewProj: Mat4 = createMat4();
  private invValid = false;
  private readonly rayScratch: Vec3 = createVec3();

  /** Chamado no início de cada tick, antes de mover a câmera. */
  snapshot(): void {
    this.prevX = this.x; this.prevY = this.y; this.prevZ = this.z;
    this.prevYaw = this.yaw; this.prevPitch = this.pitch;
  }

  setPosition(x: number, y: number, z: number): void {
    this.x = x; this.y = y; this.z = z;
  }

  /** Recalcula as matrizes para o frame, interpolando entre os dois ticks. */
  update(alpha: number, aspect: number): void {
    this.renderX = this.prevX + (this.x - this.prevX) * alpha;
    this.renderY = this.prevY + (this.y - this.prevY) * alpha;
    this.renderZ = this.prevZ + (this.z - this.prevZ) * alpha;
    const yaw = this.prevYaw + shortestAngle(this.prevYaw, this.yaw) * alpha;
    const pitch = this.prevPitch + (this.pitch - this.prevPitch) * alpha;

    perspective(this.proj, this.fovDeg * DEG2RAD, aspect, this.near, this.far);

    // Balanço: sobe e desce no dobro da frequência do passo (dois pés por
    // ciclo) e oscila de lado no tempo do passo.
    let eyeX = this.renderX;
    let eyeY = this.renderY;
    let eyeZ = this.renderZ;
    if (this.bobStrength > 0) {
      const amount = Math.min(1, this.bobStrength);
      eyeY += Math.sin(this.bobPhase * 2) * 0.055 * amount;
      const side = Math.cos(this.bobPhase) * 0.045 * amount;
      eyeX += Math.cos(yaw) * side;
      eyeZ += -Math.sin(yaw) * side;
    }
    lookYawPitch(this.view, eyeX, eyeY, eyeZ, yaw, pitch);
    multiply(this.viewProj, this.proj, this.view);
    this.frustum.fromMatrix(this.viewProj);
    this.invValid = invert(this.invViewProj, this.viewProj);
  }

  /**
   * Direção do raio que passa por um ponto da tela, em NDC (−1..1, com Y para
   * cima). É o que o Modo A de toque usa: o raycast parte do **dedo**, não do
   * centro da tela (doc 09 §2.2).
   *
   * Escreve em um vetor reusado — copie antes da próxima chamada.
   */
  rayFromNdc(ndcX: number, ndcY: number): Vec3 {
    const out = this.rayScratch;
    if (!this.invValid) {
      // Sem inversa válida, cai para a direção da câmera.
      const cp = Math.cos(this.pitch);
      out[0] = Math.sin(this.yaw) * cp;
      out[1] = -Math.sin(this.pitch);
      out[2] = Math.cos(this.yaw) * cp;
      return out;
    }
    const m = this.invViewProj;
    // Desprojeta dois pontos do raio (perto e longe) e subtrai.
    const nx = unproject(m, ndcX, ndcY, -1, 0);
    const ny = unproject(m, ndcX, ndcY, -1, 1);
    const nz = unproject(m, ndcX, ndcY, -1, 2);
    const fx = unproject(m, ndcX, ndcY, 1, 0);
    const fy = unproject(m, ndcX, ndcY, 1, 1);
    const fz = unproject(m, ndcX, ndcY, 1, 2);
    let dx = fx - nx;
    let dy = fy - ny;
    let dz = fz - nz;
    const len = Math.hypot(dx, dy, dz) || 1;
    dx /= len; dy /= len; dz /= len;
    out[0] = dx; out[1] = dy; out[2] = dz;
    return out;
  }

  /**
   * Converte coordenadas de pixel CSS em NDC. `width`/`height` são o tamanho
   * do canvas em CSS, não em pixels de backbuffer.
   */
  static toNdc(clientX: number, clientY: number, width: number, height: number, out: Float32Array): void {
    out[0] = (clientX / width) * 2 - 1;
    out[1] = 1 - (clientY / height) * 2;
  }
}

/** Componente `component` do ponto desprojetado, já dividido por w. */
function unproject(m: Mat4, x: number, y: number, z: number, component: number): number {
  const w = m[3] * x + m[7] * y + m[11] * z + m[15];
  const v = m[component] * x + m[component + 4] * y + m[component + 8] * z + m[component + 12];
  return w === 0 ? v : v / w;
}

/** Caminho angular mais curto entre dois yaws, para o wrap em ±π não dar tranco. */
function shortestAngle(from: number, to: number): number {
  let d = (to - from) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return d;
}
