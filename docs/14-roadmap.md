# 14 — Roadmap, Marcos e Critérios de Aceite

Ordem de execução pensada para que **exista algo jogável cedo** e para que o risco técnico maior
(performance em celular fraco) seja atacado no começo, não no fim.

> **Regra de ouro:** ao fim de cada marco, testar em um celular real de baixo desempenho antes de
> seguir. Se o marco não bate a meta de FPS, otimizar antes de adicionar conteúdo.

---

## M0 — Esqueleto e renderizador (a fundação)
**Entregar:** um cubo texturizado girando na tela, com o loop de jogo e o debug overlay.

- [ ] Vite + TypeScript strict, target es2017, build com report de tamanho.
- [ ] Canvas em tela cheia, contexto WebGL2 com fallback WebGL1, detecção de tier.
- [ ] Loop fixo 20 Hz + render por rAF com interpolação.
- [ ] Gerador procedural de texturas + `TEXTURE_2D_ARRAY`.
- [ ] Overlay de debug com FPS e gráfico de frame time.

**Aceite:** 60 FPS em desktop, 60 em celular, bundle < 60 KB gzip.

---

## M1 — Mundo de voxels visível
**Entregar:** um terreno gerado que dá para olhar e voar por cima.

- [ ] Estrutura de chunk com paleta, sections e sentinela de section vazia.
- [ ] Ruído (Perlin/Simplex + FBM + domain warp) e geração de heightmap.
- [ ] Greedy meshing binário no worker.
- [ ] Frustum culling + pipeline de carregamento por prioridade.
- [ ] Câmera livre (voo) com mouse + teclado.
- [ ] Céu com gradiente e fog.

**Aceite:** render distance 8 a 60 FPS no desktop; **render distance 4 a 30 FPS no T0**;
sem hitch visível ao voar em linha reta por 2 minutos.

---

## M2 — Jogador e interação
**Entregar:** dá para andar, pular, quebrar e colocar blocos.

- [ ] Física do jogador com as constantes do doc 06 (sweep AABB, auto-step, atrito).
- [ ] Raycast DDA + contorno de seleção.
- [ ] Quebrar com tempo/estágios/partículas; colocar com rotação automática.
- [ ] Hotbar com 9 slots e seleção.
- [ ] Iluminação: skylight + block light com flood fill incremental, AO no meshing.
- [ ] Ciclo dia/noite.

**Aceite:** colocar uma tocha atualiza a luz em < 16 ms; a sensação de andar/pular bate com a
referência (testar pulando em blocos de 1 e 1.5 de altura).

---

## M3 — Mobile jogável (marco crítico — não pular)
**Entregar:** o jogo roda e é jogável **de verdade** num celular antigo.

- [ ] Controles de toque completos (joystick, câmera, quebrar/colocar, modo A e B).
- [ ] Layout de HUD responsivo com safe areas, fullscreen + lock de orientação.
- [ ] Presets automáticos por tier + escala dinâmica de resolução.
- [ ] PWA instalável, service worker, funciona offline.

**Aceite:** 30 FPS estáveis com render distance 4 em um aparelho de 2016–2018, jogando por
10 minutos sem crash e sem crescimento de memória (checar no perfil de heap).

---

## M4 — Sobrevivência
**Entregar:** o loop de jogo completo.

- [ ] Inventário 46 slots com **todas** as interações de slot do doc 08 §3.5.
- [ ] Crafting 2×2 e 3×3, matcher shaped/shapeless com espelhamento, livro de receitas.
- [ ] Fornalha, baú, baú duplo (tile entities + persistência).
- [ ] Ferramentas com tier, durabilidade e velocidade de quebra correta.
- [ ] Vida, fome, saturação, exaustão, dano, morte, respawn.
- [ ] Item entities (drop, merge, coleta, despawn).
- [ ] Água e lava com espalhamento.
- [ ] Salvar/carregar em IndexedDB, tela de seleção e criação de mundos.

