/**
 * Conquistas (doc 08 §3.4: "Toast de conquista, canto superior direito").
 *
 * Uma conquista é **um gatilho declarado**, não código: o motor dispara eventos
 * de jogo ("pegou item X", "matou mob Y", "chegou em Y=12") e esta tabela diz
 * quais deles valem uma medalha. Acrescentar uma conquista é uma entrada aqui.
 *
 * A ordem define o índice usado no save (uma máscara de bits), então **nunca
 * reordene** — só acrescente no fim.
 *
 * A árvore é rasa de propósito: `parent` serve para a tela mostrar o caminho,
 * mas nenhuma conquista **exige** a anterior. Travar a medalha de "fazer uma
 * picareta" atrás da de "pegar madeira" só cria estado inválido para quem
 * começou o mundo com um baú de presente.
 */

import { t, tf } from '../core/i18n';
import type { StringKey } from './strings/pt';

/** O que o jogo precisa observar para a conquista disparar. */
export type TriggerKind =
  /** Obteve um item (coletar, craftar, tirar da fornalha). */
  | 'obtain'
  /** Matou um mob de um tipo. */
  | 'kill'
  /** Colocou um bloco. */
  | 'place'
  /** Desceu abaixo de um Y. */
  | 'depth'
  /** Subiu de nível de experiência. */
  | 'level'
  /** Um marco sem alvo: dormir, encantar, navegar. */
  | 'event';

export interface AchievementDef {
  id: number;
  name: string;
  display: string;
  /** Uma linha, no tom de "o que você acabou de fazer". */
  description: string;
  trigger: TriggerKind;
  /**
   * Alvo do gatilho: nome do item, do mob ou do bloco — ou `#tag` de
   * `data/recipes.ts`, para "qualquer tronco"; para `depth` e `level`, o
   * número; para `event`, o nome do marco.
   */
  target: string;
  /** Conquista anterior na árvore, só para a tela. */
  parent?: string;
}

const SPECS: readonly Omit<AchievementDef, 'id'>[] = [
  {
    // Qualquer tronco (M17): com `oak_log`, quem nascia entre bétulas,
    // pinheiros ou na selva nunca ganhava a primeira medalha.
    name: 'get_wood', display: 'Cortando Madeira',
    description: 'Você derrubou o primeiro tronco.',
    trigger: 'obtain', target: '#logs',
  },
  {
    name: 'benchmarking', display: 'Ponto de Partida',
    description: 'Uma bancada muda tudo.',
    trigger: 'obtain', target: 'crafting_table', parent: 'get_wood',
  },
  {
    name: 'time_to_mine', display: 'Hora de Minerar',
    description: 'Sua primeira picareta.',
    trigger: 'obtain', target: 'wooden_pickaxe', parent: 'benchmarking',
  },
  {
    name: 'hot_topic', display: 'Assunto Quente',
    description: 'Fornalha pronta: agora dá para cozinhar.',
    trigger: 'obtain', target: 'furnace', parent: 'time_to_mine',
  },
  {
    name: 'acquire_hardware', display: 'Ferro Fundido',
    description: 'Uma barra de ferro sai da fornalha.',
    trigger: 'obtain', target: 'iron_ingot', parent: 'hot_topic',
  },
  {
    name: 'diamonds', display: 'DIAMANTES!',
    description: 'O que todo mundo desce procurando.',
    trigger: 'obtain', target: 'diamond', parent: 'acquire_hardware',
  },
  {
    name: 'bake_bread', display: 'Pão Nosso',
    description: 'Trigo virou pão.',
    trigger: 'obtain', target: 'bread',
  },
  {
    name: 'the_lie', display: 'A Roça',
    description: 'Você arou a terra e plantou.',
    trigger: 'place', target: 'farmland',
  },
  {
    name: 'monster_hunter', display: 'Caçador de Monstros',
    description: 'Você derrubou o primeiro hostil.',
    trigger: 'kill', target: 'zombie',
  },
  {
    name: 'sniper_duel', display: 'Duelo à Distância',
    description: 'Um esqueleto caiu — e não foi na porrada.',
    trigger: 'kill', target: 'skeleton', parent: 'monster_hunter',
  },
  {
    name: 'cow_tipper', display: 'Couro Cru',
    description: 'Couro é o começo do livro.',
    trigger: 'obtain', target: 'leather',
  },
  {
    name: 'delicious_fish', display: 'Vida no Campo',
    description: 'Dois bichos, um filhote.',
    trigger: 'event', target: 'breed',
  },
  {
    name: 'sweet_dreams', display: 'Bons Sonhos',
    description: 'Você dormiu e pulou a noite.',
    trigger: 'event', target: 'sleep',
  },
  {
    name: 'enchanter', display: 'Encantador',
    description: 'Sua primeira peça encantada.',
    trigger: 'event', target: 'enchant', parent: 'diamonds',
  },
  {
    name: 'on_a_rail', display: 'Fundo do Poço',
    description: 'Você chegou ao nível dos diamantes.',
    trigger: 'depth', target: '12',
  },
  {
    name: 'overkill', display: 'Veterano',
    description: 'Nível 30 de experiência.',
    trigger: 'level', target: '30', parent: 'enchanter',
  },
  {
    name: 'sail_away', display: 'Mar Aberto',
    description: 'Você largou o cais.',
    trigger: 'event', target: 'boat',
  },
  {
    name: 'librarian', display: 'Bibliotecário',
    description: 'Uma estante — a mesa vai gostar.',
    trigger: 'obtain', target: 'bookshelf', parent: 'cow_tipper',
  },

  // --- Nether (M7) --------------------------------------------------------
  {
    name: 'into_fire', display: 'Portal Aberto',
    description: 'A moldura de obsidiana acendeu.',
    trigger: 'event', target: 'light_portal',
  },
  {
    name: 'nether', display: 'Do Outro Lado',
    description: 'Você atravessou para o Nether.',
    trigger: 'event', target: 'enter_nether', parent: 'into_fire',
  },
  {
    name: 'return_home', display: 'De Volta',
    description: 'E voltou inteiro para a superfície.',
    trigger: 'event', target: 'return_overworld', parent: 'nether',
  },
  {
    name: 'minecart_ride', display: 'Nos Trilhos',
    description: 'O carrinho anda sozinho — basta ter para onde ir.',
    trigger: 'event', target: 'minecart',
  },
  // M14: a comida que não depende de fazenda.
  {
    name: 'fisherman', display: 'Pescador',
    description: 'Um peixe no anzol, e o jantar garantido.',
    trigger: 'obtain', target: 'cod',
  },
  // --- M16: o caminho até o dragão ------------------------------------------
  {
    name: 'into_fortress', display: 'Na Brasa',
    description: 'Uma vara de blaze, arrancada da fortaleza do Nether.',
    trigger: 'obtain', target: 'blaze_rod', parent: 'nether',
  },
  {
    name: 'local_brewery', display: 'Alquimista',
    description: 'A primeira poção saiu do suporte de preparo.',
    trigger: 'obtain', target: 'awkward_potion', parent: 'into_fortress',
  },
  {
    name: 'eye_spy', display: 'Olho Vivo',
    description: 'O olho do ender voou na direção da fortaleza.',
    trigger: 'event', target: 'ender_eye', parent: 'into_fortress',
  },
  {
    name: 'end_portal', display: 'O Fim?',
    description: 'Doze olhos, e o portal do End acendeu.',
    trigger: 'event', target: 'end_portal', parent: 'eye_spy',
  },
  {
    name: 'the_end', display: 'O End',
    description: 'Você pisou na ilha do dragão.',
    trigger: 'event', target: 'enter_end', parent: 'end_portal',
  },
  {
    name: 'free_the_end', display: 'Liberte o End',
    description: 'O dragão caiu. A jornada tem um fim.',
    trigger: 'event', target: 'kill_dragon', parent: 'the_end',
  },
];

