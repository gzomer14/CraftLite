/**
 * Barcos (doc 14 — M6).
 *
 * **Não é mob e não é item no chão**: é uma caixa que flutua, carrega o jogador
 * e é desenhada pelo mesmo batcher dos mobs. Segue o precedente da flecha
 * (`data/mobmodels.ts`): uma caixa com skin não merece um passe de render
 * próprio.
 *
 * A física é a mínima que faz um barco parecer um barco: ele **procura a
 * superfície da água** em vez de cair até o fundo, tem arrasto alto na água e
 * quase nenhum controle no seco. Não há remo, inércia angular nem colisão de
 * casco — o que existe é o suficiente para atravessar um lago sem nadar, que é
 * o que o barco resolve no jogo.
 */

import { WATER, blockIdOf, defOf } from '../data/blocks';
import type { World } from '../world/world';

/** Quantos barcos podem existir ao mesmo tempo. */
const CAPACITY = 32;
/** Aceleração por tick com o jogador remando. */
const ACCEL = 0.028;
/** Arrasto por tick na água e no seco. */
const WATER_DRAG = 0.91;
const GROUND_DRAG = 0.7;
/** Velocidade máxima, em blocos por tick. */
const MAX_SPEED = 0.32;
const GRAVITY = -0.04;
/** Quanto o barco sobe por tick procurando a linha d'água. */
const BUOYANCY = 0.06;
/** Altura em que o jogador senta, acima da base do barco. */
export const BOAT_SEAT_HEIGHT = 0.35;
/** Largura da caixa do barco, para achar e montar. */
export const BOAT_WIDTH = 1.4;

export class Boats {
  readonly x = new Float64Array(CAPACITY);
  readonly y = new Float64Array(CAPACITY);
  readonly z = new Float64Array(CAPACITY);
  readonly prevX = new Float64Array(CAPACITY);
  readonly prevY = new Float64Array(CAPACITY);
  readonly prevZ = new Float64Array(CAPACITY);
  readonly vx = new Float32Array(CAPACITY);
  readonly vy = new Float32Array(CAPACITY);
  readonly vz = new Float32Array(CAPACITY);
  readonly yaw = new Float32Array(CAPACITY);
  readonly prevYaw = new Float32Array(CAPACITY);

  private activeCount = 0;

  get active(): number {
    return this.activeCount;
  }

  /** Coloca um barco no mundo. Devolve o índice, ou −1 se o pool está cheio. */
  spawn(x: number, y: number, z: number, yaw = 0): number {
    if (this.activeCount >= CAPACITY) return -1;
    const i = this.activeCount++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
    this.yaw[i] = yaw; this.prevYaw[i] = yaw;
    return i;
  }

  /**
   * Rema: `forward` em −1..1 e `yaw` a direção do olhar de quem pilota.
   * O barco vira junto com o olhar — controle de leme seria mais fiel e muito
   * pior de usar no toque.
   */
  drive(index: number, forward: number, yaw: number): void {
    if (index < 0 || index >= this.activeCount) return;
    this.yaw[index] = yaw;
    if (forward === 0) return;
    this.vx[index] += -Math.sin(yaw) * ACCEL * forward;
    this.vz[index] += Math.cos(yaw) * ACCEL * forward;
  }

  /** Um tick de física para todos os barcos. */
  tick(world: World): void {
    for (let i = 0; i < this.activeCount; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevZ[i] = this.z[i];
      this.prevYaw[i] = this.yaw[i];

      const inWater = blockIdOf(world.getBlock(
        Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(this.z[i]),
      )) === WATER;
      const aboveWater = blockIdOf(world.getBlock(
        Math.floor(this.x[i]), Math.floor(this.y[i] + 1), Math.floor(this.z[i]),
      )) === WATER;

      if (inWater && !aboveWater) {
        // Na linha d'água: sobe devagar até o topo do bloco e para.
        const surface = Math.floor(this.y[i]) + 1;
        this.vy[i] = Math.min(BUOYANCY, surface - this.y[i]);
      } else if (inWater) {
        this.vy[i] = BUOYANCY;
      } else {
        this.vy[i] += GRAVITY;
      }

      const drag = inWater ? WATER_DRAG : GROUND_DRAG;
      this.vx[i] *= drag;
      this.vz[i] *= drag;
      this.clampSpeed(i);

      this.moveAxis(world, i, this.vx[i], 0);
      this.moveAxis(world, i, this.vz[i], 2);
      this.moveVertical(world, i);
    }
  }

