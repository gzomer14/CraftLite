/**
 * Utilitário de `data:` URL, sem `fetch` (que é assíncrono e teria que esperar
 * por um dado que já está na mão). Saiu do `main.ts` em 2026-09-22 (M13).
 */

/**
 * `data:image/png;base64,…` → bytes. Sem `fetch`, que é assíncrono e teria que
 * esperar por um dado que já está na mão.
 */
export function decodeDataUrl(url: string): Uint8Array | null {
  const comma = url.indexOf(',');
  if (comma < 0 || !url.startsWith('data:image/png;base64,')) return null;
  try {
    const binary = atob(url.slice(comma + 1));
    const out = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
    return out;
  } catch {
    return null;
  }
}
