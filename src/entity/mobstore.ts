/**
 * Armazenamento e física dos mobs (doc 07).
 *
 * Tudo em **arrays paralelos** com pool de slots: 20 mobs em T0 significam 20
 * entidades ticando 20 vezes por segundo, e um objeto por mob com um objeto de
 * caminho dentro seria lixo garantido para o GC. Remover do meio é troca com o
 * último, como nas partículas e nos itens no chão.
 *
 * Este módulo cuida só de **estado e movimento**. Quem decide para onde ir é
 * `ai/goals.ts`; quem decide quando nascer é `spawn.ts`.
 */

import { defOf } from '../data/blocks';
import { mobDef } from '../data/mobs';
import { WORLD_HEIGHT } from '../world/chunk';
import { createAabb, moveWithCollision, setAabbFromBase, type Aabb } from '../world/physics';
import type { World } from '../world/world';
import { VillageState } from './villagestate';

/** Nós guardados por caminho. Acima disso o A* já estourou o orçamento. */
export const PATH_MAX = 24;

/** Bits de `flags`. */
export const FLAG_ANGRY = 1;
export const FLAG_TAMED = 2;
/** Nunca despawna (domado, nomeado, ou colocado à mão pelo jogador). */
export const FLAG_PERSISTENT = 4;
export const FLAG_IN_WATER = 8;
export const FLAG_CLIMBING = 16;
/** Aldeão deitado na cama (M9): parado, e o render o desenha deitado. */
export const FLAG_SLEEPING = 32;
/** Aldeão com a tela de troca aberta: fica de frente para o jogador. */
export const FLAG_TRADING = 64;

const GRAVITY = -0.08;
const VERTICAL_DRAG = 0.98;
const WATER_DRAG = 0.8;
const BUOYANCY = 0.03;
const AUTO_STEP = 0.6;
/** Impulso de pulo: o mesmo do jogador, para transpor um bloco inteiro. */
export const JUMP_IMPULSE = 0.42;
const GROUND_BLEND = 0.28;
/** Arrasto vertical de quem voa: sem isto o ghast sobe para sempre. */
const FLIGHT_DRAG = 0.92;
/** Quanto da velocidade vertical alvo entra por tick, para quem voa. */
const FLIGHT_BLEND = 0.12;
const AIR_BLEND = 0.06;
const GROUND_FRICTION = 0.6;
const AIR_FRICTION = 0.91;
const EPSILON = 0.003;
/** Queda mais lenta da galinha (doc 07 §2). */
const GLIDE_MAX_FALL = -0.12;

export class MobStore {
  readonly capacity: number;

  /**
   * Aleatório do jogo, injetável — o mesmo padrão de `world/growth.ts`.
   *
   * Chamar `Math.random()` direto daqui tornava **todo** teste de mob
   * não-determinístico: o yaw de nascimento e o primeiro passeio saíam
   * diferentes a cada execução, e a suíte completa falhava de vez em quando
   * sem ninguém conseguir reproduzir (doc 15 §6, 2026-09-13).
   */
  random: () => number = Math.random;

  readonly x: Float64Array;
  readonly y: Float64Array;
  readonly z: Float64Array;
  readonly prevX: Float64Array;
  readonly prevY: Float64Array;
  readonly prevZ: Float64Array;
  readonly vx: Float32Array;
  readonly vy: Float32Array;
  readonly vz: Float32Array;

  /** Id do tipo em `data/mobs.ts`. */
  readonly type: Uint8Array;
  readonly health: Float32Array;
  readonly age: Int32Array;
  readonly yaw: Float32Array;
  readonly prevYaw: Float32Array;
  readonly headYaw: Float32Array;
  readonly pitch: Float32Array;
  readonly flags: Uint8Array;
  /** Escala do modelo (slime pequeno/médio/grande). */
  readonly scale: Float32Array;
  /** Variante: tamanho do slime, cor da ovelha (ver `entity/husbandry.ts`). */
  readonly variant: Uint8Array;
  /**
   * Ticks até o próximo produto do bicho — o ovo da galinha (2026-09-22).
   * 0 = ainda não sorteado.
   */
  readonly product: Int32Array;
  /** Bloco que o enderman carrega (`blockState`), ou 0 (2026-09-22). */
  readonly carried: Uint16Array;

