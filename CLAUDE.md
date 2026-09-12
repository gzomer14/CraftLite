# CraftLite — instruções permanentes

Jogo de mundo aberto em voxels, TypeScript + WebGL2 puro, **zero dependências de runtime**, que
precisa rodar a 30 FPS num Android de 2016. `PROMPT.md` é o prompt mestre; `docs/00` a `docs/14` são
**normativos** (descrevem o que o jogo deve ser); `docs/15` e `docs/16` são **descritivos**
(descrevem o que o código é hoje).

## Ritual de início — sempre

Antes de qualquer coisa, leia **[docs/15-status.md](docs/15-status.md)**. Ele diz o que está pronto,
o que ficou pendente (P1, P2, …), o que depende de quê e qual é o próximo passo.

- *"Continue de onde parou"* = pegue o item 1 de **§6 Próximo passo** do doc 15.
- *"Continue o marco Mx"* = §3 do doc 15 + o checklist do marco em `docs/14-roadmap.md`.
- Precisa saber quem mexeu em quê e quando: **[docs/16-auditoria.md](docs/16-auditoria.md)**.

Não confie no doc 15 para detalhe de implementação: ele aponta o arquivo, o arquivo é a verdade.

## Ritual de fim — sempre, sem precisar de pedido

Terminou qualquer coisa que mexeu em arquivo — marco, correção, ajuste, refatoração —, **antes de
responder ao usuário**:

1. **Portões de qualidade**, nesta ordem, todos verdes:
   ```bash
   npm test                                  # nenhum teste pode ficar vermelho
   npm run lint
   npm run build                             # inclui tsc --noEmit
   SIZE_BUDGET_KB=350 node scripts/size-report.mjs
   ```
2. **Atualize `docs/15-status.md`:** linha do marco no §1, detalhe no §3, pendência criada ou
   fechada (§3 e §5), bug de marco anterior no §4, métricas do §2 com os números que acabaram de
   sair dos portões, e a data no topo.
3. **Acrescente uma sessão em `docs/16-auditoria.md`**, no topo da lista, com data/hora
   (`date "+%Y-%m-%d %H:%M"`), o pedido do usuário resumido (uma frase, citada), o resultado, e o
   **grid de arquivos**: ação (`+` criado, `~` alterado, `−` removido, `↻` movido), caminho e o que
   mudou em uma linha. Agrupe por área quando passar de ~10 arquivos.
4. Se o estado do projeto mudou de nível (marco fechado, contagem de testes, tamanho do bundle),
   atualize também o `README.md`.

Nunca escreva "concluído" sem ter rodado os portões. Nunca liste pendência sem ter verificado no
código (`grep`, teste, execução) — pendência inventada é pior que pendência esquecida.

## Regras de código (resumo do PROMPT.md §6)

- **Comentários e nomes de domínio em português**; identificadores de código em inglês.
- **Zero alocação por frame no caminho quente**: pools e objetos pré-alocados, `TypedArray` em tudo
  que é grande, nada de `map/filter/forEach` no tick ou no render.
- **Dado é dado, não código**: bloco, item, receita, mob, bioma e decoração vivem em tabelas
  declarativas em `src/data/`. Acrescentar conteúdo é uma linha na tabela, nunca um `case` novo.
- **Toda mutação de voxel passa por `world.setBlock(x, y, z, state, source)`.**
- **Tudo determinístico a partir da seed**, via `rngAt(seed, x, z, salt)`.
- **Simule a 20 Hz** com timestep fixo e interpole no render.
- Um módulo, uma responsabilidade; acima de ~400 linhas, provavelmente são dois.
- **Nenhum asset de terceiros** entra no repositório: textura, som, fonte e modelo são gerados por
  código.
- Desvio consciente de um doc normativo se escreve **no comentário do módulo**, com o motivo — e no
  §4 do doc 15 quando corrige comportamento anterior.

## Testes

`vitest`, ambiente Node (sem DOM, sem GL). O que toca DOM ou WebAudio se testa com stub. Todo
sistema novo entra com teste; toda correção de bug entra com regressão. Orçamentos de performance
ficam em `tests/perf.test.ts` e nos testes de sistema (ex.: tick de 20 mobs).

## Pendência aberta que atravessa tudo

O risco técnico do projeto é performance em celular fraco, e **nada foi medido em aparelho real
ainda**. Quando o usuário puder testar em T0, isso fecha M3 e M5 (ver doc 15 §3).
