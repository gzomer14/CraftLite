/**
 * Regras de spawn e despawn natural (doc 07 §4).
 *
 * O ciclo roda **uma vez por segundo por categoria** e tenta poucas posições:
 * o custo tem que ser invisível no orçamento de tick de T0, e é melhor falhar
 * silenciosamente numa tentativa do que varrer o mundo procurando o lugar
 * perfeito.
 *
 * O cap é proporcional aos chunks carregados, não absoluto: com render distance
 * 4 o mundo simulado é 1/9 do de render distance 12, e um cap fixo encheria o
 * mapa pequeno de zumbis.
 *
 * E é proporcional ao tier: `capsForTier` deriva todas as categorias do
 * `maxMobs` do preset (doc 07 §4). Uma tabela por tier escrita à mão seria mais
 * um lugar para sair de sincronia com `core/tier.ts`.
 */

import { spawnVariant } from './husbandry';
import { BIOMES } from '../data/biomes';
import { DIM_OVERWORLD } from '../data/dimensions';
import { defOf } from '../data/blocks';
import { MOBS_BY_CATEGORY, mobDef, spawnRuleOf, type MobCategory, type SpawnRule } from '../data/mobs';
import { WORLD_HEIGHT } from '../world/chunk';
import type { ChunkColumn } from '../world/chunk';
import type { Mobs } from './mobs';
import type { World } from '../world/world';

/** Ticks entre ciclos de spawn (doc 07 §4). */
export const SPAWN_INTERVAL = 20;
/**
 * Fração do cap liberada pelo tanto de mundo carregado.
 *
 * Antes era `chunksCarregados / 289` **sem teto**, e a conta punia duas vezes:
 * `capsForTier` já reduz pelo tier, e isto reduzia de novo pela distância de
 * render. Medido no mesmo mundo, o teto de hostis saía assim:
 *
 *   T0 (RD 4, ~113 colunas):    8      ← devia ser 20
 *   T1 (RD 8, ~317 colunas):   44      ← devia ser 40
 *   T2 (RD 12, ~613 colunas): 148      ← devia ser 70
 *
 * Oito hostis espalhados por 113 colunas é o que fazia a caverna parecer vazia
 * em T0; e T2 estourava o próprio orçamento de aparelho do doc 02 §1. Saturar
 * em 1 conserta as duas pontas: o cap vira o teto do tier, e a escala só age
 * **para baixo**, enquanto o mundo ainda está carregando e um cap cheio
 * encheria de zumbi um punhado de chunks.
 *
 * A referência é a área **simulada** (onde o mob de fato vive e pensa), não a
 * de render.
 */
function readiness(loadedChunks: number, simulationDistance: number): number {
  const span = 2 * Math.max(1, simulationDistance) + 1;
  return Math.min(1, loadedChunks / (span * span));
}
/** Nunca nasce mais perto que isto do jogador. */
const MIN_PLAYER_DISTANCE = 24;
/**
 * Distância mínima, em chunks, do chunk sorteado ao do jogador.
 *
 * Era 2, o que empurrava o spawn para ≥32 blocos — exatamente onde o despawn
 * suave começa (`mobs.ts`, 1/800 por tick). Todo hostil nascia já condenado e
 * nenhum chegava perto: medido em 151 hostis vivos, **zero** dentro dos 16
 * blocos do `followRange`. Com 1, a faixa de 24 a 32 blocos volta a existir —
 * é lá que o mob nasce e sobrevive o bastante para te achar. Quem garante o
 * mínimo real continua sendo `MIN_PLAYER_DISTANCE`.
 */
const MIN_CHUNK_DISTANCE = 1;
/**
 * De noite, esta fração dos hostis nasce na superfície em vez de em qualquer
 * altura até ela. Sem isso o Y sorteado é uniforme de `minY` até a superfície,
 * e com o chão em y≈68 quase tudo cai dentro da pedra ou numa caverna: a noite
 * a céu aberto ficava vazia, que é o defeito que isto conserta.
 */
const NIGHT_SURFACE_CHANCE = 0.6;
/** Hostil não nasce mais longe que isto. */
const MAX_HOSTILE_DISTANCE = 128;
/**
 * Faixa vertical, em blocos, em volta do jogador de onde sai o Y de quem nasce
 * no escuro. Cobre a caverna em que ele está e as vizinhas sem sortear o
 * granito inteiro da coluna.
 */
