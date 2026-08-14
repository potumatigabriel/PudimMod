# PudimMod — a 0 A.D. utility mod

A quality-of-life mod for **0 A.D. Alpha 28 (Boiorix)**. It cuts micromanagement, automates the
economy and adds tactical tooling — without ever desyncing a multiplayer match.

Everything runs in the GUI layer and every action goes out as a standard network command, so all
clients stay in lockstep.

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
food / wood / stone / metal sliders. Set a resource to zero and the mod never assigns anyone to it —
the sliders are yours, the mod does not override them.

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

**Proactive dropsites** — a storehouse goes up next to distant forest, and a farmstead next to
distant fruit, *before* workers waste time walking. It skips spots near enemy civic centres.

**Auto-queue** keeps the training queue full at the civic centre and barracks, learns the batch size
you configured, and works around the engine bug that silently shrinks a batch when resources run
short. Female citizens stop at 50, after which production switches to soldiers.

**Auto-houses** builds houses before the population cap blocks training, with a cooldown that adapts
to how many production buildings you own.

**Auto-research** is deliberately limited to the **storehouse, farmstead and forge** — never the
civic centre, fortress or barracks, and it never advances the phase: that stays your call. Priority
follows the phase: phase 1 unlocks food, wood and carrying capacity; phase 2 adds stone and metal;
phase 3 adds combat and health. Carrying-capacity techs (Baskets → Wheelbarrow → Cart) rank highest
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
- **Panic mode** — on a serious attack, everything stops and the workers are protected. **Back to
  Work** returns them.
- **Counter-train** — trains units that answer what the enemy actually has on the field.

## Scouting

Select cavalry and pick a mode:

- **Local** — sweeps the area around your base looking for resources.
- **Deep** — finds the enemy base and circles it at a safe 120 m, advancing ~40° per waypoint so it
  genuinely goes around instead of bouncing between a few points.

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
permanecem em lockstep.

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
nos controles de comida / madeira / pedra / metal. Zere um recurso e o mod nunca manda ninguém para
ele — as prioridades são suas, o mod não passa por cima.

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

**Armazéns proativos** — um armazém sobe perto de floresta distante, e um edifício agrícola perto de
fruta distante, *antes* de os trabalhadores perderem tempo andando. Evita pontos perto de centros
cívicos inimigos.

A **auto-fila** mantém a fila de treino cheia no centro cívico e nos quartéis, aprende o tamanho de
lote que você configurou e contorna o bug do motor que encolhe o lote em silêncio quando falta
recurso. Cidadãs param em 50, e a partir daí a produção passa a soldados.

As **auto-casas** constroem casas antes de o limite de população travar o treino, com um tempo de
espera que se adapta à quantidade de edifícios de produção que você tem.

A **auto-pesquisa** é limitada de propósito ao **armazém, edifício agrícola e forja** — nunca centro
cívico, fortaleza ou quartel, e nunca avança de fase: isso continua sendo decisão sua. A prioridade
segue a fase: a fase 1 libera comida, madeira e capacidade de carga; a fase 2 acrescenta pedra e
metal; a fase 3 acrescenta combate e vida. As techs de capacidade de carga (Cestas → Carrinho de Mão
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
- **Modo pânico** — num ataque sério, tudo para e os trabalhadores são protegidos. **Voltar ao
  Trabalho** os traz de volta.
- **Counter-train** — treina unidades que fazem frente ao que o inimigo realmente tem em campo.

## Exploração

Selecione a cavalaria e escolha o modo:

- **Local** — varre a região ao redor da sua base procurando recursos.
- **Profundo** — acha a base inimiga e a contorna a 120 m de distância segura, avançando ~40° por
  ponto para de fato dar a volta em vez de ricochetear entre poucos pontos.

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

## Licença

O PudimMod é distribuído sob a **GNU General Public License v3 ou posterior** — veja `LICENSE`.

Todo o código é original — veja o `NOTICE`.

**Sobre o AutoCiv:** o PudimMod de propósito *não* refaz o que o
[AutoCiv](https://github.com/nanihadesuka/autociv) já faz. Os dois rodam lado a lado e cobrem
terrenos diferentes: o AutoCiv dá atalhos, filtros de seleção e ferramentas de lobby, enquanto o
PudimMod automatiza a economia e acrescenta análise tática. Use os dois.
