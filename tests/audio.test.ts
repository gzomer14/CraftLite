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
import { SOUNDS, blockSound, buildGraph, durationOf, rateFor, noiseBuffer } from '../src/audio/synth';
import { AudioEngine, MIN_GUARANTEED_RATE, SUBTITLES, renderAtRate } from '../src/audio/engine';
import { Music } from '../src/audio/music';
import { MOBS } from '../src/data/mobs';
import { BUSES, BUS_LABELS, BUS_SETTING, busFor } from '../src/data/soundbuses';

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
      const recipe = SOUNDS[name];
      const duration = durationOf(recipe);
      expect(duration, name).toBeGreaterThan(0.01);
      /*
       * 1,5 s a 22 kHz mono = ~130 KB. Acima disso é sample, não efeito.
       *
       * Som **sustentado** é a exceção declarada: ele é tocado em `loop`, então
       * o buffer é o ciclo inteiro e não a duração do efeito. A chuva precisa
       * de segundos de ruído para a volta não virar um "chhh… chhh…"; o teto
       * dela é o dobro, e nada além do loop pode usá-lo.
       */
      const ceiling = recipe.kind === 'noise' && recipe.sustain === true ? 3 : 1.5;
      expect(duration, name).toBeLessThanOrEqual(ceiling);
    }
  });

  it('o total renderizado cabe em ~1 MB (doc 10 §2)', () => {
    let bytes = 0;
    for (const name of Object.keys(SOUNDS)) {
      const recipe = SOUNDS[name];
      // Cada som é renderizado na taxa que a própria receita pede, não a 22 kHz
      // fixos: é o que `AudioEngine.renderAll` faz.
      bytes += durationOf(recipe) * rateFor(recipe, 22050) * 4;
    }
    /*
     * O doc 10 §2 estimou ~1 MB para a tabela do M0; ela cresceu para 48 sons
     * e o teto praticado virou 4 MB, que é o que estava aqui.
     *
     * A taxa por receita (`rateFor`) derrubou a conta de **3,95 para 3,26 MB**
     * *acrescentando* três sons novos — morcego, trovão e o loop de chuva. O
     * teto desce junto: 3,5 MB deixa margem para alguns sons, não para
     * esquecer que existe um orçamento.
     *
     * No M14 a conta chegou a 3,497 MB. O degrau de um quarto da taxa (M15)
     * a trouxe para 3,14 sem tirar som nenhum.
     */
    expect(bytes / (1024 * 1024)).toBeLessThan(3.5);
  });

  it('a taxa por receita nunca corta banda que o som usa', () => {
    // Ruído com highpass e estalo agudo têm energia até o topo: eles não podem
    // cair para metade da taxa, ou o chocalho do esqueleto perde o brilho.
    // Passo na areia: lowpass em 600 Hz, cabe em um quarto da taxa (M15).
    expect(rateFor(SOUNDS['step/sand'], 22050)).toBe(5513);
    expect(rateFor(SOUNDS['break/snow'], 22050)).toBe(22050);
    expect(rateFor(SOUNDS['break/glass'], 22050)).toBe(22050);
    // A chuva passa **raspando** do outro lado: o lowpass dela está em 4 kHz e
    // a folga de 1,4 pede 5,6 kHz, contra os 5,5 que meia taxa cobre. Fica em
    // 22 kHz de propósito — encolher a folga para ganhar 88 KB comeria a saia
    // do filtro de todo mundo.
    expect(rateFor(SOUNDS['weather/rain'], 22050)).toBe(22050);
  });

  it('taxa recusada pelo navegador cai para 8 kHz, e o som não fica mudo', async () => {
    const rates: number[] = [];
    class StrictOffline {
      constructor(_channels: number, _length: number, readonly sampleRate: number) {
        rates.push(sampleRate);
        if (sampleRate < MIN_GUARANTEED_RATE) throw new Error('NotSupportedError');
      }
      get destination() { return {}; }
      createBufferSource() { return { connect: () => {}, start: () => {}, buffer: null }; }
      createBiquadFilter() { return { connect: () => {}, type: '', frequency: { value: 0, setValueAtTime() {}, exponentialRampToValueAtTime() {} }, Q: { value: 0 } }; }
      createGain() { return { connect: () => {}, gain: { value: 0, setValueAtTime() {}, linearRampToValueAtTime() {}, exponentialRampToValueAtTime() {} } }; }
      createBuffer(_c: number, length: number, rate: number) { return { getChannelData: () => new Float32Array(length), sampleRate: rate }; }
      startRendering() { return Promise.resolve({ sampleRate: this.sampleRate }); }
    }
    const scope = globalThis as unknown as { OfflineAudioContext?: unknown };
    const before = scope.OfflineAudioContext;
    scope.OfflineAudioContext = StrictOffline;
    try {
      const buffer = await renderAtRate(SOUNDS['weather/thunder'], 5513);
      expect(buffer).not.toBeNull();
      expect(rates).toEqual([5513, MIN_GUARANTEED_RATE]);
    } finally {
      scope.OfflineAudioContext = before;
    }
  });

  it('o grave cai para um quarto da taxa, sem cortar banda (M15)', () => {
    // Trovão com lowpass de 400 Hz e o mugido com formantes até 900 Hz:
    // 5,5 kHz sobram.
    expect(rateFor(SOUNDS['weather/thunder'], 22050)).toBe(5513);
    expect(rateFor(SOUNDS['mob/cow_death'], 22050)).toBe(5513);
    // A lula é senoide, mas com ruído rosa sem filtro: continua cheia.
    expect(rateFor(SOUNDS['mob/squid_death'], 22050)).toBe(22050);
    // Toda receita em um quarto tem a banda (com a folga) abaixo do Nyquist dele.
    for (const name of Object.keys(SOUNDS)) {
      const recipe = SOUNDS[name];
      if (rateFor(recipe, 22050) !== 5513) continue;
      expect(recipe.kind, name).not.toBe('clicks');
      if (recipe.kind === 'noise') expect(recipe.filter, name).toBe('lowpass');
    }
    // Serra sem formante continua cheia: os harmônicos não têm teto.
    expect(rateFor(SOUNDS['player/death'], 22050)).toBe(22050);
  });

  it('todo som cai num barramento, e os de mob no lado certo', () => {
    // Nada pode cair fora dos nove sliders do doc 08 §3.11.
    for (const name of Object.keys(SOUNDS)) {
      expect(BUSES, name).toContain(busFor(name));
    }
    expect(busFor('mob/zombie_ambient')).toBe('hostile');
    expect(busFor('mob/creeper_attack')).toBe('hostile');
    expect(busFor('mob/cow_ambient')).toBe('friendly');
    // Lobo e enderman são neutros: são da casa, não da caverna.
    expect(busFor('mob/wolf_hurt')).toBe('friendly');
    expect(busFor('mob/enderman_teleport')).toBe('friendly');
    expect(busFor('step/grass')).toBe('block');
    expect(busFor('break/stone')).toBe('block');
    expect(busFor('player/levelup')).toBe('player');
    expect(busFor('ui/click')).toBe('ui');
    expect(busFor('weather/rain')).toBe('weather');
    // Fornalha e portal tocam sozinhos: são ambiente, não bloco.
    expect(busFor('block/furnace')).toBe('ambient');
    expect(busFor('block/portal')).toBe('ambient');
    expect(busFor('block/door')).toBe('block');
  });

  it('cada barramento tem um slider e um rótulo', () => {
    for (const bus of BUSES) {
      expect(BUS_SETTING[bus], bus).toBeDefined();
      expect(BUS_LABELS[bus], bus).toBeTruthy();
    }
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
