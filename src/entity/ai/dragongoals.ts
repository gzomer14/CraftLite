/**
 * A IA do dragão do End (doc 14 — M16): um goal só, `dragon`, com fases.
 *
 * ```
 *   CIRCLE ──(sorteio)──► CHARGE ──(acertou ou cansou)──► CIRCLE
 *      │
 *      └──(sorteio; mais fácil sem cristal)──► LAND ──► PERCH ──► LIFT ──► CIRCLE
 * ```
 *
 * - **CIRCLE**: voa de ponto em ponto num anel em volta do centro, alto,
 *   passando entre as colunas. É quando ele se cura nos cristais
 *   (`game/dragonfight.ts`) e quando a flecha é a arma.
 * - **CHARGE**: mergulha no jogador; encostou, bate e empurra, e volta ao anel.
 * - **LAND / PERCH**: desce no portal de saída e fica parado 10 s olhando o
 *   jogador — mordendo quem chega perto. É a janela da espada.
 * - **LIFT**: sobe reto do portal antes de voltar ao anel.
 * - **DYING** (M19): o golpe final o põe em agonia (`deathTicks`): ele sobe
 *   devagar girando, invulnerável, e só no fim cai e solta a experiência.
 *   Os raios de luz são de `render/scenefeed.ts`.
 *
 * E em qualquer fase (M19): **quebra o que atravessa**, menos a ilha, as
 * colunas e o portal (`breaksBlocksExcept`), e, pousado, **sopra** — uma nuvem
 * no chão onde o jogador estava, que fere quem ficar nela
 * (`game/dragonfight.ts`).
 *
 * O estado mora nos campos do `MobStore` que o dragão não usa: `variant` é a
 * fase, `fuse` o relógio da fase e `product` o ponto do anel. Nada de objeto
 * por mob, nada alocado por tick.
 */

import type { GoalName } from '../../data/mobs';
import { mobDef } from '../../data/mobs';
import { BLOCKS, BLOCK_BY_NAME, blockIdOf } from '../../data/blocks';
import { END_ISLAND_Y } from '../../world/gen/end';
import { FLAG_DYING, turnTowards } from '../mobstore';
import type { AiContext, Goal } from './goals';

export const PHASE_CIRCLE = 0;
export const PHASE_CHARGE = 1;
export const PHASE_LAND = 2;
export const PHASE_PERCH = 3;
export const PHASE_LIFT = 4;
export const PHASE_DYING = 5;

/** Pontos do anel e o raio dele. */
const WAYPOINTS = 12;
const RING_RADIUS = 52;
/** Altura do anel acima da ilha, e quanto ela varia de ponto a ponto. */
const RING_HEIGHT = 30;
const RING_WAVE = 10;
/** Perto disto do ponto, passa ao próximo. */
const WAYPOINT_REACH = 6;
/** Onde ele pousa: sobre a coluna do portal de saída. */
export const PERCH_Y = END_ISLAND_Y + 5;
const PERCH_REACH = 2.5;
/** Ticks pousado: a janela da espada. */
export const PERCH_TICKS = 200;
/** Ticks de investida antes de desistir. */
const CHARGE_TICKS = 120;
/** Ticks subindo depois de pousar. */
const LIFT_TICKS = 60;
/** Distância (do centro dele ao jogador) em que a investida acerta. */
const HIT_RANGE = 5;
/** Distância em que a mordida pousada acerta. */
const BITE_RANGE = 7;
/** Chance, a cada ponto do anel, de investir ou de pousar. */
const CHARGE_CHANCE = 0.3;
const LAND_CHANCE = 0.15;
/** Com todos os cristais quebrados, ele pousa bem mais. */
const LAND_CHANCE_NO_CRYSTALS = 0.4;
/** Altura até onde ele sobe na agonia. */
const DYING_RISE = 30;
/** Blocos que ele confere em volta do centro, a cada `BREAK_EVERY` ticks. */
const BREAK_RADIUS = 3;
const BREAK_HEIGHT = 2;
const BREAK_EVERY = 4;
/** Pousado, sopra a cada tantos ticks — se o jogador estiver a este alcance. */
const BREATH_EVERY = 80;
const BREATH_RANGE = 24;
/** Quanto a nuvem dura no chão: 6 s. */
export const BREATH_TICKS = 120;

/**
 * Quantos cristais ainda vivem — quem conta é a luta, e escreve aqui antes do
 * tick dos mobs. Um número de módulo e não um campo do contexto de IA, que
 * não tem por que conhecer o End.
 */
