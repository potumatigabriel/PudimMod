var g_PudimShowDebug = Engine.ConfigDB_GetValue("user", "pudim.debug.show") !== "false";
/**
 * PudimMod - pudim_panel.js
 *
 * Lógica JavaScript do painel de jogo do PudimMod.
 * Gerencia:
 *  1. Estimador de Combate — mostra força aliados vs inimigos
 *  2. Auto-Trabalho — envia trabalhadores ociosos automaticamente
 *  3. Repetir Construção — configura construtores em modo repeat
 *
 * Convenções:
 *  - Leituras de estado: Engine.GuiInterfaceCall (GUI → Sim, somente leitura)
 *  - Modificações de estado: Engine.PostNetworkCommand (GUI → Sim, sincronizado em rede)
 */

// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE LOGS
// ═══════════════════════════════════════════════════════════════════

var g_PudimLogBuffer = [];
var PUDIM_LOG_BUFFER_SIZE = 500;
var g_PudimLogLastSave = 0; // throttle de ConfigDB_SaveChanges (persistência em disco)
function pudim_DateKey() {
	const d = new Date();
	return d.getFullYear() + "-" +
		String(d.getMonth() + 1).padStart(2, "0") + "-" +
		String(d.getDate()).padStart(2, "0");
}

// ─── Identidade da partida ────────────────────────────────────────────────────
// O log é por PARTIDA, não por dia: assim um jogo inteiro fica num registro só e
// dá para reler do começo ao fim. A retenção guarda as 10 últimas partidas.
var g_PudimMatchKey = null;
const PUDIM_MATCH_RETENTION = 10;

function pudim_MatchKey() {
	if (!g_PudimMatchKey) {
		const d = new Date();
		g_PudimMatchKey = d.getFullYear() +
			String(d.getMonth() + 1).padStart(2, "0") +
			String(d.getDate()).padStart(2, "0") + "-" +
			String(d.getHours()).padStart(2, "0") +
			String(d.getMinutes()).padStart(2, "0") +
			String(d.getSeconds()).padStart(2, "0");
	}
	return g_PudimMatchKey;
}

// pudim_Log(level, category, message)  OU  pudim_Log(level, message)  [categoria padrão="MOD"]
function pudim_Log(level, catOrMsg, msgOrUndef) {
	if (level === "DEBUG" && !g_PudimShowDebug) return;
	let category, message;
	if (msgOrUndef === undefined) { category = "MOD"; message = catOrMsg; }
	else { category = catOrMsg; message = msgOrUndef; }

	const entry = { ts: Date.now(), level: level, cat: category, msg: message };

	// Escreve em mainlog.html apenas para ERROR (warn() exibe overlay na tela para todos os níveis)
	if (level === "ERROR")
		warn("[PudimMod][" + level + "][" + category + "] " + message);

	// Buffer em memória para a sessão atual
	g_PudimLogBuffer.push(entry);
	if (g_PudimLogBuffer.length > PUDIM_LOG_BUFFER_SIZE)
		g_PudimLogBuffer.shift();

	// Persistência diária via ConfigDB (máx 200 entradas/dia)
	try {
		const key = "pudim.log." + pudim_MatchKey();
		let existing = Engine.ConfigDB_GetValue("user", key);
		let arr = [];
		try { arr = existing ? JSON.parse(existing) : []; } catch(e) { arr = []; }
		arr.push(entry);
		// Teto alto de propósito: o objetivo é o log COMPLETO da partida. O controle de
		// espaço em disco é a retenção de 10 partidas em pudim_LogInit, não truncar o jogo.
		if (arr.length > 5000) arr = arr.slice(arr.length - 5000);
		Engine.ConfigDB_CreateValue("user", key, JSON.stringify(arr));
		// Sem isso o log do dia nunca chega no user.cfg — fica só em memória e se perde
		// se o jogo não passar por outra ação que dispare SaveChanges antes de fechar.
		if (entry.ts - g_PudimLogLastSave > 10000) {
			g_PudimLogLastSave = entry.ts;
			Engine.ConfigDB_SaveChanges("user");
		}
	} catch(e) {}

	pudim_UpdateLogDisplay();
}

function pudim_LogInfo(msg)  { pudim_Log("INFO",  msg); }
function pudim_LogWarn(msg)  { pudim_Log("WARN",  msg); }
function pudim_LogError(msg) { pudim_Log("ERROR", msg); }

// ─── Snapshot periódico da partida ────────────────────────────────────────────
// Um retrato por minuto gravado no PRÓPRIO log, junto das decisões do mod. Assim dá
// para reler a partida inteira depois e ver como economia, exército e combate
// evoluíram, sem depender de screenshot (um mod do 0AD não consegue tirar print).
var g_PudimSnapshotAccum = 0;
const PUDIM_SNAPSHOT_INTERVAL = 60000;

function pudim_LogSnapshot() {
	try {
		const allies = Engine.GuiInterfaceCall("pudim_GetAllyStats");
		if (!allies || !allies.length) return;
		let me = null;
		for (const a of allies) if (a && a.isSelf) { me = a; break; }
		if (!me) return;
		const r = me.res || {}, g = me.gatherers || {};
		const f = function(v) { return Math.floor(v || 0); };
		pudim_Log("INFO", "SNAP",
			"pop " + me.popCount + "/" + me.popLimit + " fase " + me.phase +
			" | rec F" + f(r.food) + " W" + f(r.wood) + " S" + f(r.stone) + " M" + f(r.metal) +
			" | colet F" + (g.food || 0) + " W" + (g.wood || 0) +
			      " S" + (g.stone || 0) + " M" + (g.metal || 0) +
			" | trop inf" + me.infantry + " cav" + me.cavalry + " cerc" + me.siege +
			      " dist" + me.ranged + " camp" + me.champion + " sup" + me.support +
			" | k" + me.kills + " d" + me.deaths +
			// Rotatividade do último minuto: reordens antes de a unidade alcançar o alvo
			// anterior (viagem perdida) e redirects de long-walker barrados pela carência.
			" | chrn" + (g_PudimChurnCount || 0) + " seg" + (g_PudimWalkHeld || 0) +
			(me.inCombat ? " | COMBATE x" + me.combatSize : ""));
		g_PudimChurnCount = 0;
		g_PudimWalkHeld = 0;
	} catch(e) {}
}

// ─── Painel de Log Visual ─────────────────────────────────────────────────────

var g_PudimLogSessionStart = Date.now();

const PUDIM_LOG_LEVEL_COLORS = {
	"ERROR":   "255 90 90",
	"WARN":    "255 210 70",
	"SUCCESS": "80 230 80",
	"INFO":    "110 190 255",
	"DEBUG":   "155 155 155"
};
const PUDIM_LOG_CAT_COLORS = {
	"CASAS":  "255 230 100", "DROP":   "100 230 255", "FARM":  "140 255 150",
	"SCOUT":  "210 160 255", "GAR":    "255 170 100", "FOCUS": "255 120 130",
	"BARTER": "220 205 130", "PANIC":  "255 100 80",  "WORK":  "180 245 210",
	"MOD":    "190 190 190"
};

function pudim_ToggleDebugLogs() {
	g_PudimShowDebug = !g_PudimShowDebug;
	Engine.ConfigDB_CreateValue("user", "pudim.debug.show", String(g_PudimShowDebug));
	Engine.ConfigDB_SaveChanges("user");
	const btnLabel = Engine.TryGetGUIObjectByName("pudim_toggleDebugLabel");
	if (btnLabel) {
		btnLabel.caption = g_PudimShowDebug ? "(ON) Mensagens de Debug" : "(OFF) Mensagens de Debug";
		btnLabel.textcolor = g_PudimShowDebug ? "255 255 255 255" : "150 150 150 255";
	}
	pudim_LogInfo("Sistema de logs de Debug alterado para: " + (g_PudimShowDebug ? "LIGADO" : "DESLIGADO"));
}

function pudim_UpdateLogDisplay() {
	const panel = Engine.TryGetGUIObjectByName("pudimLogPanel");
	if (!panel || panel.hidden) return;
	const textObj = Engine.TryGetGUIObjectByName("pudimLogText");
	if (!textObj) return;

	// WARN silencioso in-game: só aparece no painel se debug estiver ativado
	const entries = g_PudimLogBuffer.slice(-55).filter(e =>
		e.level !== "WARN" || g_PudimShowDebug);
	// O parser de tags do GUI trata QUALQUER "[...]" como tentativa de tag, mesmo dentro de
	// outra tag — "[MOD]" dispara "ERROR: Invalid tag 'MOD'" no mainlog e no overlay nativo
	// de erros, repetido a cada atualização do painel. Nunca colocar colchetes literais no
	// texto exibido; usa parênteses e sanitiza a mensagem contra colchetes acidentais.
	const stripBrackets = s => String(s).replace(/\[/g, "(").replace(/\]/g, ")");
	const lines = [];
	for (const e of entries) {
		const t = ((e.ts - g_PudimLogSessionStart) / 1000).toFixed(1);
		const lc = PUDIM_LOG_LEVEL_COLORS[e.level] || "200 200 200";
		const cc = PUDIM_LOG_CAT_COLORS[e.cat || "MOD"] || "190 190 190";
		lines.push(
			"[color=\"100 100 100\"]" + t + "s[/color] " +
			"[color=\"" + cc + "\"](" + (e.cat || "MOD") + ")[/color] " +
			"[color=\"" + lc + "\"]" + stripBrackets(e.msg) + "[/color]"
		);
	}
	textObj.caption = lines.join("\n");
}

function pudim_ToggleLog() {
	const panel = Engine.TryGetGUIObjectByName("pudimLogPanel");
	if (!panel) return;
	panel.hidden = !panel.hidden;
	if (!panel.hidden) pudim_UpdateLogDisplay();
}

function pudim_ClearLog() {
	g_PudimLogBuffer = [];
	g_PudimLogSessionStart = Date.now();
	pudim_UpdateLogDisplay();
}

function pudim_LogGetBuffer(level) {
	if (level)
		return g_PudimLogBuffer.filter(e => e.level === level);
	return g_PudimLogBuffer.slice();
}

function pudim_LogInit() {
	// Retenção: registra esta partida no índice e apaga o log das que saíram das 10 últimas.
	// Antes a limpeza era por data e varria só os dias 8..14 atrás — quem jogasse muito num
	// dia acumulava tudo num registro só, e quem ficasse 15 dias sem jogar nunca limpava.
	try {
		const idxKey = "pudim.matches";
		let matches = [];
		try {
			const raw = Engine.ConfigDB_GetValue("user", idxKey);
			matches = raw ? JSON.parse(raw) : [];
			if (!Array.isArray(matches)) matches = [];
		} catch(e) { matches = []; }

		const cur = pudim_MatchKey();
		if (matches.indexOf(cur) === -1) matches.push(cur);

		while (matches.length > PUDIM_MATCH_RETENTION) {
			const old = matches.shift();
			// String vazia é como este ConfigDB "apaga" — não há API de remoção de chave.
			Engine.ConfigDB_CreateValue("user", "pudim.log." + old, "");
		}

		Engine.ConfigDB_CreateValue("user", idxKey, JSON.stringify(matches));
		Engine.ConfigDB_SaveChanges("user");
	} catch(e) {}
}

// ═══════════════════════════════════════════════════════════════════
// ESTADO GLOBAL DO PAINEL
// ═══════════════════════════════════════════════════════════════════

/** Controla visibilidade do painel */
var g_PudimPanelOpen = false;

/** Modo compacto: oculta seção de configuração, mostra só estimador */
var g_PudimCompactMode = false;

const PUDIM_CONFIG_ELEMENTS = [
	"pudim_autoWorkHeader", "pudim_autoWorkDesc",
	"pudim_autoWorkToggle", "pudim_autoWorkStatus", "pudim_priorityHeaderLabel",
	"pudim_foodLabel", "pudim_foodMinus", "pudim_foodVal", "pudim_foodPlus",
	"pudim_woodLabel", "pudim_woodMinus", "pudim_woodVal", "pudim_woodPlus",
	"pudim_stoneLabel", "pudim_stoneMinus", "pudim_stoneVal", "pudim_stonePlus",
	"pudim_metalLabel", "pudim_metalMinus", "pudim_metalVal", "pudim_metalPlus",
	"pudim_sendIdleNowBtn",
	"pudim_repeatHeader", "pudim_repeatDesc", "pudim_repeatStatus", "pudim_stopAllRepeatBtn",
	"pudim_aiHeader",
	"pudim_toggleBarterBtn", "pudim_toggleDropsitesBtn", "pudim_toggleRetreatBtn",
	"pudim_toggleFocusBtn", "pudim_toggleGarrisonBtn", "pudim_toggleDebugBtn",
	"pudim_togglePanicBtn", "pudim_panicStatus", "pudim_backToWorkBtn2",
	"pudim_toggleAutoHouseBtn", "pudim_toggleCounterTrainBtn", "pudim_toggleAutoQueueBtn",
	"pudim_counselorHeader", "pudim_counselorTip", "pudim_counselorCameraBtn"
];

function pudim_ToggleCompact()
{
	g_PudimCompactMode = !g_PudimCompactMode;
	pudim_ApplyCompactMode();
}

function pudim_ApplyCompactMode()
{
	const hidden = g_PudimCompactMode;
	for (const name of PUDIM_CONFIG_ELEMENTS)
	{
		const obj = Engine.TryGetGUIObjectByName(name);
		if (obj) obj.hidden = hidden;
	}
	// Redimensiona o painel: compacto mostra só o estimador (~240px), cheio mostra tudo (~1028px)
	const panel = Engine.TryGetGUIObjectByName("pudim_mainPanel");
	if (panel)
		// Painel ancorado à direita da tela (ver 02_pudim_panel.xml)
		panel.size = hidden ? "100%-340 50%-514 100%-20 50%-274" : "100%-340 50%-514 100%-20 50%+550";
	// Atualiza ícone do botão
	const lbl = Engine.TryGetGUIObjectByName("pudim_compactLabel");
	if (lbl) lbl.caption = hidden ? "▶" : "▼";
}

/** Controla se o auto-trabalho está ativo */
var g_PudimAutoWorkEnabled = true;

/** Pesos de prioridade de coleta de recursos */
var g_PudimResourceWeights = { food: 3, wood: 3, stone: 0, metal: 0 };

/** Intervalo do timer de Auto-Trabalho (ms) */
var PUDIM_AUTOWORK_INTERVAL = 500;

/** Intervalo do timer de Estimativa de Combate (ms) */
var PUDIM_COMBAT_INTERVAL = 3000;

/** IDs dos timers ativos */
var g_PudimTimers = { autoWork: null, combat: null };

/** Últimos dados de combate calculados */
var g_PudimLastCombat = null;

/** GUI-side repeat-build state — never touches simulation components (OOS-safe). */
var g_PudimRepeatBuilding = {};   // entId → true (repeat active)
var g_PudimBuilderFoundation = {}; // entId → foundationEntId (currently building)
var g_PudimBuilderLastBuilt = {};  // entId → {template, x, z} (last completed structure)
var g_PudimBuilderPending = {};    // entId → tick counter (waiting for construct to start)

/**
 * Memória de função: última coleta observada de cada unidade, entId → "food"|"wood"|"stone"|"metal".
 * Salva a cada ciclo do auto-work, ANTES de qualquer despacho, e devolvida à simulação como
 * `builderOrigin`. Enquanto a unidade estiver construindo (ordem Repair) ela continua contando
 * no balanceamento pelo recurso que coletava — 15 aldeãs erguendo 3 fazendas seguem sendo 15
 * trabalhadoras de comida. Sem isso o déficit aparente disparava e cada unidade recém-nascida
 * era despachada para o recurso que os construtores tinham acabado de deixar.
 * Estado só de GUI, nunca vai para a simulação: não afeta OOS.
 */
var g_PudimGathererRes = {};

/** Tracking GUI-side para evitar re-envio de ordens (não vai para simulação) */
var g_PudimRetreating = {};
var g_PudimGarrisoned = {};
var g_PudimFocusFixed = {};

/**
 * Quando um armazém automático é construído, guardamos posição + recurso alvo
 * para redirecionar trabalhadores próximos na próxima janela de auto-trabalho.
 * [{ x, z, resource, expireAt }]
 */
var g_PudimPendingDropsiteRedirects = [];
var g_PudimLastDropsiteTime = 0;          // gate externo: min 5s entre chamadas à API
var g_PudimLastDropsiteTimeByRes = { food: 0, wood: 0 }; // cooldown por recurso: min 30s entre builds
var g_PudimLastRedirectTimeByRes = { food: 0, wood: 0 }; // cooldown por recurso: min 20s entre redirects

// Posições de armazém/celeiro que o PRÓPRIO MOD mandou construir (não o jogador).
// O sistema de "enviar ajuda pra fundação" só deve agir nessas — se o jogador iniciou a
// construção manualmente, o mod não deve mexer em nada. [{ x, z, ts }]
var g_PudimModBuiltPositions = [];
function pudim_MarkModBuilt(x, z) {
	g_PudimModBuiltPositions.push({ x: x, z: z, ts: Date.now() });
	// Limpeza: descarta entradas com mais de 3min (fundação já deveria ter sido identificada)
	const cutoff = Date.now() - 180000;
	g_PudimModBuiltPositions = g_PudimModBuiltPositions.filter(p => p.ts > cutoff);
}

/**
 * Posições onde o jogador CANCELOU uma fundação do mod. Nunca mais construir ali.
 * Sem isto o mod reconstruía no mesmo lugar assim que o cooldown expirava — virava loop
 * e os recursos ficavam presos na fundação (problema relatado em jogo).
 * Permanente na sessão: cancelar é decisão explícita do jogador.
 */
var g_PudimCancelledPositions = [];
function pudim_MarkCancelled(x, z) {
	for (const p of g_PudimCancelledPositions) {
		const dx = p.x - x, dz = p.z - z;
		if (dx*dx + dz*dz <= 12*12) return; // já registrado
	}
	g_PudimCancelledPositions.push({ x: x, z: z });
	pudim_Log("INFO", "DROP", "construção cancelada pelo jogador em (" + x.toFixed(0) + "," + z.toFixed(0) + ") — não será refeita ali");
}
function pudim_IsCancelledSpot(x, z) {
	for (const p of g_PudimCancelledPositions) {
		const dx = p.x - x, dz = p.z - z;
		if (dx*dx + dz*dz <= 40*40) return true;
	}
	return false;
}


