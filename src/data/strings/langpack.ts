/**
 * O pacote do inglês (M25): o dicionário de interface e os nomes de conteúdo.
 * **Só tipos** — este arquivo não gera código.
 *
 * Até o M25 o inglês ia embutido no jogo, e todo jogador baixava os dois
 * idiomas. O português continua embutido (é o idioma do jogo e o de quem
 * mais joga); o inglês virou um ponto de entrada próprio (`pack.en.ts`,
 * saída em `l/`), que o `index.html` baixa **só quando o idioma é inglês**, em
 * paralelo com o jogo e executado antes dele. O pacote deixa as tabelas em
 * `globalThis.__CRAFTLITE_LANGS__`, do jeito dos mods (`mods/active.ts`).
 *
 * Medido (gzip): o jogo em português ficou ~10 KB menor. Em inglês o
 * idioma sozinho custaria ~4 KB a mais que antes — os dois dicionários juntos
 * comprimiam melhor, porque as chaves se repetem —, e o caminho inteiro
 * terminou o M25 1,3 KB acima do de antes. É a troca que favorece o idioma do
 * jogo. **Separar os dois idiomas** foi medido e descartado: o pacote do
 * português sozinho comprime para quase o mesmo que ele economizava.
 *
 * O pacote não importa nada que o jogo importe em tempo de execução: um
 * módulo em comum viraria um pedaço compartilhado, uma requisição a mais.
 */

import type { StringKey } from './pt';

/** Os nomes de conteúdo em inglês, por tabela (ver `names.en.ts`). */
export interface ContentNames {
  things: Readonly<Record<string, string>>;
  mobs: Readonly<Record<string, string>>;
  biomes: Readonly<Record<string, string>>;
  achievements: Readonly<Record<string, readonly [string, string]>>;
  effects: Readonly<Record<string, string>>;
  enchants: Readonly<Record<string, string>>;
  professions: Readonly<Record<string, string>>;
  stats: Readonly<Record<string, string>>;
  dimensions: Readonly<Record<string, string>>;
}

export interface EnglishPack {
  ui: Readonly<Record<StringKey, string>>;
  names: ContentNames;
}

/** Onde os pacotes carregados ficam. */
export interface LangPacks {
  en?: EnglishPack;
}
