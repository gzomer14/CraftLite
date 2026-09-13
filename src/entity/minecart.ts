/**
 * Carrinho de mina (doc 14 — M7).
 *
 * Segue o precedente do barco (`entity/boat.ts`): não é mob e não é item no
 * chão — é uma caixa que anda, carrega o jogador e é desenhada pelo mesmo
 * batcher dos mobs.
 *
 * **A física é de trilho, não de corpo livre.** O carrinho guarda uma
 * velocidade escalar e a direção em que está indo; a cada tick ele lê a forma
 * do trilho debaixo dele, projeta a direção sobre o eixo daquela forma, anda e
 * **gruda no centro do trilho** no eixo perpendicular. É isso que faz o
 * carrinho não sair da linha, e é muito mais barato que colisão de caixa.
 *
 * Fora do trilho ele cai e freia até parar — não existe carrinho de mina
 * andando pelo campo, e tentar dirigi-lo no chão seria pior que não ter.
 */

import { blockIdOf, defOf } from '../data/blocks';
import {
  FACING_STEP, RAIL_LINKS, railIsSlope, railSlopeDir,
} from '../world/mesh/shapes';
import { isRail, railShapeOf } from '../world/rails';
import { BLOCK_BY_NAME } from '../data/blocks';
import type { World } from '../world/world';

/** Quantos carrinhos podem existir ao mesmo tempo. */
const CAPACITY = 32;
/** Velocidade máxima no trilho, em blocos por tick (≈8 blocos/s). */
export const MAX_SPEED = 0.4;
/** Atrito por tick sobre trilho comum: o carrinho para sozinho, devagar. */
const RAIL_DRAG = 0.985;
/** Atrito fora do trilho: aí ele para rápido. */
const GROUND_DRAG = 0.5;
/** Empurrão por tick de um trilho motorizado energizado. */
const BOOST = 0.06;
/** Freio por tick de um trilho motorizado **sem** energia. */
const BRAKE = 0.82;
/** Quanto a gravidade acelera descendo a rampa, e freia subindo. */
const SLOPE_ACCEL = 0.02;
/** Abaixo disto o carrinho é considerado parado. */
const EPSILON = 0.002;
const GRAVITY = -0.04;

/** Altura em que o jogador senta, acima da base do carrinho. */
export const CART_SEAT_HEIGHT = 0.35;
/** Largura da caixa, para achar e montar. */
export const CART_WIDTH = 0.98;
/** Altura do trilho dentro do bloco — o carrinho fica em cima dele. */
const RAIL_LIFT = 1 / 16;

const POWERED_RAIL = BLOCK_BY_NAME.get('powered_rail')?.id ?? -1;
const DETECTOR_RAIL = BLOCK_BY_NAME.get('detector_rail')?.id ?? -1;
/** Bit de energizado do trilho, o mesmo de `world/mesh/shapes.ts`. */
const POWERED_BIT = 16;

export interface MinecartEvents {
  /** O carrinho entrou ou saiu de um trilho detector, que vira sinal. */
  onDetector?(x: number, y: number, z: number, occupied: boolean): void;
}

export class Minecarts {
  readonly x = new Float64Array(CAPACITY);
  readonly y = new Float64Array(CAPACITY);
  readonly z = new Float64Array(CAPACITY);
  readonly prevX = new Float64Array(CAPACITY);
  readonly prevY = new Float64Array(CAPACITY);
  readonly prevZ = new Float64Array(CAPACITY);
  /** Velocidade escalar ao longo do trilho, sempre ≥ 0. */
  readonly speed = new Float32Array(CAPACITY);
  /** Direção atual, nos índices de `FACING_STEP`. */
  readonly dir = new Int8Array(CAPACITY);
  readonly yaw = new Float32Array(CAPACITY);
  readonly prevYaw = new Float32Array(CAPACITY);
  /** Velocidade vertical fora do trilho. */
  private readonly vy = new Float32Array(CAPACITY);

  private activeCount = 0;
  private readonly events: MinecartEvents;
  /** Detectores ocupados no tick anterior, para emitir só a mudança. */
  private pressed = new Set<number>();
  private scanning = new Set<number>();

