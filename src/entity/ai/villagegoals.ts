/**
 * Goals da aldeia (M9): a rotina do aldeão e a guarda do golem.
 *
 * Um dia de aldeão, em ordem de prioridade (a lista está em `data/mobs.ts`):
 *
 * - `trade` — com a tela de troca aberta, para e olha para quem negocia;
 * - `avoidHostile` — monstro a menos de 8 blocos: corre para o outro lado;
 * - `goHome` — do fim da tarde ao amanhecer, e enquanto o sino tocar: entra
 *   em casa pela porta, fecha a porta e deita na cama;
 * - `work` — de manhã, vai até o bloco de trabalho (ou a plantação) e fica lá;
 * - `stayInVillage` — de tarde, junta-se perto do poço; longe demais, volta.
 *
 * **A porta é atravessada de verdade.** Quem está de um lado da porta e quer ir
 * para o outro vai até a frente dela, abre, passa e depois fecha — é isso que
 * faz os aldeões "entrarem em casa sozinhos" ao entardecer, e não sumirem
 * dentro da parede. Dentro e fora da casa são decididos pela posição em relação
 * à porta e à direção da rua gravada no aldeão (`VillageState.doorOut`), então
 * uma porta quebrada pelo jogador vira um vão, e o caminho continua o mesmo.
 *
 * O golem não segue rotina: ele caça o hostil que chega perto do poço
 * (`defendVillage`) e, provocado, o jogador — isso já é `attackMelee`; no resto
 * do tempo faz ronda pela aldeia (`patrol`).
 */

import { defOf, stateBitsOf } from '../../data/blocks';
import { mobDef } from '../../data/mobs';
import {
  BELL_ALARM_TICKS, isHomeTime, isWorkTime, professionOf, VILLAGE_LEASH,
} from '../../data/villagers';
import { FACING_STEP } from '../../world/mesh/shapes';
import { FLAG_SLEEPING, FLAG_TRADING, turnTowards } from '../mobstore';
import { followPath, type AiContext, type Goal } from './goals';
import type { GoalName } from '../../data/mobs';

/** Raio em que o aldeão percebe um monstro e foge. */
const FLEE_RADIUS = 8;
/** Raio em que o golem enxerga um hostil. */
const GUARD_RADIUS = 16;
/** Distância que conta como "cheguei" ao destino da rotina. */
const ARRIVED = 1.6;
/** Distância da porta a partir da qual ela pode ser fechada atrás de quem passou. */
const DOOR_CLOSE_MIN = 1.8;
const DOOR_CLOSE_MAX = 6;
/** Ronda do golem: distância do poço, pausa em cada ponto e prazo para chegar. */
const PATROL_MIN = 6;
const PATROL_MAX = 22;
const PATROL_PAUSE_MIN = 60;
const PATROL_PAUSE_SPREAD = 140;
const PATROL_TIMEOUT = 600;
/** Ciclo de trabalho: `WORK_SHIFT` ticks no posto a cada `WORK_CYCLE` (40 s em 60 s). */
const WORK_CYCLE = 1200;
const WORK_SHIFT = 800;
/** Defasagem do turno por índice: aldeões vizinhos não saem juntos. */
const WORK_SHIFT_SPREAD = 397;
/** Chance por tick de soar o trabalho (bigorna do ferreiro): ~1 vez a cada 10 s. */
const WORK_SOUND_CHANCE = 0.005;
/** Ticks sem chegar mais perto do destino que contam como "preso". */
const STUCK_TICKS = 100;
/** Distância máxima da meta que vai para o A* numa viagem longa. */
const SUBGOAL = 20;
/** Bit de "porta aberta" no estado de porta (ver `toggleOpenState`). */
const DOOR_OPEN = 4;

/** Destino escolhido por `goTo`, reusado (zero alocação). */
const WAY = new Float64Array(3);

