/**
 * Gerência dos mobs: ordem do tick, alvo, dano, morte e despawn (doc 07).
 *
 * A ordem do tick é normativa para a sensação de jogo:
 *   ambiente (fogo/afogamento) → alvo → goals → física → animação → despawn.
 *
 * O que este módulo **não** faz: decidir comportamento (é `ai/goals.ts`),
 * escolher onde nascer (é `spawn.ts`) e desenhar (é `render/mobrender.ts`).
 */

import { MOBS, mobDef, type GoalName, type MobDef, type ShotKind } from '../data/mobs';
import { raycast } from '../world/raycast';
import { GOALS, type AiContext, type Goal } from './ai/goals';
import { VILLAGE_GOALS } from './ai/villagegoals';
import { DRAGON_GOALS } from './ai/dragongoals';
import { deathDrops, tickHusbandry } from './husbandry';
import { breed, tryFeed, tryTame, type CareHost } from './mobcare';
import { pickMob } from './mobpick';
import { environmentHarm, rollDrop, shouldDespawn, teleport } from './mobrules';

export { BREED_COOLDOWN, GROW_TICKS, LOVE_TICKS } from './mobcare';
export { rayBoxDistance } from './mobpick';
import { Pathfinder, REQUESTS_PER_TICK } from './ai/pathfinder';
import {
  FLAG_ANGRY, FLAG_DYING, FLAG_PERSISTENT, FLAG_TAMED, MobStore, PATH_MAX, slimeHealth, slimeScale,
} from './mobstore';
import type { World } from '../world/world';

/** Ticks entre buscas de alvo (doc 07 §2). */
const TARGET_INTERVAL = 10;
/** Ticks sem linha de visão até perder o alvo: 5 s. */
const BLIND_LIMIT = 100;
/**
 * Força da explosão do creeper (doc 07 §6). No Difícil o doc 06 §10 pede raio
 * maior: `explode()` deriva o raio de `power * 1.3`, então 3 → 3,9 blocos e
 * 4 → 5,2.
 */
