/**
 * Síntese procedural de som (doc 10 §2). Zero bytes baixados.
 *
 * Cada som é uma **receita declarativa** — cinco famílias de grafo cobrem a
 * tabela inteira do doc — e é renderizada uma única vez no boot para um
 * `AudioBuffer` via `OfflineAudioContext`. Depois disso, tocar um som é criar
 * um `AudioBufferSourceNode`, que é barato.
 *
 * As vozes de mob saem de uma tabela de números: uma frequência, um destino de
 * varredura e um par de formantes por bicho geram ambiente, ataque, dano e
 * morte. Escrever 48 grafos à mão custaria KB de bundle sem soar melhor.
 */

/** Tipo de ruído. Rosa e marrom são gerados por integração do branco. */
export type NoiseColor = 'white' | 'pink' | 'brown';

export type Recipe =
  /** Ruído filtrado com envelope — passos, quebrar, chuva, chiado. */
  | {
    kind: 'noise'; duration: number; color: NoiseColor; gain: number;
    attack: number; decay: number;
    filter?: 'lowpass' | 'highpass' | 'bandpass';
    freq?: number; freqTo?: number; q?: number;
    /**
     * Ganho **constante** em vez de envelope, para o buffer poder ser tocado
     * em `loop` sem pulsar. É o que a chuva do doc 10 §2 precisa: um envelope
     * que morre no fim do buffer viraria um "chhh… chhh…" a cada volta.
     *
     * `lfo` acrescenta a ondulação lenta de amplitude que o doc pede — ela é
     * periódica dentro do buffer, então a volta continua costurada.
     */
    sustain?: boolean; lfo?: number;
  }
  /** Um ou mais osciladores com decaimento próprio — vidro, sino, coleta. */
  | {
    kind: 'tones'; duration: number; freqs: readonly number[]; type: OscillatorType;
    gain: number; decay: number; freqTo?: number; spread?: number;
  }
  /** Voz: oscilador com varredura de pitch, vibrato e dois formantes. */
  | {
    kind: 'voice'; duration: number; freq: number; freqTo: number; type: OscillatorType;
    gain: number; vibrato?: number; formants?: readonly [number, number];
    noise?: number;
  }
  /** Sequência de estalos curtos — chocalho do esqueleto, baú, porta. */
  | {
    kind: 'clicks'; count: number; spacing: number; length: number;
    color: NoiseColor; gain: number; filter?: 'highpass' | 'bandpass'; freq: number;
  }
  /** Arpejo de senoides — subir de nível, UI de confirmação. */
  | { kind: 'arpeggio'; notes: readonly number[]; step: number; gain: number; decay: number };

/**
 * Taxa de amostragem suficiente para a receita, a partir de `base`.
 *
 * Renderizar tudo a 22 kHz é desperdício: um passo na areia é ruído com
 * lowpass em 600 Hz, e metade das amostras guarda banda que o filtro já jogou
 * fora. Nyquist diz o que basta — o dobro da maior frequência que a receita
 * pode produzir, com folga para a saia do filtro.
 *
 * É derivado da própria receita, não de uma lista à mão: som novo já nasce com
 * a taxa certa, e mexer num filtro não deixa uma anotação velha para trás.
 */
export function rateFor(recipe: Recipe, base: number): number {
  const top = topFrequencyOf(recipe);
  // Metade da taxa cobre até `base / 4`; a folga de 1,4 evita comer a saia do
  // filtro, que não corta em vertical.
  return top * 1.4 <= base / 4 ? Math.round(base / 2) : base;
}

/** Maior frequência que a receita pode produzir, em Hz. */
function topFrequencyOf(recipe: Recipe): number {
  switch (recipe.kind) {
    case 'noise': {
      // Highpass e bandpass deixam passar a banda alta inteira do ruído.
      if (recipe.filter !== 'lowpass') return Infinity;
      return Math.max(recipe.freq ?? Infinity, recipe.freqTo ?? 0);
    }
    case 'tones':
      return Math.max(...recipe.freqs, recipe.freqTo ?? 0);
    case 'voice': {
      // O oscilador é serra/quadrada: os harmônicos vão muito acima da
      // fundamental, e quem os limita é o formante mais agudo.
      if (recipe.formants === undefined) return Infinity;
      return Math.max(recipe.formants[0], recipe.formants[1]) * 2;
    }
    case 'clicks':
      return recipe.filter === 'bandpass' ? Infinity : Infinity;
    default:
      return Math.max(...recipe.notes) * 4;
  }
}