  readonly onGround: Uint8Array;
  /** Ticks de piscada vermelha após dano. */
  readonly hurtTicks: Int16Array;
  readonly attackCooldown: Int16Array;
  /** Pavio do creeper; −1 = desarmado. */
  readonly fuse: Int16Array;
  readonly fireTicks: Int16Array;
  /** Ticks restantes do estado de pânico. */
  readonly panicTicks: Int16Array;
  /** Ticks sem linha de visão para o alvo; perde o alvo em 100 (5 s). */
  readonly blindTicks: Int16Array;
  /** true (1) se está perseguindo o jogador. */
  readonly hasTarget: Uint8Array;
  /** Ticks restantes de "no amor" — procurando par para reproduzir. */
  readonly loveTicks: Int16Array;
  /** Ticks até virar adulto; 0 = já é adulto. */
  readonly growTicks: Int32Array;
  /** Ticks até poder se reproduzir de novo. */
  readonly breedCooldown: Int16Array;
  /** Ticks já gastos arrombando o bloco à frente; 0 = não está quebrando nada. */
  readonly breakTicks: Int16Array;

  /** Destino do movimento e se ele vale. */
  readonly moveX: Float32Array;
  readonly moveY: Float32Array;
  readonly moveZ: Float32Array;
  readonly hasMove: Uint8Array;
  /** Fração de `def.speed` usada neste movimento. */
  readonly moveSpeed: Float32Array;
  /** Ticks até poder pedir outro caminho / escolher outro destino. */
  readonly pathCooldown: Int16Array;
  readonly wanderCooldown: Int16Array;
  readonly jumpCooldown: Int16Array;

  /** Caminho do A*, achatado: PATH_MAX nós por mob. */
  readonly pathX: Int16Array;
  readonly pathY: Int16Array;
  readonly pathZ: Int16Array;
  readonly pathLen: Uint8Array;
  readonly pathIndex: Uint8Array;

  /** Animação procedural (doc 07 §5). */
  readonly limbSwing: Float32Array;
  readonly limbAmount: Float32Array;
  /** Achatamento vertical (slime pulando). */
  readonly squash: Float32Array;

  /** Casa, trabalho, aldeia e trocas de quem mora numa aldeia (M9). */
  readonly village: VillageState;

  private readonly aabb: Aabb = createAabb();
  private count = 0;

  constructor(capacity = 128) {
    this.capacity = capacity;
    const f64 = (): Float64Array => new Float64Array(capacity);
    const f32 = (): Float32Array => new Float32Array(capacity);
    const i16 = (): Int16Array => new Int16Array(capacity);
    const u8 = (): Uint8Array => new Uint8Array(capacity);

    this.x = f64(); this.y = f64(); this.z = f64();
    this.prevX = f64(); this.prevY = f64(); this.prevZ = f64();
    this.vx = f32(); this.vy = f32(); this.vz = f32();
    this.type = u8();
    this.health = f32();
    this.age = new Int32Array(capacity);
    this.yaw = f32(); this.prevYaw = f32(); this.headYaw = f32(); this.pitch = f32();
    this.flags = u8();
    this.scale = f32();
    this.variant = u8();
    this.product = new Int32Array(capacity);
    this.carried = new Uint16Array(capacity);
    this.onGround = u8();
    this.hurtTicks = i16();
    this.attackCooldown = i16();
    this.fuse = i16();
    this.fireTicks = i16();
    this.panicTicks = i16();
    this.blindTicks = i16();
    this.hasTarget = u8();
    this.loveTicks = i16();
    this.growTicks = new Int32Array(capacity);
    this.breedCooldown = i16();
    this.breakTicks = i16();
    this.moveX = f32(); this.moveY = f32(); this.moveZ = f32();
    this.hasMove = u8();
    this.moveSpeed = f32();
    this.pathCooldown = i16();
    this.wanderCooldown = i16();
    this.jumpCooldown = i16();
    this.pathX = new Int16Array(capacity * PATH_MAX);
    this.pathY = new Int16Array(capacity * PATH_MAX);
    this.pathZ = new Int16Array(capacity * PATH_MAX);
    this.pathLen = u8();
    this.pathIndex = u8();
    this.limbSwing = f32();
    this.limbAmount = f32();
    this.squash = f32();
    this.village = new VillageState(capacity);
  }

  get active(): number {
    return this.count;
  }

