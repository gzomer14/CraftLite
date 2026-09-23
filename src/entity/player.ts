/**
 * Física do jogador (doc 06 §1–§3).
 *
 * As constantes abaixo são copiadas do doc sem conversão de unidade: tudo é
 * **por tick de 50 ms**. Converter para segundos e reintegrar muda a sensação
 * de andar e pular, que é justamente o que se está tentando reproduzir.
 *
 * A ordem de integração também é normativa:
 *   input → aceleração → gravidade → colisão (Y, X, Z) → atrito → corte de épsilon
 */

import { clamp } from '../core/math';
import { defOf } from '../data/blocks';
import {
  createAabb, isSpaceBlocked, moveWithCollision, setAabbFromBase, type Aabb,
} from '../world/physics';
import type { World } from '../world/world';
import { WORLD_HEIGHT } from '../world/chunk';

// --- dimensões (doc 06 §1) ---
export const PLAYER_WIDTH = 0.6;
export const PLAYER_HEIGHT = 1.8;
export const PLAYER_HEIGHT_SNEAK = 1.5;
export const EYE_HEIGHT = 1.62;
export const EYE_HEIGHT_SNEAK = 1.27;
export const REACH_SURVIVAL = 4.5;
export const REACH_CREATIVE = 5.0;

// --- movimento (doc 06 §2) ---
const GRAVITY = -0.08;
const VERTICAL_DRAG = 0.98;
const JUMP_IMPULSE = 0.42;
const SPRINT_JUMP_BOOST = 0.2;
const GROUND_ACCELERATION = 0.1;
const AIR_ACCELERATION = 0.02;
const AIR_ACCELERATION_SPRINT = 0.026;
const DEFAULT_FRICTION = 0.6;
const AIR_FRICTION = 0.91;
const AUTO_STEP = 0.6;
const EPSILON = 0.003;

/**
 * O input do jogador é escalado por 0.98 antes de virar aceleração.
 *
 * Não é enfeite: com ele, a velocidade terminal fecha **exatamente** nos
 * 4.317 blocos/s do doc 06 §2. Sem ele dá 4.41, e a diferença é perceptível
 * ao comparar o tempo de travessia de uma distância conhecida.
 *
 *   deslocamento/tick = a / (1 − atrito) , com a = 0.1 × 0.98 × multiplicador
 *                     = 0.098 / 0.454 = 0.21586 blocos/tick = 4.3172 blocos/s
 */
const INPUT_SCALE = 0.98;

/**
 * Multiplicadores de movimento. O doc dá as velocidades em blocos/s; aqui elas
 * viram o `movementMultiplier` da fórmula de aceleração, calibrado para que a
 * velocidade terminal bata com a tabela.
 */
const WALK_MULTIPLIER = 1.0;
const SPRINT_MULTIPLIER = 1.30;
const SNEAK_MULTIPLIER = 0.3;

/** Arrasto dos fluidos (doc 06 §3). */
const WATER_DRAG = 0.8;

/**
 * Escalar (M8): a escada de mão **não escalava**.
 *
 * Ela existia desde o M6 como decoração — bonita na parede, e o jogador
 * passava por ela como se fosse ar. Não era desvio consciente registrado em
 * lugar nenhum: era um buraco.
 *
 * Os números são os do gênero, por tick: subir a 0,2 (4 blocos/s, mais lento
 * que andar, que é o ponto), descer controlado a 0,15 quando se está apenas
 * encostado, e agachar **segura** no lugar. Segurar é o que permite parar no
 * meio do poço para olhar em volta sem cair.
 */
const CLIMB_SPEED = 0.2;
const CLIMB_FALL_SPEED = -0.15;
/** Na escada o passo horizontal é curto: escorregar para fora dela irrita. */
const CLIMB_HORIZONTAL = 0.12;
const LAVA_DRAG = 0.5;
/**
 * Empuxo por tick segurando pular. **Desvio consciente do doc 06 §3**, que
 * pede +0,02: com esse número o jogo é injogável dentro d'água.
 *
 * A gravidade dentro d'água é `0.08 × 0.25 = 0.02`/tick, exatamente o empuxo
 * do doc — ou seja, o empuxo só **cancelava** a gravidade e o que sobrava era
 * o resíduo do arrasto. As terminais saíam assim:
 *
 *   subindo:  (0.02 − 0.016) / 0.2 = 0.02 blocos/tick = 0,4 blocos/s
 *   afundando:      (−0.016) / 0.2 = 0.08 blocos/tick = 1,6 blocos/s
 *
 * Quatro vezes mais lento para subir do que para afundar, 2,7 s por bloco — e
 * o jogador era o corpo com menos empuxo do jogo, abaixo do mob (0,03) e do
 * barco (0,06). Com 0,04 a subida fecha em 2,4 blocos/s, acima do 1,96 de
 * nadar na horizontal, que é a relação que faz a água parecer água.
 * Ver doc 15 §4 e `tests/physics.test.ts`, bloco "nadar".
 */
