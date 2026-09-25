/**
 * A tela de carregamento do boot: barra de progresso, sumir e mostrar o erro
 * quando o jogo não consegue subir. Saiu do `main.ts` em 2026-09-22 (M13).
 */
import { t } from '../core/i18n';

export function progress(value: number, message: string): void {
  const bar = document.getElementById('boot-bar');
  const msg = document.getElementById('boot-msg');
  if (bar !== null) bar.style.width = `${Math.round(value * 100)}%`;
  if (msg !== null) msg.textContent = message;
}

export function hideBootScreen(): void {
  const boot = document.getElementById('boot');
  if (boot === null) return;
  boot.classList.add('hidden');
  setTimeout(() => boot.remove(), 300);
}

export function fail(error: unknown): void {
  const msg = error instanceof Error ? error.message : String(error);
  const boot = document.getElementById('boot');
  if (boot !== null) {
    boot.classList.remove('hidden');
    boot.innerHTML = '';
    const h = document.createElement('h1');
    h.textContent = t('boot.failed');
    const p = document.createElement('p');
    p.textContent = msg;
    boot.append(h, p);
  }
  console.error(error);
}