export const ACHIEVEMENTS: readonly AchievementDef[] = SPECS.map((spec, id) => ({ ...spec, id }));

export const ACHIEVEMENT_BY_NAME: ReadonlyMap<string, AchievementDef> = new Map(
  ACHIEVEMENTS.map((a) => [a.name, a]),
);

/**
 * Os gatilhos de evento não têm alvo legível — estes são os textos deles, pela
 * chave de `data/strings/pt.ts` (`objective.<evento>`).
 *
 * A chave do barco era `sail`, mas o gatilho que a sessão dispara é `boat` —
 * com a chave errada o objetivo do barco saía como "faça algo novo" (M7).
 */
const EVENT_OBJECTIVES: Record<string, StringKey> = {
  breed: 'objective.breed',
  sleep: 'objective.sleep',
  enchant: 'objective.enchant',
  boat: 'objective.boat',
  light_portal: 'objective.light_portal',
  enter_nether: 'objective.enter_nether',
  return_overworld: 'objective.return_overworld',
  minecart: 'objective.minecart',
  ender_eye: 'objective.ender_eye',
  end_portal: 'objective.end_portal',
  enter_end: 'objective.enter_end',
  kill_dragon: 'objective.kill_dragon',
};

/**
 * O que fazer para obter a conquista, montado a partir do gatilho e do alvo.
 *
 * Nenhum texto novo na tabela: conteúdo novo já entra com objetivo pronto. Quem
 * resolve o nome do item ou do mob é quem chama, porque `data/achievements.ts`
 * não deve depender das outras tabelas de dados só para escrever uma frase.
 */
export function objectiveFor(def: AchievementDef, displayOf: (target: string) => string): string {
  if (def.trigger === 'obtain') return tf('objective.obtain', displayOf(def.target));
  if (def.trigger === 'kill') return tf('objective.kill', displayOf(def.target));
  if (def.trigger === 'place') return tf('objective.place', displayOf(def.target));
  if (def.trigger === 'depth') return tf('objective.depth', def.target);
  if (def.trigger === 'level') return tf('objective.level', def.target);
  const key = EVENT_OBJECTIVES[def.target];
  return key === undefined ? t('objective.new') : t(key);
}

/** true se a conquista de nome `name` já está na máscara. */
export function isUnlocked(mask: number, name: string): boolean {
  const def = ACHIEVEMENT_BY_NAME.get(name);
  return def !== undefined && (mask & (1 << def.id)) !== 0;
}

/**
 * A conquista **à vista**: já dá para tentar (sem `parent`, ou com o `parent`
 * obtido) e ainda não foi feita. É o que o HUD mostra como objetivo e o que a
 * tela de conquistas revela — as duas leem a mesma regra para não divergirem.
 */
export function nextObjective(mask: number): AchievementDef | undefined {
  for (const def of ACHIEVEMENTS) {
    if ((mask & (1 << def.id)) !== 0) continue;
    if (def.parent === undefined || isUnlocked(mask, def.parent)) return def;
  }
  return undefined;
}

export function achievementDef(id: number): AchievementDef | undefined {
  return ACHIEVEMENTS[id];
}
