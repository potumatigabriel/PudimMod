# Plano de melhorias econômicas — PudimMod

Base factual: partidas `2026-08-13_0002` (55 min) e `2026-08-13_0003` (52 min),
replays + log do mod (`pudim.log.20260813-222452` e `pudim.log.20260813-230352`).

---

## 1. O que os dois jogos mostram

Evolução lida dos snapshots do próprio mod (uma linha por minuto):

| Sintoma | Jogo 0002 | Jogo 0003 |
|---|---|---|
| Coletores de pedra/metal antes da fase 2 | 0 (por ~14 min) | 0 (por ~15 min) |
| Pedra/metal parados no estoque inicial | S300 → M caiu a 0 sem ser coletado | S300 M300 intocados |
| Pico de madeira ociosa | 2678 | 4634 |
| Comida no mesmo instante | 210 | 51 |
| Fome (F < 100) ao longo da partida | 6 vezes | 5 vezes |
| Fase 2 | pop 135 (~14 min) | pop 132 (~13 min) |
| Coletores de comida (platô) | 30–42 | 28–50 |
| Máquinas de cerco | 0 a partida toda | 0 a partida toda |

O padrão é o mesmo nas duas: **madeira empilha aos milhares enquanto a comida
zera e pedra/metal nunca abrem.** Isso trava produção de unidades (comida),
trava fase 3 e cerco (metal/pedra) e desperdiça braços na madeira.

---

## 2. Causas encontradas no código

### 2.1 Teto de 45 coletores de comida — a causa principal do platô

`GuiInterface~pudim.js:1508-1686`

```js
const PUDIM_MAX_FARMS = 9;
const PUDIM_FIELD_CAPACITY = 5;
const farmWorkerCap = PUDIM_MAX_FARMS * PUDIM_FIELD_CAPACITY;  // 45
```

Nove fazendas comportam 45 trabalhadores. Passando disso, `findFoodResource()`
não acha vaga, devolve `null`, e o trabalhador **cai para o próximo recurso da
lista — quase sempre madeira**. É exatamente por isso que os coletores de comida
param em 28–50 nas duas partidas enquanto a madeira sobe sem freio: não é escolha
do balanceador, é falta de onde colocar gente na comida.

Com pop 200, 45 coletores de comida não sustentam a produção contínua.

**Ação:** teto de fazendas proporcional à população (ex.: `4 + pop/12`, chegando
a ~20 em pop 200), com o custo em madeira como único freio real. A madeira sobra —
gastá-la em fazendas é o melhor uso disponível.

### 2.2 A regra anti-acúmulo é matematicamente impossível de disparar

`GuiInterface~pudim.js:311-326`

```js
const activeTypes = ["food","wood","stone","metal"].filter(t => weights[t] > 0);
const avgBank = activeTypes.reduce((s,t) => s + bank[t], 0) / activeTypes.length;
if (amt > avgBank * 2 && amt > 600) weights[t] = Math.max(0.5, weights[t] * 0.5);
```

Com os pesos padrão (`food:3, wood:3, stone:0, metal:0`) há **dois** tipos ativos.
Então `avgBank*2 = food + wood`, e a condição vira `amt > food + wood` — impossível,
porque `amt` é uma das duas parcelas. A regra é código morto sempre que o jogador
usa dois recursos, que é o caso padrão.

Confere com o log: madeira a 2863 com comida a 51 e nenhuma redução de peso.

**Ação:** comparar cada recurso com a média **dos outros**, não com a média que o
inclui; e somar um teto absoluto (ex.: acima de 1500 parados, peso cai pela metade
independentemente do resto).

### 2.3 Pedra e metal nunca abrem sozinhos

`pudim_panel.js:280` — `g_PudimResourceWeights = { food:3, wood:3, stone:0, metal:0 }`.

Peso 0 remove o recurso de `activeWeights`, então nenhum trabalhador é enviado
para pedra ou metal enquanto o jogador não mexer no slider. Nas duas partidas isso
só aconteceu depois da fase 2, aos ~14 min — daí `cerc0` a partida inteira.

**Ação:** piso automático por fase. Ao entrar na fase 2, se o jogador não tiver
mexido nos sliders, aplicar `stone:1, metal:1`; na fase 3, `stone:2, metal:2`.
O slider manual continua tendo prioridade absoluta.

### 2.4 Rebalanceamento travado abaixo de pop 100

`GuiInterface~pudim.js:748-751`

```js
if (!bigPopRb && activeGatherers[t].length !== 0) return best;
```

Com pop ≤ 100, um recurso só é considerado carente se tiver **zero** coletores.
Com 6 na comida e 40 na madeira, a comida nunca conta como carente — e o
desequilíbrio só começa a ser corrigido depois de pop 100, quando o estrago
(F42 no jogo 0002 com pop 42) já aconteceu.

**Ação:** trocar o teste binário por um gatilho de fome: se o estoque de um
recurso ativo está abaixo de ~100 e caindo, ele conta como carente
independentemente da população.

### 2.5 Colapso da coleta na fase 3

Snapshots finais: `colet F30 W6 S0 M0` (jogo 0002), `colet F35 W11 S18 M2` (0003).
A coleta praticamente desaparece quando o combate começa. Os sistemas de pânico e
recuo tiram unidades do trabalho, e nada as devolve quando a ameaça passa.

