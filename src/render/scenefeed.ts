/**
 * Alimenta o renderizador com o que a sessão tem, a cada quadro: mobs,
 * veículos, flechas e sombras no batch de entidades (doc 07 §5); texto das
 * placas; itens no chão e arremessados; orbes de XP; o contorno do bloco
 * mirado; e a luz da mão.
 *
 * Saiu do `main.ts` em 2026-09-22 (M13). No caminho, os callbacks de
 * `forEach` passaram a ser criados **uma vez**, como campos: o `main.ts`
 * criava seis closures novas por quadro, o que a regra de zero alocação no
 * caminho quente (PROMPT.md §6) não permite.
 */

import { defOf, stateBitsOf, texOf } from '../data/blocks';
import { mobDef } from '../data/mobs';
import { modelOf } from '../data/mobmodels';
import { SHAPE_BY_NAME, boundsFor } from '../world/mesh/shapes';
import { FLAG_DYING, FLAG_SLEEPING } from '../entity/mobstore';
import { BREATH_RADIUS } from '../game/dragonfight';
import {
  ARROW_LAYER, BOAT_LAYER, BOBBER_LAYER, FISHING_LINE_LAYER, MINECART_LAYER, type EntityAtlas,
} from './entityatlas';
import { SIGN_TEXT_DISTANCE, type SignTextPass } from './signtext';
import { LINE_FLYING } from '../game/fishing';

/** Teto de trechos da linha de pesca: o batcher de entidades é finito. */
const LINE_SEGMENTS = 32;
/** Onde a ponta da vara aparece na tela, em NDC (medido na captura, M14). */
const ROD_TIP_NDC: readonly [number, number] = [0.76, -0.26];
import { mediumOfBlock } from './medium';
import type { Atlas } from './atlas';
import type { ItemRenderer } from './itemrender';
import type { MobRenderer } from './mobrender';
import type { Renderer } from './renderer';
import type { Player } from '../entity/player';
import type { Session } from '../game/session';
import type { World } from '../world/world';

export interface SceneFeedDeps {
  renderer: Renderer;
  mobRenderer: MobRenderer;
  itemRenderer: ItemRenderer;
  signTextPass: SignTextPass;
  entityAtlas: EntityAtlas;
  atlas: Atlas;
  world: World;
  session: Session;
  player: Player;
  /** Sombras de entidade: o preset liga, a opção pode desligar a cada quadro. */
  shadows: () => boolean;
}

export class SceneFeed {
  private readonly d: SceneFeedDeps;
  /** Reusado por quadro para medir o brilho do bloco mirado. */
  private readonly crackColor = new Float32Array(3);
  /** Fator de dia do quadro corrente, lido pelos callbacks abaixo. */
  private dayFactor = 1;

  constructor(deps: SceneFeedDeps) {
    this.d = deps;
    // Visão de dentro da água e da lava (M14): o bloco do olho, lido no quadro.
    const world = deps.world;
    // E o clima do tint de bioma sai da seed deste mundo.
    deps.renderer.setSeed(world.seed);
    deps.renderer.mediumAt = (x, y, z) => mediumOfBlock(defOf(world.getBlock(x, y, z)).name);
  }

  /** Um quadro. `paused` apaga o contorno do bloco mirado. */
  frame(alpha: number, paused: boolean, dayFactor: number): void {
    const { renderer, session, world, player, itemRenderer, signTextPass } = this.d;
    this.dayFactor = dayFactor;
    this.highlight(paused);
    this.entities(alpha);

    /*
     * Texto das placas (M8): só o que está perto o bastante para ser lido.
     * O corte por distância é o que limita o passe — sem ele, um mural de
     * placas a 200 blocos custaria preenchimento por letra ilegível.
     */
    signTextPass.begin();
    if (session.signs.size > 0) session.signs.forEach(this.addSign);

    // Itens no chão e arremessados: um billboard por entidade, uma draw call.
    itemRenderer.begin();
    session.items.forEach(this.addItem, alpha);
    session.projectiles.forEach(this.addThrown, alpha);
    renderer.itemRenderer = itemRenderer;

    // Orbes de XP: um brilho verde por orbe no pool de partículas, em vez de
    // um passe de render novo. Custa zero draw call a mais e some sozinho.
    session.orbs.forEach(this.addOrb, alpha);
    this.breathCloud();

    // A mão acompanha a luz de onde o jogador está: sem isto ela fica acesa
    // dentro da caverna, como se tivesse luz própria.
    const ex = Math.floor(player.x);
    const ey = Math.floor(player.y + player.eyeHeight);
    const ez = Math.floor(player.z);
    renderer.handLight = Math.max(
      world.getBlockLight(ex, ey, ez), world.getSkyLight(ex, ey, ez) * dayFactor,
    ) / 15;
  }

