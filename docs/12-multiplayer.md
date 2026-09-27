# 12 — Multijogador (pós-MVP, marco M20)

Fora do MVP, mas **a arquitetura precisa nascer com os ganchos certos** ou refatorar depois custa
caro. Este documento define o que deve ser respeitado desde o dia 1.

## 1. Regras de arquitetura a seguir desde já

1. **Toda mutação do mundo passa por um único ponto:**
   `world.setBlock(x, y, z, state, source)`. Nunca escrever no array de voxels direto a partir da
   UI ou da física. Isso é o que permite plugar rede depois.
2. **O estado do jogo é separado do render.** Nada de guardar posição só na câmera.
3. **Tudo é determinístico a partir da seed** — dois clientes com a mesma seed geram o mesmo mundo,
   então só é preciso sincronizar *diferenças*.
4. **Comandos, não estados:** ações do jogador são objetos serializáveis
   (`{t:'break', x,y,z}`, `{t:'place', x,y,z,item}`, `{t:'move', x,y,z,yaw,pitch}`).
5. Tick numerado globalmente (`totalTicks`), usado como timestamp lógico.

## 2. Opção A — P2P via WebRTC, só na rede local (decidida em 2026-09-27)

> Revisto em 2026-09-27 por decisão do usuário: *"exclusivamente local (…) evitando assim qualquer
> problema de segurança ou principalmente necessidade de servidores reais"*. O marco é o **M20** do
> [doc 14](14-roadmap.md). A versão anterior desta seção previa um servidor de sinalização e um
> código de sala de 6 caracteres; os dois saíram.

- Um jogador é o **host** (autoritativo), e **só o aparelho que tem o mundo pode ser host**. Os
  outros são clientes, e não guardam nada do mundo.
- **Sem servidor de nenhum tipo.** `RTCPeerConnection` com `iceServers: []`: sem STUN e sem TURN,
  a ligação só encontra os endereços da rede local. Quem está fora da rede não conecta.
- **Sinalização pela tela:** o host mostra um QR code (e um código em texto) com a descrição
  compacta da ligação; o cliente lê e mostra o QR de resposta, que o host lê. Uma página web não
  consegue anunciar uma sala na rede, então "ver a sala" é ver a tela do host.
- `RTCDataChannel` com `ordered: false, maxRetransmits: 0` para posição (não importa perder um
  pacote antigo) e um segundo canal `ordered: true` confiável para blocos, inventário e chat.
- Dados do cliente (posição, inventário, vida, XP) ficam no save do host, em `STORE_PLAYERS`,
  chaveados por `[worldId, playerId]`; o `playerId` é estável e mora no aparelho do cliente.
- O código de rede é um pedaço de bundle à parte: jogar sozinho não baixa nem roda nada dele.
- Limite prático: **4 jogadores com host T0, 6 com host T1+** (o host de celular não aguenta mais).

## 3. Opção B — Servidor Node com WebSocket

Se algum dia quiser servidores dedicados: mesmo protocolo, mas o servidor roda a simulação
autoritativa e o cliente só prevê. Mais caro e desnecessário para o escopo deste projeto.

## 4. Protocolo (esboço, binário)

Todo pacote: `u8 type | payload`. Usar `DataView`, nunca JSON no caminho quente.

| Tipo | Direção | Payload |
|---|---|---|
| `0x01 HELLO` | C→S | protocolVersion, nome, uuid |
| `0x02 WELCOME` | S→C | worldMeta, playerId, spawn |
| `0x10 CHUNK` | S→C | cx, cz, dados serializados (só se diferir da geração) |
| `0x11 BLOCK_CHANGE` | ambos | x, y, z, state |
| `0x12 MULTI_BLOCK` | S→C | lista (explosão, fluido) |
| `0x20 PLAYER_MOVE` | ambos | id, x, y, z (fixed-point 1/32), yaw, pitch (u8), flags |
| `0x21 PLAYER_SPAWN/DESPAWN` | S→C | |
| `0x22 PLAYER_ACTION` | C→S | tipo, alvo (quebrar, colocar, atacar, usar) |
| `0x30 ENTITY_UPDATE` | S→C | batch de mobs (id, pos delta, estado) — 10 Hz |
| `0x40 INVENTORY` | S→C | slot, item, count |
| `0x50 CHAT` | ambos | texto |
| `0x60 TIME` | S→C | totalTicks, weather |

**Taxas:** posição do jogador 20 Hz; entidades 10 Hz com delta compression; blocos por evento.

> **O que o M20 implementou (2026-09-27)** — `src/net/protocol.ts` é a referência. Os tipos
> mudaram de número e de forma: `HELLO` leva também a impressão digital do conteúdo e os mods;
> o chunk é **pedido** pelo convidado (`CHUNK_REQ`/`CHUNK`, e o anfitrião responde "nada" quando
> a coluna nunca mudou); um só `BLOCKS` em lote nos dois sentidos, com a posição de quem pede e o
> estado anterior, e `BLOCK_DENY` na volta; mobs a 20 Hz sem delta (`MOBS`); o inventário não
> viaja por slot — o convidado manda o próprio save a cada 10 s (`SAVE`). O clima não viaja: sai
> do `totalTicks` (`TIME`). Na segunda volta (protocolo 2) entraram:
> - `CHAT`;
> - `ATTACK`/`LOOT`/`HURT` (combate com mobs);
> - `OPEN`/`CONTAINERS`/`CSET`/`CLOSE`/`CONTAINER_GONE` (contêineres, com o registro do save em
>   JSON — mensagem rara);
> - `SLEEP`/`SLEEP_STATE`/`WAKE`;
> - `SIGN`.
>
> Detalhe no doc 15 §3, M20.

## 5. Predição e reconciliação

- **Client-side prediction** do próprio jogador (aplica o input local imediatamente).
- Guardar os últimos 60 inputs; ao receber a posição autoritativa do host, se divergir > 0.1 bloco,
  fazer *rewind* e reaplicar os inputs seguintes.
- **Interpolação** de outros jogadores/mobs com 100 ms de buffer (renderiza o passado, fica suave).
- Blocos: aplicar localmente na hora (otimista) e reverter se o host negar. A latência de colocar
  bloco é a coisa mais perceptível — nunca esperar o round-trip.

## 6. Segurança mínima

Mesmo em P2P entre amigos: o host valida alcance (≤ 6 blocos), cooldown de ações, e se o jogador
realmente tem o item. Não confiar no cliente.

> **No M20 (2026-09-27), em parte:** o alcance é validado, com 10 blocos em vez de 6 (folga do
> atraso), e só onde o host tem a coluna carregada. Cadência, item no inventário e o *rewind* do
> §5 não existem: inventário e movimento do cliente são confiados — desvio consciente, escrito no
> comentário de `src/net/host.ts`.