**Aceite:** é possível começar do zero, cortar madeira, craftar picareta de pedra, minerar ferro,
fazer fornalha, cozinhar comida e dormir — sem bugs bloqueantes.

---

## M5 — Vida no mundo
- [ ] Mobs passivos e hostis com modelos, animação procedural e IA por goals.
- [ ] Spawn/despawn com caps por tier; pathfinding com orçamento.
- [ ] Combate: dano, knockback, cooldown de ataque, invulnerabilidade.
- [ ] Cama (definir spawn, pular a noite), armadura.
- [ ] Sons procedurais completos.
- [ ] Biomas (10) com blend e tint; cavernas e minérios balanceados.

**Aceite:** a primeira noite é assustadora e justa; 20 mobs não derrubam o FPS abaixo de 28 no T0.

---

## M6 — Profundidade
- [ ] Agricultura (trigo, cenoura, batata), reprodução de animais.
- [ ] XP, encantamento simplificado (mesa + níveis + 8 encantamentos).
- [ ] Estruturas: dungeon, aldeia, ravina, mina.
- [ ] Clima (chuva, tempestade), fases da lua.
- [ ] Barco, arco e flecha, escudo.
- [ ] Placas, quadros, cercas, portões, alçapões, escadas/lajes de todos os materiais.
- [ ] Conquistas/avanços com toasts.

---

## M7 — Extras
- [ ] Redstone básico (dust, tocha, botão, alavanca, placa de pressão, porta, pistão, repetidor).
- [ ] Nether (dimensão, portal, netherrack, ghast/zombified piglin).
- [ ] Trilhos e carrinho de mina.
- [ ] Multijogador P2P (doc 12).
- [ ] Import/export de mundos.
- [ ] Suporte a resource pack customizado.

---

## M8 — Presença dos objetos

> Acrescentado em 2026-09-16, a pedido do usuário: *"gostaria que você fizesse uma revisão
> completa no código (…) as texturas chapadas das ferramentas, a tocha que não parece uma tocha,
> a cama e a porta que são blocos únicos"*. É um marco de **acabamento**, não de conteúdo: nada
> aqui acrescenta mecânica, tudo aqui faz o que já existe parecer o que é.

A causa-raiz dos três sintomas era a mesma e estava no formato de vértice: a posição era
guardada em **meios-blocos**, então toda caixa mais fina que 0,5 colapsava no arredondamento.
Poste de cerca, grade, porta, botão, alavanca, placa de pressão e o levantamento do trilho eram
planos de espessura zero — não faltava textura, faltava **volume representável**.

- [x] Posição do vértice em **1/16 de bloco** (9 bits por eixo), sem sair dos 8 bytes.
- [x] Textura **por face** nas formas de caixa (o topo da laje deixa de usar o desenho da lateral).
- [x] **Tocha** como poste de 2/16, com encaixe de chão e de parede, inclinada na parede, com
      fagulha saindo da brasa.
- [x] **Porta e cama** ocupando duas células, com as metades nascendo e morrendo juntas por
      qualquer causa (jogador, explosão, fogo, pistão).
- [x] **Item na mão extrudado**: frente, verso e uma borda por aresta da silhueta.
- [x] **Contorno do bloco mirado** do tamanho da forma, e não sempre um cubo.
- [x] Bloco que exige apoio cai quando o apoio some, **mesmo sem ser de redstone** (trilho comum,
      tocha).
- [x] **Vidro visível.** Ele era desenhado com alfa 0,28 no passe **recortado**, cujo shader
      descarta tudo abaixo de 0,5: nenhum pixel sobrevivia e uma janela colocada não deixava rastro
      na tela. Virou moldura opaca com reflexo em diagonal e miolo vazado — vê-se através e vê-se
      que existe.
- [x] **Escada de mão** com dois montantes e três degraus, e **que escala**: ela era decoração, o
      jogador atravessava como se fosse ar.
- [x] **Baú** com corpo, tampa e tranca, menor que o bloco.
- [x] **Fornalha acesa**: dois ids como a lâmpada de redstone, com emissão 13 e a boca em brasa.
- [x] Porta nas outras madeiras (bétula e pinheiro), com receita por material — a genérica de
      `#planks` dava porta de carvalho com tábua de bétula.
