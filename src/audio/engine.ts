/**
 * Motor de áudio (doc 10 §1 e §5).
 *
 * Três regras que mandam no desenho:
 *
 * 1. **`AudioContext` só depois do primeiro gesto** — política de autoplay. Até
 *    lá, tudo que for pedido é descartado em silêncio, sem enfileirar nada.
 * 2. **Nada de `AudioBuffer` no loop** — os buffers são renderizados uma vez,
 *    fora do frame, com `OfflineAudioContext`.
 * 3. **Pool de vozes** (16, ou 8 em T0). Estourou, rouba a mais antiga; o caro
 *    é o `PannerNode`, então eles são reusados em vez de recriados.
 */

import { SOUNDS, buildGraph, durationOf, rateFor, type Recipe } from './synth';
import { BUSES, busFor, type Bus } from '../data/soundbuses';

export type { Bus };

/** Alcance de um som posicional, em blocos (doc 10 §1). */
const MAX_DISTANCE = 16;
/** Variação aleatória de pitch e volume a cada disparo (doc 10 §1). */
const PITCH_JITTER = 0.1;
const GAIN_JITTER = 0.1;

interface Voice {
  panner: PannerNode;
  gain: GainNode;
  source: AudioBufferSourceNode | null;
  startedAt: number;
}

export interface AudioOptions {
  /** Vozes simultâneas. T0 usa 8 (doc 10 §5). */
  voices?: number;
  /** Taxa de amostragem do render offline; 22050 corta o custo pela metade. */
  sampleRate?: number;
  /**
   * Amostras do resource pack do jogador (`render/pack.ts`), por nome de som.
   *
   * Elas **desviam** da receita em vez de substituí-la: quem tem uma amostra é
   * decodificado pelo navegador, quem não tem continua sendo sintetizado. Um
   * arquivo que o navegador não sabe ler cai de volta na receita, porque
   * ficar sem o som seria pior que ignorar a escolha do jogador.
   */
  soundOverrides?: ReadonlyMap<string, Uint8Array>;
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private readonly busGains = new Map<Bus, GainNode>();
  private readonly buffers = new Map<string, AudioBuffer>();
  private readonly voices: Voice[] = [];
  private readonly voiceCount: number;
  private readonly sampleRate: number;
  private nextVoice = 0;
  private ready = false;
  private starting = false;

  /** Volumes 0..1, aplicados assim que o contexto existir. */
  private readonly volumes: Record<Bus | 'master', number> = {
    master: 1, block: 1, hostile: 1, friendly: 1, player: 1, ambient: 1,
    weather: 1, ui: 1, music: 0.6,
  };

  /**
   * Sons em loop (chuva), por nome. Um `AudioBufferSourceNode` com
   * `loop = true` por som, criado uma vez e mantido tocando — o ganho é que
   * sobe e desce. Recriar a fonte a cada mudança de intensidade daria um
   * estalo a cada tick de clima.
   */
  private readonly loops = new Map<string, { source: AudioBufferSourceNode; gain: GainNode }>();

  /** Legendas de som (doc 10 §4): `(texto, direção)`. */
  onSubtitle: ((text: string, direction: number) => void) | null = null;
  subtitlesEnabled = false;

  /** Ouvinte, atualizado a cada frame pelo render. */
  private listenerX = 0;
  private listenerY = 0;
  private listenerZ = 0;
  private listenerYaw = 0;

  /** Amostras do pack do jogador, por nome de som. */
  private readonly overrides: ReadonlyMap<string, Uint8Array>;
  /** Quantos sons vieram do pack em vez da síntese — o relatório da tela. */
  private overridden = 0;

  constructor(options: AudioOptions = {}) {
    this.voiceCount = options.voices ?? 16;
    this.sampleRate = options.sampleRate ?? 22050;
    this.overrides = options.soundOverrides ?? new Map();
  }

  /** Sons substituídos pelo pack do jogador. */
  get packSounds(): number {
    return this.overridden;
  }

  get enabled(): boolean {
    return this.ready && this.ctx !== null && this.ctx.state === 'running';
  }

  get loadedSounds(): number {
    return this.buffers.size;
  }

