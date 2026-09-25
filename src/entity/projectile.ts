/**
 * Flechas e bolas de fogo (doc 07 §6).
 *
 * Existem no M5 por causa do esqueleto: um hostil que só bate de perto não
 * obriga o jogador a se cobrir, e é isso que faz a primeira noite ser tensa.
 * O arco do jogador entra no M6 e reusa exatamente este módulo — daí o campo
 * `fromPlayer`.
 *
 * O M7 acrescentou a bola de fogo do ghast, que é uma flecha com duas
 * diferenças declaradas por bandeira e não por classe nova: **não cai** (sem
 * gravidade) e **explode** ao parar. Um segundo pool para dois campos seria
 * dobrar o código do tick para nada.
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

/** Bandeiras de projétil. */
export const FLAG_NO_GRAVITY = 1;
export const FLAG_EXPLOSIVE = 2;
/** A bola de fogo do ghast: voa reto e explode onde parar. */
export const FIREBALL_FLAGS = FLAG_NO_GRAVITY | FLAG_EXPLOSIVE;
/**
 * Ovo (2026-09-22): quebra ao parar, e quem ouve `onEgg` sorteia o pintinho.
 * Ovo e bola de neve são projéteis **com item** — desenhados com o sprite do
 * item, não com o modelo da flecha.
 */
export const FLAG_EGG = 4;
/**
 * Olho do ender (M16): voa na direção da fortaleza sem bater em nada e, depois
 * de `EYE_TICKS`, avisa `onEye` — quem ouve decide se ele cai ou se parte.
 */
export const FLAG_EYE = 8;
/**
 * Bola de fogo do blaze (M16): não cai, não explode — **incendeia** o que
 * acerta (o jogador arde; o bloco pega fogo). Quem ouve é `onIgnite`.
 */
export const FLAG_IGNITES = 16;
/** Frasco arremessado da bruxa (M16): quebra e espalha o efeito (`onPotion`). */
export const FLAG_POTION = 32;
/** Ticks de voo do olho antes de parar no ar. */
export const EYE_TICKS = 40;

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
  /** Bandeiras: bit 0 = sem gravidade, bit 1 = explode ao parar. */
  private readonly flags: Uint8Array;
  /** Item arremessado (ovo, bola de neve); 0 = flecha ou bola de fogo. */
  private readonly item: Uint16Array;
  private readonly capacity: number;
  private count = 0;

  /** Chamado quando o projétil encosta em algo que pode levar dano. */
  onHit: ((
    x: number, y: number, z: number, damage: number, fromPlayer: boolean, flags: number,
  ) => boolean) | null = null;
  onImpactSound: ((x: number, y: number, z: number) => void) | null = null;
  /** Um projétil explosivo parou: quem ouve detona (bola de fogo do ghast). */
  onExplode: ((x: number, y: number, z: number) => void) | null = null;
  /** Um ovo quebrou: quem ouve sorteia o pintinho. */
  onEgg: ((x: number, y: number, z: number) => void) | null = null;
  /** O olho do ender terminou o voo (M16). */
  onEye: ((x: number, y: number, z: number) => void) | null = null;
  /** A bola de fogo do blaze parou (M16): incendeia onde bateu. */
  onIgnite: ((x: number, y: number, z: number) => void) | null = null;
  /** O frasco da bruxa quebrou (M16), com o item da poção. */
  onPotion: ((x: number, y: number, z: number, item: number) => void) | null = null;

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
    this.flags = new Uint8Array(capacity);
    this.item = new Uint16Array(capacity);
  }

  get active(): number {
    return this.count;
  }

  /** Lança um projétil. `speed` em blocos por tick. */
  spawn(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number,
    damage: number, fromPlayer = false, speed = 1.2, flags = 0, item = 0,
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
    this.flags[i] = flags;
    this.item[i] = item;
    return true;
  }

  tick(world: World): void {
    for (let i = 0; i < this.count; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevZ[i] = this.z[i];
      this.age[i]++;

      if (this.age[i] > MAX_AGE) { this.removeAt(i); i--; continue; }
      if ((this.flags[i] & FLAG_EYE) !== 0 && this.age[i] > EYE_TICKS) {
        this.detonate(i);
        this.removeAt(i); i--; continue;
      }

      if ((this.flags[i] & FLAG_NO_GRAVITY) === 0) this.vy[i] += GRAVITY;
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
      // O olho atravessa tudo: o que importa é a direção, não o caminho.
      if ((this.flags[i] & FLAG_EYE) !== 0) continue;

      const def = defOf(world.getBlock(
        Math.floor(this.x[i]), Math.floor(this.y[i]), Math.floor(this.z[i]),
      ));
      if (def.solid) {
        this.onImpactSound?.(this.x[i], this.y[i], this.z[i]);
        this.detonate(i);
        return true;
      }
      if (this.onHit !== null
        && this.onHit(
          this.x[i], this.y[i], this.z[i], this.damage[i], this.fromPlayer[i] === 1, this.flags[i],
        )) {
        this.detonate(i);
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
    this.flags[i] = this.flags[last];
    this.item[i] = this.item[last];
  }

  /** Explode, se for explosivo. Chamado em todo fim de trajetória. */
  private detonate(i: number): void {
    const flags = this.flags[i];
    if ((flags & FLAG_EGG) !== 0) this.onEgg?.(this.x[i], this.y[i], this.z[i]);
    if ((flags & FLAG_EYE) !== 0) this.onEye?.(this.x[i], this.y[i], this.z[i]);
    if ((flags & FLAG_IGNITES) !== 0) this.onIgnite?.(this.prevX[i], this.prevY[i], this.prevZ[i]);
    if ((flags & FLAG_POTION) !== 0) this.onPotion?.(this.x[i], this.y[i], this.z[i], this.item[i]);
    if ((this.flags[i] & FLAG_EXPLOSIVE) === 0) return;
    this.onExplode?.(this.x[i], this.y[i], this.z[i]);
  }

  /** Percorre as flechas ativas para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, vx: number, vy: number, vz: number, item: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.count; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.vx[i], this.vy[i], this.vz[i], this.item[i],
      );
    }
  }

  clear(): void {
    this.count = 0;
  }
}