const BUOYANCY = 0.04;

export interface PlayerInput {
  /** −1..1 nos eixos locais (frente/trás e direita/esquerda). */
  forward: number;
  strafe: number;
  jump: boolean;
  sneak: boolean;
  sprint: boolean;
}

export type GameMode = 'survival' | 'creative';

/** Quanto à frente o auto-pulo procura o degrau, em blocos. */
const AUTO_JUMP_REACH = 0.45;
/** Altura máxima do degrau que o auto-pulo vence — um bloco, nunca dois. */
const AUTO_JUMP_STEP = 1;
/** AABB de sondagem do auto-pulo, pré-alocada (zero alocação no tick). */
const STEP_PROBE: Aabb = createAabb();

export class Player {
  x = 0;
  y = 0;
  z = 0;
  /** Posição do tick anterior, para interpolar no render. */
  prevX = 0;
  prevY = 0;
  prevZ = 0;

  vx = 0;
  vy = 0;
  vz = 0;

  yaw = 0;
  pitch = 0;

  onGround = false;
  sneaking = false;
  sprinting = false;
  /**
   * Sobe degraus de um bloco sozinho, sem o jogador pular (doc 09 §2).
   * Ligado por padrão no toque: no celular, subir uma borda de terra exigia
   * soltar o joystick e acertar o botão de pulo a cada bloco.
   */
  autoJump = false;
  inWater = false;
  /** true quando o corpo está dentro de um bloco escalável (M8). */
  onLadder = false;
  inLava = false;

  mode: GameMode = 'survival';
  /** Voo do modo criativo (doc 06 §9). */
  flying = false;
  /**
   * Espectador (M10): no Criativo, voa **atravessando** bloco, sem colisão, e
   * o mundo não o vê — mob não mira, item não é recolhido, bloco não quebra.
   * É a ferramenta de quem constrói grande: olhar por dentro da parede. Não é
   * um terceiro modo de jogo; só existe com `mode === 'creative'`.
   */
  spectator = false;

  /** Altura acumulada da queda, para o dano do doc 06 §6. */
  fallDistance = 0;

  readonly aabb: Aabb = createAabb();

  /** Deslocamento visual do auto-step, suavizado em 4 ticks. */
  stepOffset = 0;

  constructor(x: number, y: number, z: number) {
    this.setPosition(x, y, z);
  }

  setPosition(x: number, y: number, z: number): void {
    this.x = x; this.y = y; this.z = z;
    this.prevX = x; this.prevY = y; this.prevZ = z;
    this.vx = 0; this.vy = 0; this.vz = 0;
    this.syncAabb();
  }

  get height(): number {
    return this.sneaking ? PLAYER_HEIGHT_SNEAK : PLAYER_HEIGHT;
  }

  get eyeHeight(): number {
    return this.sneaking ? EYE_HEIGHT_SNEAK : EYE_HEIGHT;
  }

  get reach(): number {
    return this.mode === 'creative' ? REACH_CREATIVE : REACH_SURVIVAL;
  }

  private syncAabb(): void {
    setAabbFromBase(this.aabb, this.x, this.y, this.z, PLAYER_WIDTH, this.height);
  }

