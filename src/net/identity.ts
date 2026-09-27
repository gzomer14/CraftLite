/**
 * Quem é este aparelho numa sala (M20).
 *
 * O `playerId` é estável e mora no aparelho de quem joga: é a chave com que o
 * anfitrião guarda o convidado no mundo dele (`STORE_PLAYERS`,
 * `[worldId, playerId]`). Voltar à sala com o mesmo aparelho é voltar para onde
 * se estava, com o que se tinha.
 */

import { BLOCKS } from '../data/blocks';
import { ITEMS } from '../data/items';
import { ACTIVE_MODS } from '../mods/active';
import { t } from '../core/i18n';
import { contentHash } from './protocol';

const ID_KEY = 'craftlite.netid';
const NAME_KEY = 'craftlite.netname';
export const MAX_NAME = 16;

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Sem armazenamento: vale só por esta sessão.
  }
}

let sessionId: string | null = null;

export function playerId(): string {
  const stored = read(ID_KEY);
  if (stored !== null && /^[0-9a-f]{16}$/.test(stored)) return stored;
  if (sessionId === null) {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    sessionId = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
    write(ID_KEY, sessionId);
  }
  return sessionId;
}

export function playerName(): string {
  const stored = read(NAME_KEY);
  if (stored !== null && stored.trim() !== '') return stored.trim().slice(0, MAX_NAME);
  return `${t('net.default_name')} ${playerId().slice(0, 4).toUpperCase()}`;
}

export function setPlayerName(name: string): void {
  const clean = name.trim().slice(0, MAX_NAME);
  if (clean !== '') write(NAME_KEY, clean);
}

/** Blocos, itens e mods ligados, na ordem dos ids: tem de bater nos dois lados. */
export function localContent(): number {
  const names: string[] = [];
  for (const b of BLOCKS) names.push(b === undefined ? '' : b.name);
  for (const i of ITEMS) if (i !== undefined) names.push(`${i.id}:${i.name}`);
  for (const m of ACTIVE_MODS) names.push(`mod:${m.id}`);
  return contentHash(names);
}

export function activeModIds(): string[] {
  return ACTIVE_MODS.map((m) => m.id);
}
