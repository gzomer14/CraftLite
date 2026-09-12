# 15 — Status do projeto

> **Este é o documento de entrada de qualquer sessão de desenvolvimento.**
> Quem chega sem contexto lê este arquivo primeiro: ele diz o que está pronto, o que ficou
> pendente, o que depende de quê e qual é o próximo passo. O histórico de quem mexeu em qual
> arquivo está em [16-auditoria.md](16-auditoria.md).
>
> Os outros documentos (00 a 14) são **normativos**: descrevem o que o jogo deve ser e não mudam
> conforme a implementação anda. Este aqui é **descritivo**: reflete o estado real do código e é
> atualizado ao fim de cada entrega.

**Última atualização:** 2026-09-12 11:14 — **perseguição de mobs: velocidade da tabela não era atingida, e a tabela era lenta demais**

---

## 1. Panorama

| Marco | Entrega | Status | Pendências |
|---|---|---|---|
| **M0** Esqueleto | Vite + TS, WebGL2/1, tier, loop 20 Hz, texturas procedurais, debug | ✅ concluído | — |
| **M1** Mundo visível | chunks paletizados, ruído + splines, 10 biomas, cavernas, minérios, greedy meshing, frustum culling, céu e fog | ✅ concluído | — |
| **M2** Interação | física do jogador, raycast, quebrar/colocar, hotbar, luz por flood fill, dia/noite | ✅ concluído | — |
| **M3** Mobile | toque completo, HUD responsivo, presets por tier, escala dinâmica, PWA offline | ✅ **validado em T0 real (J7 Metal): 60 FPS, RD 4, escala 1,00, heap estável** | — |
| **M4** Sobrevivência | inventário 46 slots, crafting, fornalha, baú duplo, ferramentas, vida/fome, itens no chão, fluidos, save ligado, telas de mundo e opções, sprites de item, livro de receitas, inventário criativo | ✅ concluído | — |
| **M5** Vida no mundo | 12 mobs com IA/animação/spawn, combate, armadura, cama, som procedural, árvores e plantas | ✅ concluído | confirmar densidade de hostis no aparelho |
| **M6** Profundidade | agricultura, reprodução, XP, encantamento, estruturas, clima, arco, conquistas | ✅ concluído | — |
| **M7** Extras | redstone, Nether, trilhos, multiplayer P2P, import/export, resource packs | ⬜ não iniciado | — |

Legenda: ✅ pronto · ⚠️ pronto com débito · 🚧 em andamento · ⬜ não iniciado

---

## 2. Métricas atuais

Medidas em 2026-09-12 11:14, com `npm test`, `npm run build` e
`SIZE_BUDGET_KB=350 npm run size`.

| | Valor | Orçamento | Fonte |
|---|---|---|---|
| Bundle (gzip, tudo) | **149,0 KB** | < 350 KB | `npm run size` |
| Testes | **948**, 57 arquivos | manter verde | `npm test` |
| Geração de chunk | 6–14 ms (mediana; varia muito com a carga da máquina) | < 25 ms | `tests/perf.test.ts` |
| Meshing de section | 0,6–1,5 ms (mediana) | < 8 ms | `tests/perf.test.ts` |
| Tick de 20 mobs | 0,14 ms | << 50 ms | `tests/mobs.test.ts` |
| FPS em T0 real (2017) | **60**, RD 4, escala 1,00 (Galaxy J7 Metal) | 30 estáveis | teste manual |
| Render em T0 | **2,7 ms** de 33,3 ms de orçamento | ≤ 8 ms (soma do doc 02 §2) | overlay F3 no aparelho |
| Heap em T0 | **20 MB**, estável na sessão | sem crescimento | overlay F3 no aparelho |
| FPS em celular atual | 60 (S24 Ultra, relato do jogador) | — | teste manual |

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

### M7 ⬜
Não iniciado. Ver checklist em [14-roadmap.md](14-roadmap.md).

---

## 4. Correções fora de marco

Bugs anteriores encontrados durante o M5 e já corrigidos — ficam registrados porque explicam
mudanças em código de marcos "fechados":

| Data | Onde | O que era |
|---|---|---|
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