export const dragonState = {
  crystals: 0,
  /** A nuvem do sopro: onde está e quantos ticks faltam (0 = nenhuma). */
  breathX: 0, breathY: 0, breathZ: 0, breathTicks: 0,
};

/**
 * Por tipo de mob, 1 = atravessa este bloco sem quebrá-lo. Montado na
 * primeira vez que o mob quebra algo, do traço `breaksBlocksExcept`; o laço
 * de quebra só lê o array.
 */
const unbreakableByType = new Map<number, Uint8Array>();

function unbreakableFor(type: number): Uint8Array {
  let table = unbreakableByType.get(type);
  if (table !== undefined) return table;
  table = new Uint8Array(BLOCKS.length);
  for (let id = 0; id < BLOCKS.length; id++) {
    const block = BLOCKS[id];
    // Ar, líquido e o que nada quebra (rocha-mãe): nem o dragão.
    if (block === undefined || id === 0 || block.hardness < 0
      || block.name === 'water' || block.name === 'lava') table[id] = 1;
  }
  for (const name of mobDef(type).traits.breaksBlocksExcept ?? []) {
    const block = BLOCK_BY_NAME.get(name);
    if (block !== undefined) table[block.id] = 1;
  }
  unbreakableByType.set(type, table);
  return table;
}

/** Quebra o que o corpo atravessa (M19). Sem alocação: lê o mundo e avisa. */
function breakThrough(ctx: AiContext, i: number): void {
  const s = ctx.store;
  const table = unbreakableFor(s.type[i]);
  const cx = Math.floor(s.x[i]);
  const cy = Math.floor(s.centerY(i));
  const cz = Math.floor(s.z[i]);
  for (let y = cy - BREAK_HEIGHT; y <= cy + BREAK_HEIGHT; y++) {
    for (let z = cz - BREAK_RADIUS; z <= cz + BREAK_RADIUS; z++) {
      for (let x = cx - BREAK_RADIUS; x <= cx + BREAK_RADIUS; x++) {
        if (table[blockIdOf(ctx.world.getBlock(x, y, z))] === 1) continue;
        ctx.breakBlock(x, y, z);
      }
    }
  }
}

