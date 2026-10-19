# 15 — Status do projeto

> **Este é o documento de entrada de qualquer sessão de desenvolvimento.**
> Quem chega sem contexto lê este arquivo primeiro: ele diz o que está pronto, o que está aberto e
> qual é o próximo passo. **É uma foto**, não um diário: o porquê de cada decisão antiga, volta a
> volta, está no [histórico](15-historico.md); o que mudou em cada sessão, arquivo a arquivo, no
> [16-auditoria.md](16-auditoria.md).
>
> Os documentos 00 a 14 são **normativos**: descrevem o que o jogo deve ser. Este é **descritivo**:
> reflete o código de hoje e é atualizado ao fim de cada entrega.

**Última atualização:** 2026-10-19 18:41 — **M24 fechado: casa em ordem, terceira volta** (§3). Os seis
módulos acima de 700 linhas foram cortados por papel, e o teto virou teste. Este documento voltou a
ser foto (de 3 453 para ~360 linhas; o de antes, inteiro, no [histórico](15-historico.md)). Todo
PR passa pelos portões e pelos dois smokes no CI, e os smokes rodam como root sem invólucro.
Portões: 2424 testes, 311,2 KB; `smoke` 9, `smoke:mods` 6, `smoke:room` 20, `bench:ui` ok.
**Próximo passo de código: M25** (§6). Do usuário: **M22**.

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
| **M9** Gente no mundo | aldeão com rotina e troca, aldeia de verdade, golem, reputação | ✅ **validado em campo em 2026-09-24** | — |
| **M10** Saber onde se está | bússola, relógio, mapa, marcador, estatísticas, espectador, itens no chão no save | ✅ **validado em campo em 2026-09-24** | — |
| **M11** O que os documentos já pediam | areia que cai, pedregulho de lava, balde, tesoura, ovelha colorida, planta que cresce, efeitos de status, comidas e estruturas que faltavam, nascimento em terra firme, smoke test | ✅ **validado em campo em 2026-09-23** | — |
| **M12** O mundo chega antes do jogador | culling por conectividade e por direção de face, cópia de vizinhança fora da thread principal, luz na borda do chunk | ✅ **validado em campo em 2026-09-23** | preset do T0 não revisto (sem T0 na mão) — §3 |
| **M13** Casa em ordem | uso de item como dado, `session.ts` e `main.ts` abaixo de 700 linhas, lã e cama em 16 cores por tint | ✅ **validado em campo em 2026-09-23** | — |
| **M14** Água e paisagem | visão submersa, rios, pesca, afogado, lua com fases, biomas por tint, selva | ✅ **validado em campo em 2026-09-24** | muda o terreno gerado: **mundo antigo ganha costura** (§3) |
| **M15** Oficina | bigorna, reparo na grade, funil, dispensador, comparador, observador | ✅ **validado em campo em 2026-09-24** (depois da 1ª volta corrigida: telas e funil) | — |
| **M16** Um fim para a jornada | fortaleza do Nether, blaze, poções, olho do ender, End, dragão, créditos, bruxa | ✅ concluído em 2026-09-24 | **não visto em aparelho**; End em T0 não medido (§6) |
| **M17** Alcance | menu Idioma (doc 08 §3.11) com `en`, primeira hora guiada, seed compartilhável | ✅ concluído em 2026-09-25 | **não visto em aparelho** (visto no Chrome headless, em pt e en, desktop e celular emulado) |
| **M18** Casa em ordem, 2ª volta | cinco módulos abaixo do teto, memória de áudio com folga, varredura de idioma pelo destino | ✅ concluído em 2026-09-25 | — |
| **M19** Pontas soltas | enderman no End, dragão que quebra, sopra e morre devagar, ilhas de fora e portal de passagem, tint no WebGL1 | ✅ concluído em 2026-09-25 | **não visto em aparelho** (End visto no Chrome headless) |
| **M20** Jogar junto na mesma rede | multijogador por WebRTC só na rede local, sinalização por QR, sem servidor; o mundo e os dados do convidado só no aparelho do anfitrião | 🚧 **no jogo**, ligação e save do convidado vistos em aparelho (2026-09-27); nome, chat, combate, contêineres, cama, placa, dimensões, mundo em volta do convidado — `npm run smoke:room` (20 passos) | aceite do doc 14 é do usuário (M22); duas voltas de código no M30 |
| **M21** Mods | mods escritos no repositório, cada um um pedaço de bundle próprio, ligados e desligados na tela Mods; **desligados, a página baixa um arquivo só, o de antes** (teste e build cobram); mod de exemplo | ✅ concluído em 2026-09-27 | **não visto em aparelho** (visto no Chrome headless); na sala do M20, mods diferentes não entram |
| **M22** Aparelho e MVP | domínio, PWA do J7, aceite do M20, roteiro de campo M16–M21, Firefox e Safari, declarar o MVP | ⬜ proposto em 2026-10-19 | do usuário |
| **M23** Correções verificadas | coluna perdida na gravação, cota cheia (doc 11 §4), coluna corrompida em quarentena, fogo nos mobs e chama visível, dica fora da vida, mochila no T0 deitado, save do convidado, escada em quina de três — e a regra de canto de escada, que estava trocada | ✅ concluído em 2026-10-19 | **não visto em aparelho** (visto no Chromium, desktop e 640×360) |
| **M24** Casa em ordem, 3ª volta | seis módulos cortados por papel (e um teste que cobra o teto de 700), este documento de volta a foto, CI nos PRs com smoke, smoke como root | ✅ concluído em 2026-10-19 | o CI ainda não rodou: roda no primeiro PR |
| **M25** Folga para crescer | atlas, bundle e áudio com folga para os marcos de conteúdo | ⬜ proposto em 2026-10-19 | **próximo de código** (§6); trava M26–M29 |
| **M26** Aconchego | fogueira e caldeirão (doc 00), lanterna, vaso, moldura, tronco descascado, terracota e concreto | ⬜ proposto em 2026-10-19 | — |
| **M27** Bichos | cavalo com sela, gato, coelho, peixes vivos, guia, etiqueta | ⬜ proposto em 2026-10-19 | — |
| **M28** Lugares para achar | templos do deserto e da selva, fundo do mar, planalto de terracota, mapa do tesouro | ⬜ proposto em 2026-10-19 | — |
| **M29** Ameaça | invasão de saqueadores, besta, tridente, fantasma noturno | ⬜ proposto em 2026-10-19 | — |
| **M30** Sala, 2ª volta | golpe no boneco, inventário conferido, mods da sala sem tela, PvP opcional, teto de mobs por jogador | ⬜ proposto em 2026-10-19 | depende do aceite do M20 |
| **M31** Horizonte | terreno distante, folhas e água que se mexem — só T1+ | ⬜ proposto em 2026-10-19 | — |

