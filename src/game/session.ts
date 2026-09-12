/**
 * Sessão de jogo: costura mundo, jogador, inventário, contêineres e save.
 *
 * Existe para tirar essa cola do `main.ts`, que ficaria grande demais, e para
 * que o loop de sobrevivência inteiro possa ser testado sem GL nem DOM.
 */

import { AIR, blockIdOf, defOf, makeState } from '../data/blocks';
import { ITEM_BY_NAME, itemDef, stackTool, type ItemStack } from '../data/items';
import { blockSound } from '../audio/synth';
import { MOB_BY_NAME, mobDef } from '../data/mobs';
import { rollChestLoot } from '../world/gen/structures';
import { hash3 } from '../core/rng';
import {
  Container, DoubleChestView, EnchantTable, Furnace, CHEST_SLOTS, ENCHANT_ITEM, ENCHANT_LAPIS,
  type ContainerView,
} from './container';
import {
  armorDurabilityCost, armorTotals, attackCooldownOf, attackDamageOf,
  HIT_KNOCKBACK, HIT_KNOCKBACK_UP, type ArmorTotals,
} from './combat';
import { RecipeBook, consumeGrid, type CraftGrid, type RecipeEntry } from './crafting';
import { DayNight } from './daynight';
import { Weather } from './weather';
import { rollDrops, rollXp } from './drops';
import { FEATHER_FALLING, LOOTING } from '../data/enchants';
import { levelOf, skipDurability, MAX_BOOKSHELVES, type EnchantOffer } from './enchanting';
import { Experience } from './xp';
import { Achievements } from './achievements';
import { explode, explosionDamage } from './explosion';
import { Interaction, toggleOpenState } from './interaction';
import {
  Inventory, ARMOR_END, ARMOR_START, CRAFT_END, CRAFT_RESULT, CRAFT_START,
} from './inventory';
import { trySleep } from './sleep';
import { EXHAUSTION, Survival } from './survival';
import { ItemEntities } from '../entity/itementity';
import { XpOrbs } from '../entity/xporb';
import { Mobs } from '../entity/mobs';
import { Projectiles } from '../entity/projectile';
import { BOAT_SEAT_HEIGHT, Boats } from '../entity/boat';
import { forwardFrom, createVec3 } from '../core/math';
import { MobSpawner, capsForTier } from '../entity/spawn';
import { Player } from '../entity/player';
import { plantSeed, tillSoil } from './farming';
import { Fluids } from '../world/fluids';
import { Growth } from '../world/growth';
import { Lighting } from '../world/lighting';
import { WORLD_HEIGHT, type ChunkColumn } from '../world/chunk';
import type { World } from '../world/world';

const CRAFTING_TABLE = ITEM_BY_NAME.get('crafting_table')?.id ?? -1;
const FURNACE = ITEM_BY_NAME.get('furnace')?.id ?? -1;
const CHEST = ITEM_BY_NAME.get('chest')?.id ?? -1;
const BED = ITEM_BY_NAME.get('bed')?.id ?? -1;
const ENCHANTING_TABLE = ITEM_BY_NAME.get('enchanting_table')?.id ?? -1;
const BOOKSHELF = ITEM_BY_NAME.get('bookshelf')?.id ?? -1;
const LAPIS = ITEM_BY_NAME.get('lapis_lazuli')?.id ?? -1;

/** Raio em que a flecha e a explosão acertam o jogador. */
const HIT_RADIUS = 0.7;

/** Item da flecha, resolvido uma vez. */
const ARROW = ITEM_BY_NAME.get('arrow')?.id ?? -1;
/** Velocidade e dano da flecha por carga do arco (doc 14 — M6). */
const BOW_MIN_SPEED = 0.6;
const BOW_MAX_SPEED = 2.4;
const BOW_MIN_DAMAGE = 2;
const BOW_MAX_DAMAGE = 9;
/** Quanto o escudo apara de um golpe frontal. */
const SHIELD_REDUCTION = 0.75;
/** Dano do golpe no criativo: mais que a vida do mob mais resistente. */
const CREATIVE_ATTACK_DAMAGE = 1000;
/** Alcance para montar num barco. */
const BOAT_MOUNT_RANGE = 2.5;
/** Direção de mira reusada — nada de vetor novo por disparo. */
const AIM = createVec3();

/** Alcance em que um gerador de monstros trabalha (doc 03 §7). */
const SPAWNER_RANGE = 16;
/** Teto de mobs daquele tipo perto do gerador. */
const SPAWNER_CAP = 6;
/** Ticks entre um spawn e o próximo: 10 s. */
const SPAWNER_TICKS = 200;

/** Um gerador de monstros vivo no mundo. */
interface MobSpawnerBlock {
  x: number;
  y: number;
  z: number;
  mob: string;
  cooldown: number;
}

/** O que o jogador tem aberto no momento. */
export type OpenScreen = 'none' | 'inventory' | 'crafting' | 'furnace' | 'chest' | 'enchanting';

export interface SessionEvents {
  onOpenScreen: (screen: OpenScreen, container: ContainerView | null) => void;
  onDeath: (message: string) => void;
  onPickup: (item: number, count: number) => void;
  /** Som posicional; o mundo não sabe se existe áudio ligado. */
  onSound?: (name: string, x: number, y: number, z: number) => void;
  /** Aviso curto para o jogador ("há monstros por perto"). */
  onMessage?: (text: string) => void;
  /** O jogador levou dano — tremor de tela, vibração. */
  onHurt?: (amount: number) => void;
  /** Conquista desbloqueada — toast no canto (doc 08 §3.4). */
  onAchievement?: (title: string, description: string) => void;
}

export interface SessionOptions {
  /** Cap de mobs do tier (doc 07 §4). */
  maxMobs?: number;
  /** Distância de simulação em chunks. */
  simulationDistance?: number;
}

export class Session {
  readonly world: World;
  readonly player: Player;
  readonly inventory = new Inventory();
  readonly survival = new Survival();
  readonly items = new ItemEntities();
  readonly orbs = new XpOrbs();
  readonly xp = new Experience();
  readonly mobs: Mobs;
  readonly spawner: MobSpawner;
  readonly projectiles = new Projectiles();
  readonly boats = new Boats();
  readonly dayNight = new DayNight();
  readonly weather = new Weather();
  readonly achievements = new Achievements();
  readonly lighting: Lighting;
  readonly fluids: Fluids;
  readonly growth: Growth;
  readonly interaction: Interaction;
  readonly recipes = new RecipeBook();

  /** Tile entities por posição empacotada. */
  private readonly containers = new Map<number, Container>();
  /** Grade 3×3 da bancada aberta (a 2×2 vive no inventário). */
  private readonly benchGrid: Container;
  /** Mesa de encantamento, uma só e reusada — ver `EnchantTable`. */
  private readonly enchantTable = new EnchantTable();
  /** Geradores de monstros ativos, por posição empacotada (doc 03 §7). */
  private readonly spawners = new Map<number, MobSpawnerBlock>();
  private spawnerTick = 0;
  /** Ticks segurando o botão com o arco na mão (M6). */
  private bowCharge = 0;
  /** Índice do barco que o jogador pilota, ou −1. */
  private riding = -1;

