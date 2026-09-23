# 15 — Status do projeto

> **Este é o documento de entrada de qualquer sessão de desenvolvimento.**
> Quem chega sem contexto lê este arquivo primeiro: ele diz o que está pronto, o que ficou
> pendente, o que depende de quê e qual é o próximo passo. O histórico de quem mexeu em qual
> arquivo está em [16-auditoria.md](16-auditoria.md).
>
> Os outros documentos (00 a 14) são **normativos**: descrevem o que o jogo deve ser e não mudam
> conforme a implementação anda. Este aqui é **descritivo**: reflete o estado real do código e é
> atualizado ao fim de cada entrega.

**Última atualização:** 2026-09-23 14:08 — **Aldeia vazia de novo no campo, agora por outro motivo:
o pool de mobs estava cheio** (*"E: 140 mobs"* em T2, que é o pool inteiro). Os grupos de bichos de
chunk novo não tinham teto e, desde o M9, mob de coluna descarregada ficava no pool para sempre.
Corrigido (§4). Antes, 13:55: a aldeia nascia pela metade na divisa de bioma e o aldeão parava na
porta.

---

## 1. Panorama

| Marco | Entrega | Status | Pendências |
|---|---|---|---|
| **M0** Esqueleto | Vite + TS, WebGL2/1, tier, loop 20 Hz, texturas procedurais, debug | ✅ concluído | — |
| **M1** Mundo visível | chunks paletizados, ruído + splines, 10 biomas, cavernas, minérios, greedy meshing, frustum culling, céu e fog | ✅ concluído | — |
| **M2** Interação | física do jogador, raycast, quebrar/colocar, hotbar, luz por flood fill, dia/noite | ✅ concluído | — |
| **M3** Mobile | toque completo, HUD responsivo, presets por tier, escala dinâmica, PWA offline | ✅ **validado em T0 real (J7 Metal): 60 FPS, RD 4, escala 1,00, heap estável** | — |
| **M4** Sobrevivência | inventário 46 slots, crafting, fornalha, baú duplo, ferramentas, vida/fome, itens no chão, fluidos, save ligado, telas de mundo e opções, sprites de item, livro de receitas, inventário criativo | ✅ concluído | — |
| **M5** Vida no mundo | 12 mobs com IA/animação/spawn, combate, armadura, cama, som procedural, árvores e plantas | ✅ concluído | — |
| **M6** Profundidade | agricultura, reprodução, XP, encantamento, estruturas, clima, arco, conquistas | ✅ concluído | — |
| **M7** Extras | redstone, Nether, trilhos, import/export, resource pack | ✅ concluído | multijogador P2P fora de escopo (ver abaixo) |
| **Acabamento** pós-M7 | tabela de Vídeo e Acessibilidade completas, teclas remapeáveis, 9 sliders de som, fogo que se espalha, morcego, boneco do jogador, miniatura e tamanho do mundo, canto de escada, som no resource pack | ✅ concluído | **nada disso foi visto em aparelho ainda** |
| **Controle** pós-M7 | perfis por família (DualSense, DualShock 4, Xbox, Switch Pro), mapeamento completo do doc 09 §3, navegação de interface por gamepad, opções de analógico | ✅ concluído | — |
| **Controle, 2ª passada** | `□` abre a mochila, botão e intenção viraram tabelas separadas, navegação espacial nos menus, cursor no analógico direito, clique direito no gatilho esquerdo | ✅ validado com DualSense por Bluetooth | — |
| **Controle, 3ª passada** | direcional ←/→ troca o item da mão; painel de teste de controle em Opções | ✅ concluído | causa achada e fora do jogo — ver §3 |
| **Controle, 4ª passada** | navegação quieta até o controle ser empurrado, anel de foco próprio, só o que está desenhado entra na travessia | ✅ concluído | — |
| **Modo de jogo** | trocar entre Criativo e Sobrevivência no mesmo mundo, pela pausa, com o modo guardado no save | ✅ concluído | — |
| **HUD** | coxa de frango desenhada no lugar do retângulo da fome; vida, ar, fome e armadura somem no Criativo | ✅ concluído | — |
| **Câmera** | rotação lida por quadro desenhado, não no tick de 20 Hz | ✅ concluído | — |
| **Toque, Modo A** | dedo que girou a câmera deixa de ser candidato a quebrar | ✅ concluído | — |
| **M8** Presença dos objetos | vértice em 1/16 de bloco, tocha de verdade, porta e cama de duas células, item na mão com volume, contorno do tamanho da forma, vidro visível, escada que escala, baú e fornalha acesa, placa com texto, quadro com arte, oito cores de lã e cama, tampa de baú que abre | ✅ **validado em campo em 2026-09-17** | — |
| **Terreno** pós-M8 | blend 5×5 do `heightOffset` de bioma e teto macio: a parede de 29 blocos entre montanha e planície virou encosta, e o platô chapado em Y=124 virou cordilheira | ✅ **validado em campo** | muda o terreno gerado: **mundo antigo ganha costura** (ver §4) |
| **Placa, 2ª passada** | tábua lisa e clara no lugar da tábua de carvalho com rabisco, e um campo de texto só com quebra de linha interpretada | ✅ concluído | — |
| **M9** Gente no mundo | aldeão com rotina e troca, aldeia de verdade, golem, reputação | ✅ concluído em 2026-09-23 | **não visto em aparelho** (§6) |
| **M10** Saber onde se está | bússola, relógio, mapa, marcador, estatísticas, espectador | ⬜ proposto (2026-09-16) | — |
| **M11** O que os documentos já pediam | areia que cai, pedregulho de lava, balde, tesoura, ovelha colorida, planta que cresce, efeitos de status, comidas e estruturas que faltavam, nascimento em terra firme, smoke test | ✅ **validado em campo em 2026-09-23** | — |
| **M12** O mundo chega antes do jogador | culling por conectividade e por direção de face, cópia de vizinhança fora da thread principal, luz na borda do chunk | ✅ **validado em campo em 2026-09-23** | preset do T0 não revisto (sem T0 na mão) — §3 |
| **M13** Casa em ordem | uso de item como dado, `session.ts` e `main.ts` abaixo de 700 linhas, lã e cama em 16 cores por tint | ✅ **validado em campo em 2026-09-23** | — |
| **M14** Água e paisagem | visão submersa, rios, pesca, afogado, lua com fases, biomas por tint, selva | ⬜ proposto (2026-09-22) | — |
| **M15** Oficina | bigorna, reparo na grade, funil, dispensador, comparador, observador | ⬜ proposto (2026-09-22) | — |
| **M16** Um fim para a jornada | fortaleza do Nether, blaze, poções, olho do ender, End, dragão, créditos | ⬜ proposto (2026-09-22) | depende de M11 (efeitos) e M13 (atlas) |
| **M17** Alcance | menu Idioma (doc 08 §3.11) com `en`, primeira hora guiada, seed compartilhável | ⬜ proposto (2026-09-22) | — |

**O multijogador P2P saiu do escopo do M7** por decisão do usuário em 2026-09-13: *"acredito que
ele irá pesar muito o jogo e trazer muita complexidade por enquanto desnecessária"*. O
[doc 12](12-multiplayer.md) continua normativo e o `world.setBlock(..., source)` continua
preparado para ele (`source: 'network'`); o que não existe é implementação nem prazo.

Legenda: ✅ pronto · ⚠️ pronto com débito · 🚧 em andamento · ⬜ não iniciado

---

## 2. Métricas atuais

Medidas em 2026-09-23 11:03, ao fechar o M9, com `npm test`, `npm run build`,
`SIZE_BUDGET_KB=350 npm run size` e `npm run smoke`.

| | Valor | Orçamento | Fonte |
|---|---|---|---|
| Bundle (gzip, tudo) | **239,6 KB** (239,4 no M9; 229,0 no M12; 226,3 antes dele) | < 350 KB | `npm run size` |
| Testes | **2027**, 101 arquivos (2023 no M9; 2003 no M12) | manter verde | `npm test` |
| Smoke test de navegador | **7 passos verdes**: carregar, criar, andar 10 s, quebrar, salvar, recarregar, conferir | verde | `npm run smoke` |
| Camadas de atlas | **194** com 16 cores de lã e cama (222 no M11 com 8 cores; lã e cama viraram tint no M13) | ≤ 256 (doc 02 §3) | `buildLayerIndex()` |
| Memória de áudio | **3,33 MB** (era 3,26; +3 sons curtos de balde e arremesso) | < 3,5 MB | `tests/audio.test.ts` |
| Geração de chunk | **6,2 ms** (mediana; os cogumelos não mexeram no número) | < 25 ms | `tests/perf.test.ts` |
| Geração de chunk do Nether | 5,1 ms (mediana; 3,8 antes de a luz entrar) | < 25 ms | `tests/perf.test.ts` |
| Meshing de section | 0,64 ms (mediana) | < 8 ms | `tests/perf.test.ts` |
| Meshing de um piso de 256 tochas | **1,10 ms** (o pior caso construível da forma nova) | < 2 ms | `tests/perf.test.ts` |
| Tick de 20 mobs | 0,20 ms | << 50 ms | `tests/mobs.test.ts` |
| Tick de 20 aldeões com rotina (indo para casa) | **0,08 ms** | < 1 ms (aceite do M9) | `tests/village.test.ts` |
| Aldeões que entram em casa ao entardecer | **47 de 47**, em 11 aldeias de seeds diferentes, 2 min de jogo | ≥ 80% no teste | `tests/village.test.ts` (1 aldeia) e medido à mão (11) |
| Tick de circuito (fio de 64) | 0,83 ms | < 5 ms | `tests/perf.test.ts` |
| Tick de fogo (256 chamas, o teto) | **0,03 ms** | < 2 ms | `tests/perf.test.ts` |
| Acabamento do estilo Nítido (atlas inteiro) | **3,0 ms**, uma vez no boot (eram 2,1 com 31 texturas a menos) | < 60 ms | `tests/perf.test.ts` |
| Folha de sprites em volume (32 px) | **36,6 ms**, uma vez no boot (eram 33,9 antes dos corantes e das camas coloridas) | < 200 ms | `tests/perf.test.ts` |
| Maior degrau entre colunas vizinhas | **6 blocos** (eram 37: a parede de bioma) | sem parede vertical | `tests/heightfield.test.ts` |
| Colunas chapadas no teto do mundo | **0%** (eram 10,3% da região, 54,3% das de montanha) | zero | `tests/heightfield.test.ts` |
| Mundo de RD 16 pronto, sem relógio | **51 pumps** (165 antes do M12; eram 1315) | — | `tests/dimensionrace.test.ts` |
| Mundo de RD 16 pronto, orçamento de despacho real (60 FPS) | **183–196 pumps** (415–437 antes do M12) | — | medido à mão, depende do relógio |
| Colunas em 40 ciclos com 4 vagas (RD 8) | **101** (86 antes do M12; eram 44) | — | `tests/dimensionrace.test.ts` |
| Pedido de malha na thread principal | **0,32 ms por coluna** (eram 8 × 0,26 ms de vizinhança em JS) | < 2 ms | `tests/perf.test.ts` |
| Culling por conectividade (RD 8) | busca **0,98 ms** (ao trocar de section), quadro **0,10 ms** | < 8 ms / < 1 ms | `tests/perf.test.ts` |
| Sections desenhadas numa caverna (Y≈21, RD 8) | **29%** das que têm malha no frustum | ≤ 50% (aceite do M12) | `tests/sectioncull.test.ts` |
| Costura de luz de uma coluna nova | **0,55 ms** | < 4 ms | `tests/perf.test.ts` |
| FPS em T0 real (2017) | **60**, RD 4, escala 1,00 (Galaxy J7 Metal) | 30 estáveis | teste manual |
| Render em T0 | **2,7 ms** de 33,3 ms de orçamento | ≤ 8 ms (soma do doc 02 §2) | overlay F3 no aparelho |
| Heap em T0 | **20 MB**, estável na sessão | sem crescimento | overlay F3 no aparelho |
| FPS em celular atual | **75, T2, RD 16, escala 1,00, render 2,6 ms** (S24 Ultra) | — | teste manual |
| Abertura em 3G rápido | **4,48 s** até a tela de título | < 5 s (PROMPT.md §11) | `npm run slow-network` |
| Sessão longa (voo contínuo) | **92,5 min, 0 erros, 0 travamentos** | 2 h sem crash (PROMPT.md §11) | `npm run soak` |
| Heap na sessão longa | **37,8 MB no início, 44,2 no fim**; média por faixa de 15 min entre 42,8 e 47,2 | sem crescimento | `npm run soak` |
| FPS na sessão longa | mediana **60**, mínimo 50, nenhuma amostra abaixo de 30 | 30 estáveis | `npm run soak` |
| Mundo gerado na sessão longa | **67 621 blocos** percorridos, anel estável em 489 colunas | — | `npm run soak` |
| Abertura em 3G lento | 9,66 s | — | `npm run slow-network` |
| Abertura sem limite de rede | 2,89 s | — | `npm run slow-network` |
| Bytes na rede até o título | **178,7 KB** estimados (174,8 KB do bundle, servido em gzip; a medida de campo é de 2026-09-14, com 169,1) | < 350 KB | `npm run slow-network` |

---

## 3. Detalhe por marco

### M0 — Esqueleto ✅
Contexto WebGL2 com fallback WebGL1, detecção de tier com presets, loop de timestep fixo 20 Hz
com interpolação, atlas procedural em `TEXTURE_2D_ARRAY`, overlay de debug (F3 / 3 dedos).
**Sem pendências.**

### M1 — Mundo visível ✅
Chunks com paleta e sections, ruído com splines de continentalidade/erosão, 10 biomas com blend e
tint, cavernas (cheese + spaghetti), 8 minérios com curva triangular por Y, greedy meshing binário
com AO em Web Workers, pipeline por prioridade, frustum culling, céu com gradiente e fog.
Decoração (árvores e plantas) **faltava** e foi entregue no M5 — ver §4.
**Sem pendências.**

### M2 — Interação ✅
Física com as constantes do doc 06, raycast DDA com contorno, quebrar com estágios e partículas,
colocar com rotação, hotbar, iluminação por flood fill incremental, ciclo dia/noite.
**Sem pendências.**

### M3 — Mobile ⚠️
Joystick flutuante, câmera por arraste, modos A/B, multitoque por `pointerId`, safe areas, tela
cheia e trava de orientação, gamepad, PWA instalável e offline, escala dinâmica de resolução.

**Primeiro teste em celular real (2026-09-10, S24 Ultra).** Jogado de verdade num aparelho de
toque pela primeira vez. Achou o bug mais grave do projeto até agora — colocar um bloco no Modo A
matava o controle de toque inteiro (§4) — mais a rachadura invisível, o inventário criativo sem
armadura, o teclado virtual subindo sozinho e a escala dinâmica piscando. Tudo corrigido.

**2026-09-12 — o T0 finalmente foi medido.** Galaxy J7 Metal (Android 7, 2 GB, Mali-T830), que o
`detectTier` classificou como T0 sozinho. Overlay no aparelho:

```
tier T0 (Baixo) · WebGL2 · RD 4 · atlas 127 camadas em 321.1ms
fps 60 (16.8ms) | display ~60Hz | escala 1.00 | mem 20MB
V: 50k vértices, 64 draw calls
T: tick 0.0ms  mesh-upload 0.0ms  render 2.7ms
```

**60 FPS com o dobro do alvo e a escala dinâmica em 1,00** — ela nem precisou baixar. Render em
2,7 ms de 33,3 ms de orçamento, heap em 20 MB e estável na sessão. O risco técnico declarado no
PROMPT.md §2 não se confirmou.

**Segunda sessão no mesmo aparelho, no mesmo dia — o critério de aceite fechou.** Relato do
jogador, ponto a ponto:

| Caso | Critério | Resultado |
|---|---|---|
| Voo em linha reta, 2 min | M1: sem hitch | **sem travar**; o mundo é que não acompanha a geração |
| 15–20 mobs | M5: não cair de 28 FPS | **60 FPS**, sem engasgo |
| Chuva, campo aberto, vários biomas | risco do doc 02 | **sem problema** |
| 10 min de jogo | M3: heap estável | **estável** |

O M3 está fechado. O que sobrou não é orçamento de frame, é **taxa de geração**: com 1 worker, o
jogador anda mais rápido do que o mundo nasce. Ver §5.

### M4 — Sobrevivência ✅
Inventário de 46 slots com todas as interações de slot, crafting 2×2/3×3 com matcher
shaped/shapeless e espelhamento, fornalha com queima em segundo plano, baú, ferramentas com tier e
durabilidade, vida/fome/saturação/exaustão/morte, itens no chão com merge e coleta, água e lava com
nível 0–7.

As sete pendências abertas em 2026-09-09 (P1–P7) foram fechadas em 2026-09-10:

| # | Era | Ficou |
|---|---|---|
| P1 | `SaveManager` existia mas não era instanciado | `game/savegame.ts` liga tudo: observa mudança de bloco, responde ao pipeline com o chunk do disco, autosave de 60 s, `beforeunload` com rede em `localStorage`, jogador e tile entities. Ciclo quebrar → salvar → recarregar coberto por teste |
| P2 | Sem telas de mundo | Título, seleção e criação (nome, seed em texto, modo, dificuldade), com apagar confirmado — `ui/screens/title.ts`, `worlds.ts`, `menuflow.ts` |
| P3 | Sem tela de opções | `ui/screens/options.ts` com vídeo, som, controles e jogo; campos declarativos ligados ao `SettingsStore` |
| P4 | Item sem sprite (tudo caía em `block/missing`) | `data/itemart.ts` (26 silhuetas em máscara de texto) + `render/itemsprites.ts` (folha única; item-bloco em isométrica 2:1). Vale para inventário, hotbar, livro de receitas e **itens no chão** |
| P5 | Sem livro de receitas | `ui/containers/recipebook.ts` com busca, filtro "só o que dá" e auto-preenchimento da grade (`Session.autoFillRecipe`) |
| P6 | Baú duplo era código morto | `DoubleChestView` encaminha 54 slots para dois baús de 27; o armazenamento continua por bloco |
| P7 | Sem inventário criativo | `ui/containers/creative.ts` com 5 abas derivadas dos campos do item, busca e hotbar editável |

**Pendência:** a sessão em T0 de 2026-09-12 achou três bugs graves nesta tela, todos no toque e
todos corrigidos (§4): duplo clique no slot de resultado varrendo o inventário para o cursor,
auto-preenchimento que enchia a grade sem redesenhar a tela, e nome de receita preso no atributo
`title` do HTML, invisível no dedo. O resto do inventário no toque — arrastar entre slots, mandar
para a grade — ainda não tem cobertura de teste e o jogador descreveu como "travado"; ver §6.

### M5 — Vida no mundo ✅
- **Mobs:** 12 tipos em tabela declarativa, modelos de caixas com "box mapping", skins geradas por
  código, animação procedural por senoides, renderização em **uma draw call** para toda a cena
  (desvio consciente do doc — ver `render/mobrender.ts`), sombra opcional.
- **IA:** goals em ordem de prioridade, A* com orçamento duro (200 nós, 2 buscas por tick) e
  fallback de steering, aquisição de alvo com linha de visão.
- **Spawn:** caps por categoria proporcionais aos chunks carregados, presets por tier, população
  inicial de chunk, regras de despawn do doc 07 §4.
- **Combate:** dano por material da ferramenta, cooldown por arma, empurrão, invulnerabilidade,
  armadura nos 4 slots com a fórmula de toughness e durabilidade que gasta ao apanhar.
- **Comportamentos:** creeper explode, esqueleto atira flecha, aranha escala e é neutra na luz,
  slime se divide, enderman teleporta, lobo chama o bando e se doma com osso, zumbi/esqueleto
  queimam ao sol.
- **Cama:** define renascimento e pula a noite, com a regra "não dá para dormir com monstro perto".
- **Áudio:** ~60 sons sintetizados no boot por 5 famílias de receita, pool de vozes com panner,
  música procedural em pentatônica, legendas de som.
- **Mundo:** árvores e plantas por bioma (`world/gen/decorate.ts`).

**O critério *"20 mobs sem cair de 28 FPS em T0"* foi verificado em campo (2026-09-12): 15–20 mobs
no J7 Metal, 60 FPS, sem engasgo.** O que ficou de pé é o inverso — **é difícil encontrar hostil**.
Eram **duas causas somadas**, as duas corrigidas em 2026-09-12 (§4):

| | Antes | Depois |
|---|---|---|
| Y do spawn | ignorava o jogador: sorteio uniforme da coluna, quase tudo caindo em pedra e o resto na superfície | faixa de ±16 em volta do jogador |
| Teto de hostis em T0 | **8** (o cap era aplicado duas vezes, e T2 chegava a 148) | **20**, a linha "Máx. mobs vivos" do doc 02 §1 |

Oito hostis espalhados por 113 colunas, nascendo 40 blocos acima do jogador, explicam por completo
"andei um bom tempo e não achei nada". **Falta confirmar no aparelho.**

### Fora de marco — item na mão (2026-09-10) ✅
`render/hand.ts`, o módulo que o doc 01 §1 lista na árvore e o §191 descreve, e que nunca tinha
sido escrito: o passe ficava como o comentário `// 6. item na mão — M4.` no `renderer.ts`. É uma
draw call, desenhada por último com **a profundidade limpa** (senão encostar na parede enfia a mão
dentro dela) e numa **projeção de FOV próprio**, 55° (senão a mão estica junto com o FOV do mundo).

Três formas num programa só, escolhidas por `uMode`: **cubo** do atlas de blocos com uma camada por
face, **quad** da folha de sprites para o que não é bloco (o mesmo desenho do inventário), e uma
**caixa em tom de pele** para a mão vazia — não há skin de jogador no projeto e inventar uma
custaria camada de atlas por nada. A geometria só é reconstruída quando o item muda; no caminho de
render é uma comparação de inteiros.

A pose é **ancorada nas bordas do frustum**, não em coordenadas fixas: `tan(fov/2)·|z|` dá a
meia-altura visível, e o aspecto dá a largura. A primeira versão usava números fixos e desenhava a
mão **fora da tela** em telas largas — sem erro, sem log, só invisível. `handPose` é pura e
`tests/hand.test.ts` confere que o centro cai dentro do frustum de 0,46 a 3,2 de aspecto, em todo
ponto do golpe. Desligável em Opções → Vídeo ("Item na mão").

### M6 — Profundidade ✅
Quatro fatias, na ordem recomendada pelo doc 14. **Todo o checklist do marco
está entregue.**

#### Primeira fatia — agricultura e reprodução (2026-09-10)

- **Blocos complexos (pré-requisito).** `world/mesh/complex.ts`: o buffer que estava só como
  comentário no `greedy.ts` desde o M1. Cruz de dois planos, visível dos dois lados, para planta,
  muda, flor, plantação e tocha; caixa de meio bloco para laje e camada de neve. Sai no **mesmo
  passe recortado** — nenhuma draw call nova por section. Ver §4: até agora esses blocos existiam
  no mundo e **não eram desenhados**.
- **Textura por estado.** `BlockDef.stages` + `stageTexOf` em `mesh/blockinfo.ts`: a idade da
  plantação escolhe a textura, então trigo/cenoura/batata gastam 1 id de bloco cada em vez de 8.
- **Agricultura.** `data/crops.ts` (tabela declarativa semente → bloco → colheita),
  `game/farming.ts` (arar com enxada, plantar), `world/growth.ts` (crescimento e umidade).
  Enxadas nos 5 materiais, cenoura, batata e batata assada; trigo/cenoura/batata com 8 idades;
  colheita madura entrega o produto, verde devolve só a semente; terra arada molha com água num
  raio de 4, seca sozinha e volta a ser terra se ninguém plantar; tirar a terra debaixo arranca a
  planta na hora.
- **Reprodução.** `MobStore` ganhou `loveTicks`/`growTicks`/`breedCooldown`; goal `breed` em
  `ai/goals.ts`; `Mobs.tryFeed` e `Mobs.breed`. Cada espécie tem o seu item (vaca e ovelha trigo,
  porco cenoura, galinha sementes), o filhote nasce com metade do tamanho, cresce em 5 min, não
  dropa nada e apressa com comida.

**Desvio consciente do doc 03/04, registrado aqui e no comentário do módulo:** o crescimento
**não** usa random tick por section. O mundo mantém um registro das posições que crescem,
alimentado pelo evento de mudança de bloco e por uma varredura de paleta quando o chunk entra, e
o tick percorre esse registro em rodízio com teto de 16 posições por tick. Sortear voxels custaria
caro em T0 para acertar plantação quase nunca. O preço é que uma roça gigante cresce mais devagar
por planta — e nunca derruba o frame.

#### Segunda fatia — XP e encantamento (2026-09-10)

- **Experiência.** `game/xp.ts` guarda **só o total acumulado** e deriva nível e barra dele: gastar
  na mesa é uma subtração, e não existe estado em que o nível e a barra discordem. Curva do
  doc 06 §8. `entity/xporb.ts` é o orbe — arrays paralelos e pool fixo como o item no chão, com
  atração a 8 blocos, fusão de orbes próximos e despawn em 5 min.
- **Fontes de XP.** Minério ao quebrar (coluna do doc 04 §2.2, agora na `LootEntry.xp`), mob ao
  morrer (o `onXp` que estava vazio desde o M5) e a fornalha, que acumula o XP da receita
  (`SMELTING.xp`) e entrega ao retirar a saída.
- **Encantamento.** `data/enchants.ts` traz os 8 do checklist — Eficiência, Inquebrável, Fortuna,
  Toque Suave, Afiação, Pilhagem, Proteção e Queda Suave — com alvo, teto, peso e conflito
  declarados. `game/enchanting.ts` tem o empacotamento, o sorteio da mesa e as oito fórmulas.
- **A mesa.** Bloco `enchanting_table` (id 74, receita de livro + 2 diamantes + obsidiana),
  `EnchantTable` com 2 slots, contagem de estantes no anel de 2 blocos com caminho livre, três
  ofertas com custo em níveis e lápis (1/2/3), e reembaralhamento após a compra.
- **Efeitos ligados:** Eficiência em `breakProgressPerTick`, Inquebrável em toda gasta de
  durabilidade, Fortuna e Toque Suave em `rollDrops`, Afiação em `attackDamageOf`, Pilhagem no
  drop de mob, Proteção e Queda Suave em `Survival`.
- **HUD:** barra verde de XP acima da hotbar com o nível no centro (doc 08 §3.4). Tudo que estava
  ali (vida, fome, armadura, avisos) subiu para abrir espaço.

**Decisão de armazenamento, registrada aqui e no comentário do módulo:** o encantamento de uma
pilha é **um inteiro**, `ItemStack.ench`, com 3 bits por encantamento indexados pelo id da tabela.
Oito encantamentos cabem em 24 bits, comparar duas pilhas continua sendo comparar números e o save
ganha um array paralelo de inteiros — `undefined` em save antigo vira 0, sem migração. Um objeto de
encantamentos por pilha custaria alocação em todo caminho que reconstrói pilha, que é justamente o
caminho quente de coletar item do chão.

**Consequência que exigiu mudança fora do M6:** `Inventory.give` e `Container.give` recebem os
campos da pilha, não a pilha. Sem passar `ench` junto, guardar uma picareta encantada vinda do chão
ou de um baú apagava o encantamento em silêncio. Os dois métodos ganharam o parâmetro.

**Orbe sem passe de render próprio:** o orbe é desenhado como um brilho no pool de partículas
(`Particles.emitGlow`), uma partícula por orbe por frame, com vida de 2 ticks. Reusa a draw call
instanciada que já existe e degrada sozinho quando o pool enche — em T0, um passe novo custaria mais
que o efeito vale.

#### Terceira fatia — blocos de construção e geometria de forma (2026-09-10)

