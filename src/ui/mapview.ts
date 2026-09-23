/**
 * A conta da vista do mapa (M10): mundo ↔ tela e a pintura dos pixels.
 *
 * Separada da tela (`ui/screens/mapscreen.ts`) para ser testada sem DOM.
 *
 * **Orientação.** Norte para cima, como todo mapa. O norte do jogo é +Z (a rosa
 * do F3), e quem olha para o norte tem o **leste à direita, que é −X** — por
 * isso X cresce para a esquerda na tela. Parece espelhado para quem pensa em
 * coordenadas; é o certo para quem olha o mapa e depois olha o mundo.
 */

import { writeMapColor } from '../render/mapcolors';
import type { WorldMap } from '../game/worldmap';

/** Lado da vista, em pixels de mapa (a tela amplia com `pixelated`). */
export const MAP_VIEW = 256;
/** Pixels por bloco de cada nível de zoom: de 512 a 64 blocos na vista. */
export const MAP_ZOOMS: readonly number[] = [0.5, 1, 2, 4];
const HALF = MAP_VIEW / 2;

/** Pixel da vista `(px, py)` → coluna do mundo, para a vista centrada em `(cx, cz)`. */
export function viewToWorld(
  px: number, py: number, cx: number, cz: number, zoom: number, out: Float64Array,
): void {
  out[0] = cx - (px - HALF) / zoom;
  out[1] = cz - (py - HALF) / zoom;
}

/** Coluna do mundo → pixel da vista. */
export function worldToView(
  x: number, z: number, cx: number, cz: number, zoom: number, out: Float64Array,
): void {
  out[0] = HALF - (x - cx) * zoom;
  out[1] = HALF - (z - cz) * zoom;
}

/**
 * Ângulo, na tela, de quem olha com `yaw` (0 = para cima, horário). A frente é
 * `(sin yaw, cos yaw)`; na vista, X vira −tela e Z vira −tela para baixo.
 */
export function headingOnView(yaw: number): number {
  return Math.atan2(-Math.sin(yaw), Math.cos(yaw));
}

/** Pinta a vista inteira em `out` (RGBA, `MAP_VIEW`²). */
export function paintMapView(
  map: WorldMap, palette: Uint8Array, out: Uint8ClampedArray,
  cx: number, cz: number, zoom: number,
): void {
  for (let py = 0; py < MAP_VIEW; py++) {
    const z = Math.floor(cz - (py + 0.5 - HALF) / zoom);
    for (let px = 0; px < MAP_VIEW; px++) {
      const x = Math.floor(cx - (px + 0.5 - HALF) / zoom);
      writeMapColor(palette, map.pixel(x, z), out, (py * MAP_VIEW + px) << 2);
    }
  }
}

/** Rumo em rosa de oito pontas, do ponto `(x, z)` até `(tx, tz)`. */
export function compassPoint(x: number, z: number, tx: number, tz: number): string {
  // Norte = +Z, leste = −X (ver o topo do módulo).
  const angle = Math.atan2(-(tx - x), tz - z);
  const index = Math.round(angle / (Math.PI / 4));
  return POINTS[(index % 8 + 8) % 8];
}
const POINTS: readonly string[] = ['N', 'NE', 'L', 'SE', 'S', 'SO', 'O', 'NO'];
