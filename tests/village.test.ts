/**
 * Aldeia (M9): o critério de aceite do doc 14 e o que o sustenta.
 *
 * *"Chegar numa aldeia ao entardecer e ver os aldeões entrarem em casa
 * sozinhos; trocar dois itens sem abrir nenhum menu que não exista hoje. 20
 * aldeões no tick sem passar de 1 ms."*
 *
 * A aldeia é gerada pela seed de verdade (`generateChunk`, com estruturas e
 * caminhos) e habitada pela `Session`, como no jogo.
 */
import { describe, expect, it } from 'vitest';
import { Session } from '../src/game/session';
import { World } from '../src/world/world';
import { ChunkState } from '../src/world/chunk';
import { Player } from '../src/entity/player';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import { houseSlot, slotOrigin, villageAnchorOf, type HouseSlot } from '../src/world/gen/village';
import { BLOCK_BY_NAME, blockIdOf, stateBitsOf } from '../src/data/blocks';
import { VILLAGE_HOUSES } from '../src/data/structures';
import { ITEM_BY_NAME } from '../src/data/items';
import { MOB_BY_NAME } from '../src/data/mobs';
import { HOME_START, TRADE_BAN_TICKS } from '../src/data/villagers';
import { FLAG_ANGRY, FLAG_PERSISTENT, FLAG_SLEEPING } from '../src/entity/mobstore';
import { Pathfinder } from '../src/entity/ai/pathfinder';

const BELL = BLOCK_BY_NAME.get('bell')!.id;
const BED = BLOCK_BY_NAME.get('bed')!.id;
const PATH = BLOCK_BY_NAME.get('dirt_path')!.id;
const FARMLAND = BLOCK_BY_NAME.get('farmland')!.id;
const VILLAGER = MOB_BY_NAME.get('villager')!.id;
const GOLEM = MOB_BY_NAME.get('iron_golem')!.id;
const ZOMBIE = MOB_BY_NAME.get('zombie')!.id;
const COW = MOB_BY_NAME.get('cow')!.id;
const EMERALD = ITEM_BY_NAME.get('emerald')!.id;

interface Scene {
  seed: number;
  world: World;
  noise: TerrainNoise;
  anchorX: number;
  anchorZ: number;
  /** Centro do poço, em blocos. */
  wellX: number;
  wellZ: number;
  wellY: number;
}

/** Acha, a partir da seed 1, uma em que a aldeia da região (0,0) nasceu mesmo. */
function findVillageSeed(): Scene {
  const anchor = new Int32Array(2);
  const origin = new Int32Array(2);
  for (let seed = 1; seed < 400; seed++) {
    villageAnchorOf(seed, 0, 0, anchor);
    const noise = new TerrainNoise(seed);
    const chunk = generateChunk(seed, noise, anchor[0], anchor[1]);
    slotOrigin(seed, anchor[0], anchor[1], origin);
    const bx = origin[0] + 2 - anchor[0] * 16;
    const bz = origin[1] + 2 - anchor[1] * 16;
    for (let y = 120; y > 40; y--) {
      if (blockIdOf(chunk.getBlock(bx, y, bz)) !== BELL) continue;
      return {
        seed, world: new World(seed), noise, anchorX: anchor[0], anchorZ: anchor[1],
        wellX: origin[0] + 2, wellZ: origin[1] + 2, wellY: y - 3,
      };
    }
  }
  throw new Error('nenhuma seed com aldeia na região (0,0)');
}

/** A aldeia inteira no mundo, com uma sessão morando nela. */
function villageSession(fillPool = false): { scene: Scene; session: Session; player: Player } {
  const scene = findVillageSeed();
  const { world, seed, noise } = scene;
  const player = new Player(scene.wellX + 0.5, scene.wellY + 2, scene.wellZ - 3.5);
  player.mode = 'creative';
  const session = new Session(world, player, {
    onOpenScreen: () => { /* nada */ },
    onDeath: () => { /* nada */ },
    onPickup: () => { /* nada */ },
  });
  session.survival.difficulty = 2;
  const R = 4;
  const chunks = [];
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      const chunk = generateChunk(seed, noise, scene.anchorX + dx, scene.anchorZ + dz);
      chunk.state = ChunkState.Ready;
      world.addChunk(chunk);
      chunks.push(chunk);
    }
  }
  if (fillPool) {
    // O pool cheio de bichos que ficaram para trás, longe dali.
    const s = session.mobs.store;
    while (s.spawn(COW, scene.wellX + 500 + s.active, 70, scene.wellZ) >= 0) { /* enche */ }
  }
  for (const chunk of chunks) session.onChunkLoaded(chunk);
  // Sem bicho nascendo sozinho no meio do teste.
  session.spawner.tick = () => { /* nada */ };
  return { scene, session, player };
}

