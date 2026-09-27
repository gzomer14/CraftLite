/**
 * Catálogo de mods (M21): o que a tela **Mods** lista.
 *
 * É a única parte dos mods que mora no pedaço principal do jogo, e por isso
 * não importa código de mod nenhum — só descreve. Quem carrega um mod é
 * `mods/loaders.ts`, que só o ponto de entrada dos mods (`mods/boot.ts`) e o
 * worker com mods importam. Um mod novo entra nos dois lugares; o teste
 * `tests/mods.test.ts` cobra que as listas batem.
 *
 * A escolha do jogador fica no `localStorage` (chave `MODS_STORAGE_KEY`), e não
 * no `SettingsStore`: quem a lê primeiro é o `index.html`, **antes** de
 * qualquer módulo do jogo existir, para decidir se o boot passa pelos mods.
 */

export interface ModInfo {
  id: string;
  display: string;
  description: string;
  /** O mod pode pesar em aparelho fraco (a tela avisa). */
  heavy?: boolean;
  en: { display: string; description: string };
}

export const MOD_CATALOG: readonly ModInfo[] = [
  {
    id: 'exemplo',
    display: 'Exemplo',
    description: 'Um cristal que brilha e cura quem fica em cima, feito de vidro e redstone.',
    en: {
      display: 'Example',
      description: 'A glowing crystal that heals whoever stands on it, made from glass and redstone.',
    },
  },
];

/** A mesma chave está no `index.html` e em `mods/boot.ts` (há teste). */
export const MODS_STORAGE_KEY = 'craftlite.mods';

/** Os mods que o jogador ligou, na ordem do catálogo; vazio se nada salvo. */
export function readEnabledMods(): string[] {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(MODS_STORAGE_KEY);
  } catch {
    return [];
  }
  if (raw === null) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return MOD_CATALOG.filter((info) => parsed.includes(info.id)).map((info) => info.id);
  } catch {
    return [];
  }
}

/**
 * Guarda a escolha. Lista vazia **apaga** a chave: é o que devolve o boot ao
 * caminho de antes do M21, sem nem o `JSON.parse` do `index.html`.
 */
export function writeEnabledMods(ids: readonly string[]): void {
  try {
    if (ids.length === 0) localStorage.removeItem(MODS_STORAGE_KEY);
    else localStorage.setItem(MODS_STORAGE_KEY, JSON.stringify(ids));
  } catch {
    // Sem armazenamento (modo privado antigo): o mod só não fica ligado.
  }
}