  openScreen: OpenScreen = 'none';
  openContainer: ContainerView | null = null;

  private readonly events: SessionEvents;
  /** Posição do jogador no tick anterior, para a exaustão por distância. */
  private lastX = 0;
  private lastZ = 0;
  private eatTicks = 0;
  /** Ticks até o próximo golpe poder sair (doc 05 §2). */
  private attackCooldown = 0;
  /** Ponto de renascimento; a cama muda isso. */
  spawnX = 0;
  spawnY = -1;
  spawnZ = 0;
  /** Soma da armadura equipada, recalculada quando o inventário muda. */
  private readonly armor: ArmorTotals = { defense: 0, toughness: 0, protection: 0 };

  constructor(
    world: World, player: Player, events: SessionEvents, options: SessionOptions = {},
  ) {
    this.world = world;
    this.player = player;
    this.events = events;
    this.lighting = new Lighting(world);
    this.fluids = new Fluids(world);
    this.growth = new Growth(world, {
      // Plantação sem chão vira item no lugar, como se tivesse sido quebrada.
      onCropBroken: (x, y, z, state) => { this.spawnDrops(x, y, z, state); },
      onGrown: () => { /* silencioso: uma roça inteira crescendo seria barulho */ },
    });
    this.interaction = new Interaction(world, player, this.lighting);
    this.benchGrid = new Container('chest', 9, 0, 0, 0);

    const maxMobs = options.maxMobs ?? 70;
    this.mobs = new Mobs(world, this.mobEvents(), Math.max(32, maxMobs * 2));
    this.spawner = new MobSpawner(
      world, this.mobs, capsForTier(maxMobs), options.simulationDistance ?? 4,
    );

    this.weather.setSeed(world.seed);
    this.weather.onChange = (kind) => {
      if (kind === 'thunder') this.events.onMessage?.('A tempestade chegou');
      else if (kind === 'rain') this.events.onMessage?.('Começou a chover');
    };

    this.growth.attach();
    this.wireInventory();
    this.wireInteraction();
    this.wireSurvival();
    this.wireProjectiles();

    this.lastX = player.x;
    this.lastZ = player.z;
  }

  // --- ligação entre sistemas ---------------------------------------------

  private wireInventory(): void {
    this.inventory.onDrop = (stack) => this.dropItem(stack);
    this.inventory.refreshResult = () => this.refreshCraftResult();
    this.inventory.takeResult = () => this.consumeCraft();

    this.items.onPickup = (stack) => {
      const leftover = this.inventory.give(stack.item, stack.count, stack.damage, stack.ench ?? 0);
      if (leftover < stack.count) {
        this.events.onPickup(stack.item, stack.count - leftover);
        this.noteObtained(stack.item);
      }
      return leftover;
    };

    this.orbs.onCollect = (amount) => {
      this.xp.add(amount);
      this.events.onSound?.('ui/xp', this.player.x, this.player.y, this.player.z);
    };
    this.achievements.onUnlock = (def) => {
      this.events.onAchievement?.(def.display, def.description);
      this.events.onSound?.('player/levelup', this.player.x, this.player.y, this.player.z);
    };
    this.xp.onLevelUp = (level) => {
      this.achievements.level(level);
      this.events.onSound?.('player/levelup', this.player.x, this.player.y, this.player.z);
      this.events.onMessage?.(`Nível ${level}`);
    };
  }

  private wireInteraction(): void {
    this.interaction.onBlockBroken = (x, y, z, state) => {
      this.survival.addExhaustion(EXHAUSTION.breakBlock);
      this.spawnDrops(x, y, z, state);
      this.spawnBlockXp(x, y, z, state);
      this.removeContainerAt(x, y, z);
      this.fluids.scheduleAround(x, y, z);
      this.damageTool();
    };
    this.interaction.onBlockPlaced = (x, y, z, state) => {
      this.createContainerAt(x, y, z, blockIdOf(state));
      this.fluids.scheduleAround(x, y, z);
      this.achievements.place(defOf(state).name);
    };
  }

  private wireSurvival(): void {
    this.survival.onDamage = (amount) => {
      this.events.onHurt?.(amount);
      this.events.onSound?.('player/hurt', this.player.x, this.player.y, this.player.z);
      this.damageArmor(amount);
    };
    this.survival.onDeath = () => {
      for (const stack of this.inventory.dropAll()) {
        this.items.spawn(this.player.x, this.player.y + 1, this.player.z, stack, true);
      }
      // Doc 06 §6: morrer zera a experiência. Não sobra orbe no chão — o que
      // o jogador recupera correndo de volta é o inventário, não o nível.
      this.xp.reset();
      this.closeScreen();
      this.events.onSound?.('player/death', this.player.x, this.player.y, this.player.z);
      this.events.onDeath(this.survival.deathMessage);
    };
  }

  /** Eventos que o `Mobs` dispara de volta para o mundo. */
  private mobEvents() {
    return {
      onDrop: (item: number, count: number, x: number, y: number, z: number) => {
        this.items.spawn(x, y, z, { item, count, damage: 0 });
      },
      onXp: (amount: number, x: number, y: number, z: number) => {
        this.orbs.spawn(x, y, z, amount);
      },
      onSound: (name: string, x: number, y: number, z: number) => {
        this.events.onSound?.(name, x, y, z);
      },
      onHitPlayer: (damage: number, pushX: number, pushZ: number) => {
        this.hurtPlayer(damage, 'mob', pushX, pushZ);
      },
      onExplode: (x: number, y: number, z: number, power: number) => {
        this.explodeAt(x, y, z, power);
      },
      onBreakBlock: (x: number, y: number, z: number) => {
        this.breakBlockByMob(x, y, z);
      },
      onArrow: (
        x: number, y: number, z: number,
        dx: number, dy: number, dz: number, damage: number,
      ) => {
        this.projectiles.spawn(x, y, z, dx, dy, dz, damage, false);
      },
    };
  }

  /** A flecha acerta o jogador ou um mob — o primeiro que estiver no caminho. */
  private wireProjectiles(): void {
    this.projectiles.onHit = (x, y, z, damage, fromPlayer) => {
      if (!fromPlayer) {
        const dx = x - this.player.x;
        const dy = y - (this.player.y + this.player.height * 0.5);
        const dz = z - this.player.z;
        if (Math.abs(dx) < HIT_RADIUS && Math.abs(dz) < HIT_RADIUS
          && Math.abs(dy) < this.player.height * 0.5 + 0.2) {
          const length = Math.hypot(dx, dz) || 1;
          this.hurtPlayer(damage, 'arrow', (-dx / length) * 0.2, (-dz / length) * 0.2);
          return true;
        }
      }
      const store = this.mobs.store;
      for (let i = 0; i < store.active; i++) {
        const width = store.width(i) / 2 + 0.1;
        if (Math.abs(x - store.x[i]) > width || Math.abs(z - store.z[i]) > width) continue;
        if (y < store.y[i] || y > store.y[i] + store.height(i)) continue;
        this.mobs.damage(i, damage, 'player');
        return true;
      }
      return false;
    };
    this.projectiles.onImpactSound = (x, y, z) => {
      this.events.onSound?.('player/arrow', x, y, z);
    };
  }

