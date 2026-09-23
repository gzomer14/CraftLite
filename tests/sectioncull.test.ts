/**
 * Culling por conectividade e por direção de face (M12).
 *
 * O frustum sozinho manda desenhar a montanha inteira atrás da parede de uma
 * caverna. O critério de aceite do doc 14 é o caso real: numa caverna a Y≈20
 * com distância de render 8, **metade ou menos** das sections com malha dentro
 * do frustum vão para a lista de desenho.
 */
import { describe, expect, it } from 'vitest';
import { VisibilityScanner, VIS_ALL, visConnects } from '../src/world/mesh/visibility';
import { FAR_REFRESH_FRAMES, SectionCulling, facingFaces, sectionKey } from '../src/render/sectioncull';
import { NB_VOLUME, gatherSections, type SectionView } from '../src/world/neighborhood';
import { nbIndex, GreedyMesher } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { MeshJobRunner } from '../src/workers/meshjob';
import { World } from '../src/world/world';
import { TerrainNoise, generateChunk } from '../src/world/gen/terrain';
import {
  Frustum, createMat4, forwardFrom, lookYawPitch, multiply, perspective,
} from '../src/core/math';
import { raycast } from '../src/world/raycast';
import {
  FACE_NEG_X, FACE_NEG_Y, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z,
} from '../src/render/vertex';
import { STONE } from './helpers/blockids';

const tables = buildBlockTables(buildLayerIndex());

function frustumAt(x: number, y: number, z: number, yaw: number, pitch: number, far: number): Frustum {
  const proj = createMat4();
  const view = createMat4();
  const vp = createMat4();
  perspective(proj, (70 * Math.PI) / 180, 16 / 9, 0.05, far);
  lookYawPitch(view, x, y, z, yaw, pitch);
  multiply(vp, proj, view);
  const frustum = new Frustum();
  frustum.fromMatrix(vp);
  return frustum;
}

/** Vizinhança 18³ só de ar, com `fill(x, y, z)` decidindo onde há pedra (0..15). */
function neighborhood(fill: (x: number, y: number, z: number) => boolean): Uint16Array {
  const blocks = new Uint16Array(NB_VOLUME);
  for (let y = 0; y < 16; y++) {
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 16; x++) if (fill(x, y, z)) blocks[nbIndex(x, y, z)] = STONE;
    }
  }
  return blocks;
}

describe('conectividade dentro da section', () => {
  const scan = (fill: (x: number, y: number, z: number) => boolean): number =>
    new VisibilityScanner().scan(neighborhood(fill), tables.occludes);

  it('ar puro liga tudo; pedra maciça não liga nada', () => {
    expect(scan(() => false)).toBe(VIS_ALL);
    expect(scan(() => true)).toBe(0);
  });

  it('uma laje de pedra no meio separa em cima e embaixo', () => {
    const vis = scan((_x, y) => y === 8);
    expect(visConnects(vis, FACE_POS_Y, FACE_NEG_Y)).toBe(false);
    // Os lados continuam se vendo, por cima e por baixo da laje.
    expect(visConnects(vis, FACE_POS_X, FACE_NEG_X)).toBe(true);
    expect(visConnects(vis, FACE_POS_X, FACE_POS_Y)).toBe(true);
    expect(visConnects(vis, FACE_NEG_Z, FACE_NEG_Y)).toBe(true);
  });

  it('um túnel em X só liga as duas pontas do túnel', () => {
    const vis = scan((_x, y, z) => !(y === 5 && z === 5));
    expect(visConnects(vis, FACE_POS_X, FACE_NEG_X)).toBe(true);
    for (const [a, b] of [[FACE_POS_X, FACE_POS_Y], [FACE_POS_Z, FACE_NEG_Z], [FACE_POS_Y, FACE_NEG_Y]]) {
      expect(visConnects(vis, a, b), `${a}-${b}`).toBe(false);
    }
  });
});

