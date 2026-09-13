/**
 * Gerência dos mobs: ordem do tick, alvo, dano, morte e despawn (doc 07).
 *
 * A ordem do tick é normativa para a sensação de jogo:
 *   ambiente (fogo/afogamento) → alvo → goals → física → animação → despawn.
 *
 * O que este módulo **não** faz: decidir comportamento (é `ai/goals.ts`),
 * escolher onde nascer (é `spawn.ts`) e desenhar (é `render/mobrender.ts`).
 */

import { LAVA, blockIdOf } from '../data/blocks';
import { ITEM_BY_NAME } from '../data/items';
import { lootingBonus } from '../game/enchanting';
import { MOBS, mobDef, type MobDef } from '../data/mobs';
import { raycast } from '../world/raycast';
import { GOALS, type AiContext } from './ai/goals';
import { Pathfinder, REQUESTS_PER_TICK, standHeight } from './ai/pathfinder';
import {
  FLAG_ANGRY, FLAG_PERSISTENT, FLAG_TAMED, MobStore, PATH_MAX, slimeHealth, slimeScale,
} from './mobstore';
import type { Drop } from '../data/loot';
import type { World } from '../world/world';

/** Ticks entre buscas de alvo (doc 07 §2). */
const TARGET_INTERVAL = 10;
/** Ticks sem linha de visão até perder o alvo: 5 s. */
const BLIND_LIMIT = 100;
/** Distância em que o hostil despawna na hora (doc 07 §4). */
const DESPAWN_HARD = 128;
/** A partir daqui, 1/800 de chance por tick. */
const DESPAWN_SOFT = 32;
const DESPAWN_CHANCE = 800;
/**
 * Força da explosão do creeper (doc 07 §6). No Difícil o doc 06 §10 pede raio
 * maior: `explode()` deriva o raio de `power * 1.3`, então 3 → 3,9 blocos e
 * 4 → 5,2.
 */
const CREEPER_POWER = 3;
const CREEPER_POWER_HARD = 4;
/** Aranha só fica hostil no escuro (doc 07 §2). */
const SPIDER_LIGHT_LIMIT = 11;
/** Ticks de fogo ao pegar sol, e dano a cada 20 ticks. */
const SUNLIGHT_FIRE_TICKS = 160;
/** Dano de lava por meio segundo, e quanto tempo o mob continua queimando. */
const LAVA_DAMAGE = 4;
const LAVA_FIRE_TICKS = 100;
/** Ticks de piscada vermelha ao levar dano. */
const HURT_TICKS = 10;
/** Força do empurrão que o mob dá no jogador. */
const KNOCKBACK = 0.42;
/** Ticks que o bicho fica "no amor" depois de comer o item certo (30 s). */
export const LOVE_TICKS = 600;
/** Ticks até o filhote virar adulto (5 min) — o original leva 20. */
export const GROW_TICKS = 6000;
/** Ticks entre duas reproduções do mesmo bicho (2,5 min). */
export const BREED_COOLDOWN = 3000;
/** Quanto cada item de comida apressa o crescimento do filhote. */
const FEED_GROWTH = 600;

export interface MobEvents {
  /** Item dropado ao morrer. */
  onDrop(item: number, count: number, x: number, y: number, z: number): void;
  onXp(amount: number, x: number, y: number, z: number): void;
  /** Som posicional: `mob/<sound>_<kind>`. */
  onSound(name: string, x: number, y: number, z: number): void;
  /** Dano no jogador, com a direção do empurrão já normalizada. */
  onHitPlayer(damage: number, pushX: number, pushZ: number): void;
  onExplode(x: number, y: number, z: number, power: number): void;
  /** Um mob derrubou o bloco — hoje só o zumbi arrombando porta (doc 06 §10). */
  onBreakBlock(x: number, y: number, z: number): void;
  /** `fireball` = bola de fogo do ghast: voa reto e explode onde parar. */
  onArrow(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number, damage: number, fireball?: boolean,
  ): void;
}

export interface PlayerView {
  x: number;
  y: number;
  z: number;
  eyeY: number;
  /** Item na mão, ou −1. */
  held: number;
  alive: boolean;
}

export class Mobs {
  readonly store: MobStore;
  private readonly world: World;
  private readonly events: MobEvents;
  private readonly pathfinder = new Pathfinder();

