/**
 * Áudio procedural (doc 10).
 *
 * Node não tem WebAudio, então há duas frentes aqui: a **tabela de receitas**,
 * que é dado puro, e a **montagem do grafo**, verificada contra um contexto
 * falso mínimo. O falso pega justamente o erro que mais dói — receita que
 * referencia um nó ou uma propriedade que não existe — sem precisar de
 * navegador.
 */
import { describe, expect, it, vi } from 'vitest';
import { SOUNDS, blockSound, buildGraph, durationOf, noiseBuffer } from '../src/audio/synth';
import { AudioEngine, SUBTITLES } from '../src/audio/engine';
import { Music } from '../src/audio/music';
import { MOBS } from '../src/data/mobs';

/** Contexto de áudio falso: conta nós criados e ligações feitas. */
function fakeContext() {
  const created: string[] = [];
  const connections: number[] = [];
  const param = () => ({
    value: 0,
    setValueAtTime: vi.fn(),
    linearRampToValueAtTime: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
  });
  const node = (kind: string) => {
    created.push(kind);
    return {
      connect: () => { connections.push(1); },
      disconnect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn(),
      frequency: param(),
      detune: param(),
      gain: param(),
      Q: param(),
      playbackRate: param(),
      type: '',
      buffer: null as unknown,
    };
  };
  return {
    created,
    connections,
    sampleRate: 22050,
    currentTime: 0,
    destination: { kind: 'destination' },
    createGain: () => node('gain'),
    createOscillator: () => node('oscillator'),
    createBiquadFilter: () => node('filter'),
    createBufferSource: () => node('source'),
    createBuffer: (_channels: number, length: number) => {
      // O mesmo array em toda chamada: o gerador de ruído escreve nele e o
      // teste lê depois — devolver um novo apagaria o que foi escrito.
      const data = new Float32Array(length);
      return { length, duration: length / 22050, getChannelData: () => data };
    },
  };
}

describe('tabela de sons', () => {
  it('cada mob tem ambiente, ataque, dano e morte', () => {
    for (const mob of MOBS) {
      for (const kind of ['ambient', 'attack', 'hurt', 'death']) {
        expect(SOUNDS[`mob/${mob.sound}_${kind}`], `${mob.name} ${kind}`).toBeDefined();
      }
    }
  });

  it('nenhum som é longo demais para caber na memória do T0', () => {
    for (const name of Object.keys(SOUNDS)) {
      const duration = durationOf(SOUNDS[name]);
      expect(duration, name).toBeGreaterThan(0.01);
      // 1,5 s a 22 kHz mono = ~130 KB. Acima disso é sample, não efeito.
      expect(duration, name).toBeLessThanOrEqual(1.5);
    }
  });

  it('o total renderizado cabe em ~1 MB (doc 10 §2)', () => {
    let samples = 0;
    for (const name of Object.keys(SOUNDS)) samples += durationOf(SOUNDS[name]) * 22050;
    const megabytes = (samples * 4) / (1024 * 1024);
    expect(megabytes).toBeLessThan(4);
  });

  it('os passos e as quebras cobrem todos os materiais de bloco', () => {
    for (const kind of ['stone', 'wood', 'gravel', 'grass', 'sand', 'glass', 'metal', 'cloth', 'snow']) {
      expect(SOUNDS[blockSound(kind, 'step')], kind).toBeDefined();
      expect(SOUNDS[blockSound(kind, 'break')], kind).toBeDefined();
      expect(SOUNDS[blockSound(kind, 'place')], kind).toBeDefined();
    }
  });

  it('material desconhecido cai na pedra em vez de sumir', () => {
    expect(blockSound('adamantium', 'step')).toBe('step/stone');
    expect(blockSound('adamantium', 'break')).toBe('break/stone');
  });

  it('toda legenda aponta para um som que existe', () => {
    for (const name of Object.keys(SUBTITLES)) {
      expect(SOUNDS[name], name).toBeDefined();
    }
  });
});