const CREEPER_POWER = 3;
const CREEPER_POWER_HARD = 4;
/** Aranha só fica hostil no escuro (doc 07 §2). */
const SPIDER_LIGHT_LIMIT = 11;
/** Ticks de piscada vermelha ao levar dano. */
const HURT_TICKS = 10;
/** Força do empurrão que o mob dá no jogador. */
const KNOCKBACK = 0.42;
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
  /**
   * Um bicho mudou um bloco sem quebrá-lo: ovelha pastando, enderman pegando
   * e pondo (`entity/husbandry.ts`). Quem ouve atualiza a luz.
   */
  onBlockChanged?(x: number, y: number, z: number, previous: number, state: number): void;
  /**
   * Um tiro de mob, na direção normalizada. `kind` diz o quê: flecha, bola de
   * fogo do ghast (voa reto e explode), a do blaze (incendeia) ou o frasco da
   * bruxa (M16).
   */
  onArrow(
    x: number, y: number, z: number,
    dx: number, dy: number, dz: number, damage: number, kind?: ShotKind,
  ): void;
  /** Um aldeão abriu ou fechou a porta de casa (M9). Quem ouve troca as duas folhas. */
  onDoor?(x: number, y: number, z: number, open: boolean): void;
  /** O jogador acertou este mob (M9: reputação da aldeia, golem que se vira). */
  onHurtByPlayer?(i: number): void;
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
  /** Tick do dia, 0..23999 — a rotina da aldeia (M9). */
  dayTime = 1000;
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
  /** O que domar, alimentar e cruzar precisam daqui (`mobcare.ts`). */
  private readonly care: CareHost;
  private readonly player: PlayerView = { x: 0, y: 0, z: 0, eyeY: 0, held: -1, alive: true };
  private tickCount = 0;
  /** Explosões de morte a disparar no próximo tick: `[x, y, z, força, …]` (M16). */
  private readonly pendingExplosions: number[] = [];
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

    this.care = {
      store: this.store,
      random: () => this.rng(),
      sound: (i, kind) => this.emitSound(i, kind),
      onXp: (amount, x, y, z) => this.events.onXp(amount, x, y, z),
    };
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
      dayTime: 1000,
      hitMob: (i, target, damage) => this.hitMob(i, target, damage),
      setDoor: (x, y, z, open) => { this.events.onDoor?.(x, y, z, open); },
      villageSound: (i, name) => {
        this.events.onSound(name, this.store.x[i], this.store.centerY(i), this.store.z[i]);
      },
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

  /**
   * Coluna saiu do mundo: os mobs comuns que estão nela saem junto.
   *
   * Mob não vai para o save (doc 11 §2), então é o mesmo que acontece ao
   * recarregar — e o chunk que voltar ganha bichos de novo (`populateChunk`).
   * Sem isto, desde que o mob em coluna descarregada passou a ficar parado
   * (M9), todo bicho deixado para trás ocupava o pool para sempre: andando por
   * um mundo em RD 16 o pool enchia de vacas, e a aldeia não tinha onde nascer.
   * Domado, nomeado e morador de aldeia ficam (a aldeia cuida dos seus).
   */
  forgetChunk(cx: number, cz: number): void {
    const s = this.store;
    for (let i = 0; i < s.active; i++) {
      if (s.hasFlag(i, FLAG_PERSISTENT) || s.village.member[i] === 1) continue;
      if (Math.floor(s.x[i]) >> 4 !== cx || Math.floor(s.z[i]) >> 4 !== cz) continue;
      s.removeAt(i);
      i--;
    }
  }

  /**
   * Pool cheio: libera o slot do mob comum mais longe de `(x, z)`. Devolve
   * false se só há domados, nomeados e moradores. É a vaga do aldeão e do golem:
   * a aldeia não pode ficar vazia porque o mundo encheu de bicho.
   */
  makeRoom(x: number, z: number): boolean {
    const s = this.store;
    let far = -1;
    let farDistance = -1;
    for (let i = 0; i < s.active; i++) {
      if (s.hasFlag(i, FLAG_PERSISTENT) || s.village.member[i] === 1) continue;
      const distance = (s.x[i] - x) ** 2 + (s.z[i] - z) ** 2;
      if (distance > farDistance) { farDistance = distance; far = i; }
    }
    if (far < 0) return false;
    s.removeAt(far);
    return true;
  }

  /** Dispara as explosões de morte pendentes (ver `die`). */
  private flushExplosions(): void {
    const list = this.pendingExplosions;
    if (list.length === 0) return;
    // Copia os números antes: a explosão pode matar outro cristal e empilhar mais.
    const count = list.length;
    for (let k = 0; k < count; k += 4) {
      this.events.onExplode(list[k], list[k + 1], list[k + 2], list[k + 3]);
    }
    list.splice(0, count);
  }

  clear(): void {
    this.pendingExplosions.length = 0;
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
    ctx.dayTime = this.dayTime;

    this.flushExplosions();
    const s = this.store;
    for (let i = 0; i < s.active; i++) {
      /*
       * Mob em coluna não carregada fica parado (M9). Sem isto o `getBlock` de
       * fora do mundo carregado responde ar, e todo bicho que ficou para trás
       * caía até o fundo do mundo e morria de "void" — os aldeões de uma
       * aldeia de que o jogador se afastava inclusive.
       */
      // Quem atravessa blocos (o dragão, M16) não depende do chão carregado.
      if (!this.world.isLoaded(Math.floor(s.x[i]), Math.floor(s.z[i]))
        && mobDef(s.type[i]).traits.noClip !== true) continue;
      // Morto por outro mob no tick (ver `hitMob`): morre agora, no próprio slot.
      if (s.health[i] <= 0) { this.die(i, mobDef(s.type[i])); i--; continue; }
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
      tickHusbandry(s, i, mobDef(s.type[i]), this.world, this.rng, this.events);
      this.ambientSound(i);

      if (shouldDespawn(s, i, this.player.x, this.player.z, this.difficulty, this.rng)) {
        s.removeAt(i);
        i--;
        continue;
      }
    }

    this.drainPathQueue();
  }

  // --- ambiente -------------------------------------------------------------

  /** Fogo, lava, void e sol (`mobrules.ts`). Devolve true se o mob morreu. */
  private tickEnvironment(i: number): boolean {
    const harm = environmentHarm(
      this.store, i, this.world, this.isDay, this.ctx.skyLight, this.tickCount,
    );
    if (harm <= 0) return false;
    // A causa só distingue o golpe do jogador; queda no void e fogo dão no mesmo.
    return this.damage(i, harm, this.store.y[i] < -4 ? 'void' : 'fire');
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
      if (ALL_GOALS[goals[g]](this.ctx, i)) return;
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
    const def = mobDef(s.type[i]);
    const kind = def.traits.shoots ?? 'arrow';
    // Compensa a queda mirando acima: a flecha cai pouco, o frasco da bruxa é
    // lançado devagar e cai muito. As bolas de fogo voam reto.
    if (kind === 'arrow') dy += distance * 0.08;
    else if (kind === 'potion') dy += distance * 0.18;
    const length = Math.hypot(dx, dy, dz) || 1;
    dx /= length; dy /= length; dz /= length;

    const damage = def.attack === undefined
      ? 2
      : def.attack.damage[Math.min(2, Math.max(0, this.difficulty - 1))];
    this.events.onArrow(ox, oy, oz, dx, dy, dz, damage, kind);
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
    // Na agonia já não há o que ferir: o fim é o goal que decide (M19).
    if (s.hasFlag(i, FLAG_DYING)) return false;

    const def = mobDef(s.type[i]);
    s.health[i] -= amount;
    s.hurtTicks[i] = HURT_TICKS;

    if (cause === 'player') {
      // Provocado: neutro vira hostil e passivo entra em pânico (doc 07 §2).
      if (def.category === 'passive' || def.category === 'water') s.panicTicks[i] = 40;
      else s.setFlag(i, FLAG_ANGRY, true);
      if (def.traits.callsForHelp === true) this.callForHelp(i);
      if (def.traits.teleportsOnDamage === true) this.teleport(i);
      // Antes de morrer: quem ouve precisa do mob ainda no slot.
      this.events.onHurtByPlayer?.(i);
    }

    if (s.health[i] > 0) {
      this.emitSound(i, 'hurt');
      return false;
    }
    // Quem morre devagar entra na agonia com um fio de vida; o goal o leva ao
    // fim, e o `tick` o tira do pool quando a vida zerar.
    if (def.traits.deathTicks !== undefined) {
      s.health[i] = 0.01;
      s.setFlag(i, FLAG_DYING, true);
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
        const drop = rollDrop(def.drops[d], this.rng, this.looting);
        if (drop !== null) this.events.onDrop(drop.item, drop.count, x, y, z);
      }
    }
    deathDrops(s, i, def, this.events, x, y, z);
    const xpSpread = def.xp[1] - def.xp[0];
    const xp = def.xp[0] + (xpSpread > 0 ? Math.floor(this.rng() * (xpSpread + 1)) : 0);
    if (xp > 0 && !baby) this.events.onXp(xp, x, y, z);

    this.store.removeAt(i);
    // O cristal do End (M16) explode — no começo do próximo tick, e não aqui:
    // a explosão fere outros mobs, e quem chamou `die` pode estar no meio de
    // uma volta pelo pool (a própria explosão de outro cristal, o golpe).
    const blast = def.traits.explodesOnDeath;
    if (blast !== undefined) this.pendingExplosions.push(x, y, z, blast);

    if (splitSize >= 1) {
      for (let n = 0; n < 2; n++) {
        const child = this.store.spawn(def.id, x + (n === 0 ? -0.4 : 0.4), y, z, splitSize);
        if (child < 0) break;
        this.store.health[child] = slimeHealth(splitSize);
        this.store.scale[child] = slimeScale(splitSize);
      }
    }
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

  /**
   * Golpe de um mob em outro (M9: o golem no zumbi), com o empurrão para cima
   * que é a assinatura do golem. Se o alvo morrer, o slot dele vira outro mob —
   * quem guardava o índice (`VillageState.targetMob`) revalida no tick seguinte.
   */
  private hitMob(i: number, target: number, damage: number): void {
    const s = this.store;
    if (target < 0 || target >= s.active || damage <= 0) return;
    const dx = s.x[target] - s.x[i];
    const dz = s.z[target] - s.z[i];
    const length = Math.hypot(dx, dz) || 1;
    /*
     * Sem `damage()`: ele remove o morto na hora, e remover trocaria o último
     * mob do pool para este slot — que pode ser o próprio golem, no meio do
     * goal dele. A vida vai a zero aqui e a morte acontece no tick da vítima
     * (`tick`, primeira checagem do laço).
     */
    s.health[target] -= damage;
    s.hurtTicks[target] = HURT_TICKS;
    if (s.health[target] > 0) this.emitSound(target, 'hurt');
    s.vx[target] += (dx / length) * 0.3;
    s.vz[target] += (dz / length) * 0.3;
    s.vy[target] = 0.45;
  }

  /** Enderman teleporta num raio de 16 (`mobrules.ts`). */
  teleport(i: number): void {
    teleport(this.store, i, this.world, this.rng, this.events.onSound);
  }

  /** Doma o mob com o item, se ele aceitar (`mobcare.ts`). */
  tryTame(i: number, itemName: string): 'none' | 'tamed' | 'failed' {
    return tryTame(this.care, i, itemName);
  }

  /** Dá o item de reprodução ao mob (`mobcare.ts`). */
  tryFeed(i: number, itemName: string): 'none' | 'love' | 'grow' | 'wait' {
    return tryFeed(this.care, i, itemName);
  }

  /** Nasce um filhote entre os dois pais (`mobcare.ts`). */
  breed(i: number, partner: number): void {
    breed(this.care, i, partner);
  }

  /** O mob mais próximo que o raio atravessa, ou −1 (`mobpick.ts`). */
  pickTarget(
    ox: number, oy: number, oz: number,
    dx: number, dy: number, dz: number, maxDistance: number,
  ): number {
    return pickMob(this.store, ox, oy, oz, dx, dy, dz, maxDistance);
  }

  /** Provoca um mob (usado quando o jogador olha para o enderman, por exemplo). */
  provoke(i: number): void {
    this.store.setFlag(i, FLAG_ANGRY, true);
    this.store.hasTarget[i] = 1;
  }

  // --- despawn --------------------------------------------------------------

}

/** Total de tipos de mob — o renderer usa para dimensionar buffers. */
export const MOB_TYPES = MOBS.length;

/** Todos os goals: os de sempre e os da aldeia (M9). */
const ALL_GOALS: Record<GoalName, Goal> = { ...GOALS, ...VILLAGE_GOALS, ...DRAGON_GOALS };