  /** Nasce um mob. Devolve o índice, ou −1 se o pool está cheio. */
  spawn(typeId: number, x: number, y: number, z: number, variant = 0): number {
    if (this.count >= this.capacity) return -1;
    const i = this.count++;
    const def = mobDef(typeId);

    this.type[i] = typeId;
    this.x[i] = x; this.y[i] = y; this.z[i] = z;
    this.prevX[i] = x; this.prevY[i] = y; this.prevZ[i] = z;
    this.vx[i] = 0; this.vy[i] = 0; this.vz[i] = 0;
    this.variant[i] = variant;
    this.product[i] = 0;
    this.carried[i] = 0;
    this.scale[i] = def.traits.splitsOnDeath === true
      ? slimeScale(variant)
      : def.traits.modelScale ?? 1;
    this.health[i] = def.traits.splitsOnDeath === true
      ? slimeHealth(variant)
      : def.health;
    this.age[i] = 0;
    this.yaw[i] = this.random() * Math.PI * 2;
    this.prevYaw[i] = this.yaw[i];
    this.headYaw[i] = this.yaw[i];
    this.pitch[i] = 0;
    this.flags[i] = 0;
    this.onGround[i] = 0;
    this.hurtTicks[i] = 0;
    this.attackCooldown[i] = 0;
    this.fuse[i] = -1;
    this.fireTicks[i] = 0;
    this.panicTicks[i] = 0;
    this.blindTicks[i] = 0;
    this.hasTarget[i] = 0;
    this.loveTicks[i] = 0;
    this.growTicks[i] = 0;
    this.breedCooldown[i] = 0;
    this.breakTicks[i] = 0;
    this.hasMove[i] = 0;
    this.moveSpeed[i] = 1;
    this.pathCooldown[i] = 0;
    this.wanderCooldown[i] = (this.random() * 40) | 0;
    this.jumpCooldown[i] = 0;
    this.pathLen[i] = 0;
    this.pathIndex[i] = 0;
    this.limbSwing[i] = 0;
    this.limbAmount[i] = 0;
    this.squash[i] = 0;
    this.village.reset(i);
    return i;
  }

  /** Remove trocando com o último — nada de realocar nem embaralhar. */
  removeAt(i: number): void {
    const last = --this.count;
    if (i !== last) {
      copyEntry(this, i, last);
      this.village.copy(i, last);
      for (let n = 0; n < PATH_MAX; n++) {
        this.pathX[i * PATH_MAX + n] = this.pathX[last * PATH_MAX + n];
        this.pathY[i * PATH_MAX + n] = this.pathY[last * PATH_MAX + n];
        this.pathZ[i * PATH_MAX + n] = this.pathZ[last * PATH_MAX + n];
      }
    }
  }

  clear(): void {
    this.count = 0;
  }

  /** Escala do filhote — metade do adulto, como no original. */
  static readonly BABY_SCALE = 0.5;

  /** true se o mob ainda é filhote. */
  isBaby(i: number): boolean {
    return this.growTicks[i] > 0;
  }

  /**
   * Nasce filhote: metade do tamanho e `ticks` até crescer. Chamado logo depois
   * de `spawn`, porque `spawn` já cuidou de zerar tudo.
   */
  makeBaby(i: number, ticks: number): void {
    this.growTicks[i] = ticks;
    this.scale[i] = MobStore.BABY_SCALE;
  }

  /**
   * Um tick dos contadores de reprodução. Devolve true no tick em que o
   * filhote vira adulto — quem chama usa isso para o som.
   */
  tickGrowth(i: number): boolean {
    if (this.loveTicks[i] > 0) this.loveTicks[i]--;
    if (this.breedCooldown[i] > 0) this.breedCooldown[i]--;
    if (this.growTicks[i] <= 0) return false;
    this.growTicks[i]--;
    if (this.growTicks[i] > 0) return false;
    this.scale[i] = 1;
    return true;
  }

  width(i: number): number {
    return mobDef(this.type[i]).width * this.scale[i];
  }

  height(i: number): number {
    return mobDef(this.type[i]).height * this.scale[i];
  }

  /** Centro da hitbox — usado por alcance de ataque e linha de visão. */
  centerY(i: number): number {
    return this.y[i] + this.height(i) * 0.5;
  }

  /** Olhos do mob, um pouco abaixo do topo. */
  eyeY(i: number): number {
    return this.y[i] + this.height(i) * 0.85;
  }

