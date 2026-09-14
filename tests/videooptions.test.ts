/**
 * O resto da tabela de Vídeo e de Acessibilidade do doc 08 §3.11 e §6.
 *
 * O que dá para testar sem GL: as opções em si (validação, umbrella), o
 * relâmpago (que é determinístico da seed) e o balanço da câmera (que é
 * matemática pura). Nuvem, névoa e contorno são passes de render e ficam com o
 * teste manual do doc 15 §6.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { SettingsStore } from '../src/game/settings';
import { Weather, weatherOfDay } from '../src/game/weather';
import { Camera } from '../src/render/camera';
import { TICKS_PER_DAY } from '../src/game/daynight';

function stubStorage(): void {
  const data = new Map<string, string>();
  (globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => data.get(k) ?? null,
    setItem: (k: string, v: string) => { data.set(k, v); },
    removeItem: (k: string) => { data.delete(k); },
    clear: () => { data.clear(); },
  };
  (globalThis as { matchMedia?: unknown }).matchMedia = () => ({ matches: false });
}

beforeEach(() => stubStorage());

describe('opções de vídeo', () => {
  it('nasce em automático, que é o preset do tier', () => {
    const s = new SettingsStore();
    expect(s.get('clouds')).toBe('auto');
    expect(s.get('particles')).toBe('auto');
    expect(s.get('simulationDistance')).toBe(0);
    expect(s.get('graphics')).toBe('auto');
    // VSync ligado é o caminho seguro: desligado piscou no S24 Ultra.
    expect(s.get('vsync')).toBe(true);
  });

  it('a umbrella Rápido escreve os controles que ela resume', () => {
    const s = new SettingsStore();
    s.set('graphics', 'fast');
    expect(s.get('clouds')).toBe('off');
    expect(s.get('particles')).toBe('min');
    expect(s.get('fog')).toBe('near');
    expect(s.get('entityShadows')).toBe(false);
    expect(s.get('cameraBob')).toBe(false);
  });

  it('a umbrella Bonito faz o caminho de volta', () => {
    const s = new SettingsStore();
    s.set('graphics', 'fast');
    s.set('graphics', 'fancy');
    expect(s.get('clouds')).toBe('fancy');
    expect(s.get('particles')).toBe('all');
    expect(s.get('fog')).toBe('far');
    expect(s.get('entityShadows')).toBe(true);
  });

  it('o jogador continua podendo mexer num controle depois da umbrella', () => {
    const s = new SettingsStore();
    s.set('graphics', 'fast');
    s.set('clouds', 'fancy');
    expect(s.get('clouds')).toBe('fancy');
    expect(s.get('particles')).toBe('min');
  });

  it('valor de texto inválido no armazenamento é descartado', () => {
    localStorage.setItem('craftlite.settings.v1', JSON.stringify({
      clouds: 'muitas', fog: 'off', colorBlind: 'nenhuma', particles: 'all',
    }));
    const s = new SettingsStore();
    expect(s.get('clouds')).toBe('auto');
    expect(s.get('colorBlind')).toBe('off');
    // O que é válido continua valendo.
    expect(s.get('fog')).toBe('off');
    expect(s.get('particles')).toBe('all');
  });

  it('a distância de simulação respeita a faixa do doc', () => {
    const s = new SettingsStore();
    s.set('simulationDistance', 99);
    expect(s.get('simulationDistance')).toBe(8);
    s.set('simulationDistance', -3);
    expect(s.get('simulationDistance')).toBe(0);
  });
});

describe('relâmpago', () => {
  /**
   * Primeiro dia de tempestade da seed. `weatherOfDay` é pura, então achar o
   * dia não custa varrer tick nenhum — e é o que deixa os testes abaixo
   * percorrerem **um** dia em vez de sessenta.
   */
  function thunderDay(seed: number): number {
    for (let day = 0; day < 200; day++) {
      if (weatherOfDay(seed, day).kind === 'thunder') return day;
    }
    throw new Error('nenhuma tempestade nas 200 primeiras noites desta seed');
  }

  /** Ticks em que o clarão apareceu ao longo de um dia de tempestade. */
  function flashesOf(seed: number): number[] {
    const weather = new Weather();
    weather.setSeed(seed);
    const base = thunderDay(seed) * TICKS_PER_DAY;
    const hits: number[] = [];
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      weather.update(base + t);
      if (weather.flash > 0) hits.push(base + t);
    }
    return hits;
  }

  it('a mesma seed dá exatamente os mesmos raios', () => {
    const a = flashesOf(12345);
    const b = flashesOf(12345);
    expect(a.length).toBeGreaterThan(0);
    expect(a).toEqual(b);
  });

  it('esconder flashes zera o clarão sem tirar a tempestade', () => {
    const weather = new Weather();
    weather.setSeed(12345);
    weather.showFlashes = false;
    const base = thunderDay(12345) * TICKS_PER_DAY;
    let thundered = false;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      weather.update(base + t);
      expect(weather.flash).toBe(0);
      if (weather.isThundering) thundered = true;
    }
    expect(thundered).toBe(true);
  });

  it('avisa quem toca o trovão, uma vez por raio', () => {
    const weather = new Weather();
    weather.setSeed(12345);
    let calls = 0;
    let flashFrames = 0;
    weather.onLightning = () => { calls++; };
    const base = thunderDay(12345) * TICKS_PER_DAY;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      weather.update(base + t);
      if (weather.flash > 0) flashFrames++;
    }
    expect(calls).toBeGreaterThan(0);
    // O clarão dura mais de um tick, então há mais frames de clarão que raios.
    expect(flashFrames).toBeGreaterThan(calls);
  });

  it('não há raio sem tempestade', () => {
    const weather = new Weather();
    weather.setSeed(12345);
    const base = thunderDay(12345) * TICKS_PER_DAY;
    for (let t = 0; t < TICKS_PER_DAY * 2; t++) {
      weather.update(base + t);
      if (weather.flash > 0) expect(weather.isThundering).toBe(true);
    }
  });

  it('dimensão sem céu não tem raio', () => {
    const weather = new Weather();
    weather.setSeed(12345);
    weather.hasSky = false;
    const base = thunderDay(12345) * TICKS_PER_DAY;
    for (let t = 0; t < TICKS_PER_DAY; t++) {
      weather.update(base + t);
      expect(weather.flash).toBe(0);
    }
  });
});