  private highlight(paused: boolean): void {
    const { renderer, session, atlas } = this.d;
    const target = session.interaction.state.target;
    const h = renderer.highlight;
    h.visible = target !== null && !paused;
    if (target === null) return;
    h.x = target.x; h.y = target.y; h.z = target.z;
    h.stage = session.interaction.state.stage;
    // Brilho do bloco mirado: é ele que decide se a fissura sai clara ou
    // escura. `averages` do atlas já está pronto desde o boot, então é
    // leitura de array, não cálculo por frame.
    const def = defOf(target.state);
    atlas.averageColor(atlas.layerOf(texOf(def, 'side')), this.crackColor);
    const c = this.crackColor;
    h.brightness = c[0] * 0.299 + c[1] * 0.587 + c[2] * 0.114;
    // Contorno do tamanho da forma: uma consulta de tabela por frame.
    boundsFor(SHAPE_BY_NAME[def.shape] ?? 0, stateBitsOf(target.state), h.bounds);
  }

  /**
   * Monta o batch de mobs, veículos e flechas do frame (doc 07 §5).
   *
   * A luz é **uma amostra por entidade** — por vértice não mudaria nada na tela
   * e multiplicaria por 24 o número de consultas ao mundo.
   */
  private entities(alpha: number): void {
    const { mobRenderer, session, world, entityAtlas } = this.d;
    mobRenderer.begin();
    const store = session.mobs.store;
    const dayFactor = this.dayFactor;

    for (let i = 0; i < store.active; i++) {
      const def = mobDef(store.type[i]);
      const x = store.renderX(i, alpha);
      const y = store.renderY(i, alpha);
      const z = store.renderZ(i, alpha);
      const bx = Math.floor(x);
      const by = Math.floor(y + store.height(i) * 0.5);
      const bz = Math.floor(z);
      const light = Math.max(
        world.getBlockLight(bx, by, bz), world.getSkyLight(bx, by, bz) * dayFactor,
      );
      /*
       * Creeper com o pavio aceso pisca branco: é o aviso de que dá tempo de
       * correr. Só quem tem o goal `explode` — o dragão usa `fuse` como relógio
       * de fase (M16), e até o M19 piscava branco ao investir e ao pousar.
       */
      const fused = store.fuse[i] > 0 && def.goals.includes('explode');
      const flash = store.hurtTicks[i] > 0
        ? 1
        : fused ? (store.fuse[i] % 8 < 4 ? 0.8 : 0) : 0;
      if (store.hasFlag(i, FLAG_DYING)) this.deathRays(x, y + store.height(i) * 0.5, z, store.age[i]);
      // Aldeão dormindo (M9): o corpo inteiro deita, com a cabeça no travesseiro.
      const sleeping = store.hasFlag(i, FLAG_SLEEPING);
      mobRenderer.addModel(
        modelOf(def.model), entityAtlas.layerForMob(def, store.variant[i]),
        x, sleeping ? y + 0.15 : y, z,
        store.renderYaw(i, alpha), sleeping ? -Math.PI / 2 : 0,
        store.headYaw[i], store.pitch[i],
        store.limbSwing[i], store.limbAmount[i], store.age[i],
        light, flash, store.scale[i], store.squash[i],
      );
    }

    // Barco e carrinho: mesmo batcher dos mobs, como a flecha (doc 07 §6).
    session.vehicles.carts.forEach(this.addCart, alpha);
    session.vehicles.boats.forEach(this.addBoat, alpha);
    session.projectiles.forEach(this.addArrow, alpha);
    this.fishingLine(alpha);

    // Sombras por último: elas fecham o buffer para poderem ser desenhadas com
    // blending numa segunda chamada.
    if (!this.d.shadows()) return;
    for (let i = 0; i < store.active; i++) {
      const x = store.renderX(i, alpha);
      const z = store.renderZ(i, alpha);
      const groundY = Math.floor(store.y[i]);
      const light = world.getSkyLight(Math.floor(x), groundY, Math.floor(z)) * dayFactor;
      mobRenderer.addShadow(x, groundY, z, store.width(i) * 0.8, Math.max(4, light));
    }
  }

