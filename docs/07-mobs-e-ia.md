# 07 — Mobs, IA e Spawn

## 1. Modelo de mob

```ts
interface MobDef {
  id: number;
  name: string;
  display: string;
  category: 'passive' | 'neutral' | 'hostile' | 'ambient';
  health: number;
  width: number; height: number;       // hitbox
  speed: number;                       // blocos/s (jogador: 4.317 andando, 5.612 correndo)
  attack?: { damage: [easy: number, normal: number, hard: number]; reach: number; cooldownTicks: number };
  followRange: number;                 // raio de detecção do jogador
  drops: Drop[];
  xp: [min: number, max: number];
  spawn: SpawnRule;
  goals: GoalName[];                   // IA declarativa, em ordem de prioridade
  model: ModelName;                    // geometria (ver §5)
  sounds: { ambient: string; hurt: string; death: string; step: string };
  burnsInSunlight?: boolean;
  fireImmune?: boolean;
  despawnable: boolean;                // hostis somem longe do jogador; passivos não
}
```

## 2. Tabela de mobs — MVP

### Passivos

| Mob | HP | Hitbox | Vel. | Drops | Spawn |
|---|---|---|---|---|---|
| **Vaca** | 10 | 0.9×1.4 | 1.25 | 0–2 couro, 1–3 carne crua (cozida se morrer em fogo) | grass, luz ≥ 9, grupos de 2–4 |
| **Porco** | 10 | 0.9×0.9 | 1.25 | 1–3 porco cru | grass, luz ≥ 9, grupos de 2–4 |
| **Ovelha** | 8 | 0.9×1.3 | 1.25 | 1 lã (cor), 1–2 carneiro cru | grass, luz ≥ 9, grupos de 2–3. 15% de chance de cor rara |
| **Galinha** | 4 | 0.4×0.7 | 1.1 | 1 pena, 1 frango cru | grass, luz ≥ 9, grupos de 4. Cai devagar (planador), põe ovo a cada 5–10 min |
| **Lula** | 10 | 0.8×0.8 | 1.0 | 1–3 saco de tinta | em água, Y 45–62 |

Comportamento passivo: `panic` ao levar dano (corre 2 s), `wander` (30% de chance por segundo de
escolher um ponto num raio de 10), `lookAtPlayer`, `followItem` (segue quem segura o item de
reprodução: trigo para vaca/ovelha, cenoura para porco, sementes para galinha).

**Reprodução (pós-MVP):** alimentar dois adultos → modo amor 30 s → filhote → cooldown 5 min.
Filhote vira adulto em 20 min.

### Neutros

| Mob | HP | Dano (E/N/H) | Notas |
|---|---|---|---|
| **Lobo** | 8 | 3/4/6 | Ataca em bando se um for atacado. Domável com osso (1/3 de chance). Domesticado: senta, segue, ataca o alvo do dono, HP 20 |
| **Enderman** | 40 | 4/7/10 | Só fica hostil se você olhar para a cabeça dele por 0,5 s ou atacá-lo. Teleporta ao levar dano ou tomar chuva. Pega e coloca blocos. Altura 2.9 |
| **Aranha** | 16 | 2/2/3 | Hostil no escuro (luz ≤ 11 na posição dela), neutra na luz. Escala paredes. Hitbox 1.4×0.9 |

### Hostis

| Mob | HP | Dano (E/N/H) | Vel. | Drops | Spawn |
|---|---|---|---|---|---|
| **Zumbi** | 20 | 2/3/4 | 3.7 | 0–2 carne podre, 2.5% ferro/cenoura/batata | luz ≤ 0, grupos de 4. Queima no sol. Afunda na água |
| **Esqueleto** | 20 | flecha 1–5 | 4.0 | 0–2 osso, 0–2 flecha | luz ≤ 0. Queima no sol. Atira a cada 2 s a até 15 blocos, com strafing |
| **Creeper** | 20 | explosão | 3.4 | 0–2 pólvora, disco se morto por esqueleto | luz ≤ 0. **Não queima no sol.** Pavio 1,5 s, raio 3, dano até 49 |
| **Aranha** | 16 | 2/2/3 | 4.2 | 0–2 linha, 0–1 olho de aranha | luz ≤ 0, escala paredes |
| **Slime** | 1/4/16 (por tamanho) | 0/2/4 | 1.9 | bola de slime (só tamanhos ≥2) | swamp Y 50–70 à noite, ou chunks-slime abaixo de Y=40. Divide ao morrer |
| **Zumbi afogado** (pós-MVP) | 20 | 2/3/4 | 3.2 | idem zumbi + tridente raro | água |

