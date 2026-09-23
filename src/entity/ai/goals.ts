/**
 * IA declarativa por goals (doc 07 §2).
 *
 * Cada goal é uma função `(ctx, i) => boolean`. O `Mobs` percorre a lista do
 * mob **na ordem declarada** e o primeiro que devolve `true` assume o tick: os
 * de menor prioridade não rodam. Goals cosméticos (olhar, flutuar) devolvem
 * `false` de propósito, para aplicarem o efeito sem bloquear os outros.
 *
 * Adicionar comportamento é acrescentar um nome em `GoalName` e uma entrada
 * aqui — nenhum `switch` por tipo de mob em lugar nenhum.
 */

import { defOf } from '../../data/blocks';
import { mobDef, type GoalName } from '../../data/mobs';
import { ITEM_BY_NAME } from '../../data/items';
import { FLAG_TAMED, turnTowards, type MobStore } from '../mobstore';
import type { World } from '../../world/world';

/** O que um goal pode ver e pedir. Preenchido pelo `Mobs` a cada tick. */
export interface AiContext {
  world: World;
  store: MobStore;
  /** Posição do jogador (base dos pés) e altura dos olhos. */
  playerX: number;
  playerY: number;
  playerZ: number;
  playerEyeY: number;
  /** Item na mão do jogador, ou −1. */
  playerHeld: number;
  /** Dificuldade atual (0 = pacífico). */
  difficulty: number;
  /** Luz do céu e de bloco na posição do mob (o `Mobs` amostra antes). */
  skyLight: number;
  blockLight: number;
  isDay: boolean;
  /** Tick do dia, 0..23999 — a rotina da aldeia (M9). */
  dayTime: number;
  /** Aleatório do jogo — mobs não precisam ser determinísticos pela seed. */
  random(): number;

  // --- ações que o goal pede ao dono ---------------------------------------
  hitPlayer(i: number, damage: number): void;
  shootArrow(i: number): void;
  explode(i: number): void;
  /** Arromba o bloco em (x, y, z) — porta do zumbi no Difícil (doc 06 §10). */
  breakBlock(x: number, y: number, z: number): void;
  /** Pede um caminho A* (entra na fila com orçamento do doc 07 §3). */
  requestPath(i: number, x: number, y: number, z: number): void;
  playSound(i: number, kind: 'ambient' | 'attack'): void;
  /** Os dois se encontraram: nasce o filhote entre eles. */
  breed(i: number, partner: number): void;
  /** Um mob acerta outro — o golem no zumbi (M9). */
  hitMob(i: number, target: number, damage: number): void;
  /** Abre ou fecha a porta em `(x, y, z)`, as duas folhas (M9). */
  setDoor(x: number, y: number, z: number, open: boolean): void;
  /** Som com nome, na posição do mob — a bigorna do ferreiro (M9). */
  villageSound(i: number, name: string): void;
}

export type Goal = (ctx: AiContext, i: number) => boolean;

/** Empuxo aplicado por tick enquanto o mob está submerso. */
const FLOAT_IMPULSE = 0.05;
/** Raio do passeio aleatório (doc 07 §2). */
const WANDER_RADIUS = 10;
/** Pavio do creeper: 1,5 s (doc 07 §2). */
const FUSE_TICKS = 30;
/** Alcance de tiro do esqueleto, em blocos. */
const SHOOT_RANGE = 15;
/** Alcance de quem voa e atira (ghast): o dobro, e é o que o torna assustador. */
const FLIGHT_SHOOT_RANGE = 30;
/** Altura que o voador mantém sobre o alvo enquanto atira. */
const FLIGHT_HOVER = 8;
/** Faixa de altura que o passeio de um voador sorteia. */
const FLIGHT_WANDER_HEIGHT = 12;
/**
 * Ticks de arrombamento por ponto de dureza do bloco: a porta de carvalho tem
 * dureza 3, o que dá 12 s. É tempo de o jogador acordar e reagir — uma porta
 * que cai em dois segundos não é obstáculo, é decoração.
 */
