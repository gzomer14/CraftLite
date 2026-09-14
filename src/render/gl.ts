/**
 * Criação do contexto WebGL2 (com fallback WebGL1), leitura de capacidades e
 * utilitários de shader/buffer. Flags conforme doc 02 §5.6.
 */

export type AnyGL = WebGL2RenderingContext | WebGLRenderingContext;

export interface GlCaps {
  /** true = WebGL2; false = caminho de fallback WebGL1. */
  webgl2: boolean;
  maxTextureSize: number;
  maxArrayLayers: number;
  /** Instancing disponível (nativo no WebGL2, extensão no WebGL1). */
  instancing: boolean;
  /** VAO disponível (nativo no WebGL2, extensão no WebGL1). */
  vao: boolean;
  /** Índices de 32 bits — permite meshes com > 65535 vértices. */
  uint32Indices: boolean;
  anisotropy: number;
  vendor: string;
  renderer: string;
}

export interface GlContext {
  gl: AnyGL;
  gl2: WebGL2RenderingContext | null;
  caps: GlCaps;
  canvas: HTMLCanvasElement;
  /** Extensões do fallback WebGL1, nulas em WebGL2. */
  extVao: OES_vertex_array_object | null;
  extInstanced: ANGLE_instanced_arrays | null;
}

const CONTEXT_ATTRS: WebGLContextAttributes = {
  alpha: false,
  depth: true,
  stencil: false,
  antialias: false,
  premultipliedAlpha: false,
  preserveDrawingBuffer: false,
  powerPreference: 'high-performance',
  failIfMajorPerformanceCaveat: false,
  /*
   * **Desligado.** Ligado, ele tira o canvas da sincronia com o compositor —
   * a especificação diz, com todas as letras, que nesse modo pode haver
   * tearing e quadro apresentado fora de hora. Num painel de taxa variável
   * (LTPO), que muda de 120 para 60 Hz sozinho, isso vira **piscada**: o
   * jogador do S24 Ultra relatou a textura sumindo e voltando o tempo todo,
   * com a tela parada, e só nesse aparelho (2026-09-13). O que se ganhava era
   * alguns milissegundos de latência de toque; o que se perdia era poder
   * jogar. Ver também o teto de FPS em `core/loop.ts`, que devolve o quadro
   * sem desenhar: sem sincronia com o compositor, quadro não desenhado é
   * conteúdo indefinido na tela.
   */
  desynchronized: false,
};

/**
 * Cria o contexto. `vsync` é a opção do doc 08 §3.11 — ver o comentário de
 * `desynchronized` acima: ligado (padrão) é o caminho seguro, desligado é o que
 * piscou no S24 Ultra. Só se decide aqui porque atributo de contexto não muda
 * depois de o contexto existir.
 */
export function createContext(canvas: HTMLCanvasElement, vsync = true): GlContext {
  const attrs: WebGLContextAttributes = vsync
    ? CONTEXT_ATTRS
    : { ...CONTEXT_ATTRS, desynchronized: true };
  // `?gl1` força o caminho de fallback — é como se testa WebGL1 sem um aparelho
  // que só tenha WebGL1 (faz parte da matriz de teste manual de cada marco).
  const forceGl1 = location.search.indexOf('gl1') >= 0;
  const gl2 = forceGl1
    ? null
    : (canvas.getContext('webgl2', attrs) as WebGL2RenderingContext | null);
  const gl: AnyGL | null =
    gl2 ?? (canvas.getContext('webgl', attrs) as WebGLRenderingContext | null);

  if (gl === null) {
    throw new Error('WebGL indisponível neste navegador.');
  }

  const extVao = gl2 ? null : (gl.getExtension('OES_vertex_array_object') as OES_vertex_array_object | null);
  const extInstanced = gl2
    ? null
    : (gl.getExtension('ANGLE_instanced_arrays') as ANGLE_instanced_arrays | null);
  const extUint = gl2 ? null : gl.getExtension('OES_element_index_uint');
  const extAniso =
    (gl.getExtension('EXT_texture_filter_anisotropic') as EXT_texture_filter_anisotropic | null) ??
    (gl.getExtension('WEBKIT_EXT_texture_filter_anisotropic') as EXT_texture_filter_anisotropic | null);
  const dbgInfo = gl.getExtension('WEBGL_debug_renderer_info') as WEBGL_debug_renderer_info | null;

  const caps: GlCaps = {
    webgl2: gl2 !== null,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE) as number,
    maxArrayLayers: gl2 ? (gl2.getParameter(gl2.MAX_ARRAY_TEXTURE_LAYERS) as number) : 0,
    instancing: gl2 !== null || extInstanced !== null,
    vao: gl2 !== null || extVao !== null,
    uint32Indices: gl2 !== null || extUint !== null,
    anisotropy: extAniso
      ? (gl.getParameter(extAniso.MAX_TEXTURE_MAX_ANISOTROPY_EXT) as number)
      : 1,
    vendor: dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_VENDOR_WEBGL)) : 'desconhecido',
    renderer: dbgInfo ? String(gl.getParameter(dbgInfo.UNMASKED_RENDERER_WEBGL)) : 'desconhecido',
  };

  return { gl, gl2, caps, canvas, extVao, extInstanced };
}

/** Compila e linka um programa. Erros de shader são fatais — falham no boot, não no loop. */
export function createProgram(gl: AnyGL, vertexSrc: string, fragmentSrc: string, label: string): WebGLProgram {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vertexSrc, `${label}.vert`);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fragmentSrc, `${label}.frag`);
  const program = gl.createProgram();
  if (program === null) throw new Error(`Falha ao criar o programa ${label}.`);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  // getProgramParameter só é lido aqui, no boot — nunca dentro do loop (doc 02 §5.6).
  if (gl.getProgramParameter(program, gl.LINK_STATUS) !== true) {
    const log = gl.getProgramInfoLog(program) ?? '';
    throw new Error(`Falha ao linkar ${label}: ${log}`);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return program;
}

function compileShader(gl: AnyGL, type: number, source: string, label: string): WebGLShader {
  const shader = gl.createShader(type);
  if (shader === null) throw new Error(`Falha ao criar o shader ${label}.`);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (gl.getShaderParameter(shader, gl.COMPILE_STATUS) !== true) {
    const log = gl.getShaderInfoLog(shader) ?? '';
    gl.deleteShader(shader);
    throw new Error(`Falha ao compilar ${label}: ${log}`);
  }
  return shader;
}

/** Coleta os locais de uniform de uma vez, no boot, para não consultar por frame. */
export function uniformLocations<K extends string>(
  gl: AnyGL,
  program: WebGLProgram,
  names: readonly K[],
): Record<K, WebGLUniformLocation | null> {
  const out = {} as Record<K, WebGLUniformLocation | null>;
  for (const name of names) out[name] = gl.getUniformLocation(program, name);
  return out;
}
