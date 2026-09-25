/**
 * A luta contra o dragão (doc 14 — M16): quem nasce, quem cura, quando acaba.
 *
 * O dragão e os cristais são mobs (`data/mobs.ts`), e é isso que os deixa ser
 * desenhados, mirados e feridos de graça. O que mob não tem é **memória**:
 * mob não vai para o save (doc 11 §2), e um cristal que nascesse com o chunk
 * da coluna voltaria inteiro toda vez que a coluna fosse gerada de novo. Por
 * isso a luta é de cá:
 *
 * - o save guarda se o dragão já caiu, quais cristais foram quebrados e a
 *   vida do dragão (`EndState`);
 * - ao entrar no End, o dragão nasce com a vida guardada; cada cristal ainda
 *   inteiro nasce quando o chunk da coluna dele carrega;
 * - cristal que existia e sumiu **foi quebrado** — ele não anda, não some por
 *   distância (nasce persistente) e só sai do pool morrendo;
 * - enquanto houver cristal, o dragão se cura; o goal dele lê quantos há
 *   (`dragonState`) para pousar mais quando não houver nenhum;
 * - o dragão sumiu depois de ter nascido: caiu. O portal de saída acende, o
 *   ovo aparece em cima dele e a conquista sai.
 *
 * Tudo roda só no End, e custa uma volta pelo pool de mobs por tick.
 */

import { openMainGateway } from './endgateway';
import { DIM_END } from '../data/dimensions';
import { MOB_BY_NAME, mobDef } from '../data/mobs';
import { FLAG_PERSISTENT } from '../entity/mobstore';
import { dragonState } from '../entity/ai/dragongoals';
import { END_ISLAND_Y, PILLAR_COUNT, endPillars } from '../world/gen/end';
import { exitPortalOpen, openExitPortal, type BlockChanged } from './endportal';
import type { Mobs } from '../entity/mobs';
import type { World } from '../world/world';
import { t } from '../core/i18n';

const DRAGON = MOB_BY_NAME.get('ender_dragon')?.id ?? -1;
const CRYSTAL = MOB_BY_NAME.get('end_crystal')?.id ?? -1;
/** Um ponto de vida a cada tantos ticks, com qualquer cristal de pé. */
const HEAL_EVERY = 10;
/** Onde o dragão nasce: alto, sobre o centro. */
const SPAWN_HEIGHT = END_ISLAND_Y + 40;
/** A nuvem do sopro (M19): raio, altura, e o dano a cada meio segundo dentro dela. */
export const BREATH_RADIUS = 3.5;
const BREATH_HEIGHT = 2.5;
const BREATH_DAMAGE = 3;
const BREATH_EVERY = 10;

/** O que vai para o save do mundo. */
export interface EndState {
  killed: boolean;
  /** Bit `i` = o cristal da coluna `i` foi quebrado. */
  crystalsBroken: number;
  /** Vida do dragão ao sair do End ou salvar; 0 = cheia. */
  dragonHealth: number;
  /** Os créditos já passaram (a primeira volta pelo portal de saída). */
  creditsSeen: boolean;
}

export interface DragonFightHost {
  readonly world: World;
  readonly mobs: Mobs;
  blockChanged: BlockChanged;
  sound(name: string, x: number, y: number, z: number): void;
  message(text: string): void;
  achievement(name: string): void;
  /** Onde o jogador está, para a nuvem do sopro (M19). */
  readonly player: { readonly x: number; readonly y: number; readonly z: number };
  /** O sopro fere (M19). */
  hurtPlayer(amount: number): void;
}

export class DragonFight {
  readonly state: EndState = { killed: false, crystalsBroken: 0, dragonHealth: 0, creditsSeen: false };
  /** Vida do dragão de 0 a 1 para a barra do HUD, ou −1 sem dragão à vista. */
  bossHealth = -1;
  /** Cristais de pé agora (o HUD e os testes leem). */
  crystalsAlive = 0;
  private readonly host: DragonFightHost;
  /** Bit `i` = o cristal da coluna `i` já foi posto nesta visita. */
  private crystalsPlaced = 0;
  private dragonPlaced = false;
  private tickCount = 0;

  constructor(host: DragonFightHost) {
    this.host = host;
  }

  /** Nova visita ao End (ou saída dele): tudo que é da visita recomeça. */
  onDimensionChange(): void {
    this.crystalsPlaced = 0;
    this.dragonPlaced = false;
    this.bossHealth = -1;
    this.crystalsAlive = 0;
    dragonState.crystals = 0;
    dragonState.breathTicks = 0;
  }

  /** A nuvem do sopro no chão, se houver: `null` sem nuvem. O render lê daqui. */
  get breath(): { x: number; y: number; z: number; ticks: number } | null {
    if (dragonState.breathTicks <= 0) return null;
    this.breathView.x = dragonState.breathX;
    this.breathView.y = dragonState.breathY;
    this.breathView.z = dragonState.breathZ;
    this.breathView.ticks = dragonState.breathTicks;
    return this.breathView;
  }
  private readonly breathView = { x: 0, y: 0, z: 0, ticks: 0 };

  /**
   * Antes de os mobs do End saírem da memória (portal, morte, save): guarda a
   * vida do dragão, para ele voltar como estava.
   */
  remember(): void {
    const dragon = this.findDragon();
    if (dragon >= 0) this.state.dragonHealth = this.host.mobs.store.health[dragon];
  }

  restore(saved: Partial<EndState> | undefined): void {
    this.state.killed = saved?.killed === true;
    this.state.crystalsBroken = saved?.crystalsBroken ?? 0;
    this.state.dragonHealth = saved?.dragonHealth ?? 0;
    this.state.creditsSeen = saved?.creditsSeen === true;
  }