- [x] **Sprite do inventário segue a forma do bloco.** Ele desenhava sempre um cubo: cerca, laje,
      placa, alçapão, escada e portão são todos de tábua e viravam **o mesmo desenho**. Agora a
      silhueta sai de `boxesFor`, a mesma lista que o mundo desenha; planta e trilho aparecem como
      o próprio ladrilho, de frente.
- [x] **Texturas emprestadas.** Abóbora e melancia eram literalmente `block/oak_planks`; muda,
      samambaia, cana e arbusto seco dividiam a grama alta; acácia usava carvalho. Cada uma tem a
      sua.
- [x] **Fornalha com cara de fornalha** (boca, grelha e moldura) e **baú que não se confunde com a
      bancada** — a separação é de valor, não de detalhe.
- [x] **Placa com texto escrito pelo jogador.** Fonte 5×7 em `data/font.ts` (acento é composição,
      não glifo), folha de 128×128 gerada por código, texto guardado por posição e desenhado num
      passe próprio — um quad por glifo, como os mobs. Não entra no mesh do chunk porque é
      **por instância**: duas placas do mesmo bloco escrevem coisas diferentes.
- [x] **Quadro com arte gerada por código.** Quatro telas escritas com o operador `pattern` —
      paisagem, girassol, caveira e montanha à noite — escolhidas pela **posição** do bloco, nos
      bits 2–3 do estado. Era um desenho só, e uma parede de quadros repetia a mesma imagem.
- [x] **Cama nas outras cores**, e as lãs que faltavam: oito cores saindo de `data/dyes.ts`, com
      corante, lã, cama e receitas derivados dela. A cama colorida não custou **uma linha** de
      lógica: dormir e morrer em duas metades saem de `shape: 'bed'` e de `multi`.
      Oito e não dezesseis por orçamento de atlas — cada cor custa quatro camadas e o teto é 256.
- [x] **Tampa do baú que abre de verdade.** ~~Exige rotação, e a geometria do jogo é de caixas
      alinhadas aos eixos (doc 04 §3); precisa de um segundo formato de vértice para existir.~~
      **Não precisava.** O mesher já escreve quad de quatro cantos arbitrários (`addPolyQuad`) —
      é assim que a tocha de parede fica torta e que a rampa de trilho existe. O formato de vértice
      guarda **posição**, não transformação: a tampa girada é a mesma caixa com os oito cantos
      rodados na CPU, na hora de meshar. Abrir é um bit no estado do bloco e um remesh de uma
      section; a animação quadro a quadro é que custaria caro, e por isso o ângulo é binário.

**Critério de aceite:** num aparelho, olhar de perto uma tocha de parede, uma cerca isolada, uma
porta fechada, uma janela de vidro e uma picareta na mão, e não conseguir apontar nenhuma peça
"chapada" nem invisível. Descer um poço de escada sem cair. Ler uma placa escrita. Orçamento de
meshing intocado: uma section com um piso de 256 tochas continua abaixo de 2 ms. **Falta só a
parte do aparelho** — o resto está entregue e medido (doc 15 §2 e §3).

---

## M9 — Gente no mundo

> Proposta de 2026-09-16. Depende do M8 só no espírito: primeiro as coisas parecem coisas,
> depois o mundo fica habitado.

- [ ] **Aldeão** com profissão, rotina de dia e noite (trabalha, dorme na cama, entra em casa ao
      anoitecer) e troca por esmeralda — a tabela de trocas é dado, como tudo o mais.
- [ ] **Aldeia de verdade**: várias casas ligadas por caminho, poço no meio, cercado de plantação,
      e sino. Hoje a aldeia é um punhado de casas soltas.
- [ ] **Golem de ferro** que nasce na aldeia e defende quem mora lá.
- [ ] **Reputação**: bater em aldeão fecha as trocas por um tempo.
- [ ] Sons de aldeia (bigorna ao longe, porta, sino) no mesmo sintetizador de sempre.