  /**
   * Boia e linha de pesca (M14). A linha sai da ponta da vara — à direita e
   * acima do olho, na frente — e cai numa barriga até a boia, em trechos
   * girados na direção de cada pedaço (ver `fishing_line` em `mobmodels.ts`).
   */
  private fishingLine(alpha: number): void {
    const line = this.d.session.fishing;
    if (!line.active) return;
    const { mobRenderer, entityAtlas, player } = this.d;
    const bx = line.renderX(alpha);
    const by = line.renderY(alpha);
    const bz = line.renderZ(alpha);
    const light = Math.max(4, this.skyAt(bx, by + 0.3, bz));
    mobRenderer.addModel(
      modelOf(BOBBER_LAYER), entityAtlas.layerOf(BOBBER_LAYER), bx, by, bz,
      0, 0, 0, 0, 0, 0, 0, light, 0, 1, 0,
    );

    /*
     * A ponta da vara: onde o item da mão a desenha na tela (canto de baixo à
     * direita, `ROD_TIP_NDC`), levada de volta ao mundo a um bloco do olho.
     * Pela tela, e não por um deslocamento fixo, porque a mão é presa ao canto:
     * com o celular em pé ou deitado, a ponta muda de lugar no mundo.
     */
    const { renderer } = this.d;
    const yaw = player.yaw;
    const pitch = player.pitch;
    const sy = Math.sin(yaw);
    const cy = Math.cos(yaw);
    const sp = Math.sin(pitch);
    const cp = Math.cos(pitch);
    const half = Math.tan((renderer.camera.fovDeg * Math.PI) / 360);
    const right = ROD_TIP_NDC[0] * half * (renderer.width / renderer.height);
    const up = ROD_TIP_NDC[1] * half;
    // Frente (sy·cp, −sp, cy·cp), direita (−cy, 0, sy), cima (sy·sp, cp, cy·sp).
    const tipX = player.eyeX(alpha) + sy * cp - cy * right + sy * sp * up;
    const tipY = player.eyeY(alpha) - sp + cp * up;
    const tipZ = player.eyeZ(alpha) + cy * cp + sy * right + cy * sp * up;
    const endY = by + 0.25;
    const dx = bx - tipX;
    const dy = endY - tipY;
    const dz = bz - tipZ;
    const length = Math.hypot(dx, dy, dz);
    // A linha esticada no voo, frouxa na água.
    const sag = line.state === LINE_FLYING ? 0.05 : 0.08 * length;
    const segments = Math.min(LINE_SEGMENTS, Math.max(4, Math.ceil(length / 0.4)));
    const model = modelOf(FISHING_LINE_LAYER);
    const layer = entityAtlas.layerOf(FISHING_LINE_LAYER);
    let px = tipX;
    let py = tipY;
    let pz = tipZ;
    for (let s = 1; s <= segments; s++) {
      const t = s / segments;
      const nx = tipX + dx * t;
      const ny = tipY + dy * t - sag * 4 * t * (1 - t);
      const nz = tipZ + dz * t;
      const sx = nx - px;
      const sy = ny - py;
      const sz = nz - pz;
      const segYaw = Math.atan2(sx, sz);
      const segPitch = -Math.atan2(sy, Math.hypot(sx, sz) || 0.001);
      const segLength = Math.hypot(sx, sy, sz);
      // O modelo tem a origem no pé: a caixa de 16 unidades é centrada no pivô,
      // então o meio do trecho vai no meio do pedaço.
      mobRenderer.addModel(
        model, layer, (px + nx) * 0.5, (py + ny) * 0.5, (pz + nz) * 0.5,
        segYaw, segPitch, segYaw, 0, 0, 0, 0, light, 0, segLength, 0,
      );
      px = nx; py = ny; pz = nz;
    }
  }

  // --- callbacks, criados uma vez --------------------------------------------

  private skyAt(x: number, y: number, z: number): number {
    return this.d.world.getSkyLight(Math.floor(x), Math.floor(y), Math.floor(z)) * this.dayFactor;
  }

