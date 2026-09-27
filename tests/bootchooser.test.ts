/**
 * O script de escolha do `index.html` (M21): sem mod, o jogo; com mod, o ponto
 * de entrada dos mods — e, se este não carregar, o jogo.
 *
 * A volta existe por um defeito achado ao fechar o M21: o ponto de entrada dos
 * mods não está no precache (só `a/` está), então ligar um mod e abrir o jogo
 * **sem rede** pedia um arquivo que não existia em lugar nenhum, e a página
 * ficava em branco. Reproduzido no Chrome com o service worker e o servidor
 * derrubado; aqui, o script roda com `document` e `localStorage` de mentira.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'fs';

interface FakeScript { type: string; src: string; crossOrigin: string; onerror: (() => void) | null }

/** Roda o script inline do `index.html` e devolve os `<script>` que ele pôs. */
function runChooser(stored: string | null): FakeScript[] {
  const html = readFileSync('index.html', 'utf8');
  const code = /<script>([\s\S]*?localStorage[\s\S]*?)<\/script>/.exec(html)?.[1];
  if (code === undefined) throw new Error('script de escolha não achado no index.html');
  const added: FakeScript[] = [];
  const document = {
    createElement: (): FakeScript => ({ type: '', src: '', crossOrigin: 'x', onerror: null }),
    body: { appendChild: (s: FakeScript) => { added.push(s); } },
  };
  const localStorage = { getItem: () => stored };
  new Function('document', 'localStorage', code)(document, localStorage);
  return added;
}

describe('o script de escolha do index.html', () => {
  it('sem mod ligado, sobe o jogo direto, como módulo', () => {
    const added = runChooser(null);
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe('/src/main.ts');
    expect(added[0].type).toBe('module');
    expect(added[0].crossOrigin).toBe('');
  });

  it('com mod ligado, sobe o ponto de entrada dos mods', () => {
    const added = runChooser('["exemplo"]');
    expect(added).toHaveLength(1);
    expect(added[0].src).toBe('/src/mods/boot.ts');
  });

  it('se o ponto de entrada dos mods não carregar (offline), sobe o jogo sem mod', () => {
    const added = runChooser('["exemplo"]');
    added[0].onerror?.();
    expect(added).toHaveLength(2);
    expect(added[1].src).toBe('/src/main.ts');
    // O jogo que falhar não tem para onde voltar: nada de laço.
    expect(added[1].onerror).toBeNull();
  });
});