**Critério de aceite:** chegar numa aldeia ao entardecer e ver os aldeões entrarem em casa
sozinhos; trocar dois itens sem abrir nenhum menu que não exista hoje. 20 aldeões no tick sem
passar de 1 ms (o orçamento atual de 20 mobs é 0,20 ms).

---

## M10 — Saber onde se está

> Proposta de 2026-09-16. O jogo tem 10 biomas, duas dimensões e mundo infinito, e **nenhuma
> forma de se localizar** além de olhar em volta.

- [ ] **Bússola** e **relógio** como itens, desenhados com a agulha girando de verdade.
- [ ] **Mapa** que preenche conforme o jogador anda, guardado no save como uma imagem pequena por
      região (o `.clw` já tem miniatura — é a mesma máquina).
- [ ] **Marcador** de ponto de interesse, colocado pelo jogador, visível na borda da tela.
- [ ] **Tela de estatísticas**: blocos minerados, distância andada, mortes, tempo de jogo. Os
      números já passam todos por `game/achievements.ts`.
- [ ] **Modo espectador** no criativo: atravessar parede e voar sem colisão, que é a ferramenta de
      quem constrói grande.

**Critério de aceite:** sair da base, andar 500 blocos, e voltar usando só o mapa e o marcador.
O mapa não pode custar mais que 1 ms por segundo de jogo nem crescer o save de forma ilimitada.

---

## Avaliação de 2026-09-22 — M11 a M17

> Acrescentado em 2026-09-22, a pedido do usuário: *"Faça uma avaliação completa no projeto, para
> entender o que falta implementar, se possui melhorias claras de performance, funcionalidades
> faltantes (…) e adicionar como novos marcos. Quero esse jogo o melhor possível"*.
>
> Tudo o que aparece abaixo como **falta** foi conferido no código (`grep`, leitura do módulo),
> não suposto. O arquivo e a linha estão ao lado de cada item para quem for implementar conferir
> de novo antes de começar — o código anda, e a linha pode ter mudado.

**O achado que muda a leitura do projeto:** o doc 15 e o README diziam que *"nenhum documento
normativo tem pendência de funcionalidade"*. **Não é verdade.** Os docs 03, 04, 05, 07 e 08 pedem
coisas que não existem — algumas pequenas (a areia não cai), algumas estruturais (não há sistema de
efeitos). Elas viraram o **M11**, que é o primeiro da fila por ser dívida, e não desejo.

**O que a avaliação não achou:** problema de orçamento. O T0 real rodou a 60 FPS com 2,7 ms de
render num orçamento de 33,3; o bundle está em 60% do teto; o save, a luz incremental e o meshing
estão bem desenhados. A performance que falta é de **carregamento** (o mundo nasce mais devagar do
que o jogador anda, doc 15 §3 M3) e de **alcance visual**, não de quadro — por isso o M12 é sobre
o pipeline, e não sobre o shader.

### Ordem recomendada

```
M11 dívida normativa ──► M13 casa em ordem ──► M12 carregamento ──► M9 gente ──► M10 localização
                              │                                          │
                              └── folga de atlas ──► M14 água ──► M15 oficina ──► M16 fim da jornada
M17 alcance (idioma e primeira hora) pode andar em paralelo com qualquer um.
```

O M13 vem **antes** do conteúdo novo porque dois itens dele destravam os outros: o uso de item como
dado (sem ele, o balde do M11 é o 12º `try*` em sequência na `Session`) e a folga de atlas (sem
ela, o M14 e o M16 não cabem nas 44 camadas que sobram).

---

## M11 — O que os documentos já pediam ✅

> Dívida normativa. Nada aqui é ideia nova: cada item está escrito num doc de 00 a 14 e não existia
> no código. **Fechado em 2026-09-22**, no mesmo dia da avaliação — detalhe no doc 15 §3.