/** Duração total da receita, em segundos. */
export function durationOf(recipe: Recipe): number {
  if (recipe.kind === 'clicks') return recipe.count * recipe.spacing + recipe.length + 0.05;
  if (recipe.kind === 'arpeggio') return recipe.notes.length * recipe.step + recipe.decay;
  return recipe.duration;
}

/**
 * Monta o grafo da receita num contexto (normalmente `OfflineAudioContext`).
 * Nada aqui toca no `AudioContext` do jogo — isto roda uma vez, no boot.
 */
export function buildGraph(ctx: BaseAudioContext, recipe: Recipe): void {
  switch (recipe.kind) {
    case 'noise': buildNoise(ctx, recipe); break;
    case 'tones': buildTones(ctx, recipe); break;
    case 'voice': buildVoice(ctx, recipe); break;
    case 'clicks': buildClicks(ctx, recipe); break;
    default: buildArpeggio(ctx, recipe); break;
  }
}

function buildNoise(ctx: BaseAudioContext, r: Extract<Recipe, { kind: 'noise' }>): void {
  const source = ctx.createBufferSource();
  source.buffer = noiseBuffer(ctx, r.duration, r.color);
  let node: AudioNode = source;

  if (r.filter !== undefined) {
    const filter = ctx.createBiquadFilter();
    filter.type = r.filter;
    filter.frequency.value = r.freq ?? 1000;
    filter.Q.value = r.q ?? 1;
    if (r.freqTo !== undefined) {
      filter.frequency.setValueAtTime(r.freq ?? 1000, 0);
      filter.frequency.exponentialRampToValueAtTime(Math.max(20, r.freqTo), r.duration);
    }
    source.connect(filter);
    node = filter;
  }

  const gain = r.sustain === true
    ? sustained(ctx, r.gain, r.lfo ?? 0, r.duration)
    : envelope(ctx, r.gain, r.attack, r.decay, r.duration);
  node.connect(gain);
  gain.connect(ctx.destination);
  source.start(0);
}

/**
 * Ganho constante com ondulação opcional, para som de loop.
 *
 * A ondulação é escrita como rampas dentro do buffer em vez de um
 * `OscillatorNode` de LFO porque o buffer precisa **fechar** no mesmo valor em
 * que abriu — um LFO livre pararia em fase qualquer e daria um degrau na volta.
 */
function sustained(
  ctx: BaseAudioContext, peak: number, lfo: number, duration: number,
): GainNode {
  const gain = ctx.createGain();
  if (lfo <= 0) {
    gain.gain.value = peak;
    return gain;
  }
  const steps = 16;
  for (let i = 0; i <= steps; i++) {
    const t = (i / steps) * duration;
    const wave = Math.sin((i / steps) * Math.PI * 2);
    gain.gain.linearRampToValueAtTime(peak * (1 + lfo * wave), t);
  }
  return gain;
}

function buildTones(ctx: BaseAudioContext, r: Extract<Recipe, { kind: 'tones' }>): void {
  for (let i = 0; i < r.freqs.length; i++) {
    const osc = ctx.createOscillator();
    osc.type = r.type;
    const spread = r.spread ?? 0;
    const freq = r.freqs[i] * (1 + (i % 2 === 0 ? spread : -spread));
    osc.frequency.value = freq;
    if (r.freqTo !== undefined) {
      osc.frequency.setValueAtTime(freq, 0);
      osc.frequency.exponentialRampToValueAtTime(Math.max(20, r.freqTo), r.duration);
    }
    // Decaimentos ligeiramente diferentes por parcial: sem isso soa a sirene.
    const decay = r.decay * (0.7 + 0.3 * ((i + 1) / r.freqs.length));
    const gain = envelope(ctx, r.gain / r.freqs.length, 0.002, decay, r.duration);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(0);
    osc.stop(r.duration);
  }
}

