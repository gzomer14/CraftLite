/**
 * O som liga no primeiro gesto (doc 10 §1): o `AudioContext` só pode nascer
 * dentro de um toque, clique ou tecla. Junto nasce a música, e os nove
 * sliders de volume passam a valer.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { BUSES, BUS_SETTING } from '../data/soundbuses';
import { Music } from './music';
import type { AudioEngine } from './engine';
import type { SettingsStore } from '../game/settings';

export class AudioStart {
  private readonly audio: AudioEngine;
  private readonly settings: SettingsStore;
  /** A música existe depois do primeiro gesto; antes, `null`. */
  music: Music | null = null;
  started = false;

  constructor(audio: AudioEngine, settings: SettingsStore) {
    this.audio = audio;
    this.settings = settings;
    for (const event of ['pointerdown', 'keydown'] as const) {
      window.addEventListener(event, this.start, { once: false, passive: true });
    }
  }

  /** Qualquer gesto serve; os seguintes não fazem nada. */
  private readonly start = (): void => {
    if (this.started) return;
    this.started = true;
    void this.audio.start().then(() => {
      this.applyVolumes();
      this.music = new Music(this.audio.context, this.audio.busNode('music'));
      this.music.enabled = this.settings.get('musicVolume') > 0;
    });
  };

  /** Os nove sliders de volume do doc 08 §3.11, em uma passada. */
  applyVolumes(): void {
    this.audio.setVolume('master', this.settings.get('masterVolume'));
    for (const bus of BUSES) this.audio.setVolume(bus, this.settings.get(BUS_SETTING[bus]));
  }
}
