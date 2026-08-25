/**
 * PudimMod — dicionário de idiomas e tooltips do painel.
 *
 * Carregado automaticamente: a página de sessão do 0AD declara
 * <script directory="gui/session/"/>, que carrega todos os .js da pasta em ordem
 * alfabética — "pudim_i18n.js" entra antes de "pudim_panel.js", então pudim_T()
 * já existe quando o painel inicializa.
 */

// ─── Detecção de idioma ───────────────────────────────────────────────────────

var g_PudimLang = null;

/**
 * Idioma dos textos do mod: "pt" quando o 0AD está em português, "en" caso contrário.
 * Resolvido uma única vez por sessão e memorizado.
 */
function pudim_Lang()
{
	// Só memoriza resposta POSITIVA. Memorizar o padrão "en" era um bug: a primeira
	// chamada vem de pudim_Init(), que pode rodar antes de o dicionário de tradução do
	// jogo estar carregado — a sonda falhava, travava em inglês e nunca mais reavaliava.
	// Sem cache do negativo, a próxima chamada tenta de novo e acerta.
	if (g_PudimLang) return g_PudimLang;

	// 1) Preferência explícita do jogador, se ele quiser forçar um idioma para o mod.
	try {
		const forced = Engine.ConfigDB_GetValue("user", "pudim.lang");
		if (forced === "pt" || forced === "en") { g_PudimLang = forced; return g_PudimLang; }
	} catch(e) {}

	// 2) Locale configurado no jogo (ex.: "pt_BR", "pt_PT"). Tentamos mais de uma chave
	//    porque a config do 0AD já mudou de nome entre versões.
	for (const key of ["locale", "language", "gui.locale"]) {
		let loc = "";
		try { loc = Engine.ConfigDB_GetValue("user", key) || ""; } catch(e) {}
		if (loc && loc.toLowerCase().indexOf("pt") === 0) { g_PudimLang = "pt"; return g_PudimLang; }
	}

	// 3) Sonda o dicionário do próprio jogo. Usamos palavras cuja tradução distingue
	//    português de espanhol — "Madeira"/"Madera" e "Pedra"/"Piedra". "Cancel" não
	//    serviria: vira "Cancelar" nos dois idiomas. Basta uma bater.
	try {
		if (typeof translate === "function" &&
		    (translate("Wood") === "Madeira" || translate("Stone") === "Pedra" ||
		     translate("Food") === "Comida" && translate("Wood") !== "Madera"))
		{
			g_PudimLang = "pt";
			return g_PudimLang;
		}
	} catch(e) {}

	// Nada conclusivo AINDA: devolve inglês sem memorizar, para reavaliar na próxima vez.
	return "en";
}

// ─── Dicionário ───────────────────────────────────────────────────────────────

/**
 * Cada entrada é [inglês, português]. Chaves com prefixo "tip." são tooltips de
 * botões; as demais são rótulos.
 */
