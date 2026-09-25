/**
 * Idioma (M17): o critério de aceite é "o jogo inteiro em inglês sem um texto
 * em português sobrando". Três camadas:
 *
 * 1. os dois dicionários de interface têm as mesmas chaves e os mesmos
 *    marcadores `{0}`, e nenhum texto do inglês tem cara de português;
 * 2. toda linha de toda tabela de conteúdo tem nome em inglês;
 * 3. **a varredura do código**: nenhum literal com cara de português fora de
 *    `data/strings/pt.ts` e dos campos de nome das tabelas. É esta que pega o
 *    texto novo escrito direto na tela, sem passar por `t()`.
 */
import { describe, expect, it, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';
import { PT } from '../src/data/strings/pt';
import { EN } from '../src/data/strings/en';
import {
  decimal, lang, langFromNavigator, resolveLang, setLanguage, t, tf,
} from '../src/core/i18n';
import { NAME_TABLES, localizeContent } from '../src/data/strings/localize';
import { ACHIEVEMENTS, ACHIEVEMENT_BY_NAME, objectiveFor } from '../src/data/achievements';
import { ITEM_BY_NAME } from '../src/data/items';
import { BLOCK_BY_NAME } from '../src/data/blocks';
import { MOB_BY_NAME } from '../src/data/mobs';

/** Acento do português: nenhuma palavra inglesa do jogo usa. */
const ACCENT = /[áàâãéêíóôõúüç]/i;
/**
 * Palavras curtas que não existem em inglês e sustentam qualquer frase em
 * português. As que existem nos dois (`no`, `do`, `as`, `a`) ficam de fora; o
 * `e` só conta minúsculo, porque `E` é leste e é a linha de entidades do F3.
 */
const PT_WORDS = /(^|[^\p{L}])(de|da|dos|das|para|com|não|você|um|uma|os|nos|nas|ao|pelo|pela|seu|sua|está|são|foi|já|mais|quando|onde|aqui|isso|este|esta|ou|em|que)(?=[^\p{L}]|$)/iu;
const PT_E = /(^|[^\p{L}])e(?=[^\p{L}]|$)/u;

function looksPortuguese(text: string): boolean {
  if (ACCENT.test(text)) return true;
  // Palavra solta só conta dentro de frase: uma palavra só é nome, não frase.
  return /\s/.test(text.trim()) && (PT_WORDS.test(text) || PT_E.test(text));
}

afterEach(() => {
  setLanguage('pt');
  localizeContent('pt');
});

describe('dicionários', () => {
  it('inglês e português têm exatamente as mesmas chaves', () => {
    expect(Object.keys(EN).sort()).toEqual(Object.keys(PT).sort());
  });

  it('os marcadores {0}, {1}… batem nos dois idiomas', () => {
    const marks = (text: string): string => (text.match(/\{\d\}/g) ?? []).sort().join('');
    for (const key of Object.keys(PT) as (keyof typeof PT)[]) {
      expect(marks(EN[key]), key).toBe(marks(PT[key]));
    }
  });

  it('nenhum texto do inglês tem cara de português', () => {
    // Os nomes de idioma vão cada um no seu (`ui/screens/options.ts`).
    const allowed = new Set(['opt.language']);
    const leaks = Object.entries(EN).filter(([key, text]) => !allowed.has(key) && looksPortuguese(text));
    expect(leaks).toEqual([]);
  });

  it('o detector pega português de verdade e deixa o inglês passar', () => {
    expect(looksPortuguese('Você morreu')).toBe(true);
    expect(looksPortuguese('Tronco de Carvalho')).toBe(true);
    expect(looksPortuguese('Ponha em Item o que quer consertar')).toBe(true);
    expect(looksPortuguese('You died')).toBe(false);
    expect(looksPortuguese('Put a water bottle in Bottle')).toBe(false);
  });
});

describe('t() e tf()', () => {
  it('troca de idioma e formata os marcadores na ordem de cada um', () => {
    expect(lang()).toBe('pt');
    expect(t('death.title')).toBe('Você morreu!');
    expect(tf('anvil.no_level', '5 níveis', 3)).toBe('Custa 5 níveis e você tem 3.');
    setLanguage('en');
    expect(t('death.title')).toBe('You died!');
    expect(tf('anvil.no_level', '5 levels', 3)).toBe('Costs 5 levels and you have 3.');
  });

  it('o número decimal segue o idioma', () => {
    expect(decimal(1.5, 1)).toBe('1,5');
    setLanguage('en');
    expect(decimal(1.5, 1)).toBe('1.5');
  });

  it('o idioma do aparelho: português para pt-*, inglês para o resto', () => {
    expect(langFromNavigator('pt-BR')).toBe('pt');
    expect(langFromNavigator('pt-PT')).toBe('pt');
    expect(langFromNavigator('en-US')).toBe('en');
    expect(langFromNavigator('es')).toBe('en');
    expect(langFromNavigator(undefined)).toBe('pt');
  });

  it('a escolha do jogador vence o aparelho; lixo cai no aparelho', () => {
    expect(resolveLang('pt', 'en-US')).toBe('pt');
    expect(resolveLang('en', 'pt-BR')).toBe('en');
    expect(resolveLang('auto', 'en-GB')).toBe('en');
    expect(resolveLang('fr', 'pt-BR')).toBe('pt');
  });
});

describe('nomes de conteúdo', () => {
  it('toda linha de toda tabela tem nome em inglês, sem cara de português', () => {
    const missing: string[] = [];
    const leaks: string[] = [];
    for (const table of NAME_TABLES) {
      for (const row of table.rows) {
        if (row === undefined) continue;
        const en = table.en[row.name];
        if (en === undefined) missing.push(`${table.label}: ${row.name}`);
        else if (looksPortuguese(en)) leaks.push(`${table.label}: ${en}`);
      }
    }
    expect(missing).toEqual([]);
    expect(leaks).toEqual([]);
  });

  it('localizar troca o nome, e voltar devolve o português', () => {
    localizeContent('en');
    expect(BLOCK_BY_NAME.get('oak_log')?.display).toBe('Oak Log');
    expect(ITEM_BY_NAME.get('stone_pickaxe')?.display).toBe('Stone Pickaxe');
    expect(ITEM_BY_NAME.get('light_blue_wool')?.display).toBe('Light Blue Wool');
    expect(MOB_BY_NAME.get('zombie')?.display).toBe('Zombie');
    expect(ACHIEVEMENT_BY_NAME.get('get_wood')?.description).toBe('You chopped your first log.');
    localizeContent('pt');
    expect(BLOCK_BY_NAME.get('oak_log')?.display).toBe('Tronco de Carvalho');
    expect(ACHIEVEMENT_BY_NAME.get('get_wood')?.description).toBe('Você derrubou o primeiro tronco.');
  });

  it('todo objetivo de conquista sai em inglês', () => {
    setLanguage('en');
    localizeContent('en');
    const displayOf = (target: string): string =>
      ITEM_BY_NAME.get(target)?.display ?? MOB_BY_NAME.get(target)?.display ?? target;
    for (const def of ACHIEVEMENTS) {
      const text = objectiveFor(def, displayOf);
      expect(looksPortuguese(text), `${def.name}: ${text}`).toBe(false);
      expect(looksPortuguese(def.display), def.display).toBe(false);
      expect(looksPortuguese(def.description), def.description).toBe(false);
    }
  });
});

/**
 * A varredura do código. Um literal com cara de português só pode morar:
 * - em `data/strings/pt.ts`, que é o lugar dele;
 * - num campo de nome de tabela (`display:`, `description:`, `feminine:`),
 *   que `names.en.ts` cobre (ver o teste acima);
 * - numa mensagem de invariante (`new Error(…)` de programação, `console.*`),
 *   que é para quem desenvolve e não aparece em jogo normal.
 */
describe('varredura do código', () => {
  const files: string[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir)) {
      const path = join(dir, entry);
      if (statSync(path).isDirectory()) walk(path);
      else if (path.endsWith('.ts')) files.push(path);
    }
  };
  walk('src');

  /** Linhas inteiras que podem ter português, por arquivo e trecho. */
  const EXEMPT: readonly [string, RegExp][] = [
    ['src/data/strings/pt.ts', /./],
    // O nome do idioma vai nele mesmo.
    ['src/ui/screens/options.ts', /'Português'/],
    // Caracteres do alfabeto da fonte, não texto.
    ['src/data/font.ts', /./],
  ];

  it('nenhum texto de interface escrito direto no código', () => {
    const leaks: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8')
        // Comentário de bloco sai, preservando as quebras de linha.
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      const lines = source.split('\n');
      lines.forEach((raw, index) => {
        const line = raw.replace(/\/\/.*$/, '');
        if (/new Error\(|console\.|throw new Error/.test(line)) return;
        if (/\b(display|description|feminine)\s*:/.test(line)) return;
        if (EXEMPT.some(([f, re]) => file.replace(/\\/g, '/') === f && re.test(line))) return;
        const literal = /'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`|"((?:[^"\\]|\\.)*)"/g;
        let m: RegExpExecArray | null;
        while ((m = literal.exec(line)) !== null) {
          const text = (m[1] ?? m[2] ?? m[3]).replace(/\$\{[^}]*\}/g, ' ');
          if (looksPortuguese(text)) leaks.push(`${file}:${index + 1}: ${text.slice(0, 80)}`);
        }
      });
    }
    expect(leaks).toEqual([]);
  });

  /*
   * A segunda rede, pelo **destino**: um literal que vai direto para a tela
   * não pode ter palavra nenhuma, com ou sem cara de português. Foi o que
   * faltou para pegar *"A tempestade chegou"* e *"Durabilidade:"*, que não têm
   * acento nem palavra-função.
   */
  it('nada escrito direto para a tela: mensagem, texto, rótulo, dica', () => {
    const SINK = /showMessage\(|onMessage\?*\.?\(|message\(|showSubtitle\(|setStatus\(|textContent\s*=|innerHTML\s*=|placeholder\s*=|\.title\s*=|'aria-label',|\blabel:\s*['`]|menuButton\(\s*['`]|menuPanel\(\s*['`]|menuSection\(\s*['`]|textField\(\s*['`]/;
    // Palavras que são nome próprio ou sigla, iguais em qualquer idioma.
    const PROPER = new Set([
      'CraftLite', 'Português', 'English', 'DualSense', 'DualShock', 'Xbox', 'Nintendo', 'Switch',
      'Pro', 'PS4', 'PS5', 'Protanopia', 'Deuteranopia', 'Tritanopia', 'WebGL', 'WebGL1',
      'WebGL2', 'code', 'keyCode', 'div', 'class', 'flame', 'arrow', 'bar', 'span', 'FPS',
    ]);
    const leaks: string[] = [];
    for (const file of files) {
      if (file.replace(/\\/g, '/').startsWith('src/data/strings/')) continue;
      const source = readFileSync(file, 'utf8')
        .replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, ' '));
      source.split('\n').forEach((raw, index) => {
        const line = raw.replace(/\/\/.*$/, '');
        if (!SINK.test(line) || /new Error\(|console\./.test(line)) return;
        const literal = /'((?:[^'\\]|\\.)*)'|`((?:[^`\\]|\\.)*)`/g;
        let m: RegExpExecArray | null;
        while ((m = literal.exec(line)) !== null) {
          // A chave de `t('…')`, o nome do atributo e o lado de uma comparação
          // não vão para a tela.
          const before = line.slice(0, m.index);
          if (/\b(t|tf)\(\s*$|(===|!==)\s*$|setAttribute\(\s*$|value:\s*$/.test(before)) continue;
          if (m[0] === "'aria-label'") continue;
          if (/^\s*(===|!==)/.test(line.slice(m.index + m[0].length))) continue;
          const text = (m[1] ?? m[2]).replace(/\$\{[^}]*\}/g, ' ');
          // Pedaço de template aninhado: o regex de linha não o separa direito.
          if (text.includes('${')) continue;
          const words = text.match(/[A-Za-zÀ-ÿ]{3,}/g) ?? [];
          if (words.some((w) => !PROPER.has(w))) {
            leaks.push(`${file}:${index + 1}: ${text.slice(0, 80)}`);
          }
        }
      });
    }
    expect(leaks).toEqual([]);
  });
});