const DOOR_TICKS_PER_HARDNESS = 80;
/** A porta só conta se o alvo estiver a esta distância ou menos. */
const DOOR_REACH = 8;
/** Quanto o mob "estica o braço" para achar o bloco da frente. */
const DOOR_STEP = 0.8;
/** Posição da porta achada, reaproveitada entre ticks (zero alocação). */
const DOOR_AT = new Int32Array(3);
/** Raio em que dois apaixonados se enxergam. */
const BREED_RANGE = 8;
/** Distância em que o filhote nasce. */
const BREED_TOUCH = 1.6;
/** Distância em que o esqueleto recua em vez de avançar. */
const SHOOT_MIN = 5;

/** Os goals daqui; os da aldeia estão em `villagegoals.ts` e o `Mobs` junta os dois. */
export type BaseGoalName = Exclude<
  GoalName, 'trade' | 'avoidHostile' | 'goHome' | 'work' | 'stayInVillage' | 'patrol' | 'defendVillage'
>;

export const GOALS: Record<BaseGoalName, Goal> = {
  /** Não afogar: sobe enquanto a cabeça está submersa. Nunca bloqueia. */
  floatInWater(ctx, i) {
    const s = ctx.store;
    const def = mobDef(s.type[i]);
    if (def.traits.swims === true) return false;
    const head = defOf(ctx.world.getBlock(
      Math.floor(s.x[i]), Math.floor(s.eyeY(i)), Math.floor(s.z[i]),
    ));
    if (head.name !== 'water') return false;
    s.vy[i] += FLOAT_IMPULSE;
    return false;
  },

  /** Passivo em pânico: corre para longe por 2 s (doc 07 §2). */
  panic(ctx, i) {
    const s = ctx.store;
    if (s.panicTicks[i] <= 0) return false;
    s.panicTicks[i]--;
    if (s.hasMove[i] === 0) {
      const angle = ctx.random() * Math.PI * 2;
      s.setMoveTarget(
        i,
        s.x[i] + Math.sin(angle) * 8,
        s.y[i],
        s.z[i] + Math.cos(angle) * 8,
        1.6,
      );
    }
    return true;
  },

  /** Creeper: para, acende o pavio e explode (doc 07 §2). */
  explode(ctx, i) {
    const s = ctx.store;
    const def = mobDef(s.type[i]);
    if (s.hasTarget[i] === 0 || def.attack === undefined) {
      s.fuse[i] = -1;
      return false;
    }
    const distance = horizontalDistance(ctx, i);
    if (distance > def.attack.reach) {
      // Saiu do raio: o pavio recua em vez de simplesmente apagar, o que dá a
      // sensação de "quase" sem virar uma armadilha injusta.
      if (s.fuse[i] > 0) s.fuse[i] -= 2;
      if (s.fuse[i] <= 0) s.fuse[i] = -1;
      return false;
    }

    if (s.fuse[i] < 0) {
      s.fuse[i] = FUSE_TICKS;
      ctx.playSound(i, 'attack');
    } else {
      s.fuse[i]--;
      if (s.fuse[i] <= 0) {
        ctx.explode(i);
        return true;
      }
    }
    s.clearMoveTarget(i);
    faceTarget(ctx, i);
    return true;
  },

  /** Esqueleto: mantém distância e atira a cada 2 s (doc 07 §2). */
  shoot(ctx, i) {
    const s = ctx.store;
    const def = mobDef(s.type[i]);
    if (s.hasTarget[i] === 0 || def.attack === undefined) return false;
    const distance = horizontalDistance(ctx, i);
    // O ghast é a única ameaça que não precisa chegar perto: alcance dobrado.
    const range = def.traits.flies === true ? FLIGHT_SHOOT_RANGE : SHOOT_RANGE;
    if (distance > range) return false;

    faceTarget(ctx, i);

    // Voador mantém altitude sobre o alvo em vez de recuar rasteiro.
    if (def.traits.flies === true) {
      s.setMoveTarget(i, s.x[i], ctx.playerY + FLIGHT_HOVER, s.z[i], 0.6);
      if (s.attackCooldown[i] <= 0) {
        s.attackCooldown[i] = def.attack.cooldownTicks;
        ctx.shootArrow(i);
      }
      return true;
    }

    if (distance < SHOOT_MIN) {
      // Recua na direção oposta ao jogador.
      const dx = s.x[i] - ctx.playerX;
      const dz = s.z[i] - ctx.playerZ;
      const length = Math.hypot(dx, dz) || 1;
      s.setMoveTarget(i, s.x[i] + (dx / length) * 4, s.y[i], s.z[i] + (dz / length) * 4, 1);
    } else if (ctx.random() < 0.08) {
      // Strafing: passo lateral, que é o que faz o esqueleto ser difícil.
      const dx = ctx.playerX - s.x[i];
      const dz = ctx.playerZ - s.z[i];
      const side = ctx.random() < 0.5 ? 1 : -1;
      s.setMoveTarget(i, s.x[i] - dz * 0.4 * side, s.y[i], s.z[i] + dx * 0.4 * side, 0.8);
    }

    if (s.attackCooldown[i] <= 0) {
      s.attackCooldown[i] = def.attack.cooldownTicks;
      ctx.shootArrow(i);
    }
    return true;
  },

  /** Corpo-a-corpo com cooldown (doc 07 §2). */
  attackMelee(ctx, i) {
    const s = ctx.store;
    const def = mobDef(s.type[i]);
    if (s.hasTarget[i] === 0 || def.attack === undefined) return false;
    if (distanceToPlayer(ctx, i) > def.attack.reach) return false;

    faceTarget(ctx, i);
    s.clearMoveTarget(i);
    if (s.attackCooldown[i] <= 0) {
      s.attackCooldown[i] = def.attack.cooldownTicks;
      const damage = def.attack.damage[Math.min(2, Math.max(0, ctx.difficulty - 1))];
      ctx.hitPlayer(i, damage);
      ctx.playSound(i, 'attack');
    }
    return true;
  },

  /**
   * Zumbi no Difícil: derruba a porta que o separa do alvo (doc 06 §10).
   * Devolve `false` quando não há porta à frente, para não roubar o tick de
   * `moveToTarget` — só assume o controle enquanto está de fato quebrando.
   */
  breakDoor(ctx, i) {
    const s = ctx.store;
    if (ctx.difficulty < 3 || s.hasTarget[i] === 0 || !doorInFront(ctx, i)) {
      s.breakTicks[i] = 0;
      return false;
    }

    s.clearMoveTarget(i);
    faceTarget(ctx, i);
    const hardness = defOf(ctx.world.getBlock(DOOR_AT[0], DOOR_AT[1], DOOR_AT[2])).hardness;
    s.breakTicks[i]++;
    if (s.breakTicks[i] < hardness * DOOR_TICKS_PER_HARDNESS) return true;

    s.breakTicks[i] = 0;
    ctx.breakBlock(DOOR_AT[0], DOOR_AT[1], DOOR_AT[2]);
    ctx.playSound(i, 'attack');
    return true;
  },

  /** Aranha: salto curto na direção do alvo. */
  leapAtTarget(ctx, i) {
    const s = ctx.store;
    if (s.hasTarget[i] === 0 || s.onGround[i] !== 1) return false;
    const distance = distanceToPlayer(ctx, i);
    if (distance < 2 || distance > 5) return false;
    if (ctx.random() > 0.08) return false;

    const dx = ctx.playerX - s.x[i];
    const dz = ctx.playerZ - s.z[i];
    const length = Math.hypot(dx, dz) || 1;
    s.vx[i] = (dx / length) * 0.32;
    s.vz[i] = (dz / length) * 0.32;
    s.vy[i] = 0.42;
    return true;
  },

  /** Persegue o jogador: A* quando vale a pena, steering sempre. */
  moveToTarget(ctx, i) {
    const s = ctx.store;
    if (s.hasTarget[i] === 0) return false;
    faceTarget(ctx, i);

    // Caminho recalculado no máximo a cada 20 ticks (doc 07 §3).
    if (s.pathCooldown[i] <= 0) {
      s.pathCooldown[i] = 20;
      ctx.requestPath(i, Math.floor(ctx.playerX), Math.floor(ctx.playerY), Math.floor(ctx.playerZ));
    }

    if (!followPath(ctx, i, 1)) {
      // Sem caminho: steering direto, o fallback do doc 07 §3.
      s.setMoveTarget(i, ctx.playerX, ctx.playerY, ctx.playerZ, 1);
    }
    return true;
  },

  /** Zumbi/esqueleto de dia: procura sombra antes de pegar fogo. */
  avoidSunlight(ctx, i) {
    const s = ctx.store;
    if (mobDef(s.type[i]).traits.burnsInSunlight !== true) return false;
    if (!ctx.isDay || ctx.skyLight < 15) return false;

    if (s.hasMove[i] === 1) return true;
    // Procura, num raio de 8, uma coluna que não veja o céu.
    for (let attempt = 0; attempt < 6; attempt++) {
      const dx = Math.round((ctx.random() - 0.5) * 16);
      const dz = Math.round((ctx.random() - 0.5) * 16);
      const x = Math.floor(s.x[i]) + dx;
      const z = Math.floor(s.z[i]) + dz;
      const y = Math.floor(s.y[i]);
      if (ctx.world.getSkyLight(x, y, z) >= 15) continue;
      s.setMoveTarget(i, x + 0.5, y, z + 0.5, 1.2);
      return true;
    }
    return false;
  },

  /**
   * No amor: procura outro da mesma espécie também no amor e vai até ele
   * (doc 14 — M6: reprodução de animais).
   *
   * Enquanto não acha par, devolve `false` de propósito: o bicho continua
   * passeando e sendo atraído pelo item, em vez de ficar parado esperando.
   */
  breed(ctx, i) {
    const s = ctx.store;
    if (s.loveTicks[i] <= 0) return false;

    const partner = findMate(ctx, i);
    if (partner < 0) return false;

    const dx = s.x[partner] - s.x[i];
    const dz = s.z[partner] - s.z[i];
    if (Math.hypot(dx, dz) <= BREED_TOUCH) {
      ctx.breed(i, partner);
      return true;
    }
    s.setMoveTarget(i, s.x[partner], s.y[partner], s.z[partner], 1);
    return true;
  },

  /** Segue quem segura o item de reprodução (doc 07 §2). */
  followItem(ctx, i) {
    const s = ctx.store;
    const traits = mobDef(s.type[i]).traits;
    const wanted = traits.temptItem;
    if (wanted === undefined) return false;
    if (ctx.playerHeld !== (ITEM_BY_NAME.get(wanted)?.id ?? -1)) return false;
    const distance = distanceToPlayer(ctx, i);
    if (distance > 10) return false;

    lookAt(ctx, i);
    if (distance < 2.2) {
      s.clearMoveTarget(i);
      return true;
    }
    s.setMoveTarget(i, ctx.playerX, ctx.playerY, ctx.playerZ, 1);
    return true;
  },

  /** Domado: anda atrás do dono e para quando chega perto (doc 07 §2). */
  followOwner(ctx, i) {
    const s = ctx.store;
    if (!s.hasFlag(i, FLAG_TAMED)) return false;
    const distance = distanceToPlayer(ctx, i);
    if (distance > 24) return false;

    lookAt(ctx, i);
    if (distance < 3) {
      s.clearMoveTarget(i);
      return true;
    }
    if (distance < 5) return true;
    s.setMoveTarget(i, ctx.playerX, ctx.playerY, ctx.playerZ, 1.2);
    return true;
  },

  /** Passeio aleatório: 30% de chance por segundo (doc 07 §2). */
  wander(ctx, i) {
    const s = ctx.store;
    if (s.hasMove[i] === 1) return true;
    if (s.wanderCooldown[i] > 0) {
      s.wanderCooldown[i]--;
      return false;
    }
    s.wanderCooldown[i] = 20;
    if (ctx.random() > 0.3) return false;

    const angle = ctx.random() * Math.PI * 2;
    const radius = ctx.random() * WANDER_RADIUS;
    // Quem voa também escolhe altura; quem anda mantém a sua e sobe degrau.
    const flying = mobDef(s.type[i]).traits.flies === true;
    const dy = flying ? (ctx.random() - 0.5) * FLIGHT_WANDER_HEIGHT : 0;
    s.setMoveTarget(
      i,
      s.x[i] + Math.sin(angle) * radius,
      s.y[i] + dy,
      s.z[i] + Math.cos(angle) * radius,
      0.7,
    );
    return true;
  },

  /** Cosmético: vira a cabeça para o jogador se ele estiver perto. */
  lookAtPlayer(ctx, i) {
    if (distanceToPlayer(ctx, i) <= 8) lookAt(ctx, i);
    return false;
  },
};