  snapshot(): EndState {
    this.remember();
    return { ...this.state };
  }

  tick(): void {
    const { world } = this.host;
    if (world.dimension !== DIM_END) return;
    this.tickCount++;
    this.tickCrystals();
    this.tickBreath();
    if (this.state.killed) {
      this.bossHealth = -1;
      // Chunk do centro carregado de novo sem o portal aceso (gerado da seed):
      // acende outra vez. Idempotente.
      if (world.isLoaded(0, 0) && !exitPortalOpen(world)) openExitPortal(world, this.host.blockChanged);
      // O portal de passagem para as ilhas de fora (M19), idem.
      if (this.tickCount % 20 === 0) openMainGateway(world, this.host.blockChanged);
      return;
    }
    this.tickDragon();
  }

  /** Quem fica na nuvem do sopro leva dano a cada meio segundo (M19). */
  private tickBreath(): void {
    if (dragonState.breathTicks <= 0) return;
    dragonState.breathTicks--;
    if (dragonState.breathTicks % BREATH_EVERY !== 0) return;
    const p = this.host.player;
    const dx = p.x - dragonState.breathX;
    const dz = p.z - dragonState.breathZ;
    if (dx * dx + dz * dz > BREATH_RADIUS * BREATH_RADIUS) return;
    if (Math.abs(p.y - dragonState.breathY) > BREATH_HEIGHT) return;
    this.host.hurtPlayer(BREATH_DAMAGE);
  }

  private tickCrystals(): void {
    const { world, mobs } = this.host;
    const store = mobs.store;
    const pillars = endPillars(world.seed);
    let alive = 0;
    let count = 0;
    for (let i = 0; i < store.active; i++) {
      if (store.type[i] !== CRYSTAL) continue;
      const pillar = nearestPillar(pillars, store.x[i], store.z[i]);
      if (pillar >= 0) { alive |= 1 << pillar; count++; }
    }
    for (let p = 0; p < PILLAR_COUNT; p++) {
      const bit = 1 << p;
      if ((this.state.crystalsBroken & bit) !== 0) continue;
      if ((this.crystalsPlaced & bit) !== 0) {
        // Estava de pé nesta visita e sumiu: foi quebrado.
        if ((alive & bit) === 0) this.state.crystalsBroken |= bit;
        continue;
      }
      if ((alive & bit) !== 0) { this.crystalsPlaced |= bit; continue; }
      const pillar = pillars[p];
      if (!world.isLoaded(pillar.x, pillar.z)) continue;
      const index = store.spawn(CRYSTAL, pillar.x + 0.5, pillar.top + 2, pillar.z + 0.5);
      if (index < 0) continue;
      store.setFlag(index, FLAG_PERSISTENT, true);
      this.crystalsPlaced |= bit;
      count++;
    }
    this.crystalsAlive = count;
    dragonState.crystals = count;
  }

  private tickDragon(): void {
    const { world, mobs } = this.host;
    const store = mobs.store;
    const dragon = this.findDragon();
    if (dragon < 0) {
      if (this.dragonPlaced) { this.victory(); return; }
      this.bossHealth = -1;
      if (!world.isLoaded(0, 0)) return;
      const index = store.spawn(DRAGON, 0.5, SPAWN_HEIGHT, 40.5);
      if (index < 0 && !mobs.makeRoom(0, 0)) return;
      const placed = index >= 0 ? index : store.spawn(DRAGON, 0.5, SPAWN_HEIGHT, 40.5);
      if (placed < 0) return;
      store.setFlag(placed, FLAG_PERSISTENT, true);
      if (this.state.dragonHealth > 0) store.health[placed] = this.state.dragonHealth;
      this.dragonPlaced = true;
      this.bossHealth = store.health[placed] / mobDef(DRAGON).health;
      this.host.message(t('msg.dragon_awake'));
      return;
    }
    const max = mobDef(DRAGON).health;
    // Os cristais curam: um ponto a cada meio segundo, enquanto houver um.
    if (this.crystalsAlive > 0 && this.tickCount % HEAL_EVERY === 0 && store.health[dragon] < max) {
      store.health[dragon] = Math.min(max, store.health[dragon] + 1);
    }
    this.bossHealth = Math.max(0, store.health[dragon] / max);
  }

  /** O dragão caiu: portal de saída, ovo, conquista. */
  private victory(): void {
    const { world } = this.host;
    this.state.killed = true;
    this.state.dragonHealth = 0;
    this.bossHealth = -1;
    this.dragonPlaced = false;
    if (world.isLoaded(0, 0)) openExitPortal(world, this.host.blockChanged);
    openMainGateway(world, this.host.blockChanged);
    this.host.sound('block/end_portal', 0.5, END_ISLAND_Y + 2, 0.5);
    this.host.message(t('msg.dragon_down'));
    this.host.achievement('kill_dragon');
  }

  private findDragon(): number {
    const store = this.host.mobs.store;
    for (let i = 0; i < store.active; i++) if (store.type[i] === DRAGON) return i;
    return -1;
  }
}

/** Coluna cujo topo está a menos de 3 blocos de `(x, z)`, ou −1. */
function nearestPillar(pillars: readonly { x: number; z: number }[], x: number, z: number): number {
  for (let p = 0; p < pillars.length; p++) {
    const dx = pillars[p].x + 0.5 - x;
    const dz = pillars[p].z + 0.5 - z;
    if (dx * dx + dz * dz < 9) return p;
  }
  return -1;
}