**Não há mais pendência de funcionalidade em aberto até o M7.** O que resta é a dependência
externa ao código:

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
cap de mobs deixou de punir duas vezes (20/40/70, como o doc 02 §1 sempre disse). Falta **medir as
duas no aparelho**: a geração deve acompanhar quem anda, e a caverna deve ter bicho.

O M7 pode começar.

---

## 6. Próximo passo recomendado

1. **Confirmar em campo as duas mudanças de balanceamento de 2026-09-12** (§4), no mesmo
   Galaxy J7 Metal: (a) andar e voar em terreno novo, vendo se a geração acompanha agora com 2
   workers — a coluna "na fila" da linha `C:` do overlay é o termômetro; (b) descer numa caverna e
   ver se aparece hostil, agora que o cap de T0 subiu de 8 para 20 e o Y de spawn segue o jogador.
   As duas foram medidas em teste, **nenhuma foi medida no aparelho**.
2. **Começar o M7**, na ordem do doc 14: redstone básico, Nether, trilhos e carrinho, multijogador
   P2P (doc 12), import/export de mundos e resource pack.
3. **Rever o teto de 128 camadas de atlas no doc 02 §3.** Está em **127 de 128** depois das
   texturas novas: a próxima textura estoura a linha. A linha é arbitrária — vale 0,13 MB dentro
   de um alvo de 350 MB de RSS — e o GLES 3.0 garante no mínimo 256 camadas de array em qualquer
   aparelho, então 256 caberia em ~0,34 MB. Decisão de doc, não de código.
4. **O que a revisão de UX levantou e ficou para depois**, todos da tabela de Vídeo do doc 08 ou
   das listas de Controles/Som:
   - **remapeamento de teclas** (doc 08, Controles: "lista completa de teclas remapeáveis, conflito
     em vermelho") — hoje as teclas são fixas em `input/controls.ts`;
   - **sliders de som por categoria**: o doc pede 9 (Principal, Música, Blocos, Mobs Hostis, Mobs
     Amigáveis, Jogadores, Ambiente, Clima, Interface), existem 2 — falta categoria no
     `audio/engine.ts` antes de a tela poder oferecer;
   - resto da tabela de Vídeo: Distância de Simulação, VSync, Gráficos (Rápido/Bonito), Nuvens,
     Partículas, Névoa, Balanço de Câmera, Mostrar FPS;
   - resto da Acessibilidade: modo daltônico, contorno de bloco em alto contraste, esconder flashes
     do céu, efeitos de distorção.
5. Oportunidades pequenas que sobraram:
   - **boneco 3D do jogador** na tela de inventário: o doc 08 §3.5 desenha um preview do modelo
     ao lado dos slots de armadura, e ele nunca foi feito — hoje a seção Equipamento é só a fila
     de slots. O doc já prevê sprite estático como saída para T0;
   - **morcego**: o doc 07 §4 lista a categoria `ambient` com cap próprio, mas **não existe
     nenhum mob `ambient` no código** — é a única linha da tabela de spawn sem nada atrás dela;
   - miniatura do mundo na tela de seleção (o doc 11 §1 prevê `STORE_THUMBS`, que existe e está vazio);
   - `sizeBytes` da meta do mundo, hoje sempre 0;
   - painel de receitas mostrando **a grade** da receita, não só o resultado;
   - variante de canto da escada (`inner`/`outer`), se o orçamento de T0 permitir;
   - barco não vai para o save: sair do mundo e voltar deixa o barco onde ele estava? Não — ele
     some, porque `Boats` não é serializado.

---

## 7. Como manter este documento

Ao terminar qualquer entrega — marco, correção ou ajuste:

1. Atualize a linha do marco na tabela do §1 e o detalhe no §3.
2. Se a mudança criou ou fechou pendência, mexa na tabela do marco e no §5.
3. Se corrigiu bug de marco anterior, acrescente linha no §4.
4. Refaça as métricas do §2 (`npm test`, `npm run build`, `npm run size`).
5. Registre os arquivos tocados em [16-auditoria.md](16-auditoria.md).
6. Atualize a data de "Última atualização" no topo.