> **As velocidades de hostil e neutro foram corrigidas em 2026-09-12** (lobo 4.8, enderman 4.5).
> A tabela dava 1,05 a 1,5 blocos/s — **um quarto** dos 4,317 do jogador caminhando. Somado a um
> bug que fazia o mob atingir só 46% do número declarado (ver doc 15 §4), o zumbi perseguia a
> 0,53 blocos/s: de dentro do jogo ele não parecia perseguir ninguém, e o jogador relatou que
> "os monstros estão muito lentos" e que "não me seguem".
>
> A régua agora é o jogador: **todo hostil fica entre caminhar (4.317) e correr (5.612)**. Não dá
> para escapar caminhando — a distância cresce devagar demais para salvar quem hesita — e dá para
> escapar correndo, ao preço da fome. Passivo continua lento de propósito: ele não persegue.
> Travado em `tests/mobs.test.ts`, bloco "perseguição".

Comportamento hostil padrão (`goals` em ordem):
```
1. floatInWater      — não afogar
2. attackMelee       — se alvo a ≤ reach, ataca com cooldown
3. moveToTarget      — pathfinding até o jogador
4. avoidSunlight     — (zumbi/esqueleto) procurar sombra de dia
5. wander            — sem alvo
6. lookAround
```

**Aquisição de alvo:** a cada 10 ticks, procurar o jogador mais próximo dentro de `followRange`
(16 blocos padrão, 32 se você atacou) **com linha de visão** (raycast simples de 4 amostras).
Perde o alvo se sair de `followRange × 2` ou depois de 5 s sem linha de visão.

## 3. Pathfinding

Alvo: **barato o suficiente para rodar em celular com 20 mobs.**

- **A\*** em grade 3D com nós de 1 bloco, mas com **limite duro de 200 nós expandidos por
  requisição** e no máximo **2 requisições por tick no mundo todo** (fila round-robin entre mobs).
- Heurística: distância euclidiana. Custo de aresta: 1 horizontal, 1 diagonal ×1.41,
  +0.5 para subir, penalidade alta para água/lava/fogo/cactos.
- Um nó é caminhável se: bloco livre na altura do mob, chão sólido embaixo, sem dano.
- Caminho recalculado no máximo a cada 20 ticks ou quando o alvo se mover > 2 blocos.
- **Fallback quando o A\* falha ou estoura o orçamento:** "steering" simples — andar direto na
  direção do alvo, pular se bater numa parede de 1 bloco, contornar aleatoriamente se travar
  por 1 s. Na prática 80% dos casos resolvem assim e é praticamente grátis.

## 4. Regras de spawn

**Ciclo de spawn a cada 20 ticks (1 s), por categoria:**

```
1. Contar mobs vivos da categoria dentro dos chunks carregados.
2. Se count >= cap × (chunksCarregados / 289), pular.
3. Escolher chunk aleatório entre os carregados (distância 1..simulationDistance do jogador).
4. Escolher (x, z) aleatório no chunk. O y é a superfície para quem precisa de luz;
   para quem precisa de escuro, é a superfície em 60% das tentativas **quando é noite**,
   e aleatório entre 0 e a altura do heightmap no resto.
5. Tentar 3 posições próximas (±5 em cada eixo).
6. Validar: bloco sólido embaixo, 2 blocos de ar (ou a altura do mob),
   luz adequada, bioma permite, não é bedrock/folha/vidro/slab,
   distância do jogador entre 24 e 128 blocos (hostis) ou 24+ (passivos).
7. Spawnar um "pack" de 1..4 do mesmo tipo em posições próximas.
```

Os caps são para 289 chunks (17×17) e escalam com o tier pelo fator `maxMobs / 70` — o mesmo
número que o preset do aparelho já usa para o teto de hostis. Um cap por categoria escrito à mão
por tier seria mais uma tabela para manter em sincronia com `core/tier.ts`; a proporção sai de
graça e mantém o equilíbrio entre categorias igual em todo aparelho. Passivo e aquático têm piso
(4 e 1) para que o mundo de T0 não fique sem bicho nenhum.

| Categoria | Cap base | T0 | T1 | T2 | Condição de luz |
|---|---|---|---|---|---|
| Hostil | 70 | **20** | 40 | 70 | luz de bloco ≤ 0 e (luz do céu ≤ 7 ou está de noite) |
| Passivo | 10 | 4 | 6 | 10 | luz do céu ≥ 9, bloco = grass_block |
| Ambiente (morcego) | 8 | 2 | 5 | 8 | luz ≤ 4, Y < 63 |
| Aquático (lula) | 5 | 1 | 3 | 5 | em água |

**Estes números da coluna do tier são o cap efetivo com o mundo carregado.** O passo 2 ainda
multiplica por uma prontidão, mas ela **satura em 1**: só reduz enquanto há menos mundo carregado
que a área simulada do tier — aí um cap cheio encheria de zumbi um punhado de chunks —, e nunca
aumenta.

