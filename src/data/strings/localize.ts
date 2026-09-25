/**
 * Põe os nomes de conteúdo no idioma em uso (M17).
 *
 * As tabelas nascem em português (o `display` de cada linha); com o idioma em
 * inglês, este módulo troca o `display` pelo de `names.en.ts` **uma vez, no
 * boot**. É importado primeiro pelo `main.ts`, e por isso roda antes de
 * qualquer módulo de interface ler um nome — quem monta lista de nomes na
 * avaliação do módulo (a paleta do Criativo, as legendas) já vê o inglês.
 *
 * Mexer na tabela, e não pôr um `nameOf(def)` em cada leitura, é de propósito:
 * são dezenas de leitores de `.display` (tooltip, busca, HUD, receitas), e
 * nenhum deles precisa saber que existe idioma. O worker não importa este
 * módulo nem `names.en.ts`: ele não mostra nome, e não paga os bytes.
 */

import { ACHIEVEMENTS } from '../achievements';
import { BIOMES } from '../biomes';
import { BLOCKS } from '../blocks';
import { DIMENSIONS } from '../dimensions';
import { EFFECTS } from '../effects';
import { ENCHANTS } from '../enchants';
import { ITEMS } from '../items';
import { MOBS } from '../mobs';
import { POTIONS } from '../potions';
import { STATS } from '../stats';
import { PROFESSIONS } from '../villagers';
import { lang, type Lang } from '../../core/i18n';
import {
  ACHIEVEMENT_TEXT_EN, BIOME_NAMES_EN, DIMENSION_NAMES_EN, EFFECT_NAMES_EN, ENCHANT_NAMES_EN,
  MOB_NAMES_EN, PROFESSION_NAMES_EN, STAT_NAMES_EN, THING_NAMES_EN,
} from './names.en';

interface Named { name: string; display: string }

/** Uma tabela com nome, e onde está o inglês dela. */
export interface NameTable {
  /** O nome da tabela no código, para a mensagem do teste. */
  label: string;
  rows: readonly (Named | undefined)[];
  en: Readonly<Record<string, string>>;
}

const ACHIEVEMENT_TITLES_EN: Record<string, string> = {};
const ACHIEVEMENT_DESCRIPTIONS_EN: Record<string, string> = {};
for (const [name, [title, description]] of Object.entries(ACHIEVEMENT_TEXT_EN)) {
  ACHIEVEMENT_TITLES_EN[name] = title;
  ACHIEVEMENT_DESCRIPTIONS_EN[name] = description;
}

/** Todas as tabelas com `display`, para localizar e para o teste varrer. */
export const NAME_TABLES: readonly NameTable[] = [
  { label: 'BLOCKS', rows: BLOCKS, en: THING_NAMES_EN },
  { label: 'ITEMS', rows: ITEMS, en: THING_NAMES_EN },
  { label: 'POTIONS', rows: POTIONS, en: THING_NAMES_EN },
  { label: 'MOBS', rows: MOBS, en: MOB_NAMES_EN },
  { label: 'BIOMES', rows: BIOMES, en: BIOME_NAMES_EN },
  { label: 'ACHIEVEMENTS', rows: ACHIEVEMENTS, en: ACHIEVEMENT_TITLES_EN },
  { label: 'EFFECTS', rows: EFFECTS, en: EFFECT_NAMES_EN },
  { label: 'ENCHANTS', rows: ENCHANTS, en: ENCHANT_NAMES_EN },
  { label: 'PROFESSIONS', rows: PROFESSIONS, en: PROFESSION_NAMES_EN },
  { label: 'STATS', rows: STATS, en: STAT_NAMES_EN },
  { label: 'DIMENSIONS', rows: DIMENSIONS, en: DIMENSION_NAMES_EN },
];

/** O português de cada linha, guardado na primeira troca para poder voltar. */
const ptDisplay = new Map<Named, string>();
const ptDescription = new Map<Named, string>();

/**
 * Deixa os nomes de conteúdo em `target`. No jogo roda uma vez, no boot; os
 * testes chamam de novo para voltar ao português.
 */
export function localizeContent(target: Lang): void {
  for (const table of NAME_TABLES) {
    for (const row of table.rows) {
      if (row === undefined) continue;
      if (!ptDisplay.has(row)) ptDisplay.set(row, row.display);
      const pt = ptDisplay.get(row) ?? row.display;
      row.display = target === 'en' ? table.en[row.name] ?? pt : pt;
    }
  }
  for (const def of ACHIEVEMENTS) {
    if (!ptDescription.has(def)) ptDescription.set(def, def.description);
    const pt = ptDescription.get(def) ?? def.description;
    def.description = target === 'en' ? ACHIEVEMENT_DESCRIPTIONS_EN[def.name] ?? pt : pt;
  }
}

if (lang() !== 'pt') localizeContent(lang());