const CAVE_Y_SPREAD = 16;
/** Chance de um chunk novo já nascer com um grupo de bichos (doc 07 §4). */
const INITIAL_PASSIVE_CHANCE = 0.1;
/** Fração do pool que os grupos de chunk novo podem ocupar. */
const POPULATE_POOL_SHARE = 0.5;

export interface SpawnCaps {
  hostile: number;
  passive: number;
  water: number;
  ambient: number;
}

/** Caps por tier: T0 usa os números reduzidos da tabela do doc 07 §4. */
export function capsForTier(maxMobs: number): SpawnCaps {
  const scale = maxMobs / 70;
  return {
    hostile: maxMobs,
    passive: Math.max(4, Math.round(10 * scale)),
    water: Math.max(1, Math.round(5 * scale)),
    ambient: Math.round(8 * scale),
  };
}

/**
 * Ordem de rodízio das categorias. Neutros (lobo, enderman) entram no cap dos
 * hostis: eles competem pelo mesmo orçamento de mobs do aparelho.
 */
const CATEGORIES: readonly MobCategory[] = ['hostile', 'passive', 'neutral', 'water', 'ambient'];

export class MobSpawner {
  private readonly world: World;
  private readonly mobs: Mobs;
  caps: SpawnCaps;
  /** Distância de simulação em chunks — o sorteio nunca sai dela. */
  simulationDistance: number;
  isNight = false;
  isDay = true;
  difficulty = 2;
  /**
   * Multiplicador de slime pela fase da lua (doc 03 §8). 1 = neutro; lua cheia
   * dobra, lua nova zera.
   */
  slimeFactor = 1;

  /**
   * Aleatório do jogo, injetável — mesmo motivo de `MobStore.random`: sem isto
   * nenhum teste de spawn é reproduzível, e a suíte falha às vezes sem causa
   * localizável.
   */
  random: () => number = Math.random;

  private tickCount = 0;
  /** Última categoria tentada, para alternar sem favorecer nenhuma. */
  private cursor = 0;
  /** Contadores expostos ao debug. */
  readonly lastAttempts = { tried: 0, spawned: 0 };

  constructor(world: World, mobs: Mobs, caps: SpawnCaps, simulationDistance: number) {
    this.world = world;
    this.mobs = mobs;
    this.caps = caps;
    this.simulationDistance = simulationDistance;
  }

  /** Um tick. O ciclo em si só roda a cada `SPAWN_INTERVAL`. */
  tick(playerX: number, playerY: number, playerZ: number): void {
    this.tickCount++;
    if (this.tickCount % SPAWN_INTERVAL !== 0) return;
    if (this.difficulty === 0) return;

    const category = CATEGORIES[this.cursor % CATEGORIES.length];
    this.cursor++;
    this.runCycle(category, playerX, playerY, playerZ);
  }

  /** Um ciclo de uma categoria (doc 07 §4, passos 1–7). */
  runCycle(category: MobCategory, playerX: number, playerY: number, playerZ: number): number {
    this.lastAttempts.tried++;
    const ids = MOBS_BY_CATEGORY[category];
    if (ids.length === 0) return 0;

    const loaded = this.world.chunkCount;
    if (loaded === 0) return 0;
    const ready = readiness(loaded, this.simulationDistance);
    const cap = Math.max(1, Math.round(this.caps[capKey(category)] * ready));
    if (this.mobs.countCategory(category) >= cap) return 0;

    const typeId = this.pickWeighted(ids);
    if (typeId < 0) return 0;
    const rule = spawnRuleOf(mobDef(typeId).name);
    if (rule === undefined) return 0;
    if (!this.allowedHere(rule)) return 0;
    if (rule.nightOnly === true && !this.isNight) return 0;

    // Escolhe um chunk carregado a distância 1..simulationDistance do jogador.
    const centerX = Math.floor(playerX) >> 4;
    const centerZ = Math.floor(playerZ) >> 4;
    const span = Math.max(2, this.simulationDistance);
    for (let attempt = 0; attempt < 4; attempt++) {
      const cx = centerX + this.randomInt(-span, span);
      const cz = centerZ + this.randomInt(-span, span);
      const distance = Math.max(Math.abs(cx - centerX), Math.abs(cz - centerZ));
      if (distance < MIN_CHUNK_DISTANCE) continue;
      const chunk = this.world.getChunk(cx, cz);
      if (chunk === undefined) continue;

      const spawned = this.trySpawnPack(chunk, rule, typeId, playerX, playerY, playerZ);
      if (spawned > 0) {
        this.lastAttempts.spawned += spawned;
        return spawned;
      }
    }
    return 0;
  }

