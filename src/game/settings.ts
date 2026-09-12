/**
 * Opções do jogador, persistidas em `localStorage`.
 *
 * Ficam aqui as que o input e o HUD consultam todo frame. A tela de opções
 * completa (vídeo/som/idioma/acessibilidade) é entregável do M4; este módulo já
 * é a fonte da verdade para ela.
 */

const STORAGE_KEY = 'craftlite.settings.v1';

/** Modo de interação por toque (doc 09 §2.2). O A é o padrão. */
export type TouchMode = 'A' | 'B';

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
  /** Escala de GUI em passos de meio, 0,5–4; 0 = automática pela resolução. */
  guiScale: number;
  dynamicResolution: boolean;
  /** Teto de FPS; 0 = seguir a taxa de atualização do display. */
  maxFps: number;
  /** "Toque para alternar" em vez de "segurar" (doc 09 §4). */
  toggleSprint: boolean;
  toggleSneak: boolean;
  /** Volumes 0..1 (doc 10 §1). */
  masterVolume: number;
  musicVolume: number;
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
  guiScale: 0,
  dynamicResolution: true,
  maxFps: 0,
  toggleSprint: false,
  toggleSneak: false,
  masterVolume: 0.8,
  musicVolume: 0.6,
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
  guiScale: [0, 4],
  maxFps: [0, 480],
  masterVolume: [0, 1],
  musicVolume: [0, 1],
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
    if (key === 'touchMode' && value !== 'A' && value !== 'B') continue;
    out[key] = value as never;
  }
  return out;
}