describe('busca a partir da câmera', () => {
  /** Todas as sections de `cx0..cx1 × cz0..cz1`, com malha e a conectividade dada. */
  function block(
    culling: SectionCulling, cx0: number, cx1: number, cz0: number, cz1: number, vis: number,
  ): void {
    for (let cz = cz0; cz <= cz1; cz++) {
      for (let cx = cx0; cx <= cx1; cx++) {
        for (let sy = 0; sy < 8; sy++) culling.set(cx, cz, sy, vis, true);
      }
    }
  }
  const listed = (culling: SectionCulling): Set<number> =>
    new Set(Array.from(culling.visibleKeys.subarray(0, culling.visibleCount)));

  it('uma parede de sections maciças esconde o que está atrás', () => {
    const culling = new SectionCulling();
    culling.setRadius(4);
    block(culling, -7, 7, -7, 7, VIS_ALL);
    block(culling, 2, 2, -7, 7, 0); // toda a fatia cx = 2 é pedra maciça
    // Olhando para +X: yaw = π/2 na convenção do jogo (yaw 0 olha para +Z).
    culling.run(frustumAt(8, 70, 8, Math.PI / 2, 0, 200), 8, 70, 8);
    const seen = listed(culling);
    expect(seen.has(sectionKey(1, 0, 4)), 'antes da parede').toBe(true);
    expect(seen.has(sectionKey(2, 0, 4)), 'a parede aparece').toBe(true);
    expect(seen.has(sectionKey(3, 0, 4)), 'o que está atrás, não').toBe(false);

    // Sem a parede, o mesmo lugar é alcançado.
    block(culling, 2, 2, -7, 7, VIS_ALL);
    culling.run(frustumAt(8, 70, 8, Math.PI / 2, 0, 200), 8, 70, 8);
    expect(listed(culling).has(sectionKey(3, 0, 4))).toBe(true);
  });

  it('section nunca meshada deixa a vista passar', () => {
    const culling = new SectionCulling();
    culling.setRadius(4);
    // Só a fatia cx = 3 tem malha; entre ela e a câmera, nada foi meshado.
    block(culling, 3, 3, -7, 7, VIS_ALL);
    culling.run(frustumAt(8, 70, 8, Math.PI / 2, 0, 200), 8, 70, 8);
    expect(listed(culling).has(sectionKey(3, 0, 4))).toBe(true);
  });

  it('câmera acima do teto do mundo entra pelas sections do topo', () => {
    const culling = new SectionCulling();
    culling.setRadius(2);
    block(culling, -4, 4, -4, 4, VIS_ALL);
    culling.run(frustumAt(8, 200, 8, 0, Math.PI / 2 - 0.1, 400), 8, 200, 8);
    expect(culling.culled).toBe(true);
    expect(listed(culling).has(sectionKey(0, 0, 3))).toBe(true);
  });

  it('girar a câmera não refaz a busca; trocar de section, sim', () => {
    const culling = new SectionCulling();
    culling.setRadius(4);
    block(culling, -7, 7, -7, 7, VIS_ALL);
    culling.run(frustumAt(8, 70, 8, 0, 0, 200), 8, 70, 8);
    const before = culling.searches;
    for (const yaw of [0.5, 1, 2, 3]) culling.run(frustumAt(8, 70, 8, yaw, 0, 200), 8, 70, 8);
    expect(culling.searches).toBe(before);
    culling.run(frustumAt(24, 70, 8, 0, 0, 200), 24, 70, 8);
    expect(culling.searches).toBe(before + 1);
  });

  it('malha nova perto refaz na hora; longe, espera alguns quadros', () => {
    const culling = new SectionCulling();
    culling.setRadius(8);
    const frustum = frustumAt(8, 70, 8, 0, 0, 300);
    culling.run(frustum, 8, 70, 8);
    const base = culling.searches;

    culling.set(1, 1, 4, 0, true); // perto: cavaram do lado
    culling.run(frustum, 8, 70, 8);
    expect(culling.searches).toBe(base + 1);

    culling.set(7, 7, 4, 0, true); // longe: o anel carregando
    for (let i = 0; i < FAR_REFRESH_FRAMES - 1; i++) culling.run(frustum, 8, 70, 8);
    expect(culling.searches).toBe(base + 1);
    culling.run(frustum, 8, 70, 8);
    expect(culling.searches).toBe(base + 2);
  });
});