  /** Um tick de simulação. Chamado a 20 Hz. */
  tick(world: World, input: PlayerInput): void {
    this.prevX = this.x;
    this.prevY = this.y;
    this.prevZ = this.z;

    this.sneaking = input.sneak && this.onGround;
    this.updateFluidState(world);

    if (this.spectator && this.mode === 'creative') this.flying = true;
    if (this.flying && this.mode === 'creative') {
      this.tickFlying(world, input);
      return;
    }

    // 1–2. input → aceleração na direção, rotacionada pelo yaw
    const friction = this.onGround ? this.groundFriction(world) : AIR_FRICTION;
    this.sprinting = input.sprint && input.forward > 0 && !this.sneaking;

    const multiplier = this.sneaking ? SNEAK_MULTIPLIER
      : this.sprinting ? SPRINT_MULTIPLIER : WALK_MULTIPLIER;

    let acceleration: number;
    if (this.inWater || this.inLava) {
      // Dentro de fluido a aceleração é a do ar e quem segura é o arrasto do
      // fluido — inclusive pisando no fundo. Usar a fórmula de chão aqui daria
      // 9,8 blocos/s andando dentro d'água.
      acceleration = AIR_ACCELERATION * multiplier;
    } else if (this.onGround) {
      // Doc 06 §2: 0.1 × (0.6/friction)³ × movementMultiplier
      const ratio = DEFAULT_FRICTION / friction;
      acceleration = GROUND_ACCELERATION * ratio * ratio * ratio * multiplier;
    } else {
      acceleration = (this.sprinting ? AIR_ACCELERATION_SPRINT : AIR_ACCELERATION) * multiplier;
    }

    this.applyInputAcceleration(input, acceleration * INPUT_SCALE);

    // 3. gravidade, aplicada antes do arrasto vertical
    if (this.inWater) {
      this.vy = (this.vy + GRAVITY * 0.25) * WATER_DRAG;
    } else if (this.inLava) {
      this.vy = (this.vy + GRAVITY * 0.25) * LAVA_DRAG;
    } else {
      this.vy = (this.vy + GRAVITY) * VERTICAL_DRAG;
    }

    /*
     * Escada: a vertical passa a ser **decisão**, não queda.
     *
     * Entra depois da gravidade e antes do pulo, porque é ela que a gravidade
     * do tick acabou de sobrescrever — e antes do pulo porque na escada
     * `input.jump` quer dizer "sobe", não "salta".
     */
    if (this.onLadder && !this.flying) {
      if (this.vy < CLIMB_FALL_SPEED) this.vy = CLIMB_FALL_SPEED;
      if (input.sneak) this.vy = 0;
      else if (input.jump || input.forward > 0) this.vy = CLIMB_SPEED;
      const horizontal = Math.hypot(this.vx, this.vz);
      if (horizontal > CLIMB_HORIZONTAL) {
        const k = CLIMB_HORIZONTAL / horizontal;
        this.vx *= k;
        this.vz *= k;
      }
    }

    // O pulo entra **depois** da gravidade, e sobrescreve a vertical.
    //
    // Ordem importa: com o impulso antes da gravidade, o primeiro tick moveria
    // 0.3332 em vez de 0.42 e o pulo chegaria a 0.83 blocos em vez dos ~1.25
    // do doc 06 §2 — não passaria em cima de um bloco inteiro.
    // O auto-pulo entra como se o jogador tivesse pressionado pular.
    const wantsJump = (input.jump || this.shouldAutoJump(world, input)) && !this.onLadder;
    if (wantsJump) {
      if (this.onGround) {
        this.vy = JUMP_IMPULSE;
        if (this.sprinting) {
          // O bônus de pulo correndo é horizontal, não vertical.
          const sy = Math.sin(this.yaw);
          const cy = Math.cos(this.yaw);
          this.vx += sy * SPRINT_JUMP_BOOST;
          this.vz += cy * SPRINT_JUMP_BOOST;
        }
        this.onGround = false;
      } else if (this.inWater || this.inLava) {
        this.vy += BUOYANCY;
      }
    }

    // 4. colisão
    this.moveAndCollide(world);

    /*
     * 5. atrito horizontal, com o slipperiness do bloco pisado.
     *
     * Em fluido o arrasto do doc 06 §3 **substitui** o atrito do ar; não se
     * multiplica com ele. Antes os dois se acumulavam (0.91 × 0.8 = 0.728) e
     * a aceleração ainda levava um corte de 0.4, o que fechava a velocidade
     * terminal em 0.58 blocos/s — sete vezes mais lento que andar, e o que
     * fazia nadar parecer travado. Com o arrasto sozinho:
     *
     *   0.02 × 0.98 / (1 − 0.8) = 0.098 blocos/tick = 1.96 blocos/s
     */
    const horizontalFriction = this.inWater ? WATER_DRAG
      : this.inLava ? LAVA_DRAG
        : this.onGround ? friction * AIR_FRICTION : AIR_FRICTION;
    this.vx *= horizontalFriction;
    this.vz *= horizontalFriction;

    // 6. corta velocidades residuais
    if (Math.abs(this.vx) < EPSILON) this.vx = 0;
    if (Math.abs(this.vy) < EPSILON) this.vy = 0;
    if (Math.abs(this.vz) < EPSILON) this.vz = 0;

    // Suaviza o degrau do auto-step para a câmera não pipocar.
    if (this.stepOffset !== 0) {
      this.stepOffset *= 0.75;
      if (Math.abs(this.stepOffset) < 0.01) this.stepOffset = 0;
    }
  }