export const VILLAGE_GOALS: Pick<Record<GoalName, Goal>,
  'trade' | 'avoidHostile' | 'goHome' | 'work' | 'stayInVillage' | 'patrol' | 'defendVillage'> = {
  /** Negociando: parado, de frente para o jogador. */
  trade(ctx, i) {
    const s = ctx.store;
    if (!s.hasFlag(i, FLAG_TRADING)) return false;
    s.clearMoveTarget(i);
    const angle = Math.atan2(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
    s.yaw[i] = turnTowards(s.yaw[i], angle, 0.3);
    s.headYaw[i] = angle;
    return true;
  },

  /** Monstro perto: corre para o lado oposto, e o `panic` leva a corrida adiante. */
  avoidHostile(ctx, i) {
    const s = ctx.store;
    // Procura a cada 10 ticks, espalhado pelo índice: 20 aldeões não varrem o
    // pool todos no mesmo tick.
    if ((s.age[i] + i) % 10 !== 0) return false;
    const threat = nearestHostile(ctx, i, FLEE_RADIUS);
    if (threat < 0) return false;
    const dx = s.x[i] - s.x[threat];
    const dz = s.z[i] - s.z[threat];
    const length = Math.hypot(dx, dz) || 1;
    s.setMoveTarget(i, s.x[i] + (dx / length) * 8, s.y[i], s.z[i] + (dz / length) * 8, 1.4);
    s.panicTicks[i] = 30;
    s.setFlag(i, FLAG_SLEEPING, false);
    return true;
  },

  /** Hora de casa (ou sino tocando): entra, fecha a porta, deita. */
  goHome(ctx, i) {
    const s = ctx.store;
    const v = s.village;
    const alarmed = v.alarmTicks[i] > 0;
    if (alarmed) v.alarmTicks[i]--;
    if (v.hasHome[i] === 0 || (!alarmed && !isHomeTime(ctx.dayTime))) {
      if (s.hasFlag(i, FLAG_SLEEPING)) s.setFlag(i, FLAG_SLEEPING, false);
      return false;
    }

    const bedX = v.homeX[i] + 0.5;
    const bedZ = v.homeZ[i] + 0.5;
    if (s.hasFlag(i, FLAG_SLEEPING)) {
      // Deitado: parado em cima da cama até a hora de levantar.
      s.clearMoveTarget(i);
      s.x[i] = bedX;
      s.z[i] = bedZ;
      s.vx[i] = 0;
      s.vz[i] = 0;
      return true;
    }

    tendDoor(ctx, i);
    if (Math.hypot(s.x[i] - bedX, s.z[i] - bedZ) <= ARRIVED && Math.abs(s.y[i] - v.homeY[i]) < 1.5) {
      // Chegou: fecha a porta (se ficou aberta) e deita. No alarme ele fica em
      // casa, acordado, até o sino parar.
      closeDoor(ctx, i);
      if (!alarmed) {
        s.x[i] = bedX;
        s.z[i] = bedZ;
        s.y[i] = v.homeY[i] + 0.6;
        // Deitado, a cabeça vai para o lado oposto ao do yaw (ver `scenefeed`):
        // o yaw aponta para longe da cabeceira.
        const facing = stateBitsOf(ctx.world.getBlock(v.homeX[i], v.homeY[i], v.homeZ[i])) & 3;
        const step = FACING_STEP[facing];
        s.yaw[i] = Math.atan2(-step[0], -step[1]);
        s.prevYaw[i] = s.yaw[i];
        s.setFlag(i, FLAG_SLEEPING, true);
      }
      s.clearMoveTarget(i);
      return true;
    }
    goTo(ctx, i, bedX, v.homeY[i], bedZ, alarmed ? 1.3 : 0.9);
    return true;
  },

  /**
   * Hora de trabalho: turnos no posto intercalados com voltas pela aldeia.
   *
   * O turno sai da idade e do índice, sem estado novo: cada aldeão tem o seu
   * relógio, e a rua nunca esvazia de uma vez. Fora do turno o goal larga, e o
   * `stayInVillage`/`wander` levam o aldeão para perto do poço. Antes ele
   * ficava plantado no posto a manhã inteira — e "no posto" valia a 2,6 blocos
   * dele, que é a soleira da porta: visto de fora, um aldeão travado em casa.
   */
  work(ctx, i) {
    const s = ctx.store;
    const v = s.village;
    if (v.hasWork[i] === 0 || !isWorkTime(ctx.dayTime)) return false;
    if ((s.age[i] + i * WORK_SHIFT_SPREAD) % WORK_CYCLE >= WORK_SHIFT) return false;
    tendDoor(ctx, i);
    const wx = v.workX[i] + 0.5;
    const wz = v.workZ[i] + 0.5;
    const distance = Math.hypot(s.x[i] - wx, s.z[i] - wz);
    if (distance > ARRIVED) {
      goTo(ctx, i, wx, v.workY[i], wz, 0.8);
      return true;
    }
    // No posto: olha para o trabalho e, de vez em quando, ele soa.
    s.clearMoveTarget(i);
    s.headYaw[i] = Math.atan2(wx - s.x[i], wz - s.z[i]);
    const sound = professionOf(s.variant[i]).workSound;
    if (sound !== undefined && ctx.random() < WORK_SOUND_CHANCE) ctx.villageSound(i, sound);
    return true;
  },

  /**
   * Fora do trabalho e de casa: junta-se perto do poço. Perto dele, larga o
   * controle para o `wander`; longe demais (também o golem), volta.
   */
  stayInVillage(ctx, i) {
    const s = ctx.store;
    const v = s.village;
    if (v.member[i] === 0) return false;
    tendDoor(ctx, i);
    const cx = v.centerX[i] + 0.5;
    const cz = v.centerZ[i] + 0.5;
    // Cada um tem o seu canto perto do poço, derivado da casa: sem estado novo,
    // e os aldeões não se amontoam no mesmo bloco.
    const spread = v.hasHome[i] === 1 ? ((v.homeX[i] * 31 + v.homeZ[i] * 17) & 7) - 3.5 : 0;
    const gx = cx + spread;
    const gz = cz + (v.hasHome[i] === 1 ? ((v.homeX[i] * 13 + v.homeZ[i] * 7) & 7) - 3.5 : 0);
    const distance = Math.hypot(s.x[i] - gx, s.z[i] - gz);
    const limit = mobDef(s.type[i]).category === 'passive' ? 10 : VILLAGE_LEASH;
    if (distance <= limit && !insideHome(s, i)) return false;
    goTo(ctx, i, gx, v.centerY[i], gz, 0.8);
    return true;
  },

  /**
   * Golem: ronda pela aldeia. Sorteia um ponto a 6–22 blocos do poço, vai até
   * ele pelo A*, para um pouco olhando em volta, e sorteia outro. Antes ele só
   * tinha o `wander` (8 blocos em linha reta, a partir do poço) e, no campo,
   * "ficou preso no poço" em vez de guardar a aldeia.
   */
  patrol(ctx, i) {
    const s = ctx.store;
    const v = s.village;
    if (v.member[i] === 0) return false;
    if (v.patrolTicks[i] > 0) v.patrolTicks[i]--;
    const px = v.workX[i] + 0.5;
    const pz = v.workZ[i] + 0.5;
    const arrived = v.hasWork[i] === 1 && Math.hypot(s.x[i] - px, s.z[i] - pz) <= ARRIVED + 0.5;
    if (arrived && v.hasWork[i] === 1) {
      // Chegou: fica parado um tempo, e o próximo ponto sai quando ele acabar.
      v.hasWork[i] = 0;
      v.patrolTicks[i] = PATROL_PAUSE_MIN + Math.floor(ctx.random() * PATROL_PAUSE_SPREAD);
    }
    if (v.hasWork[i] === 0) {
      if (v.patrolTicks[i] > 0) { s.clearMoveTarget(i); return true; }
      const angle = ctx.random() * Math.PI * 2;
      const radius = PATROL_MIN + ctx.random() * (PATROL_MAX - PATROL_MIN);
      v.workX[i] = Math.floor(v.centerX[i] + Math.sin(angle) * radius);
      v.workY[i] = v.centerY[i];
      v.workZ[i] = Math.floor(v.centerZ[i] + Math.cos(angle) * radius);
      v.hasWork[i] = 1;
      v.bestDistance[i] = Infinity;
      v.patrolTicks[i] = PATROL_TIMEOUT;
    } else if (v.patrolTicks[i] <= 0) {
      // Ponto inalcançável (dentro de uma casa, atrás da horta): larga e sorteia outro.
      v.hasWork[i] = 0;
      return true;
    }
    goTo(ctx, i, v.workX[i] + 0.5, v.workY[i], v.workZ[i] + 0.5, 0.6);
    return true;
  },

  /** Golem: o hostil mais perto do poço vira alvo, e leva pancada. */
  defendVillage(ctx, i) {
    const s = ctx.store;
    const v = s.village;
    const def = mobDef(s.type[i]);
    if (def.attack === undefined) return false;

    let target = v.targetMob[i];
    if (!validHostile(ctx, target, i)) target = -1;
    if (target < 0 && (s.age[i] + i) % 10 === 0) target = nearestHostile(ctx, i, GUARD_RADIUS);
    v.targetMob[i] = target;
    if (target < 0) return false;

    const dx = s.x[target] - s.x[i];
    const dz = s.z[target] - s.z[i];
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dx, dz);
    s.yaw[i] = turnTowards(s.yaw[i], angle, 0.4);
    s.headYaw[i] = angle;
    if (distance <= def.attack.reach && Math.abs(s.y[target] - s.y[i]) < 2.5) {
      s.clearMoveTarget(i);
      if (s.attackCooldown[i] <= 0) {
        s.attackCooldown[i] = def.attack.cooldownTicks;
        const damage = def.attack.damage[Math.min(2, Math.max(0, ctx.difficulty - 1))];
        ctx.hitMob(i, target, damage);
        ctx.playSound(i, 'attack');
      }
      return true;
    }
    if (s.pathCooldown[i] <= 0) {
      s.pathCooldown[i] = 20;
      ctx.requestPath(i, Math.floor(s.x[target]), Math.floor(s.y[target]), Math.floor(s.z[target]));
    }
    if (!followPath(ctx, i, 1)) s.setMoveTarget(i, s.x[target], s.y[target], s.z[target], 1);
    return true;
  },
};