describe('faces viradas para a câmera', () => {
  it('de cima e de fora, as faces de baixo e de trás ficam de fora', () => {
    // Section na origem, câmera acima e a +X/+Z dela.
    const faces = facingFaces(0, 0, 0, 30, 40, 30);
    expect(faces & (1 << FACE_POS_X)).not.toBe(0);
    expect(faces & (1 << FACE_NEG_X)).toBe(0);
    expect(faces & (1 << FACE_POS_Y)).not.toBe(0);
    expect(faces & (1 << FACE_NEG_Y)).toBe(0);
    expect(faces & (1 << FACE_POS_Z)).not.toBe(0);
    expect(faces & (1 << FACE_NEG_Z)).toBe(0);
  });

  it('com a câmera dentro da section, todas as faces valem', () => {
    expect(facingFaces(0, 0, 0, 8, 8, 8)).toBe(0x3f);
  });

  it('o mesher entrega as faixas de face: um cubo de pedra dá 6 faixas de 6 índices', () => {
    const blocks = new Uint16Array(NB_VOLUME);
    blocks[nbIndex(4, 4, 4)] = STONE;
    const out = new GreedyMesher(tables, true).mesh(blocks, new Uint8Array(NB_VOLUME).fill(0xf0));
    const starts = out.opaque!.faceStarts!;
    expect(Array.from(starts)).toEqual([0, 6, 12, 18, 24, 30, 36]);
    expect(out.opaque!.indexCount).toBe(36);
  });
});

/*
 * Mundo de verdade (seed 11, distância 8), malhado pelo mesmo código do worker.
 * Montado uma vez: gerar e meshar 17×17 colunas leva alguns segundos.
 */
const RD = 8;
let scene: { world: World; culling: SectionCulling; withMesh: Set<number> } | null = null;

function sceneOnce(): { world: World; culling: SectionCulling; withMesh: Set<number> } {
  if (scene !== null) return scene;
  const seed = 11;
  const noise = new TerrainNoise(seed);
  const world = new World(seed);
  for (let cz = -RD - 1; cz <= RD + 1; cz++) {
    for (let cx = -RD - 1; cx <= RD + 1; cx++) world.addChunk(generateChunk(seed, noise, cx, cz));
  }
  const runner = new MeshJobRunner(new GreedyMesher(tables, true), tables.occludes);
  const culling = new SectionCulling();
  culling.setRadius(RD);
  const withMesh = new Set<number>();
  const views: SectionView[] = [];
  for (let cz = -RD; cz <= RD; cz++) {
    for (let cx = -RD; cx <= RD; cx++) {
      gatherSections(world, cx, cz, 0, 8, views);
      const response = runner.run({
        type: 'mesh', cx, cz, mask: 0xff, syMin: 0, span: 8, sections: views,
      });
      for (const section of response.sections) {
        const key = sectionKey(cx, cz, section.sy);
        const hasMesh = section.opaque !== null || section.cutout !== null || section.translucent !== null;
        culling.set(cx, cz, section.sy, section.visibility, hasMesh);
        if (hasMesh) withMesh.add(key);
      }
    }
  }
  scene = { world, culling, withMesh };
  return scene;
}

/** Uma caverna de verdade perto do centro: ar sem luz do céu, com Y entre 16 e 20. */
function findCave(world: World): [number, number, number] {
  for (let y = 20; y >= 16; y--) {
    for (let z = 0; z < 32; z++) {
      for (let x = 0; x < 32; x++) {
        if (world.getBlock(x, y, z) !== 0 || world.getSkyLight(x, y, z) !== 0) continue;
        if (world.getBlock(x, y + 1, z) !== 0) continue; // cabe uma cabeça
        return [x + 0.5, y + 1.6, z + 0.5];
      }
    }
  }
  throw new Error('a seed 11 não tem caverna perto da origem');
}