function buildVoice(ctx: BaseAudioContext, r: Extract<Recipe, { kind: 'voice' }>): void {
  const gain = envelope(ctx, r.gain, 0.01, r.duration * 0.8, r.duration);
  let sink: AudioNode = gain;

  // Formantes em série: é o que transforma um oscilador em "bicho".
  if (r.formants !== undefined) {
    const a = ctx.createBiquadFilter();
    a.type = 'bandpass';
    a.frequency.value = r.formants[0];
    a.Q.value = 4;
    const b = ctx.createBiquadFilter();
    b.type = 'bandpass';
    b.frequency.value = r.formants[1];
    b.Q.value = 6;
    gain.connect(a);
    a.connect(b);
    b.connect(ctx.destination);
    sink = gain;
  } else {
    gain.connect(ctx.destination);
  }

  // Dois osciladores levemente desafinados dão batimento e "corpo".
  for (let i = 0; i < 2; i++) {
    const osc = ctx.createOscillator();
    osc.type = r.type;
    const detune = i === 0 ? 1 : 1.055;
    osc.frequency.setValueAtTime(r.freq * detune, 0);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, r.freqTo * detune), r.duration);

    if (r.vibrato !== undefined && r.vibrato > 0) {
      const lfo = ctx.createOscillator();
      lfo.frequency.value = 5;
      const depth = ctx.createGain();
      depth.gain.value = r.freq * r.vibrato;
      lfo.connect(depth);
      depth.connect(osc.frequency);
      lfo.start(0);
      lfo.stop(r.duration);
    }

    osc.connect(sink);
    osc.start(0);
    osc.stop(r.duration);
  }

  // Uma pitada de ruído deixa a voz menos sintética.
  if (r.noise !== undefined && r.noise > 0) {
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, r.duration, 'pink');
    const noiseGain = envelope(ctx, r.gain * r.noise, 0.01, r.duration * 0.6, r.duration);
    source.connect(noiseGain);
    noiseGain.connect(ctx.destination);
    source.start(0);
  }
}

function buildClicks(ctx: BaseAudioContext, r: Extract<Recipe, { kind: 'clicks' }>): void {
  for (let i = 0; i < r.count; i++) {
    const at = i * r.spacing;
    const source = ctx.createBufferSource();
    source.buffer = noiseBuffer(ctx, r.length, r.color);
    const filter = ctx.createBiquadFilter();
    filter.type = r.filter ?? 'highpass';
    filter.frequency.value = r.freq * (0.85 + 0.3 * (i / Math.max(1, r.count - 1)));
    filter.Q.value = 1.2;

    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(r.gain, at + 0.002);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + r.length);

    source.connect(filter);
    filter.connect(gain);
    gain.connect(ctx.destination);
    source.start(at);
  }
}

function buildArpeggio(ctx: BaseAudioContext, r: Extract<Recipe, { kind: 'arpeggio' }>): void {
  for (let i = 0; i < r.notes.length; i++) {
    const at = i * r.step;
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.value = r.notes[i];
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(0, at);
    gain.gain.linearRampToValueAtTime(r.gain, at + 0.01);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + r.decay);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(at);
    osc.stop(at + r.decay);
  }
}

/** Envelope ataque/decaimento exponencial, começando em 0. */
function envelope(
  ctx: BaseAudioContext, peak: number, attack: number, decay: number, duration: number,
): GainNode {
  const gain = ctx.createGain();
  const a = Math.max(0.001, attack);
  gain.gain.setValueAtTime(0.0001, 0);
  gain.gain.linearRampToValueAtTime(peak, a);
  gain.gain.exponentialRampToValueAtTime(0.0001, Math.min(duration, a + Math.max(0.01, decay)));
  return gain;
}

/**
 * Buffer de ruído. Rosa e marrom vêm de filtros de um polo sobre o branco —
 * mais barato que somar oitavas e indistinguível no contexto.
 */
export function noiseBuffer(
  ctx: BaseAudioContext, duration: number, color: NoiseColor,
): AudioBuffer {
  const length = Math.max(1, Math.floor(ctx.sampleRate * duration));
  const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
  const data = buffer.getChannelData(0);

  let last = 0;
  let last2 = 0;
  for (let i = 0; i < length; i++) {
    const white = Math.random() * 2 - 1;
    if (color === 'white') {
      data[i] = white;
    } else if (color === 'pink') {
      last = 0.98 * last + 0.02 * white;
      data[i] = (white * 0.4 + last * 3.5);
    } else {
      last = 0.99 * last + 0.01 * white;
      last2 = 0.9 * last2 + 0.1 * last;
      data[i] = last2 * 8;
    }
  }
  return buffer;
}