  // --- tick ----------------------------------------------------------------

  /** Um tick de sobrevivência. O tick de física do jogador é do chamador. */
  tick(): void {
    this.dayNight.tick();
    this.weather.update(this.dayNight.totalTicks);
    this.trackMovement();
    if (this.attackCooldown > 0) this.attackCooldown--;
    this.syncArmor();

    const head = Math.floor(this.player.y + this.player.eyeHeight);
    const bx = Math.floor(this.player.x);
    const bz = Math.floor(this.player.z);
    const headBlock = defOf(this.world.getBlock(bx, head, bz));

    if (this.player.mode === 'survival') {
      this.survival.tick({
        submerged: headBlock.name === 'water',
        inLava: this.player.inLava,
        suffocating: headBlock.opaque && headBlock.solid,
        y: this.player.y,
      });
    }

    this.achievements.depth(Math.floor(this.player.y));
    this.items.tick(this.world, this.player.x, this.player.y, this.player.z);
    this.orbs.tick(this.world, this.player.x, this.player.y, this.player.z);
    this.boats.tick(this.world);
    this.syncRider();
    this.fluids.tick();
    this.growth.tick();
    this.tickFurnaces();
    this.tickSpawners();
    this.tickMobs();
  }

  /** Mobs, spawn e flechas. Sai cedo no criativo? Não: o mundo continua vivo. */
  private tickMobs(): void {
    // Tempestade conta como noite para o spawn: é a regra do doc 03 §8, e é o
    // que faz a chuva ser perigosa em vez de decorativa.
    const day = this.dayNight.dayFactor > 0.25 && !this.weather.isThundering;
    this.mobs.difficulty = this.survival.difficulty;
    this.mobs.isDay = day;
    this.spawner.difficulty = this.survival.difficulty;
    this.spawner.isDay = day;
    this.spawner.isNight = !day;
    this.spawner.slimeFactor = this.weather.slimeFactor;

    PLAYER_VIEW.x = this.player.x;
    PLAYER_VIEW.y = this.player.y;
    PLAYER_VIEW.z = this.player.z;
    PLAYER_VIEW.eyeY = this.player.y + this.player.eyeHeight;
    PLAYER_VIEW.held = this.inventory.held?.item ?? -1;
    // No criativo o jogador não é alvo — mas os mobs continuam andando por aí.
    PLAYER_VIEW.alive = !this.survival.isDead && this.player.mode === 'survival';

    this.mobs.tick(PLAYER_VIEW);
    this.spawner.tick(this.player.x, this.player.y, this.player.z);
    this.projectiles.tick(this.world);
  }

  /** Mantém a soma da armadura em sincronia com os slots equipados. */
  private syncArmor(): void {
    armorTotals(this.inventory.slots, this.armor);
    this.survival.armor = this.armor.defense;
    this.survival.armorToughness = this.armor.toughness;
    this.survival.protection = this.armor.protection;
    // A bota é a última peça da faixa de armadura (ver `armorSlotIndex`).
    this.survival.featherFalling = levelOf(this.inventory.get(ARMOR_END - 1), FEATHER_FALLING);
  }

  /** Pontos de armadura equipada, para a barra do HUD (doc 08 §3.4). */
  get armorPoints(): number {
    return this.armor.defense;
  }

  /** Exaustão por distância percorrida (doc 06 §7). */
  private trackMovement(): void {
    if (this.player.mode !== 'survival') {
      this.lastX = this.player.x;
      this.lastZ = this.player.z;
      return;
    }
    const dx = this.player.x - this.lastX;
    const dz = this.player.z - this.lastZ;
    const distance = Math.hypot(dx, dz);
    this.lastX = this.player.x;
    this.lastZ = this.player.z;

    if (distance <= 0) return;
    if (this.player.inWater) this.survival.addExhaustion(distance * EXHAUSTION.swimPerBlock);
    else if (this.player.sprinting) this.survival.addExhaustion(distance * EXHAUSTION.sprintPerBlock);
  }

  private tickFurnaces(): void {
    for (const container of this.containers.values()) {
      if (container instanceof Furnace) container.tick();
    }
  }

  /** Dano de queda, chamado quando o jogador encosta no chão. */
  applyFallDamage(distance: number): void {
    if (this.player.mode !== 'survival') return;
    if (this.player.inWater) return;
    this.survival.applyFallDamage(distance);
  }

  // --- ações do jogador -----------------------------------------------------

  /**
   * Clique direito mirando um mob: doma com o item certo (doc 07 §2).
   * Devolve true se o mob consumiu o clique.
   */
  useOnMob(dx: number, dy: number, dz: number): boolean {
    const held = this.inventory.held;
    if (held === null) return false;
    const name = itemDef(held.item)?.name;
    if (name === undefined) return false;

    const eyeY = this.player.y + this.player.eyeHeight;
    const index = this.mobs.pickTarget(
      this.player.x, eyeY, this.player.z, dx, dy, dz, this.player.reach,
    );
    if (index < 0) return false;

    const tame = this.mobs.tryTame(index, name);
    if (tame !== 'none') {
      if (this.player.mode === 'survival') this.inventory.consumeHeld();
      this.events.onMessage?.(tame === 'tamed' ? 'Domado!' : 'Não foi dessa vez');
      return true;
    }

    const feed = this.mobs.tryFeed(index, name);
    if (feed === 'none') return false;
    // Quem acabou de cruzar não come de novo: o item não some à toa.
    if (feed === 'wait') return true;
    if (this.player.mode === 'survival') this.inventory.consumeHeld();
    this.achievements.event('breed');
    return true;
  }

  /** Clique direito: abre contêiner, ara, planta ou come; senão, coloca bloco. */
  useHeld(): boolean {
    // Montar num barco vence tudo: o barco fica no chão e a mira acerta o
    // bloco debaixo dele.
    if (this.tryRide()) return true;
    const target = this.interaction.state.target;
    if (target !== null && this.tryBed(target.x, target.y, target.z)) return true;
    if (target !== null && this.tryToggle(target.x, target.y, target.z)) return true;
    if (target !== null && this.openContainerAt(target.x, target.y, target.z)) return true;
    if (this.tryPlaceBoat()) return true;
    if (this.tryCharge()) return true;
    // Roça antes de comer: cenoura e batata são semente e comida ao mesmo
    // tempo, e mirando a terra arada o que se quer é plantar.
    if (target !== null && this.tryFarm(target.x, target.y, target.z)) return true;
    if (this.tryEat()) return true;

    if (this.interaction.tryPlace(this.inventory.held)) {
      if (this.player.mode === 'survival') this.inventory.consumeHeld();
      return true;
    }
    return false;
  }

  /**
   * Abre ou fecha porta, portão e alçapão (doc 04 §2.5).
   * Devolve true se o bloco mirado é um deles — mesmo bloco não abre duas vezes
   * no mesmo clique porque o cooldown de colocação segura o botão.
   */
  private tryToggle(x: number, y: number, z: number): boolean {
    const current = this.world.getBlock(x, y, z);
    const next = toggleOpenState(current);
    if (next < 0) return false;
    if (!this.world.setBlock(x, y, z, next, 'player')) return false;
    this.lighting.onBlockChanged(x, y, z, current, next);
    this.events.onSound?.('block/door', x, y, z);
    return true;
  }