  /** Fila round-robin de pedidos de caminho (doc 07 §3). */
  private readonly pathQueue: number[] = [];
  private readonly pathTargetX: Int32Array;
  private readonly pathTargetY: Int32Array;
  private readonly pathTargetZ: Int32Array;

  difficulty = 2;
  /** Dia claro? Vem do ciclo dia/noite. */
  isDay = true;
  /**
   * Nível de Pilhagem da arma que está desferindo o golpe atual (M6).
   *
   * É a `Session` que liga e desliga em volta do `damage`: guardar o nível aqui
   * evita passar um parâmetro por toda a cadeia de morte só para o caso raro de
   * o golpe ser do jogador com espada encantada.
   */
  looting = 0;
  /** Caminhos calculados no último tick — o overlay de debug mostra isso. */
  pathsComputed = 0;

  /**
   * Aleatório do jogo, injetável (ver `MobStore.random`). Trocar aqui troca
   * também o do `store` e o do contexto de IA: os três são a mesma fonte.
   */
  private rng: () => number = Math.random;

  private readonly ctx: AiContext;
  private readonly player: PlayerView = { x: 0, y: 0, z: 0, eyeY: 0, held: -1, alive: true };
  private tickCount = 0;
  /**
   * Slot que um goal pediu para remover neste tick (creeper que explodiu).
   *
   * Remover de dentro do goal traria o último mob do pool para este índice, e o
   * resto do tick rodaria física e animação no mob errado.
   */
  private pendingRemove = -1;

  constructor(world: World, events: MobEvents, capacity = 128) {
    this.world = world;
    this.events = events;
    this.store = new MobStore(capacity);
    this.pathTargetX = new Int32Array(capacity);
    this.pathTargetY = new Int32Array(capacity);
    this.pathTargetZ = new Int32Array(capacity);

    // O contexto é um objeto só, reusado por todos os mobs em todos os ticks:
    // criar um por mob por tick geraria 400 objetos por segundo em T0.
    this.ctx = {
      world,
      store: this.store,
      playerX: 0, playerY: 0, playerZ: 0, playerEyeY: 0,
      playerHeld: -1,
      difficulty: 2,
      skyLight: 15,
      blockLight: 0,
      isDay: true,
      random: this.rng,
      hitPlayer: (i, damage) => this.hitPlayer(i, damage),
      shootArrow: (i) => this.shootArrow(i),
      explode: (i) => this.explodeMob(i),
      breakBlock: (x, y, z) => { this.events.onBreakBlock(x, y, z); },
      requestPath: (i, x, y, z) => this.enqueuePath(i, x, y, z),
      playSound: (i, kind) => this.emitSound(i, kind),
      breed: (i, partner) => this.breed(i, partner),
    };
  }

  /**
   * Troca a fonte de aleatório de todo o subsistema. Os testes injetam um
   * determinístico; o jogo fica com `Math.random`.
   */
  set random(fn: () => number) {
    this.rng = fn;
    this.store.random = fn;
    this.ctx.random = fn;
  }

  get random(): () => number {
    return this.rng;
  }

  get count(): number {
    return this.store.active;
  }

  /** Quantos mobs de uma categoria estão vivos — o spawner consulta isso. */
  countCategory(category: MobDef['category']): number {
    let n = 0;
    for (let i = 0; i < this.store.active; i++) {
      if (mobDef(this.store.type[i]).category === category) n++;
    }
    return n;
  }

  spawn(typeId: number, x: number, y: number, z: number, variant = 0): number {
    return this.store.spawn(typeId, x, y, z, variant);
  }

  clear(): void {
    this.store.clear();
    this.pathQueue.length = 0;
  }

