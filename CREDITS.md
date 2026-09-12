# Créditos

**CraftLite** é um projeto independente, sem afiliação, patrocínio ou aprovação de
nenhuma empresa de jogos.

## Assets

Todo o conteúdo audiovisual do jogo é **gerado por código deste repositório**:

| Asset | Como é feito | Onde |
|---|---|---|
| Texturas de bloco | operadores procedurais compostos sobre 16×16 RGBA | `src/render/texgen.ts`, `src/data/textures.ts` |
| Atlas / texture array | montado no boot, em memória | `src/render/atlas.ts` |

Nenhum arquivo de imagem, som, fonte ou modelo de terceiros entra no repositório.
Nenhuma paleta foi extraída de outro jogo. Nome, identidade visual e textos são
criações originais do projeto.

O que é reproduzido de outros jogos do gênero são **mecânicas e convenções de layout**
— um inventário 9×3 ou uma barra de vida em corações são escolhas funcionais, não obras
de arte.

## Licença

Código sob licença MIT (ver `LICENSE`). Como os assets são gerados pelo código, eles
seguem a mesma licença.

## Resource packs

O jogo aceita arte customizada do próprio jogador via `Atlas.loadOverrides()`. O projeto
não distribui nem redistribui nenhum pacote de terceiros.
