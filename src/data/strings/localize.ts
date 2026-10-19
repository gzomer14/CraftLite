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
import { englishPack, lang, type Lang } from '../../core/i18n';
import { ACTIVE_MODS } from '../../mods/active';

interface Named { name: string; display: string }

/** Uma tabela com nome, e onde está o inglês dela. */
export interface NameTable {
  /** O nome da tabela no código, para a mensagem do teste. */
  label: string;
  rows: readonly (Named | undefined)[];
  en: Readonly<Record<string, string>>;
}

const NONE: Readonly<Record<string, string>> = {};

/**
 * Todas as tabelas com `display`, com o inglês **do pacote carregado**
 * (`data/strings/pack.en.ts`, M25). Sem o pacote os mapas vêm vazios, e
 * localizar para `en` deixa o português.
 *
 * Os nomes dos mods ligados (M21) entram junto com os de blocos e itens.
 */
export function nameTables(): NameTable[] {
  const names = englishPack()?.names;
  const things: Readonly<Record<string, string>> = ACTIVE_MODS.length === 0
    ? names?.things ?? NONE
    : Object.assign({}, names?.things ?? NONE, ...ACTIVE_MODS.map((mod) => mod.en));
  const titles: Record<string, string> = {};
  for (const [name, [title]] of Object.entries(names?.achievements ?? {})) titles[name] = title;
  return [
    { label: 'BLOCKS', rows: BLOCKS, en: things },
    { label: 'ITEMS', rows: ITEMS, en: things },
    { label: 'POTIONS', rows: POTIONS, en: names?.things ?? NONE },
    { label: 'MOBS', rows: MOBS, en: names?.mobs ?? NONE },
    { label: 'BIOMES', rows: BIOMES, en: names?.biomes ?? NONE },
    { label: 'ACHIEVEMENTS', rows: ACHIEVEMENTS, en: titles },
    { label: 'EFFECTS', rows: EFFECTS, en: names?.effects ?? NONE },
    { label: 'ENCHANTS', rows: ENCHANTS, en: names?.enchants ?? NONE },
    { label: 'PROFESSIONS', rows: PROFESSIONS, en: names?.professions ?? NONE },
    { label: 'STATS', rows: STATS, en: names?.stats ?? NONE },
    { label: 'DIMENSIONS', rows: DIMENSIONS, en: names?.dimensions ?? NONE },
  ];
}

/** O português de cada linha, guardado na primeira troca para poder voltar. */
const ptDisplay = new Map<Named, string>();
const ptDescription = new Map<Named, string>();

/**
 * Deixa os nomes de conteúdo em `target`. No jogo roda uma vez, no boot; os
 * testes chamam de novo para voltar ao português.
 */
export function localizeContent(target: Lang): void {
  const descriptions = englishPack()?.names.achievements ?? {};
  for (const table of nameTables()) {
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
    def.description = target === 'en' ? descriptions[def.name]?.[1] ?? pt : pt;
  }
}

if (lang() !== 'pt') localizeContent(lang());
