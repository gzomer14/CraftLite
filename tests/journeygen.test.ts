/**
 * Geração do M16: a fortaleza do Nether, a da superfície e o End — e a
 * regressão dos marcos de estrutura que não atravessavam o worker.
 */
import { describe, expect, it } from 'vitest';
import { BLOCK_BY_NAME, blockIdOf, stateBitsOf } from '../src/data/blocks';
import { NetherNoise, generateNetherChunk } from '../src/world/gen/nether';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import {
  END_ISLAND_Y, END_SPAWN_Z, EXIT_RADIUS, EndNoise, PILLAR_COUNT, endArrivalX, endArrivalY, endPillars,
  exitPortalCells, generateEndChunk,
} from '../src/world/gen/end';
import {
  FORTRESS_REACH, FORTRESS_REGION, fortressCenter, nearestFortress,
} from '../src/world/gen/fortress';
import {
  RING, RING_MAX, RING_MIN, STRONGHOLD_COUNT, STRONGHOLD_FLOOR_Y, nearestStronghold, strongholdSites,
} from '../src/world/gen/strongholdsites';
import { PORTAL_CENTER, SHAFT } from '../src/world/gen/stronghold';
import { GenJobRunner } from '../src/workers/genjob';
import { DIM_END, DIM_NETHER, DIMENSIONS, dimensionOf } from '../src/data/dimensions';
import { ChunkPipeline, type WorkerLike } from '../src/world/pipeline';
import { World } from '../src/world/world';
import type { ChunkColumn, StructureMark } from '../src/world/chunk';
import type { WorkerRequest, WorkerResponse } from '../src/workers/protocol';

const block = (name: string): number => BLOCK_BY_NAME.get(name)!.id;
const SEED = 12345;

/** Gera as colunas do quadrado `[x0..x1]×[z0..z1]` (em blocos) com `gen`. */
function columns(
  x0: number, z0: number, x1: number, z1: number, gen: (cx: number, cz: number) => ChunkColumn,
): Map<string, ChunkColumn> {
  const out = new Map<string, ChunkColumn>();
  for (let cz = Math.floor(z0 / 16); cz <= Math.floor(z1 / 16); cz++) {
    for (let cx = Math.floor(x0 / 16); cx <= Math.floor(x1 / 16); cx++) {
      out.set(`${cx},${cz}`, gen(cx, cz));
    }
  }
  return out;
}

function blockAt(chunks: Map<string, ChunkColumn>, x: number, y: number, z: number): number {
  const chunk = chunks.get(`${Math.floor(x / 16)},${Math.floor(z / 16)}`);
  if (chunk === undefined) return -1;
  return chunk.getBlock(((x % 16) + 16) % 16, y, ((z % 16) + 16) % 16);
}

function marks(chunks: Map<string, ChunkColumn>): StructureMark[] {
  const out: StructureMark[] = [];
  for (const chunk of chunks.values()) out.push(...chunk.structures);
  return out;
}