  /**
   * Ataque corpo-a-corpo na direção do olhar (doc 05 §2, doc 07 §2).
   *
   * Devolve true se havia um mob no caminho — o chamador usa isso para **não**
   * quebrar o bloco atrás dele. O cooldown é do item na mão: espada bate mais
   * rápido que machado.
   */
  attackAlong(dx: number, dy: number, dz: number): boolean {
    const eyeY = this.player.y + this.player.eyeHeight;
    const index = this.mobs.pickTarget(
      this.player.x, eyeY, this.player.z, dx, dy, dz, this.player.reach,
    );
    if (index < 0) return false;
    if (this.attackCooldown > 0) return true;

    const held = this.inventory.held;
    // No criativo o golpe mata de uma vez, como manda o modo: o jogador ali
    // está editando o mundo, não lutando com ele.
    const damage = this.player.mode === 'creative'
      ? CREATIVE_ATTACK_DAMAGE : attackDamageOf(held);
    this.attackCooldown = attackCooldownOf(held);
    this.survival.addExhaustion(EXHAUSTION.attack);

    const store = this.mobs.store;
    const px = store.x[index] - this.player.x;
    const pz = store.z[index] - this.player.z;
    const length = Math.hypot(px, pz) || 1;

    this.events.onSound?.('player/hit', store.x[index], store.centerY(index), store.z[index]);
    // Pilhagem é do golpe, não do mob: a espada em mãos no momento da morte é
    // que decide o drop extra.
    this.mobs.looting = levelOf(held, LOOTING);
    const type = store.type[index];
    const died = this.mobs.damage(index, damage, 'player');
    this.mobs.looting = 0;
    if (died) this.achievements.kill(mobDef(type).name);
    if (!died) {
      // Empurrão só depois do dano: se ele morreu, este índice já é outro mob.
      store.vx[index] += (px / length) * HIT_KNOCKBACK;
      store.vz[index] += (pz / length) * HIT_KNOCKBACK;
      if (store.onGround[index] === 1) store.vy[index] = HIT_KNOCKBACK_UP;
    }

    // A arma gasta durabilidade ao acertar, não ao quebrar bloco.
    const def = held === null ? undefined : itemDef(held.item);
    if (this.player.mode === 'survival' && def?.durability !== undefined
      && !skipDurability(held, Math.random())) {
      this.inventory.damageHeld(1, def.durability);
    }
    return true;
  }

  /** Dano no jogador com empurrão. Usado por mob, flecha e explosão. */
  private hurtPlayer(
    amount: number, cause: 'mob' | 'arrow' | 'explosion', pushX: number, pushZ: number,
  ): void {
    if (this.player.mode !== 'survival') return;
    // Escudo levantado: o golpe que vem de frente perde a maior parte da força
    // e gasta durabilidade da peça (doc 14 — M6).
    let damage = amount;
    if (this.isBlocking && this.facesAttack(pushX, pushZ)) {
      damage *= 1 - SHIELD_REDUCTION;
      this.damageShield();
    }
    if (!this.survival.damage(damage, cause)) return;
    this.player.vx += pushX;
    this.player.vz += pushZ;
    if (this.player.onGround) this.player.vy = HIT_KNOCKBACK_UP;
  }

  /**
   * true se o golpe veio de frente. O empurrão aponta **para longe** do
   * atacante, então o produto escalar com o olhar é negativo quando ele está
   * na cara do jogador.
   */
  private facesAttack(pushX: number, pushZ: number): boolean {
    if (pushX === 0 && pushZ === 0) return true;
    const lookX = -Math.sin(this.player.yaw);
    const lookZ = Math.cos(this.player.yaw);
    return lookX * pushX + lookZ * pushZ < 0;
  }

  /** O escudo que aparou o golpe gasta durabilidade. */
  private damageShield(): void {
    const held = this.inventory.held;
    const def = held === null ? undefined : itemDef(held.item);
    if (def?.durability === undefined) return;
    if (skipDurability(held, Math.random())) return;
    this.inventory.damageHeld(1, def.durability);
  }

  /** Gasta durabilidade das peças equipadas (doc 05 §3). */
  private damageArmor(damage: number): void {
    if (this.player.mode !== 'survival') return;
    const cost = armorDurabilityCost(damage);
    for (let i = ARMOR_START; i < ARMOR_END; i++) {
      const stack = this.inventory.get(i);
      if (stack === null) continue;
      const durability = itemDef(stack.item)?.durability;
      if (durability === undefined) continue;
      if (skipDurability(stack, Math.random())) continue;
      stack.damage += cost;
      if (stack.damage >= durability) this.inventory.set(i, null);
    }
    this.syncArmor();
  }

  /**
   * Um mob derrubou um bloco (zumbi arrombando porta, doc 06 §10). Não dropa
   * item: a porta arrombada some, como no original.
   */
  breakBlockByMob(x: number, y: number, z: number): void {
    const previous = this.world.getBlock(x, y, z);
    if (previous === AIR) return;
    if (!this.world.setBlock(x, y, z, AIR, 'physics')) return;
    this.lighting.onBlockChanged(x, y, z, previous, AIR);
    this.fluids.scheduleAround(x, y, z);
    this.events.onSound?.(blockSound(defOf(previous).sound, 'break'), x, y, z);
  }

  /** Explosão de creeper ou TNT: quebra blocos, machuca quem estiver perto. */
  explodeAt(x: number, y: number, z: number, power: number): void {
    this.events.onSound?.('player/explode', x, y, z);
    explode(this.world, x, y, z, power, {
      onBlockRemoved: (bx, by, bz, previous) => {
        this.lighting.onBlockChanged(bx, by, bz, previous, AIR);
        this.removeContainerAt(bx, by, bz);
        this.fluids.scheduleAround(bx, by, bz);
      },
      onDrop: (stack, dx, dy, dz) => { this.items.spawn(dx, dy, dz, stack); },
      onDamage: (strength, ex, ey, ez, radius) => {
        const dx = this.player.x - ex;
        const dy = this.player.y + this.player.height * 0.5 - ey;
        const dz = this.player.z - ez;
        const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
        const damage = explosionDamage(strength, distance, radius);
        if (damage > 0) {
          const length = Math.hypot(dx, dz) || 1;
          this.hurtPlayer(damage, 'explosion', (dx / length) * 0.6, (dz / length) * 0.6);
        }
        // A explosão também machuca os outros mobs — inclusive o bando todo.
        const store = this.mobs.store;
        for (let i = 0; i < store.active; i++) {
          const mx = store.x[i] - ex;
          const my = store.centerY(i) - ey;
          const mz = store.z[i] - ez;
          const mobDistance = Math.sqrt(mx * mx + my * my + mz * mz);
          const mobDamage = explosionDamage(strength, mobDistance, radius);
          if (mobDamage > 0 && this.mobs.damage(i, mobDamage, 'fire')) i--;
        }
      },
    });
  }