  private clampSpeed(i: number): void {
    const speed = Math.hypot(this.vx[i], this.vz[i]);
    if (speed <= MAX_SPEED) return;
    const scale = MAX_SPEED / speed;
    this.vx[i] *= scale;
    this.vz[i] *= scale;
  }

  /** Move num eixo horizontal, parando ao encostar em sólido. */
  private moveAxis(world: World, i: number, delta: number, axis: number): void {
    if (delta === 0) return;
    const nx = axis === 0 ? this.x[i] + delta : this.x[i];
    const nz = axis === 2 ? this.z[i] + delta : this.z[i];
    const half = BOAT_WIDTH / 2;
    const probeX = axis === 0 ? nx + Math.sign(delta) * half : nx;
    const probeZ = axis === 2 ? nz + Math.sign(delta) * half : nz;
    // A folga em Y existe porque o barco pousado na linha d'água fica em
    // 63.99999 e não em 64: sem ela, ele bate na margem que está no seu nível.
    const probeY = Math.floor(this.y[i] + 0.05);
    if (defOf(world.getBlock(Math.floor(probeX), probeY, Math.floor(probeZ))).solid) {
      if (axis === 0) this.vx[i] = 0; else this.vz[i] = 0;
      return;
    }
    if (axis === 0) this.x[i] = nx; else this.z[i] = nz;
  }

  private moveVertical(world: World, i: number): void {
    const next = this.y[i] + this.vy[i];
    if (this.vy[i] < 0) {
      const below = defOf(world.getBlock(
        Math.floor(this.x[i]), Math.floor(next - 0.05), Math.floor(this.z[i]),
      ));
      if (below.solid) {
        this.y[i] = Math.floor(next) + 1;
        this.vy[i] = 0;
        return;
      }
    }
    this.y[i] = next;
  }

  /** Barco mais próximo de um ponto, dentro de `range`. −1 se não há nenhum. */
  findNear(x: number, y: number, z: number, range: number): number {
    let best = -1;
    let bestDistance = range * range;
    for (let i = 0; i < this.activeCount; i++) {
      const dx = this.x[i] - x;
      const dy = this.y[i] - y;
      const dz = this.z[i] - z;
      const distance = dx * dx + dy * dy + dz * dz;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = i;
      }
    }
    return best;
  }

  /** Tira um barco do mundo (quebrado ou recolhido). */
  removeAt(i: number): void {
    if (i < 0 || i >= this.activeCount) return;
    const last = --this.activeCount;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.prevX[i] = this.prevX[last];
    this.prevY[i] = this.prevY[last];
    this.prevZ[i] = this.prevZ[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.yaw[i] = this.yaw[last];
    this.prevYaw[i] = this.prevYaw[last];
  }

  /** Percorre os barcos para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, yaw: number, index: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.activeCount; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.prevYaw[i] + angleDelta(this.prevYaw[i], this.yaw[i]) * alpha,
        i,
      );
    }
  }

  clear(): void {
    this.activeCount = 0;
  }
}

/** Menor diferença angular entre dois ângulos, para interpolar sem dar a volta. */
function angleDelta(from: number, to: number): number {
  let delta = (to - from) % (Math.PI * 2);
  if (delta > Math.PI) delta -= Math.PI * 2;
  if (delta < -Math.PI) delta += Math.PI * 2;
  return delta;
}
