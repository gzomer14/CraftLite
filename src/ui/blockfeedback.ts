/**
 * O retorno de quebrar e colocar bloco (doc 06 §4; saiu do `main.ts` no M18):
 * partículas com a cor média do bloco, som e vibração.
 *
 * A `Session` já registrou o próprio handler na interação; aqui só se encadeia
 * o efeito, depois dele.
 */

import { dyeRgbOf } from '../data/tints';
import { defOf, texOf } from '../data/blocks';
import { blockSound } from '../audio/synth';
import type { Atlas } from '../render/atlas';
import type { AudioEngine } from '../audio/engine';
import type { Interaction } from '../game/interaction';
import type { Renderer } from '../render/renderer';
import type { SettingsStore } from '../game/settings';

export interface BlockFeedbackDeps {
  interaction: Interaction;
  atlas: Atlas;
  renderer: Renderer;
  audio: AudioEngine;
  settings: SettingsStore;
  /** Tremida curta do controle, se houver um. */
  rumble: () => void;
}

export function attachBlockFeedback(d: BlockFeedbackDeps): void {
  // Reusada: quebrar bloco não aloca.
  const particleColor = new Float32Array(3);
  const sessionBroken = d.interaction.onBlockBroken;
  d.interaction.onBlockBroken = (x, y, z, state) => {
    sessionBroken?.(x, y, z, state);
    const layer = d.atlas.layerOf(texOf(defOf(state), 'side'));
    d.atlas.averageColor(layer, particleColor);
    // Lã e cama tingidas: o desenho é cinza, a partícula sai da cor (M13).
    const dye = dyeRgbOf(defOf(state));
    if (dye !== null) for (let c = 0; c < 3; c++) particleColor[c] *= dye[c] / 255;
    d.renderer.particles.emitBlockBreak(
      x, y, z, 8, particleColor[0], particleColor[1], particleColor[2],
    );
    d.audio.play(blockSound(defOf(state).sound, 'break'), x + 0.5, y + 0.5, z + 0.5);
    if (d.settings.get('vibration')) navigator.vibrate?.(10);
    d.rumble();
  };
  const sessionPlaced = d.interaction.onBlockPlaced;
  d.interaction.onBlockPlaced = (x, y, z, state) => {
    sessionPlaced?.(x, y, z, state);
    d.audio.play(blockSound(defOf(state).sound, 'place'), x + 0.5, y + 0.5, z + 0.5, 0.7);
  };
}
