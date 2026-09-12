# 00 — Visão Geral do Projeto

> **Nome de trabalho:** `CraftLite` (nome final a definir — **não** usar "Minecraft" no produto,
> no domínio, no título ou nos assets; ver [13-assets-e-arte.md](13-assets-e-arte.md)).

## 1. O que estamos construindo

Um jogo de mundo aberto em voxels (blocos de 1×1×1) jogável **direto no navegador**, sem
instalação, sem plugin e sem backend obrigatório, que reproduz o *loop de jogo* clássico de
sobrevivência-e-construção:

> minerar → coletar → craftar ferramentas melhores → explorar mais fundo → sobreviver à noite →
> construir → repetir.

## 2. Alvo de hardware (a restrição que domina todas as decisões)

O requisito mais duro do projeto **não** é gráfico, é de alcance. O jogo precisa rodar em:

| Perfil | Aparelho de referência | Meta |
|---|---|---|
| **Piso (P0)** | Celular Android 2016–2018, 2 GB RAM, GPU Adreno 405/Mali-T720, Chrome atual | **30 FPS** estáveis, render distance 4 |
| Médio (P1) | Celular 2020, 4 GB RAM, Snapdragon 6xx | 60 FPS, render distance 6–8 |
| Alto (P2) | Notebook/desktop qualquer com GPU integrada | 60+ FPS, render distance 12–16 |

Consequências não-negociáveis disso:
- **Sem Three.js, sem Babylon, sem engine de terceiros.** Renderer WebGL2 próprio (fallback WebGL1).
- **Bundle < 500 KB gzip** no total (código + assets). Meta ideal: 300 KB.
- **Memória RSS < 350 MB** com render distance 6.
- **Texturas geradas por código** (procedurais) ou atlas 16px minúsculo — nada de baixar PNGs pesados.
- **Áudio sintetizado** via WebAudio, não arquivos .ogg de megabytes.
- Mundo com **altura 128** (não 384 como o jogo original) para cortar memória e meshing pela metade.

## 3. Escopo — o que entra

### Núcleo (obrigatório, MVP jogável)
- Mundo infinito proceduralmente gerado, com seed, biomas, cavernas, minérios, água e lava.
- Quebrar/colocar blocos com tempo de quebra dependente de ferramenta.
- Física do jogador: andar, correr, agachar, pular, nadar, queda com dano.
- Inventário 36 slots + hotbar 9 + 4 slots de armadura + offhand.
- Crafting 2×2 (inventário) e 3×3 (bancada), com livro de receitas.
- Fornalha (queima/cozimento), baú, baú duplo.
- Ciclo dia/noite, iluminação por flood-fill (luz de bloco + luz do céu, 0–15).
- Vida, fome, saturação, dano, morte e respawn, cama define spawn.
- Mobs: passivos (vaca, porco, ovelha, galinha) e hostis (zumbi, esqueleto, creeper, aranha).
- Modos Sobrevivência e Criativo.
- Salvamento local em IndexedDB (múltiplos mundos).
- **Controles de toque completos** (é o alvo principal, não um extra).

### Segundo círculo (pós-MVP, ordem de prioridade)
Encantamento simplificado, poções/caldeirão, agricultura (trigo/cenoura/batata), reprodução de mobs,
redstone básico (redstone dust, tocha, botão, alavanca, porta, pistão), carrinho de mina e trilhos,
Nether (dimensão alternativa), barco, arco e flecha, escudo, XP e níveis, estruturas (aldeia, dungeon),
clima (chuva/tempestade), placas, quadros, fogueira, cerca/portão, camas coloridas.

### Fora de escopo (declarado, não é omissão)
The End e Ender Dragon, multiplayer com servidor dedicado (deixamos ganchos, ver
[12-multiplayer.md](12-multiplayer.md)), Realms, comércio com aldeões, mapas/cartografia,
shaders/ray-tracing, bloco de comandos, mundos superplanos customizados, mods.

## 4. Princípios de design

1. **Fidelidade de sensação > fidelidade de conteúdo.** É melhor ter 60 blocos que se comportam
   *exatamente* como o esperado do que 300 blocos meia-boca. As constantes de física, tempo de
   quebra, alcance e velocidade são copiadas fielmente porque é isso que faz "parecer certo".
2. **Tudo que é dado é dado, não código.** Blocos, itens, receitas, drops e mobs vivem em tabelas
   JSON/TS declarativas. Adicionar um bloco = uma linha, não um `switch`.
3. **O frame nunca trava.** Geração e meshing acontecem em Web Workers com orçamento de tempo por
   frame. Nunca há um "hitch" de 300 ms ao andar.
4. **Degrada, não quebra.** Detecta a capacidade do aparelho no boot e escolhe presets. Se WebGL2
   não existe, cai para WebGL1. Se `OES_texture_float` não existe, tem caminho alternativo.
5. **Offline-first.** Service Worker; depois do primeiro load o jogo abre sem internet.

## 5. Documentos deste repositório

| Doc | Conteúdo |
|---|---|
| [01-arquitetura-tecnica.md](01-arquitetura-tecnica.md) | Stack, módulos, threads, formato de dados, renderer |
| [02-orcamento-performance.md](02-orcamento-performance.md) | Budgets numéricos, técnicas, presets por aparelho |
| [03-mundo-e-geracao.md](03-mundo-e-geracao.md) | Ruído, biomas, cavernas, minérios, estruturas |
| [04-blocos.md](04-blocos.md) | Tabela completa de blocos e propriedades |
| [05-itens-e-receitas.md](05-itens-e-receitas.md) | Itens, ferramentas, receitas de craft e fundição |
| [06-jogador-e-fisica.md](06-jogador-e-fisica.md) | Constantes de movimento, colisão, vida, fome, dano |
| [07-mobs-e-ia.md](07-mobs-e-ia.md) | Mobs, stats, IA, spawn, drops |
| [08-interface-ui.md](08-interface-ui.md) | Especificação pixel-a-pixel de todas as telas |
| [09-controles-mobile.md](09-controles-mobile.md) | Toque, gestos, layout, acessibilidade |
| [10-audio.md](10-audio.md) | Síntese procedural de sons |
| [11-persistencia-e-saves.md](11-persistencia-e-saves.md) | IndexedDB, formato de save, migração |
| [12-multiplayer.md](12-multiplayer.md) | Arquitetura opcional P2P/WebSocket |
| [13-assets-e-arte.md](13-assets-e-arte.md) | Geração de texturas, fonte, licenciamento |
| [14-roadmap.md](14-roadmap.md) | Marcos, critérios de aceite, ordem de execução |
| [mockups/](mockups/) | Wireframes SVG originais de cada tela |