const YAWS = [0, Math.PI / 2, Math.PI, -Math.PI / 2];

describe('critério de aceite do M12: caverna a Y≈20, distância 8', () => {
  it('metade ou menos das sections com malha dentro do frustum vão para a lista', () => {
    const { world, culling, withMesh } = sceneOnce();
    const [x, y, z] = findCave(world);

    let frustumTotal = 0;
    let drawnTotal = 0;
    for (const yaw of YAWS) {
      const frustum = frustumAt(x, y, z, yaw, 0, RD * 16 + 64);
      for (let cz = -RD; cz <= RD; cz++) {
        for (let cx = -RD; cx <= RD; cx++) {
          for (let sy = 0; sy < 8; sy++) {
            if (!withMesh.has(sectionKey(cx, cz, sy))) continue;
            const x0 = cx * 16; const y0 = sy * 16; const z0 = cz * 16;
            if (frustum.intersectsAabb(x0, y0, z0, x0 + 16, y0 + 16, z0 + 16)) frustumTotal++;
          }
        }
      }
      culling.run(frustum, x, y, z);
      for (let i = 0; i < culling.visibleCount; i++) {
        if (withMesh.has(culling.visibleKeys[i])) drawnTotal++;
      }
    }

    expect(frustumTotal).toBeGreaterThan(0);
    // Medido em 2026-09-23: 500 de 1710, 29%.
    expect(drawnTotal / frustumTotal).toBeLessThanOrEqual(0.5);
  }, 60_000);

  /*
   * O culling não pode esconder nada que se vê. A prova: raios saindo da
   * câmera dentro do campo de visão; o primeiro bloco que cada um acerta está
   * visível, então a section dele **tem** que estar na lista.
   */
  it('todo bloco que um raio da câmera acerta está numa section da lista', () => {
    const { world, culling } = sceneOnce();
    const ground = world.getChunk(0, 0)!.heightMap[(8 << 4) | 8];
    const cave = findCave(world);
    // x, y, z, yaw, pitch — caverna olhando reto e para cima, chão olhando
    // quase reto, e uma câmera alta que enxerga até a borda do anel.
    const cameras: number[][] = [];
    for (const yaw of YAWS) {
      cameras.push([cave[0], cave[1], cave[2], yaw, 0]);
      cameras.push([cave[0], cave[1], cave[2], yaw, -0.6]);
      cameras.push([8.5, ground + 2.6, 8.5, yaw, 0.05]);
      cameras.push([8.5, 110, 8.5, yaw, 0.45]);
    }

    let rays = 0;
    let far = 0;
    let misses = 0;
    let seed = 12345;
    const random = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
    const dir = new Float32Array(3);
    for (const [x, y, z, yaw, pitch] of cameras) {
      culling.run(frustumAt(x, y, z, yaw, pitch, RD * 16 + 64), x, y, z);
      const listed = new Set(Array.from(culling.visibleKeys.subarray(0, culling.visibleCount)));
      for (let r = 0; r < 500; r++) {
        // Dentro do campo de visão, com folga das bordas do frustum.
        forwardFrom(dir, yaw + (random() - 0.5) * 1.0, pitch + (random() - 0.5) * 0.6);
        const hit = raycast(world, x, y, z, dir[0], dir[1], dir[2], (RD - 1) * 16);
        if (!hit.hit) continue;
        rays++;
        if (Math.hypot(hit.x - x, hit.z - z) > 40) far++;
        const key = sectionKey(Math.floor(hit.x / 16), Math.floor(hit.z / 16), Math.floor(hit.y / 16));
        if (!listed.has(key)) misses++;
      }
    }
    // O teste só prova algo se os raios vão longe, atravessando muitas sections.
    expect(rays).toBeGreaterThan(3000);
    expect(far).toBeGreaterThan(500);
    expect(misses).toBe(0);
  }, 60_000);
});