  /** Um tick de todos os mobs. `player` é copiado, não guardado. */
  tick(player: PlayerView): void {
    this.tickCount++;
    this.player.x = player.x;
    this.player.y = player.y;
    this.player.z = player.z;
    this.player.eyeY = player.eyeY;
    this.player.held = player.held;
    this.player.alive = player.alive;

    const ctx = this.ctx;
    ctx.playerX = player.x;
    ctx.playerY = player.y;
    ctx.playerZ = player.z;
    ctx.playerEyeY = player.eyeY;
    ctx.playerHeld = player.held;
    ctx.difficulty = this.difficulty;
    ctx.isDay = this.isDay;

    const s = this.store;
    for (let i = 0; i < s.active; i++) {
      s.age[i]++;
      if (s.pathCooldown[i] > 0) s.pathCooldown[i]--;
      if (s.tickGrowth(i)) this.emitSound(i, 'ambient');

      const bx = Math.floor(s.x[i]);
      const by = Math.floor(s.centerY(i));
      const bz = Math.floor(s.z[i]);
      ctx.skyLight = this.world.getSkyLight(bx, by, bz);
      ctx.blockLight = this.world.getBlockLight(bx, by, bz);

      if (this.tickEnvironment(i)) { i--; continue; }
      if ((this.tickCount + i) % TARGET_INTERVAL === 0) this.updateTarget(i);

      this.pendingRemove = -1;
      this.runGoals(i);
      if (this.pendingRemove === i) { s.removeAt(i); i--; continue; }

      s.tickPhysics(this.world, i);
      this.ambientSound(i);

      if (this.tickDespawn(i)) { i--; continue; }
    }

    this.drainPathQueue();
  }

  // --- ambiente -------------------------------------------------------------

  /** Fogo, lava, void e sol. Devolve true se o mob morreu (e saiu do pool). */
  private tickEnvironment(i: number): boolean {
    const s = this.store;
    const def = mobDef(s.type[i]);

    if (def.traits.burnsInSunlight === true && this.isDay && this.ctx.skyLight >= 15
      && s.fireTicks[i] <= 0) {
      s.fireTicks[i] = SUNLIGHT_FIRE_TICKS;
    }

    /*
     * Lava (M7). O traço `fireImmune` existia desde o M5 e **nenhum mob o
     * declarava** — não havia como pegar fogo além do sol. O Nether é metade
     * lava, e sem isto o ghast e o porco zumbi passeariam dentro dela junto com
     * o zumbi que os seguiu pelo portal.
     */
    if (def.traits.fireImmune !== true && this.inLava(i)) {
      s.fireTicks[i] = LAVA_FIRE_TICKS;
      if (this.tickCount % 10 === 0) return this.damage(i, LAVA_DAMAGE, 'fire');
    }

    if (s.fireTicks[i] > 0 && def.traits.fireImmune !== true) {
      s.fireTicks[i]--;
      if (s.fireTicks[i] % 20 === 0) return this.damage(i, 1, 'fire');
    }

    if (s.y[i] < -4) return this.damage(i, 4, 'void');
    return false;
  }

  /** true se os pés do mob estão dentro de lava. */
  private inLava(i: number): boolean {
    const s = this.store;
    return blockIdOf(this.world.getBlock(
      Math.floor(s.x[i]), Math.floor(s.y[i] + 0.1), Math.floor(s.z[i]),
    )) === LAVA;
  }

  /** Sons ambientes esparsos — um mob silencioso não assusta. */
  private ambientSound(i: number): void {
    const s = this.store;
    if (s.age[i] % 20 !== 0) return;
    // ~1 vez a cada 20 s por mob: o suficiente para o ambiente, longe de irritar.
    if (this.rng() > 0.05) return;
    this.emitSound(i, 'ambient');
  }

  private emitSound(i: number, kind: 'ambient' | 'attack' | 'hurt' | 'death'): void {
    const s = this.store;
    const def = mobDef(s.type[i]);
    this.events.onSound(`mob/${def.sound}_${kind}`, s.x[i], s.centerY(i), s.z[i]);
  }

  // --- alvo -----------------------------------------------------------------

  /**
   * Aquisição e perda de alvo (doc 07 §2): raio 16, ou 32 se provocado, com
   * linha de visão. Perde depois de 5 s sem ver, ou passando de 2× o raio.
   */
  private updateTarget(i: number): void {
    const s = this.store;
    const def = mobDef(s.type[i]);
    if (!this.player.alive || !this.isHostileTo(i, def)) {
      s.hasTarget[i] = 0;
      return;
    }

    const range = s.hasFlag(i, FLAG_ANGRY) ? def.followRange * 2 : def.followRange;
    const dx = this.player.x - s.x[i];
    const dy = this.player.y - s.y[i];
    const dz = this.player.z - s.z[i];
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);

    if (distance > range * 2) {
      s.hasTarget[i] = 0;
      s.blindTicks[i] = 0;
      return;
    }

