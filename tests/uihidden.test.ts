/**
 * O atributo `hidden` do HTML é aplicado pelo navegador com a regra
 * `[hidden]{display:none}`, de especificidade mínima. Qualquer CSS nosso que
 * defina `display` num seletor de id ou classe vence essa regra e o elemento
 * continua visível — foi assim que o aviso "gire o aparelho" apareceu numa
 * janela em paisagem, e os botões do Modo B apareceriam no Modo A.
 *
 * A defesa é a regra global `[hidden]{display:none!important}` no index.html.
 * Este teste garante que ela não seja removida por engano.
 */
import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

const html = readFileSync('index.html', 'utf8');

describe('index.html', () => {
  it('neutraliza a especificidade do atributo hidden', () => {
    expect(html.replace(/\s+/g, ' ')).toContain('[hidden]{display:none!important}');
  });

  it('bloqueia gestos do navegador no corpo e no canvas (doc 09 §2.3)', () => {
    const compact = html.replace(/\s+/g, '');
    expect(compact).toContain('touch-action:none');
    expect(compact).toContain('overscroll-behavior:none');
    expect(compact).toContain('user-select:none');
    expect(compact).toContain('-webkit-tap-highlight-color:transparent');
  });

  it('declara viewport-fit=cover para o notch', () => {
    expect(html).toContain('viewport-fit=cover');
  });

  it('aponta para o manifest do PWA', () => {
    expect(html).toContain('rel="manifest"');
    expect(html).toContain('manifest.webmanifest');
  });
});

describe('manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));

  it('abre em tela cheia e em paisagem (doc 11 §7)', () => {
    expect(manifest.display).toBe('fullscreen');
    expect(manifest.orientation).toBe('landscape');
  });

  it('tem os dois tamanhos de ícone', () => {
    const sizes = manifest.icons.map((i: { sizes: string }) => i.sizes);
    expect(sizes).toContain('192x192');
    expect(sizes).toContain('512x512');
  });

  it('tem um ícone maskable, para o Android não recortar errado', () => {
    expect(manifest.icons.some((i: { purpose?: string }) => i.purpose === 'maskable')).toBe(true);
  });

  it('usa caminhos relativos, para funcionar em subdiretório', () => {
    expect(manifest.start_url).toBe('./');
    expect(manifest.scope).toBe('./');
  });
});

describe('service worker', () => {
  const sw = readFileSync('public/sw.js', 'utf8');

  it('versiona o cache pelo build', () => {
    expect(sw).toContain('__CRAFTLITE_VERSION__');
    expect(sw).toContain('craftlite-');
  });

  it('limpa caches antigos no activate', () => {
    expect(sw).toContain("addEventListener('activate'");
    expect(sw).toContain('caches.delete');
  });

  it('só intercepta GET da própria origem', () => {
    expect(sw).toContain("request.method !== 'GET'");
    expect(sw).toContain('url.origin !== self.location.origin');
  });

  it('tem fallback de navegação para abrir offline', () => {
    expect(sw).toContain("request.mode === 'navigate'");
  });
});