  /**
   * Popula um chunk recém-gerado com um grupo de passivos (doc 07 §4).
   * É isso que faz o mundo já nascer com bichos em vez de esperar o ciclo.
   */
  populateChunk(chunk: ChunkColumn): number {
    if (this.random() > INITIAL_PASSIVE_CHANCE) return 0;
    // Sem cap de categoria (o mundo nasce com bichos), mas não além de metade
    // do pool: o resto é dos hostis, e das aldeias.
    if (this.mobs.count >= this.mobs.store.capacity * POPULATE_POOL_SHARE) return 0;
    const ids = MOBS_BY_CATEGORY.passive;
    if (ids.length === 0) return 0;
    const typeId = this.pickWeighted(ids);
    if (typeId < 0) return 0;
    const rule = spawnRuleOf(mobDef(typeId).name);
    if (rule === undefined || !this.allowedHere(rule)) return 0;
    // Sem restrição de distância do jogador: o chunk pode ser o de spawn.
    // O Y do jogador não entra: passivo nasce na superfície, não na faixa dele.
    return this.trySpawnPack(chunk, rule, typeId, Infinity, 0, Infinity);
  }

  /**
   * true se a regra vale na dimensão carregada (M7).
   *
   * Sem isto o zumbi nasceria no Nether e o ghast na superfície — e o peso do
   * sorteio é global, então metade das tentativas seria desperdiçada num mundo
   * onde nenhum dos dois pode nascer.
   */
  private allowedHere(rule: SpawnRule): boolean {
    const allowed = rule.dimension ?? DIM_OVERWORLD;
    return typeof allowed === 'number'
      ? allowed === this.world.dimension
      : allowed.includes(this.world.dimension);
  }

  /** Inteiro em [min, max] com a fonte de aleatório do spawner. */
  private randomInt(min: number, max: number): number {
    return randomIntFrom(this.random, min, max);
  }

  /** Sorteio ponderado pelo `weight` da regra de spawn. */
  private pickWeighted(ids: readonly number[]): number {
    let total = 0;
    for (let i = 0; i < ids.length; i++) total += this.weightOf(ids[i]);
    if (total <= 0) return -1;
    let roll = this.random() * total;
    for (let i = 0; i < ids.length; i++) {
      roll -= this.weightOf(ids[i]);
      if (roll <= 0) return ids[i];
    }
    return ids[ids.length - 1];
  }

  /** Peso do mob no sorteio, já com o efeito da lua sobre o slime. */
  private weightOf(id: number): number {
    const def = mobDef(id);
    const rule = spawnRuleOf(def.name);
    if (rule === undefined || !this.allowedHere(rule)) return 0;
    return def.name === 'slime' ? rule.weight * this.slimeFactor : rule.weight;
  }