describe('balanço da câmera', () => {
  it('desligado, o olho fica exatamente onde a interpolação o deixou', () => {
    const camera = new Camera();
    camera.prevX = 0; camera.x = 4;
    camera.prevY = 64; camera.y = 64;
    camera.bobStrength = 0;
    camera.bobPhase = 1.3;
    camera.update(0.5, 1.5);
    // A view leva o olho negado na última coluna; conferimos pela posição de
    // render, que é o que o resto do jogo lê.
    expect(camera.renderX).toBeCloseTo(2, 6);
    expect(camera.renderY).toBeCloseTo(64, 6);
  });

  it('ligado, o olho sai do lugar — e volta ao fim do ciclo', () => {
    const camera = new Camera();
    camera.prevY = 64; camera.y = 64;
    camera.bobStrength = 1;

    // Um quarto de ciclo: o deslocamento vertical é máximo.
    camera.bobPhase = Math.PI / 4;
    camera.update(1, 1.5);
    const lifted = eyeYOf(camera);
    expect(lifted).toBeGreaterThan(64);

    // Fase zero: sem deslocamento vertical.
    camera.bobPhase = 0;
    camera.update(1, 1.5);
    expect(eyeYOf(camera)).toBeCloseTo(64, 5);
  });

  it('a intensidade escala o deslocamento', () => {
    const camera = new Camera();
    camera.prevY = 64; camera.y = 64;
    camera.bobPhase = Math.PI / 4;

    camera.bobStrength = 1;
    camera.update(1, 1.5);
    const full = eyeYOf(camera) - 64;

    camera.bobStrength = 0.25;
    camera.update(1, 1.5);
    const quarter = eyeYOf(camera) - 64;

    // `Mat4` é `Float32Array`: cinco casas é o que a precisão simples garante.
    expect(quarter).toBeCloseTo(full * 0.25, 5);
  });
});

/** Altura do olho embutida na matriz de view (a translação da última linha). */
function eyeYOf(camera: Camera): number {
  // `lookYawPitch` monta R * T(-eye); recuperamos eye resolvendo para Y com a
  // coluna da matriz de rotação correspondente.
  const m = camera.view;
  // eye = -Rᵀ * t, com t = (m[12], m[13], m[14]).
  return -(m[1] * m[12] + m[5] * m[13] + m[9] * m[14]);
}