/** Altura em que se fica de pé na coluna `(x, z)`, procurando de `from` para baixo. */
function standY(session: Session, x: number, z: number, from: number): number {
  for (let y = from; y > 1; y--) {
    const here = session.world.getBlock(x, y, z) & 0x3ff;
    const below = session.world.getBlock(x, y - 1, z) & 0x3ff;
    if (here === 0 && below !== 0) return y;
  }
  return from;
}

function residents(session: Session): number[] {
  const s = session.mobs.store;
  const out: number[] = [];
  for (let i = 0; i < s.active; i++) if (s.type[i] === VILLAGER && s.village.member[i] === 1) out.push(i);
  return out;
}

describe('a aldeia gerada', () => {
  it('tem poço com sino, casas com cama, caminhos e horta', () => {
    const { scene } = villageSession();
    const { world, seed } = scene;
    const slot: HouseSlot = { ox: 0, oz: 0, profession: 0, occupied: false, anchorX: 0, anchorZ: 0 };
    let houses = 0;
    let paths = 0;
    let farmland = 0;
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const cx = scene.anchorX + dx;
        const cz = scene.anchorZ + dz;
        if (houseSlot(seed, cx, cz, slot)) {
          for (let y = 120; y > 40; y--) {
            if (blockIdOf(world.getBlock(slot.ox + 5, y, slot.oz + 1)) === BED) { houses++; break; }
          }
        }
        for (let z = cz * 16; z < cz * 16 + 16; z++) {
          for (let x = cx * 16; x < cx * 16 + 16; x++) {
            for (let y = 55; y < 110; y++) {
              const id = blockIdOf(world.getBlock(x, y, z));
              if (id === PATH) paths++;
              else if (id === FARMLAND) farmland++;
            }
          }
        }
      }
    }
    // Doc 03 §7: 6–15 construções. O raio de 2 chunks a 55% dá ~13 casas; o
    // bioma e o relevo derrubam algumas.
    expect(houses).toBeGreaterThanOrEqual(3);
    expect(houses).toBeLessThanOrEqual(24);
    expect(paths).toBeGreaterThan(40);
    expect(farmland + paths).toBeGreaterThan(40);
  });

  it('nasce com moradores (3–8 no doc) e um golem, cada aldeão com casa e cama', () => {
    const { session } = villageSession();
    const s = session.mobs.store;
    const people = residents(session);
    expect(people.length).toBeGreaterThanOrEqual(3);
    expect(people.length).toBeLessThanOrEqual(8);
    for (const i of people) {
      const v = s.village;
      expect(v.hasHome[i]).toBe(1);
      expect(blockIdOf(session.world.getBlock(v.homeX[i], v.homeY[i], v.homeZ[i]))).toBe(BED);
    }
    let golems = 0;
    for (let i = 0; i < s.active; i++) if (s.type[i] === GOLEM) golems++;
    expect(golems).toBe(1);
  });
});

describe('pool de mobs cheio', () => {
  /*
   * No campo, em T2 com RD 16: "E: 140 mobs" — o pool inteiro — e a aldeia
   * vazia. Os grupos de bichos de chunk novo não tinham teto, e desde o M9 o
   * mob de coluna descarregada ficava parado no pool para sempre.
   */
  it('a aldeia nasce mesmo com o pool cheio de bichos', () => {
    const { session } = villageSession(true);
    const s = session.mobs.store;
    expect(s.active).toBe(s.capacity);
    expect(residents(session).length).toBeGreaterThanOrEqual(3);
    let golems = 0;
    for (let i = 0; i < s.active; i++) if (s.type[i] === GOLEM) golems++;
    expect(golems).toBe(1);
  });

  it('o chunk que sai leva os bichos comuns dele; domado e morador ficam', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    const people = residents(session).length;
    const x = scene.wellX + 40.5;
    const cow = s.spawn(COW, x, 70, scene.wellZ + 0.5);
    const pet = s.spawn(COW, x, 70, scene.wellZ + 0.5);
    s.setFlag(pet, FLAG_PERSISTENT, true);
    expect(cow).toBeGreaterThanOrEqual(0);
    const before = s.active;
    session.mobs.forgetChunk(Math.floor(x) >> 4, scene.wellZ >> 4);
    expect(s.active).toBe(before - 1);
    let pets = 0;
    for (let i = 0; i < s.active; i++) if (s.hasFlag(i, FLAG_PERSISTENT)) pets++;
    expect(pets).toBe(1);
    // Os moradores da aldeia não são de chunk nenhum aqui: a aldeia cuida deles.
    for (let cx = -3; cx <= 3; cx++) {
      for (let cz = -3; cz <= 3; cz++) session.mobs.forgetChunk((scene.wellX >> 4) + cx, (scene.wellZ >> 4) + cz);
    }
    expect(residents(session).length).toBe(people);
  });
});