  /** Tenta um grupo de 1..N do mesmo tipo em posições próximas. */
  private trySpawnPack(
    chunk: ChunkColumn, rule: SpawnRule, typeId: number,
    playerX: number, playerY: number, playerZ: number,
  ): number {
    const def = mobDef(typeId);
    const biome = BIOMES[chunk.biomeMap[this.randomInt(0, 255)]];
    if (rule.biomes.length > 0 && (biome === undefined || rule.biomes.indexOf(biome.name) < 0)) {
      return 0;
    }

    const lx = this.randomInt(0, 15);
    const lz = this.randomInt(0, 15);
    const baseX = (chunk.cx << 4) + lx;
    const baseZ = (chunk.cz << 4) + lz;
    const surface = chunk.heightMap[(lz << 4) | lx];
    const top = Math.min(rule.maxY, Math.max(rule.minY, surface + 1));
    // Quem precisa de escuro cava; de noite, a maioria fica na superfície.
    const atSurface = rule.light !== 'dark'
      || (this.isNight && this.random() < NIGHT_SURFACE_CHANCE);
    /*
     * Cavando, o Y sai de uma faixa em volta do **jogador**, não da coluna
     * inteira.
     *
     * Com o sorteio uniforme de `minY` até a superfície, quase todo Y caía
     * dentro de pedra maciça e era rejeitado; a superfície, que tem ar
     * garantido, aceitava sempre. O resultado medido com o jogador a 30 de
     * altura: de 16 hostis em 10 minutos, **10 nasceram na superfície** (40
     * blocos acima dele) e **nenhum** ficou ao alcance — de dentro da caverna
     * o mundo parecia não ter monstro nenhum (relato de campo 2026-09-12).
     * O jogador está num vão, então perto dele é onde há ar de verdade.
     */
    const baseY = atSurface
      ? top
      : clampY(Math.round(playerY) + this.randomInt(-CAVE_Y_SPREAD, CAVE_Y_SPREAD), rule.minY, top);

    const packSize = this.randomInt(rule.packMin, rule.packMax);
    let spawned = 0;
    // Passo 5 do doc: 3 posições próximas por membro do grupo.
    for (let member = 0; member < packSize; member++) {
      for (let attempt = 0; attempt < 3; attempt++) {
        const x = baseX + this.randomInt(-5, 5);
        const z = baseZ + this.randomInt(-5, 5);
        const y = baseY + (attempt === 0 ? 0 : this.randomInt(-2, 2));
        if (!this.isValidSpot(rule, def.height, x, y, z, playerX, playerZ)) continue;
        const variant = def.traits.splitsOnDeath === true
          ? this.randomInt(1, 3)
          : spawnVariant(def, this.random);
        if (this.mobs.spawn(typeId, x + 0.5, y, z + 0.5, variant) < 0) return spawned;
        spawned++;
        break;
      }
    }
    return spawned;
  }

  /** Passo 6 do doc: chão, espaço, luz e distância do jogador. */
  private isValidSpot(
    rule: SpawnRule, height: number,
    x: number, y: number, z: number, playerX: number, playerZ: number,
  ): boolean {
    if (y < Math.max(1, rule.minY) || y > Math.min(WORLD_HEIGHT - 3, rule.maxY)) return false;

    // Mede do centro do bloco, que é onde `trySpawnPack` põe o mob: medindo do
    // canto, o piso de 24 blocos vazava meio bloco para dentro.
    const dx = x + 0.5 - playerX;
    const dz = z + 0.5 - playerZ;
    const distance = Math.hypot(dx, dz);
    if (distance < MIN_PLAYER_DISTANCE) return false;
    if (rule.light === 'dark' && distance > MAX_HOSTILE_DISTANCE) return false;

    // Espaço livre para o corpo.
    const tall = Math.max(1, Math.ceil(height));
    for (let h = 0; h < tall; h++) {
      const def = defOf(this.world.getBlock(x, y + h, z));
      if (rule.inWater === true) {
        if (def.name !== 'water') return false;
      } else if (def.solid || def.name === 'water' || def.name === 'lava') {
        return false;
      }
    }

    if (rule.inWater !== true && !this.isValidGround(rule, x, y - 1, z)) return false;

    // Luz (doc 07 §4).
    const blockLight = this.world.getBlockLight(x, y, z);
    const skyLight = this.world.getSkyLight(x, y, z);
    if (rule.light === 'dark') {
      if (blockLight > 0) return false;
      if (skyLight > 7 && this.isDay) return false;
    } else if (rule.light === 'bright' && skyLight < 9) {
      return false;
    }
    return true;
  }

  private isValidGround(rule: SpawnRule, x: number, y: number, z: number): boolean {
    const def = defOf(this.world.getBlock(x, y, z));
    if (rule.ground.length > 0) return rule.ground.indexOf(def.name) >= 0;
    // Regra geral: chão sólido e opaco. Folha, vidro e laje não valem (doc 07 §4).
    if (!def.solid || !def.opaque) return false;
    if (def.name === 'bedrock') return false;
    return def.shape === 'cube';
  }
}

/** Prende o Y sorteado à faixa válida da regra. */
function clampY(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function capKey(category: MobCategory): keyof SpawnCaps {
  if (category === 'hostile' || category === 'neutral') return 'hostile';
  if (category === 'water') return 'water';
  if (category === 'ambient') return 'ambient';
  return 'passive';
}

/** Inteiro em [min, max], a partir de uma fonte de aleatório qualquer. */
function randomIntFrom(random: () => number, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}