/** O hostil mais próximo dentro de `radius`, ou −1. */
function nearestHostile(ctx: AiContext, i: number, radius: number): number {
  const s = ctx.store;
  let best = -1;
  let bestDistance = radius * radius;
  for (let k = 0; k < s.active; k++) {
    if (k === i || mobDef(s.type[k]).category !== 'hostile') continue;
    const dx = s.x[k] - s.x[i];
    const dy = s.y[k] - s.y[i];
    const dz = s.z[k] - s.z[i];
    const distance = dx * dx + dy * dy * 4 + dz * dz;
    if (distance >= bestDistance) continue;
    bestDistance = distance;
    best = k;
  }
  return best;
}

/** O alvo guardado ainda é um hostil vivo e perto? */
function validHostile(ctx: AiContext, target: number, i: number): boolean {
  const s = ctx.store;
  if (target < 0 || target >= s.active || target === i) return false;
  if (mobDef(s.type[target]).category !== 'hostile') return false;
  const dx = s.x[target] - s.x[i];
  const dz = s.z[target] - s.z[i];
  return dx * dx + dz * dz <= GUARD_RADIUS * GUARD_RADIUS * 2.25;
}

// --- porta --------------------------------------------------------------------

/**
 * Posição do mob em relação à porta de casa: `side` > 0 é a rua, < 0 é dentro;
 * `lateral` é o afastamento ao longo da parede.
 */
