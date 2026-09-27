/**
 * Worker de chunk **com mods** (M21).
 *
 * O worker importa as tabelas de `src/data/`, que se montam na avaliação do
 * módulo; bloco de mod precisa estar nelas antes, senão o mesher o desenha como
 * ar. Então, com mod ligado, o worker sobe por aqui: lê os ids no próprio nome
 * (`chunk-0|exemplo,outro`, dado por `world/pipeline.ts`), carrega os mesmos
 * mods que a página, deixa o global e só então importa o worker de sempre. As
 * mensagens que chegarem nesse meio-tempo esperam na fila e são entregues em
 * ordem.
 *
 * Sem mod ligado, a página sobe `chunk.worker.ts` direto, e este arquivo não é
 * baixado.
 */

import { loadMods } from '../mods/loaders';

const pending: MessageEvent[] = [];
self.onmessage = (event: MessageEvent): void => {
  pending.push(event);
};

async function start(): Promise<void> {
  const ids = (self.name.split('|')[1] ?? '').split(',').filter((id) => id.length > 0);
  (globalThis as { __CRAFTLITE_MODS__?: unknown }).__CRAFTLITE_MODS__ = await loadMods(ids);
  await import('./chunk.worker');
  const handler = self.onmessage as ((event: MessageEvent) => void) | null;
  if (handler === null) return;
  for (const event of pending) handler(event);
  pending.length = 0;
}

void start();