  /**
   * Cria o contexto e renderiza os buffers. Só pode ser chamado de dentro de
   * um gesto do usuário; chamadas repetidas são ignoradas.
   */
  async start(): Promise<void> {
    if (this.ctx !== null || this.starting) {
      await this.ctx?.resume();
      return;
    }
    this.starting = true;
    const Ctor = getAudioContext();
    if (Ctor === null) return;

    try {
      const ctx = new Ctor();
      this.ctx = ctx;
      this.master = ctx.createGain();
      this.master.gain.value = this.volumes.master;
      this.master.connect(ctx.destination);

      for (const bus of BUSES) {
        const gain = ctx.createGain();
        gain.gain.value = this.volumes[bus];
        gain.connect(this.master);
        this.busGains.set(bus, gain);
      }

      this.createVoices(ctx);
      await this.renderAll();
      this.ready = true;
    } catch {
      // Sem áudio o jogo continua: é degradação, não falha.
      this.ctx = null;
    } finally {
      this.starting = false;
    }
  }

  /** Barramento para a música se pendurar. */
  busNode(bus: Bus): GainNode | null {
    return this.busGains.get(bus) ?? null;
  }

  get context(): AudioContext | null {
    return this.ctx;
  }

  setVolume(bus: Bus | 'master', value: number): void {
    const clamped = Math.max(0, Math.min(1, value));
    this.volumes[bus] = clamped;
    if (bus === 'master') {
      if (this.master !== null) this.master.gain.value = clamped;
      return;
    }
    const node = this.busGains.get(bus);
    if (node !== undefined) node.gain.value = clamped;
  }

  /** Posição e direção do ouvinte, do render. */
  setListener(x: number, y: number, z: number, yaw: number): void {
    this.listenerX = x;
    this.listenerY = y;
    this.listenerZ = z;
    this.listenerYaw = yaw;
    const ctx = this.ctx;
    if (ctx === null) return;
    const listener = ctx.listener;
    // `setPosition` é depreciado mas é o único caminho em WebView antigo.
    if (listener.positionX !== undefined) {
      listener.positionX.value = x;
      listener.positionY.value = y;
      listener.positionZ.value = z;
      listener.forwardX.value = Math.sin(yaw);
      listener.forwardZ.value = Math.cos(yaw);
    } else if (typeof listener.setPosition === 'function') {
      listener.setPosition(x, y, z);
      listener.setOrientation(Math.sin(yaw), 0, Math.cos(yaw), 0, 1, 0);
    }
  }

  /** Toca um som posicional. Fora de alcance ou sem contexto: não faz nada. */
  play(name: string, x: number, y: number, z: number, gain = 1, bus?: Bus): void {
    if (!this.enabled) return;
    const target = bus ?? busFor(name);
    const dx = x - this.listenerX;
    const dy = y - this.listenerY;
    const dz = z - this.listenerZ;
    if (dx * dx + dy * dy + dz * dz > MAX_DISTANCE * MAX_DISTANCE * 4) return;
    this.playBuffer(name, gain, target, x, y, z);
    this.emitSubtitle(name, dx, dz);
  }

  /** Toca sem posição — interface, dano no próprio jogador. */
  playUi(name: string, gain = 1, bus?: Bus): void {
    if (!this.enabled) return;
    this.playBuffer(name, gain, bus ?? busFor(name), null, null, null);
  }

  /**
   * Volume de um som em loop, 0..1. Zero silencia sem parar a fonte — parar e
   * recomeçar custaria um estalo e um `AudioBufferSourceNode` novo, que não
   * pode ser reusado depois de `stop()`.
   *
   * A fonte nasce na primeira chamada com volume > 0; antes disso o loop nem
   * existe, então um mundo que nunca chove não paga nada.
   */
  setLoop(name: string, level: number, bus: Bus = 'weather'): void {
    const ctx = this.ctx;
    const clamped = Math.max(0, Math.min(1, level));
    const existing = this.loops.get(name);
    if (existing !== undefined) {
      existing.gain.gain.value = clamped;
      return;
    }
    if (clamped <= 0 || !this.enabled || ctx === null) return;
    const buffer = this.buffers.get(name);
    const target = this.busGains.get(bus);
    if (buffer === undefined || target === undefined) return;

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.loop = true;
    const gain = ctx.createGain();
    gain.gain.value = clamped;
    source.connect(gain);
    gain.connect(target);
    source.start();
    this.loops.set(name, { source, gain });
  }

