/**
 * Passe de terreno: um programa, um conjunto de uniforms e uma draw call por
 * malha (doc 01 §5.3, passo 2).
 *
 * O programa é escolhido no boot conforme o contexto: WebGL2 usa atributos
 * inteiros e `sampler2DArray`; WebGL1 usa floats e um atlas 2D.
 */

import { createProgram, uniformLocations, type GlContext } from './gl';
import { TINT_COLORS } from '../data/tints';
import {
  TERRAIN_FS_100, TERRAIN_FS_300, TERRAIN_VS_100, TERRAIN_VS_300, withDefines,
} from './shaders/terrain.glsl';
import type { Atlas } from './atlas';
import type { BiomeTint } from './biometint';
import type { Mat4 } from '../core/math';

const UNIFORMS = [
  'uViewProj', 'uChunkOrigin', 'uDayFactor', 'uMinSkyLight',
  'uAtlas', 'uAtlasTiles', 'uFogColor', 'uFogDensity', 'uTints', 'uMediumTint',
  'uClimate', 'uColormap', 'uClimateInv', 'uBiomeTint',
] as const;

/** Unidades de textura do tint de bioma; o atlas fica na 0. */
const CLIMATE_UNIT = 1;
const COLORMAP_UNIT = 2;

export interface SkyParams {
  fogColor: Float32Array;
  fogDensity: number;
  dayFactor: number;
  minSkyLight: number;
  /** Tom multiplicado na cor antes da névoa: branco no ar, azul na água (M14). */
  tint: Float32Array;
}

export class TerrainPass {
  private readonly ctx: GlContext;
  private readonly atlas: Atlas;
  private readonly biomeTint: BiomeTint | null;
  private readonly opaque: WebGLProgram;
  private readonly cutout: WebGLProgram;
  private readonly uOpaque: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private readonly uCutout: Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>;
  private active: WebGLProgram | null = null;

  /** Contadores lidos pelo overlay de debug — atualizados sem alocar. */
  drawCalls = 0;
  vertices = 0;

  constructor(ctx: GlContext, atlas: Atlas, biomeTint: BiomeTint | null = null) {
    this.ctx = ctx;
    this.atlas = atlas;
    this.biomeTint = biomeTint;
    const use300 = ctx.gl2 !== null;
    const vs = use300
      ? withDefines(TERRAIN_VS_300, biomeTint !== null ? ['BIOME_TINT'] : [])
      : TERRAIN_VS_100;
    const fs = use300 ? TERRAIN_FS_300 : TERRAIN_FS_100;

    this.opaque = createProgram(ctx.gl, vs, fs, 'terrain');
    this.cutout = createProgram(ctx.gl, vs, withDefines(fs, ['ALPHA_TEST']), 'terrain-cutout');
    this.uOpaque = uniformLocations(ctx.gl, this.opaque, UNIFORMS);
    this.uCutout = uniformLocations(ctx.gl, this.cutout, UNIFORMS);
  }

  /** Prepara o programa e os uniforms que valem para o frame inteiro. */
  begin(viewProj: Mat4, sky: SkyParams, cutout: boolean): void {
    const gl = this.ctx.gl;
    const program = cutout ? this.cutout : this.opaque;
    const u = cutout ? this.uCutout : this.uOpaque;

    gl.useProgram(program);
    this.active = program;

    this.atlas.bind(0);
    gl.uniform1i(u.uAtlas, 0);
    if (!this.atlas.isArray) {
      gl.uniform2f(u.uAtlasTiles, this.atlas.tilesPerRow, 1 / this.atlas.tilesPerRow);
    }
    gl.uniformMatrix4fv(u.uViewProj, false, viewProj);
    gl.uniform1f(u.uDayFactor, sky.dayFactor);
    gl.uniform1f(u.uMinSkyLight, sky.minSkyLight);
    gl.uniform3fv(u.uFogColor, sky.fogColor);
    gl.uniform1f(u.uFogDensity, sky.fogDensity);
    gl.uniform3fv(u.uMediumTint, sky.tint);
    // A tabela de tints é fixa; subir a cada `begin` custa 60 floats, três vezes
    // por quadro — mais barato que guardar estado por programa.
    gl.uniform3fv(u.uTints, TINT_COLORS);
    const tint = this.biomeTint;
    if (tint !== null) {
      tint.bind(CLIMATE_UNIT, COLORMAP_UNIT);
      gl.uniform1i(u.uClimate, CLIMATE_UNIT);
      gl.uniform1i(u.uColormap, COLORMAP_UNIT);
      gl.uniform1f(u.uClimateInv, tint.inverseSide);
      gl.uniform1f(u.uBiomeTint, tint.enabled ? 1 : 0);
    }
  }

  /** Define a origem da section atual (posições no vértice são locais). */
  setOrigin(x: number, y: number, z: number, cutout: boolean): void {
    const u = cutout ? this.uCutout : this.uOpaque;
    this.ctx.gl.uniform3f(u.uChunkOrigin, x, y, z);
  }

  end(): void {
    this.active = null;
  }

  get isActive(): boolean {
    return this.active !== null;
  }

  resetCounters(): void {
    this.drawCalls = 0;
    this.vertices = 0;
  }
}