Legenda: ✅ pronto · 🚧 em andamento · ⬜ não iniciado

O multijogador saiu do escopo do M7 por decisão do usuário (2026-09-13) e voltou como **M20**
(2026-09-27), só na rede local e sem servidor; o doc 12 §2 foi revisto para isso.

---

## 2. Métricas atuais

Medidas em 2026-10-19 18:41 (ao fechar o M24) com os quatro portões, `npm run smoke`, `smoke:mods`,
`smoke:room` e `bench:ui`; as de aparelho e de sessão longa são de setembro, com a data na linha.

| | Valor | Orçamento | Fonte |
|---|---|---|---|
| Bundle (gzip, o jogo sem mod) | **311,2 KB**, worker 42,8 (311,0 antes do M24, pelos limites de módulo novos; 308,3 antes do M23; a série completa está no [histórico](15-historico.md)) | < 350 KB | `npm run size` |
| Testes | **2424**, 130 arquivos (2423 antes do M24; 2404 antes do M23) | manter verde | `npm test` |
| Smoke test de navegador | **9 passos verdes**: carregar, criar, andar 10 s, quebrar, **cota cheia: a tela abre com o banco recusando, e com espaço de volta grava e fecha (M23)**, salvar, recarregar, conferir | verde | `npm run smoke` |
| Smoke test da rede (M20.0) | **7 passos verdes**: dois Chrome, anfitrião e convidado pela página `rede.html`, trocando os códigos como uma pessoa; ligados em candidato `host` dos dois lados; ida e volta ~0,3 ms, perda 0/300, 6–18 MB/s. Com e sem mDNS (`SMOKE_NET_MDNS=1`). **Na mesma máquina — não prova a rede Wi-Fi** | verde | `npm run smoke:net` |
| Toque nas telas de inventário, CPU 6× mais lenta | **91–268 ms** por ação (abrir o livro de receitas, tocar numa receita, tocar num slot; varia entre rodadas); eram **~3 000 ms** com a folha de sprites como `data:` URL — no J7, 5–10 s | ≤ 600 ms | `npm run bench:ui` |
| Mochila num T0 deitado (640×360) | **cabe sem rolar**, *Fechar* à vista (M23; antes o painel ia a 410 px e o botão ficava em 354) | sem rolagem | `npm run bench:ui` |
| Smoke test da sala (M20) | **20 passos verdes**: dois Chrome; o convidado entra pelo título trocando os códigos; blocos nos dois sentidos; bonecos, nome e chat; **trocar o modo de jogo pela pausa não fecha a sala** (M23); baú do anfitrião; luz do poço; bloco além do anel do anfitrião; a sala segue o anfitrião ao Nether e de volta; o convidado sai salvo no anfitrião; **0 mundo e 0 chunk no banco do convidado** | verde | `npm run smoke:room` |
| Bloco do anfitrião no convidado | **0–15 ms** por viagem, mediana 1–4 ms (5 viagens por rodada; eram até 214 ms antes de o lote sair na microtarefa, sem esperar o tick) | < 150 ms (aceite do M20) | `npm run smoke:room` |
| Smoke test da câmera (M20) | **3 passos verdes**: a webcam falsa do Chrome filma o QR do anfitrião inclinado, borrado e com ruído; o leitor próprio lê em **205–410 ms** | verde | `npm run smoke:camera` |
| Leitor de QR próprio | lê a partir de **~4,1 px por módulo** e com trapézio de até **30%** (borda de cima com 70% da de baixo); falha com 45% e a 3,3 px/módulo; **~10 ms** por quadro de 640×480 no Node (cinco leituras e a foto sintética em 59 ms) | < 120 ms/quadro | `tests/qrread.test.ts` |
| Pedaços da rede (`n/` e `rede.html`) | **32,3 KB**; abrir ou entrar numa sala baixa ~27 KB. Fora do jogo sem sala, dentro do precache (a sala abre sem internet) | sem orçamento (o jogo sem sala é que tem) | `npm run size` |
| Código de pareamento | **119 caracteres** com IP à vista, **138** com mDNS (72 e 84 bytes + CRC); QR versão 7–8, lido pelo OpenCV na captura da página | QR ≤ versão 8 | `tests/net.test.ts` |
| Smoke test dos mods (M21) | **6 passos verdes**: sem mod, **um** arquivo de código; ligar pela tela Mods; o cristal no mundo, com luz 14; desligar volta a um arquivo e apaga a escolha; o mundo pede o mod | verde | `npm run smoke:mods` |
| Pedaços que só baixam com mod (`m/`) | **45,6 KB**: ponto de entrada 1,9, mod de exemplo 0,6, worker com mods 0,4 + o worker de sempre como pedaço, 42,7 | sem orçamento (o jogo sem mod é que tem) | `npm run size` |
| Textos de interface | **~500 chaves**, as mesmas em `pt` e `en` (o compilador cobra); **nenhum literal com cara de português** fora de `data/strings/pt.ts` e dos campos de nome das tabelas | varredura verde | `tests/i18n.test.ts` |
| Geração de chunk do End nas ilhas de fora | **~2,8 ms** (1089 chunks em ~3 s, com o santuário) | < 25 ms | `tests/theend.test.ts` |
| Primeira hora guiada | três troncos de bétula → **picareta de pedra**, só pelo livro de receitas, com a dica andando a cada passo | aceite do M17 | `tests/firsthour.test.ts` |
| Camadas de atlas | **223** com o M16 (+11: verruga, suporte, pedra do End, moldura com e sem olho, portal do End, ovo); **212** com a oficina (+11: bigorna, funil, dispensador, liberador, comparador, observador); 201 com a selva; 194 antes do M14 | ≤ 256 (doc 02 §3) | `buildLayerIndex()` |
| Memória de áudio | **2,924 MB** (M18: taxa exata de Nyquist por receita, teto do teste baixado para 3,2); antes **3,442 MB** com as vozes do blaze, da bruxa, do dragão e do cristal (§5: perto do teto de novo); **3,140 MB** no M15 (3,497 no M14, colado no teto): degrau de ¼ da taxa para som grave, sem tirar nenhum (§4) | < 3,5 MB | `tests/audio.test.ts` |
| Mapa explorado (M10) | **0,23 ms por segundo de jogo**; 500 blocos = 16 regiões, ~146 KB; voando a 20 blocos/s, zero buraco | < 1 ms/s; ≤ 64 regiões | `tests/journal.test.ts` |
| Geração de chunk | **6,4 ms** (mediana; 6,2 antes do rio) | < 25 ms | `tests/perf.test.ts` |
| Clima do tint de bioma, thread principal | **8–9 µs por chunk** (até 32 por quadro) | < 60 µs | `tests/perf.test.ts` |
| Rio (seed 2, 768×768 blocos) | atravessa deserto e planície; maior degrau **≤ 8** | sem parede | `tests/rivers.test.ts` |
| Pesca | **≥ 10 peixes em 5 min** de jogo, reagindo em 0,3 s | 10 em 5 min (aceite do M14) | `tests/fishing.test.ts` |
| Dragão com os dez cristais | **0,04 ms** no 3º pior de 300 ticks | < 1 ms (aceite do M16) | `tests/theend.test.ts` |
| Cadeia do tronco ao dragão | olho do ender, arco, espada de diamante, obsidiana e as cinco poções alcançáveis só com o que o mundo dá | aceite do M16 | `tests/journey.test.ts` |
| 32 funis movendo item | **0,35 ms** no pior tick (funil + circuito) | < 5 ms (aceite do M15) | `tests/workshop.test.ts` |
| Bigorna e fornalha automática | picareta de diamante encantada **10% → 100%** com 4 diamantes, sem perder o encantamento; baú → funil → fornalha funde **64 de 64** | aceite do M15 | `tests/workshop.test.ts` |
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
| Abertura em 3G rápido | **2,82 s** até a tela de título (2026-09-25, 301,8 KB); o M21 mediu +0,5% lado a lado | < 5 s (PROMPT.md §11) | `npm run slow-network` com `URL` local |
| Sessão longa (voo contínuo) | **92,5 min, 0 erros, 0 travamentos** | 2 h sem crash (PROMPT.md §11) | `npm run soak` |
| Heap na sessão longa | **37,8 MB no início, 44,2 no fim**; média por faixa de 15 min entre 42,8 e 47,2 | sem crescimento | `npm run soak` |
| FPS na sessão longa | mediana **60**, mínimo 50, nenhuma amostra abaixo de 30 | 30 estáveis | `npm run soak` |
| Mundo gerado na sessão longa | **67 621 blocos** percorridos, anel estável em 489 colunas | — | `npm run soak` |
| Abertura em 3G lento | 9,61 s | — | `npm run slow-network` |
| Abertura sem limite de rede | 2,89 s | — | `npm run slow-network` |
| Bytes na rede até o título | **178,7 KB** estimados (174,8 KB do bundle, servido em gzip; a medida de campo é de 2026-09-14, com 169,1) | < 350 KB | `npm run slow-network` |

