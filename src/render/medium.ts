/**
 * O meio em que o olho está: ar, água ou lava (M14).
 *
 * Até aqui mergulhar não mudava nada na tela — a névoa era a do céu, a
 * distância era a de render, e a água vista de dentro era a mesma de fora.
 * Aqui sai o que muda **no quadro em que o olho entra no fluido**: cor e
 * densidade da névoa e um tom multiplicado no terreno e nas entidades.
 *
 * Não é passe novo nem pós-processamento: são os mesmos uniforms de névoa do
 * passe de terreno, com outros valores, mais o `uMediumTint`. O céu e as
 * nuvens deixam de ser desenhados — debaixo d'água o infinito é névoa pura, e
 * o `clear` já pinta essa cor.
 */

import type { SkyParams } from './terrain';

export const MEDIUM_AIR = 0;
export const MEDIUM_WATER = 1;
export const MEDIUM_LAVA = 2;
export type Medium = typeof MEDIUM_AIR | typeof MEDIUM_WATER | typeof MEDIUM_LAVA;

interface MediumLook {
  /** Cor da névoa com o olho em luz plena. */
  readonly fog: readonly [number, number, number];
  /** Distância, em blocos, em que a névoa já cobriu ~98% da cor. */
  readonly sight: number;
  /** Tom multiplicado na cor do terreno e das entidades antes da névoa. */
  readonly tint: readonly [number, number, number];
  /** Fração da cor da névoa que sobra no escuro total (a lava tem luz própria). */
  readonly floor: number;
}

/**
 * Tabela por meio. A água enxerga uns 20 blocos em azul que escurece com a
 * profundidade; a lava, pouco mais de um bloco, em laranja que não depende da
 * luz — ela é a fonte de luz.
 */
const LOOKS: readonly (MediumLook | null)[] = [
  null,
  { fog: [0.07, 0.22, 0.48], sight: 20, tint: [0.62, 0.8, 1.0], floor: 0.18 },
  { fog: [0.85, 0.3, 0.04], sight: 1.6, tint: [1.0, 0.55, 0.25], floor: 1 },
];

/**
 * A névoa é `1 − exp(−(d·dens)²)`: com `d·dens = 2` ela está em 98%. Daí a
 * densidade que apaga tudo a `sight` blocos.
 */
const FOG_OPAQUE_AT = 2;

/**
 * Escreve em `out` os parâmetros do quadro dentro do meio. `light` é a luz
 * que chega ao olho, 0..1 — a mesma que escurece a mão (`Renderer.handLight`).
 * Devolve `false` no ar, e aí `out` não é tocado.
 */
export function applyMedium(
  medium: Medium, light: number, base: SkyParams, out: SkyParams,
): boolean {
  const look = LOOKS[medium];
  if (look === null || look === undefined) return false;
  const bright = look.floor + (1 - look.floor) * Math.max(0, Math.min(1, light));
  for (let c = 0; c < 3; c++) {
    out.fogColor[c] = look.fog[c] * bright;
    out.tint[c] = look.tint[c];
  }
  // Nunca mais rala que a névoa do ar: com RD 2 o ar já é mais denso que isto.
  out.fogDensity = Math.max(base.fogDensity, FOG_OPAQUE_AT / look.sight);
  out.dayFactor = base.dayFactor;
  out.minSkyLight = base.minSkyLight;
  return true;
}

/** Meio de um bloco pelo nome da definição. */
export function mediumOfBlock(name: string): Medium {
  return name === 'water' ? MEDIUM_WATER : name === 'lava' ? MEDIUM_LAVA : MEDIUM_AIR;
}
