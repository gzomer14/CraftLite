/**
 * Pesca (M14): o que a vara tira da água, e em quanto tempo.
 *
 * Dado, não código — mudar o ritmo da pesca é mudar um número aqui. Quem lê é
 * `game/fishing.ts`.
 */

/**
 * Espera até o peixe morder, em ticks: 4 a 15 s (média ~9,5 s). Mais curta que
 * a do gênero, de propósito, pelo mesmo motivo da muda: a sessão de celular é
 * curta. O critério do doc 14 é 10 peixes em 5 minutos de jogo.
 */
export const BITE_WAIT_MIN = 80;
export const BITE_WAIT_MAX = 300;
/** Na chuva o peixe morde mais depressa (multiplica a espera). */
export const RAIN_WAIT_FACTOR = 0.75;
/** Quanto dura a fisgada: é a janela para puxar. */
export const BITE_TICKS = 24;
/** A linha arrebenta além desta distância, em blocos. */
export const MAX_LINE = 32;
/** Velocidade do arremesso, em blocos por tick. */
export const CAST_SPEED = 0.9;

/** XP de cada peixe tirado da água (doc 06 §8): 1 a 6. */
export const FISHING_XP: readonly [number, number] = [1, 6];

export interface FishingCatch {
  item: string;
  weight: number;
}

/**
 * O que sai da água: quase sempre peixe, às vezes lixo. O tesouro do gênero
 * (livro encantado, arco, sela) fica para quando houver livro encantado (M15).
 */
export const FISHING_LOOT: readonly FishingCatch[] = [
  { item: 'cod', weight: 85 },
  { item: 'stick', weight: 3 },
  { item: 'string', weight: 3 },
  { item: 'bone', weight: 3 },
  { item: 'leather', weight: 2 },
  { item: 'bowl', weight: 2 },
  { item: 'ink_sac', weight: 2 },
];

const TOTAL = FISHING_LOOT.reduce((sum, c) => sum + c.weight, 0);

/** Sorteia o que veio no anzol; `roll` em 0..1. */
export function rollCatch(roll: number): string {
  let left = roll * TOTAL;
  for (const entry of FISHING_LOOT) {
    left -= entry.weight;
    if (left < 0) return entry.item;
  }
  return FISHING_LOOT[0].item;
}
