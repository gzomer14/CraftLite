# 16 — Auditoria de alterações

> Registro append-only de **toda sessão de desenvolvimento**: o que foi pedido, o que mudou em cada
> arquivo, e como o projeto ficou depois. O estado consolidado (o que está pronto, o que falta) vive
> em [15-status.md](15-status.md) — aqui é o histórico, lá é a foto.

**Ordem: sessão mais recente primeiro.** Cada sessão tem um cabeçalho com data/hora e um grid de
arquivos. Ações: **`+`** criado · **`~`** alterado · **`−`** removido · **`↻`** renomeado/movido.

Sessões anteriores a 2026-09-09 foram reconstruídas a partir das datas de modificação dos arquivos
e do README — elas não têm grid por arquivo porque o registro não existia ainda. Está marcado.

---

## 2026-09-23 · 09:10 → 09:58 · M12: o mundo chega antes do jogador

**Pedido:** *"Deu tudo certo nos testes do M11 e M13. Qual seria o próximo marco para atacarmos?"* —
recomendado o M12 — e *"Pode seguir com o M12"*.

**Resultado:** M12 fechado, com dois desvios conscientes e um critério não batido, todos escritos
no doc 15 §3. **Culling por conectividade:** numa caverna a Y≈21 com RD 8, 29% das sections com
malha no frustum vão para a lista (pede ≤ 50%); um teste de 8000 raios prova que nenhum bloco
visível fica de fora, e pega três mutações do algoritmo. A busca não poda pelo frustum e visita
cada section uma vez — as alternativas foram medidas e custavam o dobro ou mais por quadro.
**Faces viradas para a câmera** no opaco e no recortado. **Vizinhança montada no worker**, sem o
espelho de colunas que o doc 14 pedia (seriam N cópias do mundo): o pedido de malha leva as
sections cruas, um por coluna — 0,32 ms na thread principal contra 2 ms, e o mundo de RD 16 pronto
em 2,2× menos quadros com o orçamento real. O critério de "1,5× colunas em 40 ciclos" deu 1,17×:
o teste mede a divisão de vagas, não o custo do despacho. **Luz costurada** entre colunas.

Dois defeitos antigos apareceram e foram corrigidos: o **BFS de luz explodia na borda do mundo
carregado** (achado pelo smoke — a aba congelava ao criar o mundo) e o **crédito de pedido em voo
voltava para o worker errado**. O preset do T0 não foi revisto (sem aparelho). A correção das
texturas de pé foi vista em captura do Chrome: flor com a pétala em cima.

Portões: **2003 testes** em 100 arquivos, lint limpo, build ok, **229,0 KB** de 350, smoke verde.

| Ação | Arquivo | O que mudou |
|---|---|---|
| **Pipeline e worker** | | |
| `~` | `src/world/pipeline.ts` | um pedido de malha por coluna (máscara de sections); sections cruas no lugar da vizinhança; sem pool de buffers; sujas agrupadas por coluna; crédito de voo por worker |
| `~` | `src/world/neighborhood.ts` | `fillNeighborhood` sobre sections cruas e `gatherSections`; `extractNeighborhood` usa o mesmo núcleo |
| `~` | `src/workers/protocol.ts` | `MeshRequest` e `MeshResponse` por coluna; `SectionMeshResult` com a conectividade; `faceStarts` no mesh |
| `+` | `src/workers/meshjob.ts` | o trabalho do pedido de malha, usado pelo worker e pelos duplos de teste |
| `~` | `src/workers/chunk.worker.ts` | delega ao `MeshJobRunner` |
| `+` | `src/world/mesh/visibility.ts` | conectividade entre as faces da section (15 bits) |
| `~` | `src/world/mesh/greedy.ts` | anota o início de cada face no buffer de índices; laço de passes sem alocar |
| **Render** | | |
| `+` | `src/render/sectioncull.ts` | busca a partir da câmera, corte por frustum por quadro, `facingFaces` |
| `~` | `src/render/chunkrenderer.ts` | lista de desenho pelo culling; faces por section |
| `~` | `src/render/mesh.ts` | `MeshData.faceStarts`, `GpuMesh.drawFaces` |
| `~` | `src/render/renderer.ts` | a distância de render dimensiona a grade do culling |
| **Luz** | | |
| `~` | `src/world/lighting.ts` | `stitchColumn`; os dois BFS pulam coluna não carregada |
| `~` | `src/game/session.ts` | costura a luz na chegada da coluna |
| **Testes** | | |
| `+` | `tests/sectioncull.test.ts` | 13 testes: conectividade, busca, faces, critério da caverna, prova por raios |
| `+` | `tests/lightstitch.test.ts` | 6 testes: lava e céu através da borda, nos dois sentidos, o que re-mesha, borda do mundo carregado |
| `~` | `tests/pipeline.test.ts` | duplo que trabalha no `flush`; pedido por coluna; teto de voo real |
| `~` | `tests/dimensionrace.test.ts`, `tests/savegame.test.ts` | duplos no protocolo novo; pisos 51 pumps e 101 colunas |
| `~` | `tests/perf.test.ts` | orçamentos do pedido de malha, do culling e da costura de luz |
| **Docs** | | |
| `~` | `docs/15-status.md`, `docs/14-roadmap.md`, `README.md` | M12 fechado, M11 e M13 validados, §4 com os dois defeitos, métricas |

---

## 2026-09-23 · 08:40 → 09:05 · As plantas estavam de ponta-cabeça, e não eram só elas

**Pedido:** *"vários itens ao colocar no chão estão ficando de cabeça para baixo. Notei isso na
grama, flores, sementes, arvorês (Ainda antes de crescer)"* — no inventário apareciam certos.

**Resultado:** a causa não era do M11 nem do M13: vinha do M1. Todo quad de pé punha `v = 0` na
base, e o WebGL entrega a linha 0 do ladrilho (o topo do desenho) em `v = 0`. Confirmado por
captura em Chrome headless — dente-de-leão e papoula com a flor embaixo e o caule para cima. Em
textura simétrica não aparece, mas tocha, fornalha, bancada, baú, porta e bolo também estavam
invertidos. Faces de pé passaram a descer o `v` (terreno, cruz de planta, bloco que cai, item na
mão); topo e base ficaram como estavam. **Não visto em aparelho** — o headless não redesenhou a
cena depois de editada, então a verificação visual pós-correção fica para o campo (doc 15 §6).

Portões: **1981 testes** em 98 arquivos, lint limpo, build ok, **226,3 KB** de 350.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/render/mesh.ts` | `isUprightFace`; `addQuad` e `addPolyQuad` descem o `v` em face de pé (parâmetro `upright`) |
| `~` | `src/world/mesh/complex.ts` | a cruz de planta passa `upright` explícito (a face é +Y só pela sombra) |
| `~` | `src/render/hand.ts` | bloco na mão com o mesmo sentido de `v` nas laterais |
| `+` | `tests/texorientation.test.ts` | 6 testes: canto de cima com `v = 0` em greedy, cruz, tocha, porta e fornalha; topo inalterado |
| `~` | `tests/mesh.test.ts` | UV da corrida greedy em face +Z com o `v` novo |
| `~` | `docs/15-status.md`, `README.md` | §4 com a correção, §2 e §6, contagem de testes |

---

## 2026-09-22 · 18:33 → 19:28 · O M13 fechou: a sessão perdeu dois terços, e a lã ganhou cores

**Pedido:** a mesma sessão (*"seguindo sua ordem recomendada"*); no meio, *"Somente o M11 está sendo
implementado? Por que essa demora absurda para finalizar?"* — respondido: o M11 já tinha fechado, e
o M13 era o que estava em curso.

**Resultado:** M13 fechado. `session.ts` 2042 → 697 linhas, `main.ts` 1411 → 682, `screen.ts`
1117 → 890; uso de item como dado com usos de segurar; tint de 6 bits no vértice e lã e cama em
**16 cores** com o atlas caindo de 222 para **194 camadas**. Um defeito achado no caminho: as ações
de item miravam o centro da câmera mesmo no Modo A de toque.

Portões: **1975 testes** em 97 arquivos, lint limpo, build ok, **226,1 KB** de 350, smoke verde.

| Ação | Arquivo | O que mudou |
|---|---|---|
| **Sessão dividida** | | |
| `+` | `src/game/vehicles.ts`, `tiles.ts`, `workbench.ts`, `playercombat.ts`, `blockuse.ts`, `worldsystems.ts`, `sessionwiring.ts`, `itemuser.ts` | o que saiu da `Session`, um assunto por módulo |
| `+` | `src/entity/spawnerblocks.ts` | geradores de monstros da dungeon |
| `~` | `src/game/session.ts` | orquestra os módulos acima; 697 linhas |
| `~` | `src/game/itemuse.ts` | usos antigos migrados (comer, arco/escudo, barco, carrinho, isqueiro, enxada, semente); mira pela `Interaction` |
| `~` | `src/game/portal.ts`, `src/game/interaction.ts` | `breakPortalNear`; direção da mira guardada |
| `~` | `src/data/items.ts` | `ItemDef.uses` derivado; corantes novos no fim da fila |
| **main dividido** | | |
| `+` | `src/render/scenefeed.ts`, `render/ambience.ts`, `input/playeractions.ts`, `ui/hudfeed.ts`, `ui/gameflow.ts`, `ui/gamescreens.ts`, `game/playfield.ts`, `audio/audiostart.ts`, `core/lifecycle.ts`, `save/thumbnail.ts` | o que saiu do `main.ts`, com callbacks criados uma vez |
| `+` | `src/ui/bootscreen.ts`, `ui/controlhint.ts`, `ui/debugsource.ts`, `input/uinavloop.ts`, `core/dataurl.ts` | as funções soltas do fim do `main.ts` |
| `~` | `src/main.ts` | 682 linhas |
| `+` | `src/ui/containers/screenstyle.ts`, `containerclick.ts` | CSS e clique de contêiner saídos de `screen.ts` |
| **Tint de corante** | | |
| `+` | `src/data/tints.ts` | tabela de cores de tint e índice por bloco |
| `~` | `src/render/vertex.ts`, `render/mesh.ts`, `render/shaders/terrain.glsl.ts`, `render/terrain.ts`, `world/mesh/greedy.ts`, `world/mesh/blockinfo.ts` | tint de 6 bits, tabela em uniform, máscara de alfa no passe recortado |
| `~` | `src/data/dyes.ts`, `data/blocks.ts`, `data/textures.ts` | 16 cores; campo `dye`; lã e cama em desenho cinza |
| `~` | `src/render/itemsprites.ts`, `render/hand.ts`, `render/fallingblocks.ts` | sprite, mão e bloco caindo tingidos |
| **Testes e docs** | | |
| `+` | `tests/tints.test.ts` | tint, contagem de camadas, máscara da cama |
| `~` | `tests/vertex.test.ts`, `greedy.test.ts`, `texgen.test.ts`, `m8finish.test.ts`, `uxpolish.test.ts`, `creativeui.test.ts`, `rails.test.ts`, `dimensionrace.test.ts`, `itemuse.test.ts` e os que chamavam delegadores | formato de bits e caminhos novos |
| `~` | `docs/14-roadmap.md`, `docs/15-status.md`, `README.md` | M13 fechado, métricas, próximo passo |

---

## 2026-09-22 · 17:15 → 18:33 · O M11 fechou, e a madeira voltou a crescer

**Pedido:** *"Pode começar as implementações então, seguindo sua ordem recomendada"*.

**Resultado:** o **M11 fechou** — os 13 itens de dívida normativa, cada um com teste — e quatro
achados no caminho, que a avaliação não tinha visto: nenhuma planta crescia fora da roça (madeira
não era renovável), nenhum bloco queimava na fornalha, a água apagava a lava, e o jogador nascia no
mar em metade das seeds. O último foi achado pelo **smoke test de navegador**, que não existia e
passou a existir: 7 passos verdes em Chrome headless. O primeiro item do M13 (uso de item como
dado) nasceu aqui, porque o balde precisava dele.

Portões: **1930 testes** em 96 arquivos (eram 1823 em 89), lint limpo, build ok, **221,3 KB** de
350, smoke verde. Atlas em 222 camadas de 256; áudio em 3,33 MB de 3,5; geração de chunk em 6,2 ms.

| Ação | Arquivo | O que mudou |
|---|---|---|
| **Mundo** | | |
| `+` | `src/world/falling.ts` | areia e cascalho que caem: fila por evento com orçamento, entidade num pool, pouso e quebra na tocha |
| `+` | `src/world/trees.ts` | forma das quatro árvores com escritor por caminho (chunk ou `setBlock`), sorteios intactos |
| `+` | `src/world/gen/spawnsearch.ts` | ponto de nascimento em terra firme, em anéis a partir da origem |
| `~` | `src/world/growth.ts` | muda vira árvore, cana e cacto crescem, grama se espalha por registro de eventos e morre sob bloco opaco |
| `~` | `src/world/fluids.ts` | encontro água/lava dos dois lados, lava corrente vira pedregulho, ids pela tabela |
| `~` | `src/world/gen/decorate.ts` | usa `trees.ts`; cogumelos em caverna e mata fechada com sal próprio |
| `~` | `src/world/gen/structures.ts` | `underwater` no assentamento; `stamp` e `pickY` exportados para teste |
| `~` | `src/world/redstone.ts` | apoio aceita coluna de bloco `stackable` |
| `~` | `src/world/pipeline.ts` | `findSpawn()` pede o nascimento ao worker |
| `~` | `src/world/mesh/shapes.ts`, `src/world/mesh/blockinfo.ts` | forma de bolo com as fatias nos bits de estado |
| **Dados** | | |
| `+` | `src/data/effects.ts` | Fome, Regeneração, Absorção e Veneno como números por nível |
| `+` | `src/data/plants.ts` | tabela de crescimento: quatro mudas, cana e cacto |
| `~` | `src/data/blocks.ts` | campos `stackable` e `fuel`; planta com apoio; três mudas, folha de acácia, bloco de carvão, pedra lisa, bolo, dois cogumelos |
| `~` | `src/data/items.ts` | `use`, `remainder`, efeitos na comida; maçã dourada, ensopado, biscoito, açúcar, ovo, três baldes cheios, tesoura |
| `~` | `src/data/recipes.ts`, `src/data/smelting.ts` | receitas das comidas, tesoura, bolo e bloco de carvão; pedra → pedra lisa |
| `~` | `src/data/loot.ts` | cada folha dá a própria muda |
| `~` | `src/data/mobs.ts` | traços `woolly`, `lays`, `milkable`, `carriesBlocks`; a lã sai da cor |
| `~` | `src/data/structures.ts` | poço do deserto, cabana de bruxa, naufrágio e o loot dele |
| `~` | `src/data/textures.ts`, `src/data/itemart.ts` | mudas, bolo, cogumelos, bloco de carvão, pedra lisa; baldes, ensopado, ovo, tesoura, maçã dourada |
| **Jogo e entidades** | | |
| `+` | `src/game/effects.ts` | motor de efeitos sobre a tabela, com acúmulo e save |
| `+` | `src/game/food.ts` | efeitos ao comer |
| `+` | `src/game/itemuse.ts` | registro de uso de item: balde, leite, tesoura, corante, ovo, bola de neve |
| `+` | `src/entity/husbandry.ts` | cor e tosquia da ovelha, ovo da galinha, bloco do enderman |
| `~` | `src/game/session.ts` | liga queda, efeitos, bolo, registro de uso e ovo que choca; resto de item ao comer |
| `~` | `src/game/survival.ts` | vida extra, cura, veneno que não mata, efeitos no tick e no renascimento |
| `~` | `src/game/crafting.ts`, `src/game/container.ts` | resto de receita e de combustível (o balde volta) |
| `~` | `src/game/drops.ts` | tesoura colhe folha inteira |
| `~` | `src/game/interaction.ts`, `src/game/spawnplacement.ts`, `src/game/savegame.ts` | apoio em coluna; nascimento na coluna achada; efeitos no save |
| `~` | `src/entity/mobs.ts`, `src/entity/mobstore.ts`, `src/entity/spawn.ts`, `src/entity/projectile.ts` | produtos no tick e na morte; campos `product` e `carried`; cor ao nascer; projétil com item e ovo |
| **Render, UI e boot** | | |
| `+` | `src/render/fallingblocks.ts` | cubo do bloco que cai, no passe de terreno, com cache por luz |
| `+` | `src/ui/effectsbar.ts` | selos de efeito e corações dourados |
| `~` | `src/render/renderer.ts`, `src/render/entityatlas.ts` | bloco caindo no passe opaco; peles de ovelha por cor e tosquiada |
| `~` | `src/main.ts`, `src/ui/hud.ts` | faixa de efeitos, projétil com sprite, nascimento procurado, gancho `?smoke` |
| `~` | `src/workers/chunk.worker.ts`, `src/workers/protocol.ts`, `src/save/db.ts`, `src/audio/synth.ts` | mensagem `spawn`; `spawnFound` e efeitos no save; três sons curtos |
| **Testes e scripts** | | |
| `+` | `tests/falling.test.ts`, `tests/fluids.test.ts`, `tests/plants.test.ts`, `tests/fuel.test.ts`, `tests/effects.test.ts`, `tests/itemuse.test.ts`, `tests/spawnsearch.test.ts` | 107 testes novos |
| `~` | `tests/structures.test.ts`, `tests/savegame.test.ts`, `tests/pipeline.test.ts`, `tests/dimensionrace.test.ts` | estruturas novas; contrato novo do nascimento; duplos de worker conhecem `spawn` |
| `+` | `scripts/smoke.mjs` | smoke test de navegador sem dependência nova |
| `~` | `package.json` | `npm run smoke` |
| **Docs** | | |
| `~` | `docs/14-roadmap.md`, `docs/15-status.md`, `README.md` | M11 fechado, achados no §3 e §4, métricas, próximo passo |

---

## 2026-09-22 · 16:55 → 17:12 · A lista que se dizia fechada não estava

**Pedido:** *"Faça uma avaliação completa no projeto, para entender o que falta implementar, se
possui melhorias claras de performance, funcionalidades faltantes que podem ser implementadas,
entre outros pontos que quiser avaliar e adicionar como novos marcos. Quero esse jogo o melhor
possível"*.

**Resultado:** avaliação sem mudança de código, e sete marcos novos no roteiro (M11–M17). O achado
principal é que o doc 15 e o README afirmavam *"nenhum documento normativo tem pendência de
funcionalidade"*, e **13 itens dos docs 03, 04, 05, 07, 08 e 14 não existem no código** — a flag
`gravity` da areia nunca é lida, o balde é craftável e inútil, não há sistema de efeitos de status,
a tesoura não existe como item, bétula e pinheiro não são renováveis, entre outros. Cada um foi
conferido com `grep` e leitura do módulo, e está com arquivo e linha no doc 15 §5.

Na performance, o orçamento de quadro está folgado em todos os tiers; o que falta é de
carregamento e alcance: o culling por conectividade de sections pedido no PROMPT.md §4.2 não
existe, a cópia de vizinhança custa ~0,26 ms por section na thread principal, e a luz gerada para
na borda do chunk. Na manutenção, `session.ts` (1911 linhas), `main.ts` (1376) e
`ui/containers/screen.ts` (1117) passam muito do teto de ~400, e `Session.useHeld` é uma cadeia de
onze `try*` que o balde, a tesoura e o ovo aumentariam.

Portões rodados antes de escrever: 1823 testes verdes em 89 arquivos, lint limpo, build ok,
208,8 KB gzip de 350.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/14-roadmap.md` | seção "Avaliação de 2026-09-22" com ordem recomendada e os marcos M11 (dívida normativa), M12 (carregamento e culling), M13 (casa em ordem), M14 (água e paisagem), M15 (oficina), M16 (um fim para a jornada) e M17 (alcance), cada um com evidência e critério de aceite |
| `~` | `docs/15-status.md` | data; M9–M17 no §1; §2 reconfirmado; §3 com a avaliação; §5 desmente a "lista fechada" com a tabela dos 13 itens e o roteiro em ordem; §6 ganha o item 0 (começar o M11) |
| `~` | `README.md` | estado atual sem a afirmação de zero pendência normativa; M9–M17 propostos na lista de docs |

---

## 2026-09-17 · 12:10 → 12:21 · A placa escondia o que a placa escrevia

**Pedido:** *"Todos os 5 testes passaram perfeitamente. Só a placa que por conta de sua textura mal
dá para visualizar o texto escrito (…) essa divisão por linhas também ficou horrorosa para digitar
na placa, não tem como adicionar um único campo de texto, e o próprio código interpreta se houve
uma quebra de linha (…) Podemos ainda limitar a 4 linhas, porém em um único campo de texto. Outra
coisa, pode adicionar o .abacusai ao gitignore"*.

**Resultado:** o M8 e a correção de terreno foram **validados em aparelho**, e os dois defeitos da
placa saíram — o de ler e o de escrever.

### A tábua escondia o texto

A placa era tábua de carvalho com **três linhas de rabisco** desenhadas por cima: a "escrita"
ilegível que fazia o olho reconhecer uma placa **quando não havia texto de verdade**. Quando passou
a haver, o rabisco virou o ruído que o cobria.

O erro não era só de tom, era de **agitação** — medido na área de escrita do ladrilho:

| | Luminância média | Desvio |
|---|---|---|
| Tábua de carvalho (era), mais o rabisco | 118 | **25,9** |
| Tinta do texto | 24,8 | — |
| Tábua da placa (é) | **172** | **4,7** |

O fundo variava mais do que a letra contrastava. A placa ganhou textura própria — a única superfície
do jogo desenhada para servir de fundo de leitura: grão de variância baixa, sem `plankLines` (o
sulco da tábua corta a letra na horizontal), moldura de 1 px e um fio claro por dentro dela.

### Quatro campos era um campo a mais

Quem escreve pensa em frase, não em linhas. O editor virou um `<textarea>` e a distribuição virou
`wrapSignText`, com duas regras: a quebra digitada manda (linha vazia continua vazia, que é como se
centra uma palavra na terceira linha) e o que sobra da largura desce **por palavra** — cortar
"FERRARIA" no meio seria pior que descer a palavra inteira. Palavra maior que a placa é cortada na
força, porque não tem para onde descer.

Um teste vermelho pagou um detalhe: a quebra tem de acontecer **antes** da normalização.
`toFontText` troca por espaço tudo que a fonte não desenha, e `\n` é uma dessas coisas — normalizar
primeiro apagava exatamente a quebra que o jogador acabara de digitar.

O campo **não** é reescrito enquanto se digita: isso exigiria devolver o cursor ao lugar certo a
cada tecla, e a quebra por palavra come o espaço do ponto de quebra. Em vez disso há uma **prévia**
de quatro linhas na largura exata da placa, na cor da tábua e da tinta. `Ctrl+Enter` confirma,
porque `Enter` agora é quebra de linha.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/textures.ts` | `block/oak_sign` deixou de herdar a tábua de carvalho e de ter rabisco: virou tábua lisa e clara, desenhada para ser fundo de leitura. |
| `~` | `src/game/signs.ts` | `wrapSignText` (quebra digitada + quebra por palavra, teto de 4 linhas) e `signTextToInput` (o caminho de volta, para reabrir o editor). |
| `~` | `src/ui/screens/signeditor.ts` | Um `<textarea>` no lugar de quatro campos, com prévia das quatro linhas na largura da placa, aviso de excesso e `Ctrl+Enter` para confirmar. |
| `~` | `src/render/signtext.ts` | `SIGN_INK` exportada — é contra ela que o teste mede o contraste da tábua. |
| `~` | `tests/sign.test.ts` | +11 testes: oito da quebra de linha e três da régua de legibilidade da tábua (mais clara que a tinta **e** mais calma que a tábua comum). |
| `~` | `.gitignore` | `.abacusai/`, diretório de ferramenta externa. |
| `~` | `docs/15-status.md` | §1 (validação em campo + 2ª passada da placa), §2 (métricas), §3 (quinta passada), §4 (o bug da textura), §5 e §6 (roteiro de aparelho com os cinco itens riscados). |
| `~` | `README.md` | Contagem de testes, bundle e a validação em aparelho. |

**Portões:** `npm test` 1823 testes em 89 arquivos, `npm run lint` limpo, `npm run build` ok,
`SIZE_BUDGET_KB=350 npm run size` 208,8 KB de 350 (60%).

---

## 2026-09-17 · 10:36 → 11:44 · As montanhas eram pilares, e o M8 fechou

**Pedido:** duas coisas. *"Verifique para mim qual o estado atual do projeto, e o que falta ainda
implementar"*; e, depois do diagnóstico, *"Continue então o desenvolvimento do M8, para
finaliza-lo"* mais um relato de campo: *"criei um mundo do zero, criativo, e sai voando um
pouquinho (…) começou a gerar diversas montanhas, porém as montanhas eram literalmente verticais
(…) simplesmente pilares enormes verticais, e vários um do lado do outro"*.

**Resultado:** o bug do terreno tinha **duas** causas, as duas medidas antes de qualquer correção; e
os quatro itens que faltavam no M8 foram entregues, incluindo o que o próprio doc 14 dava como
impossível sem um formato de vértice novo.

### O terreno: parede de bioma e teto duro

O doc 03 §4.3 pede média ponderada 5×5 a cada 4 blocos da altura de bioma e diz, com todas as
letras, que *"sem isso, aparecem paredes retas entre biomas"*. O código nunca fez isso — e o
comentário de `gen/terrain.ts` **afirmava que fazia**, chamando a grade esparsa de ruído de "o blend
5×5 do doc 03 §4.3". Ela suaviza a entrada (os mapas de ruído), não a saída (o `heightOffset`), e o
degrau de 24 pontos entre montanha e planície passava inteiro: **29 blocos de desnível em um bloco
de distância**. A segunda causa era o `clamp` duro no teto do mundo, em que **54,3% das colunas de
montanha** batiam — a cordilheira virava um platô liso em Y=124, com topo chapado e lado vertical.

Medido na região mais montanhosa da seed 12345, num quadrado de 256×256 blocos:

| | Antes | Depois |
|---|---|---|
| Maior degrau entre vizinhos | 37 blocos | **6** |
| Vizinhos com degrau ≥ 6 | 3,10% | **0,040%** |
| Colunas no teto do mundo | 10,3% | **0%** |
| Faixa da montanha | 118..124 | **90..117** |
| Geração de chunk | 6,2 ms | **6,2 ms** |

Dois bugs antigos caíram junto: `structures.ts` pedia altura com `sampleColumn(noise, ox, oz, 0, 0)`
e as coordenadas eram **ignoradas** no caminho de grade (a estrutura era assentada na altura do
canto do chunk), e a decoração usava um caminho ~25× mais caro por coluna.

**Isto muda o terreno gerado:** mundo antigo ganha costura entre o que já foi gerado e o que ainda
não foi. Não há migração — terreno é função da seed, e a função mudou.

### M8: os quatro que faltavam

- **Placa com texto**: fonte 5×7 escrita em binário (acento é composição, não glifo), folha de
  128×128 gerada por código, texto guardado por posição com o ciclo de vida do baú, passe próprio
  com um quad por glifo e `discard` por alfa. Editor com `<input>` de verdade, porque no celular o
  teclado do sistema sabe acento e corretor e nada disso se reimplementa em canvas.
- **Quadro com arte**: quatro telas escritas com `pattern`, escolhidas pela posição do bloco.
- **Oito cores**: `data/dyes.ts` vira a tabela de onde saem lã, cama, corante e receitas. A cama
  colorida não custou uma linha de lógica — dormir e morrer em duas metades saem da forma e do
  `multi`, que são dado.
- **Tampa do baú**: o doc 14 dizia que exigia um segundo formato de vértice. Não exigia — o mesher
  já escreve quad de quatro cantos arbitrários desde a tocha torta e a rampa de trilho, e o formato
  guarda **posição**, não transformação.

### Arquivos

**Terreno**

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/gen/heightfield.ts` | Módulo novo: blend 5×5 do `heightOffset`/`heightScale` a cada 4 blocos com kernel binomial, teto macio no lugar do `clamp`, e janela com 16 blocos de margem para decoração e estrutura lerem a mesma altura do gerador. |
| `~` | `src/world/gen/terrain.ts` | Perdeu a grade esparsa e o `sampleColumn`, que foram para o módulo novo; `TerrainNoise` ganhou o campo `field`, que tem o mesmo ciclo de vida do ruído. |
| `~` | `src/world/gen/decorate.ts` | Passou a receber `HeightField` em vez de `TerrainNoise`; a altura da árvore vem da mesma janela que o gerador usou. |
| `~` | `src/world/gen/structures.ts` | Idem, e a altura da estrutura passou a ser a do lugar dela, não a do canto do chunk. |
| `+` | `tests/heightfield.test.ts` | 8 testes: sem parede vertical, sem coluna no teto, montanha ainda com 27 blocos de amplitude, teto macio crescente, e o mesmo número pedido por chunks vizinhos. |

**Placa com texto**

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/font.ts` | Fonte 5×7, 76 caracteres, com acento por composição. |
| `+` | `src/render/fontgen.ts` | Folha RGBA de 128×128, branca com alfa zero. |
| `+` | `src/render/signtext.ts` | Passe do texto: um quad por glifo, buffer pré-alocado, corte em 32 blocos. |
| `+` | `src/render/shaders/signtext.glsl.ts` | Shader com `discard` por alfa, em 100 e 300. |
| `+` | `src/game/signs.ts` | `SignStore`: quatro linhas por posição, normalização e registros de save. |
| `+` | `src/ui/screens/signeditor.ts` | Tela de edição com quatro campos, Enter desce linha e confirma na última. |
| `~` | `src/game/session.ts` | `signs`, evento `onSignEdit`, abre o editor ao colocar e ao usar, apaga o texto ao quebrar e ao trocar de dimensão. |
| `~` | `src/game/savegame.ts` | `TileRecord` virou união: contêiner ou placa, na mesma lista do save. |
| `~` | `src/render/renderer.ts` | Slot `signTextPass`, desenhado depois do terreno e antes do translúcido. |
| `~` | `src/main.ts` | Monta o passe e o editor, e alimenta o passe por quadro com as placas perto. |
| `~` | `src/ui/screens/menu.ts` | Estilo `.menu-hint`, para a dica de tamanho de linha. |
| `+` | `tests/sign.test.ts` | 24 testes: nenhum par de glifos com o mesmo desenho, folha sem tinta fora da célula, guarda e geometria. |
| `+` | `tests/signsession.test.ts` | 9 testes de fiação: editor abre com o texto certo, quebrar leva o texto, tampa do baú abre e fecha. |

**Quadro, cores e tampa do baú**

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/dyes.ts` | Oito cores, com os tons de lã, colcha, vinco e destaque, e de onde vem cada corante. |
| `~` | `src/data/textures.ts` | Quatro quadros escritos com `pattern`; as três receitas de cama saíram de escritas à mão em vermelho para geradas por cor; lã colorida. |
| `~` | `src/data/blocks.ts` | `paintingStages()`, lã e cama coloridas geradas (ids a partir de 200), cama base virou "Cama Vermelha". |
| `~` | `src/data/items.ts` | Oito corantes, no fim da lista para não mover id. |
| `~` | `src/data/itemart.ts` | Sprite de corante e de cama por cor. |
| `~` | `src/data/recipes.ts` | `dyeRecipes()`: corante por fonte e por mistura, tingir lã, e uma cama por cor. A tag `#wool` passou a listar as oito. |
| `~` | `src/data/smelting.ts` | Cacto → corante verde, o único que sai da fornalha. |
| `~` | `src/game/interaction.ts` | O quadro escolhe a tela pela posição; a parede continua nos bits 0–1. |
| `~` | `src/world/mesh/shapes.ts` | Constantes do baú exportadas e `CHEST_LID_ANGLE`. |
| `~` | `src/world/mesh/blockinfo.ts` | `CPLX_CHEST`, com o comentário que desmente o doc 14. |
| `~` | `src/world/mesh/complex.ts` | `emitChest`/`chestBox`: caixa com os oito cantos rodados na CPU. |
| `~` | `src/game/session.ts` | Abre e fecha a tampa (e a do par, no baú duplo) pelo `setBlock` de sempre. |
| `+` | `tests/m8finish.test.ts` | 13 testes: tela por estado, toda cor com bloco/item/textura/receita, forma do baú intocada ao abrir. |