describe('fortaleza do Nether', () => {
  const noise = new NetherNoise(SEED);
  const center = new Int32Array(3);
  fortressCenter(SEED, 0, 0, center);
  const [fx, fy, fz] = center;
  const chunks = columns(
    fx - FORTRESS_REACH, fz - FORTRESS_REACH, fx + FORTRESS_REACH, fz + FORTRESS_REACH,
    (cx, cz) => generateNetherChunk(SEED, noise, cx, cz),
  );

  it('cabe inteira na sua região, e o centro é o cruzamento aceso', () => {
    const size = FORTRESS_REGION * 16;
    expect(fx - FORTRESS_REACH).toBeGreaterThanOrEqual(0);
    expect(fx + FORTRESS_REACH).toBeLessThan(size);
    expect(fz - FORTRESS_REACH).toBeGreaterThanOrEqual(0);
    expect(fz + FORTRESS_REACH).toBeLessThan(size);
    expect(blockIdOf(blockAt(chunks, fx, fy, fz))).toBe(block('glowstone'));
    expect(blockIdOf(blockAt(chunks, fx + 2, fy, fz))).toBe(block('nether_bricks'));
    // A passagem sobre o cruzamento está livre.
    expect(blockIdOf(blockAt(chunks, fx, fy + 1, fz))).toBe(0);
  });

  it('dois geradores de blaze, baús e o jardim de verruga madura', () => {
    const all = marks(chunks);
    expect(all.filter((m) => m.kind === 'spawner' && m.data === 'blaze')).toHaveLength(2);
    expect(all.filter((m) => m.kind === 'chest' && m.data === 'nether_fortress').length).toBe(3);
    let ripe = 0;
    for (const chunk of chunks.values()) {
      for (let y = 30; y < 100; y++) {
        for (let z = 0; z < 16; z++) {
          for (let x = 0; x < 16; x++) {
            const state = chunk.getBlock(x, y, z);
            if (blockIdOf(state) === block('nether_wart') && stateBitsOf(state) === 3) ripe++;
          }
        }
      }
    }
    expect(ripe).toBeGreaterThanOrEqual(10);
  });

  it('os pilares descem até o chão', () => {
    // Debaixo de um canto do cruzamento, tijolo contínuo até bater em sólido.
    let y = fy - 1;
    while (y > 1 && blockIdOf(blockAt(chunks, fx - 4, y, fz - 4)) === block('nether_bricks')) y--;
    const below = blockIdOf(blockAt(chunks, fx - 4, y, fz - 4));
    expect(below).not.toBe(0);
    expect(below).not.toBe(block('lava'));
  });

  it('de qualquer ponto do Nether, a mais perto está a menos de ~300 blocos', () => {
    const out = new Int32Array(3);
    for (const [x, z] of [[0, 0], [500, -300], [-1200, 800], [37, 2049]]) {
      nearestFortress(SEED, x, z, out);
      expect(Math.hypot(out[0] - x, out[2] - z), `${x},${z}`).toBeLessThan(300);
    }
  });
});

describe('fortaleza da superfície', () => {
  it('três por mundo, no anel, a 120° uma da outra', () => {
    for (const seed of [1, 2, 99, 12345]) {
      const sites = strongholdSites(seed);
      expect(sites.length).toBe(STRONGHOLD_COUNT * 2);
      for (let i = 0; i < STRONGHOLD_COUNT; i++) {
        const d = Math.hypot(sites[i * 2], sites[i * 2 + 1]);
        expect(d).toBeGreaterThanOrEqual(RING_MIN - 1);
        expect(d).toBeLessThanOrEqual(RING_MAX + 1);
      }
    }
    // Quem nasce na origem tem uma a no máximo `RING_MAX`.
    const out = new Int32Array(2);
    nearestStronghold(SEED, 0, 0, out);
    expect(Math.hypot(out[0], out[1])).toBeLessThanOrEqual(RING_MAX + 1);
  });

  const noise = new TerrainNoise(SEED);
  const sites = strongholdSites(SEED);
  const [sx, sz] = [sites[0], sites[1]];
  const chunks = columns(sx - 26, sz - 41, sx + 26, sz + 9, (cx, cz) => generateChunk(SEED, noise, cx, cz));
  const [px, py, pz] = PORTAL_CENTER;
  const floor = STRONGHOLD_FLOOR_Y;

  it('a sala do portal: doze molduras em volta do vão sobre a lava', () => {
    let frames = 0;
    for (const [dx, dz] of RING) {
      const id = blockIdOf(blockAt(chunks, sx + px + dx, floor + py, sz + pz + dz));
      if (id === block('end_portal_frame') || id === block('end_portal_frame_eye')) frames++;
    }
    expect(frames).toBe(12);
    expect(blockIdOf(blockAt(chunks, sx + px, floor + py - 1, sz + pz))).toBe(block('lava'));
    expect(blockIdOf(blockAt(chunks, sx + px, floor + py, sz + pz))).toBe(0);
  });

  it('o poço tem escada do corredor até a superfície, com a luz na boca', () => {
    const x = sx + SHAFT[0];
    const z = sz + SHAFT[1];
    let top = floor + 1;
    while (blockIdOf(blockAt(chunks, x, top + 1, z)) === block('ladder')) top++;
    expect(blockIdOf(blockAt(chunks, x, floor + 1, z))).toBe(block('ladder'));
    // Acima do topo da escada, céu aberto (o anel da boca tem a saída).
    expect(top).toBeGreaterThan(60);
    expect(blockIdOf(blockAt(chunks, x, top + 2, z))).toBe(0);
    expect(blockIdOf(blockAt(chunks, x + 2, top + 1, z - 2))).toBe(block('glowstone'));
  });

  it('biblioteca e depósitos com baú: livros e pérolas', () => {
    const all = marks(chunks);
    expect(all.filter((m) => m.data === 'stronghold_library')).toHaveLength(1);
    expect(all.filter((m) => m.data === 'stronghold_corridor')).toHaveLength(4);
  });
});