// ═══════════════════════════════════════════════════════════════════
// INICIALIZAÇÃO
// ═══════════════════════════════════════════════════════════════════

/**
 * Inicializa o painel do PudimMod.
 * Chamado por session~pudim.js durante o init da sessão.
 */
function pudim_Init()
{
	if (typeof g_PudimPanelInitialized !== "undefined" && g_PudimPanelInitialized) return;
	globalThis.g_PudimPanelInitialized = true;

	pudim_LogInit();
	pudim_LogInfo("PudimMod inicializado.");

	// Tooltips de todos os botões, no idioma detectado (pudim_i18n.js). Sobrepõe os
	// tooltips fixos do XML, que estavam só em português e faltavam na maioria dos botões.
	try { pudim_ApplyTooltips(); } catch(e) {}

	const awL = Engine.TryGetGUIObjectByName("pudim_autoWorkLabel");
	if (awL) {
		awL.caption = "( LIGADO ) Auto-Trabalho"; awL.textcolor = "0 255 0 255";
		
	}

	// Inicializar configurações a partir do ConfigDB (default true unless explicitly disabled)
	const autoWorkSaved = Engine.ConfigDB_GetValue("user", "pudim.autowork.enabled");
	g_PudimAutoWorkEnabled = autoWorkSaved !== "false";

	// Pesos de recurso: sempre iniciam no padrão (food=3, wood=3, stone=0, metal=0)
	// Não persistir entre sessões — g_PudimResourceWeights já tem os defaults corretos.

	let savedWorkInterval = Engine.ConfigDB_GetValue("user", "pudim.autowork.interval");
	let savedCombatInterval = Engine.ConfigDB_GetValue("user", "pudim.combat.interval");

	if (savedWorkInterval) PUDIM_AUTOWORK_INTERVAL = (+savedWorkInterval) * 1000;
	if (savedCombatInterval) PUDIM_COMBAT_INTERVAL = (+savedCombatInterval) * 1000;

	// Iniciar timer de estimativa de combate (sempre ativo quando painel aberto)
	// Timer de auto-trabalho só ativa quando habilitado pelo usuário
	pudim_RefreshCombat();

	// Sincronizar UI do Auto-Trabalho se estiver ativo por padrão
	const label = Engine.TryGetGUIObjectByName("pudim_autoWorkLabel");
	const status = Engine.TryGetGUIObjectByName("pudim_autoWorkStatus");
	if (g_PudimAutoWorkEnabled)
	{
		if (label) label.caption = "Desativar Auto-Trabalho";
		if (status) status.caption = "Status: ATIVO - verificando a cada " + (PUDIM_AUTOWORK_INTERVAL / 1000) + "s";
	}
	else
	{
		if (label) label.caption = "Ativar Auto-Trabalho";
		if (status) status.caption = "Status: Desativado";
	}

	// Sincronizar Valores de Peso na UI
	pudim_SetCaption("pudim_foodVal", String(g_PudimResourceWeights.food));
	pudim_SetCaption("pudim_woodVal", String(g_PudimResourceWeights.wood));
	pudim_SetCaption("pudim_stoneVal", String(g_PudimResourceWeights.stone));
	pudim_SetCaption("pudim_metalVal", String(g_PudimResourceWeights.metal));

	// Inicializar cores corretas dos botões de IA avançada
	pudim_UpdateAdvancedAILabels();
	pudim_UpdateAutoHouseButton();

	// Ativar auto-fila em todos os edifícios de produção no início da partida
	// O acumulador começa em 7000 para disparar logo no primeiro tick (após 1s)
	g_PudimAutoQueueAccum = 7000;

	// Tooltips nos labels de dados de combate (os de recurso nao tem name= no XML novo)
	pudim_SetTooltip("pudim_allyCount", "Aliados com capacidade de ataque selecionados ou ao redor da camera.");
	pudim_SetTooltip("pudim_allyHP", "HP atual / HP maximo dos aliados na batalha estimada.");
	pudim_SetTooltip("pudim_allyDPS", "Dano Por Segundo estimado dos aliados (Hack+Pierce+Crush).");
	pudim_SetTooltip("pudim_enemyCount", "Inimigos visiveis detectados num raio de 80 tiles.");
	pudim_SetTooltip("pudim_enemyHP", "HP atual dos inimigos detectados.");
	pudim_SetTooltip("pudim_enemyDPS", "Dano Por Segundo estimado dos inimigos detectados.");
	pudim_SetTooltip("pudim_priorityHeaderLabel", "Ajuste o peso de cada recurso (1=minimo, 10=maximo). Recursos com maior peso serao priorizados pelos trabalhadores ociosos.");
}

/**
 * Define o tooltip de um objeto GUI, com proteção contra null e aplicando estilo sessionToolTipBold.
 * @param {string} name - Nome do elemento GUI
 * @param {string} text - Texto do tooltip
 */
function pudim_SetTooltip(name, text)
{
	const obj = Engine.TryGetGUIObjectByName(name);
	if (obj)
	{
		obj.tooltip = text;
		obj.tooltip_style = "sessionToolTipBold";
	}
}



// ═══════════════════════════════════════════════════════════════════
// TOGGLE PAINEL
// ═══════════════════════════════════════════════════════════════════

/**
 * Abre ou fecha o painel principal do PudimMod.
 */
function pudim_TogglePanel()
{
	g_PudimPanelOpen = !g_PudimPanelOpen;
	const panel = Engine.TryGetGUIObjectByName("pudim_mainPanel");
	if (panel)
		panel.hidden = !g_PudimPanelOpen;

	if (g_PudimPanelOpen)
	{
		pudim_RefreshCombat();
		pudim_UpdateGlobalRepeatStatus();
		pudim_UpdateAdvancedAILabels();
		pudim_UpdateAutoHouseButton();
	}
}


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 1: ESTIMADOR DE COMBATE
// ═══════════════════════════════════════════════════════════════════

/**
 * Atualiza a estimativa de combate consultando a simulação.
 */
function pudim_RefreshCombat()
{
	if (!g_PudimPanelOpen)
		return;

	// Obter unidades selecionadas
	const selection = g_Selection ? g_Selection.toList() : [];

	let combatData;
	try
	{
		combatData = Engine.GuiInterfaceCall("pudim_GetCombatEstimation", {
			"ents": selection
		});
	}
	catch (e)
	{
		// Falha silenciosa — simulação pode não ter a função ainda
		return;
	}

	g_PudimLastCombat = combatData;
	pudim_UpdateCombatDisplay(combatData);
}

/**
 * Atualiza os elementos visuais da seção de combate.
 * @param {Object} data - Resultado de pudim_GetCombatEstimation
 */
function pudim_UpdateCombatDisplay(data)
{
	if (!data)
		return;

	const allies = data.allies;
	const enemies = data.enemies;
	const winChance = data.winChance;

	// Aliados
	pudim_SetCaption("pudim_allyCount", "Aliados: " + allies.count);
	pudim_SetCaption("pudim_allyHP", "HP: " + Math.round(allies.totalHP) + "/" + Math.round(allies.totalMaxHP));
	pudim_SetCaption("pudim_allyDPS", "DPS: " + Math.round(allies.totalAttack * 10) / 10);

	const aTypes = allies.types || { "meleeInf": 0, "rangedInf": 0, "cavalry": 0, "siege": 0, "support": 0 };
	pudim_SetCaption("pudim_allyTypes1", "Inf: " + aTypes.meleeInf + "M / " + aTypes.rangedInf + "R");
	pudim_SetCaption("pudim_allyTypes2", "Cav: " + aTypes.cavalry + " | Cer: " + aTypes.siege + " | Sup: " + aTypes.support);

	// Inimigos
	pudim_SetCaption("pudim_enemyCount", "Inimigos: " + enemies.count);
	pudim_SetCaption("pudim_enemyHP", "HP: " + Math.round(enemies.totalHP));
	pudim_SetCaption("pudim_enemyDPS", "DPS: " + Math.round(enemies.totalAttack * 10) / 10);

	const eTypes = enemies.types || { "meleeInf": 0, "rangedInf": 0, "cavalry": 0, "siege": 0, "support": 0 };
	pudim_SetCaption("pudim_enemyTypes1", "Inf: " + eTypes.meleeInf + "M / " + eTypes.rangedInf + "R");
	pudim_SetCaption("pudim_enemyTypes2", "Cav: " + eTypes.cavalry + " | Cer: " + eTypes.siege + " | Sup: " + eTypes.support);

	// Barra de probabilidade
	pudim_SetCaption("pudim_winChancePct", winChance + "%");

	const bar = Engine.TryGetGUIObjectByName("pudim_winChanceBar");
	if (bar)
	{
		// Ajustar tamanho da barra
		const bgObj = Engine.TryGetGUIObjectByName("pudim_winChanceBg");
		if (bgObj)
		{
			const bgSize = bgObj.size;
			const totalWidth = bgSize.right - bgSize.left - 8; // margem
			const barWidth = Math.round(totalWidth * winChance / 100);
			bar.size = "8 178 " + (8 + barWidth) + " 196";
		}

		// Cor baseada na probabilidade
		if (winChance >= 60)
			bar.sprite = "color: 30 180 60 200";
		else if (winChance >= 40)
			bar.sprite = "color: 200 160 20 200";
		else
			bar.sprite = "color: 200 40 40 200";
	}
}


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 2: AUTO-TRABALHO
// ═══════════════════════════════════════════════════════════════════

/**
 * Ativa ou desativa o Auto-Trabalho.
 */
function pudim_ToggleAutoWork()
{
	g_PudimAutoWorkEnabled = !g_PudimAutoWorkEnabled;

	// Salvar no ConfigDB
	Engine.ConfigDB_CreateValue("user", "pudim.autowork.enabled", String(g_PudimAutoWorkEnabled));
	Engine.ConfigDB_SaveChanges("user");

	const label = Engine.TryGetGUIObjectByName("pudim_autoWorkLabel");
	const status = Engine.TryGetGUIObjectByName("pudim_autoWorkStatus");

	if (g_PudimAutoWorkEnabled)
	{
		if (label) label.caption = "Desativar Auto-Trabalho";
		if (status) status.caption = "Status: ATIVO - verificando a cada " + (PUDIM_AUTOWORK_INTERVAL / 1000) + "s";

		// Executa imediatamente ao ativar
		pudim_RunAutoWork();
	}
	else
	{
		if (label) label.caption = "Ativar Auto-Trabalho";
		if (status) status.caption = "Status: Desativado";
	}
}

/**
 * Callback do timer — executa a lógica de auto-trabalho periodicamente.
 * Chamado a cada PUDIM_AUTOWORK_INTERVAL ms quando ativo.
 */
function pudim_RunAutoWork()
{
	if (!g_PudimAutoWorkEnabled)
		return;

	let result;
	try
	{
		result = Engine.GuiInterfaceCall("pudim_GetIdleWorkersAndBestResource", {
			"weights": g_PudimResourceWeights,
			"repeatBuilders": Object.keys(g_PudimRepeatBuilding).map(Number).filter(ent => g_PudimRepeatBuilding[ent]),
			"playerOrdered": pudim_GetPlayerOrderedIds(),
			"protectedIds": pudim_GetProtectedBuilderIds(),
			"inFlightIds": pudim_GetInFlightBuilderIds(),
			// g_PudimScouts vive em session~pudim.js, mesmo contexto de GUI. O guard cobre a
			// ordem de carga dos scripts: se ainda não existir, a lista sai vazia.
			"scoutIds": (typeof g_PudimScouts !== "undefined" && g_PudimScouts)
				? Object.keys(g_PudimScouts).map(Number) : [],
			"builderOrigin": g_PudimGathererRes
		});
	}
	catch (e)
	{
		return;
	}

	// Memória de função, atualizada ANTES de qualquer despacho deste ciclo: é a leitura do
	// estado como ele estava quando a chamada foi feita. Quem estiver construindo no
	// próximo ciclo é contado no recurso que aparece aqui, e não some do balanceamento.
	// A poda por trackedIds evita que a memória cresça com entidades já mortas.
	if (result && result.trackedIds) {
		const alive = {};
		for (const id of result.trackedIds) {
			// Quem está coletando agora traz valor novo; quem está construindo mantém o antigo.
			const res = result.gathererRes ? result.gathererRes[id] : null;
			const keep = res || g_PudimGathererRes[id];
			if (keep) alive[id] = keep;
		}
		g_PudimGathererRes = alive;
	}

	// Long walkers: tentar construir dropsite perto do recurso-alvo; redirect só como fallback
	if (result && result.longWalkers && result.longWalkers.length > 0) {
		// 8/tick (era 3): com o ciclo de 500ms do auto-work, 3 deixava fila de caminhantes
		// acumular mais rápido do que era drenada em economias grandes
		const lw = result.longWalkers.slice(0, 8);
		const nowLW = Date.now();
		// Limpa janelas vencidas ANTES de decidir: sem isso, entradas expiradas
		// continuariam bloqueando redirects legítimos.
		for (const did in g_PudimInTransitUntil)
			if (nowLW > g_PudimInTransitUntil[did])
				delete g_PudimInTransitUntil[did];
		let builtCount = 0, redirectCount = 0, heldCount = 0;
		for (const w of lw) {
			if (g_PudimHouseBuilderCooldown[w.id]) continue;
			// Quem o próprio auto-work acabou de despachar está a caminho por decisão do mod;
			// desfazer isso no meio do trajeto é o vai-e-vem medido nos replays de 13/08.
			// Nenhuma checagem do gênero existia aqui: a carência de despacho só era
			// consultada no filtro de idleWorkers, mais abaixo, e o detector de long-walker
			// atua sobre unidades NÃO ociosas — exatamente as que estavam em trânsito.
			if (g_PudimInTransitUntil[w.id]) { heldCount++; continue; }

			// Tenta construir dropsite colado ao recurso-alvo
			let builtDropsite = false;
			if (w.targetResX !== undefined && w.targetResType) {
				const fnName = w.targetResType === "food"
					? "pudim_GetProactiveFarmsteadData"
					: "pudim_GetProactiveStorehouseData";
				const ck = "lw_" + Math.round(w.targetResX) + "_" + Math.round(w.targetResZ);
				if (!g_PudimLastDropsiteTimeByRes[ck] || nowLW - g_PudimLastDropsiteTimeByRes[ck] > 30000) {
					try {
						const pd = Engine.GuiInterfaceCall(fnName, { nearX: w.targetResX, nearZ: w.targetResZ, protectedIds: pudim_GetProtectedBuilderIds() });
						if (pd && pd.builderId && pd.template && pd.candidatePositions && pd.candidatePositions.length > 0) {
							let fx = null, fz = null;
							for (const pos of pd.candidatePositions) {
								if (pudim_IsCancelledSpot(pos.x, pos.z)) continue; // jogador cancelou aqui
								let r2 = null;
								try { r2 = Engine.GuiInterfaceCall("SetBuildingPlacementPreview",
									{ "template": pd.template, "x": pos.x, "z": pos.z, "angle": 0, "actorSeed": 0 }); } catch(e2) {}
								if (r2 && r2.success) { fx = pos.x; fz = pos.z; break; }
							}
							try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e2) {}
							if (fx !== null) {
								Engine.PostNetworkCommand({ "type": "construct", "entities": [pd.builderId],
									"template": pd.template, "x": fx, "z": fz,
									"angle": 0, "actorSeed": 0, "autorepair": true, "autocontinue": true, "queued": false });
								pudim_MarkModBuilt(fx, fz);
								g_PudimLastDropsiteTimeByRes[ck] = nowLW;
								pudim_ProtectBuilder(pd.builderId, nowLW + 30000);
								builtDropsite = true;
								builtCount++;
							}
						}
					} catch(e2) {}
				} else {
					builtDropsite = true; // cooldown ativo: deixar worker continuar, dropsite vem a caminho
				}
			}

			// Fallback: sem dropsite possível → redirecionar para recurso próximo de dropsite existente
			if (!builtDropsite && w.redirectTarget) {
				Engine.PostNetworkCommand({ "type": "gather", "entities": [w.id],
					"target": w.redirectTarget, "autorepair": true, "autocontinue": true,
					"queued": false, "pushFront": false });
				// 15s protegido contra re-redirecionamento por outros sistemas durante a caminhada
				pudim_ProtectBuilder(w.id, nowLW + 15000);
				redirectCount++;
			}
		}
		if (builtCount > 0)
			pudim_Log("SUCCESS", "DROP", "dropsite pré-coleta construído para " + builtCount + " walker(s)");
		if (redirectCount > 0)
			pudim_Log("INFO", "WALK", "redirecionando " + redirectCount + " walker(s) sem dropsite disponível");
		if (heldCount > 0) g_PudimWalkHeld += heldCount;
	}

	if (!result || !result.idleWorkers || result.idleWorkers.length === 0)
	{
		const status = Engine.TryGetGUIObjectByName("pudim_autoWorkStatus");
		if (status) status.caption = "Status: ATIVO — nenhum trabalhador ocioso";
		return;
	}

	// Limpar cooldowns expirados e filtrar builders que acabaram de receber construct
	const nowAutoWork = Date.now();
	for (const bid in g_PudimHouseBuilderCooldown) {
		if (nowAutoWork > g_PudimHouseBuilderCooldown[bid])
			delete g_PudimHouseBuilderCooldown[bid];
	}
	// Limpa carências vencidas e ignora quem acabou de ser despachado (ver g_PudimDispatchedAt).
	// O valor guardado é o instante de EXPIRAÇÃO, já dimensionado pela viagem.
	for (const did in g_PudimDispatchedAt)
		if (nowAutoWork > g_PudimDispatchedAt[did])
			delete g_PudimDispatchedAt[did];
	for (const did in g_PudimInTransitUntil)
		if (nowAutoWork > g_PudimInTransitUntil[did])
			delete g_PudimInTransitUntil[did];
	// Além de 30s a entrada não conta mais como rotatividade — pode ser descartada.
	for (const did in g_PudimLastDispatchTime)
		if (nowAutoWork - g_PudimLastDispatchTime[did] > 30000)
			delete g_PudimLastDispatchTime[did];

	const bestResource = result.bestResource;

	// Construção proativa de armazém (madeira) ou farmstead (fruta) quando worker vai longe.
	// Roda ANTES do despacho: a ordem inversa (despachar e só depois erguer o dropsite)
	// fazia o coletor sair, encher a carga e atravessar a base de volta ao CC enquanto o
	// armazém ainda nem tinha sido colocado — a mensagem "antes da 1a colheita" no log
	// descrevia uma intenção que o código não cumpria. Colocando a fundação primeiro, a
	// obra corre em paralelo com a caminhada de ida e está pronta na hora da entrega.
	// result[suggestKey] é uma LISTA de clusters distantes distintos deste ciclo (não só 1) —
	// tenta cada um até o primeiro que der certo; os outros tentam de novo no próximo ciclo.
	const proactiveBuilders = {};
	const pudim_tryProactiveBuild = function(suggestKey, fnName, resKey, logLabel, minCooldown) {
		const candidates = result[suggestKey];
		if (!candidates || candidates.length === 0 || !g_PudimAdvancedAIEnabled["dropsites"]) return;
		const resCooldown = g_PudimLastDropsiteTimeByRes[resKey] || 0;
		if (Date.now() - resCooldown <= minCooldown) return;
		for (const cand of candidates) {
			try {
				const proactive = Engine.GuiInterfaceCall(fnName, { nearX: cand.x, nearZ: cand.z, protectedIds: pudim_GetProtectedBuilderIds() });
				if (!proactive || !proactive.builderId || !proactive.template ||
				    !proactive.candidatePositions || proactive.candidatePositions.length === 0) continue;
				let foundX = null, foundZ = null;
				for (const pos of proactive.candidatePositions) {
					if (pudim_IsCancelledSpot(pos.x, pos.z)) continue; // jogador cancelou aqui
					let res2 = null;
					try {
						res2 = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
							"template": proactive.template, "x": pos.x, "z": pos.z,
							"angle": 0, "actorSeed": 0
						});
					} catch(e2) {}
					if (res2 && res2.success) { foundX = pos.x; foundZ = pos.z; break; }
				}
				try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e2) {}
				if (foundX !== null) {
					Engine.PostNetworkCommand({
						"type": "construct",
						"entities": [proactive.builderId],
						"template": proactive.template,
						"x": foundX, "z": foundZ,
						"angle": 0, "actorSeed": 0,
						"autorepair": true, "autocontinue": true, "queued": false
					});
					pudim_MarkModBuilt(foundX, foundZ);
					g_PudimLastDropsiteTimeByRes[resKey] = Date.now();
					// O builder acabou de receber "construct". Sem marcá-lo, o despacho logo
					// abaixo mandaria o mesmo trabalhador colher e cancelaria a obra — era o
					// motivo de a ordem antiga (despachar primeiro) parecer funcionar.
					proactiveBuilders[proactive.builderId] = true;
					pudim_Log("SUCCESS", "DROP", logLabel + " proativo em (" + foundX.toFixed(0) + "," + foundZ.toFixed(0) + ") antes da 1a colheita");
					return; // 1 build por ciclo (respeita cooldown); demais candidatos tentam no próximo
				}
			} catch(e2) { pudim_Log("ERROR", "DROP", logLabel + " proatv: " + e2); }
		}
	};
	pudim_tryProactiveBuild("suggestStorehouse", "pudim_GetProactiveStorehouseData", "wood", "armazem", 20000);
	pudim_tryProactiveBuild("suggestFarmstead", "pudim_GetProactiveFarmsteadData", "food", "farmstead", 25000);

	// O filtro por g_PudimHouseBuilderCooldown saiu daqui: ele barrava por tempo absoluto
	// (até 30s) e, junto com a mesma trava do lado da simulação, era o que deixava
	// construtores parados depois de terminar a obra. A simulação já só reporta como ocioso
	// quem realmente está — resta barrar o comando ainda em voo.
	const inFlightNow = {};
	for (const id of pudim_GetInFlightBuilderIds()) inFlightNow[id] = true;
	const idleWorkers = result.idleWorkers.filter(w =>
		!inFlightNow[w.id] && !g_PudimDispatchedAt[w.id] && !proactiveBuilders[w.id]);

	// Agrupar trabalhadores por alvo direto (ex: cardume, animal) ou por coordenada genérica
	let targetGroups = {};
	let positionGroups = {};
	// Distância da viagem por unidade, usada para dimensionar a carência de reavaliação.
	const distById = {};
	for (const w of idleWorkers)
		if (w.dist) distById[w.id] = w.dist;

	for (let worker of idleWorkers)
	{
		if (worker.target)
		{
			// Se o type for um objeto (recurso), a ordem eh 'gather'
			let cmdType = "gather";
			if (typeof worker.type === "string") cmdType = worker.type;
			
			let tKey = worker.target + "_" + cmdType;
			if (!targetGroups[tKey])
				targetGroups[tKey] = { target: worker.target, cmdType: cmdType, ids: [] };
			targetGroups[tKey].ids.push(worker.id);
		}
		else
		{
			if (worker.x === null || worker.z === null || !worker.type)
				continue;
			let key = Math.round(worker.x) + "," + Math.round(worker.z) + "," + worker.type.generic;

			if (!positionGroups[key])
			{
				positionGroups[key] = {
					"x": worker.x,
					"z": worker.z,
					"type": worker.type,
					"ids": []
				};
			}
			positionGroups[key].ids.push(worker.id);
		}
	}

	// 1. Enviar ordens diretas para alvos específicos
	for (let key in targetGroups)
	{
		let grp = targetGroups[key];
		Engine.PostNetworkCommand({
			"type": grp.cmdType,
			"entities": grp.ids,
			"target": +grp.target,
			"autorepair": true,
			"autocontinue": true,
			"queued": false,
			"pushFront": false
		});
		pudim_MarkDispatched(grp.ids, distById);
	}

	// 2. Enviar ordens direcionadas por posição (gather-near-position)
	for (let key in positionGroups)
	{
		let gp = positionGroups[key];
		let cmd = {
			"type": "gather-near-position",
			"entities": gp.ids,
			"resourceType": gp.type,
			"resourceTemplate": "",
			"x": gp.x,
			"z": gp.z,
			"queued": false,
			"force": false
		};
		Engine.PostNetworkCommand(cmd);
		pudim_MarkDispatched(gp.ids, distById);
	}

	// Atualizar status
	const resNames = { food: "Comida", wood: "Madeira", stone: "Pedra", metal: "Metal" };
	const status = Engine.TryGetGUIObjectByName("pudim_autoWorkStatus");
	if (status)
		status.caption = "Status: ATIVO — enviou " + idleWorkers.length + " para " + (resNames[bestResource] || bestResource);
}