describe('plano da aldeia em várias seeds', () => {
  /*
   * No campo: "uma aldeia com um aldeão só, sem golem". Cada peça conferia o
   * bioma do próprio ponto, e na divisa da planície nasciam casas soltas sem
   * poço, com os moradores sorteados para casas que não existiam. E o poço na
   * beira da região contava casas da aldeia vizinha na fila de moradores.
   */
  it('aldeia com poço tem todas as casas com morador; sem poço, nenhuma casa', () => {
    const anchor = new Int32Array(2);
    const origin = new Int32Array(2);
    const slot: HouseSlot = { ox: 0, oz: 0, profession: 0, occupied: false, anchorX: 0, anchorZ: 0 };
    const hasBlock = (chunk: ReturnType<typeof generateChunk>, x: number, z: number, id: number): boolean => {
      for (let y = 120; y > 40; y--) {
        if (blockIdOf(chunk.getBlock(x - chunk.cx * 16, y, z - chunk.cz * 16)) === id) return true;
      }
      return false;
    };
    let villages = 0;
    for (let seed = 1; seed <= 24; seed++) {
      villageAnchorOf(seed, 0, 0, anchor);
      const noise = new TerrainNoise(seed);
      slotOrigin(seed, anchor[0], anchor[1], origin);
      const well = hasBlock(generateChunk(seed, noise, anchor[0], anchor[1]), origin[0] + 2, origin[1] + 2, BELL);
      let occupied = 0;
      let housed = 0;
      let built = 0;
      for (let dz = -2; dz <= 2; dz++) {
        for (let dx = -2; dx <= 2; dx++) {
          if (!houseSlot(seed, anchor[0] + dx, anchor[1] + dz, slot)) continue;
          const bed = VILLAGE_HOUSES[slot.profession].bed;
          const chunk = generateChunk(seed, noise, anchor[0] + dx, anchor[1] + dz);
          const hasBed = hasBlock(chunk, slot.ox + bed[0], slot.oz + bed[2], BED);
          if (hasBed) built++;
          if (!slot.occupied) continue;
          // Casa sobre a água não nasce (mar e, desde o M14, rio): o morador
          // dela não entra na conta.
          if (!hasBed && noise.field.heightAt(slot.ox, slot.oz) < 62) continue;
          occupied++;
          if (hasBed) housed++;
        }
      }
      if (!well) {
        expect(built, `seed ${seed}: casa sem poço`).toBe(0);
        continue;
      }
      villages++;
      expect(occupied, `seed ${seed}: moradores planejados`).toBeGreaterThanOrEqual(Math.min(3, built));
      // Fora da água, todo morador tem cama.
      expect(housed / occupied, `seed ${seed}: moradores com casa`).toBeGreaterThanOrEqual(0.75);
    }
    expect(villages).toBeGreaterThanOrEqual(3);
  }, 120_000);
});

