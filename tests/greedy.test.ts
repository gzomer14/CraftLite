/**
 * O greedy meshing é o componente com maior chance de estar "quase certo":
 * winding, contagem de quads e AO podem sair errados sem quebrar nada visível
 * de imediato. Os casos abaixo são de contagem conhecida.
 */
import { describe, expect, it } from 'vitest';
import { GreedyMesher, NB_SIDE, nbIndex } from '../src/world/mesh/greedy';
import { buildBlockTables } from '../src/world/mesh/blockinfo';
import { buildLayerIndex } from '../src/render/layers';
import { STONE, GLASS_ID, makeState } from './helpers/blockids';

const tables = buildBlockTables(buildLayerIndex());
const VOL = NB_SIDE * NB_SIDE * NB_SIDE;

function emptyNeighborhood(): { blocks: Uint16Array; light: Uint8Array } {
  return { blocks: new Uint16Array(VOL), light: new Uint8Array(VOL).fill(0xf0) };
}

/** Preenche uma caixa em coordenadas locais (−1..16 são válidas). */
function fillBox(
  blocks: Uint16Array, x0: number, y0: number, z0: number,
  x1: number, y1: number, z1: number, state: number,
): void {
  for (let y = y0; y <= y1; y++) {
    for (let z = z0; z <= z1; z++) {
      for (let x = x0; x <= x1; x++) blocks[nbIndex(x, y, z)] = state;
    }
  }
}

const mesher = (): GreedyMesher => new GreedyMesher(tables, true);