---

---

## 3. Detalhe por marco

Uma linha por marco: o que existe e onde. **O porquê de cada decisão, os números de cada volta e os
relatos de campo estão no [histórico](15-historico.md)** — `grep` pelo marco ou pelo módulo.

| Marco | O que existe | Onde começar a ler |
|---|---|---|
| M0 | contexto WebGL2 com fallback WebGL1, tier e presets, loop de 20 Hz com interpolação, atlas procedural em `TEXTURE_2D_ARRAY`, F3 | `render/gl.ts`, `core/tier.ts`, `core/loop.ts`, `render/atlas.ts` |
| M1 | chunks paletizados, splines de terreno, biomas com blend, cavernas, minérios, greedy meshing com AO nos workers, pipeline por prioridade, frustum, céu e fog | `world/gen/`, `world/mesh/greedy.ts`, `world/pipeline.ts` |
| M2 | física do doc 06, raycast DDA, quebrar e colocar, hotbar, luz por flood fill incremental, dia e noite | `entity/player.ts`, `world/lighting.ts`, `game/interaction.ts` |
| M3 | toque (joystick, modos A e B, multitoque), safe areas, tela cheia, gamepad, PWA offline, escala dinâmica — **60 FPS no J7 Metal (T0), RD 4** | `input/touch.ts`, `core/pwa.ts`, `render/dynamicscale.ts` |
| M4 | inventário de 46 slots, crafting 2×2/3×3, fornalha, baú duplo, ferramentas, vida e fome, itens no chão, fluidos, save, telas de mundo e opções, sprites de item, livro de receitas, criativo | `game/inventory.ts`, `game/crafting.ts`, `game/savegame.ts`, `ui/containers/` |
| M5 | mobs em tabela (22 tipos hoje, com o dragão e o cristal do End), IA por goals, pathfinding, spawn, combate, armadura, cama, som procedural, árvores e plantas | `data/mobs.ts`, `entity/mobs.ts`, `entity/ai/`, `audio/synth.ts` |
| M6 | agricultura, reprodução, XP, encantamento, estruturas, clima, arco, escudo, conquistas | `game/farming.ts`, `game/enchanting.ts`, `data/structures.ts`, `game/weather.ts` |
| M7 | redstone, Nether, trilhos e carrinho, import/export `.clw`, resource pack | `world/redstone.ts`, `world/gen/nether.ts`, `world/rails.ts`, `save/archive.ts`, `render/pack.ts` |
| Pós-M7 | vídeo e acessibilidade completos, teclas remapeáveis, sliders de som, fogo que se espalha, morcego, boneco do jogador, controle por família (DualSense, Xbox, Switch Pro) com navegação de menu, modo de jogo pela pausa, estilo de textura Nítido | `ui/screens/options.ts`, `world/fire.ts`, `data/gamepads.ts`, `input/uinav.ts` |
| M8 | vértice em 1/16 de bloco, tocha, porta e cama de duas células, item na mão com volume, contorno da forma, vidro, escada de mão, baú que abre, placa com texto, quadro com arte | `world/mesh/shapes.ts`, `render/hand.ts`, `game/signs.ts` |
| Terreno | blend 5×5 do relevo de bioma e teto macio (o fim das paredes de 29 blocos) | `world/gen/heightfield.ts` |
| M9 | aldeão com rotina e troca, aldeia, golem, reputação, sino | `entity/ai/villagegoals.ts`, `game/trading.ts`, `game/village.ts` |
| M10 | bússola, relógio, mapa e marcadores, estatísticas, espectador, itens no chão no save | `game/journal.ts`, `ui/screens/mapscreen.ts`, `ui/markerbar.ts` |
| M11 | a dívida normativa: areia que cai, pedregulho, balde, tesoura, ovelha colorida, efeitos, comidas, estruturas, nascimento em terra, smoke test | `world/falling.ts`, `game/effects.ts`, `scripts/smoke.mjs` |
| M12 | culling por conectividade e por face, vizinhança copiada fora da thread principal, luz na borda do chunk | `render/sectioncull.ts`, `world/neighborhood.ts`, `world/lighting.ts` |
| M13 | uso de item como dado, lã e cama em 16 cores por tint | `game/itemuse.ts`, `data/tints.ts` |
| M14 | visão submersa, rios, pesca, afogado, lua, biomas por tint, selva | `render/medium.ts`, `world/gen/heightfield.ts`, `game/fishing.ts`, `render/biometint.ts` |
| M15 | bigorna, reparo, funil, dispensador, comparador, observador | `game/anvil.ts`, `world/redstoneparts.ts` |
| M16 | fortaleza do Nether, blaze, poções, olho do ender, End, dragão, créditos, bruxa | `game/brewing.ts`, `game/dragonfight.ts`, `world/gen/end.ts` |
| M17 | idioma inglês (`data/strings/`), primeira hora guiada, seed compartilhável | `core/i18n.ts`, `game/guide.ts`, `core/seedcode.ts` |
| M18 | casa em ordem (cinco módulos cortados), memória de áudio com folga | — |
| M19 | enderman no End, dragão que quebra e sopra, ilhas de fora, portal de passagem, tint no WebGL1 | `game/endgateway.ts` |
| M20 🚧 | sala na rede local por WebRTC sem servidor, QR com leitor próprio, o convidado salvo no anfitrião, combate, contêineres, cama, placa, dimensões, âncoras do pipeline | `src/net/` (entrada em `game/netgate.ts`); o desenho no histórico, "M20 no jogo" |
| M21 | mods escritos no repositório, cada um um pedaço de bundle; sem mod, um arquivo só | `src/mods/`; a receita abaixo |
| M23 | save que não perde coluna, tela de cota cheia, quarentena de coluna corrompida, fogo nos mobs com chama à vista, mochila no T0 deitado, cadência do save do convidado, canto de escada certo | `save/savemanager.ts`, `ui/screens/storagefull.ts`, `entity/mobrules.ts`, `world/mesh/stairshape.ts` |
| M24 | ver abaixo | — |