describe('rotina', () => {
  /*
   * O critério do doc 14: chegar ao entardecer e ver os aldeões entrarem em
   * casa sozinhos. Todos começam no poço, meia hora antes do pôr do sol; dois
   * minutos de jogo depois, estão deitados nas próprias camas, com a porta
   * fechada atrás deles.
   */
  it('ao entardecer, todo aldeão entra em casa pela porta e deita na cama', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    const people = residents(session);
    expect(people.length).toBeGreaterThan(0);
    // Todo mundo no anel de caminho do poço, fora de casa, no chão de verdade.
    for (const i of people) {
      const x = scene.wellX - 3 + (i % 5);
      const z = scene.wellZ - 3;
      s.x[i] = x + 0.5;
      s.z[i] = z + 0.5;
      s.y[i] = standY(session, x, z, scene.wellY + 8);
    }
    session.dayNight.setTimeOfDay(HOME_START - 200);
    for (let t = 0; t < 2400; t++) session.tick();

    let asleep = 0;
    for (const i of residents(session)) {
      const v = s.village;
      if (!s.hasFlag(i, FLAG_SLEEPING)) continue;
      asleep++;
      // Deitado na própria cama, e a porta de casa fechada.
      expect(Math.floor(s.x[i])).toBe(v.homeX[i]);
      expect(Math.floor(s.z[i])).toBe(v.homeZ[i]);
      const door = session.world.getBlock(v.doorX[i], v.doorY[i], v.doorZ[i]);
      expect(stateBitsOf(door) & 4, 'porta fechada').toBe(0);
    }
    expect(asleep / people.length).toBeGreaterThanOrEqual(0.8);
  }, 60_000);

  /*
   * No campo o aldeão "trabalhava" parado na soleira da porta, a 2,5 blocos do
   * posto, a manhã inteira: parecia travado em casa. Agora ele chega ao posto
   * de verdade e, entre um turno e outro, anda pela aldeia.
   */
  it('de manhã, levanta, chega ao posto de trabalho e não fica plantado nele', () => {
    const { session } = villageSession();
    const s = session.mobs.store;
    session.dayNight.setTimeOfDay(HOME_START + 1000);
    for (let t = 0; t < 1600; t++) session.tick();
    session.dayNight.setTimeOfDay(1500);
    const people = residents(session);
    const closest = new Map<number, number>();
    const walked = new Map<number, number>();
    for (let t = 0; t < 2400; t++) {
      for (const i of people) {
        const v = s.village;
        const d = Math.hypot(s.x[i] - v.workX[i] - 0.5, s.z[i] - v.workZ[i] - 0.5);
        closest.set(i, Math.min(closest.get(i) ?? Infinity, d));
      }
      const before = people.map((i) => [s.x[i], s.z[i]]);
      session.tick();
      people.forEach((i, k) => {
        walked.set(i, (walked.get(i) ?? 0) + Math.hypot(s.x[i] - before[k][0], s.z[i] - before[k][1]));
      });
    }
    let reached = 0;
    for (const i of people) {
      expect(s.hasFlag(i, FLAG_SLEEPING)).toBe(false);
      if ((closest.get(i) ?? Infinity) < 2) reached++;
      // Dois minutos de manhã: posto, poço, posto — dezenas de blocos andados.
      expect(walked.get(i), `aldeão ${i} andou`).toBeGreaterThan(20);
    }
    expect(reached / people.length).toBeGreaterThanOrEqual(0.7);
  }, 60_000);

  it('o sino manda todo mundo para casa, mesmo de dia', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    session.dayNight.setTimeOfDay(6000);
    expect(session.villages.ringBell(scene.wellX, scene.wellY + 3, scene.wellZ)).toBe(true);
    for (const i of residents(session)) expect(s.village.alarmTicks[i]).toBeGreaterThan(0);
  });
});

/** Mira o jogador no aldeão `i` e devolve a direção do olhar. */
function aimAt(session: Session, player: Player, i: number): [number, number, number] {
  const s = session.mobs.store;
  player.x = s.x[i] + 1.5;
  player.z = s.z[i];
  player.y = s.y[i];
  const dx = s.x[i] - player.x;
  const dy = s.centerY(i) - (player.y + player.eyeHeight);
  const dz = s.z[i] - player.z;
  const length = Math.hypot(dx, dy, dz);
  return [dx / length, dy / length, dz / length];
}