  hasFlag(i: number, flag: number): boolean {
    return (this.flags[i] & flag) !== 0;
  }

  setFlag(i: number, flag: number, on: boolean): void {
    if (on) this.flags[i] |= flag;
    else this.flags[i] &= ~flag;
  }

  /** Manda o mob andar até um ponto, com fração da velocidade base. */
  setMoveTarget(i: number, x: number, y: number, z: number, speed = 1): void {
    this.moveX[i] = x;
    this.moveY[i] = y;
    this.moveZ[i] = z;
    this.moveSpeed[i] = speed;
    this.hasMove[i] = 1;
  }

  clearMoveTarget(i: number): void {
    this.hasMove[i] = 0;
    this.pathLen[i] = 0;
  }

  /**
   * Um tick de física: velocidade desejada → gravidade → colisão → atrito.
   * A mesma ordem do jogador (doc 06 §1), pelo mesmo motivo: resolver Y antes
   * é o que permite o auto-step e o pulo.
   */
  tickPhysics(world: World, i: number): void {
    const def = mobDef(this.type[i]);
    this.prevX[i] = this.x[i];
    this.prevY[i] = this.y[i];
    this.prevZ[i] = this.z[i];
    this.prevYaw[i] = this.yaw[i];

    const feet = defOf(world.getBlock(
      Math.floor(this.x[i]), Math.floor(this.y[i] + 0.1), Math.floor(this.z[i]),
    ));
    const inWater = feet.name === 'water';
    this.setFlag(i, FLAG_IN_WATER, inWater);

    this.steerToMoveTarget(i, def.speed, inWater);

    // Gravidade (lula flutua; ghast voa; galinha planeja).
    if (def.traits.flies === true) {
      // Sem gravidade nenhuma: quem voa é sustentado pelo próprio movimento.
      this.vy[i] *= FLIGHT_DRAG;
    } else if (def.traits.swims === true && inWater) {
      this.vy[i] *= 0.9;
    } else if (inWater) {
      this.vy[i] = (this.vy[i] + GRAVITY * 0.25) * WATER_DRAG;
      // Mobs que não afundam de propósito sobem devagar (goal `floatInWater`).
      if (this.hasMove[i] === 1) this.vy[i] += BUOYANCY;
    } else {
      this.vy[i] = (this.vy[i] + GRAVITY) * VERTICAL_DRAG;
      if (def.traits.glides === true && this.vy[i] < GLIDE_MAX_FALL) this.vy[i] = GLIDE_MAX_FALL;
    }

    // Aranha subindo parede: vira "escalar" enquanto encostada.
    if (this.hasFlag(i, FLAG_CLIMBING)) this.vy[i] = 0.14;

    const width = this.width(i);
    const height = this.height(i);
    setAabbFromBase(this.aabb, this.x[i], this.y[i], this.z[i], width, height);
    const result = moveWithCollision(
      world, this.aabb, this.vx[i], this.vy[i], this.vz[i],
      this.onGround[i] === 1 ? AUTO_STEP : 0,
    );

    this.x[i] += result.dx;
    this.y[i] += result.dy;
    this.z[i] += result.dz;

    const blocked = result.collidedX || result.collidedZ;
    if (result.collidedX) this.vx[i] = 0;
    if (result.collidedZ) this.vz[i] = 0;
    if (result.collidedY) this.vy[i] = 0;
    this.onGround[i] = result.onGround ? 1 : 0;

    // Travou de frente: pula (ou escala, se for aranha).
    if (blocked && this.hasMove[i] === 1) {
      if (def.traits.climbsWalls === true) {
        this.setFlag(i, FLAG_CLIMBING, true);
      } else if (this.onGround[i] === 1 && this.jumpCooldown[i] <= 0) {
        /*
         * O pulo é decidido **depois** de mover, e o tick seguinte aplica
         * gravidade e arrasto **antes** de mover. Com `vy = JUMP_IMPULSE` o
         * primeiro passo subia 0,33 e o pico ficava em 0,83 bloco — nenhum mob
         * subia um degrau de bloco inteiro, desde o M5: o caminho do A* que
         * sobe um bloco travava o bicho pulando no pé da parede (achado no M9,
         * com o aldeão voltando para casa). Descontar o que o próximo tick
         * tira faz o primeiro passo ser o impulso inteiro, como o do jogador.
         */
        this.vy[i] = JUMP_IMPULSE / VERTICAL_DRAG - GRAVITY;
        this.jumpCooldown[i] = 10;
      }
    } else {
      this.setFlag(i, FLAG_CLIMBING, false);
    }
    if (this.jumpCooldown[i] > 0) this.jumpCooldown[i]--;

    // Atrito horizontal.
    const friction = this.onGround[i] === 1 ? GROUND_FRICTION * AIR_FRICTION : AIR_FRICTION;
    this.vx[i] *= friction;
    this.vz[i] *= friction;
    if (inWater) { this.vx[i] *= WATER_DRAG; this.vz[i] *= WATER_DRAG; }
    if (Math.abs(this.vx[i]) < EPSILON) this.vx[i] = 0;
    if (Math.abs(this.vy[i]) < EPSILON) this.vy[i] = 0;
    if (Math.abs(this.vz[i]) < EPSILON) this.vz[i] = 0;

    this.y[i] = Math.max(-8, Math.min(WORLD_HEIGHT + 8, this.y[i]));
    this.updateAnimation(i, result.dx, result.dz);
  }