  private playBuffer(
    name: string, gain: number, bus: Bus,
    x: number | null, y: number | null, z: number | null,
  ): void {
    const ctx = this.ctx;
    const buffer = this.buffers.get(name);
    if (ctx === null || buffer === undefined) return;
    const target = this.busGains.get(bus);
    if (target === undefined) return;

    const voice = this.takeVoice(ctx);
    if (voice.source !== null) {
      try { voice.source.stop(); } catch { /* já parou sozinho */ }
    }

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    // Pitch e volume variam ±10% (doc 10 §1): sem isso a repetição enlouquece.
    source.playbackRate.value = 1 + (Math.random() * 2 - 1) * PITCH_JITTER;
    voice.gain.gain.value = gain * (1 + (Math.random() * 2 - 1) * GAIN_JITTER);

    if (x === null || y === null || z === null) {
      source.connect(voice.gain);
      voice.gain.disconnect();
      voice.gain.connect(target);
    } else {
      setPannerPosition(voice.panner, x, y, z);
      source.connect(voice.panner);
      voice.panner.disconnect();
      voice.panner.connect(voice.gain);
      voice.gain.disconnect();
      voice.gain.connect(target);
    }

    voice.source = source;
    voice.startedAt = ctx.currentTime;
    source.start();
  }

  /** Rouba a voz mais antiga quando o pool estoura (doc 10 §1). */
  private takeVoice(ctx: AudioContext): Voice {
    for (let i = 0; i < this.voices.length; i++) {
      const index = (this.nextVoice + i) % this.voices.length;
      const voice = this.voices[index];
      const buffer = voice.source === null ? null : voice.source.buffer;
      const elapsed = ctx.currentTime - voice.startedAt;
      if (buffer === null || elapsed >= buffer.duration) {
        this.nextVoice = (index + 1) % this.voices.length;
        return voice;
      }
    }
    const oldest = this.voices.reduce((a, b) => (a.startedAt <= b.startedAt ? a : b));
    return oldest;
  }

  private createVoices(ctx: AudioContext): void {
    for (let i = 0; i < this.voiceCount; i++) {
      const panner = ctx.createPanner();
      panner.panningModel = 'equalpower';
      panner.distanceModel = 'linear';
      panner.maxDistance = MAX_DISTANCE;
      panner.refDistance = 1;
      panner.rolloffFactor = 1;
      const gain = ctx.createGain();
      this.voices.push({ panner, gain, source: null, startedAt: -Infinity });
    }
  }

  /** Renderiza todas as receitas, uma por `OfflineAudioContext`. */
  private async renderAll(): Promise<void> {
    const names = Object.keys(SOUNDS);
    for (const name of names) {
      // Cada receita renderiza na taxa de que precisa (`rateFor`): o passo na
      // areia não guarda banda que o próprio lowpass jogou fora. Vale ~28% da
      // memória de áudio, que em T0 é memória de verdade.
      const recipe = SOUNDS[name];
      const sample = await this.decodeOverride(name);
      if (sample !== null) {
        this.buffers.set(name, sample);
        this.overridden++;
        continue;
      }
      const buffer = await renderAtRate(recipe, rateFor(recipe, this.sampleRate));
      if (buffer !== null) this.buffers.set(name, buffer);
    }
  }

  /**
   * Amostra do pack decodificada, ou `null` se não há uma — ou se ela não
   * abriu. Falhar aqui volta para a receita, em silêncio: o jogo não fica mudo
   * porque o `.ogg` do jogador está corrompido.
   */
  private async decodeOverride(name: string): Promise<AudioBuffer | null> {
    const bytes = this.overrides.get(name);
    const ctx = this.ctx;
    if (bytes === undefined || ctx === null) return null;
    try {
      // `slice()` porque `decodeAudioData` **assume a posse** do buffer e o
      // deixa destacado: os bytes originais moram no pack, que continua vivo.
      return await ctx.decodeAudioData(bytes.slice().buffer as ArrayBuffer);
    } catch {
      return null;
    }
  }