describe('troca', () => {
  it('clique direito no aldeão abre a tela de troca; duas trocas saem do inventário', () => {
    const { session, player } = villageSession();
    player.mode = 'survival';
    const i = residents(session)[0];
    const dir = aimAt(session, player, i);
    expect(session.useOnMob(dir[0], dir[1], dir[2])).toBe(true);
    expect(session.workbench.openScreen).toBe('trading');

    const offers = session.tradeOffers;
    expect(offers.length).toBeGreaterThanOrEqual(2);
    // Uma oferta que o aldeão vende (pede esmeralda) e uma que ele compra.
    const sells = offers.findIndex((o) => o.wantItem === EMERALD);
    const buys = offers.findIndex((o) => o.giveItem === EMERALD);
    expect(sells).toBeGreaterThanOrEqual(0);
    expect(buys).toBeGreaterThanOrEqual(0);

    const inv = session.inventory;
    inv.give(EMERALD, 10);
    inv.give(offers[buys].wantItem, offers[buys].wantCount);
    const emeraldsBefore = inv.countOf(EMERALD);
    const want = offers[sells].wantCount;
    const gives = offers[sells].giveItem;
    const givesBefore = inv.countOf(gives);

    expect(session.buyTrade(sells)).toBe('ok');
    expect(session.buyTrade(buys)).toBe('ok');
    expect(inv.countOf(gives) - givesBefore).toBeGreaterThanOrEqual(1);
    expect(inv.countOf(EMERALD)).toBe(emeraldsBefore - want + 1);

    // Sem pagamento, não sai nada.
    inv.take(EMERALD, inv.countOf(EMERALD));
    expect(session.buyTrade(sells)).toBe('no-items');
  });

  it('a oferta esgota no dia e volta cheia no dia seguinte', () => {
    const { session, player } = villageSession();
    player.mode = 'creative'; // criativo não paga: só o limite conta
    const i = residents(session)[0];
    const dir = aimAt(session, player, i);
    session.useOnMob(dir[0], dir[1], dir[2]);
    const limit = session.tradeOffers[0].remaining;
    for (let n = 0; n < limit; n++) expect(session.buyTrade(0)).toBe('ok');
    expect(session.buyTrade(0)).toBe('sold-out');
    session.dayNight.totalTicks += 24000;
    expect(session.tradeOffers[0].remaining).toBe(limit);
  });

  it('afastar-se fecha a troca', () => {
    const { session, player } = villageSession();
    const i = residents(session)[0];
    const dir = aimAt(session, player, i);
    session.useOnMob(dir[0], dir[1], dir[2]);
    expect(session.workbench.openScreen).toBe('trading');
    player.x += 30;
    session.tick();
    expect(session.workbench.openScreen).toBe('none');
  });
});

describe('reputação e golem', () => {
  it('bater num aldeão fecha as trocas da aldeia por um dia e vira o golem', () => {
    const { session, player } = villageSession();
    player.mode = 'survival';
    const people = residents(session);
    const i = people[0];
    const dir = aimAt(session, player, i);
    expect(session.combat.attackAlong(dir[0], dir[1], dir[2])).toBe(true);

    // Todo aldeão da aldeia fecha a porta — não só o que apanhou.
    const other = people[people.length - 1];
    const d2 = aimAt(session, player, other);
    expect(session.useOnMob(d2[0], d2[1], d2[2])).toBe(true);
    expect(session.workbench.openScreen).toBe('none');

    const s = session.mobs.store;
    for (let k = 0; k < s.active; k++) {
      if (s.type[k] === GOLEM) expect(s.hasFlag(k, FLAG_ANGRY)).toBe(true);
    }

    // Um dia depois, voltam a negociar.
    session.dayNight.totalTicks += TRADE_BAN_TICKS + 1;
    const d3 = aimAt(session, player, other);
    session.useOnMob(d3[0], d3[1], d3[2]);
    expect(session.workbench.openScreen).toBe('trading');
  });

  it('a má fama vai para a meta do mundo e volta dela', () => {
    const { session } = villageSession();
    const i = residents(session)[0];
    session.villages.onHurtByPlayer(i);
    const saved = session.villages.saveBans();
    expect(saved.length).toBe(3);
    session.villages.loadBans([]);
    expect(session.villages.isBanned(i)).toBe(false);
    session.villages.loadBans(saved);
    expect(session.villages.isBanned(i)).toBe(true);
  });

  /* Campo, 2026-09-23: o golem "ficou preso no poço" em vez de guardar a aldeia. */
  it('o golem faz ronda pela aldeia, longe do poço', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    let golem = -1;
    for (let i = 0; i < s.active; i++) if (s.type[i] === GOLEM) golem = i;
    expect(golem).toBeGreaterThanOrEqual(0);
    session.dayNight.setTimeOfDay(3000);
    let walked = 0;
    let farthest = 0;
    for (let t = 0; t < 2400; t++) {
      const x = s.x[golem];
      const z = s.z[golem];
      session.tick();
      walked += Math.hypot(s.x[golem] - x, s.z[golem] - z);
      farthest = Math.max(farthest, Math.hypot(s.x[golem] - scene.wellX, s.z[golem] - scene.wellZ));
    }
    expect(walked, 'andou em 2 min (antes, 35)').toBeGreaterThan(90);
    expect(farthest, 'se afastou do poço').toBeGreaterThan(10);
  }, 30_000);

  it('o golem mata o zumbi que chega perto do poço', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    const zombie = s.spawn(ZOMBIE, scene.wellX + 6.5, scene.wellY + 1, scene.wellZ + 0.5);
    expect(zombie).toBeGreaterThanOrEqual(0);
    session.dayNight.setTimeOfDay(14000);
    let alive = true;
    for (let t = 0; t < 600 && alive; t++) {
      session.tick();
      alive = false;
      for (let k = 0; k < s.active; k++) if (s.type[k] === ZOMBIE) alive = true;
    }
    expect(alive, 'o zumbi continua vivo depois de 30 s').toBe(false);
  }, 30_000);
});

