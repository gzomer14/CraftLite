# 06 — Jogador, Física e Sobrevivência

> As constantes abaixo são o que faz o jogo "sentir certo". Todas as unidades são
> **por tick de 50 ms**, salvo indicação. Não converta para segundos no código —
> simule a 20 Hz e interpole no render.

## 1. Dimensões e câmera

| | Valor |
|---|---|
| Hitbox em pé | 0.6 × 1.8 × 0.6 |
| Hitbox agachado | 0.6 × 1.5 × 0.6 |
| Hitbox nadando/rastejando | 0.6 × 0.6 × 0.6 |
| Altura dos olhos (em pé) | 1.62 |
| Altura dos olhos (agachado) | 1.27 |
| Alcance de interação (Sobrevivência) | **4.5** blocos (bloco) / 3.0 (entidade) |
| Alcance de interação (Criativo) | 5.0 / 5.0 |
| FOV padrão | 70° (vertical) |
| FOV correndo | 70° × 1.10, com transição de 100 ms |

## 2. Movimento

| Constante | Valor |
|---|---|
| Gravidade | `−0.08` por tick, aplicada antes do arrasto |
| Arrasto vertical | `×0.98` por tick |
| Velocidade terminal de queda | ~3.92 blocos/tick |
| Atrito do chão (slipperiness padrão) | 0.6 |
| Aceleração no chão | `0.1 × (0.6/friction)³ × movementMultiplier` |
| Aceleração no ar | `0.02` (correndo: 0.026) |
| Velocidade caminhando | **4.317 blocos/s** |
| Velocidade correndo | **5.612 blocos/s** (×1.30) |
| Velocidade agachado | 1.295 blocos/s |
| Velocidade nadando | 2.20 blocos/s (com Aqua Affinity, mais) |
| Velocidade voando (Criativo) | 10.89 blocos/s (dobro com sprint) |
| Impulso de pulo | `+0.42` por tick (chega a ~1.25 blocos de altura) |
| Bônus de pulo correndo | `+0.2 × direção horizontal` |
| Auto-step (subir degrau) | 0.6 (sobe blocos de meia altura sem pular) |

**Ordem exata de integração por tick** (importa muito para a sensação):
```
1. lê input → vetor de direção normalizado
2. aplica aceleração (chão ou ar) na direção, rotacionada pelo yaw
3. gravidade:  vy = (vy - 0.08) * 0.98
4. move com colisão (sweep AABB por eixo: Y, depois X, depois Z)
5. atrito horizontal: vx *= friction * 0.91; vz *= friction * 0.91
   (friction do bloco EM QUE ESTÁ PISANDO; no ar, 0.91)
6. zera velocidade < 0.003
```

## 3. Colisão

Sweep AABB contra voxels, **um eixo por vez, na ordem Y → X → Z**:

```ts
function moveAxis(aabb, delta, axis) {
  // 1. expandir o AABB pelo delta e coletar todas as AABBs de blocos que interseccionam
  // 2. para cada uma, clampar o delta
  // 3. aplicar
}
```
- Coletar blocos varrendo o range de inteiros (nunca mais que ~4×4×4 por movimento).
- Blocos com múltiplas caixas (escada, cerca, alçapão) retornam array de AABBs.
- **Auto-step**: se o movimento horizontal foi bloqueado e há espaço livre subindo até 0.6,
  tentar de novo com `y += 0.6`. Se couber, aceitar (e aplicar o offset visual suavizado
  em 4 ticks para não "pipocar" a câmera).
- Fluidos não colidem: aplicam **arrasto** (`×0.8` em água, `×0.5` em lava) e empuxo
  (`+0.04/tick` se pressionar pulo/nadar).

> **O empuxo era `+0.02` e foi corrigido em 2026-09-12.** A gravidade dentro d'água é
> `0.08 × 0.25 = 0.02`/tick — exatamente o valor antigo do empuxo, que portanto só **cancelava** a
> gravidade. O que sobrava era o resíduo do arrasto: 0,4 blocos/s para subir contra 1,6 para
> afundar, 2,7 s por bloco, e o jogador era o corpo com menos empuxo do jogo (mob 0,03, barco
> 0,06). Com 0,04 a subida fecha em 2,4 blocos/s, acima do 1,96 de nadar na horizontal — que é a
> relação que faz a água parecer água. Travado em `tests/physics.test.ts`, bloco "nadar".

## 4. Quebra de blocos

Fórmula de **progresso por tick** (0..1, quebra quando ≥ 1):

```
speedMultiplier = 1
if (ferramenta é a correta para o bloco) speedMultiplier = tool.speed
if (encantamento Efficiency n)            speedMultiplier += n² + 1
if (Haste n)                              speedMultiplier *= 1 + 0.2n
if (Mining Fatigue n)                     speedMultiplier *= 0.3^min(n,4)
if (dentro d'água && sem Aqua Affinity)   speedMultiplier /= 5
if (não está no chão)                     speedMultiplier /= 5

damage = speedMultiplier / hardness
if (canHarvest) damage /= 30   else damage /= 100

// canHarvest = bloco não requer ferramenta, OU tem a ferramenta do tier mínimo
```
- Se `damage ≥ 1` no primeiro tick, quebra instantaneamente (ex.: flores, tocha, grama alta).
- **Feedback visual:** overlay de 10 estágios de rachadura sobre o bloco (`destroy_stage_0..9`),
  desenhado como uma segunda passada com `polygonOffset` e blend multiply.
