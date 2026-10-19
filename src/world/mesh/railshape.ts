/**
 * Formas de trilho (M7): a codificação do estado e quais lados cada forma liga.
 *
 * Saiu de `mesh/shapes.ts` no M24, que passava de 900 linhas; lá ficou a
 * geometria em caixas. `shapes.ts` re-exporta tudo daqui, então quem importava
 * de lá continua importando.
 */

/**
 * Formas de trilho nos bits 0..3 do estado (M7), na codificação do gênero.
 *
 * 0..1 são as retas, 2..5 as rampas (o nome diz para onde **sobe**) e 6..9 as
 * curvas (o nome diz quais dois lados a curva liga). Trilho motorizado e
 * detector só usam 0..5: curva com máquina dentro não existe.
 */
export const RAIL_NS = 0;
export const RAIL_EW = 1;
export const RAIL_ASCEND_EAST = 2;
export const RAIL_ASCEND_WEST = 3;
export const RAIL_ASCEND_NORTH = 4;
export const RAIL_ASCEND_SOUTH = 5;
export const RAIL_CURVE_SE = 6;
export const RAIL_CURVE_SW = 7;
export const RAIL_CURVE_NW = 8;
export const RAIL_CURVE_NE = 9;
/** Bit de "energizado" do trilho motorizado e do detector. */
export const RAIL_POWERED = 16;
/** Primeira forma de rampa e primeira de curva, para as comparações de faixa. */
export const RAIL_FIRST_SLOPE = RAIL_ASCEND_EAST;
export const RAIL_FIRST_CURVE = RAIL_CURVE_SE;

/** true se a forma é uma rampa. */
export function railIsSlope(shape: number): boolean {
  return shape >= RAIL_FIRST_SLOPE && shape < RAIL_FIRST_CURVE;
}

/** true se a forma é uma curva. */
export function railIsCurve(shape: number): boolean {
  return shape >= RAIL_FIRST_CURVE;
}

/**
 * Os dois lados que uma forma de trilho liga, nos índices de `FACING_STEP`
 * (0 = +X, 1 = −X, 2 = +Z, 3 = −Z). A rampa liga os dois lados do próprio eixo.
 */
export const RAIL_LINKS: readonly (readonly [number, number])[] = [
  [2, 3], // NS
  [0, 1], // EW
  [0, 1], // sobe para +X
  [0, 1], // sobe para −X
  [2, 3], // sobe para −Z
  [2, 3], // sobe para +Z
  [2, 0], // curva +Z/+X
  [2, 1], // curva +Z/−X
  [3, 1], // curva −Z/−X
  [3, 0], // curva −Z/+X
];

/**
 * A ordem das rampas é +X, −X, −Z, +Z; a de `FACING_STEP` é +X, −X, +Z, −Z.
 * Fora da função desde o M24: o array era criado a cada chamada, no tick do
 * carrinho.
 */
const SLOPE_TO_FACING: readonly number[] = [0, 1, 3, 2];

/** Direção para onde a rampa sobe, ou −1 se a forma é plana. */
export function railSlopeDir(shape: number): number {
  if (!railIsSlope(shape)) return -1;
  return SLOPE_TO_FACING[shape - RAIL_FIRST_SLOPE];
}
