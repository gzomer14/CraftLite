/**
 * Sessão de jogo: costura mundo, jogador, inventário, contêineres e save.
 *
 * Existe para tirar essa cola do `main.ts`, que ficaria grande demais, e para
 * que o loop de sobrevivência inteiro possa ser testado sem GL nem DOM.
 */

import { AIR, BLOCK_BY_NAME, blockIdOf, defOf } from '../data/blocks';
import { itemDef, stackTool, type ItemStack } from '../data/items';
import type { ContainerView } from './container';
import { Tiles } from './tiles';
import { Workbench, type OpenScreen } from './workbench';
import { SignStore, emptySignText } from './signs';
import { PlayerCombat } from './playercombat';
import { RecipeBook } from './crafting';
import type { ItemUseContext } from './itemuse';
import { ItemUser } from './itemuser';
import {
  applyStructures, mobEvents, wireInventory, wireProjectiles, wireSurvival,
} from './sessionwiring';
import { DayNight } from './daynight';
import { Weather } from './weather';
import { rollDrops, rollXp } from './drops';
import { skipDurability } from './enchanting';
import { Experience } from './xp';
import { Achievements } from './achievements';
import { Interaction } from './interaction';
import { Inventory } from './inventory';
import { EXHAUSTION, Survival } from './survival';
import { ItemEntities } from '../entity/itementity';
import { XpOrbs } from '../entity/xporb';
import { Mobs } from '../entity/mobs';
import { Projectiles } from '../entity/projectile';
import { Minecarts } from '../entity/minecart';
import { Vehicles } from './vehicles';
import { Rails } from '../world/rails';
import { forwardFrom, createVec3 } from '../core/math';
import { MobSpawner, capsForTier } from '../entity/spawn';
import { Player } from '../entity/player';
import { Fluids } from '../world/fluids';
import { Growth } from '../world/growth';
import { Fire } from '../world/fire';
import { FallingBlocks } from '../world/falling';
import { Redstone } from '../world/redstone';
import { WorldSystems } from './worldsystems';
import { Travel } from './travel';
import { breakPortalNear } from './portal';
import { BlockUse } from './blockuse';
import { SpawnerBlocks } from '../entity/spawnerblocks';
import { DIM_OVERWORLD, dimensionOf } from '../data/dimensions';
import { Lighting } from '../world/lighting';
import { WORLD_HEIGHT, type ChunkColumn } from '../world/chunk';
import type { World } from '../world/world';

const OAK_SIGN = BLOCK_BY_NAME.get('oak_sign')?.id ?? -1;

export type { VehicleRecord } from './vehicles';

