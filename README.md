# CraftLite

Este repositório contém **a especificação completa** de um jogo de mundo aberto em voxels para
navegador — um jogo de minerar-e-construir que roda em praticamente qualquer máquina, incluindo
celulares antigos — e a **implementação em andamento**.

**Estado atual: os oito marcos, de M0 a M7, estão concluídos, e nenhum documento normativo tem mais
pendência de funcionalidade. Falta jogar em aparelho o que foi entregue depois do M7.**

- **M0 — esqueleto:** Vite + TypeScript strict, renderer WebGL2 próprio com fallback WebGL1,
  detecção de tier, loop de 20 Hz com interpolação, gerador procedural de texturas alimentando um
  `TEXTURE_2D_ARRAY`, overlay de debug.
- **M1 — mundo visível:** chunks paletizados, geração por splines com 10 biomas, cavernas e
  8 minérios, greedy meshing binário com AO em Web Workers, pipeline por prioridade, frustum
  culling, céu com gradiente e fog.
- **M2 — jogador e interação:** física com as constantes do doc 06 (sweep AABB, auto-step,
  atrito), raycast DDA com contorno de seleção, quebrar com tempo/estágios/partículas, colocar
  com rotação, hotbar de 9 slots, iluminação por flood fill incremental, ciclo dia/noite.
- **M3 — mobile jogável:** controles de toque completos (joystick flutuante, câmera por arraste,
  modos A e B), multitoque real por `pointerId`, HUD com safe areas, tela cheia e trava de
  orientação, opções persistidas, gamepad, e PWA instalável que funciona offline.
- **M4 — sobrevivência:** inventário de 46 slots com todas as interações do doc 08 §3.5,
  crafting 2×2 e 3×3 com matcher shaped/shapeless e **livro de receitas** com busca e
  auto-preenchimento, fornalha, baú e baú duplo, ferramentas com durabilidade, vida/fome/morte,
  itens no chão, fluidos, **sprites de item** (bloco em isométrica, resto por máscara),
  **inventário criativo** com abas e busca, **telas de título, mundos e opções**, e o
  **save em IndexedDB ligado de ponta a ponta**: autosave, saída segura e recarga do que mudou.
- **M5 — vida no mundo:** 12 mobs com modelo de caixas, skin procedural e animação por senoides;
  IA declarativa por goals com pathfinding A* orçado (200 nós, 2 buscas por tick) e fallback de
  steering; spawn/despawn com caps por tier; combate com dano, empurrão, cooldown por arma e
  invulnerabilidade; armadura nos 4 slots com a fórmula do doc; creeper que explode, esqueleto que
  atira, slime que se divide, enderman que teleporta, lobo que se doma com osso; cama que define o
  renascimento e pula a noite; **áudio sintetizado no boot** (60 sons + música procedural), e **árvores e plantas por
  bioma** — sem elas não há madeira e o jogo não começa.
- **M6 — profundidade:** **agricultura** (enxada, terra arada com umidade, trigo, cenoura e batata
  com 8 idades) e **reprodução de animais**; **geometria de forma** — laje, escada, cerca, portão,
  alçapão, porta, placa, quadro, escada de mão e trilho como listas de caixas, com o desenho e a
  colisão lendo a **mesma** tabela; **experiência** (orbes vindos de minério, mob e fornalha, com
  barra e nível no HUD) e **encantamento** (mesa que conta as estantes, três ofertas pagas em
  níveis e lápis-lazúli, 8 encantamentos guardados como 3 bits cada dentro da pilha);
  **estruturas** (dungeon com spawner e baús, mina com trilhos e teias, aldeia com poço, casas e
  aldeões, e ravinas); **clima** (chuva e tempestade determinísticas pela seed, que escurecem o céu
  e deixam hostil nascer de dia) e **8 fases da lua**; **arco, escudo e barco**; e **conquistas**
  com toast no canto e lista no menu de pausa.
- **M7 — extras:** **redstone** — pó com 15 níveis de energia, alavanca, botão,
  placa de pressão, tocha inversora, repetidor com quatro atrasos, lâmpada, bloco de redstone e
  pistão (comum e pegajoso, empurrando até 12 blocos). O circuito é uma fila incremental drenada
  dentro do mesmo tick, com teto duro: o fio inteiro acende no tick em que a alavanca é puxada, e
  um oscilador patológico custa um frame ruim, nunca uma trava. E o **Nether**: dimensão própria com
  gerador de salões sobre um mar de lava, portal de obsidiana aceso com isqueiro, escala 1:8 que o
  torna um atalho de viagem, save separado por dimensão, água que evapora, névoa vermelha sem ciclo
  de dia, e dois mobs — o porco zumbi e o **ghast**, que voa e atira bola de fogo a 30 blocos. Só
  uma dimensão fica carregada por vez: atravessar grava, descarrega e recarrega, porque num aparelho
  de 2 GB manter as duas seria pagar o dobro por nada. E os **trilhos**: o trilho descobre a própria
  forma olhando os vizinhos — reta, curva ou rampa —, o motorizado empurra quando energizado e freia
  quando não, o detector vira fonte de redstone com carrinho em cima, e o **carrinho de mina** anda
  preso à linha sem uma única consulta de colisão. E **import/export de mundos**: um arquivo `.clw`
  com todas as dimensões, os baús e os veículos, que leva o mundo do celular para o computador sem
  passar por servidor nenhum. O multijogador P2P **saiu do escopo** deste marco por decisão do
  projeto.
