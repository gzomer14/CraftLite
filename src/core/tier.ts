/**
 * Detecção de tier de hardware e presets de qualidade (doc 02 §1).
 *
 * A detecção erra com frequência — por isso todo valor derivado aqui pode ser
 * sobrescrito nas opções (`applyOverrides`).
 */

import type { GlCaps } from '../render/gl';
import { t } from './i18n';

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
    label: t('tier.low'),
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
    label: t('tier.medium'),
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
    label: t('tier.high'),
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
  /*
   * E o contrário: família de GPU móvel de topo, que vale um desktop.
   *
   * Sem isto **nenhum celular chegava ao T2**, por mais forte que fosse.
   * `navigator.deviceMemory` satura em 8, então 12 GB pontuam como 8; com a
   * penalidade de `isMobile`, o melhor aparelho possível somava 3 e o T2 exige
   * 4. Um Galaxy S24 Ultra entrava como T1, com render distance 8 e 2 workers.
   *
   * A primeira tentativa usou `maxTexSize >= 16384` — número do driver, sem
   * regex — e **não funcionou**: o mesmo S24 Ultra reporta 8192, porque quem
   * responde é o ANGLE e não o driver. Sobrou o nome, que é o que o aparelho
   * de fato informa: `ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)`. É a
   * regra simétrica à de cima, e envelhece do mesmo jeito — uma lista de
   * famílias que um dia deixarão de ser topo.
   */
  if (/adreno \(tm\)? ?[78]\d\d/i.test(info.renderer)
    || /mali-g7\d\d/i.test(info.renderer)
    || /immortalis/i.test(info.renderer)
    || /xclipse/i.test(info.renderer)
    || /apple gpu/i.test(info.renderer)) {
    score += 2;
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
