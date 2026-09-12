/**
 * Registro do service worker e aviso de atualização (doc 11 §7).
 *
 * Registra depois do `load` para não competir com o boot do jogo — o SW só
 * importa a partir da segunda visita, e atrasá-lo melhora o time-to-interactive
 * da primeira, que é o número que o orçamento cobra.
 */

export interface PwaHandle {
  /** true se o jogo está rodando a partir do cache do SW. */
  offlineReady: boolean;
  /** Chamado quando há uma versão nova esperando. */
  onUpdateAvailable: (() => void) | null;
}

export function registerServiceWorker(): PwaHandle {
  const handle: PwaHandle = { offlineReady: false, onUpdateAvailable: null };
  if (!('serviceWorker' in navigator)) return handle;

  /*
   * Nunca em desenvolvimento.
   *
   * O SW usa stale-while-revalidate, então em dev ele serve os módulos antigos
   * do cache e o navegador roda código que já não existe — um sintoma
   * particularmente traiçoeiro, porque o build e os testes passam. Em dev
   * também removemos um SW que tenha ficado registrado de um build anterior.
   */
  if (import.meta.env.DEV) {
    void navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((r) => r.unregister())))
      .then(() => caches.keys())
      .then((keys) => Promise.all(
        keys.filter((k) => k.startsWith('craftlite-')).map((k) => caches.delete(k)),
      ))
      .catch(() => undefined);
    return handle;
  }

  // `file://` e alguns contextos não seguros recusam o registro.
  if (location.protocol !== 'https:' && location.hostname !== 'localhost'
    && location.hostname !== '127.0.0.1') {
    return handle;
  }

  window.addEventListener('load', () => {
    const url = new URL('sw.js', document.baseURI).href;
    void navigator.serviceWorker.register(url, { scope: './' })
      .then((registration) => {
        handle.offlineReady = registration.active !== null;
        registration.addEventListener('updatefound', () => {
          const installing = registration.installing;
          if (installing === null) return;
          installing.addEventListener('statechange', () => {
            // "installed" com um controller ativo significa: versão nova pronta.
            if (installing.state === 'installed' && navigator.serviceWorker.controller !== null) {
              handle.onUpdateAvailable?.();
            }
          });
        });
      })
      .catch(() => {
        // Sem SW o jogo funciona igual, só não abre offline.
      });
  });

  return handle;
}

/** Mostra um toast discreto avisando que há atualização. */
export function showUpdateToast(): void {
  if (document.getElementById('update-toast') !== null) return;
  const toast = document.createElement('div');
  toast.id = 'update-toast';
  toast.setAttribute('role', 'status');
  toast.textContent = 'Atualização disponível — toque para recarregar';
  toast.addEventListener('click', () => location.reload());

  const style = document.createElement('style');
  style.textContent = `#update-toast{position:fixed;left:50%;top:calc(12px + env(safe-area-inset-top,0px));
    transform:translateX(-50%);padding:8px 14px;background:#1c2432;color:#fff;
    border:1px solid #3a4356;border-radius:4px;font:12px/1.3 ui-monospace,monospace;
    z-index:20;cursor:pointer;pointer-events:auto}`;
  document.head.appendChild(style);
  document.body.appendChild(toast);
}