/**
 * Envia trabalhadores ociosos imediatamente (botão manual).
 */
function pudim_SendIdleWorkersNow()
{
	// Temporariamente forçar mesmo que auto-work esteja desabilitado
	const wasEnabled = g_PudimAutoWorkEnabled;
	g_PudimAutoWorkEnabled = true;
	pudim_RunAutoWork();
	g_PudimAutoWorkEnabled = wasEnabled;
}

/**
 * Handler de mudança de peso de recurso.
 * @param {string} resource - "food" | "wood" | "stone" | "metal"
 * @param {number} value - novo peso (1-10)
 */
function pudim_OnWeightChange(resource, value)
{
	g_PudimResourceWeights[resource] = +value;

	// Atualizar label de valor
	const labelNames = { food: "pudim_foodVal", wood: "pudim_woodVal", stone: "pudim_stoneVal", metal: "pudim_metalVal" };
	const labelName = labelNames[resource];
	if (labelName)
		pudim_SetCaption(labelName, String(Math.round(+value)));

	// Pesos não são persistidos entre sessões — sem save no ConfigDB.
}

/**
 * Ajusta o peso de coleta de um recurso por um delta (+1 ou -1) e atualiza a UI.
 * @param {string} resource - "food" | "wood" | "stone" | "metal"
 * @param {number} delta - Valor a somar/subtrair
 */
function pudim_AdjustWeight(resource, delta)
{
	let val = g_PudimResourceWeights[resource] !== undefined ? g_PudimResourceWeights[resource] : 3;
	val += delta;
	if (val < 0) val = 0;
	if (val > 10) val = 10;
	pudim_OnWeightChange(resource, val);
}


// ═══════════════════════════════════════════════════════════════════
// SEÇÃO 3: REPETIR CONSTRUÇÃO
// ═══════════════════════════════════════════════════════════════════

/**
 * Ativa ou desativa o repeat-building nos construtores selecionados.
 * Estado mantido inteiramente no lado da GUI — sem comandos de rede,
 * sem propriedades na simulação → sem OOS em multiplayer.
 */
function pudim_ToggleRepeatBuild()
{
	const selection = g_Selection ? g_Selection.toList() : [];
	if (!selection.length)
		return;

	// Toggle: se qualquer um estiver ativo, desativa todos; senão ativa todos
	const anyActive = selection.some(ent => g_PudimRepeatBuilding[ent]);
	const newState = !anyActive;

	for (const ent of selection)
	{
		if (newState)
		{
			g_PudimRepeatBuilding[ent] = true;
		}
		else
		{
			delete g_PudimRepeatBuilding[ent];
			delete g_PudimBuilderLastBuilt[ent];
			delete g_PudimBuilderFoundation[ent];
			delete g_PudimBuilderPending[ent];
		}
	}

	pudim_UpdateGlobalRepeatStatus();
	pudim_UpdateAdvancedAILabels();

	g_PudimPanelOpen = true;
	pudim_RefreshCombat();
}

/** Configuração dos Toggles Avançados */
var g_PudimAdvancedAIEnabled = {
	"barter": Engine.ConfigDB_GetValue("user", "pudim.advanced.barter") !== "false",
	"dropsites": Engine.ConfigDB_GetValue("user", "pudim.advanced.dropsites") !== "false",
	// retreat e focus nascem DESLIGADOS (=== "true" em vez de !== "false"): são as duas
	// ajudas que mais brigam com o controle manual em combate, e é assim que o mod é
	// jogado na prática. Quem quiser liga no painel; a escolha persiste normalmente.
	"retreat": Engine.ConfigDB_GetValue("user", "pudim.advanced.retreat") === "true",
	"focus": Engine.ConfigDB_GetValue("user", "pudim.advanced.focus") === "true",
	"garrison": Engine.ConfigDB_GetValue("user", "pudim.advanced.garrison") !== "false",
	"panic": Engine.ConfigDB_GetValue("user", "pudim.advanced.panic") !== "false",
	"countertrain": Engine.ConfigDB_GetValue("user", "pudim.advanced.countertrain") !== "false",
	"autoqueue": Engine.ConfigDB_GetValue("user", "pudim.advanced.autoqueue") !== "false"
};

// Chave-mestra: quando OFF, nenhuma ajuda de combate age (foco de fogo, retreat, kite,
// pânico, guarnição, counter-train). Os toggles individuais continuam existindo, mas
// esta chave tem precedência — permite jogar batalhas 100% no controle manual.
var g_PudimCombatAssistsEnabled =
	Engine.ConfigDB_GetValue("user", "pudim.advanced.combat") !== "false";

/** true se a ajuda de combate `key` pode agir (mestre ligado E toggle individual ligado) */
function pudim_CombatAssistOn(key) {
	return g_PudimCombatAssistsEnabled && g_PudimAdvancedAIEnabled[key];
}

function pudim_ToggleCombatAssists() {
	g_PudimCombatAssistsEnabled = !g_PudimCombatAssistsEnabled;
	Engine.ConfigDB_CreateValue("user", "pudim.advanced.combat", String(g_PudimCombatAssistsEnabled));
	Engine.ConfigDB_SaveChanges("user");
	// Desligar solta imediatamente quem o pânico tinha guarnecido
	if (!g_PudimCombatAssistsEnabled && g_PudimPanicMode) {
		try { pudim_ReturnPanicUnitsToWork(); } catch(e) {}
	}
	pudim_Log("INFO", "MOD", "Ajudas de combate: " + (g_PudimCombatAssistsEnabled ? "LIGADAS" : "DESLIGADAS"));
	pudim_UpdateAdvancedAILabels();
}

/** Estado do Sistema de Pânico */
var g_PudimPanicMode = false;
var g_PudimPanicPreTask = {};     // entId -> { type, target, x, z, resType }
var g_PudimPanicGarrisoned = {};  // entId -> true (já enviado para abrigo)
var g_PudimPanicLastThreat = 0;   // Timestamp da última ameaça detectada
var g_PudimPanicModeStartTime = 0; // Quando o pânico atual começou (válvula de segurança)
// Pânico TOTAL (exército grande/inferioridade): só esse trava o auto-work. O modo "defendendo"
// (escaramuça com tropas suficientes) protege trabalhadores em risco mas deixa a economia rodar —
// no log real, 1 batedor inimigo paralisou o auto-work por 2min e deixou 99 unidades ociosas.
var g_PudimPanicFull = false;
// Travas de segurança para NUNCA desguarnecer sozinho (ver pudim_ReturnPanicUnitsToWork).
// Atualizadas a cada leitura de pudim_GetPanicData.
var g_PudimNoCivCentre = false;        // Centro Cívico destruído
var g_PudimSheltersUnderSiege = 0;     // abrigos ocupados com inimigo a ≤80m
var g_PudimHoldGarrisonLogged = false; // evita repetir o log de "mantendo guarnecidas"

// ── Histerese do pânico ────────────────────────────────────────────────────────
// No replay 0013 foram 562 "garrison" + 556 "unload" (1.118 de 3.770 comandos), com as
// MESMAS unidades guarnecidas de 5 a 7 vezes: guarnece → ameaça "some" → solta → detecta
// de novo → guarnece. Enquanto guarnecido o trabalhador não coleta nada, então esse loop
// consumia a economia. Três travas: ciclos consecutivos para entrar/sair, e um teto de
// guarnições por unidade por partida.
var g_PudimThreatStreak = 0;      // ciclos consecutivos COM ameaça
var g_PudimCalmStreak = 0;        // ciclos consecutivos SEM ameaça
var g_PudimLastReleaseTime = {};  // entId -> quando foi solto do abrigo pela última vez
const PUDIM_THREAT_CYCLES_TO_PANIC = 2;  // ~3s (ciclo de 1,5s) antes de guarnecer
const PUDIM_CALM_CYCLES_TO_RELEASE = 4;  // ~6s de calma antes de soltar
// Tempo mínimo entre SOLTAR e guarnecer de novo a MESMA unidade. Não é um teto por
// partida: se a base for atacada 10 vezes, o trabalhador é protegido 10 vezes. Isto só
// impede o vai-e-volta patológico (soltar e re-guarnecer em segundos) que travava a coleta.
const PUDIM_REGARRISON_COOLDOWN = 20000;

/** true se a unidade pode ser guarnecida agora (não foi solta há pouquíssimo tempo) */
function pudim_CanGarrison(entId) {
	const last = g_PudimLastReleaseTime[entId];
	return !last || (Date.now() - last) > PUDIM_REGARRISON_COOLDOWN;
}
var PUDIM_PANIC_MAX_DURATION = 120000; // 2min: força retorno mesmo se detecção ficar "presa" (ex: inimigo parado perto do CC sem atacar)


// Sempre inicia em 5 ("faltando 5") em toda partida — intencionalmente NÃO persiste no
// ConfigDB: o toggle vale só para a sessão atual. Com 3 a casa saía tarde demais e a
// população travava esperando a obra terminar.
var g_PudimAutoHouseThreshold = 5;
var g_LastAutoHouseAttempt = 0;      // última vez que uma casa foi CONSTRUÍDA
var g_LastAutoHouseCheck = 0;        // última vez que a condição foi VERIFICADA
var g_PudimLastHouseProdCount = 1;   // CC+barracas na última checagem (cooldown adaptativo)
var g_PudimHouseBuilderCooldown = {}; // {entityId: expiryMs} — builders protegidos de reassign após construct
var g_PudimBuilderCmdAt = {};         // {entityId: instante do comando} — janela de "comando em voo"
// Janela em que o comando ainda não foi aplicado pela simulação. PostNetworkCommand é
// assíncrono: por 1-2 turnos a unidade ainda LÊ como ociosa, e despachá-la nesse intervalo
// sobrescreveria o Repair que acabou de sair. Passado isso, ociosa quer dizer ociosa.
const PUDIM_CMD_IN_FLIGHT = 2500;

/**
 * Protege um construtor de reatribuição até `expiryMs` e marca o instante do comando.
 * Todo ponto que protege um builder passa por aqui — sem o instante do comando não há como
 * separar "o comando ainda não chegou" de "a obra acabou e a unidade está parada".
 */
function pudim_ProtectBuilder(id, expiryMs) {
	g_PudimHouseBuilderCooldown[id] = expiryMs;
	g_PudimBuilderCmdAt[id] = Date.now();
}

/** IDs cujo comando ainda pode não ter sido aplicado pela simulação. */
function pudim_GetInFlightBuilderIds() {
	const now = Date.now();
	const ids = [];
	for (const id in g_PudimBuilderCmdAt) {
		if (now - g_PudimBuilderCmdAt[id] <= PUDIM_CMD_IN_FLIGHT) ids.push(+id);
		else if (now - g_PudimBuilderCmdAt[id] > 120000) delete g_PudimBuilderCmdAt[id];
	}
	return ids;
}

// Trabalhadores que ACABARAM de receber ordem de coleta. PostNetworkCommand é assíncrono:
// a ordem só aparece no orderQueue alguns ticks depois, então no ciclo seguinte o
// trabalhador ainda consta como ocioso e era reavaliado do zero. Como o déficit muda entre
// ciclos, ele era mandado para OUTRO recurso — no log da partida a unidade 8229 recebeu
// 12 ordens (5737, 161, 167, 7806, cada uma repetida 3x) sem nunca chegar a coletar.
// Este carência elimina tanto o reenvio quanto o vai-e-vem entre recursos.
// Guarda o INSTANTE DE EXPIRAÇÃO, não o de despacho.
var g_PudimDispatchedAt = {};        // {entityId: expiração da carência CURTA}
const PUDIM_DISPATCH_GRACE = 6000;   // ms sem reavaliar quem acabou de ser despachado

