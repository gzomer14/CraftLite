/**
 * Loop principal: timestep fixo de 20 Hz para simulação + render livre por rAF
 * com interpolação (`alpha`). Ver doc 01 §6.
 *
 * Nada aqui aloca por frame: os tempos vão para campos numéricos e o
 * histórico de frame time vive em um Float32Array circular.
 */

export const TICK_HZ = 20;
export const TICK_MS = 1000 / TICK_HZ; // 50 ms
const MAX_CATCHUP = 5; // evita espiral da morte após uma pausa longa
const MAX_FRAME_MS = 250;
export const FRAME_HISTORY = 120;

export interface LoopStats {
  /** Frames por segundo (média móvel de 1 s). */
  fps: number;
  /** Duração do último frame completo, em ms. */
  frameMs: number;
  /** Tempo gasto nos ticks deste frame. */
  tickMs: number;
  /** Tempo gasto no render deste frame. */
  renderMs: number;
  /** Tempo gasto aplicando trabalho assíncrono (upload de mesh). */
  pumpMs: number;
  /** Contador total de ticks simulados. */
  tick: number;
  /** Últimos 120 frame times, em ordem circular. */
  history: Float32Array;
  historyIndex: number;
}

export interface LoopCallbacks {
  /** Simulação em passo fixo. */
  tick(tick: number): void;
  /** Trabalho assíncrono com orçamento em ms (upload de VBO etc). */
  pump(budgetMs: number): void;
  /** Desenho, com `alpha` = fração do tick atual já decorrida. */
  render(alpha: number): void;
}

export class GameLoop {
  readonly stats: LoopStats = {
    fps: 0,
    frameMs: 0,
    tickMs: 0,
    renderMs: 0,
    pumpMs: 0,
    tick: 0,
    history: new Float32Array(FRAME_HISTORY),
    historyIndex: 0,
  };

  /** Orçamento em ms para aplicar meshes prontos (doc 02 §2). */
  pumpBudgetMs = 2;

  /**
   * Teto de quadros por segundo. `0` = sem teto.
   *
   * O `requestAnimationFrame` acompanha a **taxa de atualização do display**,
   * não 60 Hz: num celular de 120 Hz o jogo desenha 120 vezes por segundo. Como
   * a simulação roda a 20 Hz com interpolação, o ganho acima de 60 é pequeno e
   * o custo em bateria e temperatura não é. Quem quiser os 120 desliga o teto.
   */
  maxFps = 0;

  private running = false;
  private rafId = 0;
  private last = 0;
  private acc = 0;
  private fpsFrames = 0;
  private fpsSince = 0;
  private lastRender = 0;
  private readonly cb: LoopCallbacks;
  private readonly frame: (now: number) => void;

  constructor(cb: LoopCallbacks) {
    this.cb = cb;
    // Bind uma única vez — passar `this.frame` para rAF não deve alocar.
    this.frame = (now: number) => this.step(now);
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.last = performance.now();
    this.fpsSince = this.last;
    this.acc = 0;
    this.rafId = requestAnimationFrame(this.frame);
  }

  stop(): void {
    this.running = false;
    if (this.rafId !== 0) cancelAnimationFrame(this.rafId);
    this.rafId = 0;
  }

  private step(now: number): void {
    if (!this.running) return;
    this.rafId = requestAnimationFrame(this.frame);

    const s = this.stats;

    // Teto de FPS: devolve o quadro ao navegador sem desenhar. Os ticks
    // continuam no ritmo certo porque o acumulador não é tocado aqui.
    if (this.maxFps > 0) {
      const minInterval = 1000 / this.maxFps;
      // Meio milissegundo de folga evita perder um quadro por arredondamento
      // quando o intervalo do display bate quase exato com o teto.
      if (now - this.lastRender < minInterval - 0.5) return;
    }
    this.lastRender = now;

    const dt = Math.min(now - this.last, MAX_FRAME_MS);
    this.last = now;
    this.acc += dt;

    const tickStart = performance.now();
    let steps = 0;
    while (this.acc >= TICK_MS && steps < MAX_CATCHUP) {
      this.cb.tick(s.tick);
      s.tick++;
      this.acc -= TICK_MS;
      steps++;
    }
    // Estourou o catch-up: descarta o resto em vez de acumular dívida.
    if (this.acc >= TICK_MS) this.acc = 0;
    const tickEnd = performance.now();

    this.cb.pump(this.pumpBudgetMs);
    const pumpEnd = performance.now();

    this.cb.render(this.acc / TICK_MS);
    const renderEnd = performance.now();

    s.tickMs = tickEnd - tickStart;
    s.pumpMs = pumpEnd - tickEnd;
    s.renderMs = renderEnd - pumpEnd;
    s.frameMs = dt;
    s.history[s.historyIndex] = dt;
    s.historyIndex = (s.historyIndex + 1) % FRAME_HISTORY;

    this.fpsFrames++;
    if (now - this.fpsSince >= 1000) {
      s.fps = (this.fpsFrames * 1000) / (now - this.fpsSince);
      this.fpsFrames = 0;
      this.fpsSince = now;
    }
  }
}