- [x] **Areia, areia vermelha e cascalho caem** (doc 03 §9, doc 04 §2.1). `world/falling.ts`: a
      flag `gravity` ganhou leitor. Entidade num pool, desenhada no próprio passe de terreno
      (`render/fallingblocks.ts`); para no primeiro sólido, atravessa água, e a que cai numa tocha
      vira item.
- [x] **Lava corrente + água = pedregulho** (doc 03 §9). E o encontro dos dois fluidos passou a
      existir dos dois lados: a água, que anda seis vezes mais rápido, **apagava** a lava por onde
      passava. Os ids crus de `world/fluids.ts` saíram. O módulo não tinha teste nenhum; agora tem.
- [x] **Balde que funciona**: água, lava e leite, pela tabela de uso de item (M13, abaixo). Lava
      queima 20 000 ticks e devolve o balde; o bolo devolve os três baldes na grade.
- [x] **Tesoura**: item, receita, tosquia (1–3 lãs da cor) e folha colhida inteira.
- [x] **Ovelha colorida**: 85% branca, o resto nas outras sete cores; corante tinge; a lã volta
      pastando. A cor é o `variant` da `MobStore`, que já dizia "cor da ovelha" e ninguém escrevia.
- [x] **Muda por espécie** — e, achado no caminho, **nenhuma planta crescia**: a muda não virava
      árvore, cana e cacto não subiam, a grama não se espalhava e flor boiava sem chão (doc 03 §9
      inteiro). `data/plants.ts` + `world/growth.ts`; a forma da árvore saiu para `world/trees.ts`
      para a geração e a muda usarem a mesma receita, **sem mudar um sorteio**.
- [x] **Efeitos de status** como tabela (`data/effects.ts`, `game/effects.ts`): Fome,
      Regeneração, Absorção e Veneno, com HUD (`ui/effectsbar.ts`) e save.
- [x] **Comidas do doc 05 §4**: maçã dourada, ensopado (com os cogumelos, em caverna e pântano),
      biscoito e bolo de 7 fatias comido no bloco.
- [x] **Bloco de carvão e pedra lisa** — e, achado no caminho, **nenhum bloco queimava**: tábua,
      tronco e muda, os três do doc 05 §5, ganharam `fuel`.
- [x] **Galinha põe ovo**, ovo e bola de neve são arremessáveis, um ovo em oito choca.
- [x] **Enderman pega e põe** terra, areia, planta e abóbora — nunca pedra nem construção.
- [x] **Poço do deserto, cabana de bruxa e naufrágio**, no fim da tabela para não mudar o sal das
      estruturas antigas.
- [x] **Smoke test de navegador** (`npm run smoke`): carrega, cria mundo, anda 10 s, quebra,
      salva, recarrega e confere. **7 passos verdes** em Chrome headless.

**Achado pelo smoke test, corrigido no marco:** o jogador nascia **sempre** na coluna (0, 0), e
metade das seeds põe mar ali. O worker agora procura terra firme em anéis
(`world/gen/spawnsearch.ts`), e o ponto fica no meta do mundo.

**Critério de aceite:** ✅ cumprido por teste — torre de areia desaba (`tests/falling.test.ts`),
gerador de pedregulho funciona (`tests/fluids.test.ts`), bétula replantada dá bétula
(`tests/plants.test.ts`), smoke test verde. **Falta o olho num aparelho** (doc 15 §6).

---

## M12 — O mundo chega antes do jogador ✅

> Performance de **carregamento e alcance**. O custo de quadro já está folgado em todos os tiers;
> o que o jogador sente é o mundo aparecendo atrasado ao voar e a distância de render baixa no
> celular fraco.

- [x] **Culling por conectividade de sections.** *(2026-09-23: `render/sectioncull.ts`; a busca não poda pelo frustum e visita cada section uma vez — motivos no módulo.)* O PROMPT.md §4.2 o chama de *"fortemente
      recomendado (corta 60–80% do trabalho em cavernas)"* e **não foi feito**: `buildDrawLists`
      (`render/chunkrenderer.ts:150`) só faz frustum, e `grep -i occlusion src` só acha o AO do
      mesher. O worker já varre a section inteira ao meshar; é ali que se calcula, por flood fill
      do ar, quais das 6 faces se enxergam (15 bits por section). No render, BFS a partir da
      section da câmera, atravessando só faces conectadas e só para longe dela.