  /** Voo do criativo: sem gravidade, com arrasto forte para parar rápido. */
  /**
   * true quando há um degrau de exatamente um bloco na direção do movimento e
   * o corpo cabe em cima dele (doc 09 §2).
   *
   * Duas sondagens, não uma: a primeira acha a parede na altura dos pés, a
   * segunda confirma que o espaço logo acima está livre. Sem a segunda, o
   * jogador ficaria pulando contra um paredão de três blocos sem sair do lugar.
   */
  private shouldAutoJump(world: World, input: PlayerInput): boolean {
    if (!this.autoJump || !this.onGround) return false;
    if (this.inWater || this.inLava) return false;
    if (input.forward === 0 && input.strafe === 0) return false;

    // Direção do movimento no mundo, a partir do que foi pedido no input.
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    const dx = input.forward * sy + input.strafe * cy;
    const dz = input.forward * cy - input.strafe * sy;
    const length = Math.hypot(dx, dz);
    if (length < 0.001) return false;

    const ax = (dx / length) * AUTO_JUMP_REACH;
    const az = (dz / length) * AUTO_JUMP_REACH;
    // Bloqueado na altura dos pés?
    setAabbFromBase(STEP_PROBE, this.x + ax, this.y + 0.05, this.z + az, PLAYER_WIDTH, 0.5);
    if (!isSpaceBlocked(world, STEP_PROBE)) return false;

    // E livre um bloco acima, para o corpo inteiro caber no degrau?
    setAabbFromBase(
      STEP_PROBE, this.x + ax, this.y + AUTO_JUMP_STEP + 0.05, this.z + az,
      PLAYER_WIDTH, this.height,
    );
    if (isSpaceBlocked(world, STEP_PROBE)) return false;

    // E acima da cabeça, para não bater o teto no meio do pulo.
    setAabbFromBase(STEP_PROBE, this.x, this.y + this.height, this.z, PLAYER_WIDTH, 0.6);
    return !isSpaceBlocked(world, STEP_PROBE);
  }

  private tickFlying(world: World, input: PlayerInput): void {
    const speed = (input.sprint ? 0.5 : 0.25) * (input.sneak ? 0.5 : 1);
    this.applyInputAcceleration(input, speed * INPUT_SCALE);
    this.vy += ((input.jump ? 1 : 0) - (input.sneak ? 1 : 0)) * speed;

    if (this.spectator) {
      // Espectador (M10): anda por dentro de tudo, só não sai do mundo.
      this.x += this.vx;
      this.z += this.vz;
      this.y = Math.max(1, Math.min(WORLD_HEIGHT - 2, this.y + this.vy));
      this.onGround = false;
      this.syncAabb();
    } else {
      this.moveAndCollide(world);
    }

    this.vx *= 0.6;
    this.vy *= 0.6;
    this.vz *= 0.6;
    this.fallDistance = 0;
  }

  /** Converte forward/strafe em aceleração de mundo, normalizando a diagonal. */
  private applyInputAcceleration(input: PlayerInput, acceleration: number): void {
    let forward = input.forward;
    let strafe = input.strafe;
    const length = Math.hypot(forward, strafe);
    if (length > 1) {
      forward /= length;
      strafe /= length;
    }
    if (length === 0) return;

    // Base da câmera: forward = (sin yaw, ·, cos yaw); right = (−cos yaw, 0, sin yaw)
    const sy = Math.sin(this.yaw);
    const cy = Math.cos(this.yaw);
    this.vx += (sy * forward - cy * strafe) * acceleration;
    this.vz += (cy * forward + sy * strafe) * acceleration;
  }

