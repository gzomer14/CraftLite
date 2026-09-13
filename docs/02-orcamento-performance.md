# 02 — Orçamento de Performance

Este documento é **normativo**. Se uma feature não cabe no orçamento, a feature muda — não o orçamento.

## 1. Metas por tier

| | **T0 — celular antigo** | **T1 — celular médio** | **T2 — desktop** |
|---|---|---|---|
| Referência | Android 7, 2 GB RAM, Adreno 405 | Android 11, 4 GB, Adreno 610 | qualquer GPU integrada |
| FPS alvo | **30** | 60 | 60+ |
| Render distance | **4** chunks (144 m) | 6–8 | 12–16 |
| Simulation distance | 3 | 4 | 6 |
| Resolução de render | `min(dpr, 1.0)`, escala 0.75× opcional | `min(dpr, 1.5)` | `min(dpr, 2)` |
| Smooth lighting (AO) | ON (é barato, feito no mesh) | ON | ON |
| Sombras de entidade | OFF | ON (blob simples) | ON |
| Nuvens | OFF | Fast (plano 2D) | Fancy (volumétrico simples) |
| Partículas | Mínimo | Reduzido | Todas |
| Folhas | Opacas (fast) | Fancy | Fancy |
| Máx. mobs vivos | 20 | 40 | 70 |
| Workers | 2 | 2 | 3–4 |

> **T0 usa 2 workers desde 2026-09-12.** A tabela dizia 1, por prudência. O Galaxy J7 Metal — o
> aparelho de referência do tier — mostrou que a prudência estava no lugar errado: 60 FPS com
> **2,7 ms de render num orçamento de 33,3**, ou seja, a máquina ociosa enquanto gerava o mundo
> com uma thread só, e o jogador andando mais rápido do que o terreno nascia. O gargalo de T0 não
> é o frame, é a taxa de geração. `presetFor` corta por `min(workers, núcleos − 1)`, então o
> aparelho de 2 núcleos volta a 1 sozinho e nada aqui o ameaça.

## 2. Orçamento de frame (T0, 30 FPS = 33,3 ms)

| Item | ms |
|---|---|
| Tick de jogo (física, mobs, blocos) — só quando o tick roda | ≤ 6 |
| Upload de meshes prontos (VBO) | ≤ 2 |
| Culling + montagem do draw list | ≤ 2 |
| Draw calls (GPU-bound, CPU-side) | ≤ 4 |
| UI/DOM (só quando muda) | ≤ 1 |
| **Folga para GC e navegador** | ≥ 18 |

**Regra dura: zero alocação por frame no caminho quente.** Nada de `new Vec3()` dentro do loop.
Usar pools e escrever em objetos pré-alocados. GC major de 100 ms em celular fraco = 3 frames perdidos.

## 3. Orçamento de memória (T0, render distance 4 = 81 chunks)

| Item | Cálculo | Total |
|---|---|---|
| Voxels (paletted, 4 bits médio) | 81 × 128×16×16 × 0.5 B | ~1,3 MB |
| Luz (block + sky, nibble cada) | 81 × 32768 × 1 B | ~2,7 MB |
| Meshes na GPU | ~81 × 250 KB | ~20 MB |
| Meshes espelhados na CPU | descartar após upload | 0 |
| Texturas (array 256 × 16×16 RGBA + mips) | | ~0,34 MB |
| Código + heap JS | | ~40 MB |
| **Total alvo** | | **< 350 MB RSS** |

**Descartar o ArrayBuffer do mesh no main thread logo após `bufferData`.** Ele já foi transferido
do worker; manter dobra o custo.

**O teto de camadas do atlas é 256, não 128** (revisto no M7). A linha antiga era arbitrária e
travava em 127 de 128 antes do redstone entrar; o GLES 3.0 garante no mínimo 256 camadas de
`TEXTURE_2D_ARRAY` em qualquer aparelho, e 256 × 16×16 RGBA com mips custa 0,34 MB dentro de um
alvo de 350 MB de RSS. Nada no código aplica o limite — ele é orçamento, e quem o excede paga em
memória de textura, não em correção.

## 4. Orçamento de download

| Item | Máx |
|---|---|
| JS (gzip/brotli) | 250 KB |
| CSS | 15 KB |
| HTML | 5 KB |
| Fonte (subset) | 25 KB |
| Imagens/áudio | **0 KB** (tudo procedural) |
| **Total first load** | **< 350 KB** |

Time-to-interactive alvo em 3G: **< 5 s**. Tela de título aparece antes de qualquer worker subir.

## 5. Técnicas obrigatórias

### 5.1 Greedy meshing
Mesclar faces coplanares adjacentes com mesma textura, mesma luz e mesmo AO em um único quad.
Reduz 70–90% dos vértices em terreno típico.

