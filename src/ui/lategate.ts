/**
 * Portão do pedaço "depois" (`ui/later.ts`, M25): baixa uma vez, na primeira
 * vez que alguém pede, e guarda a promessa.
 *
 * A URL é preenchida pelo build (`craftlite-late-chunk` no `vite.config.ts`).
 * O `import()` por variável é de propósito, pelo mesmo motivo de
 * `game/netgate.ts`: o Vite embrulha em `__vitePreload` todo `import()` de
 * caminho escrito, e o ajudante viraria um pedaço que todo mundo baixaria.
 */

export type Later = typeof import('./later');

declare const __CRAFTLITE_LATER_URL__: string;

let loading: Promise<Later> | null = null;

export function later(): Promise<Later> {
  if (loading === null) {
    const url: string = __CRAFTLITE_LATER_URL__;
    loading = import(/* @vite-ignore */ url) as Promise<Later>;
    // Falhou (sem rede e fora do cache): a próxima tentativa baixa de novo.
    loading.catch(() => { loading = null; });
  }
  return loading;
}

/**
 * Uma tela que só existe depois de baixada. Até lá ela está fechada, que é o
 * que o laço do jogo pergunta a cada quadro; `use` baixa (uma vez), monta e
 * chama.
 */
export class LazyScreen<T extends { readonly isOpen: boolean }> {
  private screen: T | null = null;
  private readonly make: (late: Later) => T;

  constructor(make: (late: Later) => T) {
    this.make = make;
  }

  get isOpen(): boolean {
    return this.screen?.isOpen ?? false;
  }

  use(action: (screen: T) => void): void {
    if (this.screen !== null) { action(this.screen); return; }
    void later().then((late) => {
      this.screen ??= this.make(late);
      action(this.screen);
    });
  }
}