  /**
   * Converte o destino em velocidade horizontal. O "steering" do doc 07 §3:
   * andar direto na direção, sem caminho, resolve a maioria dos casos de graça.
   */
  private steerToMoveTarget(i: number, speed: number, inWater: boolean): void {
    if (this.hasMove[i] !== 1) return;

    const dx = this.moveX[i] - this.x[i];
    const dz = this.moveZ[i] - this.z[i];
    const distance = Math.hypot(dx, dz);
    const flying = mobDef(this.type[i]).traits.flies === true;
    // Quem voa também persegue o Y do destino; quem anda ignora, e confia no
    // pulo automático para subir degrau.
    if (flying) {
      const dy = this.moveY[i] - this.y[i];
      const perTickY = (speed / 20) * this.moveSpeed[i];
      const targetVy = Math.abs(dy) < 0.5 ? 0 : Math.sign(dy) * perTickY;
      this.vy[i] += (targetVy - this.vy[i]) * FLIGHT_BLEND;
    }
    if (distance < 0.25) {
      this.hasMove[i] = 0;
      return;
    }

    /*
     * `speed` vem em blocos/s; a simulação é por tick.
     *
     * A compensação do atrito não é enfeite. A ordem do tick é **mesclar,
     * mover, atritar**, então a velocidade com que o mob de fato anda nunca
     * alcança o alvo: ela estabiliza em `blend / (1 − atrito × (1 − blend))`
     * dele, que dá **46%** no chão. Sem isto o zumbi do doc 07 §2, de 1,15
     * blocos/s, andava a 0,53 — um oitavo do jogador caminhando, e o jogador
     * relatou em campo que "os monstros estão muito lentos". Dividir pelo
     * fator faz `def.speed` significar o que o doc diz que significa.
     */
    const onGround = this.onGround[i] === 1;
    const blend = onGround || inWater ? GROUND_BLEND : AIR_BLEND;
    const friction = (onGround ? GROUND_FRICTION * AIR_FRICTION : AIR_FRICTION)
      * (inWater ? WATER_DRAG : 1);
    const reach = blend / (1 - friction * (1 - blend));
    const perTick = ((speed / 20) * this.moveSpeed[i]) / reach;
    const targetVx = (dx / distance) * perTick;
    const targetVz = (dz / distance) * perTick;
    this.vx[i] += (targetVx - this.vx[i]) * blend;
    this.vz[i] += (targetVz - this.vz[i]) * blend;

    // O corpo vira para onde anda; a cabeça é girada por quem olha.
    this.yaw[i] = turnTowards(this.yaw[i], Math.atan2(dx, dz), 0.35);
  }

  /** `limbSwing` acumula distância percorrida — é o que anima as pernas. */
  private updateAnimation(i: number, dx: number, dz: number): void {
    const moved = Math.hypot(dx, dz);
    this.limbSwing[i] += moved * 4;
    const amount = Math.min(moved * 24, 1);
    this.limbAmount[i] += (amount - this.limbAmount[i]) * 0.4;

    // Slime achata ao pousar e alonga ao subir.
    const def = mobDef(this.type[i]);
    if (def.traits.splitsOnDeath === true) {
      const target = this.onGround[i] === 1 ? 0 : Math.max(-0.3, Math.min(0.3, this.vy[i] * 2));
      this.squash[i] += (target - this.squash[i]) * 0.3;
    }
    if (this.hurtTicks[i] > 0) this.hurtTicks[i]--;
    if (this.attackCooldown[i] > 0) this.attackCooldown[i]--;
  }