- [x] **Culling por direção de face.** *(2026-09-23: opaco e recortado; o translúcido fica de fora.)* O mesh opaco de uma section sai misturado; agrupando os
      índices em 6 faixas (uma por normal, o `face:3` já está no vértice), a section fora do plano
      da câmera desenha só as faixas voltadas para ela. Em terreno aberto, metade das faces laterais
      e todas as de baixo nunca são vistas — o ganho é em vértice, que é o que a GPU móvel paga.
- [x] **A cópia da vizinhança sai da thread principal.** *(2026-09-23, com desvio: sem espelho no worker — seriam N cópias do mundo; vão as sections cruas, um pedido por coluna, e o worker monta a vizinhança. Ver doc 15 §3.)* Cada job de malha copia 18³ blocos e luz
      no main thread, ~0,26 ms por section (`world/pipeline.ts:87`), e é esse orçamento que decide
      quantas sections saem por quadro. Com um espelho das colunas **dentro** do worker (ele gerou a
      coluna; só precisa receber os `setBlock` depois), o despacho vira uma mensagem de coordenada.
      `SharedArrayBuffer` não é opção: o GitHub Pages não serve COOP/COEP.
- [x] **Luz que atravessa a borda do chunk na geração.** *(2026-09-23: `Lighting.stitchColumn`.)* Hoje ela para na borda —
      `world/gen/terrain.ts:514`, *"essa é a aproximação aceita"* —, o que deixa uma aresta reta de
      sombra onde um barranco, uma boca de caverna ou um lago de lava cruzam a fronteira. Quando o
      vizinho chega, semear o flood fill de `world/lighting.ts` com as bordas das duas colunas.
- [ ] **Rever o preset de T0 com o que sobrar.** *(não feito: sem T0 na mão.)* Render de 2,7 ms em 33,3 é folga para RD 5 ou 6;
      o que segurou o RD 4 foi a geração. Precisa de um T0 na mão — o J7 Metal não está mais com o
      usuário (doc 15 §5) — ou fica como está.

**Critério de aceite:** `tests/dimensionrace.test.ts` (colunas em 40 ciclos, RD 8) **pelo menos
1,5×** o valor atual de 86 *(2026-09-23: deu 101, 1,17× — o teste, sem relógio e com 4 vagas meio a
meio, mede a divisão de vagas e não o custo do despacho; com o orçamento de 60 FPS o mundo de RD 16
ficou pronto em 2,2× menos quadros. Doc 15 §3)*; numa caverna a Y=20 com RD 8, **metade ou menos** das sections do
frustum vão para a lista de desenho; nenhuma aresta de luz visível na fronteira de chunk num teste
com lava encostada na borda. Orçamentos do `tests/perf.test.ts` intocados.

---

## M13 — Casa em ordem ✅

> Manutenção que **destrava** conteúdo. Nenhum item aqui aparece para o jogador; todos mudam quanto
> custa o próximo item que aparece. **Fechado em 2026-09-22.**

- [x] **Uso de item como dado.** `game/itemuse.ts` (as ações) e `game/itemuser.ts` (a espera entre
      cliques e a contagem de segurar). Cada item tem uma lista de usos em ordem de tentativa
      (`ItemDef.uses`), derivada da tabela: a cenoura é `['plant', 'eat']`. Os onze `try*` da
      `Session` migraram; o que ficou nela é o que é do **bloco** (`game/blockuse.ts`) ou do veículo.
- [x] **Dividir os módulos gigantes.** `session.ts` 2042 → **697** linhas, `main.ts` 1411 →
      **682**. Saíram `vehicles`, `tiles`, `workbench`, `playercombat`, `blockuse`, `worldsystems`,
      `sessionwiring`, `itemuser`, `entity/spawnerblocks`, `render/scenefeed`, `render/ambience`,
      `input/playeractions`, `ui/hudfeed`, `ui/gameflow`, `ui/gamescreens`, `game/playfield`,
      `audio/audiostart`, `core/lifecycle` e outros utilitários. `ui/containers/screen.ts` caiu de
      1117 para 890 (CSS e clique de contêiner saíram).
