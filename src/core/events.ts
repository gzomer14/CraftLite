/**
 * Event bus tipado, minúsculo. Substitui React/Redux (doc 01 §1).
 *
 * Os handlers ficam em array simples: iterar array é mais barato que Set em
 * engines antigas, e o caminho quente (`emit`) não aloca.
 */

export type Handler<T> = (payload: T) => void;

export class EventBus<Events> {
  private readonly map = new Map<keyof Events, Handler<never>[]>();

  on<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    let list = this.map.get(type);
    if (list === undefined) {
      list = [];
      this.map.set(type, list);
    }
    list.push(fn as Handler<never>);
    return () => this.off(type, fn);
  }

  once<K extends keyof Events>(type: K, fn: Handler<Events[K]>): () => void {
    const off = this.on(type, (payload) => {
      off();
      fn(payload);
    });
    return off;
  }

  off<K extends keyof Events>(type: K, fn: Handler<Events[K]>): void {
    const list = this.map.get(type);
    if (list === undefined) return;
    const i = list.indexOf(fn as Handler<never>);
    if (i >= 0) list.splice(i, 1);
  }

  emit<K extends keyof Events>(type: K, payload: Events[K]): void {
    const list = this.map.get(type);
    if (list === undefined) return;
    // Itera por índice e tolera handlers que se removem durante o emit.
    for (let i = 0; i < list.length; i++) {
      (list[i] as Handler<Events[K]>)(payload);
    }
  }

  clear(): void {
    this.map.clear();
  }
}

/** Eventos globais do jogo. Novos tipos entram aqui, não em strings soltas. */
export interface GameEvents {
  resize: { width: number; height: number; dpr: number };
  tick: { tick: number };
  contextLost: undefined;
  contextRestored: undefined;
  debugToggle: boolean;
}

export const bus = new EventBus<GameEvents>();
