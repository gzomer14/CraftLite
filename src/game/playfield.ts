/**
 * Opções que só se aplicam em algum lugar do render, da física ou do HUD:
 * distância de render, brilho, névoa, nuvens, partículas, acessibilidade,
 * simulação, layout de controle (doc 08 §3.11 e §6).
 *
 * Saiu do `main.ts` em 2026-09-22 (M13). `apply` roda no começo da partida e
 * a cada mudança nas opções.
 */

import { profileById } from '../data/gamepads';
import type { Preset } from '../core/tier';
import type { Gamepads } from '../input/gamepad';
import type { Renderer } from '../render/renderer';
import type { DebugOverlay } from '../ui/debug';
import type { Hud } from '../ui/hud';
import type { ChunkPipeline } from '../world/pipeline';
import type { Player } from '../entity/player';
import type { Session } from './session';
import type { SettingsStore } from './settings';

export interface PlayfieldDeps {
  settings: SettingsStore;
  preset: Preset;
  pipeline: ChunkPipeline;
  renderer: Renderer;
  debug: DebugOverlay;
  player: Player;
  hud: Hud;
  session: Session;
  gamepads: Gamepads;
  /** Aparelho de toque: no Modo A a mira é o dedo e a mira central some. */
  touchAimMode: boolean;
}

export class Playfield {
  private readonly d: PlayfieldDeps;

  constructor(deps: PlayfieldDeps) {
    this.d = deps;
  }

  /**
   * Distância de render efetiva: o override das opções vence, 0 = seguir o
   * preset do tier.
   *
   * Ela era lida **uma vez, no boot** (o `rdOverride` do `main.ts`): mexer no
   * controle durante a partida não fazia absolutamente nada, e de dentro do
   * jogo isso é indistinguível de a opção estar quebrada (relato de campo
   * 2026-09-12). Agora o pipeline, o plano distante e a névoa acompanham.
   */
  applyRenderDistance(): void {
    const { settings, preset, pipeline, renderer, debug } = this.d;
    const override = settings.get('renderDistance');
    const distance = override > 0 ? override : preset.renderDistance;
    if (distance === pipeline.renderDistance) return;
    pipeline.setRenderDistance(distance);
    renderer.setRenderDistance(distance);
    // Senão o overlay segue anunciando o valor do boot, e quem está medindo o
    // mundo mede errado (relato de campo 2026-09-13).
    debug.setRenderDistance(distance);
  }

  apply(): void {
    const { settings, preset, renderer, player, hud, session, gamepads } = this.d;
    this.applyRenderDistance();
    player.autoJump = settings.get('autoJump');
    // Brilho 0–100 → piso de luz ambiente do shader. 50 mantém o 0.06 de antes,
    // e o topo clareia a caverna sem apagar a diferença entre dia e noite.
    renderer.minSkyLight = 0.02 + (settings.get('brightness') / 100) * 0.16;
    hud.applyAccessibility(
      settings.get('highContrast'), settings.get('textScale'), settings.get('damageFlash'),
      settings.get('colorBlind'),
    );

    /*
     * O resto da tabela de Vídeo do doc 08 §3.11.
     *
     * Tudo que é `auto` cai no preset do tier (`core/tier.ts`), que continua
     * sendo o padrão do aparelho; o jogador só sobrescreve o que quiser.
     */
    const clouds = settings.get('clouds');
    renderer.clouds.mode = clouds === 'auto' ? preset.clouds : clouds;
    const particles = settings.get('particles');
    renderer.particles.setMode(particles === 'auto' ? preset.particles : particles);
    renderer.fogMode = settings.get('fog');
    renderer.applyFog();
    renderer.highContrastOutline = settings.get('highContrastOutline');

    // Distância de simulação: é o raio em que mob nasce e some (doc 07 §4).
    const simulation = settings.get('simulationDistance');
    session.spawner.simulationDistance = simulation > 0 ? simulation : preset.simulationDistance;

    session.weather.showFlashes = !settings.get('hideSkyFlashes');

    // Modo A mira no dedo: a mira central apontaria para outro lugar.
    hud.setCrosshairVisible(!(this.d.touchAimMode && settings.get('touchMode') === 'A'));

    // Layout de controle forçado (`auto` deixa a detecção decidir).
    const forced = settings.get('padProfile');
    gamepads.forcedProfile = forced === 'auto' ? null : profileById(forced);

    renderer.resize();
  }
}