  private moveAndCollide(world: World): void {
    this.syncAabb();
    const before = this.y;
    /*
     * Auto-step **não** vale na escada.
     *
     * Ele existe para subir um degrau quando o horizontal trava — e na escada o
     * horizontal trava sempre, porque ela fica colada numa parede. O passo
     * então levantava o corpo, tentava andar, e **devolvia a altura** no fim,
     * apagando a subida do tick inteiro: empurrar para a frente na escada não
     * saía do lugar. Quem sobe aqui é a escada.
     */
    const autoStep = this.onGround && !this.onLadder ? AUTO_STEP : 0;
    const result = moveWithCollision(world, this.aabb, this.vx, this.vy, this.vz, autoStep);

    // A posição fica em double e recebe os deltas; ler de volta da AABB
    // (que é `Float32Array`) truncaria a precisão e faria a velocidade em
    // regime errar ~0,6%, o bastante para não bater com a tabela do doc.
    this.x += result.dx;
    this.y += result.dy;
    this.z += result.dz;

    if (result.collidedX) this.vx = 0;
    if (result.collidedZ) this.vz = 0;

    const wasOnGround = this.onGround;
    this.onGround = result.onGround;

    if (result.collidedY) {
      // Bateu no teto ou no chão: zera a vertical.
      if (this.vy < 0) {
        this.landed();
      }
      this.vy = 0;
    } else if (this.vy < 0) {
      this.fallDistance += -result.dy;
    }

    // Degrau: guarda o offset para o render suavizar.
    const climbed = this.y - before;
    if (!wasOnGround || climbed <= 0.001) return;
    if (climbed <= AUTO_STEP + 0.01 && result.onGround) this.stepOffset -= climbed;
  }

  /** Chamado ao encostar no chão. O dano de queda entra no M4 com a vida. */
  private landed(): void {
    this.fallDistance = 0;
  }

  /** Slipperiness do bloco pisado (gelo = 0.98). */
  private groundFriction(world: World): number {
    const bx = Math.floor(this.x);
    const by = Math.floor(this.y - 0.2);
    const bz = Math.floor(this.z);
    return defOf(world.getBlock(bx, by, bz)).slipperiness;
  }

  /**
   * Em que fluido o corpo está, pelo bloco que os pés ocupam.
   *
   * O viés era `+0.1`, e ele desligava o empuxo **um décimo de bloco abaixo**
   * da superfície — justo o décimo que falta para pisar numa margem no mesmo
   * nível da água. O jogador batia na parede do lago para sempre.
   *
   * Mas não pode ir a zero: parado no fundo, a colisão deixa os pés na borda
   * exata do bloco e o ponto flutuante joga o `floor()` um bloco para baixo,
   * o que fazia o jogador submerso contar como fora d'água. `EPSILON` cobre o
   * arredondamento sem comer a superfície.
   */
  private updateFluidState(world: World): void {
    const bx = Math.floor(this.x);
    const bz = Math.floor(this.z);
    const feet = Math.floor(this.y + EPSILON);
    const def = defOf(world.getBlock(bx, feet, bz));
    this.inWater = def.name === 'water';
    this.inLava = def.name === 'lava';
    /*
     * Escalável nos pés **ou** na cabeça: no topo do poço os pés já saíram da
     * última escada enquanto o corpo ainda está nela, e sem a segunda consulta
     * o jogador despencava justamente no último degrau.
     */
    const head = Math.floor(this.y + this.height - EPSILON);
    this.onLadder = def.climbable
      || (head !== feet && defOf(world.getBlock(bx, head, bz)).climbable);
  }

  /** Posição dos olhos interpolada para o render. */
  eyeX(alpha: number): number { return this.prevX + (this.x - this.prevX) * alpha; }
  eyeY(alpha: number): number {
    return this.prevY + (this.y - this.prevY) * alpha + this.eyeHeight + this.stepOffset;
  }
  eyeZ(alpha: number): number { return this.prevZ + (this.z - this.prevZ) * alpha; }

  /** Velocidade horizontal em blocos/s, para o overlay de debug. */
  get horizontalSpeed(): number {
    return Math.hypot(this.vx, this.vz) * 20;
  }

  clampToWorld(): void {
    this.y = clamp(this.y, -16, 200);
  }
}
