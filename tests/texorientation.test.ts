/**
 * Orientação do ladrilho nas faces de pé (correção de 2026-09-23).
 *
 * O ladrilho é desenhado com a linha 0 em cima, e o WebGL entrega a linha 0 em
 * `v = 0`. Até aqui os quads de pé punham `v = 0` na base: flor, muda, grama
 * alta e plantação apareciam de ponta-cabeça no mundo e certas no inventário —
 * relato do jogador: *"ao colocar no chão fica invertido"*. O mesmo erro virava
 * a brasa da tocha para baixo e a boca da fornalha para cima.
 *
 * A regra que estes testes seguram: **em quad de pé, o canto mais alto tem
 * `v = 0`**. Faces de cima e de baixo continuam como eram.
 */
import { describe, expect, it } from 'vitest';
import { MeshBuilder } from '../src/render/mesh';
import {
  FACE_NEG_X, FACE_NEG_Z, FACE_POS_X, FACE_POS_Y, FACE_POS_Z,
} from '../src/render/vertex';
import { GreedyMesher, NB_SIDE, nbIndex } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { BLOCK_BY_NAME, makeState } from '../src/data/blocks';
import { MOUNT_FLOOR } from '../src/world/mesh/shapes';

interface Vert { y: number; v: number; face: number }

function readVertices(data: ArrayBuffer, count: number): Vert[] {
  const w = new Uint32Array(data);
  const out: Vert[] = [];
  for (let i = 0; i < count; i++) {
    const w0 = w[i * 2];
    const w1 = w[i * 2 + 1];
    out.push({ y: ((w0 >>> 9) & 511) / 16, face: (w0 >>> 27) & 7, v: (w1 >>> 27) & 31 });
  }
  return out;
}

/** Em cada grupo de 4 vértices de pé: o mais alto tem v=0, o mais baixo v máximo. */
function expectTopIsRowZero(verts: Vert[], label: string): void {
  for (let q = 0; q < verts.length; q += 4) {
    const quad = verts.slice(q, q + 4);
    const top = Math.max(...quad.map((p) => p.y));
    const bottom = Math.min(...quad.map((p) => p.y));
    if (top === bottom) continue; // deitado: não é deste teste
    for (const p of quad) {
      if (p.y === top) expect(p.v, `${label}: canto de cima`).toBe(0);
      else expect(p.v, `${label}: canto de baixo`).toBeGreaterThan(0);
    }
  }
}

const AO_FLAT = [3, 3, 3, 3];
const tables = buildBlockTables(buildLayerIndex());
const VOL = NB_SIDE * NB_SIDE * NB_SIDE;

function meshOne(name: string, state = 0) {
  const blocks = new Uint16Array(VOL);
  const light = new Uint8Array(VOL).fill(0xf0);
  blocks[nbIndex(8, 8, 8)] = makeState(BLOCK_BY_NAME.get(name)!.id, state);
  return new GreedyMesher(tables, true).mesh(blocks, light);
}

describe('faces de pé mostram o desenho em pé', () => {
  it('quad greedy lateral: a linha 0 do ladrilho fica no alto, também em corrida de 3', () => {
    for (const face of [FACE_POS_X, FACE_NEG_X, FACE_POS_Z, FACE_NEG_Z]) {
      const b = new MeshBuilder(true);
      b.addQuad(0, 0, 0, face, 2, 3, 0, 0, 15, AO_FLAT, 0);
      const verts = readVertices(b.build().vertices, 4);
      expectTopIsRowZero(verts, `face ${face}`);
      expect(Math.max(...verts.map((p) => p.v)), `face ${face}: 3 ladrilhos de altura`).toBe(3);
    }
  });

  it('a face de cima continua como era: v=0 na borda +Z', () => {
    const b = new MeshBuilder(true);
    b.addQuad(0, 0, 0, FACE_POS_Y, 1, 1, 0, 0, 15, AO_FLAT, 0);
    const w = new Uint32Array(b.build().vertices);
    // Primeiro canto (origem da face +Y, em z+1) com v=0, como antes da correção.
    expect(((w[0] >>> 18) & 511) / 16).toBe(1);
    expect((w[1] >>> 27) & 31).toBe(0);
  });

  it('flor, muda, grama alta e plantação: a cruz sai em pé', () => {
    for (const name of ['dandelion', 'poppy', 'oak_sapling', 'tall_grass', 'wheat']) {
      const out = meshOne(name);
      const mesh = out.cutout!;
      const verts = readVertices(mesh.vertices, mesh.vertexCount);
      // A cruz usa a face +Y só pela sombra — é de pé mesmo assim.
      expect(verts[0].face).toBe(FACE_POS_Y);
      expectTopIsRowZero(verts, name);
    }
  });

  it('a tocha tem a brasa em cima', () => {
    const mesh = meshOne('torch', MOUNT_FLOOR).cutout!;
    expectTopIsRowZero(readVertices(mesh.vertices, mesh.vertexCount), 'tocha');
  });

  it('bloco de caixas (porta) segue a mesma regra nas laterais', () => {
    const out = meshOne('oak_door');
    const mesh = out.cutout ?? out.opaque!;
    expectTopIsRowZero(readVertices(mesh.vertices, mesh.vertexCount), 'porta');
  });

  it('cubo comum (fornalha) também', () => {
    const mesh = meshOne('furnace').opaque!;
    expectTopIsRowZero(readVertices(mesh.vertices, mesh.vertexCount), 'fornalha');
  });
});