Implementação recomendada (**binary greedy meshing**): para cada uma das 3 direções de eixo,
montar máscaras de bits `uint32` por linha e usar `Math.clz32`/operações de bit para achar corridas.
É ~5–10× mais rápido que a varredura ingênua e roda em ~1–3 ms por section em celular.

Passos por section (16³):
1. Para cada eixo (X, Y, Z) e cada sentido (+/−): 32 planos de máscara.
2. Uma face é visível se o voxel é sólido e o vizinho naquele sentido é transparente.
3. Faces só se mesclam se tiverem **mesma textura, mesmo nível de luz e mesmo padrão de AO**.
   (Isto é o que impede mesclagem excessiva e mantém a iluminação correta.)
4. Emitir quad com `u`,`v` escalados pelo tamanho da corrida; o shader usa `fract()` + `GL_REPEAT`
   por camada do texture array.

### 5.2 Ambient Occlusion de vértice
Para cada canto de cada face, contar quantos dos 3 voxels vizinhos (2 lados + 1 diagonal) são sólidos:

```
side1, side2, corner  →  ao = (side1 && side2) ? 0 : 3 - (side1 + side2 + corner)
```
`ao ∈ {0,1,2,3}` mapeia para multiplicadores `{0.55, 0.70, 0.85, 1.0}`.
**Flip do quad** quando `ao[0] + ao[2] > ao[1] + ao[3]` para evitar artefato de interpolação diagonal.

### 5.3 Iluminação incremental
Nunca recalcular a coluna inteira. Ao quebrar/colocar um bloco:
- Fila BFS de **remoção** (propaga escuridão até achar fonte maior) e fila de **adição**.
- Trabalhar em `Uint8Array` com fila circular pré-alocada (`Int32Array` de 32768 entradas).
- Marcar sections tocadas como "dirty" e re-meshar só elas + vizinhas afetadas.
- Custo típico de colocar uma tocha: < 0,5 ms.

### 5.4 Pipeline de chunks com prioridade
```
estados: EMPTY → GENERATING → GENERATED → LIGHTING → LIT → MESHING → READY
```
- Fila de prioridade por `distância² ao jogador`, com bônus para quem está no frustum.
- Máximo de chunks em voo simultâneo: `2 × nWorkers`.
- **Nunca** carregar mais de 1 anel de chunks por segundo em T0 — carregar devagar é melhor que travar.

### 5.5 Anti-GC
- Pools para: partículas, entidades, vetores temporários, mensagens de worker.
- `TypedArray` em tudo que é grande.
- Evitar `Array.prototype.map/filter/forEach` no caminho quente (alocam closures em engines antigas).
- Evitar strings como chave de `Map` no loop de render.
- Reusar objetos de mensagem de worker; transferir buffers de volta para reciclar
  (**buffer ring**: o main thread devolve o ArrayBuffer vazio ao worker após o upload).

### 5.6 Render
- `antialias: false`, `alpha: false`, `depth: true`, `stencil: false`, `preserveDrawingBuffer: false`.
- `desynchronized: true` (reduz latência de input em Chrome mobile).
- VAOs (WebGL2 nativo, `OES_vertex_array_object` em WebGL1).
- Ordenar draws opacos front-to-back (early-Z ajuda muito em tile-based GPUs mobile).
- **Nunca** ler de volta da GPU (`readPixels`, `getError` no loop) — causa stall completo.
- Índices `UNSIGNED_SHORT` (65535 vértices por buffer); dividir mesh se estourar.
- Uma alocação de VBO por section com `bufferData(..., DYNAMIC_DRAW)` reutilizando o buffer se o
  tamanho couber (evita realocação de GPU).

### 5.7 Escala dinâmica de resolução
Se a média móvel de frame time passar de `1.2 × alvo` por 60 frames, reduzir `renderScale` em
0,1 (mínimo 0,6) e re-criar os framebuffers. Se ficar abaixo de `0.8 × alvo` por 180 frames, subir.
Nunca mexer no render distance automaticamente sem avisar o jogador (é perceptível demais).

## 6. Instrumentação obrigatória

Tela de debug (tecla **F3** / gesto de 3 dedos no mobile) mostrando:
```
fps 32 (31.2ms)  |  gpu ~?  |  mem 210MB
XYZ 128.5 / 71.0 / -344.2   chunk 8 4 -22
biome: forest   light: b0 s15   facing: north (+Z)
C: 81/81 loaded, 3 queued, 1 meshing
V: 214k verts, 76 draw calls
T: tick 3.1ms  mesh-upload 0.8ms  render 12.4ms
```
E um gráfico de frame time (últimos 120 frames) desenhado em canvas 2D pequeno.
