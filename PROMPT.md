# PROMPT MESTRE — CraftLite

> **Como usar:** entregue este arquivo inteiro a um agente de código (Claude Code, Cursor, etc.)
> junto com a pasta `docs/`. Ele é autossuficiente para começar e aponta para os documentos
> normativos quando precisa de detalhe. Se for executar em etapas, use a seção
> **[Plano de execução](#12-plano-de-execução)** — um marco por sessão.

---

## 1. O que construir

Construa **CraftLite**: um jogo de mundo aberto em voxels, jogável direto no navegador, que
reproduz o loop clássico de sobrevivência-e-construção em blocos —

> minerar → coletar → craftar ferramentas melhores → descer mais fundo → sobreviver à noite →
> construir → repetir.

É um **jogo original inspirado no gênero**, não um port. Mecânicas, constantes de gameplay e
convenções de layout de UI são reproduzidas fielmente porque é isso que faz o jogo "sentir certo".
Arte, som, nome, logo, fonte e textos são **criações originais do projeto**, geradas por código.

---

## 2. A restrição que manda em tudo

O requisito mais duro **não é gráfico, é de alcance**: o jogo precisa rodar bem em um
**celular Android de 2016–2018, 2 GB de RAM, GPU Adreno 405/Mali-T720**, num navegador, sem
instalar nada.

**Metas numéricas (não negociáveis):**

| | Valor |
|---|---|
| FPS no celular antigo (tier T0) | **30 estáveis**, render distance 4 |
| FPS no desktop | 60+, render distance 12–16 |
| Bundle total (gzip) | **< 350 KB** — ideal 300 |
| Memória RSS em T0 | **< 350 MB** |
| Time-to-interactive em 3G | < 5 s |
| Assets baixados (imagens/áudio) | **0 KB** — tudo procedural |

**Decisões que decorrem disso, já tomadas — não reabra:**

1. **Sem Three.js, Babylon ou qualquer engine.** Renderer WebGL2 próprio, com fallback WebGL1.
2. **Zero dependências de runtime.** TypeScript + Vite; `vitest`/`eslint` só em dev.
3. **Mundo com altura 128** (Y 0–127), não 384. Corta memória e meshing pela metade.
4. **Texturas geradas por código** no boot, em `OffscreenCanvas` → `TEXTURE_2D_ARRAY`.
5. **Áudio sintetizado** com WebAudio (`OfflineAudioContext` no boot), zero samples.
6. **UI em DOM + CSS** sobre o canvas, não desenhada no canvas.
7. **Geração e meshing em Web Workers**, com transferables e orçamento de tempo por frame.

Se uma feature não couber no orçamento, **a feature muda — o orçamento não**.

---

## 3. Stack e estrutura

- **TypeScript strict**, **Vite**, target `es2017` (roda em WebView Android 7+).
- Estrutura de pastas completa: **[docs/01-arquitetura-tecnica.md](docs/01-arquitetura-tecnica.md) §2**.
- Threading, formato de vértice, passes de render e culling: **doc 01 §4–5**.

Princípio estrutural: **tudo que é dado é dado, não código.** Blocos, itens, receitas, drops,
mobs e biomas vivem em tabelas declarativas em `src/data/`. Adicionar um bloco novo deve ser
**uma linha em uma tabela**, nunca um `case` novo em um `switch`.

---

## 4. Funcionalidades do MVP

Ordem de implementação em §12. Detalhe completo nos documentos indicados.

### 4.1 Mundo — [doc 03](docs/03-mundo-e-geracao.md)
Mundo infinito determinístico a partir de uma seed. Y 0–127, nível do mar 63, bedrock em 0–3.
Ruído Perlin/Simplex com FBM e domain warping; altura por **splines** de continentalidade e erosão
(ruído linear puro dá terreno feio — use as splines do doc). **10 biomas** com blend 5×5 e tint de
cor por bioma para grama/folhas/água. Cavernas em três sistemas 3D (*cheese*, *spaghetti*, ravinas),
com lava abaixo de Y=10. **8 minérios** distribuídos por faixa de Y com curva triangular.
Ciclo dia/noite de 20 minutos (24000 ticks). Física de blocos: gravidade (areia/cascalho), suporte
(tochas/flores), fluidos com nível 0–7 e busca de menor caminho, crescimento por random tick.

### 4.2 Renderização — [doc 01 §5](docs/01-arquitetura-tecnica.md) + [doc 02 §5](docs/02-orcamento-performance.md)
**Greedy meshing binário** (máscaras `uint32` + `Math.clz32`) no worker, mesclando faces só quando
textura, luz e AO batem. **Ambient occlusion de vértice** com a fórmula de 3 vizinhos e flip do quad
quando a diagonal fica errada. Vértice comprimido em **8 bytes**, descompactado no shader.
`TEXTURE_2D_ARRAY` → **uma draw call por section**, independente de quantos blocos diferentes tem.
Frustum culling obrigatório; **occlusion culling por conectividade de sections** fortemente
recomendado (corta 60–80% do trabalho em cavernas). Iluminação por **flood fill BFS incremental**
(luz de bloco + luz do céu, 0–15), nunca recalculando a coluna inteira.

### 4.3 Jogador — [doc 06](docs/06-jogador-e-fisica.md)
As constantes de física estão no doc e são o que faz o jogo sentir certo — **copie-as exatamente**,
inclusive a ordem de integração por tick (input → aceleração → gravidade → colisão por eixo Y/X/Z →
atrito). Hitbox 0.6×1.8, olhos em 1.62, alcance de 4.5 blocos. Auto-step de 0.6. Sweep AABB contra
voxels. Raycast DDA para seleção, com contorno wireframe. Tempo de quebra pela fórmula exata do doc
(com os 10 estágios de rachadura e partículas). Vida 20, fome/saturação/exaustão com a tabela de
valores, regeneração, inanição, dano de queda/afogamento/lava/void, morte e respawn.

### 4.4 Inventário e crafting — [doc 05](docs/05-itens-e-receitas.md) + [doc 08 §3.5](docs/08-interface-ui.md)
46 slots (4 armadura + 1 offhand + 27 principal + 9 hotbar + 4 craft + 1 resultado).
**Implemente TODAS as interações de slot** da tabela do doc 08 — clique esquerdo/direito, shift+clique,
arrastar-para-distribuir com os dois botões, duplo clique, teclas 1–9, Q/Ctrl+Q. Isso é o que separa
um inventário utilizável de um frustrante.
Crafting 2×2 e 3×3 com matcher **shaped** (bounding box mínimo + comparação + **retentativa
espelhada horizontalmente**) e **shapeless** (multiset). Tags (`#planks`, `#logs`) para evitar
receitas duplicadas por material. Livro de receitas com abas, busca e auto-preenchimento da grade.
Fornalha com combustível/progresso/saída que continua queimando com a tela fechada. Baú e baú duplo.

### 4.5 Mobs — [doc 07](docs/07-mobs-e-ia.md)
Passivos (vaca, porco, ovelha, galinha, lula), neutros (lobo, enderman, aranha) e hostis (zumbi,
esqueleto, creeper, aranha, slime), com HP, dano por dificuldade, drops e XP da tabela.
IA declarativa por **goals em ordem de prioridade**. Pathfinding A* **com orçamento duro**
(200 nós por requisição, 2 requisições por tick no mundo todo, round-robin) e **fallback de
steering** quando estoura — na prática o steering resolve 80% dos casos praticamente de graça.
Modelos de caixas definidos como dados, com **animação procedural** (senoides sobre a distância
percorrida), renderizados **instanced**, uma draw call por tipo de mob.
Regras de spawn/despawn com caps por tier (T0: 20 hostis).

### 4.6 Interface — [doc 08](docs/08-interface-ui.md) + [wireframes](docs/mockups/)
Telas: título (com panorama girando, estático em T0), seleção de mundos, criar mundo, HUD,
inventário, inventário criativo com abas e busca, bancada, fornalha, baú, pausa, opções completas
(vídeo/controles/som/idioma/acessibilidade), morte, debug F3.
Escala por `--gui-scale` (1–4, auto por resolução, mínimo 3 no celular), `image-rendering: pixelated`,
tudo em múltiplos de `--px`. Cada wireframe em `docs/mockups/` mostra posição e cotas.
`Esc` fecha uma camada por vez. Navegação por teclado e gamepad em todas as telas.

### 4.7 Controles — [doc 09](docs/09-controles-mobile.md)
**Projete o toque primeiro, o teclado depois.**
Joystick virtual flutuante à esquerda (empurrar até o limite por 300 ms = correr), câmera por
arraste à direita. Dois modos de interação, **Modo A como padrão**: toque curto coloca, toque longo
quebra, e o **raycast parte da posição do dedo**, não do centro da tela. Modo B com botões dedicados
para quem prefere mira fixa. Alvos ≥ 44×44 px CSS reais. **Pointer Events** com `pointerId` e
multitoque real (andar + olhar + pular simultâneos). Fullscreen e lock de orientação landscape.
Editor de layout de botões arrastáveis, salvo em `localStorage`. Gamepad como bônus.

### 4.8 Persistência — [doc 11](docs/11-persistencia-e-saves.md)
IndexedDB. **Só chunks modificados são salvos** — o resto é regenerado da seed, e é isso que mantém
o save pequeno. Formato com paleta + RLE + `CompressionStream('deflate-raw')` quando disponível
(~1–4 KB por chunk modificado). Autosave a cada 60 s fora do frame, com rede de segurança em
`localStorage` para posição/inventário (IndexedDB é assíncrono e `beforeunload` não espera).
Múltiplos mundos com miniatura. Export/import `.clw`. PWA com service worker, jogável offline.

### 4.9 Áudio — [doc 10](docs/10-audio.md)
Todos os sons sintetizados no boot com as receitas do doc (ruído filtrado + envelopes + osciladores)
e renderizados para `AudioBuffer`. Pool de 16 vozes, `PannerNode` equalpower, pitch aleatório ±10%
em cada disparo (sem isso a repetição fica insuportável). Música ambiente procedural por caminhada
aleatória em escala pentatônica. `AudioContext` só após o primeiro gesto do usuário.

### 4.10 Arte — [doc 13](docs/13-assets-e-arte.md)
Motor de textura procedural com operadores compostáveis (`valueNoise`, `speckle`, `stripes`,
`bricks`, `blobs`, `dither`, `emboss`, `alphaMask`) e uma receita declarativa por bloco.
Sprites de item por mini-DSL de formas; itens-bloco renderizados em isométrica no boot (resolve
~60 sprites de graça). Fonte bitmap original 5×7 com acentos do português, como máscaras de bits
(~700 bytes). Ícones de HUD desenhados em canvas 2D.

---

## 5. Fora de escopo (declarado)

The End e chefe final, comércio com aldeões, mapas/cartografia, shaders, bloco de comandos, mods,
multiplayer com servidor dedicado. O Nether, redstone e multiplayer P2P ficam para depois do MVP —
mas a arquitetura já deve respeitar os ganchos de [doc 12 §1](docs/12-multiplayer.md).

---

## 6. Regras de código

1. **Zero alocação por frame no caminho quente.** Nada de `new Vec3()` no loop. Use pools e
   escreva em objetos pré-alocados. Um GC major de 100 ms em celular fraco custa 3 frames.
2. **`TypedArray` em tudo que é grande.** Evite `map/filter/forEach` no caminho quente.
3. **Toda mutação do mundo passa por `world.setBlock(x,y,z,state,source)`.** Nunca escreva no array
   de voxels a partir da UI ou da física — é isso que permite plugar rede depois.
4. **Tudo determinístico a partir da seed**, via `rngAt(seed, x, z, salt)`. Chunks são gerados fora
   de ordem, em número variável de workers; a mesma seed tem que dar o mesmo mundo sempre.
5. **Nunca leia de volta da GPU** (`readPixels`, `getError`) dentro do loop — causa stall completo.
6. **Simule a 20 Hz** com timestep fixo e interpole no render. Não converta constantes para segundos.
7. **Nomes e comentários em português**; identificadores de código em inglês (`chunk`, `blockId`).
8. Um módulo, uma responsabilidade. Se um arquivo passa de ~400 linhas, provavelmente são dois.

---

## 7. Instrumentação obrigatória

Tela de debug (**F3** / gesto de 3 dedos) desde o marco M0, mostrando FPS e frame time, posição e
chunk, bioma, luz, contagem de chunks por estado, vértices e draw calls, e o tempo de cada fase
(tick / upload de mesh / render), mais um gráfico dos últimos 120 frames. Formato exato em
[doc 02 §6](docs/02-orcamento-performance.md).

Sem isso você vai otimizar no escuro.

---

## 8. Testes

| Tipo | Cobrir |
|---|---|
| Unit (vitest) | matcher de receitas (com espelhamento e deslocamento), paleta de chunk em todos os `bitsPerBlock`, serialização round-trip, flood fill de luz, fórmula de tempo de quebra, greedy meshing em casos conhecidos |
| Determinismo | mesma seed → mesmo chunk, em qualquer ordem e com qualquer número de workers |
| Performance em CI | benchmark de meshing e geração que **falha o build** se regredir > 20% |
| Smoke (Playwright) | criar mundo → andar → quebrar bloco → salvar → recarregar → bloco continua quebrado |
| Memória | 10 min com render distance 8 sem crescimento monotônico do heap |
| Manual, a cada marco | **celular T0 real**, Chrome e Firefox, desktop, tela de 320 px |

---

## 9. Acessibilidade

Alto contraste, modo daltônico (remapeia a paleta do HUD), tamanho de texto, opacidade de fundo,
legendas de som com direção, desligar balanço de câmera e efeitos de distorção,
`prefers-reduced-motion`, toque-para-alternar em vez de segurar, tempo de toque longo ajustável,
`aria-label` em todo botão, focus trap nos modais, navegação completa por teclado.

---

## 10. Licenciamento e originalidade

**Nenhum asset de terceiros entra no repositório** — nem texturas, sons, fontes, modelos, logos,
paletas extraídas ou textos de outro jogo. Nome, logo, fonte, paleta e frases de splash são
originais. O projeto se identifica como independente e sem afiliação com nenhuma empresa de jogos.
Código sob MIT; assets gerados sob a mesma licença, já que são gerados por ele.
Suporte opcional a resource pack do próprio jogador (`loadOverrides(map)`) para quem quiser arte
customizada — sem que o projeto distribua nada.

---

## 11. Definição de pronto

1. Abre em < 5 s em 3G, com < 350 KB.
2. **30 FPS em celular de 2016 com render distance 4.**
3. Um jogador joga 2 horas sem crash, sem perda de progresso e sem travas.
4. Nenhum asset de terceiros no repositório.
5. Todos os controles funcionam por toque, teclado e gamepad.
6. Dá para começar do zero, cortar madeira, craftar picareta de pedra, minerar ferro, fazer
   fornalha, cozinhar comida, sobreviver à noite e dormir — sem bug bloqueante.

---

## 12. Plano de execução

Um marco por sessão. **Ao fim de cada um, teste em um celular real de baixo desempenho antes de
seguir.** Se o marco não bate a meta de FPS, otimize antes de adicionar conteúdo — o risco técnico
do projeto é performance, e ele tem que ser atacado cedo, não no fim.

| Marco | Entrega | Critério de aceite |
|---|---|---|
| **M0** Esqueleto | Vite + TS, WebGL2 com fallback, detecção de tier, loop 20 Hz + rAF, gerador de texturas, debug overlay | cubo texturizado a 60 FPS; bundle < 60 KB |
| **M1** Mundo visível | chunks com paleta, ruído + splines, greedy meshing no worker, frustum culling, pipeline por prioridade, céu e fog, câmera livre | RD 8 @ 60 FPS desktop; **RD 4 @ 30 FPS em T0**; sem hitch voando 2 min |
| **M2** Interação | física do jogador, raycast, quebrar/colocar, hotbar, iluminação flood fill + AO, dia/noite | tocha atualiza luz em < 16 ms; pulo e caminhada "sentem certo" |
| **M3** Mobile (crítico) | controles de toque completos, HUD responsivo com safe areas, presets por tier, escala dinâmica de resolução, PWA offline | **30 FPS por 10 min em aparelho de 2016, sem crash nem crescimento de heap** |
| **M4** Sobrevivência | inventário completo, crafting 2×2/3×3, fornalha, baú, ferramentas, vida/fome/morte, item entities, fluidos, IndexedDB, telas de mundo | dá para jogar do zero até fornalha e comida cozida |
| **M5** Vida no mundo | mobs com IA/animação/spawn, combate, cama, armadura, sons, 10 biomas, cavernas e minérios balanceados | primeira noite assustadora e justa; 20 mobs sem cair de 28 FPS em T0 |
| **M6** Profundidade | agricultura, reprodução, XP e encantamento, estruturas, clima, arco, barco, blocos decorativos, conquistas | — |
| **M7** Extras | redstone, Nether, trilhos, multiplayer P2P, import/export, resource packs | — |

Detalhamento de cada marco com checklist: [docs/14-roadmap.md](docs/14-roadmap.md).

---

## 13. Índice dos documentos normativos

| Doc | Conteúdo |
|---|---|
| [00-visao-geral.md](docs/00-visao-geral.md) | Escopo, tiers de hardware, princípios |
| [01-arquitetura-tecnica.md](docs/01-arquitetura-tecnica.md) | Stack, pastas, threads, formato de vértice, renderer |
| [02-orcamento-performance.md](docs/02-orcamento-performance.md) | Budgets, greedy meshing, AO, anti-GC, debug |
| [03-mundo-e-geracao.md](docs/03-mundo-e-geracao.md) | Ruído, splines, biomas, cavernas, minérios, fluidos |
| [04-blocos.md](docs/04-blocos.md) | Tabela de 68 blocos com todas as propriedades |
| [05-itens-e-receitas.md](docs/05-itens-e-receitas.md) | Itens, tiers, comida, receitas, fundição, drops |
| [06-jogador-e-fisica.md](docs/06-jogador-e-fisica.md) | Constantes de movimento, colisão, quebra, vida, fome |
| [07-mobs-e-ia.md](docs/07-mobs-e-ia.md) | Mobs, goals, pathfinding, spawn, modelos, animação |
| [08-interface-ui.md](docs/08-interface-ui.md) | Todas as telas, paleta, interações de slot |
| [09-controles-mobile.md](docs/09-controles-mobile.md) | Toque, gestos, teclado, gamepad, acessibilidade |
| [10-audio.md](docs/10-audio.md) | Receitas de síntese, música procedural |
| [11-persistencia-e-saves.md](docs/11-persistencia-e-saves.md) | IndexedDB, formato de save, PWA |
| [12-multiplayer.md](docs/12-multiplayer.md) | Ganchos de arquitetura, protocolo P2P |
| [13-assets-e-arte.md](docs/13-assets-e-arte.md) | Texturas procedurais, sprites, fonte, licença |
| [14-roadmap.md](docs/14-roadmap.md) | Marcos com checklist e critérios de aceite |
| [15-status.md](docs/15-status.md) | **Estado real do código**: status por marco, pendências, dependências, próximo passo |
| [16-auditoria.md](docs/16-auditoria.md) | Histórico por sessão, com grid de arquivos alterados |
| [mockups/](docs/mockups/) | 14 wireframes SVG originais |

> Os documentos 00–14 são **normativos** (o que o jogo deve ser) e não mudam conforme a
> implementação anda. Os documentos 15 e 16 são **descritivos** (o que o código é hoje) e são
> atualizados ao fim de cada entrega — a rotina está em [CLAUDE.md](CLAUDE.md).

---

## 14. Comece por aqui

```
Leia docs/00, docs/01 e docs/02. Implemente o marco M0 completo:
projeto Vite + TypeScript strict, canvas em tela cheia com contexto WebGL2
(fallback WebGL1), detecção de tier de hardware, loop de jogo com timestep fixo
de 20 Hz e render por rAF com interpolação, o gerador procedural de texturas
alimentando um TEXTURE_2D_ARRAY, e o overlay de debug com FPS e gráfico de
frame time. Entregue um cubo texturizado girando a 60 FPS com bundle < 60 KB
gzip, e me diga o tamanho real do bundle.
```