O pré-requisito das estruturas: sem escada, cerca e porta desenhadas, uma casa de aldeia seria uma
caixa com buracos.

- **`world/mesh/shapes.ts`.** Toda forma fora do cubo e da cruz virou **lista de caixas** — seis
  números por caixa, escolhidas por `shape` + estado. Laje é uma, escada são duas, cerca é um poste
  mais um braço por vizinho conectado, alçapão muda de lugar ao abrir. Descrever forma como dado em
  vez de uma função de emissão por forma é o que deixa acrescentar forma nova sem tocar no mesher.
- **`world/mesh/complex.ts` reescrito** em torno disso: duas geometrias só (cruz e caixas), e a
  conexão de cerca e grade calculada **no meshing**, não guardada no estado (doc 04 §2.5).
- **A física passou a ler a mesma tabela.** `world/physics.ts` colide contra as caixas da forma:
  laje para em meia altura, escada tem dois degraus, alçapão aberto vira parede. Cerca e portão
  fechado são a exceção declarada do doc 04 §3 — colidem como bloco de 1,5 de altura, e por isso o
  sweep passou a varrer uma camada a mais para baixo.
- **Blocos novos.** Escada e laje em 7 materiais, cerca/portão/alçapão nas 3 madeiras — **gerados**
  a partir de uma tabela de materiais, não escritos um a um. Mais placa, quadro, escada de mão com
  forma de verdade, trilho, teia, pedregulho musgoso e gerador de monstros. Todos com receita.
- **Orientação ao colocar** derivada do `shape`: tronco pelo eixo da face, escada e portão pelo
  olhar, laje e alçapão pela metade clicada, escada de mão e quadro pela parede. E clique direito
  abre e fecha porta, portão e alçapão.

#### Quarta fatia — estruturas, clima, equipamento e conquistas (2026-09-10)

- **Estruturas** (`data/structures.ts` + `world/gen/structures.ts`): dungeon com spawner e dois
  baús, trecho de mina com trilho, teia e suporte de madeira, e aldeia com poço central, casas e
  aldeões. Atravessam a borda do chunk como as árvores do M5, pelo mesmo mecanismo. O baú de
  estrutura nasce cheio a partir da seed.
- **Ravina** em `world/gen/terrain.ts`, junto das cavernas: fenda de 3–12 de largura e 40–70 de
  comprimento, do Y=10 à superfície, afunilando nas pontas.
- **Aldeão** (mob 12): sem regra de spawn — ele nasce com a aldeia e só.
- **Clima e fases da lua** (`game/weather.ts`): chuva e tempestade, céu e fog acinzentados,
  partículas verticais no mesmo pool das outras, luz do céu limitada a 12 (o que faz hostil nascer
  de dia sob tempestade) e 8 fases de lua mexendo no spawn de slime.
- **Arco, escudo e barco.** Arco carrega segurando e dispara ao soltar, com velocidade e dano
  proporcionais à carga; escudo apara 75% do golpe que vem de frente; barco (`entity/boat.ts`)
  flutua na linha d'água, é pilotado pelo olhar e carrega o jogador.
- **Conquistas com toast** (`data/achievements.ts` + `game/achievements.ts`): 18 medalhas por
  gatilho declarado, estado numa máscara de bits que vai para o save, toast no canto superior
  direito por 5 s (doc 08 §3.4) e lista no menu de pausa.

**Decisão sobre o formato de estrutura, registrada aqui e no comentário do módulo:** o doc 03 §7
pede "template declarativo (array de `[dx,dy,dz,blockId]`)". Uma casa voxel a voxel são ~500
entradas, e sete templates viram 3.500 linhas de números que ninguém revisa. A forma adotada é uma
camada acima: cada estrutura é uma lista de **peças** (caixa cheia, casca, paredes, ponto), e um
expansor genérico as transforma em voxels. Continua sendo dado — acrescentar estrutura é uma
entrada na tabela, sem uma linha no gerador.

**Decisão sobre o clima, idem:** ele é **função pura da seed e do dia**, não estado sorteado no
tick. Um estado com timer teria que ir para o save, e dois jogadores no mesmo mundo (doc 12, M7)
veriam chuvas diferentes. `weatherOfDay(seed, dia)` responde sempre a mesma coisa, e o save não
ganhou um campo.

**Desvio consciente do doc 04 §3:** a escada não tem variante de canto (`inner`/`outer`). Dobrar a
geometria dela para arredondar quina custa mais, em T0, do que o olho ganha.

### M7 ✅
Checklist em [14-roadmap.md](14-roadmap.md), menos o multijogador P2P, que saiu de escopo (§1).

#### Redstone ✅ (2026-09-13)

Quinze blocos novos (`data/blocks.ts`, ids 102–116), um motor de circuito
(`world/redstone.ts`, ~640 linhas) e uma tabela de papéis (`data/redstone.ts`) que é o único lugar
onde se declara o que cada componente faz.

- **Pó** (`redstone_wire`): energia 0–15 nos bits de estado, perde 1 por bloco, sobe e desce
  degrau. É `itemless` — quem o coloca é o item `redstone`, via o campo `placesBlock` que existia
  na tabela de itens e **nunca tinha sido usado** por `game/interaction.ts`.
- **Emissores:** alavanca (liga e fica), botão de pedra e de madeira (1 s e 1,5 s), placa de
  pressão de pedra e de madeira, tocha de redstone (inverte o apoio, com 2 ticks de atraso) e
  bloco de redstone (15 constante).
- **Lógica:** repetidor com quatro atrasos (1–4 ticks) que só aceita entrada por trás e renova o
  sinal em 15.
- **Saídas:** lâmpada, porta/portão/alçapão, pistão e pistão pegajoso (empurra até 12 blocos,
  o pegajoso puxa de volta).
- **Instrumentação:** a linha `E:` do overlay F3 ganhou `N redstone` — posições reavaliadas no
  último tick —, que só aparece quando há circuito rodando.

**O modelo de energia, declarado no comentário do módulo:** existe a distinção forte/fraca, mas em
uma frase — *forte* é o que um emissor entrega ao bloco em que está encostado (e que realimenta pó
vizinho com 15); *fraca* é o que o pó entrega aos seis vizinhos (liga mecanismo, **não** realimenta
pó). É isso que impede o fio de atravessar parede e voltar a 15 do outro lado. Ficaram de fora, de
propósito: comparador, observador, tremonha, queima de tocha e energia quasi-conectada.

**Propagação:** fila incremental alimentada pelo evento de mudança de bloco, drenada **dentro do
mesmo tick** até esvaziar ou bater 1024 atualizações. Um fio de 60 blocos acende no tick em que a
alavanca é puxada; um oscilador patológico custa um frame ruim, nunca uma aba travada. O segundo
anel de vizinhos só é agendado quando o bloco que mudou é circuito ou conduz — sem isso, cada
célula de água em movimento custaria 43 consultas ao mundo em vez de 7.

**Dois bugs de integração achados e corrigidos antes de sair:**

1. **A porta não abria na mão.** Abrir uma porta dispara uma reavaliação da posição; o circuito
   via energia zero e a fechava no mesmo tick. O bit 4 do estado (`DOOR_POWERED_BIT`) passou a
   guardar "esta porta está aberta por energia", e a porta só se mexe quando a energia **muda**.
   Regressão coberta em `tests/redstone.test.ts`.
2. **A placa de pressão não afundava.** A colisão pousa o pé um décimo de milésimo **abaixo** do
   topo do bloco (`TOUCH_EPSILON` de `physics.ts`), e o `Math.floor` caía no bloco de baixo.

**Desvios conscientes, todos no comentário do módulo ou da forma:**

- O **pistão não anima**: move os blocos de uma vez. Animar exigiria entidade de bloco em
  movimento, com colisão própria e re-meshing por quadro.
- A **textura do pistão é a mesma nas seis faces** — o formato de vértice não guarda rotação de
  textura (doc 01 §5.1). Quem diz para onde ele aponta é a geometria: a placa da frente é mais
  estreita que o corpo, e o degrau se vê de qualquer ângulo.
- O **pó não muda de desenho com a conexão**: é sempre um ladrilho deitado com uma cruz vazada,
  como no visual do gênero. Custa 6 quads por bloco em vez de 30.
- **Pistão não move** baú, fornalha, mesa de encantamento, gerador, obsidiana nem rocha-mãe.

**Mudança de orçamento aprovada junto:** o teto de camadas de atlas do doc 02 §3 subiu de 128 para
256. A linha antiga era arbitrária e travava em 127 de 128; o GLES 3.0 garante 256 em qualquer
aparelho, e 256 × 16×16 RGBA com mips custa 0,34 MB. Depois das 14 texturas novas do redstone
estamos em **141**.

**Mudança de alcance geral:** `BlockDef` ganhou `support: 'none' | 'below' | 'mount'`. É o que faz
pó, placa, repetidor, alavanca e botão caírem como item quando perdem o apoio — e é declarativo,
disponível para qualquer bloco futuro.

#### Nether ✅ (2026-09-13)

Uma dimensão inteira: gerador próprio, portal, travessia, save separado e dois mobs. Os documentos
normativos **não especificam o Nether** — o doc 00 §52 e o doc 14 só o nomeiam —, então o desenho
mora nos comentários dos módulos, como manda a regra de desvio do `CLAUDE.md`.

**A decisão de arquitetura que manda em tudo: só existe uma dimensão carregada por vez.** Num
aparelho de 2 GB, manter o Overworld na memória enquanto o jogador está no Nether dobraria voxel,
luz e malha sem nada na tela para mostrar. Atravessar o portal grava o que está sujo, descarrega
tudo e recarrega do outro lado — `world.takeAllChunks`, `pipeline.setDimension`,
`renderer.chunks.clear()` e `save.setDimension()`, nesta ordem, porque o save precisa gravar as
colunas que saem ainda com a chave **antiga**.

- **`data/dimensions.ts`** é a tabela: céu, luz ambiente, cor de névoa, escala de bloco, se a água
  evapora, alcance da lava e teto sólido. Acrescentar uma dimensão é uma entrada aqui mais um
  módulo em `world/gen/` — e uma linha no worker.
- **`world/gen/nether.ts`**: netherrack maciço de 0 a 127 esvaziado por ruído 3D, rocha-mãe no
  chão e no teto, mar de lava até Y=31, quartzo, magma na beira da lava, areia das almas no chão
  dos salões e glowstone pendurado no teto. **A densidade sai de uma grade esparsa de 5×5×17
  interpolada trilinearmente**: a primeira versão amostrava os 32.768 voxels e custava 56 ms por
  chunk, o dobro do orçamento. A versão final custa **3,8 ms**.
- **`game/portal.ts`**: moldura de obsidiana de 2×3 a 21×21 nos dois eixos, sem contar os cantos —
  a moldura de 10 obsidianas do gênero funciona. Acender é o isqueiro no ar da face clicada;
  quebrar qualquer parte apaga o portal inteiro e deixa a moldura.
- **`game/travel.ts`**: três estados — parado, carregando e chegando. O estado do meio existe
  porque o pipeline é assíncrono: sem esperar o chunk de destino, o jogador cai pelo mundo vazio,
  que foi exatamente o que a primeira versão fez. Há tempo limite: destino que nunca carrega aborta
  a viagem em vez de largar o jogador no nada.
- **Escala 1:8.** Ida divide, volta multiplica. É o que torna o Nether um atalho de viagem em vez
  de um cenário a mais. A chegada procura um portal aceso num raio de 12 colunas antes de escavar
  um novo — é isso que faz a ida e a volta caírem no mesmo par.
- **Save por dimensão:** a chave de chunk do Overworld **continua sendo o `worldId` puro**, então
  mundo salvo antes do M7 abre sem migração; as outras ganham sufixo, e `deleteWorld` apaga todas.
  `PlayerSave.dimension` é opcional pelo mesmo motivo — save antigo abre na superfície.
- **Mobs:** porco zumbi (neutro, corpo-a-corpo, imune ao fogo) e **ghast** — voa, atira bola de
  fogo a 30 blocos e explode onde ela para. O voo é um traço novo (`flies`): sem gravidade e com
  o Y do destino entrando no steering. O tamanho de 4 blocos sai de `modelScale`, o mesmo
  mecanismo que o slime já usava — um modelo de 64 px não caberia na folha de skin.
- **Regras da dimensão que mudam o jogo:** água evapora, lava anda 4 blocos em vez de 3, a luz do
  céu não existe (a rocha-mãe do teto já garante isso no flood fill) e a névoa é vermelha por
  tabela, sem ciclo de dia.
- **Morrer no Nether devolve à superfície**, e sair do mundo dentro dele volta nele.

**Desvios conscientes:**

- O bloco de portal é um **cubo inteiro** translúcido, não o plano fino do gênero: um plano
  exigiria forma nova com eixo no estado, e o portal é atravessado, não observado de perto.
- O isqueiro **não põe fogo em nada** além do portal. Fogo que se espalha é um sistema com
  orçamento próprio, e o M7 não pediu isso.
- O ghast tem quatro tentáculos curtos em vez de nove compridos — a 30 blocos de distância, que é
  onde ele é visto, lê igual e custa metade das caixas no batcher.

**Uma dívida de cinco marcos fechada no caminho:** o traço `fireImmune` existia desde o M5 e
**nenhum mob o declarava**, porque não havia como um mob pegar fogo fora do sol. Agora lava
machuca mob, e os dois do Nether são imunes.

#### Trilhos e carrinho de mina ✅ (2026-09-13)

O bloco `rail` existia desde o M6 porque a mina o usa — o que faltava era tudo que faz dele
transporte: forma, máquina e veículo.

- **`world/rails.ts`** — conexão automática. Um trilho não é colocado com uma forma: ele a
  **descobre** olhando os vizinhos, e a redescobre quando um vizinho muda. Dois vizinhos mandam
  (reta no mesmo eixo, curva em eixos diferentes), um define o eixo, nenhum mantém o que estava; e
  a rampa entra depois, sobre o eixo já decidido. Mesma fila incremental com teto do redstone.
- **A forma vai para os bits 0..3 do estado**, e não é calculada no meshing como a conexão da
  cerca, porque **o carrinho precisa dela**: cerca conectada é desenho, trilho conectado é física.
- **`entity/minecart.ts`** — o carrinho guarda uma velocidade escalar e a direção; a cada tick lê a
  forma do trilho, projeta a direção sobre o eixo dela, anda e **gruda no centro** no eixo
  perpendicular. É o que o mantém na linha sem uma única consulta de colisão. Fora do trilho, cai e
  freia até parar.
- **Trilho motorizado** empurra quando energizado e **freia** quando não — os dois lados da mesma
  peça, como no gênero. **Trilho detector** vira fonte de redstone enquanto há carrinho em cima.
- **Os dois sistemas escrevem no mesmo voxel sem se atropelar:** `rails.ts` mexe nos bits 0..3
  (forma), `redstone.ts` no bit 4 (energia), e cada um preserva os bits do outro. Há teste de
  regressão para exatamente isso.

**Uma exceção de mesher, a primeira em sete marcos:** o trilho ganhou `CPLX_RAIL`, um caminho que
emite **um quad só**, deitado ou inclinado. Caixa alinhada aos eixos não representa rampa, e o
trilho é a única forma do jogo que precisa de plano inclinado. De quebra, um quad custa 1/6 do que
a caixa achatada custava.

**Desvio consciente:** o carrinho não tem acelerador. O olhar escolhe **para que lado** da linha
ele vai e dá o empurrão; quem mantém a velocidade é o trilho motorizado — que é o ponto de existir
um. Um acelerador contínuo tornaria o motorizado decorativo.

#### Import/export de mundos ✅ (2026-09-13)

Responde à pergunta que o usuário fez em 2026-09-12 — *"se eu criar um mundo no celular consigo
acessar no computador?"* — e que até aqui se respondia "não dá". Nada vai para servidor (doc 11 §1);
o transporte é um arquivo `.clw` que o jogador guarda onde quiser.

- **`save/archive.ts`** é o formato e as duas operações de banco. O formato **reaproveita o que já
  existe**: cada chunk entra no arquivo exatamente como está no banco, já serializado e comprimido
  por `save/serialize.ts`. Reserializar seria pagar duas vezes, e JSON com base64 ficaria três
  vezes maior. Meta, jogador, baús e veículos são JSON — é pouco, e assim um formato novo de baú
  não quebra o arquivo antigo.
- **Todas as dimensões vão no arquivo**, cada uma com seus chunks, baús e veículos. Dimensão nunca
  visitada não entra: quem nunca abriu um portal não carrega um Nether vazio junto.
- **O mundo importado sempre ganha id novo**, e o nome ganha sufixo quando já existe outro igual.
  Reaproveitar o id do arquivo sobrescreveria em silêncio um mundo que o jogador já tem — o pior
  resultado possível para uma função cujo ponto é não perder nada.
- **Erro de arquivo é mensagem, não exceção crua:** assinatura errada, truncado, corrompido e
  versão futura têm cada um a sua frase, e ela aparece na tela de mundos.
- A tela de mundos ganhou **Exportar** e **Importar**. O download é `<a download>` com URL de blob —
  o que funciona no WebView antigo tanto quanto no Chrome de hoje —, e a URL é revogada logo
  depois, senão o arquivo inteiro fica preso na memória da aba.

`packArchive`/`unpackArchive` são **puros**: só mexem em bytes. É por isso que o formato é testado
sem IndexedDB nenhum, inclusive os quatro modos de arquivo inválido.

#### Barco e carrinho no save, e um bug do Nether ✅ (2026-09-13)

Duas coisas que sumiam sozinhas, corrigidas juntas porque moram no mesmo lugar:

1. **Barco e carrinho nunca foram salvos**, desde que existem. Sair do mundo e voltar sumia com os
   dois: o trilho ficava, o carrinho em cima dele não. Agora há `VehicleRecord`, com
   `Session.vehicleSnapshot()` e `restoreVehicles()`.
2. **O baú do Nether sobrescrevia o da superfície.** A lista de tile entities tinha **uma chave por
   mundo**; atravessar o portal gravava a lista de lá por cima da de cá, e o conteúdo de todo baú
   de casa ia junto. A chave passou a ser a de dimensão — e, como `dimensionIdFor` devolve o
   `worldId` puro para a superfície, mundo salvo antes do M7 continua abrindo sem migração.

**A ordem virou regra explícita:** a `Session` dispara `onDimensionChange` **antes** de limpar as
listas, e o `SaveGame` tira o instantâneo de baús e veículos de forma síncrona dentro do evento —
só a gravação é adiada. Invertendo a ordem, o save encontraria tudo vazio. A troca de dimensão
também virou **um caminho só**: portal, renascimento e restauração do save passam todos por
`Session.enterDimension`.

#### Resource pack ✅ (2026-09-13)

O último item do doc 14. **A regra do doc 13 §1 continua inteira:** nenhum asset de terceiros entra
no repositório, e todo pixel que o jogo distribui continua saindo de `data/textures.ts`,
`data/itemart.ts` e `data/mobskins.ts`. Um pack é o caminho para quem quer a **própria** arte: um
`.zip` que o jogador escolhe, que mora no banco dele e que nunca passa por servidor nem por `src/`.

- **`core/zip.ts`** — o leitor de ZIP, ~150 linhas, porque o doc 13 §7 pede um `.zip` e o projeto
  não tem dependência de runtime. Só a leitura: nada de escrever, de ZIP64, de arquivo cifrado nem
  de conferir CRC (o PNG tem o dele). **Vai pelo diretório central**, no fim do arquivo, e não
  pelos cabeçalhos locais — é o que faz funcionar com zip gerado em streaming, cujo cabeçalho local
  traz tamanho zero. A descompressão é `DecompressionStream('deflate-raw')`, a mesma dos chunks:
  zero bytes de bundle.
- **`render/pack.ts`** — a convenção de nomes, a reamostragem e a persistência. Três famílias:
  `block/<textura>` e `item/<item>` em 16×16, `entity/<skin>` em 64×64 (a terceira é acréscimo
  nosso; o doc só nomeia as duas primeiras). O caminho pode ter qualquer prefixo de pastas: valem
  os **dois últimos segmentos**, então `block/stone.png` e `assets/x/textures/block/stone.png`
  chegam no mesmo lugar. Imagem de outro tamanho é reamostrada **no import**, com média ponderada
  pelo alfa — sem isso a borda de um vidro ganha um halo da cor de fundo do PNG. Nome sem
  correspondente no jogo é recusado e contado.
- **O pack entra no boot, antes de o atlas gerar um pixel.** Mipmap, média de cor das partículas de
  quebra e a folha de sprites de item derivam todos dos mesmos arrays. `Atlas` e `EntityAtlas`
  ganharam `overrides` no construtor, `buildItemSheet` ganhou um mapa por item, e `boot()` virou
  assíncrono — o banco subiu três linhas, porque ia abrir logo depois de qualquer jeito.
- **De graça:** um `item/<nome>.png` **dá sprite a item que não tinha nenhum**.
- **A tela é a de título, não a de opções** (`ui/screens/packs.ts`). Aplicar recarrega a página, e
  das opções se chega de dentro do jogo, pelo menu de pausa: recarregar ali custaria o que se fez
  desde o último autosave. Importar guarda o pacote e mostra o resultado; **quem aperta recarregar
  é o jogador**, que assim lê "38 aceitas, 4 ignoradas" antes de a tela sumir.

**Desvios conscientes, todos no comentário do módulo:**

- **Não há decodificador de PNG no projeto.** `createImageBitmap`, com `Image` + URL de blob como
  reserva para o WebView antigo, gasta 20 linhas em vez de 300 de bundle para repetir o que todo
  navegador já faz.
- **A arte do pack vale só na camada dela**: textura gerada a partir de outra continua saindo do
  procedural, senão trocar a pedra mudaria o minério, o musgo e mais uma dúzia de blocos.
- **`Atlas.loadOverrides` troca só o nível 0** de mipmap. O caminho do pack é o construtor; a
  função existe porque o `PROMPT.md` §219 a pede pelo nome.

#### Dívida do aleatório dos mobs, fechada (2026-09-13)

`entity/mobs.ts`, `entity/mobstore.ts` e `entity/spawn.ts` chamavam `Math.random()` direto, ao
contrário de `world/growth.ts`, que sempre teve o aleatório injetável. A consequência era medida:
`tests/mobs.test.ts` falhava 2 vezes em ~14 execuções da suíte completa e **nunca reproduzia
isolado** — o tipo de teste que acaba ignorado.

Os três passaram a expor `random: () => number`, e `Mobs.random` propaga para o store e para o
contexto de IA de uma vez. Os quatro arquivos de teste que montam mobs semeiam um `Rng` da própria
`core/rng.ts`. Há regressão: dois mobs nascidos com a mesma semente têm o mesmo yaw e o mesmo
cooldown de passeio, e quarenta ticks com a mesma semente dão o mesmo estado. Doze execuções
seguidas da suíte completa depois da mudança: verde.

### Fora de marco — estilo de textura Nítido (2026-09-13) ✅

Pedido do usuário: *"o que está me incomodando profundamente é essa textura completa do jogo,
principalmente dos itens do inventário"*, com o alvo de *"dar um bom salto nas texturas… ainda
pixelado obviamente, porém que fique fácil bater o olho e distinguir cada bloco, cada item, que os
itens possuam realmente profundidade"* — e sem custar nada para quem não quiser.

**Não é um resource pack.** O caminho do pacote (`render/pack.ts`) serve para arte de fora, e um
`.zip` versionado seria exatamente o asset de terceiros que o PROMPT.md §6 proíbe. Também não
serviria: um override vence só na própria camada, então trocar a pedra deixaria minério, musgo e
mais uma dúzia de blocos derivados com a pedra antiga. O estilo entra **dentro da geração**, e as
receitas de `data/textures.ts` continuam sendo a única fonte de desenho.

Três módulos novos:

- **`data/texturestyle.ts`** — os números, declarativos: o acabamento padrão de bloco, o de skin de
  mob, as exceções por textura e a resposta de luz de cada material de item. Bloco novo amanhã
  nasce com os dois visuais sem escrever linha nenhuma aqui.
- **`render/texfinish.ts`** — quatro passadas sobre o ladrilho pronto: **relevo** (a luminância
  vira campo de altura e é iluminada de cima-à-esquerda), **realce** (máscara de nitidez),
  **tom** (contraste, saturação e empurrão de cor) e **chanfro** (borda de cima clara, de baixo
  escura). Com greedy meshing a UV repete por bloco, então o chanfro desenha a grade do mundo — é
  o que faz uma parede de pedra parar de ser uma mancha cinza. Textura vazada é detectada pelo
  alfa e não leva chanfro; água, lava e portal não levam nada, porque acabamento fixo sobre
  imagem que rola vira cintilação.
- **`render/itemart3d.ts`** — as mesmas máscaras de `data/itemart.ts` viradas sólido iluminado:
  transformada de distância → abaulamento → normal → Lambert + Blinn-Phong → luz de quina fria →
  contorno tingido pelo item. O expoente do especular é o que separa metal (ponto duro) de gema
  (brilho espalhado): a picareta de diamante passa a parecer de diamante ao lado da de ferro.

A folha de sprites dobra para **32 px por item** no Nítido — é o espaço que o sombreado precisa. A
silhueta continua ampliada por repetição de pixel, então o desenho segue quadriculado; o que ganha
resolução é a luz. A arte de um pacote do jogador é ampliada e **não** passa pelo sombreado.

Duas decisões que só apareceram olhando o resultado renderizado fora do navegador:

1. **O contraste gira na média da própria textura**, não no cinza fixo. Com pivô em 128, neve, lã e
   o topo da grama — que já nascem claros — eram empurrados para o branco chapado e perdiam o pouco
   de detalhe que têm.
2. **Corpo e acento têm volume medido separado.** Com uma peça só, a cabeça da pá de madeira
   desaparecia dentro do cabo: mesma cor, e só o volume os distinguia. Medindo cada peça contra a
   própria borda nasce o vinco onde uma encosta na outra.

O contorno do cubo isométrico é decidido pela **espessura média do traço**: teia (1,3), gerador
(1,1), plantação (1,5), trilho e escada (2,0–2,5) ficam de fora, porque ali o contorno engrossa
cada fio e o desenho vira borrão; a muda em cruz (2,7) e qualquer cubo cheio (acima de 6) levam.

**Custo:** zero em jogo, dos dois lados. Nenhum caminho de render, tick ou mesh pergunta o estilo —
o que ele muda são os bytes gerados no boot, 2,0 ms no atlas e 26,7 ms na folha de sprites. A
primeira versão da folha custava 89 ms porque o cubo isométrico dividia o passo de amostragem por
`k`, ficando 16 vezes mais fino do que precisa; o passo não acompanha o tamanho do tile.

Escolhe-se em **Opções → Vídeo → "Texturas (recarrega)"**, e o padrão é o Nítido. Recarrega pelo
mesmo motivo da Qualidade: o atlas já foi para a GPU e a folha já é `background-image` de dezenas
de slots.

### Acabamento pós-M7 ✅ — 2026-09-14

Tudo que o §6 listava como "levantado pela revisão de UX e ficou para depois" (item 3) e como
"oportunidades pequenas que sobraram" (item 5). Não é marco novo: é a lista de dívidas do doc 08 e
da tabela de blocos sendo paga.

**A tabela de Vídeo do doc 08 §3.11 ficou inteira.** Faltavam oito linhas e todas entraram:

| Opção | O que ela faz de verdade |
|---|---|
| Distância de Simulação | raio em que mob nasce e vive (doc 07 §4). Num aparelho fraco baixá-la rende mais que baixar a de render: mob custa tick, não pixel |
| Gráficos (Rápido/Bonito) | **umbrella**: escolher um dos dois reescreve nuvens, partículas, névoa, sombras e balanço de uma vez. Não é um valor que o render consulta — assim não existe o estado inconsistente "Gráficos: Rápido, Nuvens: Bonitas" |
| Nuvens (Off/Rápido/Bonito) | passe novo (`render/clouds.ts`): um plano a y=192 com a forma feita no shader. **Uma draw call, dois triângulos, zero byte de textura.** Uma oitava de ruído no Rápido, duas no Bonito. Desenha depois do terreno opaco, com teste de profundidade e sem escrever profundidade — a montanha na frente esconde a nuvem, e quem voa acima delas vê o chão sumir |
| Partículas (Mínimo/Reduzido/Todas) | teto vivo de partículas. Os arrays passaram a ser alocados **sempre no máximo** (~36 KB): dimensioná-los pelo preset economizaria 30 KB e faria o jogador de T0 que escolhe "Todas" não ver diferença nenhuma — o controle mentiria |
| Névoa (Mínima/Próxima/Distante) | multiplica a densidade que a distância de render calcula. "Mínima" não zera: zero deixaria o terreno recortado contra o céu na borda do mundo carregado |
| Iluminação Suave (AO) | recarrega. Desligada, todo vértice sai com AO 3 — e aí o merge greedy **deixa de quebrar nas bordas**: medido num degrau, 5 quads viram 3. É o caminho de fuga de quem precisa de cada vértice |
| Balanço da Câmera | oscilação do olho ao andar, movida pela **distância andada** e não pelo tempo — senão a câmera balança parada empurrando contra a parede |
| Mostrar FPS | contador solto no canto. O F3 já mostra o número, mas traz vinte linhas junto |
| VSync | recarrega. **No navegador não se desliga o vsync** — quem apresenta o quadro é o compositor. O que este controle mexe é `desynchronized`, e o padrão é ligado (sincronizado) porque desligado piscou no S24 Ultra (§4). Quem quiser os poucos ms de latência a menos escolhe, sabendo |

**Acessibilidade (doc 08 §6) também fechou.** Modo daltônico com paleta Okabe-Ito — o HUD codificava
vida, fome, ar e XP **só por cor**, e três delas caem no eixo que protanopia e deuteranopia perdem:
para 8% dos homens a barra de vida e a de experiência eram a mesma cor. Mais contorno de bloco em
alto contraste (branco opaco e grosso, contra o preto alpha 0,4 que some em obsidiana), esconder
flashes do céu, e efeitos de distorção 0–100% (hoje o "puxão" de FOV ao correr; em 0% a câmera não
mexe, que é o que quem tem enjoo de movimento precisa).

**Relâmpago.** "Esconder flashes do céu" não podia ser um interruptor sem nada atrás: a tempestade
não tinha clarão nenhum. Agora tem, **determinístico da seed e do tick** como o resto do clima —
dois jogadores no mesmo mundo veem o mesmo raio no mesmo instante, e o save não ganha um campo. O
trovão é o único som do jogo que toca sem posição.

**Teclas remapeáveis.** Dez ações em `data/keybinds.ts`, mapa do jogador em `input/keybinds.ts`,
lista em Opções → Controles. Clicar no botão captura a próxima tecla **antes** de qualquer outro
ouvinte — sem isso, o jogo por baixo continuaria agachando enquanto o jogador escolhe a tecla de
agachar. **Conflito é permitido e pintado de vermelho, não recusado:** trocar duas teclas de lugar
passa obrigatoriamente por um estado em que as duas estão na mesma. `Escape` e os dígitos da hotbar
ficam de fora — remapear a saída de emergência de toda camada de UI cria o estado em que o jogador
não consegue mais sair de uma tela. `Q` / `Ctrl+Q` (largar item) existia no doc 08 §3.5 e não tinha
tecla nenhuma.

**Nove sliders de som.** O motor tinha cinco barramentos (doc 10 §1) e o doc 08 pede nove
controles; os dois não se contradizem — um descreve o grafo, o outro o painel. O grafo ganhou os
que faltavam (hostil, amigável, jogador, clima) e o roteamento virou tabela em
`data/soundbuses.ts`: **quem dispara um som não sabe mais em qual slider ele cai**. Mob neutro
(lobo, enderman) conta como amigável — quem baixa "Mobs Hostis" quer parar de ouvir o zumbi na
caverna, não o lobo. Os barramentos de Ambiente e Clima teriam nascido vazios, então ganharam
conteúdo real: a fornalha e o portal foram para Ambiente, e a **chuva em loop** (doc 10 §2, nunca
implementada) e o trovão para Clima.

**Fogo que se espalha.** `flammable` estava na tabela de blocos desde o M1 — madeira 5, folha e lã
30 — e **nada no código a lia**: a floresta não pegava fogo e o número era enfeite. `world/fire.ts`
segue a disciplina do crescimento e dos fluidos: registro de posições em chamas, rodízio com teto
duro por tick, **nada de random tick**. O incêndio grande queima mais devagar por chama e nunca
derruba o frame (0,03 ms com as 256 chamas do teto). A chama envelhece, tenta pegar num vizinho com
chance proporcional ao `flammable` dele, consome o que pega, se apaga sem combustível e **a chuva
apaga** (doc 03 §8). O isqueiro deixou de servir só para portal.

**Morcego.** A categoria `ambient` do doc 07 §4 tinha cap próprio no spawner desde o M5 e **nenhum
mob atrás dela** — era a única linha da tabela de spawn vazia. Ele não ataca, não dropa, não dá XP
e some longe: o valor dele é dizer "você está numa caverna" antes de o zumbi dizer.

**Boneco do jogador.** O doc 08 §3.5 desenha um preview do modelo ao lado dos slots de armadura e
abre a exceção *"em T0, pode ser um sprite estático"*. **Este é o caminho da exceção, para todos os
tiers**, e o motivo está no cabeçalho de `ui/containers/paperdoll.ts`: um segundo contexto WebGL num
aparelho de 2 GB custa pool de buffers, programa e uma cópia do atlas de entidade; um `scissor` no
principal faria o passe de mobs rodar com outra matriz no meio do frame. O desenho é ortográfico de
frente, peça por peça, com as faces que o modelo já mapeia — e com a **armadura vestida por cima**,
que é a informação que a fileira de slots não dá: ela diz o que está guardado, não o que está no
corpo. A cabeça acompanha o ponteiro por deslocamento.

**Miniatura e tamanho do mundo.** O store `thumbs` existia desde o M4 e estava vazio; `sizeBytes`
nascia 0 e ficava 0 para sempre — a tela de seleção mostrava três mundos com o mesmo texto cinza, e
não havia como escolher qual apagar quando o aviso de cota do doc 11 §4 aparecesse. A foto é tirada
**dentro do mesmo quadro em que o canvas foi desenhado** (o contexto é `preserveDrawingBuffer:
false`), copiada para um canvas de 160×90 e guardada no autosave. O tamanho sai de uma varredura
por cursor, no `saveAll` e não a cada autosave. As duas coisas **viajam no `.clw`**: o formato foi
para a v2, com a miniatura no fim do arquivo — um leitor da v1 encontra tudo que conhece nos mesmos
offsets.

**Prévia da grade no livro de receitas.** O livro mostrava só o resultado: para saber o que entra
numa bancada era preciso clicar e ver a grade se preencher — e, se faltasse ingrediente, o clique
não fazia nada e o jogador continuava sem saber o quê. Agora a grade aparece ao passar o mouse ou
tocar, com **o que falta em vermelho**.

**Canto de escada.** O comentário de `mesh/shapes.ts` dizia que canto não existia porque *"dobrar a
geometria custa mais do que o olho ganha"*. Ele custa **uma caixa** — interno são 3, externo são 2,
contra 2 da reta — e, como a conexão de cerca, é derivado dos vizinhos na hora: **não ocupa bit
nenhum do save**, e mundo antigo abre mostrando os cantos. A regra não saiu de decorar nomes de
rotação: ela vem de uma exigência geométrica verificável — a superfície alta de duas escadas
perpendiculares tem que ser contínua pela face que elas dividem. Desenho e colisão saem da mesma
conta, incluindo as quatro consultas de vizinho, que só acontecem para escada.

**Som no resource pack.** `sound/<nome>.ogg` (ou `.mp3`/`.wav`/`.m4a`) substitui a síntese. É o
único item do pack que entra **como veio**, e por isso tem teto próprio de 2 MB. A amostra
**desvia** da receita em vez de substituí-la, e um arquivo que o navegador não sabe ler cai de volta
na síntese: ficar sem o som seria pior que ignorar a escolha do jogador.

### Controle ✅ — 2026-09-14

Pedido do usuário: jogar com um **DualSense (PS5)** conectado por cabo ou
Bluetooth, no computador e no celular, com Xbox One também se não custasse
muito. O gamepad existia desde o M0 e estava a meio caminho.

**O que já funcionava e o que não.** Andar, olhar, pular, agachar, quebrar e
colocar funcionavam. Do doc 09 §3 faltavam `Y` (soltar item) e `LT` (usar). E
**pausa, inventário e rolagem de hotbar eram calculados e jogados fora**:
`GamepadState` tinha os três campos desde o M3 e nada os consumia. Na prática,
quem jogasse de controle não conseguia abrir a mochila nem pausar — e, como
nenhuma tela respondia a gamepad, também não conseguia entrar num mundo.

**Perfis, e por que eles quase não são sobre mapeamento.** Quando o navegador
reconhece o aparelho (`mapping: 'standard'`) os índices de botão são iguais
para todo controle — é o layout da especificação, e vale no Chrome e no Firefox,
no computador e no Android. O que muda de verdade é o **nome do botão**: dizer
"aperte `A`" a quem segura um DualSense manda o jogador procurar um botão que
não existe. Cada família tem um perfil com os rótulos das oito teclas que a
interface cita, e a dica da tela e o aviso do HUD passam a falar `✕ ○ □ △`.

O perfil tem um segundo papel, de rede de segurança: quando o navegador **não**
normaliza, os índices viram a ordem crua do HID, que num controle de PlayStation
é `□ ✕ ○ △` — sem a tabela da família, apertar `□` faria o jogador pular. Esse
caminho **não foi verificado em aparelho**; o normal é o padronizado.

A detecção usa o par **fabricante/produto**, não o nome. É a armadilha da
tabela: um Xbox reporta "Xbox Wireless Controller" e um DualShock 4 reporta
"Wireless Controller", e casar por nome dá rótulos de PlayStation ao Xbox. Há
teste para exatamente isso.

**Navegação de interface (doc 08 §4.3).** Era a parte que faltava para o
controle ser jogável e não só "mover o boneco": sem ela não se entra num mundo,
não se abre o inventário e não se sai de uma tela. O alvo é o elemento com
`role="dialog"` visível mais acima — e não uma lista de telas, porque o doc 08
§4.4 já exige o atributo em todo modal, então tela nova entra sozinha. Três
decisões: **esquerda/direita mexem no valor** do controle focado em vez de pular
de campo (a tela de opções é quase toda slider); **voltar dispara `Escape`** na
camada, que já sabe fechar uma de cada vez (doc 08 §4.1); e a repetição é de
teclado — segurar anda com atraso inicial, senão a lista de opções passa vinte
campos num piscar.

**Dois laços, um controle.** A navegação roda em `requestAnimationFrame`
próprio, porque a tela de título existe muito antes de haver um tick de jogo.
Isso criou o risco de os dois laços **roubarem a borda de subida um do outro**,
e foi resolvido separando as responsabilidades: `poll()` lê tudo e consome
borda, e é chamado só pelo tick; `pollNav()` lê apenas estado segurado. Há
teste para o caso.

**O que o controle não consegue sozinho, e o jogo diz isso.** Ligar o áudio e
entrar em tela cheia exigem um gesto do usuário, e aperto de botão de controle
não conta como gesto em navegador nenhum. Conectar um controle com o áudio
ainda desligado mostra a frase que resolve — tocar a tela ou apertar uma tecla
uma vez.

**Miudezas que faltavam para fechar:** `L3` corre, duplo toque no pulo alterna o
voo no criativo (doc 06 §9 — sem isso metade do modo criativo é inacessível de
controle), perder o foco zera o controle (senão volta-se quebrando o mundo
sozinho), e a dica da tela some pelo relógio para quem joga só de controle no
computador, que nunca trava o ponteiro.

**Opções → Controle:** sensibilidade do analógico (multiplicador próprio, porque
polegar e mouse não querem a mesma), **zona morta** (é ela que salva analógico
gasto, que reporta desvio parado e faz o jogador andar sozinho para um lado),
layout forçado e vibração. A seção mostra o que está conectado: é a primeira
pergunta de quem liga um controle.

### Controle, segunda passada ✅ — 2026-09-14

Cinco pedidos do usuário depois de jogar com o DualSense ligado por Bluetooth —
que **foi reconhecido de primeira**, fechando a maior incógnita da entrega
anterior.

