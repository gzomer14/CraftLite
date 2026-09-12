/**
 * Música ambiente procedural (doc 10 §3).
 *
 * Caminhada aleatória numa pentatônica maior, com viés de volta à tônica. Toca
 * em blocos de 60–120 s e depois cala por vários minutos — a trilha existe para
 * pontuar o silêncio, não para preencher.
 *
 * O contexto varia o clima sem mudar o algoritmo: embaixo da terra as notas
 * ficam graves e espaçadas; de dia, na superfície, mais agudas e próximas. Em
 * combate, silêncio total.
 */

/** Pentatônica maior em C, três oitavas (Hz). */
const SCALE: readonly number[] = buildScale();

/** Segundos de música por bloco. */
const BLOCK_MIN = 60;
const BLOCK_MAX = 120;
/** Segundos de silêncio entre blocos. */
const REST_MIN = 180;
const REST_MAX = 480;
/** Volume base (doc 10 §3). */
const VOLUME = 0.12;

export type MusicMood = 'surface' | 'underground' | 'combat';

export class Music {
  private readonly ctx: BaseAudioContext | null;
  private readonly target: AudioNode | null;
  /** Índice atual na escala — o passeio começa na tônica do meio. */
  private degree = 5;
  /** Segundos restantes do bloco atual; negativo = descansando. */
  private blockLeft = 0;
  private restLeft = randomRange(20, 60);
  private nextNoteIn = 0;
  mood: MusicMood = 'surface';
  enabled = true;

  constructor(ctx: BaseAudioContext | null, target: AudioNode | null) {
    this.ctx = ctx;
    this.target = target;
  }

  /** Chamado a cada tick (20 Hz). Só agenda notas; não aloca por tick. */
  tick(): void {
    if (!this.enabled || this.ctx === null || this.target === null) return;
    const dt = 1 / 20;

    if (this.blockLeft > 0) {
      this.blockLeft -= dt;
      this.nextNoteIn -= dt;
      if (this.nextNoteIn <= 0) {
        this.playPhrase();
        this.nextNoteIn = this.mood === 'underground'
          ? randomRange(7, 12)
          : randomRange(4, 8);
      }
      return;
    }

    this.restLeft -= dt;
    if (this.restLeft <= 0) {
      this.blockLeft = randomRange(BLOCK_MIN, BLOCK_MAX);
      this.restLeft = randomRange(REST_MIN, REST_MAX);
      this.nextNoteIn = 0;
    }
  }

  /** Corta a música na hora — usado quando o combate começa. */
  stop(): void {
    this.blockLeft = 0;
    this.restLeft = Math.max(this.restLeft, randomRange(60, 120));
  }

  /** 1 a 3 notas por frase (doc 10 §3). */
  private playPhrase(): void {
    if (this.mood === 'combat') return;
    const notes = 1 + Math.floor(Math.random() * 3);
    for (let i = 0; i < notes; i++) {
      this.step();
      this.playNote(this.frequency(), i * randomRange(0.4, 1.2));
    }
  }

  /** Passo de −2 a +2 graus, com viés para voltar ao centro da escala. */
  private step(): void {
    const pull = this.degree > 7 ? -1 : this.degree < 3 ? 1 : 0;
    const delta = Math.round((Math.random() * 4 - 2) * 0.7) + pull;
    this.degree = Math.max(0, Math.min(SCALE.length - 1, this.degree + delta));
  }

  private frequency(): number {
    const base = SCALE[this.degree];
    // Embaixo da terra, uma oitava abaixo — é o que muda o clima de graça.
    return this.mood === 'underground' ? base / 2 : base;
  }

  private playNote(freq: number, delay: number): void {
    const ctx = this.ctx;
    const target = this.target;
    if (ctx === null || target === null) return;

    const at = ctx.currentTime + delay;
    const attack = 0.2;
    const release = 2.0;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.linearRampToValueAtTime(VOLUME, at + attack);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + attack + release);
    gain.connect(target);

    // Senoide + triangular uma oitava acima e bem baixa: dá brilho sem bater.
    for (let i = 0; i < 2; i++) {
      const osc = ctx.createOscillator();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.value = i === 0 ? freq : freq * 2;
      const partial = ctx.createGain();
      partial.gain.value = i === 0 ? 1 : 0.22;
      osc.connect(partial);
      partial.connect(gain);
      osc.start(at);
      osc.stop(at + attack + release + 0.1);
    }
  }
}

function buildScale(): number[] {
  // Graus da pentatônica maior em semitons, a partir de C.
  const degrees = [0, 2, 4, 7, 9];
  const out: number[] = [];
  for (let octave = 0; octave < 3; octave++) {
    for (const semitone of degrees) {
      // C3 = 130.81 Hz.
      out.push(130.81 * Math.pow(2, (octave * 12 + semitone) / 12));
    }
  }
  return out;
}

function randomRange(min: number, max: number): number {
  return min + Math.random() * (max - min);
}