  private emitSubtitle(name: string, dx: number, dz: number): void {
    if (!this.subtitlesEnabled || this.onSubtitle === null) return;
    const text = SUBTITLES[name];
    if (text === undefined) return;
    // Direção relativa ao olhar: 0 = à frente, cresce no sentido horário.
    const angle = Math.atan2(dx, dz) - this.listenerYaw;
    this.onSubtitle(text, angle);
  }

  /** Suspende ao perder o foco (doc 10 §5). */
  suspend(): void {
    void this.ctx?.suspend();
  }

  resume(): void {
    void this.ctx?.resume();
  }
}

/**
 * Menor taxa que a especificação do Web Audio **garante** para um contexto
 * (8–96 kHz). O Chrome aceita desde 3 kHz; quem não aceita lança.
 */
export const MIN_GUARANTEED_RATE = 8000;

/**
 * Renderiza na taxa pedida e, se o navegador recusar uma taxa abaixo da
 * garantida (o degrau de um quarto do M15 fica em 5,5 kHz), tenta de novo em
 * 8 kHz — ainda acima do que o som precisa, e nunca um som mudo.
 */
export async function renderAtRate(recipe: Recipe, rate: number): Promise<AudioBuffer | null> {
  const buffer = await renderRecipe(recipe, rate);
  if (buffer !== null || rate >= MIN_GUARANTEED_RATE) return buffer;
  return renderRecipe(recipe, MIN_GUARANTEED_RATE);
}

/** Renderiza uma receita para `AudioBuffer`. Devolve null se não der. */
export async function renderRecipe(
  recipe: Recipe, sampleRate: number,
): Promise<AudioBuffer | null> {
  const Ctor = getOfflineContext();
  if (Ctor === null) return null;
  const duration = Math.max(0.02, durationOf(recipe));
  try {
    const ctx = new Ctor(1, Math.ceil(duration * sampleRate), sampleRate);
    buildGraph(ctx, recipe);
    return await ctx.startRendering();
  } catch {
    return null;
  }
}

function setPannerPosition(panner: PannerNode, x: number, y: number, z: number): void {
  if (panner.positionX !== undefined) {
    panner.positionX.value = x;
    panner.positionY.value = y;
    panner.positionZ.value = z;
  } else {
    panner.setPosition(x, y, z);
  }
}

type AudioContextCtor = new () => AudioContext;
type OfflineContextCtor = new (
  channels: number, length: number, sampleRate: number,
) => OfflineAudioContext;

function getAudioContext(): AudioContextCtor | null {
  const scope = globalThis as unknown as {
    AudioContext?: AudioContextCtor; webkitAudioContext?: AudioContextCtor;
  };
  return scope.AudioContext ?? scope.webkitAudioContext ?? null;
}

function getOfflineContext(): OfflineContextCtor | null {
  const scope = globalThis as unknown as {
    OfflineAudioContext?: OfflineContextCtor; webkitOfflineAudioContext?: OfflineContextCtor;
  };
  return scope.OfflineAudioContext ?? scope.webkitOfflineAudioContext ?? null;
}

/** Legendas de som (doc 10 §4). Só os que importam para jogar sem ouvir. */
export const SUBTITLES: Record<string, string> = {
  'mob/zombie_ambient': 'Zumbi geme',
  'mob/zombie_attack': 'Zumbi ataca',
  'mob/skeleton_ambient': 'Esqueleto chacoalha',
  'mob/skeleton_attack': 'Esqueleto atira',
  'mob/creeper_ambient': 'Creeper se aproxima',
  'mob/creeper_attack': 'Creeper chia',
  'mob/spider_ambient': 'Aranha sibila',
  'mob/enderman_ambient': 'Enderman resmunga',
  'mob/enderman_teleport': 'Enderman teleporta',
  'mob/wolf_ambient': 'Lobo rosna',
  'mob/cow_ambient': 'Vaca muge',
  'mob/pig_ambient': 'Porco grunhe',
  'mob/sheep_ambient': 'Ovelha bale',
  'mob/chicken_ambient': 'Galinha cacareja',
  'mob/slime_ambient': 'Slime pula',
  'mob/villager_ambient': 'Aldeão resmunga',
  'player/explode': 'Explosão',
  'player/hurt': 'Você se machuca',
  'player/arrow': 'Flecha passa',
  'player/levelup': 'Você subiu de nível',
};