describe('montagem do grafo', () => {
  it('toda receita monta sem erro e liga alguma coisa ao destino', () => {
    for (const name of Object.keys(SOUNDS)) {
      const ctx = fakeContext();
      expect(() => buildGraph(ctx as unknown as BaseAudioContext, SOUNDS[name]), name).not.toThrow();
      expect(ctx.connections.length, name).toBeGreaterThan(0);
      expect(ctx.created.length, name).toBeGreaterThan(0);
    }
  });

  it('a voz de mob usa dois osciladores desafinados', () => {
    const ctx = fakeContext();
    buildGraph(ctx as unknown as BaseAudioContext, SOUNDS['mob/zombie_ambient']);
    const oscillators = ctx.created.filter((k) => k === 'oscillator').length;
    // Dois da voz, mais um do vibrato do zumbi.
    expect(oscillators).toBeGreaterThanOrEqual(2);
  });

  it('ruído rosa e marrom saem com energia, não zerados', () => {
    const ctx = fakeContext() as unknown as BaseAudioContext;
    for (const color of ['white', 'pink', 'brown'] as const) {
      const buffer = noiseBuffer(ctx, 0.05, color);
      const data = buffer.getChannelData(0);
      let energy = 0;
      for (let i = 0; i < data.length; i++) energy += Math.abs(data[i]);
      expect(energy / data.length, color).toBeGreaterThan(0.001);
    }
  });
});

describe('motor sem WebAudio', () => {
  it('não quebra nem finge estar ligado', async () => {
    const engine = new AudioEngine();
    await engine.start();
    expect(engine.enabled).toBe(false);
    expect(engine.loadedSounds).toBe(0);

    // Todas as chamadas do jogo continuam seguras.
    expect(() => engine.play('break/stone', 0, 0, 0)).not.toThrow();
    expect(() => engine.playUi('ui/click')).not.toThrow();
    expect(() => engine.setListener(1, 2, 3, 0)).not.toThrow();
    expect(() => engine.setVolume('master', 0.5)).not.toThrow();
    expect(() => engine.suspend()).not.toThrow();
  });

  it('não emite legenda sem som tocando', () => {
    const engine = new AudioEngine();
    const seen: string[] = [];
    engine.subtitlesEnabled = true;
    engine.onSubtitle = (text) => seen.push(text);
    engine.play('mob/zombie_ambient', 0, 0, 0);
    expect(seen).toEqual([]);
  });
});

describe('música procedural', () => {
  it('sem contexto o tick é inócuo', () => {
    const music = new Music(null, null);
    expect(() => { for (let i = 0; i < 1000; i++) music.tick(); }).not.toThrow();
  });

  it('toca notas em bloco e depois descansa', () => {
    const ctx = fakeContext();
    const target = { connect: vi.fn(), disconnect: vi.fn() };
    const music = new Music(
      ctx as unknown as BaseAudioContext, target as unknown as AudioNode,
    );

    // 20 minutos de tick: tem que haver nota, e o número tem que ser modesto.
    for (let i = 0; i < 20 * 60 * 20; i++) music.tick();
    const oscillators = ctx.created.filter((k) => k === 'oscillator').length;
    expect(oscillators).toBeGreaterThan(0);
    expect(oscillators).toBeLessThan(400);
  });

  it('combate cala a música por minutos', () => {
    const ctx = fakeContext();
    const target = { connect: vi.fn(), disconnect: vi.fn() };
    const music = new Music(
      ctx as unknown as BaseAudioContext, target as unknown as AudioNode,
    );
    for (let i = 0; i < 60 * 20; i++) music.tick();
    const before = ctx.created.length;
    music.stop();
    for (let i = 0; i < 60 * 20; i++) music.tick();
    expect(ctx.created.length).toBe(before);
  });

  it('desligada não toca nada', () => {
    const ctx = fakeContext();
    const target = { connect: vi.fn(), disconnect: vi.fn() };
    const music = new Music(
      ctx as unknown as BaseAudioContext, target as unknown as AudioNode,
    );
    music.enabled = false;
    for (let i = 0; i < 20 * 60 * 20; i++) music.tick();
    expect(ctx.created.length).toBe(0);
  });
});
