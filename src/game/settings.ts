/**
 * Opções do jogador, persistidas em `localStorage`.
 *
 * Ficam aqui as que o input e o HUD consultam todo frame. A tela de opções
 * completa (vídeo/som/idioma/acessibilidade) é entregável do M4; este módulo já
 * é a fonte da verdade para ela.
 */

import type { TextureStyleId } from '../data/texturestyle';

const STORAGE_KEY = 'craftlite.settings.v1';

/** Modo de interação por toque (doc 09 §2.2). O A é o padrão. */
export type TouchMode = 'A' | 'B';

/** Umbrella de qualidade do doc 08 §3.11. `auto` segue o preset do tier. */
export type GraphicsMode = 'auto' | 'fast' | 'fancy';
/** Nuvens, partículas e névoa: `auto` segue o preset do tier (doc 02 §1). */
export type CloudsMode = 'auto' | 'off' | 'fast' | 'fancy';
export type ParticlesMode = 'auto' | 'min' | 'reduced' | 'all';
export type FogMode = 'off' | 'near' | 'far';
/** Modo daltônico (doc 08 §6): remapeia a paleta do HUD. */
export type ColorBlindMode = 'off' | 'protanopia' | 'deuteranopia' | 'tritanopia';

export interface Settings {
  /** Radianos por pixel de arraste/movimento do mouse. */
  lookSensitivity: number;
  /** Inverte o eixo vertical da câmera. */
  invertY: boolean;
  touchMode: TouchMode;
  /** ms para um toque parado virar "quebrar" (ajustável por acessibilidade). */
  longPressMs: number;
  /** Escala dos botões de toque, 0.7–1.5. */
  touchButtonScale: number;
  /** Canhoto: espelha as zonas de movimento e câmera. */
  leftHanded: boolean;
  vibration: boolean;
  /** Distância de render; 0 = automática pelo tier. */
  renderDistance: number;
  /**
   * Qualidade forçada: −1 = automática, 0/1/2 = tier (doc 02 §1).
   *
   * A detecção lê quatro números do navegador e erra com frequência — e quando
   * erra não há como o jogador consertar, porque tier define workers, nuvens,
   * partículas e teto de mobs, e nada disso tem controle próprio. O comentário
   * de `core/tier.ts` sempre prometeu que tudo ali podia ser sobrescrito nas
   * opções; esta é a opção.
   */
  quality: number;
  /**
   * Visual das texturas: `classico` é o procedural cru, `nitido` acrescenta
   * relevo, contraste e sprites de item com volume (`data/texturestyle.ts`).
   *
   * Custa **zero em jogo** dos dois lados: o que muda são os pixels gerados no
   * boot. Por isso muda só no próximo carregamento — o atlas já está na GPU e a
   * folha de sprites já virou `background-image` de dezenas de slots.
   */
  textureStyle: TextureStyleId;
  /** Escala de GUI em passos de meio, 0,5–4; 0 = automática pela resolução. */
  guiScale: number;
  dynamicResolution: boolean;
  /** Distância de simulação em chunks; 0 = automática pelo tier (doc 08 §3.11). */
  simulationDistance: number;
  /**
   * VSync (doc 08 §3.11).
   *
   * No navegador não existe "desligar o vsync": quem apresenta o quadro é o
   * compositor. O que existe é `desynchronized`, o atributo de contexto que
   * tira o canvas da sincronia com ele — e é exatamente isso que esta opção
   * liga e desliga. **O padrão é ligado (sincronizado)** porque desligado
   * causou piscada num painel de taxa variável (ver `render/gl.ts`); quem quiser
   * os poucos ms de latência a menos escolhe, sabendo do risco. Vale no próximo
   * carregamento: atributo de contexto só se escolhe ao criar o contexto.
   */
  vsync: boolean;
  /**
   * Umbrella Rápido/Bonito. Escolher um dos dois **reescreve** nuvens,
   * partículas, névoa e sombras de uma vez — é um botão só para quem não quer
   * mexer em seis. Depois disso os controles individuais continuam valendo.
   */
  graphics: GraphicsMode;
  clouds: CloudsMode;
  particles: ParticlesMode;
  fog: FogMode;
  /**
   * Iluminação suave (AO) no mesh (doc 08 §3.11).
   *
   * Vale no próximo carregamento: o AO entra nos vértices quando a section é
   * meshada, e trocá-lo ao vivo significa remesar o mundo todo. Desligado o
   * mesh também **encolhe**, porque o merge greedy deixa de quebrar nas bordas.
   */
  smoothLighting: boolean;
  /** Balanço da câmera ao andar (doc 08 §3.11 e §6). */
  cameraBob: boolean;
  /** Contador de FPS no canto do HUD, sem abrir o F3. */
  showFps: boolean;
  /** Teto de FPS; 0 = seguir a taxa de atualização do display. */
  maxFps: number;
  /** "Toque para alternar" em vez de "segurar" (doc 09 §4). */
  toggleSprint: boolean;
  toggleSneak: boolean;
  /**
   * Volumes 0..1, um por barramento (doc 08 §3.11: nove sliders).
   *
   * `masterVolume` e `musicVolume` mantêm o nome antigo de propósito — eles já
   * estão no `localStorage` de quem joga, e renomear zeraria a preferência de
   * todo mundo por nada.
   */
  masterVolume: number;
  musicVolume: number;
  blockVolume: number;
  hostileVolume: number;
  friendlyVolume: number;
  playerVolume: number;
  ambientVolume: number;
  weatherVolume: number;
  uiVolume: number;
  /** Legendas de som com direção (doc 10 §4). */
  subtitles: boolean;
  /** Sombra de entidade; desligada em T0 pelo preset. */
  entityShadows: boolean;
  /** Item na mão em primeira pessoa (doc 01 §191). */
  handItem: boolean;
  /** Dificuldade 0–3: pacífico, fácil, normal, difícil (doc 06 §10). */
  difficulty: number;
  /** Sobe degraus de um bloco sozinho; padrão ligado no toque (doc 09 §2). */
  autoJump: boolean;
  /** Campo de visão em graus (doc 08 §6). */
  fov: number;
  /** Brilho 0–100; vira o piso de luz ambiente do shader (doc 08 §6). */
  brightness: number;
  /** Alto contraste: fundo sólido atrás do texto do HUD (doc 08 §6). */
  highContrast: boolean;
  /** Tamanho do texto do HUD, 80–150% (doc 08 §6). */
  textScale: number;
  /** Clarão vermelho ao levar dano; desligável por acessibilidade. */
  damageFlash: boolean;
  /** Modo daltônico: remapeia a paleta do HUD (doc 08 §6). */
  colorBlind: ColorBlindMode;
  /** Contorno do bloco mirado em alto contraste (doc 08 §6). */
  highContrastOutline: boolean;
  /** Esconde o clarão do relâmpago na tempestade (doc 08 §6). */
  hideSkyFlashes: boolean;
  /** Intensidade dos efeitos de distorção de câmera, 0–100 (doc 08 §6). */
  distortion: number;
}