### M24 — Casa em ordem, terceira volta ✅ — 2026-10-19

Pedido: *"PR mesclado, pode seguir"* — o próximo de código depois do M23.

- **Seis módulos abaixo de 700, por papel** (nenhum importador mudou: quem saiu é re-exportado):
  - `world/mesh/shapes.ts` 919 → 543: a caixa em `box.ts`, a escada em `stairshape.ts`, o trilho
    em `railshape.ts`, alavanca, botão, repetidor, comparador, pistão, bigorna e funil em
    `machineshape.ts`;
  - `ui/hud.ts` 738 → 565: o CSS e o ícone da fome em `hudstyle.ts`;
  - `entity/mobs.ts` 716 → 640: alvo, hostilidade e linha de visão em `mobtarget.ts`;
  - `game/session.ts` 715 → 671: o renascimento em `spawnplacement.ts`, o drop de bloco em
    `drops.ts`;
  - `world/pipeline.ts` 714 → 660: os tipos em `pipelinetypes.ts`;
  - `render/itemsprites.ts` 713 → 644: o mostrador da bússola e do relógio em `dialsprite.ts`.
  - **E o teto virou teste** (`tests/modulesize.test.ts`): módulo de código acima de 700 linhas
    reprova o `npm test`. Tabelas de `src/data/` ficam de fora.
  - De passagem: `railSlopeDir` criava um array por chamada (tick do carrinho); saiu da função.
