/**
 * Pose do item na mão (doc 01 §191).
 *
 * A primeira versão usava coordenadas fixas e desenhava a mão **fora do
 * frustum**: ela simplesmente não aparecia, e nada no código acusava — o draw
 * call acontecia, os vértices iam para a GPU e o resultado caía fora da tela.
 * É o tipo de erro que só um teste de geometria pega, porque não há exceção,
 * não há log e não há teste de render neste projeto.
 */
import { describe, expect, it } from 'vitest';
import { handPose, HandAnimation, HAND_FOV, SWING_TICKS, type HandPose } from '../src/render/hand';

const pose = (): HandPose => ({ x: 0, y: 0, z: 0, yaw: 0, pitch: 0, scale: 1 });

/** Meia-altura e meia-largura visíveis na distância da mão. */
function halfExtents(p: HandPose, aspect: number): { w: number; h: number } {
  const h = Math.tan(HAND_FOV / 2) * Math.abs(p.z);
  return { w: h * aspect, h };
}

/** Do celular em retrato ao monitor ultrawide. */
const ASPECTS = [0.46, 0.75, 1, 1.78, 2.2, 3.2];

describe('a mão fica dentro da tela', () => {
  it('o centro cai no frustum em qualquer aspecto e em qualquer ponto do golpe', () => {
    for (const aspect of ASPECTS) {
      for (let step = 0; step <= 10; step++) {
        const p = handPose(step / 10, 0, aspect, pose());
        const { w, h } = halfExtents(p, aspect);
        expect(Math.abs(p.x), `x fora em aspect ${aspect}, swing ${step / 10}`).toBeLessThan(w);
        expect(Math.abs(p.y), `y fora em aspect ${aspect}, swing ${step / 10}`).toBeLessThan(h);
      }
    }
  });

  it('fica no canto inferior direito, não no meio da tela', () => {
    for (const aspect of ASPECTS) {
      const p = handPose(0, 0, aspect, pose());
      const { w, h } = halfExtents(p, aspect);
      expect(p.x / w).toBeGreaterThan(0.4);   // direita
      expect(p.y / h).toBeLessThan(-0.4);     // baixo
    }
  });

  it('a mão acompanha a tela: mais largo, mais para a direita', () => {
    const estreito = handPose(0, 0, 1, pose()).x;
    const largo = handPose(0, 0, 2.2, pose()).x;
    expect(largo).toBeGreaterThan(estreito);
  });

  it('a escala nunca é zero nem negativa', () => {
    for (const aspect of ASPECTS) {
      expect(handPose(0.5, 0, aspect, pose()).scale).toBeGreaterThan(0);
    }
  });
});

describe('balanço', () => {
  it('começa e termina na mesma pose', () => {
    const inicio = handPose(0, 0, 1.78, pose());
    const fim = handPose(1, 0, 1.78, pose());
    expect(fim.x).toBeCloseTo(inicio.x, 6);
    expect(fim.y).toBeCloseTo(inicio.y, 6);
    expect(fim.pitch).toBeCloseTo(inicio.pitch, 6);
  });

  it('no meio do golpe a mão desce e gira', () => {
    const descanso = handPose(0, 0, 1.78, pose());
    const meio = handPose(0.5, 0, 1.78, pose());
    expect(meio.y).toBeLessThan(descanso.y);
    expect(meio.pitch).toBeGreaterThan(descanso.pitch);
  });
});

describe('passo', () => {
  it('andar move a mão, parar não', () => {
    const a = handPose(0, 0, 1.78, pose());
    const b = handPose(0, Math.PI / 2, 1.78, pose());
    expect(a.x === b.x && a.y === b.y).toBe(false);
  });

  it('o balanço do passo é pequeno perto do golpe', () => {
    const parado = handPose(0, 0, 1.78, pose());
    const andando = handPose(0, Math.PI / 3, 1.78, pose());
    const golpe = handPose(0.5, 0, 1.78, pose());
    expect(Math.abs(andando.y - parado.y)).toBeLessThan(Math.abs(golpe.y - parado.y) / 4);
  });
});


/*
 * Vibração da mão com a tela aberta (relato de campo 2026-09-12: "ao abrir a
 * bancada com a mão vazia, ela fica se movimentando rapidamente para frente e
 * para trás").
 *
 * `tick()` é quem iguala `previous` a `current`. A guarda de "tela de
 * contêiner aberta" no laço saía antes dele, então o golpe disparado pelo
 * mesmo clique que abriu a bancada ficava congelado com `previous = 0` e
 * `current = SWING_TICKS`: `swingAt(alpha)` virava o próprio `alpha`, e a mão
 * completava um golpe inteiro por frame, sem fim.
 */
describe('animação da mão', () => {
  it('sem tick, o golpe disparado varre a pose inteira a cada frame', () => {
    const animation = new HandAnimation();
    animation.swing();
    // É o estado congelado: começo e fim do frame em pontos opostos do golpe.
    expect(animation.swingAt(0)).toBe(0);
    expect(animation.swingAt(1)).toBe(1);
    expect(animation.settled).toBe(false);
  });

  it('com tick todo tick, o golpe termina e a pose para de depender do alpha', () => {
    const animation = new HandAnimation();
    animation.swing();
    // Parado, com tela aberta: `speed` 0, mas o tick acontece.
    for (let i = 0; i < SWING_TICKS + 1; i++) animation.tick(0);

    expect(animation.settled, 'o golpe tem que acabar').toBe(true);
    expect(animation.swingAt(0)).toBe(animation.swingAt(1));
    for (let step = 0; step <= 4; step++) {
      expect(animation.swingAt(step / 4), 'mão parada não se mexe dentro do frame').toBe(0);
    }
  });

  it('parado e sem golpe, o balanço de caminhada não anda', () => {
    const animation = new HandAnimation();
    for (let i = 0; i < 10; i++) animation.tick(0);
    expect(animation.bobAt(0)).toBe(animation.bobAt(1));
  });
});