const DEFAULTS: Settings = {
  lookSensitivity: 0.0022,
  invertY: false,
  touchMode: 'A',
  longPressMs: 300,
  touchButtonScale: 1,
  leftHanded: false,
  vibration: true,
  renderDistance: 0,
  quality: -1,
  textureStyle: 'nitido',
  guiScale: 0,
  dynamicResolution: true,
  simulationDistance: 0,
  vsync: true,
  graphics: 'auto',
  clouds: 'auto',
  particles: 'auto',
  fog: 'far',
  smoothLighting: true,
  cameraBob: true,
  showFps: false,
  maxFps: 0,
  toggleSprint: false,
  toggleSneak: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
  blockVolume: 1,
  hostileVolume: 1,
  friendlyVolume: 1,
  playerVolume: 1,
  ambientVolume: 1,
  weatherVolume: 1,
  uiVolume: 1,
  subtitles: false,
  entityShadows: true,
  handItem: true,
  difficulty: 2,
  // O padrão real do auto-pulo depende do aparelho; ver `touchDefaults`.
  autoJump: false,
  fov: 70,
  brightness: 50,
  highContrast: false,
  textScale: 100,
  damageFlash: true,
  colorBlind: 'off',
  highContrastOutline: false,
  hideSkyFlashes: false,
  distortion: 100,
};

/**
 * Valores aceitos das opções de texto. Fica ao lado de `RANGES` e cumpre o
 * mesmo papel: o que vier do `localStorage` fora da lista é descartado.
 *
 * Antes eram dois `if` soltos dentro de `loadStored`, um por opção — e a
 * terceira opção de texto teria virado o terceiro `if`.
 */
const CHOICES: Partial<Record<keyof Settings, readonly string[]>> = {
  touchMode: ['A', 'B'],
  textureStyle: ['classico', 'nitido'],
  graphics: ['auto', 'fast', 'fancy'],
  clouds: ['auto', 'off', 'fast', 'fancy'],
  particles: ['auto', 'min', 'reduced', 'all'],
  fog: ['off', 'near', 'far'],
  colorBlind: ['off', 'protanopia', 'deuteranopia', 'tritanopia'],
};

/**
 * O que "Rápido" e "Bonito" escrevem nos controles individuais (doc 08 §3.11).
 *
 * A umbrella não é um valor que o render consulta: ela **mexe nos outros
 * controles**, como no gênero. Assim não existe estado inconsistente do tipo
 * "Gráficos: Rápido, Nuvens: Bonitas" — o jogador vê nos sliders o que
 * escolheu no atalho.
 */