  constructor(events: MinecartEvents = {}) {
    this.events = events;
  }

  get active(): number {
    return this.activeCount;
  }

  /** Põe um carrinho no mundo. Devolve o índice, ou −1 se o pool está cheio. */
  spawn(x: number, y: number, z: number, dir = 0): number {
    if (this.activeCount >= CAPACITY) return -1;
    const i = this.activeCount++;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.speed[i] = 0;
    this.vy[i] = 0;
    this.dir[i] = dir;
    this.yaw[i] = yawOf(dir);
    this.prevYaw[i] = this.yaw[i];
    return i;
  }

  /**
   * O jogador empurra: `forward` em −1..1 e o olhar de quem pilota.
   *
   * Não há acelerador — o que o olhar faz é escolher **para que lado** da linha
   * o carrinho vai, e dar o empurrão inicial. Quem mantém a velocidade é o
   * trilho motorizado, que é o ponto de existir um.
   */
  drive(index: number, forward: number, yaw: number): void {
    if (index < 0 || index >= this.activeCount || forward === 0) return;
    const wanted = dirFromYaw(yaw, forward);
    // Empurrar contra o sentido atual: inverte se o carrinho está quase parado.
    if (this.speed[index] < EPSILON) this.dir[index] = wanted;
    else if (wanted === (this.dir[index] ^ 1)) this.dir[index] ^= 1;
    this.speed[index] = Math.min(MAX_SPEED, this.speed[index] + PUSH);
  }

  /** Um tick de física para todos os carrinhos. */
  tick(world: World): void {
    this.scanning.clear();
    for (let i = 0; i < this.activeCount; i++) {
      this.prevX[i] = this.x[i];
      this.prevY[i] = this.y[i];
      this.prevZ[i] = this.z[i];
      this.prevYaw[i] = this.yaw[i];
      this.tickOne(world, i);
    }
    this.flushDetectors();
  }

  private tickOne(world: World, i: number): void {
    const bx = Math.floor(this.x[i]);
    const bz = Math.floor(this.z[i]);
    // O trilho pode estar no bloco dos pés ou um abaixo, quando o carrinho
    // acabou de descer uma rampa.
    let by = Math.floor(this.y[i] + 0.1);
    let state = world.getBlock(bx, by, bz);
    if (!isRail(state)) {
      by -= 1;
      state = world.getBlock(bx, by, bz);
    }
    if (!isRail(state)) {
      this.tickOffRail(world, i);
      return;
    }

    const shape = railShapeOf(state);
    const id = blockIdOf(state);
    const powered = (stateBits(state) & POWERED_BIT) !== 0;

    this.dir[i] = alignDirection(shape, this.dir[i]);
    this.applyRailForces(i, id, shape, powered);
    this.advance(world, i, bx, by, bz, shape);

    if (id === DETECTOR_RAIL) this.scanning.add(positionKey(bx, by, bz));
  }

  /** Empurrão, freio, rampa e atrito — nesta ordem. */
  private applyRailForces(i: number, id: number, shape: number, powered: boolean): void {
    if (id === POWERED_RAIL) {
      if (powered) this.speed[i] = Math.min(MAX_SPEED, this.speed[i] + BOOST);
      else this.speed[i] *= BRAKE;
    }

    if (railIsSlope(shape)) {
      // Descer acelera, subir freia. `railSlopeDir` diz para onde a rampa sobe.
      const up = railSlopeDir(shape);
      this.speed[i] += this.dir[i] === up ? -SLOPE_ACCEL : SLOPE_ACCEL;
    }

    this.speed[i] *= RAIL_DRAG;
    if (this.speed[i] < EPSILON) this.speed[i] = 0;
    if (this.speed[i] > MAX_SPEED) this.speed[i] = MAX_SPEED;
  }