function doorFrame(s: AiContext['store'], i: number, x: number, z: number): { side: number; lateral: number } {
  const v = s.village;
  const out = FACING_STEP[v.doorOut[i]];
  const dx = x - (v.doorX[i] + 0.5);
  const dz = z - (v.doorZ[i] + 0.5);
  FRAME.side = dx * out[0] + dz * out[1];
  FRAME.lateral = Math.abs(dx * out[1] - dz * out[0]);
  return FRAME;
}
const FRAME = { side: 0, lateral: 0 };

/** Um ponto está dentro da casa: atrás da porta, até o fundo, entre as paredes. */
function isInside(s: AiContext['store'], i: number, x: number, z: number): boolean {
  const f = doorFrame(s, i, x, z);
  return f.side < -0.3 && f.side > -6 && f.lateral < 2.8;
}

function insideHome(s: AiContext['store'], i: number): boolean {
  return s.village.hasHome[i] === 1 && isInside(s, i, s.x[i], s.z[i]);
}

/**
 * Anda até `(x, z)`, atravessando a porta de casa se o destino está do outro
 * lado dela: frente da porta → abre → passa. Fora disso, A* com o steering de
 * sempre como reserva.
 */
function goTo(ctx: AiContext, i: number, x: number, y: number, z: number, speed: number): void {
  const s = ctx.store;
  const v = s.village;
  if (unstick(ctx, i, x, z)) return;
  if (v.hasHome[i] === 1) {
    const meInside = isInside(s, i, s.x[i], s.z[i]);
    const targetInside = isInside(s, i, x, z);
    if (meInside !== targetInside) {
      const out = FACING_STEP[v.doorOut[i]];
      const dcx = v.doorX[i] + 0.5;
      const dcz = v.doorZ[i] + 0.5;
      // Frente da porta do meu lado, e a do outro lado.
      const near = meInside ? -1 : 1;
      const side = doorFrame(s, i, s.x[i], s.z[i]).side;
      const inDoorway = Math.abs(side) < 0.7 && doorFrame(s, i, s.x[i], s.z[i]).lateral < 0.6;
      const frontX = dcx + out[0] * near;
      const frontZ = dcz + out[1] * near;
      if (!inDoorway && Math.hypot(s.x[i] - frontX, s.z[i] - frontZ) > 0.6) {
        WAY[0] = frontX; WAY[1] = v.doorY[i]; WAY[2] = frontZ;
      } else {
        openDoor(ctx, i);
        WAY[0] = dcx - out[0] * near * 1.2;
        WAY[1] = v.doorY[i];
        WAY[2] = dcz - out[1] * near * 1.2;
        s.pathLen[i] = 0;
        s.setMoveTarget(i, WAY[0], WAY[1], WAY[2], speed);
        return;
      }
      x = WAY[0]; y = WAY[1]; z = WAY[2];
    }
  }

  // Colado no destino: steering direto. Fora disso, caminho do A* (pedido a
  // cada 20 ticks): a 4 blocos da porta do fazendeiro há uma cerca no meio, e
  // o steering empurrava a cerca em vez de dar a volta pela abertura da horta.
  if (Math.hypot(s.x[i] - x, s.z[i] - z) < 1.5) {
    s.pathLen[i] = 0;
    s.setMoveTarget(i, x, y, z, speed);
    return;
  }
  if (s.pathCooldown[i] <= 0) {
    s.pathCooldown[i] = 20;
    // O A* recusa destino a mais de 32 blocos (doc 07 §3): quem mora na borda
    // da aldeia e está no poço ficava no steering direto, empurrando a parede
    // da primeira casa do caminho. A meta vira um ponto a 20 blocos na direção
    // do destino, e o caminho parcial do A* leva o resto.
    const dx = x - s.x[i];
    const dz = z - s.z[i];
    const length = Math.hypot(dx, dz);
    const reach = Math.min(1, SUBGOAL / length);
    ctx.requestPath(i, Math.floor(s.x[i] + dx * reach), Math.floor(y), Math.floor(s.z[i] + dz * reach));
  }
  if (!followPath(ctx, i, speed)) s.setMoveTarget(i, x, y, z, speed);
}