- **Este documento:** de 3 453 para ~360 linhas. O documento inteiro de antes está, sem edição, em
  [15-historico.md](15-historico.md). *Desvio consciente do doc 14*, que mandava o histórico para o
  doc 16: o 16 é um registro por sessão, com grid de arquivos, e 2 800 linhas de narrativa por
  marco não cabem nesse formato.
- **CI nos PRs** (`.github/workflows/portoes.yml`): testes, lint, build, orçamento, `npm run smoke`
  e `npm run smoke:mods` em todo pull request. **Ainda não rodou** — roda no primeiro PR aberto.
- **Smoke como root:** os oito scripts de navegador tinham cada um a sua cópia de `chromeBin()`; agora
  é `scripts/chrome.mjs`, que acha também o Chromium do Playwright e põe `--no-sandbox` sozinho como
  root. `smoke`, `smoke:net` e `smoke:camera` rodaram como root sem invólucro.

### Como escrever um mod (a receita)

1. **Pasta e catálogo.** `src/mods/<id>/mod.ts` com `export default` um `ModDef`. Uma linha em
   `MOD_CATALOG` (`mods/catalog.ts`: nome e descrição em `pt` e `en`, `heavy: true` se pesa) e uma
   em `MOD_LOADERS` (`mods/loaders.ts`). O teste cobra que os dois batem.
2. **Faixas.** Escolha `blockBase` e `itemBase` que não cruzem os mods que existem (o teste liga
   todos juntos e recusa cruzamento). **Só acrescente no fim** das listas `blocks` e `items`: o id é
   a posição, e ele está no save de quem jogou.
3. **Nomes com prefixo** `<id>:` em blocos, itens, texturas e silhuetas. Todo bloco e item com o
   nome em inglês em `en` (o M17 cobra).
4. **Só `import type` de fora da pasta do mod.** O que o mod usa em tempo de execução chega por
   parâmetro: os operadores de textura em `textures(g)`, o mundo, o jogador, a vida e o inventário
   em `tick(ctx)`. Um import de valor quebra o build (`size-report`) e o teste de isolamento.
5. **Conteúdo é tabela.** Arma é uma linha em `items` com `attack`, `attackSpeed`, `durability` e
   `tool: { kind: 'sword', … }`; a arte é uma silhueta em `itemShapes` e uma linha em `itemArt`; a
   receita, uma linha em `recipes`. Precisou de comportamento que a tabela não tem? Abra um ponto
   de extensão novo do jeito do tick: montado no boot, só com o mod ligado, nunca consultado por
   quadro.
6. **Teste do mod** em `tests/`, carregando o jogo com ele (`loadGame([mod])` em
   `tests/mods.test.ts` é o molde). Um mod pode ser pesado; o jogo sem ele, não — os portões e o
   `npm run smoke:mods` continuam valendo.
7. **Limites:** atlas de 256 camadas no total (o jogo usa 223; o exemplo, 1) — o teste soma todos os
   mods do catálogo; mob, som, estrutura e conquista de mod ainda não têm tabela aberta.

---

## 4. Correções fora de marco

Bugs de marcos fechados corrigidos depois, desde 2026-09-27. **Os de antes (≈170 linhas) estão no
[histórico](15-historico.md), §4.** Uma correção nova entra aqui, no topo.