const PUDIM_STRINGS = {
	"cap.combatHeader":  ["Combat Estimator", "Estimador de Combate"],
	"cap.combatRefresh": ["Refresh Estimate", "Atualizar Estimativa"],
	"cap.autoWorkHeader":["Auto-Work", "Auto-Trabalho"],
	"cap.autoWorkDesc":  ["Sends idle citizens to gather resources.",
	                      "Envia cidadãos ociosos para coletar recursos."],
	"cap.autoWorkOn":    ["( ON ) Auto-Work", "( LIGADO ) Auto-Trabalho"],
	"cap.autoWorkEnable":["Enable Auto-Work", "Ativar Auto-Trabalho"],
	"cap.autoWorkDisable":["Disable Auto-Work", "Desativar Auto-Trabalho"],
	"cap.statusOff":     ["Status: Off", "Status: Desativado"],
	// Os pesos são deliberadamente não persistentes. Sem esta nota o jogador procura onde
	// salvá-los e não acha — foi o que motivou remover os sliders mortos das opções.
	"cap.priorityHeader":["-- Gathering Priorities (reset every match) --",
	                      "-- Prioridades de Coleta (recomeçam a cada partida) --"],
	"cap.food":          ["Food", "Comida"],
	"cap.wood":          ["Wood", "Madeira"],
	"cap.stone":         ["Stone", "Pedra"],
	"cap.metal":         ["Metal", "Metal"],
	"cap.sendIdle":      ["Send Idle Now", "Enviar Ociosos Agora"],
	"cap.repeatHeader":  ["Repeat Building", "Repetir Construção"],
	"cap.repeatDesc":    ["On finishing, places the next foundation alongside.",
	                      "Ao terminar, coloca a próxima fundação adjacente."],
	"cap.repeatNone":    ["No builder repeating", "Nenhum construtor em repeat"],
	"cap.repeatCount":   ["Builders repeating: ", "Construtores em repeat: "],
	"cap.repeatStop":    ["Stop All Repeats", "Parar Todos os Repeats"],
	"cap.serieHeader":   ["Build in Sequence", "Construção em Série"],
	"cap.serieBuild":    ["Build", "Construir"],
	"cap.serieStop":     ["STOP — remaining:", "PARAR — faltam"],
	"cap.barracks":      ["Barracks", "Quartel"],
	"cap.stable":        ["Stable", "Estábulo"],
	"cap.house":         ["House", "Casa"],
	"cap.forge":         ["Forge", "Forja"],
	"cap.tower":         ["Tower", "Torre"],
	"cap.backToWork":    ["Back to Work", "Voltar ao Trabalho"],
	"cap.situation":     ["Situation", "Situação"],
	"cap.calm":          ["Calm", "Calma"],
	"cap.defending":     ["Defending", "Defendendo"],
	"cap.enemyScout":    ["Enemy scout spotted", "Batedor inimigo à vista"],
	"cap.panic":         ["PANIC!", "PÂNICO!"],
	"cap.returning":     ["Returning to work...", "Retornando ao trabalho..."],
	"cap.autoHouseOff":  ["(OFF) Auto-Houses", "(OFF) Auto-Casas"],
	"cap.autoHouseOn":   ["(ON) Auto-Houses (short by ", "(ON) Auto-Casas (Faltando "],
	"cap.counselorHeader":["Strategic Advisor", "Conselheiro Estratégico"],
	"cap.counselorTip":  ["Tip: Reading the map...", "Dica: Analisando o mapa..."],
	"cap.counselorCam":  ["Show Location on Map", "Ver Local no Mapa"],
	"cap.optionsHint":   ["Switches and explanations: Menu > Options > PudimMod",
	                      "Interruptores e explicações: Menu > Opções > PudimMod"],
	// Cabeçalho do painel
	"tip.compact":       ["Collapse the panel to show only the combat estimator, or expand it back.",
	                      "Encolhe o painel para mostrar só o estimador de combate, ou expande de volta."],
	"tip.log":           ["Open the log panel: everything the mod decided, plus a snapshot of the match each minute.",
	                      "Abre o painel de log: tudo o que o mod decidiu, mais um retrato da partida a cada minuto."],
	"tip.close":         ["Close the PudimMod panel. Reopen it from the button in the top bar.",
	                      "Fecha o painel do PudimMod. Reabra pelo botão na barra superior."],

	// Estimador de combate
	"tip.combatRefresh": ["Recalculate the combat estimate: troop count, total HP, DPS and win probability for both sides.",
	                      "Recalcula a estimativa de combate: contagem de tropas, HP total, DPS e probabilidade de vitória dos dois lados."],

	// Auto-trabalho
	"tip.autoWork":      ["Send idle citizens to gather resources automatically, following the priorities below.",
	                      "Envia cidadãos ociosos para coletar recursos automaticamente, seguindo as prioridades abaixo."],
	"tip.prioFood":      ["Share of workers assigned to food. Zero means the mod never sends anyone to food.",
	                      "Fatia dos trabalhadores destinada à comida. Zero faz o mod nunca mandar ninguém para comida."],
	"tip.prioWood":      ["Share of workers assigned to wood. Zero means the mod never sends anyone to wood.",
	                      "Fatia dos trabalhadores destinada à madeira. Zero faz o mod nunca mandar ninguém para madeira."],
	"tip.prioStone":     ["Share of workers assigned to stone. Zero means the mod never sends anyone to stone.",
	                      "Fatia dos trabalhadores destinada à pedra. Zero faz o mod nunca mandar ninguém para pedra."],
	"tip.prioMetal":     ["Share of workers assigned to metal. Zero means the mod never sends anyone to metal.",
	                      "Fatia dos trabalhadores destinada ao metal. Zero faz o mod nunca mandar ninguém para metal."],
	"tip.sendIdle":      ["Send every idle worker to gather right now, without waiting for the next cycle.",
	                      "Manda todos os trabalhadores ociosos coletarem agora, sem esperar o próximo ciclo."],

	// Repetir construção
	"tip.stopRepeat":    ["Stop all builders that are repeating a construction.",
	                      "Para todos os construtores que estão repetindo uma construção."],

	// Inteligência avançada
	"tip.barter":        ["Sell surplus resources at the market when one resource piles up and another runs short.",
	                      "Vende recursos excedentes no mercado quando um sobra e outro está em falta."],
	"tip.dropsites":     ["Build storehouses and farmsteads near distant resources, before workers waste time walking.",
	                      "Constrói armazéns e edifícios agrícolas perto de recursos distantes, antes que os trabalhadores percam tempo andando."],
	"tip.retreat":       ["Pull wounded units out of combat when their health drops below 20%.",
	                      "Retira unidades feridas do combate quando a vida cai abaixo de 20%."],
	"tip.focus":         ["Concentrate fire: your soldiers pick the same target instead of each hitting a different enemy.",
	                      "Concentra o ataque: seus soldados escolhem o mesmo alvo em vez de cada um bater num inimigo diferente."],
	"tip.garrison":      ["Garrison workers in nearby buildings when enemies raid the base, and release them once it is calm.",
	                      "Guarnece trabalhadores em prédios próximos quando inimigos atacam a base, e os solta quando acalma."],
	"tip.debug":         ["Show detailed messages in the log. Useful to understand why the mod made a decision.",
	                      "Mostra mensagens detalhadas no log. Útil para entender por que o mod tomou uma decisão."],
	"tip.panic":         ["Panic mode: on a serious attack, drop everything and protect the workers.",
	                      "Modo pânico: num ataque sério, larga tudo e protege os trabalhadores."],
	"tip.backToWork":    ["Take everyone out of panic mode and send them back to gathering.",
	                      "Tira todo mundo do modo pânico e manda de volta para a coleta."],
	"tip.autoHouse":     ["Build houses on their own before the population cap blocks unit training.",
	                      "Constrói casas sozinho antes que o limite de população trave o treino de unidades."],
	"tip.counterTrain":  ["Train units that counter what the enemy is actually fielding.",
	                      "Treina unidades que fazem frente ao que o inimigo está realmente colocando em campo."],
	"tip.autoQueue":     ["Keep the training queue always full at the civic center and barracks.",
	                      "Mantém a fila de treino sempre cheia no centro cívico e nos quartéis."],

	// Conselheiro
	"tip.counselorCam":  ["Move the camera to the spot the advice refers to.",
	                      "Leva a câmera até o ponto a que a dica se refere."],

	// Scout (painel de seleção da cavalaria) — montados dinamicamente com o estado atual
	// em pudim_UpdateSelectionButton (session~pudim.js), por isso são partes separadas.
	"scout.local.title": ["Scout Base (PudimMod)", "Explorar Base (PudimMod)"],
	"scout.local.desc":  ["Sweeps the area around your Civic Centre looking for resources.",
	                      "Varre a região ao redor do seu Centro Cívico procurando recursos."],
	"scout.local.note":  ["Avoids fights and goes around enemies.",
	                      "Evita batalhas e contorna inimigos."],
	"scout.deep.title":  ["Scout Deep (PudimMod)", "Explorar Profundo (PudimMod)"],
	"scout.deep.desc":   ["Finds the enemy base and circles it at a safe distance.",
	                      "Acha a base inimiga e a contorna a distância segura."],
	"scout.deep.note":   ["Flees from enemy troops and blacklists risky areas.",
	                      "Foge de tropas inimigas e marca áreas arriscadas."],
	"state.on":          ["ON", "ATIVADO"],
	"state.off":         ["OFF", "DESATIVADO"]
};

