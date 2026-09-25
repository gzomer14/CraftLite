/**
 * A cada quadro: HUD (hotbar, vida, fome, XP, efeitos, FPS), o desenho dos
 * controles de toque e, com o F3 aberto, o overlay de depuração.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13).
 */

import { MAX_AIR } from '../game/survival';
import { ITEM_BY_NAME } from '../data/items';
import { dimensionOf } from '../data/dimensions';
import { clockFrame, compassFrame, spinFrame } from './dials';
import { updateDebugSource } from './debugsource';
import type { AudioEngine } from '../audio/engine';
import type { GameLoop } from '../core/loop';
import type { Controls } from '../input/controls';
import type { Renderer } from '../render/renderer';
import type { Session } from '../game/session';
import type { SettingsStore } from '../game/settings';
import type { ChunkPipeline } from '../world/pipeline';
import type { DebugOverlay, DebugSource } from './debug';
import type { EffectsBar } from './effectsbar';
import type { Hud } from './hud';
import type { TouchUi } from './touchui';
import type { ItemSprites } from '../render/itemsprites';
import type { MarkerBar } from './markerbar';
import type { BossBar } from './bossbar';

export interface HudFeedDeps {
  hud: Hud;
  effectsBar: EffectsBar;
  touchUi: TouchUi | null;
  debug: DebugOverlay;
  session: Session;
  controls: Controls;
  settings: SettingsStore;
  renderer: Renderer;
  pipeline: ChunkPipeline;
  audio: AudioEngine;
  /** A folha de sprites, para girar bússola e relógio (M10). */
  itemSprites?: ItemSprites;
  /** Para onde a bússola aponta: o nascimento do mundo, `[x, z]`. */
  compassTarget?: () => readonly [number, number];
  /** Marcadores na borda de cima (M10). */
  markerBar?: MarkerBar;
  /** Vida do dragão (M16). */
  bossBar?: BossBar;
}

const COMPASS = ITEM_BY_NAME.get('compass')?.id ?? -1;
const CLOCK = ITEM_BY_NAME.get('clock')?.id ?? -1;

export class HudFeed {
  private readonly d: HudFeedDeps;
  /** A fonte do F3, reusada — o overlay lê daqui, nunca de um objeto novo. */
  readonly debugSource: DebugSource;

  constructor(deps: HudFeedDeps) {
    this.d = deps;
    this.debugSource = {
      stats: undefined as never,
      camera: deps.renderer.camera,
      drawCalls: 0,
      vertices: 0,
      renderScale: 1,
      chunks: { loaded: 0, total: 0, queued: 0, generating: 0, meshing: 0, visibleSections: 0 },
      maxFps: 0,
      biome: '—',
      blockLight: 0,
      skyLight: 15,
      entities: { mobs: 0, items: 0, arrows: 0, paths: 0 },
      redstone: 0,
      fire: 0,
      clock: '00:00',
      sounds: 0,
    };
  }

  /**
   * Bússola e relógio no quadro certo (M10). Antes da hotbar: é ela que lê a
   * posição do sprite, e a mão lê o tile no tick seguinte.
   */
  private turnDials(tick: number): void {
    const sprites = this.d.itemSprites;
    if (sprites === undefined) return;
    const { player, world, dayNight } = this.d.session;
    if (!dimensionOf(world.dimension).hasSky) {
      sprites.setFrame(COMPASS, spinFrame(tick, 0));
      sprites.setFrame(CLOCK, spinFrame(tick, 5));
      return;
    }
    const target = this.d.compassTarget?.();
    if (target !== undefined) {
      sprites.setFrame(COMPASS, compassFrame(player.x, player.z, player.yaw, target[0], target[1]));
    }
    sprites.setFrame(CLOCK, clockFrame(dayNight.time));
  }

  frame(loop: GameLoop): void {
    const { hud, effectsBar, touchUi, session, controls, settings, debug } = this.d;
    const { inventory, survival } = session;
    this.turnDials(loop.stats.tick);
    this.d.markerBar?.update(
      session.journal.markers, session.player, session.world.dimension,
      this.d.renderer.camera.fovDeg, window.innerWidth / Math.max(1, window.innerHeight),
    );
    hud.setSelected(inventory.selected);
    hud.render(inventory.slots);
    hud.setStats(survival.health, survival.hunger, survival.air, MAX_AIR, session.armorPoints);
    hud.setExperience(session.xp.level, session.xp.progress);
    effectsBar.update(survival.effects, survival.absorption);
    this.d.bossBar?.update(session.dragonFight.bossHealth);
    hud.setFps(loop.stats.fps, settings.get('showFps'));
    if (touchUi !== null) {
      const aimX = ((controls.aimNdcX + 1) / 2) * window.innerWidth;
      const aimY = ((1 - controls.aimNdcY) / 2) * window.innerHeight;
      touchUi.draw(controls.touch.joystick, controls.holdProgress, aimX, aimY);
    }

    const now = performance.now();
    // A taxa do display se mede sempre: precisa estar pronta ao abrir o F3.
    debug.sampleDisplayRate(now);
    // O resto só com o overlay aberto — em T0 nem a varredura do anel nem as
    // leituras de estado precisam acontecer 60 vezes por segundo à toa.
    if (!debug.isVisible) return;
    const src = this.debugSource;
    src.stats = loop.stats;
    src.maxFps = loop.maxFps;
    src.entities.mobs = session.mobs.count;
    src.entities.items = session.items.active;
    src.entities.arrows = session.projectiles.active;
    src.entities.paths = session.mobs.pathsComputed;
    src.redstone = session.redstone.lastUpdates;
    src.fire = session.fire.burning;
    src.clock = session.dayNight.clock;
    src.sounds = this.d.audio.loadedSounds;
    updateDebugSource(src, this.d.renderer, this.d.pipeline, session.world, session.player);
    debug.update(now, src);
  }
}