  private readonly addCart = (x: number, y: number, z: number, yaw: number): void => {
    const { mobRenderer, entityAtlas } = this.d;
    mobRenderer.addModel(
      modelOf(MINECART_LAYER), entityAtlas.layerOf(MINECART_LAYER), x, y, z,
      yaw, 0, yaw, 0, 0, 0, 0, Math.max(4, this.skyAt(x, y, z)), 0, 1, 0,
    );
  };

  private readonly addBoat = (x: number, y: number, z: number, yaw: number): void => {
    const { mobRenderer, entityAtlas } = this.d;
    mobRenderer.addModel(
      modelOf(BOAT_LAYER), entityAtlas.layerOf(BOAT_LAYER), x, y, z,
      yaw, 0, yaw, 0, 0, 0, 0, Math.max(4, this.skyAt(x, y, z)), 0, 1, 0,
    );
  };

  private readonly addArrow = (
    x: number, y: number, z: number, vx: number, vy: number, vz: number, item: number,
  ): void => {
    // Ovo e bola de neve vão com o sprite, no passe dos itens do chão.
    if (item !== 0) return;
    const yaw = Math.atan2(vx, vz);
    const pitch = -Math.atan2(vy, Math.hypot(vx, vz) || 0.001);
    this.d.mobRenderer.addModel(
      modelOf(ARROW_LAYER), this.d.entityAtlas.layerOf(ARROW_LAYER), x, y, z,
      yaw, pitch, yaw, 0, 0, 0, 0, 12, 0, 1, 0,
    );
  };

  private readonly addSign = (
    x: number, y: number, z: number, lines: readonly string[],
  ): void => {
    const player = this.d.player;
    const dx = x + 0.5 - player.x;
    const dz = z + 0.5 - player.z;
    if (dx * dx + dz * dz > SIGN_TEXT_DISTANCE * SIGN_TEXT_DISTANCE) return;
    this.d.signTextPass.add(x, y, z, stateBitsOf(this.d.world.getBlock(x, y, z)) & 3, lines);
  };

  private readonly addItem = (
    x: number, y: number, z: number, item: number, _count: number, age: number,
  ): void => {
    this.d.itemRenderer.add(x, y, z, item, age);
  };

  private readonly addThrown = (
    x: number, y: number, z: number, _vx: number, _vy: number, _vz: number, item: number,
  ): void => {
    if (item !== 0) this.d.itemRenderer.add(x, y - 0.15, z, item, 0);
  };

  /**
   * A agonia do dragão (M19): seis raios de luz girando para fora do corpo,
   * feitos de brilhos do pool de partículas — nenhum passe de render novo.
   */
  private deathRays(x: number, y: number, z: number, age: number): void {
    const particles = this.d.renderer.particles;
    for (let ray = 0; ray < RAYS; ray++) {
      const yaw = age * 0.04 + (ray * Math.PI * 2) / RAYS;
      const pitch = Math.sin(age * 0.03 + ray * 1.7) * 0.9;
      const dx = Math.cos(yaw) * Math.cos(pitch);
      const dy = Math.sin(pitch);
      const dz = Math.sin(yaw) * Math.cos(pitch);
      for (let step = 1; step <= RAY_STEPS; step++) {
        const d = step * 2;
        particles.emitGlow(x + dx * d, y + dy * d, z + dz * d, 1, 0.85, 1, 0.6);
      }
    }
  }

  /** A nuvem do sopro do dragão (M19): brilhos roxos rentes ao chão. */
  private breathCloud(): void {
    const cloud = this.d.session.dragonFight.breath;
    if (cloud === null) return;
    const particles = this.d.renderer.particles;
    for (let k = 0; k < CLOUD_PUFFS; k++) {
      const angle = Math.random() * Math.PI * 2;
      const r = Math.sqrt(Math.random()) * BREATH_RADIUS;
      particles.emitGlow(
        cloud.x + Math.cos(angle) * r, cloud.y + Math.random() * 0.8, cloud.z + Math.sin(angle) * r,
        0.72, 0.25, 0.9, 0.45,
      );
    }
  }

  private readonly addOrb = (x: number, y: number, z: number): void => {
    this.d.renderer.particles.emitGlow(x, y + 0.15, z, 0.48, 0.84, 0.23);
  };
}

/** Raios da agonia do dragão, e brilhos por raio. */
const RAYS = 6;
const RAY_STEPS = 5;
/** Brilhos da nuvem do sopro por quadro. */
const CLOUD_PUFFS = 8;
