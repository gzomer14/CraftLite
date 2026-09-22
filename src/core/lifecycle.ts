/**
 * O jogo diante da página: contexto GL perdido, janela redimensionada, aba
 * escondida, página fechando (doc 10 §5, doc 11 §3).
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

export interface LifecycleDeps {
  canvas: HTMLCanvasElement;
  loop: { start(): void; stop(): void };
  resize(): void;
  /** Solta teclas e botões presos: perder o foco não pode deixar o jogador andando. */
  resetInput(): void;
  audio: { suspend(): void; resume(): void };
  save: { writeEmergency(): void; saveAll(): Promise<void> } | null;
}

export function attachLifecycle(d: LifecycleDeps): void {
  d.canvas.addEventListener('webglcontextlost', (e) => {
    e.preventDefault();
    d.loop.stop();
  });
  d.canvas.addEventListener('webglcontextrestored', () => location.reload());

  window.addEventListener('resize', () => d.resize(), { passive: true });
  window.addEventListener('blur', () => d.resetInput());
  document.addEventListener('visibilitychange', () => {
    // Suspender o áudio ao perder o foco é regra do doc 10 §5.
    if (!document.hidden) {
      d.loop.start();
      d.audio.resume();
      return;
    }
    d.resetInput();
    d.loop.stop();
    d.audio.suspend();
    /*
     * Esconder a aba é o **único** aviso confiável no celular.
     *
     * `beforeunload` não dispara ao trocar de app ou fechar o navegador no
     * Android: quem dispara é isto. Sem gravar aqui, sair do jogo pelo botão de
     * início do aparelho perdia tudo desde o último autosave.
     *
     * A rede de segurança síncrona vai primeiro, porque ela **sempre** termina;
     * o save completo é assíncrono e pode ser interrompido.
     */
    d.save?.writeEmergency();
    void d.save?.saveAll();
  });

  // Rede de segurança do doc 11 §3: `beforeunload` não espera o IndexedDB, mas
  // o `localStorage` grava na hora.
  window.addEventListener('beforeunload', () => d.save?.writeEmergency());
}
