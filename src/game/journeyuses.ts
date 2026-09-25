/**
 * Usos de item do M16: encher o frasco e arremessar o olho do ender.
 *
 * Moram fora de `itemuse.ts` pelo tamanho daquele módulo; o registro
 * (`ITEM_USES`) continua lá, e estes são só mais duas entradas nele.
 */

import { WATER, blockIdOf } from '../data/blocks';
import { DIM_OVERWORLD } from '../data/dimensions';
import { FLAG_EYE, FLAG_NO_GRAVITY } from '../entity/projectile';
import { nearestStronghold } from '../world/gen/strongholdsites';
import { fluidRay, swapHeld } from './itemhelpers';
import { insertEye, isFrame } from './endportal';
import type { ItemUseHandler } from './itemuse';

/** Velocidade horizontal do olho, em blocos por tick: ~12 blocos de voo. */
const EYE_SPEED = 0.3;
/** Subida do olho por tick enquanto voa na direção da fortaleza. */
const EYE_RISE = 0.1;
/**
 * Perto disto (em blocos), o olho não sobe: mergulha para o chão, em cima da
 * sala. É o sinal de "é aqui, cave".
 */
const EYE_DIVE_RANGE = 16;
const EYE_DIVE = -0.25;

/** Onde o olho aponta; reusado entre arremessos. */
const TARGET = new Int32Array(2);

/** Frasco de vidro na água: vira frasco d'água, e a água fica onde está. */
export const fillBottle: ItemUseHandler = {
  use(ctx, held) {
    const hit = fluidRay(ctx);
    if (!hit.hit || blockIdOf(hit.state) !== WATER) return false;
    ctx.sound('block/bucket_fill', hit.x + 0.5, hit.y + 0.5, hit.z + 0.5);
    swapHeld(ctx, held, 'water_bottle');
    return true;
  },
};

/**
 * Olho do ender: na moldura do portal do End, encaixa (e o décimo segundo
 * acende o portal). Fora dela, sai da mão na direção da fortaleza da superfície mais perto
 * e sobe; perto dela, mergulha. Só na superfície — no Nether e no End não há
 * para onde apontar, e o olho fica na mão.
 *
 * O olho é um projétil sem colisão (`FLAG_EYE`); quando o voo acaba, a
 * `Session` decide se ele cai no chão (quatro em cinco) ou se parte.
 */
export const throwEye: ItemUseHandler = {
  use(ctx, held) {
    // Mirando a moldura do portal do End: o olho encaixa em vez de voar.
    const hit = ctx.target();
    if (hit !== null && isFrame(hit.state)) {
      const result = insertEye(ctx.world, hit.x, hit.y, hit.z, ctx.blockChanged);
      if (result === 'none') return false;
      if (ctx.player.mode === 'survival') ctx.inventory.consumeHeld();
      ctx.sound(result === 'lit' ? 'block/end_portal' : 'block/click', hit.x + 0.5, hit.y + 1, hit.z + 0.5);
      if (result === 'lit') ctx.achievement('end_portal');
      return true;
    }
    if (ctx.world.dimension !== DIM_OVERWORLD) return false;
    const p = ctx.player;
    nearestStronghold(ctx.world.seed, p.x, p.z, TARGET);
    const dx = TARGET[0] + 0.5 - p.x;
    const dz = TARGET[1] + 0.5 - p.z;
    const distance = Math.hypot(dx, dz) || 1;
    const dive = distance < EYE_DIVE_RANGE;
    const speed = dive ? Math.min(EYE_SPEED, distance / 40) : EYE_SPEED;
    const launched = ctx.projectiles.spawn(
      p.x, p.y + p.eyeHeight, p.z,
      (dx / distance) * speed, dive ? EYE_DIVE : EYE_RISE, (dz / distance) * speed,
      0, true, 1, FLAG_EYE | FLAG_NO_GRAVITY, held.item,
    );
    if (!launched) return false;
    ctx.sound('player/throw', p.x, p.y + p.eyeHeight, p.z);
    ctx.achievement('ender_eye');
    if (p.mode === 'survival') ctx.inventory.consumeHeld();
    return true;
  },
};
