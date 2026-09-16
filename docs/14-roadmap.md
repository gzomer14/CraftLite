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
- [ ] Placa com texto escrito pelo jogador, e quadro com arte gerada por código.
- [ ] Escada de mão com degraus de verdade (hoje é uma chapa com a textura vazada).
- [ ] Porta e alçapão nas outras madeiras; cama nas outras cores de lã.
- [ ] Baú com tampa que abre, e fornalha com a boca acesa quando está queimando.

**Critério de aceite:** num aparelho, olhar de perto uma tocha de parede, uma cerca isolada, uma
porta fechada e uma picareta na mão, e não conseguir apontar nenhuma peça "chapada". Orçamento de
meshing intocado: uma section com um piso de 256 tochas continua abaixo de 2 ms.

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
