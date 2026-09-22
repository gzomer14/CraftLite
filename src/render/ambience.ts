/**
 * O que acontece em volta do jogador a cada tick sem ser jogo: balanço da
 * câmera, partículas, fagulhas de tocha, chuva (as gotas e o som) e passos.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { defOf } from '../data/blocks';
import { blockSound } from '../audio/synth';
import { emitTorchSparks } from '../game/ambient';
import type { AudioEngine } from '../audio/engine';
import type { Renderer } from './renderer';
import type { Session } from '../game/session';
import type { SettingsStore } from '../game/settings';

/** Distância andada entre dois sons de passo: um por tick seria metralhadora. */
const STEP_DISTANCE = 2.2;

export class Ambience {
  private readonly renderer: Renderer;
  private readonly session: Session;
  private readonly audio: AudioEngine;
  private readonly settings: SettingsStore;
  private readonly rainDrops: number;
  private stepDistance = 0;

  constructor(
    renderer: Renderer, session: Session, audio: AudioEngine, settings: SettingsStore,
    rainDrops: number,
  ) {
    this.renderer = renderer;
    this.session = session;
    this.audio = audio;
    this.settings = settings;
    this.rainDrops = rainDrops;
  }

  tick(): void {
    const { renderer, session } = this;
    const player = session.player;
    const walked = Math.hypot(player.x - player.prevX, player.z - player.prevZ);

    /*
     * Balanço da câmera: a fase avança com a distância andada no chão. Ligar
     * pelo tempo faria a câmera balançar parada de costas para a parede.
     */
    const camera = renderer.camera;
    if (this.settings.get('cameraBob') && player.onGround) {
      camera.bobPhase += walked * 2.4;
      // A intensidade acompanha a velocidade: passo lento balança pouco.
      camera.bobStrength = Math.min(1, walked * 5);
    } else {
      camera.bobStrength = 0;
    }

    renderer.particles.tick();
    /*
     * Fagulha de tocha (M8): duas sondas por tick num cubo de 17 blocos. Um
     * punhado por segundo basta para uma sala de tochas piscar, e o custo não
     * aparece nem em T0. O emissor desiste sozinho quando o pool enche.
     */
    emitTorchSparks(session.world, player.x, player.y, player.z, 2, this.spark);
    // Chuva: gotas em volta do jogador, no mesmo pool (doc 03 §8).
    const weather = session.weather;
    if (weather.isRaining) {
      const drops = Math.round(weather.intensity * this.rainDrops);
      if (drops > 0) renderer.particles.emitRain(player.x, player.y, player.z, 10, drops);
    }
    // Chuva no ouvido: um loop só, com o ganho seguindo a intensidade. Debaixo
    // de telhado continua chovendo — medir cobertura custaria mais que vale.
    this.audio.setLoop('weather/rain', weather.intensity * 0.9);

    this.footsteps(walked);
  }

  /** Som de passo a cada ~2,2 blocos andados no chão, com a superfície pisada. */
  private footsteps(walked: number): void {
    const player = this.session.player;
    if (!player.onGround) return;
    this.stepDistance += walked;
    if (this.stepDistance < STEP_DISTANCE) return;
    this.stepDistance = 0;
    const below = defOf(this.session.world.getBlock(
      Math.floor(player.x), Math.floor(player.y - 0.2), Math.floor(player.z),
    ));
    if (below.shape === 'none') return;
    this.audio.play(blockSound(below.sound, 'step'), player.x, player.y, player.z, 0.5);
  }

  private readonly spark = (x: number, y: number, z: number): void => {
    this.renderer.particles.emitFlame(x, y, z);
  };
}
