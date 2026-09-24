/**
 * Liga o save ao jogo (doc 11).
 *
 * A camada de persistência (`save/`) já sabia gravar chunk, jogador e mundo; o
 * que faltava era **quem chama**. É este módulo: ele observa as mudanças de
 * bloco para marcar chunk sujo, responde ao pipeline quando um chunk pedido já
 * existe no disco, conta o autosave e serializa jogador e tile entities.
 *
 * Fica fora de `main.ts` de propósito: assim o ciclo inteiro
 * (gravar → recarregar → conferir) roda em teste, com um banco falso.
 *
 * O que **não** é salvo: nada que possa ser recalculado. Chunk nunca tocado
 * volta da seed, luz é recomputada ao carregar, e mob não persiste (doc 11 §2).
 * Item no chão persiste desde o M10: é o inventário da morte que o jogador
 * ainda vai buscar, e não se recalcula.
 */

import { ChunkColumn } from '../world/chunk';
import { computeChunkLight } from '../world/gen/terrain';
import { Container, Furnace, type ContainerKind } from './container';
import type { SignRecord } from './signs';
import { INVENTORY_SIZE } from './inventory';
import { TICKS_PER_DAY } from './daynight';
import { DIM_OVERWORLD } from '../data/dimensions';
import { AUTOSAVE_TICKS, type SaveManager } from '../save/savemanager';
import type { PlayerSave, WorldMeta } from '../save/db';
import type { Player } from '../entity/player';
import type { Session, VehicleRecord } from './session';
import { encodeRegion } from './worldmap';
import type { Marker } from './markers';
import type { ItemStack } from '../data/items';

/** Id do jogador local. O multiplayer do M7 vai usar outros (doc 12). */
export const LOCAL_PLAYER = 'local';

/**
 * Tile entity serializada. Duas famílias dividem a mesma lista no save: o
 * contêiner, que guarda itens, e a placa, que guarda texto (M8). O `kind`
 * separa as duas na leitura.
 */
export type TileRecord = ContainerRecord | SignRecord;

/** Contêiner serializado. `slots` são triplas [item, count, damage]. */
export interface ContainerRecord {
  kind: ContainerKind;
  x: number;
  y: number;
  z: number;
  slots: number[];
  /** Encantamentos, um inteiro por slot (M6). Ver `PlayerSave.enchants`. */
  enchants?: number[];
  /** Nomes da bigorna por slot (M15). Ver `PlayerSave.names`. */
  names?: (string | null)[];
  /** true = baú de estrutura, salvo mesmo vazio para não reabastecer (M6). */
  persistent?: boolean;
  /** Fornalha: [burnTicks, burnTotal, cookTicks]. */
  burn?: [number, number, number];
}

export interface SaveGameOptions {
  /** Chamado quando a gravação falha, para a UI avisar. */
  onError?: (message: string) => void;
  /**
   * Miniatura do mundo em PNG, ou `null` se não houver uma pronta.
   *
   * Quem tira a foto é o render (o canvas precisa estar desenhado no mesmo
   * quadro, ver `main.ts`); o save só a guarda. Fica como callback para este
   * módulo continuar testável sem canvas nenhum.
   */
  captureThumbnail?: () => Uint8Array | null;
}

export class SaveGame {
  private readonly manager: SaveManager;
  private readonly session: Session;
  private readonly player: Player;
  private readonly meta: WorldMeta;
  private readonly options: SaveGameOptions;
  private unsubscribe: (() => void) | null = null;
  /**
   * Troca de dimensão em andamento, ou `null`.
   *
   * Ver `loadChunk`: enquanto ela não termina, o save ainda responde com a
   * chave da dimensão **antiga**.
   */
  private switching: Promise<void> | null = null;

  constructor(
    manager: SaveManager, session: Session, player: Player, meta: WorldMeta,
    options: SaveGameOptions = {},
  ) {
    this.manager = manager;
    this.session = session;
    this.player = player;
    this.meta = meta;
    this.options = options;
    // Falha ao gravar chunk também é falha de save, e chega ao mesmo aviso.
    manager.onError = (message) => this.options.onError?.(message);
  }

  get worldMeta(): WorldMeta {
    return this.meta;
  }

  /**
   * Passa a observar o mundo. Toda mudança de bloco que não veio da geração
   * marca a coluna para gravação — é o gatilho que faltava para o autosave
   * ter o que gravar.
   */
  attach(): void {
    this.unsubscribe = this.session.world.onBlockChange((change) => {
      if (change.source === 'gen') return;
      const chunk = this.session.world.getChunk(change.x >> 4, change.z >> 4);
      if (chunk !== undefined) this.manager.markDirty(chunk);
    });
  }

