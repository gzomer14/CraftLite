/**
 * Itens dropados no chão (doc 14, M4).
 *
 * São muitos e de vida curta, então tudo vive em arrays paralelos com um pool
 * de slots livres: dropar 64 blocos não pode gerar 64 objetos para o GC.
 *
 * Regras: caem com gravidade, deslizam pouco, **fundem** com pilhas iguais
 * próximas, são coletados quando o jogador chega perto e somem depois de
 * 5 minutos.
 */

import { defOf } from '../data/blocks';
import { maxStackOf, type ItemStack } from '../data/items';
import type { World } from '../world/world';

/** Ticks até desaparecer: 5 minutos. */
const DESPAWN_TICKS = 6000;
/** Ticks antes de poder ser coletado — evita recolher o que acabou de sair da mão. */
const PICKUP_DELAY = 10;
/**
 * Ticks antes de o jogador poder recoletar o que ele **jogou fora** (2 s).
 *
 * Meio segundo não bastava: a caixa de coleta tem 1,3 de raio horizontal, o
 * item saía com um empurrão aleatório de ±0,05 e caía praticamente nos pés de
 * quem o jogou. Na prática, largar um item era vê-lo voltar para a mochila
 * sozinho — e o jogador sem uma forma de se livrar de nada (relato de campo
 * 2026-09-14). O arremesso para a frente resolve o caso normal; este atraso
 * resolve o resto, inclusive quem joga contra a parede e anda atrás do item.
 */
const THROWN_PICKUP_DELAY = 40;
/**
 * Caixa de coleta: a AABB do jogador expandida.
 *
 * Um raio esférico em torno do meio do corpo falha justamente no caso mais
 * comum — quebrar o bloco sob os próprios pés deixa o item ~1,6 abaixo do
 * centro, fora de qualquer esfera razoável, e o jogador vê o item no chão sem
 * conseguir pegá-lo.
 */
const PICKUP_HORIZONTAL = 1.3;
const PICKUP_BELOW = 1.5;
const PICKUP_ABOVE = 2.8;
/** Velocidade do arremesso, em blocos por tick. */
const THROW_SPEED = 0.3;
/** Raio em que duas pilhas iguais se fundem. */
const MERGE_RADIUS = 0.75;
const GRAVITY = -0.04;
const DRAG = 0.98;
const GROUND_FRICTION = 0.6;

export class ItemEntities {
  private readonly x: Float64Array;
  private readonly y: Float64Array;
  private readonly z: Float64Array;
  private readonly prevX: Float64Array;
  private readonly prevY: Float64Array;
  private readonly prevZ: Float64Array;
  private readonly vx: Float32Array;
  private readonly vy: Float32Array;
  private readonly vz: Float32Array;
  private readonly item: Uint16Array;
  private readonly count: Uint8Array;
  private readonly damage: Uint16Array;
  private readonly age: Int32Array;
  /** Ticks que cada item ainda precisa esperar para poder ser coletado. */
  private readonly pickupAt: Int32Array;
  private readonly capacity: number;

  private activeCount = 0;

  /** Chamado quando o jogador coleta; devolve quanto não coube. */
  onPickup: ((stack: ItemStack) => number) | null = null;

  constructor(capacity = 512) {
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
    this.item = new Uint16Array(capacity);
    this.count = new Uint8Array(capacity);
    this.damage = new Uint16Array(capacity);
    this.age = new Int32Array(capacity);
    this.pickupAt = new Int32Array(capacity);
  }

