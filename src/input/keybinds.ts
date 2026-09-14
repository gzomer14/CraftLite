/**
 * Mapa de teclas do jogador, persistido em `localStorage` (doc 08 §3.11).
 *
 * Fica fora do `SettingsStore` porque é outro formato: `Settings` é um registro
 * plano de campos tipados, com faixa numérica por chave, e isto é um
 * dicionário de ação → código que cresce com a tabela de `data/keybinds.ts`.
 * Enfiar dez chaves de string lá dentro obrigaria a validar cada uma à mão.
 *
 * **Conflito não é erro.** Duas ações na mesma tecla continuam funcionando —
 * as duas disparam — e a tela de opções pinta as duas de vermelho. Recusar a
 * troca deixaria o jogador preso: para trocar A e B de lugar é preciso passar
 * por um estado em que as duas estão na mesma tecla.
 */

import { KEYBINDS, RESERVED_CODES, type ActionId } from '../data/keybinds';

const STORAGE_KEY = 'craftlite.keybinds.v1';

export class Keybinds {
  private readonly codes = new Map<ActionId, string>();
  private readonly listeners: (() => void)[] = [];

  constructor() {
    this.reset(false);
    for (const [id, code] of loadStored()) this.codes.set(id, code);
  }

  /** Código da tecla de uma ação. */
  codeFor(id: ActionId): string {
    return this.codes.get(id) ?? '';
  }

  /**
   * Troca a tecla de uma ação. Devolve `false` se a tecla é reservada.
   *
   * O conflito com outra ação é permitido e sinalizado por `conflicts`.
   */
  set(id: ActionId, code: string): boolean {
    if (RESERVED_CODES.includes(code)) return false;
    this.codes.set(id, code);
    this.save();
    for (const fn of this.listeners) fn();
    return true;
  }

  /** Ações que dividem a tecla de `id`, sem contar ela mesma. */
  conflicts(id: ActionId): ActionId[] {
    const code = this.codeFor(id);
    const out: ActionId[] = [];
    for (const [other, otherCode] of this.codes) {
      if (other !== id && otherCode === code) out.push(other);
    }
    return out;
  }

  /** true se alguma ação divide tecla com outra. */
  get hasConflict(): boolean {
    const seen = new Set<string>();
    for (const code of this.codes.values()) {
      if (seen.has(code)) return true;
      seen.add(code);
    }
    return false;
  }

  reset(notify = true): void {
    for (const bind of KEYBINDS) this.codes.set(bind.id, bind.code);
    if (!notify) return;
    this.save();
    for (const fn of this.listeners) fn();
  }

  /** Avisado a cada troca — é por aqui que o `Controls` refaz os binds. */
  onChange(fn: () => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private save(): void {
    const out: Record<string, string> = {};
    for (const [id, code] of this.codes) out[id] = code;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(out));
    } catch {
      // Modo privado ou cota cheia: jogar sem persistir é melhor que quebrar.
    }
  }
}

/** Lê o que está guardado, descartando ação desconhecida e tecla reservada. */
function loadStored(): [ActionId, string][] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (typeof parsed !== 'object' || parsed === null) return [];

  const source = parsed as Record<string, unknown>;
  const out: [ActionId, string][] = [];
  for (const bind of KEYBINDS) {
    const code = source[bind.id];
    if (typeof code !== 'string' || code === '') continue;
    if (RESERVED_CODES.includes(code)) continue;
    out.push([bind.id, code]);
  }
  return out;
}