// ---------------------------------------------------------------------------
// Vozes de mob: uma linha de números por bicho gera os quatro sons dele.
// ---------------------------------------------------------------------------

interface VoiceSpec {
  freq: number;
  type: OscillatorType;
  formants?: readonly [number, number];
  vibrato?: number;
  noise?: number;
}

const MOB_VOICES: Record<string, VoiceSpec> = {
  cow: { freq: 150, type: 'sawtooth', formants: [420, 900], noise: 0.15 },
  pig: { freq: 220, type: 'sawtooth', formants: [640, 1400], noise: 0.2 },
  sheep: { freq: 280, type: 'sawtooth', formants: [800, 1700], vibrato: 0.03, noise: 0.2 },
  chicken: { freq: 620, type: 'square', formants: [1200, 2600], noise: 0.1 },
  squid: { freq: 180, type: 'sine', noise: 0.4 },
  wolf: { freq: 240, type: 'sawtooth', formants: [560, 1100], vibrato: 0.02, noise: 0.25 },
  enderman: { freq: 90, type: 'sawtooth', formants: [300, 1900], vibrato: 0.05, noise: 0.3 },
  spider: { freq: 320, type: 'square', formants: [1500, 3200], noise: 0.5 },
  zombie: { freq: 110, type: 'sawtooth', formants: [340, 700], vibrato: 0.04, noise: 0.2 },
  skeleton: { freq: 340, type: 'triangle', formants: [1800, 3400], noise: 0.6 },
  creeper: { freq: 400, type: 'sawtooth', formants: [2200, 5200], noise: 0.8 },
  slime: { freq: 130, type: 'sine', formants: [300, 620], noise: 0.5 },
  // O "hmmm" do aldeão: fundamental baixa, formante de vogal fechada (M6).
  villager: { freq: 130, type: 'sawtooth', formants: [500, 1100], vibrato: 0.02, noise: 0.12 },
  // O guincho do morcego: curto, muito agudo e quase sem corpo.
  bat: { freq: 900, type: 'triangle', formants: [2400, 4200], vibrato: 0.06, noise: 0.22 },
  // O choro do ghast (M7): agudo, trêmulo e fino — ele é ouvido antes de visto.
  ghast: { freq: 520, type: 'sine', formants: [900, 2100], vibrato: 0.08, noise: 0.18 },
};

/** Variação de cada tipo de vocalização a partir da voz base. */
const VOICE_KINDS: Record<string, {
  freqMul: number; sweep: number; duration: number; gain: number;
}> = {
  ambient: { freqMul: 1, sweep: 0.75, duration: 0.9, gain: 0.5 },
  attack: { freqMul: 1.25, sweep: 0.6, duration: 0.3, gain: 0.7 },
  hurt: { freqMul: 1.4, sweep: 0.5, duration: 0.28, gain: 0.8 },
  death: { freqMul: 0.9, sweep: 0.35, duration: 1.1, gain: 0.8 },
};