  get active(): number {
    return this.activeCount;
  }

/**
   * Solta um item no mundo, com um empurrão aleatório.
   *
   * `throwDir` é a direção do arremesso, normalizada — o olhar de quem jogou.
   * Sem ela o item apenas cai onde nasceu, que é o certo para o que sai de um
   * bloco quebrado.
   */
  spawn(
    x: number, y: number, z: number, stack: ItemStack,
    throwDir?: ArrayLike<number> | null,
  ): boolean {
    if (this.activeCount >= this.capacity) return false;
    const i = this.activeCount++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;

    if (throwDir !== undefined && throwDir !== null) {
      /*
       * Jogado pelo jogador: sai **na direção do olhar**, com força.
       *
       * Antes o "arremesso" era um empurrão aleatório de ±0,05 por eixo, que
       * derruba o item a menos de meio bloco de distância — dentro da caixa de
       * coleta, que tem 1,3. Com atrito e gravidade, 0,3 por tick põe o item a
       * uns três blocos à frente, que é onde o jogador espera vê-lo.
       */
      const spread = 0.02;
      this.vx[i] = throwDir[0] * THROW_SPEED + (Math.random() - 0.5) * spread;
      this.vy[i] = throwDir[1] * THROW_SPEED + 0.2;
      this.vz[i] = throwDir[2] * THROW_SPEED + (Math.random() - 0.5) * spread;
      this.pickupAt[i] = THROWN_PICKUP_DELAY;
    } else {
      this.vx[i] = (Math.random() - 0.5) * 0.08;
      this.vy[i] = 0.12;
      this.vz[i] = (Math.random() - 0.5) * 0.08;
      this.pickupAt[i] = PICKUP_DELAY;
    }

    this.item[i] = stack.item;
    this.count[i] = Math.min(255, stack.count);
    this.damage[i] = stack.damage;
    this.age[i] = 0;
    return true;
  }

  /** Um tick: física, fusão, coleta e despawn. */
  tick(world: World, playerX: number, playerY: number, playerZ: number): void {
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

      this.integrate(world, i);

      if (this.age[i] >= this.pickupAt[i]) {
        if (this.tryPickup(i, playerX, playerY, playerZ)) { i--; continue; }
      }
    }

    this.mergeNearby();
  }

  /** Gravidade, arrasto e colisão simplificada (só o eixo Y importa aqui). */
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

    // Horizontal: só anda se o destino não for sólido.
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

  private tryPickup(i: number, px: number, py: number, pz: number): boolean {
    // `py` é a base do jogador; a caixa vai de um pouco abaixo dos pés até
    // acima da cabeça.
    const dx = this.x[i] - px;
    const dz = this.z[i] - pz;
    const dy = this.y[i] - py;
    if (Math.abs(dx) > PICKUP_HORIZONTAL || Math.abs(dz) > PICKUP_HORIZONTAL) return false;
    if (dy < -PICKUP_BELOW || dy > PICKUP_ABOVE) return false;
    if (this.onPickup === null) return false;

    const leftover = this.onPickup({
      item: this.item[i], count: this.count[i], damage: this.damage[i],
    });
    if (leftover >= this.count[i]) return false; // inventário cheio: fica no chão
    if (leftover > 0) {
      this.count[i] = leftover;
      return false;
    }
    this.removeAt(i);
    return true;
  }

  /**
   * Funde pilhas iguais próximas. Sem isso, minerar uma veia de carvão deixa
   * 8 entidades separadas no chão, cada uma custando física e render.
   */
  private mergeNearby(): void {
    for (let i = 0; i < this.activeCount; i++) {
      for (let j = i + 1; j < this.activeCount; j++) {
        if (this.item[i] !== this.item[j] || this.damage[i] !== this.damage[j]) continue;
        const max = maxStackOf(this.item[i]);
        if (this.count[i] >= max) break;

        const dx = this.x[i] - this.x[j];
        const dy = this.y[i] - this.y[j];
        const dz = this.z[i] - this.z[j];
        if (dx * dx + dy * dy + dz * dz > MERGE_RADIUS * MERGE_RADIUS) continue;

        const moved = Math.min(max - this.count[i], this.count[j]);
        this.count[i] += moved;
        this.count[j] -= moved;
        if (this.count[j] <= 0) {
          this.removeAt(j);
          j--;
        }
      }
    }
  }

  /** Troca com o último: remover do meio sem realocar. */
  private removeAt(i: number): void {
    const last = --this.activeCount;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.prevX[i] = this.prevX[last];
    this.prevY[i] = this.prevY[last];
    this.prevZ[i] = this.prevZ[last];
    this.vx[i] = this.vx[last]; this.vy[i] = this.vy[last]; this.vz[i] = this.vz[last];
    this.item[i] = this.item[last];
    this.count[i] = this.count[last];
    this.damage[i] = this.damage[last];
    this.age[i] = this.age[last];
    this.pickupAt[i] = this.pickupAt[last];
  }

  /** Percorre as entidades ativas para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, item: number, count: number, age: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.activeCount; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.item[i], this.count[i], this.age[i],
      );
    }
  }

  clear(): void {
    this.activeCount = 0;
  }
}