// Janela de VIAGEM, separada da carência curta acima — e a separação é essencial.
// g_PudimDispatchedAt filtra `result.idleWorkers`, que por construção só contém unidades
// OCIOSAS. Dimensionar aquela carência pela viagem faria o oposto do pretendido: se a ordem
// falhasse (recurso esgotado na chegada), o trabalhador ficaria parado até 45s sem ser
// reaproveitado. A janela de viagem serve só ao detector de long-walker, que atua sobre
// unidades NÃO ociosas — as que estão de fato em trânsito.
var g_PudimInTransitUntil = {};      // {entityId: expiração da janela de viagem}
// Custo estimado de caminhada. Um aldeão anda ~8 units/s no Alpha 28; 160 ms/unit equivale
// a ~6,2 units/s, folga proposital para terreno acidentado e desvios de pathfinding.
// É uma constante de ajuste, não uma medição — se a janela ficar curta ou longa demais,
// é este número que se mexe.
const PUDIM_WALK_MS_PER_UNIT = 160;
const PUDIM_IN_TRANSIT_MAX = 45000;  // teto: viagem longa não pode blindar a unidade para sempre

// Telemetria de rotatividade (só GUI). g_PudimChurnCount = reordens em menos de 30s;
// g_PudimWalkHeld = redirects de long-walker barrados pela carência. Ambos zerados a cada
// SNAP, então o log mostra o valor do último minuto e não um acumulado da partida.
var g_PudimLastDispatchTime = {};    // {entityId: timestamp do último despacho}
var g_PudimChurnCount = 0;
var g_PudimWalkHeld = 0;

/**
 * Marca trabalhadores como recém-despachados, protegendo-os de reatribuição.
 * Abre também a janela de viagem: com a carência fixa de 6s, uma ida de 150 units (~24s de
 * caminhada) ficava desprotegida a partir do sexto segundo, e o detector de long-walker
 * desfazia no meio do trajeto a ordem que o auto-work tinha acabado de dar. Nos replays de
 * 13/08 isso respondia por ~25% de todas as reordenações (132 e 86 casos em menos de 30s).
 */
function pudim_MarkDispatched(ids, distById) {
	const now = Date.now();
	for (const id of ids) {
		// Telemetria de rotatividade: reordenar em menos de 30s significa que a unidade
		// mudou de alvo antes de alcançar o anterior — viagem perdida. Nos replays de
		// 13/08 isso era ~25% de todas as reordenações; é o número que diz se a carência
		// proporcional resolveu.
		if (g_PudimLastDispatchTime[id] && now - g_PudimLastDispatchTime[id] <= 30000)
			g_PudimChurnCount++;
		g_PudimLastDispatchTime[id] = now;

		g_PudimDispatchedAt[id] = now + PUDIM_DISPATCH_GRACE;

		const d = (distById && distById[id]) || 0;
		g_PudimInTransitUntil[id] = now + Math.min(PUDIM_IN_TRANSIT_MAX,
			PUDIM_DISPATCH_GRACE + Math.round(d * PUDIM_WALK_MS_PER_UNIT));
	}
}
// IDs atualmente protegidos (não expirados) — repassar pra simulação, que não tem acesso
// direto a esse dict do GUI, pra sistemas de "buscar qualquer builder disponível" não
// sequestrarem quem acabou de ser despachado (ex: aldeãs do balanceamento inicial).
function pudim_GetProtectedBuilderIds() {
	const now = Date.now();
	const ids = [];
	for (const id in g_PudimHouseBuilderCooldown)
		if (g_PudimHouseBuilderCooldown[id] > now) ids.push(+id);
	return ids;
}

/**
 * Unidades que receberam ordem MANUAL do jogador (preenchido pelo hook de
 * handleUnitAction em session~pudim.js).
 *
 * Regra de proteção — o que vier primeiro:
 *   • 2 minutos desde a ordem, OU
 *   • a unidade ficar ociosa (terminou de construir/coletar) → livre na hora.
 * A checagem de "ociosa" é feita no lado da simulação, que é quem enxerga o UnitAI.
 * Aqui só aplicamos o teto de tempo.
 */
var g_PudimPlayerOrders = {};
const PUDIM_PLAYER_ORDER_PROTECTION = 120000; // 2 min
function pudim_GetPlayerOrderedIds() {
	const cutoff = Date.now() - PUDIM_PLAYER_ORDER_PROTECTION;
	const ids = [];
	for (const id in g_PudimPlayerOrders) {
		if (g_PudimPlayerOrders[id] < cutoff) { delete g_PudimPlayerOrders[id]; continue; }
		ids.push(+id);
	}
	return ids;
}
var g_AutoHouseCandidateOffset = 0;
var g_PudimLastHouseLogTime = 0;
var g_PudimLastDropsiteLogTime = 0;
var g_PudimLastDropsiteDiagTime = 0; // Timer separado para log diagnóstico (evita conflito com GATE)
var g_PudimFarmDebugLastLog = 0;

function pudim_ToggleAutoHouse() {
	if (g_PudimAutoHouseThreshold === 12) g_PudimAutoHouseThreshold = 8;
	else if (g_PudimAutoHouseThreshold === 8) g_PudimAutoHouseThreshold = 5;
	else if (g_PudimAutoHouseThreshold === 5) g_PudimAutoHouseThreshold = 3;
	else if (g_PudimAutoHouseThreshold === 3) g_PudimAutoHouseThreshold = 0;
	else g_PudimAutoHouseThreshold = 12;
	// Sem persistência: toda partida recomeça no padrão 5
	pudim_UpdateAutoHouseButton();
}

function pudim_UpdateAutoHouseButton() {
	const btnL = Engine.TryGetGUIObjectByName("pudim_toggleAutoHouseLabel");
	if (!btnL) return;
	if (g_PudimAutoHouseThreshold === 0) {
		btnL.caption = "(OFF) Auto-Casas";
		btnL.textcolor = "180 180 180 255";
	} else {
		btnL.caption = "(ON) Auto-Casas (Faltando " + g_PudimAutoHouseThreshold + ")";
		btnL.textcolor = "255 255 255 255";
	}
}

function pudim_ToggleAdvancedAI(key)
{
	g_PudimAdvancedAIEnabled[key] = !g_PudimAdvancedAIEnabled[key];
	Engine.ConfigDB_CreateValue("user", "pudim.advanced." + key, String(g_PudimAdvancedAIEnabled[key]));
	Engine.ConfigDB_SaveChanges("user");
	pudim_UpdateAdvancedAILabels();
}

function pudim_UpdateAdvancedAILabels()
{
	const configs = [
		{ key: "barter", labelId: "pudim_toggleBarterLabel", name: "Mercado Inteligente" },
		{ key: "dropsites", labelId: "pudim_toggleDropsitesLabel", name: "Smart Dropsites" },
		{ key: "retreat", labelId: "pudim_toggleRetreatLabel", name: "Auto-Retreat (HP < 20%)" },
		{ key: "focus", labelId: "pudim_toggleFocusLabel", name: "Smart Focus Fire" },
		{ key: "garrison", labelId: "pudim_toggleGarrisonLabel", name: "Auto-Guarnição Defensiva" },
		{ key: "panic", labelId: "pudim_togglePanicLabel", name: "Sistema de Pânico" },
		{ key: "countertrain", labelId: "pudim_toggleCounterTrainLabel", name: "Auto Counter-Train" },
		{ key: "autoqueue", labelId: "pudim_toggleAutoQueueLabel", name: "Auto-Fila (Treino)" }
	];

	// Atualizar label de debug separado (não faz parte de g_PudimAdvancedAIEnabled)
	const debugLabel = Engine.TryGetGUIObjectByName("pudim_toggleDebugLabel");
	if (debugLabel) {
		debugLabel.caption = g_PudimShowDebug ? "(ON) Mensagens de Debug" : "(OFF) Mensagens de Debug";
		debugLabel.textcolor = g_PudimShowDebug ? "255 255 255 255" : "150 150 150 255";
	}

	// Chave-mestra das ajudas de combate
	const combatLabel = Engine.TryGetGUIObjectByName("pudim_toggleCombatLabel");
	if (combatLabel) {
		combatLabel.caption = (g_PudimCombatAssistsEnabled ? "(ON)" : "(OFF)") + " AJUDAS DE COMBATE (tudo)";
		combatLabel.textcolor = g_PudimCombatAssistsEnabled ? "80 220 80 255" : "220 80 80 255";
	}

	// Toggles individuais de combate aparecem apagados quando a chave-mestra está OFF
	const combatKeys = { retreat: 1, focus: 1, garrison: 1, panic: 1, countertrain: 1 };
	for (const cfg of configs)
	{
		const obj = Engine.TryGetGUIObjectByName(cfg.labelId);
		if (obj)
		{
			const on = g_PudimAdvancedAIEnabled[cfg.key];
			const masterOff = combatKeys[cfg.key] && !g_PudimCombatAssistsEnabled;
			obj.caption = (masterOff ? "(OFF-M)" : (on ? "(ON)" : "(OFF)")) + " " + cfg.name;
			obj.textcolor = masterOff ? "130 130 130 255" : (on ? "80 220 80 255" : "220 80 80 255");
		}
	}
}

/**
 * Desativa o repeat-building em TODOS os construtores.
 */
function pudim_StopAllRepeat()
{
	g_PudimRepeatBuilding = {};
	g_PudimBuilderLastBuilt = {};
	g_PudimBuilderFoundation = {};
	g_PudimBuilderPending = {};

	pudim_SetCaption("pudim_repeatStatus", "Nenhum construtor em repeat");
	if (typeof pudim_UpdateSelectionButton === "function")
		pudim_UpdateSelectionButton();
}

/**
 * Atualiza o painel de repeat quando a seleção muda.
 */
function pudim_OnSelectionChange()
{
	if (!g_PudimPanelOpen)
		return;

	pudim_UpdateGlobalRepeatStatus();
}

/**
 * Atualiza o label do painel lateral com a quantidade global de construtores em repeat.
 */
function pudim_UpdateGlobalRepeatStatus()
{
	const status = Engine.TryGetGUIObjectByName("pudim_repeatStatus");
	if (!status)
		return;

	const count = Object.keys(g_PudimRepeatBuilding).filter(ent => g_PudimRepeatBuilding[+ent]).length;

	if (count > 0)
		status.caption = "Construtores em repeat: " + count;
	else
		status.caption = "Nenhum construtor em repeat";
}


// ═══════════════════════════════════════════════════════════════════
// TICK PRINCIPAL (chamado pelo timer de sessão)
// ═══════════════════════════════════════════════════════════════════

/** Acumulador de tempo para auto-trabalho */
var g_PudimAutoWorkAccum = 0;

/** Acumulador de tempo para combate */
var g_PudimCombatAccum = 0;

/** Acumulador de tempo para repeat-build */
var g_PudimRepeatAccum = 0;

/** Dicionário de timestamps dos avisos de falta de recursos por template */
var g_PudimLastRepeatWarnTime = {};

/** Acumulador de tempo para inteligência avançada */
var g_PudimAdvancedAIAccum = 0;

/** Acumulador de tempo para auto-kite */
var g_PudimKiteAccum = 0;

/** Acumulador de tempo para o sistema de pânico */
var g_PudimPanicAccum = 0;

/** Acumulador de tempo para re-ativar auto-fila */
var g_PudimAutoQueueAccum = 0;

/** Cache de templates por edifício — usado para reiniciar fila vazia */
var g_PudimAutoQueueTemplates = {};
/** Contagem desejada de treino por edifício — baseada no maior count observado */
var g_PudimAutoQueueDesiredCount = {};
// Instante da última semeadura por edifício — carência contra semear duas vezes antes de
// o comando anterior (ou uma ordem do jogador) aparecer na fila.
var g_PudimQueueSeededAt = {};
// Template da última semeadura por edifício. Sem ele não há como distinguir um lote do mod
// de uma ordem do jogador — e foi essa confusão que trocou soldados por aldeões.
var g_PudimQueueSeededTpl = {};
/** Edifícios já avisados por falta de template treinável (evita repetir o log a cada 3s) */
var g_PudimQueueNoTplLogged = {};

/** Edifícios que o Pudim ativou autoqueue — para detectar desativação manual */
var g_PudimAutoQueueManagedByMod = new Set();
/** Edifícios que o usuário desativou manualmente — Pudim não reativa */
var g_PudimAutoQueueUserDisabled = new Set();
/** Flag para logar uma vez quando o limite de 50 mulheres for atingido */
var g_PudimFemaleCapLogged = false;

/** Acumulador de tempo para verificar construção de fazendas */
var g_PudimFarmAccum = 0;

/** Acumulador de tempo para pesquisa automática de tecnologias */
var g_PudimResearchAccum = 0;

/** IDs de fundações de dropsite conhecidas (para detectar conclusões) */
var g_PudimDropsiteFoundations = {}; // entityId → true
/** Posição de cada fundação rastreada — usada para detectar cancelamento pelo jogador */
var g_PudimDropsiteFoundationPos = {}; // entityId → { x, z }

/** Acumulador de tempo para sistema de fundações de dropsite */
var g_PudimFoundationAccum = 0;

/** Rastreamento de unidades em kite para evitar re-envio imediato */
var g_PudimKiting = {}; // entId -> timestamp do último kite

/**
 * Tick periódico do PudimMod — chamado a cada frame por session~pudim.js.
 * @param {number} dt - Tempo em ms desde o último tick
 */
function pudim_Tick(dt)
{
	if (typeof pudim_UpdateAllyBar === "function") { try { pudim_UpdateAllyBar(); } catch(e) { error("AllyBar Error: " + e); } }

	// Não enviar comandos de rede se for espectador (causaria OOS)
	if (typeof g_IsObserver !== "undefined" && g_IsObserver) return;

	// Balanceamento inicial de workers: a cada 1s até concluído
	if (!g_PudimInitialBalanceDone && g_PudimAutoWorkEnabled)
	{
		g_PudimInitialBalanceAccum = (g_PudimInitialBalanceAccum || 0) + dt;
		if (g_PudimInitialBalanceAccum >= 1000) {
			g_PudimInitialBalanceAccum = 0;
			try {
				if (pudim_ExecuteInitialBalance()) {
					g_PudimInitialBalanceDone = true;
					g_PudimAutoWorkAccum = 0; // auto-work aguarda intervalo completo após balance
				}
			} catch(e) {}
		}
	}

	// Timeout de segurança: libera auto-work caso o balance trave.
	// 8s era curto demais para partidas online: o jogo em rede só avança quando todos os
	// clientes terminam de carregar, e nos primeiros segundos as unidades iniciais podem
	// ainda não estar visíveis à GUI — o timeout marcava "concluído" sem nunca ter
	// despachado ninguém, e o resultado era o mod não iniciar os trabalhos sozinho.
	// 25s cobre a partida em rede com folga e continua imperceptível numa partida local
	// (que resolve em ~1-2s). Ao desistir, zera o acumulador para o auto-work assumir já
	// no próximo ciclo e recolher qualquer trabalhador ocioso.
	if (!g_PudimInitialBalanceDone && g_SimState && g_SimState.timeElapsed > 25000)
	{
		g_PudimInitialBalanceDone = true;
		g_PudimAutoWorkAccum = PUDIM_AUTOWORK_INTERVAL;
		pudim_Log("WARN", "BALANCE", "timeout do balanceamento inicial — auto-trabalho assume");
	}

	g_PudimAutoWorkAccum += dt;
	g_PudimCombatAccum += dt;
	g_PudimRepeatAccum += dt;
	g_PudimAdvancedAIAccum += dt;

	// Idioma pode demorar a ficar detectável (dicionário do jogo carrega depois do init)
	try { pudim_RefreshTooltipsIfNeeded(); } catch(e) {}

	g_PudimSnapshotAccum += dt;
	if (g_PudimSnapshotAccum >= PUDIM_SNAPSHOT_INTERVAL)
	{
		g_PudimSnapshotAccum = 0;
		pudim_LogSnapshot();
	}

	// Auto-Trabalho: bloqueado durante pânico (não redirecionar trabalhadores em batalha)
	if (g_PudimAutoWorkEnabled && g_PudimAutoWorkAccum >= PUDIM_AUTOWORK_INTERVAL && g_PudimInitialBalanceDone && !g_PudimPanicFull)
	{
		g_PudimAutoWorkAccum = 0;
		pudim_RunAutoWork();
	}

	// Estimativa de combate: a cada 3 segundos (apenas quando painel aberto)
	if (g_PudimPanelOpen && g_PudimCombatAccum >= PUDIM_COMBAT_INTERVAL)
	{
		g_PudimCombatAccum = 0;
		pudim_RefreshCombat();
	}

	// Repetir Construção: a cada 1 segundo (sempre rodando em background se houver repeats ativos)
	if (g_PudimRepeatAccum >= 1000)
	{
		g_PudimRepeatAccum = 0;
		pudim_ProcessRepeatBuildings();
		if (g_PudimPanelOpen)
			pudim_UpdateGlobalRepeatStatus();
	}

	// Inteligência Avançada (Mercado, Armazéns, Foco de Fogo, Torres): a cada 2 segundos
	if (g_PudimAdvancedAIAccum >= 2000)
	{
		g_PudimAdvancedAIAccum = 0;
		pudim_ProcessAdvancedAI();
	}

	// Auto-Kite (Ranged foge de melee): a cada 600ms para ser responsivo
	g_PudimKiteAccum += dt;
	if (g_PudimKiteAccum >= 600 && g_PudimCombatAssistsEnabled)
	{
		g_PudimKiteAccum = 0;
		pudim_ProcessAutoKite();
	}

	// Sistema de Pânico: a cada 1.5 segundos
	g_PudimPanicAccum += dt;
	if (g_PudimPanicAccum >= 1500)
	{
		g_PudimPanicAccum = 0;
		pudim_ProcessPanic();
	}

	// Auto-Fila: re-ativa autoqueue em todos os edifícios a cada 3 segundos (se habilitado)
	if (g_PudimAdvancedAIEnabled["autoqueue"]) {
		g_PudimAutoQueueAccum += dt;
		if (g_PudimAutoQueueAccum >= 3000)
		{
			g_PudimAutoQueueAccum = 0;
			pudim_ProcessAutoQueue();
		}
	}

	// Auto-Fazendas: redireciona ou constrói fazendas quando fruta acaba (a cada 5s)
	// 5s para pegar novos workers logo após nascerem; guard interno evita spam de construção.
	if (g_PudimAdvancedAIEnabled["dropsites"]) {
		g_PudimFarmAccum += dt;
		if (g_PudimFarmAccum >= 5000)
		{
			g_PudimFarmAccum = 0;
			pudim_ProcessFarms();
		}
	}

	// Auto-Pesquisa: verifica tecnologias disponíveis a cada 15s quando recursos sobrando
	g_PudimResearchAccum += dt;
	if (g_PudimResearchAccum >= 15000)
	{
		g_PudimResearchAccum = 0;
		pudim_ProcessAutoResearch();
	}

	// Fundações de dropsite: workers novos → ajudar construir; dropsite concluído → redirecionar workers
	if (g_PudimAdvancedAIEnabled["dropsites"]) {
		g_PudimFoundationAccum += dt;
		if (g_PudimFoundationAccum >= 3000)
		{
			g_PudimFoundationAccum = 0;
			pudim_ProcessDropsiteFoundations();
		}
	}
}