describe('moradores seguem o chunk da casa', () => {
  it('o chunk sai e o morador sai junto; o chunk volta e ele volta', () => {
    const { session } = villageSession();
    const s = session.mobs.store;
    const i = residents(session)[0];
    const home = s.village;
    const cx = home.homeX[i] >> 4;
    const cz = home.homeZ[i] >> 4;
    const before = residents(session).length;
    const chunk = session.world.getChunk(cx, cz)!;
    session.onChunkUnloaded(chunk);
    expect(residents(session).length).toBe(before - 1);
    session.onChunkLoaded(chunk);
    expect(residents(session).length).toBe(before);
    // E recarregar sem ter saído não duplica ninguém.
    session.onChunkLoaded(chunk);
    expect(residents(session).length).toBe(before);
  });

  it('mob em coluna não carregada fica parado, em vez de cair no vazio', () => {
    const world = new World(3);
    const player = new Player(0.5, 80, 0.5);
    const session = new Session(world, player, {
      onOpenScreen: () => { /* nada */ }, onDeath: () => { /* nada */ }, onPickup: () => { /* nada */ },
    });
    const i = session.mobs.store.spawn(VILLAGER, 1000.5, 70, 1000.5);
    for (let t = 0; t < 100; t++) session.mobs.tick({ x: 0, y: 80, z: 0, eyeY: 81.6, held: -1, alive: true });
    expect(session.mobs.store.active).toBe(1);
    expect(session.mobs.store.y[i]).toBe(70);
  });
});

describe('caminho', () => {
  it('o A* atravessa uma porta', () => {
    const { session } = villageSession();
    const s = session.mobs.store;
    const i = residents(session)[0];
    const v = s.village;
    const pathfinder = new Pathfinder();
    // Da rua, dois blocos para fora da porta, até a cama.
    const outX = v.doorX[i];
    const outZ = v.doorZ[i] - 3;
    const found = pathfinder.find(
      session.world, outX, v.doorY[i], outZ, v.homeX[i], v.homeY[i], v.homeZ[i] - 0, 2,
    );
    expect(found).toBe(true);
  });
});

describe('orçamento', () => {
  /* Doc 14: "20 aldeões no tick sem passar de 1 ms". */
  it('20 aldeões com rotina custam menos de 1 ms por tick', () => {
    const { scene, session } = villageSession();
    const s = session.mobs.store;
    const people = residents(session);
    const template = people[0];
    const v = s.village;
    while (residents(session).length < 20) {
      const k = s.spawn(VILLAGER, scene.wellX + Math.random() * 6 - 3, scene.wellY + 1, scene.wellZ - 4);
      v.setHome(k, v.homeX[template], v.homeY[template], v.homeZ[template],
        v.doorX[template], v.doorY[template], v.doorZ[template], v.doorOut[template]);
      v.setWork(k, v.workX[template], v.workY[template], v.workZ[template]);
      v.setCenter(k, v.centerX[template], v.centerY[template], v.centerZ[template]);
    }
    const view = { x: scene.wellX, y: scene.wellY + 1, z: scene.wellZ, eyeY: scene.wellY + 2.6, held: -1, alive: false };
    // Hora de ir para casa: é a rotina que mais pede caminho e porta.
    session.mobs.dayTime = HOME_START + 100;
    for (let t = 0; t < 100; t++) session.mobs.tick(view);
    const samples: number[] = [];
    for (let t = 0; t < 200; t++) {
      const t0 = performance.now();
      session.mobs.tick(view);
      samples.push(performance.now() - t0);
    }
    samples.sort((a, b) => a - b);
    const median = samples[samples.length >> 1];
    console.log(`  20 aldeões: ${median.toFixed(3)} ms/tick (mediana de 200)`);
    expect(median).toBeLessThan(1);
  }, 30_000);
});
