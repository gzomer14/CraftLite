/**
 * Estatísticas do jogador (M10, doc 14 "Tela de estatísticas").
 *
 * Dado, não código: a tela lista esta tabela na ordem, e o save guarda um
 * número por linha, **pelo índice** — a tabela só cresce no fim, como a de
 * conquistas. Quem conta é `game/stats.ts`, chamado pelos mesmos pontos que
 * avisam as conquistas.
 */

/** Como o número aparece: contagem, metros (blocos) ou tempo (ticks). */
export type StatUnit = 'count' | 'distance' | 'time';

export interface StatDef {
  name: string;
  display: string;
  unit: StatUnit;
}

export const STATS: readonly StatDef[] = [
  { name: 'play_time', display: 'Tempo de jogo', unit: 'time' },
  { name: 'walk', display: 'Distância a pé', unit: 'distance' },
  { name: 'swim', display: 'Distância nadando', unit: 'distance' },
  { name: 'fly', display: 'Distância voando', unit: 'distance' },
  { name: 'ride', display: 'Distância de barco ou carrinho', unit: 'distance' },
  { name: 'blocks_mined', display: 'Blocos quebrados', unit: 'count' },
  { name: 'blocks_placed', display: 'Blocos colocados', unit: 'count' },
  { name: 'items_crafted', display: 'Itens fabricados', unit: 'count' },
  { name: 'mobs_killed', display: 'Criaturas derrotadas', unit: 'count' },
  { name: 'deaths', display: 'Mortes', unit: 'count' },
  { name: 'trades', display: 'Trocas com aldeões', unit: 'count' },
];

export type StatName =
  | 'play_time' | 'walk' | 'swim' | 'fly' | 'ride' | 'blocks_mined' | 'blocks_placed'
  | 'items_crafted' | 'mobs_killed' | 'deaths' | 'trades';

/** Índice de cada estatística na tabela (e no save). */
export const STAT_INDEX: ReadonlyMap<string, number> = new Map(STATS.map((s, i) => [s.name, i]));

/** O valor como a tela mostra: "1 234", "5,2 km", "3 h 12 min". */
export function formatStat(unit: StatUnit, value: number): string {
  if (unit === 'distance') {
    if (value >= 1000) return `${(value / 1000).toFixed(1).replace('.', ',')} km`;
    return `${Math.floor(value)} m`;
  }
  if (unit === 'time') {
    const minutes = Math.floor(value / 20 / 60);
    const hours = Math.floor(minutes / 60);
    return hours > 0 ? `${hours} h ${minutes % 60} min` : `${minutes} min`;
  }
  return Math.floor(value).toLocaleString('pt-BR');
}