- [x] **Folga de atlas.** Tint de 2 para 6 bits no vértice (2 bits do `texLayer`, que tinha 10 para
      256 camadas, e 2 livres da palavra 0), tabela de cores num uniform (`data/tints.ts`). Lã e cama
      viraram um desenho cinza cada; na cama, madeira e travesseiro têm alfa 0,75 e o passe recortado
      não os tinge. **Dezesseis cores** agora, e o atlas caiu de 222 para **194 camadas**.

**Critério de aceite:** ✅ `session.ts` e `main.ts` abaixo de 700, suíte inteira sem mudar de
expectativa de comportamento (só testes que liam o código-fonte ou o formato de bits mudaram);
o balde, a tesoura e o ovo entraram sem tocar na cadeia da `Session`; 16 cores com 4 camadas, contra
32 das 8 antigas. Smoke test verde.

---

## M14 — Água e paisagem

> O mundo é bonito de cima e igual de dentro. Mergulhar não muda nada na tela, e não há rio.

- [ ] **Ver de dentro da água e da lava.** Hoje a névoa e a cor não mudam ao mergulhar (`grep -i
      underwater src` volta vazio). Névoa azul curta e escurecimento debaixo d'água, névoa laranja
      quase opaca na lava — é um uniform a mais no passe de terreno, nada de passe novo.
- [ ] **Rios.** Não há rio: a água do mundo é oceano, pântano e lago. Um ruído de canal que cava
      abaixo do nível do mar nas faixas estreitas, com bioma de rio só por tint — zero camadas de
      atlas.
- [ ] **Pesca**: vara (linha + graveto), boia na água, bacalhau e bacalhau assado (doc 05 §4) e XP
      de pesca (doc 06 §8). É a comida renovável que não depende de fazenda.
- [ ] **Afogado** (doc 07 §1, *"pós-MVP"*): o zumbi que nasce na água e no rio.
- [ ] **Lua com fases visível** (doc 03 §8: *"Lua com 8 fases"*). A fase já existe para o spawn
      de slime (`game/weather.ts`); no céu, a lua é sempre cheia.
- [ ] **Biomas de variação que só custam tint:** floresta de bétula, planície florida, pântano
      mais escuro. E **selva**, que custa camadas (tronco, folha, tábua) e depende da folga do M13.

**Critério de aceite:** mergulhar e emergir muda a tela em menos de um quadro; um rio atravessa
pelo menos dois biomas numa seed de teste sem degrau de parede; pescar 10 peixes em 5 minutos de
jogo. Geração de chunk continua abaixo de 25 ms (hoje 6,2).

---

## M15 — Oficina

> Meio de jogo. Hoje a ferramenta encantada quebra e acabou, e o circuito não tem como mexer em
> item.

- [ ] **Bigorna**: reparar ferramenta com o material, juntar duas ferramentas e dois livros
      encantados, dar nome. Custo em nível, como a mesa de encantamento.
- [ ] **Reparo na grade**: duas ferramentas iguais e gastas viram uma com a soma, sem
      encantamento. É uma receita especial do matcher, não uma tela.
- [ ] **Funil, dispensador e liberador**: o circuito passa a mexer em item. É o que torna possível
      fazenda automática e fornalha alimentada.
- [ ] **Comparador e observador**: ler quanto tem num baú, e perceber que um bloco mudou.
- [ ] **Livro encantado** como item guardável, saído da mesa de encantamento, que a bigorna
      consome.

**Critério de aceite:** uma picareta de diamante encantada volta de 10% para 100% de durabilidade
sem perder o encantamento; uma fornalha alimentada por funil a partir de um baú funde 64 minérios
sem o jogador tocar. Tick de circuito com 32 funis abaixo de 5 ms (o orçamento atual do fio de 64).