| Data | Onde | O que era |
|---|---|---|
| 2026-10-19 | `world/mesh/shapes.ts` | **A regra de canto de escada estava trocada** desde o acabamento pós-M7 (2026-09-14). Um vizinho perpendicular do lado alto fazia canto **interno**, e no gênero (e pela geometria) é **externo**; com o vizinho do lado aberto, o contrário. Numa pirâmide de escadas, a quina saía com o degrau cheio. O teste antigo olhava só um lado da face compartilhada; o novo compara os dois. Mundo salvo não muda, porque o canto é derivado dos vizinhos e não fica no save: a escada já construída passa a mostrar o canto certo. Achado no M23. |
| 2026-10-19 | `ui/gameflow.ts`, `main.ts` | **Trocar Criativo/Sobrevivência pela pausa fechava a sala da rede local** (M20 × modo de jogo). O fluxo tinha um `saveAll` só, que gravava **e** saía da sala (`leaveRoom`), e a troca de modo grava o mundo: o anfitrião fechava a sala, e o convidado era derrubado. Agora são duas peças, e só *Salvar e Sair* sai. Regressão no `npm run smoke:room`, que falha com o código antigo. Achado na revisão do M23. |
| 2026-10-19 | `save/serialize.ts` | **Coluna corrompida deixava duas promessas rejeitadas sem dono** (`writer.write` e `writer.close` da descompressão), e o navegador mostrava "Uncaught (in promise)". A falha já chegava pelo `read`; agora as duas têm `catch`. Achado pelo teste do M23. |
| 2026-10-19 | `save/savemanager.ts` | **Coluna descarregada perdida quando a gravação falhava** (M4): saía de `dirty` antes do `putChunks`. M23. |
| 2026-09-28 | `net/link.ts`, `net/linkhealth.ts` | **A sala caía a cada 2–3 minutos com o J7 Metal de anfitrião** (M20; campo, com um S24 Ultra de convidado). A ligação tratava `disconnected` como o fim, e esse estado do WebRTC é passageiro: aparece quando as verificações de consentimento atrasam alguns segundos (Wi-Fi de celular antigo em economia de energia) e volta sozinho a `connected`. Agora `disconnected` é "instável": os dois lados avisam na tela e no chat e esperam 20 s. Só `failed`, `closed`, um canal fechado, um envio que falha na fila cheia, ou a espera esgotada, derrubam. **Toda queda mostra o motivo** (na tela do convidado e no chat do anfitrião), para o próximo teste dizer qual foi. O canal rápido também deixa de enfileirar posição quando a fila passa de 256 KB. A causa no aparelho é a mais provável, **não medida**: o smoke não consegue interromper a rede entre dois Chrome. Regressão em `tests/linkhealth.test.ts`. |
| 2026-09-28 | `render/itemsprites.ts` | **Cada toque na mochila, bancada, fornalha e livro de receitas levava 5–10 s no J7 Metal** (T0, campo). O jogo rodava a 60 FPS. A folha de sprites (M4) ia ao CSS como `data:` URL de ~480 mil caracteres dentro de `--item-sheet`, e cada slot, receita e célula a resolvia a cada recálculo de estilo: 57 botões de receita recriados por toque. Agora é uma `blob:` URL. Medido com a CPU 6× mais lenta: ~3 000 ms por ação antes, 91–212 ms depois. Regressão em `npm run bench:ui` (orçamento de 600 ms) e em `tests/itemsprites.test.ts`. |
| 2026-09-28 | `public/manifest.webmanifest`, `ui/screenmode.ts` | **O app instalado não abria no Android 8.1** (J7 Metal, campo: *"CraftLite não está respondendo, CraftLite parou"*). No navegador, o jogo abria. Causa provável, não reproduzida: `"orientation": "landscape"` no manifesto. O Android 8 derruba uma atividade translúcida que fixa orientação (*"Only fullscreen opaque activities can request orientation"*), e a tela de abertura do WebAPK é translúcida. A orientação saiu do manifesto — **desvio do doc 11 §7**, escrito em `ui/screenmode.ts`, que já trava a paisagem no primeiro toque. O Chrome do Android 8 parou no 138. **A conferir no aparelho**, desinstalando antes. |
| 2026-09-27 | `net/blockreact.ts`, `net/host.ts`, `net/guest.ts` | **O buraco aberto pelo outro jogador ficava escuro** (M20; campo, com captura). O bloco que chega pela rede entra por `world.setBlock(…, 'network')`, e a luz só é recalculada por quem muda o bloco (a interação, o fluido): ninguém a recalculava, nem no anfitrião nem no convidado. Agora os dois recalculam, e o anfitrião também cuida de fluido, contêiner e placa, como o caminho local. Regressão em `tests/netroom.test.ts` (sem a correção, falha — conferido) e no smoke da sala (luz 15 no fundo do poço). |
| 2026-09-27 | `game/session.ts`, `input/playeractions.ts` | **Porta, alavanca e alçapão abriam e fechavam num clique** (desde a porta do M8; campo, como convidado, mas é do jogo). Com o botão direito seguro, o pedido de usar chega a cada tick (20 por segundo), e só colocar bloco tinha intervalo: um clique de 100 ms virava a porta duas vezes. Agora o bloco mirado só responde no tick em que o botão desceu, e segurar o botão sobre a porta não coloca o bloco da mão nela. Comer e colocar bloco seguem valendo com o botão seguro. Regressão em `tests/workshop.test.ts`. |
| 2026-09-27 | `input/keyboard.ts`, `input/controls.ts`, `input/keybinds.ts` | **`Ctrl`+`D` (correr para a direita) abria "salvar favorito" do Chrome** (campo). A repetição da tecla segurada saía antes do `preventDefault`, e as teclas de andar nem estavam na lista do jogo. Agora toda tecla de ação, inclusive na repetição, é do jogo enquanto o mouse está travado. **`Ctrl`+`W` é reservado pelo Chrome** e só se segura com a Keyboard Lock API em tela cheia pedida pela página: o **F11 do jogo** faz isso (`input/keylock.ts`), e **W duas vezes** corre sem `Ctrl`. Regressão em `tests/keyinput.test.ts`. |
| 2026-09-27 | `input/wheelsteps.ts`, `input/controls.ts` | **A roda do mouse "às vezes não funcionava"** (campo). Cada evento `wheel` andava uma casa; a roda de alta resolução, o touchpad e o Chrome no Linux mandam um dente em vários eventos pequenos, e a seleção dava voltas e parava onde estava. Agora evento grande anda uma casa e os pequenos somam até um dente. **Hipótese, não medida no mouse do usuário.** Regressão em `tests/keyinput.test.ts`. |

