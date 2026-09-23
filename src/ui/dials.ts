/**
 * Para onde apontam a bússola e o relógio (M10).
 *
 * O desenho de cada quadro está pronto na folha de sprites
 * (`render/itemsprites.ts`); aqui só se escolhe o quadro. Como no original:
 *
 * - a **bússola** aponta para o nascimento do mundo, **relativo ao olhar** — a
 *   agulha para cima quer dizer "em frente", e girar o corpo gira a agulha;
 * - o **relógio** mostra o céu: sol no alto ao meio-dia, lua no alto à
 *   meia-noite;
 * - no **Nether** (dimensão sem céu) os dois enlouquecem.
 *
 * Funções puras, sem estado: testáveis sem DOM, e chamá-las por quadro não
 * aloca nada.
 */

import { DIAL_FRAMES } from '../data/itemart';
import { TICKS_PER_DAY } from '../game/daynight';

const TAU = Math.PI * 2;
/** Tick do meio-dia (o `time` 0 é o nascer do sol, 06:00). */
const NOON = 6000;

/** Ângulo → quadro, com 0 para cima e sentido horário. */
function frameOf(angle: number): number {
  const turns = angle / TAU;
  const frame = Math.round((turns - Math.floor(turns)) * DIAL_FRAMES);
  return frame % DIAL_FRAMES;
}

/**
 * Quadro da bússola para quem está em `(x, z)` olhando para `yaw`, com o alvo
 * em `(targetX, targetZ)`.
 *
 * O `yaw` do jogo gira de +Z para +X (frente = `(sin yaw, cos yaw)`) e a direita
 * da tela é `(−cos yaw, sin yaw)`: um alvo à direita tem rumo **menor** que o
 * yaw. Por isso a agulha é `yaw − rumo` — positivo gira para a direita.
 */
export function compassFrame(
  x: number, z: number, yaw: number, targetX: number, targetZ: number,
): number {
  const bearing = Math.atan2(targetX - x, targetZ - z);
  return frameOf(yaw - bearing);
}

/** Quadro do relógio na hora `time` do dia (0 = nascer do sol). */
export function clockFrame(time: number): number {
  return frameOf(((time - NOON) / TICKS_PER_DAY) * TAU);
}

/**
 * Mostrador enlouquecido (Nether): pula de quadro em quadro sem direção. O
 * passo é primo com 16, então percorre todos antes de repetir.
 */
export function spinFrame(tick: number, salt: number): number {
  return (Math.floor(tick / 3) * 7 + salt) % DIAL_FRAMES;
}
