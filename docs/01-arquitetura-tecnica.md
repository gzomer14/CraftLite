# 01 — Arquitetura Técnica

## 1. Stack

| Camada | Escolha | Por quê |
|---|---|---|
| Linguagem | **TypeScript** (strict) | Segurança em tabelas de dados grandes; compila para JS puro |
| Build | **Vite** + `esbuild`, target `es2017` | Tree-shaking agressivo; `es2017` roda em WebView Android 7+ |
| Render | **WebGL2 puro** (fallback WebGL1) | Three.js custa ~600 KB e overhead de cena que não usamos |
| UI | **DOM + CSS** sobre o canvas | Muito mais barato que desenhar UI no canvas; texto acessível |
| Estado | Módulos simples + event bus próprio | Sem React/Redux — custo de bundle e GC injustificável |
| Threads | **Web Workers** (worldgen + meshing) | Frame principal só renderiza e simula |
| Storage | **IndexedDB** via wrapper próprio (~2 KB) | Sem `idb`/`dexie` |
| Áudio | **WebAudio API** com síntese procedural | Zero bytes de samples |
| Offline | Service Worker + manifest PWA | Instalável na home screen do celular |

**Dependências de runtime permitidas: zero.** Tudo é código do projeto. Dev-dependencies
(vite, typescript, vitest, eslint) são livres.

## 2. Estrutura de pastas

```
minecraft-web/
├─ index.html
├─ vite.config.ts
├─ public/
│  ├─ manifest.webmanifest
│  └─ sw.js
├─ src/
│  ├─ main.ts                    # bootstrap, detecção de device, game loop
│  ├─ core/
│  │  ├─ loop.ts                 # fixed timestep + accumulator
│  │  ├─ events.ts               # event bus tipado
│  │  ├─ rng.ts                  # PRNG determinístico (xoroshiro128**)
│  │  ├─ noise.ts                # Perlin/Simplex + FBM, domain warp
│  │  └─ math.ts                 # vec3, AABB, raycast DDA, frustum
│  ├─ data/                      # ← TABELAS DECLARATIVAS (sem lógica)
│  │  ├─ blocks.ts
│  │  ├─ items.ts
│  │  ├─ recipes.ts
│  │  ├─ smelting.ts
│  │  ├─ mobs.ts
│  │  ├─ biomes.ts
│  │  └─ loot.ts
│  ├─ world/
│  │  ├─ chunk.ts                # ChunkColumn, ChunkSection, palette
│  │  ├─ world.ts                # mapa de chunks, load/unload, tick
│  │  ├─ lighting.ts             # flood fill BFS luz de bloco + céu
│  │  ├─ raycast.ts              # seleção de bloco (voxel traversal)
│  │  ├─ physics.ts              # AABB sweep contra voxels
│  │  ├─ blockupdate.ts          # queda de areia, fluxo de água, plantas
│  │  └─ fluids.ts               # água/lava com nível 0-7
│  ├─ workers/
│  │  ├─ gen.worker.ts           # geração de terreno
│  │  ├─ mesh.worker.ts          # greedy meshing + AO
│  │  └─ protocol.ts             # tipos das mensagens (transferables)
│  ├─ render/
│  │  ├─ gl.ts                   # contexto, capabilities, extensões
│  │  ├─ shaders/*.glsl.ts       # como template strings (evita fetch)
│  │  ├─ terrain.ts              # draw de chunks opacos/transparentes
│  │  ├─ entities.ts             # mobs, itens dropados (instanced)
│  │  ├─ sky.ts                  # gradiente, sol, lua, estrelas, nuvens
│  │  ├─ particles.ts            # instanced quads
│  │  ├─ hand.ts                 # item na mão em 1ª pessoa
│  │  └─ atlas.ts                # gera texture array/atlas em runtime
│  ├─ entity/
│  │  ├─ entity.ts               # base: AABB, velocity, tick
│  │  ├─ player.ts
│  │  ├─ mob.ts + ai/*.ts        # goals: wander, followPlayer, attack, flee
│  │  └─ itementity.ts           # drop no chão
│  ├─ game/
│  │  ├─ inventory.ts
│  │  ├─ crafting.ts             # matcher shaped/shapeless
│  │  ├─ container.ts            # baú, fornalha, bancada
│  │  ├─ interaction.ts          # break/place/use, tempo de quebra
│  │  ├─ daynight.ts
│  │  └─ spawning.ts             # regras de spawn/despawn de mobs
│  ├─ ui/
│  │  ├─ screens/*.ts            # title, worldselect, pause, options, death
│  │  ├─ hud.ts                  # hotbar, corações, coxas, crosshair
│  │  ├─ containers/*.ts         # inventory, crafting, furnace, chest
│  │  ├─ widgets.ts              # Button, Slider, Toggle, Slot, Tooltip
│  │  └─ theme.css
│  ├─ input/
│  │  ├─ keyboard.ts
│  │  ├─ mouse.ts                # pointer lock
│  │  └─ touch.ts                # joystick, look, tap-to-break
│  ├─ audio/
│  │  ├─ synth.ts                # osciladores + noise + envelopes
│  │  └─ sounds.ts               # tabela de "receitas" de som por evento
│  └─ save/
│     ├─ db.ts                   # IndexedDB
│     └─ serialize.ts            # chunk → bytes (palette + RLE)
└─ docs/                          # esta documentação
```