---

## M16 — Um fim para a jornada

> O jogo não tem objetivo. Não há chefe, não há créditos, e o loop "minerar → descer → sobreviver"
> não aponta para lugar nenhum. É o marco maior desta lista.

- [ ] **Fortaleza do Nether** com **blaze**, e a vara de blaze que o doc 05 §5 já lista como
      combustível.
- [ ] **Poções**, com o suporte de preparo, a verruga do Nether e o sistema de efeitos do M11: cura,
      força, velocidade, visão noturna, resistência ao fogo. A tabela de receitas de poção é dado.
- [ ] **Olho do ender** (pérola, que já cai do enderman, + pó de blaze): arremessado, voa na
      direção da fortaleza.
- [ ] **Fortaleza** subterrânea com biblioteca e a sala do portal.
- [ ] **O End**: terceira dimensão. O doc 15 §5 já registrou que `data/dimensions.ts` e o
      protocolo do worker são genéricos — *"uma terceira dimensão é uma entrada na tabela e um
      gerador"*. Ilhas de pedra do End, obsidiana em colunas, cristais.
- [ ] **O dragão**: voo por caminho, cristais que curam, ovo, e **créditos** com o tempo de jogo e
      as estatísticas do M10.

**Critério de aceite:** um mundo novo pode ser **terminado** — do primeiro tronco ao dragão — sem
comando nem modo criativo. O End em T0 a 30 FPS; o dragão no tick abaixo de 1 ms.

---

## M17 — Alcance

> Quem ainda não joga. O jogo só fala português e não ensina nada.

- [ ] **Idioma** (doc 08 §3.11: *"Menu raiz: Vídeo, Controles, Som, **Idioma**,
      Acessibilidade"*). O menu não existe (`ui/screens/options.ts:292–296` tem quatro seções). Os
      textos saem para `data/strings/pt.ts`, com um `t('chave')` barato, e entra `en` como segundo
      idioma. O custo em bundle é para medir, não para supor.
- [ ] **Primeira hora guiada**, por dica contextual e não por tutorial em pop-up: *"segure para
      quebrar"* até o primeiro tronco, *"abra a mochila"* até a primeira bancada — cada dica some
      quando a conquista correspondente de `data/achievements.ts` sai. Desligável.
- [ ] **Compartilhar seed** na tela do mundo: copiar, colar e um código curto.

**Critério de aceite:** o jogo inteiro em inglês sem um texto em português sobrando (teste que
varre as chaves); um jogador novo chega à picareta de pedra sem ler nada fora do jogo.

---

## Testes obrigatórios (a manter verde desde M1)

| Tipo | O que cobrir |
|---|---|
| **Unit (vitest)** | matcher de receitas (incluindo espelhamento e deslocamento), paleta de chunk (set/get com todos os `bitsPerBlock`), serialização round-trip, flood fill de luz, fórmula de tempo de quebra, greedy meshing (contagem de quads em casos conhecidos), splines de terreno |
| **Determinismo** | mesma seed → mesmo chunk, gerado em qualquer ordem e com qualquer número de workers |
| **Performance (CI)** | benchmark de meshing e de geração com limites que falham o build se regredirem > 20% |
| **Smoke (Playwright)** | carregar a página, criar mundo, andar 10 s, quebrar um bloco, salvar, recarregar, verificar que o bloco continua quebrado |
| **Memória** | rodar 10 min com render distance 8 e afirmar que o heap não cresce monotonicamente |
| **Manual, todo marco** | celular de referência T0, Chrome e Firefox, desktop Linux/Windows, tela de 320 px |

## Critérios de "pronto" do projeto

1. Abre em < 5 s numa conexão 3G e < 350 KB.
2. 30 FPS em celular de 2016 com render distance 4.
3. Um jogador consegue jogar 2 horas sem crash, sem perda de progresso e sem travas.
4. Nenhum asset de terceiros no repositório.
5. Todos os controles funcionam por toque, teclado e gamepad.