  /**
   * Dormir: define o ponto de renascimento e pula para o amanhecer.
   * Devolve true se a cama foi usada (mesmo que o sono seja negado).
   */
  private tryBed(x: number, y: number, z: number): boolean {
    if (blockIdOf(this.world.getBlock(x, y, z)) !== BED) return false;

    this.spawnX = x;
    this.spawnY = y + 1;
    this.spawnZ = z;

    const result = trySleep(this.dayNight.time, this.hostilesNear(x, y, z));
    if (!result.ok) {
      this.events.onMessage?.(result.message);
      return true;
    }
    this.dayNight.setTimeOfDay(result.wakeTime);
    this.survival.health = Math.min(20, this.survival.health + 1);
    this.events.onMessage?.('Bom dia');
    this.events.onSound?.('ui/sleep', x, y, z);
    this.achievements.event('sleep');
    return true;
  }

  /** Quantos hostis existem num raio de 8 blocos (doc: dormir exige abrigo). */
  hostilesNear(x: number, y: number, z: number): number {
    const store = this.mobs.store;
    let count = 0;
    for (let i = 0; i < store.active; i++) {
      const category = mobDef(store.type[i]).category;
      if (category !== 'hostile') continue;
      const dx = store.x[i] - x;
      const dy = store.y[i] - y;
      const dz = store.z[i] - z;
      if (dx * dx + dy * dy + dz * dz <= 64) count++;
    }
    return count;
  }

  // --- encantamento (doc 14 — M6) -------------------------------------------