/**
 * O parceiro mais próximo no amor: mesma espécie, adulto e apaixonado.
 * Varre o pool inteiro, mas só roda para quem está no amor — que é raro.
 */
function findMate(ctx: AiContext, i: number): number {
  const s = ctx.store;
  let best = -1;
  let bestDistance = BREED_RANGE * BREED_RANGE;
  for (let k = 0; k < s.active; k++) {
    if (k === i || s.type[k] !== s.type[i]) continue;
    if (s.loveTicks[k] <= 0 || s.isBaby(k)) continue;
    const dx = s.x[k] - s.x[i];
    const dy = s.y[k] - s.y[i];
    const dz = s.z[k] - s.z[i];
    const distance = dx * dx + dy * dy + dz * dz;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = k;
  }
  return best;
}

/** Distância 3D até o centro do jogador. */
export function distanceToPlayer(ctx: AiContext, i: number): number {
  const s = ctx.store;
  const dx = ctx.playerX - s.x[i];
  const dy = ctx.playerY + 0.9 - s.centerY(i);
  const dz = ctx.playerZ - s.z[i];
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function horizontalDistance(ctx: AiContext, i: number): number {
  const s = ctx.store;
  return Math.hypot(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
}

/**
 * Procura uma porta no bloco imediatamente à frente do mob, na direção do
 * alvo, entre os pés e a cabeça. Achou, deixa a posição em `DOOR_AT`.
 */
function doorInFront(ctx: AiContext, i: number): boolean {
  const s = ctx.store;
  const dx = ctx.playerX - s.x[i];
  const dz = ctx.playerZ - s.z[i];
  const length = Math.hypot(dx, dz);
  if (length < 0.001 || length > DOOR_REACH) return false;

  const fx = Math.floor(s.x[i] + (dx / length) * DOOR_STEP);
  const fz = Math.floor(s.z[i] + (dz / length) * DOOR_STEP);
  const base = Math.floor(s.y[i]);
  for (let h = 0; h < 2; h++) {
    if (defOf(ctx.world.getBlock(fx, base + h, fz)).shape !== 'door') continue;
    DOOR_AT[0] = fx; DOOR_AT[1] = base + h; DOOR_AT[2] = fz;
    return true;
  }
  return false;
}

/** Gira corpo e cabeça para o jogador. */
function faceTarget(ctx: AiContext, i: number): void {
  const s = ctx.store;
  const angle = Math.atan2(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
  s.yaw[i] = turnTowards(s.yaw[i], angle, 0.4);
  s.headYaw[i] = angle;
  s.pitch[i] = -Math.atan2(ctx.playerEyeY - s.eyeY(i), horizontalDistance(ctx, i) || 0.01);
}

/** Só a cabeça acompanha — o corpo continua indo para onde ia. */
function lookAt(ctx: AiContext, i: number): void {
  const s = ctx.store;
  s.headYaw[i] = Math.atan2(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
  s.pitch[i] = -Math.atan2(ctx.playerEyeY - s.eyeY(i), horizontalDistance(ctx, i) || 0.01);
}

/**
 * Anda o próximo nó do caminho guardado. Devolve false quando o caminho acabou
 * ou não existe — aí quem chamou cai no steering.
 */
export function followPath(ctx: AiContext, i: number, speed: number): boolean {
  const s = ctx.store;
  const length = s.pathLen[i];
  if (length === 0) return false;

  const base = i * 24;
  let index = s.pathIndex[i];
  while (index < length) {
    const nx = s.pathX[base + index] + 0.5;
    const nz = s.pathZ[base + index] + 0.5;
    if (Math.hypot(nx - s.x[i], nz - s.z[i]) > 0.6) break;
    index++;
  }
  s.pathIndex[i] = index;
  if (index >= length) {
    s.pathLen[i] = 0;
    return false;
  }
  s.setMoveTarget(
    i,
    s.pathX[base + index] + 0.5,
    s.pathY[base + index],
    s.pathZ[base + index] + 0.5,
    speed,
  );
  return true;
}
