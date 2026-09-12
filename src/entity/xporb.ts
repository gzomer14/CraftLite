/**
 * Orbes de experiência (doc 06 §8).
 *
 * Mesma disciplina dos itens no chão: arrays paralelos, pool fixo, remoção por
 * troca com o último. Um mob morto solta um orbe, um veio de diamante solta
 * sete — é fácil ter dezenas na tela e nenhum pode virar objeto para o GC.
 *
 * Diferença para o item: o orbe **é atraído** pelo jogador num raio de 8 blocos
 * (doc 06 §8) e não colide de verdade com nada — só para de cair no chão. Voar
 * é o que dá a sensação de "recolher" sem exigir precisão do jogador, o que
 * importa muito no controle por toque.
 */

import { defOf } from '../data/blocks';
import type { World } from '../world/world';

/** Raio de atração (doc 06 §8). */
export const ATTRACT_RADIUS = 8;
/** Distância em que o orbe é absorvido. */
const COLLECT_RADIUS = 1.1;
/** Ticks até sumir: 5 minutos, como o item no chão. */
const DESPAWN_TICKS = 6000;
/** Ticks antes de poder ser atraído — dá tempo de o orbe aparecer. */
const PICKUP_DELAY = 6;
/** Aceleração da atração, por tick. */
const ATTRACT_ACCEL = 0.12;
/** Raio em que dois orbes se fundem, para não haver 60 na mesma cova. */
const MERGE_RADIUS = 0.9;
/** Valor máximo de um orbe fundido — acima disso vira um segundo orbe. */
const MAX_VALUE = 100;
const GRAVITY = -0.04;
const DRAG = 0.98;
const GROUND_FRICTION = 0.6;

export class XpOrbs {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly prevZ: Float64Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly value: Int32Array;
  private readonly age: Int32Array;
  private readonly capacity: number;

  private activeCount = 0;

  /** Chamado quando o jogador absorve um orbe. */
  onCollect: ((amount: number) => void) | null = null;

  constructor(capacity = 256) {
    this.capacity = capacity;
    this.x = new Float64Array(capacity);
    this.y = new Float64Array(capacity);
    this.z = new Float64Array(capacity);
    this.prevX = new Float64Array(capacity);
    this.prevY = new Float64Array(capacity);
    this.prevZ = new Float64Array(capacity);
    this.vx = new Float32Array(capacity);
    this.vy = new Float32Array(capacity);
    this.vz = new Float32Array(capacity);
    this.value = new Int32Array(capacity);
    this.age = new Int32Array(capacity);
  }

  get active(): number {
    return this.activeCount;
  }

  /** Solta um orbe. Valor 0 ou pool cheio: não faz nada. */
  spawn(x: number, y: number, z: number, amount: number): boolean {
    const value = Math.floor(amount);
    if (value <= 0 || this.activeCount >= this.capacity) return false;
    const i = this.activeCount++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.vx[i] = (Math.random() - 0.5) * 0.1;
    this.vy[i] = 0.15;
    this.vz[i] = (Math.random() - 0.5) * 0.1;
    this.value[i] = value;
    this.age[i] = 0;
    return true;
  }

  /** Um tick: física, atração, coleta, fusão e despawn. */
  tick(world: World, playerX: number, playerY: number, playerZ: number): void {
    const targetY = playerY + 0.9;
    for (let i = 0; i < this.activeCount; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevZ[i] = this.z[i];
      this.age[i]++;

      if (this.age[i] > DESPAWN_TICKS) {
        this.removeAt(i);
        i--;
        continue;
      }

      const dx = playerX - this.x[i];
      const dy = targetY - this.y[i];
      const dz = playerZ - this.z[i];
      const distanceSq = dx * dx + dy * dy + dz * dz;

      if (this.age[i] >= PICKUP_DELAY && distanceSq < COLLECT_RADIUS * COLLECT_RADIUS) {
        this.onCollect?.(this.value[i]);
        this.removeAt(i);
        i--;
        continue;
      }

      if (this.age[i] >= PICKUP_DELAY && distanceSq < ATTRACT_RADIUS * ATTRACT_RADIUS) {
        // Atraído: a gravidade sai de cena e o orbe acelera na direção do
        // jogador. Sem isso o orbe fica preso em qualquer buraco de 1 bloco.
        const distance = Math.sqrt(distanceSq) || 1;
        this.vx[i] += (dx / distance) * ATTRACT_ACCEL;
        this.vy[i] += (dy / distance) * ATTRACT_ACCEL;
        this.vz[i] += (dz / distance) * ATTRACT_ACCEL;
        this.vx[i] *= DRAG; this.vy[i] *= DRAG; this.vz[i] *= DRAG;
        this.x[i] += this.vx[i];
        this.y[i] += this.vy[i];
        this.z[i] += this.vz[i];
        continue;
      }

      this.integrate(world, i);
    }

    this.mergeNearby();
  }

  /** Queda livre com pouso: só o eixo Y precisa de colisão. */
  private integrate(world: World, i: number): void {
    this.vy[i] += GRAVITY;
    this.vy[i] *= DRAG;

    const nextY = this.y[i] + this.vy[i];
    const belowSolid = defOf(world.getBlock(
      Math.floor(this.x[i]), Math.floor(nextY - 0.05), Math.floor(this.z[i]),
    )).solid;

    if (this.vy[i] < 0 && belowSolid) {
      this.y[i] = Math.floor(nextY) + 1;
      this.vy[i] = 0;
      this.vx[i] *= GROUND_FRICTION;
      this.vz[i] *= GROUND_FRICTION;
    } else {
      this.y[i] = nextY;
    }

    const nx = this.x[i] + this.vx[i];
    const nz = this.z[i] + this.vz[i];
    if (!defOf(world.getBlock(Math.floor(nx), Math.floor(this.y[i]), Math.floor(this.z[i]))).solid) {
      this.x[i] = nx;
    } else {
      this.vx[i] = 0;
    }
    if (!defOf(world.getBlock(Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(nz))).solid) {
      this.z[i] = nz;
    } else {
      this.vz[i] = 0;
    }
  }

  /** Funde orbes próximos: matar um bando não deixa 30 entidades no chão. */
  private mergeNearby(): void {
    for (let i = 0; i < this.activeCount; i++) {
      if (this.value[i] >= MAX_VALUE) continue;
      for (let j = i + 1; j < this.activeCount; j++) {
        const dx = this.x[i] - this.x[j];
        const dy = this.y[i] - this.y[j];
        const dz = this.z[i] - this.z[j];
        if (dx * dx + dy * dy + dz * dz > MERGE_RADIUS * MERGE_RADIUS) continue;

        const moved = Math.min(MAX_VALUE - this.value[i], this.value[j]);
        if (moved <= 0) continue;
        this.value[i] += moved;
        this.value[j] -= moved;
        if (this.value[j] <= 0) {
          this.removeAt(j);
          j--;
        }
        if (this.value[i] >= MAX_VALUE) break;
      }
    }
  }

  private removeAt(i: number): void {
    const last = --this.activeCount;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.prevX[i] = this.prevX[last];
    this.prevY[i] = this.prevY[last];
    this.prevZ[i] = this.prevZ[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.value[i] = this.value[last];
    this.age[i] = this.age[last];
  }

  /** Percorre os orbes ativos para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, value: number, age: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.activeCount; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.value[i], this.age[i],
      );
    }
  }

  clear(): void {
    this.activeCount = 0;
  }
}
