/**
 * Pacote do inglês (M25): ponto de entrada próprio, baixado pelo `index.html`
 * só quando o idioma é inglês. Ver `langpack.ts`.
 *
 * A chave do global vai escrita aqui, e não importada: um import de valor em
 * comum com o jogo viraria um pedaço compartilhado.
 */

import { EN } from './en';
import {
  ACHIEVEMENT_TEXT_EN, BIOME_NAMES_EN, DIMENSION_NAMES_EN, EFFECT_NAMES_EN, ENCHANT_NAMES_EN,
  MOB_NAMES_EN, PROFESSION_NAMES_EN, STAT_NAMES_EN, THING_NAMES_EN,
} from './names.en';
import type { LangPacks } from './langpack';

const g = globalThis as { __CRAFTLITE_LANGS__?: LangPacks };
const packs: LangPacks = g.__CRAFTLITE_LANGS__ ?? {};
packs.en = {
  ui: EN,
  names: {
    things: THING_NAMES_EN,
    mobs: MOB_NAMES_EN,
    biomes: BIOME_NAMES_EN,
    achievements: ACHIEVEMENT_TEXT_EN,
    effects: EFFECT_NAMES_EN,
    enchants: ENCHANT_NAMES_EN,
    professions: PROFESSION_NAMES_EN,
    stats: STAT_NAMES_EN,
    dimensions: DIMENSION_NAMES_EN,
  },
};
g.__CRAFTLITE_LANGS__ = packs;