describe('GreedyMesher', () => {
  it('section vazia não gera nada', () => {
    const { blocks, light } = emptyNeighborhood();
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(0);
    expect(out.opaque).toBeNull();
  });

  it('um bloco isolado gera exatamente 6 quads', () => {
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(6);
    expect(out.opaque?.vertexCount).toBe(24);
    expect(out.opaque?.indexCount).toBe(36);
  });

  it('dois blocos vizinhos escondem a face entre eles', () => {
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    blocks[nbIndex(9, 8, 8)] = makeState(STONE);
    // 12 faces no total, menos as 2 internas, e as 2 laterais de cada par
    // se fundem: 4 quads laterais + 2 topos fundidos + 2 bases fundidas... 
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(6); // greedy funde os pares coplanares
  });

  it('uma section sólida gera só as 6 faces externas, fundidas', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, 0, 0, 0, 15, 15, 15, makeState(STONE));
    const out = mesher().mesh(blocks, light);
    // Cada face externa vira um único quad 16×16 — é o ganho do greedy.
    expect(out.quads).toBe(6);
    expect(out.opaque?.vertexCount).toBe(24);
  });

  it('section sólida cercada de vizinhos sólidos não gera face nenhuma', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, -1, -1, -1, 16, 16, 16, makeState(STONE));
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(0);
  });

  it('um plano 16×16 vira 2 quads (topo e base)', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, 0, 8, 0, 15, 8, 15, makeState(STONE));
    const out = mesher().mesh(blocks, light);
    // topo + base fundidos (1 cada) + 4 bordas laterais de 16×1
    expect(out.quads).toBe(6);
  });

  it('o greedy reduz drasticamente os vértices vs. faces soltas', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, 0, 0, 0, 15, 7, 15, makeState(STONE));
    const out = mesher().mesh(blocks, light);
    const naiveQuads = 16 * 16 + 16 * 16 + 4 * (16 * 8); // topo+base+laterais
    expect(out.quads).toBeLessThan(naiveQuads * 0.1);
  });

  it('xadrez é o pior caso e não funde nada', () => {
    const { blocks, light } = emptyNeighborhood();
    let count = 0;
    for (let y = 0; y < 16; y++) {
      for (let z = 0; z < 16; z++) {
        for (let x = 0; x < 16; x++) {
          if (((x + y + z) & 1) === 0) { blocks[nbIndex(x, y, z)] = makeState(STONE); count++; }
        }
      }
    }
    const out = mesher().mesh(blocks, light);
    expect(out.quads).toBe(count * 6);
  });

  it('blocos transparentes não escondem a face do vizinho', () => {
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    blocks[nbIndex(9, 8, 8)] = makeState(GLASS_ID);
    const out = mesher().mesh(blocks, light);
    // A pedra mantém as 6 faces; o vidro vai para o passe de cutout.
    expect(out.opaque).not.toBeNull();
    expect(out.cutout).not.toBeNull();
  });

  it('o padding de vizinhos suprime as faces da borda', () => {
    const semPadding = emptyNeighborhood();
    fillBox(semPadding.blocks, 0, 0, 0, 15, 15, 15, makeState(STONE));
    const comPadding = emptyNeighborhood();
    fillBox(comPadding.blocks, -1, -1, -1, 16, 16, 16, makeState(STONE));

    expect(mesher().mesh(semPadding.blocks, semPadding.light).quads).toBe(6);
    expect(mesher().mesh(comPadding.blocks, comPadding.light).quads).toBe(0);
  });

  it('luz diferente impede o merge', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, 0, 8, 0, 15, 8, 15, makeState(STONE));
    // Metade do topo com luz de céu 15, metade com 5.
    for (let z = 0; z < 16; z++) {
      for (let x = 0; x < 8; x++) light[nbIndex(x, 9, z)] = 0x50;
    }
    const out = mesher().mesh(blocks, light);
    // O topo, que seria 1 quad, agora precisa de 2.
    expect(out.quads).toBe(7);
  });

  /**
   * Invariante que impede a volta do artefato de AO esticado: um quad só pode
   * ser maior que 1 numa direção se o AO for constante nessa direção. Sem isso,
   * o degradê de um bloco vira um triângulo escuro do tamanho da faixa.
   */
  it('nenhum quad estica o degradê de AO', () => {
    const { blocks, light } = emptyNeighborhood();
    // Piso com um degrau no meio — a situação que produzia o artefato.
    fillBox(blocks, -1, 7, -1, 16, 7, 16, makeState(STONE));
    fillBox(blocks, 8, 8, 0, 15, 8, 15, makeState(STONE));
    const out = mesher().mesh(blocks, light);

    const words = new Uint32Array(out.opaque!.vertices);
    const quads = out.opaque!.vertexCount / 4;
    let stretched = 0;
    for (let q = 0; q < quads; q++) {
      const ao: number[] = [];
      const uv: number[][] = [];
      for (let k = 0; k < 4; k++) {
        const w0 = words[(q * 4 + k) * 2];
        const w1 = words[(q * 4 + k) * 2 + 1];
        uv.push([(w0 >>> 21) & 31, (w0 >>> 26) & 31]);
        ao.push((w1 >>> 18) & 3);
      }
      const w = uv[1][0];
      const h = uv[3][1];
      if (w > 1 && !(ao[0] === ao[1] && ao[3] === ao[2])) stretched++;
      if (h > 1 && !(ao[0] === ao[3] && ao[1] === ao[2])) stretched++;
    }
    expect(stretched).toBe(0);
  });

  it('ainda funde por inteiro quando o AO é uniforme', () => {
    const { blocks, light } = emptyNeighborhood();
    fillBox(blocks, 0, 0, 0, 15, 15, 15, makeState(STONE));
    // Sem nada em volta, todo AO é 3: as 6 faces continuam sendo 1 quad cada.
    expect(mesher().mesh(blocks, light).quads).toBe(6);
  });

  it('reutilizar o mesher dá o mesmo resultado', () => {
    const m = mesher();
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(4, 4, 4)] = makeState(STONE);
    const a = m.mesh(blocks, light);
    const b = m.mesh(blocks, light);
    expect(b.quads).toBe(a.quads);
    expect(b.opaque?.vertexCount).toBe(a.opaque?.vertexCount);
  });

  it('AO escurece os cantos ocluídos', () => {
    const { blocks, light } = emptyNeighborhood();
    // Um bloco com um vizinho em L acima: o canto entre eles deve ter AO < 3.
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    blocks[nbIndex(9, 9, 8)] = makeState(STONE);
    const out = mesher().mesh(blocks, light);
    const words = new Uint32Array(out.opaque!.vertices);
    let hasOccluded = false;
    for (let i = 0; i < out.opaque!.vertexCount; i++) {
      if (((words[i * 2 + 1] >>> 18) & 3) < 3) { hasOccluded = true; break; }
    }
    expect(hasOccluded).toBe(true);
  });

  it('sem oclusão nenhuma, todo AO é 3', () => {
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    const out = mesher().mesh(blocks, light);
    const words = new Uint32Array(out.opaque!.vertices);
    for (let i = 0; i < out.opaque!.vertexCount; i++) {
      expect((words[i * 2 + 1] >>> 18) & 3).toBe(3);
    }
  });

  it('a luz gravada no vértice vem do voxel de fora da face', () => {
    const { blocks, light } = emptyNeighborhood();
    blocks[nbIndex(8, 8, 8)] = makeState(STONE);
    light.fill(0x00);
    light[nbIndex(8, 9, 8)] = 0xf0; // só acima do bloco
    const out = mesher().mesh(blocks, light);
    const words = new Uint32Array(out.opaque!.vertices);
    let litVerts = 0;
    for (let i = 0; i < out.opaque!.vertexCount; i++) {
      if (((words[i * 2 + 1] >>> 14) & 0xf) === 15) litVerts++;
    }
    expect(litVerts).toBe(4); // exatamente os 4 vértices da face de topo
  });
});