/** Sons de bloco e de interface (doc 10 §2). */
const BASE_SOUNDS: Record<string, Recipe> = {
  'step/stone': { kind: 'noise', duration: 0.06, color: 'white', gain: 0.35, attack: 0.002, decay: 0.05, filter: 'bandpass', freq: 800, q: 1.5 },
  'step/grass': { kind: 'noise', duration: 0.08, color: 'white', gain: 0.3, attack: 0.004, decay: 0.07, filter: 'lowpass', freq: 1200 },
  'step/sand': { kind: 'noise', duration: 0.1, color: 'pink', gain: 0.3, attack: 0.004, decay: 0.09, filter: 'lowpass', freq: 600 },
  'step/wood': { kind: 'noise', duration: 0.07, color: 'white', gain: 0.35, attack: 0.002, decay: 0.06, filter: 'bandpass', freq: 500, q: 1.2 },
  'step/gravel': { kind: 'noise', duration: 0.09, color: 'white', gain: 0.32, attack: 0.002, decay: 0.08, filter: 'bandpass', freq: 950, q: 0.9 },
  'step/cloth': { kind: 'noise', duration: 0.09, color: 'pink', gain: 0.22, attack: 0.006, decay: 0.08, filter: 'lowpass', freq: 900 },

  'break/stone': { kind: 'tones', duration: 0.18, freqs: [200, 280, 390], type: 'square', gain: 0.4, decay: 0.14, freqTo: 120 },
  'break/wood': { kind: 'noise', duration: 0.16, color: 'white', gain: 0.45, attack: 0.002, decay: 0.14, filter: 'bandpass', freq: 1500, freqTo: 400, q: 1.4 },
  'break/glass': { kind: 'tones', duration: 0.3, freqs: [2100, 3200, 4300, 5100, 5900, 2700], type: 'sine', gain: 0.35, decay: 0.22, spread: 0.05 },
  'break/gravel': { kind: 'noise', duration: 0.2, color: 'brown', gain: 0.4, attack: 0.002, decay: 0.18, filter: 'lowpass', freq: 1400 },
  'break/cloth': { kind: 'noise', duration: 0.16, color: 'pink', gain: 0.3, attack: 0.004, decay: 0.14, filter: 'lowpass', freq: 800 },
  'break/metal': { kind: 'tones', duration: 0.26, freqs: [520, 780, 1240], type: 'triangle', gain: 0.35, decay: 0.2, freqTo: 300 },
  'break/snow': { kind: 'noise', duration: 0.14, color: 'white', gain: 0.25, attack: 0.004, decay: 0.12, filter: 'highpass', freq: 2200 },

  'place/generic': { kind: 'noise', duration: 0.05, color: 'white', gain: 0.28, attack: 0.002, decay: 0.04, filter: 'bandpass', freq: 700, q: 1 },
  'player/hurt': { kind: 'voice', duration: 0.2, freq: 150, freqTo: 90, type: 'sawtooth', gain: 0.6, noise: 0.2 },
  'player/death': { kind: 'voice', duration: 0.9, freq: 180, freqTo: 60, type: 'sawtooth', gain: 0.7, noise: 0.25 },
  'player/explode': { kind: 'noise', duration: 1.2, color: 'brown', gain: 0.9, attack: 0.005, decay: 1.0, filter: 'lowpass', freq: 800, freqTo: 80 },
  'player/levelup': { kind: 'arpeggio', notes: [523.25, 659.25, 783.99, 1046.5], step: 0.1, gain: 0.3, decay: 0.4 },
  'player/pickup': { kind: 'tones', duration: 0.09, freqs: [900, 1350], type: 'sine', gain: 0.25, decay: 0.07 },
  'player/eat': { kind: 'clicks', count: 3, spacing: 0.07, length: 0.05, color: 'pink', gain: 0.25, filter: 'bandpass', freq: 700 },
  'player/arrow': { kind: 'noise', duration: 0.12, color: 'white', gain: 0.3, attack: 0.002, decay: 0.1, filter: 'highpass', freq: 2600 },
  'player/hit': { kind: 'noise', duration: 0.1, color: 'brown', gain: 0.45, attack: 0.002, decay: 0.08, filter: 'lowpass', freq: 1400 },

  'block/chest': { kind: 'noise', duration: 0.25, color: 'white', gain: 0.3, attack: 0.002, decay: 0.22, filter: 'bandpass', freq: 1200, q: 1.1 },
  'block/door': { kind: 'voice', duration: 0.4, freq: 90, freqTo: 140, type: 'sawtooth', gain: 0.3, noise: 0.4 },
  'block/furnace': { kind: 'noise', duration: 0.8, color: 'brown', gain: 0.18, attack: 0.05, decay: 0.7, filter: 'lowpass', freq: 500 },
  'ui/click': { kind: 'tones', duration: 0.03, freqs: [800], type: 'square', gain: 0.2, decay: 0.028 },
  'ui/sleep': { kind: 'arpeggio', notes: [392, 329.63, 261.63], step: 0.14, gain: 0.22, decay: 0.5 },
  // M6: coletar orbe é um "plim" curto e agudo; encantar é um acorde místico.
  'ui/xp': { kind: 'tones', duration: 0.08, freqs: [1318.5, 1760], type: 'sine', gain: 0.18, decay: 0.07 },
  'ui/enchant': { kind: 'arpeggio', notes: [261.63, 392, 523.25, 659.25], step: 0.09, gain: 0.26, decay: 0.6 },

  'mob/enderman_teleport': { kind: 'tones', duration: 0.3, freqs: [180, 900, 1800], type: 'sine', gain: 0.35, decay: 0.24, freqTo: 3000 },

  // M7: o clique seco de alavanca, botão e placa, e o sopro do pistão.
  'block/click': { kind: 'tones', duration: 0.05, freqs: [1100, 660], type: 'square', gain: 0.25, decay: 0.04 },
  'block/piston': { kind: 'noise', duration: 0.18, color: 'pink', gain: 0.32, attack: 0.004, decay: 0.16, filter: 'bandpass', freq: 420, freqTo: 900, q: 1.2 },
  // O portal acendendo: um sopro grave que sobe, sem nota definida.
  'block/portal': { kind: 'noise', duration: 0.9, color: 'brown', gain: 0.3, attack: 0.06, decay: 0.8, filter: 'lowpass', freq: 240, freqTo: 1400 },
  // Fogo: o estalo de alguma coisa pegando. Curto, para poder repetir sem
  // cansar enquanto o incêndio anda.
  'block/fire': { kind: 'noise', duration: 0.35, color: 'pink', gain: 0.3, attack: 0.004, decay: 0.3, filter: 'bandpass', freq: 1100, freqTo: 480, q: 1.1 },
  // Água virando vapor no Nether: chiado agudo que morre rápido.
  'block/evaporate': { kind: 'noise', duration: 0.35, color: 'white', gain: 0.3, attack: 0.002, decay: 0.32, filter: 'highpass', freq: 2400, freqTo: 5200 },

  /*
   * Chuva (doc 10 §2), o único som de loop do jogo.
   *
   * Dois segundos de ruído branco com lowpass em 4 kHz e uma ondulação lenta de
   * amplitude. Ruído não tem fase, então a emenda do loop é inaudível; a
   * ondulação é que precisa fechar o ciclo dentro do buffer, e fecha.
   *
   * Ele existe porque o slider "Clima" do doc 08 precisa mandar em alguma
   * coisa — e porque a tempestade sem som nenhum nunca passou de um filtro de
   * cor no céu.
   */
  /*
   * Trovão: estouro grave e longo, com a varredura do lowpass fazendo o rolar.
   * É o único som que o jogador ouve **sem nada ter acontecido perto dele**.
   */
  'weather/thunder': { kind: 'noise', duration: 1.4, color: 'brown', gain: 0.55, attack: 0.01, decay: 1.3, filter: 'lowpass', freq: 400, freqTo: 70 },

  'weather/rain': { kind: 'noise', duration: 2, color: 'white', gain: 0.22, attack: 0.05, decay: 0, filter: 'lowpass', freq: 4000, sustain: true, lfo: 0.18 },
};