  /** Posição interpolada para o render, sem alocar. */
  renderX(i: number, alpha: number): number {
    return this.prevX[i] + (this.x[i] - this.prevX[i]) * alpha;
  }

  renderY(i: number, alpha: number): number {
    return this.prevY[i] + (this.y[i] - this.prevY[i]) * alpha;
  }

  renderZ(i: number, alpha: number): number {
    return this.prevZ[i] + (this.z[i] - this.prevZ[i]) * alpha;
  }

  renderYaw(i: number, alpha: number): number {
    let delta = this.yaw[i] - this.prevYaw[i];
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    return this.prevYaw[i] + delta * alpha;
  }
}

/** Vida do slime por tamanho (doc 07 §2: 1 / 4 / 16). */
export function slimeHealth(size: number): number {
  return size <= 1 ? 1 : size === 2 ? 4 : 16;
}

/** Escala do modelo do slime por tamanho. */
export function slimeScale(size: number): number {
  return size <= 1 ? 0.5 : size === 2 ? 1 : 1.5;
}

/** Gira `from` na direção de `to`, no máximo `maxStep` radianos. */
export function turnTowards(from: number, to: number, maxStep: number): number {
  let delta = to - from;
  while (delta > Math.PI) delta -= Math.PI * 2;
  while (delta < -Math.PI) delta += Math.PI * 2;
  if (delta > maxStep) delta = maxStep;
  else if (delta < -maxStep) delta = -maxStep;
  return from + delta;
}

/** Copia a entrada `from` sobre `to` (usado ao remover do meio do pool). */
function copyEntry(s: MobStore, to: number, from: number): void {
  s.x[to] = s.x[from]; s.y[to] = s.y[from]; s.z[to] = s.z[from];
  s.prevX[to] = s.prevX[from]; s.prevY[to] = s.prevY[from]; s.prevZ[to] = s.prevZ[from];
  s.vx[to] = s.vx[from]; s.vy[to] = s.vy[from]; s.vz[to] = s.vz[from];
  s.type[to] = s.type[from];
  s.health[to] = s.health[from];
  s.age[to] = s.age[from];
  s.yaw[to] = s.yaw[from]; s.prevYaw[to] = s.prevYaw[from];
  s.headYaw[to] = s.headYaw[from]; s.pitch[to] = s.pitch[from];
  s.flags[to] = s.flags[from];
  s.scale[to] = s.scale[from];
  s.variant[to] = s.variant[from];
  s.product[to] = s.product[from];
  s.carried[to] = s.carried[from];
  s.onGround[to] = s.onGround[from];
  s.hurtTicks[to] = s.hurtTicks[from];
  s.attackCooldown[to] = s.attackCooldown[from];
  s.fuse[to] = s.fuse[from];
  s.fireTicks[to] = s.fireTicks[from];
  s.panicTicks[to] = s.panicTicks[from];
  s.blindTicks[to] = s.blindTicks[from];
  s.hasTarget[to] = s.hasTarget[from];
  s.loveTicks[to] = s.loveTicks[from];
  s.growTicks[to] = s.growTicks[from];
  s.breedCooldown[to] = s.breedCooldown[from];
  s.breakTicks[to] = s.breakTicks[from];
  s.moveX[to] = s.moveX[from]; s.moveY[to] = s.moveY[from]; s.moveZ[to] = s.moveZ[from];
  s.hasMove[to] = s.hasMove[from];
  s.moveSpeed[to] = s.moveSpeed[from];
  s.pathCooldown[to] = s.pathCooldown[from];
  s.wanderCooldown[to] = s.wanderCooldown[from];
  s.jumpCooldown[to] = s.jumpCooldown[from];
  s.pathLen[to] = s.pathLen[from];
  s.pathIndex[to] = s.pathIndex[from];
  s.limbSwing[to] = s.limbSwing[from];
  s.limbAmount[to] = s.limbAmount[from];
  s.squash[to] = s.squash[from];
}
