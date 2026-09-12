/**
 * Dormir na cama: define o ponto de renascimento e pula a noite (M5).
 *
 * A regra "não dá para dormir com monstro por perto" não é enfeite: sem ela, a
 * primeira noite deixa de existir como desafio — bastaria colocar a cama e
 * apertar o botão. Com ela, o jogador precisa **fechar o abrigo** antes.
 *
 * **Desvio consciente:** no gênero a cama ocupa dois blocos (cabeceira e pé).
 * Aqui ela é um bloco só, porque blocos multi-parte exigiriam a máquina de
 * estados de colocação/quebra que só chega no M6 com as portas e escadas. A
 * mecânica — definir spawn, pular a noite — é idêntica.
 */

import { TICKS_PER_DAY } from './daynight';

/** Início da noite, em ticks do dia. Antes disso não dá para dormir. */
export const NIGHT_FROM = 12541;
/** Fim da noite. */
export const NIGHT_TO = 23458;
/** Hora em que o jogador acorda. */
export const WAKE_TIME = 0;
/** Raio em que um hostil impede o sono. */
export const MONSTER_RADIUS = 8;

export type SleepDenial = 'day' | 'monsters';

export type SleepResult =
  | { ok: true; wakeTime: number }
  | { ok: false; reason: SleepDenial; message: string };

const MESSAGES: Record<SleepDenial, string> = {
  day: 'Você só pode dormir à noite',
  monsters: 'Há monstros por perto',
};

/** true se `time` está dentro da janela de sono. */
export function isNight(time: number): boolean {
  const t = ((time % TICKS_PER_DAY) + TICKS_PER_DAY) % TICKS_PER_DAY;
  return t >= NIGHT_FROM && t <= NIGHT_TO;
}

/**
 * Decide se o jogador consegue dormir agora.
 * `hostilesNearby` é a contagem de hostis num raio de `MONSTER_RADIUS`.
 */
export function trySleep(time: number, hostilesNearby: number): SleepResult {
  if (!isNight(time)) return { ok: false, reason: 'day', message: MESSAGES.day };
  if (hostilesNearby > 0) {
    return { ok: false, reason: 'monsters', message: MESSAGES.monsters };
  }
  return { ok: true, wakeTime: WAKE_TIME };
}