/**
 * Calcula quantas unidades do template dá pra treinar com os recursos atuais.
 * Sem dados de custo (raro), não bloqueia — deixa o motor validar.
 */
function pudim_ComputeAffordableCount(template, desiredCount, res)
{
	if (desiredCount <= 0) return 0;
	let tData = null;
	try { tData = GetTemplateData(template); } catch(e) {}
	if (!tData || !tData.cost) return desiredCount;
	const cost = tData.cost;
	let maxAffordable = desiredCount;
	for (const rk of ["food", "wood", "stone", "metal"]) {
		const perUnit = cost[rk] || 0;
		if (perUnit <= 0) continue;
		const can = Math.floor((res[rk] || 0) / perUnit);
		if (can < maxAffordable) maxAffordable = can;
	}
	return Math.max(0, maxAffordable);
}

/**
 * Re-ativa autoqueue em todos os edifícios de produção que tiveram a fila
 * desativada automaticamente pelo jogo (quando recursos acabam ou um limite de
 * treino é atingido — bug reconhecido do motor: trac.wildfiregames.com/ticket/6278).
 * Garante que a auto-fila permaneça ativa sem necessidade de microgestão.
 */
function pudim_ProcessAutoQueue()
{
	try {
		const aqData = Engine.GuiInterfaceCall("pudim_GetProductionBuildings");
		if (!aqData || !aqData.buildings || aqData.buildings.length === 0) return;
		const buildings = aqData.buildings;
		const femaleCount = aqData.femaleCount || 0;
		const atFemaleCap = femaleCount >= 50;
		const res = aqData.resources || {};

		// Cachear template e aprender o tamanho de lote que o usuário configurou.
		// IMPORTANTE: qItem.count é quanto FALTA treinar naquele lote — o motor decrementa
		// (this.count--) a cada unidade que nasce, não é o tamanho original fixo. Um lote de
		// 3 já com 2 unidades nascidas mostra count=1; ler isso como "desejado" faria a
		// memória cair pra 1 e nunca mais voltar a 3 mesmo com recursos de sobra depois.
		// Só confia no valor quando o lote está fresco (progress baixo, count ainda intacto).
		for (const b of buildings) {
			if (b.trainingQueue && b.trainingQueue.length > 0) {
				const qItem = b.trainingQueue[0];
				if (qItem && qItem.unitTemplate) {
					g_PudimAutoQueueTemplates[b.ent] = qItem.unitTemplate;
					if ((qItem.progress || 0) < 0.15) {
						const observed = qItem.count || 1;
						if (!g_PudimAutoQueueDesiredCount[b.ent] || observed > g_PudimAutoQueueDesiredCount[b.ent])
							g_PudimAutoQueueDesiredCount[b.ent] = observed;
					}
				}
			}
		}

		// Detectar desativações manuais e ativar apenas novos edifícios
		const toEnable = [];
		for (const b of buildings) {
			if (!b.autoqueue) {
				if (b.alwaysQueue) {
					// Barracks/CC: sempre reativar, independente da causa da desativação
					toEnable.push(b.ent);
					g_PudimAutoQueueManagedByMod.add(b.ent);
					g_PudimAutoQueueUserDisabled.delete(b.ent);
				} else if (g_PudimAutoQueueManagedByMod.has(b.ent) && !g_PudimAutoQueueUserDisabled.has(b.ent)) {
					// Pudim tinha ativado, agora está off. Só é o USUÁRIO se havia recursos
					// suficientes pro template — senão é o bug nativo do motor (falta de
					// recursos/limite de treino) desligando sozinho: reativa sem penalizar.
					const cachedTpl = g_PudimAutoQueueTemplates[b.ent];
					const affordableNow = cachedTpl ? pudim_ComputeAffordableCount(cachedTpl, 1, res) : 1;
					if (affordableNow < 1) {
						toEnable.push(b.ent);
					} else {
						g_PudimAutoQueueUserDisabled.add(b.ent);
						pudim_Log("INFO", "QUEUE", "edifício " + b.ent + " desativado pelo usuário");
					}
				} else if (!g_PudimAutoQueueManagedByMod.has(b.ent) && !g_PudimAutoQueueUserDisabled.has(b.ent)) {
					// Novo edifício nunca gerenciado
					if (b.alwaysQueue) {
						// Barracks/CC: ativar autoqueue por padrão
						toEnable.push(b.ent);
						g_PudimAutoQueueManagedByMod.add(b.ent);
					} else {
						// Demais construções: off por padrão; usuário habilita individualmente
						g_PudimAutoQueueManagedByMod.add(b.ent);
						g_PudimAutoQueueUserDisabled.add(b.ent);
					}
				}
				// Se está em UserDisabled (e não é alwaysQueue): ignorar completamente
			} else {
				// autoqueue=true: registrar como gerenciado
				g_PudimAutoQueueManagedByMod.add(b.ent);
				// Se usuário reativou manualmente, remover da lista de desativados
				if (g_PudimAutoQueueUserDisabled.has(b.ent)) {
					g_PudimAutoQueueUserDisabled.delete(b.ent);
					pudim_Log("INFO", "QUEUE", "edifício " + b.ent + " reativado pelo usuário");
				}
			}
		}
		if (toEnable.length > 0) {
			Engine.PostNetworkCommand({ "type": "autoqueue-on", "entities": toEnable });
		}

		// Template feminino: support_civilian* ou *female* (Gaul usa support_civilian/_house)
		const isFemaleTemplate = function(t) {
			return t.indexOf("support_civilian") !== -1 || t.indexOf("female") !== -1;
		};

		// Reiniciar fila vazia — se vazia E (autoqueue off OU fila zerou por falta de recursos)
		// "Faz o máximo que dá": se configurou count=3 mas só tem recursos p/ 1, põe 1 na fila
		// assim que tiver recursos p/ o total, volta a treinar em lote
		const nowQueue = Date.now();
		for (const b of buildings) {
			if (g_PudimAutoQueueUserDisabled.has(b.ent)) continue;

			// CC: padrão 3; barracks: padrão 1; demais: 1
			const defaultCount = b.isCC ? 3 : 1;
			const desiredCount = g_PudimAutoQueueDesiredCount[b.ent] || defaultCount;

			if (!b.queueEmpty) {
				// REGRA: a auto-fila mantém NO MÁXIMO UM lote. Um lote degradado por escassez
				// (ticket 6278) loopa para sempre no autoqueue nativo — o motor re-enfileira o
				// mesmo tamanho que terminou, então a fila nunca volta sozinha ao lote
				// configurado. A correção anterior APENDAVA um segundo lote com a diferença;
				// as duas ordens somavam o throughput certo, mas empilhavam grupos na fila, e
				// a cada lote concluído a fila voltava a ter 1 e um novo era apendado. O
				// resultado em jogo era uma fila com dezenas de grupos.
				//
				// Agora o lote degradado é SUBSTITUÍDO, não complementado: cancela e reenfileira
				// no tamanho cheio. Só quando o lote ainda NÃO começou (progress <= 0) — cancelar
				// um lote em andamento jogaria fora o tempo já investido. Sem progresso o
				// cancelamento devolve os recursos, então a troca não custa nada.
				//
				// Qualquer lote ALÉM deste é do jogador: a auto-fila só semeia fila vazia, e
				// sempre com uma ordem só. Por isso nada aqui cancela quando length > 1.
				if (b.trainingQueue && b.trainingQueue.length === 1) {
					const cur = b.trainingQueue[0];
					const curCount = cur.count || 1;
					// O lote só pode ser trocado se for RECONHECIDAMENTE do mod: mesmo edifício
					// e mesmo template da última semeadura dele.
					//
					// A versão anterior pegava o template de g_PudimAutoQueueTemplates (a
					// memória do mod, quase sempre o aldeão) com cur.unitTemplate apenas como
					// fallback. Com o jogador enfileirando soldados, ela cancelava o lote DELE e
					// reenfileirava aldeões — visto no log: "edifício 150 lote degradado x1
					// trocado por x3", com todas as semeaduras em support_civilian.
					//
					// Agora o tipo de unidade NUNCA muda: reenfileira exatamente cur.unitTemplate,
					// e só quando esse template é o que o próprio mod semeou. Lote de tipo
					// diferente é ordem do jogador e não se toca.
					const seededTpl = g_PudimQueueSeededTpl[b.ent];
					const isOurs = !!(cur.unitTemplate && seededTpl && cur.unitTemplate === seededTpl);
					if (isOurs && (cur.progress || 0) <= 0 && curCount < desiredCount) {
						const tpl = cur.unitTemplate;
						// Exige poder pagar o lote CHEIO com o estoque atual, sem contar o
						// reembolso do cancelamento: é conservador de propósito, para nunca
						// cancelar um lote e não conseguir repor.
						const affordable = pudim_ComputeAffordableCount(tpl, desiredCount, res);
						if (affordable >= desiredCount && cur.id !== undefined) {
							Engine.PostNetworkCommand({ "type": "stop-production", "entity": b.ent, "id": cur.id });
							Engine.PostNetworkCommand({ "type": "train", "entities": [b.ent], "template": tpl, "count": desiredCount });
							g_PudimQueueSeededAt[b.ent] = nowQueue;
							pudim_Log("INFO", "QUEUE", "edifício " + b.ent + " lote degradado x" + curCount +
								" trocado por x" + desiredCount + " " + tpl.split("/").pop());
						}
					}
				}
				continue;
			}

			let template = null;
			// Usar trainerEntities do servidor (mais confiável que GetEntityState para barracas novas)
			const trainerEnts = b.trainerEntities || [];
			if (trainerEnts.length > 0) {
				if (atFemaleCap) {
					template = trainerEnts.find(t => !isFemaleTemplate(t));
					if (!template) continue;
				} else {
					template = trainerEnts.find(isFemaleTemplate) || trainerEnts[0];
				}
				if (template) g_PudimAutoQueueTemplates[b.ent] = template;
			}

			if (!template) {
				template = g_PudimAutoQueueTemplates[b.ent];
				if (atFemaleCap && template && isFemaleTemplate(template)) continue;
			}
			if (!template) {
				// Sem template não há como semear a fila. Logar (throttled por edifício) —
				// esta saída silenciosa escondeu por muito tempo o bug do trainerEntities.
				if (!g_PudimQueueNoTplLogged[b.ent]) {
					g_PudimQueueNoTplLogged[b.ent] = true;
					pudim_Log("WARN", "QUEUE", "edifício " + b.ent + " sem template treinável (fila não semeada)");
				}
				continue;
			}

			// Carência por edifício: PostNetworkCommand é assíncrono, então a fila pode
			// continuar lendo VAZIA no ciclo seguinte mesmo já tendo um lote a caminho.
			// Sem isto, dois ciclos seguidos semeiam e a fila ganha um lote a mais — e o
			// mesmo vale para uma ordem SUA dada nesse intervalo: o mod não a enxerga ainda
			// e semeia por cima. Foi assim que 3 aldeões apareceram atrás dos 3 soldados.
			// 7s cobre dois ciclos de 3s com folga.
			if (nowQueue - (g_PudimQueueSeededAt[b.ent] || 0) < 7000) continue;

			// Custo real do template: enfileira o máximo que der; se não der pra nem 1,
			// espera o próximo ciclo (evita comando inválido que pode disparar o bug nativo)
			const affordable = pudim_ComputeAffordableCount(template, desiredCount, res);
			if (affordable <= 0) continue;
			Engine.PostNetworkCommand({ "type": "train", "entities": [b.ent], "template": template, "count": affordable });
			g_PudimQueueSeededAt[b.ent] = nowQueue;
			// Guarda O QUE foi semeado: é a única forma de, depois, reconhecer um lote como
			// do mod sem confundi-lo com uma ordem do jogador no mesmo edifício.
			g_PudimQueueSeededTpl[b.ent] = template;
			// qlen registra o tamanho da fila NO MOMENTO da decisão. Se algum dia a fila
			// voltar a empilhar, este número diz se o mod semeou sobre uma fila que já tinha
			// itens (leitura errada) ou se cada semeadura viu vazio de verdade (corrida).
			pudim_Log("INFO", "QUEUE", "fila semeada em " + b.ent + " x" + affordable + " " +
				template.split("/").pop() + " qlen=" + ((b.trainingQueue && b.trainingQueue.length) || 0));
		}

		if (atFemaleCap && !g_PudimFemaleCapLogged) {
			pudim_Log("INFO", "QUEUE", "limite de 50 mulheres atingido (atual=" + femaleCount + ") — produção mudou para soldados");
			g_PudimFemaleCapLogged = true;
		} else if (!atFemaleCap && g_PudimFemaleCapLogged) {
			g_PudimFemaleCapLogged = false; // resetar se cair abaixo do limite
		}
	} catch(e) {}
}

/**
 * Constrói fazendas perto do CC quando trabalhadores de comida estão longe (>100m).
 * Máximo 10 fazendas. Redireciona trabalhadores para coletar perto da nova fazenda.
 */
/**
 * Auto-pesquisa tecnologias quando há recursos sobrando.
 * Prioridade: economia (coleta +%) > fases > militar.
 * Usa IID_Researcher.GetTechnologiesList() via GuiInterface — sem hardcode de nomes.
 */
// {tech: timestamp} — quando o comando de pesquisa foi enviado
var g_PudimResearchSentAt = {};
// techs que falharam a entrar na fila após 90s → não tentar de novo na sessão
var g_PudimResearchBlacklist = [];

function pudim_ProcessAutoResearch()
{
	try {
		const now = Date.now();
		// Detectar pesquisas enviadas há >90s que nunca apareceram na fila → blacklist
		const sentKeys = Object.keys(g_PudimResearchSentAt);
		for (const tech of sentKeys) {
			if (now - g_PudimResearchSentAt[tech] > 90000) {
				if (g_PudimResearchBlacklist.indexOf(tech) === -1)
					g_PudimResearchBlacklist.push(tech);
				delete g_PudimResearchSentAt[tech];
				pudim_Log("WARN", "RESEARCH", "blacklist: " + tech + " (nunca entrou na fila em 90s)");
			}
		}

		const researchData = Engine.GuiInterfaceCall("pudim_GetAutoResearchData", {
			blacklist: g_PudimResearchBlacklist,
			sentTechs: sentKeys
		});
		if (!researchData) return;

		// Confirmar pesquisas que agora estão na fila ou concluídas
		for (const tech of (researchData.confirmed || [])) {
			if (g_PudimResearchSentAt[tech]) delete g_PudimResearchSentAt[tech];
		}

		if (!researchData.research || researchData.research.length === 0) return;
		for (const item of researchData.research) {
			Engine.PostNetworkCommand({
				"type": "research",
				"template": item.tech,
				"entity": item.building,
				"metadata": null
			});
			g_PudimResearchSentAt[item.tech] = now;
			pudim_Log("INFO", "RESEARCH", "pesquisando " + item.tech + " (score=" + item.score + ")");
		}
	} catch(e) {}
}

/**
 * Feature 1: workers recém-nascidos (idle ou com rally point) são enviados para ajudar
 *            construir fundação de dropsite ativa com poucos construtores.
 * Feature 2: quando dropsite conclui, redireciona workers coletando longe para o novo dropsite.
 */
function pudim_ProcessDropsiteFoundations()
{
	try {
		const prevIds = Object.keys(g_PudimDropsiteFoundations).map(Number);
		const data = Engine.GuiInterfaceCall("pudim_GetDropsiteFoundationData", {
			prevFoundationIds: prevIds,
			modBuiltPositions: g_PudimModBuiltPositions,
			protectedIds: pudim_GetProtectedBuilderIds(),
			// separado de protectedIds: estes são liberados assim que ficarem ociosos
			playerOrdered: pudim_GetPlayerOrderedIds()
		});
		if (!data) return;

		// Fundação que sumiu SEM virar prédio = o jogador cancelou. Registrar a posição para
		// nunca reconstruir ali (era o loop de "cancelei o armazém e ele voltava").
		// data.completions traz as que viraram prédio; o que sumiu e não está lá foi cancelado.
		const completedIds = new Set((data.completions || []).map(c => c.id));
		const stillFoundation = new Set((data.foundations || []).map(f => f.id));
		for (const oldId in g_PudimDropsiteFoundations) {
			const idNum = +oldId;
			if (stillFoundation.has(idNum) || completedIds.has(idNum)) continue;
			const pos = g_PudimDropsiteFoundationPos[idNum];
			if (pos) pudim_MarkCancelled(pos.x, pos.z);
			delete g_PudimDropsiteFoundationPos[idNum];
		}

		// Atualizar rastreamento de fundações (id + posição, para detectar cancelamento acima)
		g_PudimDropsiteFoundations = {};
		for (const f of (data.foundations || [])) {
			g_PudimDropsiteFoundations[f.id] = true;
			g_PudimDropsiteFoundationPos[f.id] = { x: f.x, z: f.z };
		}

		// Feature 1: Enviar workers ociosos/novos para ajudar na fundação
		for (const assign of (data.assignments || [])) {
			Engine.PostNetworkCommand({
				"type": "repair",
				"entities": [assign.workerId],
				"target": assign.foundationId,
				"queued": false
			});
			pudim_Log("INFO", "BUILD", "worker→fundação dropsite " + assign.foundationId);
		}

		// Feature 2: Redirecionar workers distantes para perto do dropsite recém-concluído
		for (const completion of (data.completions || [])) {
			const n = completion.workersToRedirect ? completion.workersToRedirect.length : 0;
			if (n > 0) {
				pudim_Log("SUCCESS", "DROPSITE", "concluído " + completion.resourceType
					+ " → redirecionando " + n + " worker(s)");
			}
			const redirExpiry = Date.now() + 15000;
			for (const w of (completion.workersToRedirect || [])) {
				Engine.PostNetworkCommand({
					"type": "gather",
					"entities": [w.workerId],
					"target": w.targetRes,
					"queued": false
				});
				// 15s protegido: sem isso, long-walker/rebalance/farm podiam re-redirecionar o
				// mesmo worker no meio da caminhada — ping-pong entre sistemas ("passeio")
				pudim_ProtectBuilder(w.workerId, redirExpiry);
			}
		}
	} catch(e) {}
}

