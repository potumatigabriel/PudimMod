/**
 * PudimMod - session~pudim.js
 *
 * Hook principal na sessão de jogo do 0 A.D.
 * Conecta o painel do PudimMod ao ciclo de vida da sessão usando
 * pudim_patchApplyN (gui/common/!!!pudim_patchApplyN.js), nosso próprio wrapper.
 *
 * Funções patcheadas:
 *  - init()    → inicializa o painel após todos os sistemas carregarem
 *  - onTick()  → chama o tick do PudimMod a cada frame do jogo
 */

// ─── Hook de Inicialização ─────────────────────────────────────────────────────

pudim_patchApplyN("init", function(target, that, args)
{
	const result = target.apply(that, args);

	// Inicializar o painel do PudimMod após o init base da sessão
	try
	{
		pudim_Init();
	}
	catch (e)
	{
		warn("[PudimMod] Erro ao inicializar: " + e);
	}

	// Patchear updateUnitCommands dinamicamente, pois unit_commands.js carrega depois de session~pudim.js
	try
	{
		pudim_patchApplyN("updateUnitCommands", function(targetUpdate, thatUpdate, argsUpdate)
		{
			const resUpdate = targetUpdate.apply(thatUpdate, argsUpdate);
			try
			{
				pudim_UpdateSelectionButton();
			}
			catch (err)
			{
				// Silencioso
			}
			return resUpdate;
		});
	}
	catch (e)
	{
		warn("[PudimMod] Erro ao patchear updateUnitCommands: " + e);
	}

	return result;
});

// ─── Hook de Tick ──────────────────────────────────────────────────────────────

// Controle de tempo para o tick do PudimMod
var g_PudimLastTickTime = 0;

pudim_patchApplyN("onTick", function(target, that, args)
{
	let result;
	try { result = target.apply(that, args); } catch(e) {}

	// Balanceamento inicial no primeiro tick de jogo (tempo < 3 segundos, retry até conseguir)
	try
	{
		// Janela de 25s (era 3s): em partida online o relógio da simulação só anda depois que
		// todos carregam, e as unidades iniciais podem demorar a aparecer para a GUI — com 3s
		// esta tentativa rápida já tinha expirado antes de haver o que despachar.
		if (!g_PudimInitialBalanceDone && g_SimState && g_SimState.timeElapsed < 25000)
		{
			if (pudim_ExecuteInitialBalance())
				g_PudimInitialBalanceDone = true;
		}
	}
	catch (err) {}

	// Calcular delta de tempo desde o último tick
	const now = Date.now();
	const dt = g_PudimLastTickTime > 0 ? (now - g_PudimLastTickTime) : 100;
	g_PudimLastTickTime = now;

	// Chamar o tick do PudimMod
	try
	{
		pudim_Tick(dt);
	}
	catch (e)
	{
		// Silencioso para não poluir o console durante o jogo
	}

	return result;
});

// ─── Ordens MANUAIS do jogador ────────────────────────────────────────────────

/**
 * handleUnitAction(position, action) é o funil por onde passa TODA ordem que o jogador
 * dá às suas unidades (clique direito e botões de ação) — verificado em
 * gui/session/input.js:1303 do jogo, que resolve a seleção com g_Selection.toList().
 *
 * Marcamos as unidades da seleção como "sob ordem do jogador". Enquanto estiverem
 * executando essa ordem, nenhum sistema do mod as toca. Quando ficarem ociosas, o mod
 * volta a assumi-las (a checagem de ocioso é feita no lado da simulação).
 *
 * Sem isto o mod sobrepunha o comando do jogador: no replay 0013 foram 633 comandos
 * "gather" (contra 136 de um humano sem mod) — cada ordem nova zerando a anterior.
 */
pudim_patchApplyN("handleUnitAction", function(target, that, args)
{
	try
	{
		if (typeof g_Selection !== "undefined" && g_Selection)
		{
			const now = Date.now();
			for (const ent of g_Selection.toList())
				g_PudimPlayerOrders[ent] = now;
		}
	}
	catch (e) {}

	return target.apply(that, args);
});