  detach(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
  }

  /**
   * Chunk pedido pelo pipeline: devolve o do disco (se foi modificado alguma
   * vez) ou `null` para o worker gerar da seed.
   */
  /**
   * Troca a dimensão do save (M7).
   *
   * **Síncrono no que importa:** o instantâneo de baús e veículos é tirado
   * agora, antes de a `Session` limpar a lista, e só a gravação é adiada. Pela
   * mesma razão a ordem é sagrada — gravar com a chave antiga, virar a chave,
   * carregar com a nova.
   */
  switchDimension(dimension: number): void {
    const tiles = this.tileRecords();
    const vehicles = this.session.vehicles.snapshot();
    const items = this.session.items.snapshot();
    this.switching = this.finishSwitch(dimension, tiles, vehicles, items)
      .finally(() => { this.switching = null; });
  }

  private async finishSwitch(
    dimension: number, tiles: readonly TileRecord[], vehicles: readonly VehicleRecord[],
    items: readonly (number | string)[],
  ): Promise<void> {
    try {
      await this.manager.saveTiles(tiles);
      await this.manager.saveVehicles(vehicles);
      await this.manager.saveItems(items);
      // Isto grava os chunks pendentes — ainda com a chave antiga — e vira.
      await this.manager.setDimension(dimension);
      await this.loadDimensionState();
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Contêineres e placas da dimensão atual, na mesma lista. */
  private tileRecords(): TileRecord[] {
    const out: TileRecord[] = this.session.tiles.saved.map(tileFrom);
    for (const sign of this.session.signs.records()) out.push(sign);
    return out;
  }

  /** Um registro lido do save volta a ser placa ou contêiner. */
  private restoreTile(record: TileRecord): void {
    if (record.kind === 'sign') this.session.signs.restore(record);
    else this.session.tiles.restore(containerFrom(record));
  }

  /** Traz baús, placas e veículos da dimensão que acabou de entrar. */
  private async loadDimensionState(): Promise<void> {
    const tiles = await this.manager.loadTiles<TileRecord>();
    for (const record of tiles) this.restoreTile(record);
    this.session.vehicles.restore(await this.manager.loadVehicles<VehicleRecord>());
    this.session.items.restore(await this.manager.loadItems());
  }

  /**
   * Chunk pedido pelo pipeline, da dimensão em que o save está.
   *
   * **Espera a troca de dimensão terminar.** O pipeline vira de dimensão de
   * forma síncrona e começa a pedir chunk no mesmo tick; o save vira de forma
   * assíncrona, porque antes precisa gravar baús, veículos e as colunas que
   * estão saindo. Nessa fresta o pipeline pedia chunk do Nether e o save
   * respondia com a chave da superfície — um pedaço de campo, com grama e
   * chuva, plantado no meio do Nether (relato de campo 2026-09-13). É o
   * inverso exato da coluna de netherrack que apareceu na grama de manhã, e a
   * correção daquela **alargou** esta fresta, porque `setDimension` passou a
   * esperar a gravação de verdade.
   *
   * Segurar aqui é o lugar certo: o carregamento já é assíncrono, o pipeline
   * já sabe esperar, e a viagem tem tempo limite se algo travar.
   */
  async loadChunk(cx: number, cz: number): Promise<ChunkColumn | null> {
    if (this.switching !== null) await this.switching;
    const chunk = await this.manager.loadChunk(cx, cz);
    if (chunk === null) return null;
    // A luz não é salva (doc 11 §2): recalcula antes de entregar, senão a
    // coluna volta iluminada por igual e a caverna fica em pleno dia.
    computeChunkLight(chunk);
    return chunk;
  }

  /** Coluna saindo de alcance: grava se foi tocada. */
  unloadChunk(chunk: ChunkColumn): void {
    if (!chunk.modified) return;
    void this.manager.saveAndForget(chunk);
  }

  /**
   * Um tick. A cada `AUTOSAVE_TICKS` (60 s) grava **tudo**.
   *
   * Antes o autosave chamava só `manager.tick()`, que despeja **apenas os
   * chunks**. Jogador, baús e a meta do mundo tinham um único caminho de
   * gravação: o botão "Salvar e sair". Quem fechasse a aba perdia o conteúdo
   * dos baús e a hora do dia, e voltava com a posição da última saída limpa —
   * no celular, onde `beforeunload` quase nunca dispara, isso era o caso
   * comum, não a exceção (relato de campo 2026-09-12).
   */
  tick(): void {
    this.ticksSinceSave++;
    if (this.ticksSinceSave < AUTOSAVE_TICKS) return;
    this.ticksSinceSave = 0;
    void this.saveAll();
  }

  // --- jogador --------------------------------------------------------------

  /** Estado do jogador no formato do save. */
  snapshot(): PlayerSave {
    const inventory: number[] = new Array(INVENTORY_SIZE * 3).fill(0);
    const enchants: number[] = new Array(INVENTORY_SIZE).fill(0);
    let names: (string | null)[] | undefined;
    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const stack = this.session.inventory.get(i);
      if (stack === null) continue;
      inventory[i * 3] = stack.item;
      inventory[i * 3 + 1] = stack.count;
      inventory[i * 3 + 2] = stack.damage;
      enchants[i] = stack.ench ?? 0;
      if (stack.name !== undefined) {
        names ??= new Array<string | null>(INVENTORY_SIZE).fill(null);
        names[i] = stack.name;
      }
    }

    return {
      worldId: this.meta.id,
      playerId: LOCAL_PLAYER,
      x: this.player.x,
      y: this.player.y,
      z: this.player.z,
      yaw: this.player.yaw,
      pitch: this.player.pitch,
      health: this.session.survival.health,
      hunger: this.session.survival.hunger,
      saturation: this.session.survival.saturation,
      selected: this.session.inventory.selected,
      dimension: this.session.world.dimension,
      inventory,
      enchants,
      names,
      xp: this.session.xp.total,
      achievements: this.session.achievements.mask,
      effects: this.session.survival.effects.snapshot(),
      absorption: this.session.survival.absorption,
      bedSpawn: this.session.spawnY >= 0
        ? [this.session.spawnX, this.session.spawnY, this.session.spawnZ]
        : undefined,
      markers: this.session.journal.markers.snapshot(),
      stats: this.session.journal.stats.snapshot(),
      spectator: this.player.spectator ? true : undefined,
    };
  }

  /** Aplica um save de jogador ao estado vivo. */
  restore(saved: PlayerSave): void {
    /*
     * A dimensão vem **antes** da posição: sair do mundo dentro do Nether e
     * voltar precisa recarregar o Nether, senão o jogador reaparece com as
     * coordenadas de lá dentro da superfície — 8 vezes fora do lugar, e
     * possivelmente dentro de pedra maciça.
     */
    const dimension = saved.dimension ?? DIM_OVERWORLD;
    if (dimension !== this.session.world.dimension) {
      this.session.enterDimension(dimension);
    }
    this.player.setPosition(saved.x, saved.y, saved.z);
    this.player.yaw = saved.yaw;
    this.player.pitch = saved.pitch;
    this.session.survival.health = saved.health;
    this.session.survival.hunger = saved.hunger;
    this.session.survival.saturation = saved.saturation;
    this.session.survival.effects.restore(saved.effects, this.session.survival);
    if (saved.absorption !== undefined) this.session.survival.absorption = saved.absorption;
    this.session.inventory.select(saved.selected);
    this.session.xp.setTotal(saved.xp ?? 0);
    this.session.achievements.setMask(saved.achievements ?? 0);

    for (let i = 0; i < INVENTORY_SIZE; i++) {
      const item = saved.inventory[i * 3] ?? 0;
      const count = saved.inventory[i * 3 + 1] ?? 0;
      this.session.inventory.set(
        i,
        item > 0 && count > 0
          ? withName({
            item, count,
            damage: saved.inventory[i * 3 + 2] ?? 0,
            ench: saved.enchants?.[i] ?? 0,
          }, saved.names?.[i])
          : null,
      );
    }

    this.session.journal.markers.restore(saved.markers as Partial<Marker>[] | undefined);
    this.session.journal.stats.restore(saved.stats);
    this.player.spectator = saved.spectator === true && this.player.mode === 'creative';
    if (this.player.spectator) this.player.flying = true;

    if (saved.bedSpawn !== undefined) {
      this.session.spawnX = saved.bedSpawn[0];
      this.session.spawnY = saved.bedSpawn[1];
      this.session.spawnZ = saved.bedSpawn[2];
    }
  }

  /** Carrega jogador e tile entities. Devolve false se o mundo é novo. */
  private ticksSinceSave = 0;

  async load(): Promise<boolean> {
    const saved = await this.manager.loadPlayer(LOCAL_PLAYER);
    await this.loadDimensionState();

    // `time` do save é o total desde o início do mundo; o tick do dia sai dele.
    this.session.dayNight.totalTicks = this.meta.time;
    this.session.dayNight.time = this.meta.time % TICKS_PER_DAY;
    this.session.weather.setSeed(this.session.world.seed);
    this.session.survival.difficulty = this.meta.difficulty;
    this.session.villages.loadBans(this.meta.villageBans);
    this.session.journal.map.load(await this.manager.loadMapRegions());
    if (saved === undefined) return false;
    this.restore(saved);
    return true;
  }

  /** Grava tudo: chunks, jogador, tile entities e a meta do mundo. */
  async saveAll(): Promise<void> {
    try {
      this.meta.time = this.session.dayNight.totalTicks;
      this.meta.difficulty = this.session.survival.difficulty;
      this.meta.gameMode = this.player.mode;
      this.meta.villageBans = this.session.villages.saveBans();
      await this.manager.flush();
      await this.manager.savePlayer(this.snapshot());
      await this.manager.saveTiles(this.tileRecords());
      await this.manager.saveVehicles(this.session.vehicles.snapshot());
      await this.manager.saveItems(this.session.items.snapshot());
      await this.saveMap();
      // Mede **depois** de gravar os chunks: senão o número seria o do mundo
      // de antes deste save.
      await this.manager.measureWorld(this.meta);
      await this.manager.saveWorldMeta(this.meta);
      const png = this.options.captureThumbnail?.() ?? null;
      if (png !== null) await this.manager.saveThumbnail(png);
    } catch (error) {
      this.options.onError?.(error instanceof Error ? error.message : String(error));
    }
  }

  /** Grava as regiões do mapa que mudaram e apaga as que o teto esqueceu. */
  private async saveMap(): Promise<void> {
    const map = this.session.journal.map;
    if (map.dirty.size === 0 && map.forgotten.size === 0) return;
    const changed: [number, Uint8Array][] = [];
    for (const key of map.dirty) {
      const region = map.regions.get(key);
      if (region !== undefined) changed.push([key, encodeRegion(region)]);
    }
    const forgotten = [...map.forgotten];
    map.dirty.clear();
    map.forgotten.clear();
    await this.manager.saveMapRegions(changed, forgotten, [...map.regions.keys()]);
  }

  /**
   * Rede de segurança síncrona para o `beforeunload` (doc 11 §3): o IndexedDB
   * não termina a tempo, o `localStorage` termina.
   */
  writeEmergency(): void {
    this.manager.writeEmergency(this.snapshot());
  }
}

/** Container → registro serializável. */
export function tileFrom(container: Container): ContainerRecord {
  const slots: number[] = new Array(container.size * 3).fill(0);
  const enchants: number[] = new Array(container.size).fill(0);
  let names: (string | null)[] | undefined;
  for (let i = 0; i < container.size; i++) {
    const stack = container.get(i);
    if (stack === null) continue;
    slots[i * 3] = stack.item;
    slots[i * 3 + 1] = stack.count;
    slots[i * 3 + 2] = stack.damage;
    enchants[i] = stack.ench ?? 0;
    if (stack.name !== undefined) {
      names ??= new Array<string | null>(container.size).fill(null);
      names[i] = stack.name;
    }
  }

  const record: TileRecord = {
    kind: container.kind, x: container.x, y: container.y, z: container.z, slots, enchants,
  };
  if (names !== undefined) record.names = names;
  if (container.persistent) record.persistent = true;
  if (container instanceof Furnace) {
    record.burn = [container.burnTicks, container.burnTotal, container.cookTicks];
  }
  return record;
}

/** Registro serializado → container vivo. */
export function containerFrom(record: ContainerRecord): Container {
  const size = record.slots.length / 3;
  const container = record.kind === 'furnace'
    ? new Furnace(record.x, record.y, record.z)
    : new Container(record.kind, size, record.x, record.y, record.z);

  for (let i = 0; i < size && i < container.size; i++) {
    const item = record.slots[i * 3];
    const count = record.slots[i * 3 + 1];
    if (item > 0 && count > 0) {
      container.slots[i] = withName({
        item, count, damage: record.slots[i * 3 + 2], ench: record.enchants?.[i] ?? 0,
      }, record.names?.[i]);
    }
  }

  container.persistent = record.persistent === true;

  if (container instanceof Furnace && record.burn !== undefined) {
    container.burnTicks = record.burn[0];
    container.burnTotal = record.burn[1];
    container.cookTicks = record.burn[2];
  }
  return container;
}

/** A pilha com o nome do save, se houver um (M15). */
function withName(stack: ItemStack, name: string | null | undefined): ItemStack {
  if (typeof name === 'string' && name !== '') stack.name = name;
  return stack;
}
