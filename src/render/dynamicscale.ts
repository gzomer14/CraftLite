/**
 * Escala dinâmica de resolução (doc 02 §5.7).
 *
 * Se a média móvel do frame time passar de 1,2× o alvo, baixa a escala em 0,1
 * (piso 0,6); se ficar bem abaixo, sobe. Render distance **nunca** é mexido
 * automaticamente: é perceptível demais e o jogador precisa decidir.
 *
 * Duas salvaguardas que não estão no doc mas o teste em celular exigiu:
 *
 * 1. **Ignora frames sob carga de carregamento.** Enquanto há chunk na fila, os
 *    picos de frame time vêm de gerar e subir malha, não do custo de desenhar.
 *    Reagir a eles faz a escala oscilar exatamente enquanto o mundo aparece.
 * 2. **Cooldown entre mudanças.** Trocar a escala realoca o backbuffer, e cada
 *    realocação custa um frame preto. Duas por segundo viram tela piscando.
 * 3. **Teto com recuo exponencial.** O cooldown sozinho não impede o ciclo
 *    "cai, sobe, cai" — só limita a frequência dele, e cada volta do ciclo é
 *    uma piscada. Depois de uma queda a escala anterior fica **proibida** por
 *    um tempo que dobra a cada nova queda: o aparelho que não aguenta 1,0
 *    tenta de novo em 20 s, depois em 40 s, e em poucos minutos desiste e fica
 *    estável. Era esta a causa de o mundo "piscar" parado, a 60 FPS.
 */

const STEP = 0.1;
const MIN_SCALE = 0.6;
const MAX_SCALE = 1;
const FRAMES_TO_DROP = 90;
const FRAMES_TO_RAISE = 240;
/** ms mínimos entre duas mudanças de escala. */
const COOLDOWN_MS = 3000;
/**
 * Folga exigida para **subir**, como fração do alvo.
 *
 * Subir um degrau custa ~20% mais pixels. Com o limiar antigo (0,8 do alvo) o
 * aparelho subia com 20% de folga para gastar 20% a mais — e caía no frame
 * seguinte, para sempre. Em 0,6 a folga cobre o degrau com sobra.
 */
const RAISE_HEADROOM = 0.6;
/** Espera antes de tentar subir de novo depois de uma queda. */
const RECOVERY_MS = 20000;
/** Teto do recuo exponencial: depois disto, para de dobrar. */
const MAX_RECOVERY_MS = 300000;

export class DynamicScale {
  private readonly targetMs: number;
  private slowFrames = 0;
  private fastFrames = 0;
  private avgMs: number;
  /** `-Infinity` para a primeira mudança não esperar o cooldown do boot. */
  private lastChangeAt = -Infinity;
  /** Maior escala permitida agora; cai junto com a escala e volta no `probeAt`. */
  private ceiling = MAX_SCALE;
  /** Instante em que o teto pode ser levantado de novo. */
  private probeAt = -Infinity;
  /** Quanto esperar na próxima queda — dobra a cada uma. */
  private recoveryMs = RECOVERY_MS;

  enabled = true;

  constructor(targetFps: number) {
    this.targetMs = 1000 / targetFps;
    this.avgMs = this.targetMs;
  }

  /**
   * Devolve a nova escala, ou `current` se nada muda.
   *
   * `loading` deve ser true enquanto o pipeline de chunks ainda tem trabalho:
   * nesse período a medição é descartada.
   */
  update(frameMs: number, current: number, loading = false): number {
    if (!this.enabled) return current;

    if (loading) {
      // Sob carga de carregamento a medição não representa o custo de render.
      // Zera os contadores para não acumular dívida falsa.
      this.slowFrames = 0;
      this.fastFrames = 0;
      this.avgMs = this.targetMs;
      return current;
    }

    // Média móvel exponencial: barata e sem histórico para alocar.
    this.avgMs += (frameMs - this.avgMs) * 0.1;

    const now = performance.now();
    const cooling = now - this.lastChangeAt < COOLDOWN_MS;
    // Passou o tempo de castigo: pode tentar subir de novo.
    if (now >= this.probeAt) this.ceiling = MAX_SCALE;

    if (this.avgMs > this.targetMs * 1.2) {
      this.fastFrames = 0;
      this.slowFrames++;
      if (this.slowFrames >= FRAMES_TO_DROP && current > MIN_SCALE && !cooling) {
        this.slowFrames = 0;
        this.lastChangeAt = now;
        const next = Math.max(MIN_SCALE, current - STEP);
        this.ceiling = next;
        this.probeAt = now + this.recoveryMs;
        this.recoveryMs = Math.min(MAX_RECOVERY_MS, this.recoveryMs * 2);
        return next;
      }
    } else if (this.avgMs < this.targetMs * RAISE_HEADROOM) {
      this.slowFrames = 0;
      this.fastFrames++;
      const allowed = Math.min(MAX_SCALE, this.ceiling);
      if (this.fastFrames >= FRAMES_TO_RAISE && current < allowed && !cooling) {
        this.fastFrames = 0;
        this.lastChangeAt = now;
        return Math.min(allowed, current + STEP);
      }
    } else {
      this.slowFrames = 0;
      this.fastFrames = 0;
    }
    return current;
  }
}