/** A porta de casa está aberta? `null` se não há mais porta (quebrada: é um vão). */
/**
 * Preso num canto: 5 s sem chegar mais perto do destino, e o caminho parcial do
 * A* sempre o devolvendo ao mesmo lugar. Um curto pânico (passos para um lado
 * qualquer) tira o aldeão do mínimo local, e o próximo pedido de caminho sai de
 * outro ponto. Devolve true no tick em que deu o empurrão.
 */
function unstick(ctx: AiContext, i: number, x: number, z: number): boolean {
  const s = ctx.store;
  const v = s.village;
  const distance = Math.hypot(s.x[i] - x, s.z[i] - z);
  if (distance < v.bestDistance[i] - 0.5 || distance > v.bestDistance[i] + 6) {
    // Chegou mais perto (ou o destino mudou): recomeça a conta.
    v.bestDistance[i] = distance;
    v.stuckTicks[i] = 0;
    return false;
  }
  if (++v.stuckTicks[i] < STUCK_TICKS) return false;
  v.stuckTicks[i] = 0;
  v.bestDistance[i] = Infinity;
  s.panicTicks[i] = 25;
  s.pathLen[i] = 0;
  s.clearMoveTarget(i);
  return true;
}

function doorOpen(ctx: AiContext, i: number): boolean | null {
  const v = ctx.store.village;
  const state = ctx.world.getBlock(v.doorX[i], v.doorY[i], v.doorZ[i]);
  if (defOf(state).shape !== 'door') return null;
  return (stateBitsOf(state) & DOOR_OPEN) !== 0;
}

function openDoor(ctx: AiContext, i: number): void {
  const v = ctx.store.village;
  if (doorOpen(ctx, i) === false) ctx.setDoor(v.doorX[i], v.doorY[i], v.doorZ[i], true);
}

function closeDoor(ctx: AiContext, i: number): void {
  const v = ctx.store.village;
  if (doorOpen(ctx, i) === true) ctx.setDoor(v.doorX[i], v.doorY[i], v.doorZ[i], false);
}

/** Fecha a porta de casa atrás de quem acabou de passar por ela. */
function tendDoor(ctx: AiContext, i: number): void {
  const s = ctx.store;
  const v = s.village;
  if (v.hasHome[i] === 0) return;
  const distance = Math.hypot(s.x[i] - (v.doorX[i] + 0.5), s.z[i] - (v.doorZ[i] + 0.5));
  if (distance > DOOR_CLOSE_MIN && distance < DOOR_CLOSE_MAX) closeDoor(ctx, i);
}

/** Toque de sino: manda para casa quem mora na aldeia e está perto. */
export function ringAlarm(store: AiContext['store'], x: number, z: number, radius: number): number {
  const v = store.village;
  let count = 0;
  for (let k = 0; k < store.active; k++) {
    if (v.hasHome[k] === 0) continue;
    const dx = store.x[k] - x;
    const dz = store.z[k] - z;
    if (dx * dx + dz * dz > radius * radius) continue;
    v.alarmTicks[k] = BELL_ALARM_TICKS;
    count++;
  }
  return count;
}