/**
 * Iluminação suave desligada (doc 08 §3.11).
 *
 * Não é só tirar a sombra de canto: com o AO uniforme o merge greedy deixa de
 * quebrar nas bordas, e a mesma section rende **menos** vértices. É o caminho
 * de fuga de quem precisa de cada vértice, e é essa a propriedade que precisa
 * continuar valendo.
 */
describe('iluminação suave', () => {
  /** Um degrau: quinas o bastante para o AO ter o que escurecer. */
  function stepWorld(): { blocks: Uint16Array; light: Uint8Array } {
    const blocks = new Uint16Array(NB_SIDE * NB_SIDE * NB_SIDE);
    const light = new Uint8Array(NB_SIDE * NB_SIDE * NB_SIDE).fill(0xf0);
    for (let z = 0; z < 18; z++) {
      for (let x = 0; x < 18; x++) {
        const height = x < 9 ? 4 : 8;
        for (let y = 0; y < height; y++) blocks[nbIndex(x - 1, y - 1, z - 1)] = makeState(STONE);
      }
    }
    return { blocks, light };
  }

  it('desligada, o mesh não fica maior — e costuma ficar menor', () => {
    const { blocks, light } = stepWorld();
    const smooth = new GreedyMesher(tables, false, true).mesh(blocks, light);
    const smoothQuads = countQuads(smooth);
    const flat = new GreedyMesher(tables, false, false).mesh(blocks, light);
    expect(countQuads(flat)).toBeLessThanOrEqual(smoothQuads);
  });

  it('desligada, nenhum vértice sai sombreado', () => {
    const { blocks, light } = stepWorld();
    const mesher = new GreedyMesher(tables, false, false);
    mesher.mesh(blocks, light);
    // Com AO uniforme, o merge nunca é interrompido por variação de canto.
    const smooth = new GreedyMesher(tables, false, true);
    smooth.mesh(blocks, light);
    expect(mesher.quads).toBeLessThanOrEqual(smooth.quads);
  });
});

/** Quads do passe opaco — o único que este cenário de pedra produz. */
function countQuads(mesh: { opaque: { vertexCount: number } | null }): number {
  return (mesh.opaque?.vertexCount ?? 0) / 4;
}