  /**
   * Estantes que contam para a mesa: as que estão a 2 blocos de distância, no
   * mesmo nível ou um acima, **com o caminho livre**.
   *
   * O bloco intermediário precisa ser transparente porque é isso que faz a
   * biblioteca ter formato: emparedar a mesa não vale como sala de estudo.
   */
  countBookshelves(x: number, y: number, z: number): number {
    let count = 0;
    for (let dy = 0; dy <= 1; dy++) {
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          // Só o anel externo: o que está colado na mesa não conta.
          if (Math.abs(dx) !== 2 && Math.abs(dz) !== 2) continue;
          if (blockIdOf(this.world.getBlock(x + dx, y + dy, z + dz)) !== BOOKSHELF) continue;
          // Caminho livre: o bloco no meio do caminho não pode ser sólido.
          const mx = x + (dx === 0 ? 0 : Math.sign(dx));
          const mz = z + (dz === 0 ? 0 : Math.sign(dz));
          if (defOf(this.world.getBlock(mx, y + dy, mz)).opaque) continue;
          count++;
          if (count >= MAX_BOOKSHELVES) return MAX_BOOKSHELVES;
        }
      }
    }
    return count;
  }

  /** As três ofertas da mesa aberta, para a UI desenhar. */
  get enchantOffers(): readonly EnchantOffer[] {
    return this.enchantTable.offers;
  }

  /** Estantes contadas na última abertura da mesa. */
  get enchantShelves(): number {
    return this.enchantTable.shelves;
  }

  /**
   * Compra a oferta `slot` da mesa aberta.
   *
   * Devolve o motivo de ter falhado, para a UI dizer o que faltou — silêncio
   * num botão que não funciona é o pior retorno possível.
   */
  buyEnchant(slot: number): 'ok' | 'no-offer' | 'no-level' | 'no-lapis' {
    if (this.openScreen !== 'enchanting') return 'no-offer';
    const offer = this.enchantTable.offers[slot];
    if (offer === undefined || offer.enchant < 0) return 'no-offer';

    const creative = this.player.mode === 'creative';
    if (!creative && this.enchantTable.lapis < offer.lapis) return 'no-lapis';
    if (!creative && !this.xp.canAfford(offer.cost)) return 'no-level';

    // No criativo a mesa também precisa do lápis? Não: criativo não paga nada,
    // mas a oferta ainda tem que existir e o item tem que estar lá.
    if (creative) {
      const stack = this.enchantTable.get(ENCHANT_ITEM);
      if (stack === null) return 'no-offer';
      this.enchantTable.slots[ENCHANT_LAPIS] = {
        item: LAPIS, count: offer.lapis, damage: 0,
      };
    }

    if (!this.enchantTable.apply(slot)) return 'no-offer';
    if (!creative) this.xp.spend(offer.cost);
    this.events.onSound?.('ui/enchant', this.player.x, this.player.y, this.player.z);
    this.achievements.event('enchant');
    return 'ok';
  }

  /**
   * Chamado pela UI ao mexer nos slots da mesa: as ofertas dependem do item.
   */
  refreshEnchantOffers(): void {
    this.enchantTable.refresh();
  }

  /**
   * Entrega a experiência acumulada por uma fornalha (doc 05 §7).
   * Chamado pela UI quando o jogador tira o item do slot de saída.
   */
  collectFurnaceXp(furnace: Furnace, item = -1): void {
    if (item >= 0) this.noteObtained(item);
    const amount = Math.floor(furnace.storedXp);
    if (amount <= 0) return;
    furnace.storedXp -= amount;
    this.orbs.spawn(furnace.x + 0.5, furnace.y + 1, furnace.z + 0.5, amount);
  }

  /**
   * Enxada no chão ou semente na terra arada (doc 14 — M6).
   * Devolve true se a ação aconteceu.
   */
  private tryFarm(x: number, y: number, z: number): boolean {
    const held = this.inventory.held;
    if (tillSoil(this.world, x, y, z, held)) {
      this.events.onSound?.('block/dig_gravel', x, y, z);
      this.damageTool();
      return true;
    }
    if (plantSeed(this.world, x, y, z, held)) {
      this.events.onSound?.('block/dig_grass', x, y + 1, z);
      if (this.player.mode === 'survival') this.inventory.consumeHeld();
      return true;
    }
    return false;
  }

  /** Segurar o botão come, se o item for comida e houver fome. */
  private tryEat(): boolean {
    const stack = this.inventory.held;
    if (stack === null) return false;
    const food = itemDef(stack.item)?.food;
    if (food === undefined) return false;
    if (!this.survival.canEat) return false;

    this.eatTicks++;
    if (this.eatTicks < food.eatTicks) return true;
    this.eatTicks = 0;
    this.survival.eat(food.hunger, food.saturation);
    this.inventory.consumeHeld();
    return true;
  }

  cancelEating(): void {
    this.eatTicks = 0;
    this.releaseCharge();
  }

  // --- arco, escudo e barco (doc 14 — M6) -----------------------------------

  /**
   * Segurar o botão com arco ou escudo na mão.
   * Devolve true enquanto o item consome o clique.
   */
  private tryCharge(): boolean {
    const held = this.inventory.held;
    const kind = held === null ? undefined : itemDef(held.item)?.charge;
    if (kind === undefined) return false;
    // Arco sem flecha não carrega (no criativo, carrega sempre).
    if (kind === 'bow' && this.player.mode === 'survival'
      && this.inventory.countOf(ARROW) <= 0) {
      return false;
    }
    this.bowCharge++;
    return true;
  }

  /**
   * Soltou o botão: o arco dispara com a força acumulada, o escudo só baixa.
   *
   * Chamado por `cancelEating`, que é o caminho por onde `main.ts` avisa que o
   * botão foi solto — vale para os dois itens de segurar.
   */
  private releaseCharge(): void {
    const charge = this.bowCharge;
    this.bowCharge = 0;
    if (charge <= 0) return;

    const held = this.inventory.held;
    const def = held === null ? undefined : itemDef(held.item);
    if (def?.charge !== 'bow') return;

    const full = def.chargeTicks ?? 20;
    const power = Math.min(1, charge / full);
    // Abaixo de 15% da carga a flecha "escorrega" da corda e não sai.
    if (power < 0.15) return;
    if (this.player.mode === 'survival' && !this.inventory.take(ARROW, 1)) return;

    forwardFrom(AIM, this.player.yaw, this.player.pitch);
    const speed = BOW_MIN_SPEED + (BOW_MAX_SPEED - BOW_MIN_SPEED) * power;
    const damage = BOW_MIN_DAMAGE + (BOW_MAX_DAMAGE - BOW_MIN_DAMAGE) * power;
    this.projectiles.spawn(
      this.player.x, this.player.y + this.player.eyeHeight, this.player.z,
      AIM[0] * speed, AIM[1] * speed, AIM[2] * speed, damage, true,
    );
    this.events.onSound?.('player/arrow', this.player.x, this.player.y, this.player.z);
    if (this.player.mode === 'survival' && def.durability !== undefined
      && !skipDurability(held, Math.random())) {
      this.inventory.damageHeld(1, def.durability);
    }
  }

  /** 0..1 da carga do arco, para o HUD e para a animação. */
  get chargeProgress(): number {
    const held = this.inventory.held;
    const def = held === null ? undefined : itemDef(held.item);
    if (def?.charge !== 'bow') return 0;
    return Math.min(1, this.bowCharge / (def.chargeTicks ?? 20));
  }

  /** true se o escudo está levantado agora (doc 14 — M6). */
  get isBlocking(): boolean {
    if (this.bowCharge <= 0) return false;
    return itemDef(this.inventory.held?.item ?? -1)?.charge === 'shield';
  }

  /** Coloca o barco na água mirada. */
  private tryPlaceBoat(): boolean {
    const held = this.inventory.held;
    if (held === null || itemDef(held.item)?.placesBoat !== true) return false;
    const target = this.interaction.state.target;
    if (target === null) return false;

    const x = target.x + target.nx + 0.5;
    const y = target.y + target.ny;
    const z = target.z + target.nz + 0.5;
    if (this.boats.spawn(x, y, z, this.player.yaw) < 0) return false;
    if (this.player.mode === 'survival') this.inventory.consumeHeld();
    this.events.onSound?.('block/chest', x, y, z);
    return true;
  }

  /** Monta no barco mais próximo, ou desce do que está pilotando. */
  private tryRide(): boolean {
    if (this.riding >= 0) {
      this.riding = -1;
      return true;
    }
    const index = this.boats.findNear(
      this.player.x, this.player.y, this.player.z, BOAT_MOUNT_RANGE,
    );
    if (index < 0) return false;
    this.riding = index;
    this.achievements.event('boat');
    return true;
  }

  get isRiding(): boolean {
    return this.riding >= 0;
  }

  /**
   * Rema o barco com o eixo de movimento do jogador.
   * Chamado por `main.ts` no lugar do tick de física do jogador.
   */
  driveBoat(forward: number): void {
    if (this.riding < 0) return;
    this.boats.drive(this.riding, forward, this.player.yaw);
  }

  /** Cola o jogador no barco que ele pilota, e o solta se o barco sumiu. */
  private syncRider(): void {
    if (this.riding < 0) return;
    if (this.riding >= this.boats.active) { this.riding = -1; return; }
    this.player.setPosition(
      this.boats.x[this.riding],
      this.boats.y[this.riding] + BOAT_SEAT_HEIGHT,
      this.boats.z[this.riding],
    );
    this.player.fallDistance = 0;
  }

  get eatProgress(): number {
    const stack = this.inventory.held;
    const food = stack === null ? undefined : itemDef(stack.item)?.food;
    if (food === undefined) return 0;
    return this.eatTicks / food.eatTicks;
  }

  /** Gasta durabilidade da ferramenta usada para quebrar. */
  private damageTool(): void {
    if (this.player.mode !== 'survival') return;
    const stack = this.inventory.held;
    if (stack === null) return;
    const def = itemDef(stack.item);
    if (def?.durability === undefined) return;
    if (skipDurability(stack, Math.random())) return;
    this.inventory.damageHeld(1, def.durability);
  }

  private spawnDrops(x: number, y: number, z: number, state: number): void {
    if (this.player.mode === 'creative') return;
    const held = this.inventory.held;
    const drops = rollDrops(
      state, stackTool(held), this.world.seed, x, y, z, held?.ench ?? 0,
    );
    for (const stack of drops) {
      this.items.spawn(x + 0.5, y + 0.25, z + 0.5, stack);
    }
  }

  /** Orbe de experiência do bloco quebrado (doc 04 §2.2). */
  private spawnBlockXp(x: number, y: number, z: number, state: number): void {
    if (this.player.mode === 'creative') return;
    const held = this.inventory.held;
    const amount = rollXp(
      state, stackTool(held), this.world.seed, x, y, z, held?.ench ?? 0,
    );
    if (amount > 0) this.orbs.spawn(x + 0.5, y + 0.5, z + 0.5, amount);
  }

  /**
   * Registra que o jogador **passou a ter** um item, para as conquistas.
   * Vale para coleta do chão, craft e retirada da fornalha — os três caminhos
   * por onde um item entra no inventário.
   */
  noteObtained(item: number): void {
    const name = itemDef(item)?.name;
    if (name !== undefined) this.achievements.obtain(name);
  }

  private dropItem(stack: ItemStack): void {
    this.items.spawn(this.player.x, this.player.y + 1.2, this.player.z, stack, true);
  }

  // --- contêineres ----------------------------------------------------------

  /** Cria o tile entity quando um baú ou fornalha é colocado. */
  private createContainerAt(x: number, y: number, z: number, blockId: number): void {
    if (blockId === FURNACE) {
      this.containers.set(positionKey(x, y, z), new Furnace(x, y, z));
    } else if (blockId === CHEST) {
      this.containers.set(positionKey(x, y, z), new Container('chest', CHEST_SLOTS, x, y, z));
    }
  }

  /** Remove o tile entity e dropa o conteúdo. */
  private removeContainerAt(x: number, y: number, z: number): void {
    const key = positionKey(x, y, z);
    const container = this.containers.get(key);
    if (container === undefined) return;
    this.containers.delete(key);
    for (const stack of container.slots) {
      if (stack !== null) this.items.spawn(x + 0.5, y + 0.5, z + 0.5, stack);
    }
    if (this.openContainer?.contains(container) === true) this.closeScreen();
  }

  /** Abre a tela do bloco mirado, se ele tiver uma. Devolve true se abriu. */
  private openContainerAt(x: number, y: number, z: number): boolean {
    const id = blockIdOf(this.world.getBlock(x, y, z));

    if (id === CRAFTING_TABLE) {
      this.clearBench();
      this.setScreen('crafting', this.benchGrid);
      return true;
    }
    if (id === ENCHANTING_TABLE) {
      this.enchantTable.shelves = this.countBookshelves(x, y, z);
      this.enchantTable.refresh();
      this.setScreen('enchanting', this.enchantTable);
      return true;
    }
    if (id === FURNACE || id === CHEST) {
      const container = this.containerAtOrCreate(x, y, z, id);
      if (id === FURNACE) {
        this.setScreen('furnace', container);
        return true;
      }
      // Baú colado em outro baú abre os dois de uma vez (doc 08 §3.9).
      const neighbor = this.findDoubleChest(x, y, z);
      this.setScreen('chest', neighbor === null ? container : neighbor);
      return true;
    }
    return false;
  }

  /** O contêiner da posição, criando na hora se o bloco veio da geração. */
  private containerAtOrCreate(x: number, y: number, z: number, blockId: number): Container {
    const key = positionKey(x, y, z);
    let container = this.containers.get(key);
    if (container === undefined) {
      container = blockId === FURNACE
        ? new Furnace(x, y, z)
        : new Container('chest', CHEST_SLOTS, x, y, z);
      this.containers.set(key, container);
    }
    return container;
  }

  /**
   * Visão de baú duplo, se houver um baú colado (doc 08 §3.9).
   *
   * A ordem é fixa — o baú de menor `(x, z)` fica com os primeiros 27 slots —
   * para que abrir pela esquerda ou pela direita mostre a mesma coisa.
   */
  findDoubleChest(x: number, y: number, z: number): DoubleChestView | null {
    const neighbors: [number, number][] = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (const [dx, dz] of neighbors) {
      const nx = x + dx;
      const nz = z + dz;
      if (blockIdOf(this.world.getBlock(nx, y, nz)) !== CHEST) continue;

      const here = this.containerAtOrCreate(x, y, z, CHEST);
      const there = this.containerAtOrCreate(nx, y, nz, CHEST);
      const hereFirst = x < nx || z < nz;
      return hereFirst ? new DoubleChestView(here, there) : new DoubleChestView(there, here);
    }
    return null;
  }

  setScreen(screen: OpenScreen, container: ContainerView | null): void {
    this.openScreen = screen;
    this.openContainer = container;
    this.events.onOpenScreen(screen, container);
  }

  toggleInventory(): void {
    if (this.openScreen === 'none') this.setScreen('inventory', null);
    else this.closeScreen();
  }

  closeScreen(): void {
    if (this.openScreen === 'none') return;
    // Devolve o que estiver na grade de craft, senão os itens somem.
    this.returnCraftGrid();
    this.setScreen('none', null);
  }

  /** Devolve os ingredientes da grade ao inventário ao fechar. */
  private returnCraftGrid(): void {
    for (let i = CRAFT_START; i < CRAFT_END; i++) {
      const stack = this.inventory.get(i);
      if (stack === null) continue;
      const leftover = this.inventory.give(stack.item, stack.count, stack.damage);
      this.inventory.set(i, null);
      if (leftover > 0) this.dropItem({ item: stack.item, count: leftover, damage: stack.damage });
    }
    this.returnGrid(this.benchGrid);
    this.returnGrid(this.enchantTable);
    this.inventory.set(CRAFT_RESULT, null);
  }

  /** Esvazia um contêiner temporário de volta para o inventário, ou no chão. */
  private returnGrid(container: Container): void {
    for (let i = 0; i < container.size; i++) {
      const stack = container.get(i);
      if (stack === null) continue;
      const leftover = this.inventory.give(
        stack.item, stack.count, stack.damage, stack.ench ?? 0,
      );
      container.set(i, null);
      if (leftover > 0) {
        this.dropItem({
          item: stack.item, count: leftover, damage: stack.damage, ench: stack.ench ?? 0,
        });
      }
    }
  }

  private clearBench(): void {
    for (let i = 0; i < this.benchGrid.size; i++) this.benchGrid.set(i, null);
  }

  // --- crafting -------------------------------------------------------------

  /** Grade ativa: 3×3 da bancada, ou 2×2 do inventário. */
  private currentGrid(): CraftGrid {
    if (this.openScreen === 'crafting') {
      return { size: 3, slots: this.benchGrid.slots };
    }
    return {
      size: 2,
      slots: [
        this.inventory.get(CRAFT_START), this.inventory.get(CRAFT_START + 1),
        this.inventory.get(CRAFT_START + 2), this.inventory.get(CRAFT_START + 3),
      ],
    };
  }

  /** Recalcula o slot de resultado a partir da grade ativa. */
  refreshCraftResult(): void {
    const result = this.recipes.match(this.currentGrid());
    this.inventory.slots[CRAFT_RESULT] = result;
  }

  /** Consome os ingredientes depois de retirar o resultado. */
  private consumeCraft(): void {
    const crafted = this.inventory.get(CRAFT_RESULT);
    if (crafted !== null) this.noteObtained(crafted.item);
    const grid = this.currentGrid();
    consumeGrid(grid);
    if (this.openScreen === 'crafting') {
      for (let i = 0; i < 9; i++) this.benchGrid.set(i, grid.slots[i]);
    } else {
      for (let i = 0; i < 4; i++) this.inventory.slots[CRAFT_START + i] = grid.slots[i];
    }
    this.refreshCraftResult();
  }

  /**
   * Preenche a grade aberta com uma receita do livro (doc 05 §6.4).
   *
   * Devolve o que já estava na grade antes, tira **uma** unidade de cada
   * ingrediente do inventário e põe na célula certa. Se faltar ingrediente,
   * desfaz tudo: meia receita na grade é pior que receita nenhuma.
   */
  autoFillRecipe(entry: RecipeEntry): boolean {
    const grid = this.currentGrid();
    const size = grid.size;
    if (entry.width > size || entry.height > size) return false;

    this.returnCraftGrid();
    const taken: number[] = [];

    for (let row = 0; row < entry.height; row++) {
      for (let column = 0; column < entry.width; column++) {
        const candidates = entry.cells[row * entry.width + column];
        if (candidates === null || candidates === undefined) continue;
        const item = this.takeOneOf(candidates);
        if (item < 0) {
          for (const back of taken) this.inventory.give(back, 1);
          this.returnCraftGrid();
          return false;
        }
        taken.push(item);
        this.setGridSlot(grid, row * size + column, { item, count: 1, damage: 0 });
      }
    }

    this.refreshCraftResult();
    return true;
  }

  /** Tira uma unidade do primeiro candidato que existir no inventário. */
  private takeOneOf(candidates: readonly number[]): number {
    for (const item of candidates) {
      for (let i = 0; i < CRAFT_START; i++) {
        const stack = this.inventory.get(i);
        if (stack === null || stack.item !== item || stack.damage !== 0) continue;
        stack.count--;
        if (stack.count <= 0) this.inventory.set(i, null);
        return item;
      }
    }
    return -1;
  }

  /** Escreve numa célula da grade ativa (bancada ou inventário). */
  private setGridSlot(grid: CraftGrid, index: number, stack: ItemStack): void {
    if (this.openScreen === 'crafting') this.benchGrid.set(index, stack);
    else this.inventory.slots[CRAFT_START + index] = stack;
    grid.slots[index] = stack;
  }

  /** A grade da bancada, para a UI desenhar. */
  get bench(): Container {
    return this.benchGrid;
  }

  // --- respawn --------------------------------------------------------------

  /**
   * Renasce no ponto da cama, se houver, senão no spawn do mundo.
   * `spawnX`/`spawnZ` são o spawn do mundo, não o do jogador.
   */
  respawn(spawnX: number, spawnZ: number): void {
    this.survival.respawn();
    const useBed = this.spawnY >= 0;
    const x = useBed ? this.spawnX : spawnX;
    const z = useBed ? this.spawnZ : spawnZ;
    const chunk = this.world.getChunk(x >> 4, z >> 4);
    const height = chunk?.heightMap[((z & 15) << 4) | (x & 15)] ?? 70;
    const y = useBed ? this.spawnY : Math.min(height + 1, WORLD_HEIGHT - 2);
    this.player.setPosition(x + 0.5, Math.min(y, WORLD_HEIGHT - 2), z + 0.5);
    this.player.fallDistance = 0;
  }

  /**
   * Chunk novo no mundo: popula com bichos, cataloga o que cresce nele e
   * resolve os marcos de estrutura (doc 03 §7).
   * Chamado pelo pipeline (`onChunkLoaded`).
   */
  onChunkLoaded(chunk: ChunkColumn): void {
    this.spawner.populateChunk(chunk);
    this.growth.scanChunk(chunk);
    this.applyStructures(chunk);
  }

  /** Chunk saindo de alcance: para de crescer o que estava registrado nele. */
  onChunkUnloaded(chunk: ChunkColumn): void {
    this.growth.forgetChunk(chunk.cx, chunk.cz);
    this.forgetSpawners(chunk.cx, chunk.cz);
  }

  /**
   * Transforma os marcos deixados pelo gerador em coisas vivas: baú com loot,
   * gerador de monstros registrado e aldeão no lugar.
   *
   * Um baú que **já existe** (veio do save) não é reabastecido — é o que
   * impede duplicar loot recarregando o mundo.
   */
  private applyStructures(chunk: ChunkColumn): void {
    for (const mark of chunk.structures) {
      if (mark.kind === 'chest') {
        this.fillLootChest(mark.x, mark.y, mark.z, mark.data);
      } else if (mark.kind === 'spawner') {
        this.spawners.set(positionKey(mark.x, mark.y, mark.z), {
          x: mark.x, y: mark.y, z: mark.z, mob: mark.data, cooldown: 0,
        });
      } else {
        const def = MOB_BY_NAME.get(mark.data);
        if (def !== undefined) this.mobs.store.spawn(def.id, mark.x + 0.5, mark.y, mark.z + 0.5);
      }
    }
    // Os marcos são consumidos uma vez; recarregar o chunk os regenera.
    chunk.structures.length = 0;
  }

  /** Baú de estrutura: enche na primeira vez que o chunk entra. */
  private fillLootChest(x: number, y: number, z: number, table: string): void {
    const key = positionKey(x, y, z);
    if (this.containers.has(key)) return;
    const container = new Container('chest', CHEST_SLOTS, x, y, z);
    // Fica no save mesmo vazio: um baú saqueado que não é salvo volta cheio.
    container.persistent = true;
    rollChestLoot(this.world.seed, x, y, z, table, (name, count) => {
      const item = ITEM_BY_NAME.get(name);
      if (item !== undefined) container.give(item.id, count);
    });
    this.containers.set(key, container);
  }

  /** Esquece os geradores do chunk que saiu de alcance. */
  private forgetSpawners(cx: number, cz: number): void {
    for (const [key, spawner] of this.spawners) {
      if ((spawner.x >> 4) === cx && (spawner.z >> 4) === cz) this.spawners.delete(key);
    }
  }

  /**
   * Geradores de monstros da dungeon (doc 03 §7).
   *
   * A regra é a mínima que faz a dungeon ser perigosa sem virar fábrica: só
   * com o jogador a menos de 16 blocos, com teto de 6 mobs daquele tipo por
   * perto, e um a cada 10 segundos.
   */
  private tickSpawners(): void {
    if (this.spawners.size === 0) return;
    for (const spawner of this.spawners.values()) {
      if (spawner.cooldown > 0) { spawner.cooldown--; continue; }
      const dx = this.player.x - spawner.x;
      const dy = this.player.y - spawner.y;
      const dz = this.player.z - spawner.z;
      if (dx * dx + dy * dy + dz * dz > SPAWNER_RANGE * SPAWNER_RANGE) continue;

      const def = MOB_BY_NAME.get(spawner.mob);
      if (def === undefined) continue;
      if (this.countNear(def.id, spawner.x, spawner.y, spawner.z) >= SPAWNER_CAP) {
        spawner.cooldown = SPAWNER_TICKS;
        continue;
      }

      const jitter = hash3(this.world.seed, spawner.x, spawner.y + this.spawnerTick, spawner.z, 0x5aa5);
      const ox = ((jitter & 3) - 1.5);
      const oz = (((jitter >>> 2) & 3) - 1.5);
      const index = this.mobs.store.spawn(def.id, spawner.x + 0.5 + ox, spawner.y, spawner.z + 0.5 + oz);
      if (index >= 0) this.events.onSound?.('block/furnace', spawner.x, spawner.y, spawner.z);
      spawner.cooldown = SPAWNER_TICKS;
    }
    this.spawnerTick++;
  }

  /** Quantos mobs deste tipo estão perto do gerador. */
  private countNear(type: number, x: number, y: number, z: number): number {
    const store = this.mobs.store;
    let count = 0;
    for (let i = 0; i < store.active; i++) {
      if (store.type[i] !== type) continue;
      const dx = store.x[i] - x;
      const dy = store.y[i] - y;
      const dz = store.z[i] - z;
      if (dx * dx + dy * dy + dz * dz <= SPAWNER_RANGE * SPAWNER_RANGE) count++;
    }
    return count;
  }

  /** O contêiner numa posição, se existir. */
  containerAt(x: number, y: number, z: number): Container | undefined {
    return this.containers.get(positionKey(x, y, z));
  }

  /** Todos os contêineres com conteúdo, para o save. */
  get tileEntities(): readonly Container[] {
    const out: Container[] = [];
    for (const container of this.containers.values()) {
      if (!container.isEmpty || container.persistent || container instanceof Furnace) {
        out.push(container);
      }
    }
    return out;
  }

  /** Restaura contêineres vindos do save. */
  restoreContainer(container: Container): void {
    this.containers.set(positionKey(container.x, container.y, container.z), container);
  }

  /** Semeia o bloco de estado após colocar — usado por `main.ts`. */
  static blockState(id: number): number {
    return makeState(id);
  }

  /** Ar como valor de bloco, exposto para testes. */
  static get AIR(): number {
    return AIR;
  }
}

function positionKey(x: number, y: number, z: number): number {
  return ((x & 0x3ffffff) * 0x4000000 + (z & 0x3ffffff)) * 128 + y;
}

/** Visão do jogador entregue aos mobs — reusada, nunca recriada por tick. */
const PLAYER_VIEW = { x: 0, y: 0, z: 0, eyeY: 0, held: -1, alive: true };
