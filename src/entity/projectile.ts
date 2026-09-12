/**
 * Flechas (doc 07 §6).
 *
 * Existem no M5 por causa do esqueleto: um hostil que só bate de perto não
 * obriga o jogador a se cobrir, e é isso que faz a primeira noite ser tensa.
 * O arco do jogador entra no M6 e reusa exatamente este módulo — daí o campo
 * `fromPlayer`.
 *
 * Arrays paralelas e pool fixo, como o resto das entidades.
 */

import { defOf } from '../data/blocks';
import type { World } from '../world/world';

/** Gravidade e arrasto do doc 07 §6. */
const GRAVITY = -0.05;
const DRAG = 0.99;
/** Ticks até desaparecer (1 min). */
const MAX_AGE = 1200;
/** Subpassos por tick: uma flecha rápida não pode atravessar uma parede. */
const SUBSTEPS = 4;

export class Projectiles {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly prevZ: Float64Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly damage: Float32Array;
  private readonly age: Int32Array;
  private readonly fromPlayer: Uint8Array;
  private readonly capacity: number;
  private count = 0;

  /** Chamado quando a flecha encosta em algo que pode levar dano. */
  onHit: ((x: number, y: number, z: number, damage: number, fromPlayer: boolean) => boolean) | null = null;
  onImpactSound: ((x: number, y: number, z: number) => void) | null = null;

  constructor(capacity = 64) {
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
    this.damage = new Float32Array(capacity);
    this.age = new Int32Array(capacity);
    this.fromPlayer = new Uint8Array(capacity);
  }

  get active(): number {
    return this.count;
  }

  /** Lança uma flecha. `speed` em blocos por tick. */
  spawn(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    damage: number, fromPlayer = false, speed = 1.2,
  ): boolean {
    if (this.count >= this.capacity) return false;
    const i = this.count++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.vx[i] = dx * speed;
    this.vy[i] = dy * speed;
    this.vz[i] = dz * speed;
    this.damage[i] = damage;
    this.age[i] = 0;
    this.fromPlayer[i] = fromPlayer ? 1 : 0;
    return true;
  }

  tick(world: World): void {
    for (let i = 0; i < this.count; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevZ[i] = this.z[i];
      this.age[i]++;

      if (this.age[i] > MAX_AGE) { this.removeAt(i); i--; continue; }

      this.vy[i] += GRAVITY;
      this.vx[i] *= DRAG;
      this.vy[i] *= DRAG;
      this.vz[i] *= DRAG;

      if (this.advance(world, i)) { this.removeAt(i); i--; }
    }
  }

  /** Move em subpassos. Devolve true se a flecha acabou (bateu ou acertou). */
  private advance(world: World, i: number): boolean {
    const stepX = this.vx[i] / SUBSTEPS;
    const stepY = this.vy[i] / SUBSTEPS;
    const stepZ = this.vz[i] / SUBSTEPS;

    for (let step = 0; step < SUBSTEPS; step++) {
      this.x[i] += stepX;
      this.y[i] += stepY;
      this.z[i] += stepZ;

      const def = defOf(world.getBlock(
        Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(this.z[i]),
      ));
      if (def.solid) {
        this.onImpactSound?.(this.x[i], this.y[i], this.z[i]);
        return true;
      }
      if (this.onHit !== null
        && this.onHit(this.x[i], this.y[i], this.z[i], this.damage[i], this.fromPlayer[i] === 1)) {
        return true;
      }
      if (this.y[i] < -8) return true;
    }
    return false;
  }

  private removeAt(i: number): void {
    const last = --this.count;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.prevX[i] = this.prevX[last];
    this.prevY[i] = this.prevY[last];
    this.prevZ[i] = this.prevZ[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.damage[i] = this.damage[last];
    this.age[i] = this.age[last];
    this.fromPlayer[i] = this.fromPlayer[last];
  }

  /** Percorre as flechas ativas para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, vx: number, vy: number, vz: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.count; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.vx[i], this.vy[i], this.vz[i],
      );
    }
  }

  clear(): void {
    this.count = 0;
  }
}
