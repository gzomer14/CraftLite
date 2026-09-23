/**
 * Aldeia como dado (M9, doc 14): profissões, o que cada uma troca e a rotina
 * do dia.
 *
 * **A ordem das profissões é estável** — o índice é a `variant` do aldeão e a
 * casa de cada profissão é uma estrutura própria em `data/structures.ts`.
 * Profissão nova entra no fim.
 *
 * Os blocos de trabalho são os que o jogo já tem: bancada para o açougueiro,
 * fornalha para o ferreiro, estante para o bibliotecário. O fazendeiro trabalha
 * na plantação da aldeia, não num bloco. A bigorna e o defumador do M15 podem
 * trocar estes blocos depois — é uma linha aqui.
 */

/** Uma oferta: o aldeão quer `want` e dá `give`, no máximo `maxUses` vezes por dia. */
export interface TradeDef {
  want: readonly [item: string, count: number];
  give: readonly [item: string, count: number];
  maxUses: number;
}

export interface ProfessionDef {
  name: string;
  display: string;
  /** Pele em `data/mobskins.ts`. */
  skin: string;
  /** Bloco em que ele trabalha; `null` = a plantação da aldeia. */
  workstation: string | null;
  /** Som que o trabalho faz de vez em quando, ou nenhum. */
  workSound?: string;
  trades: readonly TradeDef[];
}

export const PROFESSIONS: readonly ProfessionDef[] = [
  {
    name: 'farmer', display: 'Fazendeiro', skin: 'villager_farmer', workstation: null,
    trades: [
      { want: ['wheat', 20], give: ['emerald', 1], maxUses: 12 },
      { want: ['carrot', 15], give: ['emerald', 1], maxUses: 12 },
      { want: ['emerald', 1], give: ['bread', 6], maxUses: 12 },
      { want: ['emerald', 1], give: ['apple', 4], maxUses: 12 },
    ],
  },
  {
    name: 'butcher', display: 'Açougueiro', skin: 'villager_butcher', workstation: 'crafting_table',
    trades: [
      { want: ['chicken', 14], give: ['emerald', 1], maxUses: 12 },
      { want: ['porkchop', 7], give: ['emerald', 1], maxUses: 12 },
      { want: ['emerald', 1], give: ['cooked_porkchop', 5], maxUses: 12 },
      { want: ['emerald', 1], give: ['cooked_chicken', 6], maxUses: 12 },
    ],
  },
  {
    name: 'smith', display: 'Ferreiro', skin: 'villager_smith', workstation: 'furnace',
    workSound: 'village/anvil',
    trades: [
      { want: ['coal', 15], give: ['emerald', 1], maxUses: 12 },
      { want: ['iron_ingot', 4], give: ['emerald', 1], maxUses: 12 },
      { want: ['emerald', 3], give: ['iron_sword', 1], maxUses: 3 },
      { want: ['emerald', 5], give: ['iron_chestplate', 1], maxUses: 3 },
    ],
  },
  {
    name: 'librarian', display: 'Bibliotecário', skin: 'villager_librarian', workstation: 'bookshelf',
    trades: [
      { want: ['paper', 24], give: ['emerald', 1], maxUses: 12 },
      { want: ['book', 4], give: ['emerald', 1], maxUses: 12 },
      { want: ['emerald', 1], give: ['glass', 4], maxUses: 12 },
      { want: ['emerald', 6], give: ['bookshelf', 1], maxUses: 6 },
    ],
  },
];

export function professionOf(variant: number): ProfessionDef {
  return PROFESSIONS[variant] ?? PROFESSIONS[0];
}

// --- rotina (ticks do dia; 0 = nascer do sol, 12000 = pôr) -------------------

/** Começa a ir para o trabalho. */
export const WORK_START = 1000;
/** Larga o trabalho e passeia pela aldeia. */
export const WORK_END = 9000;
/**
 * Vai para casa. Meio tick-dia antes do pôr do sol (12000): quem chega à
 * aldeia "ao entardecer" vê o movimento de volta, não as ruas já vazias.
 */
export const HOME_START = 11500;

/** true na hora de estar em casa: do fim da tarde até o nascer do sol. */
export function isHomeTime(dayTime: number): boolean {
  return dayTime >= HOME_START;
}

export function isWorkTime(dayTime: number): boolean {
  return dayTime >= WORK_START && dayTime < WORK_END;
}

// --- reputação e sino ---------------------------------------------------------

/** Bater num aldeão fecha as trocas da aldeia por este tanto (um dia inteiro). */
export const TRADE_BAN_TICKS = 24000;
/** Golpes em aldeão que viram o golem contra o jogador. */
export const GOLEM_ANGER_HITS = 1;
/** Quanto o sino manda todo mundo para casa. */
export const BELL_ALARM_TICKS = 600;
/** Raio em que o sino é ouvido pelos aldeões. */
export const BELL_RADIUS = 48;
/** Distância do poço que conta como "dentro da aldeia" para quem volta para ela. */
export const VILLAGE_LEASH = 40;
