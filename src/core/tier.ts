/**
 * Detecção de tier de hardware e presets de qualidade (doc 02 §1).
 *
 * A detecção erra com frequência — por isso todo valor derivado aqui pode ser
 * sobrescrito nas opções (`applyOverrides`).
 */

import type { GlCaps } from '../render/gl';

export type Tier = 0 | 1 | 2;

export interface DeviceInfo {
  hasWebGL2: boolean;
  memGB: number;
  cores: number;
  isMobile: boolean;
  maxTexSize: number;
  /** GPU reportada pelo WEBGL_debug_renderer_info, quando disponível. */
  renderer: string;
}

export interface Preset {
  tier: Tier;
  /** Nome legível, mostrado nas opções. */
  label: string;
  renderDistance: number;
  simulationDistance: number;
  /** Multiplicador máximo de devicePixelRatio. */
  maxDpr: number;
  /** Escala de resolução inicial (a escala dinâmica mexe nisso). */
  renderScale: number;
  smoothLighting: boolean;
  entityShadows: boolean;
  clouds: 'off' | 'fast' | 'fancy';
  particles: 'min' | 'reduced' | 'all';
  /** Gotas de chuva emitidas por tick com a tempestade cheia (doc 03 §8). */
  rainDrops: number;
  fancyLeaves: boolean;
  maxMobs: number;
  workers: number;
  targetFps: number;
}

const PRESETS: Record<Tier, Preset> = {
  0: {
    tier: 0,
    label: 'Baixo',
    renderDistance: 4,
    simulationDistance: 3,
    maxDpr: 1,
    renderScale: 1,
    smoothLighting: true, // AO é feito no mesh: é barato mesmo em T0
    entityShadows: false,
    clouds: 'off',
    particles: 'min',
    rainDrops: 4,
    fancyLeaves: false,
    maxMobs: 20,
    /*
     * Dois, não um (o doc 02 §1 dizia 1).
     *
     * Medido num Galaxy J7 Metal — o aparelho de referência de T0 — o render
     * gastava **2,7 ms de 33,3** e o jogo rodava a 60 FPS: a máquina estava
     * ociosa e gerando o mundo com uma thread só, e o jogador andava mais
     * rápido do que o mundo nascia. O corte por núcleo em `presetFor`
     * (`min(workers, cores − 1)`) continua protegendo o aparelho de 2 núcleos,
     * que volta a 1 sozinho. Ver doc 15 §4.
     */
    workers: 2,
    targetFps: 30,
  },
  1: {
    tier: 1,
    label: 'Médio',
    renderDistance: 8,
    simulationDistance: 4,
    maxDpr: 1.5,
    renderScale: 1,
    smoothLighting: true,
    entityShadows: true,
    clouds: 'fast',
    particles: 'reduced',
    rainDrops: 12,
    fancyLeaves: true,
    maxMobs: 40,
    workers: 2,
    targetFps: 60,
  },
  2: {
    tier: 2,
    label: 'Alto',
    renderDistance: 12,
    simulationDistance: 6,
    maxDpr: 2,
    renderScale: 1,
    smoothLighting: true,
    entityShadows: true,
    clouds: 'fancy',
    particles: 'all',
    rainDrops: 28,
    fancyLeaves: true,
    maxMobs: 70,
    workers: 4,
    targetFps: 60,
  },
};

export function readDeviceInfo(caps: GlCaps): DeviceInfo {
  const nav = navigator as Navigator & { deviceMemory?: number };
  return {
    hasWebGL2: caps.webgl2,
    memGB: nav.deviceMemory ?? (matchMedia('(pointer: coarse)').matches ? 2 : 8),
    cores: nav.hardwareConcurrency ?? 2,
    isMobile: matchMedia('(pointer: coarse)').matches,
    maxTexSize: caps.maxTextureSize,
    renderer: caps.renderer,
  };
}

/**
 * Pontua o aparelho e escolhe o tier. Prefere errar para baixo: um desktop
 * classificado como T1 continua a 60 FPS, um celular fraco classificado como
 * T2 fica injogável.
 */
export function detectTier(info: DeviceInfo): Tier {
  let score = 0;

  if (!info.hasWebGL2) score -= 3;
  if (info.maxTexSize < 4096) score -= 2;

  if (info.memGB <= 2) score -= 2;
  else if (info.memGB <= 4) score += 0;
  else score += 2;

  if (info.cores <= 2) score -= 2;
  else if (info.cores <= 4) score += 0;
  else score += 2;

  if (info.isMobile) score -= 1;
  else score += 2;

  // GPUs móveis antigas conhecidas por não segurarem render distance alto.
  if (/adreno \(tm\) (3|4|5)0\d/i.test(info.renderer) || /mali-t[678]\d\d/i.test(info.renderer)) {
    score -= 3;
  }

  if (score <= -1) return 0;
  if (score <= 3) return 1;
  return 2;
}

/** Preset base do tier. Sempre clonado — o chamador pode mutar à vontade. */
export function presetFor(tier: Tier, info: DeviceInfo): Preset {
  const preset: Preset = { ...PRESETS[tier] };
  preset.workers = Math.max(1, Math.min(preset.workers, (info.cores || 2) - 1));
  return preset;
}