  /**
   * Anda ao longo do trilho e gruda no centro dele.
   *
   * O eixo perpendicular é **escrito**, não integrado: é o que mantém o
   * carrinho na linha sem uma única consulta de colisão. O Y sai da forma —
   * rampa interpola entre o piso e o topo do bloco conforme a travessia.
   */
  private advance(
    world: World, i: number, bx: number, by: number, bz: number, shape: number,
  ): void {
    const step = FACING_STEP[this.dir[i]];
    const nx = this.x[i] + step[0] * this.speed[i];
    const nz = this.z[i] + step[1] * this.speed[i];

    // Chegou ao fim da linha? O bloco seguinte precisa ter trilho, no mesmo
    // nível ou um acima (subindo rampa) ou um abaixo (descendo).
    const ahead = Math.floor(nx) !== bx || Math.floor(nz) !== bz;
    if (ahead && this.railAhead(world, bx, by, bz, this.dir[i]) === null) {
      this.speed[i] = 0;
      this.snapToCenter(i, bx, bz, shape);
      this.y[i] = by + RAIL_LIFT;
      return;
    }

    this.x[i] = nx;
    this.z[i] = nz;
    this.yaw[i] = yawOf(this.dir[i]);

    const cell = this.cellOf(world, i, by);
    this.snapToCenter(i, Math.floor(this.x[i]), Math.floor(this.z[i]), cell.shape);
    this.y[i] = cell.y + RAIL_LIFT + slopeOffset(cell.shape, this.x[i], this.z[i]);
    this.vy[i] = 0;
  }

  /** Trilho sob o carrinho depois do passo: mesmo nível, acima ou abaixo. */
  private cellOf(world: World, i: number, by: number): { y: number; shape: number } {
    const bx = Math.floor(this.x[i]);
    const bz = Math.floor(this.z[i]);
    for (const dy of [1, 0, -1]) {
      const state = world.getBlock(bx, by + dy, bz);
      if (isRail(state)) return { y: by + dy, shape: railShapeOf(state) };
    }
    return { y: by, shape: -1 };
  }

  /** Fim da linha? Devolve a altura do trilho à frente, ou `null`. */
  private railAhead(
    world: World, bx: number, by: number, bz: number, dir: number,
  ): number | null {
    const step = FACING_STEP[dir];
    for (const dy of [1, 0, -1]) {
      if (isRail(world.getBlock(bx + step[0], by + dy, bz + step[1]))) return by + dy;
    }
    return null;
  }

  /** Centraliza o carrinho no eixo perpendicular ao movimento. */
  private snapToCenter(i: number, bx: number, bz: number, shape: number): void {
    if (shape < 0) return;
    const links = RAIL_LINKS[shape] ?? RAIL_LINKS[0];
    // Curva prende os dois eixos no centro; reta só o perpendicular.
    const alongX = links[0] < 2 || links[1] < 2;
    const alongZ = links[0] >= 2 || links[1] >= 2;
    if (!alongX || (alongX && alongZ)) this.x[i] = bx + 0.5;
    if (!alongZ || (alongX && alongZ)) this.z[i] = bz + 0.5;
  }

  /** Fora do trilho: cai e freia até parar. */
  private tickOffRail(world: World, i: number): void {
    this.speed[i] *= GROUND_DRAG;
    if (this.speed[i] < EPSILON) this.speed[i] = 0;

    const step = FACING_STEP[this.dir[i]];
    const nx = this.x[i] + step[0] * this.speed[i];
    const nz = this.z[i] + step[1] * this.speed[i];
    const probeY = Math.floor(this.y[i] + 0.1);
    if (!defOf(world.getBlock(Math.floor(nx), probeY, Math.floor(nz))).solid) {
      this.x[i] = nx;
      this.z[i] = nz;
    } else {
      this.speed[i] = 0;
    }

    this.vy[i] += GRAVITY;
    const next = this.y[i] + this.vy[i];
    const below = defOf(world.getBlock(
      Math.floor(this.x[i]), Math.floor(next - 0.05), Math.floor(this.z[i]),
    ));
    if (this.vy[i] < 0 && below.solid) {
      this.y[i] = Math.floor(next) + 1;
      this.vy[i] = 0;
      return;
    }
    this.y[i] = next;
  }