- **Partículas:** 4 partículas por tick com a cor média da textura do bloco.
- Soltar o botão zera o progresso; trocar de bloco alvo zera o progresso.
- Bloco quebrado → drop conforme tabela + som + 8 partículas.

## 5. Colocar blocos

- Raycast DDA (algoritmo de Amanatides & Woo) do olho na direção da câmera, passo por voxel,
  até 4.5 blocos.
- Retorna `{ blockPos, faceNormal, hitPoint }`. Colocar em `blockPos + faceNormal`, a menos que
  o bloco alvo seja `replaceable` (grama alta, neve, água) — aí coloca no próprio.
- **Bloquear** se o AABB do novo bloco intersecta o AABB do jogador ou de qualquer mob.
- Rotação automática: logs pegam o eixo da face clicada; escadas/fornalha/portas pegam a direção
  oposta ao yaw do jogador; escadas invertem se clicar na metade de cima da face.
- Cooldown de colocação: 4 ticks (evita colocar 20 blocos/s segurando o botão).
- **Contorno de seleção:** wireframe preto (`#000`, alpha 0.4, largura 2px) no AABB do bloco
  apontado, com `polygonOffset` para não brigar com o Z.

## 6. Vida, dano e morte

| | Valor |
|---|---|
| Vida máxima | 20 (10 corações) |
| Invulnerabilidade após dano | 10 ticks (500 ms) |
| Knockback | 0.4 horizontal, 0.4 vertical (× (1 − resistência a knockback)) |

**Fontes de dano**
| Fonte | Dano | Nota |
|---|---|---|
| Queda | `floor(distância − 3)` | ignora se caiu em água/feno/slime |
| Sufocamento (cabeça em bloco sólido) | 1 a cada 10 ticks | |
| Afogamento | 2 a cada 20 ticks após a barra de ar zerar | ar = 300 ticks (15 bolhas) |
| Fogo | 1 a cada 10 ticks | + 8 s de "pegando fogo" |
| Lava | 4 a cada 10 ticks | + 15 s de fogo |
| Cactos | 1 a cada 10 ticks de contato | |
| Void (Y < −5) | 4 a cada 5 ticks | ignora armadura |
| Explosão | por distância e obstrução | |
| Mobs | ver [07-mobs-e-ia.md](07-mobs-e-ia.md) | |

**Morte:** tela de morte, dropar todo o inventário no local (Sobrevivência), zerar XP com 
recuperação parcial ao respawnar. Respawn no ponto de spawn do mundo ou na cama.

## 7. Fome e saturação

- Barra de fome: 0–20 (10 coxas). Saturação oculta: 0–20, nunca maior que a fome.
- **Exaustão** acumula; a cada 4.0 de exaustão, tira 1 de saturação (ou 1 de fome se saturação = 0).

| Ação | Exaustão |
|---|---|
| Correr | 0.1 por bloco |
| Nadar | 0.01 por bloco |
| Pular | 0.05 |
| Pular correndo | 0.2 |
| Atacar / receber dano | 0.1 |
| Quebrar um bloco | 0.005 |
| Regenerar 1♥ | 6.0 |

**Regeneração:**
- Fome ≥ 18 e saturação > 0: +1♥ a cada 10 ticks (0,5 s), consome 1.5 de saturação por ♥.
- Fome ≥ 18 e saturação = 0: +1♥ a cada 80 ticks (4 s), custa 6.0 de exaustão.
- Fome ≤ 17: **não regenera.**
- Fome ≤ 6: não pode correr.
- Fome = 0: **inanição**, −1♥ a cada 80 ticks. Para em 10♥ (Fácil), 1♥ (Normal), 0 (Difícil).

**Comer:** segurar botão por 32 ticks (1,6 s), com animação de mordida e partículas do item.
Só pode comer se `fome < 20` (exceto golden apple e leite).

## 8. Experiência (pós-MVP)

- Orbes de XP dropam de mobs, minérios, fundição e pesca. São entidades que voam até o jogador
  num raio de 8 blocos.
- `xpParaProximoNivel(n) = n<16 ? 2n+7 : n<31 ? 5n-38 : 9n-158`.
- Barra verde acima da hotbar; nível em número grande no centro.

## 9. Modo Criativo

- Voo (duplo-toque no pulo / duplo-espaço), sem gravidade, `shift` desce.
- Sem fome, sem dano (exceto void), sem consumo de item ao colocar.
- Quebra instantânea de qualquer bloco (exceto bedrock com clique único? não — quebra tudo).
- Inventário criativo com abas e busca (ver [08-interface-ui.md](08-interface-ui.md)).
- Pick block (roda do meio / segurar no bloco no mobile) coloca o bloco na hotbar.

## 10. Dificuldades

| | Pacífico | Fácil | Normal | Difícil |
|---|---|---|---|---|
| Mobs hostis | não spawnam | sim | sim | sim |
| Dano de mob | — | ×0.5 | ×1.0 | ×1.5 |
| Inanição para em | — | 10♥ | 1♥ | 0 (mata) |
| Fome regenera vida | sempre | sim | sim | sim |
| Creeper explode | não | sim | sim | sim (raio maior) |
| Zumbi arromba porta | não | não | não | sim |