const GRAPHICS_PRESETS: Record<'fast' | 'fancy', Partial<Settings>> = {
  /*
   * A umbrella **não** mexe em `smoothLighting` nem em `vsync`: os dois só
   * valem no próximo carregamento, e um atalho que muda alguma coisa agora e
   * outra daqui a um reinício é pior que não mexer nas duas.
   */
  fast: {
    clouds: 'off', particles: 'min', fog: 'near',
    entityShadows: false, cameraBob: false,
  },
  fancy: {
    clouds: 'fancy', particles: 'all', fog: 'far',
    entityShadows: true, cameraBob: true,
  },
};

/**
 * Padrões que mudam conforme o aparelho, aplicados só quando o jogador ainda
 * não escolheu. O doc 09 §2 quer auto-pulo **ligado no celular**: sem ele,
 * subir uma borda de um bloco exige soltar o joystick e acertar o botão de
 * pulo a cada passo. No desktop a tecla está ali e o automático atrapalha.
 */
function touchDefaults(): Partial<Settings> {
  try {
    return matchMedia('(pointer: coarse)').matches ? { autoJump: true } : {};
  } catch {
    return {};
  }
}

/** Faixas válidas. Valor fora da faixa em `localStorage` é ignorado. */
const RANGES: Partial<Record<keyof Settings, [number, number]>> = {
  lookSensitivity: [0.0002, 0.02],
  longPressMs: [150, 1000],
  touchButtonScale: [0.7, 1.5],
  renderDistance: [0, 32],
  simulationDistance: [0, 8],
  distortion: [0, 100],
  quality: [-1, 2],
  guiScale: [0, 4],
  maxFps: [0, 480],
  masterVolume: [0, 1],
  musicVolume: [0, 1],
  blockVolume: [0, 1],
  hostileVolume: [0, 1],
  friendlyVolume: [0, 1],
  playerVolume: [0, 1],
  ambientVolume: [0, 1],
  weatherVolume: [0, 1],
  uiVolume: [0, 1],
  difficulty: [0, 3],
  fov: [30, 110],
  brightness: [0, 100],
  textScale: [80, 150],
};

export class SettingsStore {
  private readonly values: Settings;
  private readonly listeners: ((settings: Settings) => void)[] = [];

  constructor() {
    this.values = { ...DEFAULTS, ...touchDefaults(), ...loadStored() };
  }

  get current(): Readonly<Settings> {
    return this.values;
  }

  get<K extends keyof Settings>(key: K): Settings[K] {
    return this.values[key];
  }

  set<K extends keyof Settings>(key: K, value: Settings[K]): void {
    const range = RANGES[key];
    let next = value;
    if (range !== undefined && typeof next === 'number') {
      next = Math.min(range[1], Math.max(range[0], next)) as Settings[K];
    }
    if (this.values[key] === next) return;
    this.values[key] = next;
    // A umbrella de gráficos escreve os controles que ela resume, antes de
    // avisar quem ouve: um aviso só, com tudo já no lugar.
    if (key === 'graphics' && (next === 'fast' || next === 'fancy')) {
      Object.assign(this.values, GRAPHICS_PRESETS[next as 'fast' | 'fancy']);
    }
    this.save();
    for (const fn of this.listeners) fn(this.values);
  }

  reset(): void {
    Object.assign(this.values, DEFAULTS, touchDefaults());
    this.save();
    for (const fn of this.listeners) fn(this.values);
  }

  onChange(fn: (settings: Settings) => void): () => void {
    this.listeners.push(fn);
    return () => {
      const i = this.listeners.indexOf(fn);
      if (i >= 0) this.listeners.splice(i, 1);
    };
  }

  private save(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.values));
    } catch {
      // Modo privado ou cota cheia: jogar sem persistir é melhor que quebrar.
    }
  }
}

/** Lê e valida o que está guardado, descartando campos desconhecidos. */
function loadStored(): Partial<Settings> {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (raw === null) return {};

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return {};
  }
  if (typeof parsed !== 'object' || parsed === null) return {};

  const out: Partial<Settings> = {};
  const source = parsed as Record<string, unknown>;
  for (const key of Object.keys(DEFAULTS) as (keyof Settings)[]) {
    const value = source[key];
    if (typeof value !== typeof DEFAULTS[key]) continue;
    const range = RANGES[key];
    if (range !== undefined && typeof value === 'number') {
      if (!Number.isFinite(value) || value < range[0] || value > range[1]) continue;
    }
    const choices = CHOICES[key];
    if (choices !== undefined && (typeof value !== 'string' || !choices.includes(value))) continue;
    out[key] = value as never;
  }
  return out;
}
