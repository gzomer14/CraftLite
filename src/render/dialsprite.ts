/**
 * O mostrador da bússola e do relógio (M10), pintado por cima da silhueta do
 * item em cada um dos quadros da animação. Saiu de `itemsprites.ts` no M24,
 * que passava de 700 linhas.
 */

import { DIAL_FRAMES, SHAPES, type DialKind, type ItemArt } from '../data/itemart';
import { SPRITE_SIZE } from './itemsprites';
import type { Rgb } from './texgen';

const NEEDLE: Rgb = [206, 40, 36];
const NEEDLE_TAIL: Rgb = [70, 72, 84];
const NIGHT: Rgb = [26, 32, 74];
const SUN: Rgb = [252, 220, 70];
const MOON: Rgb = [226, 226, 214];
/** Centro da face do mostrador, em pixels de máscara (ver `SHAPES.dial`). */
const DIAL_CENTER = 7.5;

/**
 * Pinta o mostrador do quadro `frame` por cima da silhueta: a agulha da
 * bússola ou o disco dia/noite do relógio, só onde a máscara é face (`a`).
 *
 * Quadro 0 é agulha para cima e sol no alto; cada quadro gira 360°/16 no
 * sentido horário.
 */
export function drawDialFace(tile: Uint8ClampedArray, size: number, art: ItemArt, frame: number): void {
  const mask = SHAPES[art.shape];
  if (mask === undefined || art.dial === undefined) return;
  const k = Math.max(1, Math.floor(size / SPRITE_SIZE));
  const angle = (frame / DIAL_FRAMES) * Math.PI * 2;
  const face = (mx: number, my: number): boolean => {
    const role = mask[my]?.[mx];
    return role === 'a' || role === 'A';
  };
  const paint = (mx: number, my: number, color: Rgb): void => {
    if (!face(mx, my)) return;
    for (let y = my * k; y < (my + 1) * k; y++) {
      for (let x = mx * k; x < (mx + 1) * k; x++) {
        const o = ((y * size) + x) << 2;
        tile[o] = color[0]; tile[o + 1] = color[1]; tile[o + 2] = color[2]; tile[o + 3] = 255;
      }
    }
  };
  const dx = Math.sin(angle);
  const dy = -Math.cos(angle);
  drawDialKind(art.dial, angle, dx, dy, paint);
}

function drawDialKind(
  kind: DialKind, angle: number, dx: number, dy: number,
  paint: (mx: number, my: number, color: Rgb) => void,
): void {
  if (kind === 'needle') {
    // Ponta vermelha para onde aponta, rabo escuro do outro lado.
    for (let t = -3; t <= 4.01; t += 0.5) {
      const color = t > 0 ? NEEDLE : NEEDLE_TAIL;
      paint(Math.floor(DIAL_CENTER + dx * t + 0.5), Math.floor(DIAL_CENTER + dy * t + 0.5), color);
    }
    return;
  }
  // Céu: metade dia (o acento já pintado), metade noite, sol e lua opostos.
  for (let my = 0; my < SPRITE_SIZE; my++) {
    for (let mx = 0; mx < SPRITE_SIZE; mx++) {
      const px = mx + 0.5 - DIAL_CENTER - 0.5;
      const py = my + 0.5 - DIAL_CENTER - 0.5;
      if (px * dx + py * dy < -0.3) paint(mx, my, NIGHT);
    }
  }
  const sunX = DIAL_CENTER + Math.sin(angle) * 3;
  const sunY = DIAL_CENTER - Math.cos(angle) * 3;
  const moonX = DIAL_CENTER - Math.sin(angle) * 3;
  const moonY = DIAL_CENTER + Math.cos(angle) * 3;
  for (let oy = 0; oy <= 1; oy++) {
    for (let ox = 0; ox <= 1; ox++) {
      paint(Math.floor(sunX) + ox, Math.floor(sunY) + oy, SUN);
      paint(Math.floor(moonX) + ox, Math.floor(moonY) + oy, MOON);
    }
  }
}
