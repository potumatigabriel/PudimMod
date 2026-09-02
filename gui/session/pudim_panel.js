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
// O log da partida, em memoria. Ele so vai para o ConfigDB no flush de 10s — ver pudim_Log,
// que antes reserializava este array inteiro A CADA LINHA.
var g_PudimLogSessao = [];
const PUDIM_LOG_SESSAO_MAX = 5000;
// 32 KB por partida no user.cfg. Antes uma unica linha chegou a 228 KB — ver o comentario
// do teto em pudim_Log, e a investigacao dos fechamentos de 01/09.
const PUDIM_LOG_BYTES_MAX = 32768;
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

	// ── PERSISTENCIA: O ARRAY VIVE EM MEMORIA, O DISCO RECEBE A CADA 10s ──────────────
	//
	// A versao anterior fazia, A CADA LINHA DE LOG:
	//
	//   ConfigDB_GetValue  -> le a sessao inteira como string
	//   JSON.parse         -> parseia tudo
	//   push
	//   JSON.stringify     -> re-serializa TUDO
	//   ConfigDB_CreateValue
	//
	// Isso e O(n^2) no numero de entradas. Medido (tools/test_log_custo.js roda a conta):
	//
	//   1000 entradas ->   481 ms no total,  98 MB de JSON processado
	//   5000 entradas -> 12075 ms no total, 2,4 GB de JSON processado
	//
	// Com 5000 entradas cada linha de log custava 2,4ms da thread da interface, e a partida
	// inteira gastava 2,4 GB de parse+stringify. No log da partida nomad de 01/09 o
	// balanceamento inicial gerava ~50 linhas por segundo — a esse ritmo isto sozinho
	// engasga o jogo.
	//
	// Agora o array vive em memoria e so e serializado no flush periodico. O custo por linha
	// vira O(1), e o O(n) acontece uma vez a cada 10 segundos em vez de a cada linha.
	g_PudimLogSessao.push(entry);
	if (g_PudimLogSessao.length > PUDIM_LOG_SESSAO_MAX)
		g_PudimLogSessao.shift();
	try {
		if (entry.ts - g_PudimLogLastSave > 10000) {
			g_PudimLogLastSave = entry.ts;
			// ── TETO EM BYTES, NAO SO EM ENTRADAS ─────────────────────────────────────
			//
			// Investigacao de 01/09, "o jogo esta fechando": os oito fechamentos desde
			// 25/08 sao IDENTICOS no registro do Windows —
			//
			//   modulo ucrtbase.dll, excecao 0xc0000409, deslocamento 0x11858
			//
			// que e o CRT abortando o processo de proposito, sempre no mesmo ponto. Nao e
			// falta de memoria (17,6 GB livres no crashlog).
			//
			// O que o mod estava fazendo: 97% do user.cfg era log dele, e a maior LINHA
			// unica do arquivo tinha 228.326 bytes. Uma linha de configuracao de 228 KB esta
			// muito fora do uso normal de um .cfg, e e o tipo de coisa que estoura buffer de
			// leitor de linha.
			//
			// NAO esta provado que era a causa — a correlacao entre tamanho do log e
			// fechamento existe mas nao e limpa, porque varias partidas cabem num mesmo
			// processo. Mas 228 KB numa linha de config nao se defende de qualquer forma, e
			// cortar isso e o teste: se os fechamentos pararem, era.
			//
			// O teto e em BYTES porque e o byte que chega no arquivo. Contar entradas nao
			// garante nada: uma mensagem longa vale por dez curtas.
			let texto = JSON.stringify(g_PudimLogSessao);
			while (texto.length > PUDIM_LOG_BYTES_MAX && g_PudimLogSessao.length > 20) {
				// Corta um quarto de uma vez: cortar de um em um refaria o stringify a cada
				// volta, que e exatamente o custo quadratico que acabei de tirar daqui.
				g_PudimLogSessao.splice(0, Math.max(1, Math.floor(g_PudimLogSessao.length / 4)));
				texto = JSON.stringify(g_PudimLogSessao);
			}
			Engine.ConfigDB_CreateValue("user", "pudim.log." + pudim_MatchKey(), texto);
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
	"PALICADA": "200 180 140",
	"QUARTEL": "200 160 255",
	"OBRA":   "255 180 120",
	"HEROI":  "255 200 255",
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
	// A chave-mestra das ajudas de combate ficou de fora desta lista desde que foi criada:
	// no modo compacto o painel encolhia e ela continuava desenhada, solta sobre o mapa.
	// Os objetos *Label não precisam entrar aqui — são filhos dos respectivos botões no XML
	// e somem junto com eles.
	"pudim_toggleCombatBtn",
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
		panel.size = hidden ? "100%-340 50%-494 100%-20 50%-254" : "100%-340 50%-494 100%-20 50%+496";
	// Atualiza ícone do botão
	const lbl = Engine.TryGetGUIObjectByName("pudim_compactLabel");
	if (lbl) lbl.caption = hidden ? "▶" : "▼";
}

/** Controla se o auto-trabalho está ativo */
var g_PudimAutoWorkEnabled = true;

/**
 * Pesos de prioridade de coleta de recursos, como o jogo deve comecar.
 * Madeira acima de comida (4x3) e o padrao pedido em 19/08: a fase 1 gasta madeira em
 * casas, armazens e fazendas mais rapido do que gasta comida, e as fazendas so passam a
 * render depois de pagas em madeira.
 */
var g_PudimResourceWeights = { food: 3, wood: 4, stone: 0, metal: 0 };

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

/**
 * Depois que o jogador apaga uma obra do mod, NENHUMA obra nova sai por 10 segundos.
 *
 * Pedido de 25/08: "quando tenta fazer alguma construcao, se eu deleto, espera 10s antes de
 * tentar novamente, e antes de fazer, verifique se ainda precisa".
 *
 * A quarentena por posicao sozinha nao resolve o que ele descreve. Ela impede refazer NO
 * MESMO PONTO, mas o mod continua livre para pousar a 45m dali no ciclo seguinte — e
 * enquanto ele repoe a cada poucos segundos, o jogador nao consegue nem chegar a escolher o
 * lugar bom. Apagar e um sinal de "para", nao so de "ali nao".
 *
 * Dez segundos e o numero que ele pediu, e e o certo: da tempo de posicionar a construcao a
 * mao sem parar o mod por tempo demais. E ao voltar, cada sistema refaz a propria conta de
 * necessidade — se o jogador ja construiu no lugar melhor, o mod simplesmente nao precisa
 * mais, e nao constroi.
 */
const PUDIM_PAUSA_APOS_APAGAR = 10000;
var g_PudimObrasPausadasAte = 0;

function pudim_ObrasPausadas() {
	return Date.now() < g_PudimObrasPausadasAte;
}

function pudim_MarkCancelled(x, z) {
	g_PudimObrasPausadasAte = Date.now() + PUDIM_PAUSA_APOS_APAGAR;
	for (const p of g_PudimCancelledPositions) {
		const dx = p.x - x, dz = p.z - z;
		if (dx*dx + dz*dz <= 12*12) return; // já registrado
	}
	g_PudimCancelledPositions.push({ x: x, z: z });
	pudim_Log("INFO", "DROP", "construção cancelada pelo jogador em (" + x.toFixed(0) + "," +
		z.toFixed(0) + ") — não será refeita ali, e nenhuma obra nova por " +
		(PUDIM_PAUSA_APOS_APAGAR / 1000) + "s");
}
/**
 * Pontos onde uma fundação DECAIU sem nenhum construtor encostar. Diferente de
 * g_PudimCancelledPositions, isto expira: não foi decisão do jogador, foi falha do mod em
 * levar alguém até lá. Bani-los para sempre deixava a floresta sem depósito o resto da
 * partida. Também usa raio menor (25 vs 40): a intenção é só evitar insistir no mesmo
 * ponto exato durante a quarentena, não excluir a região inteira.
 */
var g_PudimDecayedSpots = [];
var g_PudimFoundationProgress = {}; // { foundationId: último progresso visto }

function pudim_IsCancelledSpot(x, z) {
	for (const p of g_PudimCancelledPositions) {
		const dx = p.x - x, dz = p.z - z;
		if (dx*dx + dz*dz <= 40*40) return true;
	}
	const now = Date.now();
	g_PudimDecayedSpots = g_PudimDecayedSpots.filter(p => p.until > now);
	for (const p of g_PudimDecayedSpots) {
		const dx = p.x - x, dz = p.z - z;
		if (dx*dx + dz*dz <= 25*25) return true;
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
	// Popula os dropdowns da construcao em serie (tipo e quantidade).
	try { pudim_QuartelInit(); } catch (e) { pudim_Log("ERROR", "QUARTEL", "init: " + e); }
	pudim_LogInfo("PudimMod inicializado.");

	// Tooltips de todos os botões, no idioma detectado (pudim_i18n.js). Sobrepõe os
	// tooltips fixos do XML, que estavam só em português e faltavam na maioria dos botões.
	try { pudim_ApplyTooltips(); } catch(e) {}
	try { pudim_ApplyCaptions(); } catch(e) {}
	// Estimador nasce colapsado, e a lista de unidades e lida uma vez ja no inicio.
	try { pudim_AplicarCombatBox(); } catch(e) { pudim_Log("ERROR", "PAINEL", "combatbox: " + e); }
	try { pudim_AtualizarUnidades(); } catch(e) { pudim_Log("ERROR", "PAINEL", "unidades: " + e); }

	const awL = Engine.TryGetGUIObjectByName("pudim_autoWorkLabel");
	if (awL) {
		awL.caption = "( LIGADO ) Auto-Trabalho"; awL.textcolor = "0 255 0 255";
		
	}

	// Inicializar configurações a partir do ConfigDB (default true unless explicitly disabled)
	const autoWorkSaved = Engine.ConfigDB_GetValue("user", "pudim.autowork.enabled");
	g_PudimAutoWorkEnabled = autoWorkSaved !== "false";

	// Pesos de recurso: sempre iniciam no padrão (food=3, wood=4, stone=0, metal=0)
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
// ─── Realidade da batalha: HP perdido nos ultimos 5s ──────────────────────────
// Mortes sao um sinal ruim numa janela curta: em 5s costuma haver ZERO mortes (sem
// sinal) e a primeira morte faz a razao saltar de 0 para infinito. HP perdido e
// continuo — atualiza a cada golpe — entao avisa ENQUANTO a tropa apanha, que e
// quando ainda da tempo de recuar.
var g_PudimHpSamples = [];              // [{ t, ally, enemy }]
const PUDIM_HP_WINDOW = 5000;           // janela de leitura: 5s
const PUDIM_COLOR_HOLD = 2000;          // trava antes de trocar de cor: 2s
var g_PudimCombatColor = "yellow";
var g_PudimCombatColorSince = 0;
var g_PudimCombatColorPending = null;

/**
 * Compara o HP atual com o de ~5s atras e devolve quem esta sangrando mais.
 * @returns {number|null} 0..1 (fracao da perda que foi NOSSA) ou null sem dados
 */
function pudim_BattleReality(now, allyHP, enemyHP) {
	g_PudimHpSamples.push({ t: now, ally: allyHP, enemy: enemyHP });
	while (g_PudimHpSamples.length > 1 && now - g_PudimHpSamples[0].t > PUDIM_HP_WINDOW)
		g_PudimHpSamples.shift();
	if (g_PudimHpSamples.length < 2) return null;

	const old = g_PudimHpSamples[0];
	// So conta PERDA (delta negativo); reforco chegando nao vira "vitoria"
	const lostAlly = Math.max(0, old.ally - allyHP);
	const lostEnemy = Math.max(0, old.enemy - enemyHP);
	const total = lostAlly + lostEnemy;
	if (total < 1) return null;           // ninguem apanhou: sem realidade a reportar
	return lostAlly / total;              // 0 = so ele sangra, 1 = so nos sangramos
}

/** Aplica a trava de 2s: a cor so muda apos se confirmar, para nao tremer */
function pudim_StableColor(now, wanted) {
	if (wanted === g_PudimCombatColor) { g_PudimCombatColorPending = null; return wanted; }
	if (g_PudimCombatColorPending !== wanted) {
		g_PudimCombatColorPending = wanted;
		g_PudimCombatColorSince = now;
		return g_PudimCombatColor;
	}
	if (now - g_PudimCombatColorSince >= PUDIM_COLOR_HOLD) {
		g_PudimCombatColor = wanted;
		g_PudimCombatColorPending = null;
	}
	return g_PudimCombatColor;
}

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

	// Tempo para cada lado eliminar o outro (a base da estimativa)
	if (data.timeToKillEnemy >= 0 || data.timeToKillUs >= 0) {
		const tE = data.timeToKillEnemy >= 0 ? data.timeToKillEnemy + "s" : "--";
		const tU = data.timeToKillUs >= 0 ? data.timeToKillUs + "s" : "--";
		pudim_SetCaption("pudim_winChancePct", winChance + "%   [color=\"170 170 170\"]mata em " +
			tE + " / morre em " + tU + "[/color]");
	} else {
		pudim_SetCaption("pudim_winChancePct", winChance + "%");
	}

	// Contras disponiveis contra a composicao inimiga
	if (data.counters && data.counters.length > 0) {
		const c = data.counters[0];
		pudim_SetCaption("pudim_counterHint", "[color=\"120 230 120\"]" + c.unit + " x " +
			c.vs + ": " + c.mult + "x[/color] (" + c.targets + " alvos)");
	} else {
		pudim_SetCaption("pudim_counterHint", "");
	}

	const now = Date.now();
	// A REALIDADE (HP perdido nos ultimos 5s) tem prioridade sobre a teoria: se o calculo
	// diz que ganhamos mas estamos sangrando 3:1, o vermelho acende do mesmo jeito.
	const reality = pudim_BattleReality(now, allies.totalHP, enemies.totalHP);
	let wanted;
	if (reality !== null) {
		if (reality >= 0.62) wanted = "red";        // 62%+ da perda e nossa
		else if (reality <= 0.42) wanted = "green";
		else wanted = "yellow";
	} else {
		wanted = winChance >= 60 ? "green" : (winChance >= 40 ? "yellow" : "red");
	}
	const color = pudim_StableColor(now, wanted);

	const bar = Engine.TryGetGUIObjectByName("pudim_winChanceBar");
	if (bar)
	{
		const bgObj = Engine.TryGetGUIObjectByName("pudim_winChanceBg");
		if (bgObj)
		{
			const bgSize = bgObj.size;
			const totalWidth = bgSize.right - bgSize.left - 8; // margem
			const barWidth = Math.round(totalWidth * winChance / 100);
			bar.size = "8 178 " + (8 + barWidth) + " 196";
		}
		bar.sprite = color === "green" ? "color: 30 180 60 200"
		           : color === "yellow" ? "color: 200 160 20 200"
		           : "color: 200 40 40 200";
	}

	// Fundo do estimador piscando na cor do estado (translucido, so durante combate)
	const flash = Engine.TryGetGUIObjectByName("pudim_combatFlash");
	if (flash) {
		const emCombate = (enemies.count || 0) > 0 && (allies.count || 0) > 0;
		if (!emCombate) {
			flash.sprite = "color: 0 0 0 0";
		} else {
			const on = (Math.floor(now / 450) % 2 === 0);
			const a = on ? 70 : 24;
			flash.sprite = color === "green" ? "color: 30 150 50 " + a
			             : color === "yellow" ? "color: 190 160 30 " + a
			             : "color: 190 30 30 " + a;
		}
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
								// O dropsite nasceu por causa DESTE recurso-alvo: ao terminar,
								// o construtor colhe ali mesmo em vez de voltar ao despacho.
								pudim_SetRally([pd.builderId], w.targetResX, w.targetResZ, w.targetResType, fx, fz);
								builtDropsite = true;
								builtCount++;
							}
						}
					} catch(e2) {}
				} else {
					builtDropsite = true; // cooldown ativo: deixar worker continuar, dropsite vem a caminho
				}
			}

			// Fallback: sem dropsite possível → redirecionar para recurso próximo de dropsite
			// existente. Só para quem está ALÉM do limiar de mover (podeMover): entre o
			// limiar de obra e o de mover, a resposta certa é construir mais perto e deixar
			// o coletor em paz. Mover custa duas caminhadas e a carga parcial que ele larga.
			if (!builtDropsite && w.redirectTarget && w.podeMover) {
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
		// Amostra do que o detector viu: distância real até o dropsite e o limiar calculado
		// para aquele recurso (capacidade x velocidade / 2 x taxa). Sem isso não dá para
		// julgar em jogo se o limiar está apertado ou frouxo demais.
		if (lw.length > 0 && nowLW - g_PudimWalkDiagAt > 20000) {
			g_PudimWalkDiagAt = nowLW;
			const amostra = lw.slice(0, 4)
				.map(w => w.targetResType + " " + (w.dropDist || "?") + "m/obra" + (w.thresh || "?") +
					"/mover" + (w.moveThresh || "?") + (w.podeMover ? "" : " [so_obra]"))
				.join(" | ");
			pudim_Log("DEBUG", "WALK", "longe do dropsite: " + result.longWalkers.length +
				" (obras=" + builtCount + " redir=" + redirectCount + " segurados=" + heldCount + ") " + amostra);
		}
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
					// proactiveBuilders vale só para ESTE ciclo. Sem a proteção persistente, o
					// ciclo seguinte (500ms depois) mandava o mesmo trabalhador colher, a
					// fundação ficava sem ninguém e decaía — foi o armazém de (221,428) no log
					// de 15:52. A proteção solta sozinha assim que ele fica ocioso, então não
					// prende ninguém depois que a obra acaba.
					pudim_ProtectBuilder(proactive.builderId, Date.now() + 30000);
					// cand é o cluster que motivou a obra: o construtor colhe lá ao terminar.
					pudim_SetRally([proactive.builderId], cand.x, cand.z, resKey, foundX, foundZ);
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
	const idleCandidates = result.idleWorkers.filter(w =>
		!inFlightNow[w.id] && !g_PudimDispatchedAt[w.id] && !proactiveBuilders[w.id]);

	// Rally antes do despacho genérico: quem acabou de erguer um armazém/celeiro do mod vai
	// colher NA floresta daquele dropsite, não no recurso de melhor score global. Sem esta
	// precedência o despacho genérico reclamava o construtor no mesmo tique e a obra recém
	// terminada ficava sem ninguém entregando nela.
	const ralliedNow = pudim_ApplyRally(idleCandidates);
	const ralliedIds = Object.keys(ralliedNow).map(Number);
	if (ralliedIds.length > 0) pudim_MarkDispatched(ralliedIds, {});
	const idleWorkers = idleCandidates.filter(w => !ralliedNow[w.id]);

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

	// Retrato do balanceamento a cada 20s: alvo x atual por recurso, ociosos, e quantos
	// queriam o recurso mais carente e não acharam vaga (semvaga). É esse último número que
	// separa as duas causas possíveis de "10 na comida e 32 na madeira": conta de cota
	// errada, ou falta de onde colocar gente na comida.
	if (result._bal) {
		const nowBal = Date.now();
		if (nowBal - g_PudimBalLogAt > 20000) {
			g_PudimBalLogAt = nowBal;
			const q = result._bal.quota || {}, c = result._bal.current || {};
			const partes = [];
			for (const r of ["food", "wood", "stone", "metal"])
				if (q[r] !== undefined) partes.push(r.charAt(0).toUpperCase() + (c[r] || 0) + "/" + q[r]);
			pudim_Log("DEBUG", "BALANCE", "atual/alvo " + partes.join(" ") +
				" | ociosos=" + (result._bal.idle || 0) +
				" | semvaga=" + (result._bal.foodBlocked || 0));
		}
	}

	// Trabalhadores ociosos que o mod NÃO conseguiu empregar neste ciclo, com o motivo por
	// recurso tentado. Throttled a 15s para não poluir. Enquanto sobrar gente parada, esta
	// linha diz exatamente onde a decisão morreu — sem ela, cada relato custava uma leitura
	// do código inteira para achar qual `continue` estava barrando.
	if (result.unplaced && result.unplaced.length > 0) {
		const nowUP = Date.now();
		if (nowUP - g_PudimUnplacedLogAt > 15000) {
			g_PudimUnplacedLogAt = nowUP;
			const amostra = result.unplaced.slice(0, 4)
				.map(u => u.kind + "#" + u.id + "[" + u.tried + "]").join(" ");
			// enemyList mostra QUEM o mod considera inimigo. Sem isso, "inimigo_a_100m" num
			// jogo sem combate ficava sem explicação — era Gaia entrando na lista.
			pudim_Log("WARN", "WORK", result.unplaced.length + " sem alvo: " + amostra +
				" | inimigos=" + (result.enemyList || "nenhum"));
		}
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
/**
 * Orçamento de caminhada, compartilhado por todos os sistemas que mandam uma unidade andar.
 *
 * O problema, medido no replay de 24/08: 65% das reordenações de kite aconteciam em menos de
 * 6 s, mesmo com o kite tendo cooldown de 6 s por unidade. O cooldown funcionava — só não
 * era o único sistema mandando. Kite, fuga do pânico, abrigo e auto-retirada tinham cada um
 * o SEU mapa de controle, e nenhum enxergava o outro. A unidade recebia um walk do kite e
 * 1 s depois um walk da fuga, e cada walk cancela o anterior: ela andava para o primeiro
 * destino por um segundo, virava, e nunca chegava a lugar nenhum.
 *
 * É a mesma classe de erro dos três sistemas de economia empurrando o mesmo trabalhador em
 * direções opostas, e o sintoma na tela é o mesmo que o jogador chama de "bagunçando durante
 * a luta" e "passeio".
 *
 * A solução não pode ser um cooldown único e cego: fugir da morte é mais urgente que
 * reposicionar. Então cada emissor declara uma PRIORIDADE, e a regra é:
 *
 *   - prioridade MAIOR passa na hora, sempre. Salvar a unidade nunca espera.
 *   - prioridade igual ou menor espera PUDIM_ANDAR_MIN_ENTRE desde a última ordem.
 *
 * Os cooldowns próprios de cada sistema continuam existindo e valendo — este aqui só
 * resolve o que nenhum deles podia ver: o outro sistema.
 */
const PUDIM_ANDAR_FUGIR   = 4;  // está prestes a morrer
const PUDIM_ANDAR_ABRIGO  = 3;  // pânico, sem abrigo livre
const PUDIM_ANDAR_RETIRAR = 2;  // vida baixa, indo para o curador
const PUDIM_ANDAR_KITE    = 1;  // reposicionamento tático
const PUDIM_ANDAR_HEROI   = 0;  // ajuste de posição, nunca urgente

// 2,5 s: tempo de sobra para a unidade sair do lugar e o passo anterior valer alguma coisa,
// e curto o bastante para não segurar uma reação real. Abaixo disso o walk novo chega antes
// de o motor terminar de virar a unidade, que é o desperdício que se quer cortar.
const PUDIM_ANDAR_MIN_ENTRE = 2500;

// { id: { em: timestamp, pri: prioridade } }
var g_PudimAndarAt = {};

/**
 * Pode mandar esta unidade andar agora, vindo deste sistema?
 */
function pudim_PodeAndar(id, prioridade, agora)
{
	const ultimo = g_PudimAndarAt[id];
	if (!ultimo)
		return true;
	if (prioridade > ultimo.pri)
		return true;   // urgência maior nunca espera
	return (agora - ultimo.em) >= PUDIM_ANDAR_MIN_ENTRE;
}

/**
 * Registra que a ordem saiu. Chamar SEMPRE que um walk for emitido, senão o próximo
 * sistema não tem como saber que esta unidade acabou de receber destino.
 */
function pudim_RegistrarAndada(id, prioridade, agora)
{
	g_PudimAndarAt[id] = { "em": agora, "pri": prioridade };
}

/**
 * Descarta entradas velhas. Sem isto o mapa cresce por toda a partida com unidades que já
 * morreram — 200 de população numa partida longa vira memória à toa e um vazamento lento.
 */
function pudim_LimparAndadas(agora)
{
	for (const id in g_PudimAndarAt)
		if (agora - g_PudimAndarAt[id].em > 30000)
			delete g_PudimAndarAt[id];
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
	pudim_LimparAndadas(now);
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

/**
 * O que o JOGADOR pos na fila daquele edificio: template e tamanho do lote.
 *
 * Separado de g_PudimAutoQueueTemplates de proposito. Aquele guarda "o ultimo template visto
 * ali", que o proprio mod sobrescreve ao semear — inutil para distinguir escolha sua de
 * escolha dele. Este so e gravado quando o item na fila NAO e o que o mod semeou por ultimo
 * (g_PudimQueueSeededTpl), ou seja, quando so pode ter vindo de voce.
 *
 * Relato de 19/08: o jogador pos 5 guerreiros no centro civico e, quando o lote esvaziou, a
 * auto-fila semeou 2 aldeoes. A escolha de template era refeita do zero a cada semeadura,
 * com preferencia pela aldea, e nada olhava o que estava ali antes. Trocar o TIPO de unidade
 * que voce escolheu nunca pode acontecer.
 */
var g_PudimPlayerQueueTpl = {};
var g_PudimPlayerQueueCount = {};
// Instante da última semeadura por edifício — carência contra semear duas vezes antes de
// o comando anterior (ou uma ordem do jogador) aparecer na fila.
var g_PudimQueueSeededAt = {};
// Template da última semeadura por edifício. Sem ele não há como distinguir um lote do mod
// de uma ordem do jogador — e foi essa confusão que trocou soldados por aldeões.
var g_PudimQueueSeededTpl = {};
var g_PudimUnplacedLogAt = 0; // throttle do log de trabalhadores sem alvo
var g_PudimBalLogAt = 0;      // throttle do retrato de balanceamento
/** Edifícios já avisados por falta de template treinável (evita repetir o log a cada 3s) */
var g_PudimQueueNoTplLogged = {};

/** Edifícios que o Pudim ativou autoqueue — para detectar desativação manual */
var g_PudimAutoQueueManagedByMod = new Set();
/** Edifícios que o usuário desativou manualmente — Pudim não reativa */
var g_PudimAutoQueueUserDisabled = new Set();

/**
 * Quando cada edifício teve a auto-fila desligada. { ent: [timestamps recentes] }
 *
 * Relato de 25/08: "no quartel nao consigo desabilitar o treinamento automatico das
 * unidades, quando coloco, o mod habilita novamente".
 *
 * O mod tentava adivinhar QUEM desligou olhando se havia recursos naquele instante: com
 * recursos, foi o jogador; sem recursos, foi o motor (que desliga sozinho quando não dá para
 * pagar). A heurística é razoável e mesmo assim perde — o estoque oscila o tempo todo, e o
 * jogador que desliga num vale de recursos é lido como o motor e tem a fila religada.
 *
 * Adivinhar quem clicou é impossível: o comando chega igual dos dois. Mas não é preciso
 * adivinhar. O motor desliga UMA vez e volta a funcionar quando há recurso; o jogador que
 * quer a fila desligada desliga DE NOVO. Duas desativações na mesma janela são intenção,
 * não coincidência — e aí a decisão é dele, sem mais discussão.
 */
var g_PudimQueueOffAt = {};
const PUDIM_QUEUE_OFF_JANELA = 30000;   // duas desativações aqui dentro = decisão do jogador
const PUDIM_QUEUE_ESPERA_RELIGAR = 10000; // e o mod nunca religa antes disto
/** Flag para logar uma vez quando o limite de 50 mulheres for atingido */
var g_PudimFemaleCapLogged = false;

/** Acumulador de tempo para verificar construção de fazendas */
var g_PudimFarmAccum = 0;

/**
 * Fazenda em atraso: falta comida e o mod ainda não conseguiu erguer os campos.
 *
 * Pedido de 25/08: "quando acaba as frutas demora pra fazer todas as fazendas, tem sempre
 * que respeitar a proporção... isso é prioridade máxima, a segunda prioridade é construir
 * unidades".
 *
 * Duas consequências, e a segunda é a que não é óbvia:
 *   1. o ciclo de fazendas acelera de 5s para 1,5s enquanto o atraso durar;
 *   2. a auto-fila para de gastar a madeira que os campos precisam.
 *
 * Sem a (2) a (1) não adianta: o mod construiria mais rápido e a auto-fila comeria o
 * estoque antes, e o campo continuaria não saindo. As duas prioridades brigam pelo MESMO
 * recurso, e é por isso que o jogador precisou dizer qual vem primeiro.
 */
var g_PudimFarmUrgente = false;

/** Madeira que os campos pendentes vão consumir. A auto-fila desconta isto do estoque. */
var g_PudimMadeiraReservada = 0;

/** Acumulador de tempo para pesquisa automática de tecnologias */
var g_PudimResearchAccum = 0;

/** IDs de fundações de dropsite conhecidas (para detectar conclusões) */
var g_PudimDropsiteFoundations = {}; // entityId → true
/** Posição de cada fundação rastreada — usada para detectar cancelamento pelo jogador */
var g_PudimDropsiteFoundationPos = {}; // entityId → { x, z }

/** Acumulador de tempo para sistema de fundações de dropsite */
var g_PudimFoundationAccum = 0;

/**
 * Rally pós-obra: para onde o construtor de um dropsite do mod deve ir colher quando a obra
 * acabar. id → { x, z, res, specific, until }.
 *
 * Sem isto, o construtor terminava o armazém e caía no despacho genérico, que o mandava
 * para o recurso de melhor score global — frequentemente a floresta de onde ele tinha vindo,
 * do outro lado da base. O armazém ficava pronto e sem ninguém entregando nele. É o relato
 * de 19/08: "mandou os trabalhadores na floresta sem armazém, daí fez armazém em outra
 * floresta e não mandou os trabalhadores pra essa nova floresta".
 */
/** Throttle do diagnóstico de caminhada longa (ver o log WALK) */
var g_PudimWalkDiagAt = 0;

/** Throttle do log de abrigo (ver o ramo "defendendo" do pânico) */
var g_PudimShelterLogAt = 0;

/** Última ordem de fuga por unidade — evita reemitir walk a cada ciclo (id → ms) */
var g_PudimFleeAt = {};

/** Tropa nossa lutando agora, em qualquer lugar do mapa (vem de pudim_GetPanicData) */
var g_PudimEmCombate = false;
/** Para a linha de log da trava sair uma vez por batalha, não a cada tique */
var g_PudimHoldCombateLogged = false;

var g_PudimDropsiteRally = {};
/** Janela de validade do rally. Acima disso a âncora provavelmente já não faz sentido. */
const PUDIM_RALLY_WINDOW = 180000;

/**
 * Subtipo real por recurso, exigido por UnitAI: o estado FINDINGNEWTARGET da ordem
 * GatherNearPosition filtra o próximo alvo com `type.specific == resourceType.specific`
 * (UnitAI.js). Mandar só { generic } deixa specific === undefined, nada casa e a unidade
 * para depois do primeiro alvo. Nomes conferidos em simulation/data/resources/*.json.
 */
const PUDIM_RES_SPECIFIC = { "wood": "tree", "food": "fruit", "stone": "rock", "metal": "ore" };

/**
 * Registra que estes construtores devem colher na âncora QUANDO A OBRA ACABAR.
 * bx/bz é onde a fundação foi colocada — é o que segura o rally até ela sair do chão.
 */
function pudim_SetRally(ids, x, z, res, bx, bz) {
	if (x === undefined || x === null || z === undefined || z === null || !res) return;
	const until = Date.now() + PUDIM_RALLY_WINDOW;
	const spec = PUDIM_RES_SPECIFIC[res] || "";
	for (const id of ids)
		g_PudimDropsiteRally[id] = { x: x, z: z, res: res, specific: spec, until: until,
		                             bx: bx, bz: bz };
}

/**
 * Ainda existe fundação do mod de pé em (bx,bz)? Enquanto houver, o rally espera.
 *
 * "Apos a obra" era medido por OCIOSIDADE do construtor, e um construtor pode aparecer
 * ocioso por um instante sem a obra ter andado — ordem que não pegou, caminho recalculado,
 * o intervalo entre chegar e começar a martelar. Bastava esse instante para o rally
 * arrancá-lo da fundação, e o auto-work devolvia outro no ciclo seguinte: o vaivém sobre
 * o celeiro relatado em 19/08, com a comida caindo a zero enquanto a obra de (661,816)
 * passava 79s sem sair com 4 construtores.
 *
 * Agora quem manda é a fundação: enquanto ela estiver na lista rastreada, o rally segura.
 * 10m de tolerância porque a posição gravada é a do comando, e a fundação assenta na
 * grade de construção.
 */
function pudim_RallyObraPendente(r) {
	if (!r || r.bx === undefined || r.bx === null) return false;
	for (const fid in g_PudimDropsiteFoundationPos) {
		const p = g_PudimDropsiteFoundationPos[fid];
		if (!p) continue;
		const dx = p.x - r.bx, dz = p.z - r.bz;
		if (dx * dx + dz * dz <= 100) return true;
	}
	return false;
}

/**
 * Tira dos ociosos quem tem rally pendente e manda colher na âncora do dropsite que acabou
 * de erguer, em vez de devolvê-los ao despacho genérico. Retorna { id: true } dos resolvidos.
 */
function pudim_ApplyRally(idleList) {
	const now = Date.now();
	for (const id in g_PudimDropsiteRally)
		if (now > g_PudimDropsiteRally[id].until) delete g_PudimDropsiteRally[id];

	const groups = {}, taken = {};
	for (const w of idleList) {
		const r = g_PudimDropsiteRally[w.id];
		if (!r) continue;
		if (pudim_RallyObraPendente(r)) continue; // obra de pé: ninguém sai daqui ainda
		const k = Math.round(r.x) + "," + Math.round(r.z) + "," + r.res;
		if (!groups[k]) groups[k] = { x: r.x, z: r.z, res: r.res, specific: r.specific, ids: [] };
		groups[k].ids.push(w.id);
		taken[w.id] = true;
		delete g_PudimDropsiteRally[w.id];
	}
	for (const k in groups) {
		const g = groups[k];
		Engine.PostNetworkCommand({
			"type": "gather-near-position",
			"entities": g.ids,
			"resourceType": { "generic": g.res, "specific": g.specific },
			"resourceTemplate": "",
			"x": g.x, "z": g.z,
			"queued": false
		});
		pudim_Log("INFO", "DROP", "rally " + g.ids.length + " worker(s) p/ " + g.res +
			" em (" + g.x.toFixed(0) + "," + g.z.toFixed(0) + ") apos a obra");
	}
	return taken;
}

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

	// Herói na aura: a cada 1.2s. Mais lento que o kite de propósito — a posição dele muda
	// devagar (a luta é que se move), e ordem repetida cancelaria a caminhada anterior.
	g_PudimHeroAccum += dt;
	if (g_PudimHeroAccum >= 1200 && g_PudimCombatAssistsEnabled)
	{
		g_PudimHeroAccum = 0;
		pudim_ProcessHeroAura();
	}

	// Lista de unidades treinaveis: a cada 1,5s.
	//
	// O intervalo era 4s, justificado assim: "ela muda quando um edificio de producao sobe
	// ou quando a fase avanca, e nenhum dos dois e frequente". O raciocinio olhava so para a
	// COMPOSICAO da lista — e essa parte estava certa. O que ele ignorava e que a mesma
	// leitura traz `existentes` e `emFila`, e ESSES mudam a toda hora: cada unidade que
	// nasce e, principalmente, cada uma que MORRE em batalha altera a proporcao real.
	// Decidir o que treinar com contagem de 4s atras significa, no meio de uma briga,
	// insistir em reforcar o tipo que acabou de ser dizimado ja estar coberto.
	g_PudimUnitAccum += dt;
	if (g_PudimUnitAccum >= 1500)
	{
		g_PudimUnitAccum = 0;
		try { pudim_AtualizarUnidades(); } catch(e) {}
	}

	// Série de quartéis/estábulos: a cada 1s; o freio real é PUDIM_QUARTEL_INTERVALO.
	g_PudimQuartelAccum += dt;
	if (g_PudimQuartelAccum >= 1000)
	{
		g_PudimQuartelAccum = 0;
		pudim_ProcessQuartel();
		try { pudim_ProcessPalicada(); } catch (e) { pudim_Log("ERROR", "PALICADA", "" + e); }
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
		// 5s quando esta tudo em ordem; 1,5s enquanto falta comida.
		//
		// "isso e prioridade maxima" — pedido do jogador. Com a fruta esgotada, cada ciclo
		// perdido e capacidade de comida que nao sobe, enquanto o auto-trabalho (500ms)
		// segue mandando gente para a madeira por falta de vaga em comida.
		if (g_PudimFarmAccum >= (g_PudimFarmUrgente ? 1500 : 5000))
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
	// SEM TEMPLATE, NAO PERGUNTA. GetTemplateData desce ate o motor
	// (GuiInterface.js:647), e la a conversao de argumento falha com "v.isString() ||
	// v.isNumber() || v.isBoolean() (got type undefined)". O try/catch daqui NAO evita
	// isso: o motor registra o erro antes de a excecao chegar ao JS, entao a tela do
	// jogador enche de rastro vermelho a cada tique mesmo com a excecao tratada.
	if (!template) return desiredCount;
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
		// SEGUNDA PRIORIDADE. A madeira que os campos pendentes vão consumir sai da conta
		// antes de a auto-fila decidir se pode pagar uma unidade. Sem isso as duas
		// prioridades disputam o mesmo estoque e a que roda mais vezes por segundo ganha —
		// que é a auto-fila, não a fazenda.
		const resBruto = aqData.resources || {};
		const res = {};
		for (const k in resBruto) res[k] = resBruto[k];
		if (g_PudimMadeiraReservada > 0) {
			res.wood = Math.max(0, (+res.wood || 0) - g_PudimMadeiraReservada);
			if (g_PudimShowDebug && res.wood === 0)
				pudim_Log("DEBUG", "QUEUE", "treino em espera: " + g_PudimMadeiraReservada +
					" de madeira reservados para campos de comida");
		}
		// No teto de população o motor recusa ligar a auto-fila e imprime
		// "Não foi possível definir auto-fila para a unidade, desativando" em cima da tela.
		// Insistir a cada 3s só produz spam: a fila volta sozinha quando abrir vaga.
		const popCheio = (aqData.popMax || 0) > 0 && (aqData.popCount || 0) >= aqData.popMax;

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
					// Lote que NAO e o que o mod semeou por ultimo so pode ter vindo do
					// jogador. Guardar tipo e tamanho: a partir daqui a auto-fila repoe
					// exatamente isso neste edificio, e nunca mais escolhe o tipo sozinha.
					if (qItem.unitTemplate !== g_PudimQueueSeededTpl[b.ent]) {
						if (g_PudimPlayerQueueTpl[b.ent] !== qItem.unitTemplate) {
							g_PudimPlayerQueueTpl[b.ent] = qItem.unitTemplate;
							pudim_Log("INFO", "QUEUE", "edificio " + b.ent + " passa a repor " +
								qItem.unitTemplate.split("/").pop() + " (escolha do jogador)");
						}
						// So conta como tamanho escolhido enquanto o lote esta fresco: o motor
						// decrementa count a cada unidade nascida (this.count--), entao um lote
						// de 5 ja com 3 prontas mostra 2.
						if ((qItem.progress || 0) < 0.15) {
							const obs = qItem.count || 1;
							if (obs > (g_PudimPlayerQueueCount[b.ent] || 0))
								g_PudimPlayerQueueCount[b.ent] = obs;
						}
					}
				}
			}
		}

		// Detectar desativações manuais e ativar apenas novos edifícios
		const toEnable = [];
		for (const b of buildings) {
			if (!b.autoqueue) {
				if (b.alwaysQueue) {
					// Barracks/CC: sempre reativar, independente da causa da desativação —
					// menos no teto de população ou sem recurso para uma unidade sequer, onde
					// o motor recusa e o único efeito é a mensagem de erro na tela.
					const tplCheck = g_PudimPlayerQueueTpl[b.ent] || g_PudimAutoQueueTemplates[b.ent];
					const podePagar = tplCheck ? pudim_ComputeAffordableCount(tplCheck, 1, res) >= 1 : true;
					if (popCheio || !podePagar) continue;
					// Nunca religa logo depois de ter sido desligado: dá tempo de o jogador
					// desligar de novo e o mod entender que é decisão dele.
					const ultimoOff = (g_PudimQueueOffAt[b.ent] || []).slice(-1)[0] || 0;
					if (Date.now() - ultimoOff < PUDIM_QUEUE_ESPERA_RELIGAR) continue;
					toEnable.push(b.ent);
					g_PudimAutoQueueManagedByMod.add(b.ent);
					g_PudimAutoQueueUserDisabled.delete(b.ent);
				} else if (g_PudimAutoQueueManagedByMod.has(b.ent) && !g_PudimAutoQueueUserDisabled.has(b.ent)) {
					// Pudim tinha ativado, agora está off. Só é o USUÁRIO se havia recursos
					// suficientes pro template — senão é o bug nativo do motor (falta de
					// recursos/limite de treino) desligando sozinho: reativa sem penalizar.
					const agoraQ = Date.now();
					const historico = (g_PudimQueueOffAt[b.ent] || [])
						.filter(t => agoraQ - t < PUDIM_QUEUE_OFF_JANELA);
					historico.push(agoraQ);
					g_PudimQueueOffAt[b.ent] = historico;

					if (historico.length >= 2) {
						// Desligou de novo dentro da janela: é decisão, não escassez.
						g_PudimAutoQueueUserDisabled.add(b.ent);
						pudim_Log("INFO", "QUEUE", "edifício " + b.ent +
							" desativado pelo usuário (2ª vez em " +
							(PUDIM_QUEUE_OFF_JANELA / 1000) + "s) — o mod não religa mais");
					} else {
						const cachedTpl = g_PudimAutoQueueTemplates[b.ent];
						const affordableNow = cachedTpl ? pudim_ComputeAffordableCount(cachedTpl, 1, res) : 1;
						if (affordableNow >= 1) {
							// Havia recurso: o motor não tinha motivo para desligar, então foi
							// o jogador. Isto sozinho já resolve o caso comum, na primeira vez.
							g_PudimAutoQueueUserDisabled.add(b.ent);
							pudim_Log("INFO", "QUEUE", "edifício " + b.ent + " desativado pelo usuário");
						}
						// Sem recurso: provavelmente foi o motor. Mesmo assim NÃO religa agora —
						// religar no mesmo tique é o que atropelava o clique do jogador. Espera,
						// e se ele desligar de novo nesse meio-tempo, o ramo acima decide.
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

			// CC: padrão 3; barracks: padrão 1; demais: 1. O tamanho que o JOGADOR usou vem
			// na frente de tudo: ele pos 5, repoe 5. (Quanto disso cabe no estoque ainda e
			// decidido por pudim_ComputeAffordableCount logo abaixo — "faz o que da e depois
			// volta ao normal" continua valendo para a QUANTIDADE; o que nunca muda e o TIPO.)
			const defaultCount = b.isCC ? 3 : 1;
			// COM PROPORÇÃO CONFIGURADA, o lote manda; com tudo zerado, nada muda.
			//
			// "se estiver tudo zerado essa parte não faz nada, mas respeita o sistema atual
			// de auto fila... se não estiver zerado esse sistema se sobrepõe o auto fila".
			// Mexer no tamanho do lote sem o jogador ter pedido nada seria mudar o
			// comportamento dele sem aviso — por isso a chave é a proporção estar ativa.
			//
			// O que ele pôs na fila DAQUELE edifício continua vindo antes de tudo: essa
			// regra já custou caro quando 5 guerreiros voltavam como 2 aldeões.
			let desiredCount = g_PudimPlayerQueueCount[b.ent] ||
			                   g_PudimAutoQueueDesiredCount[b.ent] || defaultCount;
			// So dimensiona quando ja se sabe O QUE aquele edificio vai treinar. Com a
			// proporcao ligada este trecho passa a rodar para TODO edificio de producao —
			// e a lista inclui casa, armazem e celeiro, que tem IID_ProductionQueue por
			// causa de tecnologia e nunca terao template. Era dali que saia o undefined.
			const tplLote = g_PudimPlayerQueueTpl[b.ent] || g_PudimAutoQueueTemplates[b.ent];
			if (tplLote && !g_PudimPlayerQueueCount[b.ent] && pudim_ProporcaoAtiva())
				desiredCount = pudim_LoteIdeal(tplLote, res, buildings);

			// ── PROPORCAO COM A FILA CHEIA ──────────────────────────────────────────
			//
			// "ainda continua fazendo so mulheres", pela terceira vez. As duas tentativas
			// anteriores erraram o lugar:
			//
			//   1a — liguei a proporcao no caminho da SEMEADURA, que so roda com fila vazia.
			//        A fila nunca esvaziava.
			//   2a — liguei na troca de lote, que e guardada por `trainingQueue.length === 1`.
			//        A fila do centro civico tinha QUINZE lotes.
			//
			// A fila cheia e o caso normal, nao a excecao: a auto-fila nativa do motor repoe
			// sozinha. Entao a proporcao precisa de um caminho que funcione COM ela cheia, e
			// esse caminho e cancelar o que ainda nao comecou.
			//
			// A trava continua sendo a mesma de sempre, e e o que separa isto de atropelar o
			// jogador: so cancela lote cujo template bate com a ULTIMA SEMEADURA DO PROPRIO
			// MOD. Lote de outro tipo e ordem dele e nao se toca; lote que ja comecou tambem
			// nao, porque cancelar jogaria fora o tempo investido (sem progresso, o
			// cancelamento devolve os recursos e a troca sai de graca).
			if (pudim_ProporcaoAtiva() && b.trainingQueue && b.trainingQueue.length) {
				const seededTpl = g_PudimQueueSeededTpl[b.ent];
				// Quantos deste tipo estao na fila SEM ter comecado — sao exatamente os que
				// seriam cancelados, e por isso sao os que saem da conta da proporcao.
				let naFila = 0;
				if (seededTpl)
					for (const item of b.trainingQueue)
						if (item.unitTemplate === seededTpl && (item.progress || 0) <= 0)
							naFila += item.count || 1;
				const alvo = seededTpl && naFila
					? pudim_ProporcaoTrocaria(b.trainerEntities || [], seededTpl, naFila) : null;
				if (alvo && !(atFemaleCap && isFemaleTemplate(alvo.tpl)))
				{
					let cancelados = 0;
					for (const item of b.trainingQueue) {
						if (item.unitTemplate !== seededTpl) continue;   // do jogador
						if ((item.progress || 0) > 0) continue;          // ja comecou
						if (item.id === undefined) continue;
						Engine.PostNetworkCommand({ "type": "stop-production",
							"entity": b.ent, "id": item.id });
						cancelados++;
					}
					if (cancelados > 0) {
						// A semeadura passa a ser o alvo: no ciclo seguinte a fila estara
						// vazia e o caminho normal repoe com a unidade certa.
						g_PudimQueueSeededTpl[b.ent] = alvo.tpl;
						pudim_Log("INFO", "QUEUE", "edifício " + b.ent + ": " + cancelados +
							" lote(s) de " + seededTpl.split("/").pop() +
							" cancelado(s) para " + alvo.tpl.split("/").pop() +
							" (proporção de unidades)");
						continue;
					}
				}
			}

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

					// A PROPORÇÃO TAMBÉM TROCA O TIPO, e não só o tamanho.
					//
					// Relato do jogador: ele pôs peso no escaramuçador e o centro cívico
					// continuou fazendo mulheres. A causa: a auto-fila só SEMEIA fila vazia, e
					// a fila nunca esvaziava — a auto-fila nativa do motor (autoqueue-on)
					// repete o lote indefinidamente. A proporção era consultada num ponto que
					// nunca era alcançado.
					//
					// Trocar o tipo aqui resolve, e a trava que já existia continua sendo a
					// certa: só se o lote for RECONHECIDAMENTE do mod (mesmo template da última
					// semeadura dele) e ainda não tiver começado. Lote do jogador não se toca —
					// é a mesma regra que impediu 5 guerreiros de voltarem como 2 aldeões, e
					// configurar proporção não é motivo para reabri-la.
					let tplDesejado = null;
					if (isOurs && pudim_ProporcaoAtiva()) {
						const alvo = pudim_ProporcaoTrocaria(b.trainerEntities || [],
							cur.unitTemplate, cur.count || 1);
						if (alvo && !(atFemaleCap && isFemaleTemplate(alvo.tpl)))
							tplDesejado = alvo.tpl;
					}

					if (isOurs && (cur.progress || 0) <= 0 && tplDesejado) {
						const affordable = pudim_ComputeAffordableCount(tplDesejado, desiredCount, res);
						const lote = Math.max(1, Math.min(desiredCount, affordable));
						if (cur.id !== undefined && affordable >= 1) {
							Engine.PostNetworkCommand({ "type": "stop-production", "entity": b.ent, "id": cur.id });
							Engine.PostNetworkCommand({ "type": "train", "entities": [b.ent],
								"template": tplDesejado, "count": lote });
							g_PudimQueueSeededTpl[b.ent] = tplDesejado;
							g_PudimQueueSeededAt[b.ent] = nowQueue;
							pudim_Log("INFO", "QUEUE", "edifício " + b.ent + " trocado para " +
								tplDesejado.split("/").pop() + " x" + lote + " (proporção de unidades)");
						}
						continue;
					}

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

			// A escolha do jogador manda, sempre. Se ele pos alguma coisa na fila deste
			// edificio, a auto-fila repoe EXATAMENTE aquilo — sem preferencia por aldea e sem
			// a troca do limite de 50 mulheres. O mod so escolhe o tipo quando voce nunca
			// escolheu nada ali.
			let template = g_PudimPlayerQueueTpl[b.ent] || null;
			const doJogador = !!template;

			// A PROPORCAO DE UNIDADES entra aqui, e so aqui.
			//
			// Ordem: escolha do jogador naquele edificio > proporcao que ele configurou >
			// o palpite antigo. Nunca por cima do que ele pos na fila — essa regra ja custou
			// caro uma vez, quando 5 guerreiros voltavam como 2 aldeoes.
			//
			// A unidade escolhida tem de ser treinavel NESTE edificio: pedir cavalaria num
			// quartel faria o motor recusar em silencio, e a fila ficaria parada sem motivo
			// visivel.
			if (!template) {
				const atrasada = pudim_UnidadeMaisAtrasada(b.trainerEntities || [],
					g_PudimQueueSeededTpl[b.ent]);
				if (atrasada && !(atFemaleCap && isFemaleTemplate(atrasada.tpl))) {
					template = atrasada.tpl;
					g_PudimAutoQueueTemplates[b.ent] = template;
				}
				pudim_ProporcaoDiag(b, atrasada);
			}

			if (!template) {
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
				template.split("/").pop() + (doJogador ? " (escolha do jogador)" : "") +
				" qlen=" + ((b.trainingQueue && b.trainingQueue.length) || 0) +
				(g_PudimShowDebug ? " | " + pudim_LoteDiag(template, res, buildings) : ""));
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
// Techs que falharam a entrar na fila após 90s → { tech: instante em que pode tentar de novo }.
//
// Era uma lista PERMANENTE na sessão, e isso custava caro: a razão mais comum de uma
// pesquisa não entrar na fila é falta de recurso naquele instante, não impossibilidade.
// No log de 14/08, com a comida oscilando entre 37 e 74, o mod baniu para sempre
// gather_capacity_basket, gather_capacity_wheelbarrow e gather_farming_plows — as três
// tecnologias que justamente melhorariam a coleta. Banir a cura da doença.
// Agora é uma quarentena de 3 minutos: preserva o objetivo original (não ficar reenviando
// a mesma pesquisa em loop) sem perder a tecnologia quando o estoque se recupera.
var g_PudimResearchBlacklist = {};
const PUDIM_RESEARCH_RETRY = 180000;
/** Ultima tentativa de envio por tech (anti-rajada; ver pudim_ProcessAutoResearch) */
var g_PudimResearchLastTry = {};
const PUDIM_RESEARCH_RESEND_MIN = 30000;

function pudim_ProcessAutoResearch()
{
	try {
		const now = Date.now();
		// Detectar pesquisas enviadas há >90s que nunca apareceram na fila → blacklist
		const sentKeys = Object.keys(g_PudimResearchSentAt);
		for (const tech of sentKeys) {
			if (now - g_PudimResearchSentAt[tech] > 90000) {
				g_PudimResearchBlacklist[tech] = now + PUDIM_RESEARCH_RETRY;
				delete g_PudimResearchSentAt[tech];
				pudim_Log("WARN", "RESEARCH", "quarentena 3min: " + tech + " (nao entrou na fila em 90s)");
			}
		}

		// Só as quarentenas ainda ativas vão para a simulação; as vencidas são descartadas
		// aqui e a tecnologia volta a ser candidata.
		const blacklistAtiva = [];
		for (const tech in g_PudimResearchBlacklist) {
			if (now < g_PudimResearchBlacklist[tech]) blacklistAtiva.push(tech);
			else delete g_PudimResearchBlacklist[tech];
		}

		const researchData = Engine.GuiInterfaceCall("pudim_GetAutoResearchData", {
			blacklist: blacklistAtiva,
			sentTechs: sentKeys,
			// Prioridades de coleta: recurso com peso > 0 e recurso que voce quer, entao a
			// tech que acelera a coleta dele deixa de esperar a Fase 2.
			weights: g_PudimResourceWeights
		});
		if (!researchData) return;

		// Confirmar pesquisas que agora estão na fila ou concluídas
		for (const tech of (researchData.confirmed || [])) {
			if (g_PudimResearchSentAt[tech]) delete g_PudimResearchSentAt[tech];
		}

		if (!researchData.research || researchData.research.length === 0) return;
		for (const item of researchData.research) {
			// Nao repetir a mesma tech em rajada: se ja tentamos ha menos de
			// PUDIM_RESEARCH_RESEND_MIN, espera. Sem isto o ciclo de 15s reenviava a mesma
			// pesquisa dezenas de vezes enquanto ela nao entrasse na fila.
			const lastTry = g_PudimResearchLastTry[item.tech] || 0;
			if (now - lastTry < PUDIM_RESEARCH_RESEND_MIN) continue;
			Engine.PostNetworkCommand({
				"type": "research",
				"template": item.tech,
				"entity": item.building,
				"metadata": null
			});
			// NAO sobrescrever se ja existe: este carimbo marca a PRIMEIRA tentativa e e o
			// que alimenta o detector de 90s que poe a tech em quarentena. Como a auto-
			// pesquisa roda a cada 15s, regravar aqui renovava o relogio a cada ciclo e a
			// quarentena NUNCA disparava: no replay 2026-08-18_0007 o mod enviou
			// gather_capacity_carts 98 vezes (451 comandos de research no total) porque a
			// tech nunca entrava na fila e era reenviada indefinidamente.
			if (!g_PudimResearchSentAt[item.tech])
				g_PudimResearchSentAt[item.tech] = now;
			g_PudimResearchLastTry[item.tech] = now;
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
			// A simulacao precisa das POSICOES para distinguir obra concluida de obra
			// apagada: a fundacao e SUBSTITUIDA por uma entidade nova ao terminar, entao o
			// id sozinho nao diz nada. Ver o comentario no Passo 2 daquela funcao.
			prevFoundationPos: g_PudimDropsiteFoundationPos,
			modBuiltPositions: g_PudimModBuiltPositions,
			protectedIds: pudim_GetProtectedBuilderIds(),
			// separado de protectedIds: estes são liberados assim que ficarem ociosos
			playerOrdered: pudim_GetPlayerOrderedIds()
		});
		if (!data) return;

		// Fundação que sumiu sem virar prédio tem DOIS motivos possíveis, e tratá-los igual
		// custou caro. Se havia obra feita (progress > 0), foi o jogador que cancelou:
		// decisão explícita, o local fica banido. Se o progresso era ZERO, ela apenas
		// decaiu — nenhum construtor chegou a encostar — e a culpa é do mod, não do jogador.
		//
		// No log de 15:52 os dois armazéns que o mod ergueu sumiram assim, ~38s depois de
		// colocados, sem combate nenhum. Cada um baniu o próprio ponto PARA SEMPRE, e os
		// lenhadores seguiram cortando sem depósito por perto até o detector de long-walker
		// mandá-los para outra floresta — a viagem inteira desperdiçada.
		//
		// Decaimento agora é quarentena curta: o mod tenta de novo, de preferência com
		// construtor que chegue lá.
		// completions cobre so dropsite; concluidas cobre TODA obra que virou predio. Sem a
		// segunda, casa e campo concluidos eram lidos como apagados pelo jogador.
		const completedIds = new Set((data.completions || []).map(c => c.id));
		for (const id of (data.concluidas || [])) completedIds.add(id);
		const stillFoundation = new Set((data.foundations || []).map(f => f.id));
		for (const oldId in g_PudimDropsiteFoundations) {
			const idNum = +oldId;
			if (stillFoundation.has(idNum) || completedIds.has(idNum)) continue;
			const pos = g_PudimDropsiteFoundationPos[idNum];
			if (pos) {
				if ((g_PudimFoundationProgress[idNum] || 0) > 0) {
					pudim_Log("INFO", "OBRA", "jogador apagou " + (pos.classe || "obra") +
						" em (" + pos.x.toFixed(0) + "," + pos.z.toFixed(0) + ")");
					pudim_MarkCancelled(pos.x, pos.z);
				}
				else {
					g_PudimDecayedSpots.push({ x: pos.x, z: pos.z, until: Date.now() + 90000 });
					pudim_Log("WARN", "DROP", "fundação em (" + pos.x.toFixed(0) + "," + pos.z.toFixed(0) +
						") decaiu sem nenhum construtor — quarentena 90s, nao foi o jogador");
				}
			}
			delete g_PudimDropsiteFoundationPos[idNum];
			delete g_PudimFoundationProgress[idNum];
		}

		// Atualizar rastreamento de fundações (id, posição e progresso — o progresso é o que
		// permite classificar o sumiço no ciclo seguinte)
		g_PudimDropsiteFoundations = {};
		for (const f of (data.foundations || [])) {
			g_PudimDropsiteFoundations[f.id] = true;
			g_PudimDropsiteFoundationPos[f.id] = { x: f.x, z: f.z, classe: f.classe };
			g_PudimFoundationProgress[f.id] = f.progress || 0;
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
		// builderOrigin: mesma memória de função usada pelo auto-work. Sem ela, quem está
		// construindo some do censo de comida deste sistema e o déficit vira fantasma.
		// A RESERVA ZERA ANTES DE QUALQUER SAIDA CEDO.
		//
		// Ela e recalculada la embaixo, depois de a simulacao responder. Toda saida daqui
		// para cima deixava o valor ANTIGO de pe — e como a auto-fila desconta a reserva do
		// estoque antes de decidir o tamanho do lote, uma reserva velha de 200 ou 300 de
		// madeira estrangula o treino para sempre, sem nada na tela dizendo por que.
		g_PudimMadeiraReservada = 0;
		g_PudimFarmUrgente = false;

		if (pudim_ObrasPausadas()) return;
		const farmData = Engine.GuiInterfaceCall("pudim_GetFarmBuildData",
			{ "weights": g_PudimResourceWeights, "builderOrigin": g_PudimGathererRes });
		if (!farmData) return;

		// Log de diagnóstico a cada 30s (throttled)
		if (Date.now() - g_PudimFarmDebugLastLog > 30000) {
			g_PudimFarmDebugLastLog = Date.now();
			const d = farmData._dbg || {};
			pudim_Log("DEBUG", "FARM", "fc=" + (d.fc||0) + " nfc=" + (d.nfc||0) +
				" ncap=" + (d.ncap||0) + " tg=" + (d.tg||0) + " oci0=" + (d.oci0||0) +
				" sold=" + (d.sold||0) +
				" esc=" + ["food","wood","stone","metal"]
					.filter(r => d["esc_" + r] !== undefined)
					.map(r => r[0] + (d["esc_" + r])).join("/") +
				" cfm=" + (d.cfm||0) +
				" fwt=" + (d.fwt||0) + " df=" + (d.df||0) + " wp=" + (d.wp||0) + " ocio=" + (d.ocio||0) + " vagas=" + (d.vagas||0) + " pag=" + (farmData.camposPagaveis||0) +
				" fmc=" + (d.fmc||0) + " tffs=" + (d.tffs||0) +
				// trn = unidades em produção; edf = déficit já descontado delas. Juntos
				// mostram quando a trava de "espera nascer" está segurando o remanejamento.
				" trn=" + (d.trn||0) + " edf=" + (d.edf||0) +
				" reason=" + (d.reason||"?") + " action=" + farmData.action);
		}

		// ── Fundação de campo em aberto: todo mundo termina ela antes de abrir outra ─────
		// Uma fazenda comporta 5 trabalhadores. Abrir uma nova a cada ciclo, com o punhado de
		// gente livre do momento, deixava 3 campos simultâneos com 1 construtor em cada:
		// pagava a madeira das três de uma vez e nenhuma ficava pronta.
		if (farmData.action === "assist" && farmData.assistTarget) {
			const helpers = (farmData.workersToRedirect || []).filter(w => !g_PudimRepeatBuilding[w]);
			if (helpers.length > 0) {
				Engine.PostNetworkCommand({ "type": "repair", "entities": helpers,
					"target": farmData.assistTarget, "autocontinue": true, "queued": false });
				pudim_Log("INFO", "FARM", "fundacao " + farmData.assistTarget +
					" recebeu " + helpers.length + " construtor(es) — nenhum campo novo neste ciclo");
			}
			return;
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
				"resourceType": { "generic": "wood", "specific": PUDIM_RES_SPECIFIC["wood"] },
				"resourceTemplate": "",
				"queued": false
			});
			pudim_Log("INFO", "FARM", "soldado " + ev.soldierId + " → madeira (vaga p/ aldeão na fazenda " + ev.farmId + ")");
		}

		// Atraso de comida: quantos trabalhadores a cota pede a mais do que existe.
		// edf é o déficit já descontado de quem está nascendo — se ele é positivo, há campo
		// para erguer e a comida está atrás da proporção.
		const atraso = (farmData._dbg && farmData._dbg.edf) || 0;
		g_PudimFarmUrgente = atraso > 0;
		// Cada campo comporta 5 e custa 100 de madeira. Reservar só o que ainda falta erguer
		// evita a auto-fila gastar o estoque antes do campo.
		g_PudimMadeiraReservada = g_PudimFarmUrgente
			? Math.ceil(atraso / 5) * 100 : 0;

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

			// A madeira e o unico limite, e ela e conferida a cada campo: o estoque cai
			// 100 por fundacao colocada, e colocar mais do que o estoque paga so faria o
			// motor recusar em silencio.
			if (farmsBuilt >= (farmData.camposPagaveis || 0)) {
				pudim_Log("INFO", "FARM", "parou em " + farmsBuilt +
					" campo(s): madeira acabou — o resto sai assim que tiver");
				break;
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
			// playerOrdered vai junto: sem ele o foco de fogo passava por cima de ordem
			// manual. Foi o relato de 24/08 — cavalaria atravessando o mapa para um ataque
			// furtivo parava sozinha para atacar quem estava no caminho, porque o comando
			// sai com queued:false e cancela a caminhada.
			const focusData = Engine.GuiInterfaceCall("pudim_GetFocusFireCorrections",
				{ "fixed": g_PudimFocusFixed, "playerOrdered": pudim_GetPlayerOrderedIds() });
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
	// Apagar uma obra do mod pausa TODAS as obras por 10s — ver PUDIM_PAUSA_APOS_APAGAR.
	if (g_PudimAutoHouseThreshold > 0 && !pudim_ObrasPausadas() &&
	    nowTimer - g_LastAutoHouseCheck > 3000) {
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
					// rotas/limpos: quantos corredores de coleta existiam e quantos lugares
					// ficavam fora deles. limpos=0 significa que a casa POUSOU num corredor
					// por falta de alternativa — é o sinal de que a base ficou apertada.
					pudim_Log("SUCCESS", "CASAS", "rotas=" + (houseData.rotasEvitadas||0) +
						" limpos=" + (houseData.candidatosLimpos||0) +
						" build em (" + foundPos.x.toFixed(0) + "," + foundPos.z.toFixed(0) +
						") builders=" + houseBuilderIds.length + walkTxt +
						" de=" + (houseData.fromRes || "-"));
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
	if (g_PudimAdvancedAIEnabled["dropsites"] && !pudim_ObrasPausadas() &&
	    _nowDrop - g_PudimLastDropsiteTime > 5000) {
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
						// Sem esta proteção o auto-work reassumia os construtores no ciclo
						// seguinte e a fundação decaía sem ninguém — foi o armazém de
						// (484,409) no log de 15:52, colocado com 2 construtores e sumido 40s
						// depois. Solta sozinha quando eles ficam ociosos.
						const _dsProt = Date.now() + 30000;
						for (const b of allBuilders) pudim_ProtectBuilder(b, _dsProt);
						// Todo mundo que veio erguer este armazém fica colhendo AQUI quando a
						// obra acabar. A âncora é a mata que justificou a obra (anchorX/Z do
						// lado da simulação); se ela não vier, a própria posição do prédio
						// serve — está, por construção, colada ao recurso.
						pudim_SetRally(allBuilders,
							dropsiteData.anchorX !== undefined ? dropsiteData.anchorX : foundX,
							dropsiteData.anchorZ !== undefined ? dropsiteData.anchorZ : foundZ,
							resKey, foundX, foundZ);
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
							// specific é obrigatório: FINDINGNEWTARGET (UnitAI.js) escolhe o
							// próximo alvo com `type.specific == resourceType.specific`. Sem
							// ele o coletor esvaziava uma árvore e parava.
							"resourceType": { "generic": resKey, "specific": PUDIM_RES_SPECIFIC[resKey] || "" },
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
					"resourceType": { "generic": redirect.resource, "specific": PUDIM_RES_SPECIFIC[redirect.resource] || "" },
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
			const retreatData = Engine.GuiInterfaceCall("pudim_GetAutoRetreatData",
				{ "retreating": g_PudimRetreating, "playerOrdered": pudim_GetPlayerOrderedIds() });
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
					} else if (pudim_PodeAndar(action.unitId, PUDIM_ANDAR_RETIRAR, Date.now())) {
						Engine.PostNetworkCommand({
							"type": "walk",
							"entities": [action.unitId],
							"x": action.targetX,
							"z": action.targetZ,
							"queued": true
						});
						pudim_RegistrarAndada(action.unitId, PUDIM_ANDAR_RETIRAR, Date.now());
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
var g_PudimBalanceUltimaLinha = "";   // ver pudim_ExecuteInitialBalance: log so quando muda
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

	// SO QUANDO MUDA. Esta linha rodava a cada tique do balanceamento inicial: no log da
	// partida nomad de 01/09 foram 386 entradas IDENTICAS ("fc=0 sol=0 cav=0...") em 7,7
	// segundos, e elas ocuparam o log inteiro — as 389 entradas da sessao eram 387 destas
	// mais duas. O diagnostico de qualquer outra coisa ficou impossivel.
	//
	// Log que se repete identico nao informa nada na segunda vez, e a partir da centesima
	// atrapalha ativamente. Guardar a ultima e so registrar mudanca mantem o sinal (a
	// transicao de fc=0 para fc=4 e o que importa) e devolve o log ao resto do mod.
	const balAssinatura = "fc=" + data.femaleCitizens.length + " sol=" + data.soldiers.length +
		" cav=" + (data.cavalry||0) + " berry=" + (data.berryBush||0) +
		" tree=" + (data.tree||0) + " chicken=" + (data.chicken||0);
	if (balAssinatura !== g_PudimBalanceUltimaLinha) {
		g_PudimBalanceUltimaLinha = balAssinatura;
		pudim_Log("DEBUG", "BALANCE", balAssinatura);
	}

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
/**
 * Seleciona todos os guerreiros do jogador.
 *
 * Pedido de 31/08: "adicionar um botão no pudim mod, pra selecionar todos os guerreiros
 * (tudo que não for aldeão e do mercado)".
 *
 * Quem monta a lista e a simulacao (pudim_GetGuerreiros), porque so ela enxerga as classes
 * de cada entidade. Quem seleciona e este lado, e selecao NAO passa pela rede: g_Selection
 * e estado local da interface, entao isto nao afeta quem joga sem o mod. Por isso nao ha
 * PostNetworkCommand em lugar nenhum daqui.
 *
 * A API e a do proprio jogo, conferida em gui/session/selection.js: g_Selection e global
 * (`var g_Selection = new EntitySelection()`), com reset() e addList(). O motor limita a
 * selecao a g_MaxSelectionSize sozinho — nao ha o que cortar aqui.
 */
function pudim_SelecionarGuerreiros()
{
	let d = null;
	try { d = Engine.GuiInterfaceCall("pudim_GetGuerreiros", {}); } catch (e) { return; }
	const ids = (d && d.ids) || [];
	if (!ids.length) {
		pudim_Log("INFO", "SELECAO", "nenhum guerreiro para selecionar");
		return;
	}
	try {
		g_Selection.reset();
		g_Selection.addList(ids);
	} catch (e) { return; }
	pudim_Log("INFO", "SELECAO", ids.length + " guerreiro(s) selecionado(s)");
}

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
	// Enquanto houver tropa lutando, ninguém sai do abrigo nem volta a colher por conta do
	// mod. O jogador continua podendo soltar pelo botão "Voltar ao Trabalho".
	if (!manual && g_PudimEmCombate) {
		if (!g_PudimHoldCombateLogged) {
			g_PudimHoldCombateLogged = true;
			pudim_Log("INFO", "PANIC", "batalha em curso — segurando as unidades abrigadas");
		}
		return false;
	}
	g_PudimHoldCombateLogged = false;

	if (!manual && (g_PudimNoCivCentre || g_PudimSheltersUnderSiege > 0)) {
		if (!g_PudimHoldGarrisonLogged) {
			g_PudimHoldGarrisonLogged = true;
			pudim_Log("WARN", "PANIC", "mantendo unidades guarnecidas ("
				+ (g_PudimNoCivCentre ? "sem CC" : "cerco: " + g_PudimSheltersUnderSiege + " abrigo(s)")
				+ ") — use 'Voltar ao Trabalho' para soltar manualmente");
		}
		return false; // nada foi solto — quem chamou precisa saber
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
	return true;
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

	// Batalha em curso trava a soltura, mesmo com a base calma.
	//
	// A liberação olhava só o entorno da base: 10s sem inimigo perto e todo mundo voltava
	// ao trabalho. Quando a briga se desloca — a gente avança, ou o inimigo recua puxando
	// nosso exército — a base fica calma com a batalha rolando. No log de 24/08 isso
	// devolveu 152 unidades ao trabalho 57s depois de "defendendo com 28 inimigo(s)".
	g_PudimEmCombate = !!panicData.emCombate;

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
			if (pudim_ReturnPanicUnitsToWork()) {
				pudim_Log("WARN", "PANIC", "timeout de segurança (" + Math.round(PUDIM_PANIC_MAX_DURATION / 1000) + "s) — forçando retorno ao trabalho");
				return;
			}
			// A trava de "sem CC / abrigo cercado" recusou a soltura, e ela NÃO limpa
			// g_PudimPanicModeStartTime. Sem rearmar a janela aqui, a condição continuava
			// verdadeira em todo tique e o timeout redisparava a cada 1,5s: foram 119 linhas
			// de PANIC no log de 19/08, uma por tique até o fim da partida. Rearmando, a
			// próxima tentativa fica para daqui a PUDIM_PANIC_MAX_DURATION.
			g_PudimPanicModeStartTime = now;
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
			// Pânico anterior ainda ativo? Ameaça trivial não renova o timer, então o
			// timeout de 10s libera as unidades aqui.
			//
			// NÃO exigir g_PudimCalmStreak aqui. Ele só cresce quando underAttack e falso, e
			// um inimigo rondando mantem underAttack VERDADEIRO — o streak era zerado a cada
			// ciclo e nunca alcancava o limite, deixando a soltura inatingivel. Em jogo isso
			// virou "PANICO! 1 inimigos" com ZERO coletores por minutos: um unico batedor
			// paralisava a economia inteira, que e o oposto do que este ramo existe para
			// fazer. A ameaca aqui ja foi classificada como trivial (<=2 inimigos e com
			// defesa suficiente), entao o timer de 10s sozinho e critério de sobra.
			if (g_PudimPanicMode && now - g_PudimPanicLastThreat > 10000) {
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
			// Mesmo no modo "pode defender", abrigar quem está perto do inimigo.
			//
			// Aqui só o CENTRO CÍVICO era considerado. Com uma base de 183 de população e
			// dezenas de casas, o CC enche nas primeiras ~20 unidades e todo o resto ficava
			// parado apanhando: era o relato de 19/08, "aldeões sendo atacados sem fugir".
			// As casas já vinham na lista de abrigos e simplesmente não eram usadas neste ramo.
			//
			// Casa vem primeiro, de propósito: são muitas e espalhadas, então há sempre uma
			// perto, e deixam o CC livre para guarnição militar (que é o que faz o CC atirar).
			// Dentro de cada categoria vence o abrigo MAIS PERTO do trabalhador — mandar
			// alguém atravessar a base sob ataque é o mesmo que não abrigar.
			let abrigados = 0, fugindo = 0;
			const nowPanic = Date.now();
			// Limpa cooldowns de fuga vencidos, para o objeto não crescer a partida inteira.
			for (const fid in g_PudimFleeAt)
				if (nowPanic - g_PudimFleeAt[fid] > 30000) delete g_PudimFleeAt[fid];
			const escolherAbrigo = function(w) {
				let melhor = null, melhorRank = 99, melhorD = Infinity;
				for (const sh of panicData.shelters) {
					if (sh.freeSlots <= 0) continue;
					// 0 = casa segura, 1 = CC seguro, 2 = casa sob ameaça, 3 = CC sob ameaça.
					// Abrigo com inimigo por perto ainda é melhor que campo aberto.
					const rank = (sh.type === "house" ? 0 : 1) + (sh.safe ? 0 : 2);
					let d = 0;
					if (w.x !== null && w.x !== undefined && sh.x !== undefined) {
						const dx = sh.x - w.x, dz = sh.z - w.z;
						d = dx * dx + dz * dz;
					}
					if (rank < melhorRank || (rank === melhorRank && d < melhorD)) {
						melhorRank = rank; melhorD = d; melhor = sh;
					}
				}
				return melhor;
			};
			for (const worker of panicData.atRiskWorkers) {
				if (g_PudimPanicGarrisoned[worker.id]) continue;
				// Só bloqueia se foi solto agora há pouco (anti vai-e-volta). Ataque novo
				// depois do cooldown protege a unidade normalmente, quantas vezes for preciso.
				if (!pudim_CanGarrison(worker.id)) continue;
				if (!g_PudimPanicPreTask[worker.id] && worker.currentOrder)
					g_PudimPanicPreTask[worker.id] = worker.currentOrder;
				const shelter = escolherAbrigo(worker);
				if (shelter) {
					Engine.PostNetworkCommand({ "type": "garrison", "entities": [worker.id], "target": shelter.id, "queued": false });
					g_PudimPanicGarrisoned[worker.id] = { shelterID: shelter.id };
					shelter.freeSlots--;
					abrigados++;
				} else if (worker.fleeX !== null && worker.fleeX !== undefined) {
					// Sem vaga em lugar nenhum: correr para o lado oposto ao atacante, para
					// fora do alcance. Ficar parado apanhando não é opção — foi o relato.
					// Cooldown por unidade: reemitir walk a cada ciclo reinicia o pathfinder e
					// a unidade fica tremendo no lugar em vez de andar.
					if (nowPanic - (g_PudimFleeAt[worker.id] || 0) > 5000 &&
					    pudim_PodeAndar(worker.id, PUDIM_ANDAR_FUGIR, nowPanic)) {
						g_PudimFleeAt[worker.id] = nowPanic;
						pudim_RegistrarAndada(worker.id, PUDIM_ANDAR_FUGIR, nowPanic);
						Engine.PostNetworkCommand({ "type": "walk", "entities": [worker.id],
							"x": worker.fleeX, "z": worker.fleeZ, "queued": false });
						fugindo++;
					}
				}
			}
			if ((abrigados > 0 || fugindo > 0) && nowPanic - g_PudimShelterLogAt > 10000) {
				g_PudimShelterLogAt = nowPanic;
				const vagas = panicData.shelters.reduce((a, sh) => a + Math.max(0, sh.freeSlots), 0);
				pudim_Log("INFO", "PANIC", "abrigando " + abrigados + " e fugindo " + fugindo +
					"; " + vagas + " vaga(s) em " + panicData.shelters.length + " abrigo(s)");
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

		// ── O ABRIGO E O MAIS PERTO DE QUEM ESTA FUGINDO ──────────────────────────────
		//
		// "os coletores de madeira viram um perigo, ao inves de irem para casas proximas,
		// andaram pra longe... o trabalhador, sempre tem que procurar uma casa mais proxima
		// que não esteja cheia da posicao dele".
		//
		// A versao anterior era `safeHouses.find(s => s.freeSlots > 0)` — sem argumento
		// nenhum. `.find` devolve o PRIMEIRO da lista, na ordem em que a simulacao empilhou
		// as entidades, entao todo mundo em panico ia para a mesma casa ate ela encher,
		// estivesse a dez metros ou do outro lado da base. Um lenhador na mata ganhava a
		// casa que por acaso vinha primeiro.
		//
		// A simulacao ja mandava x/z de cada trabalhador para isto — o comentario dela diz
		// "sem ela o painel nao tem como escolher o abrigo MAIS PERTO". O painel e que nunca
		// usou.
		//
		// As faixas de prioridade continuam: abrigo seguro (sem inimigo a 80m) antes de
		// inseguro, casa antes de CC. Dentro da faixa, o mais perto. Trocar a ordem das
		// faixas por distancia pura mandaria gente para uma casa colada no inimigo so por
		// ser dois metros mais perto.
		const maisPerto = (lista, x, z) => {
			let melhor = null, melhorD = Infinity;
			for (const s of lista) {
				if (s.freeSlots <= 0) continue;
				if (x === null || x === undefined || s.x === undefined) return s;
				const dx = s.x - x, dz = s.z - z;
				const d = dx * dx + dz * dz;
				if (d < melhorD) { melhorD = d; melhor = s; }
			}
			return melhor;
		};
		const pickWorkerShelter = (x, z) =>
			maisPerto(safeHouses, x, z) ||
			maisPerto(safeCCs, x, z) ||
			maisPerto(anyHouses, x, z) ||
			maisPerto(anyCCs, x, z) ||
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

			const shelter = pickWorkerShelter(worker.x, worker.z);
			if (shelter) {
				Engine.PostNetworkCommand({
					"type": "garrison",
					"entities": [worker.id],
					"target": shelter.id,
					"queued": false
				});
				g_PudimPanicGarrisoned[worker.id] = { shelterID: shelter.id };
				shelter.freeSlots--;
			} else if (rallyCCPos && pudim_PodeAndar(worker.id, PUDIM_ANDAR_ABRIGO, Date.now())) {
				// Sem abrigo disponível: mover para perto do CC
				Engine.PostNetworkCommand({
					"type": "walk",
					"entities": [worker.id],
					"x": rallyCCPos.x + (Math.random() * 20 - 10),
					"z": rallyCCPos.z + (Math.random() * 20 - 10),
					"queued": false
				});
				pudim_RegistrarAndada(worker.id, PUDIM_ANDAR_ABRIGO, Date.now());
				g_PudimPanicGarrisoned[worker.id] = { shelterID: null };
			}
		}

		// Guarnecer soldados em torres/fortalezas/CC seguros
		// Mesma regra para o soldado: a torre mais perto, nao a primeira da lista.
		const pickSoldierShelter = (x, z) =>
			maisPerto(soldierShelters, x, z) ||
			maisPerto(soldierSheltersFallback, x, z) ||
			null;

		for (const soldier of panicData.atRiskSoldiers) {
			if (g_PudimPanicGarrisoned[soldier.id]) continue;

			const shelter = pickSoldierShelter(soldier.x, soldier.z);
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
/**
 * Mantém o herói passivo dentro do alcance da própria aura e fora do alcance das armas
 * inimigas — nessa ordem de prioridade quando os dois não cabem juntos.
 *
 * O trabalho de decidir ONDE é do lado da simulação (pudim_GetHeroAuraData), que é onde
 * estão os componentes. Aqui só se emite a ordem e se respeita o intervalo entre ordens.
 */
let g_PudimHeroAccum = 0;
let g_PudimHeroLastAt = 0;
let g_PudimHeroLogAt = 0;

function pudim_ProcessHeroAura()
{
	const agora = Date.now();
	// 4s entre ordens. Sem isso, com a luta se movendo, o herói recebe um walk novo a cada
	// ciclo e nunca chega a lugar nenhum — foi exatamente o que aconteceu com o kite antes
	// do cooldown de 6s, e não há motivo para repetir o erro aqui.
	if (agora - g_PudimHeroLastAt < 4000) return;

	let d;
	try {
		d = Engine.GuiInterfaceCall("pudim_GetHeroAuraData",
			{ "playerOrdered": pudim_GetPlayerOrderedIds() });
	} catch (e) { return; }
	if (!d) return;

	if (g_PudimShowDebug && agora - g_PudimHeroLogAt > 15000) {
		g_PudimHeroLogAt = agora;
		const g = d._dbg || {};
		pudim_Log("DEBUG", "HEROI", "acao=" + d.action + " motivo=" + (g.reason || "?") +
			" raio=" + (g.raio || 0) + " lutando=" + (g.lutando || 0) +
			" ameacas=" + (g.ameacas || 0) + " mover=" + (g.mover || 0) + "m");
	}

	if (d.action !== "posicionar" || !d.heroId) {
		// "aura_toda_exposta" merece registro mesmo sem debug: significa que a tropa está
		// lutando SEM o bônus, por decisão deliberada de preservar o herói.
		if (d.action === "recuar" && agora - g_PudimHeroLogAt > 15000) {
			g_PudimHeroLogAt = agora;
			pudim_Log("INFO", "HEROI", "aura toda dentro do alcance inimigo — heroi fica fora, tropa luta sem bonus");
		}
		return;
	}

	// Posicionar o heroi nunca e urgente: se ele acabou de receber ordem de qualquer outro
	// sistema (fuga, retirada), aquilo importa mais e este ciclo passa.
	if (!pudim_PodeAndar(d.heroId, PUDIM_ANDAR_HEROI, agora))
		return;
	g_PudimHeroLastAt = agora;
	pudim_RegistrarAndada(d.heroId, PUDIM_ANDAR_HEROI, agora);
	Engine.PostNetworkCommand({
		"type": "walk",
		"entities": [d.heroId],
		"x": d.x,
		"z": d.z,
		"queued": false
	});
	// Protege contra outros sistemas (pânico, abrigo, despacho) reclamarem o herói durante
	// a caminhada. Mesmo mecanismo já usado pelos construtores.
	pudim_ProtectBuilder(d.heroId, agora + 4000);
	pudim_Log("INFO", "HEROI", "posicionado na aura em (" + d.x.toFixed(0) + "," + d.z.toFixed(0) +
		") raio=" + ((d._dbg && d._dbg.raio) || "?") + " andou=" + ((d._dbg && d._dbg.mover) || "?") + "m");
}


// ─── Construir quartéis / estábulos em série ──────────────────────────────────────────
//
// Pedido de 25/08: escolher o tipo, escolher quantos (1 a 10), e o mod ergue um de cada vez
// com 5 trabalhadores do recurso mais abundante, devolvendo todo mundo ao trabalho no fim.
// Com muitos recursos e população acima de 180, pode erguer em paralelo.
//
// Por que sequencial é o padrão: cinco trabalhadores numa obra terminam ela rápido e voltam
// a colher; cinco obras com um trabalhador cada ficam meio-prontas por muito tempo, com o
// custo já pago e nenhuma unidade saindo de nenhuma. É a diferença entre um quartel
// treinando aos 8 minutos e cinco esqueletos aos 12.
//
// E por que a exceção dele é certa: perto do teto de população o gargalo deixa de ser
// recurso e passa a ser quantos lugares treinam ao mesmo tempo. Aí paralelo ganha.
const PUDIM_QUARTEL_TIPOS = ["quartel", "estabulo", "casa", "forja", "torre", "palicada"];
// Os nomes saem do dicionário, não de literais: o dropdown e o botão têm de falar a
// mesma língua do resto do painel.
const PUDIM_QUARTEL_CHAVES = {
	quartel:  "cap.barracks",
	estabulo: "cap.stable",
	casa:     "cap.house",
	forja:    "cap.forge",
	torre:    "cap.tower",
	palicada: "cap.palisade"
};
function pudim_QuartelNome(tipo) {
	return pudim_T(PUDIM_QUARTEL_CHAVES[tipo] || "cap.barracks");
}
const PUDIM_QUARTEL_INTERVALO = 2500;   // entre tentativas; obra é lenta, não precisa correr
const PUDIM_QUARTEL_MAX_PARALELO = 3;   // teto do regime paralelo, para não virar spam

// Estoque a partir do qual "sobra recurso" para o regime paralelo. Um quartel custa da ordem
// de algumas centenas de madeira; com 1500 sobrando, erguer três de uma vez não compromete
// nada. Abaixo disso o paralelo tiraria da economia justamente quando ela ainda importa.
const PUDIM_QUARTEL_FOLGA = 1500;

// A população a partir da qual vale erguer em paralelo, como o jogador pediu. Vive nos DOIS
// lados (aqui e na simulação) porque painel e simulação são escopos separados no motor —
// não há como um ler a constante do outro. Se mudar, mude nos dois.
const PUDIM_QUARTEL_POP_PARALELO = 180;

var g_PudimQuartelTipo = "quartel";
// O ALVO e o ATIVO sao POR TIPO — ver g_PudimSeries / pudim_SerieEstado. Eram escalares, e
// era por isso que mandar estabulos apagava a serie de quarteis.
var g_PudimQuartelAccum = 0;
// Quantos daquele tipo já existiam quando a série começou. null = ainda não medido.
//
// Era 0, e 0 significava DUAS coisas: "ainda não medi" e "não havia nenhum". Quem começa a
// série sem nenhum quartel cai nas duas ao mesmo tempo, e a base era remedida a cada ciclo
// até a primeira obra concluir — quando prontos virava 1, a base virava 1 junto e aquela
// primeira obra deixava de ser contada. Resultado: pedir 3 construía 4, sempre que se
// começava do zero. Um sentinela que não colide com um valor legítimo resolve.

// ── A ORDEM VIROU FUNDACAO? ───────────────────────────────────────────────────────────
//
// "mandei fazer torres e nada aconteceu". O log de 01/09 mostra a ordem sendo emitida 28
// vezes, de 3 em 3 segundos, sempre na MESMA coordenada (717,154), com "faltam 10" parado:
//
//   607s Torre em (717,154) ... faltam 10 [paralelo: pop 199 e recurso sobrando]
//   610s Torre em (717,154) ... faltam 10 [paralelo: pop 199 e recurso sobrando]
//   ... 26 vezes mais
//
// Duas coisas se somaram. A primeira: o painel registrava SUCCESS ao EMITIR o comando, nao
// ao ver a fundacao aparecer — entao o log dizia "sucesso" 28 vezes para 28 fracassos.
//
// A segunda: nada fazia o mod desconfiar. O motor recusa o `construct` por motivos que o
// SetBuildingPlacementPreview do lado GUI nao testa (limite de construcao do template, por
// exemplo), e a recusa e silenciosa. Como o ponto escolhido e deterministico, o ciclo
// seguinte reescolhia exatamente o mesmo.
//
// No regime sequencial isso nao aparecia porque o freio "obra em andamento" segurava tudo
// no primeiro fracasso. As torres entraram no regime PARALELO (pop 199), onde o teto e 3
// obras — e com emObra travado em 0 o freio nunca agia.
//
// Agora o mod compara o progresso (prontos + emObra) com o da ultima emissao. Igual
// significa que a ordem anterior nao virou nada: o ponto vai para a lista de adiados e a
// proxima tentativa sai em outro lugar. Depois de PUDIM_QUARTEL_FALHAS_MAX seguidas sem
// nenhum progresso, a serie para e diz — melhor parar avisando do que gastar comando a cada
// 3 segundos para sempre.
const PUDIM_QUARTEL_FALHAS_MAX = 5;

/** Chamado pelo dropdown de tipo. */
function pudim_QuartelSetTipo()
{
	const dd = Engine.GetGUIObjectByName("pudim_quartelTipo");
	if (!dd) return;
	// Le da lista VISIVEL, nao da completa: elas divergem enquanto forja e torre estao
	// bloqueadas, e ler da completa selecionaria o edificio errado.
	g_PudimQuartelTipo = g_PudimQuartelDisponiveis[dd.selected] || g_PudimQuartelDisponiveis[0];
	pudim_QuartelAtualizarLabel();
}

/** Chamado pelo dropdown de quantidade. */
function pudim_QuartelSetQtd()
{
	const dd = Engine.GetGUIObjectByName("pudim_quartelQtd");
	if (!dd) return;
	const stQtd = pudim_SerieEstado(g_PudimQuartelTipo);
	if (!stQtd.ativo) stQtd.alvo = dd.selected + 1;
	pudim_QuartelAtualizarLabel();
}

/** Botão: liga a série, ou cancela a que estiver rodando. */
function pudim_QuartelToggle()
{
	// A palicada nao e "mais um edificio da serie": e um muro tracado em espiral, com
	// equipe propria e comando proprio (construct-wall). O dropdown e o mesmo por
	// conveniencia — o numero ali passa a significar VOLTAS em vez de quantidade.
	if (g_PudimQuartelTipo === "palicada") { pudim_PalicadaToggle(); return; }

	// O botao age SO no tipo que esta no dropdown. E o "cancelar uma das ordens" do pedido:
	// com quartel e estabulo correndo juntos, parar um nao encosta no outro.
	const tipo = g_PudimQuartelTipo;
	const st = pudim_SerieEstado(tipo);
	if (st.ativo) {
		st.ativo = false;
		// Cancelar devolve a equipe ao trabalho na hora. Deixá-los parados seria pior do
		// que nunca ter começado.
		pudim_QuartelLiberarEquipe(tipo);
		pudim_Log("INFO", "QUARTEL", pudim_QuartelNome(tipo) + ": série cancelada pelo jogador");
	} else {
		const dd = Engine.GetGUIObjectByName("pudim_quartelQtd");
		st.alvo = dd ? dd.selected + 1 : 1;
		st.ativo = true;
		st.base = null;
		st.ultima = 0;
		st.ultimoPonto = null;
		st.progresso = -1;
		st.falhas = 0;
		st.faltam = undefined;
		st.feitos = 0;
		const outras = pudim_SeriesAtivas().filter(t => t !== tipo).map(pudim_QuartelNome);
		pudim_Log("INFO", "QUARTEL", "série iniciada: " + st.alvo + " " +
			pudim_QuartelNome(tipo) +
			(outras.length ? " (em paralelo com " + outras.join(", ") + ")" : ""));
	}
	pudim_QuartelAtualizarLabel();
}

/**
 * Solta a proteção da equipe para que o auto-trabalho a recolha.
 *
 * "Ao finalizar, eles voltam a trabalhar" — o despacho já manda unidade ociosa para o
 * recurso mais carente a cada 500ms, então basta parar de protegê-los. Emitir uma ordem de
 * coleta aqui competiria com esse despacho e cairia no mesmo erro de dois sistemas
 * mandando na mesma unidade que já custou caro em outras partes do mod.
 */
function pudim_QuartelLiberarEquipe(tipo)
{
	const st = pudim_SerieEstado(tipo);
	for (const id of st.equipe)
		pudim_ProtectBuilder(id, 0);
	st.equipe = [];
}

function pudim_QuartelAtualizarLabel()
{
	try { pudim_SerieDesenharLista(); } catch (e) {}
	const lbl = Engine.GetGUIObjectByName("pudim_quartelBtnLabel");
	if (!lbl) return;
	const nome = pudim_QuartelNome(g_PudimQuartelTipo);
	// O botao fala SO do tipo que esta no dropdown. Quem mostra o conjunto e a lista de
	// vagas logo abaixo (pudim_SerieDesenharLista) — antes isto era um rotulo unico que
	// crescia ate quebrar em duas linhas com tres series ativas.
	if (g_PudimQuartelTipo === "palicada") {
		const dd = Engine.TryGetGUIObjectByName("pudim_quartelQtd");
		const voltas = g_PudimPalicadaAtiva ? g_PudimPalicadaVoltas : ((dd ? dd.selected : 0) + 1);
		lbl.caption = (g_PudimPalicadaAtiva ? pudim_T("cap.serieStop") : pudim_T("cap.serieBuild")) +
			" " + nome + ": " + voltas + " " + pudim_T("cap.laps");
		return;
	}
	// So esta selecionada corre (ou nenhuma): o rotulo fala dela, como sempre falou.
	const stLbl = pudim_SerieEstado(g_PudimQuartelTipo);
	lbl.caption = (stLbl.ativo ? pudim_T("cap.serieStop") : pudim_T("cap.serieBuild")) +
		" " + stLbl.alvo + " " + nome;
}

/**
 * O que esta em andamento nas duas series, junto.
 *
 * Pergunta do jogador em 01/09: "da pra fazer varias coisas simultaneas? por exemplo
 * palicadas e quarteis?".
 *
 * Da, e ja dava: g_PudimQuartelAtivo e g_PudimPalicadaAtiva sao estados independentes, os
 * dois processos rodam no mesmo tique, e o toggle de um nao encosta no outro. Cada um tem
 * equipe propria (5 construtores a serie, 3 a palicada).
 *
 * O que faltava era a TELA dizer isso. O rotulo do botao so falava da serie selecionada no
 * dropdown, entao a outra corria invisivel — e quem nao sabe do detalhe conclui que o mod so
 * faz uma coisa por vez, que foi exatamente a duvida dele.
 */
function pudim_SerieStatusTexto()
{
	const partes = [];
	for (const t of pudim_SeriesAtivas())
		partes.push(pudim_QuartelNome(t) + " x" + pudim_SerieFaltam(t));
	if (g_PudimPalicadaAtiva)
		partes.push(pudim_QuartelNome("palicada") + ": " + g_PudimPalicadaVoltas + " " + pudim_T("cap.laps"));
	return partes.join("  +  ");
}

/** Tipos que dao para construir AGORA. A lista cresce sozinha durante a partida. */
var g_PudimQuartelDisponiveis = PUDIM_QUARTEL_TIPOS.slice();

/**
 * Redesenha o dropdown com o que da para construir neste momento.
 *
 * Pedido de 25/08: "forja e torre, tem que ficar desabilitado, ate poder construir (fase 2),
 * ai libera sozinho".
 *
 * Nao ha lista de fases no codigo, e nao pode haver: cada civilizacao libera em momentos
 * diferentes, e escrever "forja e fase 2" seria certo para umas e errado para outras. A
 * simulacao pergunta ao Builder do trabalhador, que ja sabe — a mesma fonte que decide quais
 * botoes de construcao o jogo desenha.
 *
 * O tipo escolhido e preservado pelo NOME, nao pelo indice: a lista cresce durante a
 * partida, e um indice guardado apontaria para outro edificio depois que a forja liberar.
 */
function pudim_QuartelAtualizarLista(disponiveis)
{
	if (!disponiveis || !disponiveis.length) return;
	// Ordem fixa, a mesma de PUDIM_QUARTEL_TIPOS: a lista nao pode dancar quando algo libera.
	const nova = PUDIM_QUARTEL_TIPOS.filter(t => disponiveis.indexOf(t) >= 0);
	if (nova.join(",") === g_PudimQuartelDisponiveis.join(",")) return;
	g_PudimQuartelDisponiveis = nova;

	const dd = Engine.TryGetGUIObjectByName("pudim_quartelTipo");
	if (!dd) return;
	const escolhido = g_PudimQuartelTipo;
	dd.list = nova.map(t => pudim_QuartelNome(t));
	dd.list_data = nova.slice();
	const idx = nova.indexOf(escolhido);
	dd.selected = idx >= 0 ? idx : 0;
	if (idx < 0) g_PudimQuartelTipo = nova[0];
	pudim_QuartelAtualizarLabel();
}

function pudim_QuartelInit()
{
	const tipo = Engine.GetGUIObjectByName("pudim_quartelTipo");
	if (tipo) {
		tipo.list = PUDIM_QUARTEL_TIPOS.map(t => pudim_QuartelNome(t));
		tipo.list_data = PUDIM_QUARTEL_TIPOS.slice();
		tipo.selected = 0;
	}
	const qtd = Engine.GetGUIObjectByName("pudim_quartelQtd");
	if (qtd) {
		const nums = [];
		for (let i = 1; i <= 10; i++) nums.push(String(i));
		qtd.list = nums;
		qtd.list_data = nums.slice();
		qtd.selected = 0;
	}
	pudim_QuartelAtualizarLabel();
}

// ─── Paliçada: liga os pontos da espiral, um trecho por vez ───────────────────────────
//
// Quem calcula ONDE cada peça entra é o motor, não este código. SetWallPlacementPreview
// recebe início e fim e devolve a lista de peças com posição e ângulo já resolvidos —
// incluindo as curvas, que é onde qualquer cálculo próprio erraria. Depois é só mandar
// construct-wall com essa lista, exatamente como gui/session/input.js faz em tryPlaceWall.
//
// "a onde falhar a construção contorna e continua fazendo, por exemplo arvores e etc": um
// trecho que o preview recusa é pulado, e o próximo começa do ponto seguinte. A paliçada
// fica com um vão ali e segue em frente, que é o que dá para fazer — derrubar a árvore para
// fechar o muro seria decidir sozinho jogar madeira fora.
const PUDIM_PALICADA_INTERVALO = 1200;   // entre trechos; obra é lenta, não precisa correr

var g_PudimPalicadaAtiva = false;
var g_PudimPalicadaVoltas = 1;
var g_PudimPalicadaPontos = [];
var g_PudimPalicadaIdx = 0;
var g_PudimPalicadaUltima = 0;
var g_PudimPalicadaEquipe = [];
var g_PudimPalicadaAccum = 0;
var g_PudimPalicadaVaos = 0;

function pudim_PalicadaToggle()
{
	if (g_PudimPalicadaAtiva) {
		g_PudimPalicadaAtiva = false;
		for (const id of g_PudimPalicadaEquipe) pudim_ProtectBuilder(id, 0);
		g_PudimPalicadaEquipe = [];
		pudim_Log("INFO", "PALICADA", "cancelada pelo jogador");
	} else {
		const dd = Engine.TryGetGUIObjectByName("pudim_quartelQtd");
		g_PudimPalicadaVoltas = dd ? dd.selected + 1 : 1;
		g_PudimPalicadaAtiva = true;
		g_PudimPalicadaPontos = [];
		g_PudimPalicadaIdx = 0;
		g_PudimPalicadaVaos = 0;
		g_PudimPalicadaUltima = 0;
		pudim_Log("INFO", "PALICADA", "iniciada: " + g_PudimPalicadaVoltas + " volta(s)");
	}
	pudim_QuartelAtualizarLabel();
}

function pudim_ProcessPalicada()
{
	if (!g_PudimPalicadaAtiva) return;
	const agora = Date.now();
	if (agora - g_PudimPalicadaUltima < PUDIM_PALICADA_INTERVALO) return;
	if (pudim_ObrasPausadas()) return;
	g_PudimPalicadaUltima = agora;

	// Traça a espiral uma vez, no começo. Retraçá-la a cada trecho faria o muro se deslocar
	// junto com o território, que cresce durante a partida.
	if (!g_PudimPalicadaPontos.length) {
		let d;
		try {
			d = Engine.GuiInterfaceCall("pudim_GetPalicadaData",
				{ "voltas": g_PudimPalicadaVoltas, "playerOrdered": pudim_GetPlayerOrderedIds() });
		} catch (e) { return; }
		if (!d) return;
		if (!d.disponivel) {
			// A paliçada vale em TODAS as fases, e isso merece a explicação porque eu li
			// errado da primeira vez: structures/wallset_palisade traz
			// Requirements "-phase_town phase_village", e no sistema de tokens do 0 A.D. o
			// "-" REMOVE um requisito herdado. O pai (template_wallset) exige phase_town —
			// muralha de pedra é fase 2 —, e a paliçada tira essa exigência e fica pedindo
			// só phase_village, que se tem desde o início e nunca se perde.
			//
			// Então cair aqui não é "mudou de fase": é civilização que não constrói paliçada,
			// ou nenhum trabalhador disponível para perguntar.
			pudim_Log("WARN", "PALICADA", "esta civilização não constrói paliçada — cancelada");
			g_PudimPalicadaAtiva = false;
			pudim_QuartelAtualizarLabel();
			return;
		}
		if (!d.pontos || d.pontos.length < 2 || !d.builderIds.length) {
			pudim_Log("WARN", "PALICADA", "sem caminho para traçar (" +
				((d._dbg && d._dbg.reason) || "?") + ") — cancelada");
			g_PudimPalicadaAtiva = false;
			pudim_QuartelAtualizarLabel();
			return;
		}
		// O wallSet vem do template, igual a gui/session/input.js: "wallSet = templateData.wallSet".
		// Sem ele o preview nao tem como saber quais pecas existem.
		try {
			const td = GetTemplateData(d.template);
			g_PudimPalicadaWallSet = td && td.wallSet ? td.wallSet : null;
		} catch (e) { g_PudimPalicadaWallSet = null; }
		if (!g_PudimPalicadaWallSet) {
			pudim_Log("WARN", "PALICADA", "template " + d.template + " sem wallSet — cancelada");
			g_PudimPalicadaAtiva = false;
			pudim_QuartelAtualizarLabel();
			return;
		}

		g_PudimPalicadaPontos = d.pontos;
		g_PudimPalicadaTemplate = d.template;
		g_PudimPalicadaEquipe = d.builderIds.slice();
		for (const id of d.builderIds) pudim_ProtectBuilder(id, agora + 300000);
		pudim_Log("INFO", "PALICADA", "traçada: " + d.pontos.length + " pontos, " +
			g_PudimPalicadaVoltas + " volta(s), borda a " + ((d._dbg && d._dbg.borda) || "?") + "m");
	}

	if (g_PudimPalicadaIdx >= g_PudimPalicadaPontos.length - 1) {
		pudim_Log("SUCCESS", "PALICADA", "terminada" +
			(g_PudimPalicadaVaos ? " — " + g_PudimPalicadaVaos + " trecho(s) sem passagem, contornados" : ""));
		g_PudimPalicadaAtiva = false;
		for (const id of g_PudimPalicadaEquipe) pudim_ProtectBuilder(id, 0);
		g_PudimPalicadaEquipe = [];
		pudim_QuartelAtualizarLabel();
		return;
	}

	const a = g_PudimPalicadaPontos[g_PudimPalicadaIdx];
	const b = g_PudimPalicadaPontos[g_PudimPalicadaIdx + 1];
	g_PudimPalicadaIdx++;

	// Pontos de voltas diferentes não se ligam: o fim de uma volta e o começo da seguinte
	// estão a uma volta inteira de distância, e ligá-los cortaria a base ao meio.
	if (a.volta !== b.volta) return;

	let info = null;
	try {
		info = Engine.GuiInterfaceCall("SetWallPlacementPreview", {
			"wallSet": g_PudimPalicadaWallSet,
			"start": { "x": a.x, "z": a.z },
			"end": { "x": b.x, "z": b.z },
			"snapEntities": []
		});
	} catch (e) { info = null; }

	// SEMPRE limpar. SetWallPlacementPreview cria entidades locais no motor (ver
	// placementWallEntities em GuiInterface.js); chamar sem wallSet as destroi. Deixar de
	// limpar acumularia peças fantasma no mapa a cada trecho.
	const limpar = function() {
		try { Engine.GuiInterfaceCall("SetWallPlacementPreview", {}); } catch (e) {}
	};

	if (!info || !info.pieces || !info.pieces.length) {
		// Árvore, rocha, terreno íngreme: o motor recusou o trecho. Conta e segue.
		limpar();
		g_PudimPalicadaVaos++;
		return;
	}

	Engine.PostNetworkCommand({
		"type": "construct-wall",
		"entities": g_PudimPalicadaEquipe,
		"wallSet": g_PudimPalicadaWallSet,
		"pieces": info.pieces,
		"startSnappedEntity": info.startSnappedEnt,
		"endSnappedEntity": info.endSnappedEnt,
		"autorepair": true,
		"autocontinue": true,
		"queued": true
	});
	limpar();
}

var g_PudimPalicadaTemplate = "";
var g_PudimPalicadaWallSet = null;

/**
 * Estado de UMA serie. Ha um por tipo, e e por isso que elas correm juntas.
 *
 * Pedido de 01/09: "mandei fazer 4 quarteis, e no meio da construcao do primeiro, mandei
 * fazer 4 estabulos, so terminou o que tinha comecado e n fez os quarteis... tem que fazer
 * em paralelo, e ter a opcao de cancelar uma das ordens".
 *
 * A causa era estrutural: o estado da serie eram OITO variaveis escalares
 * (g_PudimQuartelAtivo, ...Alvo, ...Base, ...Equipe e o resto) para UMA serie so. Trocar o
 * tipo no dropdown e apertar reescrevia esse mesmo estado — a serie de quarteis nao era
 * cancelada, era SOBRESCRITA. O que ja estava em obra terminava porque o motor nao sabe do
 * mod, e o resto simplesmente deixava de existir.
 *
 * Agora cada tipo tem o seu, e o laco processa todos os ativos no mesmo tique. Cancelar um
 * mexe so no dele, que e a segunda metade do pedido.
 */
var g_PudimSeries = {};
function pudim_SerieEstado(tipo)
{
	if (!g_PudimSeries[tipo])
		g_PudimSeries[tipo] = { ativo: false, alvo: 1, base: null, ultima: 0, logAt: 0,
		                        equipe: [], ultimoPonto: null, progresso: -1, falhas: 0,
		                        faltam: undefined, feitos: 0 };
	return g_PudimSeries[tipo];
}

/**
 * Quantos ainda faltam nesta serie.
 *
 * st.faltam so existe depois do primeiro ciclo de pudim_ProcessSerie (e ele que conta os
 * prontos). Antes disso, o alvo cheio e a resposta certa: nada foi construido ainda.
 */
function pudim_SerieFaltam(tipo)
{
	const st = pudim_SerieEstado(tipo);
	return st.faltam === undefined ? st.alvo : Math.max(0, st.faltam);
}

/**
 * A lista do que esta sendo construido, uma linha por serie, cada uma com o seu X.
 *
 * Pedido de 02/09: "poderia ficar uma lista de coisas sendo construidas, com um botao X pra
 * parar, de forma individual".
 *
 * Antes tudo cabia num rotulo so — "PARAR — faltam Quartel x10 + Estabulo x3 + Casa x5" —
 * que nao escala e nao deixa cancelar UMA. Sao seis vagas porque sao seis tipos
 * (PUDIM_QUARTEL_TIPOS), entao a lista nunca transborda.
 *
 * A ordem e a de PUDIM_QUARTEL_TIPOS, fixa: lista que reordena sozinha faz o jogador clicar
 * no X de uma e acertar outra. Foi o mesmo cuidado da lista de unidades.
 */
const PUDIM_SERIE_VAGAS = 6;

function pudim_SerieDesenharLista()
{
	const ativas = pudim_SeriesAtivas();
	if (g_PudimPalicadaAtiva) ativas.push("palicada");
	for (let i = 0; i < PUDIM_SERIE_VAGAS; i++) {
		const rot = Engine.TryGetGUIObjectByName("pudim_serieRot" + i);
		const bx = Engine.TryGetGUIObjectByName("pudim_serieX" + i);
		const t = ativas[i];
		if (rot) {
			rot.hidden = !t;
			if (t) rot.caption = pudim_QuartelNome(t) + " " +
				(t === "palicada" ? g_PudimPalicadaVoltas + "v" : pudim_SerieFaltam(t));
		}
		if (bx) bx.hidden = !t;
	}
	g_PudimSerieLista = ativas;
}

/**
 * O X de uma vaga. Cancela SO aquela serie — e a segunda metade do pedido de 01/09
 * ("ter a opcao de cancelar uma das ordens").
 */
function pudim_SerieCancelar(vaga)
{
	const tipo = (g_PudimSerieLista || [])[vaga];
	if (!tipo) return;
	if (tipo === "palicada") { pudim_PalicadaToggle(); return; }
	const st = pudim_SerieEstado(tipo);
	if (!st.ativo) return;
	st.ativo = false;
	pudim_QuartelLiberarEquipe(tipo);
	pudim_Log("INFO", "QUARTEL", pudim_QuartelNome(tipo) + ": série cancelada pelo jogador (X da lista)");
	pudim_QuartelAtualizarLabel();
}
var g_PudimSerieLista = [];

/** As series em andamento agora, na ordem fixa de PUDIM_QUARTEL_TIPOS. */
function pudim_SeriesAtivas()
{
	return PUDIM_QUARTEL_TIPOS.filter(t => t !== "palicada" && pudim_SerieEstado(t).ativo);
}

function pudim_ProcessQuartel()
{
	// A lista de tipos disponiveis e atualizada mesmo sem serie ativa: o jogador precisa ver
	// a forja liberar quando muda de fase, nao so depois de mandar construir alguma coisa.
	// Uma consulta so, com o tipo que esta no dropdown, serve para isso.
	try {
		const d0 = Engine.GuiInterfaceCall("pudim_GetBarracksBuildData",
			{ "tipo": g_PudimQuartelTipo, "playerOrdered": pudim_GetPlayerOrderedIds(),
			  "equipeAtual": pudim_SerieEstado(g_PudimQuartelTipo).equipe });
		if (d0) pudim_QuartelAtualizarLista(d0.disponiveis);
	} catch (e) {}

	for (const tipo of pudim_SeriesAtivas())
		pudim_ProcessSerie(tipo, pudim_SerieEstado(tipo));

	// A lista precisa acompanhar o `faltam`, que muda a cada ciclo — desenhar so no clique
	// deixaria o numero congelado no valor inicial, que foi exatamente a queixa
	// ("ja foram construidos 5 quarteis, mas n diminuiu ai conforme constroi").
	try { pudim_SerieDesenharLista(); } catch (e) {}
}

function pudim_ProcessSerie(tipo, st)
{
	const agora = Date.now();
	if (agora - st.ultima < PUDIM_QUARTEL_INTERVALO) return;

	let d;
	try {
		d = Engine.GuiInterfaceCall("pudim_GetBarracksBuildData",
			{ "tipo": tipo, "playerOrdered": pudim_GetPlayerOrderedIds(),
			  "equipeAtual": st.equipe });
	} catch (e) { return; }
	if (!d) return;

	// A LISTA ATUALIZA MESMO SEM SERIE ATIVA. O jogador precisa ver a forja liberar quando
	// muda de fase, e nao so depois de mandar construir alguma coisa — a checagem de "serie
	// ativa" vem DEPOIS desta linha de proposito.


	/**
	 * Toda saida daqui em diante DIZ por que parou.
	 *
	 * Esta funcao tinha quatro saidas silenciosas, e foi por isso que "mandei fazer quarteis
	 * e nada" custou duas partidas para diagnosticar: o log mostrava "serie iniciada" e mais
	 * nada, para sempre. Silencio nao e neutro — ele transforma um bug de dez minutos num de
	 * dois dias.
	 */
	const parar = function(motivo, extra) {
		st.ultima = agora;
		if (agora - (st.logAt || 0) > 15000) {
			st.logAt = agora;
			pudim_Log("DEBUG", "QUARTEL", "parado: " + motivo + (extra ? " (" + extra + ")" : ""));
		}
	};

	// A pausa de "o jogador apagou uma obra" vale aqui também: ele apagou, ele decide.
	if (pudim_ObrasPausadas()) { parar("o jogador apagou uma obra ha pouco"); return; }

	if (!d.template) {
		pudim_Log("WARN", "QUARTEL", "esta civilização não constrói " +
			pudim_QuartelNome(tipo) + " — série cancelada");
		st.ativo = false;
		pudim_QuartelAtualizarLabel();
		return;
	}

	// Na primeira volta, guarda quantos já existiam: o alvo é quantos NOVOS, não um total.
	// O teste é contra null, não contra 0 — ver a declaração de st.base.
	if (st.base === null) st.base = d.prontos;

	// A ordem anterior virou fundacao? (ver a declaracao de st.ultimoPonto)
	const progressoAgora = d.prontos + d.emObra;
	if (st.ultimoPonto !== null) {
		if (progressoAgora === st.progresso) {
			g_PudimDecayedSpots.push({ x: st.ultimoPonto.x,
			                           z: st.ultimoPonto.z,
			                           until: Date.now() + 90000 });
			st.falhas++;
			pudim_Log("WARN", "QUARTEL", "ordem em (" +
				st.ultimoPonto.x.toFixed(0) + "," +
				st.ultimoPonto.z.toFixed(0) + ") nao virou fundacao — " +
				"ponto adiado (" + st.falhas + " de " + PUDIM_QUARTEL_FALHAS_MAX + ")");
			if (st.falhas >= PUDIM_QUARTEL_FALHAS_MAX) {
				pudim_Log("ERROR", "QUARTEL", pudim_QuartelNome(tipo) +
					": " + PUDIM_QUARTEL_FALHAS_MAX + " ordens seguidas sem fundacao — " +
					"o motor esta recusando (limite do edificio? terreno?). Serie cancelada.");
				st.ativo = false;
				pudim_QuartelLiberarEquipe(tipo);
				pudim_QuartelAtualizarLabel();
				return;
			}
		} else {
			st.falhas = 0;
		}
		st.ultimoPonto = null;
	}

	// QUANTOS FALTAM FICA NO ESTADO, NAO SO NESTA VARIAVEL.
	//
	// "ja foram construidos 5 quarteis e 2 estabulos, mas n diminuiu ai conforme constroi":
	// o rotulo mostrava st.alvo, que e o TOTAL PEDIDO e nunca muda. O numero que interessa
	// — quantos ainda faltam — era calculado aqui, usado, e jogado fora a cada ciclo, entao
	// a tela nao tinha como saber dele.
	const feitos = Math.max(0, d.prontos - st.base);
	const faltam = st.alvo - feitos;
	st.faltam = faltam;
	st.feitos = feitos;
	if (faltam <= 0) {
		pudim_Log("SUCCESS", "QUARTEL", st.alvo + " " +
			pudim_QuartelNome(tipo) + " prontos — equipe volta ao trabalho");
		st.ativo = false;
		pudim_QuartelLiberarEquipe(tipo);
		pudim_QuartelAtualizarLabel();
		return;
	}

	// ── Sequencial ou paralelo ───────────────────────────────────────────────────────
	// As duas condições do jogador têm de valer JUNTAS: população acima de 180 e recurso
	// sobrando. Só uma delas não basta — pop alta sem recurso deixaria fundações paradas,
	// e recurso sobrando com pop baixa é justamente quando terminar rápido importa mais.
	const estado = GetSimState().players[Engine.GetPlayerID()];
	const res = estado ? estado.resourceCounts : null;
	const folgado = !!res && (+res.wood || 0) >= PUDIM_QUARTEL_FOLGA &&
	                (+res.stone || 0) >= PUDIM_QUARTEL_FOLGA / 3;
	const popAlta = (d._dbg && d._dbg.pop || 0) > PUDIM_QUARTEL_POP_PARALELO;
	const paralelo = folgado && popAlta;
	const tetoObras = paralelo ? Math.min(PUDIM_QUARTEL_MAX_PARALELO, faltam) : 1;

	if (d.emObra >= tetoObras) {
		// Já há obra em andamento: no regime sequencial isto é o freio inteiro.
		parar("obra em andamento", d.emObra + " de teto " + tetoObras);
		return;
	}

	if (!d.builderIds || d.builderIds.length === 0 ||
	    !d.candidatePositions || d.candidatePositions.length === 0) {
		parar(!d.builderIds || !d.builderIds.length ? "sem trabalhador livre" : "sem posicao candidata",
			"pool=" + ((d._dbg && d._dbg.pool) || "?") + " cands=" + (d.candidatePositions || []).length);
		return;
	}

	// Valida a posição com o mesmo preview que o jogo usa ao posicionar à mão, então
	// terreno, sobreposição e território são checados pelo motor e não por conta própria.
	let escolhida = null;
	for (const pos of d.candidatePositions) {
		if (pudim_IsCancelledSpot(pos.x, pos.z)) continue;
		let r = null;
		try {
			r = Engine.GuiInterfaceCall("SetBuildingPlacementPreview", {
				"template": d.template, "x": pos.x, "z": pos.z, "angle": 0, "actorSeed": 0
			});
		} catch (e) {}
		if (r && r.success) { escolhida = pos; break; }
	}
	try { Engine.GuiInterfaceCall("SetBuildingPlacementPreview", { "template": "" }); } catch (e) {}
	if (!escolhida) {
		parar("nenhuma das " + d.candidatePositions.length + " posicoes foi aceita pelo motor");
		return;
	}

	Engine.PostNetworkCommand({
		"type": "construct",
		"entities": d.builderIds,
		"template": d.template,
		"x": escolhida.x,
		"z": escolhida.z,
		"angle": 0,
		"actorSeed": 0,
		"autorepair": true,
		"autocontinue": true,
		"queued": false
	});
	pudim_MarkModBuilt(escolhida.x, escolhida.z);
	// Guardado para o ciclo seguinte conferir se isto virou fundacao de verdade.
	st.ultimoPonto = { x: escolhida.x, z: escolhida.z };
	st.progresso = d.prontos + d.emObra;
	// Protege a equipe enquanto ela constrói, senão o despacho a puxa de volta para o
	// recurso no tique seguinte e a obra fica sem ninguém.
	st.equipe = d.builderIds.slice();
	for (const id of d.builderIds)
		pudim_ProtectBuilder(id, agora + 60000);

	st.ultima = agora;
	const distCC = (d._dbg && d._dbg.ccx !== undefined)
		? Math.round(Math.sqrt(Math.pow(escolhida.x - d._dbg.ccx, 2) +
		                       Math.pow(escolhida.z - d._dbg.ccz, 2))) : -1;
	pudim_Log("INFO", "QUARTEL", pudim_QuartelNome(tipo) + " ordenado em (" +
		escolhida.x.toFixed(0) + "," + escolhida.z.toFixed(0) + ") a " + distCC + "m do CC com " +
		d.builderIds.length + " trabalhador(es) (" +
		((d._dbg && d._dbg.herdados) || 0) + " da equipe anterior) — faltam " + faltam +
		(paralelo ? " [paralelo: pop " + d._dbg.pop + " e recurso sobrando]" : " [em série]"));
}


// ─── Estimador de combate: colapsa e expande ──────────────────────────────────────────
//
// Pedido de 25/08: "estimador de combate deixar compactado, e ao clicar no titulo expande e
// ao clicar de novo colapsa".
//
// Ele ocupava 182px do painel o tempo todo — mais que qualquer outra seção — para um número
// que fica em zero na maior parte da partida. Nasce colapsado.
//
// O 0 A.D. não tem contêiner que encolha sozinho: cada objeto tem posição absoluta dentro
// do painel. Então colapsar é esconder o miolo E subir tudo que vem abaixo. As posições de
// origem ficam nesta tabela porque ler `.size` de volta e reinterpretar a string
// ("8 602 100%-8 622") seria frágil — a parte horizontal é texto com porcentagem.
const PUDIM_COMBAT_ALTURA = 182;   // 234 (fim do miolo) menos 52 (fim do título)

/** Objetos do miolo do estimador: somem quando colapsado. */
const PUDIM_COMBAT_MIOLO = [
	"pudim_combatFlash", "pudim_allyCount", "pudim_enemyCount", "pudim_allyHP",
	"pudim_enemyHP", "pudim_allyDPS", "pudim_enemyDPS", "pudim_allyTypes1",
	"pudim_allyTypes2", "pudim_winChanceLabel", "pudim_winChanceBar",
	"pudim_winChanceBg", "pudim_winChancePct",
	"pudim_counterHint", "pudim_combatRefreshBtn"
];

const PUDIM_ABAIXO_DO_COMBATE = [
	"pudim_autoWorkHeader", "pudim_autoWorkDesc", "pudim_autoWorkToggle",
	"pudim_autoWorkStatus", "pudim_priorityHeaderLabel", "pudim_foodLabel", "pudim_foodMinus",
	"pudim_foodPlus", "pudim_foodVal", "pudim_woodLabel", "pudim_woodMinus", "pudim_woodPlus",
	"pudim_woodVal", "pudim_stoneLabel", "pudim_stoneMinus", "pudim_stonePlus",
	"pudim_stoneVal", "pudim_metalLabel", "pudim_metalMinus", "pudim_metalPlus",
	"pudim_metalVal", "pudim_sendIdleNowBtn", "pudim_repeatHeader", "pudim_repeatDesc",
	"pudim_repeatStatus", "pudim_stopAllRepeatBtn", "pudim_quartelHeader", "pudim_quartelQtd",
	"pudim_quartelTipo", "pudim_quartelBtn", "pudim_toggleAutoHouseBtn", "pudim_panicStatus",
	"pudim_serieRot0", "pudim_serieX0", "pudim_serieRot1", "pudim_serieX1",
	"pudim_serieRot2", "pudim_serieX2", "pudim_serieRot3", "pudim_serieX3",
	"pudim_serieRot4", "pudim_serieX4", "pudim_serieRot5", "pudim_serieX5",
	"pudim_backToWorkBtn2", "pudim_selectWarriorsBtn",
	"pudim_optionsHint", "pudim_unitHeader", "pudim_unitLabel0",
	"pudim_unitMinus0", "pudim_unitPlus0", "pudim_unitVal0", "pudim_unitVazio",
	"pudim_unitLabel1", "pudim_unitMinus1", "pudim_unitPlus1", "pudim_unitVal1",
	"pudim_unitLabel2", "pudim_unitMinus2", "pudim_unitPlus2", "pudim_unitVal2",
	"pudim_unitLabel3", "pudim_unitMinus3", "pudim_unitPlus3", "pudim_unitVal3",
	"pudim_unitLabel4", "pudim_unitMinus4", "pudim_unitPlus4", "pudim_unitVal4",
	"pudim_unitLabel5", "pudim_unitMinus5", "pudim_unitPlus5", "pudim_unitVal5",
	"pudim_unitLabel6", "pudim_unitMinus6", "pudim_unitPlus6", "pudim_unitVal6"
];

var g_PudimCombatAberto = false;

/** Posições de origem, com o estimador ABERTO. Preenchido na primeira passada. */
var g_PudimYBase = null;
var g_PudimPainelBaseBottom = null;

function pudim_ToggleCombatBox()
{
	g_PudimCombatAberto = !g_PudimCombatAberto;
	pudim_AplicarCombatBox();
}

function pudim_AplicarCombatBox()
{
	// Guarda as posições originais uma vez. Ler agora, e não no toggle, evita gravar
	// posições já deslocadas caso alguém chame o toggle duas vezes seguidas.
	// GUARDA NUMEROS, NAO O OBJETO. O `size` devolvido pelo motor e VIVO — gui/hotkeys/
	// HotkeyPicker.js le `.size` e escreve `.top` direto, sem reatribuir. Guardar a
	// referencia faria a tabela de base mudar junto com o primeiro deslocamento, e o
	// segundo clique somaria em cima do valor ja deslocado.
	if (!g_PudimYBase)
	{
		g_PudimYBase = {};
		for (const nome of PUDIM_ABAIXO_DO_COMBATE)
		{
			const o = Engine.TryGetGUIObjectByName(nome);
			if (!o) continue;
			try { g_PudimYBase[nome] = { top: o.size.top, bottom: o.size.bottom }; } catch (e) {}
		}
	}

	for (const nome of PUDIM_COMBAT_MIOLO)
	{
		const o = Engine.TryGetGUIObjectByName(nome);
		if (o) try { o.hidden = !g_PudimCombatAberto; } catch (e) {}
	}

	const desloca = g_PudimCombatAberto ? 0 : -PUDIM_COMBAT_ALTURA;
	for (const nome in g_PudimYBase)
	{
		const o = Engine.TryGetGUIObjectByName(nome);
		if (!o) continue;
		const b = g_PudimYBase[nome];
		// Mexer so no eixo vertical: a parte horizontal tem porcentagem e nao precisa mudar.
		try { const sz = o.size; sz.top = b.top + desloca; sz.bottom = b.bottom + desloca;
		      o.size = sz; } catch (e) {}
	}

	const lbl = Engine.TryGetGUIObjectByName("pudim_combatHeaderLabel");
	if (lbl) try {
		lbl.caption = (g_PudimCombatAberto ? "▼ " : "▶ ") + pudim_T("cap.combatHeader");
	} catch (e) {}

	// O painel encolhe junto: moldura vazia sobre o mapa atrapalha a visão.
	// O painel encolhe junto: moldura vazia sobre o mapa atrapalha a visao. Guardado na
	// primeira passada pelo mesmo motivo do resto — o objeto de size e vivo.
	if (g_PudimPainelBaseBottom === null) {
		const p0 = Engine.TryGetGUIObjectByName("pudim_mainPanel");
		if (p0) try { g_PudimPainelBaseBottom = p0.size.bottom; } catch (e) {}
	}
	const painel = Engine.TryGetGUIObjectByName("pudim_mainPanel");
	if (painel && g_PudimPainelBaseBottom !== null) try {
		const sz = painel.size;
		sz.bottom = g_PudimPainelBaseBottom + desloca;
		painel.size = sz;
	} catch (e) {}
}


// ─── Proporção de unidades ────────────────────────────────────────────────────────────
//
// Pedido de 25/08: "faz um pra construir automaticamente unidades... pra balancear elas...
// ai a gente coloca as proporções, tem que aparecer na lista todas que estão disponíveis no
// momento".
//
// Funciona igual às prioridades de coleta: peso por tipo, e o mod treina primeiro quem está
// mais atrás da sua fatia. A diferença é que a lista é DINÂMICA — o que dá para treinar
// muda quando um quartel sobe, quando um estábulo sobe, quando a fase muda. Ela é
// perguntada aos edifícios de pé, não escrita no código.
//
// Peso zero significa "não treine isto", igual em coleta. Todos começam em zero: o mod não
// deve escolher exército pelo jogador — ele mantém a proporção QUE O JOGADOR pediu.
// 5 vagas: as duas ultimas pagaram as fileiras da lista de series (02/09). A ordenacao
// poe os tipos COM PESO na frente, entao o que o jogador configurou nunca some.
const PUDIM_UNIT_LINHAS = 5;
var g_PudimUnitPesos = {};      // tpl -> peso 0..10, escolha do jogador
var g_PudimUnitLista = [];      // o que a simulação devolveu na última leitura
var g_PudimUnitAccum = 0;
var g_PudimUnitVazioLogAt = 0;  // ver o diagnostico de lista vazia em pudim_AtualizarUnidades

function pudim_UnitWeightDelta(linha, delta)
{
	const u = g_PudimUnitLista[linha];
	if (!u) return;
	const atual = g_PudimUnitPesos[u.tpl] || 0;
	const novo = Math.max(0, Math.min(10, atual + delta));
	g_PudimUnitPesos[u.tpl] = novo;
	pudim_DesenharUnidades();
}

function pudim_AtualizarUnidades()
{
	let d;
	try { d = Engine.GuiInterfaceCall("pudim_GetTrainableUnits", {}); }
	catch (e) { return; }
	if (!d || !d.unidades) return;

	// Cabem sete linhas. Com mais tipos disponíveis, os que o jogador já pesou vêm primeiro
	// — esconder justamente o que ele configurou seria o pior corte possível.
	let lista = d.unidades.slice();
	lista.sort(function(a, b) {
		const pa = g_PudimUnitPesos[a.tpl] || 0, pb = g_PudimUnitPesos[b.tpl] || 0;
		if (pa !== pb) return pb - pa;
		return a.tpl < b.tpl ? -1 : (a.tpl > b.tpl ? 1 : 0);
	});
	// NOME TRADUZIDO, E SEM AMBIGUIDADE.
	//
	// Dois problemas que o jogador viu na mesma tela: "os nomes das unidades esta em ingles"
	// e "Plebeian esta 2x".
	//
	// O primeiro: eu lia Identity.GenericName do template CRU, que e o texto-fonte em
	// ingles. GetTemplateData devolve o nome ja traduzido — e o proprio mod ja usava esse
	// caminho em outro lugar, no aviso de "sem recursos para repetir a construcao".
	//
	// O segundo: nomes genericos SE REPETEM de proposito no 0 A.D. Varias unidades romanas
	// se chamam "Plebeu"; o que as distingue e o nome especifico. Entao quando o generico
	// aparece mais de uma vez, o especifico entra junto — mostrar duas linhas identicas e
	// pior do que nao mostrar nada, porque o jogador clica numa achando que e a outra.
	// SÓ O QUE DÁ PARA TREINAR AGORA.
	//
	// Relato do jogador, com apenas um centro cívico: "está mostrando unidades que ainda não
	// podemos construir". Ele tem razão, e a causa está no motor: Trainer.GetEntitiesList()
	// devolve TUDO que o edifício pode treinar algum dia — CalculateEntitiesMap só trata
	// substituição de civ e templates desabilitados, não fase nem tecnologia. Quem cinza os
	// botões na interface do jogo é outra checagem, AreRequirementsMet, e é ela que falta
	// aqui (gui/session/selection_panels.js usa exatamente assim).
	//
	// Sem esse filtro o jogador vê campeão na lista aos cinco minutos e ajusta uma proporção
	// que não vai sair.
	const jogador = Engine.GetPlayerID();
	const disponivel = function(tpl) {
		try {
			const td = GetTemplateData(tpl);
			if (!td) return false;
			if (!td.requirements) return true;
			return !!Engine.GuiInterfaceCall("AreRequirementsMet",
				{ "requirements": td.requirements, "player": jogador });
		} catch (e) { return true; }   // na dúvida, mostra: esconder demais é pior
	};
	const antes = lista.length;
	lista = lista.filter(u => disponivel(u.tpl));
	if (g_PudimShowDebug && antes !== lista.length)
		pudim_Log("DEBUG", "UNIDADES", (antes - lista.length) + " tipo(s) fora por requisito");

	// LISTA VAZIA COM EDIFICIO DE PE E UM DEFEITO, NAO UM ESTADO.
	//
	// Relato de 01/09, partida nomad: "falando que nao tem nada pra treinar", com o centro
	// civico erguido e treinando na tela. Com o log de entao nao dava para saber se a
	// simulacao nao achou edificio nenhum ou se o filtro de requisito comeu tudo — as duas
	// causas produzem exatamente a mesma tela.
	//
	// Esta linha separa as duas. `edificios` e quantos edificios com IID_Trainer a simulacao
	// encontrou; `antes` e quantos tipos vieram dali; `depois` e o que sobrou do filtro:
	//
	//   edificios=0            -> a simulacao nao ve o edificio (nomad? fundacao? ownership?)
	//   edificios>0 antes=0    -> o edificio existe mas Trainer.GetEntitiesList veio vazia
	//   antes>0 depois=0       -> AreRequirementsMet recusou tudo
	//
	// Throttle de 20s: o caso interessante e persistente, e repetir a cada 4s so repetiria o
	// erro que acabei de corrigir no log do balanceamento inicial.
	if (!lista.length) {
		const agoraU = Date.now();
		if (agoraU - g_PudimUnitVazioLogAt > 20000) {
			g_PudimUnitVazioLogAt = agoraU;
			pudim_Log("WARN", "UNIDADES", "nada para treinar: edificios=" +
				((d._dbg && d._dbg.edificios) || 0) + " antes=" + antes + " depois=0");
		}
	}

	// NOME TRADUZIDO, E SEM AMBIGUIDADE. Ver o comentário abaixo.
	const nomes = {};
	for (const u of lista) {
		let g = u.nome, e = "";
		try {
			const td = GetTemplateData(u.tpl);
			if (td && td.name) {
				if (td.name.generic) g = td.name.generic;
				if (td.name.specific) e = td.name.specific;
			}
		} catch (err) {}
		u.nomeGenerico = g;
		u.nomeEspecifico = e;
		nomes[g] = (nomes[g] || 0) + 1;
	}
	for (const u of lista)
		u.nome = (nomes[u.nomeGenerico] > 1 && u.nomeEspecifico && u.nomeEspecifico !== u.nomeGenerico)
			? u.nomeGenerico + " (" + u.nomeEspecifico + ")"
			: u.nomeGenerico;

	g_PudimUnitLista = lista.slice(0, PUDIM_UNIT_LINHAS);
	g_PudimUnitTodas = lista;
	pudim_DesenharUnidades();
}

function pudim_DesenharUnidades()
{
	for (let i = 0; i < PUDIM_UNIT_LINHAS; i++)
	{
		const u = g_PudimUnitLista[i];
		const mostra = !!u;
		for (const parte of ["Label", "Minus", "Val", "Plus"])
		{
			const o = Engine.TryGetGUIObjectByName("pudim_unit" + parte + i);
			if (o) try { o.hidden = !mostra; } catch (e) {}
		}
		if (!mostra) continue;
		const lbl = Engine.TryGetGUIObjectByName("pudim_unitLabel" + i);
		const val = Engine.TryGetGUIObjectByName("pudim_unitVal" + i);
		// Quantas existem entra no rótulo: sem esse número o jogador ajusta a proporção às
		// cegas, sem saber o que já tem.
		if (lbl) try { lbl.caption = u.nome + " (" + u.existentes + ")"; } catch (e) {}
		if (val) try { val.caption = String(g_PudimUnitPesos[u.tpl] || 0); } catch (e) {}
	}
	const vazio = Engine.TryGetGUIObjectByName("pudim_unitVazio");
	if (vazio) try { vazio.hidden = g_PudimUnitLista.length > 0; } catch (e) {}
}

/**
 * Qual unidade está mais atrás da proporção pedida — ou null se nenhuma foi pesada.
 *
 * Mesma conta das prioridades de coleta: peso não é quantidade, é fatia. Com lanceiro 3 e
 * arqueiro 1, de cada 4 unidades 3 são lanceiros. Quem tem a maior falta relativa vem
 * primeiro; empate desempata por peso, para o que o jogador priorizou sair antes.
 */
/**
 * A unidade mais atrasada em relacao a proporcao configurada.
 *
 * permitidos  limita ao que AQUELE edificio treina. Sem isso a mais atrasada podia ser
 *             cavalaria enquanto o edificio da vez era um quartel — a checagem seguinte
 *             recusava e o mod caia no palpite antigo. No log de 25/08 o quartel 6177
 *             semeou infantry_spearman_b vinte vezes seguidas com prop=on, porque a mais
 *             atrasada NO GERAL era cavalry_spearman_b.
 *
 * descontos   {tpl: n} — quantos tirar da fila antes de contar. Serve para perguntar "e se
 *             este lote nao existisse?", que e a unica forma de decidir cancelamento sem
 *             entrar em loop (ver pudim_ProporcaoTrocaria).
 *
 * preferido   desempate: com falta igual, fica quem ja estava. Sem isso duas unidades de
 *             mesmo peso alternam o alvo a cada ciclo, que foi o "as vezes n troca as
 *             unidades" — trocava tanto que nunca terminava nenhuma.
 */
function pudim_ProporcaoAlvo(permitidos, descontos, preferido)
{
	const pesadas = (g_PudimUnitTodas || [])
		.filter(u => (g_PudimUnitPesos[u.tpl] || 0) > 0)
		.filter(u => !permitidos || permitidos.indexOf(u.tpl) >= 0);
	if (!pesadas.length) return null;

	const conta = function(u) {
		const desc = (descontos && descontos[u.tpl]) || 0;
		return u.existentes + Math.max(0, u.emFila - desc);
	};

	let somaPeso = 0, total = 0;
	for (const u of pesadas) {
		somaPeso += g_PudimUnitPesos[u.tpl];
		total += conta(u);   // a fila conta: senao pede a mesma de novo
	}
	if (somaPeso <= 0) return null;
	// Sem nenhuma ainda, o alvo de todos e zero e a falta empata. Trata como se houvesse uma
	// a distribuir, para a de maior peso sair primeiro em vez de a ordem alfabetica decidir.
	const base = Math.max(total, 1);

	let melhor = null, maiorFalta = -Infinity;
	for (const u of pesadas) {
		const falta = base * (g_PudimUnitPesos[u.tpl] / somaPeso) - conta(u);
		let ganha = falta > maiorFalta + 0.001;
		if (!ganha && melhor && Math.abs(falta - maiorFalta) <= 0.001) {
			if (preferido && u.tpl === preferido) ganha = true;
			else if (!(preferido && melhor.tpl === preferido))
				ganha = g_PudimUnitPesos[u.tpl] > g_PudimUnitPesos[melhor.tpl];
		}
		if (ganha) { maiorFalta = falta; melhor = u; }
	}
	return melhor;
}

function pudim_UnidadeMaisAtrasada(permitidos, preferido)
{
	return pudim_ProporcaoAlvo(permitidos, null, preferido || null);
}

/**
 * Vale a pena cancelar `naFila` lotes de `semeado` neste edificio para trocar de unidade?
 *
 * A pergunta e feita COM O LOTE JA DESCONTADO, e e isso que quebra o ciclo. Contando o lote,
 * semear 5 escaramurcadores empurra a falta para o espadachim; no ciclo seguinte o mod
 * cancela os 5, o que devolve a falta ao escaramurcador, e recomeca. No log de 25/08 isso
 * aparece como cancelamentos em 227s e 330s sem nenhuma unidade ter saido no meio.
 *
 * Descontado o lote, a pergunta vira "se eu nao tivesse enfileirado nada, o que pediria
 * agora?". Se a resposta continua sendo o proprio semeado, nao ha o que trocar — e o
 * desempate por `preferido` garante que empate tambem fica parado.
 */
function pudim_ProporcaoTrocaria(permitidos, semeado, naFila)
{
	const descontos = {};
	descontos[semeado] = naFila;
	const alvo = pudim_ProporcaoAlvo(permitidos, descontos, semeado);
	return alvo && alvo.tpl !== semeado ? alvo : null;
}

var g_PudimUnitTodas = [];

/** Há alguma proporção configurada? Com tudo zerado, este sistema inteiro fica fora. */
/**
 * Por que a proporcao escolheu o que escolheu.
 *
 * "so ta fazendo escaramurcador, nenhum espadachin", com peso 1 nos dois e o espadachim em
 * zero. Pela conta, a falta do espadachim so cresce e ele teria de sair na frente — entao
 * ou ele nao esta chegando ate a conta, ou esta e alguma premissa minha esta errada.
 *
 * Ja gastei tres hipoteses nisto por inspecao (lista filtrada por requisito, sufixo de
 * patente diferente entre as duas fontes, memoria de escolha do jogador travada) e nenhuma
 * se sustentou ao ler o codigo. O que decidiu todos os casos anteriores foi medir, entao e
 * o que vai decidir este: uma linha por edificio dizendo QUEM concorreu, com peso, quantos
 * existem, quantos estao na fila e a falta de cada um.
 *
 * Se o espadachim aparecer com falta alta e mesmo assim nao for escolhido, o erro esta na
 * escolha. Se nao aparecer na lista, esta em quem monta a lista — e o campo `treina` diz
 * qual das duas, porque mostra se o edificio declara saber treina-lo.
 */
var g_PudimPropDiagUltimo = {};
function pudim_ProporcaoDiag(b, escolhida)
{
	if (!g_PudimShowDebug || !pudim_ProporcaoAtiva()) return;
	const agora = Date.now();
	if (agora - (g_PudimPropDiagUltimo[b.ent] || 0) < 20000) return;
	g_PudimPropDiagUltimo[b.ent] = agora;

	const permitidos = b.trainerEntities || [];
	const partes = [];
	for (const u of (g_PudimUnitTodas || [])) {
		const peso = g_PudimUnitPesos[u.tpl] || 0;
		if (!peso) continue;
		partes.push(u.tpl.split("/").pop() +
			" p" + peso + " tem" + u.existentes + " fila" + u.emFila +
			(permitidos.indexOf(u.tpl) >= 0 ? " treina=sim" : " treina=NAO"));
	}
	pudim_Log("DEBUG", "PROP", "edifício " + b.ent + " escolheu " +
		(escolhida ? escolhida.tpl.split("/").pop() : "NADA") +
		" | pesados: " + (partes.join(" ; ") || "nenhum") +
		" | treinaveis do edifício: " + permitidos.length);
}

function pudim_ProporcaoAtiva()
{
	for (const tpl in g_PudimUnitPesos)
		if (g_PudimUnitPesos[tpl] > 0) return true;
	return false;
}

// Teto do lote. O ganho por unidade continua subindo além de 10 (0,44x em 15, 0,41x em 20),
// mas duas coisas pioram junto: o lote inteiro só ENTREGA quando termina, então um lote de
// 20 segura a primeira unidade por 8,14 tempos de treino; e ele tranca os recursos enquanto
// isso, inclusive os que as fazendas — prioridade máxima — podem precisar.
const PUDIM_LOTE_MAX = 10;
// Teto so da CONTA de quanto o estoque paga — nao e tamanho de lote. Existe porque
// pudim_ComputeAffordableCount precisa de um limite superior, e este tem de ser alto o
// bastante para nunca ser ele a decidir o lote (quem decide e PUDIM_LOTE_MAX, depois).
const PUDIM_LOTE_TETO_CONTA = 500;

/**
 * Tamanho do lote de treino.
 *
 * Pedido de 25/08: "sempre treine em lotes, se tiver recursos, assim a proporção
 * tempo/unidades é mais rapido. faça o tamanho do lote de treinamento proporcional a
 * quantidade de locais que podem treinar e a quantidade de recursos disponiveis".
 *
 * O ganho é real e está no motor, não é impressão: Trainer.GetBatchTime devolve
 * `batchSize ^ BatchTimeModifier`, com o modificador em 0.7 por padrão
 * (simulation/components/Trainer.js). Ou seja, o tempo TOTAL de um lote de N é N^0,7 vezes o
 * tempo de uma — e o tempo POR UNIDADE cai como N^-0,3:
 *
 *     lote  2  ->  0,81x por unidade   (19% mais rápido)
 *     lote  5  ->  0,62x               (38%)
 *     lote 10  ->  0,50x               (50%)
 *
 * Dividir pelo número de edifícios é o que impede o primeiro a ser atendido de comer o
 * estoque inteiro: todos enfileiram no mesmo tique, então cada um pode contar com a sua
 * fatia, não com o total.
 *
 * `res` já vem com a madeira reservada para as fazendas descontada, então o lote cede
 * sozinho quando a comida está atrasada — sem precisar saber que a regra existe.
 */
/**
 * Por que o lote deu esse tamanho. So para o log; nao decide nada.
 *
 * Existe porque "esta treinando de 1 em 1" nao da para diagnosticar por inspecao: o tamanho
 * sai de quatro coisas (estoque, reserva das fazendas, numero de edificios, proporcao ligada
 * ou nao) e so o numero final aparecia no log.
 */
function pudim_LoteDiag(template, res, buildings)
{
	try {
		if (!template) return "lote=1 sem-template";
		const paga = pudim_ComputeAffordableCount(template, PUDIM_LOTE_TETO_CONTA, res || {});
		return "lote=" + pudim_LoteIdeal(template, res, buildings) +
			" paga=" + paga + " treinam=" + pudim_QuantosTreinam(template, buildings) +
			" edif=" + (buildings ? buildings.length : 0) +
			" prop=" + (pudim_ProporcaoAtiva() ? "on" : "off") +
			" reserva=" + g_PudimMadeiraReservada +
			" w=" + Math.round(+(res && res.wood) || 0) +
			" f=" + Math.round(+(res && res.food) || 0);
	} catch (e) { return "diag?"; }
}

/**
 * Quantos edificios disputam o estoque para ESTE template.
 *
 * Nao e buildings.length. A lista vem de pudim_GetProductionBuildings, que aceita tudo que
 * tem IID_ProductionQueue — e no 0 A.D. quase toda construcao tem, porque ProductionQueue
 * tambem serve para PESQUISAR TECNOLOGIA. Casa, armazem e celeiro entravam na conta. No log
 * de 25/08 isso deu edif=15 com um centro civico e um quartel em pe.
 */
function pudim_QuantosTreinam(template, buildings)
{
	if (!template || !buildings || !buildings.length) return 1;
	let n = 0;
	for (const b of buildings)
		if ((b.trainerEntities || []).indexOf(template) >= 0) n++;
	return Math.max(1, n);
}

/**
 * O tamanho do lote: o que o estoque paga, dividido entre quem vai gastar dele.
 *
 * "esta treinando de 1 em 1, ao inves de fazer em lote pra otimizar o tempo". A versao
 * anterior dividia `cabe`, que JA vinha limitado a PUDIM_LOTE_MAX. Com 10 disponiveis e 15
 * edificios na conta, floor(10/15) = 0 e o lote caia para 1 — e piorava a cada construcao
 * nova, justamente quando havia mais recursos. Dividir um valor ja limitado nao significa
 * nada: quem tem de ser dividido e quanto o estoque REALMENTE paga, e o teto entra depois.
 *
 * O ganho que isso persegue e real: GetBatchTime(n) = n^0.7, entao o tempo por unidade cai
 * com n^-0.3 — lote de 5 sai 38% mais rapido por unidade, lote de 10, 50%.
 */
function pudim_LoteIdeal(template, res, buildings)
{
	if (!template) return 1;
	const paga = pudim_ComputeAffordableCount(template, PUDIM_LOTE_TETO_CONTA, res || {});
	const porEdificio = Math.floor(paga / pudim_QuantosTreinam(template, buildings));
	return Math.max(1, Math.min(PUDIM_LOTE_MAX, porEdificio));
}


function pudim_ProcessAutoKite()
{
	const now = Date.now();

	// Limpar entradas expiradas (3s de cooldown por unidade)
	// 3s deixava a mesma unidade ser reposicionada sem parar: no replay de 24/08 as mais
	// afetadas levaram 9 ou 10 walks em 100s, e cada walk cancela o ataque em curso. Com o
	// gatilho novo (baseado no alcance do AMEACANTE) o recuo ja e grande o bastante para
	// nao reabrir sozinho; 6s cobrem a caminhada ate o destino antes de reavaliar.
	for (const ent in g_PudimKiting)
		if (now - g_PudimKiting[ent] > 6000)
			delete g_PudimKiting[ent];

	let kiteData;
	try
	{
		kiteData = Engine.GuiInterfaceCall("pudim_GetAutoKiteData",
			{ "kiting": g_PudimKiting, "playerOrdered": pudim_GetPlayerOrderedIds() });
	}
	catch (e) { return; }

	if (!kiteData || kiteData.length === 0)
		return;

	for (const item of kiteData)
	{
		// O cooldown de 6s do kite so via o proprio kite. Fuga e retirada mandavam walk na
		// mesma unidade sem que ele soubesse, e cada walk cancela o anterior: 65% das
		// reordenacoes aconteciam em menos de 6s no replay de 24/08.
		if (!pudim_PodeAndar(item.ent, PUDIM_ANDAR_KITE, now))
			continue;
		Engine.PostNetworkCommand({
			"type": "walk",
			"entities": [item.ent],
			"x": item.x,
			"z": item.z,
			"queued": false
		});
		pudim_RegistrarAndada(item.ent, PUDIM_ANDAR_KITE, now);
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