**`Start` valia por dois ou três apertos.** Não era o controle. Está em §4: é o
`reset` que esquecia o que estava apertado. O relato foi preciso o bastante
(*"ele abre e fecha o menu, como se eu tivesse apertado mais de uma vez, e isso
tenho certeza que não é problema do controle"*) para apontar direto para a
borda de subida.

**`□` passou a abrir a mochila.** O que ele fazia antes era **duplicar o `L2`**:
colocar bloco. Era a única coisa que ele fazia, e a mochila só abria no
`Create` — um botão pequeno, mal colocado, para a ação mais repetida do jogo.
Agora `L2` coloca, `R2` quebra, e as quatro faces ficam para pular, agachar,
largar e abrir a mochila. `Create`/`View` continua abrindo também.

**Botão e intenção viraram duas tabelas.** `src/data/gamepads.ts` tinha uma só,
com nomes de ação (`place: 2`), e mudar o que o `□` faz obrigava a mexer num
índice — que é do aparelho, não do jogo. Agora `STANDARD_BUTTONS` diz **onde o
botão fica** e `PAD_BINDINGS` diz **o que ele dispara**; remapear é uma linha na
segunda. É a regra "dado é dado, não código" aplicada a um lugar onde ela não
estava.

**`L1`/`R1` já trocavam o item da mão** desde a entrega anterior — o pedido era
para uma coisa que existia. Ficou com teste próprio, que é o que faltava para
ela ser verificável.

**A navegação do direcional passou a ser espacial.** Era ordem de documento, e
no inventário isso obrigava a atravessar armadura, boneco e resultado para ir
da grade de criação até a mochila: doze casinhas para o que o olho lê como "um
passo para a direita" (*"ele não corta caminho, ele passa por todas as
casinhas"*). Agora o foco vai para o vizinho **mais próximo na direção pedida**,
medido em pixels, com peso extra para quem sai do eixo — a coluna de slots desce
em linha reta e a mochila fica a um passo. Sem geometria (tela ainda não
desenhada, teste em Node) vale a ordem do documento, que é o comportamento
antigo; nada regride onde a medida não existe.

**O analógico direito virou cursor nos menus** (`src/input/uicursor.ts`). Fora
deles ele é a câmera; com uma tela aberta ele não tinha o que fazer, e é
exatamente aí que falta o mouse. Ele **não clica**: encosta num elemento e o
foca, e quem ativa continua sendo o botão de confirmar — ter dois caminhos de
ativação seria duas regras para a mesma coisa. Nasce no meio da tela, anda 950
px/s, não sai da viewport, some sozinho depois de quatro segundos parado e só
entra no documento na primeira vez que alguém empurra o analógico: quem joga de
toque não paga um nó a mais.

**Os dois botões do mouse existem no controle.** `A`/`RT` valem clique esquerdo
e `LT` vale clique direito nos menus — a mesma mão que coloca e quebra no
mundo. Sem o direito, o cursor daria alcance mas não daria **função**: não havia
como pegar metade de uma pilha nem soltar um item de cada vez (doc 08 §3.5), que
é o gesto que o toque ganhou hoje de manhã.

---

### Controle, terceira passada ⚠️ — 2026-09-14

**Pendência aberta: `L1`/`R1` não trocam o item da mão num DualSense real.**

O relato veio duas vezes, a segunda depois de a primeira ter sido respondida com
*"isso já funciona"* — o que estava errado como resposta, mesmo estando certo
como leitura do código. Os dois botões estão nos índices **4 e 5** do layout
padrão, `PAD_BINDINGS` os liga a `hotbarPrev`/`hotbarNext`, `Controls.update`
chama `onHotbarScroll`, e `Inventory.scroll` move a seleção. O caminho inteiro
foi exercitado de ponta a ponta com um `Gamepad` falso — `Controls` de verdade,
callbacks de verdade — e chega. Todo o resto do controle funciona no mesmo
aparelho, incluindo botões vizinhos.

Quando o código não explica o sintoma, a resposta não é mexer no código: é
**medir o aparelho**. Foram as duas coisas:

1. **Painel de teste de controle** em Opções → Controle
   (`ui/screens/padtester.ts`). Ele lê `navigator.getGamepads()` **cru** — sem
   perfil, sem remapeamento, sem zona morta — e mostra o índice, o nome e o
   valor de cada botão apertado, o último aperto (que fica na tela depois de
   soltar, porque apertar e ler ao mesmo tempo é difícil), a contagem de botões
   e eixos, e se o navegador normalizou o layout. Um diagnóstico que passasse
   pela camada sob suspeita não diagnosticaria nada.
2. **O direcional ←/→ passou a trocar o item da mão**, fora dos menus. Não é
   a correção do bug — é um caminho que com certeza existe enquanto o bug não
   tem causa. Dentro dos menus o direcional volta a ser navegação, porque
   `uiCapture` zera a hotbar.

O que o painel vai dizer decide o próximo passo: se apertar `L1` acusar o índice
4, o problema não está no mapeamento e a investigação vira para o consumo; se
não acusar nada, o aparelho não está mandando o botão e o caminho é outro (um
segundo controle na lista, um `id` diferente em Bluetooth, uma contagem de
botões fora do padrão).

---

### Controle, quarta passada; modo de jogo; HUD ✅ — 2026-09-14

Seis relatos de uma sessão só, e os três primeiros tinham **a mesma raiz**: a
navegação por controle brigava com o jogador em vez de ajudá-lo.

**O foco andava certo e ninguém via.** `:focus-visible` é decidido pelo
navegador a partir da modalidade do último input, e **gamepad não é uma
modalidade que ele conheça**: um `focus()` disparado de um laço de
`requestAnimationFrame`, depois de o jogador ter tocado a tela, não acende anel
nenhum. Toda a interface do jogo estiliza foco com `:focus-visible`, então
navegar de controle movia o foco de verdade e não mostrava nada — o que de
dentro do jogo é indistinguível de *"parece que está indo para botões nem
existentes em tela"*. O documento agora ganha a classe `pad-nav` enquanto a
navegação está em uso, com anel desenhado à mão; o primeiro toque ou tecla
devolve a decisão ao navegador. É a mesma heurística dele, para uma modalidade
a mais.

**A navegação tomava o foco de quem nunca ligou um controle.** Ela rodava a cada
tick com uma tela aberta e, sem nada focado, focava o primeiro item. No
inventário criativo o primeiro focável é **o campo de busca** — então, no
celular, pegar qualquer item devolvia o foco à busca e **subia o teclado
virtual** por cima da tela inteira (*"impossibilitando de fazer qualquer
coisa"*). Agora ela não encosta no foco enquanto o controle não for empurrado, e
o aperto que revela onde o foco está não anda com ele nem aperta nada — quem
abriu a tela no dedo e pegou o controle depois precisa ver onde está antes de
agir. O foco de partida também **foge de campo de texto**, pelo mesmo motivo.

**Botão que não está na tela não entra na travessia.** O atributo `hidden` não
pega tudo: um painel fechado por CSS deixa os botões dele no documento. Agora
quem não tem caixa de layout fica fora — e a regra se calibra sozinha: se
ninguém tem caixa, não há layout para consultar e a lista vai inteira, que é o
comportamento antigo.

Junto, saiu um bug de contagem que não tinha sido relatado: as sete leituras do
direcional estavam dentro de um `else if`, então a direção que não era lida
guardava um número de ticks velho e o primeiro aperto dela, depois de soltar
outra, repetia na hora ou não valia.

**Trocar de modo no mesmo mundo.** O save já guardava `meta.gameMode` desde o M4
e `saveAll` já o escrevia a partir de `player.mode` — o que não existia era
**como trocar**. O botão mora na pausa, porque é decisão de partida e não
preferência, e diz para onde vai (*"Mudar para Criativo"*) e não onde está.
Trocar desliga o voo, fecha a tela aberta e salva na hora.

**A fome virou comida.** O doc 08 §3.4 sempre pediu *"10 coxas"*; o código
desenhava `▮▮▯▯`, que na tela do celular lê como um risco. Agora é uma coxa de
frango de 9×9, definida como grade de caracteres no código e convertida em SVG
de retângulos para servir de **máscara** — a cor continua saindo do CSS, então a
paleta para daltônicos (doc 08 §6) segue valendo, e nenhum asset de terceiros
entrou no repositório. O lado do ícone acompanha a fonte da barra, então a opção
de texto grande da acessibilidade vale nos dois.

**E some tudo no Criativo.** Vida, ar, fome e armadura não mudam nunca ali:
quatro fileiras congeladas ocupando a faixa mais disputada da tela, sugerindo
uma mecânica que não existe.

---

### A câmera saiu do tick ✅ — 2026-09-14

Três relatos. Um deles é a correção mais visível da semana e valia para **todo
mundo**, em qualquer aparelho.

**A câmera andava a 20 Hz.** O jogo simula a 20 Hz e interpola no render, e a
posição do jogador seguia essa regra — mas a rotação não: `camera.yaw` recebia
`player.yaw` direto, sem interpolação, e `player.yaw` só mudava no tick. Num
display de 60 Hz isso repete o mesmo ângulo por três quadros e depois pula; num
de 120, por seis. O jogo rodava liso e a câmera andava *"de quadro em quadro,
como se fosse movimentação por teclado"* — notado inclusive por quem não estava
procurando.

Interpolar a rotação como se interpola a posição **não** era a resposta. Posição
é simulação: ela tem estado anterior de verdade, e interpolar é reconstruir o
que aconteceu entre dois estados conhecidos. Rotação é **input**: interpolar
adiciona um tick de atraso e continua entregando a velocidade em degraus, porque
o passo continua sendo de 50 ms. A câmera passou a ser lida **uma vez por quadro
desenhado**, que é o que todo jogo de primeira pessoa faz.

A divisão importa: mouse e dedo entregam **pixels acumulados** desde a última
leitura e não são escalados pelo tempo — o mesmo arrasto tem que girar o mesmo
em qualquer FPS. O analógico entrega **velocidade** (−1..1) e é multiplicado
pela duração do quadro, senão girar dependeria do FPS. O passo vem limitado a
100 ms: um engasgo de 250 ms faria o analógico girar cinco vezes de uma vez.

**Um gesto é uma coisa só.** No Modo A, o dedo que passa da folga de toque vira
câmera e **não volta a ser quebra** enquanto não for levantado. Isso desfaz a
reancoragem entregue de manhã, em que parar no meio de um arrasto rearmava a
contagem: era uma resposta ao toque longo que quase nunca disparava, e o efeito
na mão foi o oposto — o anel de progresso aparecendo o tempo todo enquanto o
jogador só olhava em volta. Começada a quebra, nada a cancela a não ser levantar
o dedo.

**O painel de controle ficou mais fundo.** O `L1`/`R1` do DualSense continua não
aparecendo — *"reconhece todas as outras teclas do controle, menos essas
duas"* —, e o painel agora mostra os três jeitos de um botão chegar (`pressed`,
meio curso, e só encostado, que alguns drivers usam e o painel engolia), o
**último eixo que saiu do lugar** (se o botão estiver chegando como eixo ou
chapéu, é aqui que aparece) e o `id` cru do aparelho. As hipóteses que restam
estão listadas no §5 P1.

> **Fechado horas depois:** a causa é o navegador. Ver a seção
> *"`L1`/`R1`: a causa era o navegador"*, acima.

---

### `L1`/`R1`: a causa era o navegador ✅ — 2026-09-14

Três sessões atrás isto era um sintoma sem explicação: num DualSense real, `L1`
e `R1` não trocavam o item da mão, enquanto todo o resto do controle
funcionava. O código não explicava — os dois estão nos índices 4 e 5 do layout
padrão e o caminho inteiro tem teste de ponta a ponta.

**A resposta veio de fora do jogo.** O jogador abriu um testador de joystick no
Chrome do Android e viu que apertar `L1`/`R1` **trocava de aba do navegador**.
É isso: num Android, o sistema entrega os botões do controle como **tecla**, e o
navegador fica com algumas antes de a página ver. O painel de teste concorda —
ele reporta `mapping: 'standard'` e 17 botões, e os índices 4 e 5 nunca ficam
`pressed`. Instalar como PWA não muda.

Não há correção do lado do jogo: o mapeamento está certo, e a Gamepad API nunca
recebe o evento. O que dava para fazer, e foi feito:

- **o direcional ←/→ troca o item**, entregue na sessão anterior como caminho
  "que com certeza existe" — que agora é a resposta definitiva e não mais uma
  muleta;
- **a tela de Opções diz isso** quando há controle ligado, no lugar onde o
  jogador vai procurar: se um botão não aparece no painel, o navegador ficou com
  ele;
- **a dica de entrada no mundo cita o direcional** junto de `L1`/`R1`;
- **o painel passou a mostrar a última tecla que a página recebeu**. É o que
  separa "o navegador entregou e o jogo ignorou" de "o navegador ficou com ela"
  — dois casos indistinguíveis de dentro do jogo, e a diferença entre ter e não
  ter conserto. Aqui a linha fica vazia, o que confirma o diagnóstico.

Fica registrado porque é o tipo de coisa que se investiga de novo daqui a seis
meses: **o mapeamento não está errado**.

---

### Os dois critérios que faltavam viraram teste automatizado ✅ — 2026-09-14

O PROMPT.md §11 tem dois critérios que nunca tinham sido medidos: *"abre em
< 5 s em 3G"* e *"2 horas sem crash, sem perda de progresso e sem travas"*.
Ambos pediam um navegador de verdade rodando o jogo publicado, e agora existe
um jeito de fazer isso sem ninguém segurando o mouse.

**O harness é um Chrome de verdade dirigido por CDP, com zero dependência.** O
Node 22 já traz `fetch` e `WebSocket` globais, e o protocolo do DevTools é JSON
sobre um socket — `scripts/cdp.mjs` tem 40 linhas e faz o que o Puppeteer faria
trazendo 300 MB e um Chrome próprio. O Chrome usado é o que já está instalado.

**Abertura em 3G — medida, não estimada** (`npm run slow-network`). O CDP
estrangula a rede com os mesmos perfis do DevTools, o cache fica desligado e o
perfil é novo a cada medida (senão a segunda leitura sai do service worker e
mede zero). O cronômetro para quando **a tela de título fica visível**, que é o
que o critério pede — e não no `load` do documento.

| Rede | Até o título | `load` |
|---|---|---|
| sem limite | 2,89 s | 1,11 s |
| **3G rápido** (1,6 Mbit/s, 562 ms) | **4,48 s** ✅ | 2,49 s |
| 3G lento (400 kbit/s, 2000 ms) | 9,66 s | 7,76 s |

São 173,0 KB na rede até o título, dos quais 169,1 KB do bundle — o GitHub
Pages serviu **gzip**, não brotli, então há 26 KB de margem que o servidor
simplesmente não usou.

O número que interessa não é só o veredito: **no 3G rápido, metade do tempo não
é rede.** O documento fica pronto em 2,49 s e a tela de título aparece em 4,48 s
— os ~2 s do meio são atlas procedural, folha de sprites e inicialização do GL,
num desktop. Num T0 essa metade cresce, e é ela, não o tamanho do bundle, que
decide se o critério continua cumprido. O caminho para ganhar tempo, se um dia
precisar, está do lado da CPU.

**Resultado da primeira execução (2026-09-14 22:46 → 2026-09-15 00:19).** Noventa e dois
minutos e meio de voo contínuo, encerrados a pedido do usuário antes dos 120 — **zero erros, zero
travamentos**, 185 amostras. O que os números dizem:

- **Não há vazamento.** O heap começou em 37,8 MB e terminou em 44,2, com as médias por faixa de
  15 min entre 42,8 e 47,2 MB. As amostras finais mostram o dente de serra clássico do coletor
  (37,6 → 44,5 → 52,0 → 63,2 → 41,7): ele sobe e **volta**, que é o contrário de vazar.
- **O anel de chunks é limitado de verdade.** 489 colunas do começo ao fim, com **67 621 blocos**
  percorridos em linha reta. O descarregamento acompanha o carregamento; se não acompanhasse, este
  é o teste que teria mostrado, porque nada nele volta para onde já esteve.
- **Nada engasga.** FPS mediana 60, mínimo 50, **nenhuma amostra abaixo de 30**. Tick mediano de
  0,0 ms com pico de 6,1; render mediano de 1,0 ms com pico de 13,6.
- **As entidades não acumulam.** Itens no chão oscilaram entre 125 e 311 de média por faixa de
  10 min, subindo e **descendo** — os picos acompanham os de mob, que é o ciclo de noite e
  amanhecer. Um vazamento de entidade seria uma curva que só sobe, e não é o caso.

O que este teste **não** prova: que o jogo é jogável por duas horas. O robô voa em linha reta e não
abre inventário, não constrói, não morre e não volta. Ele prova que pipeline, memória e entidades
aguentam — o resto ainda pede mão humana, de preferência no celular.

**Sessão longa — automatizada** (`npm run soak`). Um agente injetado na página
entra no menu, cria um mundo criativo, liga o voo e segura o "para frente":
voar em linha reta é o pior caso do pipeline, porque nunca para de pedir chunk
novo. A cada 30 s guarda uma amostra do overlay de depuração.

Três coisas que o harness aprendeu do jeito difícil, e que estão no código
porque um teste que mente é pior que nenhum:

1. **Aba escondida não roda.** Numa aba comum o jogo para quando ela deixa de
   estar visível — é o que o `visibilitychange` faz, e está certo. O teste
   rodaria só com a janela em primeiro plano por duas horas. Daí headless.
2. **`blur` solta as teclas.** `Keyboard` esvazia as teclas apertadas quando a
   janela perde o foco, e uma janela headless perde o foco sem avisar: o
   primeiro teste passou minutos com o jogador imóvel num mundo que carregava
   normalmente, FPS saudável, tudo verde. O "para frente" passou a ser
   **reafirmado** a cada 500 ms, e duas amostras no mesmo lugar viram erro
   registrado.
3. **O duplo toque do voo estava na fronteira.** O terceiro aperto — o que
   segura para subir — caía em cima da janela de 300 ms que alterna o voo: às
   vezes ligava, às vezes desligava o que acabara de ligar. Era cara ou coroa, e
   no coroa o boneco encalhava numa parede a seis blocos do nascimento. Agora a
   subida é **verificada**: subiu mais de 25 blocos e ficou, está voando; senão,
   tenta de novo.

---

### M8 — Presença dos objetos ✅
Marco aberto em 2026-09-16 a pedido do usuário, depois de uma revisão do código inteiro. Ele é de
**acabamento**: nada aqui acrescenta mecânica, tudo aqui faz o que já existe parecer o que é.

**A causa dos três incômodos era a mesma, e não era textura.** O formato de vértice guardava a
posição em **meios-blocos**, e isso não era detalhe de compressão: era uma regra de geometria.
Toda caixa mais fina que 0,5 bloco colapsava no arredondamento — e é assim que quase toda forma do
jogo é descrita. Poste de cerca (2/16) e grade (1/16) **sumiam**; porta, alçapão, placa e quadro
(3/16) viravam planos de espessura zero; botão, alavanca, repetidor e placa de pressão idem; e o
levantamento de 1/16 do trilho virava zero, deixando ele brigando com o chão no Z.

A posição passou a ser em **1/16 de bloco** (9 bits por eixo). Os 3 bits a mais por eixo saíram de
onde não faziam falta: `tint` tem quatro valores (2 bits bastam), `u`/`v` foram para a segunda
palavra e o campo `flags`, que nunca teve leitor, saiu. **Continua em 8 bytes por vértice**, então
o orçamento de memória de mesh do doc 02 §3 não muda.

O que isso destravou, em ordem do que o jogador vê primeiro:

| Era | Ficou |
|---|---|
| **Tocha** = dois quads cruzados com a textura de tocha — lia como flor marrom | poste de 2/16 com brasa no topo, encaixe de chão e de parede, **inclinada** na parede, textura em faixas (lateral de 2 px não guarda detalhe horizontal), fagulha saindo da ponta e tampa de baixo descartada quando o apoio a cobre |
| **Porta** = um bloco de altura, textura repetida | duas células (`oak_door` + `oak_door_top`), folha de baixo com a maçaneta na divisa e folha de cima com a travessa; as duas giram juntas na mão e no circuito |
| **Cama** = um cubo de lã | duas células (`bed` + `bed_head`), colchão de 9/16 com dois pés em cada ponta de fora, sólida (dá para subir), e clicar em qualquer metade deita na mesma cama |
| **Item na mão** = quad chapado, invisível de perfil | sólido extrudado da própria silhueta: frente, verso e uma borda por aresta, com a borda amostrando **o pixel de dentro** — a lateral da lâmina sai com a cor da lâmina |
| **Tocha/porta/cama no inventário** = cubo isométrico da textura | silhueta própria em `data/itemart.ts`, o mesmo desenho que a mão extruda |
| **Contorno do bloco mirado** = sempre o cubo unitário | a envolvente da forma (`boundsFor`): laje acende meia caixa, tocha acende um poste |

**A máquina que faltava para porta e cama é `world/multiblock.ts`**, e ela é pequena porque mora no
lugar certo: um ouvinte de `world.onBlockChange`. Como **toda** mutação de voxel passa por
`setBlock` (regra nº 3 do projeto), as duas metades morrem juntas para qualquer causa — jogador,
explosão de creeper, fogo, pistão, importação de `.clw` — sem nenhum desses sistemas saber que
existe porta de dois blocos. O comentário de `game/sleep.ts` que chamava a cama de um bloco de
"desvio consciente até haver máquina de colocação/quebra" deixou de valer e saiu.

**Custo medido:** a tocha passou de 2 para 5–6 quads. O pior caso que um jogador consegue construir
— um piso inteiro de 256 tochas numa section — mesha em **1,13 ms**, dentro do orçamento de 8 ms
por section e com um teto próprio de 2 ms em `tests/perf.test.ts`. Encher a section inteira é
impossível: tocha precisa de apoio.

#### Segunda passada (2026-09-16, tarde)

**O vidro não estava fosco: ele não estava lá.** A receita pintava o ladrilho inteiro com
`alpha: 0.28` e o vidro é desenhado no passe **recortado**, cujo shader descarta tudo abaixo de
0,5 — **zero pixels** sobreviviam. Uma janela colocada não deixava rastro na tela e o slot parecia
vazio. Virou moldura de 1 px mais duas riscas de reflexo, com o miolo em alfa zero: 29% de desenho,
71% de buraco de verdade. Não foi para o passe translúcido de propósito — lá o desenho é ordenado
de trás para frente e não escreve profundidade, e vidro é o bloco que se empilha em parede inteira.

**A escada de mão não escalava.** Procurando o que mais estava chapado apareceu um buraco maior que
o visual: não havia uma linha sobre escalar em lugar nenhum, e o jogador atravessava a escada como
se fosse ar. Agora sobe a 0,2 por tick, desce controlada a 0,15 e **agachar segura no lugar**; o
campo é `climbable` na tabela de blocos, porque a propriedade é de física e não de forma. O
**auto-step** precisou ser desligado na escada: ele levantava o corpo, tentava andar e devolvia a
altura no fim, apagando a subida do tick inteiro.

| Peça | Era | Ficou |
|---|---|---|
| **Vidro** | invisível no mundo e no slot | moldura e reflexo, ainda vazado |
| **Escada de mão** | chapa de 3/16 com textura vazada, e **decoração** | dois montantes e três degraus, e sobe-se por ela |
| **Baú** | cubo inteiro | corpo, tampa e tranca, com folga de 1/16 em volta |
| **Fornalha** | queimava sem dar sinal | dois ids como a lâmpada; acesa tem emissão 13 e boca em brasa |
| **Porta** | só carvalho, e `#planks` genérico dava carvalho com tábua de bétula | bétula e pinheiro, com receita por material |

#### Terceira passada (2026-09-16, fim da tarde)

**O sprite do inventário desenhava sempre um cubo.** Cerca, laje, placa, alçapão, escada e portão
são todos de tábua de carvalho: como cubo, os seis eram **o mesmo desenho**. Relato do jogador:
*"vários itens estão com textura que parece um bloco de madeira normal, mas na realidade colocando
no chão são outros itens"*. A silhueta passou a sair de `boxesFor` — a mesma lista que o mundo
desenha e que a física colide —, então forma nova nasce com sprite certo sem ninguém tocar no
inventário. Planta e trilho saíram da isometria: eles aparecem como o próprio ladrilho, de frente,
que é o desenho que existe deles.

**E havia textura emprestada de verdade.** Abóbora e melancia apontavam `block/oak_planks`: eram
caixotes de madeira com outro nome no tooltip. Muda, samambaia, cana e arbusto seco dividiam a
grama alta; acácia usava carvalho; grama alta, dente-de-leão e papoula eram um **X** recortado nas
diagonais do ladrilho, que é a máscara confundida com a geometria. Todas ganharam desenho próprio,
escrito com o operador `pattern` — pixel a pixel, legível no código.

**Fornalha e baú**, os outros dois relatos. A fornalha era pedregulho 18% mais escuro com uma
moldura fina: virou boca, grelha e ferro rebatido, e a acesa agora tem a boca inteira em brasa. Baú
e bancada eram dois cubos de tábua clara — a diferença era de detalhe fino, que 16 px não carregam.
Agora é de **valor**: baú escuro e ferrado, bancada clara com a grade sulcada. A régua do teste
subiu de 22 para 44 nesse par.

**Pendência:** nada disto foi visto num aparelho. Ver §6. O que restava do marco — placa com texto,
quadro com arte, cama em outras cores e a tampa do baú — foi entregue na passada seguinte.

---

#### Quarta passada — o fechamento (2026-09-17)

Os quatro itens que faltavam no [doc 14](14-roadmap.md) foram entregues, **incluindo o que o
próprio doc dava como impossível sem um formato de vértice novo**.

**Placa com texto escrito pelo jogador.** O item exigiu quatro peças que não existiam:

| Peça | Onde | O que é |
|---|---|---|
| **Fonte** | `data/font.ts` | 5×7 por glifo, escrita em binário para a letra aparecer no código. 76 caracteres: caixa alta, dígitos, 24 sinais e 14 acentuados. **Acento é composição**, não glifo: Á, Â, Ã, À e Ü são a letra base mais uma marca de duas linhas, e Ç é o C com a cedilha — guardar os 14 inteiros seria repetir a letra e deixar o Â divergir do A na primeira correção. |
| **Folha** | `render/fontgen.ts` | RGBA de 128×128, branca com alfa zero no resto. A cor sai do shader: a mesma folha serve texto escuro sobre tábua clara e o contrário. 64 KB, montada uma vez no boot. |
| **Guarda** | `game/signs.ts` | A primeira *tile entity* que não é contêiner. Quatro linhas de 15 caracteres, por posição, e o mesmo ciclo de vida do baú — nasce ao colocar, morre ao quebrar. Placa em branco **não** ocupa registro, senão o save cresceria com placa vazia. |
| **Passe** | `render/signtext.ts` | Um quad por glifo, num buffer dinâmico, como os mobs. Não entra no mesh do chunk porque o texto é **por instância**: duas placas do mesmo bloco no mesmo estado escrevem coisas diferentes, e meshar a section a cada letra digitada seria o caminho errado. Usa `discard` por alfa em vez de mistura, então a profundidade resolve a ordem sozinha. Corta em 32 blocos: além disso a letra não é legível e só custa preenchimento. |

A tela de edição (`ui/screens/signeditor.ts`) usa `<input>` de verdade, e não um teclado desenhado:
no celular o teclado é do sistema — ele sabe acento, corretor e idioma, e nada disso se reimplementa
em canvas. A regra de 2026-09-14 de **nunca deixar o teclado subir sozinho** continua valendo e não
briga com isto: aqui o jogador pediu para escrever. Colocar uma placa já abre o editor, porque
colocar e não poder escrever obrigaria a descobrir que é preciso clicar de novo.

**Quadro com arte.** Eram **um** desenho só — um morro e um sol desenhados por um laço —, então uma
parede de quadros repetia a mesma imagem. Agora são quatro telas escritas pixel a pixel com o
operador `pattern`: paisagem, girassol, caveira e montanha à noite. Qual delas aparece sai da
**posição** do bloco, não de sorteio: um mural nasce variado sozinho, e recolocar o quadro no mesmo
lugar devolve a mesma arte. Os bits 0–1 do estado continuam sendo a parede e os bits 2–3 viraram a
tela, indexados pela tabela `stages` que o pó de redstone e o trilho já usavam.

**Oito cores.** A cama não tinha cor porque **só existia lã branca** — e, pior, o vermelho da cama
estava no desenho, não no dado: as três receitas de textura eram escritas à mão em vermelho.
`data/dyes.ts` passou a ser a tabela, e dela saem quatro famílias:

- **lã** nas oito cores (branco, vermelho, laranja, amarelo, verde, azul, roxo, preto);
- **cama** nas mesmas oito, com pé e cabeceira — e **nenhuma linha de lógica nova**: dormir, quebrar
  as duas metades juntas e mirar a forma certa saem de `shape: 'bed'` e de `multi`, que são dado. É
  a prova de que a máquina de duas células do M8 ficou no lugar certo;
- **corante** como item, com sprite próprio por cor;
- **receitas**: quatro corantes saem de coisa que já existia (osso, papoula, dente-de-leão,
  lápis-lazúli, saco de tinta), o verde sai do cacto na fornalha, e laranja e roxo se **misturam** a
  partir dos outros — é isso que dá economia à paleta em vez de oito receitas soltas.

**Oito e não dezesseis** por orçamento de atlas: cada cor custa quatro camadas (a lã e as três da
cama) e o doc 02 §3 fecha em 256. Dezesseis levariam o total a 265. Oito deixam o atlas em **212**.

**A tampa do baú abre — e não precisou de formato de vértice novo.** O doc 14 dizia que ela "exige
rotação, e a geometria do jogo é de caixas alinhadas aos eixos (doc 04 §3); precisa de um segundo
formato de vértice para existir". **Estava errado, e a prova já estava no repositório:** o mesher
escreve quad de quatro cantos arbitrários (`addPolyQuad`) desde que a tocha de parede ficou torta e
desde que a rampa de trilho existe. O que o formato de vértice guarda é **posição**, não
transformação — a tampa girada é a mesma caixa com os oito cantos rodados na CPU, na hora de meshar.

O ângulo é binário — fechada ou aberta a 95° — e não uma animação, e essa foi a única decisão de
orçamento aqui: cada quadro de animação seria um estado de bloco novo, e estado novo é `setBlock`,
que suja a section, remesha e marca o chunk para salvar. Abrir e fechar custa **um** remesh de uma
section (0,64 ms medidos) cada. O corpo e a tranca continuam saindo de `boxesFor`, que é o que a
física e o contorno leem: abrir o baú não muda onde se esbarra nem onde se mira. Baú duplo abre as
duas tampas.

**O que ficou de fora, e por quê:** um baú deixado aberto quando o jogo é fechado volta aberto no
save — o bit está no bloco. Ele se conserta sozinho no primeiro uso (abrir e fechar), e guardar uma
lista de tampas no save para resolver um caso que o jogador desfaz clicando seria pior que o
sintoma.


#### Quinta passada — a placa, depois de ser usada (2026-09-17, tarde)

Os cinco itens do roteiro de aparelho passaram — *"todos os 5 testes passaram perfeitamente"* — e o
único defeito relatado foi da placa, nos dois lados dela: o que se lê e o que se digita.

**A tábua escondia o texto.** A placa era tábua de carvalho com **três linhas de rabisco** desenhadas
por cima — a "escrita" ilegível que fazia o olho reconhecer uma placa quando não havia texto de
verdade. Agora há, e o rabisco virou justamente o ruído que o cobria. Relato: *"por conta de sua
textura mal dá para visualizar o texto escrito"*.

O erro não era só de tom, era de **agitação**. Medido na área de escrita do ladrilho:

| | Luminância média | Desvio | O que isso faz |
|---|---|---|---|
| Tábua de carvalho (era) | 118 | **25,9** | sulco de tábua cortando a letra na horizontal |
| + rabisco por cima | — | — | pontos escuros do tamanho de um traço de letra |
| Tinta do texto | 24,8 | — | — |
| Tábua da placa (é) | **172** | **4,7** | fundo calmo, sem nada do tamanho da letra |

A placa passou a ter textura própria — a única superfície do jogo desenhada para servir de **fundo
de leitura**: grão de variância baixa, sem `plankLines`, moldura de 1 px e um fio claro por dentro
dela para dar relevo de tábua aplainada sem pôr linha escura na área escrita.

**Quatro campos era um campo a mais que o necessário.** Relato: *"essa divisão por linhas também
ficou horrorosa para digitar na placa, não tem como adicionar um único campo de texto, e o próprio
código interpreta se houve uma quebra de linha"*. Sim: quem escreve pensa em frase, não em linhas.

O editor virou um `<textarea>` e a distribuição virou `wrapSignText`, em `game/signs.ts`, com duas
regras nesta ordem: **a quebra digitada manda** (um `Enter` é uma linha, e linha vazia continua
vazia — é assim que se centra uma palavra na terceira linha), e **o que sobra da largura desce por
palavra**. Palavra maior que a placa é cortada na força, porque não tem para onde descer.

Um detalhe que custou um teste vermelho: a quebra tem de acontecer **antes** da normalização.
`toFontText` troca por espaço tudo que a fonte não desenha, e `\n` é uma dessas coisas — normalizar
primeiro apagava exatamente a quebra que o jogador acabara de digitar.

**E o campo não é reescrito enquanto se digita.** Reescrever o texto para a forma quebrada exigiria
devolver o cursor ao lugar certo a cada tecla, e a quebra por palavra come o espaço do ponto de
quebra: o cursor pularia. Em vez disso, embaixo do campo há uma **prévia** de quatro linhas com a
largura exata da placa, na cor da tábua e da tinta. Quem vê a prévia não precisa adivinhar a regra —
e um aviso aparece quando o que foi digitado não cabe nas quatro linhas.

`Ctrl+Enter` confirma, porque `Enter` sozinho agora é quebra de linha, que é o ponto de ter um campo
só.

---

### Terreno — as montanhas eram pilares verticais ✅ — 2026-09-17

**Relato do usuário:** *"criei um mundo do zero, criativo, e sai voando um pouquinho para ver a
geração de mundo. Do nada, começou a gerar diversas montanhas, porém as montanhas eram literalmente
verticais, vários blocos de altura só que totalmente verticais, não parecia nem um pouco com
montanhas verdadeiras, e sim simplesmente pilares enormes verticais, e vários um do lado do outro."*

**Duas causas, as duas medidas antes de mexer em uma linha.**

**Causa 1: o degrau do bioma entrava inteiro.** A altura de uma coluna depende do bioma
(`heightOffset`, `heightScale` do doc 03 §4.3), e bioma é uma *classificação*: muda de degrau.
Entre montanha (offset 26, escala 2,2) e planície (offset 2), o terreno subia **29 blocos em um
bloco de distância**. E onde a fronteira se esfarela — porque o `detail` de 1/60 faz o `h0` cruzar o
limiar de montanha para frente e para trás — a parede vira uma fileira de pilares soltos, que é
exatamente o que a captura de tela mostra.

**O doc 03 §4.3 já previa o sintoma**, com estas palavras: *"Blend de biomas: amostrar 5×5 pontos ao
redor (a cada 4 blocos) e fazer média ponderada da altura (…). **Sem isso, aparecem paredes retas
entre biomas.**"* O código nunca fez isso. O comentário de `gen/terrain.ts` afirmava que a grade
esparsa de ruído "**é** o blend 5×5 do doc 03 §4.3" — e não era: ela suaviza a **entrada** (os mapas
de ruído) e deixa a **saída** (o `heightOffset`) passar em degrau.

**Causa 2: o teto do mundo.** A altura terminava num `clamp` duro em `WORLD_HEIGHT − 4 = 124`.
**54,3% das colunas de montanha** batiam nele: a cordilheira inteira virava um platô liso na cota
124 — topo chapado, lado vertical. A faixa de altura de montanha inteira era **118..124**, sete
blocos, metade colados no teto.

**A cura.** `world/gen/heightfield.ts`, um módulo novo com uma responsabilidade:

- **média ponderada 5×5 a cada 4 blocos** do `heightOffset` e do `heightScale`, com kernel binomial,
  exatamente como o doc 03 §4.3 manda;
- **teto macio**: uma hipérbole que se aproxima de 124 sem nunca encostar, no lugar do `clamp`. Um
  `clamp` achata todo mundo na mesma cota — é isso que transforma cordilheira em platô;
- **margem de 16 blocos** na janela preparada, porque decoração e estruturas sorteiam posição nos 8
  chunks vizinhos e precisam da mesma altura que o gerador de lá vai usar. Perguntar a outra fonte
  faria a árvore do vizinho nascer flutuando.

**De quebra, dois bugs antigos caíram junto** (§4): `structures.ts` pedia a altura com
`sampleColumn(noise, ox, oz, 0, 0)` — as coordenadas `ox, oz` eram **ignoradas** no caminho de
grade, e a estrutura era assentada na altura do canto `(0,0)` do chunk em geração; e a decoração
usava um caminho de amostragem ~25× mais caro por coluna, que agora sai da mesma janela.

**O resultado, medido na região mais montanhosa da seed 12345 (256×256 blocos):**

| | Antes | Depois |
|---|---|---|
| Maior degrau entre colunas vizinhas | **37 blocos** | **6** |
| Vizinhos com degrau ≥ 6 | 3,10% | **0,040%** |
| Colunas chapadas no teto | 10,3% (54,3% das de montanha) | **0%** |
| Faixa de altura da montanha | 118..124 | **90..117** (o doc 03 pede 90–124) |
| Geração de chunk | 6,2 ms | **6,2 ms** |

O custo ficou dentro do ruído de medição porque a rede lenta de ruído passou a ser amostrada a cada
8 blocos em vez de 4 (os mapas variam entre 1/800 e 1/2000 — 8 blocos é fino demais para o olho) e
porque nó exato de rede não interpola.

**Isto muda o terreno gerado.** Mundo criado antes desta sessão continua com os chunks que já
gravou; os chunks novos nascem com a regra nova, e a fronteira entre os dois fica visível como uma
costura. Não há migração possível — o terreno é função da seed, e a função mudou. **Mundo novo.**

---

### Avaliação completa e M11–M17 ⬜ — 2026-09-22

Leitura do código inteiro contra os docs normativos, sem mexer em código. Três resultados:

1. **Dívida normativa que o documento negava** — 13 itens, com arquivo e linha, na tabela do §5.
   Viraram o **M11**.
2. **Performance de carregamento, não de quadro.** Frustum é o único culling de terreno
   (`render/chunkrenderer.ts:150`); o culling por conectividade de sections do PROMPT.md §4.2 não
   existe; a cópia 18³ da vizinhança custa ~0,26 ms por section na thread principal
   (`world/pipeline.ts:87`); a luz gerada para na borda do chunk (`world/gen/terrain.ts:514`).
   Viraram o **M12**.
3. **O que encarece o próximo conteúdo**: `Session.useHeld` com onze `try*`, três módulos acima
   de 1100 linhas contra o teto de ~400 do CLAUDE.md, e 44 camadas de atlas livres. O vértice tem
   2 bits livres na palavra 0, o que abre um tint de corante e devolve camadas. Viraram o **M13**.

M14 a M17 são conteúdo e alcance novos: água e paisagem, oficina, um fim para a jornada (End e
dragão) e idioma. Nenhum foi iniciado. Portões reconfirmados verdes: 1823 testes, lint limpo,
build, 208,8 KB de 350.

### M11 — O que os documentos já pediam ✅ — 2026-09-22

Os 13 itens da tabela do §5, todos com teste. O que vale registrar além do checklist do doc 14:

**Quatro achados que a avaliação não tinha visto**, todos corrigidos no marco (§4):

1. **Nenhuma planta crescia fora da roça.** A muda nunca virava árvore — a única receita de árvore
   do jogo escrevia direto no chunk durante a geração —, cana e cacto ficavam do tamanho em que
   nasceram, a grama não voltava a um caminho pisado e uma flor boiava sobre o buraco onde antes
   havia terra. Somado, **madeira não era renovável**. A forma das árvores saiu para
   `world/trees.ts`, com um escritor por caminho (chunk na geração, `world.setBlock` no
   crescimento), e o código foi movido **sem mudar um sorteio**: o terreno gerado continua o
   mesmo. A grama se espalha por **registro de eventos**, não por varredura: só entra no registro
   a terra que o jogador expôs perto de grama.
2. **Nenhum bloco queimava.** O item de bloco é derivado da tabela de blocos, que não tinha coluna
   de combustível; tábua, tronco e muda — os primeiros combustíveis que o jogador tem — não
   entravam na fornalha.
3. **A água apagava a lava.** Os dois fluidos são `replaceable`, e a água, que atualiza a cada
   5 ticks contra 30 da lava, sobrescrevia a lava por onde passava — sem obsidiana, sem
   pedregulho. `world/fluids.ts` não tinha teste nenhum.
4. **O jogador nascia no mar.** Achado pelo smoke test no primeiro mundo que ele criou: o
   nascimento era sempre a coluna (0, 0). O worker agora procura terra firme em anéis de 16 blocos
   até 512 (`world/gen/spawnsearch.ts`); o resultado fica no meta do mundo (`spawnFound`), e o
   renascimento usa o mesmo ponto. Mundo antigo não muda.

**Desvios conscientes, escritos no comentário do módulo:**

- **biscoito** leva açúcar no lugar do cacau (não há selva nem cacau; `data/recipes.ts`);
- **leite** se bebe no clique, sem os 1,6 s do gênero (`game/itemuse.ts`);
- **folha de acácia** é um id novo com o desenho da de carvalho: as duas são cinza tingido pelo
  bioma, e o id só existe para dar a muda certa — zero camada de atlas;
- **cabana de bruxa** sem bruxa (a bruxa é do M14).

**O que o M11 adiantou do M13:** o registro de uso de item (`game/itemuse.ts`) nasceu aqui, porque
balde, tesoura, ovo, leite e corante precisavam dele. Os onze `try*` antigos da `Session` ainda não
migraram.

**O que ninguém viu ainda, em ordem de quanto pode estar errado** (§6, item 0).

### M13 — Casa em ordem ✅ — 2026-09-22

Refatoração sem mudança de jogo, exceto as cores. O que vale registrar:

- **A `Session` virou orquestradora.** Veículos, contêineres, a tela aberta, combate, clique em
  bloco, geradores de dungeon, os sistemas do mundo e a costura de eventos saíram para módulos
  próprios (lista no doc 14). A API pública foi mantida onde era usada; quem falava com
  delegadores de uma linha passou a falar com o subobjeto (`session.workbench.closeScreen()`,
  `session.vehicles.boats`).
- **Uso de item é tabela.** `ItemDef.uses` sai dos campos (`food` come, `charge` segura,
  `placesBoat`…) e do `use` declarado. O uso de segurar (comer, arco, escudo) tem `hold` e
  `release`; o de clique, uma espera de 4 ticks. **Correção achada no caminho:** as ações mirando
  pelo centro da câmera ignoravam o Modo A de toque; agora usam a mira da `Interaction` (o dedo).
- **`main.ts` sem closure por quadro.** O `SceneFeed` e o laço criam os callbacks uma vez — o
  `main.ts` criava oito por quadro, contra a regra de zero alocação no caminho quente.
- **Formato de vértice:** `texLayer` 8 bits, tint 6 bits (4 na palavra 1, 2 no topo da palavra 0).
  O teto de 256 camadas do doc 02 §3 continua, agora como limite do formato.
- **16 cores**: cinza-claro, cinza, marrom, rosa, verde-limão, ciano, azul-claro e magenta, por
  mistura de corante (o marrom é vermelho + verde: não há cacau). Os ids de item das cores novas
  entraram no fim da fila; os de bloco, depois dos 200–220 das antigas.

### M12 — O mundo chega antes do jogador ✅ — 2026-09-23

Pedido: *"Pode seguir com o M12"*. Os cinco itens do doc 14, com o que cada um virou:

- **Culling por conectividade** (`render/sectioncull.ts`, `world/mesh/visibility.ts`). O worker
  calcula, junto da malha, quais pares de faces da section se enxergam por ar (15 bits, flood fill
  de 4096 voxels). No render, uma busca em largura parte da section da câmera, só anda para longe
  dela e só atravessa por faces ligadas. **Dois desvios conscientes**, escritos no módulo: a busca
  **não poda pelo frustum** — ela é refeita só quando a câmera troca de section ou algo muda perto,
  e o frustum corta por quadro o que ela alcançou (a versão que podava custava 0,4–0,8 ms todo
  quadro no desktop); e cada section é visitada **uma vez** — a reentrada por outra face custava o
  dobro e alcançava menos de 1% a mais, sem nenhum caso em que a entrada única escondesse um bloco
  visível. Malha nova longe da câmera espera 15 quadros e sai numa busca só; perto, na hora.
  **Critério de aceite:** numa caverna a Y≈21 com RD 8, **29%** das sections com malha dentro do
  frustum vão para a lista (pede ≤ 50%). **Prova de correção:** 16 câmeras (caverna reta e para
  cima, chão, alto) disparam 500 raios cada; todo bloco atingido tem que estar numa section da
  lista, e o teste falha com qualquer uma de três mutações que proíbem uma direção.
- **Culling por direção de face** (`MeshData.faceStarts`, `GpuMesh.drawFaces`, `facingFaces`). O
  mesher já emitia face por face; agora anota onde cada uma começa, e o render desenha só as faixas
  viradas para a câmera (as vizinhas acesas saem numa chamada). Vale para o opaco e o recortado; a
  geometria livre (planta, tocha, laje) fica numa faixa final, sempre desenhada. O translúcido fica
  de fora de propósito.
- **Cópia da vizinhança fora da thread principal** — com desvio. O doc 14 pedia um **espelho das
  colunas dentro do worker**; ficou de fora porque com N workers seriam N cópias do mundo (RD 16 no
  T2 dá ~50 MB por worker) e o `SharedArrayBuffer` não existe no GitHub Pages. O que foi feito: o
  pedido de malha leva as **sections cruas** das 3×3 colunas, e o `postMessage` as copia (cópia
  nativa); quem monta a vizinhança 18³ é o worker (`workers/meshjob.ts`). E o pedido passou a ser
  **um por coluna**, com as sections numa máscara: uma vaga em voo em vez de até oito. Medido:
  0,32 ms por coluna na thread principal contra 8 × 0,26 ms antes; mundo de RD 16 pronto em 51
  pumps sem relógio (eram 165) e em 183–196 com o orçamento real de 60 FPS (eram 415–437).
  **O critério "colunas em 40 ciclos ≥ 1,5 × 86" não foi batido: deu 101 (1,17×).** Não é falta
  de ganho, é o que o teste mede: sem relógio e com 4 vagas meio a meio, a geração leva duas vagas
  por ciclo em qualquer versão. O ganho do item está no custo de cada despacho, que só aparece com
  relógio — e com relógio foi de 2,2×.
- **Luz que atravessa a borda do chunk** (`Lighting.stitchColumn`). Na chegada da coluna, cada par
  de voxels que se toca através das quatro bordas é comparado, e a diferença propaga pelo BFS de
  sempre, nos dois sentidos. Só vai para re-meshar a section de coluna já meshada. **O smoke test
  achou um travamento no caminho** — ver §4, BFS de luz.
- **Rever o preset de T0 — não feito.** Precisa de um T0 na mão, e o J7 Metal não está mais com o
  usuário (§5). O RD 4 continua. Os números acima são de desktop; a leitura em aparelho é a
  pendência do marco (§6).

Achados no caminho, fora do escopo mas corrigidos porque o M12 os expôs (§4): o crédito de pedido
em voo voltava para o worker errado, e o BFS de luz explodia na borda do mundo carregado.

### M9 — Gente no mundo ✅ — 2026-09-23

Pedido: *"Pode implementar o M9"*. O que cada item virou, e as leituras que o doc deixava abertas:

- **Aldeão com ofício** (`data/villagers.ts`): fazendeiro, açougueiro, ferreiro e bibliotecário,
  cada um com quatro ofertas por esmeralda e limite de usos por dia (reabastece ao virar o dia). O
  ofício é a `variant` do mob e escolhe a pele (`traits.variantSkins`, uma camada de atlas de
  entidade por ofício). Os postos são blocos que o jogo já tinha — bancada, fornalha, estante; o
  fazendeiro trabalha na horta. A bigorna e o defumador do M15 podem trocá-los numa linha.
- **Rotina** (`entity/ai/villagegoals.ts`): de manhã vai ao posto, de tarde junta-se perto do
  poço, às 11500 do dia (meio tick-dia antes do pôr do sol) volta para casa, **atravessa a porta de
  verdade** (frente → abre → passa → fecha) e deita na cama; o render o desenha deitado. Foge de
  monstro a menos de 8 blocos. Viagens longas pedem ao A* uma meta a 20 blocos (ele recusa destino
  a mais de 32); quem passa 5 s sem chegar mais perto dá uns passos para um lado e tenta de novo.
  **Medido:** todos no poço meia hora antes do pôr do sol, dois minutos de jogo depois **47 de 47
  aldeões deitados na própria cama, com a porta fechada, em 11 aldeias** de seeds diferentes.
- **Aldeia de verdade** (`world/gen/village.ts`, `data/structures.ts`): cada casa ganhou uma
  frente pelo ofício — terreiro com o posto, ou a **horta cercada** do fazendeiro (trigo, cenoura,
  batata, água tampada por laje) — e um degrau largo na borda, para a frente não virar plataforma
  numa encosta. **Caminhos de terra batida** (bloco novo) saem de cada casa até um anel em volta do
  poço. O **sino** (bloco novo, com forma própria) fica pendurado no telhado do poço; tocá-lo manda
  quem mora por perto para casa por 30 s. As aldeias continuam onde estavam nos mundos criados:
  os sais do sorteio de poço e casa não mudaram.
- **Moradores nascem com o chunk da casa, não com a geração** (`game/village.ts`). Mob não vai
  para o save (desvio antigo, doc 11 §2 — ver `game/savegame.ts`); os marcos de geração se perdiam
  no chunk que o jogador modificava. Agora, quando qualquer chunk entra no mundo, o plano da seed
  diz se há casa com morador e a cama é procurada na coluna. O chunk da casa saindo leva o morador;
  voltando, traz. **3 a 8 aldeões por aldeia** (doc 03 §7) são sorteados e vão para as casas de
  menor sorteio; casa sorteada que não nasceu (bioma, relevo) deixa a aldeia com um a menos.
- **Golem de ferro**: um por aldeia, nasce junto do poço. Caça o hostil a menos de 16 blocos e
  mata o zumbi (teste). Não caça o jogador, a menos que ele bata num aldeão da aldeia ou nele.
  **Não há** construção de golem com blocos nem golem novo com o tempo — não estava no doc 14.
- **Reputação**: bater num aldeão fecha as trocas **da aldeia inteira** por um dia de jogo e vira os
  golems dela. O prazo vai para a meta do mundo (`villageBans`) — recarregar não limpa a má fama.
- **Troca — leitura do critério.** O doc 14 pede *"trocar dois itens sem abrir nenhum menu que não
  exista hoje"*. Lido como: a troca é uma tela **do sistema de contêineres que já existe** — mesmo
  painel, mesmos slots do inventário, mesmo toque, controle e botão Fechar —, com a lista de ofertas
  no lugar da grade, no padrão das três ofertas da mesa de encantamento (`ui/containers/tradepanel.ts`).
  Não há slot de troca: o pagamento sai do inventário e o item entra nele. Clique direito no
  aldeão abre, com ou sem item na mão; afastar-se mais de 8 blocos fecha. Vista no Chrome:
  "Aldeão — Fazendeiro", quatro ofertas com o desenho dos itens.
- **Sons**: sino (parciais fora da série harmônica), bigorna curta do ferreiro no posto, porta pelo
  som de porta de sempre, voz do golem.

**Orçamento:** 20 aldeões voltando para casa (a rotina que mais pede caminho e porta) em **0,08 ms
por tick** — o aceite pede menos de 1 ms.

Achados no caminho, corrigidos (§4): a tabela de mobs trocava três criaturas entre si, nenhum mob
subia um degrau de um bloco, e mob em coluna não carregada caía no vazio. E o A* passou a tratar
porta como passagem (o zumbi para diante dela, onde o Difícil a arromba).

## 4. Correções fora de marco

Bugs anteriores encontrados durante o M5 e já corrigidos — ficam registrados porque explicam
mudanças em código de marcos "fechados":

| Data | Onde | O que era |
|---|---|---|
| 2026-09-23 | `entity/mobs.ts`, `entity/spawn.ts`, `game/village.ts` | **O pool de mobs enchia e a aldeia não tinha onde nascer** (M9; campo, seed `2` em T2 com RD 16: aldeia inteira, nenhum aldeão, nenhum golem, e o F3 mostrando *"140 mobs"* — o pool é `2 × maxMobs` = 140). Três causas somadas: `populateChunk` dá um grupo de bichos a 10% dos chunks novos **sem teto** (em RD 16 são ~860 colunas); a correção do M9 que deixa o mob de coluna descarregada parado fez os bichos deixados para trás **nunca saírem do pool** (antes eles caíam no vazio, o que liberava a vaga por acidente); e o aldeão, ao nascer com o chunk da casa, desistia em silêncio com o pool cheio. Agora o chunk que sai leva os mobs comuns dele (`Mobs.forgetChunk`; domado, nomeado e morador ficam — mob não vai para o save, então é o mesmo que recarregar), os grupos de chunk novo param em metade do pool, e aldeão e golem tomam a vaga do mob comum mais longe (`Mobs.makeRoom`). Três regressões (`village.test.ts`, `spawn.test.ts`), que falham no código anterior. |
| 2026-09-23 | `world/gen/village.ts` | **Aldeia pela metade: um aldeão só, sem golem** (M9; relato de campo: *"tinha somente 1 aldeão, travado na casa dele (…) não tinha iron golem"*). Cada peça da aldeia conferia o bioma do **próprio** ponto: na divisa da planície nasciam duas ou três casas soltas, sem poço — sem golem e sem sino —, e os moradores eram sorteados entre as casas **do plano**, que não tinham nascido. Em 24 seeds, 4 das 11 aldeias estavam assim, com 1 morador. A seed `2`, usada nos testes do M9, é toda planície. Agora a aldeia existe ou não pelo bioma do poço (que não depende da janela do chunk), e de pé ela constrói todas as casas, menos sobre a água. E o poço na beira da região de 32 chunks contava casas da aldeia vizinha na fila de moradores (`occupantRank`). Regressão em `tests/village.test.ts` ("plano da aldeia em várias seeds"). **Mundos já criados:** chunk gerado antes continua como estava; a aldeia certa aparece em terreno novo. |
| 2026-09-23 | `entity/ai/villagegoals.ts` | **O aldeão passava a manhã plantado na soleira da porta** (M9). "Chegou ao posto" valia a 2,6 blocos dele, que é a porta de casa, e ele ficava ali de 1000 a 9000 — visto de fora, travado. Agora ele chega ao posto (1,6) e trabalha em turnos de 40 s a cada minuto, defasados por aldeão; entre um e outro vai para perto do poço. Regressão: cada aldeão anda mais de 20 blocos numa manhã de 2 min (antes, 7,8). |
| 2026-09-23 | `data/mobs.ts` | **Morcego, porco zumbi e ghast trocavam de corpo e de IA** (desde 2026-09-14). `mobDef(id)` lê `MOBS[id]`, e a lista estava na ordem de declaração: o morcego (id 15) entrou antes do porco zumbi (13) e do ghast (14). O morcego das cavernas era um ghast, o porco zumbi do Nether um morcego, e o ghast um porco zumbi. A lista passou a ser ordenada pelo id, e buraco na numeração vira erro no boot. Regressão em `tests/mobs.test.ts`. |
| 2026-09-23 | `entity/mobstore.ts` | **Nenhum mob subia um degrau de bloco inteiro** (M5). O pulo é decidido depois de mover, e o tick seguinte aplica gravidade antes de mover: o pico ficava em 0,83 bloco. Todo caminho do A* que subia um bloco deixava o bicho pulando no pé da parede — parte, talvez, do "os monstros não me seguem" de 2026-09-12. O impulso passou a descontar o que o próximo tick tira. Achado com o aldeão voltando para casa. |
| 2026-09-23 | `entity/mobs.ts` | **Mob em coluna não carregada caía no vazio.** O mundo fora do anel responde ar; todo bicho que ficava para trás despencava e morria de "void". Agora fica parado até a coluna voltar. |
| 2026-09-23 | `entity/ai/pathfinder.ts` | **Porta era parede para o A*.** Porta passou a contar como passagem, aberta ou fechada: o aldeão abre a de casa, e o zumbi para diante dela. |
| 2026-09-23 | `world/lighting.ts` | **O BFS de luz explodia na borda do mundo carregado** (M2). Coluna não carregada responde "luz de bloco 0" e ignora a escrita, então todo voxel lá fora parecia sempre mais escuro e voltava para a fila com seus 6 vizinhos — até 6¹⁴ caminhos. Uma tocha ou lava rente à borda já travava a aba; a costura de luz do M12, que roda justamente na fronteira, passou a acioná-lo em toda coluna nova, e o smoke test pegou (a página congelava ao criar o mundo). Vizinho em coluna não carregada agora é pulado nos dois BFS. Regressão em `tests/lightstitch.test.ts`. |
| 2026-09-23 | `world/pipeline.ts` | **O crédito de pedido em voo voltava para o worker errado** (M1). Sem saber de quem era a resposta, o pipeline descontava do worker mais ocupado: a soma batia, mas o balanceamento derivava. Com os pedidos de coluna do M12, um worker de três ficava sem receber nada. Cada worker agora tem o próprio `onmessage` com o índice. |
| 2026-09-23 | `tests/pipeline.test.ts` | **O duplo de worker trabalhava dentro do `postMessage`** e cobrava a geração no orçamento de despacho da thread principal. Dois testes passavam por isso e não pelo que diziam medir: "respeita o limite de requisições em voo" afirmava um teto de 2 × 2 que é 16 × 2 desde 2026-09-13. O duplo passou a trabalhar no `flush`, como o navegador. |
| 2026-09-23 | `render/mesh.ts`, `world/mesh/complex.ts`, `render/hand.ts` | **Todo desenho em face de pé saía de ponta-cabeça** (M1). O ladrilho é desenhado com a linha 0 em cima e o WebGL entrega a linha 0 em `v = 0`, mas os quads de pé punham `v = 0` na **base**. Em pedra, terra e tronco não aparece; em flor, muda, grama alta e plantação aparece de cara — e também estavam invertidas a brasa da tocha, a boca da fornalha, o tampo da bancada, a tampa do baú, a maçaneta da porta e o glacê do bolo. No inventário tudo estava certo, porque o sprite lê o ladrilho como o canvas. Relato: *"ao colocar no chão fica invertido"*. Faces de pé (±X, ±Z, a cruz de planta e o item na mão) passaram a descer o `v`; **faces de cima e de baixo não mudaram** — trilho, cama e repetidor foram acertados contra o `v` antigo. Regressão em `tests/texorientation.test.ts`. |
| 2026-09-22 | `game/itemuse.ts` | **Balde, ovo e arco miravam o centro da câmera** mesmo no Modo A de toque, em que a mira é o dedo. Achado ao migrar os usos de item (M13): passaram a usar a mira da `Interaction`. |
| 2026-09-22 | `world/growth.ts`, `world/gen/decorate.ts` → `world/trees.ts` | **Nenhuma planta crescia fora da roça** (M5/M6). A muda era decoração: a única receita de árvore do jogo escrevia direto no chunk durante a geração. Cana e cacto não subiam, a grama não se espalhava, e três das quatro folhas davam muda de carvalho. Madeira não era renovável. |
| 2026-09-22 | `data/blocks.ts`, `world/redstone.ts`, `game/interaction.ts` | **Flor, muda e grama alta boiavam sem chão** (doc 03 §9, "Suporte"). Só redstone e tocha declaravam apoio. Planta ganhou `support: 'below'`, e cana e cacto o campo `stackable`, para a coluna se segurar em si mesma. |
| 2026-09-22 | `data/blocks.ts`, `data/items.ts` | **Nenhum bloco queimava na fornalha** (doc 05 §5). Tábua, tronco e muda não tinham `fuel`: a tabela de blocos não tinha a coluna. |
| 2026-09-22 | `world/fluids.ts` | **A água apagava a lava**, e lava corrente com água dava pedra em vez de pedregulho (doc 03 §9). Os dois fluidos são substituíveis e a água, seis vezes mais rápida, passava por cima. |
| 2026-09-22 | `data/blocks.ts` → `world/falling.ts` | **A flag `gravity` nunca foi lida** (M1). Areia e cascalho ficavam de pé sem base. |
| 2026-09-22 | `game/spawnplacement.ts`, `main.ts` | **O jogador nascia no mar** em metade das seeds: o nascimento era sempre a coluna (0, 0). Achado pelo smoke test. |
| 2026-09-17 | `data/textures.ts` | **A textura da placa escondia o texto da placa.** Ela era tábua de carvalho com três linhas de rabisco desenhadas por cima — a "escrita" ilegível que fazia o olho reconhecer uma placa **quando não havia texto de verdade**. Quando passou a haver, o rabisco virou o ruído que o cobria, e o sulco da tábua cortava a letra na horizontal. Não era só tom: a área de escrita tinha desvio de luminância de 25,9 contra uma tinta de 24,8, ou seja, o fundo variava mais que o contraste da letra. Virou textura própria, de média 172 e desvio 4,7 — a única superfície do jogo desenhada para servir de fundo de leitura. Relato: *"por conta de sua textura mal dá para visualizar o texto escrito"*. |
| 2026-09-17 | `world/gen/heightfield.ts` (era `gen/terrain.ts`) | **O `heightOffset` do bioma entrava em degrau.** Entre montanha (offset 26) e planície (offset 2) o terreno subia **29 blocos em um bloco** de distância, e onde a fronteira se esfarela a parede virava fileira de pilares. O doc 03 §4.3 pede média ponderada 5×5 a cada 4 blocos e diz, com estas palavras, que *"sem isso, aparecem paredes retas entre biomas"* — o código nunca fez isso, e o comentário de `terrain.ts` **afirmava que fazia**: chamava a grade esparsa de ruído de "o blend 5×5 do doc 03 §4.3". Ela suaviza a entrada, não a saída. Relato do usuário: *"as montanhas eram literalmente verticais (…) simplesmente pilares enormes verticais, e vários um do lado do outro"*. |
| 2026-09-17 | `world/gen/heightfield.ts` | **O teto do mundo achatava as montanhas.** A altura terminava num `clamp` duro em 124 e **54,3% das colunas de montanha** batiam nele: a cordilheira virava um platô liso, com topo chapado e lado vertical, e a faixa de altura de montanha inteira era 118..124. Virou teto macio — uma hipérbole que se aproxima de 124 sem encostar —, e a faixa passou a 90..117, que é o que o doc 03 §4.3 pede. |
| 2026-09-17 | `world/gen/structures.ts` | **A estrutura era assentada na altura do canto do chunk.** `pickY` pedia `sampleColumn(noise, ox, oz, 0, 0)`, e no caminho de grade os argumentos `ox, oz` eram **ignorados**: a altura devolvida era sempre a do canto `(0,0)` do chunk que estava sendo gerado, não a do lugar da estrutura. Casa de aldeia perto da borda nascia enterrada ou boiando. Agora a altura vem do mesmo campo com margem que o gerador usa. |
| 2026-09-16 | `render/itemsprites.ts` | **O sprite do inventário ignorava a forma do bloco.** Ele desenhava sempre um cubo isométrico com a textura do bloco, e cerca, laje, placa, alçapão, escada e portão são todos de tábua: os seis eram **o mesmo desenho** no slot. A silhueta passou a sair de `boxesFor`, a mesma lista do mundo e da física; planta e trilho saíram da isometria e aparecem como o ladrilho de frente. Relato de campo: *"vários itens estão com textura que parece um bloco de madeira normal, mas na realidade colocando no chão são outros itens"*. |
| 2026-09-16 | `data/blocks.ts`, `data/textures.ts` | **Abóbora e melancia eram `block/oak_planks`.** Literalmente: a tabela apontava a tábua de carvalho, então uma abóbora no campo era um caixote de madeira com outro nome. Na mesma varredura: muda, samambaia, cana e arbusto seco dividiam `block/tall_grass`, acácia usava tronco e tábua de carvalho, e grama alta, dente-de-leão e papoula eram um **X** — `alphaMask('cross')` recorta as diagonais do ladrilho, o que é a máscara confundida com a geometria dos dois quads cruzados. |
| 2026-09-16 | `data/textures.ts` | **A fornalha parecia pedra e o baú parecia a bancada.** A fornalha era pedregulho 18% mais escuro com moldura fina; ganhou boca, grelha e ferro rebatido. Baú e bancada passavam na régua de legibilidade de 22 e mesmo assim se confundiam no slot, porque a diferença era de **detalhe** e 16 px não carregam detalhe: virou diferença de **valor**, e a régua daquele par subiu para 44. |
| 2026-09-16 | `data/textures.ts` | **O vidro era invisível.** A receita pintava o ladrilho inteiro com `alpha: 0.28`, e o vidro é desenhado no passe recortado, cujo shader faz `discard` abaixo de 0,5: **zero pixels** passavam. Uma janela colocada não deixava rastro na tela e o slot do inventário parecia vazio — o jogador não tinha como saber que havia vidro ali. Virou moldura opaca com reflexo em diagonal e miolo vazado. O teste que entrou cobre a classe do bug, não o caso: todo bloco dos passes opaco e recortado precisa de pixel acima do corte. |
| 2026-09-16 | `entity/player.ts`, `data/blocks.ts` | **A escada de mão não escalava.** Ela existia desde o M6 e não havia uma linha de código sobre escalar: o jogador atravessava como se fosse ar. Não era desvio consciente, era buraco. Entrou `climbable` na tabela — campo de física, não de forma — com subida a 0,2/tick, descida controlada a 0,15 e agachar segurando no lugar. |
| 2026-09-16 | `entity/player.ts` | **O auto-step apagava a subida da escada.** Ele existe para vencer um degrau quando o horizontal trava, e na escada o horizontal trava sempre: levantava o corpo, tentava andar e **devolvia a altura** no fim. Empurrar para a frente na escada não saía do lugar. Na escada quem sobe é a escada. |
| 2026-09-16 | `data/recipes.ts` | **Seis tábuas de bétula davam uma porta de carvalho.** A receita de porta era `#planks` genérica, herdada de quando só existia uma porta. Virou receita por material, junto com escada, laje e cerca. |
| 2026-09-16 | `render/vertex.ts`, `render/mesh.ts`, `render/shaders/terrain.glsl.ts` | **Toda caixa mais fina que meio bloco colapsava.** A posição do vértice era guardada em meios-blocos (6 bits por eixo), então `Math.round(x * 2)` achatava tudo: poste de cerca (2/16) e grade (1/16) **desapareciam** — uma cerca isolada não tinha geometria nenhuma —, porta, alçapão, placa e quadro (3/16) viravam planos de espessura zero, botão, alavanca e repetidor idem, e o levantamento de 1/16 do trilho virava zero, deixando ele brigando com o chão no Z. Era um bug do M1 que ninguém tinha nomeado, porque de longe um plano com a textura certa parece a peça. A precisão foi para **1/16 de bloco** sem sair dos 8 bytes por vértice. Relato do usuário que levou até ele: *"as texturas chapadas das ferramentas"*. |
| 2026-09-16 | `world/mesh/complex.ts` | **Toda face de toda caixa usava a textura de lado.** O topo de uma laje, de uma escada ou da cama saía com o desenho da lateral. Não aparecia porque os materiais de laje e escada do jogo têm as seis faces iguais — apareceria na primeira laje de grama. |
| 2026-09-16 | `world/redstone.ts` | **Bloco que exige apoio e não é de redstone nunca era conferido.** A fila só aceitava quem tinha papel no circuito, então `dropUnsupported` — que existe desde o M7 e está certo — nunca era chamada para **trilho comum**: minerar o bloco de baixo deixava o trilho flutuando. A tocha entrou no mesmo caso ao ganhar encaixe, e a correção vale para as duas. |
| 2026-09-16 | `world/redstone.ts`, `game/session.ts` | **Porta de duas folhas e uma alavanca só alcança uma delas.** Com a porta ocupando duas células, energizar a de baixo abria só a de baixo — metade da porta continuava barrando a passagem. A folha tocada passou a arrastar a outra, tanto no circuito quanto no clique. |
| 2026-09-16 | `data/structures.ts` | **A casa de aldeia nascia com a tocha boiando no meio da sala** e a cama de costas para a parede. Com a tocha virando poste com encaixe, o defeito ficou visível: ela foi para a parede norte, a cama deitou para dentro do cômodo com pé e cabeceira, e a porta passou a nascer com as duas metades. |
| 2026-09-14 | `input/controls.ts`, `main.ts` | **A rotação da câmera acontecia a 20 Hz.** A posição do jogador é interpolada no render, mas a rotação não — `camera.yaw` recebe `player.yaw` direto —, e `player.yaw` só mudava no tick. Num display de 60 Hz o mesmo ângulo aparecia em três quadros seguidos e então pulava: o jogo rodava liso e a câmera andava *"de quadro em quadro, como se fosse movimentação por teclado"*. A leitura da câmera saiu do tick e passou a ser por quadro desenhado; interpolar a rotação teria adicionado um tick de atraso sem tirar o degrau, porque o passo continuaria sendo de 50 ms. Mouse e dedo entregam pixels e não escalam com o tempo; analógico entrega velocidade e escala, com o passo limitado a 100 ms para um engasgo não virar um giro. |
| 2026-09-14 | `input/touch.ts` | **No Modo A, olhar em volta mostrava o anel de "vai quebrar" o tempo todo.** A reancoragem entregue horas antes — sair da folga reiniciava a contagem em vez de cancelá-la — fazia qualquer pausa no meio de um arrasto rearmar a quebra. Ela tinha sido a resposta para o toque longo que quase nunca disparava; na mão, o problema virou o oposto. Agora o dedo que passa de `TAP_SLOP` vira câmera e não volta a ser candidato a quebrar até ser levantado. Relato de campo: *"ele constantemente aparece a bolinha achando que eu vou começar a quebrar algo"*. |
| 2026-09-14 | `input/uinav.ts` | **O foco do gamepad era invisível.** Toda a interface estiliza foco com `:focus-visible`, que o navegador acende a partir da **modalidade do último input** — e gamepad não é uma modalidade que ele conheça. Um `focus()` disparado de um laço de `requestAnimationFrame` depois de um toque na tela não acende anel nenhum: a navegação movia o foco corretamente e não mostrava nada. Relato de campo: *"parece que muitas vezes indo para botões nem existentes em tela"*. O documento passou a ganhar a classe `pad-nav` enquanto a navegação está em uso, com anel próprio; o primeiro toque ou tecla devolve a decisão ao navegador. |
| 2026-09-14 | `input/uinav.ts` | **A navegação por controle roubava o foco de quem joga no dedo.** Ela rodava a cada tick com qualquer tela aberta e, sem nada focado dentro dela, focava o primeiro item — inclusive para quem nunca ligou um controle. No inventário criativo o primeiro focável é o campo de busca, então no celular **pegar um item subia o teclado virtual** por cima da tela (*"em qualquer item que pego ele simplesmente seleciona a pesquisa novamente sozinho"*). Agora ela só age quando o controle é empurrado, o primeiro aperto revela o foco sem andar nem ativar, e o foco de partida evita campo de texto. |
| 2026-09-14 | `input/uinav.ts` | **Botão escondido por CSS entrava na travessia.** O filtro olhava só o atributo `hidden`, e um painel fechado por classe deixa os botões dele no documento com caixa de layout zerada. Agora quem não tem caixa fica de fora — e, se ninguém tem, a lista vai inteira, porque aí não há layout para consultar (é o caso do ambiente de teste). |
| 2026-09-14 | `input/uinav.ts` | **A contagem de repetição do direcional guardava número velho.** As leituras estavam dentro de um `else if`, então a direção não lida em um tick não tinha o contador atualizado: o primeiro aperto dela, depois de soltar outra, repetia na hora ou não valia. As sete leituras passaram a sair antes de qualquer ação. |
| 2026-09-14 | `ui/hud.ts` | **A barra de fome era um retângulo, não comida.** O doc 08 §3.4 pede *"10 coxas"* desde sempre; o código desenhava `▮`/`▯`, que na tela do celular lê como um risco (*"são simplesmente um risco feio"*). Virou uma coxa de 9×9 definida como grade no código e convertida em SVG de retângulos para servir de máscara CSS — a cor continua vindo de `var(--hud-hunger)`, então a paleta para daltônicos segue valendo. |
| 2026-09-14 | `input/gamepad.ts` | **Um aperto no `Start` abria e fechava o menu várias vezes.** `togglePause` solta todo o input (é o mesmo `reset` do `blur`), e `reset` **limpava** o estado anterior das bordas de subida. No tick seguinte o `Start` continuava apertado e não havia mais nada guardado dizendo isso — o jogo lia uma borda nova e pausava de novo, a 20 Hz, enquanto o dedo estivesse no botão. Agora `reset` **silencia até soltar**: marca tudo como já apertado, e o primeiro polling em que o botão aparece solto devolve o aperto seguinte. A exceção é o instante em que o controle é reconhecido — a Gamepad API só revela o aparelho depois do primeiro aperto, e engolir esse pediria dois. Relato de campo: *"pressionando uma vez ele considera que apertei duas ou até três vezes"*. |
| 2026-09-14 | `input/uinav.ts` | **Confirmar num slot de inventário com o controle não fazia nada.** A navegação chamava `click()` em tudo, e os slots **não são `<button>`**: são `div[role="button"]` que agem no `keydown` de Enter e no `pointerdown` (doc 08 §3.5). O `click` disparava um evento que ninguém escuta. Passou despercebido porque a navegação por gamepad foi entregue no mesmo dia em que os slots ganharam o tratamento de toque, e os testes de navegação usavam só `<button>` de verdade. Agora a ativação fala a língua de cada elemento — e é o mesmo caminho que faz o clique direito do controle funcionar. |
| 2026-09-14 | `world/raycast.ts`, `game/interaction.ts` | **Nenhuma planta podia ser quebrada — o raio atravessava todas.** A condição de acerto excluía tudo que é `replaceable`, e `plant()` marca exatamente isso: as 18 de dureza zero (grama alta, samambaia, flores, mudas, cana, arbusto, trepadeira), mais neve fina e fogo. O raio passava direto e acertava o chão atrás. O código de colocação já esperava o contrário — ele tem um ramo *"bloco substituível recebe no próprio lugar"* que **nunca era alcançado**. A regra não podia simplesmente cair, porque os outros dois usuários do raio são linha de visão de mob e de explosão, e uma flor não pode esconder o jogador de um creeper: virou opção (`RayOptions.replaceable`), ligada só na interação. Relato de campo: *"as plantas que encontro na grama, nenhuma delas consigo quebrar"*. |
| 2026-09-14 | `game/interaction.ts` | **Um clique derrubava três blocos.** No criativo a quebra acontecia **uma vez por tick**: 50 ms por bloco, e um clique normal de 150 ms fazia uma fila de três. O sobrevivência tinha o mesmo caso para tudo que quebra em um tick — medido: **478 combinações bloco+ferramenta**, das quais 18 só com a mão. Entrou um intervalo de 5 ticks entre quebras dentro do **mesmo apertar**; soltar o botão o zera, então um clique é um bloco e quem clica rápido continua mandando no ritmo. Ele **não atrasa mineração normal**: só gate a conclusão, o progresso corre durante ele, e bloco comum termina muito depois dos 5 ticks. Relato de campo: *"é quase impossível quebrar só um bloco"*. |
| 2026-09-14 | `input/touch.ts` | **No Modo A, colocar bloco mirava no centro da tela e quebrar mirava no dedo.** `onUp` definia a mira do toque curto, mas `update()` roda no **começo** de `Controls.update`, antes de alguém ler `state.hasAim` — e apagava a mira que o toque acabara de definir. O `placeRequested` sobrevivia sozinho, então o bloco ia para o crosshair. Os dois gestos do mesmo modo tinham alvos diferentes, o que de dentro do jogo é indistinguível de "funcionalidade bugada" (relato de campo: *"fiquei muito confuso se... ele irá fazer a ação onde estou clicando ou se sempre respeita o ponteiro branco de mira"*). O teste existente passava porque lia a mira **sem** chamar `update()` — ele não modelava a ordem do tick, e foi essa brecha que deixou o bug passar. |
| 2026-09-14 | `input/touch.ts` | **A folga de arraste de 10 px cancelava quase todo toque.** O limiar era medido desde o ponto inicial e era **pegajoso**: um dedo que passasse dele ficava marcado como "arrastado" para sempre e não conseguia mais nem colocar nem quebrar até ser levantado. Com o outro polegar mexendo o joystick e o aparelho balançando na mão, 10 px acontecem em quase todo gesto. Agora são duas folgas — 16 px para o toque curto, 28 px para o longo — e sair da folga do longo **reancora** a contagem em vez de matá-la. Começada a quebra, deriva nenhuma a cancela, e o dedo que quebra para de girar a câmera: ele é o mesmo polegar que mira, e girar a cena tirava o alvo de baixo dele. |
| 2026-09-14 | `input/touch.ts` | **`pointerleave` valia como soltar o dedo.** Encostar na borda da tela ou passar por cima de um botão do HUD gerava um "soltou" falso — que num toque curto **coloca um bloco que ninguém pediu** e num toque longo cancela a quebra no meio. Ele saiu; a rede de segurança contra dedo perdido passou a ser ouvir `pointerup`/`pointercancel` no `window`. |
| 2026-09-14 | `game/settings.ts`, `ui/hud.ts` | **O padrão de toque virou o Modo B** — desvio consciente do doc 09 §2.2, que pede o A. Decisão do usuário com o jogo na mão. Mesmo com os três bugs acima corrigidos, sobra no A uma ambiguidade que não tem conserto: o alvo é o dedo, e o dedo tapa o que mira num aparelho pequeno. No A a **mira central agora some**, porque ela apontava para um lugar que não é o alvo. |
| 2026-09-14 | `ui/containers/screen.ts` | **No celular, todo toque de slot movia a pilha inteira — não havia como colocar um item de cada vez.** No toque `PointerEvent.button` é sempre 0, então o clique direito do doc 08 §3.5 (pegar metade, soltar uma unidade) simplesmente não existia: montar uma receita que pede uma tábua por célula era impossível, o jogador colocava as 24 de uma vez. O **toque longo** passou a valer como botão direito, e para isso a ação de toque resolve **ao soltar o dedo** e não ao encostar. O arraste de distribuição não se perde: ele nunca funcionou no dedo, porque o ponteiro de toque recebe captura implícita no elemento do `pointerdown` e os outros slots nunca recebem `pointerenter` — era, e segue sendo, gesto de mouse. Relato de campo: *"clicando em qualquer espaço ele acaba movendo o stack inteiro"*. |
| 2026-09-14 | `entity/itementity.ts`, `game/session.ts` | **O item jogado fora voltava sozinho para a mochila.** `spawn(..., thrown)` prometia "sai para a frente com força" e dava um empurrão **aleatório** de ±0,05 por eixo: o item caía a menos de meio bloco de quem o largou, dentro da caixa de coleta, que tem 1,3 de raio horizontal. Meio segundo depois o próprio jogador o recolhia. Agora ele é arremessado **na direção do olhar** a 0,3 por tick, e o atraso de coleta do que foi jogado fora subiu de 10 para 40 ticks — o arremesso resolve o caso normal, o atraso cobre quem joga contra a parede. O que cai de bloco quebrado continua sendo pego na hora. Relato de campo: *"ele está indo muito perto do meu personagem então instantaneamente meu personagem coleta ele"*. |
| 2026-09-14 | `ui/containers/screen.ts` | **Evento sem `pointerType` caía no caminho de toque.** Ao separar mouse de dedo, `pointerType` indefinido ou vazio — evento sintetizado por teclado, por navegador antigo ou por teste — ia para o ramo que espera um `pointerup` que talvez nunca venha, e a ação nunca acontecia. A regra passou a ser a mesma de `isMouseClick` em `input/controls.ts`: ausente ou vazio conta como mouse. Achado por um teste existente de shift+clique, não em campo. |
| 2026-09-14 | `input/controls.ts`, `input/gamepad.ts` | **Pausa, inventário e rolagem de hotbar do controle eram calculados e jogados fora.** Os três campos existiam em `GamepadState` desde o M3, `poll()` os preenchia todo tick e **nada em `Controls` os lia**. Quem jogasse de controle andava, olhava, pulava e quebrava — e não conseguia abrir a mochila nem pausar o jogo. Do mapeamento do doc 09 §3 também faltavam `Y` (soltar item) e `LT` (usar), que nunca existiram. |
| 2026-09-14 | `audio/synth.ts`, `audio/engine.ts` | **A tabela de sons renderizava tudo a 22 kHz, e metade das amostras guardava banda que o próprio filtro tinha jogado fora.** Um passo na areia é ruído com lowpass em 600 Hz: Nyquist diz que 11 kHz basta, com folga. `rateFor` deriva a taxa da **própria receita** — não de uma lista à mão, para som novo já nascer com a taxa certa e mexer num filtro não deixar anotação velha para trás. A conta de memória de áudio caiu de **3,95 para 3,26 MB acrescentando três sons** (morcego, trovão e o loop de chuva), e o teto do teste desceu de 4 para 3,5 MB. Em T0 isso é memória de verdade. |
| 2026-09-14 | `world/physics.ts`, `world/mesh/shapes.ts` | **A colisão da escada teria divergido do desenho no primeiro canto.** O cabeçalho de `mesh/shapes.ts` promete desde o M1 que as duas saem da mesma tabela — *"duas tabelas divergiriam na primeira forma nova, e o jogador atravessaria a escada que enxerga"* —, mas `collisionBoxesFor` recebia só `(forma, estado)` e o canto depende do **vizinho**. A física passou a derivar o canto dos mesmos quatro vizinhos, pela mesma função. As consultas só acontecem para escada: pedra e terra, que são o caminho quente do sweep, saem antes. |
| 2026-09-14 | `render/particles.ts` | **O controle de partículas não poderia funcionar para cima.** A capacidade era dimensionada pelo preset do tier no construtor, então um jogador de T0 que escolhesse "Todas" continuaria com 128 — a opção existiria e não faria nada. Os arrays passaram a ser alocados sempre no máximo (~36 KB de `TypedArray`) e o modo virou um teto vivo. Trinta quilobytes não valem uma opção que mente. |
| 2026-09-13 | `game/savegame.ts` | **Um pedaço de campo nasceu dentro do Nether — o inverso exato do bug da manhã, e a correção dele alargou esta fresta.** O pipeline troca de dimensão de forma **síncrona** e pede chunk no mesmo tick; o save troca de forma **assíncrona**, porque antes grava baús, veículos e as colunas que estão saindo. Nessa fresta o pipeline pedia chunk do Nether e o save respondia com a chave da superfície. O carimbo de dimensão do pipeline não pega este caso: quem está fora de sincronia não é o pipeline consigo mesmo, é o save com o pipeline. `SaveGame.loadChunk` passou a **esperar a troca terminar** — o carregamento já é assíncrono, o pipeline já sabe esperar, e a viagem tem tempo limite se algo travar. |
| 2026-09-13 | `game/weather.ts`, `game/session.ts` | **Chovia no Nether**, debaixo de um teto de rocha-mãe. `hasSky` estava em `data/dimensions.ts` desde que o Nether nasceu e **nada no código a lia** — a terceira dívida desse tipo no projeto, depois de `fireImmune` e `flammable`. O corte é em `Weather.kind`, um lugar só: `isRaining`, `isThundering`, `intensity` e o teto de luz do céu saem todos dele. |
| 2026-09-13 | `game/travel.ts`, `game/session.ts` | **O portal só funcionava perto da origem.** O pipeline carrega o anel em volta do **jogador**, e a travessia o deixava parado nas coordenadas antigas enquanto esperava o chunk de destino — que, com a escala 1:8, pode estar a 700 blocos dali. O chunk nunca chegava, a viagem estourava o tempo limite de 30 s e o jogador ficava largado na dimensão nova, nas coordenadas velhas, **preso dentro da rocha e sem portal nenhum**. Perto do spawn passava despercebido, porque a diferença cabia no render distance. Agora `onDimensionChange` leva as coordenadas do destino e a `Session` põe o jogador lá na hora; a física está congelada durante o carregamento, então mover antes de existir chão é seguro, e o Y definitivo continua saindo de `arriveAt`. Relato de campo: *"apareci travado voando… não consigo me mexer… não renderizou portal algum"*. |
| 2026-09-13 | `render/gl.ts` | **A textura piscava a tela inteira.** O contexto era criado com `desynchronized: true`, que tira o canvas da sincronia com o compositor — a especificação diz que nesse modo pode haver tearing e quadro apresentado fora de hora. Num painel LTPO, que troca de 120 para 60 Hz sozinho, isso vira piscada constante, com a tela parada e só naquele aparelho. O que se ganhava eram alguns milissegundos de latência de toque. Agrava o teto de FPS de `core/loop.ts`, que devolve o quadro **sem desenhar**: sem sincronia com o compositor, quadro não desenhado é conteúdo indefinido na tela. |
| 2026-09-13 | `core/tier.ts` | **A regra de textura de 16384 não promovia ninguém — e o motivo veio do aparelho.** A linha de aparelho nova mostrou `tex 8192` num Adreno 750: quem responde `MAX_TEXTURE_SIZE` é o ANGLE, não o driver. Sobrou o nome, que é o que o aparelho de fato informa (`ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)`). A regra virou simétrica à das GPUs antigas: família de topo — Adreno 7xx/8xx, Mali-G7xx, Immortalis, Xclipse, Apple GPU — vale +2. Envelhece do mesmo jeito que a outra, e é por isso que a opção **Qualidade** existe. |
| 2026-09-13 | `world/pipeline.ts` | **O teto de jobs em voo era o gargalo do jogo inteiro.** `maxInFlight = workers * 2`, e o `pump` roda **uma vez por frame** — então o teto de pedidos em voo era também o teto de despachos por frame: 4. O aparelho mandava 4 jobs e esperava o frame seguinte, com os workers ociosos ~90% do tempo. Num S24 Ultra com RD 16: 60 FPS, render de 3,2 ms de 16,6 ms, **7051 sections na fila** e 861/861 colunas já geradas — a máquina não estava lenta, estava **entediada**. Medido no pipeline: um mundo de RD 16 saía em **1315 pumps** (22 s a 60 FPS) e agora sai em **165**. O teto subiu para `workers * 16` e quem limita passou a ser um **orçamento de tempo** de 20% do frame, porque despachar não é de graça: cada job de malha copia a vizinhança 18³ da coluna na thread principal (~0,26 ms). Sendo orçamento, ele se ajusta ao aparelho sozinho. |
| 2026-09-13 | `ui/debug.ts` | **Não havia como diagnosticar um tier errado.** `detectTier` decide a partir de quatro números do navegador e, quando erra, nada na tela diz **qual** deles está baixo — o bônus de textura de 16384 não promoveu o S24 Ultra e não havia como saber por quê. O overlay ganhou uma linha com memória, núcleos, workers, tamanho máximo de textura e GPU reportada. |
| 2026-09-13 | `game/settings.ts`, `ui/screens/options.ts`, `main.ts` | **O tier não tinha como ser corrigido pelo jogador.** O comentário de `core/tier.ts` promete desde o M0 que *"todo valor derivado aqui pode ser sobrescrito nas opções"*, e só a distância de render era. Tier define workers, nuvens, partículas e teto de mobs, nenhum com controle próprio. Opções → Vídeo ganhou **Qualidade** (Automática/Baixa/Média/Alta). Vale no carregamento seguinte: o número de workers é decidido quando o pipeline nasce. |
| 2026-09-13 | `save/savemanager.ts` | **Coluna do Nether gravada como coluna da superfície — netherrack plantado na grama, permanente.** `flush` devolvia na hora quando já havia uma gravação em curso (*"chamadas concorrentes são ignoradas"*), mas `setDimension` faz `await this.flush()` **justamente** para gravar com a chave antiga o que está saindo. Com um autosave rodando, esse `await` não esperava nada: a dimensão virava no meio e o lote em voo ia para o disco com a chave **nova**. Agora `flush` devolve a promessa em curso, e `setDimension` chama duas vezes — a primeira espera a que já rodava, a segunda leva o que o `pipeline.setDimension` acabou de sujar ao descarregar. A chave passou a ser capturada antes de qualquer `await`, aqui e em `saveAndForget` (onde o acerto dependia da ordem de avaliação dos argumentos — correto por acidente). Relato de campo: *"parece que ele trouxe parte do mundo do nether para terra"*. |
| 2026-09-13 | `world/pipeline.ts` | **A mesma corrupção pela outra porta.** O caminho do save em `dispatchGen` é assíncrono e `acceptChunk` só conferia distância: atravessar o portal com uma leitura de IndexedDB em voo punha a coluna do outro lado no mundo novo — e, como ela volta do disco marcada `modified`, ao sair de alcance era **gravada** na dimensão errada. A dimensão agora é carimbada no despacho e conferida na volta, como já acontecia com a resposta do worker. |
| 2026-09-13 | `world/pipeline.ts` | **O meshing matava a geração de fome.** São `workers × 2` vagas, o meshing era despachado primeiro **sem teto**, e uma coluna rende até 8 jobs de malha: com a fila cheia as quatro vagas iam todas para malha e quase nada nascia. No S24 Ultra com RD 16: *"201/861 colunas, 1046 na fila, 0 gerando, 4 meshando"*. Metade das vagas agora fica reservada para a geração enquanto houver fila dela — gerar e meshar uma coluna custam a mesma ordem de grandeza (6–14 ms contra 8 × 0,6–1,5 ms). Medido com 4 vagas: **86 colunas em 40 ciclos, contra 44**. **Escopo revisto no mesmo dia:** com o teto de vagas corrigido na linha seguinte desta tabela, a reserva deixa de mudar qualquer coisa num aparelho rápido — sobra vaga para os dois lados. Ela guarda o regime oposto, o do aparelho lento, onde o orçamento de tempo deixa passar meia dúzia de despachos por frame e sem reserva o meshing leva todos. Era esse o regime de **todo** aparelho antes. |
| 2026-09-13 | `world/gen/nether.ts` | **O Nether nascia sem luz nenhuma.** `generateNetherChunk` chamava `recomputeHeightMap()` e **não** `computeChunkLight()`, que o gerador da superfície sempre chamou. Lava, pedra luminosa e magma declaravam `emission` na tabela e não acendiam nada. Pior que escuro, ficava **manchado**: coluna que o jogador tinha modificado voltava pelo save, que recalcula a luz, e nascia iluminada ao lado de uma que não — *"parte da lava fica mais acesa e parte da lava mais escura"*. Custo: 3,8 → 6,1 ms por chunk, contra um orçamento de 25. |
| 2026-09-13 | `core/tier.ts` | **Nenhum celular podia chegar ao T2, por mais forte que fosse.** `navigator.deviceMemory` satura em 8, então um aparelho de 12 GB pontua igual a um de 8; com a penalidade de `isMobile`, o melhor celular possível somava 3 e o T2 exige 4. Um Galaxy S24 Ultra entrava como **T1**, com render distance 8 e 2 workers. `maxTexSize >= 16384` — GPU de classe GLES 3.1/3.2, e o único número que vem do driver em vez de um nome para casar com regex — passou a valer +1, **só com WebGL2** (sem essa condição um aparelho sem WebGL2 subia para T2, que é o oposto da regra de errar para baixo). |
| 2026-09-13 | `ui/debug.ts`, `main.ts` | **O overlay mentia o render distance.** O cabeçalho era montado uma vez no construtor: quem subisse a opção para 16 em jogo continuava lendo "RD 8" e media o mundo errado. O cabeçalho virou prefixo + valor + sufixo, e `applyRenderDistance` avisa o overlay junto com o pipeline e o renderer. |
| 2026-09-12 | `entity/mobstore.ts` | **O mob nunca atingia a velocidade da tabela.** A ordem do tick é mesclar, mover, atritar: `steerToMoveTarget` mira `def.speed` mas o atrito entra depois, todo tick, e o regime permanente estabiliza em `blend / (1 − atrito × (1 − blend))` do alvo — **46%** no chão. O zumbi de 1,15 blocos/s andava a 0,53. Agora o alvo é dividido por esse fator, calculado com o atrito do próprio tick (chão, ar ou água), e `def.speed` passa a significar o que o doc 07 §1 diz. Regressão em `tests/mobs.test.ts`. |
| 2026-09-12 | `data/mobs.ts`, `docs/07` §2 | **A tabela de velocidade era lenta demais.** Hostil andava de 1,05 a 1,3 blocos/s contra 4,317 do jogador caminhando — um quarto. Mesmo com o bug acima corrigido, um mob que leva oito segundos para cruzar dez blocos não parece estar perseguindo ninguém, e o relato de campo foi exatamente esse: *"os monstros estão muito lentos"* e *"não me seguem"*. A régua agora é o jogador: hostil fica entre caminhar (4,317) e correr (5,612) — zumbi 3.7, esqueleto 4.0, creeper 3.4, aranha 4.2, slime 1.9, lobo 4.8, enderman 4.5. Passivo continua lento de propósito. Decisão registrada no doc 07 §2. |
| 2026-09-12 | `game/spawnplacement.ts` (novo), `main.ts` | **Voltar ao mundo teletransportava o jogador para o ponto inicial.** `trySpawn` tem duas funções — segurar a simulação até existir chão (senão o jogador cai pelo vazio enquanto os chunks carregam) e posicioná-lo em mundo novo — e fazia as duas **sempre**, inclusive logo depois de `save.load()` ter devolvido a posição do disco. Como ela reposiciona na coluna (0,0), que é onde toda partida começa, o jogador voltava exatamente para o spawn por mais longe que tivesse construído. Agora o caminho do save só espera a coluna do jogador chegar, sem tocar na posição. A função saiu do `main.ts` para um módulo próprio porque `main.ts` chama `boot()` no topo e não pode ser importado por teste; regressões em `tests/savegame.test.ts`. |
| 2026-09-12 | `game/savegame.ts` | **O autosave de 60 s gravava só os chunks.** Ele chamava `manager.tick()`, que despeja apenas o terreno; jogador, baús e meta do mundo tinham **um único caminho de gravação**, o botão "Salvar e sair". Fechar a aba perdia o conteúdo de todo baú e a hora do dia, e no celular esse é o caso comum — `beforeunload` não dispara ao trocar de app. O tick agora chama `saveAll()`. |
| 2026-09-12 | `save/savemanager.ts`, `save/db.ts` | **O registro do banco vencia sempre o de emergência.** Os dois são escritos em momentos diferentes (o do banco em `saveAll`, o de emergência ao sair da página), então fechar a aba depois de jogar deixava o de emergência mais novo — e o jogo carregava o do banco assim mesmo, parado na última saída limpa. `PlayerSave.savedAt` desempata; ausente vale 0, então save antigo não precisa de migração. |
| 2026-09-12 | `main.ts` | **Nada era salvo ao esconder a aba.** `visibilitychange` só parava o laço e o áudio, e é o **único** aviso confiável no celular. Agora grava a rede de emergência (síncrona, sempre termina) e dispara o save completo. |
| 2026-09-12 | `save/savemanager.ts`, `game/savegame.ts` | **Falha ao gravar chunk era silenciosa.** `flush` e `saveAndForget` engolem a exceção para não derrubar o frame e escreviam só em `stats.lastError`, que **nada no código lia** — estourar a cota parava de salvar o mundo construído sem nenhum aviso, contra o doc 11 §4. `SaveManager.onError` leva a falha ao mesmo aviso de HUD do resto do save. |
| 2026-09-12 | `main.ts` | **`requestPersistence()` e `estimate()` existiam em `save/db.ts` desde o M4 e nunca tinham sido chamados** (doc 11 §4). Sem `persist()`, o navegador trata a base como descartável e pode limpá-la sob pressão de espaço — num aparelho de 2 GB, risco real. Agora o boot pede persistência, e ao entrar no mundo o jogador é avisado se passou de 80% da cota ou se o navegador não tem armazenamento nenhum (aba anônima). |
| 2026-09-12 | `core/tier.ts`, `docs/02` §1 | **T0 passou de 1 para 2 workers.** A tabela do doc dizia 1 por prudência, e o aparelho de referência mostrou que a prudência estava no lugar errado: o J7 Metal roda a 60 FPS com **2,7 ms de render num orçamento de 33,3**, ou seja, ocioso, gerando o mundo com uma thread só enquanto o jogador anda mais rápido do que o terreno nasce. Medido no pipeline, o anel de RD 4 enche em **75 frames em vez de 149**. `presetFor` corta por `min(workers, núcleos − 1)`, então o aparelho de 2 núcleos continua com 1 — verificado em `tests/tier.test.ts`. Decisão do usuário. |
| 2026-09-12 | `entity/spawn.ts`, `docs/07` §4 | **O cap de mobs punia duas vezes.** `capsForTier` já reduz pelo tier e `runCycle` multiplicava de novo por `chunksCarregados / 289`, **sem teto**. No mesmo mundo isso dava **8 hostis no T0** (a caverna parecia vazia) e **148 no T2** — acima do próprio teto de 70 mobs vivos do doc 02 §1. A prontidão agora satura em 1 e a referência é a área **simulada**, não a de render: só reduz enquanto há menos mundo carregado que o tier espera. Caps efetivos passam a ser 20/40/70, exatamente a linha "Máx. mobs vivos" do doc 02 §1. Decisão do usuário. |
| 2026-09-12 | `docs/06` §3 | O doc normativo pedia empuxo `+0.02/tick`, que apenas cancelava a gravidade dentro d'água (`0.08 × 0.25`). O código já usava 0,04 desde a correção da natação, como desvio consciente registrado no comentário da constante; agora o doc traz o número certo e o porquê. Decisão do usuário. |
| 2026-09-12 | `render/hand.ts`, `main.ts` | **A mão vibrava com qualquer tela aberta.** A guarda de "tela de contêiner aberta" saía do tick **antes** de `handRenderer.tick()`, e é ele quem iguala `previous` a `current`. Abrir a bancada com a mão vazia é um clique de usar: ele dispara o golpe e abre a tela no mesmo tick, deixando `previous = 0` e `current = SWING_TICKS` congelados. O render interpola entre os dois a cada frame, então `swingAt(alpha)` virava o próprio `alpha` — um golpe inteiro por frame, sem fim, até fechar a tela. Agora a mão continua animando parada com a tela aberta. A máquina de estado saiu para `HandAnimation`, fora do renderer, para poder ser testada sem GL; regressões em `tests/hand.test.ts`. |
| 2026-09-12 | `ui/containers/screen.ts` | **Painel desperdiçando espaço no desktop.** A fileira de 9 slots da mochila manda na largura, e a grade 3×3 da bancada empilhada em cima dela deixava metade da linha vazia; o livro de receitas, empilhado embaixo, empurrava o painel para além da altura da tela e ficava cortado. Acima de 900 px o corpo do painel virou duas faixas — conteúdo à esquerda, livro à direita, na altura do botão que o abre — e a grade deita (`row wrap`), o que fecha o vazio. Abaixo disso tudo volta a empilhar, que é o certo no celular. A largura do painel só cresce com o livro aberto (`.panel.with-book`). |
| 2026-09-12 | `main.ts`, `world/pipeline.ts`, `render/renderer.ts` | **A opção de distância de render não fazia nada em jogo.** Ela era lida uma única vez no boot (`rdOverride`), e `settings.onChange` não a tratava: mexer no controle durante a partida não mudava pipeline, plano distante nem névoa — o jogador subia para 16 chunks e via exatamente a mesma coisa. Agora `applyRenderDistance` liga os três, com `pipeline.setRenderDistance` (que reenfileira o anel e descarrega o excedente, porque `setCenter` sai cedo quando o centro não mudou) e `renderer.setRenderDistance` (plano distante e névoa juntos, num método só). Regressões em `tests/pipeline.test.ts`. |
| 2026-09-12 | `entity/spawn.ts` | **Hostil não nascia na caverna onde o jogador estava.** `runCycle` recebia o Y do jogador e o ignorava (`_playerY`): o Y saía uniforme de `minY` até a superfície, quase todo sorteio caía dentro de pedra maciça e era rejeitado, e a superfície — que sempre tem ar — aceitava. Medido com o jogador a 30 de altura: dos hostis nascidos em 10 minutos, **nenhum** ficava ao alcance e vários saíam ~38 blocos acima dele. Agora quem nasce no escuro sorteia o Y numa faixa de ±16 em volta do jogador (`CAVE_Y_SPREAD`); o caminho da superfície à noite continua igual. Regressão em `tests/spawn.test.ts`. |
| 2026-09-12 | `world/pipeline.ts` | **A aba travava por completo ao voar** — não caía de FPS, morria, e só voltava recarregando a página. `dispatchMesh` devolvia o job bloqueado para a mesma `meshQueue` de onde o `pump` acabara de tirá-lo e o `continue` não gastava vaga de `busy`: com todo job da fila sem vizinho — que é o que voar produz, porque a coluna de trás descarrega antes de o meshing sair —, o `while` reexaminava o mesmo job para sempre. Loop infinito síncrono, por isso nem erro aparecia. O job adiado agora espera em `deferredMeshes` e só volta para a fila depois do laço; `scan` limita o laço a uma passada por job, e job cuja coluna saiu do mundo é descartado em vez de esperar um vizinho que não volta. Regressão em `tests/pipeline.test.ts` (que **trava** em vez de falhar se regredir — está dito lá). |
| 2026-09-12 | `entity/player.ts` | **Nadar era impossível.** Dois defeitos somados na vertical. (a) O empuxo do doc 06 §3 (+0,02/tick) apenas cancelava a gravidade dentro d'água (0,08 × 0,25 = 0,02/tick); sobrava só o resíduo do arrasto, 0,4 blocos/s subindo contra 1,6 afundando — 2,7 s por bloco, e o jogador com menos empuxo que o mob (0,03) e o barco (0,06). (b) `updateFluidState` sondava `floor(y + 0.1)`, desligando o empuxo um décimo de bloco **abaixo** da superfície — exatamente o décimo que falta para pisar numa margem no mesmo nível da água, então o jogador batia na parede do lago para sempre. Agora empuxo 0,04 (**desvio consciente do doc 06 §3**, justificado no comentário da constante) e sonda em `EPSILON`, que não pode ser zero: parado no fundo a colisão deixa os pés na borda exata do bloco e o `floor()` cairia um bloco abaixo. Subir um bloco caiu de 54 para 13 ticks; sair para a margem passou de impossível para 41 ticks. Regressões em `tests/physics.test.ts`. |
| 2026-09-12 | `ui/containers/screen.ts` | **Craftar em série roubava o inventário.** Tocar repetido no slot de resultado é a forma normal de craftar, e dois toques dentro de 350 ms caíam na janela do duplo clique, que varre o inventário inteiro para o cursor: quem tinha acabado de guardar 64 tábuas via as 64 voltarem para a mão sozinhas. O gesto de juntar não vale mais em slot que só produz saída (resultado do craft, saída da fornalha). Regressão em `tests/recipebookui.test.ts`. |
| 2026-09-12 | `ui/containers/screen.ts` | **Clicar numa receita "não fazia nada".** `autoFillRecipe` enchia a grade de verdade, mas escrevendo direto em `inventory.slots` — e `refreshCraftResult` idem —, sem passar por `changed()`. Sem `onChange`, `containerScreen.refresh()` nunca rodava: grade cheia no modelo, vazia na tela. O `onPick` do livro passou a redesenhar a tela quando o preenchimento dá certo. |
| 2026-09-12 | `ui/containers/recipebook.ts` | O nome da receita saía no atributo `title` do HTML, que **só existe para o mouse parado em cima**: no celular a região de receitas não tinha rótulo nenhum. Agora usa o tooltip do jogo, com a mesma divisão dos slots — no toque quem avisa é o `pointerdown`, com prazo para sumir; entrar e sair é só do mouse. |
| 2026-09-12 | `ui/debug.ts`, `main.ts` | A linha `C:` do overlay misturava duas unidades: `main.ts` punha **sections visíveis** no campo "carregados" e **colunas carregadas** no campo "total", contra o `C: 81/81 loaded` do doc 02 §6, onde os dois são colunas. Um `41/88` saudável se lia como pipeline travado com metade do mundo faltando — e foi lido assim num relatório de campo. Agora `loaded`/`total` são as colunas do anel (`ringProgress`), `generating` aparece separado de `meshing` (antes estava somado e invisível) e as sections visíveis foram para a linha `V:`. De quebra, o overlay fechado não recalcula mais nada a cada frame. |
| 2026-09-09 | `world/chunk.ts` | `setByIndex` guardava o array de dados **antes** de resolver a paleta; quando o estado novo estourava os bits, `growBits` trocava `this.data` e a escrita caía no buffer descartado — o bloco não aparecia, em silêncio. Regressão coberta em `tests/worldgen.test.ts`. |
| 2026-09-09 | `world/gen/terrain.ts` | A luz do céu atenuava 15 em qualquer bloco não-ar. Com árvores, tudo debaixo de uma copa ficava preto. Agora usa `lightAttenuation` da tabela de blocos. |
| 2026-09-09 | `world/lighting.ts`, `world/gen/terrain.ts` | `seedChunkSkyLight` nunca era chamado e enfileirava a coluna iluminada inteira (~16 mil voxels por chunk). O espalhamento lateral passou para o worker (`spreadSkyLight`), com fila só de voxels de fronteira. |
| 2026-09-09 | `data/items.ts` | O dano das ferramentas ignorava o material: espada de diamante batia igual à de madeira. Agora soma o bônus do material, fechando a coluna do doc 05 §2 (4/4/5/6/7). |
| 2026-09-10 | `world/gen/terrain.ts` | A luz de bloco nunca era propagada na geração: lava e pedra luminosa declaravam `emission` na tabela e não iluminavam nada. Agora há flood fill de luz de bloco no worker, filtrado pela paleta da section para não custar 32 mil consultas por chunk. |
| 2026-09-10 | `render/itemrender.ts` | O item no chão amostrava o atlas de blocos e, para o que não é bloco, caía na textura de "faltando". Passou a usar a folha de sprites — o mesmo desenho do inventário. |
| 2026-09-10 | `world/pipeline.ts` | `onGenerated` duplicava a checagem de alcance; virou `acceptChunk`, compartilhado com o caminho do save. |
| 2026-09-10 | `main.ts` | **Comer nunca funcionava.** O laço zerava o progresso de comer sempre que o jogador **não estava quebrando** (`if (!breaking) session.cancelEating()`), e comer acontece segurando o *outro* botão: `eatTicks` ia a 1 e voltava a 0 a cada tick, sem nunca chegar aos 32. A condição passou a olhar o botão de usar, que é o que de fato encerra a ação — e é o mesmo caminho por onde o arco dispara ao soltar. |
| 2026-09-10 | `world/mesh/blockinfo.ts`, `world/physics.ts` | Laje e escada colidiam como bloco inteiro, porque a física só conhecia `def.solid`. Agora as duas leem as caixas de `mesh/shapes.ts`, a mesma tabela que desenha. |
| 2026-09-10 | `game/container.ts` | A fornalha somava **0,1 de XP fixo** por item fundido e ignorava a coluna `xp` da tabela de fundição (doc 05 §7): ouro valia o mesmo que areia. O índice de fundição passou a guardar saída **e** XP, e `smeltingXp` é quem responde. Sem efeito visível até agora só porque o XP não era entregue a ninguém. |
| 2026-09-10 | `game/inventory.ts`, `game/container.ts` | `give()` reconstruía a pilha a partir de `item`/`count`/`damage` e perdia qualquer campo novo. Com o encantamento, coletar do chão ou tirar de um baú apagaria o encantamento em silêncio; os dois métodos passaram a receber `ench`. |
| 2026-09-10 | `world/mesh/greedy.ts` | **Bloco não-cubo não era desenhado.** O greedy só emite face de voxel cheio, e o "buffer de blocos complexos" prometido pelo doc 04 §3 nunca foi escrito — havia só um comentário dizendo que chegaria no M4. Na prática grama alta, samambaia, flor, muda, cana, trepadeira, arbusto, **tocha** e laje existiam no mundo, colidiam, iluminavam e eram invisíveis. Corrigido em `world/mesh/complex.ts`, com regressão em `tests/complexmesh.test.ts` que falha se aparecer forma nova sem geometria. |
| 2026-09-10 | `input/controls.ts` | **O jogo travava o controle de toque ao colocar um bloco.** `canvas.addEventListener('click', …)` pedia pointer lock sem olhar de onde veio o clique — e um toque curto e parado também dispara `click`. Com o ponteiro travado a spec manda **congelar `clientX`/`clientY`**, então todo dedo passava a reportar o mesmo ponto: o joystick nascia no canto superior esquerdo, nunca saía do raio morto (personagem parado) e nenhum toque era mais classificado como "olhar" (nada mais colocava bloco). Só voltava ao normal na pausa, que solta o lock, e nunca acontecia no Modo B, onde colocar é botão de DOM e o canvas não recebe `click`. Agora só `pointerType === 'mouse'` pede lock. Regressão em `tests/input.test.ts` |
| 2026-09-10 | `entity/player.ts` | **Nadar estava 3,4× mais lento que o doc.** A água aplicava dois freios ao mesmo tempo — o atrito do ar (0,91) **e** o arrasto do fluido (0,8), multiplicados — e ainda cortava a aceleração em 0,4. A velocidade terminal dava 0,58 blocos/s contra 4,32 andando. O doc 06 §3 pede só o arrasto: agora ele **substitui** o atrito, e a aceleração dentro de fluido é a do ar (inclusive pisando no fundo, senão a fórmula de chão daria 9,8 blocos/s). Fecha em 1,96 blocos/s. Regressão em `tests/physics.test.ts` |
| 2026-09-10 | `main.ts`, `game/session.ts` | **Nenhum mob tomava dano no criativo.** O golpe estava preso a `mode === 'survival'` no laço principal, então no criativo o clique caía direto no `tickBreaking` — que no criativo quebra o bloco **atrás** do mob. Bater em bicho não fazia nada visível. O ataque agora vale nos dois modos, e no criativo mata de uma vez. Regressão em `tests/session.test.ts` |
| 2026-09-10 | `render/selection.ts`, `render/shaders/overlay.glsl.ts` | **A rachadura sumia em bloco escuro.** Ela era sempre escura, em blend de multiplicação: em tronco, obsidiana ou pedra profunda não dava para ver se a batida estava pegando. O passe virou alpha blend com a cor vinda de fora, escolhida pelo brilho médio da textura do bloco (leitura do `averages` do atlas, pronto desde o boot). `crackToneFor` isola a decisão e está coberta em `tests/cracks.test.ts` |
| 2026-09-10 | `ui/containers/creative.ts`, `main.ts` | **No criativo não havia como vestir armadura.** O `E` abria só a paleta de itens; os 4 slots de armadura, o offhand e a grade 2×2 ficavam inalcançáveis. A paleta ganhou o botão "Mochila e armadura", que fecha e abre o inventário normal. Coberto em `tests/creativeui.test.ts` |
| 2026-09-10 | `ui/containers/creative.ts` | O inventário criativo focava a busca ao abrir, o que no celular sobe o teclado virtual por cima da tela sem ninguém pedir. O foco agora só acontece fora de ponteiro grosso |
| 2026-09-10 | `render/dynamicscale.ts` | **O mundo "piscava" com a câmera parada.** Num aparelho que fica em cima do alvo de FPS, a escala caía, sobrava folga, subia, não aguentava e caía de novo — e **cada troca realoca o backbuffer, que custa um frame preto**. O cooldown de 3 s limitava a frequência do ciclo, não o ciclo. Duas mudanças: subir agora exige 40% de folga (antes 20%, menos que os ~20% que o próprio degrau custa — oscilar era garantido), e depois de uma queda a escala anterior fica proibida por um tempo que **dobra a cada queda**, até o aparelho estabilizar. Regressão em `tests/dynamicscale.test.ts` |
| 2026-09-10 | `input/touch.ts` | `reset()` não zerava a origem do joystick nem a mira: ao voltar da pausa o joystick podia ressuscitar na posição do toque anterior |
| 2026-09-10 | `ui/containers/screen.ts`, `ui/containers/creative.ts` | **As janelas não rolavam no celular.** `#container-screen` tinha `touch-action:none`, que desliga a rolagem por toque do navegador — estava lá para o arraste de pilha entre slots não rolar a tela junto, mas os slots já chamam `preventDefault()` no `pointerdown`, então o lugar certo da regra é o slot. Virou `touch-action:pan-y`. Junto, `place-items:center` com painel mais alto que a tela deixa **o topo inalcançável**: passou a `safe center`, que centraliza quando cabe e alinha no início quando não cabe. Regressão em `tests/creativeui.test.ts` |
| 2026-09-11 | `ui/containers/screen.ts` | **Regressão introduzida horas antes nesta mesma sessão:** o painel de container passou a vazar para fora da própria borda no celular. A culpa foi usar `columns:2` do CSS para a tela baixa — o multi-coluna reparte a largura em partes **iguais**, e a fileira de 9 slots da mochila é mais larga que metade do painel. Agora as colunas são contêineres no DOM com `flex-wrap`: cada uma toma a largura de que precisa e, quando as duas são largas (baú), elas empilham em vez de transbordar. Verificado a 740×340: slot mais à direita em 668 contra borda do painel em 680 |
| 2026-09-11 | `ui/hud.ts`, `ui/screens/options.ts` | **A opção "Escala da interface" nunca funcionou ao vivo.** `updateScale` só rodava no boot e no `resize` da janela: mexer no slider trocava o rótulo e não mudava nada na tela — quem tentava diminuir a interface concluía, com razão, que a opção era decorativa. O HUD passou a assinar `settings.onChange`. Junto, o passo do slider foi de 1 para **0,5**: com passo inteiro o vizinho de "automática" era 1×, e num aparelho cuja automática já é 2× não havia meio-termo. Verificado: 0,5× leva a hotbar de 202 px para 111 px |
| 2026-09-11 | `ui/containers/tooltip.ts`, `ui/containers/creative.ts`, `ui/containers/screen.ts`, `docs/08` §3.5 | **No toque não havia como ler o nome de um item.** No desktop o hover mostra o rótulo; no celular não há hover e o `title` do HTML nunca aparece, então tocar um item da paleta criativa já o mandava para a hotbar sem nunca dizer o que era — quem não reconhecia o sprite não tinha como descobrir. Novo módulo `ItemTooltip` com `bindLongPress`: segurar mostra o nome e **engole o clique** daquele toque (`stopImmediatePropagation` num ouvinte registrado antes do de ação), o toque curto segue igual, e escorregar o dedo cancela. Na tela de container a ação resolve no `pointerdown`, de que depende o arraste entre slots — cancelar ali quebraria o arraste, então o rótulo aparece **junto** com a ação. Verificado no celular emulado: toque de 80 ms põe Minério de Diamante na hotbar; toque de 700 ms mostra "Minério de Esmeralda" e a hotbar não muda |
| 2026-09-11 | `ui/hud.ts`, `ui/containers/screen.ts`, `docs/08` §6 | **No celular a interface era grande demais para a tela.** `autoGuiScale` forçava `max(3, …)` no ponteiro grosso para garantir alvo de toque de 44 px. Num celular deitado o cálculo honesto dá 1 — e o piso entregava a mesma escala de um desktop de 1280×800. Medido a 640×360: painel do inventário com **600×755 px numa tela de 360**, 2,1× a altura disponível; a hotbar sozinha comia 22% da tela. O piso passou a 2 (os 44 px continuam garantidos onde importam, no `min-width`/`min-height` dos botões de toque) e, abaixo de 560 px de altura em paisagem, as seções do painel fluem em duas colunas. Verificado no jogo: **626×247, cabe**. O botão "Receitas" saiu do `float:right`, que em tela estreita caía sobre o primeiro slot. Regressões em `tests/uxpolish.test.ts` |
| 2026-09-11 | `ui/containers/recipebook.ts`, `docs/08` §3.5 | **O livro de receitas nascia vazio.** O filtro "só o que dá" vinha ligado, então quem entrava no mundo abria a única ferramenta que ensina a craftar e lia "Nada para fazer com o que você tem". Agora nasce desligado, com o indisponível em cinza (o que o doc já pedia) e o possível ordenado na frente. Verificado no jogo: **10 receitas** com a mochila vazia, era zero |
| 2026-09-11 | `data/achievements.ts`, `ui/screens/pause.ts`, `ui/hud.ts`, `main.ts` | **Nada no jogo dizia o que fazer.** A tela de Conquistas mostrava as 18 linhas como "???" com dica genérica ("Consiga um certo item"), embora os nomes existissem e o dado já tivesse `parent` com um comentário dizendo que ele *"serve para a tela mostrar o caminho"*. Agora a árvore revela um passo à frente, e o HUD ganhou uma **linha de objetivo** no canto superior esquerdo que segue a mesma regra (`nextObjective`). O texto é derivado do gatilho e do alvo, então conteúdo novo já entra com objetivo pronto |
| 2026-09-11 | `entity/player.ts`, `game/settings.ts`, `ui/screens/options.ts`, `docs/09` | **Não existia pulo automático**, e o doc 09 §2 o quer ligado por padrão no celular. Sem ele, subir uma borda de um bloco no toque exige soltar o joystick e acertar o botão de pulo a cada passo. `shouldAutoJump` sonda o degrau à frente com AABB pré-alocada: sobe um bloco, nunca dois, e nunca parado |
| 2026-09-11 | `game/settings.ts`, `ui/screens/options.ts`, `ui/hud.ts`, `render/renderer.ts` | A tela de Opções tinha 6 das 17 entradas de Vídeo do doc 08 e **nenhuma seção de Acessibilidade**. Entraram **Campo de visão** (30–110°), **Brilho** (vira o piso de luz ambiente do shader) e a seção **Acessibilidade** com alto contraste, tamanho de texto (80–150%) e clarão de dano |
| 2026-09-11 | `ui/hud.ts`, `main.ts` | **Não havia retorno visual de dano** — o único aviso era a fileira de corações mudar no canto de baixo, fácil de perder olhando para o creeper. Vinheta vermelha de 350 ms nas bordas, desligável na Acessibilidade, e respeitando `prefers-reduced-motion` |
| 2026-09-11 | `ui/touchui.ts`, `main.ts`, `docs/09` | **Botão de voar morto no sobrevivência.** Ele sempre era desenhado, mas `onFlyToggle` devolve cedo fora do criativo: um controle em posição nobre que não fazia nada. Agora só aparece no criativo |
| 2026-09-11 | `ui/touchui.ts`, `ui/hud.ts` | **O botão de pular cobria a barra de fome.** Medido a 640×360: barras em `x 47–593`, botão em `x 568–624` — 25×21 px de sobreposição. A `TouchUi` publica `--touch-pad` e a barra desconta dos dois lados. Verificado: barras em `x 138–502`, sem colisão |
| 2026-09-11 | `ui/containers/screen.ts` | **Não havia como vestir armadura à mão em nenhum modo.** Os 4 slots de armadura e o offhand existem em `game/inventory.ts` desde o M5, `canPlaceIn` valida a peça, `shiftMove` equipa e `game/combat.ts` soma a defesa — mas **nenhuma tela os desenhava**: `build()` montava, para `inventory`, só a grade 2×2, o resultado, a mochila e a hotbar. A correção de 2026-09-10 pôs o botão "Mochila e armadura" na paleta criativa apontando para essa tela, então a queixa original ("não consigo equipar armadura") nunca foi de fato resolvida. Agora a tela abre com a seção **Equipamento** e fecha os 46 slots do doc 08 §3.5. Slot vazio mostra o nome da peça (Elmo, Peito, Calça, Bota, Mão), que sem ícone fantasma é o que diz ao jogador o que vai ali. Regressões em `tests/creativeui.test.ts`, incluindo o shift+clique que equipa |
| 2026-09-11 | `ui/containers/screen.ts`, `main.ts` | **Nenhuma tela de container fechava sem teclado.** O overlay é `z-index:12` e o HUD de toque é `z-index:6`: com baú, fornalha, bancada ou mochila aberta, o botão de inventário e o de pausa ficavam cobertos, e não havia botão de fechar no painel. Clicar fora só devolve o item do cursor (doc 08 §3.5), não fecha. Num aparelho sem teclado — o alvo do projeto — a janela prendia o jogador. A queixa chegou pelo criativo (paleta → "Mochila e armadura" → sem saída), mas valia para os dois modos e para as quatro telas. Agora todo painel tem rodapé com "Fechar", alvo de toque de 44 px. Junto, no criativo o `E` com a mochila aberta abria a paleta **por cima** em vez de fechar uma camada por vez (doc 08 §4.1). Regressões em `tests/creativeui.test.ts` |
| 2026-09-11 | `data/textures.ts`, `data/blocks.ts`, `render/texgen.ts`, `docs/13` §2.2 | **Os blocos construídos não se distinguiam do material de origem.** Baú, bancada, fornalha e estante eram `inherit` da tábua ou do pedregulho com um `tintBy(0.9x)`; cama e TNT apontavam para **a mesma camada do atlas** que a lã branca e as tábuas, e a porta para a das tábuas — diferença zero por construção. Só dava para separar pelo tooltip. Medindo a diferença média por pixel (carvalho × bétula = 48 como régua legível): baú-topo × tábuas era **8,6**, bancada-topo **9,8**, fornalha × pedregulho **9,5**. Agora todos têm estrutura desenhada e ficam entre **28 e 120**. Custo: +6 camadas de atlas (121 → 127), +6 KB de VRAM, +0,7 ms no boot; meshing e geração de chunk sem mudança medível. Piso de legibilidade virou teste em `tests/texgen.test.ts` |
| 2026-09-11 | `entity/spawn.ts`, `docs/07` §4 | **A noite não tinha monstros.** O spawn funcionava e até saturava o cap, mas nenhum hostil chegava perto: o chunk sorteado precisava estar a **2 chunks** do jogador, o que empurrava todo spawn para ≥32 blocos — exatamente onde começa o despawn suave (1/800 por tick, ~40 s de vida). Todo hostil nascia condenado. Somado a isso, o Y era sorteado uniformemente de `minY` até a superfície, então com o chão em y≈68 ~2/3 nasciam dentro da pedra. Medido: de 151 hostis vivos, **zero** dentro dos 16 blocos do `followRange`, e 3 min andando de noite davam **0 encontros**. Agora a distância mínima é 1 chunk (a faixa de 24–32 blocos volta a existir) e 60% dos hostis noturnos nascem na superfície: **~20 encontros** nos mesmos 3 min, 149 de 154 na superfície. O doc 07 §4 foi corrigido junto — o comportamento antigo era o que ele especificava. Regressões em `tests/spawn.test.ts` |
| 2026-09-11 | `entity/spawn.ts` | `isValidSpot` media a distância ao jogador a partir do **canto** do bloco, mas `trySpawnPack` põe o mob no **centro** (`+0.5`): o piso de 24 blocos vazava meio bloco. Invisível enquanto tudo nascia a ≥32; apareceu assim que a faixa de 24–32 abriu. |
| 2026-09-11 | `docs/07` §4 | A tabela de caps do doc dava números à mão para T0 (passivo 8, aquático 3, ambiente 0) que o código nunca implementou: `capsForTier` deriva tudo de `maxMobs/70`, o que em T0 dá 4, 1 e 2. Decisão do usuário: **o código está certo, o doc é que estava errado**. A tabela agora traz as três colunas de tier com os valores reais e o porquê da proporção; `tests/spawn.test.ts` fixa os números exatos, então mudar a fórmula quebra o teste e obriga a mexer no doc. |
| 2026-09-11 | `entity/mobs.ts` | O creeper explodia com força 3 fixa. O doc 06 §10 promete **raio maior no Difícil** desde sempre e isso nunca foi implementado: força 4 (raio 5,2 contra 3,9) quando a dificuldade é 3. Coberto em `tests/mobs.test.ts` |
| 2026-09-11 | `data/mobs.ts`, `entity/ai/goals.ts`, `entity/mobstore.ts`, `entity/mobs.ts`, `game/session.ts` | O doc 06 §10 promete **zumbi arrombando porta no Difícil** e não havia nada — nem goal, nem traço, nem menção a porta em `entity/`. Novo goal `breakDoor`, com o tempo derivado da dureza do bloco (80 ticks por ponto → 12 s numa porta de carvalho) e o voxel removido pela `Session`, sem drop. Coberto em `tests/mobs.test.ts` e `tests/nightlife.test.ts` |
| 2026-09-10 | `public/sw.js`, `vite.config.ts` | **Instalar o PWA não garantia funcionar offline.** O precache eram três arquivos (`./`, `index.html`, `manifest`); o bundle e o worker de chunks só entravam no cache **depois** de terem sido baixados sob demanda. Instalar e ficar offline antes de abrir uma partida dava tela em branco. O build agora injeta a lista real de arquivos emitidos no `self.__CRAFTLITE_ASSETS__`, e o `install` guarda item a item (um `addAll` falha inteiro se um item falhar) |

---

## 5. Dependências entre pendências

**P1 fechada em 2026-09-14: a causa é o navegador, e não há correção do lado do jogo.**
Num Android, o sistema entrega os botões do controle como **tecla**, e o navegador fica com
algumas antes de a página ver — no Chrome, `L1` e `R1` **trocam de aba**. O painel de teste, que lê
`navigator.getGamepads()` cru, mostrou o DualSense com `mapping: 'standard'` e 17 botões e mesmo
assim os índices 4 e 5 nunca ficando `pressed`; um testador de joystick de fora do jogo confirmou,
trocando de aba ao apertar os mesmos botões. Instalar como PWA não muda. A mitigação já estava no
ar — **o direcional ←/→ troca o item** —, e agora a tela de Opções diz isso quando há controle
ligado.

**Não há mais pendência de funcionalidade em aberto.** O que resta é a dependência externa ao
código:

```
Teste em aparelho T0 real  ──►  fecha M3, M4, M5 e M6 de verdade
                           ──►  destrava declarar o MVP pronto (PROMPT.md §11)
```

O teste em celular atual (S24 Ultra, 2026-09-10) cobriu a **metade "ergonomia"** dessa dependência
e rendeu oito correções (§4).

**2026-09-12: a outra metade saiu do papel.** Um Galaxy J7 Metal (Android 7, 2 GB, Mali-T830) foi
classificado como T0 pelo `detectTier` — a regra de GPU móvel antiga em `core/tier.ts` pega a
família Mali-T8xx — e rodou a **60 FPS com render distance 4, escala 1,00 e render de 2,7 ms**,
num orçamento de 33,3 ms. O alvo do doc 02 era 30 FPS; o aparelho entregou o dobro, sem a escala
dinâmica precisar baixar nada. Heap em 20 MB e estável. O risco técnico declarado do projeto
**não se confirmou**: o gargalo de T0 não é o custo de frame.

O que a mesma sessão revelou foi pior e de outra natureza — três bugs de jogo, não de orçamento:
a aba **travava por completo ao voar** (loop infinito no `pump`), **nadar era impossível**, e o
livro de receitas/inventário estava quebrado no toque. Todos corrigidos (§4). Nenhum deles teria
aparecido em teste de FPS: são de lógica, e só um aparelho na mão de um jogador acha.

**A segunda sessão do mesmo dia fechou a lista.** Voo de 2 minutos sem travar, 15–20 mobs a
60 FPS, chuva e campo aberto em vários biomas sem problema, heap estável. **O M3 está fechado e o
critério 2 da definição de pronto (PROMPT.md §11) foi cumprido com folga:** o alvo era 30 FPS, o
aparelho entregou 60.

As **duas decisões de balanceamento** que ficaram abertas foram aplicadas em 2026-09-12, com o
aval do usuário, e estão no §4: T0 subiu para 2 workers (anel de RD 4 em 75 frames, não 149) e o
cap de mobs deixou de punir duas vezes (20/40/70, como o doc 02 §1 sempre disse).

**2026-09-13: as duas foram confirmadas em campo.** Relato do usuário sobre o mesmo Galaxy J7
Metal: *"eu já havia feito os testes no dispositivo T0, tudo funcionando perfeitamente e sempre a
60 FPS sem problema"*. Com isso **a dependência externa fechou por inteiro** e não sobrou nenhuma
pendência de marco anterior: M0 a M6 estão fechados e validados no aparelho-alvo.

A única coisa que resta é o M7, e dele o multijogador P2P saiu de escopo (ver §1). A ordem do
doc 14 continua valendo para o que ficou:

```
redstone ✅  ──►  Nether ✅  ──►  trilhos ✅  ──►  import/export ✅  ──►  resource pack ✅
```

**O M7 fechou em 2026-09-13**, e com ele os oito marcos do `PROMPT.md`.

**2026-09-16: abriu o M8**, a pedido do usuário e depois de uma revisão do código inteiro. Ele não
estava no `PROMPT.md` e não acrescenta mecânica: é o marco de **acabamento** que faz o que já
existe parecer o que é (§3). A parte entregue está fechada; o que ficou para depois está no
[doc 14](14-roadmap.md) como a lista não marcada do M8 — placa com texto, quadro com arte, escada
de mão com degraus, porta e alçapão nas outras madeiras, cama nas outras cores, baú que abre.
O doc 14 também ganhou **M9 (gente no mundo)** e **M10 (saber onde se está)** como propostas.

**2026-09-14: a lista de polimento também fechou.** Os dois blocos que o §6 carregava — as lacunas
do doc 08 (teclas, sliders de som, resto de Vídeo, Acessibilidade) e as "oportunidades pequenas"
(boneco, morcego, `sizeBytes`, grade de receita, canto de escada, miniatura, fogo, som no pack) —
foram entregues por inteiro, com teste. **Não sobrou pendência de funcionalidade em nenhum
documento normativo.**

No mesmo dia o usuário encerrou os outros dois itens que estavam abertos:

- **Teste em aparelho fraco:** *"não tenho mais em mãos o J7 Metal, mas já fiz testes no meu
  celular e computador e tudo funcionou — pode considerar concluído esse teste mesmo no dispositivo
  mais fraco"*. O critério 2 do PROMPT.md §11 já estava cumprido com folga na medição de
  2026-09-12 (60 FPS contra 30 de alvo).
- **Mundos corrompidos antes de 2026-09-13:** *"não precisa se preocupar com mundos antigos não, já
  foram recriados"*. O item sai da lista.

**O que ficou, e é de outra natureza:** nada do que foi entregue em 2026-09-14 **rodou num
aparelho**. Passe de nuvens, boneco, fogo, morcego e as vinte opções novas foram verificados por
teste e por tipo, não por olho — e o suporte a controle foi escrito contra um `Gamepad` falso, sem
nenhum controle físico na mesa. Ver §6.

**O que o Nether deixou pronto para quem vier depois:** `data/dimensions.ts` e o carimbo de
dimensão no protocolo do worker são genéricos — uma terceira dimensão é uma entrada na tabela e um
gerador. E `renderer.chunks.clear()`, que não existia, é o que qualquer troca de mundo precisa.

**2026-09-17: o M8 fechou** com os quatro itens que faltavam (§3), e a lista não marcada do doc 14
para ele ficou vazia. O que resta no roteiro são as duas propostas — **M9 (gente no mundo)** e
**M10 (saber onde se está)** —, nenhuma iniciada.

**E foi validado no mesmo dia, em aparelho.** O usuário rodou os cinco itens do roteiro de campo
(terreno, placa, baú, quadros e cama colorida) e relatou: *"todos os 5 testes passaram
perfeitamente"*. O único defeito foi da placa — a textura que escondia o texto e o editor de quatro
campos —, e os dois foram corrigidos na mesma sessão (§3, quinta passada). **Com isso o M8 e a
correção de terreno deixam de ter pendência de aparelho.** O que continua sem ter rodado em celular
é o que foi entregue em 2026-09-14 (§6).

**A pendência que este dia criou é de outra natureza: o mundo salvo.** A correção do terreno mudou a
função que gera altura, e terreno é função da seed. Quem já tem mundo vai ver uma **costura** entre
o que já foi gerado e o que ainda não foi — parede reta na fronteira. Não há migração possível e
não vale inventar uma: a saída é mundo novo.

**E sobrou uma folga menor no atlas.** As oito cores levaram o total de camadas de 181 para 212, de
um teto de 256 (doc 02 §3). Restam **44 camadas** para o que vier — o que dá para M9 e M10 como
estão propostos, mas não dá para uma segunda paleta de 16 cores.

**2026-09-22: a avaliação completa desmentiu este documento.** O parágrafo de 2026-09-14 acima
(*"Não sobrou pendência de funcionalidade em nenhum documento normativo"*) e o README diziam o
mesmo, e **não é verdade**. Conferido no código, item por item:

| Doc | O que pede | O que o código tem | Onde |
|---|---|---|---|
| 03 §9, 04 §2.1 | areia, areia vermelha e cascalho caem | a flag `gravity: true` está na tabela e **nenhum módulo a lê** | `data/blocks.ts:186–191`; `grep -rn "\.gravity" src` vazio |
| 03 §9 | lava fluindo + água = pedregulho | sai **pedra**; e os ids `1` e `19` estão literais | `world/fluids.ts:284`, `:299–300` |
| 05 §5, §6.3 | balde; lava como combustível | balde craftável que **não faz nada**; não há balde d'água nem de lava | `data/items.ts:199`, `data/recipes.ts:101` |
| 05 §6.3 | tesoura | o tipo `shears` existe e folha e lã o pedem; **o item não** | `data/blocks.ts:56` |
| 07 §1 | ovelha de cor, 15% rara | sempre branca | `data/mobs.ts:211` |
| — (renovabilidade) | cada árvore dá a sua muda | folha de bétula e pinheiro dão **muda de carvalho**; acácia nasce com folha de carvalho | `data/loot.ts:63–64`, `world/gen/decorate.ts` |
| 05 §4 | Fome por carne podre/frango cru; maçã dourada com Regeneração e Absorção | **não há sistema de efeitos** | `data/items.ts:220` |
| 05 §4 | maçã dourada, ensopado de cogumelo, biscoito, bolo | nenhum existe, nem o cogumelo | `grep -rli "cake\|cookie\|mushroom" src` vazio |
| 05 §5, §7 | bloco de carvão, pedra lisa | nenhum dos dois | — |
| 07 §1 | galinha põe ovo; enderman pega bloco | nem ovo como item, nem o carregar | — |
| 03 §7 | poço do deserto, cabana de bruxa, naufrágio | só dungeon, mina, casa e poço de aldeia | `data/structures.ts` |
| 08 §3.11 | menu raiz com **Idioma** | quatro seções, sem Idioma | `ui/screens/options.ts:292–296` |
| 14 (testes) | smoke test de navegador | não existe; só o `soak` | `scripts/` |

Nada disso é bug de regressão — são coisas que **nunca foram feitas** e que a revisão de
2026-09-14 não cruzou com as tabelas dos docs. Viraram o **M11** do doc 14 (o Idioma, por tamanho,
foi para o M17). A lição fica para quem declarar a próxima lista fechada: **cruzar tabela de doc
com `grep`**, não com memória da sessão.

**O que a avaliação confirmou que está bom:** orçamento de quadro (60 FPS em T0 com 2,7 ms de
render), bundle em 60% do teto, save com compressão e escrita ociosa, luz incremental com filas
pré-alocadas, lista de desenho sem alocação. A performance que falta é **de carregamento**, não de
quadro — e o PROMPT.md §4.2 pedia o culling por conectividade de sections como *"fortemente
recomendado"*, e ele não existe. Isso é o **M12**.

**2026-09-22, fim do dia: o M11 fechou** — os 13 itens e mais quatro achados no caminho (§3). A
lista de dívida normativa da tabela acima está vazia, com uma exceção declarada: o menu **Idioma**,
que foi para o M17 por tamanho. O que o M11 deixou pronto para os próximos: o registro de uso de
item (primeiro item do M13), o sistema de efeitos (as poções do M16) e o smoke test (que roda em
qualquer marco daqui em diante).

**O roteiro inteiro, em ordem recomendada** (detalhe e critérios no doc 14):

```
M11 dívida normativa ──► M13 casa em ordem ──► M12 carregamento ──► M9 gente ──► M10 localização
                              └── folga de atlas ──► M14 água ──► M15 oficina ──► M16 fim da jornada
M17 alcance (idioma e primeira hora) em paralelo com qualquer um.
```

---

## 6. Próximo passo recomendado

0. **Olhar o M9 num aparelho, de novo, num mundo novo** e depois seguir o roteiro: **M10** (saber
   onde se está — bússola, relógio, mapa). A primeira volta de campo achou a aldeia pela metade e
   o aldeão parado na porta (§4, 2026-09-23 13:55); a aldeia certa só nasce em terreno gerado
   depois da correção. Em ordem de quanto pode estar errado:
   - **aldeia inteira**: poço com sino, golem, 3 a 8 aldeões, e de manhã eles alternando entre o
     posto de trabalho e o poço — nenhum parado na porta;
   - **entardecer**: achar uma aldeia (a semente `2` tem uma com o poço em x 282, z 340), esperar o
     fim da tarde e ver os aldeões entrarem, fecharem a porta e deitarem. Se algum travar num canto,
     o número é `STUCK_TICKS` em `entity/ai/villagegoals.ts`;
   - **troca**: clique direito num aldeão (com e sem item na mão), duas trocas, e a tela com o
     desenho dos itens legível no celular. **No Modo A de toque**, conferir que o toque no aldeão
     abre a troca;
   - **golem e reputação**: bater num aldeão perto do golem — ele tem que vir atrás do jogador —,
     e as trocas fechadas até o dia seguinte;
   - **sino**: tocar e ver todo mundo correr para casa;
   - **morcego nas cavernas e porco zumbi no Nether**: voltaram a ser eles mesmos (§4) — o morcego
     não pode mais atirar bola de fogo;
   - **mob subindo degrau**: um zumbi perseguindo morro acima tem que subir, não empacar.

   ~~**Olhar o M12 num aparelho**~~ — **feito em 2026-09-23**: *"M12 testado com sucesso"*. O
   roteiro que foi seguido, para referência:
   - **buraco no mundo**: voar por cima de montanha, entrar numa caverna, sair dela, cavar uma
     parede de uma caverna para outra. Nenhuma section pode sumir e reaparecer. Se sumir perto,
     o número é `NEAR_COLUMNS` em `render/sectioncull.ts`; se o anel distante demorar a aparecer,
     `FAR_REFRESH_FRAMES`;
   - **face faltando**: andar em volta de um morro e olhar de baixo de uma ponte — o culling por
     face só deveria cortar o que está de costas;
   - **luz na divisa**: lava ou boca de caverna cruzando a borda de um chunk (F3 mostra a grade);
   - **velocidade**: com o F3 aberto, criar um mundo e voar reto; comparar o "na fila" e quanto o
     anel demora a fechar com o que se lembrava. Num T0, conferir se o RD 5 cabe (§5).

   ~~**E olhar M11 e M13 num aparelho**~~ — **feito em 2026-09-23**: *"Deu tudo certo nos testes
   do M11 e M13"*, junto com a correção das texturas de pé (flor, muda, grama alta). O roteiro que
   foi seguido, para referência:
   - **a correção de 2026-09-23 (textura de pé)**: flor, muda, grama alta e trigo de pé; e, como a
     mesma regra vale para todo bloco, conferir **tocha** (brasa em cima), **fornalha** (boca na
     metade de baixo), **bancada** (tampo em cima), **baú** (tampa em cima), **porta** (maçaneta
     no meio) e o bloco na mão. Nenhum deles foi visto depois da troca — o navegador headless do
     smoke não redesenhou a cena editada;
   - **lã e cama coloridas**: o tint é novo no shader. Colocar as 16 lãs lado a lado e uma cama de
     cada cor; na cama, a madeira e o travesseiro **não** podem sair coloridos. Se a cor sair
     lavada ou escura demais, o número é o `DYE_BASE` de `data/tints.ts`;
   - **mundo novo**: nascer em terra, com árvore à vista;
   - **areia caindo**: cavar debaixo de uma coluna na praia;
   - **plantar uma muda** e esperar ~2 min; cana na beira d'água; caminho pisado voltando a verde
     (`chance` em `data/plants.ts`, `GRASS_SPREAD_CHANCE` em `world/growth.ts`);
   - **balde**: fonte infinita e gerador de pedregulho; **no Modo A de toque**, conferir que o balde
     pega a água onde o dedo aponta;
   - **ovelha**: tosquiar e tingir; **maçã dourada**: os corações dourados e o selo de efeito
     (`ui/effectsbar.ts`) sem cobrir o HUD de toque; **bolo**: comer fatia por fatia.

1. ~~**Criar um mundo novo e voar.**~~ ~~**Olhar as quatro peças novas do M8 num aparelho.**~~
   **Feitos em 2026-09-17**: *"todos os 5 testes passaram perfeitamente"*. Terreno, placa, baú,
   quadros e cama colorida foram vistos em aparelho. O único defeito foi da placa — textura que
   escondia o texto e editor de quatro campos — e saiu na mesma sessão (§3, quinta passada).
   **O que ainda não foi visto da placa é a correção dela**: reabrir o editor num celular,
   escrever uma frase corrida e conferir que a prévia mostra a quebra que a placa vai fazer, e que
   `Ctrl+Enter` confirma. Se a letra estiver pequena demais para ler de longe, o número é
   `SIGN_COLUMNS` em `game/signs.ts` — menos colunas, letra maior.

2. **Olhar o resto do M8 num aparelho.** Mexeu no **formato de vértice**, que é o caminho por onde
   passa cada triângulo do mundo. Os testes provam a aritmética; o que eles não provam é que a tela
   está certa. Em ordem de quanto pode estar errado:
   - **uma cerca isolada e uma grade de vidro.** São as duas peças que literalmente **não
     existiam** antes desta sessão — o poste colapsava para largura zero. Se alguma coisa
     regrediu no formato de vértice, é aqui que aparece primeiro, e aparece como buraco;
   - **uma tocha na parede e uma no chão**, de perto. A de parede tem que **inclinar** para longe
     da parede, e a ponta tem que soltar fagulha de vez em quando. Se a chama parecer fria demais
     ou animada demais, o número é o `2` de sondas por tick em `main.ts`;
   - **uma porta**: colocar, abrir, fechar, quebrar pelo topo e quebrar pela base. Nos quatro
     casos a porta inteira tem que sumir, e uma porta só tem que cair no chão;
   - **uma cama**: colocar (a cabeceira vai para longe de quem coloca), subir em cima dela, dormir
     clicando no pé **e** na cabeceira, e explodir uma das metades com creeper;
   - **a mão**: pegar picareta, espada e tocha e olhar de lado. O item tem espessura agora; se
     algum deles piscar ou desaparecer em certo ângulo, o número é `SPRITE_THICKNESS` em
     `render/hand.ts`;
   - **o contorno branco**: mirar uma laje, uma tocha e uma escada. O contorno é do tamanho da
     peça, não mais um cubo;
   - **uma aldeia**, se aparecer: tocha na parede, cama deitada para dentro, porta com duas folhas;
   - **uma janela de vidro**, de perto e de longe: a moldura tem que aparecer e o miolo tem que
     continuar sendo buraco. Duas vidraças lado a lado formam grade, que é o desenho certo;
   - **um poço com escada de mão**: descer, subir empurrando para a frente, parar no meio agachado.
     Se a subida parecer lenta ou rápida demais, o número é `CLIMB_SPEED` em `entity/player.ts`;
   - **um baú e uma fornalha**: o baú agora é menor que o bloco e tem tranca; a fornalha acende a
     boca **e ilumina em volta** enquanto queima;
   - **o inventário inteiro, de uma olhada só**. É o teste mais rápido desta passada: abrir o
     inventário criativo e percorrer as abas. Nenhum par de itens diferentes pode sair com o mesmo
     desenho — cerca, laje, placa, alçapão e escada eram todos o mesmo cubo de tábua, e abóbora e
     melancia eram tábua também. Flor, muda, samambaia e cana agora aparecem como a planta, não
     como cubo.
3. **Reconferir os menus com o controle**, que é o que mudou mais na passada anterior:
   - **o foco tem que aparecer.** Empurrar o direcional numa tela precisa acender um anel amarelo
     no item escolhido. Se ele não acender, nada mais dessa lista importa — era essa a causa de
     *"indo para botões nem existentes em tela"*;
   - **criar um mundo só de controle**, indo até o seletor de modo e trocando para Criativo. É o
     caminho que o usuário relatou como impossível;
   - **abrir o inventário criativo no celular** e pegar itens: o teclado virtual **não** pode
     subir sozinho, e o analógico tem que andar entre as casinhas;
   - **pegar o controle com a tela já aberta no dedo**: o primeiro aperto mostra onde o foco está
     e não aperta nada.
4. ~~**Olhar em volta, e só isso.**~~ **Validado em campo em 2026-09-14**: a câmera por quadro e o
   Modo A que não acende mais o anel durante o arrasto foram confirmados no celular e no
   computador. Se a velocidade do analógico incomodar, o número é `padSensitivity` nas opções.
5. **Trocar de modo pela pausa** e conferir que sair e voltar ao mundo devolve o modo aplicado.
   No Criativo, vida, ar, fome e armadura somem do HUD; no Sobrevivência voltam — e a fome agora é
   uma coxa de frango, não um retângulo.
6. **Jogar o que foi entregue em 2026-09-14.** É o único item com risco real: vinte opções novas,
   um passe de render novo, um sistema de mundo novo e um mob novo — nenhum deles viu um aparelho.
   O que olhar, em ordem de quanto pode estar errado:
   - **Nuvens.** Elas são o único desenho que nunca foi visto. Conferir se a forma lê como nuvem e
     não como mancha, se a borda do plano some antes de virar quadrado, e o custo de preenchimento
     num celular — o plano cobre boa parte do céu e a GPU móvel cobra por pixel. Ligar em
     Opções → Vídeo → Nuvens (o padrão de T0 é desligado, de propósito).
   - **Fogo.** Acender com o isqueiro num campo de grama alta e ver o incêndio andar. O que
     precisa acontecer: ele **acaba** (sem combustível a chama morre em segundos), a chuva apaga, e
     a linha `E:` do F3 mostra `N fogo` sem chegar perto de 256. Se ele parecer lento demais ou
     rápido demais, o número a mexer é a divisão por 300 em `trySpread`.
   - **Canto de escada.** Construir um L de escadas e olhar os dois cantos. É o item cuja regra foi
     **derivada e não copiada** — se algum canto sair girado 90°, é aqui. Andar por cima também: a
     colisão sai da mesma conta, então um erro aparece nos dois ao mesmo tempo.
   - **Boneco do inventário.** Vestir as quatro peças e ver se o tom de cada uma aparece na parte
     certa do corpo.
   - **Modo daltônico e contorno em alto contraste**, que são acessibilidade e só se avaliam
     olhando.
7. **Reconferir a quebra.** Um clique — de mouse ou de dedo — tem que derrubar **um** bloco, no
   criativo e no sobrevivência; segurando, o ritmo é de ~4 por segundo. E as plantas passaram a ser
   miráveis: grama alta, flores, mudas e cana agora quebram. Vale conferir que **minerar pedra não
   ficou mais lento** — é o que o intervalo foi desenhado para não fazer.
8. **Reconferir o toque no celular.** O padrão agora é o **Modo B**, que é o que já funcionava —
   então o primeiro teste é confirmar que nada regrediu nele. Depois vale voltar ao **Modo A** nas
   opções e ver se ele ficou utilizável: colocar e quebrar agora miram no **mesmo** lugar (o dedo),
   a mira central some, a folga de arraste dobrou, e arrastar para mirar e então segurar passou a
   funcionar em vez de travar o dedo. Se ainda falhar, o número a mexer é `HOLD_SLOP` em
   `input/touch.ts`.
9. **Reconferir o inventário no celular.** As duas correções de 2026-09-14
   vieram de relato de campo e voltam para lá:
   - **toque longo num slot** pega metade com a mão vazia e solta uma unidade com a mão cheia.
     Montar uma receita de tábua por célula é o teste que importa. A dica aparece no painel, e o
     gesto usa o `longPressMs` das opções — quem achar lento demais baixa lá;
   - **largar item** agora arremessa na direção do olhar, e o que foi jogado fora só volta a ser
     coletável depois de dois segundos. Vale largar olhando para o chão e para uma parede, que é
     onde o arremesso sozinho não resolveria.
10. **Voltar ao DualSense.** O reconhecimento por Bluetooth e a navegação básica já foram
   confirmados em 2026-09-14; o que ainda não viu aparelho é a segunda passada. Em ordem de
   quanto pode estar errado:
   - **O cursor do analógico direito** com o inventário aberto. É o item novo e o mais fácil de
     sair errado: conferir se a seta anda no ritmo certo (950 px/s — muito rápido cansa a mira,
     muito lento irrita), se ela some ao usar o direcional, e se encostar numa casinha **foca** ela
     de verdade. Se a velocidade incomodar, o número é `SPEED` em `input/uicursor.ts`.
   - **`L2` como clique direito** num slot: com a mão vazia pega metade da pilha, com a mão cheia
     solta uma unidade. É o que torna o inventário de controle utilizável para montar receita.
   - **A navegação espacial**: da grade de criação, um toque para a direita tem que cair na
     mochila. E, dentro da mochila, para baixo tem que descer a coluna e não pular de linha.
   - **`□` abre a mochila** e não coloca mais bloco; colocar é `L2` e quebrar é `R2`.
   - **`Start`**: um aperto, uma vez. É a correção mais direta da sessão e a mais fácil de
     verificar.
   - **Cabo contra Bluetooth**: o mesmo controle pode reportar `id` diferente nos dois modos, e é
     o `id` que escolhe o perfil. O Bluetooth já foi; falta o cabo.
   - **Um controle de Xbox**, se aparecer um: a família inteira foi escrita sem nunca ter sido
     ligada.
   - **No celular**, lembrar que ligar o áudio e a tela cheia exigem um toque na tela — o controle
     não serve de gesto para o navegador. O jogo avisa isso ao conectar.
11. **Uma sessão longa jogando de verdade.** A metade mecânica do critério está cumprida:
   `npm run soak` rodou 92,5 min de voo contínuo sem um erro, e os números estão no §2 e no §3.
   O que o robô **não** cobre, e é o que sobra: uma sessão longa **jogando** — inventário,
   construção, morte e volta, troca de dimensão —, e principalmente **no celular**, que é onde o
   orçamento é apertado. Vale também deixar o `npm run soak` fechar os 120 min uma vez, já que a
   primeira execução parou aos 92 por decisão de quem estava na máquina.
12. ~~**Medir o tempo de abertura em 3G.**~~ **Feito em 2026-09-14**: 4,48 s no 3G rápido, dentro
   dos 5 s do critério (§2 e §3). O que sobrou como pergunta em aberto é a **outra metade do
   tempo**: ~2 s entre o documento pronto e a tela de título são CPU de boot, medidos num desktop.
   Vale repetir a medida no celular, porque é essa metade que cresce num T0 — e é ela, e não o
   tamanho do bundle, que decide se o critério continua cumprido.
13. Oportunidades pequenas que sobraram, agora curtas:
   - **`.clw` com miniatura** já funciona, mas nenhum arquivo real foi exportado e reimportado
     desde a mudança para a v2 — é um teste manual de cinco minutos;
   - **som no resource pack** foi testado por formato, nunca com um `.ogg` de verdade num
     navegador: falta confirmar que o `decodeAudioData` aceita o que o jogador vai pôr lá;
   - **fogo em mob**: o `fireTicks` de `entity/mobs.ts` existe e a chama não o liga — mob atravessa
     o incêndio sem pegar fogo. O jogador queima, o zumbi não;
   - **variante de escada em quina de três**: o gênero tem um caso a mais (canto bloqueado por uma
     terceira escada) que não foi implementado; ele aparece só em construção elaborada;
   - **segundo controle**: o jogo usa o primeiro conectado e ignora o resto. Enquanto não houver
     multijogador local (fora de escopo, §1), não há o que fazer com o segundo.

---

## 7. Como manter este documento

Ao terminar qualquer entrega — marco, correção ou ajuste:

1. Atualize a linha do marco na tabela do §1 e o detalhe no §3.
2. Se a mudança criou ou fechou pendência, mexa na tabela do marco e no §5.
3. Se corrigiu bug de marco anterior, acrescente linha no §4.
4. Refaça as métricas do §2 (`npm test`, `npm run build`, `npm run size`).
5. Registre os arquivos tocados em [16-auditoria.md](16-auditoria.md).
6. Atualize a data de "Última atualização" no topo.