/**
 * Texto no idioma ativo. Devolve a própria chave se ela não existir no dicionário,
 * para o problema ficar visível em vez de virar string vazia.
 */
function pudim_T(key)
{
	const entry = PUDIM_STRINGS[key];
	if (!entry) return key;
	return pudim_Lang() === "pt" ? entry[1] : entry[0];
}

// ─── Tooltips ─────────────────────────────────────────────────────────────────

/** Objeto GUI -> chave do dicionário. */
const PUDIM_TOOLTIP_MAP = {
	"pudim_compactBtn":           "tip.compact",
	"pudim_logBtn":               "tip.log",
	"pudim_closeBtn":             "tip.close",
	"pudim_combatRefreshBtn":     "tip.combatRefresh",
	"pudim_autoWorkToggle":       "tip.autoWork",
	"pudim_foodMinus":            "tip.prioFood",
	"pudim_foodPlus":             "tip.prioFood",
	"pudim_foodVal":              "tip.prioFood",
	"pudim_woodMinus":            "tip.prioWood",
	"pudim_woodPlus":             "tip.prioWood",
	"pudim_woodVal":              "tip.prioWood",
	"pudim_stoneMinus":           "tip.prioStone",
	"pudim_stonePlus":            "tip.prioStone",
	"pudim_stoneVal":             "tip.prioStone",
	"pudim_metalMinus":           "tip.prioMetal",
	"pudim_metalPlus":            "tip.prioMetal",
	"pudim_metalVal":             "tip.prioMetal",
	"pudim_sendIdleNowBtn":       "tip.sendIdle",
	"pudim_stopAllRepeatBtn":     "tip.stopRepeat",
	"pudim_toggleBarterBtn":      "tip.barter",
	"pudim_toggleDropsitesBtn":   "tip.dropsites",
	"pudim_toggleRetreatBtn":     "tip.retreat",
	"pudim_toggleFocusBtn":       "tip.focus",
	"pudim_toggleGarrisonBtn":    "tip.garrison",
	"pudim_toggleDebugBtn":       "tip.debug",
	"pudim_togglePanicBtn":       "tip.panic",
	"pudim_backToWorkBtn2":       "tip.backToWork",
	"pudim_toggleAutoHouseBtn":   "tip.autoHouse",
	"pudim_toggleCounterTrainBtn":"tip.counterTrain",
	"pudim_toggleAutoQueueBtn":   "tip.autoQueue",
	"pudim_counselorCameraBtn":   "tip.counselorCam"
	// Os botões de exploração NÃO entram aqui: o tooltip deles é montado em
	// pudim_UpdateSelectionButton (session~pudim.js) a cada mudança de seleção, porque
	// inclui o estado ligado/desligado. Repetir aqui seria sobrescrito e viraria letra morta.
};