/** Tabela final: sons de bloco/UI + as quatro vozes de cada mob. */
export const SOUNDS: Record<string, Recipe> = buildSoundTable();

function buildSoundTable(): Record<string, Recipe> {
  const out: Record<string, Recipe> = { ...BASE_SOUNDS };
  for (const name of Object.keys(MOB_VOICES)) {
    const voice = MOB_VOICES[name];
    for (const kind of Object.keys(VOICE_KINDS)) {
      const shape = VOICE_KINDS[kind];
      const freq = voice.freq * shape.freqMul;
      out[`mob/${name}_${kind}`] = {
        kind: 'voice',
        duration: shape.duration,
        freq,
        freqTo: freq * shape.sweep,
        type: voice.type,
        gain: shape.gain,
        ...(voice.formants !== undefined ? { formants: voice.formants } : {}),
        ...(voice.vibrato !== undefined ? { vibrato: voice.vibrato } : {}),
        ...(voice.noise !== undefined ? { noise: voice.noise } : {}),
      };
    }
  }
  return out;
}

/** Nome do som de passo/quebra de um `SoundKind` de bloco (doc 04). */
export function blockSound(kind: string, action: 'step' | 'break' | 'place'): string {
  if (action === 'place') return 'place/generic';
  const mapped = kind === 'glass' ? 'glass'
    : kind === 'wood' ? 'wood'
      : kind === 'sand' ? 'sand'
        : kind === 'gravel' ? 'gravel'
          : kind === 'grass' ? 'grass'
            : kind === 'cloth' ? 'cloth'
              : kind === 'metal' ? 'metal'
                : kind === 'snow' ? 'snow'
                  : 'stone';
  const name = `${action}/${mapped}`;
  return SOUNDS[name] !== undefined ? name : `${action}/stone`;
}