## 3. Modelo de dados do mundo

### 3.1 Coordenadas
- Bloco: inteiros `(x, y, z)`. `y ∈ [0, 127]`. **Y=0 é bedrock, Y=63 é o nível do mar.**
- Chunk: coluna de `16 × 128 × 16`, dividida em **8 sections** de `16×16×16`.
- Chave de chunk: `cx * 0x40000000 + cz` empacotado, ou string `` `${cx},${cz}` `` (medir; preferir número).

### 3.2 Armazenamento de blocos
Cada section guarda:

```ts
interface ChunkSection {
  // Paletted storage: a maioria das sections tem <16 blocos distintos
  palette: Uint16Array;      // índice local -> blockStateId global
  paletteLen: number;
  bits: 1 | 2 | 4 | 8 | 16;  // bits por voxel, cresce conforme a paleta
  data: Uint8Array | Uint16Array; // 4096 voxels empacotados
  blockLight: Uint8Array;    // 2048 bytes (nibble por voxel)
  skyLight: Uint8Array;      // 2048 bytes
  nonAirCount: number;       // 0 => section vazia, pula meshing e render
}
```

- Section 100% ar → `data = null` (sentinela). Economiza ~70% da memória do mundo.
- **BlockState ID**: `uint16`. Bits `0..9` = tipo de bloco (até 1024 tipos), bits `10..15` = estado
  (rotação, nível de fluido, idade de plantação, aberto/fechado). Ver [04-blocos.md](04-blocos.md).

### 3.3 Tick do mundo
- **Fixed timestep de 20 ticks/s (50 ms)**, igual ao original. Render é livre (rAF), com
  interpolação de posição entre ticks (`alpha`).