function pudim_ProcessFarms()
{
	try {
		const farmData = Engine.GuiInterfaceCall("pudim_GetFarmBuildData", { "weights": g_PudimResourceWeights });
		if (!farmData) return;

		// Log de diagnóstico a cada 30s (throttled)
		if (Date.now() - g_PudimFarmDebugLastLog > 30000) {
			g_PudimFarmDebugLastLog = Date.now();
			const d = farmData._dbg || {};
			pudim_Log("DEBUG", "FARM", "fc=" + (d.fc||0) + " nfc=" + (d.nfc||0) +
				" ncap=" + (d.ncap||0) + " tg=" + (d.tg||0) + " cfm=" + (d.cfm||0) +
				" fwt=" + (d.fwt||0) + " df=" + (d.df||0) + " wp=" + (d.wp||0) +
				" fmc=" + (d.fmc||0) + " tffs=" + (d.tffs||0) +
				" reason=" + (d.reason||"?") + " action=" + farmData.action);
		}

		// ── Soldados em fazendas: trocar por aldeões (soldado → madeira) ─────────────────
		// Isso acontece ANTES do action check para garantir a troca em qualquer estado
		for (const ev of (farmData.soldierEvictions || [])) {
			// Envia o soldado para coletar madeira perto de sua posição atual
			Engine.PostNetworkCommand({
				"type": "gather-near-position",
				"entities": [ev.soldierId],
				"x": ev.soldierX,
				"z": ev.soldierZ,
				"resourceType": { "generic": "wood" },
				"resourceTemplate": "",
				"queued": false
			});
			pudim_Log("INFO", "FARM", "soldado " + ev.soldierId + " → madeira (vaga p/ aldeão na fazenda " + ev.farmId + ")");
		}

		if (farmData.action === "none") return;

		// ── Fazenda existente tem espaço: enviar worker para colher lá ───────────────────
		if (farmData.action === "assign") {
			for (const a of farmData.farmAssignments) {
				Engine.PostNetworkCommand({
					"type": "gather",
					"entities": [a.workerId],
					"target": a.farmId,
					"queued": false
				});
			}
			pudim_Log("INFO", "FARM", "alocou " + farmData.farmAssignments.length +
				" worker(s) em fazenda(s) existente(s)");
			return;
		}

		// ── Nenhuma fazenda tem espaço: construir nova(s) em grupos de 5 ─────────────────
		if (!farmData.builderId || !farmData.template || !farmData.candidatePositions.length) return;

		// Todos os workers de comida fora de fazendas (builderId + workersToRedirect)
		const allFoodWorkers = [farmData.builderId];
		if (farmData.workersToRedirect && farmData.workersToRedirect.length > 0) {
			for (const w of farmData.workersToRedirect)
				if (w !== farmData.builderId) allFoodWorkers.push(w);
		}

		// Dividir em grupos de 5 — cada grupo constrói seu próprio campo perto da fazenda
		const GROUP_SIZE = 5;
		let posIdx = 0;
		let farmsBuilt = 0;

		for (let g = 0; g < allFoodWorkers.length; g += GROUP_SIZE) {
			const group = allFoodWorkers.slice(g, g + GROUP_SIZE);

			// Encontrar próxima posição válida — SetBuildingPlacementPreview cuida da colisão
			let foundX = null, foundZ = null;
			while (posIdx < farmData.candidatePositions.length) {
				const pos = farmData.candidatePositions[posIdx++];
				let res = null;
				try {
					res = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
						"template": farmData.template, "x": pos.x, "z": pos.z,
						"angle": 0, "actorSeed": 0
					});
				} catch(e2) {}
				if (res && res.success) { foundX = pos.x; foundZ = pos.z; break; }
			}
			if (foundX === null) {
				// Silêncio aqui era o que escondia o problema: a simulação devolvia
				// action=build a cada ciclo, nenhuma fazenda saía, e o log só mostrava o
				// déficit crescendo sem dizer por quê.
				if (farmsBuilt === 0)
					pudim_Log("WARN", "FARM", "action=build sem posicao valida — " +
						farmData.candidatePositions.length + " candidatos testados");
				break; // Sem mais posições válidas
			}

			Engine.PostNetworkCommand({
				"type": "construct",
				"entities": group,
				"template": farmData.template,
				"x": foundX, "z": foundZ,
				"angle": 0, "actorSeed": 0,
				"autorepair": true, "autocontinue": true, "queued": false
			});
			pudim_Log("SUCCESS", "FARM", "campo #" + (farmsBuilt + 1) +
				" em (" + foundX.toFixed(0) + "," + foundZ.toFixed(0) + ")" +
				" workers=" + group.length);
			farmsBuilt++;
		}
		try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e) {}
	} catch(e) { pudim_Log("ERROR", "FARM", "excecao: " + e); }
}

/**
 * Executa as rotinas de IA em background para o jogador.
 * Aciona comandos de rede reais, replicando um micro-gerenciamento profissional.
 */
function pudim_ProcessAdvancedAI()
{
  try {
	// 1. Foco de Fogo Inteligente
	if (pudim_CombatAssistOn("focus")) {
		try {
			const focusData = Engine.GuiInterfaceCall("pudim_GetFocusFireCorrections", { "fixed": g_PudimFocusFixed });
			if (focusData && focusData.length > 0)
			{
				for (const group of focusData)
				{
					Engine.PostNetworkCommand({
						"type": "attack",
						"entities": group.units,
						"target": group.target,
						"queued": false
					});
					for (const u of group.units)
						g_PudimFocusFixed[u] = true;
				}
			}
		} catch (e) {}
	}

	// 2. Auto-Guarnição Defensiva
	if (pudim_CombatAssistOn("garrison")) {
		try {
			const garrisonData = Engine.GuiInterfaceCall("pudim_GetDefensiveGarrisonData", { "garrisoned": g_PudimGarrisoned });
			if (garrisonData && garrisonData.toGarrison && garrisonData.toGarrison.length > 0)
			{
				for (const task of garrisonData.toGarrison)
				{
					Engine.PostNetworkCommand({
						"type": "garrison",
						"entities": [task.unitId],
						"target": task.towerId,
						"queued": true
					});
					g_PudimGarrisoned[task.unitId] = true;
				}
			}
		} catch (e) {}
	}

	// 2b. Auto-Casas (independente do garrison)
	const nowTimer = Date.now();
	// Verificar a cada 3s e permitir nova tentativa a cada 12s: com autoqueue contínuo no CC/quartel
	// a população cresce rápido, e o intervalo de 5s/30s antigo deixava a folga (ex: "faltando 3")
	// já consumida até 1 pelo tempo da próxima checagem. O cap de 2 fundações simultâneas
	// continua sendo o freio real contra spam de casas.
	if (g_PudimAutoHouseThreshold > 0 && nowTimer - g_LastAutoHouseCheck > 3000) {
	g_LastAutoHouseCheck = nowTimer;
	// Cooldown reduz de 12s para 6s quando há barracas (pop cresce mais rápido com mais edifícios de produção)
	const autoHouseCooldown = (g_PudimLastHouseProdCount > 1) ? 6000 : 12000;
	if (nowTimer - g_LastAutoHouseAttempt > autoHouseCooldown) { // tempo para builder chegar à foundation
		try {
			const houseData = Engine.GuiInterfaceCall("pudim_GetAutoHouseData", { threshold: g_PudimAutoHouseThreshold });
			if (houseData && houseData.productionBuildingCount !== undefined)
				g_PudimLastHouseProdCount = houseData.productionBuildingCount;
			// Fundação "fantasma" (0 builders) durante pânico NÃO é abandono real: os builders
			// foram guarnecidos e voltam. Deletar aqui causava loop de deleta-reconstrói na
			// mesma posição (visto no log: mesma coord 2-3x em sequência durante um ataque).
			if (houseData && houseData.stuckGhosts && houseData.stuckGhosts.length > 0 && !g_PudimPanicMode)
				Engine.PostNetworkCommand({ "type": "delete-entities", "entities": houseData.stuckGhosts });
			if (houseData && houseData._skip) {
				if (nowTimer - (g_PudimLastHouseLogTime || 0) > 20000) {
					g_PudimLastHouseLogTime = nowTimer;
					pudim_Log("DEBUG", "CASAS", "skip=" + houseData._skip);
				}
			} else if (houseData && houseData.builderId && houseData.candidatePositions && houseData.candidatePositions.length > 0) {
				// Validar posições com placement preview antes de construir
				let foundPos = null;
				for (const pos of houseData.candidatePositions) {
					let res = null;
					try {
						res = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
							"template": houseData.template, "x": pos.x, "z": pos.z,
							"angle": 0, "actorSeed": 0
						});
					} catch(e2) {}
					if (res && res.success) { foundPos = pos; break; }
				}
				try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e2) {}

				if (!foundPos) {
					pudim_Log("DEBUG", "CASAS", "skip=noValidPos cands=" + houseData.candidatePositions.length);
				} else {
					g_LastAutoHouseAttempt = nowTimer;
					const houseBuilderIds = houseData.builderIds || [houseData.builderId];
					let walkTxt = "";
					if (houseData.anchorX !== undefined) {
						const wdx = foundPos.x - houseData.anchorX, wdz = foundPos.z - houseData.anchorZ;
						walkTxt = " and=" + Math.round(Math.sqrt(wdx*wdx + wdz*wdz));
					}
					pudim_Log("SUCCESS", "CASAS", "build em (" + foundPos.x.toFixed(0) + "," + foundPos.z.toFixed(0) + ") builders=" + houseBuilderIds.length + walkTxt);
					Engine.PostNetworkCommand({
						"type": "construct",
						"entities": houseBuilderIds,
						"template": houseData.template,
						"x": foundPos.x, "z": foundPos.z,
						"angle": 0, "actorSeed": 0,
						"autorepair": true, "autocontinue": true, "queued": false
					});
					// Proteger builders de reassign por 5s: PostNetworkCommand é async,
					// auto-work veria eles como idle e sobrescreveria o Repair order
					const houseExpiry = nowTimer + 5000;
					for (const bid of houseBuilderIds)
						pudim_ProtectBuilder(bid, houseExpiry);
				}
			}
		} catch (e) { pudim_Log("ERROR", "CASAS", "excecao: " + e); }
	} // fim if 30s cooldown
	} // fim if 5s check

	// 3. Mercado Inteligente
	if (g_PudimAdvancedAIEnabled["barter"]) {
		try {
			const barterData = Engine.GuiInterfaceCall("pudim_GetMarketBarterData");
			if (barterData && barterData.sell && barterData.buy)
			{
				Engine.PostNetworkCommand({
					"type": "barter",
					"sell": barterData.sell,
					"buy": barterData.buy,
					"amount": barterData.amount
				});
			}
		} catch (e) {}
	}

	// 4. Smart Dropsites (Expansão de Armazéns)
	// Gate externo: 5s entre chamadas à API (evita overhead a cada tick)
	// Cooldown por recurso: 30s entre construções do mesmo tipo (food/wood separados)
	const _nowDrop = Date.now();
	if (_nowDrop - (g_PudimLastDropsiteLogTime || 0) > 10000) {
		g_PudimLastDropsiteLogTime = _nowDrop;
		// "never" enquanto nenhum dropsite desse tipo foi construído ainda (timer em 0) —
		// senão o cálculo dá o epoch inteiro em segundos, poluindo o log com números absurdos
		const fdDt = g_PudimLastDropsiteTimeByRes.food ? Math.round((_nowDrop - g_PudimLastDropsiteTimeByRes.food) / 1000) + "s" : "never";
		const wdDt = g_PudimLastDropsiteTimeByRes.wood ? Math.round((_nowDrop - g_PudimLastDropsiteTimeByRes.wood) / 1000) + "s" : "never";
		pudim_Log("DEBUG", "DROP", "GATE on=" + g_PudimAdvancedAIEnabled["dropsites"] + " food_dt=" + fdDt + " wood_dt=" + wdDt);
	}
	if (g_PudimAdvancedAIEnabled["dropsites"] && _nowDrop - g_PudimLastDropsiteTime > 5000) {
		g_PudimLastDropsiteTime = _nowDrop;
		try {
			const dropsiteData = Engine.GuiInterfaceCall("pudim_GetSmartDropsiteData", { protectedIds: pudim_GetProtectedBuilderIds() });
			const dbg = (dropsiteData && dropsiteData._dbg) ? dropsiteData._dbg : {};

			if (dropsiteData && dropsiteData.action === "build" &&
			    dropsiteData.builderId && dropsiteData.template &&
			    dropsiteData.candidatePositions && dropsiteData.candidatePositions.length > 0)
			{
				const resKey = dropsiteData.resource || "wood";
				const resCooldown = g_PudimLastDropsiteTimeByRes[resKey] || 0;
				if (_nowDrop - resCooldown < 30000) {
					// Cooldown por tipo ainda ativo — aguarda sem bloquear o outro tipo
					if (Date.now() - g_PudimLastDropsiteDiagTime > 15000) {
						g_PudimLastDropsiteDiagTime = Date.now();
						pudim_Log("DEBUG", "DROP", "cooldown res=" + resKey + " dt=" + Math.round((_nowDrop - resCooldown)/1000) + "s");
					}
				} else {
					// FASE 4: Teste de Colisão para posicionamento
					let foundX = null, foundZ = null;
					for (const pos of dropsiteData.candidatePositions) {
						if (pudim_IsCancelledSpot(pos.x, pos.z)) continue; // jogador cancelou aqui
						let res = null;
						try {
							res = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
								"template": dropsiteData.template, "x": pos.x, "z": pos.z,
								"angle": 0, "actorSeed": 0
							});
						} catch(e) {}
						if (res && res.success) { foundX = pos.x; foundZ = pos.z; break; }
					}
					try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e) {}

					if (foundX === null) {
						pudim_Log("WARN", "DROP", "action=build sem pos valida tpl=" + dropsiteData.template.split("/").pop() +
							" recurso=" + dropsiteData.resource + " cands=" + dropsiteData.candidatePositions.length);
						g_PudimLastDropsiteTimeByRes[resKey] = Date.now();
					}

					if (foundX !== null) {
						g_PudimLastDropsiteTimeByRes[resKey] = Date.now();
						let allBuilders = [dropsiteData.builderId];
						if (dropsiteData.workersToMove && dropsiteData.workersToMove.length > 0)
							allBuilders = allBuilders.concat(dropsiteData.workersToMove.filter(e => !g_PudimRepeatBuilding[e]));
						if (dropsiteData.scatteredWorkers && dropsiteData.scatteredWorkers.length > 0)
							allBuilders = allBuilders.concat(dropsiteData.scatteredWorkers.filter(e => !g_PudimRepeatBuilding[e]));
						pudim_Log("SUCCESS", "DROP", "build " + dropsiteData.template.split("/").pop() +
							" recurso=" + dropsiteData.resource +
							" builders=" + allBuilders.length +
							" density=" + (dbg.density||0) +
							" em (" + foundX.toFixed(0) + "," + foundZ.toFixed(0) + ")");
						Engine.PostNetworkCommand({
							"type": "construct",
							"entities": allBuilders,
							"template": dropsiteData.template,
							"x": foundX, "z": foundZ,
							"angle": 0, "actorSeed": 0,
							"autorepair": true, "autocontinue": true, "queued": false
						});
						pudim_MarkModBuilt(foundX, foundZ);
					}
				}
			}
			else if (dropsiteData && dropsiteData.action === "redirect" &&
			         dropsiteData.workersToMove && dropsiteData.workersToMove.length > 0 &&
			         dropsiteData.resource)
			{
				const resKey = dropsiteData.resource;
				const _redirNow = Date.now();
				// Cooldown de 20s por recurso: evita oscilar workers que chegaram a 51m de um armazém
				if (_redirNow - (g_PudimLastRedirectTimeByRes[resKey] || 0) > 20000) {
					const redirectEnts = dropsiteData.workersToMove.filter(e => !g_PudimRepeatBuilding[e]).slice(0, 4);
					if (redirectEnts.length > 0) {
						g_PudimLastRedirectTimeByRes[resKey] = _redirNow;
						pudim_Log("INFO", "DROP", "redirect " + redirectEnts.length + " workers p/ " + resKey + " (cooldown 20s)");
						Engine.PostNetworkCommand({
							"type": "gather-near-position",
							"entities": redirectEnts,
							"x": dropsiteData.redirectX,
							"z": dropsiteData.redirectZ,
							"resourceType": { "generic": resKey },
							"resourceTemplate": "",
							"queued": false
						});
					}
				}
			}
			else {
				// Log diagnóstico a cada 15s
				if (Date.now() - g_PudimLastDropsiteDiagTime > 15000) {
					g_PudimLastDropsiteDiagTime = Date.now();
					const skip = dbg.skip || "?";
					pudim_Log("DEBUG", "DROP", "skip=" + skip + " fw=" + (dbg.fw||0) + " ds=" + (dbg.ds||0) + " sc=" + (dbg.sc||0) + " density=" + (dbg.density||0) + " wtm=" + (dbg.wtm||0) + " w=" + (dbg.wood||"?"));
				}
			}
		} catch (e) { pudim_Log("ERROR", "DROP", "excecao: " + e); }
	}

	// Processar redirecionamentos de trabalhadores para novos armazéns
	if (g_PudimPendingDropsiteRedirects.length > 0)
	{
		const now = Date.now();
		g_PudimPendingDropsiteRedirects = g_PudimPendingDropsiteRedirects.filter(r => r.expireAt > now);

		for (const redirect of g_PudimPendingDropsiteRedirects)
		{
			if (redirect.workers && redirect.workers.length > 0)
			{
				// Enviar grupos de 3 trabalhadores por vez para árvores diferentes (evitar sobrecarregar uma árvore)
				const batch = redirect.workers.splice(0, 3);
				Engine.PostNetworkCommand({
					"type": "gather-near-position",
					"entities": batch,
					"resourceType": { "generic": redirect.resource, "specific": redirect.resource === "wood" ? "tree" : redirect.resource },
					"resourceTemplate": "",
					"x": redirect.x, "z": redirect.z,
					"queued": false, "force": false
				});
			}
		}
	}

	// 5. Retirada Estratégica
	if (pudim_CombatAssistOn("retreat")) {
		try {
			const retreatData = Engine.GuiInterfaceCall("pudim_GetAutoRetreatData", { "retreating": g_PudimRetreating });
			// Desmarcar unidades curadas (HP >= 50%)
			if (retreatData && retreatData.recovered) {
				for (const uid of retreatData.recovered) delete g_PudimRetreating[uid];
			}
			if (retreatData && retreatData.length > 0)
			{
				for (const action of retreatData)
				{
					if (action.garrison) {
						Engine.PostNetworkCommand({
							"type": "garrison",
							"entities": [action.unitId],
							"target": action.target,
							"queued": true
						});
					} else {
						Engine.PostNetworkCommand({
							"type": "walk",
							"entities": [action.unitId],
							"x": action.targetX,
							"z": action.targetZ,
							"queued": true
						});
					}
					g_PudimRetreating[action.unitId] = true;
				}
			}
		} catch (e) {}
	}
  } catch(e) { pudim_Log("ERROR", "AI", "FATAL: " + e); }
}

