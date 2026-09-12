# Wireframes de Referência

Diagramas **originais** de layout — caixas, grades e cotas mostrando posição, tamanho e hierarquia
de cada tela. São referência de *estrutura*, não de arte: as cores aqui são de wireframe
(cinza-azulado escuro), enquanto a paleta real do jogo está em
[../08-interface-ui.md](../08-interface-ui.md) §2.

Nenhum asset de terceiros é usado ou reproduzido. Regenerar com:

```bash
python3 docs/mockups/generate.py
```

| Arquivo | Tela |
|---|---|
| [01-title.svg](01-title.svg) | Tela de título |
| [02-worlds.svg](02-worlds.svg) | Seleção de mundos |
| [03-create-world.svg](03-create-world.svg) | Criar novo mundo |
| [04-hud.svg](04-hud.svg) | HUD em jogo (vida, fome, XP, hotbar, crosshair) |
| [05-inventory.svg](05-inventory.svg) | Inventário de sobrevivência + interações de slot |
| [06-creative.svg](06-creative.svg) | Inventário criativo com abas e busca |
| [07-crafting.svg](07-crafting.svg) | Bancada 3×3 + regras de matching |
| [08-furnace.svg](08-furnace.svg) | Fornalha (entrada, combustível, progresso, saída) |
| [09-chest.svg](09-chest.svg) | Baú simples e baú duplo |
| [10-pause.svg](10-pause.svg) | Menu de pausa |
| [11-options.svg](11-options.svg) | Opções ▸ Vídeo |
| [12-death.svg](12-death.svg) | Tela de morte |
| [13-mobile-controls.svg](13-mobile-controls.svg) | Layout de controles de toque (landscape) |
| [14-chunk-pipeline.svg](14-chunk-pipeline.svg) | Diagrama da pipeline de chunk e threads |

## Como usar ao implementar

1. Abra o SVG ao lado do código da tela.
2. As anotações em amarelo são **decisões**, não sugestões (ex.: "alvos ≥ 44×44 px CSS reais").
3. Os tamanhos citados em "px de GUI" multiplicam por `--gui-scale` (1–4). Ver doc 08 §1.
4. Se o layout implementado divergir do wireframe por um bom motivo, **atualize o
   `generate.py`** — o wireframe deve seguir sendo a verdade.
