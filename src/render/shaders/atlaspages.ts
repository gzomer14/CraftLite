/**
 * Amostrar o atlas de blocos em uma ou duas páginas (M25).
 *
 * O vértice endereça 512 camadas (9 bits), mas o GLES 3.0 só garante 256 por
 * `TEXTURE_2D_ARRAY`. Na GPU que aceita todas num array só — a maioria, que
 * aceita 2048 —, nada muda: este trecho vira um `texture()` simples, igual ao
 * de antes. Na que não aceita, o atlas vira duas páginas (`render/atlas.ts`)
 * e os programas são compilados com `ATLAS_PAGES`.
 *
 * Com duas páginas a escolha é por camada, que é a mesma no triângulo inteiro;
 * mesmo assim um quadrado de 2×2 pixels pode pegar dois triângulos de páginas
 * diferentes, e por isso o mip sai de `textureGrad` com o gradiente calculado
 * **fora** do desvio — derivada dentro de desvio é indefinida no GLSL.
 *
 * Vai logo depois da declaração de `uniform sampler2DArray uAtlas`.
 */
export const ATLAS_TEXEL_300 = `
#ifdef ATLAS_PAGES
uniform sampler2DArray uAtlasHigh;
uniform float uAtlasSplit;
#endif
// \`st\` é a coordenada no ladrilho; \`grad\`, a que decide o mip (sem o fract).
vec4 atlasTexel(vec2 st, float layer, vec2 grad) {
#ifdef ATLAS_PAGES
  vec2 gx = dFdx(grad);
  vec2 gy = dFdy(grad);
  if (layer >= uAtlasSplit) return textureGrad(uAtlasHigh, vec3(st, layer - uAtlasSplit), gx, gy);
  return textureGrad(uAtlas, vec3(st, layer), gx, gy);
#else
  return texture(uAtlas, vec3(st, layer));
#endif
}
`;

/** Unidade de textura da segunda página. A 0 é a primeira; 1 e 2 são do tint de bioma. */
export const ATLAS_HIGH_UNIT = 3;
