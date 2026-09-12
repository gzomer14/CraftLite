/**
 * Service worker do CraftLite (doc 11 §7).
 *
 * Estratégia **stale-while-revalidate** no app shell: responde do cache na hora
 * (o jogo abre offline e instantâneo) e busca a versão nova em segundo plano.
 * O cache é versionado pelo build; `activate` limpa os antigos.
 *
 * Só entra em cache o que é do próprio site. Requisição de terceiro passa
 * direto — o jogo não tem nenhuma, e cachear às cegas é como se acumula lixo.
 */

const VERSION = self.__CRAFTLITE_VERSION__ || 'dev';
const CACHE = `craftlite-${VERSION}`;

/**
 * Tudo que o jogo precisa para abrir sem rede.
 *
 * `__CRAFTLITE_ASSETS__` é substituído no build pela lista real de arquivos
 * emitidos (bundle, worker de chunks, ícones) — sem isso, o precache era só o
 * HTML e o jogo **dependia de ter sido aberto uma vez com rede** para o bundle
 * entrar no cache sob demanda. Instalar o PWA e só depois ficar offline dava
 * uma tela em branco.
 */
const ASSETS = self.__CRAFTLITE_ASSETS__ || [];
const SHELL = ['./', './index.html', './manifest.webmanifest', ...ASSETS];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE)
      // Um `addAll` falha inteiro se **um** item falhar, e aí o jogo fica sem
      // precache nenhum. Item a item, o que der certo fica.
      .then((cache) => Promise.all(
        SHELL.map((url) => cache.add(url).catch(() => undefined)),
      ))
      .catch(() => undefined)
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((key) => key.startsWith('craftlite-') && key !== CACHE)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  event.respondWith(staleWhileRevalidate(request));
});

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request);

  const network = fetch(request)
    .then((response) => {
      // Só guarda resposta completa e válida; opaque/erro poluiria o cache.
      if (response.ok && response.type === 'basic') {
        cache.put(request, response.clone()).catch(() => undefined);
      }
      return response;
    })
    .catch(() => undefined);

  if (cached !== undefined) {
    // Revalida em segundo plano sem segurar a resposta.
    event_waitUntil(network);
    return cached;
  }

  const response = await network;
  if (response !== undefined) return response;

  // Offline e sem cache: navegação cai no shell, o resto falha honestamente.
  if (request.mode === 'navigate') {
    const shell = await cache.match('./index.html');
    if (shell !== undefined) return shell;
  }
  return new Response('Offline', { status: 503, statusText: 'Offline' });
}

/** `event.waitUntil` fora do handler não existe; isto só evita unhandled rejection. */
function event_waitUntil(promise) {
  promise.catch(() => undefined);
}

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