/**
 * Escreve os tooltips nos objetos do painel. Sobrepõe os tooltips fixos que estavam
 * no XML — assim eles passam a respeitar o idioma e ficam todos num lugar só.
 * Idempotente: pode ser chamada quantas vezes for.
 */
var g_PudimTooltipsSettled = false;

/**
 * Reaplica os tooltips enquanto o idioma não estiver resolvido em definitivo.
 * Os tooltips escritos em pudim_Init() podem ter saído em inglês se o dicionário do jogo
 * ainda não tivesse carregado naquele instante; assim que pudim_Lang() consegue decidir,
 * reescrevemos tudo uma última vez e paramos.
 */
function pudim_RefreshTooltipsIfNeeded()
{
	if (g_PudimTooltipsSettled) return;
	pudim_ApplyTooltips();
	pudim_ApplyCaptions();
	if (g_PudimLang) g_PudimTooltipsSettled = true; // decidido: não precisa mais reaplicar
}

// ─── Rótulos do painel ────────────────────────────────────────────────────────
//
// Pedido de 25/08: "se o jogo instalado estiver em outra lingua que n seja pt ou pt-br, tem
// que ficar em ingles os botões e as explicações".
//
// Os TOOLTIPS já eram bilíngues desde agosto; os RÓTULOS não. Eles nascem do XML, onde o
// texto é fixo, então o painel saía em português em qualquer idioma — e com pedaços em
// inglês por acidente ("Smart Dropsites", "Auto-Retreat"), que era o pior dos dois mundos.
//
// Mesma tabela, mesma função, mesmo par [en, pt] dos tooltips. O que muda é só o atributo
// escrito: caption em vez de tooltip.
const PUDIM_CAPTION_MAP = {
	// pudim_combatHeader, NAO pudim_combatFlash. O Flash e a imagem de fundo que pisca na
	// cor do combate — image nao tem caption, e escrever nela imprimia
	// "Property 'caption' does not exist!" na tela do jogador a CADA QUADRO, porque este
	// aplicador roda no laco de atualizacao. O texto ficava num objeto sem nome; agora ele
	// tem nome, que e o que permite traduzi-lo.
	"pudim_combatHeader":       "cap.combatHeader",
	"pudim_combatRefreshBtn":   "cap.combatRefresh",
	"pudim_autoWorkHeader":     "cap.autoWorkHeader",
	"pudim_autoWorkDesc":       "cap.autoWorkDesc",
	"pudim_priorityHeaderLabel":"cap.priorityHeader",
	"pudim_foodLabel":          "cap.food",
	"pudim_woodLabel":          "cap.wood",
	"pudim_stoneLabel":         "cap.stone",
	"pudim_metalLabel":         "cap.metal",
	"pudim_sendIdleNowBtn":     "cap.sendIdle",
	"pudim_repeatHeader":       "cap.repeatHeader",
	"pudim_repeatDesc":         "cap.repeatDesc",
	"pudim_stopAllRepeatBtn":   "cap.repeatStop",
	"pudim_quartelHeader":      "cap.serieHeader",
	"pudim_backToWorkBtn2":     "cap.backToWork",
	"pudim_optionsHint":        "cap.optionsHint",
	"pudim_counselorHeader":    "cap.counselorHeader",
	"pudim_counselorCameraBtn": "cap.counselorCam"
};