// ─── Hook de Mudança de Seleção ───────────────────────────────────────────────

/**
 * Monitora mudanças de seleção para atualizar o painel de Repetir Construção.
 * Usamos o padrão de patchear onSimulationUpdate que é chamado após cada
 * atualização da simulação (inclui mudanças de seleção).
 */
pudim_patchApplyN("onSimulationUpdate", function(target, that, args)
{
	let result;
	try { result = target.apply(that, args); } catch(e) {}

	try
	{
		if (g_PudimPanelOpen)
			pudim_OnSelectionChange();
	}
	catch (e)
	{
		// Silencioso
	}

	return result;
});

// ─── Hook para Botão de Repetir Construção no Painel de Seleção ────────────────

/**
 * Atualiza o estado, visibilidade, tooltip e ação do botão "Repetir Construção"
 * no painel inferior de seleção (ao lado das stances).
 */
function pudim_UpdateSelectionButton()
{
	const btn = Engine.GetGUIObjectByName("unitPudimRepeatButton");

	const selection = g_Selection ? g_Selection.toList() : [];
	if (!selection.length)
	{
		if (btn) btn.hidden = true;
		const pnlR = Engine.TryGetGUIObjectByName("pudimScoutPanelRight");
		if (pnlR) pnlR.hidden = true;
		return;
	}

	const player = Engine.GetPlayerID();
	const controllable = selection.every(ent => {
		const state = GetEntityState(ent);
		return state && state.player === player && state.unitAI && !hasClass(state, "Animal");
	});

	const isCavalry = selection.every(ent => {
		const state = GetEntityState(ent);
		return state && state.identity && state.identity.classes && state.identity.classes.indexOf("Cavalry") !== -1;
	});

	// Scout floating panel: show when cavalry is selected
	const pnlR = Engine.TryGetGUIObjectByName("pudimScoutPanelRight");
	if (pnlR) {
		if (isCavalry && controllable) {
			pnlR.hidden = false;

			let anyLocal = selection.some(ent => g_PudimScouts[ent] === "local");
			let anyDeep  = selection.some(ent => g_PudimScouts[ent] === "deep");

			const iconL = Engine.TryGetGUIObjectByName("unitPudimScoutLocalIcon");
			const selL  = Engine.TryGetGUIObjectByName("unitPudimScoutLocalSelection");
			const btnL  = Engine.TryGetGUIObjectByName("unitPudimScoutLocalButton");
			const iconD = Engine.TryGetGUIObjectByName("unitPudimScoutDeepIcon");
			const selD  = Engine.TryGetGUIObjectByName("unitPudimScoutDeepSelection");
			const btnD  = Engine.TryGetGUIObjectByName("unitPudimScoutDeepButton");

			if (iconL) iconL.sprite = anyLocal ? "stretched:session/icons/stances/passive.png" : "grayscale:stretched:session/icons/stances/passive.png";
			if (selL) selL.hidden = !anyLocal;
			if (btnL) btnL.tooltip = "[font=\"sans-bold-13\"]Explorar Base (PudimMod)[/font]\n[font=\"sans-13\"]Explora as redondezas do seu Centro Civico.\n" + (anyLocal ? "[color=\"80 220 80\"]ATIVADO[/color]" : "[color=\"180 180 180\"]DESATIVADO[/color]") + " - Evita batalhas e contorna inimigos.[/font]";

			if (iconD) iconD.sprite = anyDeep ? "stretched:session/icons/stances/aggressive.png" : "grayscale:stretched:session/icons/stances/aggressive.png";
			if (selD) selD.hidden = !anyDeep;
			if (btnD) btnD.tooltip = "[font=\"sans-bold-13\"]Explorar Mapa Profundo (PudimMod)[/font]\n[font=\"sans-13\"]Explora as pontas distantes do mapa sem visao.\n" + (anyDeep ? "[color=\"80 220 80\"]ATIVADO[/color]" : "[color=\"180 180 180\"]DESATIVADO[/color]") + " - Foge de defesas inimigas automaticamente.[/font]";
		} else {
			pnlR.hidden = true;
		}
	}

	// Repeat build button: only for units that can build
	if (!btn) return;

	if (!controllable || typeof getAllBuildableEntitiesFromSelection !== "function")
	{
		btn.hidden = true;
		return;
	}

	const buildableList = getAllBuildableEntitiesFromSelection();
	if (!buildableList || buildableList.length === 0)
	{
		btn.hidden = true;
		return;
	}

	btn.hidden = false;

	const anyActive = selection.some(ent => g_PudimRepeatBuilding && g_PudimRepeatBuilding[ent]);
	const icon = Engine.GetGUIObjectByName("unitPudimRepeatIcon");
	const selOverlay = Engine.GetGUIObjectByName("unitPudimRepeatSelection");

	if (icon)
	{
		if (anyActive)
		{
			icon.sprite = "stretched:session/icons/pudim.png";
			if (selOverlay) selOverlay.hidden = false;
			btn.tooltip = "[font=\"sans-bold-13\"]Repetir Construção (PudimMod)[/font]\n" +
				"[font=\"sans-13\"][color=\"80 220 80\"]ATIVADO para as unidades selecionadas.[/color]\n" +
				"Clique para desativar. Ao terminar uma obra, a unidade colocará a próxima fundação adjacente.[/font]";
		}
		else
		{
			icon.sprite = "grayscale:stretched:session/icons/pudim.png";
			if (selOverlay) selOverlay.hidden = true;
			btn.tooltip = "[font=\"sans-bold-13\"]Repetir Construção (PudimMod)[/font]\n" +
				"[font=\"sans-13\"][color=\"180 180 180\"]DESATIVADO para as unidades selecionadas.[/color]\n" +
				"Clique para ativar. Ao terminar uma obra, a unidade colocará a próxima fundação adjacente.[/font]";
		}
	}

	if (typeof setPanelObjectPosition === "function")
		setPanelObjectPosition(btn, 5, 8);

	btn.onPress = function() {
		pudim_ToggleRepeatBuild();
		pudim_UpdateSelectionButton();
	};
}