describe('o End', () => {
  const noise = new EndNoise(SEED);
  const chunks = columns(-100, -100, 110, 100, (cx, cz) => generateEndChunk(SEED, noise, cx, cz));

  it('é a terceira dimensão da tabela, sem céu e com névoa própria', () => {
    expect(DIMENSIONS).toHaveLength(3);
    const def = dimensionOf(DIM_END);
    expect(def.name).toBe('end');
    expect(def.hasSky).toBe(false);
    expect(def.fog).not.toBeNull();
  });

  it('a ilha é de pedra do End, e em volta dela é vazio', () => {
    expect(blockIdOf(blockAt(chunks, 20, END_ISLAND_Y, 20))).toBe(block('end_stone'));
    for (let y = 0; y < 128; y++) expect(blockAt(chunks, 105, y, -95)).toBe(0);
  });

  it('dez colunas de obsidiana, com rocha-mãe no topo', () => {
    const pillars = endPillars(SEED);
    expect(pillars).toHaveLength(PILLAR_COUNT);
    for (const pillar of pillars) {
      expect(blockIdOf(blockAt(chunks, pillar.x, pillar.top, pillar.z))).toBe(block('obsidian'));
      expect(blockIdOf(blockAt(chunks, pillar.x, pillar.top + 1, pillar.z))).toBe(block('bedrock'));
      expect(pillar.top).toBeGreaterThan(END_ISLAND_Y + 15);
      expect(pillar.top).toBeLessThan(120);
    }
  });

  it('o portal de saída nasce apagado: bacia de rocha-mãe e o vão vazio', () => {
    expect(blockIdOf(blockAt(chunks, 0, END_ISLAND_Y + 4, 0))).toBe(block('bedrock'));
    expect(blockIdOf(blockAt(chunks, EXIT_RADIUS, END_ISLAND_Y + 1, 0))).toBe(block('bedrock'));
    for (const [x, z] of exitPortalCells()) {
      expect(blockAt(chunks, x, END_ISLAND_Y + 1, z)).toBe(0);
      expect(blockIdOf(blockAt(chunks, x, END_ISLAND_Y, z))).toBe(block('bedrock'));
    }
  });

  it('a chegada fica a um bloco da borda da ilha, no mesmo nível — a plataforma é quem segura', () => {
    const x = endArrivalX(SEED);
    expect(blockAt(chunks, x, END_ISLAND_Y, END_SPAWN_Z)).toBe(0);
    expect(blockAt(chunks, x - 3, END_ISLAND_Y, END_SPAWN_Z)).toBe(0);
    const solidColumn = (cx: number): boolean => {
      for (let y = 1; y < 128; y++) if (blockAt(chunks, cx, y, END_SPAWN_Z) !== 0) return true;
      return false;
    };
    expect(solidColumn(x - 4)).toBe(true);
    expect(solidColumn(x - 3)).toBe(false);
    // O piso da plataforma fica na altura do topo da borda: um pulo atravessa.
    const y = endArrivalY(SEED);
    expect(blockAt(chunks, x - 4, y - 1, END_SPAWN_Z)).not.toBe(0);
    expect(blockAt(chunks, x - 4, y, END_SPAWN_Z)).toBe(0);
    for (const seed of [1, 2, 3, 99]) {
      expect(endArrivalX(seed)).toBeGreaterThan(60);
      expect(endArrivalX(seed)).toBeLessThan(110);
    }
  });
});