- **Dois estilos de textura**, ambos gerados por código e trocáveis em Opções → Vídeo. O
  **Clássico** é o procedural cru; o **Nítido** passa cada ladrilho por relevo direcional, realce,
  tom e chanfro de borda, e transforma as máscaras de item em sólidos iluminados — mesma silhueta
  quadriculada, com volume, especular por material e contorno. Não é resource pack e não baixa
  nada: são os mesmos desenhos, iluminados. Custo em jogo: zero dos dois lados, porque só muda os
  bytes gerados no boot.
- **Acabamento pós-M7:** a tabela de Vídeo e a de Acessibilidade do doc 08 ficaram inteiras —
  distância de simulação, gráficos Rápido/Bonito, **nuvens** (um plano no céu com a forma feita no
  shader, uma draw call), partículas, névoa, iluminação suave, balanço da câmera, contador de FPS,
  vsync, modo daltônico, contorno em alto contraste, distorção e flashes do céu. Mais **teclas
  remapeáveis**, **nove sliders de som** (o motor ganhou os barramentos que faltavam), **fogo que se
  espalha** — o `flammable` da tabela de blocos estava lá desde o M1 sem ninguém lendo —, o
  **morcego**, o **boneco do jogador** no inventário, **miniatura e tamanho** na tela de mundos,
  **canto de escada** e **som no resource pack**.
- **Controle:** DualSense, DualShock 4, Xbox e Switch Pro reconhecidos por fabricante/produto —
  o que muda entre eles é sobretudo o **nome do botão**, e o jogo passa a dizer `✕ ○ □ △` a quem
  segura um controle da Sony. Mapeamento completo do doc 09 §3, e **os menus navegáveis por
  gamepad**, sem o que não dá nem para entrar num mundo só com o controle na mão. Funciona por cabo
  ou Bluetooth, no computador e no celular.

**189 KB gzip** no total (código + worker + HTML + service worker), zero assets baixados
além de dois ícones de PWA de 6,7 KB, gerados por código.

Validado em aparelho alvo (**Galaxy J7 Metal**, Android 7, 2 GB, Mali-T830) em 2026-09-12:
**60 FPS com render distance 4**, escala de resolução em 1,00 e 2,7 ms de render num orçamento
de 33,3 ms — o dobro do alvo de 30 FPS. Voo contínuo, 15–20 mobs, chuva e travessia de biomas
sem queda de quadro; heap estável em 20 MB.

## Rodar

```bash
npm install
npm run dev        # servidor de desenvolvimento
npm test           # 1328 testes (vitest)
npm run build      # build de produção com typecheck
npm run size       # relatório de tamanho; falha se estourar o orçamento
npm run icons      # regenera os ícones do PWA
```

**Teclado e mouse:** clique para jogar, `WASD` mover, `Espaço` pular, `Shift` agachar,
`Ctrl` correr, botão esquerdo quebrar **ou atacar o mob mirado**, direito colocar (e usar cama,
baú, bancada, fornalha), botão do meio copiar bloco, `1`–`9` e roda do mouse trocam de item,
`E` inventário, `Esc` pausa, `F3` debug. Espaço duas vezes alterna o voo no criativo.

**Som:** o áudio só liga no primeiro clique ou toque (política de autoplay do navegador) e é
todo sintetizado no boot — nada é baixado. Volume, música e legendas de som ficam nas opções.

**Toque:** metade esquerda é o joystick flutuante (empurrar até o limite por 300 ms corre);
metade direita gira a câmera. Toque curto coloca, toque longo quebra, e o raycast parte do dedo
(Modo A). O Modo B, com botões dedicados de quebrar/colocar e mira no centro, fica nas opções.
Três dedos abrem o debug.

**Gamepad:** analógicos para mover e olhar, `A` pular, `B` agachar, `X` colocar, `RT` quebrar,
`LB`/`RB` rolam a hotbar.

**Parâmetros de URL:** `?seed=texto` pula o menu e entra direto num mundo com essa seed;
`?mode=creative` começa no criativo; `?gl1` força o caminho de fallback WebGL1. Sem parâmetro, o
jogo abre na tela de título, com a lista de mundos salvos.

## Por onde começar