  /** Avisa quem ouve sobre os detectores que mudaram de estado. */
  private flushDetectors(): void {
    for (const key of this.scanning) {
      if (!this.pressed.has(key)) this.emitDetector(key, true);
    }
    for (const key of this.pressed) {
      if (!this.scanning.has(key)) this.emitDetector(key, false);
    }
    const previous = this.pressed;
    this.pressed = this.scanning;
    this.scanning = previous;
  }

  private emitDetector(key: number, occupied: boolean): void {
    this.events.onDetector?.(xOfKey(key), yOfKey(key), zOfKey(key), occupied);
  }

  /** Carrinho mais próximo de um ponto, dentro de `range`. −1 se não há. */
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

  removeAt(i: number): void {
    if (i < 0 || i >= this.activeCount) return;
    const last = --this.activeCount;
    if (i === last) return;
    this.x[i] = this.x[last]; this.y[i] = this.y[last]; this.z[i] = this.z[last];
    this.prevX[i] = this.prevX[last];
    this.prevY[i] = this.prevY[last];
    this.prevZ[i] = this.prevZ[last];
    this.speed[i] = this.speed[last];
    this.vy[i] = this.vy[last];
    this.dir[i] = this.dir[last];
    this.yaw[i] = this.yaw[last];
    this.prevYaw[i] = this.prevYaw[last];
  }

  /** Percorre os carrinhos para o render, sem alocar. */
  forEach(
    fn: (x: number, y: number, z: number, yaw: number, index: number) => void,
    alpha = 1,
  ): void {
    for (let i = 0; i < this.activeCount; i++) {
      fn(
        this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha,
        this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha,
        this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha,
        this.yaw[i],
        i,
      );
    }
  }

  clear(): void {
    this.activeCount = 0;
    this.pressed.clear();
    this.scanning.clear();
  }
}

/** Empurrão inicial de quem entra e acelera. */
const PUSH = 0.08;

/**
 * Escolhe, entre os dois lados que a forma liga, o mais parecido com a direção
 * atual. É o que faz o carrinho **sair da curva pelo outro lado** em vez de
 * ricochetear: entrando por +X numa curva +Z/+X, a saída é +Z.
 */
export function alignDirection(shape: number, current: number): number {
  const links = RAIL_LINKS[shape] ?? RAIL_LINKS[0];
  if (links[0] === current || links[1] === current) return current;
  // Veio do lado oposto a um dos dois: segue pelo outro.
  if ((links[0] ^ 1) === current) return links[1];
  if ((links[1] ^ 1) === current) return links[0];
  return links[0];
}

/** Altura extra dentro do bloco quando o trilho é rampa, 0..1. */
export function slopeOffset(shape: number, x: number, z: number): number {
  const up = railSlopeDir(shape);
  if (up < 0) return 0;
  const fx = x - Math.floor(x);
  const fz = z - Math.floor(z);
  if (up === 0) return fx;
  if (up === 1) return 1 - fx;
  if (up === 2) return fz;
  return 1 - fz;
}

/** Yaw para uma direção de `FACING_STEP`, para o carrinho apontar certo. */
function yawOf(dir: number): number {
  if (dir === 0) return Math.PI / 2;
  if (dir === 1) return -Math.PI / 2;
  if (dir === 2) return 0;
  return Math.PI;
}

/** Direção de `FACING_STEP` mais próxima do olhar, com o sinal de `forward`. */
function dirFromYaw(yaw: number, forward: number): number {
  const dx = Math.sin(yaw) * Math.sign(forward);
  const dz = Math.cos(yaw) * Math.sign(forward);
  if (Math.abs(dx) > Math.abs(dz)) return dx > 0 ? 0 : 1;
  return dz > 0 ? 2 : 3;
}

function stateBits(state: number): number {
  return (state >>> 10) & 0x3f;
}

/** Mesma chave de posição de `world/rails.ts`. */
function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}

function yOfKey(key: number): number {
  return key % 128;
}

function xOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(Math.floor(xz / 0x4000000));
}

function zOfKey(key: number): number {
  const xz = (key - (key % 128)) / 128;
  return signed26(xz % 0x4000000);
}

function signed26(value: number): number {
  return value >= 0x2000000 ? value - 0x4000000 : value;
}