- **A câmera é a exceção: ela é lida por quadro desenhado, não por tick.** Posição é simulação e
  tem estado anterior de verdade, então interpola; rotação é **input**, e interpolar input só
  adiciona um tick de atraso e continua entregando a velocidade em degraus de 50 ms. Ler o mouse
  na hora de desenhar é o que faz a câmera acompanhar o display em vez de andar de 20 em 20 Hz
  (relato de campo 2026-09-14: *"a câmera se move pulando, como se fosse movimentação por
  teclado"*). Mouse e dedo entregam pixels acumulados e não são escalados pelo tempo; analógico
  entrega velocidade e é multiplicado pela duração do quadro.
- Se o navegador atrasar, limitar a **5 ticks de catch-up por frame** e então descartar o resto
  (evita espiral da morte).
- **Random ticks**: por section carregada, 3 posições aleatórias por tick recebem `randomTick()`
  (crescimento de grama, plantação, derretimento de neve, propagação de fogo).

## 4. Threading

```
┌──────────── Main Thread ────────────┐
│ input → tick(20Hz) → render(rAF)    │
│ UI/DOM, áudio, física do jogador    │
└──┬───────────────────────▲──────────┘
   │ {cx,cz,seed}          │ {cx,cz, sections:[ArrayBuffer]}   (transferable)
   ▼                       │
┌────── gen.worker (×N) ───┘
│ ruído → terreno → cavernas → minérios → decoração
└──┬───────────────────────▲──────────┐
   │ {sectionData + vizinhos}         │ {vertices:ArrayBuffer, indices:ArrayBuffer}
   ▼                                  │
┌────── mesh.worker (×N) ─────────────┘
│ greedy meshing + ambient occlusion + separação opaco/transparente
└──────────────────────────────────────
```

- `N = clamp(navigator.hardwareConcurrency - 1, 1, 4)`. Em celular fraco, N=1 e os dois papéis
  compartilham o mesmo worker.
- **Toda transferência usa `postMessage(buf, [buf])` (transferable)** — zero cópia.
- Os workers **não** têm acesso ao `World`; recebem cópias imutáveis do que precisam.
  Para meshing, mandar a section + as 6 bordas vizinhas (1 camada) em um único buffer de
  `18×18×18` voxels para não precisar de sincronização.
- Fila de prioridade: chunks mais próximos do jogador e dentro do frustum primeiro.
- **Orçamento por frame no main thread: 2 ms** para aplicar meshes prontos (upload de VBO).
  Se estourar, o resto fica para o próximo frame.

## 5. Renderer

### 5.1 Formato de vértice (crítico para memória)
Um vértice comprimido em **8 bytes**:

```
uint32 #1:  x:6 | y:7 | z:6  (posição no chunk, 0..16 com meio-bloco)  = 19 bits
            | normal/face:3                                            = 22 bits
            | ao:2                                                     = 24 bits
            | u:4 | v:4  (canto do quad, para greedy: tamanho do tile)  = 32 bits
uint32 #2:  texLayer:10 | blockLight:4 | skyLight:4 | tint:6 | flags:8
```
Descompactado no vertex shader com bit ops (WebGL2 suporta `int` nativo).
Em WebGL1 (fallback), usar 2 `vec4` de floats (16 bytes) — aceita-se o custo.

### 5.2 Texturas
- **WebGL2:** `TEXTURE_2D_ARRAY`, 16×16 por camada, ~64–128 camadas, mipmaps até nível 2,
  filtro `NEAREST` + `NEAREST_MIPMAP_LINEAR`. Uma camada por face-textura.
  **Uma única draw call por chunk-section, independente de quantos blocos diferentes tem.**
- **WebGL1:** atlas 256×256 (16×16 tiles) com padding de 1px repetido nas bordas para evitar
  bleeding do mipmap.
- O atlas é **gerado em runtime** no boot em um `OffscreenCanvas` por código procedural
  (ver [13-assets-e-arte.md](13-assets-e-arte.md)) — custa ~15 ms e 0 bytes de download.

### 5.3 Passes de render (por frame)
1. **Sky**: fullscreen quad com gradiente por hora do dia + sol/lua/estrelas. Sem depth write.
2. **Terreno opaco**: front-to-back, depth test, `CULL_FACE`. Uma draw call por section visível.
3. **Entidades**: instanced. Um `drawElementsInstanced` por tipo de mob.
4. **Terreno transparente** (água, vidro, folhas em modo fancy): back-to-front, blend on, depth write off.
5. **Partículas**: instanced quads billboard.
6. **Item na mão**: viewport separado com FOV menor, depth cleared.
7. **UI**: DOM, fora do canvas.

### 5.4 Culling
- **Frustum culling** por AABB de section (obrigatório).
- **Face culling entre chunks**: uma face só entra no mesh se o vizinho for transparente/ar.
- **Occlusion culling por conectividade** (recomendado, grande ganho em cavernas): para cada
  section, precomputar quais dos 6 lados se conectam por ar via flood fill; ao caminhar o grafo de
  sections a partir da câmera, só visitar as conectadas. Corta 60–80% do trabalho no subsolo.
- **Sem** occlusion queries de GPU (mal suportado em mobile).

### 5.5 Shaders — o essencial
- Vertex: descompacta atributos, aplica MVP, calcula `light = max(blockLight, skyLight * dayFactor)`
  e `finalLight = pow(0.8, 15 - light)` (curva do original), multiplica por AO.
- Fragment: `texture(atlas, vec3(uv, layer)) * light * tint`, discard se `alpha < 0.5` (folhas, grama alta),
  fog exponencial `exp(-(d * fogDensity)^2)` com cor do céu.
- **Nada de branch dinâmico no fragment shader.** Variantes de shader compiladas com `#define`.

## 6. Loop principal

```ts
const TICK_MS = 50;
let acc = 0, last = performance.now();

function frame(now: number) {
  const dt = Math.min(now - last, 250); last = now;
  acc += dt;
  let steps = 0;
  while (acc >= TICK_MS && steps++ < 5) { world.tick(); player.tick(); acc -= TICK_MS; }
  const alpha = acc / TICK_MS;
  chunkPipeline.pump(2 /* ms budget */);
  renderer.render(alpha);
  requestAnimationFrame(frame);
}
```

## 7. Detecção de capacidade e presets (no boot)

```ts
const gl2 = canvas.getContext('webgl2', { antialias:false, powerPreference:'high-performance',
                                          desynchronized:true, alpha:false, depth:true, stencil:false });
const tier = detectTier({
  hasWebGL2: !!gl2,
  memGB: (navigator as any).deviceMemory ?? 2,
  cores: navigator.hardwareConcurrency ?? 2,
  isMobile: matchMedia('(pointer: coarse)').matches,
  maxTexSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
});
```
`tier` → preset de render distance, partículas, sombras de entidade, nuvens, smooth lighting,
resolução de render (`devicePixelRatio` clamp). Ver [02-orcamento-performance.md](02-orcamento-performance.md).

**Sempre permitir override manual nas opções** — a detecção erra.