👉 **[docs/15-status.md](docs/15-status.md)** — o estado real do código: o que está pronto, o que
ficou pendente, o que depende de quê e qual é o próximo passo. É o primeiro arquivo a ler para
retomar o desenvolvimento. O histórico de alterações por sessão fica em
**[docs/16-auditoria.md](docs/16-auditoria.md)**, e a rotina que mantém os dois em dia está em
**[CLAUDE.md](CLAUDE.md)**.

👉 **[PROMPT.md](PROMPT.md)** — o prompt mestre, com a especificação e o plano de marcos (§12).
Entregue este arquivo, junto com a pasta `docs/`, a quem for implementar do zero.

## O que está definido

| | |
|---|---|
| **Alvo** | 30 FPS em Android de 2016 com 2 GB de RAM (medido: **60**); 60+ no desktop |
| **Bundle** | < 350 KB gzip, **zero assets baixados** (texturas e sons gerados por código) |
| **Stack** | TypeScript + Vite + WebGL2 puro, **zero dependências de runtime** |
| **Escopo do MVP** | mundo infinito, 10 biomas com árvores e plantas, cavernas, 8 minérios, 68 blocos, crafting 2×2/3×3, fornalha, baús, vida/fome/armadura, 12 mobs com IA, combate, cama, dia/noite, som procedural, saves locais, controles de toque completos |
| **Documentos** | 15 docs normativos + 14 wireframes SVG |

## Estrutura

```
PROMPT.md               ← o prompt mestre
src/
  main.ts                   bootstrap, detecção de device, wiring do loop
  core/                     loop 20 Hz, math, noise, rng, tier, events, zip
  data/                     tabelas declarativas: blocos, biomas, texturas, mobs, modelos, skins
  world/                    chunks, mundo, pipeline, vizinhança, física, raycast, luz
    gen/terrain.ts          splines, biomas, cavernas, ravinas, minérios, luz do céu
    gen/decorate.ts         árvores e plantas por bioma
    gen/structures.ts       dungeon, mina e aldeia a partir de peças declarativas
    mesh/greedy.ts          greedy meshing binário com AO
    mesh/shapes.ts          formas não-cubo como caixas (desenho e colisão)
  workers/                  protocolo tipado + worker de chunk
  render/                   gl, atlas, texgen, mesh, terrain, sky, selection, particles,
                            entityatlas, skingen, mobrender, pack (resource pack do jogador)
  entity/                   jogador, itens no chão, orbes de XP, barcos, mobs (store, spawn,
                            projéteis), ai/
  game/                     sessão, inventário, crafting, contêineres, sobrevivência, drops,
                            combate, explosão, cama, dia/noite, agricultura, XP, encantamento,
                            clima, conquistas
  audio/                    síntese procedural, motor de vozes, música
  save/                     IndexedDB, serialização de chunk, autosave, arquivo `.clw`
  input/                    controls (camada única), keyboard, mouse, touch, gamepad
  ui/                       HUD, controles de toque, tela cheia/orientação, debug
    screens/                título, mundos, opções, texturas, pausa, morte
    containers/             inventário, bancada, fornalha, baú, mesa de encantamento,
                            livro de receitas, criativo
public/                     manifest, service worker, ícones do PWA
tests/                      1328 testes, incluindo orçamento de performance e de luz
scripts/size-report.mjs     orçamento de bundle (falha o build se estourar)
docs/
  00-visao-geral.md         escopo, tiers de hardware, princípios
  01-arquitetura-tecnica.md stack, pastas, threads, renderer
  02-orcamento-performance.md budgets numéricos, greedy meshing, AO, anti-GC
  03-mundo-e-geracao.md     ruído, splines, biomas, cavernas, minérios, fluidos
  04-blocos.md              tabela de 68 blocos
  05-itens-e-receitas.md    itens, tiers, comida, receitas, fundição, drops
  06-jogador-e-fisica.md    constantes de movimento, colisão, quebra, vida, fome
  07-mobs-e-ia.md           mobs, goals, pathfinding, spawn, animação
  08-interface-ui.md        todas as telas, paleta, interações de slot
  09-controles-mobile.md    toque, gestos, teclado, gamepad
  10-audio.md               síntese procedural de som e música
  11-persistencia-e-saves.md IndexedDB, formato de save, PWA
  12-multiplayer.md         ganchos de arquitetura, protocolo P2P
  13-assets-e-arte.md       texturas procedurais, sprites, fonte, licença
  14-roadmap.md             8 marcos com checklist e critérios de aceite
  15-status.md              estado real: status por marco, pendências, próximo passo
  16-auditoria.md           histórico por sessão, com grid de arquivos
  mockups/                  14 wireframes SVG + generate.py
```

Regenerar os wireframes:

```bash
python3 docs/mockups/generate.py
```

## Originalidade

Projeto independente, sem afiliação com nenhuma empresa de jogos. O que é reproduzido são
**mecânicas e convenções de layout** — arte, som, nome, logo, fonte e textos são criações originais
geradas por código. Nenhum asset de terceiros entra no repositório.
Detalhes em [docs/13-assets-e-arte.md](docs/13-assets-e-arte.md).