/** Objetos que aceitam caption. Descoberto uma vez; ver o porque em pudim_ApplyCaptions. */
var g_PudimCaptionOk = null;

function pudim_ApplyCaptions()
{
	// Nem todo objeto de GUI tem caption. Uma imagem nao tem, e escrever nela faz o motor
	// imprimir "Property 'caption' does not exist!" — e como este aplicador roda no laco de
	// atualizacao, o aviso saia a cada quadro e cobriu a tela do jogador.
	//
	// try/catch nao resolve: o motor IMPRIME antes de lancar. Entao o teste e feito uma vez
	// so, na primeira passada, e o objeto problematico sai da lista para sempre. No pior
	// caso o jogador ve o aviso uma vez, em vez de sessenta por segundo.
	if (!g_PudimCaptionOk)
	{
		g_PudimCaptionOk = [];
		for (const objName in PUDIM_CAPTION_MAP)
		{
			const o = Engine.TryGetGUIObjectByName(objName);
			if (!o) continue;
			try { const _ = o.caption; g_PudimCaptionOk.push(objName); }
			catch(e) { warn("[PudimMod] " + objName + " nao aceita caption; fora da traducao"); }
		}
	}

	for (const objName of g_PudimCaptionOk)
	{
		const obj = Engine.TryGetGUIObjectByName(objName);
		if (!obj) continue;
		try { obj.caption = pudim_T(PUDIM_CAPTION_MAP[objName]); } catch(e) {}
	}
	// Os dropdowns e o botão da série têm texto montado em tempo real (o número escolhido
	// entra no meio da frase), então quem os escreve é o próprio painel.
	try { if (typeof pudim_QuartelAtualizarLabel === "function") pudim_QuartelAtualizarLabel(); } catch(e) {}
}

function pudim_ApplyTooltips()
{
	for (const objName in PUDIM_TOOLTIP_MAP)
	{
		const obj = Engine.TryGetGUIObjectByName(objName);
		if (!obj) continue;
		try { obj.tooltip = pudim_T(PUDIM_TOOLTIP_MAP[objName]); } catch(e) {}
	}
}
