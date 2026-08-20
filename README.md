# PudimMod — a 0 A.D. utility mod

A quality-of-life mod for **0 A.D. Alpha 28 (Boiorix)**. It cuts micromanagement, automates the
economy and adds tactical tooling — without ever desyncing a multiplayer match.

Everything runs in the GUI layer and every action goes out as a standard network command, so all
clients stay in lockstep. **Players and spectators without the mod can join your match**: nothing the
mod ships under `simulation/` changes how the game simulates, and `tools/test_mp_safety.js` enforces
that as a contract rather than a promise — it fails the build if a file there ever gains executable
code, component state, a non-vanilla network command, or a Math function the engine has not made
deterministic.

> **No dependencies beyond 0 A.D. itself.** PudimMod ships its own `pudim_patchApplyN`
> helper for patching vanilla functions, so it does not need AutoCiv — and because the
> helper lives in its own namespace, running both mods together causes no conflict.

---

## Installation

Download the repository (**Code → Download ZIP**, or `git clone`) and put the `PudimMod`
folder inside your 0 A.D. `mods` directory:

| System  | Path |
|---------|------|
| Windows | `%APPDATA%\0ad\mods\` — or `Documents\My Games\0ad\mods\` |
| Linux   | `~/.local/share/0ad/mods/` |
| macOS   | `~/Library/Application Support/0ad/mods/` |

If you are unsure, the game's own reference is at
<https://trac.wildfiregames.com/wiki/GameDataPaths>.

The folder must sit directly inside `mods/`, so that `mods/PudimMod/mod.json` exists — a
common mistake is ending up with `mods/PudimMod/PudimMod/`.

Then open 0 A.D., go to **Settings → Mod Selection**, pick **PudimMod**, click **Enable**,
then **Save Configuration** and **Start Mods**.

To update, replace the folder with the newer version and restart the game.

---

## Control panel

Open it from the pudim icon in the top bar. The header has three buttons: **▼ / ▶** collapses the
panel down to just the combat estimator, **Log** opens the log viewer, **X** closes the panel.

Every control has a tooltip explaining what it does, in English or Portuguese depending on the
game's language.

---

## Combat estimator

Side-by-side readout of your forces and the enemy's: unit count, total HP, DPS, and a breakdown by
type (melee/ranged infantry, cavalry, siege, support). A win-probability bar summarises it. Updates
on its own, and **Refresh Estimate** recomputes on demand.

## Economy

**Auto-work** sends idle citizens to gather, following per-resource quotas you set with the
food / wood / stone / metal sliders. Every match starts at **food 3, wood 4, stone 0, metal 0** —
wood above food, because phase 1 spends wood on houses, storehouses and fields faster than it spends
food. The sliders are yours: set a resource to zero and the mod never assigns anyone to it, and your
values are never written to disk, so every match starts from the same known state.

- Cavalry never gathers. It stays free for combat and scouting, but **does hunt animals inside your
  own territory** — and only those, so it never chases a fleeing animal across the map.
- Soldiers gather berries, never farm fields (that would fight with the farm logic).
- Workers already gathering are **rarely** pulled to another resource: moving one costs the whole
  round trip. Below 100 population it only happens when a resource has *zero* coverage and another
  is 20 workers over quota. Above 100 population, where one worker is noise, normal rebalancing
  resumes. New units coming out of production are always the preferred way to fill a gap.

**Farms** — built once berries can no longer keep up, capped at **9 farms**. Each field holds 5
gatherers, so the mod targets at most 45 farm workers. It only redirects workers to existing farms
instead of building when the free slots cover the whole shortfall.

A **stock brake** sits in front of all of it: the gathering ratio splits workers by weight, not by
need, so on its own it would keep asking for fields with the granary overflowing. Before computing
any shortfall the mod compares the food stock against what you could still spend — 40 per free
population slot plus a 1000 cushion — and stops building and assigning above that. The comfort level
scales with population headroom, so 60/200 with 4000 food still plants (that food will become units)
while 195/200 with the same 4000 does not.

**Proactive dropsites** — a storehouse goes up next to distant forest, and a farmstead next to
distant fruit, *before* workers waste time walking. It skips spots near enemy civic centres.

- The anchor is **density weighted by distance to the crew** (`density / (1 + distance/50)`), not
  raw density. Delivery is a round trip, so a far tree yields less per minute: the biggest forest on
  the map no longer wins over the one your team is actually cutting.
- Detection fires **while the gatherers are still walking**, not after they arrive. The order that
  carries them there (`GatherNearPosition`) is now read too, so the foundation goes up in parallel
  with the trip instead of after the first long delivery.
- **Dropsite foundations count as dropsites.** During the ~30 s of construction the dispatcher used
  to score that forest as uncovered and keep sending people elsewhere.
- **Gatherers follow the dropsite they built.** When the work is done — tracked by the foundation
  itself, not by a timer — the builders gather right there instead of falling back to the global
  best-scoring resource, which was usually the forest they came from.
- A farmstead is approved by **how much fruit is actually left within reach** (200, one full bush
  and twice the farmstead's wood cost), not by counting bushes. One full bush is worth it; three
  stripped ones are not.

**Long-walk detection** — a gatherer whose resource is too far from a dropsite gets either a new
dropsite next to the resource, or a move to the same resource type near an existing one. "Too far"
is computed, not guessed: filling a load takes `capacity / rate` and the round trip takes
`2 × distance / speed`, so the break-even is `capacity × speed / (2 × rate)` — about **45 m for
fruit, 64 m for wood, 129 m for stone and metal**. It reads the unit's own components, so gathering
and speed upgrades move the threshold on their own.

**Auto-queue** keeps the training queue full at the civic centre and barracks and works around the
engine bug that silently shrinks a batch when resources run short.

**It never changes the unit type you picked.** Whatever you put in a building's queue is what gets
refilled there — no villager preference, and the 50-female cap does not override it either. The mod
only chooses the type in a building where you never chose anything. Batch size follows you too: put
5, get 5 back. Only the *quantity* adapts to your stock (fewer when short, back to full when the
bank recovers) — never the type. It also stops re-enabling auto-queue at the population cap or with
no resources, where the engine refuses and prints an error across your screen.

**Auto-houses** builds houses before the population cap blocks training, with a cooldown that adapts
to how many production buildings you own.

**Auto-research** is deliberately limited to the **storehouse, farmstead and forge** — never the
civic centre, fortress or barracks, and it never advances the phase: that stays your call. Priority
follows the phase: phase 1 unlocks food, wood and carrying capacity; phase 2 adds stone and metal;
phase 3 adds combat and health. **Stone and metal techs skip the wait when their slider is above
zero** — a weight above zero means someone is mining now, so speeding that up already pays off. Carrying-capacity techs (Baskets → Wheelbarrow → Cart) rank highest
among gathering techs, since they add to all four resources at once. A tech that never reaches the
queue within 90 s is blacklisted for the session.

**Smart market** barters surplus for whatever is running short.

## Military

- **Auto-kite** — ranged units step away from melee attackers and are given a queued attack order,
  so they resume fighting instead of standing still after repositioning.
- **Auto-retreat** — units below 20% health pull back to a healer or temple.
- **Focus fire** — your soldiers concentrate on one target instead of each picking a different enemy.
- **Defensive garrison** — workers shelter in nearby buildings during a raid and come back out once
  it is calm, with cooldowns that prevent the garrison/ungarrison loop that used to stall the economy.
  Houses come first (there are many, they are spread out, and it leaves the civic centre free for the
  military garrison that makes it shoot), then the civic centre, and a threatened shelter still beats
  open ground. Within each tier the nearest one wins. **With every shelter full they run** — away
  from the attacker, far enough to leave its actual weapon range.
- **Panic mode** — on a serious attack, everything stops and the workers are protected. **Back to
  Work** returns them. Panic needs **real hostility**, not proximity: an enemy counts only if it has
  an attack order on something of yours or an ally's, or if it is standing inside your territory.
  Troops passing by on their way to fight someone else no longer trigger it. If your civic centre is
  gone, or a shelter is under siege, the mod never ungarrisons on its own — that stays your call.
- **Counter-train** — trains units that answer what the enemy actually has on the field.

## Scouting

Select cavalry and pick a mode:

- **Local** — spirals over your whole base, inner ring outward, one full sweep per revolution. It
  prefers what nobody is watching right now, so it closes blind spots instead of pacing the outer
  rim.
- **Deep** — heads for the **far side of the map**, away from your base and your allies', because
  that is where the enemy usually is. It never re-covers ground already explored — yours *or an
  ally's*, since the engine's shared line of sight is what it reads. Once the enemy base is found it
  **follows the border of their territory** rather than a fixed ring, skipping arcs it has already
  opened. Nothing that shoots ever gets in range: destination *and route* are checked against every
  enemy attacker's real reach, and sectors that shot at it go on a blacklist. Surrounded, it retreats
  home — surviving comes first.

On contact the scout **runs directly away from the enemy**, not back to the base, and only resumes
exploring after two consecutive clear checks. Enemy structures blacklist their sector permanently;
mobile troops blacklist it for three minutes. Anti-stuck detection handles lakes and impassable
terrain, and any manual order you give hands control straight back to you.

## Awareness

**Ally bar** — a live line per player in your team: name in that player's map colour, phase, pop,
the four resources, gatherers per resource, kills/deaths and army composition. It flashes while a
player is advancing a phase and when they are under attack.

**Auto-flare** marks a real battle on the minimap. It is **local only** — it never notifies the
other players — and fires **once per battle**, at the centre of the largest cluster of fighting, and
only when at least three units are engaged. Hunting animals is not a battle and never triggers it.

**Strategic advisor** offers a running read on the match, with a button to jump the camera to
whatever it is talking about.

**Repeat build** — a builder places the next foundation adjacent as soon as it finishes one.

## Match log

Everything the mod decides is recorded, and once a minute a **snapshot** is appended: population,
phase, all four resources, gatherers per resource, army composition, kills/deaths, and whether you
are in combat. The log is kept **per match** (not per day) and the **last 10 matches** are retained,
so a whole game can be read back from start to finish without filling the disk.

## Chat translation

Moved out into its own mod, **PudimTranslate** — click a chat message to translate it, in a
match, in the lobby and in the match setup screen. It is independent: it does not require
PudimMod, and PudimMod does not require it.

## Language

Portuguese or English, detected automatically from the game's language. To force one, set
`pudim.lang` to `pt` or `en` in the user config.

## Changelog

### 2026-08-19

**Economy**

- Gathering priorities start every match at **food 3 / wood 4 / stone 0 / metal 0**, and are no
  longer written to disk.
- Farm cap back to a fixed **9** (45 farm workers). The population-proportional cap it had replaced
  fixed a food shortfall but produced 15 fields and 66 food workers with 7900 food banked.
- New **stock brake**: no new field and no extra food worker while the food stock is above what the
  remaining population headroom could spend.
- A farmstead is now approved by **how much fruit is left within reach** (200 = one full bush =
  twice its wood cost) instead of by counting bushes. It was refusing to build next to a single full
  bush while gatherers walked across the base — three cycles in a row in the log.
- Storehouse anchor is **density weighted by distance to the crew**, so it lands in the forest your
  team is cutting rather than the biggest one on the map.
- **Dropsite foundations count as dropsites.** They carry no `ResourceDropsite` component
  (`special/filter/foundation.xml` is a filtered entity), so during construction the dispatcher
  scored that forest as uncovered and kept sending people elsewhere.
- **Gatherers follow the dropsite they built**, once the foundation is actually gone — tracked by the
  foundation, not by a timer. Timing it by builder idleness pulled builders off unfinished
  foundations: one farmstead sat 79 s with four builders and the food stock hit zero.
- Detection of "far from a dropsite" now fires **while the gatherers walk**, not after they arrive.
- **Long-walk threshold is computed per resource** from the unit's own capacity, gather rate and walk
  speed — about 45 m for fruit, 64 m for wood, 129 m for stone and metal, replacing a flat 100 m.
- Every gather-near-position order now carries the resource subtype. Without it the engine's
  FINDINGNEWTARGET state matches nothing and the gatherer stops after emptying one target.
- **Auto-queue never changes the unit type you picked.** It rebuilt the choice from scratch on every
  refill, with an explicit villager preference, so 5 warriors queued at the civic centre came back as
  2 villagers. What you queue in a building is now what gets refilled there, at your batch size; only
  the quantity still adapts to your stock.
- Auto-queue also stops re-enabling itself at the population cap or with no resources, where the
  engine refuses and prints "could not set auto-queue" across the screen every 3 s.
- **Stone and metal techs no longer wait for phase 2 when their slider is above zero.** The wait made
  sense with both at zero — nobody is mining, so the tech yields nothing — but a weight above zero
  means someone is mining right now.

**Military**

- **Panic requires real hostility** — an attack order on something of yours or an ally's, or an enemy
  standing inside your territory. Any combatant within 220 m used to be enough, so troops passing by
  triggered a full panic with no attack taking place.
- Fixed a **panic timeout loop**: when the "no civic centre / shelter under siege" lock refused to
  ungarrison, the 120 s valve re-fired every tick — 119 log lines in one match.
- **Workers under attack take the nearest house.** In the "we can defend" branch the shelter list was
  filtered to the civic centre alone; the houses were already in the list and simply went unused.
  With 183 population the civic centre filled in the first ~20 units and everyone else stood there
  being killed next to empty houses.
- **With every shelter full they run**, away from the attacker. The base bearing is the opposite of
  the nearby enemies' centre of mass, but that alone points a surrounded worker straight into a
  second group, so it tries seven bearings across a ±60° fan and takes the one that ends up furthest
  from the closest enemy. The distance comes from the attackers' real weapon reach plus 30 m.

**Scouting**

- Math.asin removed from the simulation component. The engine rejects it there ("does not yet have a
  synchronization safe implementation"): on-screen errors every waypoint and a desync risk in
  multiplayer. The orbit step now comes from arc length.
- **Deep scouting prefers the far side of the map**, away from your base and your allies', and never
  re-covers ground already explored — including what an ally explored, via the engine's shared line
  of sight.
- **Local scouting spirals over the whole base** instead of pacing the outer rim, and prefers what
  nobody is currently watching, closing blind spots.
- Orbit radius now scales with map size. On a 2048 map the arrival radius (140 m) exceeded the
  largest possible chord of a 120 m ring, so the scout "arrived" without moving and burned the orbit
  standing still.
- **The orbit follows the enemy's territory border** instead of a fixed 120 m ring. The ring was
  measured from the civic centre and knew nothing about towers, so one tower near the edge put the
  scout in range. Civic centre, defensive tower, outpost and fortress all reach 60 m, and the civic
  centre's territory radius is 140 m — following the border puts the scout at ~158 m, nearly 100 m
  clear of all of them.
- **The route is checked too, not just the destination.** Two safe waypoints joined by a line across
  the base is still a death sentence: that was how the scout crossed the civic centre's range without
  ever stopping inside it. The path is now sampled every 12 m, shorter than any forbidden radius.
- Forbidden radius = real weapon reach (`Attack.GetFullAttackRange`, so enemy range upgrades tighten
  it on their own) plus 25 m for a building, plus two seconds of its own movement for a unit. Those
  zones go on the scout's blacklist, and surrounded it retreats home.

**Tooling**

- Node test suite under `tools/` — 14 files. Several run the shipping code directly rather than a
  copy. They have caught real production bugs: a luminance formula, the 2048-map orbit, and a
  farmstead rule that approved three stripped bushes while refusing one full one.
- **`test_mp_safety.js` turns multiplayer compatibility into a contract.** `mod.json` declares
  `ignoreInCompatibilityChecks`, which is what lets an unmodded spectator join — that claim is only
  honest while everything under `simulation/` stays inert, so it is now checked automatically: no
  executable code in the stubs, no state written to a component, only `GuiInterface` extended, no
  network commands from the simulation side, only vanilla command types, and no `Math` function the
  engine has not replaced with a deterministic version.

---

## License

PudimMod is released under the **GNU General Public License v3 or later** — see `LICENSE`.

All code is original — see `NOTICE`.

**On AutoCiv:** PudimMod deliberately does *not* reimplement what
[AutoCiv](https://github.com/nanihadesuka/autociv) already does. The two mods run side by
side and cover different ground: AutoCiv gives you hotkeys, selection filters and lobby
tooling, while PudimMod automates the economy and adds tactical analysis. Run both.

---
---

# PudimMod — mod utilitário para 0 A.D.

Mod de conveniência para o **0 A.D. Alpha 28 (Boiorix)**. Reduz a microgestão, automatiza a economia
e acrescenta ferramentas táticas — sem nunca dessincronizar uma partida multiplayer.

Tudo roda na camada de GUI e toda ação sai como comando de rede padrão, então todos os clientes
permanecem em lockstep. **Jogadores e espectadores sem o mod podem entrar na sua partida**: nada do que o
mod põe em `simulation/` altera como o jogo simula, e `tools/test_mp_safety.js` transforma isso num
contrato em vez de uma promessa — ele falha se algum arquivo de lá ganhar código executável, estado
de componente, comando de rede fora do padrão ou uma função Math que a engine não tornou
determinística.

> **Sem dependências além do próprio 0 A.D.** O PudimMod traz o seu `pudim_patchApplyN` para
> modificar funções do jogo, então não precisa do AutoCiv — e como o auxiliar fica no namespace
> próprio, rodar os dois mods juntos não gera conflito.

---

## Instalação

Baixe o repositório (**Code → Download ZIP**, ou `git clone`) e coloque a pasta `PudimMod`
dentro do diretório `mods` do 0 A.D.:

| Sistema | Caminho |
|---------|---------|
| Windows | `%APPDATA%\0ad\mods\` — ou `Documentos\My Games\0ad\mods\` |
| Linux   | `~/.local/share/0ad/mods/` |
| macOS   | `~/Library/Application Support/0ad/mods/` |

Na dúvida, a referência oficial do jogo está em
<https://trac.wildfiregames.com/wiki/GameDataPaths>.

A pasta precisa ficar direto dentro de `mods/`, de modo que exista `mods/PudimMod/mod.json` —
o erro mais comum é acabar com `mods/PudimMod/PudimMod/`.

Depois abra o 0 A.D., vá em **Configurações → Seleção de Mods**, escolha **PudimMod**, clique em
**Ativar**, depois em **Salvar Configuração** e **Iniciar Mods**.

Para atualizar, substitua a pasta pela versão nova e reinicie o jogo.

---

## Painel de controle

Abra pelo ícone do pudim na barra superior. O cabeçalho tem três botões: **▼ / ▶** encolhe o painel
para mostrar só o estimador de combate, **Log** abre o visualizador de log, **X** fecha o painel.

Todo controle tem um tooltip explicando o que faz, em português ou inglês conforme o idioma do jogo.

---

## Estimador de combate

Leitura lado a lado das suas forças e das inimigas: contagem de unidades, HP total, DPS e a divisão
por tipo (infantaria corpo a corpo/à distância, cavalaria, cerco, suporte). Uma barra de
probabilidade de vitória resume tudo. Atualiza sozinho, e **Atualizar Estimativa** recalcula na hora.

## Economia

O **auto-trabalho** manda cidadãos ociosos coletarem, seguindo as cotas por recurso que você define
nos controles de comida / madeira / pedra / metal. Toda partida começa em **comida 3, madeira 4,
pedra 0, metal 0** — madeira acima de comida, porque a fase 1 gasta madeira em casas, armazéns e
fazendas mais rápido do que gasta comida. As prioridades são suas: zere um recurso e o mod nunca
manda ninguém para ele, e os valores não são gravados em disco, então toda partida começa do mesmo
estado conhecido.

- A cavalaria nunca coleta. Fica livre para combate e exploração, mas **caça animais dentro do seu
  território** — e só esses, então nunca sai perseguindo animal que foge pelo mapa.
- Soldados coletam frutas, nunca campos de fazenda (isso brigaria com a lógica das fazendas).
- Trabalhadores que já estão coletando **raramente** são puxados para outro recurso: mover um custa a
  viagem inteira. Abaixo de 100 de população isso só acontece quando um recurso está com *zero*
  cobertura e outro está 20 trabalhadores acima da cota. Acima de 100, onde um trabalhador é ruído, o
  rebalanceamento normal volta. As unidades que estão nascendo são sempre a forma preferida de
  preencher uma falta.

**Fazendas** — construídas quando as frutas já não dão conta, com teto de **9 fazendas**. Cada campo
comporta 5 coletores, então o alvo máximo é 45 trabalhadores em fazenda. Só redireciona para as
fazendas existentes em vez de construir quando as vagas livres cobrem todo o déficit.

Na frente de tudo isso há um **freio por estoque**: a proporção de coleta distribui por peso, não por
necessidade, então sozinha ela continuaria pedindo campo com o celeiro transbordando. Antes de
calcular qualquer déficit o mod compara o estoque de comida com o que ainda dá para gastar — 40 por
vaga de população livre mais 1000 de colchão — e acima disso para de construir e de puxar gente. O
conforto escala com a folga de população: 60/200 com 4000 de comida ainda planta (essa comida vai
virar unidade), 195/200 com os mesmos 4000 não planta.

**Armazéns proativos** — um armazém sobe perto de floresta distante, e um edifício agrícola perto de
fruta distante, *antes* de os trabalhadores perderem tempo andando. Evita pontos perto de centros
cívicos inimigos.

- A âncora é **densidade ponderada pela distância até a equipe** (`densidade / (1 + distância/50)`),
  não densidade pura. A entrega é ida e volta, então árvore longe rende menos por minuto: a maior
  mata do mapa deixa de ganhar da que a sua turma está realmente cortando.
- A detecção dispara **enquanto os coletores ainda estão caminhando**, não depois que chegam. A ordem
  que os leva até lá (`GatherNearPosition`) passou a ser lida também, então a fundação sobe em
  paralelo com a ida em vez de sair depois da primeira entrega longa.
- **Fundação de dropsite conta como dropsite.** Durante os ~30 s de obra o despachante pontuava
  aquela floresta como descoberta e seguia mandando gente para outro lado.
- **Os coletores acompanham o dropsite que ergueram.** Terminada a obra — controlada pela própria
  fundação, não por relógio — os construtores colhem ali mesmo, em vez de caírem no recurso de melhor
  score global, que costumava ser a floresta de onde vieram.
- O edifício agrícola é aprovado por **quanta fruta de fato sobrou ao alcance** (200, um arbusto
  cheio e o dobro do custo dele em madeira), não por contagem de arbustos. Um arbusto cheio vale;
  três raspados não valem.

**Detecção de caminhada longa** — coletor cujo recurso está longe demais de um dropsite recebe ou um
dropsite novo colado no recurso, ou uma troca para o mesmo tipo de recurso perto de um já existente.
"Longe demais" é calculado, não chutado: encher a carga leva `capacidade / taxa` e a ida e volta leva
`2 × distância / velocidade`, então o empate é `capacidade × velocidade / (2 × taxa)` — cerca de
**45 m para fruta, 64 m para madeira e 129 m para pedra e metal**. Ele lê os componentes da própria
unidade, então melhorias de coleta e de velocidade deslocam o limiar sozinhas.

A **auto-fila** mantém a fila de treino cheia no centro cívico e nos quartéis e contorna o bug do
motor que encolhe o lote em silêncio quando falta recurso.

**Ela nunca troca o tipo de unidade que você escolheu.** O que você põe na fila de um edifício é o
que é reposto ali — sem preferência por aldeã, e o limite de 50 mulheres também não passa por cima.
O mod só escolhe o tipo em edifício onde você nunca escolheu nada. O tamanho do lote também segue
você: pôs 5, volta 5. Só a *quantidade* se adapta ao estoque (menos quando falta, cheio de novo
quando o banco recupera) — nunca o tipo. Ela também para de insistir em religar a auto-fila no teto
de população ou sem recurso, onde o motor recusa e imprime erro na sua tela.

As **auto-casas** constroem casas antes de o limite de população travar o treino, com um tempo de
espera que se adapta à quantidade de edifícios de produção que você tem.

A **auto-pesquisa** é limitada de propósito ao **armazém, edifício agrícola e forja** — nunca centro
cívico, fortaleza ou quartel, e nunca avança de fase: isso continua sendo decisão sua. A prioridade
segue a fase: a fase 1 libera comida, madeira e capacidade de carga; a fase 2 acrescenta pedra e
metal; a fase 3 acrescenta combate e vida. **As techs de pedra e metal furam a espera quando a
prioridade delas passa de zero** — peso acima de zero quer dizer que tem gente minerando agora,
então acelerar essa coleta já rende. As techs de capacidade de carga (Cestas → Carrinho de Mão
→ Carroça) são as mais prioritárias entre as de coleta, porque somam nos quatro recursos de uma vez.
Uma tech que não entra na fila em 90 s vai para a lista negra da sessão.

O **mercado inteligente** troca o que está sobrando pelo que está faltando.

## Militar

- **Auto-kite** — unidades à distância se afastam de atacantes corpo a corpo e recebem uma ordem de
  ataque enfileirada, então voltam a lutar em vez de ficar paradas depois de reposicionar.
- **Auto-retirada** — unidades abaixo de 20% de vida recuam para um curador ou templo.
- **Foco de fogo** — seus soldados concentram num alvo só em vez de cada um escolher um inimigo.
- **Guarnição defensiva** — trabalhadores se abrigam em prédios próximos durante um ataque e voltam
  quando acalma, com esperas que impedem o vai-e-volta de guarnecer/soltar que travava a economia.
  Casa vem primeiro (são muitas, espalhadas, e deixam o centro cívico livre para a guarnição militar
  que o faz atirar), depois o centro cívico, e abrigo sob ameaça ainda ganha de campo aberto. Dentro
  de cada faixa vence o mais perto. **Com todos os abrigos lotados, eles correm** — para o lado
  oposto ao atacante, longe o bastante para sair do alcance real da arma dele.
- **Modo pânico** — num ataque sério, tudo para e os trabalhadores são protegidos. **Voltar ao
  Trabalho** os traz de volta. O pânico exige **hostilidade real**, não proximidade: um inimigo só
  conta se estiver com ordem de ataque sobre algo seu ou de aliado, ou se estiver dentro do seu
  território. Tropa passando de largo a caminho de brigar com outro não dispara mais nada. Se o seu
  centro cívico caiu, ou se um abrigo está cercado, o mod nunca desguarnece sozinho — isso continua
  sendo decisão sua.
- **Counter-train** — treina unidades que fazem frente ao que o inimigo realmente tem em campo.

## Exploração

Selecione a cavalaria e escolha o modo:

- **Local** — faz uma espiral sobre a base inteira, do anel interno para fora, uma volta completa por
  revolução. Dá preferência ao que ninguém está enxergando no momento, então fecha pontos cegos em
  vez de andar só pelo aro externo.
- **Profundo** — vai para o **lado oposto do mapa**, longe da sua base e das aliadas, porque é onde o
  inimigo normalmente está. Nunca refaz terreno já explorado — seu *ou de um aliado*, já que o que
  ele lê é a linha de visão compartilhada do motor. Achada a base inimiga, ele **contorna a
  fronteira do território dela** em vez de um anel fixo, pulando os arcos que já abriu. Nada que
  atira chega a alcançá-lo: destino *e trajeto* são conferidos contra o alcance real de cada
  atacante inimigo, e o setor de quem atirou nele vai para a lista negra. Cercado, ele recua para
  casa — sobreviver vem primeiro.

Ao ser avistado, o scout **foge na direção oposta ao inimigo**, não de volta para a base, e só volta
a explorar após duas verificações seguidas sem perigo. Estruturas inimigas bloqueiam o setor
permanentemente; tropas móveis bloqueiam por três minutos. A detecção de travamento cuida de lagos e
terreno impassável, e qualquer ordem manual sua devolve o controle na hora.

## Percepção

**Barra de aliados** — uma linha ao vivo por jogador do seu time: nome na cor daquele jogador no
mapa, fase, população, os quatro recursos, coletores por recurso, abates/perdas e composição do
exército. Pisca enquanto um jogador avança de fase e quando está sob ataque.

O **flare automático** marca uma batalha real no minimapa. Ele é **só local** — nunca avisa os outros
jogadores — e dispara **uma vez por batalha**, no centro do maior aglomerado de luta, e apenas quando
há pelo menos três unidades envolvidas. Caçar animais não é batalha e nunca aciona o aviso.

O **conselheiro estratégico** dá uma leitura contínua da partida, com um botão que leva a câmera até
o ponto comentado.

**Repetir construção** — o construtor coloca a próxima fundação ao lado assim que termina uma.

## Log da partida

Tudo o que o mod decide é registrado e, uma vez por minuto, é acrescentado um **snapshot**: população,
fase, os quatro recursos, coletores por recurso, composição do exército, abates/perdas e se você está
em combate. O log é guardado **por partida** (não por dia) e as **10 últimas partidas** são
preservadas, então dá para reler um jogo inteiro do começo ao fim sem encher o disco.

## Tradução do chat

Saiu para um mod próprio, o **PudimTranslate** — clique numa fala do chat para traduzi-la, na
partida, na lobby e na tela de configuração da partida. Ele é independente: não precisa do
PudimMod, e o PudimMod não precisa dele.

## Idioma

Português ou inglês, detectado automaticamente pelo idioma do jogo. Para forçar um deles, defina
`pudim.lang` como `pt` ou `en` na configuração do usuário.

## Histórico de mudanças

### 19/08/2026

**Economia**

- As prioridades de coleta começam toda partida em **comida 3 / madeira 4 / pedra 0 / metal 0**, e não
  são mais gravadas em disco.
- Teto de fazendas de volta ao valor fixo de **9** (45 trabalhadores). O teto proporcional à população
  que o havia substituído resolvia a falta de comida, mas em jogo produziu 15 campos e 66
  trabalhadores em comida com 7900 de comida parada.
- Novo **freio por estoque**: nenhum campo novo e nenhum trabalhador a mais em comida enquanto o
  estoque estiver acima do que a folga de população ainda conseguiria gastar.
- O edifício agrícola passa a ser aprovado por **quanta fruta sobrou ao alcance** (200 = um arbusto
  cheio = o dobro do custo dele em madeira), e não por contagem de arbustos. Ele recusava construir ao
  lado de um arbusto cheio enquanto os coletores atravessavam a base — três ciclos seguidos no log.
- A âncora do armazém é **densidade ponderada pela distância até a equipe**, então ele nasce na
  floresta que a sua turma está cortando, não na maior do mapa.
- **Fundação de dropsite conta como dropsite.** Ela não carrega o componente `ResourceDropsite`
  (`special/filter/foundation.xml` é uma entidade filtrada), então durante a obra o despachante
  pontuava aquela floresta como descoberta e seguia mandando gente para outro lado.
- **Os coletores acompanham o dropsite que ergueram**, quando a fundação de fato sai do chão —
  controlado pela fundação, não por relógio. Medir isso pela ociosidade do construtor arrancava gente
  de obra inacabada: um edifício agrícola passou 79 s com quatro construtores e o estoque de comida
  foi a zero.
- A detecção de "longe do dropsite" dispara **enquanto os coletores caminham**, não depois que chegam.
- O **limiar de caminhada longa é calculado por recurso** a partir da capacidade, da taxa de coleta e
  da velocidade da própria unidade — cerca de 45 m para fruta, 64 m para madeira e 129 m para pedra e
  metal, no lugar de 100 m fixos.
- Toda ordem gather-near-position passa a levar o subtipo do recurso. Sem ele o estado
  FINDINGNEWTARGET do motor não casa com nada e o coletor para depois de esvaziar um alvo.
- **A auto-fila nunca troca o tipo de unidade que você escolheu.** Ela refazia a escolha do zero a
  cada reposição, com preferência explícita por aldeã, então 5 guerreiros postos no centro cívico
  voltavam como 2 aldeões. O que você põe na fila de um edifício passa a ser o que é reposto ali, no
  seu tamanho de lote; só a quantidade ainda se adapta ao estoque.
- A auto-fila também para de se religar no teto de população ou sem recurso, onde o motor recusa e
  imprime "não foi possível definir auto-fila" na tela a cada 3 s.
- **As techs de pedra e metal deixam de esperar a Fase 2 quando a prioridade delas passa de zero.**
  A espera fazia sentido com as duas zeradas — ninguém está minerando, a tech rende nada — mas peso
  acima de zero quer dizer que tem gente minerando agora.

**Militar**

- **O pânico exige hostilidade real** — ordem de ataque sobre algo seu ou de aliado, ou inimigo dentro
  do seu território. Antes bastava qualquer combatente a 220 m, então tropa passando de largo
  disparava pânico total sem ataque nenhum.
- Corrigido um **laço no timeout do pânico**: quando a trava de "sem centro cívico / abrigo cercado"
  recusava desguarnecer, a válvula de 120 s redisparava a cada tique — 119 linhas de log numa partida.
- **Trabalhador sob ataque entra na casa mais perto.** No ramo "podemos defender" a lista de abrigos
  era filtrada só para o centro cívico; as casas já estavam na lista e simplesmente não eram usadas.
  Com 183 de população o centro cívico enchia nas primeiras ~20 unidades e todo o resto ficava parado
  apanhando ao lado de casas vazias.
- **Com todos os abrigos lotados, eles correm**, para o lado oposto ao atacante. A direção base é a
  oposta ao centro de massa dos inimigos próximos, mas só isso aponta um trabalhador cercado direto
  para um segundo grupo, então ele testa sete rumos num leque de ±60° e fica com o que termina mais
  longe do inimigo mais próximo. A distância sai do alcance real da arma dos atacantes mais 30 m.

**Exploração**

- Math.asin saiu do componente de simulação. O motor o recusa ali ("does not yet have a
  synchronization safe implementation"): erro em tela a cada ponto de rota e risco de dessincronizar
  em multiplayer. O passo da órbita agora vem do comprimento de arco.
- **O scout profundo dá preferência ao lado oposto do mapa**, longe da sua base e das aliadas, e nunca
  refaz terreno já explorado — inclusive o que um aliado explorou, pela linha de visão compartilhada
  do motor.
- **O scout local faz espiral sobre a base inteira** em vez de andar pelo aro externo, e prioriza o
  que ninguém está enxergando, fechando pontos cegos.
- O raio da órbita passa a escalar com o tamanho do mapa. Num mapa 2048 o raio de chegada (140 m) era
  maior que a maior corda possível de um anel de 120 m, então o scout "chegava" sem sair do lugar e
  queimava a órbita parado.
- **A órbita segue a fronteira do território inimigo** em vez de um anel fixo de 120 m. O anel era
  medido do centro cívico e não sabia nada sobre torres, então uma torre perto da borda já punha o
  scout no alcance. Centro cívico, torre defensiva, posto avançado e fortaleza alcançam 60 m, e o
  raio de território do centro cívico é 140 m — contornar a fronteira põe o scout a ~158 m, quase
  100 m livre de todos eles.
- **O trajeto também é conferido, não só o destino.** Dois pontos seguros ligados por uma reta que
  corta a base continuam sendo sentença de morte: era assim que o scout atravessava o alcance do
  centro cívico sem nunca parar lá dentro. O caminho passa a ser amostrado a cada 12 m, menor que
  qualquer raio proibido.
- Raio proibido = alcance real da arma (`Attack.GetFullAttackRange`, então upgrade de alcance inimigo
  aperta o cerco sozinho) mais 25 m para prédio, mais dois segundos do próprio deslocamento para
  unidade. Essas zonas entram na lista negra do scout, e cercado ele recua para casa.

**Ferramentas**

- Suíte de testes em Node dentro de `tools/` — 14 arquivos. Vários rodam o código que vai para o jogo,
  e não uma cópia. Já pegaram defeitos reais: uma fórmula de luminância, a órbita em mapa 2048 e uma
  regra que aprovava três arbustos raspados enquanto recusava um cheio.
- **`test_mp_safety.js` transforma a compatibilidade em multiplayer num contrato.** O `mod.json`
  declara `ignoreInCompatibilityChecks`, que é o que permite um espectador sem o mod entrar — essa
  declaração só é honesta enquanto tudo em `simulation/` continuar inerte, então isso passou a ser
  verificado sozinho: nenhum código executável nos stubs, nenhum estado gravado em componente, só o
  `GuiInterface` estendido, nenhum comando de rede saindo da simulação, só tipos de comando do jogo
  base e nenhuma função `Math` que a engine não tenha substituído por uma versão determinística.

---

## Licença

O PudimMod é distribuído sob a **GNU General Public License v3 ou posterior** — veja `LICENSE`.

Todo o código é original — veja o `NOTICE`.

**Sobre o AutoCiv:** o PudimMod de propósito *não* refaz o que o
[AutoCiv](https://github.com/nanihadesuka/autociv) já faz. Os dois rodam lado a lado e cobrem
terrenos diferentes: o AutoCiv dá atalhos, filtros de seleção e ferramentas de lobby, enquanto o
PudimMod automatiza a economia e acrescenta análise tática. Use os dois.