---

## 5. Pendências abertas

Só o que está aberto, **conferido em 2026-10-19** (no código, quando dá; o que é de aparelho vem do
registro de campo). O que fechou está no histórico.

### De código — conferidas no código

| Pendência | Onde | Marco que fecha |
|---|---|---|
| O boneco do outro jogador não balança o braço ao bater (só ao andar) | `net/avatars.ts` (`limbSwing` só de passo) | M30 |
| Inventário e movimento do convidado são confiados — desvio consciente do doc 12 §6; o alcance do pedido de bloco é 10, não 6 (folga do atraso) | `net/host.ts` (comentário do módulo) | M30 (inventário) |
| O convidado não liga sozinho os mods do anfitrião: recusa com a lista | `net/guest.ts` (`HELLO` com `activeModIds`) | M30 |
| O teto de mobs por categoria é um só para a sala | `entity/spawn.ts` | M30 |
| O convidado não vê mob pegando fogo (`fireTicks` não viaja) | `net/mobsync.ts` | M30 |
| O convidado que cai sem `BYE` perde até 10 s de **posição** (o inventário sai a cada mudança desde o M23) | `net/savecadence.ts` | — |
| O convidado não atravessa portal sozinho: a sala segue o anfitrião — desvio consciente do doc 14 | `net/dimensionsync.ts` | — (decisão) |
| Mod não tem tabela de mob, som, estrutura nem conquista; nem uso de item próprio, nem ouvinte de `world.setBlock` | `mods/types.ts` | quando o primeiro mod pedir |
| Tirar um mod de um mundo de propósito não existe: o mundo pede os mods do último save | `mods/worldmods.ts` | — |
| A quarentena guarda a coluna corrompida, mas recuperar é manual (não há tela) | `save/savemanager.ts` | — |
| O jogo usa o primeiro controle ligado e ignora o resto | `input/gamepad.ts` (`firstConnected`) | — (sem multijogador local) |
| O worker de sempre sai duas vezes no `dist/` (em `assets/` e como pedaço em `m/`, 42,8 KB que só baixam com mod) | `vite.config.ts` | — |
| Folga: atlas 223 de 256 camadas, áudio 2,92 de 3,5 MB, bundle 311,2 de 350 KB | `npm run size`, `tests/audio.test.ts` | **M25** |

### De aparelho — não vistos, ou não medidos

| O quê | De quando | Fecha em |
|---|---|---|
| Domínio `craftlite.zomertech.com.br` configurado (Cloudflare e Pages) e o jogo instalando e abrindo offline lá | 2026-10-18 | M22 |
| **O app instalado (PWA) não abre no J7 Metal** (Android 8.1): sem orientação no manifesto, a tela preta aparece e fecha. Causa não achada | 2026-09-28 | M22 |
| Aceite do M20: 30 min de sala; J7 anfitrião com um convidado **longe** (as âncoras) acima de 30 FPS; um aparelho nos dados móveis **não** fecha a ligação; a sala com o J7 de anfitrião por 10 min sem cair | 2026-09-27/28 | M22 |
| M20, segunda e terceira voltas em aparelho: nome e chat (teclado do celular), mob atrás do convidado, baú e fornalha, dormir juntos, placa, portal com a sala, construir longe do anfitrião, F11 com trava de teclado, roda do mouse | 2026-09-27 | M22 |
| M20 sem câmera nenhuma (dois computadores digitando o código, depende de mDNS) | 2026-09-27 | M22 |
| M16 e M19: o End inteiro, o dragão e as ilhas de fora, e **o FPS no T0** | 2026-09-24/25 | M22 |
| M17: a primeira hora no celular, de preferência com alguém que nunca jogou; o jogo em inglês; copiar e colar a seed | 2026-09-25 | M22 |
| M21: o PWA sem mod e **offline** (o boot e o precache mudaram), e o mod de exemplo | 2026-09-27 | M22 |
| M23: a tela de cota cheia, a borda de fogo e a fagulha no mob, escadas em L e em pirâmide, a mochila deitada | 2026-10-19 | M22 |
| No T0: a cor de grama por bioma (duas leituras de textura por vértice) e se o RD 5 cabe | 2026-09-23/24 | M22 |
| Firefox (computador e Android) e **Safari no iPhone**: nunca rodaram | — | M22 |
| Do acabamento de setembro, nunca olhados com atenção em aparelho: nuvens (custo de preenchimento), fogo que se espalha, contorno em alto contraste e modo daltônico, o boneco do inventário com as quatro peças de armadura, o Modo A de toque, `.clw` exportado e reimportado de verdade, `.ogg` real num resource pack | 2026-09-14 | M22 |
| Controle, segunda passada: o cursor do analógico direito na mochila, `L2` como clique direito, a navegação espacial, criar mundo só de controle; DualSense por cabo e um controle de Xbox (a família foi escrita sem nunca ter sido ligada) | 2026-09-14 | M22 |
| A abertura **medida no celular**: no desktop ~2 s entre o documento pronto e o título são CPU de boot, e é essa metade que cresce num T0 | 2026-09-14 | M22 |
| Uma sessão longa **jogando** no celular (o `npm run soak` cobre só voo: 92,5 min sem erro) | 2026-09-14 | M22 |