**Testes e docs tocados de tabela**

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `tests/texgen.test.ts` | Seis pares de quadro e quatro de cor entraram na régua de legibilidade. |
| `~` | `tests/savegame.test.ts` | Usa `ContainerRecord` onde o registro é de contêiner. |
| `~` | `tests/dimensionrace.test.ts` | A sessão falsa ganhou `signs`. |
| `~` | `tests/perf.test.ts` | Passou a imprimir o tempo do acabamento do atlas e o da folha de sprites. |
| `~` | `docs/14-roadmap.md` | Os quatro itens do M8 marcados, com o porquê de a tampa do baú não precisar de formato novo. |
| `~` | `docs/15-status.md` | §1 (M8 fechado + linha do terreno), §2 (métricas), §3 (quarta passada e o terreno), §4 (três bugs), §5 (costura no mundo antigo, folga do atlas), §6 (roteiro de aparelho reordenado). |
| `~` | `README.md` | Contagem de testes, bundle e o estado do M8. |

**Portões:** `npm test` 1812 testes em 89 arquivos, `npm run lint` limpo, `npm run build` ok,
`SIZE_BUDGET_KB=350 npm run size` 208,3 KB de 350 (60%).

---

## 2026-09-16 · 14:45 → 15:05 · Seis peças de tábua eram o mesmo desenho no slot

**Pedido:** três relatos do jogador. *"Vários itens estão com textura que parece um bloco de madeira
normal, mas na realidade colocando no chão são outros itens, como por exemplo a placa de madeira, a
cerca, melancia, abóbora, alçapão, laje"*; *"a mesa de trabalho e o baú estão com textura muito
semelhante, difícil distinguir batendo o olho no inventário"*; *"a fornalha está muito feia, parece
um bloco normal de pedra tanto no chão quanto no inventário"*.

**Resultado:** o primeiro relato tinha **duas** causas independentes, e uma delas era maior do que
parecia.

### Causa 1: o sprite ignorava a forma do bloco

`drawBlockIsometric` desenhava sempre um **cubo** com a textura do bloco. Cerca, laje, placa,
alçapão, escada e portão são todos de tábua de carvalho — como cubo, os seis saíam com o mesmo
desenho. Não era falta de textura: era falta de **forma**.

A silhueta passou a sair de `boxesFor`, a mesma lista que o mundo desenha e que a física colide.
A projeção é a que o cubo já usava, escrita agora para um ponto qualquer do bloco:

```
x = 8 + (bx − bz)·8
y = 1 + (bx + bz)·4 + (1 − by)·7
```

Com a caixa unitária ela reproduz o desenho antigo **pixel por pixel** — foi o critério para trocar.
As caixas são ordenadas de trás para frente (pintor) por `x0 + z0`, com empate na altura, para a
tampa do baú cobrir o corpo e não o contrário.

Duas decisões de pose, que são de legibilidade e não de geometria: a **cerca** posa com dois braços
opostos, porque uma cerca sem braço é um poste e ninguém reconhece um poste como cerca; e a
**escada** posa com o degrau virado para a câmera, porque com o estado 0 o lado alto cai atrás e a
silhueta sairia idêntica à de um cubo cheio — justamente o que este passe veio consertar.

Planta e trilho saíram da isometria: eles aparecem como **o próprio ladrilho, de frente**. Um cubo
de flor nunca fez sentido, e era o que havia.

### Causa 2: textura emprestada, de verdade

A varredura da tabela achou o resto:

| Bloco | Apontava | Virou |
|---|---|---|
| Abóbora | `block/oak_planks` | gomos e cabinho |
| Melancia | `block/oak_planks` | casca listrada, polpa no topo |
| Acácia (tronco e tábua) | carvalho | madeira alaranjada própria |
| Muda | `block/oak_leaves` | arvorezinha com tronco |
| Samambaia, cana, arbusto seco | `block/tall_grass` | três silhuetas distintas |
| Grama alta, dente-de-leão, papoula | um **X** recortado | touceira, flor com haste e folhas |

O X merece nota: `alphaMask('cross')` recorta as **duas diagonais do ladrilho**, e isso vinha de
confundir a máscara com a geometria. A planta é desenhada em dois quads cruzados e cada quad mostra
o ladrilho inteiro — se o ladrilho também é um X, o resultado é uma estrela, não uma flor. Com o
sprite virando ladrilho de frente, ficou impossível de ignorar.

As plantas novas usam um operador novo, `pattern`: desenho escrito como texto, no mesmo formato da
arte de item. Ruído continua sendo ruído; silhueta agora é silhueta.

**Uma troca consciente:** muda, samambaia e cana saíram do tint de bioma. O tint multiplica a
textura inteira pela cor do bioma e só funciona com desenho cinza — um tronco marrom de muda não
pode ser pintado de verde. Trocou-se variação por bioma por saber o que é cada planta.

### Fornalha e baú

A **fornalha** era pedregulho 18% mais escuro com uma moldura fina: de relance, uma pedra. Ganhou
**boca** — buraco escuro com grelha —, moldura de ferro rebatida e topo com boca de carga. A boca
aparece nos quatro lados, e não só na frente como no gênero, porque o formato de vértice não guarda
rotação de textura (doc 01 §5.1): quatro bocas lêem como fornalha, uma pedra lisa não lê como nada.
A acesa passou a ter a boca **inteira** em brasa.

**Baú e bancada** passavam na régua de legibilidade de 22 e mesmo assim se confundiam — porque a
diferença era de **detalhe**, e 16 px não carregam detalhe. Virou diferença de **valor**: baú
escuro e ferrado (0,44), bancada clara (1,02). A régua daquele par subiu para 44. A tranca do baú
mudou de face: em −Z ela existiria só para quem olha por trás, já que a isometria mostra +X e +Z.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/render/itemsprites.ts` | sprite por caixas com ordenação de pintor; planta e trilho de frente; pose de cerca e escada |
| `~` | `src/render/texgen.ts` | operador `pattern`: desenho escrito como texto |
| `~` | `src/data/textures.ts` | abóbora, melancia, acácia, muda, samambaia, cana, arbusto seco, trepadeira, folha de bétula, grama alta, dente-de-leão, papoula, fornalha (lado e topo), baú e bancada |
| `~` | `src/data/blocks.ts` | as texturas emprestadas apontando para as próprias; fornalha com topo próprio; tint fora de muda, samambaia e cana |
| `~` | `src/world/mesh/shapes.ts` | tranca do baú na face que o inventário mostra |
| `+` | `tests/itemshapesprite.test.ts` | 20 testes: silhuetas distintas por forma, planta de frente, e o cubo intacto |
| `~` | `tests/texgen.test.ts` | 12 pares novos de legibilidade, régua de 44 para baú/bancada, e a boca da fornalha medida por região |
| `~` | `tests/shapes.test.ts` | face da tranca |
| `~` | `docs/14-roadmap.md`, `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | M8 |

**Portões:** 1710 testes (85 arquivos), lint limpo, build limpo, **200,9 KB gzip** de 350.
181 camadas de atlas de 256; folha de sprites em volume 33,9 ms (eram 29,3), teto de 200.

---

## 2026-09-16 · 13:50 → 14:40 · O vidro não estava fosco: ele não estava lá

**Pedido:** *"Vamos seguir então com o desenvolvimento do M8. Queria também um ajuste para
adicionar uma leve textura no 'Vidro' do jogo, para conseguir diferenciar que hoje realmente existe
o vidro (…). Ele ainda precisa possibilitar o jogador de ver através dele, porém com alguma coisa
para indicar ao jogador sua presença"*.

**Resultado:** o vidro não era discreto demais — ele era **invisível**, e por um motivo mecânico.

### O vidro

A receita pintava o ladrilho inteiro com `alpha: 0.28` e recortava tudo fora da moldura. Só que
vidro é desenhado no passe **recortado**, cujo shader faz `if (texel.a < 0.5) discard`. Medido:
**zero pixels** acima do corte. Uma janela colocada não deixava rastro nenhum na tela, e o slot do
inventário parecia vazio — exatamente o sintoma relatado.

A correção não foi "deixar opaco", que tiraria a janela: é **moldura de 1 px** nas quatro bordas
mais **duas riscas em diagonal** de reflexo, com o resto em alfa zero. 29% do ladrilho é desenho,
71% é buraco de verdade. Não foi para o passe translúcido de propósito: lá o desenho é ordenado de
trás para frente e não escreve profundidade, e vidro é justamente o bloco que se empilha em parede
inteira — numa GPU de 2016 isso é preenchimento caro por um ganho que a moldura já dá.

O teste que entrou cobre a **classe** do bug, não o caso: todo bloco desenhado nos passes opaco e
recortado precisa de pelo menos um pixel acima do corte de alfa. São 195 asserções gerada da
tabela; nenhum outro bloco estava na mesma situação.

### Escada de mão: ela não escalava

Buscando o que mais estava "chapado", apareceu um buraco maior que o visual: **a escada de mão era
decoração**. Não havia uma linha de código sobre escalar em lugar nenhum — o jogador atravessava
a escada como se fosse ar. Não estava registrado como desvio consciente porque nunca foi decidido.

Agora ela sobe a 0,2 por tick (4 blocos/s, mais lento que andar de propósito), desce controlada a
0,15, e **agachar segura no lugar**. O campo é `climbable` na tabela de blocos, não
`shape === 'ladder'`: a propriedade é de física, e trepadeira e corrente sobem sem ter forma de
escada.

Uma coisa quebrou junto e é instrutiva: o **auto-step**. Ele existe para subir um degrau quando o
horizontal trava — e na escada o horizontal trava sempre, porque ela vive colada numa parede. O
passo levantava o corpo, tentava andar e **devolvia a altura** no fim, apagando a subida do tick
inteiro: empurrar para a frente na escada não saía do lugar. Na escada, quem sobe é a escada.

A forma acompanhou: dois montantes e três degraus, com o degrau 1/16 recuado — é a sombra entre as
peças que faz o olho ler "degrau" em vez de "listra". A textura deixou de ser a escada desenhada
com o vão vazado e virou madeira lisa, porque cada caixa mostra o ladrilho inteiro espremido na
largura dela: com o recorte antigo, um montante de 2/16 podia calhar de amostrar o vão e sumir.

### Baú e fornalha

O **baú** era um cubo inteiro — encostado noutro cubo, só a textura o distinguia. Virou corpo,
tampa e tranca, com 1/16 de folga em volta, que é o que faz dele um móvel pousado no chão. A tampa
**não abre**: girar uma caixa em torno da dobradiça não é representável numa geometria alinhada aos
eixos, e está registrado no doc 14 como o que falta.

A **fornalha** queimava sem dar sinal: mesma textura, mesma luz. Agora são dois ids, como a lâmpada
de redstone — a emissão é coluna da tabela indexada por id, e é ela que o flood fill lê. Acesa, ela
tem emissão 13 e a boca em brasa; a troca avisa a luz, senão a textura acende e a caverna continua
escura.

### Portas das outras madeiras

Bétula e pinheiro ganharam porta, com os ids **no fim da tabela**: `BUILD_PARTS` é percorrida por
material, e uma peça nova no meio empurraria o id de tudo que vem depois — e id vai para o save.

De quebra, uma correção de receita: a porta era `#planks` genérico, então seis tábuas de bétula
davam uma porta de **carvalho**. Virou receita por material, junto com escada, laje e cerca.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/textures.ts` | vidro com moldura e reflexo; boca acesa da fornalha; escada em madeira lisa; portas de bétula e pinheiro geradas |
| `~` | `src/data/blocks.ts` | campo `climbable`; forma `chest`; `furnace_lit` (128); portas de bétula e pinheiro (129–132) |
| `~` | `src/data/itemart.ts` | silhueta da escada de mão |
| `~` | `src/data/loot.ts` | fornalha acesa e as metades de cima das portas novas |
| `~` | `src/data/recipes.ts` | porta por material; a genérica de `#planks` saiu |
| `~` | `src/entity/player.ts` | escalar: subir, descer controlado, segurar agachado, e auto-step desligado na escada |
| `~` | `src/game/session.ts` | `syncFurnaceBlock`; fornalha acesa abre, cria contêiner e é minerada como fornalha |
| `~` | `src/world/mesh/shapes.ts` | `SHAPE_CHEST`; escada com montantes e degraus |
| `~` | `src/world/mesh/blockinfo.ts` | baú nas tabelas de forma |
| `~` | `src/world/redstone.ts` | pistão não move fornalha acesa |
| `+` | `tests/ladder.test.ts` | 11 testes: forma da escada e as cinco regras de escalada |
| `+` | `tests/furnacelit.test.ts` | 5 testes: troca de bloco, luz que acompanha, e o conteúdo que sobrevive |
| `~` | `tests/texgen.test.ts` | corte de alfa por bloco (a classe do bug do vidro) e a janela do vidro |
| `~` | `tests/shapes.test.ts` | caixas do baú |
| `~` | `tests/multiblock.test.ts` | portas de bétula e pinheiro |
| `~` | `docs/14-roadmap.md`, `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | M8 avançado |

**Portões:** 1672 testes (84 arquivos), lint limpo, build limpo, **198,3 KB gzip** de 350.
167 camadas de atlas de 256; meshing 0,68 ms/section.

---

## 2026-09-16 · 09:20 → 10:10 · O que fazia tudo parecer chapado era um bit de posição

**Pedido:** *"gostaria que você fizesse uma revisão completa no código para ir corrigindo possíveis
furos, problemas de layout, problemas de performance (…) Algo que ainda me incomoda são as texturas
chapadas das ferramentas, ou da tocha que não parece uma tocha verdadeira, ou da cama e porta que
são simplesmente blocos únicos"*.

**Resultado:** os três incômodos tinham **uma causa comum**, e ela não era textura.

### A causa: meio bloco de precisão

O formato de vértice guardava a posição em **meios-blocos** (6 bits por eixo). Toda caixa mais fina
que 0,5 bloco colapsava no arredondamento — e é assim que quase toda forma do jogo é descrita:

| Peça | Espessura declarada | O que a GPU recebia |
|---|---|---|
| Poste de cerca | 2/16 | **nada** — a cerca isolada era invisível |
| Grade de vidro | 1/16 | nada |
| Porta, alçapão, placa, quadro | 3/16 | um plano de espessura zero |
| Botão, alavanca, repetidor | 2/16 | plano |
| Trilho (levantado do chão) | 1/16 | colado no chão, brigando com ele no Z |

Não faltava desenho: faltava **volume representável**. A posição passou a ser em **1/16 de bloco**
(9 bits por eixo), e os 3 bits vieram de onde não faziam falta — `tint` tem quatro valores (2 bits
bastam), `u`/`v` mudaram para a segunda palavra e o campo `flags`, que nunca teve leitor, saiu.
**Continua em 8 bytes por vértice**, então o orçamento de memória de mesh do doc 02 §3 não muda.

### O que isso destravou

- **Tocha**: deixou de ser uma cruz de planta (era a saída honesta enquanto um poste de 2/16 não
  cabia) e virou um poste com brasa no topo, encaixe de chão e de parede, **inclinada** na parede, e
  com fagulha saindo da ponta.
- **Porta e cama**: viraram blocos de **duas células**. A máquina que faltava é `world/multiblock.ts`
  — e ela é pequena porque mora no `setBlock`: as duas metades morrem juntas para **qualquer** causa
  (jogador, creeper, fogo, pistão), sem nenhum desses sistemas saber que porta tem duas metades.
- **Item na mão**: o quad chapado virou sólido extrudado da própria silhueta, com as bordas
  amostrando o pixel de dentro — a lateral da lâmina sai com a cor da lâmina.
- **Contorno do bloco mirado**: passou a ter o tamanho da forma. Mirar uma tocha acendia um cubo.

### Achados de revisão que não eram o pedido

- **Textura de face em forma de caixa**: toda face usava a textura de *lado*. O topo de uma laje,
  de uma escada ou de uma cama saía com o desenho da lateral.
- **Bloco com apoio que não é de redstone nunca era conferido**: a fila de `world/redstone.ts` só
  aceitava componente de circuito, então **trilho comum flutuava** quando o chão sumia. A checagem
  já existia; faltava alguém chamá-la.
- **Porta e circuito**: com duas folhas, uma alavanca alcança só uma delas — a folha tocada passou a
  arrastar a outra, senão metade da porta abre e a outra metade barra a passagem.
- **Aldeia**: a casa nascia com a tocha **boiando** no meio da sala e a cama contra a parede. Tocha
  na parede, cama com pé e cabeceira para dentro, porta com as duas metades.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/render/vertex.ts` | posição em 1/16 (9 bits/eixo), `u`/`v` e `tint` na palavra 1, `flags` removido |
| `~` | `src/render/mesh.ts` | `vertex()` arredonda em dezesseis avos |
| `~` | `src/render/shaders/terrain.glsl.ts` | descompactação nova (× 0,0625, face no bit 27) |
| `+` | `src/world/multiblock.ts` | blocos de duas células: par, colocação, órfã e metade principal |
| `~` | `src/world/mesh/shapes.ts` | `SHAPE_TORCH` e `SHAPE_BED`, geometria dos dois, `boundsFor` |
| `~` | `src/world/mesh/complex.ts` | `emitTorch` (poste inclinado, tampa de baixo culled), textura por face |
| `~` | `src/world/mesh/blockinfo.ts` | `CPLX_TORCH`; tocha e cama nas tabelas de forma |
| `~` | `src/world/redstone.ts` | fila aceita quem depende de apoio; porta arrasta a outra folha |
| `~` | `src/data/blocks.ts` | `MultiSpec`; tocha com encaixe e textura por face; cama sólida; `oak_door_top` (126) e `bed_head` (127) |
| `~` | `src/data/textures.ts` | tocha em faixas + topo + base, tocha de redstone idem, porta partida em duas folhas, topo do pé da cama |
| `~` | `src/data/itemart.ts` | silhuetas de tocha, porta e cama (eram cubos isométricos) |
| `~` | `src/data/loot.ts` | metade de cima da porta e cabeceira da cama dropam o item inteiro |
| `~` | `src/data/structures.ts` | casa de aldeia: tocha na parede, porta de duas metades, cama deitada para dentro; mina: tocha no piso |
| `~` | `src/game/interaction.ts` | colocação de duas células, encaixe da tocha, recusa de tocha no teto |
| `~` | `src/game/session.ts` | liga `attachMultiBlocks`; porta abre as duas folhas; cama responde pelas duas pontas |
| `~` | `src/game/sleep.ts` | o "desvio consciente" da cama de um bloco deixou de existir |
| `+` | `src/game/ambient.ts` | fagulha de tocha por sorteio, custo fixo por tick |
| `+` | `src/render/itemmodel.ts` | extrusão do sprite de item, com fusão de corridas nas bordas |
| `~` | `src/render/hand.ts` | item na mão extrudado; só bloco **cúbico** vira cubo na mão |
| `~` | `src/render/particles.ts` | `emitFlame` |
| `~` | `src/render/selection.ts` | contorno e rachadura seguem a envolvente da forma |
| `~` | `src/render/shaders/overlay.glsl.ts` | `uScale` na rachadura |
| `~` | `src/render/renderer.ts` | `HighlightState.bounds` |
| `~` | `src/main.ts` | preenche a envolvente do bloco mirado; emite fagulha por tick |
| `+` | `tests/multiblock.test.ts` | 15 testes: par, colocação, órfã por qualquer causa, cama vizinha que não é par |
| `+` | `tests/itemmodel.test.ts` | 11 testes: espessura, fusão de corridas, UV da borda, capacidade |
| `+` | `tests/ambient.test.ts` | 6 testes: ponta da tocha de chão e de parede, apagada não pisca, custo fixo |
| `+` | `tests/placement.test.ts` | 11 testes: tocha nas 4 paredes e no chão, teto recusado, porta e cama de duas células, e o caminho inteiro com a sessão montada |
| `~` | `tests/vertex.test.ts` | descompactação nova + regressão das caixas finas |
| `~` | `tests/mesh.test.ts`, `tests/greedy.test.ts` | leitores de vértice atualizados |
| `~` | `tests/complexmesh.test.ts` | tocha é poste, inclina na parede, e não desenha a tampa coberta |
| `~` | `tests/shapes.test.ts` | caixas de tocha e cama, e envolvente por forma |
| `~` | `tests/perf.test.ts` | piso de 256 tochas numa section |
| `~` | `docs/14-roadmap.md` | M8 (este marco), M9 e M10 propostos |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | panorama, métricas, §4 |

**Portões:** 1473 testes (82 arquivos), lint limpo, build limpo, **196,7 KB gzip** de 350.
Meshing 0,67 ms/section; piso de 256 tochas 1,13 ms; 162 camadas de atlas de 256.

**O que foi visto na tela, e o que não foi.** O jogo foi aberto no Chrome e jogado o suficiente
para confirmar o que tinha risco de quebrar tudo: **o mundo desenha certo com o formato de vértice
novo** (terreno, água, árvore, sem buraco nem geometria torta), a **tocha aparece como tocha no
slot** da hotbar em vez de um cubo isométrico, e o **item na mão tem espessura** — dá para ver a
face lateral sombreada da tocha e do bloco. O que **não** deu para ver foi a tocha, a porta e a
cama **colocadas no mundo**: sem `pointer lock` no ambiente de automação, o único caminho de
colocação disponível era o toque sintético, e ele não dispara o gesto de forma confiável. Essa
parte ficou coberta por `tests/placement.test.ts`, que roda o caminho de verdade — inclusive com a
sessão montada, para provar que a tocha não some no tick seguinte.

---

## 2026-09-14 · 21:30 → 22:50 · Os dois critérios que faltavam viraram teste

**Pedido:** *"para o teste de 2h você não consegue simplesmente abrir o Chrome aqui da minha
máquina, acessar o github pages publicado, criar um mundo no criativo e deixar voando por esse
tempo todo? ... Inclusive para o teste do 3G, se não estou enganado o DevTools do navegador permite
escolher diferentes conexões"*.

**Resultado:** sim para os dois, mas não do jeito proposto — e o "não" é o achado.

### Numa aba comum, o teste não roda

A primeira tentativa foi exatamente a sugerida: abrir o jogo publicado numa aba do Chrome do
usuário. Ela travou num ponto revelador — `document.hidden` era `true`, `requestAnimationFrame`
nunca disparava, e o jogo estava **parado**. É o `visibilitychange` do próprio jogo, que para o
loop quando a aba some, e está certo. Consequência: o teste de duas horas numa aba comum exigiria a
janela em primeiro plano e desobstruída por duas horas — a máquina do usuário inteira, parada.

Daí **headless**, que não tem aba escondida. E com `--use-gl=angle --use-angle=gl-egl`, que é o que
faz o Chrome headless usar a GPU de verdade (Intel UHD 620) em vez de cair no SwiftShader — a
diferença entre medir 60 FPS e medir 4.

### O harness: Chrome de verdade, zero dependência

O Node 22 já traz `fetch` e `WebSocket` globais, e o CDP é JSON sobre um socket: `scripts/cdp.mjs`
tem 40 linhas e dispensa o Puppeteer, que traria 300 MB e um Chrome próprio. O Chrome usado é o que
já está instalado.

### 3G medido, e a metade que não é rede

`Network.emulateNetworkConditions` com os perfis do DevTools, cache desligado, perfil novo a cada
medida. O cronômetro para quando **a tela de título aparece**, não no `load`.

| Rede | Até o título | `load` |
|---|---|---|
| sem limite | 2,89 s | 1,11 s |
| **3G rápido** | **4,48 s** ✅ (critério: < 5 s) | 2,49 s |
| 3G lento | 9,66 s | 7,76 s |

173,0 KB na rede, 169,1 KB deles do bundle — em **gzip**, porque o GitHub Pages não serviu brotli,
deixando 26 KB de margem na mesa. E o número que interessa além do veredito: **no 3G rápido,
metade do tempo é CPU de boot**, não rede. Num T0 essa metade cresce, e é ela que decide o critério.

### Três lições do agente de sessão longa

O agente entra no menu, cria mundo criativo, liga o voo e segura o "para frente" — voar em linha
reta é o pior caso do pipeline. Três falhas silenciosas foram achadas e corrigidas antes de valer:

1. **`blur` solta as teclas.** `Keyboard` esvazia as teclas quando a janela perde o foco, e uma
   janela headless perde o foco sem avisar. O primeiro teste passou minutos com o jogador imóvel
   num mundo que carregava normalmente, FPS saudável, tudo verde. O "para frente" virou
   **reafirmação** a cada 500 ms, e duas amostras no mesmo lugar viram erro registrado.
2. **O duplo toque do voo estava na fronteira dos 300 ms.** O terceiro aperto, o que segura para
   subir, caía em cima da janela que alterna o voo: às vezes ligava, às vezes desligava. No coroa, o
   boneco encalhava numa parede a seis blocos do nascimento. A subida passou a ser **verificada**.
3. **Três segundos de subida não bastam.** Deixavam o boneco na altura das árvores. Agora são oito,
   com retentativa.

Um teste que mente é pior que nenhum: as três davam um verde perfeito medindo nada.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `scripts/cdp.mjs` | driver CDP mínimo sobre o `WebSocket` global do Node 22 |
| `+` | `scripts/soak.mjs` | sessão longa: sobe o Chrome headless com GPU real, injeta o agente, grava as amostras |
| `+` | `scripts/soak-agent.js` | o agente que joga sozinho, com subida verificada e watchdog de travamento |
| `+` | `scripts/slow-network.mjs` | abertura em 3G pelos perfis do DevTools, cronometrada até a tela de título |
| `~` | `package.json` | `npm run soak` e `npm run slow-network` |
| `~` | `docs/15-status.md` | §2 quatro métricas de rede; §3 seção nova; §6 itens 9 e 10 |
| `~` | `docs/16-auditoria.md` | esta sessão |

### Resultado da sessão longa