    const visible = distance <= range && this.hasLineOfSight(i);
    if (visible) {
      s.hasTarget[i] = 1;
      s.blindTicks[i] = 0;
      return;
    }

    if (s.hasTarget[i] === 1) {
      s.blindTicks[i] += TARGET_INTERVAL;
      if (s.blindTicks[i] > BLIND_LIMIT) {
        s.hasTarget[i] = 0;
        s.blindTicks[i] = 0;
      }
    }
  }

  private isHostileTo(i: number, def: MobDef): boolean {
    if (this.difficulty === 0) return false;
    const s = this.store;
    // Domado nunca ataca o dono, nem quando apanha dele.
    if (s.hasFlag(i, FLAG_TAMED)) return false;
    if (s.hasFlag(i, FLAG_ANGRY)) return true;
    if (def.category === 'hostile') {
      // Aranha é neutra na luz (doc 07 §2).
      if (def.traits.climbsWalls === true) {
        return Math.max(this.ctx.blockLight, this.ctx.skyLight) <= SPIDER_LIGHT_LIMIT;
      }
      return true;
    }
    return false;
  }

  /**
   * Linha de visão do mob até os olhos do jogador.
   *
   * O doc sugere 4 amostras ao longo do segmento; usamos o raycast DDA que já
   * existe, que é exato e custa proporcional à distância em blocos — e roda uma
   * vez a cada 10 ticks por mob, não por frame.
   */
  private hasLineOfSight(i: number): boolean {
    const s = this.store;
    const ox = s.x[i];
    const oy = s.eyeY(i);
    const oz = s.z[i];
    let dx = this.player.x - ox;
    let dy = this.player.eyeY - oy;
    let dz = this.player.z - oz;
    const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
    if (distance < 0.001) return true;
    dx /= distance; dy /= distance; dz /= distance;
    const hit = raycast(this.world, ox, oy, oz, dx, dy, dz, distance);
    return !hit.hit;
  }

  // --- goals ----------------------------------------------------------------

  private runGoals(i: number): void {
    const goals = mobDef(this.store.type[i]).goals;
    for (let g = 0; g < goals.length; g++) {
      if (GOALS[goals[g]](this.ctx, i)) return;
    }
  }

  // --- caminhos -------------------------------------------------------------

  private enqueuePath(i: number, x: number, y: number, z: number): void {
    if (this.pathQueue.indexOf(i) >= 0) return;
    this.pathTargetX[i] = x;
    this.pathTargetY[i] = y;
    this.pathTargetZ[i] = z;
    this.pathQueue.push(i);
  }

  /** Atende no máximo `REQUESTS_PER_TICK` pedidos — o orçamento do doc 07 §3. */
  private drainPathQueue(): void {
    this.pathsComputed = 0;
    const s = this.store;
    for (let n = 0; n < REQUESTS_PER_TICK && this.pathQueue.length > 0; n++) {
      const i = this.pathQueue.shift() as number;
      if (i >= s.active) continue;
      const found = this.pathfinder.find(
        this.world,
        Math.floor(s.x[i]), Math.floor(s.y[i]), Math.floor(s.z[i]),
        this.pathTargetX[i], this.pathTargetY[i], this.pathTargetZ[i],
        s.height(i),
      );
      this.pathsComputed++;
      if (!found) {
        s.pathLen[i] = 0;
        continue;
      }
      const length = Math.min(PATH_MAX, this.pathfinder.outLength);
      const base = i * PATH_MAX;
      for (let k = 0; k < length; k++) {
        s.pathX[base + k] = this.pathfinder.outX[k];
        s.pathY[base + k] = this.pathfinder.outY[k];
        s.pathZ[base + k] = this.pathfinder.outZ[k];
      }
      s.pathLen[i] = length;
      // O primeiro nó é onde o mob já está: começar nele o faria parar.
      s.pathIndex[i] = length > 1 ? 1 : 0;
    }
  }

  // --- combate --------------------------------------------------------------

  private hitPlayer(i: number, damage: number): void {
    if (damage <= 0) return;
    const s = this.store;
    const dx = this.player.x - s.x[i];
    const dz = this.player.z - s.z[i];
    const length = Math.hypot(dx, dz) || 1;
    this.events.onHitPlayer(damage, (dx / length) * KNOCKBACK, (dz / length) * KNOCKBACK);
  }

  private shootArrow(i: number): void {
    const s = this.store;
    const ox = s.x[i];
    const oy = s.eyeY(i);
    const oz = s.z[i];
    let dx = this.player.x - ox;
    let dy = this.player.y + 1.2 - oy;
    let dz = this.player.z - oz;
    const distance = Math.hypot(dx, dy, dz) || 1;
    // Compensa a gravidade da flecha mirando um pouco acima.
    dy += distance * 0.08;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length; dy /= length; dz /= length;

    const def = mobDef(s.type[i]);
    const damage = def.attack === undefined
      ? 2
      : def.attack.damage[Math.min(2, Math.max(0, this.difficulty - 1))];
    // A bola de fogo voa reto: mirar acima compensaria uma queda que não há.
    const fireball = def.traits.shootsFireball === true;
    this.events.onArrow(ox, oy, oz, dx, fireball ? dy - distance * 0.08 : dy, dz, damage, fireball);
    this.emitSound(i, 'attack');
  }

  private explodeMob(i: number): void {
    const s = this.store;
    const power = this.difficulty >= 3 ? CREEPER_POWER_HARD : CREEPER_POWER;
    this.events.onExplode(s.x[i], s.centerY(i), s.z[i], power);
    // O creeper morre na explosão e não dropa nada: é o preço de ter escapado.
    this.pendingRemove = i;
  }

  /**
   * Aplica dano a um mob. Devolve true se ele morreu (e o slot foi removido,
   * então quem itera precisa recuar o índice).
   */
  damage(i: number, amount: number, cause: 'player' | 'fire' | 'void' | 'fall'): boolean {
    const s = this.store;
    if (amount <= 0) return false;

    const def = mobDef(s.type[i]);
    s.health[i] -= amount;
    s.hurtTicks[i] = HURT_TICKS;

    if (cause === 'player') {
      // Provocado: neutro vira hostil e passivo entra em pânico (doc 07 §2).
      if (def.category === 'passive' || def.category === 'water') s.panicTicks[i] = 40;
      else s.setFlag(i, FLAG_ANGRY, true);
      if (def.traits.callsForHelp === true) this.callForHelp(i);
      if (def.traits.teleportsOnDamage === true) this.teleport(i);
    }

    if (s.health[i] > 0) {
      this.emitSound(i, 'hurt');
      return false;
    }

    this.die(i, def);
    return true;
  }

  private die(i: number, def: MobDef): void {
    const s = this.store;
    this.emitSound(i, 'death');
    const x = s.x[i];
    const y = s.centerY(i);
    const z = s.z[i];

    // Slime grande deixa dois menores no lugar (doc 07 §2).
    const splitSize = def.traits.splitsOnDeath === true ? s.variant[i] - 1 : 0;
    // Filhote não vira carne nem couro: matar bezerro não pode ser atalho.
    const baby = s.isBaby(i);
    if (!baby) {
      for (let d = 0; d < def.drops.length; d++) {
        this.rollDrop(def.drops[d], x, y, z);
      }
    }
    const xpSpread = def.xp[1] - def.xp[0];
    const xp = def.xp[0] + (xpSpread > 0 ? Math.floor(this.rng() * (xpSpread + 1)) : 0);
    if (xp > 0 && !baby) this.events.onXp(xp, x, y, z);

    this.store.removeAt(i);

    if (splitSize >= 1) {
      for (let n = 0; n < 2; n++) {
        const child = this.store.spawn(def.id, x + (n === 0 ? -0.4 : 0.4), y, z, splitSize);
        if (child < 0) break;
        this.store.health[child] = slimeHealth(splitSize);
        this.store.scale[child] = slimeScale(splitSize);
      }
    }
  }

  /**
   * Sorteia um drop.
   *
   * Diferente de bloco quebrado, aqui o sorteio **não** é derivado da seed: o
   * drop de um mob não é conteúdo do mundo, e amarrá-lo à posição faria o mesmo
   * zumbi soltar sempre a mesma coisa no mesmo lugar.
   */
  private rollDrop(drop: Drop, x: number, y: number, z: number): void {
    const item = ITEM_BY_NAME.get(drop.item);
    if (item === undefined) return;
    if (drop.chance !== undefined && this.rng() >= drop.chance) return;

    let count: number;
    if (typeof drop.count === 'number') {
      count = drop.count;
    } else {
      count = drop.count[0] + Math.floor(this.rng() * (drop.count[1] - drop.count[0] + 1));
    }
    // Pilhagem só acrescenta ao que já saiu: um drop que falhou no sorteio de
    // chance continua não saindo.
    if (count > 0) count += lootingBonus(this.looting, this.rng());
    if (count <= 0) return;
    this.events.onDrop(item.id, count, x, y, z);
  }

  /** Lobo atacado chama o bando (doc 07 §2). */
  private callForHelp(i: number): void {
    const s = this.store;
    const type = s.type[i];
    for (let k = 0; k < s.active; k++) {
      if (k === i || s.type[k] !== type) continue;
      const dx = s.x[k] - s.x[i];
      const dz = s.z[k] - s.z[i];
      if (dx * dx + dz * dz > 256) continue;
      s.setFlag(k, FLAG_ANGRY, true);
      s.hasTarget[k] = 1;
    }
  }

  /** Enderman teleporta para uma posição válida num raio de 16 (doc 07 §2). */
  teleport(i: number): void {
    const s = this.store;
    const tall = Math.max(1, Math.ceil(s.height(i)));
    for (let attempt = 0; attempt < 8; attempt++) {
      const x = Math.floor(s.x[i] + (this.rng() - 0.5) * 32);
      const z = Math.floor(s.z[i] + (this.rng() - 0.5) * 32);
      const y = standHeight(this.world, x, Math.floor(s.y[i]) + 2, z, tall);
      if (y < 0) continue;
      s.x[i] = x + 0.5; s.y[i] = y; s.z[i] = z + 0.5;
      s.prevX[i] = s.x[i]; s.prevY[i] = s.y[i]; s.prevZ[i] = s.z[i];
      s.vx[i] = 0; s.vy[i] = 0; s.vz[i] = 0;
      s.clearMoveTarget(i);
      this.events.onSound('mob/enderman_teleport', s.x[i], s.centerY(i), s.z[i]);
      return;
    }
  }

  /**
   * Tenta domar o mob `i` com `itemName` (doc 07 §2: osso, 1/3 de chance).
   *
   * Devolve `'none'` se o mob não é domável ou o item é outro — aí o item não é
   * consumido e o clique segue o caminho normal (colocar bloco, abrir baú).
   */
  tryTame(i: number, itemName: string): 'none' | 'tamed' | 'failed' {
    const s = this.store;
    const traits = mobDef(s.type[i]).traits;
    if (traits.tameItem === undefined || traits.tameItem !== itemName) return 'none';
    if (s.hasFlag(i, FLAG_TAMED)) return 'none';

    if (this.rng() >= (traits.tameChance ?? 1 / 3)) {
      this.emitSound(i, 'hurt');
      return 'failed';
    }
    s.setFlag(i, FLAG_TAMED, true);
    s.setFlag(i, FLAG_PERSISTENT, true);
    s.setFlag(i, FLAG_ANGRY, false);
    s.hasTarget[i] = 0;
    // Domado ganha vida cheia de bicho de estimação (doc 07 §2: HP 20).
    s.health[i] = 20;
    this.emitSound(i, 'ambient');
    return 'tamed';
  }

  /**
   * Dá o item de reprodução na mão do jogador ao mob `i`.
   *
   * Adulto pronto entra no amor; filhote cresce mais rápido; quem acabou de
   * cruzar recusa. Devolve `'none'` quando o item não serve — aí o clique
   * segue o caminho normal (comer, colocar bloco).
   */
  tryFeed(i: number, itemName: string): 'none' | 'love' | 'grow' | 'wait' {
    const s = this.store;
    const traits = mobDef(s.type[i]).traits;
    if (traits.breedItem === undefined || traits.breedItem !== itemName) return 'none';

    if (s.isBaby(i)) {
      s.growTicks[i] = Math.max(0, s.growTicks[i] - FEED_GROWTH);
      if (s.growTicks[i] === 0) s.scale[i] = 1;
      this.emitSound(i, 'ambient');
      return 'grow';
    }
    if (s.breedCooldown[i] > 0 || s.loveTicks[i] > 0) return 'wait';

    s.loveTicks[i] = LOVE_TICKS;
    s.setFlag(i, FLAG_PERSISTENT, true);
    this.emitSound(i, 'ambient');
    return 'love';
  }

  /**
   * Nasce um filhote entre os dois pais (doc 14 — M6).
   *
   * Os dois saem do amor e entram em cooldown mesmo se o pool estiver cheio:
   * senão um par preso num canto ficaria tentando cruzar todo tick.
   */
  breed(i: number, partner: number): void {
    const s = this.store;
    s.loveTicks[i] = 0;
    s.loveTicks[partner] = 0;
    s.breedCooldown[i] = BREED_COOLDOWN;
    s.breedCooldown[partner] = BREED_COOLDOWN;
    s.clearMoveTarget(i);
    s.clearMoveTarget(partner);

    const x = (s.x[i] + s.x[partner]) * 0.5;
    const y = Math.max(s.y[i], s.y[partner]);
    const z = (s.z[i] + s.z[partner]) * 0.5;
    const baby = this.store.spawn(s.type[i], x, y, z, s.variant[i]);
    if (baby >= 0) {
      this.store.makeBaby(baby, GROW_TICKS);
      this.store.setFlag(baby, FLAG_PERSISTENT, true);
      this.emitSound(baby, 'ambient');
    }
    this.events.onXp(1 + Math.floor(this.rng() * 7), x, y, z);
  }

  /** Provoca um mob (usado quando o jogador olha para o enderman, por exemplo). */
  provoke(i: number): void {
    this.store.setFlag(i, FLAG_ANGRY, true);
    this.store.hasTarget[i] = 1;
  }

  // --- despawn --------------------------------------------------------------

  /** Regras do doc 07 §4. Devolve true se o mob saiu do pool. */
  private tickDespawn(i: number): boolean {
    const s = this.store;
    const def = mobDef(s.type[i]);
    if (!def.despawnable || s.hasFlag(i, FLAG_PERSISTENT)) return false;

    const dx = s.x[i] - this.player.x;
    const dz = s.z[i] - this.player.z;
    const distanceSq = dx * dx + dz * dz;

    if (distanceSq > DESPAWN_HARD * DESPAWN_HARD) {
      s.removeAt(i);
      return true;
    }
    if (distanceSq > DESPAWN_SOFT * DESPAWN_SOFT && this.rng() < 1 / DESPAWN_CHANCE) {
      s.removeAt(i);
      return true;
    }
    // Pacífico: hostis somem (doc 06 §10).
    if (this.difficulty === 0 && def.category === 'hostile') {
      s.removeAt(i);
      return true;
    }
    return false;
  }

  /**
   * O mob mais próximo de um raio, para o jogador atacar.
   * Devolve o índice ou −1.
   */
  pickTarget(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDistance: number,
  ): number {
    const s = this.store;
    let best = -1;
    let bestDistance = maxDistance;
    for (let i = 0; i < s.active; i++) {
      const width = s.width(i);
      const height = s.height(i);
      const distance = rayBoxDistance(
        ox, oy, oz, dx, dy, dz,
        s.x[i] - width / 2, s.y[i], s.z[i] - width / 2,
        s.x[i] + width / 2, s.y[i] + height, s.z[i] + width / 2,
      );
      if (distance < 0 || distance >= bestDistance) continue;
      bestDistance = distance;
      best = i;
    }
    return best;
  }
}

/** Total de tipos de mob — o renderer usa para dimensionar buffers. */
export const MOB_TYPES = MOBS.length;

/**
 * Distância do raio até a AABB, ou −1 se não acerta (slab method).
 * Usado para o jogador mirar num mob em vez de num bloco.
 */
export function rayBoxDistance(
  ox: number, oy: number, oz: number,
  dx: number, dy: number, dz: number,
  minX: number, minY: number, minZ: number,
  maxX: number, maxY: number, maxZ: number,
): number {
  let near = 0;
  let far = Infinity;

  for (let axis = 0; axis < 3; axis++) {
    const origin = axis === 0 ? ox : axis === 1 ? oy : oz;
    const direction = axis === 0 ? dx : axis === 1 ? dy : dz;
    const min = axis === 0 ? minX : axis === 1 ? minY : minZ;
    const max = axis === 0 ? maxX : axis === 1 ? maxY : maxZ;

    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return -1;
      continue;
    }
    let t1 = (min - origin) / direction;
    let t2 = (max - origin) / direction;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
    if (t1 > near) near = t1;
    if (t2 < far) far = t2;
    if (near > far) return -1;
  }
  return far < 0 ? -1 : near;
}