### Desvios conscientes que valem lembrar

Estão nos comentários dos módulos; os que mudam o que o jogador vê:
- **Mundo antigo ganha costura** onde o terreno gerado mudou (terreno de 2026-09-17, rios e clima
  do M14): não há migração possível, a saída é mundo novo.
- **Pareamento lembrado** do M20 deixado de fora (exige reescrever credenciais ICE no SDP à mão);
  com o leitor pela webcam, ninguém digita código.
- **Mod ligado sem rede antes de ter sido baixado:** o jogo abre sem o mod, e o mundo que o pede
  não abre.

---

## 6. Próximo passo recomendado

**De código: o M25** (folga para crescer, doc 14). Os marcos de conteúdo M26–M29 não cabem nos
tetos de hoje — atlas 223/256, áudio 2,92/3,5 MB, bundle 311,2/350 KB. O primeiro candidato do
bundle é o inglês embutido (~12 KB), que vira pedaço sob demanda como a sala do M20.

**Do usuário: o M22** (aparelho e MVP). O roteiro, numa sessão de celular, em ordem:

1. **Domínio:** no Cloudflare, CNAME `craftlite` → `gzomer14.github.io` só DNS (nuvem cinza); no
   GitHub, *Settings → Pages → Custom domain* = `craftlite.zomertech.com.br` e *Enforce HTTPS*.
   Depois, abrir, instalar e abrir offline no endereço novo. Os mundos do endereço antigo ficam lá.
2. **O PWA no J7:** `about://webapks` no Chrome do J7 (versão do *Shell APK*, *Update Status*,
   captura); com um computador, depuração USB e `adb logcat -b crash` enquanto o app abre — a
   primeira exceção diz a causa. Enquanto isso, *Adicionar à tela inicial → Criar atalho* abre sem o
   WebAPK. Sem o log, as hipóteses baratas (uma de cada vez): `display: standalone` sem
   `display_override`, e um ícone `maskable` próprio.
3. **A sala (M20):** computador e celular na mesma Wi-Fi; abrir pela pausa, entrar pelo título,
   ler os QRs pela câmera e pela webcam. Jogar 30 min: blocos nos dois sentidos, nome e chat, zumbi
   atrás do convidado, baú, dormir juntos, placa, portal do Nether. O convidado sai e volta com o
   inventário. **J7 de anfitrião com o convidado longe: FPS no F3** (acima de 30). Um aparelho nos
   dados móveis tentando entrar: não pode ligar. Se a sala cair, o motivo aparece entre parênteses.
4. **Os primeiros minutos (M17):** a dica do alto anda sozinha do tronco à picareta de pedra;
   inglês em Opções → Idioma; copiar e colar a seed em Mundos.
5. **O caminho até o dragão (M16, M19):** suporte de preparo, fortaleza do Nether, olho do ender,
   o End com os endermen, os cristais, o dragão (sem piscar branco, com o sopro), o portal de
   passagem e as ilhas de fora, os créditos. **FPS no T0** com o dragão.
6. **M23:** fogo num campo com vacas (pegam fogo e soltam fagulha); entrar no fogo (borda laranja
   embaixo, some na água); a mochila deitada inteira, com *Fechar* ao lado de *Receitas*; um L de
   escadas e um telhado em pirâmide; na sala, o convidado pega um item e desliga o Wi-Fi — ao voltar,
   o item está lá.
7. **Navegadores:** o jogo no Firefox (computador e Android) e no Safari do iPhone. Anotar o que
   funciona, o que degrada e o que quebra.
8. **Declarar o MVP** com os critérios de "pronto" do doc 14 — três já estão medidos (3G, sessão
   longa sem crash, zero assets); faltam 30 FPS no T0 com o conteúdo de hoje e os controles nos três
   jeitos.

---

## 7. Como manter este documento

Ao terminar qualquer entrega — marco, correção ou ajuste:

1. Atualize a linha do marco no §1 e no §3 (uma linha; o detalhe novo vai no §3 só enquanto o marco
   é o mais recente, e depois desce para o histórico).
2. Pendência criada ou fechada: §5. **Fechada sai da tabela** — o registro de que existiu fica no
   doc 16 e, quando for o caso, no histórico.
3. Bug de marco anterior corrigido: linha no topo do §4.
4. Refaça as métricas do §2 (`npm test`, `npm run build`, `npm run size`).
5. Registre os arquivos tocados em [16-auditoria.md](16-auditoria.md).
6. Atualize a data de "Última atualização" no topo, com **um** parágrafo — o anterior sai.
7. Se o documento passar de ~800 linhas, desça o detalhe dos marcos fechados para o
   [histórico](15-historico.md), acrescentando ao fim dele com a data.