Encerrada a pedido do usuário aos **92,5 min** dos 120 (*"pode finalizar o teste que já passou um
bom tempo e já vou desligar a máquina"*). **Zero erros, zero travamentos**, 185 amostras.

| | |
|---|---|
| Heap | 37,8 MB no início, 44,2 no fim; médias por faixa de 15 min entre 42,8 e 47,2 |
| FPS | mediana 60, mínimo 50, nenhuma amostra abaixo de 30 |
| Tick / render | 0,0 ms mediano (pico 6,1) / 1,0 ms mediano (pico 13,6) |
| Mundo | 67 621 blocos percorridos, anel estável em 489 colunas do começo ao fim |
| Entidades | itens no chão oscilando entre 125 e 311 de média, subindo **e descendo** |

As três coisas que o teste era para pegar não apareceram: não há vazamento de heap (o dente de
serra do coletor sobe e volta), o descarregamento de chunk acompanha o carregamento ao longo de
67 mil blocos em linha reta, e as entidades não acumulam. O que ele não prova é que o jogo é
**jogável** por duas horas — o robô voa reto e não abre inventário, não constrói e não morre.

**Portões:** 1416 testes em 78 arquivos verdes · lint limpo · build limpo · 192,7 KB gzip de 350.

---

## 2026-09-14 · 21:08 → 21:20 · O L1/R1 é do navegador, não do jogo

**Pedido:** *"Fiz o teste aqui e realmente pressionando os botões não mudou literalmente nenhuma
informação, porém descobri algo interessante. Abri um joystick tester no Chrome aqui no meu
celular... e ao pressionar L1/R1 ele tem a ação de mudar página no Google Chrome, mudar abas. Eu
acho que alguma função do próprio navegador está sobrescrevendo o jogo, mesmo instalado via PWA."*
E, sobre o resto da entrega anterior: *"tudo funcionou perfeitamente"*.

**Resultado:** o diagnóstico do usuário está certo, e fecha uma investigação de três sessões.

### A resposta veio de fora do jogo

Num Android, o sistema entrega os botões do controle como **tecla**, e o navegador fica com algumas
antes de a página ver: no Chrome, `L1` e `R1` trocam de aba. O painel concorda com isso por
omissão — reporta `mapping: 'standard'`, 17 botões, 4 eixos, e os índices 4 e 5 nunca ficando
`pressed`. Instalar como PWA não muda. **Não há correção do lado do jogo**: o mapeamento está
certo e a Gamepad API nunca recebe o evento.

O que dava para fazer foi feito: o direcional ←/→ (entregue na sessão anterior como "caminho que
com certeza existe") virou a resposta definitiva; a tela de Opções passa a dizer isso quando há
controle ligado, no lugar onde o jogador vai procurar; e a dica de entrada no mundo cita o
direcional junto de `L1`/`R1`.

### A linha que faltava no painel

O painel passou a mostrar **a última tecla que a página recebeu**, com `key`, `code` e `keyCode`.
É o que separa "o navegador entregou e o jogo ignorou" de "o navegador ficou com ela" — dois casos
indistinguíveis de dentro do jogo, e a diferença entre ter e não ter conserto. Aqui a linha fica
vazia, o que confirma o diagnóstico em vez de deduzi-lo.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/screens/padtester.ts` | linha "última tecla na página" (`key`/`code`/`keyCode`), com o ouvinte ligado e desligado junto do relógio |
| `~` | `src/ui/screens/options.ts` | a linha de estado explica o botão que não aparece e aponta o direcional |
| `~` | `src/main.ts` | a dica de entrada no mundo cita o direcional ao lado de `L1`/`R1` |
| `~` | `tests/padtester.test.ts` | 3 testes: a tecla anotada como chega, a linha vazia como informação, o ouvinte solto no `stop` |
| `~` | `docs/09-controles-mobile.md` | §3 o aviso sobre botão reservado pelo navegador; o que o painel mostra |
| `~` | `docs/15-status.md` | §1 3ª passada concluída; §2 métricas; §3 seção nova; §5 **P1 fechada**; §6 item 1 removido e a câmera marcada como validada |
| `~` | `docs/16-auditoria.md` | esta sessão |
| `~` | `README.md` | contagem de testes |

**Portões:** 1416 testes em 78 arquivos verdes · lint limpo · build limpo · 192,7 KB gzip de 350.

---

## 2026-09-14 · 20:30 → 21:05 · A câmera saiu do tick

**Pedido:** três relatos. (1) no painel de controle, *"ele simplesmente não reconhece quando
pressiono L1 ou R1. Reconhece todas as outras teclas do controle, menos essas duas"*, num controle
que funciona no PS5; (2) no Modo A, *"se eu coloco o dedo na tela apenas para mover a câmera... ele
constantemente aparece a bolinha achando que eu vou começar a quebrar algo"*; (3) *"a câmera não se
move de forma lisinha, e sim frame a frame... como se fosse movimentação por teclado"*.

**Resultado:** o terceiro era a correção mais visível da semana, e valia para todo mundo.

### A câmera andava a 20 Hz

O jogo simula a 20 Hz e interpola no render — a posição do jogador seguia essa regra. A rotação
**não**: `camera.yaw` recebe `player.yaw` direto, sem interpolação, e `player.yaw` só mudava dentro
do tick. Num display de 60 Hz o mesmo ângulo aparecia em três quadros seguidos e então pulava; num
de 120, em seis. Daí o jogo rodar liso e a câmera não.

Interpolar a rotação como se interpola a posição não era a resposta. Posição é **simulação**: tem
estado anterior de verdade, e interpolar reconstrói o que aconteceu entre dois estados conhecidos.
Rotação é **input**: interpolar adiciona um tick de atraso e continua entregando velocidade em
degraus de 50 ms. A leitura da câmera saiu do tick e virou `Controls.updateLook(dtMs, …)`, chamada
uma vez por quadro desenhado.

A divisão importa e está testada: mouse e dedo entregam **pixels acumulados** e não escalam com o
tempo — o mesmo arrasto gira o mesmo em qualquer FPS; o analógico entrega **velocidade** e é
multiplicado pela duração do quadro, com o passo limitado a 100 ms para um engasgo de 250 ms não
virar um giro. Pausado, o movimento é consumido e jogado fora, senão a câmera saltaria tudo de uma
vez ao voltar.

### Um gesto é uma coisa só

No Modo A, o dedo que passa da folga de toque vira câmera e **não volta a ser quebra** até ser
levantado. Isso desfaz a reancoragem entregue de manhã, em que parar no meio de um arrasto rearmava
a contagem: ela tinha sido a resposta para o toque longo que quase nunca disparava, e o efeito na
mão foi o oposto — o anel de progresso aparecendo enquanto o jogador só olhava em volta. Sumiram
com ela o `HOLD_SLOP` e os campos de âncora; a contagem voltou a ser desde que o dedo encostou.

### O painel de controle ficou mais fundo

`L1`/`R1` continuam sem aparecer, e o painel lê o controle cru — então a causa não está no jogo. O
painel passou a mostrar os **três** jeitos de um botão chegar (`pressed`, meio curso, e só
`touched`, que alguns drivers usam e que ele engolia), o **último eixo que saiu do lugar** (se o
botão estiver chegando como eixo ou chapéu, é onde isso aparece) e o `id` cru do aparelho. As
hipóteses que sobram estão no doc 15 §5 P1.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/input/controls.ts` | `updateLook(dtMs, …)` novo, por quadro; `update()` deixou de mexer na câmera; passo de integração limitado |
| `~` | `src/main.ts` | a câmera é lida no `render`, antes de posicionar; pausado, o movimento é consumido e descartado |
| `~` | `src/input/touch.ts` | `panned`: dedo que girou a câmera sai da disputa pela quebra; `HOLD_SLOP` e a âncora saíram |
| `~` | `src/ui/screens/padtester.ts` | três sinais por botão, último eixo que mexeu, `id` cru |
| `~` | `tests/input.test.ts` | 5 testes da câmera por quadro: o tick não consome, pixel não escala, velocidade escala, engasgo limitado, quadro parado não recalcula |
| `~` | `tests/touch.test.ts` | contrato novo do arrasto (3 testes no lugar de 1) |
| `~` | `tests/padtester.test.ts` | 5 testes dos sinais que não são um aperto comum |
| `~` | `docs/01-arquitetura-tecnica.md` | §3.3: a câmera é a exceção do timestep fixo, e por quê |
| `~` | `docs/09-controles-mobile.md` | §2.2 um gesto é uma coisa só; §3 o que o painel mostra |
| `~` | `docs/15-status.md` | §1 duas linhas; §2 métricas; §3 seção nova; §4 duas correções; §5 P1 reescrita com as hipóteses; §6 itens 1 e 3 |
| `~` | `docs/16-auditoria.md` | esta sessão |
| `~` | `README.md` | contagem de testes |

**Portões:** 1413 testes em 78 arquivos verdes · lint limpo · build limpo · 192,5 KB gzip de 350.

---

## 2026-09-14 · 18:22 → 18:45 · O foco que ninguém via, e o modo que dá para trocar

**Pedido:** seis relatos de uma sessão. *"No menu inicial, a movimentação utilizando o analógico
entre as opções de menu está bem ruim, parece que muitas vezes indo para botões nem existentes em
tela. Para criar um mundo novo utilizando somente o controle... foi uma missão impossível"*; no
inventário criativo, *"ele já vem com a pesquisa pré-selecionada, e literalmente em qualquer item
que pego ele simplesmente seleciona a pesquisa novamente sozinho... todo movimento abre o pop-up do
teclado do celular"*; *"não está movimentando com o analógico entre os itens"*; trocar de modo no
mesmo mundo; corações e fome aparecendo no criativo; e *"os ícones de fome são simplesmente um
risco feio"*.

**Resultado:** os três primeiros relatos tinham a mesma raiz, e ela era minha.

### O foco andava certo e ninguém via

`:focus-visible` é decidido pelo navegador a partir da **modalidade do último input**, e gamepad não
é uma modalidade que ele conheça. Um `focus()` disparado de um laço de `requestAnimationFrame`,
depois de o jogador ter tocado a tela, não acende anel nenhum — e toda a interface do jogo estiliza
foco com `:focus-visible`. A navegação movia o foco corretamente e **não mostrava nada**, o que de
dentro do jogo é igual a não funcionar.

O documento passou a ganhar a classe `pad-nav` enquanto a navegação está em uso, com anel próprio
desenhado à mão (e `!important`, porque as telas estilizam foco com seletores de id). O primeiro
toque ou tecla devolve a decisão ao navegador — a heurística dele, para uma modalidade a mais.

### A navegação roubava o foco de quem joga no dedo

Ela rodava a cada tick com qualquer tela aberta e, sem nada focado, focava o primeiro item —
inclusive para quem nunca ligou um controle. No inventário criativo o primeiro focável é o **campo
de busca**: no celular, pegar um item devolvia o foco à busca e subia o teclado virtual por cima da
tela inteira.

Agora ela não encosta no foco enquanto o controle não for empurrado; o aperto que **revela** onde o
foco está não anda com ele nem ativa nada (quem abriu a tela no dedo e pegou o controle depois
precisa ver onde está antes de agir, e confirmar às cegas podia cair em "Apagar mundo"); e o foco de
partida foge de campo de texto.

Junto saíram mais dois: **botão escondido por CSS entrava na travessia** (o filtro olhava só o
atributo `hidden`, e um painel fechado por classe deixa os botões no documento) e **a contagem de
repetição do direcional guardava número velho**, porque as leituras estavam dentro de um `else if`.

### Modo de jogo no mesmo mundo

O save já guardava `meta.gameMode` desde o M4 e `saveAll` já o escrevia a partir de `player.mode`.
Faltava **como trocar**. O botão mora na pausa — é decisão de partida, não preferência — e diz para
onde vai, não onde está. Trocar desliga o voo, fecha a tela aberta (a paleta do Criativo e a mochila
do Sobrevivência são telas diferentes para o mesmo botão) e salva na hora.

### A fome virou comida

O doc 08 §3.4 pede *"10 coxas"* desde sempre; o código desenhava `▮`/`▯`. Agora é uma coxa de 9×9
definida como **grade de caracteres no código** e convertida em SVG de retângulos para servir de
máscara CSS — cor vinda de `var(--hud-hunger)`, então a paleta para daltônicos segue valendo, e
nenhum asset de terceiros entrou. E vida, ar, fome e armadura somem no Criativo: nada disso muda
ali, e quatro fileiras congeladas ocupam a faixa mais disputada da tela.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/input/uinav.ts` | inerte sem pedido do controle; primeiro aperto revela sem andar; foco de partida foge de campo de texto; classe `pad-nav` com anel próprio; só entra na travessia quem tem caixa de layout; as sete leituras saem antes da ação |
| `~` | `src/ui/hud.ts` | `setCreative` some com vida/ar/fome/armadura; fome virou dez `<i>` com máscara de coxa gerada por `maskFrom(DRUMSTICK)` |
| `~` | `src/ui/screens/pause.ts` | botão de trocar de modo, rotulado pelo destino, com `aria-label` que diz os dois estados |
| `~` | `src/main.ts` | `setGameMode`/`applyGameMode`: troca, desliga o voo, fecha a tela aberta, avisa no HUD e salva |
| `+` | `tests/hudicons.test.ts` | 9 testes: grade quadrada, forma com carne em cima e osso embaixo, SVG válido, retângulos unidos, sem cor no desenho |
| `+` | `tests/gamemode.test.ts` | 4 testes: rótulo pelo destino, `aria-label`, releitura ao reabrir, botão ausente sem callback |
| `~` | `tests/uinav.test.ts` | contrato novo do foco de partida (5 testes reescritos); fora da tela (2); anel de foco (3) |
| `~` | `tests/uxpolish.test.ts` | o modo passou a ter um lugar só na interface, e é ele que o teste cobra |
| `~` | `docs/08-interface-ui.md` | §3.4 HUD sem vitais no Criativo; §3.10 troca de modo; §4 regra 3 |
| `~` | `docs/09-controles-mobile.md` | §3.2 navegação quieta, foco visível, fora-da-tela |
| `~` | `docs/15-status.md` | §1 três linhas novas; §2 métricas; §3 seção nova; §4 cinco correções; §6 itens 2 e 3 |
| `~` | `docs/16-auditoria.md` | esta sessão |
| `~` | `README.md` | contagem de testes e bundle |

**Portões:** 1401 testes em 78 arquivos verdes · lint limpo · build limpo · 192,3 KB gzip de 350.

---

## 2026-09-14 · 18:05 → 18:20 · O painel que lê o controle cru

**Pedido:** *"Tudo está funcionando conforme esperado, porém o R1 e L1 continuam não funcionando,
não trocam de item atual na mão de jeito nenhum."*

**Resultado:** o bug continua sem causa, e a sessão entregou o instrumento para achá-la mais um
caminho que funciona.

### O código diz que funciona, e funciona — no teste

Primeiro passo foi exercitar o caminho inteiro de ponta a ponta: `Controls` de verdade, callbacks
de verdade, um `Gamepad` falso apertando o índice 4. `onHotbarScroll(-1)` chega. `L1`/`R1` estão
nos índices 4 e 5 do layout padrão, `PAD_BINDINGS` os liga a `hotbarPrev`/`hotbarNext`,
`Inventory.scroll` move a seleção, e o HUD espelha `inventory.selected` todo quadro. Todo o resto
do controle funciona no mesmo aparelho, incluindo botões vizinhos.

Quando o código não explica o sintoma, mexer no código é chutar. A resposta honesta foi **medir o
aparelho**.

### Painel de teste de controle

`ui/screens/padtester.ts`, em Opções → Controle. Lê `navigator.getGamepads()` **cru**: sem perfil,
sem remapeamento, sem zona morta — um diagnóstico que passasse pela camada sob suspeita não
diagnosticaria nada. Mostra o índice e o nome de cada botão apertado, o **último aperto** (que fica
na tela depois de soltar, porque apertar e ler ao mesmo tempo é difícil e quem usa controle sem fio
costuma estar longe do monitor), a contagem de botões e eixos, os eixos, e se o navegador
normalizou o layout. Só roda com a tela aberta.

### O direcional ←/→ troca o item da mão

Não é a correção do bug — é um caminho que com certeza existe enquanto o bug não tem causa. Fora
dos menus o direcional não tinha função nenhuma; dentro deles ele volta a ser navegação, porque
`uiCapture` já zera a hotbar.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/ui/screens/padtester.ts` | painel de teste ao vivo: índice, nome, último aperto, eixos, contagem, aviso de layout não normalizado |
| `~` | `src/ui/screens/options.ts` | painel montado na seção Controle; começa em `show`, para em `hide`; linha de estado convida a apertar os botões |
| `~` | `src/data/gamepads.ts` | `hotbarPrev`/`hotbarNext` ganharam `dpadLeft`/`dpadRight`; nota 4 no comentário de `PAD_BINDINGS` explicando por quê |
| `+` | `tests/padtester.test.ts` | 7 testes: índice mostrado, último aperto que sobrevive ao soltar, aviso de layout, contagem, botão fora da tabela, relógio que para |
| `~` | `tests/gamepad.test.ts` | direcional troca item fora dos menus; e volta a ser só navegação com tela aberta |
| `~` | `docs/09-controles-mobile.md` | §3 direcional na hotbar e o painel de teste |
| `~` | `docs/15-status.md` | §1 linha da 3ª passada (⚠️); §2 métricas; §3 seção nova; §5 pendência P1 reaberta; §6 item 1 novo |
| `~` | `docs/16-auditoria.md` | esta sessão |
| `~` | `README.md` | contagem de testes e bundle |

**Portões:** 1380 testes em 76 arquivos verdes · lint limpo · build limpo · 191,1 KB gzip de 350.

---

## 2026-09-14 · 17:30 → 17:58 · O controle vira mouse nos menus

**Pedido:** cinco ajustes depois de jogar com o DualSense ligado por Bluetooth — que *"ele
reconheceu perfeitamente"*, o que fecha a maior incógnita da entrega da manhã. (1) *"O botão para
pausar... pressionando uma vez ele considera que apertei duas ou até três vezes... e isso tenho
certeza que não é problema do controle"*; (2) `L1`/`R1` para trocar o item da mão; (3) *"colocar o
quadrado para abertura do meu inventário... hoje não entendi o que o quadrado está fazendo"*;
(4) *"tornar a movimentação da seleção dos itens mais inteligente... ele não corta caminho, ele
passa por todas as casinhas até finalmente mover para o lado direito"*; (5) *"controlar o cursor
dentro do jogo, com o analógico direito, quando esses menus estão abertos"*.

**Resultado:** dois eram bug, dois eram desenho e um já existia.

### O `Start` que valia por três

A desconfiança do usuário estava certa: não era o controle. `togglePause` chama `Controls.reset()`
— o mesmo caminho do `blur` —, e `Gamepads.reset()` **limpava** o estado anterior das bordas de
subida. No tick seguinte o `Start` continuava apertado e não havia mais nada guardado dizendo isso,
então o jogo lia uma borda nova e pausava de novo. A 20 Hz, enquanto o dedo estivesse no botão.

`reset` passou a **silenciar até soltar**: marca toda intenção como já apertada, e o primeiro
polling em que o botão aparece solto devolve o aperto seguinte — conserta-se sozinho, sem estado
extra. A única exceção é o instante em que o controle é reconhecido: a Gamepad API só revela o
aparelho **depois** do primeiro aperto, então o botão apertado ali é justamente o que o acordou, e
engoli-lo pediria dois apertos para entrar.

### Botão e intenção viraram duas tabelas

`data/gamepads.ts` tinha uma tabela só, e os nomes dela eram os da ação (`place: 2`). Parecia
econômico e escondia uma armadilha: mudar o que o `□` faz obrigava a mexer num **índice**, que é do
aparelho e não do jogo. Agora `STANDARD_BUTTONS` diz onde o botão fica e `PAD_BINDINGS` diz o que
ele dispara — a regra "dado é dado, não código" aplicada a um lugar onde ela não estava.

Com isso o pedido do `□` virou uma linha. O que ele fazia antes era **duplicar o `L2`**: colocar
bloco, e nada mais. A mochila só abria no `Create`, um botão pequeno e mal colocado para a ação
mais repetida do jogo. Agora `L2` coloca, `R2` quebra, e as faces ficam para pular, agachar, largar
e abrir a mochila.

`L1`/`R1` **já trocavam o item da mão** desde a entrega da manhã — o pedido era para algo que
existia. Ganhou teste próprio, que é o que faltava para ser verificável.

### A navegação passou a andar pela tela

O direcional percorria a **ordem do documento**, e a ordem do documento não é a ordem que o olho vê:
no inventário, ir da grade de criação até a mochila custava atravessar armadura, boneco e resultado.
Agora o foco vai para o vizinho mais próximo na direção pedida, medido em pixels, com peso 2 para
quem sai do eixo — a coluna de slots desce em linha reta e a mochila fica a um passo. Onde não há
geometria (tela não desenhada, teste em Node) vale a ordem do documento: nada regride onde a medida
não existe.

### O cursor, e por que ele não clica

`input/uicursor.ts` é novo. O analógico direito é câmera no mundo e não tinha função nenhuma com uma
tela aberta — que é exatamente onde falta o mouse. Ele **não clica**: encosta num elemento e o foca,
e quem ativa continua sendo o botão de confirmar; dois caminhos de ativação seriam duas regras para
a mesma coisa. Nasce no meio da tela, anda 950 px/s, não sai da viewport, some depois de quatro
segundos parado e só entra no documento quando alguém empurra o analógico pela primeira vez.

Dar alcance sem dar função não resolveria: sem clique direito não há como pegar meia pilha nem
soltar um item de cada vez. `LT`/`L2` virou o botão direito nos menus e `A`/`RT` o esquerdo — a
mesma mão que coloca e quebra no mundo.

No caminho apareceu um bug que ninguém tinha relatado: **confirmar num slot não fazia nada**. Os
slots são `div[role="button"]` que agem no `keydown` de Enter e no `pointerdown`, e a navegação
chamava `click()` neles — um evento que ninguém escuta. Passou despercebido porque a navegação por
gamepad e o tratamento de toque dos slots foram entregues no mesmo dia, e os testes de navegação só
usavam `<button>` de verdade.

### Grid de arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/gamepads.ts` | `PadAction` virou `PadButton` **posicional**; nova tabela `PAD_BINDINGS` (intenção → botões); rótulos passaram a cobrir o layout inteiro; `□` ligado à mochila, `L2` a colocar |
| `~` | `src/input/gamepad.ts` | polling por intenção; `reset` silencia até soltar em vez de esquecer; `NavState` ganhou `secondary` e o cursor do analógico direito; `state.using` saiu (era duplicata de `placing`) |
| `~` | `src/input/uinav.ts` | navegação espacial com queda para ordem de documento; ativação que fala a língua do elemento (`keydown` no slot, `click` no botão); clique secundário; integração do cursor |
| `+` | `src/input/uicursor.ts` | cursor virtual dos menus: posição, limite da viewport, sumiço por inatividade, elemento sob o ponteiro |
| `~` | `src/input/controls.ts` | um caminho só para colocar bloco, agora que o `□` saiu de cima do `L2` |
| `~` | `src/main.ts` | dica do controle com os rótulos novos (`L2` colocar, `L1`/`R1` trocar item, `□` mochila); passo do laço de navegação vindo de `NAV_STEP_MS` |
| `+` | `tests/uicursor.test.ts` | 10 testes: velocidade por segundo, limite da tela, criação preguiçosa, sumiço, ambiente sem DOM |
| `~` | `tests/gamepad.test.ts` | tabelas novas; regressão do `Start` repetido; `□` abre e não coloca; `L1`/`R1`; cursor e clique secundário; completude de rótulos derivada de `STANDARD_BUTTONS` |
| `~` | `tests/uinav.test.ts` | DOM falso com geometria e `role`; navegação espacial (5); slots (3); cursor (4) |
| `~` | `docs/08-interface-ui.md` | §4 regra 3: navegação espacial, cursor e clique direito |
| `~` | `docs/09-controles-mobile.md` | §3 mapeamento novo e as duas tabelas; §3.2 reescrita com navegação espacial, cursor e os dois botões do mouse |
| `~` | `docs/15-status.md` | §1 linha da 2ª passada; §2 métricas; §3 seção nova; §4 duas correções; §6 item 5 reescrito |
| `~` | `docs/16-auditoria.md` | esta sessão |
| `~` | `README.md` | contagem de testes e bundle |

**Portões:** 1371 testes em 75 arquivos verdes · lint limpo · build limpo · 190,4 KB gzip de 350.

---

## 2026-09-14 · 15:15 → 15:24 · Um clique, um bloco — e as plantas que ninguém conseguia quebrar

**Pedido:** dois relatos, o segundo lembrado no meio do primeiro. *"No modo criativo... a
sensibilidade para fazer essa quebra acredito que esteja absurda... mesmo dando um clique
extremamente rápido é quase impossível quebrar só um bloco. Tem momentos em que um simples clique
rápido acaba quebrando três blocos em sequência"*, com o pedido explícito de **verificar se o mesmo
acontece no sobrevivência** com bloco frágil ou ferramenta forte. E, logo depois: *"as plantas que
encontro na grama, nenhuma delas consigo quebrar"*.

**Resultado:** os dois eram bugs, e o segundo é mais antigo e mais grave do que parece.

### A quebra acontecia uma vez por tick

No criativo `tickBreaking` derrubava um bloco **a cada tick** enquanto o botão estivesse
pressionado: 50 ms por bloco, então um clique normal de 150 ms fazia uma fila de três. Não havia
como o jogador clicar mais rápido que isso.

A pergunta sobre o sobrevivência tinha resposta, e foi medida em vez de estimada: **478 combinações
bloco+ferramenta quebram em um único tick**, das quais **18 apenas com a mão** — todas as plantas
de dureza zero — mais neve com pá. Todas tinham o mesmo comportamento.

A correção é um intervalo de 5 ticks entre quebras **dentro do mesmo apertar de botão**. Três
propriedades a mantêm honesta: soltar o botão zera o intervalo (um clique é um bloco, e quem clica
rápido de propósito continua mandando no ritmo); o intervalo gate apenas a **conclusão**, com o
progresso correndo durante ele, então nenhum bloco comum o encontra; e a quebra do criativo
continua instantânea — o que passou a ser limitado é a fila, não o golpe.

### O raio atravessava toda planta

A condição de acerto do raycast excluía tudo que é `replaceable`, e é exatamente isso que `plant()`
marca. Grama alta, samambaia, flores, mudas, cana, arbusto morto e trepadeira — mais neve fina e
fogo — **não podiam nem ser miradas**: o raio passava direto e acertava o chão atrás.

O código de colocação já esperava o contrário. Ele tem um ramo escrito e comentado — *"bloco
substituível recebe no próprio lugar"* — que **nunca era alcançado** para nada que não fosse
líquido. Era uma contradição entre dois módulos, parada ali desde o M2.

A regra não podia simplesmente cair: os outros dois usuários do raio são **linha de visão de mob** e
**linha de explosão**, e uma flor não pode esconder o jogador de um creeper nem barrar uma explosão.
Virou opção (`RayOptions.replaceable`), ligada só no raio da interação.

**Portões:** 1342 testes (74 arquivos) verdes, lint limpo, build limpo, **189,0 KB gzip** de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/breakrate.test.ts` | 10 testes: um clique é um bloco no criativo e no sobrevivência, segurar dá ritmo controlável, soltar zera a espera, **a mineração normal não fica mais lenta**, toda planta de dureza zero é mirável, e o inventário de quebras instantâneas fica registrado. |
| `~` | `src/game/interaction.ts` | `BREAK_INTERVAL` de 5 ticks entre quebras do mesmo apertar, zerado ao soltar; ele gate a conclusão e não o progresso. O raio da interação passa `{ replaceable: true }`. |
| `~` | `src/world/raycast.ts` | `RayOptions` no lugar do booleano de líquidos: o que conta como acerto depende de para que serve o raio. Linha de visão e explosão seguem ignorando planta. |
| `~` | `tests/gameplay.test.ts` | O teste do poço segurava o botão por 4 ticks para cavar 4 blocos; passou a modelar **quatro cliques**, que é o que um jogador faz. |
| `~` | `docs/15-status.md`, `README.md` | Métricas, duas correções fora de marco e o roteiro de reteste da quebra. |

---

## 2026-09-14 · 14:55 → 15:12 · O Modo A de toque tinha três bugs, e o padrão virou o B

**Pedido:** *"para mim a opção A de controles... está bem estranha. Vira e mexe ela falha, parece
que não detecta que estou clicando para colocar um bloco, ou que estou segurando para quebrar"* —
com a dúvida de *"se ao clicar ou segurar... ele irá fazer a ação onde estou clicando na posição do
meu dedo, ou se ele sempre respeita o ponteiro branco de mira no meio da tela"*, e a proposta de
tornar o Modo B o padrão.

**Resultado:** a confusão tinha causa. **Os dois gestos do Modo A miravam em lugares diferentes** —
e mais dois bugs faziam o modo falhar sozinho. Os três corrigidos, e o padrão virou o B por decisão
do usuário.

### A pergunta tinha uma resposta ruim: os dois, dependendo do gesto

`onUp` definia a mira do toque curto, mas o `update()` de `TouchControls` roda no **começo** de
`Controls.update`, antes de alguém ler `state.hasAim` — e apagava a mira que o toque acabara de
definir. O pedido de colocar sobrevivia sozinho, então **o bloco ia para o crosshair**. Quebrar, que
acontece durante o tick com o dedo ainda na tela, usava o dedo. Dois alvos no mesmo modo.

O teste que deveria pegar isso passava: ele lia a mira **sem** chamar `update()`, ou seja, não
modelava a ordem do tick. Foi reescrito na ordem real, e é ele que agora protege a correção.

### O modo falhava sozinho

A folga de arraste era de 10 px, medida desde o ponto inicial e **pegajosa**: um dedo que passasse
dela ficava marcado como "arrastado" para sempre e não conseguia mais nem colocar nem quebrar até
ser levantado. Com o outro polegar no joystick e o aparelho balançando na mão, 10 px acontecem em
quase todo gesto — era o *"vira e mexe ela falha"*.

Agora são duas folgas, 16 px para o toque curto e 28 px para o longo, e sair da folga do longo
**reancora** a contagem em vez de matá-la — que é como todo toque longo com folga funciona. Uma vez
começada, a quebra não é mais cancelada por deriva; e o dedo que está quebrando **para de girar a
câmera**, porque é o mesmo polegar que mira e girar a cena tirava o alvo de baixo dele.

E `pointerleave` valia como "soltou o dedo": encostar na borda da tela ou passar por cima de um
botão do HUD colocava um bloco que ninguém pediu. Saiu; a rede contra dedo perdido passou a ser
ouvir `pointerup`/`pointercancel` no `window`.

### O padrão virou o B

Desvio consciente do doc 09 §2.2, registrado lá e em `game/settings.ts`. Mesmo consertado, sobra no
A uma ambiguidade que não é bug: o alvo é o dedo, e o dedo tapa justamente o que ele mira num
aparelho pequeno. O B é inequívoco. O A continua a um toque nas opções — e nele **a mira central
some**, porque ela apontava para um lugar que não é o alvo.

**Portões:** 1332 testes (73 arquivos) verdes, lint limpo, build limpo, **188,9 KB gzip** de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/input/touch.ts` | A mira do toque curto sobrevive até ser consumida; duas folgas (`TAP_SLOP`/`HOLD_SLOP`) com reancoragem em vez de cancelamento; quebra latchada contra deriva; o dedo que quebra não gira a câmera; `pointerleave` deixa de valer como soltar, com rede de segurança no `window`. |
| `~` | `src/game/settings.ts` | Padrão de `touchMode` passa a ser `B`, com o motivo do desvio no comentário do tipo. |
| `~` | `src/ui/hud.ts`, `src/main.ts` | `setCrosshairVisible`: no Modo A de toque a mira central some. |
| `~` | `tests/touch.test.ts` | O teste da mira passou a rodar na ordem real do tick — era a brecha que deixou o bug passar. Mais cinco: deriva pequena não reinicia, quebra começada não cancela, o dedo que quebra não gira a câmera, arrastar rearma, e `pointerleave` não coloca bloco. |
| `~` | `tests/settings.test.ts` | Novo padrão; e três testes que tinham virado vazios ao trocar o valor (afirmavam o padrão contra o padrão) voltaram a provar o que prometem. |
| `~` | `docs/09-controles-mobile.md` | §2.2: o padrão é o B, com os três bugs e a ambiguidade que sobra. |
| `~` | `docs/15-status.md`, `README.md` | Métricas, quatro correções fora de marco e o roteiro de reteste do toque. |

---

## 2026-09-14 · 14:35 → 14:48 · Meia pilha no dedo, e o item que voltava sozinho

**Pedido:** dois relatos de campo do celular. *"ao tentar colocar uma única madeira em cada
espacinho do menu de Criação eu não consigo, pois clicando em qualquer espaço ele acaba movendo o
stack inteiro"* — com a pergunta de como colocar itens individualmente na criação, nos baús, na
bancada e ao reorganizar o inventário. E *"estou conseguindo jogar itens fora... porém ele está
indo muito perto do meu personagem então instantaneamente meu personagem coleta ele e volta para
meu inventário"*.

**Resultado:** os dois eram bugs, não limitações.

### O botão direito não existia no dedo

O doc 08 §3.5 descreve as interações de slot em botões de mouse, e no toque
`PointerEvent.button` é **sempre 0**. Todo toque virava clique esquerdo, então não havia gesto
nenhum para "pegar metade" nem para "soltar uma unidade" — e montar uma receita que pede uma tábua
por célula era impossível.

O toque longo passou a valer como botão direito. Para isso a ação de toque resolve **ao soltar o
dedo**, e não ao encostar. A dúvida era se isso quebrava o arraste de distribuição entre slots, que
o comentário do módulo dizia depender do `pointerdown` — e **não quebra, porque esse arraste nunca
funcionou no dedo**: o ponteiro de toque recebe captura implícita no elemento do `pointerdown`,
então os outros slots nunca recebem `pointerenter`. Era, e segue sendo, um gesto de mouse.

O gesto não tem como ser descoberto sozinho — no mouse o botão direito é convenção de trinta anos,
no dedo não há convenção nenhuma —, então o painel ganhou uma linha de dica no ponteiro grosso, e
o toque longo vibra ao pegar.

### O "arremesso" não arremessava

`spawn(..., thrown)` prometia no comentário que o item *"sai para a frente com força"* e dava um
empurrão **aleatório** de ±0,05 por eixo. O item caía a menos de meio bloco de quem o largou —
dentro da caixa de coleta, que tem 1,3 de raio horizontal — e o `PICKUP_DELAY` de 10 ticks o
devolvia meio segundo depois. Na prática, não havia como se livrar de nada.

São duas correções somadas: o item sai **na direção do olhar** a 0,3 por tick, e o que o jogador
jogou fora só pode ser recolhido depois de 40 ticks. O arremesso resolve o caso normal; o atraso
cobre quem joga contra a parede e anda atrás do item. O que cai de bloco quebrado continua sendo
pego na hora — esperar dois segundos por cada item minerado seria o oposto do que se quer.

### Um terceiro, achado por teste

Ao separar mouse de dedo, `pointerType` **indefinido ou vazio** passou a cair no ramo de toque, que
espera um `pointerup` que talvez nunca venha. Evento sintetizado — por teclado, por navegador antigo
ou por teste — deixava de agir. A regra virou a mesma de `isMouseClick` em `input/controls.ts`:
ausente ou vazio conta como mouse. Quem achou foi um teste existente de shift+clique, não o campo.

**Portões:** 1328 testes (73 arquivos) verdes, lint limpo, build limpo, **188,7 KB gzip** de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/itemdrop.test.ts` | 6 testes: o item vai para a frente, não volta sozinho, volta a ser coletável depois de 2 s, o drop de bloco continua imediato, e o `pickupAt` sobrevive à compactação do array. |
| `~` | `src/ui/containers/screen.ts` | Toque longo = botão direito; ação de toque ao soltar; `TOUCH_SLOP` cancela se o dedo escorregar; `isMousePointer` trata `pointerType` ausente como mouse; linha de dica no ponteiro grosso. |
| `~` | `src/entity/itementity.ts` | `spawn` recebe a **direção** do arremesso em vez de um booleano; atraso de coleta por item, com 40 ticks para o que foi jogado fora. |
| `~` | `src/game/session.ts` | `dropItem` arremessa na direção do olhar, com vetor reusado; a morte continua deixando o inventário **em volta** do corpo, que é onde não há olhar para usar. |
| `~` | `src/main.ts` | Passa `longPressMs` e a vibração para a tela de contêiner. |
| `~` | `tests/recipebookui.test.ts` | O toque agora é `pointerdown` + `pointerup`: um teste que dispara só um dos dois descreve um gesto que não existe. Mais 6 testes do toque longo, incluindo a garantia de que o mouse não mudou. |
| `~` | `docs/08-interface-ui.md` | §3.5: o toque longo como botão direito, por que a ação resolve ao soltar, e a regra do item jogado fora. |
| `~` | `docs/15-status.md`, `README.md` | Métricas, três correções fora de marco e o roteiro de reteste no celular. |

---

## 2026-09-14 · 13:45 → 14:11 · Jogar de controle: DualSense, Xbox e menus navegáveis

**Pedido:** *"implementar no jogo a compatibilidade de jogar com controle conectado tanto no
computador quanto no celular, seja via bluetooth ou cabo"* — com um **DualSense (PS5)** em mãos, e
*"seria interessante adicionar compatibilidade também para controle de Xbox One"*, com a ressalva
de que, se a detecção de layout fosse complexa, dava para ficar só no DualSense.

**Resultado:** quatro famílias reconhecidas (DualSense, DualShock 4, Xbox, Switch Pro), o
mapeamento do doc 09 §3 completo, e **os menus navegáveis por controle** — que era o que faltava
para o controle ser jogável e não só mover o boneco.

**A detecção não era a parte difícil, e quase não é sobre mapeamento.** Quando o navegador
reconhece o aparelho ele reporta `mapping: 'standard'` e os índices de botão são iguais para todo
controle — é o layout da especificação, e vale no Chrome e no Firefox, no computador e no Android.
O que muda de verdade é o **nome impresso no botão**: dizer "aperte `A`" a quem segura um DualSense
manda o jogador procurar um botão que não existe no aparelho dele. Daí os perfis serem, antes de
tudo, tabelas de rótulo.

O segundo papel deles é rede de segurança: sem normalização os índices viram a ordem crua do HID,
que num controle de PlayStation é `□ ✕ ○ △` — sem a tabela da família, apertar `□` faria o jogador
pular. Esse caminho **não foi verificado em aparelho** e está marcado como tal no código e no
doc 15 §6.

**A armadilha da tabela foi casar por nome.** Um Xbox reporta "Xbox Wireless Controller" e um
DualShock 4 reporta "Wireless Controller": a primeira versão da regra do DS4 tinha
`wireless controller` e capturava o Xbox, dando rótulos de PlayStation a ele. A regra passou a
valer pelo par fabricante/produto, e há teste para exatamente esse caso.

**Três coisas estavam calculadas e jogadas fora.** `pause`, `inventory` e a rolagem de hotbar
existiam em `GamepadState` desde o M3, eram preenchidas todo tick e **nada em `Controls` as lia**.
Quem jogasse de controle não conseguia abrir a mochila nem pausar. Do doc 09 §3 também faltavam
`Y` (soltar item) e `LT` (usar), que nunca existiram.

**A navegação de interface era o buraco maior.** Sem ela não se entra num mundo, não se abre o
inventário e não se sai de uma tela — o controle mexia no jogo e não na interface. O alvo é o
elemento com `role="dialog"` visível mais acima, e não uma lista de telas: o doc 08 §4.4 já exige o
atributo em todo modal, então tela nova entra sozinha. Esquerda/direita **mexem no valor** do
controle focado em vez de pular de campo, porque a tela de opções é quase toda slider; voltar
dispara `Escape` na camada, que já sabe fechar uma de cada vez.

**Um risco que apareceu no meio do caminho.** A navegação precisa de laço próprio, porque a tela de
título existe muito antes de haver um tick de jogo — e dois laços chamando o mesmo `poll()`
**roubariam a borda de subida um do outro**, fazendo o aperto de colocar bloco sumir. Ficou
`poll()` (tudo, consome borda, só no tick) e `pollNav()` (só estado segurado). Há teste.

**O que o controle não consegue sozinho.** Ligar o áudio e entrar em tela cheia exigem um gesto do
usuário, e aperto de botão de controle não conta como gesto em navegador nenhum. Em vez de deixar o
jogador no mudo sem entender por quê, conectar um controle com o áudio desligado mostra a frase que
resolve.

**Portões:** 1316 testes (72 arquivos) verdes, lint limpo, build limpo, **188,2 KB gzip** de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/gamepads.ts` | Perfis por família: detecção por fabricante/produto, rótulos de botão e a ordem crua do HID como rede de segurança. Controle novo é uma entrada aqui. |
| `+` | `src/input/uinav.ts` | Navegação de interface por controle (doc 08 §4.3): foco pela camada `role="dialog"` de cima, valor no slider com esquerda/direita, `Escape` no voltar, repetição de teclado. |
| `+` | `tests/gamepad.test.ts` | 24 testes: os dois formatos de `id`, Xbox contra DualShock 4, rótulos, gatilho analógico, borda de subida, zona morta, layout cru e o `pollNav` que não rouba aperto. |
| `+` | `tests/uinav.test.ts` | 18 testes: camada de cima vence, foco inicial, item escondido e desligado fora do caminho, repetição, slider e select, `Escape` na camada. |
| `~` | `src/input/gamepad.ts` | Reescrito sobre os perfis: ações do doc 09 §3 completas, borda por **ação** e não por índice, gatilho analógico com limiar, `poll`/`pollNav` separados, `uiCapture`, ouvintes de conexão em lista. |
| `~` | `src/input/controls.ts` | Consome pausa, inventário, hotbar, largar e correr; duplo toque no pulo alterna o voo; `reset()` zera o controle; sensibilidade de analógico própria. |
| `~` | `src/game/settings.ts` | `padDeadZone`, `padSensitivity` e `padProfile`, com faixa e lista de valores válidos. |
| `~` | `src/ui/screens/options.ts` | Seção **Controle** com sensibilidade, zona morta, layout e vibração, mais a linha de estado que diz o que está conectado. |
| `~` | `src/ui/menuflow.ts` | Passa o controle para a tela de opções. |
| `~` | `src/main.ts` | Controle e navegação nascem antes do mundo; laço de navegação a 20 Hz; aviso de conexão com o nome da família; dica com os rótulos do controle na mão; aviso de que o áudio precisa de um toque. |
| `~` | `docs/09-controles-mobile.md` | §3.1 (perfis e o que muda de verdade entre eles) e §3.2 (navegação de interface), mais `L3`, duplo toque e direcional no mapeamento. |
| `~` | `docs/15-status.md`, `README.md` | Panorama, métricas, detalhe da entrega, a correção fora de marco e o roteiro de teste com controle físico. |

---

## 2026-09-14 · 12:31 → 13:32 · O resto do doc 08, o fogo, o morcego e o boneco

**Pedido:** *"Pode atacar o ponto 2 e 4"* — os dois blocos que o doc 15 §6 carregava: as lacunas da
tabela de Vídeo, Controles, Som e Acessibilidade do doc 08, e as "oportunidades pequenas que
sobraram". No mesmo pedido, o usuário encerrou os outros dois itens: *"para o ponto 1 não tenho mais
em mãos o J7 Metal, mas já fiz testes no meu celular e computador e tudo funcionou — pode considerar
concluído"* e *"para o ponto 3 não precisa se preocupar com mundos antigos não, já foram
recriados"*.

**Resultado:** **nenhum documento normativo tem mais pendência de funcionalidade.** Vinte opções
novas, dez teclas remapeáveis, um passe de render novo, um sistema de mundo novo, um mob novo e
sete miudezas — todas com teste.

Quatro decisões que mereceram mais do que uma linha de código:

1. **A umbrella "Gráficos" não é um valor que o render consulta — ela reescreve os outros
   controles.** Assim não existe o estado "Gráficos: Rápido, Nuvens: Bonitas", e o jogador vê nos
   sliders o que escolheu no atalho.
2. **Conflito de tecla é permitido e pintado de vermelho, não recusado.** Recusar prenderia o
   jogador: trocar duas teclas de lugar passa obrigatoriamente por um estado em que as duas estão na
   mesma. `Escape` e os dígitos da hotbar ficaram de fora do remapeamento — a saída de emergência de
   toda camada de UI não pode ser remapeada para lugar nenhum.
3. **Três sliders teriam nascido controlando o nada.** "Clima" não tinha som de clima, "Ambiente"
   não tinha som de ambiente, e "esconder flashes do céu" não tinha flash nenhum para esconder. Em
   vez de entregar controles vazios, entraram a chuva em loop (doc 10 §2, nunca implementada), o
   trovão, e o relâmpago — determinístico da seed, como o resto do clima, sem um campo novo no save.
4. **O boneco do jogador é 2D, de propósito, em todos os tiers.** O doc 08 §3.5 pede canvas WebGL e
   abre a exceção *"em T0, pode ser um sprite estático"*. Um segundo contexto num aparelho de 2 GB
   custa pool de buffers, programa e uma cópia do atlas de entidade; um `scissor` no principal faria
   o passe de mobs rodar com outra matriz no meio do frame. O desvio está escrito no cabeçalho do
   módulo, como o PROMPT.md §6 manda.

**Uma dívida de memória foi paga no caminho.** A tabela de sons renderizava tudo a 22 kHz, e metade
das amostras guardava banda que o próprio filtro já tinha jogado fora. `rateFor` deriva a taxa da
própria receita: a conta caiu de **3,95 para 3,26 MB acrescentando três sons**, e o teto do teste
desceu de 4 para 3,5 MB.

**O canto de escada não foi copiado, foi derivado.** A regra sai de uma exigência geométrica
verificável — a superfície alta de duas escadas perpendiculares tem que ser contínua pela face que
elas dividem — e é isso que os testes medem, não nomes de rotação. Ele não ocupa bit nenhum do save,
como a conexão de cerca, e a **colisão passou a derivar o canto pela mesma função**: o cabeçalho de
`mesh/shapes.ts` promete desde o M1 que desenho e colisão não divergem, e o canto teria sido a
primeira divergência.

**Portões:** 1269 testes (70 arquivos) verdes, lint limpo, build limpo, **185,3 KB gzip** de 350.

### Opções, teclas e som

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/keybinds.ts` | As dez ações remapeáveis, as teclas reservadas e o rótulo legível de um `code`. |
| `+` | `src/input/keybinds.ts` | Mapa do jogador, persistido; conflito é sinalizado, não recusado. |
| `+` | `src/data/soundbuses.ts` | Os oito barramentos, o rótulo de cada um, a chave de `Settings` e o roteamento por prefixo — quem dispara um som não sabe em qual slider ele cai. |
| `+` | `tests/keybinds.test.ts` | 10 testes: tabela de fábrica única, tecla reservada, conflito nos dois sentidos, persistência, storage sujo. |
| `+` | `tests/videooptions.test.ts` | 14 testes: umbrella, validação de opção de texto, relâmpago determinístico, balanço da câmera. |
| `~` | `src/game/settings.ts` | Vinte chaves novas (simulação, vsync, gráficos, nuvens, partículas, névoa, AO, balanço, FPS, sete volumes, daltônico, contorno, flashes, distorção); `CHOICES` substitui os `if` soltos de validação; a umbrella escreve os controles que resume. |
| `~` | `src/input/controls.ts` | Binds vêm do mapa e são refeitos quando ele muda; `onDropItem` (Q / Ctrl+Q, doc 08 §3.5) que não existia. |
| `~` | `src/input/keyboard.ts` | `unbind`, sem o qual remapear deixava a tecla velha valendo também. |
| `~` | `src/ui/screens/menu.ts` | `buildKeybinds`: botão que escuta a próxima tecla **em captura**, antes do jogo por baixo; CSS do conflito. |
| `~` | `src/ui/screens/options.ts` | Nove sliders de som montados a partir de `soundbuses`; oito linhas novas em Vídeo; cinco em Acessibilidade. |
| `~` | `src/ui/menuflow.ts` | Passa o mapa de teclas para a tela de opções e a miniatura para a de mundos. |
| `~` | `src/audio/engine.ts` | Oito barramentos; roteamento por nome; `setLoop` para a chuva; taxa por receita; amostras do resource pack. |
| `~` | `src/audio/synth.ts` | `rateFor` (taxa derivada da receita), envelope sustentado para loop, e quatro sons: chuva, trovão, fogo e a voz do morcego. |
| `~` | `tests/audio.test.ts` | Roteamento dos nove sliders, taxa por receita, teto de memória em 3,5 MB. |

### Render, mundo e conteúdo

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/render/clouds.ts` | Passe de nuvens: plano a y=192, uma draw call, forma no shader. Off/Rápido/Bonito = zero, uma ou duas oitavas. |
| `+` | `src/render/shaders/clouds.glsl.ts` | Ruído de valor e a forma da nuvem, nas duas versões de GLSL. |
| `+` | `src/world/fire.ts` | Fogo que se espalha: registro em rodízio com teto duro, chance vinda do `flammable` da tabela, chuva apaga, varredura de coluna carregada. |
| `+` | `src/ui/containers/paperdoll.ts` | Boneco do jogador em vista frontal ortográfica, com a armadura vestida por cima. |
| `+` | `tests/fire.test.ts` | 15 testes: acender, propagar, acabar, chuva, chão, teto de chamas e orçamento por tick. |
| `+` | `tests/staircorners.test.ts` | 14 testes: volume das três formas, escolha do canto, continuidade entre vizinhas, desenho = colisão. |
| `+` | `tests/paperdoll.test.ts` | 8 testes: projeção dentro do canvas, boneco não invertido nem espelhado, ordem de profundidade. |
| `~` | `src/world/mesh/shapes.ts` | Escada com canto interno e externo; `stairCornerFrom` derivado dos quatro vizinhos; `collisionBoxesFor` aceita o canto. |
| `~` | `src/world/mesh/complex.ts` | O mesher calcula o canto da escada, como já calculava a conexão de cerca. |
| `~` | `src/world/physics.ts` | A colisão da escada consulta os mesmos quatro vizinhos, pela mesma função. Só para escada. |
| `~` | `src/world/mesh/greedy.ts` | `smoothLighting`: desligado, AO 3 em todo vértice — e o merge deixa de quebrar nas bordas (5 quads viram 3 num degrau). |
| `~` | `src/render/renderer.ts` | Passe de nuvens, modo de névoa, clarão do relâmpago, contorno em alto contraste. |
| `~` | `src/render/camera.ts` | Balanço do olho ao andar, movido pela distância andada. |
| `~` | `src/render/particles.ts` | Teto vivo em vez de capacidade fixa por tier — senão "Todas" em T0 não faria nada. |
| `~` | `src/render/selection.ts` | Contorno branco opaco e grosso no alto contraste. |
| `~` | `src/render/gl.ts` | `vsync` decide `desynchronized` na criação do contexto. |
| `~` | `src/game/weather.ts` | Relâmpago determinístico da seed e do tick, com o interruptor de acessibilidade e o aviso do trovão. |
| `~` | `src/game/survival.ts` | `SurvivalContext` com `onFire`, prometido no comentário desde o M4; dano de fogo a cada meio segundo, não por tick. |
| `~` | `src/game/session.ts` | Fogo ligado ao tick, à chuva, ao chunk e ao isqueiro; dano de fogo no jogador. |
| `~` | `src/data/blocks.ts` | Bloco `fire` (cruz, luz 15, `replaceable`, `itemless`). |
| `~` | `src/data/textures.ts` | Textura `block/fire`, animada em 4 quadros. |
| `~` | `src/data/mobs.ts` | Morcego: a primeira entrada da categoria `ambient`, que tinha cap desde o M5 e ninguém atrás. |
| `~` | `src/data/mobmodels.ts` | Modelo `bat`: corpo, cabeça com orelhas e duas asas que batem. |
| `~` | `src/data/mobskins.ts` | Skin do morcego e a do jogador — esta fora do atlas, só para o boneco. |
| `~` | `src/ui/hud.ts` | Paleta do modo daltônico em variáveis CSS e contador de FPS. |
| `~` | `src/ui/containers/screen.ts` | Boneco ao lado dos slots de equipamento. |
| `~` | `src/ui/containers/recipebook.ts` | Prévia da grade da receita, com o que falta em vermelho. |
| `~` | `src/ui/debug.ts` | `N fogo` na linha `E:`. |
| `~` | `src/workers/protocol.ts`, `src/workers/chunk.worker.ts`, `src/world/pipeline.ts` | `smoothLighting` chega ao mesher pelo `init`. |

### Save e resource pack

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/save/db.ts` | `worldSize` por cursor (sem trazer os chunks todos para a memória), `saveThumbnail`/`loadThumbnail`. |
| `~` | `src/save/savemanager.ts` | `measureWorld` e `saveThumbnail`, ambos falhando em silêncio: tamanho e foto são informação, o mundo é o dado. |
| `~` | `src/save/archive.ts` | `.clw` v2: miniatura no **fim** do arquivo, para um leitor da v1 achar tudo que conhece nos mesmos offsets. |
| `~` | `src/game/savegame.ts` | Mede o mundo depois de gravar os chunks e guarda a foto do quadro. |
| `~` | `src/ui/screens/worlds.ts` | Miniatura e tamanho na lista; `formatSize` com travessão para o mundo nunca medido. |
| `~` | `src/render/pack.ts` | `sound/<nome>.ogg` no pacote, com teto próprio de 2 MB — o único item que entra como veio. |
| `~` | `src/ui/screens/packs.ts` | O relatório conta imagens **e** sons. |
| `~` | `src/main.ts` | Fiação de tudo: volumes, teclas, opções de vídeo, loop de chuva, trovão, balanço, FOV de corrida, miniatura. |
| `~` | `docs/15-status.md`, `README.md` | Panorama, métricas, detalhe da entrega, três correções fora de marco e o §6 reescrito. |

---

## 2026-09-13 · 15:05 → 15:27 · Um estilo de textura com relevo, e itens que têm volume

**Pedido:** *"o que está me incomodando profundamente é essa textura completa do jogo,
principalmente dos itens do inventário no geral, na mão"* — com o alvo de *"dar um bom salto nas
texturas… ainda pixelado obviamente, porém que fique fácil bater o olho e distinguir cada bloco,
cada item, que os itens possuam realmente profundidade"*, e a exigência de *"habilitar ou não e
não impactar em literalmente nada na performance caso alguém não queira utilizá-la"*.

**Resultado:** um segundo visual, **Nítido**, gerado por código e escolhido em Opções → Vídeo. O
caminho do resource pack **não** foi usado: um `.zip` versionado seria o asset de terceiros que o
PROMPT.md §6 proíbe, e um override do pacote vence só na própria camada — trocar a pedra deixaria
minério e musgo com a pedra velha. O estilo entra dentro da geração, e `data/textures.ts` continua
sendo a única fonte de desenho.

Blocos ganham quatro passadas sobre o ladrilho pronto (relevo direcional, realce, tom e chanfro de
borda); o chanfro desenha a grade do mundo porque a UV repete por bloco no greedy meshing. Itens
ganham um sólido iluminado a partir da **mesma máscara** de `data/itemart.ts`: transformada de
distância, abaulamento, Lambert, Blinn-Phong, luz de quina e contorno tingido — com o expoente do
especular separando metal de gema. A folha de sprites dobra para 32 px por item no Nítido.

Custo em jogo: **zero dos dois lados**. Nenhum caminho de render, tick ou mesh pergunta o estilo; o
que ele muda são os bytes gerados no boot — 2,0 ms no atlas e 26,7 ms na folha.

Três coisas só apareceram olhando o resultado renderizado fora do navegador, imagem por imagem:

1. **contraste com pivô fixo em 128 estourava os claros** — neve, lã e o topo da grama viravam
   branco chapado. Passou a girar na média da própria textura;
2. **cabeça e cabo de madeira viravam uma peça só** — a pá sumia dentro do próprio cabo. Corpo e
   acento passaram a medir o volume separados, e o vinco nasce sozinho;
3. **o contorno do cubo isométrico borrava desenho de traço fino** — a teia virava mancha. Quem
   decide agora é a espessura média do traço.

A primeira versão da folha custava 89 ms: o cubo isométrico dividia o passo de amostragem pelo
tamanho do tile e ficava 16 vezes mais fino do que precisa.

**Portões:** 1179 testes (65 arquivos) verdes, lint limpo, build limpo, **174,5 KB gzip** de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/texturestyle.ts` | Os números do estilo, declarativos: acabamento de bloco e de skin, exceções por textura, material de item. |
| `+` | `src/render/texfinish.ts` | Relevo, realce, tom e chanfro sobre o ladrilho pronto. Vazada não leva chanfro; água e lava não levam nada. |
| `+` | `src/render/itemart3d.ts` | Máscara de item virada sólido iluminado: distância por peça, abaulamento, Lambert, especular, quina, contorno. |
| `+` | `tests/texstyle.test.ts` | 20 testes: o Clássico intacto byte a byte, o pivô de contraste, o vinco entre peças, o contorno, a espessura de traço. |
| `~` | `src/render/itemsprites.ts` | Folha com tamanho e estilo; `drawItemArt`/`drawBlockIsometric` deixam de assumir 16; contorno por espessura; passo de amostragem corrigido. |
| `~` | `src/render/atlas.ts` | Acabamento depois do `resolve` e sobre cópia, para quem herda herdar o ladrilho cru. |
| `~` | `src/render/entityatlas.ts` | Acabamento de skin, sem chanfro — a skin não é ladrilhada. |
| `~` | `src/game/settings.ts` | `textureStyle`, padrão `nitido`, validado na leitura do storage. |
| `~` | `src/ui/screens/options.ts` | Campo "Texturas (recarrega)" em Vídeo. |
| `~` | `src/main.ts` | Lê o estilo uma vez e passa aos três geradores; folha em 32 px no Nítido. |
| `~` | `tests/perf.test.ts` | Orçamento de boot: acabamento < 60 ms, folha < 200 ms — folgados de propósito, contra ruído de máquina. |
| `~` | `tests/settings.test.ts` | Padrão do estilo e rejeição de valor desconhecido. |
| `~` | `docs/15-status.md` | Seção fora de marco, métricas, e o passo de campo que falta. |

---

## 2026-09-13 · 14:36 → 14:50 · O campo que nasceu no Nether, e a chuva que caiu lá

**Pedido:** *"Agora está perfeito, a tela não piscou mais em nenhum momento"* — com duas
observações: o FPS ficar preso na taxa do display mesmo com teto 240, e *"indo para o nether agora
aconteceu o inverso, um pedaço da terra foi gerado lá no nether, e inclusive nesse pedaço de terra
até começou a chover"*.

**Resultado:** o aparelho fechou em **T2, 4 workers, RD 16, 75 FPS, render 2,6 ms, sem piscar**. Das
duas observações, uma não é bug e a outra eram dois.

### O FPS preso na taxa do display não é bug

`requestAnimationFrame` é chamado pelo navegador **na cadência do display**. O teto só sabe
*recusar* quadros; ele não tem como pedir mais do que a tela oferece. Num painel LTPO de 1 a 120 Hz,
teto 240 é o mesmo que teto nenhum — e é por isso que o overlay marca 75, que é a média de um painel
alternando entre 120 e 60. Nada a corrigir; fica registrado porque a pergunta vai voltar.

### O campo dentro do Nether — e a correção da manhã abriu essa porta

É o inverso exato do pilar de netherrack na grama, e o carimbo de dimensão que resolveu aquele **não
pega este**. Lá, o pipeline trocava de dimensão enquanto uma leitura estava em voo; aqui, quem está
fora de sincronia não é o pipeline consigo mesmo, é o **save com o pipeline**:

- o pipeline troca de dimensão de forma **síncrona** e já pede chunk no mesmo tick;
- o save troca de forma **assíncrona**, porque antes precisa gravar baús, veículos e as colunas que
  estão saindo.

Na fresta entre os dois, o pipeline pedia chunk do Nether e o save respondia com a chave da
superfície. E a correção da manhã **alargou a fresta**: `setDimension` passou a esperar a gravação
de verdade, em vez de voltar na hora. Consertar um lado do mesmo problema aumentou o outro.

`SaveGame.loadChunk` agora **espera a troca terminar**. É o lugar certo: o carregamento já é
assíncrono, o pipeline já sabe esperar por ele, e a travessia tem tempo limite se algo travar.

### A chuva no Nether

`hasSky` está em `data/dimensions.ts` desde que o Nether nasceu e **nada no código a lia** — a
terceira dívida desse tipo no projeto, depois de `fireImmune` (fechada no M7) e `flammable` (ainda
aberta). O corte ficou em `Weather.kind`, um lugar só: `isRaining`, `isThundering`, `intensity` e o
teto de luz do céu derivam todos dele.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/game/savegame.ts` | `loadChunk` espera a troca de dimensão; `switchDimension` guarda a promessa |
| `~` | `src/game/weather.ts` | `hasSky`: sem céu, `kind` é sempre `clear` |
| `~` | `src/game/session.ts` | passa o `hasSky` da dimensão ao entrar nela e ao nascer |
| `~` | `tests/dimensionrace.test.ts` | leitura durante a troca sai na chave nova; o mesmo instante chuvoso fica seco sem céu |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | §4, métricas, FPS de campo |

**Portões:** 1155 testes (64 arquivos), lint limpo, build limpo, **171,3 KB gzip** de 350.

---

## 2026-09-13 · 14:15 → 14:35 · O portal que só funcionava perto de casa

**Pedido:** *"deu uma melhorada absurda no carregamento do mundo, não vejo mais problema"* — e três
coisas novas: travar ao entrar no Nether *"sem renderizar portal algum"*, a textura *"piscando toda
hora… deixando tudo transparente e voltando"*, e o tier ainda em T1.

**Resultado:** a vazão do pipeline está resolvida (861/861 colunas, **0 na fila**). Os três achados
novos eram bugs, e o terceiro se resolveu com o dado que a linha de aparelho de meia hora atrás
passou a mostrar.

### 1 — o portal só funcionava perto da origem

O pipeline carrega o anel em volta do **jogador**, e a travessia o deixava parado nas coordenadas
antigas enquanto esperava o chunk de destino. Com a escala 1:8, esse chunk pode estar a 700 blocos
dali: nunca chegava, a viagem estourava o tempo limite de 30 s e o jogador ficava largado na
dimensão nova, nas coordenadas velhas — dentro da rocha, sem portal, sem conseguir andar nem voar.
Perto do spawn a diferença cabia no render distance e tudo parecia funcionar, que é por que passou
por todos os testes e pela primeira sessão de campo.

`onDimensionChange` passou a levar as coordenadas do destino, e a `Session` põe o jogador lá na
hora. A física já estava congelada durante o carregamento, então mover antes de existir chão é
seguro; o Y definitivo continua saindo de `arriveAt` quando o chunk chega. Duas regressões com
coordenadas bem longe da origem — ida e volta — mais uma de que a `Session` sem coordenadas (save e
renascimento) não mexe no jogador.

### 2 — a tela piscando

O contexto era criado com **`desynchronized: true`**. A opção tira o canvas da sincronia com o
compositor, e a especificação diz com todas as letras que nesse modo pode haver tearing e quadro
apresentado fora de hora. Num painel LTPO, que troca de 120 para 60 Hz sozinho, isso vira piscada
constante — com a tela parada, e só naquele aparelho, que foi exatamente o relato.

Agrava o teto de FPS de `core/loop.ts`, que devolve o quadro **sem desenhar**: fora de sincronia com
o compositor, quadro não desenhado é conteúdo indefinido na tela. O que se ganhava eram alguns
milissegundos de latência de toque.

**Não dá para reproduzir aqui** — é um aparelho e um painel específicos. O que sustenta a mudança é
que `desynchronized` é a única coisa no contexto que abre mão da sincronia, e desligá-la é o valor
seguro; o custo de estar errado é milissegundos de latência.

### 3 — o tier, resolvido pelo dado e não pelo palpite

A linha de aparelho nova mostrou o motivo de a regra da manhã não ter promovido ninguém:

```
mem 8GB · 8 núcleos · 2 workers · tex 8192 · ANGLE (Qualcomm, Adreno (TM) 750, OpenGL ES 3.2)
```

**`tex 8192` num Adreno 750** — quem responde `MAX_TEXTURE_SIZE` é o ANGLE, não o driver. A
heurística de 16384 era inútil e saiu. Sobrou o nome, que é o que o aparelho de fato informa: a
regra virou simétrica à das GPUs antigas, com família de topo (Adreno 7xx/8xx, Mali-G7xx,
Immortalis, Xclipse, Apple GPU) valendo +2. Envelhece igual à outra — e é por isso que a opção
**Qualidade** entrou junto.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/game/travel.ts` | `onDimensionChange` leva as coordenadas do destino |
| `~` | `src/game/session.ts` | `enterDimension(dim, x?, z?)` reposiciona o jogador no destino |
| `~` | `src/render/gl.ts` | `desynchronized: false`, com o motivo no comentário |
| `~` | `src/core/tier.ts` | heurística de textura fora; família de GPU de topo no lugar |
| `~` | `tests/nether.test.ts` | ida e volta longe da origem, e a `Session` sem coordenadas |
| `~` | `tests/dimensionrace.test.ts` | tier com a string real do aparelho e as outras famílias |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | §4, métricas |

**Portões:** 1151 testes (64 arquivos), lint limpo, build limpo, **171,2 KB gzip** de 350.

---

## 2026-09-13 · 13:50 → 14:15 · A máquina não estava lenta, estava entediada

**Pedido:** *"Mesmo após seu ajuste aqui no S24 ultra a geração de mundo está muito estranha, bem
lenta mesmo"*, e em seguida *"Será que não é limitação do próprio navegador Chrome?"*.

**Resultado:** não era o Chrome, e a correção da manhã tinha atacado o sintoma menor. O overlay
trazia a resposta inteira: **861/861 colunas carregadas** — a geração tinha terminado —, **7051
sections na fila**, 60 FPS e **render de 3,2 ms num frame de 16,6**. Um aparelho sem nada para
fazer e uma fila de sete mil.

### O gargalo

`maxInFlight = workers * 2`, e o `pump` roda **uma vez por frame**. O teto de pedidos em voo era,
portanto, o teto de despachos por frame: **4**. O aparelho mandava quatro jobs e esperava o frame
seguinte, com os workers parados ~90% do tempo. Nada disso aparece como queda de FPS — aparece como
mundo que não nasce.

Medido no pipeline, varrendo o multiplicador com um mundo de RD 16 (861 colunas, ~4.400 sections):

| Vagas por worker | Pumps para ficar pronto | A 60 FPS |
|---|---|---|
| 2 (como estava) | 1315 | 21,9 s |
| 4 | 657 | 10,9 s |
| 8 | 328 | 5,5 s |
| 16 | 165 | 2,7 s |
| 32 | 82 | 1,4 s |

Linear, porque o trabalho total é idêntico nos cinco casos (as mesmas 4.398 malhas): só muda quantos
cabem por frame.

### A correção, e por que não é só "aumentar o número"

O teto subiu para `workers * 16`, mas quem passa a limitar de verdade é um **orçamento de tempo**:
20% do frame, derivado do FPS alvo do preset. Despachar não é de graça — cada job de malha copia a
vizinhança 18³ da coluna (blocos e luz) **na thread principal**, ~0,26 ms por section. Um número
fixo alto entregaria o frame de um aparelho fraco para a cópia; sendo orçamento, a conta se ajusta
sozinha: o aparelho rápido despacha mais, o lento despacha menos, e nenhum dos dois engasga.

### Duas coisas que a medição corrigiu em mim

**O primeiro número estava errado por culpa do duplo de teste.** O worker falso meshava dentro do
`postMessage`, então o custo do worker era cobrado do orçamento de despacho da thread principal —
que no navegador roda em outra thread. Medido assim, a correção parecia render 887 pumps; com o
duplo consertado, 463.

**E a reserva de vagas da manhã perdeu o efeito.** Com 32 vagas ela não muda nada: sobra para os
dois lados. Ela guarda o regime oposto — aparelho lento, onde o orçamento deixa passar meia dúzia de
despachos por frame e sem reserva o meshing leva todos —, que era o regime de **todo** aparelho
antes. O teste dela foi refeito para rodar com o teto apertado, que é onde ela tem o que provar; o
§4 do doc 15 registra a revisão de escopo.

**O teste de vazão também estava flaky** e passou despercebido por pouco: o orçamento é de relógio,
então a vazão dependia de quanto a máquina estava ocupada — passava sozinho e falhava na suíte
cheia. `dispatchBudgetMs` e `maxInFlight` viraram opções do pipeline; os testes passam `Infinity` e
medem só a estrutura.

### O tier, que o usuário estranhou de novo

O bônus de textura de 16384 da manhã **não promoveu** o S24 Ultra, e não havia como saber qual dos
quatro números de `detectTier` está baixo. Duas respostas:

- o overlay ganhou uma **linha de aparelho** — memória, núcleos, workers, textura máxima e GPU
  reportada;
- Opções → Vídeo ganhou **Qualidade** (Automática/Baixa/Média/Alta). O comentário de `core/tier.ts`
  promete desde o M0 que tudo ali pode ser sobrescrito nas opções, e só a distância de render era.
  Vale no carregamento seguinte, porque o número de workers é decidido quando o pipeline nasce.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/world/pipeline.ts` | teto de vagas `workers * 16` e orçamento de despacho de 20% do frame; `maxInFlight` e `dispatchBudgetMs` viraram opções |
| `~` | `src/ui/debug.ts` | linha de aparelho, para diagnosticar o tier em vez de adivinhar |
| `~` | `src/game/settings.ts`, `src/ui/screens/options.ts` | opção **Qualidade**, com tier forçado |
| `~` | `src/main.ts` | escolha do jogador vence `detectTier`; `targetFps` vai para o pipeline |
| `~` | `tests/dimensionrace.test.ts` | vazão de RD 16 (165 pumps contra 1315) e reserva medida com teto apertado |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | §4, métricas |

**Portões:** 1146 testes (64 arquivos), lint limpo, build limpo, **171,2 KB gzip** de 350. Três
execuções seguidas da suíte completa: verde.

---

## 2026-09-13 · 13:20 → 13:45 · Quatro bugs que só um aparelho na mão acha

**Pedido:** *"Notei algumas coisas estranhas no jogo"* — pilar de netherrack na superfície depois
de voltar do Nether, mundo demorando muito para renderizar num S24 Ultra, o aparelho entrando como
T1, e *"parte da lava fica mais acesa e parte da lava mais escura"*.

**Resultado:** os quatro eram bugs de verdade, todos no código do M7 entregue hoje de manhã, e
nenhum deles apareceria em teste de FPS. Todos com regressão que **falha sem a correção** —
verificado revertendo cada uma.

### 1 e 2 — a coluna do Nether na superfície, por duas portas

O pilar de netherrack é uma **coluna inteira gravada na dimensão errada**, e havia dois caminhos
para isso.

**No save:** `flush` devolvia na hora quando já havia gravação em curso — *"chamadas concorrentes
são ignoradas, a primeira já vai levar o resto"*, o que é verdade para o autosave e catastrófico
para `setDimension`, cuja razão de existir é gravar **com a chave antiga** o que está saindo. Com
um autosave rodando, aquele `await this.flush()` não esperava nada: a dimensão virava no meio e o
lote em voo caía no disco com a chave nova. Agora `flush` devolve a promessa em curso, e
`setDimension` chama duas vezes — a primeira espera a que já rodava, a segunda leva o que o
`pipeline.setDimension` acabou de sujar ao descarregar o mundo.

**No pipeline:** o caminho do save em `dispatchGen` é uma leitura assíncrona de IndexedDB, e
`acceptChunk` só conferia **distância**. Atravessar o portal com uma leitura em voo punha a coluna
do outro lado no mundo novo — e, como ela volta do disco marcada `modified`, ao sair de alcance era
gravada na dimensão errada. A dimensão passou a ser carimbada no despacho e conferida na volta,
exatamente como já acontecia com a resposta do worker. O comentário de `setDimension` afirmava que
isso já valia para tudo; valia só para o worker.

De quebra, a chave de armazenamento passou a ser capturada **antes** de qualquer `await`, aqui e em
`saveAndForget` — onde funcionava por depender da ordem de avaliação dos argumentos, o que é estar
certo por acidente.

### 3 — o meshing matando a geração de fome

*"C: 201/861 colunas, 1046 na fila, 0 gerando, 4 meshando"*. São `workers × 2` vagas, o meshing era
despachado primeiro **sem teto**, e uma coluna rende até 8 jobs de malha: com a fila cheia as
quatro vagas iam todas para malha e quase nada nascia. Metade das vagas agora fica reservada para a
geração enquanto houver fila dela — gerar e meshar uma coluna custam a mesma ordem de grandeza
(6–14 ms contra 8 × 0,6–1,5 ms), então meio a meio é onde nenhum dos dois espera pelo outro.

Medido no pipeline com worker de verdade: **86 colunas em 40 ciclos, contra 44**. O primeiro teste
que escrevi para isto **passava com o bug** — os jobs de malha eram todos adiados por falta de
vizinho e não gastavam vaga. Só com coluna cheia e mesher real o sintoma aparece.

É também a explicação real do *"o mundo não acompanha a geração"* de T0, que em 2026-09-12 se
atribuiu ao número de workers.

### 4 — o Nether sem luz

`generateNetherChunk` chamava `recomputeHeightMap()` e **não** `computeChunkLight()`, que o gerador
da superfície sempre chamou. Lava, pedra luminosa e magma declaravam `emission` na tabela de blocos
e não acendiam nada. Pior que escuro, ficava **manchado**: coluna que o jogador tinha modificado
voltava pelo save, que recalcula a luz, e nascia iluminada ao lado de uma que não — que é
literalmente *"parte da lava mais acesa e parte mais escura"*. Custo: 3,8 → 6,1 ms por chunk,
contra um orçamento de 25.

### 5 — e o tier, que o usuário estranhou com razão

Nenhum celular podia chegar ao T2, por mais forte que fosse. `navigator.deviceMemory` satura em 8,
então um aparelho de 12 GB pontua igual a um de 8; com a penalidade de `isMobile`, o melhor celular
possível somava **3** e o T2 exige 4. `maxTexSize >= 16384` — GPU de classe GLES 3.1/3.2, e o único
número que vem do driver em vez de um nome para casar com regex — passou a valer +1.

A primeira versão dessa regra **promovia a T2 um aparelho sem WebGL2**, o oposto da regra de errar
para baixo; o teste novo pegou, e o bônus passou a exigir WebGL2.

De brinde: o overlay mentia o render distance. O cabeçalho era montado uma vez no construtor, então
quem subisse a opção para 16 em jogo continuava lendo "RD 8" — e media o mundo errado.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/dimensionrace.test.ts` | 15 regressões: as duas portas da corrupção, a vazão do pipeline, a luz do Nether e o tier |
| `~` | `src/save/savemanager.ts` | `flush` devolve a promessa em curso; chave capturada antes dos `await` |
| `~` | `src/world/pipeline.ts` | dimensão carimbada no caminho do save; metade das vagas reservada para a geração |
| `~` | `src/world/gen/nether.ts` | `computeChunkLight` no fim da geração |
| `~` | `src/core/tier.ts` | bônus de textura 16384 com WebGL2 |
| `~` | `src/ui/debug.ts`, `src/main.ts` | render distance vivo no cabeçalho do overlay |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | §4 com os quatro bugs, métricas |

**Portões:** 1145 testes (64 arquivos), lint limpo, build limpo, **170,9 KB gzip** de 350.

---

## 2026-09-13 · 10:31 → 11:12 · A arte do jogador, e o M7 fecha

**Pedido:** *"Continue o desenvolvimento do resource pack"*.

**Resultado:** **quinto e último item do M7** — o jogador pode trazer a própria arte. Com ele
fecham o M7 e os **oito marcos do `PROMPT.md`**.

### A regra do doc 13 continua inteira

**Nenhum asset de terceiros entra no repositório.** Todo pixel que o jogo distribui continua saindo
de `data/textures.ts`, `data/itemart.ts` e `data/mobskins.ts`, receitas que rodam no boot. Um pack
é o caminho para quem quer a **própria** arte: um `.zip` que o jogador escolhe, que mora no banco
dele e que nunca passa por servidor nem por `src/`. Nada no repositório mudou de licença.

### O leitor de zip

`core/zip.ts`, ~150 linhas, porque o doc 13 §7 pede um `.zip` e o projeto não tem dependência de
runtime. Só a leitura interessa: não escrevemos zip, não tratamos ZIP64, não abrimos arquivo
cifrado e não conferimos CRC — o PNG tem o dele.

**A leitura é guiada pelo diretório central**, no fim do arquivo, não pelos cabeçalhos locais. É o
que faz funcionar com zip gerado em streaming, cujo cabeçalho local traz tamanho zero e joga o
valor real para depois dos dados. O cabeçalho local ainda é lido, mas só pelos **tamanhos de nome e
extra**: alguns compactadores põem o campo de tempo estendido só num dos dois, e ler do lugar
errado começa a descompressão alguns bytes fora.

A descompressão é `DecompressionStream('deflate-raw')`, a mesma que `save/serialize.ts` usa nos
chunks: zero bytes de bundle. Onde ela não existe, entra o que estiver guardado sem compressão e o
jogador recebe a frase que explica o resto.

### A convenção de nomes

A do doc 13 §7, com uma folga: o caminho pode ter qualquer prefixo de pastas e valem os **dois
últimos segmentos** — `block/stone.png` e `assets/qualquer/textures/block/stone.png` chegam no
mesmo lugar. Três famílias, e a terceira é acréscimo nosso (o doc só nomeia as duas primeiras):

| Família | Destino | Lado |
|---|---|---|
| `block/<textura>` | camada do atlas de blocos | 16 |
| `item/<item>` | tile da folha de sprites | 16 |
| `entity/<skin>` | camada do atlas de entidades | 64 |

Imagem de outro tamanho é **reamostrada no import**, não no boot: o jogador paga uma vez e o que
vai para o banco já está pronto para subir na GPU. A média é ponderada pelo alfa, como a dos
mipmaps do atlas e pelo mesmo motivo — sem isso a borda de um vidro ganha um halo da cor de fundo
do PNG. Nome sem correspondente no jogo é recusado e **contado**: a tela diz quantas imagens
entraram e quantas ficaram de fora.

### Onde o pack entra

**No boot, antes de o atlas gerar um pixel.** Mipmap, média de cor das partículas de quebra e a
folha de sprites de item derivam todos dos mesmos arrays; aplicar depois exigiria refazer os quatro
mais as duas texturas de GPU que saem da folha. O `boot()` virou assíncrono e o banco subiu três
linhas — ele ia abrir logo depois de qualquer jeito.

O `Atlas` e o `EntityAtlas` ganharam um `overrides` no construtor, e `buildItemSheet` um mapa de
arte por item. Detalhe de graça: um `item/<nome>.png` **dá sprite a item que não tinha nenhum**.

### Aplicar recarrega, e quem aperta é o jogador

Importar guarda o pacote e mostra o resultado; **o botão de recarregar é do jogador**. Assim ele lê
"38 aceitas, 4 ignoradas" antes de a tela sumir, e um zip que só acertou 3 nomes de 300 não vira
surpresa depois do boot. A tela é a **de título**, não a de opções: das opções se chega de dentro
do jogo, pelo menu de pausa, e recarregar ali custaria o que se fez desde o último autosave.

### Desvios conscientes

- **Não escrevemos um decodificador de PNG.** `createImageBitmap`, com `Image` + URL de blob como
  reserva para o WebView antigo, gasta 20 linhas em vez de 300 de bundle para repetir o que todo
  navegador já faz.
- **A arte do pack vale só na camada dela.** Textura gerada a partir de outra continua saindo do
  procedural — senão trocar a pedra mudaria o minério, o musgo e mais uma dúzia de blocos.
- **`Atlas.loadOverrides` continua trocando só o nível 0** de mipmap. O caminho do pack é o
  construtor; a função existe porque o `PROMPT.md` §219 a pede pelo nome, e agora ao menos mantém
  os pixels guardados em dia.

### Arquivos

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/core/zip.ts` | leitor de ZIP guiado pelo diretório central, guardado e deflate |
| `+` | `src/render/pack.ts` | convenção de nomes, reamostragem, persistência e decodificação de PNG |
| `+` | `src/ui/screens/packs.ts` | tela do pacote: escolher, remover, contar e recarregar |
| `+` | `tests/zip.test.ts` | 13 testes; os zips são montados byte a byte no próprio teste |
| `+` | `tests/pack.test.ts` | 18 testes com decodificador injetado — sem DOM e sem imagem no repo |
| `~` | `src/render/atlas.ts` | `overrides` no construtor, antes de mipmap e média de cor |
| `~` | `src/render/entityatlas.ts` | `overrides` no construtor e `entitySkinNames()` para validar sem GL |
| `~` | `src/render/itemsprites.ts` | `buildItemSheet` aceita arte por item e dá sprite a quem não tinha |
| `~` | `src/ui/menuflow.ts` | instala, remove e consulta o pacote; `location.reload()` aplica |
| `~` | `src/ui/screens/title.ts` | botão "Texturas" |
| `~` | `src/ui/screens/menu.ts` | `messageOf` virou compartilhado entre as telas |
| `~` | `src/ui/screens/worlds.ts` | usa o `messageOf` compartilhado |
| `~` | `src/main.ts` | `boot()` assíncrono; banco e pacote antes do atlas |
| `~` | `docs/15-status.md`, `docs/16-auditoria.md`, `README.md` | M7 fechado |

**Portões:** 1130 testes (63 arquivos), lint limpo, build limpo, **170,7 KB gzip** de 350.

---

## 2026-09-13 · 10:12 → 10:26 · O mundo cabe num arquivo, e o carrinho para de sumir

**Pedido:** *"Pode implementar o próximo ponto e já corrigir a questão do save"*.

**Resultado:** quarto item do M7 fechado — **import/export de mundos** — e a persistência de
veículo que estava na lista de pontas soltas. Falta **um** item para o M7 fechar: o resource pack.

### O arquivo

Responde à pergunta que o usuário fez em 2026-09-12 e que até hoje se respondia "não dá": levar um
mundo do celular para o computador. Nada vai para servidor, então o transporte é um arquivo `.clw`.

**O formato reaproveita o que já existe.** Cada chunk entra no arquivo exatamente como está no
banco — já serializado e já comprimido por `save/serialize.ts`. Reserializar seria pagar duas vezes,
e um mundo de 500 chunks em JSON com base64 ficaria três vezes maior. Meta, jogador, baús e veículos
vão em JSON: é pouco, e assim um formato novo de baú não quebra o arquivo antigo.

**O mundo importado sempre ganha id novo**, e o nome ganha sufixo quando já existe outro igual.
Reaproveitar o id do arquivo sobrescreveria em silêncio um mundo que o jogador já tem — o pior
resultado possível para uma função cujo ponto é não perder nada.

`packArchive` e `unpackArchive` são puros: só mexem em bytes. É por isso que o formato é testado sem
IndexedDB nenhum, incluindo os quatro modos de arquivo inválido — assinatura errada, curto,
truncado e versão futura, cada um com a sua frase na tela.

### O save que faltava

Duas coisas que sumiam sozinhas, corrigidas juntas porque moram no mesmo lugar:

1. **Barco e carrinho nunca foram salvos**, desde que existem. Sair do mundo e voltar sumia com os
   dois — o trilho ficava, o carrinho em cima dele não.
2. **O baú do Nether sobrescrevia o da superfície.** A lista de tile entities tinha uma chave por
   **mundo**, não por dimensão; atravessar o portal gravava a lista de lá por cima da de cá, e o
   conteúdo de todo baú de casa ia junto. Bug meu, do M7 desta manhã, achado ao escrever o save do
   veículo — e o tipo de coisa que só apareceria semanas depois, sem ninguém saber ligar a causa.

**A ordem virou regra explícita:** a `Session` dispara `onDimensionChange` **antes** de limpar as
listas, e o `SaveGame` tira o instantâneo de forma síncrona dentro do evento — só a gravação é
adiada. Invertida, o save encontraria tudo vazio. De quebra, a troca de dimensão virou **um caminho
só**: portal, renascimento e restauração do save passam todos por `Session.enterDimension`.

**Portões:** 1099 testes (eram 1076), lint limpo, build limpo, bundle 167,6 KB gzip de 350.

### Arquivo de mundo (novo)

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/save/archive.ts` | Formato binário, `packArchive`/`unpackArchive` puros, `exportWorld`/`importWorld` sobre o banco, nome único e nome de arquivo |
| `+` | `tests/archive.test.ts` | 19 testes: ida e volta, bytes do chunk, arquivo inválido nos quatro modos, e o caminho do banco |

### Save

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/save/savemanager.ts` | Baús passam a ter chave **por dimensão**; `saveVehicles`/`loadVehicles` |
| `~` | `src/save/db.ts` | `allChunks` por faixa de chave; `DIMENSION_COUNT` exportado |
| `~` | `src/save/serialize.ts` | `ByteWriter`/`ByteReader` exportados — dois formatos binários, um jeito de escrever |
| `~` | `src/game/savegame.ts` | `switchDimension` com instantâneo síncrono; veículos no `saveAll` e no `load` |
| `~` | `src/game/session.ts` | `VehicleRecord`, `vehicleSnapshot`, `restoreVehicles`; evento antes da limpeza; caminho único de dimensão |
| `~` | `src/main.ts` | Usa `switchDimension`; `world.dimension` passa a ser escrito só pela `Session` |

### Interface

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/screens/worlds.ts` | Botões Exportar e Importar, seletor de arquivo escondido e linha de status |
| `~` | `src/ui/menuflow.ts` | Download por blob e leitura do arquivo escolhido |
| `~` | `tests/savegame.test.ts` | 4 testes: veículo na ida e na volta, listas por dimensão, dimensão no instantâneo |
| `~` | `docs/15-status.md` | §1, §2, §3 (import/export e save de veículo), §5, §6, data |

---

## 2026-09-13 · 09:50 → 10:12 · O trilho descobre a própria forma

**Pedido:** *"Pode seguir"*.

**Resultado:** terceiro item do M7 fechado — **trilhos e carrinho de mina**. Sobram dois:
import/export de mundos e resource pack.

O bloco `rail` existia desde o M6, porque a mina o usa. O que faltava era tudo que faz dele
transporte.

**O trilho não é colocado com uma forma: ele a descobre.** Olha os quatro vizinhos e decide — dois
mandam (reta no mesmo eixo, curva em eixos diferentes), um define o eixo, nenhum mantém o que
estava — e a rampa entra depois, sobre o eixo já decidido. É isso que faz "colocar trilho" ser um
gesto só em vez de escolher entre dez peças.

**A forma vai para o estado, não para o meshing.** A conexão da cerca é calculada na hora de
desenhar, e nunca ocupou bit nenhum (doc 04 §2.5). A do trilho ocupa quatro, porque **o carrinho
precisa dela**: cerca conectada é desenho, trilho conectado é física, e refazer a busca de vizinhos
dentro do tick do carrinho seria pagá-la a cada movimento.

**A física do carrinho é de trilho, não de corpo livre.** Ele guarda uma velocidade escalar e uma
direção; a cada tick lê a forma do trilho, projeta a direção sobre o eixo dela, anda e **escreve** o
eixo perpendicular no centro do bloco. Zero consultas de colisão, e o carrinho não sai da linha.

**Dois sistemas no mesmo voxel.** `world/rails.ts` escreve os bits 0..3 (forma) e `world/redstone.ts`
o bit 4 (energia); cada um preserva os bits do outro. Há teste de regressão para exatamente isso,
porque é o tipo de coisa que quebra em silêncio seis meses depois.

**A primeira exceção de mesher em sete marcos.** Toda forma não-cubo do jogo é uma lista de caixas
alinhadas aos eixos — e caixa alinhada aos eixos não representa rampa. O trilho ganhou um caminho
próprio, `CPLX_RAIL`, que emite **um quad só**, deitado ou inclinado. De quebra ficou mais barato:
1 quad contra os 6 da caixa achatada que ele usava antes.

**Desvio consciente:** o carrinho não tem acelerador. O olhar escolhe para que lado da linha ele vai
e dá o empurrão inicial; quem sustenta a velocidade é o trilho motorizado. Um acelerador contínuo
tornaria o motorizado decorativo — e ele é metade do conteúdo desta entrega.

**Portões:** 1076 testes (eram 1047), lint limpo, build limpo, bundle 165,6 KB gzip de 350, atlas
152 camadas de 256.

### Trilhos (novo)

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/rails.ts` | Conexão automática: forma por vizinhança, rampa, queda sem apoio, bit de energia, varredura de chunk |
| `+` | `src/entity/minecart.ts` | Carrinho: física de trilho, empurrão, freio, rampa, curva, detector e queda fora da linha |
| `+` | `tests/rails.test.ts` | 28 testes: forma, rampa, curva, circuito, carrinho, detector e a sessão de ponta a ponta |

### Motor e dados

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/world/mesh/shapes.ts` | `SHAPE_RAIL`, as dez formas `RAIL_*`, `RAIL_LINKS`, `railIsSlope`/`railIsCurve`/`railSlopeDir` |
| `~` | `src/world/mesh/blockinfo.ts` · `complex.ts` | `CPLX_RAIL` e `emitRail`: um quad, deitado ou inclinado |
| `~` | `src/world/redstone.ts` · `src/data/redstone.ts` | Papéis `rail` (segue a energia) e `detector` (emite quando ocupado) |
| `~` | `src/data/blocks.ts` | Trilho passa a ter forma e textura por estado; trilho motorizado e detector (123–124) |
| `~` | `src/data/textures.ts` | `railBed`/`railGlow` e 5 texturas: curva, motorizado (2) e detector (2) |
| `~` | `src/data/items.ts` · `itemart.ts` · `recipes.ts` | Item do carrinho (`placesMinecart`), sprite e 3 receitas |
| `~` | `src/data/mobmodels.ts` · `mobskins.ts` · `render/entityatlas.ts` | Modelo, skin e camada do carrinho |
| `~` | `src/data/achievements.ts` | Conquista "Nos Trilhos" |
| `~` | `src/game/session.ts` | `Rails` e `Minecarts` ligados; montar/descer generalizado dos dois veículos; `driveBoat` → `driveVehicle` |
| `~` | `src/main.ts` | Desenha o carrinho no batcher dos mobs; chamada de pilotagem renomeada |
| `~` | `tests/complexmesh.test.ts` | O trilho saiu da lista de caixas e ganhou teste próprio |
| `~` | `docs/15-status.md` | §1, §2, §3 (trilhos), §5, §6, data |

---

## 2026-09-13 · 09:15 → 09:50 · Uma dimensão inteira, e uma dívida de cinco marcos

**Pedido:** *"Pode seguir com os desenvolvimento"* e, no meio da sessão, *"Pode aproveitar para
corrigir o seu achado mencionado anteriormente, para não deixar pontas soltas e débitos"*.

**Resultado:** o segundo item do M7 fechado — **Nether completo** — mais a dívida do aleatório dos
mobs, que era o achado da sessão anterior.

### O Nether

**A decisão que manda em tudo: só existe uma dimensão carregada por vez.** Num aparelho de 2 GB,
manter o Overworld na memória enquanto o jogador está do outro lado dobraria voxel, luz e malha sem
nada na tela para mostrar. Atravessar o portal grava o que está sujo, descarrega tudo e recarrega —
e a ordem importa: o save precisa gravar as colunas que saem ainda com a chave da dimensão antiga.

**O gerador nasceu duas vezes.** A primeira versão amostrava ruído 3D nos 32.768 voxels da coluna e
custava **56 ms por chunk**, o dobro do orçamento do doc 02. A segunda usa uma grade esparsa de
5×5×17 interpolada trilinearmente — a mesma técnica dos mapas 2D do Overworld — e varre a coluna
**uma vez só**, com a forma num `Uint8Array` local em vez de três passadas com `getBlock`. Custa
**3,8 ms**, menos que o gerador da superfície.

**A travessia tem um estado que parecia dispensável e não era.** O pipeline é assíncrono: trocar de
dimensão descarrega tudo e o terreno do outro lado leva alguns frames. A primeira versão punha o
jogador no destino na hora, e ele caía pelo mundo vazio. O estado "carregando" segura a física até
o chunk chegar, com tempo limite — destino que nunca carrega aborta a viagem em vez de largar o
jogador no nada.

**Compatibilidade de save sem migração:** a chave de chunk do Overworld continua sendo o `worldId`
puro, e `PlayerSave.dimension` é opcional. Mundo salvo antes do M7 abre exatamente como abria.

**Duas pontas que só aparecem jogando, fechadas antes de sair:** morrer no Nether devolve o jogador
à superfície (renascer com as coordenadas de lá dentro daqui é cair num mar de lava), e sair do
mundo dentro dele volta nele.

**Uma dívida de cinco marcos, achada no caminho:** o traço `fireImmune` existia desde o M5 e
**nenhum mob o declarava** — não havia como um mob pegar fogo além do sol. Agora lava machuca mob,
e os dois do Nether são imunes. Sem isso o ghast passearia dentro da lava.

### A dívida do aleatório

`entity/mobs.ts`, `entity/mobstore.ts` e `entity/spawn.ts` chamavam `Math.random()` direto, ao
contrário de `world/growth.ts`. O sintoma estava medido na sessão anterior: `tests/mobs.test.ts`
falhava 2 vezes em ~14 execuções da suíte completa e nunca reproduzia isolado. Os três passaram a
expor `random: () => number`, com `Mobs.random` propagando para o store e para o contexto de IA de
uma vez; os quatro arquivos de teste que montam mobs semeiam um `Rng` de `core/rng.ts`. Entrou
regressão que falha se alguém voltar a chamar o aleatório global. Doze execuções seguidas da suíte
completa depois: verde.

**Portões:** 1047 testes (eram 1003), lint limpo, build limpo, bundle 161,8 KB gzip de 350, atlas
147 camadas de 256, Nether a 3,8 ms/chunk.

### Dimensão (novo)

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/dimensions.ts` | Tabela: céu, luz ambiente, névoa, escala 1:8, evaporação, alcance de lava, teto |
| `+` | `src/world/gen/nether.ts` | Gerador: grade esparsa de densidade, mar de lava, rocha-mãe, quartzo, magma, areia das almas, glowstone |
| `+` | `src/game/portal.ts` | Moldura, ignição, apagamento, destino, busca de portal existente e construção da chegada |
| `+` | `src/game/travel.ts` | Máquina de três estados da travessia, com espera de chunk e tempo limite |
| `+` | `tests/nether.test.ts` | 40 testes: gerador, dimensões, portal, chegada, travessia, mobs e save por dimensão |

### Motor

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/world/world.ts` | `dimension`, `dimensionDef` e `takeAllChunks` |
| `~` | `src/world/pipeline.ts` | `setDimension`: descarrega, limpa filas e invalida o centro; `dim` em toda requisição |
| `~` | `src/workers/protocol.ts` · `chunk.worker.ts` | `dim` na requisição e na resposta; ruído do Nether criado preguiçosamente |
| `~` | `src/save/db.ts` · `savemanager.ts` · `game/savegame.ts` | Chave de chunk por dimensão (Overworld inalterado), `setDimension`, `PlayerSave.dimension` |
| `~` | `src/render/renderer.ts` · `sky.ts` · `chunkrenderer.ts` | Céu e névoa por dimensão; `SkyPass.override`; `clear()` solta toda a malha da GPU |
| `~` | `src/world/fluids.ts` | Água evapora onde a dimensão manda; alcance da lava vem da tabela |
| `~` | `src/game/session.ts` | `Travel`, `enterDimension`, isqueiro, portal apagado ao quebrar, limpeza de entidades, renascimento na superfície |
| `~` | `src/main.ts` | Troca de dimensão (pipeline, save, céu, malha) e física congelada durante a travessia |

### Conteúdo

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/blocks.ts` | 6 blocos (117–122); campo `translucent` |
| `~` | `src/data/textures.ts` · `itemart.ts` | 6 texturas de bloco e 3 sprites de item |
| `~` | `src/data/items.ts` | Quartzo, tijolo do Nether e isqueiro (campo `lights`) |
| `~` | `src/data/recipes.ts` · `smelting.ts` · `loot.ts` | Isqueiro, tijolos, netherrack → tijolo, drops de quartzo |
| `~` | `src/data/mobs.ts` · `mobmodels.ts` · `mobskins.ts` | Porco zumbi e ghast; traços `flies`, `shootsFireball` e `modelScale`; `dimension` na regra de spawn |
| `~` | `src/data/achievements.ts` | 3 conquistas do Nether; a chave `sail` do objetivo do barco estava errada (era `boat`) |
| `~` | `src/audio/synth.ts` | Voz do ghast, som de portal e de evaporação |
| `~` | `src/entity/projectile.ts` | Bandeiras: sem gravidade e explosivo — a bola de fogo é uma flecha com duas linhas |
| `~` | `src/entity/mobstore.ts` · `ai/goals.ts` · `mobs.ts` | Física e IA de voo; alcance de tiro dobrado; dano de lava |
| `~` | `src/entity/spawn.ts` | Spawn filtrado por dimensão, no sorteio e no peso |

### Dívida do aleatório

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/mobs.ts` · `mobstore.ts` · `spawn.ts` | `random` injetável nos três; `Mobs.random` propaga para store e IA |
| `~` | `tests/mobs.test.ts` | Semente determinística no harness + 3 testes de regressão de determinismo |
| `~` | `tests/spawn.test.ts` · `breeding.test.ts` · `nightlife.test.ts` | Semente determinística nos harnesses |

### Testes e documentos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `tests/perf.test.ts` | Orçamento do Nether: chunk em menos de 25 ms |
| `~` | `tests/entityart.test.ts` · `pipeline.test.ts` · `savegame.test.ts` | Ajuste ao `dim` do protocolo e à contagem de mobs |
| `~` | `docs/15-status.md` | §1, §2, §3 (Nether e dívida do aleatório), §5, §6, data |

---

## 2026-09-13 · 08:30 → 09:15 · O M7 começa por onde dá para brincar

**Pedido:** *"Vamos seguir com o desenvolvimento do M7, porém sem desenvolver o multijogador por
enquanto pois acredito que ele irá pesar muito o jogo e trazer muita complexidade por enquanto
desnecessária"* — precedido da confirmação de campo que faltava: *"eu já havia feito os testes no
dispositivo T0, tudo funcionando perfeitamente e sempre a 60 FPS sem problema"*.

**Resultado:** duas coisas fechadas e uma aberta. Fechou a **dependência externa** que atravessava
o projeto desde o M3 — não há mais pendência de marco anterior, M0 a M6 estão validados no
aparelho-alvo. Fechou também o **primeiro item do M7**: redstone completo, do pó ao pistão
pegajoso. E abriu o M7 de verdade, agora com quatro itens em vez de cinco: o multijogador P2P saiu
de escopo por decisão do usuário, com o doc 12 continuando normativo e sem prazo.

O redstone são 15 blocos novos (ids 102–116), um motor de circuito e uma tabela declarativa de
papéis. As decisões que valem registro:

**O modelo de energia cabe numa frase.** *Forte* é o que um emissor dedicado entrega ao bloco em
que está encostado — e bloco com energia forte realimenta pó vizinho com 15, sem perda. *Fraca* é o
que o pó entrega aos seis vizinhos: liga mecanismo, mas **não** realimenta pó. É essa distinção, e
só ela, que impede o fio de atravessar parede e voltar a 15 do outro lado. Ficaram fora, de
propósito: comparador, observador, tremonha, queima de tocha e energia quasi-conectada.

**A fila é drenada dentro do mesmo tick.** Um fio de 60 blocos acende no tick em que a alavanca é
puxada, que é o que o jogador espera — não uma casa por tick. O teto de 1024 atualizações é o que
transforma um oscilador patológico num frame ruim em vez de numa aba travada. Medido:
**0,88 ms/tick** com um fio de 64 blocos ligando e desligando.

**Dois bugs de integração, achados antes de sair e cobertos por regressão:**

1. **A porta não abria na mão.** Abrir uma porta dispara reavaliação da posição; o circuito via
   energia zero e fechava a porta no mesmo tick — a porta simplesmente não abria. O bit 4 do estado
   passou a guardar "aberta **por energia**", e a porta só se mexe quando a energia muda.
2. **A placa de pressão não afundava.** A colisão pousa o pé um décimo de milésimo abaixo do topo
   do bloco (`TOUCH_EPSILON`), e o `Math.floor` do Y caía no bloco de baixo.

**Duas descobertas no caminho:** `placesBlock` existia na tabela de itens desde o M2 e **nunca
tinha sido lido** por `game/interaction.ts`, que resolvia bloco por `itemId === blockId`; é ele que
agora deixa o item `redstone` colocar `redstone_wire`. E `BlockDef` ganhou `support`, declarativo,
que faz pó, placa, repetidor, alavanca e botão caírem como item ao perder o apoio — disponível para
qualquer bloco futuro, não só os de circuito.

**Teto de atlas revisto**, como o doc 15 §6 pedia desde 2026-09-12: 128 → 256 camadas no doc 02 §3.
A linha antiga era arbitrária e travava em 127; o GLES 3.0 garante 256 em qualquer aparelho, e 256
camadas custam 0,34 MB num alvo de 350 MB. Com as 14 texturas novas estamos em **141**.

**Portões:** 1003 testes (eram 948), lint limpo, build limpo, bundle 155,8 KB gzip de 350, atlas
141 camadas de 256.

### Circuito (novo)

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/redstone.ts` | Motor do circuito: energia forte/fraca, fila por tick com teto, tocha, repetidor, pistão, placas e apoio |
| `+` | `src/data/redstone.ts` | Tabela declarativa de papéis por bloco; porta/portão/alçapão entram pela forma, sem linha própria |
| `+` | `tests/redstone.test.ts` | 40 testes: propagação, degrau, forte × fraca, os seis componentes, apoio e orçamento |

### Dados e conteúdo

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/blocks.ts` | 15 blocos (102–116); `BlockShape` ganhou 6 formas; `SupportKind` novo; `dustStages()` |
| `~` | `src/data/textures.ts` | 14 texturas procedurais; `dustCross()` e `dustTextures()` para os 4 níveis de brilho |
| `~` | `src/data/items.ts` | `places` em `SimpleItem`: o item `redstone` coloca `redstone_wire` |
| `~` | `src/data/recipes.ts` | 12 receitas, do pó à tocha, ao repetidor e ao pistão pegajoso |
| `~` | `src/data/loot.ts` | Drops do pó, do lado apagado da tocha e da lâmpada, e do braço do pistão |
| `~` | `src/audio/synth.ts` | `block/click` e `block/piston` |

### Motor

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/world/mesh/shapes.ts` | 6 formas; `mounted()` resolve os 6 encaixes de alavanca e botão numa geometria só; `PISTON_STEP` e `mountForDir` |
| `~` | `src/world/mesh/blockinfo.ts` | Formas novas nas duas tabelas; `MAX_STAGES` 8 → 16 (o pó tem 16 níveis) |
| `~` | `src/game/interaction.ts` | `placesBlock` passa a valer; `hasSupport`; encaixe pela normal do clique; `facing4FromLook`/`facing6FromLook` |
| `~` | `src/game/session.ts` | Circuito criado, ligado, varrido por chunk e ticado; varredura de placas por entidade; `use()` antes da porta |
| `~` | `src/render/itemsprites.ts` | Arte desenhada vence o cubo isométrico — o pó na mão é pó, não um cubo vazado |
| `~` | `src/ui/debug.ts` · `src/main.ts` | Linha `E:` mostra `N redstone` quando há circuito rodando |

### Testes e documentos

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `tests/shapes.test.ts` | 10 testes de geometria das formas novas e do encaixe por direção |
| `~` | `tests/complexmesh.test.ts` | Todo componente sai do mesher com geometria; 4 degraus de brilho do pó; pistão estendido é mais curto |
| `~` | `tests/perf.test.ts` | Orçamento de tick do circuito: fio de 64 em menos de 5 ms |
| `~` | `docs/02-orcamento-performance.md` | §3: teto de atlas 128 → 256, com o motivo |
| `~` | `docs/15-status.md` | §1 (M7 em andamento, multijogador fora), §2 (métricas), §3 (redstone), §5 (dependência fechada), §6, data |

---

## 2026-09-12 · 10:55 → 11:14 · A perseguição que não perseguia

**Pedido:** *"Agora finalmente consegui encontrar os monstros, porém eles estão muito lentos"* e
*"só o zumbi começa a me seguir quando chego próximo dele. Os outros monstros não me seguem, só se
eu bater propositalmente neles"*.

**Resultado:** medi antes de mexer, e a metade da queixa estava mal diagnosticada — por mim
inclusive, que quase fui procurar bug na aquisição de alvo.

**Todo hostil já adquiria o jogador por proximidade.** O teste mostra `hasTarget = 1` para zumbi,
esqueleto, creeper, aranha e slime a oito blocos, com linha de visão. O que enganava era a
lentidão: creeper e aranha se aproximavam a 0,44 e 0,54 blocos/s, o que de dentro do jogo é
indistinguível de estar parado. As duas exceções reais são **por design** e continuam: o enderman
é neutro até ser provocado, e o esqueleto mantém distância para atirar (doc 07 §2) — ele só
aproxima além do alcance de tiro.

A lentidão eram dois defeitos somados:

1. **A velocidade da tabela não era atingida.** A ordem do tick é mesclar, mover, atritar, e o
   regime permanente fica em `blend / (1 − atrito × (1 − blend))` do alvo: **46%** no chão. O
   zumbi de 1,15 blocos/s andava a 0,53.
2. **A tabela era lenta demais.** 1,15 blocos/s é um quarto dos 4,317 do jogador caminhando.

Com os dois corrigidos, o regime medido bate com a tabela (zumbi 3,64 para 3,7 declarado; creeper
3,40 para 3,4; aranha 4,10 para 4,2) e a régua passa a ser o jogador: **não dá para escapar
caminhando, dá para escapar correndo**, ao preço da fome.

**Portões:** 948 testes (eram 945), lint limpo, build limpo, bundle 149,0 KB gzip de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/mobstore.ts` | `steerToMoveTarget` compensa o atrito do próprio tick, então `def.speed` é atingido de verdade |
| `~` | `src/data/mobs.ts` | Velocidades de hostil e neutro na régua do jogador; comentário na interface fixa a unidade |
| `~` | `tests/mobs.test.ts` | 3 testes: todo hostil adquire alvo, a velocidade declarada é a andada, e a faixa entre caminhar e correr |
| `~` | `docs/07-mobs-e-ia.md` | §1 (unidade de `speed`) e §2 (tabela de hostis, com o porquê) |
| `~` | `docs/15-status.md` | §2 (métricas), §4 (duas linhas), data |

---

## 2026-09-12 · 10:36 → 10:53 · O que acontece quando você fecha a aba

**Pedido:** *"Como está funcionando hoje os mundos salvos... Se eu criar um mundo no celular
consigo acessar no computador?"*, mais um bug — *"ao sair desse mundo e voltar para ele meu jogador
é teletransportado para a primeira posição onde iniciou"* — e, no meio da sessão, *"o mundo só é
salvo se eu apertar 'Salvar e sair'? Se eu simplesmente fechar a aba nada será salvo?"*.

**Resultado:** a pergunta sobre armazenamento virou auditoria, e a auditoria achou mais do que os
três itens que já estavam na fila. O saldo: **seis correções**, cinco delas de perda de progresso.

A explicação em si: nada é guardado no servidor — não existe uma única chamada de rede em `src/`.
Mundos ficam no IndexedDB e opções no `localStorage`, **por origem**, o que inclui a pegadinha de
`localhost:5173` e `192.168.0.16:5173` serem origens diferentes na mesma máquina.

Os bugs, em ordem de gravidade:

1. **Teleporte ao voltar ao mundo.** `trySpawn` segura a simulação até existir chão *e* posiciona
   o jogador, e fazia as duas coisas sempre — inclusive depois de `save.load()` ter devolvido a
   posição. Como ela reposiciona na coluna (0,0), o jogador voltava ao spawn por mais longe que
   tivesse construído.
2. **O autosave de 60 s gravava só os chunks.** Jogador, baús e meta tinham um único caminho: o
   botão "Salvar e sair". Fechar a aba perdia o conteúdo de todo baú.
3. **O registro do banco vencia sempre o de emergência**, mesmo quando o de emergência era mais
   novo — então voltar depois de fechar a aba trazia a posição da saída anterior.
4. **Esconder a aba não gravava nada**, e no celular `visibilitychange` é o único aviso confiável.
5. **Falha ao gravar chunk era silenciosa**: ia para `stats.lastError`, que nada lia.
6. **`requestPersistence()` e `estimate()` nunca tinham sido chamados**, apesar de existirem desde
   o M4 e de o doc 11 §4 pedir os dois.

`trySpawn` saiu do `main.ts` para um módulo próprio: o `main.ts` chama `boot()` no topo, então
nada dentro dele pode ser importado por um teste — e este era exatamente o tipo de regra que
precisava de um.

**Portões:** 945 testes (eram 939), lint limpo, build limpo, bundle 149,0 KB gzip de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/game/spawnplacement.ts` | `trySpawn` com o caminho do save separado, testável fora do `main.ts` |
| `~` | `src/main.ts` | Usa o módulo novo; `persist()` no boot; avisos de cota e de aba anônima ao entrar no mundo; `visibilitychange` grava |
| `~` | `src/game/savegame.ts` | O tick de autosave chama `saveAll()`; liga `manager.onError` ao aviso de HUD |
| `~` | `src/save/savemanager.ts` | `loadPlayer` escolhe o registro mais novo; `onError`/`reportError` propagam falha de chunk; `writeEmergency` carimba `savedAt` |
| `~` | `src/save/db.ts` | `PlayerSave.savedAt`, opcional, para desempatar sem migração |
| `~` | `tests/savegame.test.ts` | 6 testes: autosave completo, registro mais novo vence, erro de gravação chega, e os três de posição preservada ao voltar |
| `~` | `docs/15-status.md` | §2 (métricas), §4 (seis linhas), data |

---

## 2026-09-12 · 10:30 → 10:35 · As três decisões acumuladas

**Pedido:** *"Pode aplicar as suas três sugestões acumuladas"*.

**Resultado:** as três eram número de documento normativo, e por isso estavam esperando. Aplicadas
com o aval do usuário.

1. **T0 com 2 workers** (doc 02 §1 dizia 1). O aparelho de referência roda a 60 FPS gastando
   2,7 ms de 33,3 e gerava o mundo com uma thread só. Medido no pipeline: o anel de RD 4 enche em
   **75 frames em vez de 149**. O corte `min(workers, núcleos − 1)` do `presetFor` continua
   devolvendo 1 no aparelho de 2 núcleos — conferido.
2. **Cap de mobs sem punição dupla** (doc 07 §4). A multiplicação por `chunksCarregados / 289` não
   tinha teto e se somava à redução que `capsForTier` já faz pelo tier: 8 hostis no T0 e 148 no
   T2, este último **acima do teto de 70 mobs vivos do próprio doc 02 §1**. Agora a prontidão
   satura em 1 e mede a área **simulada**, não a de render; ela só reduz enquanto o mundo ainda
   está carregando. Caps efetivos: 20/40/70.
3. **Empuxo do doc 06 §3** passou de `+0.02` para `+0.04`, o valor que o código já usava como
   desvio consciente desde a correção da natação.

**Portões:** 939 testes (eram 938), lint limpo, build limpo, bundle 148,7 KB gzip de 350.

**O que fica pendente:** as três foram medidas **em teste**, nenhuma no aparelho. A confirmação de
campo — a geração acompanhando quem anda, e a caverna com bicho — é o item 1 do §6 do doc 15.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/core/tier.ts` | Preset de T0 com `workers: 2`, com o motivo e a proteção por núcleo no comentário |
| `~` | `src/entity/spawn.ts` | `readiness()` satura em 1 e mede a área simulada; substitui `REFERENCE_CHUNKS` |
| `~` | `tests/spawn.test.ts` | `build()` aceita distância de simulação; o teste de cap passa a exigir o teto do tier, mais um caso de mundo ainda carregando |
| `~` | `docs/02-orcamento-performance.md` | Linha Workers 1 → 2 no §1, com a nota do porquê |
| `~` | `docs/06-jogador-e-fisica.md` | §3 com empuxo `+0.04` e a conta que explica o antigo |
| `~` | `docs/07-mobs-e-ia.md` | §4: a coluna do tier vira o cap efetivo; a prontidão satura em 1, com a medição dos três tiers |
| `~` | `docs/15-status.md` | §2, §3 (M5), §4 (três linhas), §5 e §6, data |

---

## 2026-09-12 · 10:10 → 10:27 · A coluna que faltava e a mão que não parava

**Pedido:** *"Para telas maiores entendo que o menu de receitas poderia ficar na direita, ao lado
do botão não? E todo esse frame mais centralizado e sem desperdício de espaço em branco"* — com
captura da bancada aberta no desktop. E, no meio da sessão: *"ao pressionar o botão direito para
abrir a bancada de trabalho com a mão do personagem vazia, ela fica completamente bugada, se
movimentando rapidamente para frente e para trás"*.

**Resultado:** o layout era desperdício dos dois lados, e o da mão era um bug de interpolação com
causa bem específica.

1. **Painel.** A fileira de 9 slots da mochila é quem manda na largura; a grade 3×3 da bancada,
   empilhada em cima dela, deixava metade da linha vazia — é o branco da captura. E o livro,
   empilhado embaixo, passava da altura da tela. Acima de 900 px o corpo virou duas faixas
   (conteúdo | livro) e a grade deita: o livro ocupa exatamente o vazio que existia, na altura do
   próprio botão "Receitas". Abaixo de 900 px nada muda.
2. **Mão.** `handRenderer.tick()` é quem iguala `previous` a `current`, e a guarda de "tela aberta"
   saía do tick antes dele. Abrir a bancada com a mão vazia é um clique de usar: dispara o golpe e
   abre a tela no mesmo tick, congelando `previous = 0` e `current = SWING_TICKS`. Com os dois
   congelados em pontos opostos, `swingAt(alpha)` vira o próprio `alpha` e a mão completa um golpe
   por frame, para sempre. A correção é de uma linha — continuar chamando `tick(0)` com a tela
   aberta —, mas a máquina de estado saiu para `HandAnimation` porque presa ao renderer ela exigia
   GL e não tinha como ser testada.

**Portões:** 938 testes (eram 935), lint limpo, build limpo, bundle 148,7 KB gzip de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/render/hand.ts` | `HandAnimation` extraída do `HandRenderer` (golpe e balanço, sem GL); `SWING_TICKS` exportado; o renderer delega |
| `~` | `src/main.ts` | A guarda de tela aberta passa a manter `setHeld` + `tick(0)` antes de sair |
| `~` | `src/ui/containers/screen.ts` | `.panel-body`/`.panel-main` no DOM; acima de 900 px o livro vira coluna à direita e a grade deita; `.panel.with-book` alarga só com o livro aberto; `syncBookLayout` |
| `~` | `tests/hand.test.ts` | 3 testes: golpe congelado varre a pose por frame, golpe termina se `tick` for chamado, balanço parado não anda |
| `~` | `docs/15-status.md` | §2 (métricas), §4 (duas linhas), data |

---

## 2026-09-12 · 09:40 → 10:05 · O T0 passou no aceite, e a caverna estava vazia por bug

**Pedido:** *"Voando seguido por 2 minutos não travou nem nada... a geração de mundo está bem
devagar"*, *"mesmo com 15/20 mobs o jogo continuou a 60fps"*, *"alterando a distância de visão
parece que não afeta em nada"*, *"simplesmente não encontro monstros"* e *"se eu construir uma
casa e viajar muuuito longe, ao voltar ela irá permanecer ali correto? Preciso ter total certeza"*.

**Resultado:** o M3 fechou. Voo de 2 min sem travar (a correção do `pump` da sessão anterior
segurou), 15–20 mobs a 60 FPS, chuva e vários biomas sem problema, heap estável. O critério 2 da
definição de pronto foi cumprido com o dobro da folga pedida.

Das quatro dúvidas, duas eram bug e duas eram medida.

1. **Distância de render não fazia nada** — bug confirmado. A opção era lida uma vez no boot e
   `settings.onChange` não a tratava. Agora pipeline, plano distante e névoa acompanham.
2. **Monstro nenhum na caverna** — bug confirmado, e o mais interessante da sessão. `runCycle`
   recebia o Y do jogador com o nome `_playerY` e nunca o usava: o Y saía uniforme da coluna
   inteira, quase todo sorteio caía em pedra maciça e era rejeitado, e a superfície — que sempre
   tem ar — ficava com tudo. Medido com o jogador a 30 de altura: **zero** hostis ao alcance,
   vários 38 blocos acima dele. Com a faixa de ±16 em volta do jogador, todos passam a nascer na
   altura da caverna (o teste de regressão pega 12 fora da faixa no código antigo, 0 agora).
3. **Persistência** — não era bug: **verificado de ponta a ponta**. O teste novo constrói, viaja
   4000 blocos (a coluna sai da memória), volta, e encontra o buraco cavado e o bloco colocado.
   No caminho, um susto meu: a primeira versão do teste falhou porque eu drenava só microtasks e
   `compressChunk` passa por `CompressionStream`, que é stream de verdade e precisa de macrotask.
   O código estava certo; o teste é que estava.
4. **Geração lenta** — não é bug, é o preset: T0 usa **1 worker** num aparelho de 8 núcleos que
   está 84% ocioso. Fica como decisão do usuário no §5 do doc 15, junto com o teto duplo de
   hostis (T0 fica com 8 contra 148 do T2).

**Portões:** 935 testes (eram 930), lint limpo, build limpo, bundle 148,2 KB gzip de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/main.ts` | `applyRenderDistance` liga a opção ao pipeline e ao renderer, e entra em `applyPlayfieldSettings` |
| `~` | `src/world/pipeline.ts` | `setRenderDistance` reenfileira o anel e descarrega o excedente |
| `~` | `src/render/renderer.ts` | `setRenderDistance` junta plano distante e névoa num método só |
| `~` | `src/entity/spawn.ts` | Y de quem nasce no escuro sai de ±`CAVE_Y_SPREAD` em volta do jogador; `playerY` deixa de ser ignorado e chega a `trySpawnPack` |
| `~` | `tests/pipeline.test.ts` | 2 regressões de distância de render (aumentar carrega, diminuir descarrega) |
| `~` | `tests/spawn.test.ts` | Regressão de spawn em caverna, com galeria escavada e o jogador dentro |
| `~` | `tests/savegame.test.ts` | 2 testes de ida e volta na mesma sessão: a construção sobrevive ao descarregamento; coluna intocada não vai para o disco |
| `~` | `docs/15-status.md` | §1 (M3 fechado), §2, §3 (tabela do aceite em campo, teto duplo de hostis), §4 (duas linhas), §5 e §6 |

---

## 2026-09-12 · 09:10 → 09:35 · O T0 chegou, passou com folga, e trouxe três bugs de jogo

**Pedido:** *"Consegui um dispositivo Galaxy J7 Metal... o jogo está funcionando perfeitamente a
60FPS"*, depois *"ao sair voando o jogo simplesmente trava completamente"*, *"nadar na água ainda
está impossível"* e, sobre o inventário, *"a região de Receitas está bem ruim no modo sobrevivência
no celular"* — com foto do overlay no aparelho.

**Resultado:** a pendência que atravessava quatro marcos desde o M3 saiu do papel, e o resultado é
melhor do que o projeto supunha: **T0 real a 60 FPS, render distance 4, escala 1,00, render de
2,7 ms num orçamento de 33,3 ms**, heap em 20 MB e estável. O `detectTier` classificou o aparelho
como T0 sozinho (regra de Mali-T8xx). O risco técnico declarado no PROMPT.md §2 — "performance em
celular fraco" — **não se confirmou**.

O que a sessão achou foi de outra natureza: três bugs de lógica que nenhum teste de FPS pegaria.

1. **A aba travava por completo ao voar.** Não caía de FPS: morria, e só voltava recarregando.
   `dispatchMesh` devolvia o job bloqueado para a mesma `meshQueue` de onde o `pump` acabara de
   tirá-lo, e o `continue` não gastava vaga de `busy`. Com todo job sem vizinho — que é o que voar
   produz, porque a coluna de trás descarrega antes de o meshing sair — o `while` reexaminava o
   mesmo job para sempre. Loop infinito síncrono; por isso nem erro aparecia. Reproduzido em teste
   com `timeout` de shell (o vitest não interrompe laço síncrono): saía 124, agora 0.
2. **Nadar era impossível**, por dois defeitos somados. O empuxo do doc 06 §3 (+0,02/tick) apenas
   cancelava a gravidade dentro d'água, deixando 0,4 blocos/s para subir contra 1,6 para afundar; e
   a sonda de fluido em `floor(y + 0.1)` desligava o empuxo um décimo de bloco abaixo da superfície
   — exatamente o que falta para pisar numa margem no mesmo nível. Subir um bloco caiu de 54 para
   13 ticks; sair para a margem, de impossível para 41.
3. **A tela de receitas/inventário no toque**, três defeitos: duplo clique disparando no slot de
   resultado (craftar em série varria as 64 tábuas guardadas de volta para o cursor), auto-
   preenchimento que enchia a grade sem redesenhar a tela, e nome de receita preso no `title` do
   HTML, que não existe no dedo.

**Um erro meu no caminho, registrado porque custou tempo:** li o `41/88` da foto como pipeline
travado com metade do mundo faltando. Não era — o overlay é que misturava unidades, pondo sections
visíveis sobre colunas carregadas, contra o `C: 81/81 loaded` do doc 02 §6. O anel de RD 4 tem 69
colunas e a histerese segura até 113, então 88 é saudável. Corrigi o overlay: os dois campos agora
são colunas do anel, e `gerando` deixou de estar somado dentro de `meshando`, invisível.

**Portões:** 930 testes (eram 921), lint limpo, build limpo, bundle 148,0 KB gzip de 350.

| | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/world/pipeline.ts` | Job de mesh bloqueado espera em `deferredMeshes` e só volta à fila depois do laço; `scan` limita a uma passada por job; job sem coluna é descartado; `ringProgress` para o overlay |
| `~` | `src/entity/player.ts` | `BUOYANCY` 0,02 → 0,04 (desvio consciente do doc 06 §3, justificado na constante); sonda de fluido `+0.1` → `EPSILON` |
| `~` | `src/ui/containers/screen.ts` | Duplo clique não vale em slot de saída (`isOutputSlot`); `onPick` do livro redesenha a tela; `onHint` liga o tooltip do jogo ao livro; `data-slot` identifica o slot no DOM |
| `~` | `src/ui/containers/recipebook.ts` | `onHint` no lugar do `title` do HTML: `pointerdown` no toque, entrar/sair só no mouse |
| `~` | `src/ui/debug.ts` | Linha `C:` em colunas do anel, com `gerando` separado de `meshando`; sections visíveis foram para a linha `V:` |
| `~` | `src/main.ts` | `updateDebugSource` alimenta os campos novos via `ringProgress`; overlay fechado não recalcula nada por frame |
| `+` | `tests/recipebookui.test.ts` | 4 testes: tooltip no toque, redesenho após auto-preenchimento, duplo clique no slot de resultado, e o gesto de juntar preservado em slot comum |
| `~` | `tests/physics.test.ts` | 3 regressões de natação vertical: subir um bloco, sair para a margem, afundar não mais rápido que subir |
| `~` | `tests/pipeline.test.ts` | 2 regressões: `pump()` retorna com fila toda bloqueada; job de coluna descarregada é descartado |
| `~` | `docs/15-status.md` | §1, §2 (métricas do T0), §3 (M3 com a leitura do overlay, M4 e M5), §4 (seis linhas), §5 e §6 reescritos, data |
| `~` | `README.md` | Contagem de testes, bundle e a linha do T0 |

---

## 2026-09-11 · 12:00 → 12:15 · O painel que eu quebrei, e a escala que nunca funcionou

**Pedido:** *"O inventário ficou quebrado como você pode observar, está extrapolando o tamanho.
Outra coisa que notei é que a opção de escala da interface começa em automático e a próxima opção
já é 1x, não me possibilitando diminuir mais a interface caso desejado."* — com captura de tela.

**Resultado:** dois defeitos, e o primeiro é meu, de algumas horas antes.

**O vazamento é regressão da correção de layout desta mesma sessão.** Para caber no celular deitado
eu pus `columns:2` do CSS. O multi-coluna reparte a largura em partes **iguais**, e a fileira de 9
slots da mochila é mais larga que metade do painel — ela transbordava pela borda, exatamente o que
a captura mostra. Agora as colunas são contêineres no DOM com `flex-wrap`: cada uma toma a largura
de que precisa, e quando as duas são largas (baú) elas empilham em vez de vazar. Verificado a
740×340: slot mais à direita em **668**, borda do painel em **680**.

**A segunda queixa escondia um defeito maior que o relatado.** A granularidade era mesmo grossa —
com passo 1, o vizinho de "automática" era 1×, sem meio-termo num aparelho cuja automática já é 2×.
Mas ao testar apareceu o problema de verdade: **a opção nunca foi aplicada ao vivo**. `updateScale`
só rodava no boot e no `resize` da janela, então mexer no slider trocava o rótulo e não mudava nada
na tela. Quem tentou diminuir a interface e concluiu que não dava tinha razão pelo motivo errado.

**921 testes** (eram 916, 56 arquivos), bundle 147,7 KB gzip, lint limpo, build e orçamento verdes.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/containers/screen.ts` | `build` monta `.grid-col` estreita e larga; `addSection` escreve na coluna atual, e a mochila mais a hotbar vão para a larga. O CSS da tela baixa virou `flex-flow:row wrap` com `align-items:flex-start` |
| `~` | `src/ui/hud.ts` | O HUD assina `settings.onChange` para recalcular a escala |
| `~` | `src/ui/screens/options.ts` | Passo do slider de escala em 0,5, com rótulo em vírgula ("0,5×") |
| `~` | `tests/uxpolish.test.ts` | Quatro regressões: nada de multi-coluna do CSS, a coluna larga recebe a mochila, o passo é 0,5 e a escala assina as opções |
| `~` | `tests/creativeui.test.ts` | O painel monta duas colunas, com Equipamento na estreita e Inventário na larga |
| `~` | `docs/08-interface-ui.md` | §6 com o porquê de contêiner em vez de multi-coluna, e o passo de meio |
| `~` | `docs/15-status.md` | Métricas e duas linhas no §4 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

---

## 2026-09-11 · 11:45 → 11:55 · O nome do item, sem mouse

**Pedido:** *"Na versão de desktop, ao colocar o mouse em cima de um item que fico na dúvida do que
realmente se trata, ele aparece o tooltip informando o nome do item. O problema é que na versão
mobile, ao clicar em cima do item no modo criativo por exemplo ele já traz o item para a minha
barra de seleção, não me informa qual o nome do item nem mesmo segurando em cima do item talvez.
Existe alguma forma de contornar isso? Não quebrando nenhuma funcionalidade já existente."*

**Resultado:** existia, e a saída é o vocabulário que o jogo já usa no mundo — segurar o dedo, com
o mesmo `longPressMs` das opções. Os slots da paleta tinham `el.title`, que só existe para mouse e
leitor de tela, e um `click` que dava o item na hora.

A restrição do pedido — não quebrar nada — decidiu o desenho nas duas telas:

- **Paleta criativa:** o `click` é quem age, então dá para cancelar. O guarda do toque longo é
  registrado **antes** do ouvinte de ação (ouvintes do mesmo elemento rodam na ordem de registro) e
  engole o clique com `stopImmediatePropagation`. Toque curto: igual ao que sempre foi.
- **Tela de container:** a ação resolve no `pointerdown`, e é disso que depende o arraste de
  distribuição entre slots. Cancelar ali quebraria o arraste, então o rótulo aparece **junto** com
  a ação em vez de no lugar dela — no inventário o item já é seu, saber depois basta.

**Verificado no celular emulado (640×360, ponteiro grosso):** toque de 80 ms põe "Minério de
Diamante" na hotbar; toque de 700 ms mostra "Minério de Esmeralda" e a hotbar não muda.

**916 testes** (eram 910, 56 arquivos), bundle 147,6 KB gzip (era 147,1), lint limpo, build e
orçamento verdes.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/ui/containers/tooltip.ts` | `ItemTooltip`: `show`/`flash`/`hide`/`position` e `bindLongPress`. O `flash` existe porque o toque não tem "sair de cima" — sem prazo, o rótulo ficaria na tela até o toque seguinte. Escorregar mais de 12 px cancela: é rolagem, não consulta. Mouse nunca entra no caminho do toque longo, porque ali segurar é arraste de pilha |
| `~` | `src/ui/containers/creative.ts` | Usa o `ItemTooltip`; `bindLongPress` antes do `click`, e `longPressMs` entra por callback (a tela não tem `SettingsStore`) |
| `~` | `src/ui/containers/screen.ts` | O tooltip inline virou `ItemTooltip`; `showTooltip` virou `describeSlot`, que devolve o texto e serve aos dois caminhos. Hover continua só para mouse; no toque o `pointerdown` faz `flash` |
| `~` | `src/main.ts` | Passa `longPressMs` para a paleta |
| `~` | `tests/creativeui.test.ts` | Seis regressões: segurar mostra o nome, segurar **não** dá o item, o toque curto **continua** dando (com asserção de que a hotbar começa vazia, senão o teste passaria mesmo quebrado), o rótulo some sozinho, o mouse não dispara, e escorregar cancela. O stub de DOM ganhou `stopImmediatePropagation` no `dispatch` |
| `~` | `docs/08-interface-ui.md` | §3.5 com a regra e o porquê da diferença entre as duas telas |
| `~` | `docs/15-status.md` | Métricas e a linha no §4 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

---

## 2026-09-11 · 10:45 → 11:45 · Os sete pontos da navegada geral

**Pedido:** *"Dê uma navegada geral no jogo, jogue um pouco, e verifique se existe melhorias a
serem feitas para deixar o jogo mais intuitivo, mais fluido, melhor."* — e, sobre o relatório,
*"Pode atacar todos os 7 pontos levantados por você."*

**Como foi levantado:** mundo novo e mundo salvo, sobrevivência, desktop e celular emulado
(640×360, ponteiro grosso). O jogo foi dirigido por DOM e por eventos de entrada via CDP, com
medição de geometria em vez de impressão — todos os números abaixo saíram do jogo rodando.

**Resultado:** os sete corrigidos e verificados no jogo. **910 testes** (eram 881, 56 arquivos),
bundle 147,1 KB gzip (era 144,8), lint limpo, build e orçamento verdes.

| # | Queixa | Antes → depois, medido |
|---|---|---|
| 1 | Interface grande demais no celular | painel do inventário **600×755 px numa tela de 360** → **626×247, cabe** |
| 2 | Livro de receitas nascia vazio | **0 receitas** com mochila vazia → **10** |
| 3 | Conquistas não guiavam | 18 linhas de "???" → revela um passo à frente |
| 4 | Botão de voar morto no sobrevivência | sempre visível → só no criativo |
| 5 | Botão de pular cobria a barra de fome | sobreposição de 25×21 px → nenhuma |
| 6 | Faltavam opções de conforto e a acessibilidade inteira | +FOV, +Brilho, +Pulo automático, +seção Acessibilidade |
| 7 | Nada dizia o que fazer | nenhuma direção → linha de objetivo no HUD |

### 1 — Escala da interface e layout do painel

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/hud.ts` | `autoGuiScale` com piso de **2** no ponteiro grosso, era 3. O cálculo honesto dá 1 em todo celular; o piso de 3 entregava a escala de um desktop de 1280×800. Os 44 px de alvo continuam garantidos onde importam: no `min-width`/`min-height` de `#touch .tbtn` |
| `~` | `src/ui/containers/screen.ts` | Cada seção do painel virou um bloco `.section`, e abaixo de 560 px de altura em paisagem elas fluem em **duas colunas** (`columns:2`, não grid — o grid forçava linhas compartilhadas e deixava a fileira de equipamento num vão da altura da mochila). O botão "Receitas" saiu do `float:right`, que em tela estreita caía sobre o primeiro slot, para um cabeçalho flex |

### 2 — Livro de receitas

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/containers/recipebook.ts` | Filtro "só o que dá" nasce **desligado**; duas passadas de renderização põem o possível na frente e o resto em cinza (o `.recipe.missing` já existia). Mensagem de vazio agora explica o filtro |

### 3 e 7 — A árvore de conquistas vira direção

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/data/achievements.ts` | `objectiveFor`, `isUnlocked` e `nextObjective`. O texto sai do gatilho e do alvo, então conteúdo novo já entra com objetivo pronto; quem resolve o nome legível é quem chama, para a tabela não depender das outras |
| `~` | `src/ui/screens/pause.ts` | A lista revela um passo à frente: sem `parent`, ou com o `parent` obtido, mostra nome e objetivo. O dado já tinha `parent` com um comentário dizendo que ele *"serve para a tela mostrar o caminho"* — a tela ignorava |
| `~` | `src/ui/hud.ts` | Linha de objetivo no canto superior esquerdo, com `setObjective` |
| `~` | `src/main.ts` | `refreshObjective` na entrada e a cada conquista obtida |

### 4, 5 e 6 — Toque, opções e acessibilidade

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/player.ts` | `autoJump` e `shouldAutoJump`: sonda o degrau à frente com AABB pré-alocada (`STEP_PROBE`), sobe um bloco, nunca dois, e nunca parado |
| `~` | `src/game/settings.ts` | `autoJump`, `fov`, `brightness`, `highContrast`, `textScale`, `damageFlash`; `touchDefaults()` liga o auto-pulo só no ponteiro grosso, e o `reset` respeita o aparelho |
| `~` | `src/ui/screens/options.ts` | Campo de visão e Brilho em Vídeo, Pulo automático em Controles, e a seção **Acessibilidade** |
| `~` | `src/ui/touchui.ts` | Botão de voar nasce escondido, `setCreative` o revela; `setVisible` publica `--touch-pad` com a largura dos pads |
| `~` | `src/ui/hud.ts` | `applyAccessibility` (alto contraste, tamanho de texto), `flashDamage` com vinheta de 350 ms respeitando `prefers-reduced-motion`, e a barra descontando `--touch-pad` dos dois lados |
| `~` | `src/render/renderer.ts` | `minSkyLight` exposto e reaplicado a cada frame, para o controle de Brilho |
| `~` | `src/main.ts` | `applyPlayfieldSettings` liga FOV, brilho, auto-pulo e acessibilidade; `onHurt` aciona o clarão; `setCreative` no boot |

### Testes e documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/uxpolish.test.ts` | 24 regressões: escala em quatro tamanhos de celular e dois de desktop; a árvore de conquistas revelando e esgotando; o auto-pulo subindo um bloco, **não** subindo dois, e não pulando parado; e as fontes do livro, do botão de voo e da reserva do HUD |
| `~` | `tests/settings.test.ts` | Padrão do auto-pulo por aparelho, a escolha do jogador vencendo o padrão, faixas de FOV e brilho, e o `reset` respeitando o aparelho |
| `~` | `docs/08-interface-ui.md` | §6 com a separação entre escala de GUI e alvo de toque, o painel em duas colunas, a linha de objetivo e a revelação das conquistas; §3.5 com o filtro do livro |
| `~` | `docs/09-controles-mobile.md` | Seção com auto-pulo, botão de voo só no criativo e a reserva do HUD |
| `~` | `docs/15-status.md` | Métricas, oito linhas no §4 e o que ficou de fora no §6 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

**Do ponto 6, ficou de fora de propósito** (registrado no §6 do doc 15): remapeamento de teclas, e
os sliders de som por categoria — este último precisa de categoria no `audio/engine.ts` antes de a
tela poder oferecer. Fazer metade dos dois seria pior que deixar registrado.

**Duas coisas investigadas e descartadas, para ninguém refazer:** a luz do céu desce corretamente
um poço recém-cavado (medido: 15 nos dez blocos — o escuro é oclusão de ambiente num poço 1×1), e
o livro esconder receitas 3×3 na grade 2×2 é o comportamento certo.

---

## 2026-09-11 · 10:30 → 10:40 · Finalmente dá para vestir armadura

**Pedido:** *"Faz sim"* — sobre o achado da sessão anterior: nenhuma tela desenhava os slots de
armadura.

**Resultado:** os 4 slots de armadura e o offhand existiam em `game/inventory.ts` desde o M5 —
`canPlaceIn` valida que cada slot só aceita a peça do lugar certo, `shiftMove` equipa direto, e
`game/combat.ts` soma a defesa. Só a interface faltava: `build()` montava, para `inventory`,
apenas a grade 2×2, o resultado, a mochila e a hotbar. Na prática **não havia como vestir armadura
à mão em nenhum modo**, e a correção de 2026-09-10 (botão "Mochila e armadura" na paleta criativa)
apontava justamente para essa tela — a queixa daquele dia nunca tinha sido resolvida de verdade.

A tela agora abre com a seção **Equipamento** e fecha os 46 slots que o doc 08 §3.5 especifica:
5 equipamento + 4 criação + 1 resultado + 27 mochila + 9 hotbar. Slot vazio mostra o nome da peça
(Elmo, Peito, Calça, Bota, Mão) em cinza apagado — sem ícone fantasma no atlas, é o que diz ao
jogador o que vai ali, e some assim que a peça entra.

Verificado no navegador com o jogo rodando: seções `["Equipamento","Criação","Inventário"]`,
**46 slots**, fantasmas `["Elmo","Peito","Calça","Bota","Mão"]`.

**881 testes** (eram 877, 55 arquivos), bundle 144,8 KB gzip (era 144,5), lint limpo, build e
orçamento verdes.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/containers/screen.ts` | Seção "Equipamento" na tela de inventário; `SlotView.placeholder` e `makeSlot(..., placeholder)` para o rótulo do slot vazio; `addSection` aceita um rótulo por slot; `renderSlot` repõe o rótulo ao esvaziar e tira ao encher; CSS `.slot.ghost span` |
| `~` | `tests/creativeui.test.ts` | Bloco `a mochila mostra armadura e mão secundária`: os cinco slots aparecem, a tela tem 46 slots, o rótulo some quando a peça entra, e **shift+clique num capacete equipa no slot do elmo** — o caminho inteiro, do `pointerdown` com `shiftKey` até o `shiftMove`. O stub de DOM ganhou `classList` funcional (`add`/`remove`/`toggle`/`contains`), `style.removeProperty` e `dispatch` com carga |
| `~` | `docs/15-status.md` | Métricas, a linha no §4, pendência dos slots fechada no §6 e o boneco 3D registrado no lugar dela |
| `~` | `docs/16-auditoria.md` | Esta sessão |

**Pendência criada:** o doc 08 §3.5 desenha um **boneco 3D do jogador** ao lado dos slots de
armadura, e ele nunca foi feito — hoje a seção Equipamento é só a fila de slots. O próprio doc já
prevê sprite estático como saída para T0. Está no §6 do doc 15.

---

## 2026-09-11 · 10:15 → 10:25 · A janela que não fechava

**Pedido:** *"Ainda temos o problema de no criativo, ao abrir a parte de inventário não existe um
botão para fechar a janela aberta de 'Mochila'."*

**Resultado:** a queixa chegou pelo criativo, mas o alcance é maior. O overlay `#container-screen`
é `z-index:12` e o HUD de toque é `z-index:6`, com `inset:0` e sem `pointer-events:none` — então
com **qualquer** container aberto (baú, fornalha, bancada, mochila, nos dois modos) o botão de
inventário e o de pausa ficam cobertos. Clicar fora do painel só devolve o item do cursor
(doc 08 §3.5), não fecha. `Esc` e `E` resolviam no teclado; **num aparelho sem teclado a janela
prendia o jogador** — e o celular é o alvo declarado do projeto.

O painel ganhou rodapé com "Fechar", alvo de toque de 44 px como manda o doc 09, igual ao que a
paleta criativa já tinha. Verificado no navegador: a tela lista `["Receitas","Fechar"]` e o clique
fecha de verdade.

Junto, um segundo defeito no mesmo caminho: no criativo, `E` com a mochila aberta abria a paleta
**por cima** dela, em vez de fechar uma camada por vez como o `Esc` faz (doc 08 §4.1).

**877 testes** (eram 871, 55 arquivos), bundle 144,5 KB gzip (era 144,4), lint limpo, build e
orçamento verdes.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/containers/screen.ts` | Rodapé com botão "Fechar" em todo painel, e o CSS `.close` com `min-height:44px`. O comentário do módulo registra por que ele é necessário: o HUD fica coberto pelo overlay |
| `~` | `src/main.ts` | `toggleInventory` no criativo fecha a mochila se ela estiver aberta, em vez de empilhar a paleta por cima |
| `~` | `tests/creativeui.test.ts` | Bloco `toda tela de container fecha sem teclado`: as quatro telas têm o botão, o botão fecha e avisa quem devolve o pointer lock, e o alvo de toque tem 44 px. O stub de DOM ganhou `style.setProperty` e um `window` mínimo |
| `~` | `docs/15-status.md` | Métricas, a linha no §4 e os slots de armadura no §6 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

**Achado grave, não corrigido (decisão do usuário):** **não há como vestir armadura à mão em
nenhum modo.** `ARMOR_START` e `OFFHAND` existem em `game/inventory.ts`, `game/combat.ts` soma a
defesa e `game/session.ts` sincroniza — mas `grep -rn 'ARMOR_START|OFFHAND' src/ui/` não devolve
nada: `build()` monta, para `inventory`, só a grade 2×2, o resultado, a mochila e a hotbar. A
correção de 2026-09-10 pôs um botão "Mochila e armadura" na paleta criativa que leva a uma tela
onde a armadura não aparece — a queixa original daquele dia continua de pé. Registrado no §6 do
doc 15.

---

## 2026-09-11 · 09:45 → 10:10 · Baú deixou de ser tábua mais escura

**Pedido:** *"As texturas do jogo estão bem ruins, vários itens estão com texturas extremamente
semelhantes... Só consigo diferenciar colocando o mouse ou clicando em cima para ver o nome do
item. Quero confirmar com você se isso é completamente proposital, para rodar em dispositivos
fracos, ou se foi só um caminho mais fácil que você seguiu."* — e, depois da confirmação,
*"Quero que você faça esses ajustes nas texturas sim, só se isso não for impactar em nada na
performance geral do sistema."*

**Resultado:** confirmado que **não era decisão de performance**. O orçamento do doc 02 §3 reserva
~0,2 MB para o array de texturas inteiro dentro de um alvo de 350 MB, e cada textura nova custa
1 KB. Os blocos construídos eram `inherit` do material de origem com `tintBy(0.9x)` — e cama, TNT
e porta apontavam para **a mesma camada do atlas** que lã e tábuas, diferença zero por construção.

Medida usada: diferença média por pixel em [0, 255], com tábuas de carvalho × tábuas de bétula
(= 48) como régua do que é legível.

| Par | Antes | Depois |
|---|---|---|
| Tábuas × Baú (topo) | 8,6 | **38,3** |
| Tábuas × Bancada (topo) | 9,8 | **28,9** |
| Pedregulho × Fornalha | 9,5 | **29,2** |
| Tábuas × Bancada (lado) | 11,6 | **34,2** |
| Tábuas × Estante | 13,8 | **38,2** |
| Baú × Bancada (lado) | 15,8 | **35,9** |
| Tábuas × Baú (lado) | 19,5 | **37,9** |
| Tábuas × Porta | **0,0** | **28,4** |
| Tábuas × TNT (lado) | **0,0** | **47,8** |
| Lã branca × Cama (topo) | **0,0** | **119,8** |

**Custo, que era a condição do pedido:** +6 camadas de atlas (121 → 127), +6 KB de VRAM, +0,7 ms
na geração no boot (4,7 → 5,4 ms, uma vez). Em tempo de execução, nada: geração de chunk 5,68
ms/chunk e meshing 0,64 ms/section, dentro da variação normal entre rodadas. O número de camadas
não afeta o custo por frame — continua sendo um `TEXTURE_2D_ARRAY` e uma draw call por section.

**871 testes** (eram 859, 55 arquivos), bundle 144,4 KB gzip (era 142,9), lint limpo, build e
orçamento verdes.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/render/texgen.ts` | Operadores `rect` e `outline` — a primitiva de forma que o doc 13 §2.4 pedia e não existia. Antes, o único bloco com estrutura de verdade (a boca da fornalha) carregava um closure solto dentro da receita |
| `~` | `src/data/textures.ts` | Baú com ferragem e fechadura; bancada com tampo, gaveta e ferramentas; fornalha com moldura de ferro; estante com lombadas grossas sobre fundo escuro (eram 1 px a cada 2 e sumiam). Novas: `tnt_side`/`tnt_top`/`tnt_bottom`, `bed_top`/`bed_side`, `oak_door`. Auxiliar `shelfBooks` no lugar do closure da estante |
| `~` | `src/data/blocks.ts` | TNT, cama e porta apontam para as texturas próprias, não mais para `oak_planks` e `wool_white` |
| `~` | `tests/texgen.test.ts` | Bloco `legibilidade das texturas`: 10 pares contra o piso de 22, a régua carvalho × bétula, e a regra de que nenhuma **face visível** de bloco construído pode ser a camada crua de outro bloco (a de baixo fica de fora — o fundo da bancada é tábua mesmo) |
| `~` | `docs/13-assets-e-arte.md` | §2.2: legibilidade virou requisito escrito, com o critério numérico e o piso de 22 |
| `~` | `docs/15-status.md` | Métricas, a linha no §4 e o teto de camadas do doc 02 no §6 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

**Pendência criada:** o atlas está em **127 de 128 camadas**, o teto escrito no doc 02 §3 — a
próxima textura estoura a linha. A linha vale 0,13 MB e o GLES 3.0 garante ao menos 256 camadas
em qualquer aparelho, então é decisão de doc, não limite de hardware. Está no §6 do doc 15.

---

## 2026-09-11 · 08:55 → 09:35 · A noite ganhou monstros, e o Difícil ficou difícil

**Pedido:** *"o jogo já possui monstros? Por que não encontrei... Mesmo jogando no sobrevivência e
deixando de noite"* — seguido de *"aumentando a dificuldade do jogo, essa taxa de spawn aumenta
correto?"*, depois *"1. Pode fazer. 2. Pode fazer. 3. Pode fazer."* e, sobre os caps de T0,
*"pode manter o que já foi implementado no código e atualizar o DOC somente"*.

**Resultado:** os monstros existiam e nasciam — o spawn até saturava o cap — mas **nenhum chegava
perto do jogador**. Medindo o spawner contra um mundo gerado de verdade: de 151 hostis vivos,
**zero** dentro dos 16 blocos do `followRange`, distância média 74 blocos, e apenas 16 de 151 na
superfície. Três minutos andando de noite davam **0 encontros**. Depois da correção: **~20
encontros** nos mesmos 3 minutos e 149 de 154 na superfície.

A investigação mostrou que o comportamento era **fiel ao doc 07 §4** — não era bug de
implementação, era a especificação. O doc foi corrigido junto, com o motivo escrito nele. Já as
duas promessas do Difícil no doc 06 §10 (creeper com raio maior, zumbi arrombando porta) **nunca
tinham sido implementadas** e não estavam registradas como pendência em lugar nenhum.

**859 testes** (eram 853, 55 arquivos), bundle 142,9 KB gzip (era 142,5), lint limpo, build e
orçamento verdes.

### Spawn noturno

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/spawn.ts` | `MIN_CHUNK_DISTANCE = 1` (era 2 fixo): reabre a faixa de 24–32 blocos, que o despawn suave não alcança. `NIGHT_SURFACE_CHANCE = 0.6`: de noite, 60% dos hostis nascem na superfície em vez de num Y uniforme até ela. `isValidSpot` passou a medir do **centro** do bloco, que é onde o mob de fato nasce — o piso de 24 blocos vazava meio bloco |
| `~` | `docs/07-mobs-e-ia.md` | §4 passos 3 e 4 reescritos, com dois blocos de citação explicando por que a distância mínima caiu para 1 chunk e por que existe viés de superfície à noite — os números medidos ficaram no doc |
| `~` | `tests/spawn.test.ts` | Duas regressões: a maioria dos hostis noturnos nasce acima do chão; o spawn chega a acontecer dentro dos 32 blocos sem violar o piso de 24. O harness ganhou `onBreakBlock` |

### Difícil: creeper e porta

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/mobs.ts` | `CREEPER_POWER` / `CREEPER_POWER_HARD`: força 4 no Difícil (raio 5,2 contra 3,9). `MobEvents.onBreakBlock` e a ação `breakBlock` no contexto de IA |
| `~` | `src/data/mobs.ts` | `GoalName` ganhou `breakDoor`; o zumbi saiu de `HOSTILE_GOALS` para `ZOMBIE_GOALS`, com `breakDoor` entre atacar e perseguir |
| `~` | `src/entity/ai/goals.ts` | Goal `breakDoor` e o auxiliar `doorInFront`, com a posição em `Int32Array` pré-alocado. Tempo derivado da dureza (80 ticks por ponto → 12 s numa porta de carvalho), não de constante mágica |
| `~` | `src/entity/mobstore.ts` | Campo `breakTicks`, zerado no spawn e copiado no swap-remove |
| `~` | `src/game/session.ts` | `breakBlockByMob`: remove o voxel por `setBlock`, atualiza luz e fluidos, toca o som de quebra do material e **não** dropa item |
| `~` | `tests/mobs.test.ts` | Força da explosão por dificuldade (3/3/4); o zumbi só pede a porta no Difícil. Harness com `broken` e `onBreakBlock` |
| `~` | `tests/nightlife.test.ts` | A porta arrombada some do mundo e não vira item |
| `~` | `tests/breeding.test.ts` | Stubs de `MobEvents` com `onBreakBlock` |

### Caps por tier: o doc cedeu ao código

A tabela do doc 07 §4 dava números à mão para T0 (passivo 8, aquático 3, ambiente 0) que
`capsForTier` nunca implementou — ela deriva tudo de `maxMobs / 70`, o que em T0 dá 4, 1 e 2.
Decisão do usuário: manter o código e corrigir o doc.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/07-mobs-e-ia.md` | A tabela de caps passou a ter as três colunas de tier com os valores reais, mais o parágrafo explicando por que a escala é proporcional em vez de tabelada, e a nota de que o cap ainda é multiplicado por `chunksCarregados / 289` |
| `~` | `src/entity/spawn.ts` | Cabeçalho do módulo diz que a proporção por tier é deliberada, para não virar mais uma tabela fora de sincronia com `core/tier.ts` |
| `~` | `tests/spawn.test.ts` | Os três tiers com `toEqual` e números exatos, no lugar dos limites frouxos (`<= 8`, `<= 3`) que passavam com qualquer fórmula — agora mexer na fórmula quebra o teste e obriga a mexer no doc |

### Documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/15-status.md` | Métricas (859 testes, 142,9 KB), cinco linhas novas no §4, e o morcego que falta registrado no §6 |
| `~` | `docs/16-auditoria.md` | Esta sessão |

**Achado sem dono:** **não existe nenhum mob de categoria `ambient`** no código — o morcego que o
doc 07 §4 lista com cap próprio nunca foi implementado. É a única linha da tabela de spawn sem
nada atrás dela. Registrado no §6 do doc 15.

---

## 2026-09-10 · 22:20 → 22:50 · Item na mão, rolagem das janelas e precache do PWA

**Pedido:** *"pode implementar o item 5 então"* — mais a queixa de que a janela do inventário não
rola no celular como o menu criativo, e a dúvida sobre acesso offline depois de instalar o PWA.

**Resultado:** `render/hand.ts` entregue (o módulo que o doc 01 previa desde sempre e nunca tinha
sido escrito), rolagem corrigida nas duas janelas, e o precache do service worker passou a incluir
o bundle — sem isso, "instalei o PWA" não significava "funciona offline". **853 testes** (eram
841, 55 arquivos), bundle 142,5 KB gzip (era 139,6), lint limpo, build e orçamento verdes.

A mão foi verificada na tela, nos três modos: cubo de bloco, sprite de item e braço vazio. A
primeira versão desenhava **fora do frustum** — nenhum erro, nenhum log, simplesmente invisível —
e foi isso que virou o teste de pose.

### Item na mão

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/render/hand.ts` | Passe da mão: uma draw call, profundidade limpa, FOV próprio de 55°; três formas num programa (`uMode`); geometria reconstruída só quando o item muda; `handPose` pura, ancorada nas bordas do frustum |
| `~` | `src/render/renderer.ts` | `handRenderer` e `handLight`; o passe entrou no lugar do comentário `// 6. item na mão — M4.` |
| `~` | `src/main.ts` | Cria o `HandRenderer`, liga a opção, alimenta item/balanço/passo no tick e a luz do olho no render |
| `~` | `src/game/settings.ts` | `handItem`, ligado por padrão |
| `~` | `src/ui/screens/options.ts` | Alternador "Item na mão" em Vídeo |
| `+` | `tests/hand.test.ts` | Pose dentro do frustum de 0,46 a 3,2 de aspecto em todo ponto do golpe; canto inferior direito; golpe começa e termina igual; passo é sutil perto do golpe |

### Rolagem das janelas

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/containers/screen.ts` | Raiz com `touch-action:pan-y` (era `none`, que desliga a rolagem por toque) e `place-items:safe center`; `touch-action:none` desceu para o slot, que é quem precisa |
| `~` | `src/ui/containers/creative.ts` | `place-items:safe center` e `overscroll-behavior:contain` |
| `~` | `tests/creativeui.test.ts` | Quatro casos sobre as regras de CSS, na mesma linha do que `uihidden.test.ts` já faz com o `index.html` |

### PWA offline

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `public/sw.js` | `SHELL` passou a incluir `__CRAFTLITE_ASSETS__`; `install` guarda item a item em vez de `addAll`, que falha inteiro se um item falhar |
| `~` | `vite.config.ts` | `closeBundle` varre o `dist/` e injeta a lista de arquivos emitidos no service worker |

### Documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/15-status.md` | Seção nova no §3 para o item na mão; duas linhas no §4; a mão saiu das pendências do §6; métricas e data |
| `~` | `README.md` | 841 → 853 testes; 139 → 142 KB |

---

## 2026-09-10 · 21:30 → 22:20 · Nove queixas do primeiro teste em celular real

**Pedido:** *"Notei alguns problemas que precisamos corrigir"* — nove itens vindos de uma sessão de
jogo num S24 Ultra: controle de toque quebrando ao colocar bloco, rachadura invisível, inventário
criativo sem armadura, nadar lento, item na mão ausente, mob sem tomar dano, dúvida sobre
ferramentas, textura piscando e o teclado virtual subindo sozinho.

**Resultado:** sete viraram correção de código, uma virou resposta com números (ferramentas) e uma
virou pendência registrada (item na mão, doc 01 §191, nunca implementado). **841 testes** (eram
821, 54 arquivos), bundle 139,6 KB gzip (era 139,2), lint limpo, build e orçamento verdes.

O achado principal é de uma linha só: `canvas.addEventListener('click', () => requestPointerLock())`
não olhava de onde vinha o clique. Um toque curto e parado — que é exatamente o gesto de colocar
bloco no Modo A — também dispara `click`, e com pointer lock ativo a spec **congela
`clientX`/`clientY`**. Todo dedo passava a reportar o mesmo ponto: joystick no canto, jogador
parado, nada mais colocando bloco. Explica sozinho os três sintomas relatados, inclusive o de só
voltar ao normal depois da pausa (que solta o lock) e o de não acontecer no Modo B (onde colocar é
botão de DOM).

### Correções

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/input/controls.ts` | Só `pointerType === 'mouse'` (e o clique sintético de teclado) pede pointer lock; `isMouseClick` isola a decisão |
| `~` | `src/input/touch.ts` | `reset()` zera origem do joystick, mira e pedido de colocar — um joystick meio-preso ressuscitava no canto ao voltar da pausa |
| `~` | `src/entity/player.ts` | Nadar: o arrasto do fluido **substitui** o atrito do ar em vez de multiplicar com ele, e a aceleração dentro d'água é a do ar mesmo pisando no fundo. De 0,58 para 1,96 blocos/s |
| `~` | `src/main.ts` | Ataque a mob deixou de exigir sobrevivência; brilho do bloco mirado alimenta a cor da rachadura; `onOpenInventory` liga a paleta criativa à mochila |
| `~` | `src/game/session.ts` | `CREATIVE_ATTACK_DAMAGE`: no criativo o golpe mata de uma vez |
| `~` | `src/render/selection.ts` | Passe da rachadura em alpha blend com cor vinda de fora; `crackToneFor` decide claro/escuro pelo brilho do bloco |
| `~` | `src/render/shaders/overlay.glsl.ts` | Fragment da rachadura (300 e 100) usa o canal vermelho como máscara e `uCrackColor` como tom |
| `~` | `src/render/renderer.ts` | `HighlightState.brightness`, repassado ao `drawCrack` |
| `~` | `src/render/dynamicscale.ts` | Anti-oscilação: subir exige 40% de folga (era 20%) e a escala que falhou fica proibida por um tempo que dobra a cada queda |
| `~` | `src/ui/containers/creative.ts` | Botão "Mochila e armadura"; foco na busca só fora de ponteiro grosso |

### Testes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/creativeui.test.ts` | Stub de DOM mínimo; cobre o botão da mochila e o foco da busca por tipo de ponteiro |
| `~` | `tests/input.test.ts` | Quatro casos de pointer lock por `pointerType` (toque, caneta, mouse, teclado) |
| `~` | `tests/physics.test.ts` | Velocidade de nado medida por deslocamento, a mesma régua da caminhada; e o caso de pisar no fundo |
| `~` | `tests/session.test.ts` | Golpe no criativo mata de uma vez; no sobrevivência continua levando vários |
| `~` | `tests/dynamicscale.test.ts` | Não sobe logo após cair, tenta de novo depois do recuo, e o recuo dobra até parar de tentar |
| `~` | `tests/cracks.test.ts` | `crackToneFor` dá contraste nos dois extremos de brilho |

### Documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/15-status.md` | Oito linhas no §4; §3 do M3 separa "ergonomia validada em celular atual" de "T0 não medido"; §5 e §6 idem; métricas e data |
| `~` | `README.md` | 821 → 841 testes |

### Respondido sem mexer em código

- **Ferramentas funcionam**, com números: tronco 3,00 s na mão e 0,40 s com machado de diamante;
  pedra 7,50 s na mão e 0,30 s com picareta de diamante; e ferramenta errada não ajuda (machado em
  pedra = 7,50 s). Durabilidade existe e gasta ao quebrar e ao acertar — 59 na picareta de madeira,
  1561 na de diamante.
- **Item na mão em primeira pessoa não existe** e não é decisão de performance: o doc 01 prevê
  `render/hand.ts` e o passe nunca foi escrito. Registrado no §6 do doc 15.

---

## 2026-09-10 · 17:00 → 17:40 · M6 concluído: blocos de construção, estruturas, clima, equipamento e conquistas

**Pedido:** *"Pode seguir com o desenvolvimento do M6 até finalizá-lo. A pendência do aparelho real
infelizmente vai ficar para um próximo momento."*

**Resultado:** os cinco itens que faltavam no checklist do M6 (doc 14) entregues — **o marco está
fechado**. 821 testes (eram 753), bundle 139,2 KB gzip (era 126,5), lint limpo, build e orçamento de
tamanho verdes. Geração de chunk em 6,03 ms mesmo com estruturas, meshing em 0,64 ms.

Três decisões de arquitetura, detalhadas no §3 do doc 15: forma não-cubo é **lista de caixas**
compartilhada entre desenho e colisão; estrutura é **lista de peças**, não array de voxels; clima é
**função pura da seed e do dia**, sem estado no save.

Três achados do caminho, no §4 do doc 15: **comer nunca funcionava** (o progresso era zerado no
mesmo tick em que começava), laje e escada colidiam como bloco inteiro, e a mesa de encantamento já
tinha corrigido a XP fixa da fornalha na sessão anterior.

### Geometria de forma e blocos de construção

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/mesh/shapes.ts` | Toda forma não-cubo como lista de caixas por `shape` + estado; `collisionBoxesFor` com as exceções de colisão do doc 04 §3 |
| `~` | `src/world/mesh/complex.ts` | Reescrito em torno das caixas; duas geometrias só (cruz e caixas); conexão de cerca e grade calculada no meshing |
| `~` | `src/world/mesh/blockinfo.ts` | `CPLX_BOXES` no lugar de `CPLX_HALF_BOX`; tabela `shape` por id; nenhuma forma sai mais sem geometria |
| `~` | `src/world/physics.ts` | Colide contra as caixas da forma, não contra o cubo; varre uma camada a mais para baixo por causa da cerca de 1,5 |
| `~` | `src/data/blocks.ts` | Escada e laje em 7 materiais, cerca/portão/alçapão em 3 madeiras — **gerados** de uma tabela; mais placa, quadro, trilho, teia, pedregulho musgoso, gerador de monstros; escada de mão ganhou forma própria |
| `~` | `src/data/textures.ts` | Texturas de escada de mão, musgo, gerador, teia, trilho, placa e quadro |
| `~` | `src/data/recipes.ts` | `buildingSet` por material; receitas de placa, quadro, trilho e musgo |
| `~` | `src/game/interaction.ts` | `stateForPlacement` deriva orientação do `shape`; `facingFromYaw` e `toggleOpenState` |
| `~` | `src/game/session.ts` | Clique direito abre e fecha porta, portão e alçapão |

### Estruturas e ravinas

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/structures.ts` | Dungeon, mina, casa de aldeia e poço como listas de peças; tabelas de loot de baú |
| `+` | `src/world/gen/structures.ts` | Colocação determinística por chunk de origem, expansão das peças em voxels, aldeia por região de 32×32, `rollChestLoot` |
| `~` | `src/world/gen/terrain.ts` | Passo 9 de geração; `carveRavines` junto das cavernas |
| `~` | `src/world/chunk.ts` | `StructureMark`: baú, gerador e mob deixados pelo gerador para a `Session` resolver |
| `~` | `src/game/session.ts` | Consome os marcos ao carregar o chunk: enche o baú uma vez, registra o gerador, faz nascer o aldeão; tick de geradores com alcance, teto e cooldown |
| `~` | `src/game/container.ts` | `Container.persistent`: baú de estrutura vai para o save mesmo vazio, senão o loot volta |
| `~` | `src/data/mobs.ts`, `src/data/mobskins.ts`, `src/audio/synth.ts` | Aldeão (mob 12), sem regra de spawn — nasce com a aldeia |

### Clima e fases da lua

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/game/weather.ts` | `weatherOfDay` puro, janela de chuva dentro do dia, intensidade com rampa, teto de luz do céu, 8 fases de lua |
| `~` | `src/game/daynight.ts` | `totalTicks` e `day`; `setTimeOfDay` para dormir sem voltar o dia |
| `~` | `src/render/sky.ts`, `src/render/renderer.ts` | `applyRain`: céu e fog puxam para o cinza da chuva juntos |
| `~` | `src/render/particles.ts` | `emitRain`: gotas no mesmo pool, sem passe novo |
| `~` | `src/core/tier.ts` | `rainDrops` por tier (4 / 12 / 28) |
| `~` | `src/entity/spawn.ts` | `slimeFactor`: a lua mexe no peso do slime no sorteio |
| `~` | `src/game/savegame.ts` | O save guarda o total desde o início do mundo, não o tick do dia |

### Arco, escudo e barco

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/entity/boat.ts` | Pool de barcos com flutuação, arrasto, remada pelo olhar e montaria |
| `~` | `src/data/items.ts` | `charge`/`chargeTicks`/`placesBoat`; itens arco, escudo e barco |
| `~` | `src/data/itemart.ts` | Silhuetas de arco, escudo e barco |
| `~` | `src/data/mobmodels.ts`, `src/data/mobskins.ts`, `src/render/entityatlas.ts` | Modelo e camada do barco, no mesmo batcher da flecha |
| `~` | `src/game/session.ts` | Carga do arco, disparo ao soltar, escudo que apara golpe frontal, colocar/montar/pilotar barco |
| `~` | `src/game/inventory.ts` | `take`: consome munição de qualquer slot |
| `~` | `src/main.ts` | Barco no lugar da física do jogador ao pilotar; barcos no render; **correção do laço que zerava o ato de comer** |

### Conquistas

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/achievements.ts` | 18 conquistas por gatilho declarado (`obtain`, `kill`, `place`, `depth`, `level`, `event`) |
| `+` | `src/game/achievements.ts` | Rastreio com máscara de bits e índice por gatilho |
| `~` | `src/game/session.ts` | Dispara nos eventos reais: coletar, craftar, tirar da fornalha, colocar, matar, descer, subir de nível, dormir, encantar, cruzar, navegar |
| `~` | `src/ui/hud.ts` | Toast no canto superior direito, 5 s, com animação de entrada |
| `~` | `src/ui/screens/pause.ts` | Lista de conquistas no menu, com dica genérica para as trancadas |
| `~` | `src/save/db.ts`, `src/game/savegame.ts` | Máscara de conquistas no save do jogador |

### Testes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/shapes.test.ts` | Caixas por forma, colisão de laje/cerca, orientação ao colocar — 16 testes |
| `+` | `tests/structures.test.ts` | Estruturas aparecem, determinismo, ravina, loot de baú — 14 testes |
| `+` | `tests/weather.test.ts` | Clima determinístico, janela, intensidade, fases da lua, relógio — 12 testes |
| `+` | `tests/equipment.test.ts` | Arco, escudo e barco — 12 testes |
| `+` | `tests/achievements.test.ts` | Tabela, rastreio, máscara e integração com a sessão — 13 testes |
| `~` | `tests/complexmesh.test.ts` | O guarda-corpo agora só aceita `liquid` e `none` sem geometria |
| `~` | `tests/savegame.test.ts` | Conquistas e o total de ticks do mundo |
| `~` | `tests/mobs.test.ts` | 13 mobs com o aldeão |

---

## 2026-09-10 · 16:35 → 16:50 · M6, segunda fatia: XP, orbes e encantamento

**Pedido:** *"Verifique onde paramos e continue o desenvolvimento do jogo."*

**Resultado:** terceiro item do checklist do M6 (doc 14) entregue — *"XP, encantamento simplificado
(mesa + níveis + 8 encantamentos)"*. O primeiro item do §6 do doc 15 continua sendo o teste em
aparelho T0 real, que depende de hardware; foi para o item 2. 753 testes (eram 701), bundle
126,5 KB gzip (era 121,2), lint limpo, build e orçamento de tamanho verdes.

Duas decisões de arquitetura, detalhadas no §3 do doc 15: o encantamento de uma pilha é **um
inteiro** de 3 bits por encantamento (`ItemStack.ench`), não um objeto; e o orbe de XP é desenhado
como brilho no pool de partículas, sem passe de render próprio.

Dois achados do caminho, no §4 do doc 15: a fornalha somava 0,1 de XP fixo em vez do valor da
receita, e `give()` perdia campos novos da pilha ao reconstruí-la.

### Experiência

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/game/xp.ts` | `Experience`: guarda só o total acumulado e deriva nível e barra; curva das três faixas do doc 06 §8, `spend` para a mesa, `reset` na morte, `setTotal` para o save |
| `+` | `src/entity/xporb.ts` | `XpOrbs`: pool fixo em arrays paralelos, gravidade com pouso, atração a 8 blocos, fusão de orbes próximos, despawn em 5 min |
| `~` | `src/data/loot.ts` | `LootEntry.xp` (faixa por bloco, coluna do doc 04 §2.2) e `Drop.fortune` (que saída Fortuna multiplica) |
| `~` | `src/game/drops.ts` | `rollDrops` recebe a máscara de encantamento e honra Fortuna e Toque Suave; `rollXp` novo, com a mesma disciplina determinística por posição |
| `~` | `src/render/particles.ts` | `emitGlow`: partícula parada de vida curta — é o que desenha o orbe sem draw call nova |

### Encantamento

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/enchants.ts` | Os 8 encantamentos em tabela: alvo, teto, peso do sorteio e conflito. Ids estáveis (vão para o save); máscara de alvo por item pré-calculada |
| `+` | `src/game/enchanting.ts` | Empacotamento na pilha (`levelIn`/`withEnchant`/`canApply`/`applyEnchant`), ofertas da mesa (`offerCost`, `rollOffers`) e as oito fórmulas de efeito |
| `~` | `src/data/items.ts` | `ItemStack.ench`: inteiro opcional com os encantamentos empacotados |
| `~` | `src/data/blocks.ts` | Bloco 74 `enchanting_table`, dureza de obsidiana, colhe com picareta de diamante |
| `~` | `src/data/textures.ts` | `enchanting_table_top` (livro aberto) e `_side` (runas), derivadas da obsidiana |
| `~` | `src/data/recipes.ts` | Receita da mesa: livro, 2 diamantes e 4 obsidianas |
| `~` | `src/game/container.ts` | `EnchantTable` (2 slots, estantes, seed, ofertas, `apply`); índice de fundição passa a guardar o XP da receita; `give` recebe `ench` |

### Efeitos ligados aos sistemas existentes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/game/interaction.ts` | `breakProgressPerTick` e `breakTimeSeconds` recebem o nível de Eficiência, somado só com a ferramenta certa |
| `~` | `src/game/combat.ts` | Afiação em `attackDamageOf`; `ArmorTotals.protection` soma os níveis de Proteção das peças |
| `~` | `src/game/survival.ts` | Campos `protection` e `featherFalling`; Proteção entra depois da armadura, Queda Suave alivia o dano de queda |
| `~` | `src/entity/mobs.ts` | Campo `looting`, ligado pela sessão em volta do golpe; o bônus só soma a drop que já saiu |
| `~` | `src/game/inventory.ts` | `give` e `moveInto` carregam `ench` — sem isso o encantamento sumia ao empilhar |
| `~` | `src/game/session.ts` | Costura: orbes no tick, XP de bloco e de mob, Inquebrável em toda gasta de durabilidade, abertura da mesa com contagem de estantes, `buyEnchant`, `collectFurnaceXp` |

### Interface e persistência

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/ui/hud.ts` | Barra verde de XP com o nível no centro (doc 08 §3.4); vida, fome, armadura e avisos subiram para abrir espaço |
| `~` | `src/ui/containers/screen.ts` | Tela `enchanting` com os 2 slots e os 3 botões de oferta; tooltip mostra os encantamentos; slot encantado ganha brilho; tirar da fornalha entrega o XP |
| `~` | `src/main.ts` | Liga os callbacks da mesa, o HUD de XP e o brilho dos orbes |
| `~` | `src/save/db.ts` | `PlayerSave.enchants` e `PlayerSave.xp`, ambos opcionais — save antigo carrega sem migração |
| `~` | `src/game/savegame.ts` | Grava e restaura XP e encantamentos, no jogador e nos baús |

### Testes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/xp.test.ts` | Curva de nível, gasto, reset, e a física do orbe (voa, pousa, funde, respeita o pool) — 12 testes |
| `+` | `tests/enchanting.test.ts` | Tabela, empacotamento, ofertas e as oito fórmulas, mais Fortuna e Toque Suave no drop — 27 testes |
| `+` | `tests/enchanttable.test.ts` | A mesa pela sessão: abrir, contar estantes, pagar, recusar, não perder item ao fechar — 8 testes |
| `~` | `tests/session.test.ts` | XP no mundo: minério dá orbe e o jogador coleta; morrer zera; fornalha entrega |
| `~` | `tests/savegame.test.ts` | Ida e volta de XP e de encantamento, no jogador e no baú |
| `~` | `tests/combat.test.ts` | `ArmorTotals` ganhou `protection` |

---

## 2026-09-10 · 08:07 → 08:32 · M6, primeira fatia: agricultura, reprodução e blocos complexos

**Pedido:** *"Vamos seguir com o desenvolvimento do M6. Ainda não tenho o aparelho antigo para
testar e concluir os outros M previamente implementados."*

**Resultado:** os dois primeiros itens do checklist do M6 (doc 14) entregues — agricultura e
reprodução —, mais o **buffer de blocos complexos** que faltava desde o M1 e sem o qual a
plantação seria invisível. 701 testes (eram 654), bundle 121,2 KB gzip (era 116,6), lint limpo,
build e orçamento de tamanho verdes.

Achado do caminho, registrado no §4 do doc 15: **todo bloco não-cubo estava invisível em jogo**.
O `greedy.ts` tinha um comentário dizendo que o buffer de formas complexas chegaria no M4 e ele
nunca foi escrito — grama alta, samambaia, flor, muda, cana, trepadeira, arbusto morto, tocha e
laje existiam no mundo, colidiam e iluminavam, mas não eram desenhados.

### Malha de blocos complexos

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/mesh/complex.ts` | Geometria fora do greedy: cruz de dois planos visível dos dois lados (planta, muda, flor, plantação, tocha) e caixa de meio bloco (laje, camada de neve). Sai no mesmo buffer recortado, sem draw call nova |
| `~` | `src/world/mesh/greedy.ts` | Chama `meshComplex` depois dos três passes e soma os quads |
| `~` | `src/world/mesh/blockinfo.ts` | Tabelas `complex`, `stageTex` e `hasStages`; `stageTexOf`; forma complexa passa a ter camada de render em vez de `LAYER_NONE` |
| `~` | `src/render/mesh.ts` | `MeshBuilder.addPolyQuad`: quad de cantos livres, opcionalmente de dois lados reusando os mesmos 4 vértices |

### Agricultura

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/crops.ts` | Tabela declarativa semente → bloco → colheita, com idade máxima, chance de crescer e drops por maturidade; índices por bloco e por semente |
| `+` | `src/game/farming.ts` | `tillSoil` (enxada) e `plantSeed`, regras puras de mundo |
| `+` | `src/world/growth.ts` | Registro de posições que crescem, alimentado pelo evento de bloco e pela varredura de paleta do chunk; tick em rodízio com teto de 16 posições; umidade da terra arada e crescimento da planta |
| `~` | `src/data/blocks.ts` | Campos `stages` e `itemless` na definição; atalho `crop()`; blocos 70 `farmland`, 71 `wheat`, 72 `carrots`, 73 `potatoes`; constante `FARMLAND` |
| `~` | `src/data/items.ts` | Enxadas nos 5 materiais, cenoura, batata e batata assada — **no fim da tabela**, para não mover id de item que já foi para o save; bloco `itemless` não gera item |
| `~` | `src/data/textures.ts` | `farmland_dry`/`farmland_wet` e 16 texturas de estágio (trigo 8, cenoura 4, batata 4), geradas em laço |
| `~` | `src/render/texgen.ts` | Operadores `cropRows` (talos que sobem com o estágio) e `furrows` (sulcos da terra arada) |
| `~` | `src/data/itemart.ts` | Silhuetas `hoe`, `carrot` e `potato`; `hoe` entra na lista de tipos de ferramenta da arte |
| `~` | `src/data/recipes.ts` | Enxada no `toolSet` — uma receita por material, de graça |
| `~` | `src/data/smelting.ts` | Batata → batata assada |
| `~` | `src/data/loot.ts` | Terra arada dropa terra |
| `~` | `src/game/drops.ts` | Plantação dropa pela idade: madura entrega a colheita, verde devolve a semente |

### Reprodução

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/entity/mobstore.ts` | `loveTicks`, `growTicks`, `breedCooldown`; `isBaby`, `makeBaby`, `tickGrowth`, `BABY_SCALE`; os campos novos entram na cópia de slot |
| `~` | `src/entity/mobs.ts` | `tryFeed` (adulto entra no amor, filhote cresce mais rápido, cooldown recusa), `breed` (filhote no meio dos pais, cooldown nos dois, XP), contadores no tick, filhote não dropa nada |
| `~` | `src/entity/ai/goals.ts` | Goal `breed` e o ajudante `findMate`; ação `breed` no contexto de IA |
| `~` | `src/data/mobs.ts` | Traço `breedItem`, goal `breed` no conjunto passivo, porco passa a ser atraído por cenoura |

### Fiação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/game/session.ts` | Instancia e liga o `Growth`; `tryFarm` no clique direito (antes de comer, porque cenoura e batata são semente e comida); alimentar mob no `useOnMob`; `onChunkLoaded`/`onChunkUnloaded` |
| `~` | `src/main.ts` | Pipeline avisa a sessão ao carregar e ao descarregar chunk |
| `~` | `src/world/world.ts` | Evento de mudança de bloco passou a usar um objeto por nível de reentrância: o crescimento chama `setBlock` de dentro do próprio evento, e com um objeto só os ouvintes seguintes receberiam a mudança de dentro no lugar da de fora |

### Testes e documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/farming.test.ts` | 19 testes: arar, plantar, crescer, luz, orçamento por tick, umidade, colheita por maturidade, planta sem suporte, varredura e descarte de chunk |
| `+` | `tests/breeding.test.ts` | 13 testes: item por espécie, cooldown, cruzar, filhote (tamanho, crescimento, sem drop) e slot reaproveitado |
| `+` | `tests/complexmesh.test.ts` | 14 testes: tabelas de forma, textura por idade, geometria de cruz/tocha/laje, oclusão da laje, padding e campo de trigo |
| `~` | `docs/15-status.md` | §1 M6 em andamento, §2 métricas novas, §3 detalhe do M6 com o desvio do random tick, §4 bug do bloco não-cubo invisível, §5 e §6 |
| `~` | `tests/worldgen.test.ts` | Regressão do despacho reentrante de mudança de bloco |
| `~` | `README.md` | Linha do M6, 701 testes, 121 KB |

---

## 2026-09-10 · 07:25 → 08:05 · Pendências do M4 (P1–P7)

**Pedido:** *"Corrija as pendências do M4"*

**Resultado:** as sete pendências fechadas. 654 testes (eram 609), bundle 116,6 KB gzip (era 99,7),
lint limpo. Fluxo completo verificado no navegador: criar mundo → jogar → quebrar bloco → salvar →
recarregar → o buraco e o inventário continuam lá.

### P1 — Save ligado

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/game/savegame.ts` | `SaveGame`: observa mudança de bloco para marcar chunk sujo, responde ao pipeline com o chunk do disco (recalculando a luz), autosave, snapshot/restore do jogador e das tile entities |
| `~` | `src/world/pipeline.ts` | Gancho `loadSaved` consultado antes de gerar; `acceptChunk` compartilhado entre worker e save |
| `~` | `src/save/savemanager.ts` | `saveTiles`/`loadTiles` para baús e fornalhas |
| `~` | `src/save/db.ts` | `PlayerSave.bedSpawn` |
| `~` | `src/world/gen/terrain.ts` | `computeChunkLight` exportado (a luz não é salva, é recalculada); **novo flood fill de luz de bloco**, filtrado pela paleta da section |
| `~` | `src/main.ts` | Instancia `SaveManager` + `SaveGame`, autosave no tick, grava ao descarregar chunk, `beforeunload` com rede de segurança |

### P2 e P3 — Telas de mundo e de opções

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/ui/screens/menu.ts` | Peças compartilhadas: painel, botão de 44 px, campos declarativos ligados ao `SettingsStore` |
| `+` | `src/ui/screens/title.ts` | Tela de título |
| `+` | `src/ui/screens/worlds.ts` | Lista de mundos, criação (nome, seed, modo, dificuldade) e apagar com confirmação |
| `+` | `src/ui/screens/options.ts` | Opções de vídeo, som, controles e jogo |
| `+` | `src/ui/menuflow.ts` | Fluxo título → mundos → jogo, com `newWorldMeta`; funciona sem IndexedDB |
| `~` | `src/main.ts` | `boot()` só monta o que não depende de mundo; `startGame(meta)` constrói o resto quando o jogador escolhe |
| `~` | `src/ui/screens/pause.ts` | Botão "Opções"; "Salvar e Sair" agora grava e volta ao título |

### P4 — Sprites de item

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/itemart.ts` | 26 silhuetas em máscara de texto 16×16, com papéis de cor; cobre ferramentas, armadura, materiais e comida |
| `+` | `src/render/itemsprites.ts` | Folha única de sprites: item-bloco em isométrica 2:1 a partir das texturas, resto por máscara; publica variáveis CSS |
| `~` | `src/render/atlas.ts` | Guarda os pixels das camadas (`texturePixels`) para a interface poder montar os sprites |
| `~` | `src/render/itemrender.ts` | Item no chão passou a usar a folha de sprites em vez do atlas de blocos |
| `~` | `src/ui/containers/screen.ts` | Slots desenham sprite (com contagem no canto) e caem na cor média quando não há |
| `~` | `src/ui/hud.ts` | Hotbar com sprite |

### P5, P6 e P7 — Livro de receitas, baú duplo e criativo

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/ui/containers/recipebook.ts` | Livro com busca, filtro "só o que dá" e clique que preenche a grade |
| `+` | `src/ui/containers/creative.ts` | Inventário criativo com 5 abas derivadas dos campos do item, busca e hotbar editável |
| `~` | `src/game/crafting.ts` | `RecipeBook.entries()`: receitas no formato da interface, com cache |
| `~` | `src/game/session.ts` | `autoFillRecipe`, `useOnMob` já existente ajustado, baú duplo via `findDoubleChest` de verdade |
| `~` | `src/game/container.ts` | `ContainerView` e `DoubleChestView` (54 slots sobre dois baús de 27) |
| `~` | `src/main.ts` | Liga livro de receitas, criativo (E no modo criativo) e sprites nas telas |

### Testes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/savegame.test.ts` | 15 testes: mundo novo, ciclo salvar → recarregar, tile entities, autosave |
| `+` | `tests/itemsprites.test.ts` | 13 testes: máscaras válidas, **todo item não-bloco tem arte**, folha, cubo isométrico |
| `+` | `tests/inventoryui.test.ts` | 17 testes: baú duplo, entradas de receita, auto-preenchimento, abas do criativo |

### Documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `docs/15-status.md` | M4 fechado, tabela P1–P7 com o que ficou, métricas, novo próximo passo |
| `~` | `docs/16-auditoria.md` | Esta sessão |
| `~` | `README.md` | Estado, telas, sprites e contagens |

---

## 2026-09-09 · 21:05 → 23:00 · Marco M5 — Vida no mundo

**Pedido:** *"Preciso que você continue com o desenvolvimento deste jogo, considerando todo o status
atual do projeto. A etapa atual que devemos continuar o desenvolvimento se não me engano é o M5."*

**Resultado:** M5 concluído. 609 testes (eram 478), bundle 99,7 KB gzip (era 73,2), lint limpo,
verificação visual no navegador (mobs, árvores e luz na tela). Três bugs anteriores ao M5
encontrados e corrigidos no caminho — ver [15-status.md §4](15-status.md).

### Mobs, IA e entidades

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/data/mobs.ts` | Tabela declarativa dos 12 mobs: vida, hitbox, velocidade, ataque por dificuldade, drops, XP, goals, modelo, skin, traços e regras de spawn |
| `+` | `src/data/mobmodels.ts` | Modelos de caixas com "box mapping" e convenção de espaço própria; 10 modelos + flecha; `faceRect` resolve o retângulo de cada face |
| `+` | `src/data/mobskins.ts` | Receitas de skin (cor de base, cor por parte, detalhes) — arte original, zero assets |
| `+` | `src/entity/mobstore.ts` | Armazenamento SoA com pool, física do mob (gravidade, colisão, auto-step, pulo ao travar, escalada, planeio, natação) e animação |
| `+` | `src/entity/mobs.ts` | Gerência: ordem do tick, alvo com linha de visão, dano/morte/drops, despawn, domar, teleportar, `pickTarget` para o jogador mirar |
| `+` | `src/entity/ai/goals.ts` | 12 goals declarativos em ordem de prioridade (flutuar, pânico, explodir, atirar, atacar, saltar, perseguir, fugir do sol, seguir item, seguir dono, passear, olhar) |
| `+` | `src/entity/ai/pathfinder.ts` | A* com orçamento duro (200 nós, 2 buscas/tick), heap binário e tabela de hash pré-alocados, caminho parcial quando estoura |
| `+` | `src/entity/spawn.ts` | Ciclo de spawn por categoria, caps proporcionais aos chunks carregados, validação de chão/luz/bioma/distância, população inicial de chunk |
| `+` | `src/entity/projectile.ts` | Flechas em SoA, com subpassos para não atravessar parede |

### Combate, sobrevivência e sessão

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/game/combat.ts` | Fórmulas: soma de armadura, redução de dano com toughness, dano e cooldown por arma, custo de durabilidade |
| `+` | `src/game/explosion.ts` | Explosão como evento: esfera com queda por distância, abrigo por raycast, 30% de drop, curva de dano |
| `+` | `src/game/sleep.ts` | Janela da noite, regra de monstro por perto, hora de acordar |
| `~` | `src/game/session.ts` | Passou a costurar mobs, spawner, projéteis e dia/noite; ataque corpo-a-corpo, dano com empurrão, uso de item em mob, cama, explosão, sincronia da armadura |
| `~` | `src/game/survival.ts` | Campos de armadura, redução no `damage`, causas `arrow` e `explosion`, lista de causas que ignoram armadura |
| `~` | `src/game/inventory.ts` | Slot de armadura só aceita a peça certa; shift+clique equipa; `armorSlotIndex` |
| `~` | `src/game/settings.ts` | Volume geral e de música, legendas de som, sombras de entidade, dificuldade |
| `~` | `src/data/items.ts` | 16 peças de armadura, itens de drop de mob, `attackSpeed` por tipo e **dano por material** (corrigiu espada de diamante batendo igual à de madeira) |
| `~` | `src/data/recipes.ts` | Receitas das 4 armaduras completas, flecha e lã → linha |

### Áudio

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/audio/synth.ts` | 5 famílias de receita (ruído, tons, voz, estalos, arpejo), tabela de ~60 sons e vozes de mob geradas por parâmetro |
| `+` | `src/audio/engine.ts` | Contexto só no primeiro gesto, barramentos, pool de vozes com panner, jitter de pitch/volume, legendas |
| `+` | `src/audio/music.ts` | Música por caminhada aleatória em pentatônica, com blocos e silêncios e clima por contexto |

### Renderização

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/render/skingen.ts` | Gerador de skin a partir do modelo + receita (fundo por parte, olhos, boca, faixa, manchas) |
| `+` | `src/render/entityatlas.ts` | Atlas 64×64 por camada (array em WebGL2, grade 2D no fallback), com a sombra radial |
| `+` | `src/render/mobrender.ts` | Batcher de caixas na CPU: uma draw call para toda a cena, sombras em segunda chamada com blending |
| `+` | `src/render/shaders/entity.glsl.ts` | Shaders de entidade nas duas variantes, com o mesmo fog do terreno |
| `~` | `src/render/renderer.ts` | Passe de entidades entre o terreno e os itens no chão |

### Mundo

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `src/world/gen/decorate.ts` | Árvores (carvalho, bétula, pinheiro, acácia) e plantas por bioma, com transbordo determinístico entre chunks |
| `~` | `src/world/gen/terrain.ts` | Chama a decoração; luz do céu passou a usar `lightAttenuation` da tabela; novo `spreadSkyLight` (BFS no worker) |
| `~` | `src/world/chunk.ts` | **Correção:** `setByIndex` relê `this.data` depois de `growBits` — a escrita que estourava a paleta era perdida |
| `~` | `src/world/lighting.ts` | Removido `seedChunkSkyLight` (custo proibitivo na thread principal); o espalhamento virou trabalho de worker |
| `~` | `src/world/pipeline.ts` | Gancho `onChunkLoaded`, usado pela população inicial de mobs |

### Interface e bootstrap

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `src/main.ts` | Fiação de tudo: atlas de entidade, batcher, áudio no primeiro gesto, ataque antes de quebrar, uso de item em mob, passos, música, sombras, contadores de debug |
| `~` | `src/ui/hud.ts` | Barra de armadura, avisos curtos (`showMessage`) e legendas de som com direção |
| `~` | `src/ui/debug.ts` | Linha de entidades (mobs, itens, flechas, caminhos/tick), relógio e sons carregados |

### Testes

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `tests/mobs.test.ts` | 24 testes: tabela, física, perseguição, combate, ambiente, despawn, mira e orçamento de 20 mobs |
| `+` | `tests/pathfinding.test.ts` | 11 testes: altura de apoio, desvio de parede, lava, orçamento, caminho parcial |
| `+` | `tests/combat.test.ts` | 22 testes: tabela de armadura do doc, redução de dano, ataque, slots, explosão |
| `+` | `tests/spawn.test.ts` | 11 testes: caps por tier, luz, bioma, distância, cap, população inicial |
| `+` | `tests/sleep.test.ts` | 11 testes: janela da noite, monstros, cama no mundo, renascimento |
| `+` | `tests/entityart.test.ts` | 11 testes: UV dentro da skin, altura do modelo × hitbox, skins determinísticas |
| `+` | `tests/audio.test.ts` | 15 testes: tabela de sons, montagem de grafo em contexto falso, motor sem WebAudio, música |
| `+` | `tests/nightlife.test.ts` | 16 testes: atacar, apanhar, armadura, domar, explosão e 1200 ticks com 20 mobs |
| `+` | `tests/decorate.test.ts` | 9 testes: madeira no mundo, determinismo, borda de chunk, onde não entra |
| `~` | `tests/worldgen.test.ts` | Regressão do bug da paleta de chunk |

### Documentação

| Ação | Arquivo | O que mudou |
|---|---|---|
| `~` | `README.md` | Status M0–M5, novidades do marco, controles de ataque e som, estrutura de pastas, contagem de testes e bundle |

---

## 2026-09-09 · 23:00 → 23:05 · Controle de status e auditoria

**Pedido:** *"adicione uma parte nos documentos (Ou crie um documento unificado), para armazenar
todos os status atuais de cada ponto... e também uma espécie de auditoria contendo uma grid para
controle de cada interação que foi feita nos arquivos... Caso necessário faça ajustes no CLAUDE.MD
pois não quero avisar nada disso para você, quero tudo automático."*

**Resultado:** documentos de status e auditoria criados; `CLAUDE.md` passa a exigir a leitura do
status no início e a atualização dos dois no fim de cada entrega, sem precisar de aviso.

| Ação | Arquivo | O que mudou |
|---|---|---|
| `+` | `docs/15-status.md` | Status por marco, pendências verificadas (P1–P7), dependências, métricas, próximo passo e regra de manutenção |
| `+` | `docs/16-auditoria.md` | Este arquivo: histórico por sessão com grid de arquivos |
| `+` | `CLAUDE.md` | Regras automáticas: ler o status ao começar, atualizar status + auditoria ao terminar, portões de qualidade |
| `~` | `README.md` | Aponta para o status e a auditoria |
| `~` | `PROMPT.md` | Índice de documentos inclui 15 e 16 |

---

## Sessões anteriores (reconstruídas)

Sem grid por arquivo: o registro passou a existir em 2026-09-09. As datas vêm da modificação dos
arquivos; o conteúdo, do README e do código.

| Data | Entrega | Arquivos | Observação |
|---|---|---|---|
| 2026-09-05 | Especificação completa (`PROMPT.md`, docs 00–14, 14 wireframes) e marcos **M0**, **M1** e **M2** | 31 arquivos `.ts` | Esqueleto, renderer, mundo visível, física e interação |
| 2026-09-08 | Marcos **M3** e **M4** | 58 arquivos `.ts` | Toque, PWA, inventário, crafting, contêineres, sobrevivência, fluidos, persistência (a camada de save ficou pronta mas **não ligada** — pendência P1) |
