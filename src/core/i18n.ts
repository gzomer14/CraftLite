/**
 * Idioma da interface (doc 08 §3.11, M17).
 *
 * **O idioma é resolvido uma vez, na avaliação deste módulo**, e não muda com
 * o jogo aberto — trocar vale no próximo carregamento, como a qualidade e o
 * estilo de textura. É isso que deixa o `t()` barato e as tabelas de campos
 * (`ui/screens/options.ts` e companhia) continuarem sendo constantes de módulo:
 * todo módulo que chama `t()` importa este, e por isso roda **depois** dele,
 * com o idioma já decidido.
 *
 * Por isso a preferência é lida direto do `localStorage`, com a mesma chave de
 * `game/settings.ts`, e não do `SettingsStore`: o store nasce dentro do
 * `boot()`, e as constantes de módulo já foram avaliadas antes disso.
 *
 * Fora do navegador (vitest, worker) não há `document`: o idioma é `pt`, e os
 * testes que precisam do inglês pedem com `setLanguage`.
 *
 * Os textos de interface ficam em `data/strings/pt.ts` e `en.ts`; os nomes de
 * conteúdo (bloco, item, mob…) continuam na tabela de cada um, em português, e
 * o inglês deles entra por `data/strings/localize.ts`.
 */

import { PT, type StringKey } from '../data/strings/pt';
import { EN } from '../data/strings/en';
import { STORAGE_KEY } from '../game/settings';

export type Lang = 'pt' | 'en';
/** A preferência guardada: `auto` segue o idioma do aparelho. */
export type LangSetting = 'auto' | Lang;

export const LANGS: readonly Lang[] = ['pt', 'en'];

/**
 * Idioma pelo aparelho: português para qualquer `pt-*`, inglês para o resto.
 *
 * O jogo nasceu em português e continua sendo; o inglês é a porta para quem
 * não lê português, e é por isso que ele é o padrão de todo o resto do mundo.
 */
export function langFromNavigator(language: string | undefined): Lang {
  if (language === undefined || language === '') return 'pt';
  return language.toLowerCase().startsWith('pt') ? 'pt' : 'en';
}

/** Resolve a preferência guardada; `auto` e lixo caem no idioma do aparelho. */
export function resolveLang(setting: unknown, navigatorLanguage: string | undefined): Lang {
  if (setting === 'pt' || setting === 'en') return setting;
  return langFromNavigator(navigatorLanguage);
}

function detect(): Lang {
  if (typeof document === 'undefined') return 'pt';
  let stored: unknown;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw !== null) stored = (JSON.parse(raw) as { language?: unknown }).language;
  } catch {
    // `localStorage` bloqueado ou JSON quebrado: segue o aparelho.
  }
  return resolveLang(stored, typeof navigator === 'undefined' ? undefined : navigator.language);
}

let current: Lang = detect();
let table: Readonly<Record<StringKey, string>> = current === 'en' ? EN : PT;

/** O idioma em uso. */
export function lang(): Lang {
  return current;
}

/**
 * Troca o idioma **deste módulo**. Só os testes chamam: no jogo o idioma muda
 * recarregando, porque as constantes de módulo já leram os textos.
 */
export function setLanguage(next: Lang): void {
  current = next;
  table = next === 'en' ? EN : PT;
}

/** O texto da chave no idioma em uso. */
export function t(key: StringKey): string {
  return table[key];
}

/**
 * O texto da chave com `{0}`, `{1}`… trocados pelos argumentos.
 *
 * Posicional e não por nome porque a ordem das palavras muda de um idioma para
 * o outro e o marcador acompanha; um objeto de nomes custaria uma alocação por
 * chamada a mais, sem ganho de leitura em frases de uma linha.
 */
export function tf(key: StringKey, ...args: readonly (string | number)[]): string {
  let text: string = table[key];
  for (let i = 0; i < args.length; i++) text = text.split(`{${i}}`).join(String(args[i]));
  return text;
}

/**
 * Número com casas decimais na convenção do idioma: `0,5` em português, `0.5`
 * em inglês.
 */
export function decimal(value: number, digits: number): string {
  const text = value.toFixed(digits);
  return current === 'pt' ? text.replace('.', ',') : text;
}

/** O atributo `lang` do documento, para leitor de tela e hifenização. */
export function htmlLang(): string {
  return current === 'pt' ? 'pt-BR' : 'en';
}