var g_PudimScouts = {};              // { entityId: "local" | "deep" }
var g_PudimScoutActivatedAt = {};
var g_PudimScoutTheta = {};
var g_PudimScoutRadius = {};    // { entityId: timestamp } — grace period após ativação

// ─── Scout: Memória de Setores 8×8 ───────────────────────────────────────────

var g_PudimScoutSectors = {};        // "col,row" -> timestamp da última visita
var g_PudimScoutTargets = {};        // entId -> { x, z } alvo atual do setor
var g_PudimScoutLastPos = {};        // entId -> { x, z, stuckCount }
var g_PudimScoutBlocked = {};        // "col,row" -> Infinity (perm) ou timestamp de expiração
var g_PudimScoutTargetTime = {};     // entId -> timestamp de quando o alvo foi atribuído
var g_PudimScoutSameCount = {};      // entId -> vezes seguidas que o mesmo alvo foi escolhido
var g_PudimScoutFleeing = {};        // entId -> true enquanto aguarda área limpar após fuga
var g_PudimScoutClearTicks = {};     // entId -> ticks consecutivos sem perigo (retomar após ≥2)
var g_PudimScoutEnemyBase = null;    // { x, z } base inimiga detectada no modo deep
var PUDIM_SCOUT_GRID = 8;