describe('marcos de estrutura atravessam o worker (regressão do M6)', () => {
  it('a resposta de geração leva os marcos', () => {
    const center = new Int32Array(3);
    fortressCenter(SEED, 0, 0, center);
    const gen = new GenJobRunner(SEED);
    // Varre a região da fortaleza até achar o chunk de um gerador de blaze.
    let found: StructureMark | undefined;
    for (let dz = -4; dz <= 4 && found === undefined; dz++) {
      for (let dx = -4; dx <= 4 && found === undefined; dx++) {
        const response = gen.run((center[0] >> 4) + dx, (center[2] >> 4) + dz, DIM_NETHER);
        found = response.structures?.find((m) => m.kind === 'spawner');
      }
    }
    expect(found?.data).toBe('blaze');
  });

  it('e o pipeline os põe na coluna que entra no mundo', () => {
    const gen = new GenJobRunner(SEED);
    const center = new Int32Array(3);
    fortressCenter(SEED, 0, 0, center);
    class GenWorker implements WorkerLike {
      onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
      postMessage(message: unknown): void {
        const request = message as WorkerRequest;
        if (request.type !== 'gen') return;
        const response = gen.run(request.cx, request.cz, request.dim);
        this.onmessage?.({ data: structuredClone(response) });
      }
      terminate(): void { /* nada */ }
    }
    const world = new World(SEED);
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 3, packed: true, dispatchBudgetMs: Infinity,
      createWorker: () => new GenWorker(),
    });
    let received = 0;
    pipeline.onChunkLoaded = (chunk) => { received += chunk.structures.length; };
    pipeline.setDimension(DIM_NETHER);
    pipeline.setCenter(center[0], center[2]);
    for (let i = 0; i < 200; i++) pipeline.pump();
    expect(received).toBeGreaterThan(0);
  });
});

describe('malha pedida antes do portal (M16)', () => {
  /**
   * Worker que guarda as respostas e só entrega quando mandam, na ordem que
   * o teste escolher: é o que acontece quando o portal fecha no meio de uma
   * leva de meshing.
   */
  class HeldWorker implements WorkerLike {
    onmessage: ((event: { data: WorkerResponse }) => void) | null = null;
    readonly held: WorkerResponse[] = [];
    private readonly gen = new GenJobRunner(SEED);
    postMessage(message: unknown): void {
      const request = message as WorkerRequest;
      if (request.type === 'gen') this.held.push(this.gen.run(request.cx, request.cz, request.dim));
      if (request.type === 'mesh') {
        // A malha em si não importa: só quem a pediu e para qual dimensão.
        this.held.push({
          type: 'mesh', cx: request.cx, cz: request.cz, sections: [], quads: 0, ms: 0,
          ...(request.dim !== undefined ? { dim: request.dim } : {}),
        });
      }
    }
    deliver(filter: (r: WorkerResponse) => boolean): number {
      let n = 0;
      for (let i = 0; i < this.held.length; i++) {
        if (!filter(this.held[i])) continue;
        const [response] = this.held.splice(i, 1);
        i--;
        n++;
        this.onmessage?.({ data: response });
      }
      return n;
    }
    terminate(): void { /* nada */ }
  }

  it('a resposta da dimensão antiga não marca pronta a coluna da nova', () => {
    let worker: HeldWorker | null = null;
    const world = new World(SEED);
    const pipeline = new ChunkPipeline(world, {
      workers: 1, renderDistance: 1, packed: true, dispatchBudgetMs: Infinity,
      createWorker: () => { worker = new HeldWorker(); return worker; },
    });
    const w = (): HeldWorker => worker as unknown as HeldWorker;
    pipeline.setCenter(8, 8);
    pipeline.pump();
    w().deliver((r) => r.type === 'gen');
    for (let i = 0; i < 5; i++) pipeline.pump();
    // Há malha da superfície pedida e não entregue.
    expect(w().held.some((r) => r.type === 'mesh')).toBe(true);

    pipeline.setDimension(DIM_END);
    pipeline.setCenter(8, 8);
    pipeline.pump();
    // A coluna do End chega primeiro; a malha velha da superfície, depois.
    expect(w().deliver((r) => r.type === 'gen' && r.dim === DIM_END)).toBeGreaterThan(0);
    const stale = w().deliver((r) => r.type === 'mesh' && r.dim !== DIM_END);
    expect(stale).toBeGreaterThan(0);
    let applied = 0;
    pipeline.drainReady(Infinity, () => { applied++; });
    expect(applied).toBe(0);
    expect(world.getChunk(0, 0)?.state).not.toBe(4);
  });
});