/**
 * Processa construtores com repeat ativo que terminaram suas construções.
 * Estado gerenciado inteiramente na GUI — sem OOS em multiplayer.
 */
function pudim_ProcessRepeatBuildings()
{
	const activeEnts = Object.keys(g_PudimRepeatBuilding).map(Number).filter(ent => g_PudimRepeatBuilding[ent]);
	if (activeEnts.length === 0)
		return;

	// Query what each active builder is currently building (read-only GuiInterface call).
	let buildingInfo = {};
	try
	{
		buildingInfo = Engine.GuiInterfaceCall("pudim_GetBuilderCurrentFoundation", { "ents": activeEnts }) || {};
	}
	catch(e) {}

	for (const ent of activeEnts)
	{
		const info = buildingInfo[ent]; // { foundationId, template, x, z } or undefined

		if (info)
		{
			// Builder is actively constructing — record template + position of the foundation.
			g_PudimBuilderLastBuilt[ent] = { "template": info.template, "x": info.x, "z": info.z };
			g_PudimBuilderFoundation[ent] = info.foundationId;
			g_PudimBuilderPending[ent] = 0; // confirmed started
			continue;
		}

		// Builder is NOT currently building.

		// Handle pending window: we just sent a construct command but the unit hasn't
		// started yet (there's a 1-2 tick delay). Increment counter and wait.
		if (g_PudimBuilderPending[ent] > 0)
		{
			g_PudimBuilderPending[ent]++;
			if (g_PudimBuilderPending[ent] <= 5)
				continue; // Still within the grace period — keep waiting.
			// Exceeded grace period — command likely failed or entity was interrupted.
			g_PudimBuilderPending[ent] = 0;
		}

		// Clear stale foundation reference (construction finished or cancelled).
		if (g_PudimBuilderFoundation[ent])
			delete g_PudimBuilderFoundation[ent];

		// No lastBuilt data yet — user activated repeat before the first build.
		if (!g_PudimBuilderLastBuilt[ent])
			continue;

		// Check entity still exists.
		const state = GetEntityState(ent);
		if (!state)
		{
			delete g_PudimRepeatBuilding[ent];
			delete g_PudimBuilderLastBuilt[ent];
			delete g_PudimBuilderPending[ent];
			continue;
		}

		// ── Builder is idle with a lastBuilt record → place next building ──

		let templateName = g_PudimBuilderLastBuilt[ent].template;
		if (templateName.startsWith("foundation|")) templateName = templateName.substring(11);
		const lastPos = g_PudimBuilderLastBuilt[ent];

		let templateData = GetTemplateData(templateName);
		if (!templateData)
			continue;

		// Check resources.
		let canAfford = true;
		if (templateData.cost)
		{
			let needed = null;
			try { needed = Engine.GuiInterfaceCall("GetNeededResources", { "cost": templateData.cost, "player": g_ViewedPlayer }); } catch(e) {}
			if (needed)
				for (let res in needed)
					if (needed[res] > 0) { canAfford = false; break; }
		}

		if (!canAfford)
		{
			let now = Date.now();
			let lastWarn = g_PudimLastRepeatWarnTime[templateName] || 0;
			if (now - lastWarn > 10000)
			{
				g_PudimLastRepeatWarnTime[templateName] = now;
				let gName = (templateData.name && templateData.name.generic) ? templateData.name.generic : templateName;
				try { Engine.GuiInterfaceCall("pudim_PushNotification", { "message": "Sem recursos para repetir a construção de " + gName }); } catch(e) {}
			}
			continue;
		}

		// Find adjacent free space.
		let width = 8, depth = 8;
		if (templateData.footprint)
		{
			let fp = templateData.footprint;
			if (fp.circle)      { width = fp.circle.radius * 2; depth = fp.circle.radius * 2; }
			else if (fp.square) { width = fp.square.width;       depth = fp.square.depth; }
		}
		// Espacamento seguro e orgânico para o Bairro
		let shiftX = width + 5.0;
		let shiftZ = depth + 5.0;

		let candidateOffsets = [
			{ dx: shiftX,  dz: 0      }, { dx: -shiftX, dz: 0      },
			{ dx: 0,       dz: shiftZ  }, { dx: 0,       dz: -shiftZ }
		];

		// Ordena as 4 direções pela mais próxima ao construtor (minimiza caminhada)
		// Fallback: pseudo-aleatório se posição do construtor indisponível
		const builderState = GetEntityState(ent);
		const builderPos = (builderState && builderState.position)
			? { x: builderState.position.x, z: builderState.position.z } : null;

		let order = [0, 1, 2, 3];
		if (builderPos) {
			order.sort((a, b) => {
				const oa = candidateOffsets[a], ob = candidateOffsets[b];
				const dxa = lastPos.x + oa.dx - builderPos.x, dza = lastPos.z + oa.dz - builderPos.z;
				const dxb = lastPos.x + ob.dx - builderPos.x, dzb = lastPos.z + ob.dz - builderPos.z;
				return (dxa*dxa + dza*dza) - (dxb*dxb + dzb*dzb);
			});
		} else {
			let pIdx = Math.abs(Math.floor(lastPos.x * 17 + lastPos.z * 31)) % 4;
			order = order.slice(pIdx).concat(order.slice(0, pIdx));
		}

		let foundX = null, foundZ = null;
		for (let idx of order) {
			let off = candidateOffsets[idx];
			let tx = lastPos.x + off.dx;
			let tz = lastPos.z + off.dz;

			let isSafe = false;
			try {
				const res = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
					"template": templateName, "x": tx, "z": tz, "angle": 0, "actorSeed": 0
				});
				isSafe = !!(res && res.success);
			} catch(e) {}

			if (isSafe) {
				foundX = tx; foundZ = tz; break;
			}
		}
		try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch(e) {}

		if (foundX !== null)
		{
			Engine.PostNetworkCommand({
				"type": "construct",
				"template": templateName,
				"x": foundX,
				"z": foundZ,
				"angle": 0,
				"actorSeed": 0,
				"entities": [ent],
				"autorepair": true,
				"autocontinue": true,
				"queued": false
			});
			// Protege o worker por 10s para o auto-work não sobrescrever com gather antes de chegar na fundação.
			pudim_ProtectBuilder(ent, Date.now() + 10000);
			// Clear lastBuilt — will be repopulated once building starts.
			delete g_PudimBuilderLastBuilt[ent];
			g_PudimBuilderPending[ent] = 1;
		}
		else
		{
			let gName = (templateData.name && templateData.name.generic) ? templateData.name.generic : templateName;
			try { Engine.GuiInterfaceCall("pudim_PushNotification", { "message": "Sem espaço livre adjacente para repetir a construção de " + gName }); } catch(e) {}
			delete g_PudimRepeatBuilding[ent];
			delete g_PudimBuilderLastBuilt[ent];
			delete g_PudimBuilderPending[ent];
		}
	}
}


// ═══════════════════════════════════════════════════════════════════
// UTILITÁRIOS
// ═══════════════════════════════════════════════════════════════════

/**
 * Define o caption de um elemento GUI pelo nome, com proteção contra null.
 * @param {string} name - Nome do elemento GUI
 * @param {string} text - Texto a definir
 */
function pudim_SetCaption(name, text)
{
	const obj = Engine.TryGetGUIObjectByName(name);
	if (obj)
		obj.caption = text;
}

/** Flag para o balanceamento inicial */
var g_PudimInitialBalanceDone = false;
var g_PudimInitialFemaleDispatched = false;
var g_PudimInitialSoldierDispatched = false;
var g_PudimInitialCavalryDispatched = false;
// Unidades iniciais podem aparecer "in world" em ticks diferentes (ex: desguarnecendo do CC
// aos poucos). Rastreia quem já foi despachado e só marca "concluído" quando a contagem
// estabilizar entre duas checagens (1s) — evita perder unidade que aparece um tick depois.
var g_PudimInitialFemaleSeen = new Set();
var g_PudimInitialFemaleLastCount = -1;
var g_PudimInitialSoldierSeen = new Set();
var g_PudimInitialSoldierLastCount = -1;

/**
 * Executa o balanceamento inicial de coleta de recursos no início do jogo.
 */
function pudim_ExecuteInitialBalance()
{
	let data;
	try
	{
		data = Engine.GuiInterfaceCall("pudim_GetInitialBalanceData");
	}
	catch (e)
	{
		return false;
	}

	if (!data)
	{
		pudim_Log("DEBUG", "BALANCE", "GetInitialBalanceData retornou null");
		return false;
	}

	pudim_Log("DEBUG", "BALANCE", "fc=" + data.femaleCitizens.length + " sol=" + data.soldiers.length + " cav=" + (data.cavalry||0) + " berry=" + (data.berryBush||0) + " tree=" + (data.tree||0) + " chicken=" + (data.chicken||0));

	// Se não encontrou nenhuma unidade inicial do jogador no mapa, retornar false para tentar novamente
	if (data.femaleCitizens.length === 0 && data.soldiers.length === 0 && !data.cavalry)
		return false;

	// Marcar como despachado se o grupo não existe após 8s (era 3s — em alguns mapas as unidades
	// demoram mais para desguarnecer do CC, causando dispatch nunca ocorrer em 2/4 jogos)
	const elapsed = (g_SimState && g_SimState.timeElapsed) || 0;
	if (data.femaleCitizens.length === 0 && elapsed > 8000)
	{
		pudim_Log("DEBUG", "BALANCE", "fc=0 apos 8s, sem artesas nesta civ/mapa");
		g_PudimInitialFemaleDispatched = true;
	}
	else if (data.femaleCitizens.length === 0 && elapsed <= 8000)
		pudim_Log("DEBUG", "BALANCE", "fc=0 aguardando artesas t=" + Math.round(elapsed) + "ms");
	// Soldados: aguardar até 8s antes de marcar como sem-soldados (podem estar garnisonados)
	if (data.soldiers.length === 0 && elapsed > 8000)
		g_PudimInitialSoldierDispatched = true;
	// Cavalaria: aguardar até 5s (unidade única, costuma sair do CC mais rápido)
	if (!data.cavalry && elapsed > 5000)
		g_PudimInitialCavalryDispatched = true;

	// 1. Artesãs -> Frutas (fallback: 5s sem fruta, auto-work assume)
	if (data.femaleCitizens.length > 0 && !g_PudimInitialFemaleDispatched)
	{
		if (data.berryBush)
		{
			// Despacha só as que ainda não foram vistas (evita reenviar comando pra quem já está indo)
			const newFemales = data.femaleCitizens.filter(id => !g_PudimInitialFemaleSeen.has(id));
			if (newFemales.length > 0)
			{
				Engine.PostNetworkCommand({
					"type": "gather",
					"entities": newFemales,
					"target": data.berryBush,
					"queued": false,
					"pushFront": false
				});
				// Protege por 15s: sem isso, sistemas de armazém/celeiro proativo (que buscam
				// "qualquer builder civil disponível", mesmo coletando) podiam sequestrar as
				// aldeãs recém-despachadas segundos depois, antes delas sequer chegarem na fruta.
				const femaleExpiry = Date.now() + 15000;
				for (const id of newFemales) {
					g_PudimInitialFemaleSeen.add(id);
					pudim_ProtectBuilder(id, femaleExpiry);
				}
			}
			// Contagem estabilizou entre duas checagens (1s) -> ninguém novo apareceu, concluído
			if (data.femaleCitizens.length === g_PudimInitialFemaleLastCount)
				g_PudimInitialFemaleDispatched = true;
			g_PudimInitialFemaleLastCount = data.femaleCitizens.length;
		}
		else if (g_SimState && g_SimState.timeElapsed > 5000)
		{
			// Sem arbustos perto da CC; auto-work distribuirá as artesãs
			g_PudimInitialFemaleDispatched = true;
		}
	}

	// 2. Soldados -> Madeira
	if (data.soldiers.length > 0 && !g_PudimInitialSoldierDispatched)
	{
		if (data.tree)
		{
			const newSoldiers = data.soldiers.filter(id => !g_PudimInitialSoldierSeen.has(id));
			if (newSoldiers.length > 0)
			{
				Engine.PostNetworkCommand({
					"type": "gather",
					"entities": newSoldiers,
					"target": data.tree,
					"queued": false,
					"pushFront": false
				});
				// Protege soldados por 20s para auto-work não os mandar de volta para frutas
				const soldierExpiry = Date.now() + 20000;
				for (const s of newSoldiers) {
					pudim_ProtectBuilder(s, soldierExpiry);
					g_PudimInitialSoldierSeen.add(s);
				}
			}
			if (data.soldiers.length === g_PudimInitialSoldierLastCount)
				g_PudimInitialSoldierDispatched = true;
			g_PudimInitialSoldierLastCount = data.soldiers.length;
		}
		else if (g_SimState && g_SimState.timeElapsed > 5000)
			g_PudimInitialSoldierDispatched = true;
	}

	// 3. Cavaleiro -> Carne passiva
	if (data.cavalry && !g_PudimInitialCavalryDispatched)
	{
		if (data.chicken)
		{
			Engine.PostNetworkCommand({
				"type": "gather",
				"entities": [data.cavalry],
				"target": data.chicken,
				"queued": false,
				"pushFront": false
			});
			// Protege cavalaria por 20s para auto-work não a redirecionar para frutas
			pudim_ProtectBuilder(data.cavalry, Date.now() + 20000);
			g_PudimInitialCavalryDispatched = true;
		}
		else if (g_SimState && g_SimState.timeElapsed > 1500)
			g_PudimInitialCavalryDispatched = true;
	}

	return g_PudimInitialFemaleDispatched && g_PudimInitialSoldierDispatched && g_PudimInitialCavalryDispatched;
}

/**
 * Retorna trabalhadores do pânico às suas tarefas anteriores (botão manual).
 * Também reseta o estado de pânico completamente.
 */
function pudim_ReturnToWork()
{
	// Botão do painel = ordem explícita do jogador: sempre obedece, mesmo sem CC ou em cerco.
	pudim_ReturnPanicUnitsToWork(true);
}

/**
 * Envia de volta ao trabalho todos os trabalhadores que foram guarnecidos pelo pânico.
 * @param {boolean} manual - true só quando o JOGADOR pediu (botão "Voltar ao Trabalho").
 */