**Ação:** fila de "volta ao trabalho" — quem foi retirado por pânico/recuo é
registrado com o recurso que coletava e reenviado assim que não há inimigo a 100 m.

---

## 3. O que já foi corrigido nesta sessão

**Dropsite antes da coleta** (`pudim_panel.js`) — a construção proativa de armazém
e celeiro rodava *depois* do despacho dos coletores. O log dizia "antes da 1ª
colheita", mas o coletor já tinha saído, enchido a carga e atravessado a base de
volta ao CC antes de a fundação existir. Agora a obra é colocada primeiro e corre
em paralelo com a caminhada de ida. O construtor escolhido é excluído do despacho
no mesmo ciclo, senão a ordem de coleta cancelaria a obra.

**Peso da distância do trabalhador** (`GuiInterface~pudim.js`) — na fórmula de
escolha do recurso, a distância que o trabalhador precisa percorrer valia `0.1`
contra densidade `40`. Uma única árvore a mais num agrupamento pagava por 400 m de
caminhada, então o mod atravessava a base para começar a coletar. Passou para
`1.5` (madeira/pedra/metal) e `1.0` (comida): cada árvore extra compra ~27 m de
viagem. A densidade ainda decide entre matas parecidas, mas parou de justificar a
travessia do mapa.

O guard de comida foi reancorado junto: ele testava `maxScore < -200`, e com o
peso novo passaria a rejeitar frutas coladas no celeiro só porque o trabalhador
estava longe. Agora testa a distância recurso→dropsite diretamente (`> 100 m`),
que é o que ele sempre quis medir.

**Casa nasce onde o construtor está** — `pudim_GetAutoHouseData` decidia *onde*
antes de *quem*: a âncora era o centroide de todas as unidades capazes de
construir (a base inteira, ou seja, o CC), e os construtores eram escolhidos
depois, sem olhar distância. Agora escolhe-se o construtor-semente primeiro e a
casa é ancorada nele; os ajudantes são os mais próximos, até 60 units.

**Construtor continua contando no balanceamento** — quem está com ordem `Repair`
some de `activeGatherers`, então mandar 15 aldeãs erguer 3 fazendas zerava a
comida no censo, o déficit aparente disparava e cada unidade recém-nascida ia
para a comida; quando as obras terminavam, sobrava gente demais lá. O painel
agora guarda a última coleta observada de cada unidade (`g_PudimGathererRes`),
salva a cada ciclo **antes** de qualquer despacho, e a simulação conta o
construtor no recurso de origem — nos dois lados da cota, para não recriar a
incoerência que motivou a exclusão original. O censo também passou a rodar antes
dos filtros de "não tocar": eles existem para não dar ordem à unidade, não para
fingir que ela não existe (quem estava sob ordem manual sua também sumia da conta).

Junto veio um guard que nunca funcionou: o painel envia `repeatBuilders` (array)
e a simulação lia `data.repeatBuilding` (objeto). O nome nunca chegou, então os
trabalhadores do repeat-build eram despachados por cima da própria obra.

**Rotatividade de despachos** — nos replays de 13/08, 25% das reordenações
chegavam em menos de 30 s, antes de o trabalhador alcançar o alvo anterior (132 e
86 casos). O detector de long-walker atua sobre unidades **não ociosas** — ou
seja, exatamente as que estão em trânsito — e não consultava carência nenhuma: a
única que existia (`g_PudimDispatchedAt`, 6 s fixos) era aplicada só ao filtro de
`idleWorkers`. Resultado: auto-work despachava, e no ciclo seguinte (500 ms) o
long-walker desfazia.

Agora há uma segunda janela, `g_PudimInTransitUntil`, dimensionada pela distância
da viagem (`6 s + 160 ms/unit`, teto de 45 s), consultada apenas pelo detector de
long-walker. A separação é essencial: `g_PudimDispatchedAt` filtra `idleWorkers`,
que por construção só contém unidades **ociosas** — alongar aquela carência faria
o oposto do pretendido, deixando parado até 45 s quem teve a ordem falhada.

`PUDIM_WALK_MS_PER_UNIT = 160` é constante de ajuste, não medição: ~6,2 units/s
contra ~8 units/s reais de um aldeão, com folga para terreno e pathfinding. Se a
janela ficar curta ou longa demais, é esse número que se mexe.

O SNAP passou a registrar `chrn` (reordens em menos de 30 s no último minuto) e
`seg` (redirects barrados pela janela). São eles que dizem se o ajuste pegou.

---

## 4. Ordem sugerida de execução

| # | Item | Impacto | Risco |
|---|---|---|---|
| 1 | Teto de fazendas por população (2.1) | Alto — destrava a comida | Baixo |
| 2 | Corrigir regra anti-acúmulo (2.2) | Alto — para de empilhar madeira | Baixo |
| 3 | Gatilho de fome no rebalanceamento (2.4) | Alto — evita F<100 no início | Médio |
| 4 | Piso de pedra/metal por fase (2.3) | Médio — destrava fase 3 e cerco | Baixo |
| 5 | Volta ao trabalho pós-combate (2.5) | Médio — sustenta a eco tardia | Médio |

Itens 1 e 2 são mudanças de poucas linhas com causa comprovada nos dois logs —
valem como primeiro lote, medindo o resultado em uma partida antes de seguir.