> **Corrigido em 2026-09-12.** A multiplicação era `chunksCarregados / 289`, sem teto, e punia
> duas vezes: a coluna do tier já reduz pelo aparelho. Medido no mesmo mundo, o cap de hostis saía
> **8 no T0** (RD 4, ~113 colunas), 44 no T1 e **148 no T2** — ou seja, T0 com oito hostis
> espalhados por 113 colunas, que é o que fazia a caverna parecer vazia, e T2 estourando o próprio
> teto de 70 mobs vivos do doc 02 §1. A referência passou a ser a área **simulada**, onde o mob de
> fato vive, e não a de render. Travado em `tests/spawn.test.ts`.

> **Por que a distância mínima é 1 chunk e não 2.** Com 2, o spawn só acontecia a ≥32 blocos
> — exatamente onde começa o despawn suave abaixo. Todo hostil nascia condenado e nenhum
> sobrevivia o bastante para chegar ao jogador: medindo 151 hostis vivos, **zero** estava
> dentro dos 16 blocos do `followRange`, e andando 3 minutos de noite o jogador não
> encontrava nenhum. Com 1, a faixa de 24 a 32 blocos volta a existir — o mob nasce ali,
> não despawna, e te acha. Quem garante o mínimo real continua sendo o passo 6.
>
> **Por que o viés de superfície à noite.** Com o y uniforme de 0 até a superfície e o chão
> em y≈68, ~2/3 dos hostis nasciam dentro da pedra ou em caverna e a noite a céu aberto
> ficava vazia. Com 60%, a superfície fica povoada sem esvaziar as cavernas.

**Spawn inicial de passivos:** ao gerar um chunk pela primeira vez, 10% de chance de popular com
um pack de animais do bioma. Isso é o que faz o mundo já nascer com bichos.

**Despawn:**
- Hostil a > 128 blocos do jogador: despawna imediatamente.
- Hostil a > 32 blocos: 1/800 de chance por tick de despawnar.
- Mobs com nome, domados ou com item de armadura: nunca despawnam.
- Passivos nunca despawnam (por isso o cap é baixo).

**Spawner (dungeon):** ativa quando um jogador está a ≤ 16 blocos; spawna 4 mobs a cada
10–40 s num raio de 4, até haver 6 do mesmo tipo por perto.

## 5. Modelos e animação

Modelos são **caixas** (paralelepípedos com UV de "box mapping"), como no original. Definidos como
dados:

```ts
const ZOMBIE_MODEL: ModelDef = {
  texture: 'entity/zombie', texSize: [64, 64],
  parts: [
    { name:'head',     pivot:[0,24,0],   box:[-4,0,-4, 8,8,8],  uv:[0,0]  },
    { name:'body',     pivot:[0,24,0],   box:[-4,-12,-2, 8,12,4], uv:[16,16] },
    { name:'armRight', pivot:[-4,22,0],  box:[-3,-12,-2, 4,12,4], uv:[40,16] },
    { name:'armLeft',  pivot:[4,22,0],   box:[-1,-12,-2, 4,12,4], uv:[40,16], mirror:true },
    { name:'legRight', pivot:[-2,12,0],  box:[-2,-12,-2, 4,12,4], uv:[0,16] },
    { name:'legLeft',  pivot:[2,12,0],   box:[-2,-12,-2, 4,12,4], uv:[0,16], mirror:true },
  ]
};
```

**Animação (procedural, sem keyframes — é assim que o original faz e é o mais barato):**
```
limbSwing  = distância percorrida acumulada
limbAmount = min(velocidadeHorizontal * 4, 1)

legRight.rotX =  cos(limbSwing * 0.6662) * 1.4 * limbAmount
legLeft.rotX  =  cos(limbSwing * 0.6662 + PI) * 1.4 * limbAmount
armRight.rotX =  cos(limbSwing * 0.6662 + PI) * 2.0 * limbAmount
armLeft.rotX  =  cos(limbSwing * 0.6662) * 2.0 * limbAmount
head.rotY     =  yawRelativo (clamp ±75°)
head.rotX     =  pitch (clamp ±40°)
// zumbi: braços travados à frente → armX.rotX = -PI/2 + sin(age*0.09)*0.05
```

**Renderização:** todos os mobs do mesmo tipo em **uma draw call instanced**. Cada instância
manda a matriz do corpo + as rotações das partes empacotadas. Em T0, limitar a 20 mobs visíveis
e desligar sombra.

**Sombra:** blob circular escuro projetado no chão (quad com textura radial), opacidade por
distância vertical. Desligável.

## 6. Entidades não-mob

| Entidade | Notas |
|---|---|
| `ItemEntity` | ver [05-itens-e-receitas.md](05-itens-e-receitas.md) §9 |
| `FallingBlock` | areia/cascalho caindo; vira bloco ao pousar, ou dropa item se não couber |
| `TntPrimed` | pavio de 80 ticks, explosão raio 3 |
| `Arrow` | gravidade 0.05, arrasto 0.99, dano por velocidade, crava no bloco |
| `XpOrb` | voa até o jogador a ≤ 8 blocos |
| `Explosion` (não é entidade, é evento) | raycast em 16³ direções, força por resistência do bloco, dano por distância, 30% dos blocos dropam item |