function pudim_ToggleScout(type) {
	const selection = g_Selection ? g_Selection.toList() : [];
	let toggled = false;
	for (let ent of selection) {
		if (g_PudimScouts[ent] === type) {
			delete g_PudimScouts[ent];
			delete g_PudimScoutTargets[ent];
			delete g_PudimScoutLastPos[ent];
			delete g_PudimScoutActivatedAt[ent];
			delete g_PudimScoutTheta[ent];
			delete g_PudimScoutRadius[ent];
			delete g_PudimScoutFleeing[ent];
			delete g_PudimScoutClearTicks[ent];
			delete g_PudimScoutSameCount[ent];
			Engine.PostNetworkCommand({"type": "stop", "entities": [ent], "queued": false});
		} else {
			g_PudimScouts[ent] = type;
			g_PudimScoutActivatedAt[ent] = Date.now();
			toggled = true;
		}
	}
	pudim_UpdateSelectionButton();
	if (toggled) pudim_ForceScoutTick();
}

var g_LastScoutTick = 0;

function pudim_ForceScoutTick() {
	const now = Date.now();
	if (now - g_LastScoutTick < 1500) return;
	g_LastScoutTick = now;

	const scoutList = Object.keys(g_PudimScouts).map(Number);
	if (scoutList.length === 0) return;

	let statusData;
	try {
		statusData = Engine.GuiInterfaceCall("pudim_GetScoutStatus", { "scouts": g_PudimScouts });
	} catch(e) { return; }

	if (!statusData) return;

	const mapSize = statusData.mapSize || 256;
	const cellSize = mapSize / PUDIM_SCOUT_GRID;
	const ccList = statusData.ccList || [];

	// Limpar bloqueios temporários de patrulhas (expiram pelo timestamp)
	for (const key of Object.keys(g_PudimScoutBlocked)) {
		const v = g_PudimScoutBlocked[key];
		if (v !== Infinity && v < now) delete g_PudimScoutBlocked[key];
	}

	for (const scoutInfo of statusData.scouts) {
		const { ent, idle, pos, inDanger, enemyPos, enemyIsBuilding, enemyIsMobile, orderType } = scoutInfo;
		const mode = g_PudimScouts[ent];

		// Auto-desativar se o jogador deu um comando manual (grace period de 3s após ativação)
		// Flee é gerado pelo motor em combate — não deativar; o scout vai fugir e continuar
		if (orderType && orderType !== "Walk" && orderType !== "Idle" && orderType !== "Stop" && orderType !== "Flee") {
			const activatedAt = g_PudimScoutActivatedAt[ent] || 0;
			if (now - activatedAt > 3000) {
				delete g_PudimScouts[ent];
				delete g_PudimScoutTargets[ent];
				delete g_PudimScoutLastPos[ent];
				delete g_PudimScoutActivatedAt[ent];
				delete g_PudimScoutFleeing[ent];
				delete g_PudimScoutClearTicks[ent];
				delete g_PudimScoutSameCount[ent];
				pudim_UpdateSelectionButton();
				continue;
			}
		}

		// Fuga imediata de ameaças — ignorar qualquer alvo de setor
		if (inDanger) {
			// Estrutura inimiga: blacklist permanente do setor + adjacentes
			if (enemyIsBuilding && enemyPos) {
				const tc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(enemyPos.x / cellSize)));
				const tr = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(enemyPos.z / cellSize)));
				g_PudimScoutBlocked[tc + "," + tr] = Infinity;
				for (let dc = -1; dc <= 1; dc++) {
					for (let dr = -1; dr <= 1; dr++) {
						const nc = tc + dc; const nr = tr + dr;
						if (nc >= 0 && nc < PUDIM_SCOUT_GRID && nr >= 0 && nr < PUDIM_SCOUT_GRID)
							g_PudimScoutBlocked[nc + "," + nr] = Infinity;
					}
				}
				const scCol = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
				const scRow = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
				g_PudimScoutSectors[scCol + "," + scRow] = now;
				// Modo deep: guardar posição da base inimiga para orbitar
				if (mode === "deep") g_PudimScoutEnemyBase = enemyPos;
			}
			// Tropa móvel: blacklist temporária (2 min) do setor atual do scout
			if (enemyIsMobile) {
				const scCol = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
				const scRow = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
				g_PudimScoutBlocked[scCol + "," + scRow] = now + 120000;
			}
			// Fugir na direção oposta ao inimigo (não em direção ao CC)
			let fleeX = pos.x, fleeZ = pos.z;
			if (enemyPos) {
				const angle = Math.atan2(pos.z - enemyPos.z, pos.x - enemyPos.x);
				fleeX = Math.max(15, Math.min(mapSize - 15, pos.x + Math.cos(angle) * 200));
				fleeZ = Math.max(15, Math.min(mapSize - 15, pos.z + Math.sin(angle) * 200));
			} else if (ccList.length > 0) {
				let nearCC = ccList[0], minD = Infinity;
				for (const cc of ccList) {
					const d = (cc.x - pos.x)*(cc.x - pos.x) + (cc.z - pos.z)*(cc.z - pos.z);
					if (d < minD) { minD = d; nearCC = cc; }
				}
				fleeX = nearCC.x; fleeZ = nearCC.z;
			}
			g_PudimScoutFleeing[ent] = true;
			g_PudimScoutClearTicks[ent] = 0;
			delete g_PudimScoutTargets[ent];
			Engine.PostNetworkCommand({ "type": "walk", "entities": [ent], "x": fleeX, "z": fleeZ, "queued": false });
			g_PudimScoutLastPos[ent] = { x: pos.x, z: pos.z, stuckCount: 0 };
			continue;
		}

		// Em fuga — aguarda 2 ticks consecutivos sem perigo antes de retomar exploração
		if (g_PudimScoutFleeing[ent]) {
			g_PudimScoutClearTicks[ent] = (g_PudimScoutClearTicks[ent] || 0) + 1;
			if (g_PudimScoutClearTicks[ent] < 2) continue;
			g_PudimScoutFleeing[ent] = false;
			g_PudimScoutClearTicks[ent] = 0;
		}

		// Timeout: alvo atribuído há >10s e scout ainda está longe → preso em água/obstáculo
		{
			const tgtForTimeout = g_PudimScoutTargets[ent];
			if (tgtForTimeout) {
				const tgtAge = now - (g_PudimScoutTargetTime[ent] || now);
				if (tgtAge > 10000) {
					const ttdx = pos.x - tgtForTimeout.x;
					const ttdz = pos.z - tgtForTimeout.z;
					if (ttdx*ttdx + ttdz*ttdz > (cellSize * 0.5) * (cellSize * 0.5)) {
						// Bloquear setor alvo + adjacentes + setor atual (possivelmente água)
						const ttc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(tgtForTimeout.x / cellSize)));
						const ttr = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(tgtForTimeout.z / cellSize)));
						for (let dc = -1; dc <= 1; dc++) {
							for (let dr = -1; dr <= 1; dr++) {
								const nc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, ttc + dc));
								const nr = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, ttr + dr));
								g_PudimScoutBlocked[nc + "," + nr] = Infinity;
								g_PudimScoutSectors[nc + "," + nr] = now;
							}
						}
						const curC = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
						const curR = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
						g_PudimScoutBlocked[curC + "," + curR] = Infinity;
						g_PudimScoutSectors[curC + "," + curR] = now;
						delete g_PudimScoutTargets[ent];
						delete g_PudimScoutTargetTime[ent];
						g_PudimScoutLastPos[ent] = { x: pos.x, z: pos.z, stuckCount: 0 };
						let retreatXt = mapSize / 2, retreatZt = mapSize / 2;
						if (ccList.length > 0) {
							let nearCCt = ccList[0], minDt = Infinity;
							for (const cc of ccList) {
								const cdx = cc.x - pos.x; const cdz = cc.z - pos.z;
								const d = cdx*cdx + cdz*cdz;
								if (d < minDt) { minDt = d; nearCCt = cc; }
							}
							retreatXt = nearCCt.x; retreatZt = nearCCt.z;
						}
						Engine.PostNetworkCommand({ "type": "walk", "entities": [ent], "x": retreatXt, "z": retreatZt, "queued": false });
						continue;
					} else {
						delete g_PudimScoutTargetTime[ent];
					}
				}
			}
		}

		// Idle com alvo distante = pathfinder não conseguiu chegar (água, obstáculo)
		{
			const tgtForIdle = g_PudimScoutTargets[ent];
			if (idle && tgtForIdle) {
				const idx = pos.x - tgtForIdle.x;
				const idz = pos.z - tgtForIdle.z;
				if (idx*idx + idz*idz > (cellSize * 0.5) * (cellSize * 0.5)) {
					const itc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(tgtForIdle.x / cellSize)));
					const itr = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(tgtForIdle.z / cellSize)));
					g_PudimScoutBlocked[itc + "," + itr] = Infinity;
					g_PudimScoutSectors[itc + "," + itr] = now;
					const icurC = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
					const icurR = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
					g_PudimScoutBlocked[icurC + "," + icurR] = Infinity;
					g_PudimScoutSectors[icurC + "," + icurR] = now;
					delete g_PudimScoutTargets[ent];
					delete g_PudimScoutTargetTime[ent];
				}
			}
		}

		// Detecção de scout preso (água/montanha): movimento < 10 unidades em 2s → recuo imediato
		// Cavalaria normal: ~28 unidades/tick; água rasa: ~10-14; preso total: 0-3
		const lastPos = g_PudimScoutLastPos[ent];
		if (lastPos && !idle && g_PudimScoutTargets[ent]) {
			const dx = pos.x - lastPos.x;
			const dz = pos.z - lastPos.z;
			const moved = Math.sqrt(dx * dx + dz * dz);
			if (moved < 3) {
				// Preso ou em água — bloquear APENAS o setor alvo exato e recuar para CC imediatamente
				const stuckTgt = g_PudimScoutTargets[ent];
				const stc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor((stuckTgt ? stuckTgt.x : pos.x) / cellSize)));
				const str = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor((stuckTgt ? stuckTgt.z : pos.z) / cellSize)));
				g_PudimScoutBlocked[stc + "," + str] = Infinity;
				g_PudimScoutSectors[stc + "," + str] = now;
				const curC = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
				const curR = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
				g_PudimScoutBlocked[curC + "," + curR] = Infinity;
				g_PudimScoutSectors[curC + "," + curR] = now;
				delete g_PudimScoutTargets[ent];
				delete g_PudimScoutTargetTime[ent];
				g_PudimScoutLastPos[ent] = { x: pos.x, z: pos.z, stuckCount: 0 };
				let retreatX = mapSize / 2, retreatZ = mapSize / 2;
				if (ccList.length > 0) {
					let nearCC = ccList[0], minD = Infinity;
					for (const cc of ccList) {
						const cdx = cc.x - pos.x; const cdz = cc.z - pos.z;
						const d = cdx*cdx + cdz*cdz;
						if (d < minD) { minD = d; nearCC = cc; }
					}
					retreatX = nearCC.x; retreatZ = nearCC.z;
				}
				Engine.PostNetworkCommand({ "type": "walk", "entities": [ent], "x": retreatX, "z": retreatZ, "queued": false });
				continue;
			} else {
				g_PudimScoutLastPos[ent] = { x: pos.x, z: pos.z, stuckCount: 0 };
			}
		} else {
			g_PudimScoutLastPos[ent] = { x: pos.x, z: pos.z, stuckCount: lastPos ? (lastPos.stuckCount || 0) : 0 };
		}

		// Marca o setor atual como visitado agora
		const col = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.x / cellSize)));
		const row = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(pos.z / cellSize)));
		g_PudimScoutSectors[col + "," + row] = now;

		// Verifica se chegou perto do alvo atual
		const currentTarget = g_PudimScoutTargets[ent];
		let needsNewTarget = idle;
		if (currentTarget) {
			const dx = pos.x - currentTarget.x;
			const dz = pos.z - currentTarget.z;
			if (dx * dx + dz * dz < cellSize * cellSize * 0.3)
				needsNewTarget = true;
		} else {
			needsNewTarget = true;
		}

		if (!needsNewTarget) continue;

		// RASTREADOR DE FRONTEIRA E RECURSOS
		let bestCell = null;

		// Rotacionar theta a cada waypoint para patrulha circular (não usa random — deterministico)
		if (typeof g_PudimScoutTheta[ent] !== "number") g_PudimScoutTheta[ent] = 0;
		g_PudimScoutTheta[ent] += Math.PI / 4;  // avança 45° por waypoint
		if (g_PudimScoutTheta[ent] > 2 * Math.PI) g_PudimScoutTheta[ent] -= 2 * Math.PI;

		const targetData = Engine.GuiInterfaceCall("pudim_GetScoutBorderTarget", {
			"scoutId": ent,
			"mode": mode,
			"blockedSectors": g_PudimScoutBlocked,
			"gridSize": cellSize,
			"theta": g_PudimScoutTheta[ent],
			"enemyBasePos": g_PudimScoutEnemyBase || null
		});

		if (targetData && targetData.x > 0) {
			bestCell = { x: targetData.x, z: targetData.z };
			// Órbita: adota o ângulo entregue pelo servidor como novo theta. Assim a próxima
			// varredura começa DEPOIS deste ponto e o contorno progride sempre no mesmo
			// sentido, em vez de reescolher os mesmos pontos livres do anel.
			if (typeof targetData.orbitAngle === "number")
				g_PudimScoutTheta[ent] = targetData.orbitAngle;
		} else {
			// Fallback: explorar em espiral ao redor da posição atual
			const fallbackR = 60;
			const fallbackAngle = g_PudimScoutTheta[ent];
			bestCell = {
				x: Math.max(15, Math.min(mapSize - 15, pos.x + Math.cos(fallbackAngle) * fallbackR)),
				z: Math.max(15, Math.min(mapSize - 15, pos.z + Math.sin(fallbackAngle) * fallbackR))
			};
		}

		if (bestCell) {
			// Nunca reenviar o MESMO alvo: cada walk reinicia o pathfinder, e em jogo isso
			// virou um loop — o scout ficou repetindo 3 destinos e reenviando o comando a
			// cada tick sem nunca contornar a base. Se o mesmo alvo insistir, bloqueia o
			// setor por 3min e força outro destino.
			const prevT = g_PudimScoutTargets[ent];
			const sameTarget = prevT &&
				Math.abs(prevT.x - bestCell.x) < 5 && Math.abs(prevT.z - bestCell.z) < 5;
			if (sameTarget) {
				g_PudimScoutSameCount[ent] = (g_PudimScoutSameCount[ent] || 0) + 1;
				if (g_PudimScoutSameCount[ent] >= 3) {
					const rc = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(bestCell.x / cellSize)));
					const rr = Math.max(0, Math.min(PUDIM_SCOUT_GRID - 1, Math.floor(bestCell.z / cellSize)));
					g_PudimScoutBlocked[rc + "," + rr] = now + 180000;
					g_PudimScoutSameCount[ent] = 0;
					delete g_PudimScoutTargets[ent];
					delete g_PudimScoutTargetTime[ent];
				}
				continue;
			}
			g_PudimScoutSameCount[ent] = 0;
			g_PudimScoutTargets[ent] = { x: bestCell.x, z: bestCell.z };
			g_PudimScoutTargetTime[ent] = now;
			Engine.PostNetworkCommand({
				"type": "walk", "entities": [ent],
				"x": bestCell.x, "z": bestCell.z, "queued": false
			});
		}
	}
}

pudim_patchApplyN("onTick", function(target, that, args) {
	const result = target.apply(that, args);

	const now = Date.now();
	if (now - g_LastScoutTick > 2000) {
		try {
			pudim_ForceScoutTick();
		} catch(e) {}
	}

	return result;
});

// Garante que o painel scout some ao selecionar qualquer coisa que nao seja cavalaria
pudim_patchApplyN("onSelectionChange", function(target, that, args) {
	const result = target.apply(that, args);
	try {
		pudim_UpdateSelectionButton();
	} catch(e) {}
	return result;
});