/** Sopra no chão onde o jogador está, se ele estiver ao alcance (M19). */
function breathe(ctx: AiContext, i: number): void {
  const s = ctx.store;
  const reach = Math.hypot(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
  if (reach > BREATH_RANGE || s.hasTarget[i] === 0) return;
  dragonState.breathX = ctx.playerX;
  dragonState.breathY = ctx.playerY;
  dragonState.breathZ = ctx.playerZ;
  dragonState.breathTicks = BREATH_TICKS;
  ctx.playSound(i, 'attack');
}

/** Ponto `k` do anel, em `out` como `[x, y, z]`. */
export function waypoint(k: number, out: Float64Array): void {
  const angle = (k * Math.PI * 2) / WAYPOINTS;
  out[0] = Math.cos(angle) * RING_RADIUS;
  out[1] = END_ISLAND_Y + RING_HEIGHT + Math.sin(k * 1.7) * RING_WAVE;
  out[2] = Math.sin(angle) * RING_RADIUS;
}

const POINT = new Float64Array(3);

/** Aponta o corpo para onde voa (o goal controla o corpo inteiro). */
function faceMotion(ctx: AiContext, i: number, x: number, z: number): void {
  const s = ctx.store;
  const angle = Math.atan2(x - s.x[i], z - s.z[i]);
  s.yaw[i] = turnTowards(s.yaw[i], angle, 0.12);
  s.headYaw[i] = s.yaw[i];
}

function distance3(ctx: AiContext, i: number, x: number, y: number, z: number): number {
  const s = ctx.store;
  return Math.hypot(x - s.x[i], y - s.centerY(i), z - s.z[i]);
}

function toPhase(ctx: AiContext, i: number, phase: number, ticks: number): void {
  ctx.store.variant[i] = phase;
  ctx.store.fuse[i] = ticks;
}

/** Acerta o jogador, se ele estiver perto do corpo e a vez tiver chegado. */
function strike(ctx: AiContext, i: number, range: number): boolean {
  const s = ctx.store;
  if (s.attackCooldown[i] > 0 || s.hasTarget[i] === 0) return false;
  const reach = Math.hypot(ctx.playerX - s.x[i], ctx.playerY + 0.9 - s.centerY(i), ctx.playerZ - s.z[i]);
  if (reach > range) return false;
  const def = mobDef(s.type[i]);
  const attack = def.attack;
  if (attack === undefined) return false;
  s.attackCooldown[i] = attack.cooldownTicks;
  ctx.hitPlayer(i, attack.damage[Math.min(2, Math.max(0, ctx.difficulty - 1))]);
  ctx.playSound(i, 'attack');
  return true;
}

export const DRAGON_GOALS: Pick<Record<GoalName, Goal>, 'dragon'> = {
  dragon(ctx, i) {
    const s = ctx.store;
    if (s.fuse[i] > 0) s.fuse[i]--;
    if (s.hasFlag(i, FLAG_DYING) && s.variant[i] !== PHASE_DYING) {
      toPhase(ctx, i, PHASE_DYING, mobDef(s.type[i]).traits.deathTicks ?? 1);
    }
    if (s.variant[i] !== PHASE_DYING && s.age[i] % BREAK_EVERY === 0) breakThrough(ctx, i);
    switch (s.variant[i]) {
      case PHASE_DYING: {
        // Sobe devagar girando; no fim, a vida zera e o `tick` dos mobs o tira.
        s.setMoveTarget(i, s.x[i], END_ISLAND_Y + RING_HEIGHT + DYING_RISE, s.z[i], 0.12);
        s.vx[i] = 0; s.vz[i] = 0;
        s.yaw[i] += 0.05;
        s.headYaw[i] = s.yaw[i];
        if (s.fuse[i] % 20 === 0) ctx.playSound(i, 'hurt');
        if (s.fuse[i] === 0) s.health[i] = 0;
        return true;
      }
      case PHASE_CHARGE: {
        s.setMoveTarget(i, ctx.playerX, ctx.playerY + 1, ctx.playerZ, 1.3);
        faceMotion(ctx, i, ctx.playerX, ctx.playerZ);
        if (strike(ctx, i, HIT_RANGE) || s.fuse[i] === 0 || s.hasTarget[i] === 0) {
          toPhase(ctx, i, PHASE_CIRCLE, 0);
        }
        return true;
      }
      case PHASE_LAND: {
        s.setMoveTarget(i, 0, PERCH_Y, 0, 0.7);
        faceMotion(ctx, i, 0, 0);
        if (distance3(ctx, i, 0, PERCH_Y, 0) < PERCH_REACH) {
          s.clearMoveTarget(i);
          s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
          toPhase(ctx, i, PHASE_PERCH, PERCH_TICKS);
        }
        return true;
      }
      case PHASE_PERCH: {
        s.clearMoveTarget(i);
        s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
        // Pousado, vira a cabeça para quem luta e morde quem chega.
        const angle = Math.atan2(ctx.playerX - s.x[i], ctx.playerZ - s.z[i]);
        s.yaw[i] = turnTowards(s.yaw[i], angle, 0.08);
        s.headYaw[i] = s.yaw[i];
        strike(ctx, i, BITE_RANGE);
        // O sopro: ao pousar e de tempos em tempos enquanto está no portal.
        if ((PERCH_TICKS - s.fuse[i]) % BREATH_EVERY === 1) breathe(ctx, i);
        if (s.fuse[i] === 0) toPhase(ctx, i, PHASE_LIFT, LIFT_TICKS);
        return true;
      }
      case PHASE_LIFT: {
        s.setMoveTarget(i, s.x[i], END_ISLAND_Y + RING_HEIGHT, s.z[i], 0.8);
        if (s.fuse[i] === 0) toPhase(ctx, i, PHASE_CIRCLE, 0);
        return true;
      }
      default: {
        waypoint(s.product[i], POINT);
        s.setMoveTarget(i, POINT[0], POINT[1], POINT[2], 1);
        faceMotion(ctx, i, POINT[0], POINT[2]);
        // De passagem, quem estiver no caminho leva o golpe.
        strike(ctx, i, HIT_RANGE);
        if (distance3(ctx, i, POINT[0], POINT[1], POINT[2]) > WAYPOINT_REACH) return true;
        s.product[i] = (s.product[i] + 1) % WAYPOINTS;
        const roll = ctx.random();
        const land = dragonState.crystals === 0 ? LAND_CHANCE_NO_CRYSTALS : LAND_CHANCE;
        if (roll < land) toPhase(ctx, i, PHASE_LAND, 0);
        else if (roll < land + CHARGE_CHANCE && s.hasTarget[i] === 1) {
          toPhase(ctx, i, PHASE_CHARGE, CHARGE_TICKS);
        }
        return true;
      }
    }
  },
};