export type { OpenScreen } from './workbench';

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
  /**
   * O jogador quer escrever numa placa (M8). Quem ouve abre o editor; a
   * sessão não conhece DOM e não sabe o que é um teclado.
   */
  onSignEdit?: (x: number, y: number, z: number, lines: readonly string[]) => void;
  /**
   * A dimensão vai mudar (M7): quem ouve troca pipeline, save e céu. Chamado
   * **antes** de o mundo novo ter chunk nenhum.
   */
  onDimensionChange?: (dimension: number) => void;
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
  /** Barco e carrinho do jogador (`game/vehicles.ts`). */
  readonly vehicles: Vehicles;
  readonly dayNight = new DayNight();
  readonly weather = new Weather();
  readonly achievements = new Achievements();
  readonly lighting: Lighting;
  readonly fluids: Fluids;
  readonly growth: Growth;
  readonly fire: Fire;
  readonly falling: FallingBlocks;
  /** A montagem dos sistemas acima (`game/worldsystems.ts`). */
  private readonly systems: WorldSystems;
  readonly redstone: Redstone;
  readonly rails: Rails;
  readonly travel: Travel;
  readonly interaction: Interaction;
  readonly recipes = new RecipeBook();

  /** Baú e fornalha no mundo (`game/tiles.ts`). */
  readonly tiles: Tiles;
  /** A tela aberta: grade, bancada, mesa (`game/workbench.ts`). */
  readonly workbench: Workbench;
  /** Texto das placas, a tile entity que não é contêiner (M8). */
  readonly signs = new SignStore();
  /** Geradores de monstros ativos, por posição empacotada (doc 03 §7). */
  readonly spawners: SpawnerBlocks;
  /** Cama, porta e bolo: o clique que é do bloco (`game/blockuse.ts`). */
  private readonly blockUse: BlockUse;

  private readonly events: SessionEvents;
  /** Posição do jogador no tick anterior, para a exaustão por distância. */
  private lastX = 0;
  private lastZ = 0;
  /** Quem usa o item na mão (`game/itemuse.ts`). */
  readonly itemUser: ItemUser;
  /** Ponto de renascimento; a cama muda isso. */
  spawnX = 0;
  spawnY = -1;
  spawnZ = 0;
  /** Golpe, escudo, armadura e explosão (`game/playercombat.ts`). */
  readonly combat: PlayerCombat;

  constructor(
    world: World, player: Player, events: SessionEvents, options: SessionOptions = {},
  ) {
    this.world = world;
    this.player = player;
    this.events = events;
    const systems = new WorldSystems(world, {
      spawnDrops: (x, y, z, state) => { this.spawnDrops(x, y, z, state); },
      drop: (stack, x, y, z) => { this.items.spawn(x, y, z, stack); },
      sound: (name, x, y, z) => { this.events.onSound?.(name, x, y, z); },
    });
    this.systems = systems;
    this.lighting = systems.lighting;
    this.fluids = systems.fluids;
    this.growth = systems.growth;
    this.redstone = systems.redstone;
    this.rails = systems.rails;
    this.fire = systems.fire;
    this.falling = systems.falling;
    /*
     * O detector é o caminho de volta do carrinho para o circuito: ele escreve
     * o bit de energizado do trilho, e o `Redstone` lê isso como emissor. Os
     * dois sistemas compartilham o voxel sem se atropelar porque cada um mexe
     * só nos seus bits (forma nos 0..3, energia no 4).
     */
    const carts = new Minecarts({
      onDetector: (x, y, z, occupied) => {
        this.rails.setPowered(x, y, z, occupied);
        this.events.onSound?.('block/click', x, y, z);
      },
    });
    this.vehicles = new Vehicles(player, carts, (kind) => { this.achievements.event(kind); });
    this.travel = new Travel(world, {
      // A travessia entra pelo mesmo caminho que o save e o renascimento.
      onDimensionChange: (dimension, x, z) => { this.enterDimension(dimension, x, z); },
      onArrive: (x, y, z) => {
        this.player.setPosition(x, y, z);
        this.player.vx = 0; this.player.vy = 0; this.player.vz = 0;
        this.player.fallDistance = 0;
        this.achievements.event(
          this.world.dimension === DIM_OVERWORLD ? 'return_overworld' : 'enter_nether',
        );
      },
      onMessage: (text) => this.events.onMessage?.(text),
    });
    this.interaction = new Interaction(world, player, this.lighting);
    this.tiles = new Tiles(world, {
      onChanged: (x, y, z, previous, state) => {
        this.lighting.onBlockChanged(x, y, z, previous, state);
      },
      onDrop: (stack, x, y, z) => { this.items.spawn(x, y, z, stack); },
    });
    this.workbench = new Workbench({
      world, player, inventory: this.inventory, recipes: this.recipes, tiles: this.tiles,
      xp: this.xp, achievements: this.achievements,
      onOpenScreen: (screen, container) => { this.events.onOpenScreen(screen, container); },
      sound: (name, x, y, z) => { this.events.onSound?.(name, x, y, z); },
      dropItem: (stack) => { this.dropItem(stack); },
      noteObtained: (item) => { this.noteObtained(item); },
      spawnOrb: (x, y, z, amount) => { this.orbs.spawn(x, y, z, amount); },
    });

    const maxMobs = options.maxMobs ?? 70;
    this.mobs = new Mobs(world, mobEvents(this, events), Math.max(32, maxMobs * 2));
    this.spawners = new SpawnerBlocks(this.mobs.store, world.seed, (x, y, z) => {
      this.events.onSound?.('block/furnace', x, y, z);
    });
    this.blockUse = new BlockUse({
      world, survival: this.survival, dayNight: this.dayNight, achievements: this.achievements,
      mobs: this.mobs.store,
      changed: (x, y, z, previous, state) => {
        this.lighting.onBlockChanged(x, y, z, previous, state);
      },
      sound: (name, x, y, z) => { this.events.onSound?.(name, x, y, z); },
      message: (text) => { this.events.onMessage?.(text); },
      setSpawn: (x, y, z) => { this.spawnX = x; this.spawnY = y; this.spawnZ = z; },
    });
    this.combat = new PlayerCombat({
      world, player, inventory: this.inventory, survival: this.survival, mobs: this.mobs,
      achievements: this.achievements,
      isBlocking: () => this.isBlocking,
      sound: (name, x, y, z) => { this.events.onSound?.(name, x, y, z); },
      blockRemoved: (x, y, z, previous) => {
        this.lighting.onBlockChanged(x, y, z, previous, AIR);
        this.removeContainerAt(x, y, z);
        this.fluids.scheduleAround(x, y, z);
      },
      drop: (stack, x, y, z) => { this.items.spawn(x, y, z, stack); },
    });
    this.spawner = new MobSpawner(
      world, this.mobs, capsForTier(maxMobs), options.simulationDistance ?? 4,
    );

    this.weather.setSeed(world.seed);
    // Mundo restaurado direto no Nether nasce sem céu, sem passar por portal.
    this.weather.hasSky = dimensionOf(world.dimension).hasSky;
    this.weather.onChange = (kind) => {
      if (kind === 'thunder') this.events.onMessage?.('A tempestade chegou');
      else if (kind === 'rain') this.events.onMessage?.('Começou a chover');
    };

    this.itemUser = new ItemUser({
      world, player, inventory: this.inventory, survival: this.survival,
      projectiles: this.projectiles, mobs: this.mobs.store,
      random: () => this.random(),
      blockChanged: (x, y, z, previous, state) => {
        this.lighting.onBlockChanged(x, y, z, previous, state);
        this.fluids.scheduleAround(x, y, z);
      },
      sound: (name, x, y, z) => { this.events.onSound?.(name, x, y, z); },
      drop: (stack, x, y, z) => { this.items.spawn(x, y, z, stack); },
      wearHeld: () => { this.damageTool(); },
      target: () => this.interaction.state.target,
      aim: this.interaction.aim,
      vehicles: this.vehicles,
      fire: this.fire,
      achievement: (name) => { this.achievements.event(name); },
    });
    wireInventory(this, events, (stack) => this.dropItem(stack));
    this.wireInteraction();
    wireSurvival(this, events);
    wireProjectiles(this, events);

    this.lastX = player.x;
    this.lastZ = player.z;
  }

  // --- ligação entre sistemas ---------------------------------------------

  private wireInteraction(): void {
    this.interaction.onBlockBroken = (x, y, z, state) => {
      this.survival.addExhaustion(EXHAUSTION.breakBlock);
      this.spawnDrops(x, y, z, state);
      this.spawnBlockXp(x, y, z, state);
      this.removeContainerAt(x, y, z);
      this.signs.remove(x, y, z);
      this.fluids.scheduleAround(x, y, z);
      this.breakPortalAround(x, y, z);
      this.damageTool();
    };
    this.interaction.onBlockPlaced = (x, y, z, state) => {
      this.tiles.create(x, y, z, blockIdOf(state));
      // Placa recém-plantada abre o editor sozinha: colocar e não poder
      // escrever obrigaria a descobrir que é preciso clicar nela de novo.
      if (blockIdOf(state) === OAK_SIGN) this.editSignAt(x, y, z);
      this.fluids.scheduleAround(x, y, z);
      this.achievements.place(defOf(state).name);
    };
  }

  // --- tick ----------------------------------------------------------------

  /** Um tick de sobrevivência. O tick de física do jogador é do chamador. */
  tick(): void {
    this.dayNight.tick();
    this.weather.update(this.dayNight.totalTicks);
    this.trackMovement();
    this.combat.tick();
    this.itemUser.tick();

    const head = Math.floor(this.player.y + this.player.eyeHeight);
    const bx = Math.floor(this.player.x);
    const bz = Math.floor(this.player.z);
    const headBlock = defOf(this.world.getBlock(bx, head, bz));

    if (this.player.mode === 'survival') {
      // Pés ou cabeça dentro da chama: o corpo inteiro conta, senão dava para
      // atravessar o incêndio agachado.
      const feet = defOf(this.world.getBlock(bx, Math.floor(this.player.y), bz));
      this.survival.tick({
        submerged: headBlock.name === 'water',
        inLava: this.player.inLava,
        onFire: feet.name === 'fire' || headBlock.name === 'fire',
        suffocating: headBlock.opaque && headBlock.solid,
        y: this.player.y,
      });
    }

    this.achievements.depth(Math.floor(this.player.y));
    this.items.tick(this.world, this.player.x, this.player.y, this.player.z);
    this.orbs.tick(this.world, this.player.x, this.player.y, this.player.z);
    this.vehicles.tick(this.world);
    this.rails.tick();
    this.vehicles.syncRider();
    this.systems.tick(this.weather.isRaining);
    this.tickRedstone();
    this.travel.tick(this.player.x, this.player.y, this.player.z);
    this.tiles.tick();
    this.spawners.tick(this.player.x, this.player.y, this.player.z);
    this.tickMobs();
  }

  /**
   * Circuito: primeiro quem pisa em placa, depois a fila de atualizações.
   *
   * A varredura de placas é do jogador e dos mobs — é O(mobs), sem registro de
   * posições, porque uma placa só interessa quando alguém está em cima dela.
   */
  private tickRedstone(): void {
    this.redstone.beginPlateScan();
    this.redstone.markEntity(this.player.x, this.player.y, this.player.z);
    const store = this.mobs.store;
    for (let i = 0; i < store.active; i++) {
      this.redstone.markEntity(store.x[i], store.y[i], store.z[i]);
    }
    this.redstone.endPlateScan();
    this.redstone.tick();
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

  /** Pontos de armadura equipada, para a barra do HUD (doc 08 §3.4). */
  get armorPoints(): number {
    return this.combat.armor.defense;
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

    // Ações de item em bicho (tesoura, balde na vaca, corante na ovelha).
    if (this.itemUser.onMob(held, index)) return true;

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

  /**
   * Entra numa dimensão sem portal: usado pelo save ao restaurar o mundo e pelo
   * renascimento. Quem troca pipeline, save e céu é quem ouve o evento.
   */
  enterDimension(dimension: number, x?: number, z?: number): void {
    if (dimension === this.world.dimension) return;
    /*
     * O evento vem **antes** da limpeza de propósito: quem ouve precisa ler
     * baús e veículos que ainda são desta dimensão para gravá-los. Invertendo a
     * ordem, o save encontraria as listas já vazias — e todo baú do Nether
     * sumiria ao voltar para casa.
     */
    this.events.onDimensionChange?.(dimension);
    this.clearForDimension();
    this.world.dimension = dimension;
    // Sem céu não chove: `hasSky` da tabela de dimensões existia desde o M7 e
    // ninguém a lia, então chovia no Nether — debaixo de um teto de rocha-mãe.
    this.weather.hasSky = dimensionOf(dimension).hasSky;
    /*
     * Quem chega por portal já sabe onde vai cair, e precisa estar lá **antes**
     * do próximo `pipeline.setCenter` — é a posição do jogador que decide onde
     * o mundo novo nasce. O Y é o de agora; o definitivo vem de `arriveAt`
     * quando o chunk chega. Renascimento e restauração do save não passam
     * coordenadas: eles posicionam o jogador por conta própria.
     */
    if (x !== undefined && z !== undefined) {
      this.player.setPosition(x + 0.5, this.player.y, z + 0.5);
    }
  }

  /** Clique direito: abre contêiner, ara, planta ou come; senão, coloca bloco. */
  useHeld(): boolean {
    // Montar num barco vence tudo: o barco fica no chão e a mira acerta o
    // bloco debaixo dele.
    if (this.vehicles.tryRide()) return true;
    const target = this.interaction.state.target;
    if (target !== null && this.blockUse.bed(target.x, target.y, target.z)) return true;
    // Alavanca, botão e repetidor respondem antes da porta: os três são
    // mecanismos de clique, e a porta é a única que também abre na mão.
    if (target !== null && this.redstone.use(target.x, target.y, target.z)) return true;
    if (target !== null && this.blockUse.toggle(target.x, target.y, target.z)) return true;
    if (target !== null && this.openContainerAt(target.x, target.y, target.z)) return true;
    if (target !== null && this.blockUse.cake(target.x, target.y, target.z)) return true;
    if (this.itemUser.use(this.inventory.held)) return true;

    if (this.interaction.tryPlace(this.inventory.held)) {
      if (this.player.mode === 'survival') this.inventory.consumeHeld();
      return true;
    }
    return false;
  }

  /** Quantos hostis existem num raio de 8 blocos (dormir exige abrigo). */
  hostilesNear(x: number, y: number, z: number): number {
    return this.blockUse.hostilesNear(x, y, z);
  }

  /**
   * Esvazia o que é da dimensão que está sendo deixada.
   *
   * Mob, item no chão, orbe, barco, flecha e contêiner vivem em coordenadas —
   * e as coordenadas do outro lado são de outro mundo. Inventário, vida, XP e
   * conquistas são do **jogador** e atravessam com ele.
   */
  private clearForDimension(): void {
    this.mobs.clear();
    this.items.clear();
    this.orbs.clear();
    this.projectiles.clear();
    this.falling.clear();
    this.vehicles.clear();
    this.tiles.clear();
    this.signs.clear();
    this.spawners.clear();
    this.workbench.closeScreen();
  }

  /**
   * Quebrar um pedaço da moldura apaga o portal inteiro (M7).
   *
   * Vale para a obsidiana **e** para o próprio bloco de portal: nos dois casos
   * o que sobraria seria um retângulo roxo furado, que continuaria teleportando.
   */
  private breakPortalAround(x: number, y: number, z: number): void {
    const at = breakPortalNear(this.world, x, y, z);
    if (at === null) return;
    this.lighting.onBlockChanged(at[0], at[1], at[2], 0, AIR);
    this.events.onSound?.('block/portal', at[0], at[1], at[2]);
  }

  /** Aleatório da sessão; os testes injetam um determinístico. */
  random: () => number = Math.random;

  /**
   * O botão de usar foi solto: encerra comer, dispara o arco e baixa o escudo.
   * O nome é histórico — `main.ts` chama isto todo tick sem o botão apertado.
   */
  cancelEating(): void {
    this.itemUser.release(this.inventory.held);
  }

  get chargeProgress(): number {
    return this.itemUser.chargeProgress(this.inventory.held);
  }

  get isBlocking(): boolean {
    return this.itemUser.isBlocking(this.inventory.held);
  }

  get eatProgress(): number {
    return this.itemUser.eatProgress(this.inventory.held);
  }

  /** O contexto das ações de item — exposto para os testes. */
  get useContext(): ItemUseContext {
    return this.itemUser.context;
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

  /**
   * Larga um item no mundo, arremessado **na direção do olhar**.
   *
   * Antes ele nascia com um empurrão aleatório de ±0,05 por eixo e caía nos
   * pés de quem o largou — dentro da caixa de coleta, que tem 1,3 de raio. Meio
   * segundo depois o próprio jogador o recolhia, e não havia como se livrar de
   * nada (relato de campo 2026-09-14). Agora ele sai para a frente, e o atraso
   * de coleta de `ItemEntities` cobre o resto.
   */
  private dropItem(stack: ItemStack): void {
    forwardFrom(this.dropDirection, this.player.yaw, this.player.pitch);
    this.items.spawn(
      this.player.x, this.player.y + 1.2, this.player.z, stack, this.dropDirection,
    );
  }

  /** Direção do arremesso, reusada — largar item não aloca. */
  private readonly dropDirection = createVec3();

  // --- contêineres no mundo: delegados a `game/tiles.ts` ----------------------

  /** Remove o tile entity, dropa o conteúdo e fecha a tela se era a dele. */
  private removeContainerAt(x: number, y: number, z: number): void {
    const removed = this.tiles.remove(x, y, z);
    if (removed !== undefined) this.workbench.onContainerRemoved(removed);
  }

  /** Abre a tela do bloco mirado, se ele tiver uma. Devolve true se abriu. */
  private openContainerAt(x: number, y: number, z: number): boolean {
    if (blockIdOf(this.world.getBlock(x, y, z)) === OAK_SIGN) {
      this.editSignAt(x, y, z);
      return true;
    }
    return this.workbench.open(x, y, z);
  }

  // --- respawn --------------------------------------------------------------

  /**
   * Renasce no ponto da cama, se houver, senão no spawn do mundo.
   * `spawnX`/`spawnZ` são o spawn do mundo, não o do jogador.
   */
  respawn(spawnX: number, spawnZ: number): void {
    this.survival.respawn();
    /*
     * Morrer fora da superfície devolve o jogador **à superfície**, não ao
     * ponto de renascimento com o Nether ainda carregado: a cama fica do outro
     * lado, e renascer com as coordenadas de lá dentro daqui é cair num mar de
     * lava. A troca de dimensão é a mesma do portal, sem portal.
     */
    this.enterDimension(DIM_OVERWORLD);
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
    this.systems.scanChunk(chunk);
    applyStructures(this, chunk);
  }

  /** Chunk saindo de alcance: para de crescer o que estava registrado nele. */
  onChunkUnloaded(chunk: ChunkColumn): void {
    this.systems.forgetChunk(chunk.cx, chunk.cz);
    this.spawners.forgetChunk(chunk.cx, chunk.cz);
  }

  /** Pede ao dono da UI que abra o editor da placa nesta posição. */
  private editSignAt(x: number, y: number, z: number): void {
    this.events.onSignEdit?.(x, y, z, this.signs.get(x, y, z) ?? emptySignText());
  }

  /** Escreve o texto da placa. Chamado pelo editor quando ele fecha. */
  writeSign(x: number, y: number, z: number, lines: readonly string[]): void {
    this.signs.set(x, y, z, lines);
  }

}

/** Visão do jogador entregue aos mobs — reusada, nunca recriada por tick. */
const PLAYER_VIEW = { x: 0, y: 0, z: 0, eyeY: 0, held: -1, alive: true };
