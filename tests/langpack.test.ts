/**
 * O pacote do inglês (M25) e o script do `index.html` que o escolhe.
 *
 * O script decide o idioma **antes** do jogo existir, para baixar o pacote em
 * paralelo; o `core/i18n.ts` decide de novo, já dentro do jogo. Se as duas
 * regras divergissem, o jogador em inglês receberia o jogo em português (sem
 * pacote), ou baixaria um pacote que ninguém lê. Aqui o script roda de
 * verdade, com `localStorage`, `navigator` e `document` falsos.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolveLang } from '../src/core/i18n';
import { STORAGE_KEY } from '../src/game/settings';
import { MODS_STORAGE_KEY } from '../src/mods/catalog';

const HTML = readFileSync('index.html', 'utf8');
const SCRIPT = HTML.match(/<script>(\(function\(\)\{[\s\S]*?)<\/script>/)?.[1] ?? '';

/** Roda o script e devolve os `src` que ele pede, na ordem. */
function run(settings: unknown, language: string, mods: string | null = null): string[] {
  const store: Record<string, string> = {};
  if (settings !== undefined) store[STORAGE_KEY] = JSON.stringify(settings);
  if (mods !== null) store[MODS_STORAGE_KEY] = mods;
  const loaded: string[] = [];
  const fakeDocument = {
    createElement: () => ({}) as Record<string, unknown>,
    body: { appendChild: (el: { src: string; async: boolean }) => { expect(el.async).toBe(false); loaded.push(el.src); } },
  };
  const fakeStorage = { getItem: (key: string) => store[key] ?? null };
  new Function('localStorage', 'navigator', 'document', SCRIPT)(fakeStorage, { language }, fakeDocument);
  return loaded;
}

const EN_PACK = '/src/data/strings/pack.en.ts';

describe('o script do index.html escolhe o idioma como o i18n', () => {
  it('o script existe e usa as mesmas chaves de armazenamento do jogo', () => {
    expect(SCRIPT).not.toBe('');
    expect(SCRIPT).toContain(`'${STORAGE_KEY}'`);
    expect(SCRIPT).toContain(`'${MODS_STORAGE_KEY}'`);
  });

  it('baixa o pacote do inglês exatamente quando o i18n escolheria inglês', () => {
    const cases: [unknown, string][] = [
      [undefined, 'pt-BR'], [undefined, 'en-US'], [undefined, ''], [undefined, 'fr-FR'],
      [{ language: 'auto' }, 'en-GB'], [{ language: 'auto' }, 'pt-PT'],
      [{ language: 'en' }, 'pt-BR'], [{ language: 'pt' }, 'en-US'], [{ language: 'xx' }, 'en-US'],
      [{}, 'PT-br'],
    ];
    for (const [settings, language] of cases) {
      const setting = (settings as { language?: unknown } | undefined)?.language;
      const wantsEnglish = resolveLang(setting, language) === 'en';
      const loaded = run(settings, language);
      expect(loaded.includes(EN_PACK), `${JSON.stringify(settings)} / ${language}`).toBe(wantsEnglish);
    }
  });

  it('o pacote vem antes do jogo, e o jogo vem sempre', () => {
    expect(run({ language: 'en' }, 'pt-BR')).toEqual([EN_PACK, '/src/main.ts']);
    expect(run({ language: 'pt' }, 'en-US')).toEqual(['/src/main.ts']);
    expect(run({ language: 'en' }, 'en-US', '["exemplo"]')).toEqual([EN_PACK, '/src/mods/boot.ts']);
  });
});