function pudim_ReturnPanicUnitsToWork(manual)
{
	// Trava de segurança: NUNCA desguarnecer sozinho se
	//   (a) o Centro Cívico caiu — sem CC a base está sendo tomada; abrir as casas é
	//       entregar as unidades. Só o jogador decide a hora de sair; ou
	//   (b) há abrigo ocupado com inimigo a ≤80m (cerco em andamento).
	// Foi exatamente isso que despejou as unidades no meio do exército inimigo.
	if (!manual && (g_PudimNoCivCentre || g_PudimSheltersUnderSiege > 0)) {
		if (!g_PudimHoldGarrisonLogged) {
			g_PudimHoldGarrisonLogged = true;
			pudim_Log("WARN", "PANIC", "mantendo unidades guarnecidas ("
				+ (g_PudimNoCivCentre ? "sem CC" : "cerco: " + g_PudimSheltersUnderSiege + " abrigo(s)")
				+ ") — use 'Voltar ao Trabalho' para soltar manualmente");
		}
		return;
	}
	g_PudimHoldGarrisonLogged = false;

	if (g_PudimPanicMode)
		pudim_Log("SUCCESS", "PANIC", "ameaça encerrada, retornando " + Object.keys(g_PudimPanicGarrisoned).length + " unidade(s) ao trabalho");

	// Primeiro: desguarnecer unidades que foram enviadas para abrigo
	const releaseNow = Date.now();
	for (const entId in g_PudimPanicGarrisoned)
	{
		// Marca o momento da soltura: alimenta o cooldown anti vai-e-volta. A unidade
		// volta a ser protegida num ataque novo, só não é re-guarnecida em segundos.
		g_PudimLastReleaseTime[entId] = releaseNow;
		const garrisonInfo = g_PudimPanicGarrisoned[entId];
		if (garrisonInfo && garrisonInfo.shelterID) {
			Engine.PostNetworkCommand({
				"type": "unload",
				"garrisonHolder": garrisonInfo.shelterID,
				"entities": [+entId],
				"queued": false
			});
		}
	}

	for (const entId in g_PudimPanicPreTask)
	{
		const task = g_PudimPanicPreTask[+entId];
		if (!task) continue;

		const state = GetEntityState ? GetEntityState(+entId) : null;
		if (!state) continue;

		// Soldados (CitizenSoldier/Cavalry) NÃO voltam a colher — ficam idle para o auto-work
		// decidir se precisam de trabalho (evita mandar soldados de volta a recursos em batalha)
		const isSoldier = state.identity && (
			(state.identity.classes && (state.identity.classes.indexOf("CitizenSoldier") !== -1 ||
			                             state.identity.classes.indexOf("FastMoving") !== -1)));
		if (isSoldier) continue;

		if (task.type === "gather" && task.target)
		{
			Engine.PostNetworkCommand({
				"type": "gather",
				"entities": [+entId],
				"target": task.target,
				"queued": false,
				"pushFront": false
			});
		}
		else if (task.type === "gather-near-position" && task.resType)
		{
			Engine.PostNetworkCommand({
				"type": "gather-near-position",
				"entities": [+entId],
				"resourceType": task.resType,
				"resourceTemplate": "",
				"x": task.x,
				"z": task.z,
				"queued": false,
				"force": false
			});
		}
	}

	g_PudimPanicPreTask = {};
	g_PudimPanicGarrisoned = {};
	g_PudimPanicMode = false;
	g_PudimPanicFull = false;
	g_PudimPanicLastThreat = 0;
	g_PudimPanicModeStartTime = 0;

	const statusEl = Engine.TryGetGUIObjectByName("pudim_panicStatus");
	if (statusEl) statusEl.caption = "Situação: Calma";
}


// ═══════════════════════════════════════════════════════════════════
// SISTEMA DE PÂNICO
// ═══════════════════════════════════════════════════════════════════

/**
 * Verifica se a base está sob ataque e executa protocolo de pânico:
 *  - Exército grande (>4): trabalhadores → casas/CC; ranged → torres/fortaleza
 *  - Grupo pequeno com tropas suficientes: deixa soldados lutar
 *  - Ameaça cessou há 6s: retorno automático ao trabalho
 */
function pudim_ProcessPanic()
{
	if (!pudim_CombatAssistOn("panic")) {
		if (g_PudimPanicMode) pudim_ReturnPanicUnitsToWork();
		return;
	}

	const now = Date.now();
	let panicData;
	try {
		panicData = Engine.GuiInterfaceCall("pudim_GetPanicData");
	} catch(e) { return; }
	if (!panicData) return;

	// Estado que trava o desguarnecimento automático (ver pudim_ReturnPanicUnitsToWork)
	g_PudimNoCivCentre = !!panicData.noCivCentre;
	g_PudimSheltersUnderSiege = panicData.sheltersUnderSiege || 0;

	const statusEl = Engine.TryGetGUIObjectByName("pudim_panicStatus");

	// Histerese: contar ciclos consecutivos com/sem ameaça (mata o loop garrison↔unload)
	if (panicData.underAttack) { g_PudimThreatStreak++; g_PudimCalmStreak = 0; }
	else { g_PudimCalmStreak++; g_PudimThreatStreak = 0; }

	// Ameaça ainda não confirmada: espera ciclos consecutivos antes de guarnecer qualquer um
	if (panicData.underAttack && !g_PudimPanicMode &&
	    g_PudimThreatStreak < PUDIM_THREAT_CYCLES_TO_PANIC) {
		if (statusEl) statusEl.caption = "Situação: verificando ameaça...";
		return;
	}

	if (panicData.underAttack) {
		// Válvula de segurança: nunca fica preso em pânico indefinidamente, mesmo se a detecção
		// continuar ativa (ex: inimigo parado sem atacar perto do CC mantém "underAttack"=true pra sempre).
		if (g_PudimPanicMode && g_PudimPanicModeStartTime > 0 &&
		    (now - g_PudimPanicModeStartTime > PUDIM_PANIC_MAX_DURATION)) {
			pudim_Log("WARN", "PANIC", "timeout de segurança (" + Math.round(PUDIM_PANIC_MAX_DURATION / 1000) + "s) — forçando retorno ao trabalho");
			pudim_ReturnPanicUnitsToWork();
			return;
		}

		// Defesa é decidida por força RELATIVA, não por contagem absoluta de inimigos.
		// A regra antiga (isLargeArmy = 5+ inimigos → pânico total) causou absurdo real no log:
		// "PÂNICO iniciado! 6 inimigo(s), aliados=98" — 98 soldados fugindo de 6 atacantes,
		// economia travada 50s. Pânico total agora só quando estamos de fato em desvantagem
		// (militares aliados < 1.2x inimigos = margem de segurança).
		const canDefend = panicData.alliedMilitaryNearby >= panicData.enemyCount * 1.2;

		// 1-2 inimigos com defesa suficiente = batedor/assédio leve: só avisa, NÃO guarnece
		// nem entra em modo pânico, e NÃO renova o timer de ameaça (senão um batedor rondando
		// segura unidades guarnecidas de um pânico anterior indefinidamente). No log real,
		// 1 batedor manteve "defendendo" por 2min, guarneceu dezenas de trabalhadores e
		// paralisou a economia.
		if (canDefend && panicData.enemyCount <= 2) {
			// Pânico anterior ainda ativo? Ameaça trivial não renova o timer, então o mesmo
			// timeout de 10s do fluxo normal libera as unidades aqui também.
			if (g_PudimPanicMode && (now - g_PudimPanicLastThreat > 10000 && g_PudimCalmStreak >= PUDIM_CALM_CYCLES_TO_RELEASE)) {
				if (statusEl) statusEl.caption = "Retornando ao trabalho...";
				pudim_ReturnPanicUnitsToWork();
			} else if (statusEl && !g_PudimPanicMode) {
				statusEl.caption = "Situação: Batedor inimigo à vista (" + panicData.enemyCount + ")";
			}
			return;
		}

		g_PudimPanicLastThreat = now;

		if (canDefend) {
			// Grupo pequeno com tropas suficientes — soldados lutam, mas trabalhadores em risco ficam protegidos.
			// IMPORTANTE: precisa marcar g_PudimPanicMode=true mesmo aqui, senão o retorno automático
			// (que só dispara com g_PudimPanicMode true) nunca libera esses trabalhadores guarnecidos.
			if (!g_PudimPanicMode) {
				pudim_Log("INFO", "PANIC", "defendendo com " + panicData.enemyCount + " inimigo(s), protegendo trabalhadores");
				g_PudimPanicModeStartTime = now;
			}
			g_PudimPanicMode = true;
			if (statusEl) statusEl.caption = "Situação: Defendendo (" + panicData.enemyCount + " inimigos)";
			// Mesmo no modo "pode defender", guarnecer trabalhadores que estão próximos do inimigo
			const safeCC = panicData.shelters.filter(s => s.type === "cc" && s.freeSlots > 0);
			for (const worker of panicData.atRiskWorkers) {
				if (g_PudimPanicGarrisoned[worker.id]) continue;
				// Só bloqueia se foi solto agora há pouco (anti vai-e-volta). Ataque novo
				// depois do cooldown protege a unidade normalmente, quantas vezes for preciso.
				if (!pudim_CanGarrison(worker.id)) continue;
				if (!g_PudimPanicPreTask[worker.id] && worker.currentOrder)
					g_PudimPanicPreTask[worker.id] = worker.currentOrder;
				const shelter = safeCC.find(s => s.freeSlots > 0);
				if (shelter) {
					Engine.PostNetworkCommand({ "type": "garrison", "entities": [worker.id], "target": shelter.id, "queued": false });
					g_PudimPanicGarrisoned[worker.id] = { shelterID: shelter.id };
					shelter.freeSlots--;
				}
			}
			return;
		}

		// Grande exército ou inferior em tropa — pânico total (único modo que trava o auto-work)
		if (!g_PudimPanicMode) {
			pudim_Log("WARN", "PANIC", "PÂNICO iniciado! " + panicData.enemyCount + " inimigo(s), aliados=" + panicData.alliedMilitaryNearby);
			g_PudimPanicModeStartTime = now;
		}
		g_PudimPanicMode = true;
		g_PudimPanicFull = true;
		if (statusEl) statusEl.caption = "PÂNICO! " + panicData.enemyCount + " inimigos!";

		// Priorizar abrigos SEGUROS (sem inimigo a 80m). Fallback: qualquer abrigo.
		// Trabalhadores: casa segura > CC seguro > casa insegura > CC inseguro > andar para CC
		const safeHouses = panicData.shelters.filter(s => s.type === "house" && s.safe && s.freeSlots > 0);
		const safeCCs    = panicData.shelters.filter(s => s.type === "cc"    && s.safe && s.freeSlots > 0);
		const anyHouses  = panicData.shelters.filter(s => s.type === "house" && s.freeSlots > 0);
		const anyCCs     = panicData.shelters.filter(s => s.type === "cc"    && s.freeSlots > 0);
		// Soldados: torre/fortaleza/CC seguros primeiro
		const soldierShelters = panicData.shelters.filter(s =>
			(s.type === "cc" || s.type === "tower" || s.type === "fortress") && s.safe);
		const soldierSheltersFallback = panicData.shelters.filter(s =>
			s.type === "cc" || s.type === "tower" || s.type === "fortress");

		const pickWorkerShelter = () =>
			safeHouses.find(s => s.freeSlots > 0) ||
			safeCCs.find(s => s.freeSlots > 0) ||
			anyHouses.find(s => s.freeSlots > 0) ||
			anyCCs.find(s => s.freeSlots > 0) ||
			null;

		// Guarnecer trabalhadores em risco
		const rallyCCPos = (panicData.ccPositions && panicData.ccPositions.length > 0)
			? panicData.ccPositions[0] : null;

		for (const worker of panicData.atRiskWorkers) {
			if (g_PudimPanicGarrisoned[worker.id]) continue;
			// Anti vai-e-volta (ver PUDIM_REGARRISON_COOLDOWN) — não limita quantas vezes a
			// unidade pode ser protegida ao longo da partida
			if (!pudim_CanGarrison(worker.id)) continue;

			// Salvar tarefa anterior (só na primeira vez)
			if (!g_PudimPanicPreTask[worker.id] && worker.currentOrder)
				g_PudimPanicPreTask[worker.id] = worker.currentOrder;

			const shelter = pickWorkerShelter();
			if (shelter) {
				Engine.PostNetworkCommand({
					"type": "garrison",
					"entities": [worker.id],
					"target": shelter.id,
					"queued": false
				});
				g_PudimPanicGarrisoned[worker.id] = { shelterID: shelter.id };
				shelter.freeSlots--;
			} else if (rallyCCPos) {
				// Sem abrigo disponível: mover para perto do CC
				Engine.PostNetworkCommand({
					"type": "walk",
					"entities": [worker.id],
					"x": rallyCCPos.x + (Math.random() * 20 - 10),
					"z": rallyCCPos.z + (Math.random() * 20 - 10),
					"queued": false
				});
				g_PudimPanicGarrisoned[worker.id] = { shelterID: null };
			}
		}

		// Guarnecer soldados em torres/fortalezas/CC seguros
		const pickSoldierShelter = () =>
			soldierShelters.find(s => s.freeSlots > 0) ||
			soldierSheltersFallback.find(s => s.freeSlots > 0) ||
			null;

		for (const soldier of panicData.atRiskSoldiers) {
			if (g_PudimPanicGarrisoned[soldier.id]) continue;

			const shelter = pickSoldierShelter();
			if (!shelter) continue;

			Engine.PostNetworkCommand({
				"type": "garrison",
				"entities": [soldier.id],
				"target": shelter.id,
				"queued": false
			});
			g_PudimPanicGarrisoned[soldier.id] = { shelterID: shelter.id };
			shelter.freeSlots--;
		}

	} else if (g_PudimPanicMode && (now - g_PudimPanicLastThreat > 10000 && g_PudimCalmStreak >= PUDIM_CALM_CYCLES_TO_RELEASE)) {
		// Ameaça cessou há 10 segundos — retorno automático ao trabalho
		if (statusEl) statusEl.caption = "Retornando ao trabalho...";
		pudim_ReturnPanicUnitsToWork();
	} else if (!panicData.underAttack && !g_PudimPanicMode) {
		if (statusEl) statusEl.caption = "Situação: Calma";
	}
}

// ═══════════════════════════════════════════════════════════════════
// AUTO-KITE
// ═══════════════════════════════════════════════════════════════════

/**
 * Faz infantaria ranged fugir de inimigos corpo-a-corpo que chegam perto.
 * Limpa entradas antigas do dicionário de kiting a cada ciclo.
 */
function pudim_ProcessAutoKite()
{
	const now = Date.now();

	// Limpar entradas expiradas (3s de cooldown por unidade)
	for (const ent in g_PudimKiting)
		if (now - g_PudimKiting[ent] > 3000)
			delete g_PudimKiting[ent];

	let kiteData;
	try
	{
		kiteData = Engine.GuiInterfaceCall("pudim_GetAutoKiteData", { "kiting": g_PudimKiting });
	}
	catch (e) { return; }

	if (!kiteData || kiteData.length === 0)
		return;

	for (const item of kiteData)
	{
		Engine.PostNetworkCommand({
			"type": "walk",
			"entities": [item.ent],
			"x": item.x,
			"z": item.z,
			"queued": false
		});
		// Após reposicionar, retoma ataque ao inimigo mais próximo para não ficar parada
		if (item.enemyTarget)
			Engine.PostNetworkCommand({
				"type": "attack",
				"entities": [item.ent],
				"target": item.enemyTarget,
				"queued": true
			});
		g_PudimKiting[item.ent] = now;
	}
}



/**
 * Analisador de Combate em Tempo Real (O Estrategista)
 */
var g_PudimLastCombatTip = "";

function pudim_RunCombatEstimator()
{
	try {
		let result = Engine.GuiInterfaceCall("pudim_GetCombatEstimator");
		if (result && result.tips && result.tips.length > 0) {
			// Selecionar o alerta mais urgente ou rotacionar
			let tip = result.tips[0];
			if (tip !== g_PudimLastCombatTip) {
				g_PudimLastCombatTip = tip;
				try { Engine.GuiInterfaceCall("pudim_PushNotification", { "message": "[Estrategista] " + tip }); } catch(e) {}
			}
		}
	} catch(e) {}
}

// ==========================================
// MÓDULO 4: COUNTER-TRAIN (E AUTO-QUEUE INFINITO)
// ==========================================
let g_PudimLastCounterTrain = 0;
function pudim_RunCounterTrain()
{
	let now = Date.now();
	if (now - g_PudimLastCounterTrain < 3000) return; // Roda a cada 3 segundos para nao floodar a engine
	g_PudimLastCounterTrain = now;

	let playerState = GetSimState().players[Engine.GetPlayerID()];
	if (!playerState) return;

	// Varre as construcoes do jogador
	let ents = Engine.PickEntitiesByPlayer(Engine.GetPlayerID());
	for (let ent of ents) {
		let state = GetEntityState(ent);
		if (!state || !state.trainer || !state.trainer.entities || state.trainer.entities.length === 0) continue;

		// So agir se a fila estiver VAZIA (assim nao gastamos recursos atoa acumulando fila)
		if (state.production && state.production.queue && state.production.queue.length > 0) continue;

		let isCC = state.identity && state.identity.classes.indexOf("CivCentre") !== -1;
		let isBarracks = state.identity && state.identity.classes.indexOf("Barracks") !== -1;

		if (isCC) {
			// Encontrar a mulher cidada nas entidades de producao do CC
			let targetTemplate = null;
			for (let t of state.trainer.entities) {
				if (t.indexOf("support_female_citizen") !== -1 || t.indexOf("female") !== -1) {
					targetTemplate = t; break;
				}
			}
			if (!targetTemplate) targetTemplate = state.trainer.entities[0]; // Failsafe
			
			if (targetTemplate) {
				Engine.PostNetworkCommand({ "type": "train", "entities": [ent], "template": targetTemplate, "count": 1, "pushFront": false });
			}
		} 
		else if (isBarracks) {
			let targetTemplate = null;
			for (let t of state.trainer.entities) {
				if (t.indexOf("infantry_spearman") !== -1 || t.indexOf("infantry_melee") !== -1) {
					targetTemplate = t; break;
				}
			}
			if (!targetTemplate) targetTemplate = state.trainer.entities[0];
			
			if (targetTemplate) {
				Engine.PostNetworkCommand({ "type": "train", "entities": [ent], "template": targetTemplate, "count": 1, "pushFront": false });
			}
		}
	}
}

let g_PudimCounselorTarget = null;
let g_PudimLastCounselorCheck = 0;

function pudim_RunCounselor()
{
	let now = Date.now();
	if (now - g_PudimLastCounselorCheck < 5000) return;
	g_PudimLastCounselorCheck = now;
	
	let data = Engine.GuiInterfaceCall("pudim_GetCounselorData");
	if (!data) return;
	
	let tipEl = Engine.TryGetGUIObjectByName("pudim_counselorTip");
	let btnEl = Engine.TryGetGUIObjectByName("pudim_counselorCameraBtn");
	
	if (tipEl) {
		tipEl.caption = data.hasTip ? data.tip : "Dica: Analisando as trincheiras...";
	}
	
	if (btnEl) {
		if (data.x !== 0 && data.z !== 0) {
			btnEl.hidden = false;
			g_PudimCounselorTarget = { x: data.x, z: data.z };
		} else {
			btnEl.hidden = true;
			g_PudimCounselorTarget = null;
		}
	}
}

function pudim_CounselorCameraMove()
{
	if (g_PudimCounselorTarget) {
		Engine.CameraMoveTo(g_PudimCounselorTarget.x, g_PudimCounselorTarget.z);
	}
}
