// Registrando variaveis globais de cache para alta performance
var g_PudimEnemyStructuresCache = [];
var g_PudimEnemyStructuresLastUpdate = 0;
/**
 * PudimMod - GuiInterface~pudim.js
 * Extensões da interface de GUI para o PudimMod.
 *
 * Expõe funções de simulação que a GUI pode chamar via Engine.GuiInterfaceCall.
 * Todas as funções SOMENTE LÊEM o estado da simulação — nenhuma modifica nada.
 * Modificações de estado devem ser feitas via Engine.PostNetworkCommand na GUI.
 */

// ─── Estimativa de Combate ────────────────────────────────────────────────────

/**
 * Retorna estimativa de força de combate para as entidades selecionadas
 * e para as unidades inimigas próximas a elas.
 *
 * @param {number} player - ID do jogador solicitante.
 * @param {Object} data
 * @param {number[]} data.ents - IDs das entidades selecionadas (unidades aliadas).
 * @returns {Object} Dados de estimativa de combate para aliados e inimigos.
 */
GuiInterface.prototype.pudim_GetCombatEstimation = function(player, data)
{
	const result = {
		"allies": { 
			"count": 0, 
			"totalHP": 0, 
			"totalMaxHP": 0, 
			"totalAttack": 0, 
			"totalArmor": 0,
			"types": { "meleeInf": 0, "rangedInf": 0, "cavalry": 0, "siege": 0, "support": 0 }
		},
		"enemies": { 
			"count": 0, 
			"totalHP": 0, 
			"totalMaxHP": 0, 
			"totalAttack": 0, 
			"totalArmor": 0,
			"types": { "meleeInf": 0, "rangedInf": 0, "cavalry": 0, "siege": 0, "support": 0 }
		},
		"winChance": 50,
		"allyDetails": [],
		"enemyDetails": []
	};

	if (!data || !data.ents || !data.ents.length)
		return result;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);

	// Determinar jogadores inimigos
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpDiplomacy = Engine.QueryInterface(playerEnt, IID_Diplomacy);

	const collectStats = (ent, bucket) =>
	{
		const cmpHealth = Engine.QueryInterface(ent, IID_Health);
		const cmpAttack = Engine.QueryInterface(ent, IID_Attack);
		const cmpResistance = Engine.QueryInterface(ent, IID_Resistance);
		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);

		if (!cmpHealth)
			return;

		const hp = cmpHealth.GetHitpoints();
		const maxHP = cmpHealth.GetMaxHitpoints();

		// Classificar unidade por tipo
		let typeStr = "meleeInf";
		if (cmpIdentity)
		{
			if (cmpIdentity.HasClass("FemaleCitizen") || cmpIdentity.HasClass("Support"))
				typeStr = "support";
			else if (cmpIdentity.HasClass("Siege"))
				typeStr = "siege";
			else if (cmpIdentity.HasClass("FastMoving"))
				typeStr = "cavalry";
			else if (cmpIdentity.HasClass("CitizenSoldier"))
			{
				if (cmpIdentity.HasClass("Ranged"))
					typeStr = "rangedInf";
				else
					typeStr = "meleeInf";
			}
		}
		bucket.types[typeStr] = (bucket.types[typeStr] || 0) + 1;

		// Calcular DPS usando todos os tipos de ataque disponíveis (Melee + Ranged)
		let dps = 0;
		if (cmpAttack)
		{
			const types = cmpAttack.GetAttackTypes();
			for (const type of types)
			{
				if (type === "Capture")
					continue;

				let typeDamage = 0;
				try
				{
					const effectData = cmpAttack.GetAttackEffectsData(type);
					if (effectData && effectData.Damage)
					{
						const dmg = effectData.Damage;
						typeDamage = (dmg.Hack || 0) + (dmg.Pierce || 0) + (dmg.Crush || 0);
					}
				}
				catch (e) {}

				if (typeDamage > 0)
				{
					try
					{
						const repeatTime = cmpAttack.GetRepeatTime(type);
						if (repeatTime > 0)
							typeDamage = typeDamage / (repeatTime / 1000);
					}
					catch (e) {}

					if (typeDamage > dps)
						dps = typeDamage;
				}
			}
		}

		// Resistência de armadura (Hack + Pierce + Crush)
		let armor = 0;
		if (cmpResistance)
		{
			try
			{
				const resistData = cmpResistance.GetArmor ? cmpResistance.GetArmor() : null;
				if (resistData)
					armor = (resistData.hack || 0) + (resistData.pierce || 0) + (resistData.crush || 0);
			}
			catch (e)
			{
				armor = 0;
			}
		}

		const name = cmpIdentity
			? ((cmpIdentity.template && cmpIdentity.template.SpecificName) || cmpIdentity.GetGenericName() || "Unidade")
			: "Unidade";

		bucket.count++;
		bucket.totalHP += hp;
		bucket.totalMaxHP += maxHP;
		bucket.totalAttack += dps;
		bucket.totalArmor += armor;

		return { name, hp, maxHP, dps, armor };
	};

	// Coletar estatísticas dos aliados selecionados
	const allyPositions = [];
	for (const ent of data.ents)
	{
		const cmpOwnership = Engine.QueryInterface(ent, IID_Ownership);
		if (!cmpOwnership || cmpOwnership.GetOwner() !== player)
			continue;
		const detail = collectStats(ent, result.allies);
		if (detail)
			result.allyDetails.push(detail);

		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (cmpPos && cmpPos.IsInWorld())
			allyPositions.push(cmpPos.GetPosition2D());
	}

	// Calcular centro das unidades aliadas para buscar inimigos próximos
	if (allyPositions.length > 0)
	{
		let cx = 0, cy = 0;
		for (const p of allyPositions) { cx += p.x; cy += p.y; }
		cx /= allyPositions.length;
		cy /= allyPositions.length;

		// Buscar entidades inimigas num raio de 80 tiles (~largura de batalha típica)
		const nearbyEnts = cmpRangeManager.ExecuteQueryAroundPos(
			{ "x": cx, "y": cy },
			0, 80,
			cmpDiplomacy.GetEnemies(),
			IID_Health, false);

		for (const ent of nearbyEnts)
		{
			const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
			const cmpMirage = Engine.QueryInterface(ent, IID_Mirage);
			if (cmpFoundation || cmpMirage)
				continue;

			const cmpAttack = Engine.QueryInterface(ent, IID_Attack);
			if (!cmpAttack)
				continue;

			const detail = collectStats(ent, result.enemies);
			if (detail)
				result.enemyDetails.push(detail);
		}
	}

	// Estimar probabilidade de vitória (heurística simples)
	const allyScore = result.allies.totalHP * Math.max(result.allies.totalAttack, 1) / (1 + result.allies.totalArmor / 10);
	const enemyScore = result.enemies.totalHP * Math.max(result.enemies.totalAttack, 1) / (1 + result.enemies.totalArmor / 10);

	if (allyScore + enemyScore > 0)
		result.winChance = Math.round(100 * allyScore / (allyScore + enemyScore));
	else
		result.winChance = 50;

	return result;
};

// ─── Trabalhadores Ociosos ────────────────────────────────────────────────────

/**
 * Retorna unidades trabalhadoras ociosas do jogador e o recurso mais
 * necessário com base nos pesos configurados.
 *
 * @param {number} player - ID do jogador.
 * @param {Object} data
 * @param {Object} data.weights - Pesos de prioridade { food, wood, stone, metal }
 * @returns {Object} { idleWorkers: number[], bestResource: string }
 */
GuiInterface.prototype.pudim_GetIdleWorkersAndBestResource = function(player, data)
{
	// suggestStorehouse/suggestFarmstead são LISTAS: se vários workers forem despachados pra
	// longe no mesmo tick (ex: balanceamento inicial mandando 4 aldeãs pra fruta distante),
	// capturar só o primeiro deixava os outros esperando o sistema de long-walker (mais lento,
	// limiar maior) — daí "primeiro coletou, só depois construiu". Agora acumula candidatos
	// distintos (deduplicados por proximidade) e todos são tentados no mesmo ciclo.
	// gathererRes/trackedIds alimentam a memória de função do painel (g_PudimGathererRes):
	// gathererRes diz o que cada unidade coleta AGORA; trackedIds é o conjunto vivo, usado
	// para podar a memória e não deixá-la crescer com entidades mortas.
	const result = { "idleWorkers": [], "bestResource": "food", "suggestStorehouse": [], "suggestFarmstead": [], "longWalkers": [],
	                 "gathererRes": {}, "trackedIds": [], "unplaced": [],
	                 // Retrato do balanceamento: alvo por recurso, quanto há de fato, e
	                 // quantos ficaram sem vaga no recurso mais carente.
	                 "_bal": { quota: {}, current: {}, foodBlocked: 0, idle: 0 } };

	// Função anterior de quem agora está construindo: { entId: "food" | "wood" | ... }.
	// Vem do painel, que guarda a última coleta observada de cada unidade antes de o mod
	// (ou o jogador) mandá-la construir.
	const builderOrigin = (data && data.builderOrigin) || {};

	// O painel envia a chave `repeatBuilders` (array). Este ponto lia `data.repeatBuilding`
	// como objeto — nome que nunca chegou — então o guard era sempre falso e os
	// trabalhadores do repeat-build eram despachados por cima da própria obra.
	const repeatBuilders = new Set(((data && data.repeatBuilders) || []).map(Number));

	// Unidades sob ordem MANUAL do jogador (marcadas pelo hook de handleUnitAction).
	// Enquanto estiverem EXECUTANDO a ordem, nenhum sistema do mod as toca — se o jogador
	// mandou colher fruta num ponto, é lá que elas ficam. Assim que ficarem ociosas
	// (tarefa concluída), voltam a ser gerenciadas normalmente.
	const playerOrdered = new Set(((data && data.playerOrdered) || []).map(Number));
	const protectedIds = new Set(((data && data.protectedIds) || []).map(Number));
	// Comando recém-postado que a simulação ainda pode não ter aplicado (PostNetworkCommand
	// é assíncrono). Só esta janela ignora o estado ocioso.
	const inFlight = new Set(((data && data.inFlightIds) || []).map(Number));
	// Exploradores têm controlador próprio (pudim_GetScoutBorderTarget) e nunca devem ser
	// despachados para coleta. Até agora quem os protegia era, por acidente, o teste de
	// território aplicado a soldados: scout profundo fica fora do território por definição.
	// Com aquele teste removido — ele prendia soldados comuns parados — a proteção precisa
	// ser explícita, senão o auto-work passa a arrastar o explorador de volta para a base.
	const scoutIds = new Set(((data && data.scoutIds) || []).map(Number));
	const pudimSkipUnit = function(ent, cmpUnitAI) {
		const busy = !!(cmpUnitAI && !cmpUnitAI.IsIdle());
		if (scoutIds.has(ent)) return true;
		if (inFlight.has(ent)) return true;
		// Proteção de construtor valia por TEMPO ABSOLUTO — até 30s no caso de quem ergueu
		// um dropsite. Se a obra terminava antes, a unidade ficava parada o resto da janela,
		// invisível para o auto-work: era a origem dos trabalhadores ociosos no meio da base.
		// Agora ela protege apenas quem está OCUPADO, mesma regra já usada para ordem manual:
		// ficou ocioso, acabou (ou falhou) a obra, e a unidade volta a ser despachada.
		if (protectedIds.has(ent)) return busy;
		if (!playerOrdered.has(ent)) return false;
		return busy; // ainda cumprindo a ordem do jogador
	};

	// Workers em trânsito (ordem "Gather" com target específico) para cada entidade-recurso.
	// Preenchido no scan de entidades abaixo, ANTES de findNearestResource ser chamado.
	// Corrige superlotação: GetNumGatherers() retorna 0 para workers caminhando — sem isso,
	// cada ciclo de 5s manda mais workers para o mesmo arbusto de 8 vagas.
	const inTransitByTarget = {};

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return result;

	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	
	// Identificar inimigos para evitar florestas perigosas.
	// Gaia (jogador 0) é excluída: dependendo da configuração da partida ela aparece em
	// GetEnemies(), e aí toda ovelha, veado ou galinha vira "inimigo por perto". Foi o que
	// deixou os soldados iniciais parados a partida inteira — o log acusava
	// `inimigo_a_100m` num jogo com k0/d0, sem um único combate. Gaia também poluía
	// enemyStructures, fazendo florestas perto de qualquer ruína parecerem perigosas.
	const cmpDiplomacy = Engine.QueryInterface(playerEnt, IID_Diplomacy);
	const enemiesRaw = cmpDiplomacy ? cmpDiplomacy.GetEnemies() : [];
	const enemies = enemiesRaw.filter(p => p > 0);
	// Lista CRUA no log, antes do filtro: é o que confirma se Gaia estava mesmo entrando.
	// Logar a lista já filtrada não provaria nada — nunca mostraria o 0.
	result.enemyList = enemiesRaw.join("/") || "vazio";
	const enemyStructures = [];
	for (const enemy of enemies) {
		const ents = cmpRangeManager.GetEntitiesByPlayer(enemy);
		for (const e of ents) {
			const id = Engine.QueryInterface(e, IID_Identity);
			if (id && (id.HasClass("Structure") || id.HasClass("Tower") || id.HasClass("Fortress") || id.HasClass("Civic"))) {
				const pos = Engine.QueryInterface(e, IID_Position);
				if (pos && pos.IsInWorld()) enemyStructures.push(pos.GetPosition2D());
			}
		}
	}

	const civicCenters = [];
	for (const ent of allEnts) {
		const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
		if (cmpIdentity && cmpIdentity.HasClass("CivCentre")) {
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) civicCenters.push(cmpPos.GetPosition2D());
		}
	}

	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);

	// Detectar invasão REAL: 3+ unidades inimigas a 80m de algum CC (era 200m — raio grande
	// demais causava baseUnderAttack=true permanente em partidas 1v3, bloqueando soldados
	// recém-nascidos de ir trabalhar mesmo estando seguros a 150m do CC).
	let baseUnderAttack = false;
	if (cmpTerritoryManager && civicCenters.length > 0 && enemies.length > 0) {
		let enemyNearCC = 0;
		outer: for (const ccPos of civicCenters) {
			const nearEnemies = cmpRangeManager.ExecuteQueryAroundPos(
				{ x: ccPos.x, y: ccPos.y }, 0, 80, enemies, IID_UnitAI, false);
			enemyNearCC += nearEnemies.length;
			if (enemyNearCC >= 3) { baseUnderAttack = true; break outer; }
		}
	}

	let weights = data && data.weights ? { ...data.weights } : { food: 3, wood: 3, stone: 0, metal: 0 };
	const cmpTechnologyManager = QueryPlayerIDInterface(player, IID_TechnologyManager);

	// Ajuste dinâmico por estoque: jogadores experientes evitam deixar um recurso empilhar
	// sem uso enquanto outro falta, redistribuindo trabalhadores continuamente (não só por
	// peso fixo do slider). Reduz peso do recurso muito acima da média; reforça o crítico.
	if (cmpPlayer) {
		const bank = cmpPlayer.GetResourceCounts();
		const activeTypes = ["food", "wood", "stone", "metal"].filter(t => weights[t] > 0);
		if (activeTypes.length > 1) {
			const avgBank = activeTypes.reduce((s, t) => s + (bank[t] || 0), 0) / activeTypes.length;
			if (avgBank > 100) {
				for (const t of activeTypes) {
					const amt = bank[t] || 0;
					if (amt > avgBank * 2 && amt > 600)
						weights[t] = Math.max(0.5, weights[t] * 0.5);
					else if (amt < 80 && avgBank > 300)
						weights[t] = weights[t] * 2;
				}
			}
		}
	}

	// Preenchido após o scan de entidades; acessível pelas closures abaixo.
	let woodStorehouseCount = 0;

	// 1. Helper com Busca de Floresta Densa e Segura
	const findNearestResource = (pos, type, maxRange, assignedEntities, excludeMeat, specificType) => {
		const nearby = cmpRangeManager.ExecuteQueryAroundPos(pos, 0, maxRange, [0, player], IID_ResourceSupply, false);
		const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);

		let safeResources = [];
		for (const ent of nearby) {
			const cmpResourceSupply = Engine.QueryInterface(ent, IID_ResourceSupply);
			if (!cmpResourceSupply || !cmpResourceSupply.IsAvailable() || cmpResourceSupply.GetType().generic !== type)
				continue;
			if (excludeMeat && cmpResourceSupply.GetType().specific === "meat")
				continue;
			// Filtra por tipo específico (ex: "fruit" para só frutas/bagas, excluindo pesca/caça)
			if (specificType && cmpResourceSupply.GetType().specific !== specificType)
				continue;
			
			// Frutas/bagas: respeitar GetMaxGatherers() real (ex: berry bush = 8)
			// alreadyAss inclui: (1) assignments deste tick, (2) workers ainda caminhando
			// (inTransitByTarget) — evita superlotação quando GetNumGatherers() = 0 em trânsito
			if (specificType === "fruit") {
				const maxG = cmpResourceSupply.GetMaxGatherers();
				const curG = cmpResourceSupply.GetNumGatherers();
				const alreadyAss = (assignedEntities ? (assignedEntities[ent] || 0) : 0) + (inTransitByTarget[ent] || 0);
				if (curG + alreadyAss >= maxG) continue;
			} else {
				if (assignedEntities && assignedEntities[ent] && assignedEntities[ent] >= 15) continue;
			}

			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (!cmpPos || !cmpPos.IsInWorld()) continue;

			const resPos = cmpPos.GetPosition2D();

			let isSafe = true;
			for (const ep of enemyStructures) {
				const dx = resPos.x - ep.x;
				const dz = resPos.y - ep.y;
				if (dx*dx + dz*dz < 80*80) { isSafe = false; break; }
			}
			if (!isSafe) continue;

			// Recursos Gaia de comida (berries/frutas): check por proximidade de CC/dropsite
			// Em vez de território (berries ficam fora da borda do CC mas são acessíveis)
			// Em vez de permitir todo Gaia (evita ir longe demais para entregar)
			const cmpOwnershipChk = Engine.QueryInterface(ent, IID_Ownership);
			const isGaiaFood = type === "food" && (!cmpOwnershipChk || cmpOwnershipChk.GetOwner() === 0);

			if (isGaiaFood) {
				// Frutas/berries: só coleta dentro do território ou até 10m da borda
				if (!cmpTerritoryManager) continue;
				let nearTerritory = false;
				if (cmpTerritoryManager.GetOwner(resPos.x, resPos.y) === player) {
					nearTerritory = true;
				} else {
					const ext = 10;
					const pts = [[ext,0],[-ext,0],[0,ext],[0,-ext],[7,7],[-7,7],[7,-7],[-7,-7]];
					for (const p of pts) {
						if (cmpTerritoryManager.GetOwner(resPos.x + p[0], resPos.y + p[1]) === player) {
							nearTerritory = true; break;
						}
					}
				}
				if (!nearTerritory) continue;
			} else if (cmpTerritoryManager) {
				// Recursos não-Gaia ou não-food: check de território padrão
				let inTerritory = false;
				if (cmpTerritoryManager.GetOwner(resPos.x, resPos.y) === player) {
					inTerritory = true;
				} else {
					const ext = 5;
					const pts = [ [ext,0], [-ext,0], [0,ext], [0,-ext] ];
					for (const p of pts) {
						if (cmpTerritoryManager.GetOwner(resPos.x + p[0], resPos.y + p[1]) === player) {
							inTerritory = true; break;
						}
					}
				}
				if (!inTerritory) continue;
			}

			safeResources.push({ id: ent, pos: resPos, type: cmpResourceSupply.GetType() });
		}

		if (safeResources.length === 0) {
			if (assignedEntities) return findNearestResource(pos, type, maxRange, null, excludeMeat, specificType);
			return null;
		}

		let bestRes = null;
		let maxScore = -Infinity;
		let bestDistToDropsite = Infinity;
		const searchRadiusSq = type === "wood" ? 60*60 : 30*30;
		// Food: distDropsite peso 2 (era 1) — penaliza mais frutas longe do dropsite para evitar
		// workers passeando pelo mapa até bagas distantes quando há bagas próximas com capacidade.
		// Wood/stone/metal: peso 3 para preferir floresta próxima de armazém existente.
		const densityWeight = type === "food" ? 20 : 40;
		const distToDropsiteWeight = type === "food" ? 2 : 3;
		// Distância que o trabalhador precisa percorrer ATÉ o recurso. Estava em 0.1, um valor
		// perto de zero diante de densidade 40: uma única árvore a mais num agrupamento pagava
		// por 400m de caminhada, então o mod atravessava a base para começar a coletar. Em 1.5
		// cada árvore extra compra ~27m de viagem — densidade ainda decide entre matas
		// parecidas, mas deixa de justificar a travessia do mapa.
		const distToWorkerWeight = type === "food" ? 1 : 1.5;

		// Densidade via grade espacial em vez de comparar todos contra todos.
		// O laço aninhado anterior era O(n²) no caminho MAIS quente do mod: roda para cada
		// trabalhador ocioso, a cada ciclo, e com busca de 400m o safeResources chega
		// facilmente a centenas de nós — centenas de milhares de comparações por ciclo.
		// Como só interessa quem está a menos de searchRadius, basta agrupar em células
		// desse tamanho e olhar as 9 células vizinhas: passa a ser O(n) na prática.
		const cellSide = Math.sqrt(searchRadiusSq);
		const densityGrid = {};
		for (const res of safeResources) {
			const gx = Math.floor(res.pos.x / cellSide);
			const gz = Math.floor(res.pos.y / cellSide);
			const gk = gx + "," + gz;
			if (!densityGrid[gk]) densityGrid[gk] = [];
			densityGrid[gk].push(res.pos);
		}

		for (const res of safeResources) {
			let density = 0;
			const gx = Math.floor(res.pos.x / cellSide);
			const gz = Math.floor(res.pos.y / cellSide);
			for (let cx = gx - 1; cx <= gx + 1; ++cx) {
				for (let cz = gz - 1; cz <= gz + 1; ++cz) {
					const bucket = densityGrid[cx + "," + cz];
					if (!bucket) continue;
					for (const op of bucket) {
						const dx = res.pos.x - op.x;
						const dz = res.pos.y - op.y;
						if (dx*dx + dz*dz < searchRadiusSq) density++;
					}
				}
			}
			const dx = res.pos.x - pos.x;
			const dz = res.pos.y - pos.y;
			const distToWorker = Math.sqrt(dx*dx + dz*dz);

			// Distância do recurso ao dropsite mais próximo que aceita esse tipo.
			// CC é excluído para madeira SOMENTE quando já há armazéns: assim florestas com
			// armazém próximo ganham penalidade baixa e vencem florestas sem armazém.
			// Quando woodStorehouseCount === 0 (início de jogo), CC conta → trabalhadores
			// preferem florestas próximas ao CC antes de um armazém ser construído.
			let distToDropsite = 500; // penalidade alta se não houver dropsite dedicado
			for (const ds of dropsites) {
				if (type === "wood" && ds.isCC && woodStorehouseCount > 0) continue;
				if (ds.types.indexOf(type) === -1) continue;
				const ddx = res.pos.x - ds.pos.x;
				const ddz = res.pos.y - ds.pos.y;
				const d = Math.sqrt(ddx*ddx + ddz*ddz);
				if (d < distToDropsite) distToDropsite = d;
			}

			const score = (density * densityWeight) - distToDropsite * distToDropsiteWeight - distToWorker * distToWorkerWeight;
			if (score > maxScore) {
				maxScore = score;
				bestRes = res.id;
				bestDistToDropsite = distToDropsite;
			}
		}

		if (!bestRes && assignedEntities) return findNearestResource(pos, type, maxRange, null, excludeMeat, specificType);
		if (!bestRes) return null;
		// Para comida: recurso longe demais de qualquer dropsite não compensa a viagem de volta.
		// O teste é feito na PRÓPRIA distância ao dropsite, não no score: o score agora carrega
		// também a caminhada do trabalhador, e um limiar sobre a soma rejeitaria frutas coladas
		// no celeiro só porque o trabalhador estava longe delas — exatamente o oposto do
		// pretendido. Madeira/pedra/metal não entram: têm posição fixa e não há alternativa.
		//
		// Devolver `null` aqui criava um impasse: sem atribuição, o sistema de celeiro proativo
		// (que só é acionado por uma fruta ATRIBUÍDA) nunca era chamado, o celeiro nunca subia,
		// a fruta continuava longe de dropsite para sempre — e o sistema de fazendas, vendo
		// capacidade natural zero, partia para os campos com bagas ainda de pé dentro da base.
		// Agora o alvo é devolvido marcado com `tooFar`: o chamador não despacha o trabalhador,
		// mas registra o celeiro. Construído o celeiro, a fruta passa a valer e é colhida antes
		// de qualquer fazenda.
		if (type === "food" && bestDistToDropsite > 100) {
			const farObj = safeResources.find(r => r.id === bestRes);
			return { "id": bestRes, "x": farObj.pos.x, "z": farObj.pos.y, "type": farObj.type, "tooFar": true };
		}

		const bestObj = safeResources.find(r => r.id === bestRes);
		return { "id": bestRes, "x": bestObj.pos.x, "z": bestObj.pos.y, "type": bestObj.type };
	};

	// Frutas dentro da base que existem, mas estão longe de qualquer dropsite de comida.
	// Não viram ordem de coleta (a viagem de volta não compensa), viram pedido de celeiro:
	// erguido o celeiro, elas passam a valer e são colhidas ANTES de qualquer fazenda.
	const farFruit = [];
	const notePudimFarFruit = (t) => {
		if (!t || !t.tooFar) return;
		const dup = farFruit.some(c => {
			const dx = c.x - t.x, dz = c.z - t.z;
			return dx*dx + dz*dz <= 60*60;
		});
		if (!dup) farFruit.push({ x: t.x, z: t.z });
	};

	const findFoodResource = (workerPos, assignedEntities) => {
		// 1. Prioridade: frutas naturais (bagas/arbustos) próximas de dropsite — nunca caça ou pesca
		const fruitTarget = findNearestResource(workerPos, "food", 250, assignedEntities, true, "fruit");
		if (fruitTarget && fruitTarget.tooFar) notePudimFarFruit(fruitTarget);
		else if (fruitTarget) return fruitTarget;

		// 2. Fallback: fazendas (campos agrícolas do jogador) — apenas com capacidade livre
		const nearbyFields = cmpRangeManager.ExecuteQueryAroundPos(workerPos, 0, 300, [player], IID_ResourceSupply, false);
		let bestField = null;
		let minFieldDist = Infinity;
		for (const ent of nearbyFields) {
			const cmpResourceSupply = Engine.QueryInterface(ent, IID_ResourceSupply);
			if (!cmpResourceSupply || !cmpResourceSupply.IsAvailable()) continue;
			const type = cmpResourceSupply.GetType();
			if (type.generic !== "food") continue;
			const cmpIdent = Engine.QueryInterface(ent, IID_Identity);
			if (!cmpIdent || !cmpIdent.HasClass("Field")) continue;
			// Verificar capacidade: não enviar para fazenda já cheia (causa zigzag)
			const maxG = cmpResourceSupply.GetMaxGatherers();
			const curG = cmpResourceSupply.GetNumGatherers();
			const alreadyAssigned = assignedEntities && assignedEntities[ent] ? assignedEntities[ent] : 0;
			if (curG + alreadyAssigned >= maxG) continue;
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (!cmpPos || !cmpPos.IsInWorld()) continue;
			const resPos = cmpPos.GetPosition2D();
			const dx = resPos.x - workerPos.x;
			const dz = resPos.y - workerPos.y;
			const distSq = dx*dx + dz*dz;
			if (distSq < minFieldDist) {
				minFieldDist = distSq;
				bestField = { "id": ent, "x": resPos.x, "z": resPos.y, "type": type };
			}
		}
		return bestField;
	};

	const dropsites = [];
	const idleWorkersList = [];
	const assignedWorkers = [];
	const activeGatherers = { "food": [], "wood": [], "stone": [], "metal": [] };
	
	for (const ent of allEnts) {
		const cmpDropsite = Engine.QueryInterface(ent, IID_ResourceDropsite);
		if (cmpDropsite) {
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) {
				const cmpDsIdent = Engine.QueryInterface(ent, IID_Identity);
				const dsIsCC = !!(cmpDsIdent && cmpDsIdent.HasClass("CivCentre"));
				dropsites.push({ "id": ent, "pos": cmpPos.GetPosition2D(), "types": cmpDropsite.GetTypes() || [], "isCC": dsIsCC });
			}
		}

		const cmpGatherer = Engine.QueryInterface(ent, IID_ResourceGatherer);
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpGatherer || !cmpUnitAI || Engine.QueryInterface(ent, IID_Foundation) || Engine.QueryInterface(ent, IID_Mirage) || cmpUnitAI.isGarrisoned)
			continue;

		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const workerPos = cmpPos.GetPosition2D();

		// ── CENSO ─────────────────────────────────────────────────────────────────
		// Contar vem ANTES de decidir se a unidade pode ser comandada. Os filtros
		// abaixo (ordem manual do jogador, repeat-build, construtor) existem para não
		// TOCAR na unidade — não para fingir que ela não existe. Somados, eles faziam
		// sumir do censo justamente quem estava ocupado: mandar 15 aldeãs erguer 3
		// fazendas zerava a comida na conta, o déficit aparente disparava, e cada
		// unidade recém-nascida era despachada para a comida. Quando as fazendas
		// ficavam prontas, sobrava gente demais lá e o balanceamento desandava.
		// Elas continuam sendo 15 trabalhadores de comida enquanto constroem.
		result.trackedIds.push(ent);
		const ordC = (cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0) ? cmpUnitAI.orderQueue[0] : null;
		if (ordC) {
			// Worker em trânsito para uma entidade-recurso específica (controle de capacidade).
			// Corrige superlotação: GetNumGatherers() retorna 0 para quem ainda está andando.
			if (ordC.type === "Gather" && ordC.data && ordC.data.target !== undefined && ordC.data.target !== null)
				inTransitByTarget[ordC.data.target] = (inTransitByTarget[ordC.data.target] || 0) + 1;

			let resType = null;
			if (ordC.type === "Gather" || ordC.type === "GatherNearPosition" || ordC.type === "ReturnResource") {
				if (ordC.data && ordC.data.type) resType = ordC.data.type.generic;
				else if (ordC.data && ordC.data.resourceType) resType = ordC.data.resourceType.generic;
				// Memória para o painel: é este valor que será devolvido como origem
				// quando a unidade virar construtora no ciclo seguinte.
				if (resType) result.gathererRes[ent] = resType;
			} else if (ordC.type === "Repair") {
				// Construindo: mantém a função anterior, lembrada pelo painel.
				const origin = builderOrigin[ent];
				if (origin) resType = origin;
			}
			if (resType && activeGatherers[resType] !== undefined) activeGatherers[resType].push(ent);
		}

		// ── COMANDO ───────────────────────────────────────────────────────────────
		// Daqui para baixo é decisão de dar ordem; quem não pode ser tocado sai agora.
		if (repeatBuilders.has(ent)) continue;
		// Ordem manual do jogador em andamento (ou unidade recém-comandada pelo mod): não tocar
		if (pudimSkipUnit(ent, cmpUnitAI)) continue;

		if (cmpUnitAI.IsIdle()) {
			const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
			if (cmpIdentity && cmpIdentity.HasClass("FishingBoat")) {
				const nearbyGaia = cmpRangeManager.ExecuteQueryAroundPos(workerPos, 0, 250, [0], IID_ResourceSupply, false);
				let closestFish = null;
				let minFishDist = Infinity;
				for (const gaiaEnt of nearbyGaia) {
					const cmpResourceSupply = Engine.QueryInterface(gaiaEnt, IID_ResourceSupply);
					if (!cmpResourceSupply || !cmpResourceSupply.IsAvailable() || cmpResourceSupply.GetType().generic !== "food" || cmpResourceSupply.GetType().specific !== "fish") continue;
					const cmpFishPos = Engine.QueryInterface(gaiaEnt, IID_Position);
					if (!cmpFishPos || !cmpFishPos.IsInWorld()) continue;
					const fishPos = cmpFishPos.GetPosition2D();
					const dx = fishPos.x - workerPos.x;
					const dz = fishPos.y - workerPos.y;
					const dist = dx*dx + dz*dz;
					if (dist < minFishDist) { minFishDist = dist; closestFish = { "id": gaiaEnt, "x": fishPos.x, "z": fishPos.y, "type": cmpResourceSupply.GetType() }; }
				}
				if (closestFish) { assignedWorkers.push({ "id": ent, "target": closestFish.id, "x": closestFish.x, "z": closestFish.z, "type": closestFish.type }); continue; }
			}

			if (cmpIdentity && cmpIdentity.HasClass("FastMoving")) {
				// Cavalaria só recebe ordem do mod para CAÇAR, e apenas se: está ociosa
				// (já garantido neste ramo), está DENTRO da base, e NÃO há inimigo na base.
				// Com inimigo na base ou fora do território ela fica livre — é tropa de
				// combate/exploração, e o scout é quem comanda nesses casos.
				// O filtro por território nos dois lados (cavaleiro + animal) evita o loop
				// infinito de perseguição de animais que fugiam para fora da base.
				if (baseUnderAttack) continue; // inimigo na base: não interferir
				// Margem fora da fronteira: rebanhos (ovelhas, cabras) costumam pastar logo
				// depois da borda do território, e exigir GetOwner() === player deixava a
				// cavalaria parada olhando comida a 20m dali. A margem é amostrada em 8
				// direções — se qualquer ponto a até `m` de distância for nosso, vale.
				const nearOwnTerritory = (x, z, m) => {
					if (!cmpTerritoryManager) return false;
					if (cmpTerritoryManager.GetOwner(x, z) === player) return true;
					const d = m * 0.7071; // componente diagonal
					const pts = [[m,0],[-m,0],[0,m],[0,-m],[d,d],[-d,d],[d,-d],[-d,-d]];
					for (const p of pts)
						if (cmpTerritoryManager.GetOwner(x + p[0], z + p[1]) === player) return true;
					return false;
				};
				// A própria cavalaria pode estar um pouco fora enquanto persegue.
				if (!nearOwnTerritory(workerPos.x, workerPos.y, 60)) continue;
				// workerPos já é Vector2D {x, y}; o {x, z} anterior deixava y undefined e a
				// consulta voltava vazia — a cavalaria nunca achava caça e ficava parada
				const cavNearby = cmpRangeManager.ExecuteQueryAroundPos(
					workerPos, 0, 200, [0], IID_ResourceSupply, false);
				let cavBest = null, cavMinDist = Infinity;
				for (const ae of cavNearby) {
					const aSupply = Engine.QueryInterface(ae, IID_ResourceSupply);
					if (!aSupply || !aSupply.IsAvailable()) continue;
					const aType = aSupply.GetType();
					if (!aType || aType.generic !== "food" || aType.specific !== "meat") continue;
					const aId = Engine.QueryInterface(ae, IID_Identity);
					if (!aId || !aId.HasClass("Animal")) continue;
					const aPos = Engine.QueryInterface(ae, IID_Position);
					if (!aPos || !aPos.IsInWorld()) continue;
					const ap = aPos.GetPosition2D();
					// Animal até 40m FORA da fronteira ainda vale: é perto o bastante para
					// caçar e voltar sem se expor. Mais que isso já é aventura no mapa, que
					// era justamente o loop de perseguição que removemos antes.
					if (!nearOwnTerritory(ap.x, ap.y, 40)) continue;
					const dx = ap.x - workerPos.x, dz = ap.y - workerPos.y;
					const d = dx*dx + dz*dz;
					if (d < cavMinDist) { cavMinDist = d; cavBest = { id: ae, x: ap.x, z: ap.y, type: aType }; }
				}
				if (cavBest) {
					assignedWorkers.push({ "id": ent, "target": cavBest.id, "x": cavBest.x, "z": cavBest.z, "type": cavBest.type });
				}
				continue; // nunca vai para lógica de recurso genérico
			}

			// CitizenSoldier: o ÚNICO motivo para não trabalhar é inimigo por perto.
			//
			// Estar fora do território não é motivo e era tratado como se fosse: um `continue`
			// seco, sem alternativa nenhuma. O soldado nunca entrava em idleWorkersList e ficava
			// parado indefinidamente — bastava ter nascido, recuado ou terminado uma escolta a
			// alguns metros da fronteira. Com território pequeno no início de partida isso pega
			// muita gente, e era a origem dos soldados ociosos em volta da base.
			// O alvo de coleta é sempre dentro do território (findNearestResource exige isso),
			// então a própria ordem traz o soldado de volta — não há risco de mandá-lo cavar
			// madeira em campo aberto.
			//
			// A checagem de inimigo passou a valer SEMPRE, não só sob baseUnderAttack: um
			// soldado a 100m de inimigo deve ficar em combate mesmo que a base esteja calma,
			// e é justamente fora do território que ele tem mais chance de topar com um.
			// Uma consulta por soldado ocioso, com todos os inimigos de uma vez.
			if (cmpIdentity && cmpIdentity.HasClass("CitizenSoldier") && enemies.length > 0) {
				const nearRaw = cmpRangeManager.ExecuteQueryAroundPos(
					{ x: workerPos.x, y: workerPos.y }, 0, 100, enemies, IID_UnitAI, false);
				// Bicho não é ameaça: mesmo num inimigo de verdade, animais e barcos de pesca
				// não justificam manter um lanceiro parado.
				const nearEnemies = nearRaw.filter(e => {
					const ei = Engine.QueryInterface(e, IID_Identity);
					return ei && !ei.HasClass("Animal") && !ei.HasClass("FishingBoat");
				});
				if (nearEnemies.length > 0) {
					// Também é uma unidade ociosa que o mod escolheu não empregar — registrar,
					// senão ela some do diagnóstico e volta a virar suposição.
					result.unplaced.push({ id: ent, kind: "soldado", tried: "inimigo_a_100m" });
					continue; // em contato: manter em combate
				}
			}

			idleWorkersList.push(ent);
		}
	}

	// Conta armazéns dedicados (não-CC) para informar o scoring de florestas
	woodStorehouseCount = dropsites.filter(ds => !ds.isCC && ds.types && ds.types.indexOf("wood") !== -1).length;

	// Capacidade total de frutas naturais próximas do CC — guard para não construir farmstead prematuramente.
	// Só sugere farmstead quando workers de comida ≥ 80% da capacidade total das bagas disponíveis.
	let totalFruitCapacity = 0;
	for (const ccPos of civicCenters) {
		const nearFruits = cmpRangeManager.ExecuteQueryAroundPos(
			{ x: ccPos.x, y: ccPos.y }, 0, 250, [0], IID_ResourceSupply, false);
		for (const fent of nearFruits) {
			const cmpFruitSupply = Engine.QueryInterface(fent, IID_ResourceSupply);
			if (!cmpFruitSupply || !cmpFruitSupply.IsAvailable()) continue;
			const ftype = cmpFruitSupply.GetType();
			if (!ftype || ftype.generic !== "food" || ftype.specific !== "fruit") continue;
			const maxG = cmpFruitSupply.GetMaxGatherers ? cmpFruitSupply.GetMaxGatherers() : 10;
			totalFruitCapacity += maxG;
		}
	}

	// NOVO ALGORITMO DE DISTRIBUIÇÃO (Cota Percentual de Trabalhadores)
	let activeWeights = [];
	let totalWeight = 0;
	// Construtores entram na conta pelo recurso que coletavam ANTES (ver censo acima), e
	// portanto contam nos dois lados: em activeGatherers[origem] e no total. A tentativa
	// anterior de tirá-los inteiramente resolvia a incoerência de somá-los ao total sem
	// somá-los a nenhum recurso, mas criava o problema oposto: o recurso de onde eles
	// saíram passava a parecer vazio, e todo ocioso era despachado para lá. Contando dos
	// dois lados, as cotas fecham e ninguém desaparece do censo enquanto constrói.
	let totalWorkers = idleWorkersList.length;
	for (const type of ["food", "wood", "stone", "metal"]) {
		if (weights[type] > 0) {
			activeWeights.push(type);
			totalWeight += weights[type];
		}
		totalWorkers += activeGatherers[type].length;
	}

	const toRedirect = [];
	for (const ent of idleWorkersList) {
		toRedirect.push({ "id": ent, "isIdle": true });
	}
	result._bal.idle = idleWorkersList.length;

	let deficits = { "food": 0, "wood": 0, "stone": 0, "metal": 0 };

	// Puxar um coletor ATIVO de um recurso para outro custa a viagem inteira (ida, volta e
	// o tempo parado no caminho). Com população pequena isso pesa muito no total coletado,
	// então só vale com desequilíbrio extremo — o certo é esperar as unidades que estão
	// nascendo e mandá-las direto para o recurso em falta.
	// Acima de 100 de população, um coletor a menos é ruído: pode rebalancear normalmente.
	const popCountRb = cmpPlayer ? cmpPlayer.GetPopulationCount() : 0;
	const bigPopRb = popCountRb > 100;
	const surplusThreshold = bigPopRb ? 8 : 20;

	if (totalWeight > 0) {
		let worstSurplus = -Infinity;
		let worstSurplusRes = null;
		
		for (const type of activeWeights) {
			const targetQuota = (weights[type] / totalWeight) * totalWorkers;
			const currentCount = activeGatherers[type].length;
			const diff = targetQuota - currentCount; // Positivo: precisa de gente. Negativo: excesso.
			deficits[type] = diff;
			result._bal.quota[type] = Math.round(targetQuota);
			result._bal.current[type] = currentCount;
			
			// Rebalancear ativos SOMENTE com excesso extremo (limiar depende da população).
			// Preferir sempre aguardar novos trabalhadores nascidos da produção.
			if (diff < -surplusThreshold) {
				if (-diff > worstSurplus) {
					worstSurplus = -diff;
					worstSurplusRes = type;
				}
			}
		}

		// Tirar worker ativo SOMENTE se:
		//   1. Sem workers ociosos disponíveis (novos nascidos têm prioridade absoluta)
		//   2. Base não está sob ataque
		//   3. Excesso acima do limiar (20 com pop baixa, 8 com pop > 100)
		//   4. Existe recurso carente — com pop baixa, apenas se estiver com ZERO coletores
		// Regra: sempre preferir esperar novos trabalhadores de produção; com pop pequena só
		// redirecionar ativo quando o recurso está completamente sem cobertura.
		const worstDeficitType = activeWeights.reduce((best, t) => {
			if (!bigPopRb && activeGatherers[t].length !== 0) return best;
			return deficits[t] > (best ? deficits[best] : 0) ? t : best;
		}, null);
		if (worstSurplusRes && worstDeficitType && activeGatherers[worstSurplusRes].length > 0 &&
		    idleWorkersList.length === 0 && !baseUnderAttack) {
			const candidates = activeGatherers[worstSurplusRes];
			candidates.sort((a, b) => {
				const idA = Engine.QueryInterface(a, IID_Identity);
				const idB = Engine.QueryInterface(b, IID_Identity);
				const isCivilA = idA && (idA.HasClass("FemaleCitizen") || (idA.HasClass("Organic") && !idA.HasClass("CitizenSoldier") && !idA.HasClass("FastMoving")));
				const isCivilB = idB && (idB.HasClass("FemaleCitizen") || (idB.HasClass("Organic") && !idB.HasClass("CitizenSoldier") && !idB.HasClass("FastMoving")));
				if (worstSurplusRes === "wood" || worstSurplusRes === "stone") {
					if (isCivilA && !isCivilB) return -1;
					if (!isCivilA && isCivilB) return 1;
				} else if (worstSurplusRes === "food") {
					if (!isCivilA && isCivilB) return -1;
					if (isCivilA && !isCivilB) return 1;
				}
				return 0;
			});

			// Apenas 1 worker por ciclo — novos trabalhadores da produção resolvem o resto
			const pullCount = 1;
			let count = 0;
			for (const ent of candidates) {
				if (count >= pullCount) break;
				
				const id = Engine.QueryInterface(ent, IID_Identity);
				if (id && (id.HasClass("CitizenSoldier") || id.HasClass("FastMoving"))) {
					const cmpPos2 = Engine.QueryInterface(ent, IID_Position);
					if (cmpPos2 && cmpPos2.IsInWorld()) {
						const sPos = cmpPos2.GetPosition2D();
						if (cmpTerritoryManager &&
						    cmpTerritoryManager.GetOwner(sPos.x, sPos.y) !== player) continue;
					}
				}
				
				toRedirect.push({ "id": ent, "isIdle": false });
				deficits[worstSurplusRes] += 1; // Ajusta a simulação
				count++;
			}
		}
	}

	const assignedEntities = {};
	
	for (const item of toRedirect) {
		const ent = item.id;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const workerPos = cmpPos.GetPosition2D();

		let closestDs = null;
		let minDsDist = Infinity;
		for (const ds of dropsites) {
			const dx = ds.pos.x - workerPos.x;
			const dz = ds.pos.y - workerPos.y;
			const dist = dx*dx + dz*dz;
			if (dist < minDsDist) { minDsDist = dist; closestDs = ds; }
		}

		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		const isMilitary = cmpId && (cmpId.HasClass("CitizenSoldier") || cmpId.HasClass("FastMoving"));
		// Trabalhador civil: FemaleCitizen OU Organic não-combatente (support_civilian, Ambactos)
		const isFemale = cmpId && (cmpId.HasClass("FemaleCitizen") ||
		    (cmpId.HasClass("Organic") && !cmpId.HasClass("CitizenSoldier") && !cmpId.HasClass("FastMoving")));

		// Vocação por tipo de unidade: aldeão → comida, soldado → madeira, e pedra/metal
		// como segunda vocação do soldado quando a madeira já está atendida.
		// É PREFERÊNCIA, não regra dura: o bônus entra no déficit e a ordenação continua
		// mandando. Se o recurso da vocação não tem déficit (ou não há alvo lá), a unidade
		// vai para o próximo da lista — que é o "senão tiver em quantidade, podem fazer
		// outras funções". O boost antigo do soldado era +0,5 igual para madeira, pedra e
		// metal, então na prática ele não tinha vocação nenhuma: ia para o que estivesse
		// mais vazio no momento.
		let localDeficits = { ...deficits };
		if (isFemale) {
			// Aldeões preferem comida mas respeitam a cota — boost só quando há déficit real
			if ((localDeficits.food || 0) > 0) localDeficits.food = localDeficits.food * 2 + 1.5;
		} else if (cmpId && cmpId.HasClass("CitizenSoldier")) {
			// Comida é a vocação do aldeão: soldado só vai para lá se sobrar necessidade.
			if (localDeficits.food !== undefined) localDeficits.food -= 1.5;
			// Madeira é a vocação primária do soldado — mesmo peso que a comida tem para o
			// aldeão, para que os dois grupos se separem de fato em vez de disputarem.
			if ((localDeficits.wood || 0) > 0) localDeficits.wood = localDeficits.wood * 2 + 1.5;
			// Pedra e metal: vocação secundária. Boost menor, então só vencem a madeira
			// quando a madeira já está coberta e eles estão claramente em falta.
			for (const r of ["stone", "metal"]) {
				if ((localDeficits[r] || 0) > 0) localDeficits[r] += 1;
			}
		}

		// Ordenar os recursos pelo MAIOR déficit (os que mais precisam de gente)
		const sortedRes = activeWeights.slice().sort((a, b) => {
			return localDeficits[b] - localDeficits[a];
		});

		// O que ESTA unidade consegue coletar, lido do próprio componente em vez de
		// deduzido pela classe. GetGatherRates() devolve { "food.meat": 5, "wood.tree": ... }
		// (ResourceGatherer.js:119-132), então o prefixo antes do ponto é o recurso genérico.
		// Campeão nem chega aqui: não tem ResourceGatherer, logo já foi filtrado antes.
		// Verificado nos templates do motor: infantaria coleta os 4 recursos; cavalaria só
		// food.meat. A regra antiga barrava TODA a cavalaria e presumia classes fixas.
		const canGather = new Set();
		try {
			const rates = cmpGatherer.GetGatherRates() || {};
			for (const key in rates)
				if (rates[key] > 0) canGather.add(key.split(".")[0]);
		} catch(e) {}

		// Cavalaria NUNCA passa por aqui: quem a comanda é o ramo de ociosos acima (caçar só
		// dentro da base e sem inimigo), e o scout. Se ela já está caçando, o rebalanceamento
		// não pode arrastá-la para outro recurso.
		if (cmpId && cmpId.HasClass("FastMoving")) continue;

		// Diagnóstico de trabalhador que fica sem alvo. Toda vez que apareceu unidade
		// parada em jogo, a causa estava num `continue` diferente e só deu para achar lendo
		// o código. Registrar aqui QUAIS recursos foram tentados e por que cada um falhou
		// transforma "tem gente parada" num dado, em vez de mais uma rodada de suposição.
		let placed = false;
		const tried = [];

		for (const resType of sortedRes) {
			if (canGather.size > 0 && !canGather.has(resType)) { tried.push(resType + ":naocoleta"); continue; }

			let target = null;
			const isSoldier = cmpId && cmpId.HasClass("CitizenSoldier");
			if (resType === "food") {
				if (isSoldier) {
					// Soldados NUNCA vão para Fields (campos agrícolas): causaria loop de evicção
					// com pudim_GetFarmBuildData que os recoloca em madeira indefinidamente.
					// Soldados só coletam frutas/bagas silvestres.
					target = findNearestResource(workerPos, "food", 250, assignedEntities, true, "fruit");
					if (target && target.tooFar) { notePudimFarFruit(target); target = null; }
				} else {
					target = findFoodResource(workerPos, assignedEntities);
				}
				// Contador decisivo para o desequilíbrio comida/madeira: quantos QUERIAM
				// comida (era o maior déficit) e não acharam vaga. Se este número for alto
				// enquanto a madeira cresce, o problema é capacidade de comida — fazenda de
				// menos —, não a conta de cotas. Sem ele, "10 na comida e 32 na madeira" não
				// distingue as duas causas.
				if (!target && resType === sortedRes[0]) result._bal.foodBlocked++;
			} else {
				// Busca ampla a partir do worker; a fórmula de score (distDropsite * 3) garante
				// que o trabalhador vá para a árvore mais próxima de um dropsite existente,
				// não para floresta isolada distante.
				target = findNearestResource(workerPos, resType, 400, assignedEntities);
			}

			if (target) {
				// Distância da viagem, para o painel dimensionar a carência de reavaliação:
				// uma carência fixa de 6s deixava o detector de long-walker desfazer, no meio
				// do caminho, a mesma ordem que o auto-work tinha acabado de dar.
				const tdx = target.x - workerPos.x, tdz = target.z - workerPos.y;
				assignedWorkers.push({ "id": ent, "x": target.x, "z": target.z, "target": target.id, "type": target.type,
				                       "dist": Math.sqrt(tdx*tdx + tdz*tdz) });
				if (!assignedEntities[target.id]) assignedEntities[target.id] = 0;
				assignedEntities[target.id]++;
				deficits[resType] -= 1;
				// Sinaliza construção proativa de armazém (madeira) ou farmstead (fruta).
				// Dedup por proximidade (60m): não empilha candidato do mesmo cluster já visto.
				if (resType === "wood") {
					let minDsDistSq = Infinity;
					for (const ds of dropsites) {
						const ddx = target.x - ds.pos.x, ddz = target.z - ds.pos.y;
						minDsDistSq = Math.min(minDsDistSq, ddx*ddx + ddz*ddz);
					}
					if (minDsDistSq > 40*40) {
						const dup = result.suggestStorehouse.some(c => {
							const ddx = c.x - target.x, ddz = c.z - target.z;
							return ddx*ddx + ddz*ddz <= 60*60;
						});
						if (!dup) result.suggestStorehouse.push({ x: target.x, z: target.z });
					}
				} else if (resType === "food" && target.type && target.type.specific === "fruit") {
					// Fruta longe de dropsite E frutas saturadas → farmstead proativo.
					// 55m: raio de cobertura real de um dropsite. Só sugere se workers ≥ 80%
					// da capacidade das bagas próximas, para não construir desnecessariamente.
					let minFsDistSq = Infinity;
					for (const ds of dropsites) {
						if (!ds.types || ds.types.indexOf("food") === -1) continue;
						const ddx = target.x - ds.pos.x, ddz = target.z - ds.pos.y;
						minFsDistSq = Math.min(minFsDistSq, ddx*ddx + ddz*ddz);
					}
					const fruitSaturated = totalFruitCapacity === 0 ||
						activeGatherers.food.length >= totalFruitCapacity * 0.80;
					if (minFsDistSq > 55*55 && fruitSaturated) {
						const dup = result.suggestFarmstead.some(c => {
							const ddx = c.x - target.x, ddz = c.z - target.z;
							return ddx*ddx + ddz*ddz <= 60*60;
						});
						if (!dup) result.suggestFarmstead.push({ x: target.x, z: target.z });
					}
				}
				placed = true;
				break;
			}
			tried.push(resType + ":semalvo");
		}

		// Ninguém quis este trabalhador: ele vai ficar parado até o próximo ciclo. Guardar
		// o motivo por recurso é o que faltava — sem isso, "tem gente parada" só se
		// investigava lendo o código, um `continue` de cada vez.
		if (!placed) {
			const kind = !cmpId ? "?" :
				(cmpId.HasClass("CitizenSoldier") ? "soldado" : (isFemale ? "aldeao" : "outro"));
			result.unplaced.push({ id: ent, kind: kind, tried: tried.join(",") || "nenhum_recurso_ativo" });
		}
	}

	if (assignedWorkers.length > 0) {
		result.idleWorkers = assignedWorkers;
	}

	// Frutas da base que só faltam um celeiro para valerem entram NA FRENTE das demais
	// sugestões: enquanto houver baga de pé dentro do território, ela vem antes da fazenda.
	// O painel constrói uma por ciclo e percorre a lista em ordem.
	if (farFruit.length > 0) {
		const rest = result.suggestFarmstead.filter(c => !farFruit.some(f => {
			const dx = f.x - c.x, dz = f.z - c.z;
			return dx*dx + dz*dz <= 60*60;
		}));
		result.suggestFarmstead = farFruit.concat(rest);
	}

	// ── Detectar workers caminhando longe sem coleta (long walkers) ──
	// Worker em estado "Walk"/"Move" sem ordem de coleta iminente está desperdiçando tempo.
	// Redirecionar para o recurso mais próximo de um dropsite existente.
	for (const ent of allEnts) {
		const cmpUnitAI2 = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI2 || cmpUnitAI2.isGarrisoned || cmpUnitAI2.IsIdle()) continue;
		// Se o jogador mandou colher longe, é decisão dele — não redirecionar
		if (pudimSkipUnit(ent, cmpUnitAI2)) continue;
		const cmpId2 = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpId2 || cmpId2.HasClass("CitizenSoldier") || cmpId2.HasClass("FastMoving")) continue;
		if (!Engine.QueryInterface(ent, IID_ResourceGatherer)) continue;

		const ord2 = cmpUnitAI2.orderQueue && cmpUnitAI2.orderQueue.length > 0 ? cmpUnitAI2.orderQueue[0] : null;
		// Quem está indo coletar com alvo longe de qualquer dropsite. Cobre Gather (alvo =
		// entidade) e GatherNearPosition (alvo = coordenada x/z — antes era invisível ao
		// detector, e workers mandados "coletar perto de posição" distante nunca eram tratados).
		if (!ord2 || !ord2.data) continue;
		let targetResType = null;
		let targetPos = null;
		let targetEnt = null;
		if (ord2.type === "Gather" && ord2.data.target) {
			targetEnt = ord2.data.target;
			const cmpTargetRes = Engine.QueryInterface(targetEnt, IID_ResourceSupply);
			if (!cmpTargetRes) continue;
			targetResType = cmpTargetRes.GetType();
			if (!targetResType) continue;
			const cmpTargetPos = Engine.QueryInterface(targetEnt, IID_Position);
			if (!cmpTargetPos || !cmpTargetPos.IsInWorld()) continue;
			targetPos = cmpTargetPos.GetPosition2D();
		} else if (ord2.type === "GatherNearPosition" &&
		           typeof ord2.data.x === "number" && typeof ord2.data.z === "number") {
			// UnitAI guarda o tipo do recurso em data.type (Commands.js: cmd.resourceType → type)
			const rt = ord2.data.type || ord2.data.resourceType;
			if (!rt || !rt.generic) continue;
			targetResType = rt;
			targetPos = { x: ord2.data.x, y: ord2.data.z };
		} else {
			continue;
		}

		// Verificar se o recurso-alvo está longe (> 100m) de qualquer dropsite que aceite esse tipo
		let nearestDropDist = Infinity;
		let nearestDropPos = null;
		for (const ds of dropsites) {
			if (!ds.types || ds.types.indexOf(targetResType.generic) === -1) continue;
			const ddx = targetPos.x - ds.pos.x, ddz = targetPos.y - ds.pos.y;
			const d = Math.sqrt(ddx*ddx + ddz*ddz);
			if (d < nearestDropDist) { nearestDropDist = d; nearestDropPos = ds.pos; }
		}
		if (nearestDropDist <= 100) continue; // 100m de ida = 200m/viagem; acima disso é caminhada demais — age já

		// Encontrar recurso do mesmo tipo mais próximo de um dropsite (< 50m de algum dropsite)
		let bestNearbyRes = null, bestNearbyDistSq = Infinity;
		for (const ds of dropsites) {
			if (!ds.types || ds.types.indexOf(targetResType.generic) === -1) continue;
			const dsPos2D = { x: ds.pos.x, y: ds.pos.y };
			const nearby2 = cmpRangeManager.ExecuteQueryAroundPos(dsPos2D, 5, 80, [0], IID_ResourceSupply, false);
			for (const res2 of nearby2) {
				const rs2 = Engine.QueryInterface(res2, IID_ResourceSupply);
				if (!rs2 || !rs2.IsAvailable()) continue;
				const rt2 = rs2.GetType();
				if (!rt2 || rt2.generic !== targetResType.generic) continue;
				const rp2 = Engine.QueryInterface(res2, IID_Position);
				if (!rp2 || !rp2.IsInWorld()) continue;
				const rpos2 = rp2.GetPosition2D();
				const dx2 = rpos2.x - ds.pos.x, dz2 = rpos2.y - ds.pos.y;
				const dSq2 = dx2*dx2 + dz2*dz2;
				if (dSq2 < bestNearbyDistSq) { bestNearbyDistSq = dSq2; bestNearbyRes = res2; }
			}
		}
		// Sempre registrar — panel tentará construir dropsite perto do alvo; redirect é fallback
		result.longWalkers.push({
			id: ent,
			redirectTarget: (bestNearbyRes && bestNearbyRes !== targetEnt) ? bestNearbyRes : null,
			targetResX: targetPos.x,
			targetResZ: targetPos.y,
			targetResType: targetResType.generic
		});
	}

	return result;
};




// ─── Tática de Fuga ────────────────────────────────────────────────────
// Retorna array de ações de recuo para soldados com HP < 20%.
// Formato: [{ unitId, garrison: bool, target: entityId }]
//       ou [{ unitId, garrison: false, targetX, targetZ }]
// Prioridade: templo com vaga → CC com vaga → caminhar ao lado do CC.
GuiInterface.prototype.pudim_GetAutoRetreatData = function(player, data)
{
	const retreating = (data && data.retreating) || {};
	const actions = [];
	// Unidades que já recuperaram HP (>50%) podem ser removidas do dict de retreating
	const recovered = [];

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	if (!cmpRangeManager) return actions;

	const myUnits = cmpRangeManager.GetEntitiesByPlayer(player);

	// Coletar templos e CCs com vagas de guarnição
	const temples = [], ccs = [], ccPositions = [];
	for (const ent of myUnits) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id) continue;
		if (Engine.QueryInterface(ent, IID_Foundation)) continue;
		const cmpGarrison = Engine.QueryInterface(ent, IID_GarrisonHolder);
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const p = cmpPos.GetPosition2D();
		if (id.HasClass("CivCentre")) {
			ccPositions.push({ x: p.x, z: p.y, id: ent });
			if (cmpGarrison) {
				const free = cmpGarrison.GetCapacity() - cmpGarrison.GetEntities().length;
				if (free > 0) ccs.push({ id: ent, x: p.x, z: p.y, free });
			}
		}
		if (id.HasClass("Temple") && cmpGarrison) {
			const free = cmpGarrison.GetCapacity() - cmpGarrison.GetEntities().length;
			if (free > 0) temples.push({ id: ent, x: p.x, z: p.y, free });
		}
	}

	// Encontrar abrigo mais próximo ao unit
	const findShelter = (unitX, unitZ) => {
		let best = null, bestDist = Infinity;
		for (const t of temples) {
			const dx = t.x - unitX, dz = t.z - unitZ;
			const d = dx*dx + dz*dz;
			if (d < bestDist) { bestDist = d; best = { ...t, type: "temple" }; }
		}
		if (best) return best;
		for (const cc of ccs) {
			const dx = cc.x - unitX, dz = cc.z - unitZ;
			const d = dx*dx + dz*dz;
			if (d < bestDist) { bestDist = d; best = { ...cc, type: "cc" }; }
		}
		return best;
	};

	const fallbackCC = ccPositions.length > 0 ? ccPositions[0] : null;

	for (const ent of myUnits) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id) continue;
		if (!id.HasClass("CitizenSoldier") && !id.HasClass("FastMoving")) continue;
		const cmpHealth = Engine.QueryInterface(ent, IID_Health);
		if (!cmpHealth) continue;
		const hpRatio = cmpHealth.GetHitpoints() / cmpHealth.GetMaxHitpoints();
		// Unidade recuperou: liberar do dict de retreating
		if (retreating[ent] && hpRatio >= 0.50) { recovered.push(ent); continue; }
		if (retreating[ent]) continue;
		if (hpRatio >= 0.20) continue;
		// Já garrisoned ou em fuga
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (cmpUnitAI && cmpUnitAI.isGarrisoned) continue;
		if (cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0) {
			const t = cmpUnitAI.orderQueue[0].type;
			if (t === "Garrison" || t === "Flee") continue;
		}

		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const p = cmpPos.GetPosition2D();

		const shelter = findShelter(p.x, p.y);
		if (shelter) {
			shelter.free--;
			if (shelter.free < 0) {
				if (shelter.type === "temple") { temples.splice(temples.findIndex(t => t.id === shelter.id), 1); }
				else { ccs.splice(ccs.findIndex(c => c.id === shelter.id), 1); }
			}
			actions.push({ unitId: ent, garrison: true, target: shelter.id });
		} else if (fallbackCC) {
			// Sem vaga: caminhar para perto do CC (offset aleatório fixo baseado no ID)
			const offset = (ent % 20) - 10;
			actions.push({ unitId: ent, garrison: false, targetX: fallbackCC.x + offset, targetZ: fallbackCC.z + offset });
		}
	}
	// Embutir recovered junto às actions para o panel desmarcar unidades curadas
	if (recovered.length > 0) actions.recovered = recovered;
	return actions;
};

// ─── Pânico ────────────────────────────────────────────────────
GuiInterface.prototype.pudim_GetPanicData = function(player, data)
{
	const result = {
		underAttack: false,
		isLargeArmy: false,
		enemyCount: 0,
		alliedMilitaryNearby: 0,
		atRiskWorkers: [],
		atRiskSoldiers: [],
		shelters: []
	};

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpDiplomacy = Engine.QueryInterface(playerEnt, IID_Diplomacy);
	if (!cmpRangeManager || !cmpDiplomacy) return result;

	const myEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	const enemies = cmpDiplomacy.GetEnemies();

	// Posições dos CCs como centro da base
	const ccPositions = [];
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (id && id.HasClass("CivCentre")) {
			const pos = Engine.QueryInterface(ent, IID_Position);
			if (pos && pos.IsInWorld()) ccPositions.push(pos.GetPosition2D());
		}
	}

	// Sem CC (destruído) NÃO é "sem ameaça" — é o momento MAIS perigoso da partida.
	// Antes havia `if (ccPositions.length === 0) return result;`, que devolvia
	// underAttack=false: o mod ficava cego para os inimigos dentro da base, o painel
	// concluía "ameaça cessou" e 10s depois despejava todo mundo das casas no meio do
	// exército inimigo. Agora usamos outras estruturas como âncora e, em último caso, as
	// próprias unidades — a detecção continua funcionando com o CC morto.
	const anchorPositions = ccPositions.slice();
	if (anchorPositions.length === 0) {
		for (const ent of myEnts) {
			const id = Engine.QueryInterface(ent, IID_Identity);
			if (!id || !id.HasClass("Structure")) continue;
			if (Engine.QueryInterface(ent, IID_Foundation)) continue;
			const pos = Engine.QueryInterface(ent, IID_Position);
			if (pos && pos.IsInWorld()) anchorPositions.push(pos.GetPosition2D());
		}
	}
	if (anchorPositions.length === 0) {
		for (const ent of myEnts) {
			if (!Engine.QueryInterface(ent, IID_UnitAI)) continue;
			const pos = Engine.QueryInterface(ent, IID_Position);
			if (pos && pos.IsInWorld()) { anchorPositions.push(pos.GetPosition2D()); break; }
		}
	}
	if (anchorPositions.length === 0) return result;
	result.noCivCentre = ccPositions.length === 0;

	// Inimigos combatentes dentro de 220m de qualquer âncora da base (CC ou, se o CC caiu,
	// outra estrutura / a própria tropa — ver bloco acima)
	const enemyNear = [];
	const seenEnemies = new Set();
	for (const ccPos of anchorPositions) {
		const near = cmpRangeManager.ExecuteQueryAroundPos(ccPos, 0, 220, enemies, IID_Identity, false);
		for (const e of near) {
			if (seenEnemies.has(e)) continue;
			const id = Engine.QueryInterface(e, IID_Identity);
			if (id && (id.HasClass("CitizenSoldier") || id.HasClass("FastMoving") || id.HasClass("Hero"))) {
				const pos = Engine.QueryInterface(e, IID_Position);
				if (pos && pos.IsInWorld()) { seenEnemies.add(e); enemyNear.push(e); }
			}
		}
	}

	// MELHORADO: também detectar trabalhadores em fuga (Flee) em qualquer lugar do mapa.
	// Um trabalhador em Flee = inimigo próximo na floresta/campo, mesmo longe do CC.
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id) continue;
		const isWorker = id.HasClass("FemaleCitizen") ||
			(id.HasClass("Organic") && !id.HasClass("CitizenSoldier") && !id.HasClass("FastMoving"));
		if (!isWorker) continue;
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
		if (cmpUnitAI.orderQueue[0].type !== "Flee") continue;
		// Trabalhador fugindo — encontrar inimigos próximos a ele
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const wp = cmpPos.GetPosition2D();
		for (const ep of enemies) {
			const nearWorker = cmpRangeManager.ExecuteQueryAroundPos(wp, 0, 80, [ep], IID_Identity, false);
			for (const e of nearWorker) {
				if (seenEnemies.has(e)) continue;
				const eid = Engine.QueryInterface(e, IID_Identity);
				if (eid && (eid.HasClass("CitizenSoldier") || eid.HasClass("FastMoving") || eid.HasClass("Hero"))) {
					const epos = Engine.QueryInterface(e, IID_Position);
					if (epos && epos.IsInWorld()) { seenEnemies.add(e); enemyNear.push(e); }
				}
			}
		}
	}

	if (enemyNear.length === 0) return result;

	result.underAttack = true;
	result.enemyCount = enemyNear.length;
	result.isLargeArmy = enemyNear.length >= 5;

	// Posições dos inimigos próximos
	const enemyPos = [];
	for (const e of enemyNear) {
		const pos = Engine.QueryInterface(e, IID_Position);
		if (pos && pos.IsInWorld()) enemyPos.push(pos.GetPosition2D());
	}

	// Militares aliados dentro de 200m de qualquer CC
	let alliedMilitary = 0;
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id || !(id.HasClass("CitizenSoldier") || id.HasClass("FastMoving"))) continue;
		const pos = Engine.QueryInterface(ent, IID_Position);
		if (!pos || !pos.IsInWorld()) continue;
		const ep = pos.GetPosition2D();
		// anchorPositions (não ccPositions): com o CC destruído a contagem de defensores
		// dava 0, e "aliados < inimigos" jogava direto em pânico total justo quando é
		// preciso decidir com clareza.
		for (const cc of anchorPositions) {
			const dx = ep.x - cc.x, dz = ep.y - cc.y;
			if (dx*dx + dz*dz < 200*200) { alliedMilitary++; break; }
		}
	}
	result.alliedMilitaryNearby = alliedMilitary;

	// Abrigos: casas, CC, torres, fortalezas com vagas livres
	// Marcados como "safe" se não houver inimigo a ≤ 80m
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id) continue;
		const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
		if (cmpFoundation) continue;

		let shelterType = null;
		if (id.HasClass("House"))            shelterType = "house";
		else if (id.HasClass("CivCentre"))   shelterType = "cc";
		else if (id.HasClass("DefenseTower")) shelterType = "tower";
		else if (id.HasClass("Fortress"))    shelterType = "fortress";
		if (!shelterType) continue;

		const cmpGarrison = Engine.QueryInterface(ent, IID_GarrisonHolder);
		if (!cmpGarrison) continue;
		const maxG = cmpGarrison.GetCapacity();
		const curG = cmpGarrison.GetEntities().length;
		if (maxG - curG <= 0) continue;

		const shelterPosCmp = Engine.QueryInterface(ent, IID_Position);
		if (!shelterPosCmp || !shelterPosCmp.IsInWorld()) continue;
		const sp = shelterPosCmp.GetPosition2D();
		let isSafe = true;
		for (const ep of enemyPos) {
			const dx = sp.x - ep.x, dz = sp.y - ep.y;
			if (dx*dx + dz*dz < 80*80) { isSafe = false; break; }
		}

		result.shelters.push({ id: ent, type: shelterType, freeSlots: maxG - curG, safe: isSafe, x: sp.x, z: sp.y });
	}

	// Exportar posições dos CCs para fallback "ficar perto do CC"
	result.ccPositions = ccPositions.map(p => ({ x: p.x, z: p.y }));

	// Abrigos OCUPADOS que estão cercados: enquanto houver inimigo a ≤80m de um prédio com
	// gente dentro, desguarnecer é sentença de morte. O painel usa isto para nunca soltar
	// ninguém em cerco (foi o que matou as unidades quando o CC caiu).
	let occupiedUnderSiege = 0;
	for (const ent of myEnts) {
		if (Engine.QueryInterface(ent, IID_Foundation)) continue;
		const cmpGar = Engine.QueryInterface(ent, IID_GarrisonHolder);
		if (!cmpGar || cmpGar.GetEntities().length === 0) continue;
		const gp = Engine.QueryInterface(ent, IID_Position);
		if (!gp || !gp.IsInWorld()) continue;
		const gpos = gp.GetPosition2D();
		for (const ep of enemyPos) {
			const dx = gpos.x - ep.x, dz = gpos.y - ep.y;
			if (dx*dx + dz*dz < 80*80) { occupiedUnderSiege++; break; }
		}
	}
	result.sheltersUnderSiege = occupiedUnderSiege;

	// Trabalhadores e soldados em risco (dentro de 120m de inimigo)
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id) continue;
		const cmpHealth = Engine.QueryInterface(ent, IID_Health);
		const pos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpHealth || !pos || !pos.IsInWorld()) continue;
		const ep = pos.GetPosition2D();

		let nearEnemy = false;
		for (const ep2 of enemyPos) {
			const dx = ep.x - ep2.x, dz = ep.y - ep2.y;
			if (dx*dx + dz*dz < 120*120) { nearEnemy = true; break; }
		}
		if (!nearEnemy) continue;

		const isWorker = id.HasClass("FemaleCitizen") ||
			(id.HasClass("Organic") && !id.HasClass("CitizenSoldier") && !id.HasClass("FastMoving") &&
			 !id.HasClass("FishingBoat") && !id.HasClass("Ship"));
		const isSoldier = id.HasClass("CitizenSoldier") || id.HasClass("FastMoving");

		if (isWorker) {
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			let currentOrder = null;
			if (cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0) {
				const ord = cmpUnitAI.orderQueue[0];
				if (ord.type === "Gather" && ord.data && ord.data.target)
					currentOrder = { type: "gather", target: ord.data.target };
			}
			result.atRiskWorkers.push({ id: ent, currentOrder: currentOrder });
		} else if (isSoldier) {
			result.atRiskSoldiers.push({ id: ent });
		}
	}

	return result;
};

// ─── Scout Border ────────────────────────────────────────────────────
GuiInterface.prototype.pudim_GetScoutBorderTarget = function(player, data)
{
	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	if (!cmpTerritoryManager || !cmpTerrain) return { "x": -1, "z": -1 };

	const mapSize = cmpTerrain.GetMapSize();
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const myEnts = cmpRangeManager ? cmpRangeManager.GetEntitiesByPlayer(player) : [];
	let ccX = mapSize / 2, ccZ = mapSize / 2;
	for (const ent of myEnts) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (id && id.HasClass("CivCentre")) {
			const pos = Engine.QueryInterface(ent, IID_Position);
			if (pos && pos.IsInWorld()) { const p = pos.GetPosition2D(); ccX = p.x; ccZ = p.y; break; }
		}
	}

	const mode        = (data && data.mode) || "local";
	const gridSize    = (data && data.gridSize && data.gridSize > 0) ? data.gridSize : 64;
	const blocked     = (data && data.blockedSectors) ? data.blockedSectors : {};
	// Ângulo preferido passado pelo cliente: rotaciona a cada waypoint para patrulha circular
	const theta       = (data && typeof data.theta === "number") ? data.theta : 0;
	const step        = 20;

	// Modo deep com base inimiga conhecida: orbitar ao redor dela a distância segura
	const enemyBasePos = (data && data.enemyBasePos) ? data.enemyBasePos : null;
	if (mode === "deep" && enemyBasePos) {
		const ORBIT_DIST = 120;
		// Passo derivado do raio de chegada REAL, não fixo.
		// O cliente considera "chegou" a menos de sqrt(0.3)×gridSize ≈ 0.55×gridSize, e
		// gridSize é mapSize/8 — ou seja, escala com o mapa. Um passo fixo de 0.7 rad dá
		// corda de ~82m: serve num mapa de 1024 (chegada ~70m) e falha num de 1536, onde a
		// chegada é ~105m e engole a corda — o scout "chega" no ponto seguinte sem sair do
		// lugar e queima a órbita inteira parado. Com 30% de folga sobre o raio de chegada,
		// cada parada fica sempre longe o bastante para exigir deslocamento de verdade.
		const arrivalRadius = 0.5477 * gridSize;
		const sinHalf = Math.min(0.95, (arrivalRadius * 1.3) / (2 * ORBIT_DIST));
		const ORBIT_STEP = 2 * Math.asin(sinHalf);
		// Varredura PROGRESSIVA a partir de theta: devolve o primeiro ponto livre à frente.
		// Antes usava argmax de cos(a - theta); com o anel quase todo bloqueado sobravam
		// poucos pontos e o scout ricocheteava entre eles para sempre (loop de 3 pontos
		// observado em jogo). Avançar sempre no mesmo sentido garante contorno de verdade.
		for (let k = 1; k <= 32; ++k) {
			const a = theta + k * ORBIT_STEP;
			const cx = enemyBasePos.x + Math.cos(a) * ORBIT_DIST;
			const cz = enemyBasePos.z + Math.sin(a) * ORBIT_DIST;
			if (cx < 15 || cx > mapSize - 15 || cz < 15 || cz > mapSize - 15) continue;
			const col = Math.floor(cx / gridSize);
			const row = Math.floor(cz / gridSize);
			if (blocked[col + "," + row]) continue;
			// orbitAngle volta ao cliente para ele avançar theta e nunca reescolher este ponto
			return { "x": cx, "z": cz, "orbitAngle": a };
		}
		// Volta inteira bloqueada: cair na varredura normal de fronteira
	}

	let bestPos   = { "x": -1, "z": -1 };
	let bestScore = -Infinity;

	// Estado de exploração do tile. Sem isto o score do modo profundo era só ângulo +
	// distância do próprio CC: o scout escolhia o tile mais longe na direção da vez, já
	// tivesse ele sido explorado ou não — daí ele revisitar o que ele mesmo (ou outra
	// unidade) já tinha aberto. "hidden" = nunca visto, "fogged" = explorado sem visão
	// agora, "visible" = alguém está enxergando neste instante.
	// A API é sondada com fallback: não consegui confirmar GetLosVisibilityPosition neste
	// build, e uma chamada inexistente dentro do componente derrubaria a consulta inteira.
	// Sem ela o scout apenas volta ao comportamento anterior.
	let losAt = null;
	try {
		if (cmpRangeManager && typeof cmpRangeManager.GetLosVisibilityPosition === "function") {
			cmpRangeManager.GetLosVisibilityPosition(ccX, ccZ, player); // sonda
			losAt = function(x, z) {
				try { return cmpRangeManager.GetLosVisibilityPosition(x, z, player); }
				catch (e) { return null; }
			};
		}
	} catch (e) { losAt = null; }

	// Posição atual do próprio scout. Com a leitura de exploração disponível, é ELA que
	// passa a guiar a escolha entre os tiles inexplorados — ver o score mais abaixo.
	let scoutX = ccX, scoutZ = ccZ;
	if (data && data.scoutId) {
		const spos = Engine.QueryInterface(data.scoutId, IID_Position);
		if (spos && spos.IsInWorld()) { const sp = spos.GetPosition2D(); scoutX = sp.x; scoutZ = sp.y; }
	}

	for (let x = 10; x < mapSize - 10; x += step) {
		for (let z = 10; z < mapSize - 10; z += step) {
			const owner = cmpTerritoryManager.GetOwner(x, z);
			if (owner === player) continue;

			// A exigência de "borda do território" só vale para o modo LOCAL, cuja missão é
			// girar em torno da nossa própria base. Borda do território É a nossa base, por
			// definição — aplicá-la ao modo PROFUNDO prendia o scout no mesmo perímetro do
			// local, que era exatamente a queixa: "o profundo só fica rodeando minha base".
			// No modo profundo sem base inimiga conhecida a missão é ACHAR o inimigo, então
			// varremos o mapa inteiro e o distMod (positivo para deep) puxa para longe.
			if (mode !== "deep") {
				let isBorder = false;
				const neighbors = [ [step,0], [-step,0], [0,step], [0,-step] ];
				for (const n of neighbors) {
					const nx = x + n[0], nz = z + n[1];
					if (nx > 0 && nx < mapSize && nz > 0 && nz < mapSize &&
					    cmpTerritoryManager.GetOwner(nx, nz) === player) {
						isBorder = true; break;
					}
				}
				if (!isBorder) continue;
			}

			// Pular setores bloqueados (água/obstáculo marcado pelo cliente)
			const col = Math.floor(x / gridSize);
			const row = Math.floor(z / gridSize);
			if (blocked[col + "," + row]) continue;

			// Pontuação: combina alinhamento de ângulo (patrulha circular) + preferência de distância
			const dx = x - ccX, dz = z - ccZ;
			const distCC = Math.sqrt(dx*dx + dz*dz);
			const tileAngle = Math.atan2(dz, dx);
			// angleCos: 1 = alinhado com theta, -1 = oposto (força patrulha em sentido horário)
			const angleCos = Math.cos(tileAngle - theta);
			// local: prefere mais próximo; deep: prefere mais longe
			// Peso do modo deep bem maior: com 0.1 o termo de distância chegava a ~75 num
			// mapa grande e perdia para o alinhamento de ângulo (±100), então o scout
			// escolhia sempre o vizinho na direção da vez em vez de ir longe. Com 0.4 a
			// distância domina e o ângulo só decide o sentido da varredura.
			const distMod = mode === "deep" ? distCC * 0.4 : -distCC * 0.1;

			// Só no modo PROFUNDO, cuja missão é descobrir mapa. O modo local roda em volta
			// da própria base, que é explorada por definição — penalizar isso ali só faria
			// a patrulha fugir de casa.
			// O peso é deliberadamente maior que a soma de ângulo (±100) e distância
			// (0.4 × distCC, até ~400 num mapa de 1024): qualquer tile nunca visto tem de
			// ganhar de qualquer tile já explorado. Entre os não explorados, ângulo e
			// distância voltam a decidir, preservando o sentido da varredura.
			let score;
			let exploreMod = 0; // lido depois, fora deste bloco, ao guardar o melhor tile
			if (mode === "deep" && losAt) {
				const vis = losAt(x, z);
				exploreMod = vis === "hidden" ? 1000 : (vis === "visible" ? -300 : 0);

				// Com a exploração conhecida, a distância ao CC deixa de ser critério: ela
				// existia só como PALPITE de "longe = inexplorado". Mantê-la agora fazia o
				// scout, a cada waypoint, mirar o ponto mais distante da base — e como theta
				// gira 45° por parada, o alvo saltava para regiões opostas do mapa. Ele
				// atravessava tudo de volta e de ida pelo mesmo corredor: o "anda nos mesmos
				// lugares" que sobrou depois do filtro de exploração.
				// Agora, entre os inexplorados, vence o MAIS PRÓXIMO DO SCOUT. A fronteira
				// desconhecida é varrida de forma contígua, sem travessias inúteis.
				const sdx = x - scoutX, sdz = z - scoutZ;
				const distScout = Math.sqrt(sdx*sdx + sdz*sdz);
				// angleCos entra com peso pequeno, só para desempatar e manter um sentido de
				// varredura entre tiles igualmente próximos.
				score = exploreMod - distScout * 1.0 + angleCos * 10;
			} else {
				// Sem leitura de exploração: comportamento anterior, guiado por ângulo e
				// distância do CC.
				score = angleCos * 100 + distMod;
			}

			if (score > bestScore) {
				bestScore = score;
				bestPos = { "x": x, "z": z, "unexplored": exploreMod > 0 };
			}
		}
	}

	// losOk diz se a leitura de exploração existiu neste build ou se caiu no fallback.
	// Sem esse sinal não há como julgar em jogo se o scout melhorou ou se a API faltou.
	bestPos.losOk = !!losAt;
	return bestPos;
};



// ─── Fazendas ────────────────────────────────────────────────────
GuiInterface.prototype.pudim_GetFarmBuildData = function(player, data)
{
	const result = { "action": "none", "builderId": null, "template": null, "candidatePositions": [], "workersToRedirect": [], "ccX": 0, "ccZ": 0, "soldierEvictions": [], "_dbg": { "fc": 0, "nfc": 0, "fbc": 0, "tg": 0, "cfm": 0, "df": 0, "wp": 0, "fwc": 0, "fmc": 0, "reason": "init" } };
	
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer) return result;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const mapSize = cmpTerrain ? cmpTerrain.GetMapSize() : 512;
	
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	const ccPositions = [];
	let ccEntity = null;
	let farmCount = 0;

	const farmsteadPositions = [];
	const fieldFoundations = [];
	for (const ent of allEnts) {
		const cmpIdent = Engine.QueryInterface(ent, IID_Identity);
		if (cmpIdent) {
			if (cmpIdent.HasClass("CivCentre")) {
				const pos = Engine.QueryInterface(ent, IID_Position);
				if (pos && pos.IsInWorld()) {
					ccPositions.push(pos.GetPosition2D());
					if (!ccEntity) ccEntity = ent;
				}
			}
			if (cmpIdent.HasClass("Field")) {
				farmCount++;
				// Fundação de campo ainda inacabada. Contada à parte porque ela muda a
				// decisão: enquanto existir uma, não se começa outra.
				if (Engine.QueryInterface(ent, IID_Foundation)) fieldFoundations.push(ent);
			}
			if (cmpIdent.HasClass("Farmstead")) {
				const pos = Engine.QueryInterface(ent, IID_Position);
				if (pos && pos.IsInWorld()) {
					const p = pos.GetPosition2D();
					farmsteadPositions.push({ x: p.x, z: p.y });
				}
			}
		}
	}
	
	result._dbg.fc = farmCount;
	// Limite dinâmico: ~1 fazenda por 5 workers, até 40 total (pop cap 200)
	// O sistema de ratio já controla quando construir — este limite é apenas segurança
	// Teto de fazendas construídas automaticamente. Acima disso o jogador decide se quer
	// mais — o mod não continua expandindo sozinho indefinidamente.
	// Teto proporcional à população. Fixo em 9, ele limitava a comida a 45 trabalhadores
	// (9 x 5) em qualquer situação — com pesos 3/3 e pop 200 o alvo é ~100, então o déficit
	// virava permanente e o excedente ia todo para a madeira. Com ~1 campo por 8 de
	// população: 6 no mínimo (início), 13 em pop 100, 20 em pop 200 (100 vagas de comida).
	// O custo em madeira segue sendo o freio real; madeira é justamente o que sobra.
	const PUDIM_MAX_FARMS = Math.max(6, Math.min(20, Math.ceil(cmpPlayer.GetPopulationCount() / 8)));
	// Capacidade real de um campo, conferida em
	// simulation/templates/template_structure_resource_field.xml: <MaxGatherers>5</MaxGatherers>
	const PUDIM_FIELD_CAPACITY = 5;
	if (farmCount >= PUDIM_MAX_FARMS || ccPositions.length === 0) { result._dbg.reason = "limit"; return result; }

	const hasWoodForFarm = cmpPlayer.GetResourceCounts().wood >= 100;
	if (!hasWoodForFarm) { result._dbg.reason = "nowood"; return result; }
	
	let currentFoodGatherersCount = 0;
	let farFoodWorkers = [];
	let idleBuilders = [];
	
	for (const ent of allEnts) {
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		const cmpBuilder = Engine.QueryInterface(ent, IID_Builder);
		if (!cmpUnitAI || !cmpBuilder) continue;

		const queue = cmpUnitAI.orderQueue;
		if (queue && queue.length > 0) {
			const order = queue[0];
			if (order.type === "Gather") {
				const tgt = order.data.target;
				if (tgt) {
					const rs = Engine.QueryInterface(tgt, IID_ResourceSupply);
					if (rs && rs.GetType().generic === "food") {
						const tgtId = Engine.QueryInterface(tgt, IID_Identity);
						const cmpEntId = Engine.QueryInterface(ent, IID_Identity);
						if (tgtId && tgtId.HasClass("Field")) {
							// Worker numa fazenda — verificar se é soldado (deve ser trocado por aldeão)
							if (cmpEntId && cmpEntId.HasClass("CitizenSoldier")) {
								const cmpSolPos = Engine.QueryInterface(ent, IID_Position);
								if (cmpSolPos && cmpSolPos.IsInWorld()) {
									const sp = cmpSolPos.GetPosition2D();
									result.soldierEvictions.push({ soldierId: ent, farmId: tgt, soldierX: sp.x, soldierZ: sp.y });
								}
								// Não contar soldado como food worker: a fazenda ficará "vaga"
								// para o sistema enviar um aldeão no lugar
							} else {
								currentFoodGatherersCount++;
							}
						} else {
							currentFoodGatherersCount++;
							farFoodWorkers.push(ent);
						}
					}
				}
			}
		} else {
			const cmpId = Engine.QueryInterface(ent, IID_Identity);
			if (cmpId && !cmpId.HasClass("FastMoving")) {
				idleBuilders.push({ent: ent, cmp: cmpBuilder});
			}
		}
	}
	
	// ── Capacidade de comida natural (fruta/arbustos acessíveis) ────────────────────────────
	// Fazenda = segunda opção: só construir quando demand > capacidade da fruta.
	// naturalFoodCapacity = Σ GetMaxGatherers() de cada arbusto acessível com recursos.
	let naturalFoodCount = 0;
	let naturalFoodCapacity = 0;
	let territoryFruitFreeSlots = 0;
	const centerSearch = ccPositions.length > 0 ? ccPositions[0] : {x: mapSize/2, y: mapSize/2};
	const allNaturalFood = cmpRangeManager.ExecuteQueryAroundPos(centerSearch, 0, 300, [0], IID_ResourceSupply, false);
	for (const f of allNaturalFood) {
		const posCmp = Engine.QueryInterface(f, IID_Position);
		if (!posCmp || !posCmp.IsInWorld()) continue;
		const fPos = posCmp.GetPosition2D();
		if (!cmpTerritoryManager) continue;
		let isSafeFood = false;
		if (cmpTerritoryManager.GetOwner(fPos.x, fPos.y) === player) {
			isSafeFood = true;
		} else {
			const pts = [ [10,0], [-10,0], [0,10], [0,-10], [7,7], [-7,7], [7,-7], [-7,-7] ];
			for (const p of pts) {
				if (cmpTerritoryManager.GetOwner(fPos.x + p[0], fPos.y + p[1]) === player) {
					isSafeFood = true; break;
				}
			}
		}
		if (!isSafeFood) continue;
		const rs = Engine.QueryInterface(f, IID_ResourceSupply);
		if (!rs || rs.GetCurrentAmount() <= 0) continue;
		const rt = rs.GetType();
		if (rt && rt.generic === "food" && rt.specific === "fruit") {
			const id = Engine.QueryInterface(f, IID_Identity);
			if (id && (id.HasClass("Predator") || id.HasClass("Dangerous"))) continue;

			// Só conta a fruta que os trabalhadores REALMENTE vão aceitar.
			// findNearestResource descarta comida com score < -200, e o score penaliza a
			// distância ao dropsite com peso 2 — na prática, arbusto a mais de ~100m de um
			// dropsite de comida nunca é escolhido. Contar esses arbustos aqui fazia os dois
			// sistemas discordarem: o de fazendas via "capacidade natural de sobra, não
			// precisa de fazenda", enquanto o de trabalhadores dizia "nenhuma fruta válida"
			// e mandava todo mundo para madeira. Resultado observado em jogo: 6 na comida,
			// 41 na madeira, uma fazenda só.
			// ATENÇÃO aos campos: ccPositions guarda GetPosition2D() cru, que é {x, y} com
			// y = coordenada z; farmsteadPositions foi montado como {x, z}. Misturar os dois
			// dá NaN e o filtro passa a não filtrar nada, silenciosamente.
			let minDropDist = Infinity;
			for (const cc of ccPositions) {
				const ddx = fPos.x - cc.x, ddz = fPos.y - cc.y;
				minDropDist = Math.min(minDropDist, Math.sqrt(ddx*ddx + ddz*ddz));
			}
			for (const fs of farmsteadPositions) {
				const ddx = fPos.x - fs.x, ddz = fPos.y - fs.z;
				minDropDist = Math.min(minDropDist, Math.sqrt(ddx*ddx + ddz*ddz));
			}
			// Vagas livres em fruta DENTRO do território, sem o filtro de distância acima.
			// É a medida de "ainda tem baga de pé na base": enquanto houver, a fazenda espera.
			// Contada aqui, antes do `continue`, justamente para incluir a fruta que hoje está
			// longe de dropsite — essa não é ignorada, é o que dispara o celeiro proativo.
			{
				const maxG = rs.GetMaxGatherers ? rs.GetMaxGatherers() : 0;
				const curG = rs.GetNumGatherers ? rs.GetNumGatherers() : 0;
				if (maxG > curG) territoryFruitFreeSlots += (maxG - curG);
			}

			if (minDropDist > 100) continue;

			naturalFoodCapacity += rs.GetMaxGatherers();
			naturalFoodCount++;
		}
	}

	// ── Ratio: quantos workers de fazenda são necessários ────────────────────────────────
	// Fruta cobre até naturalFoodCapacity workers. Fazendas cobrem o excedente.
	const weights = data && data.weights || {};
	const foodW = weights.food || 0;
	const totalW = (weights.food || 0) + (weights.wood || 0) + (weights.stone || 0) + (weights.metal || 0);
	if (totalW <= 0 || foodW <= 0) { result._dbg.reason = "noweights"; return result; }

	// Memória de função vinda do painel (a mesma de pudim_GetIdleWorkersAndBestResource):
	// { entId: "food" | "wood" | ... } com a última coleta observada antes de a unidade
	// virar construtora.
	const builderOriginFarm = (data && data.builderOrigin) || {};

	let totalGatherers = 0, currentFarmWorkers = 0;
	// Construtores que já pertencem à comida e voltarão para ela ao terminar a obra.
	// Entram como cobertura (abatidos do déficit), não como demanda.
	let pendingFoodWorkers = 0;
	const woodWorkerPool = [];
	for (const ent of allEnts) {
		const cmpUAI = Engine.QueryInterface(ent, IID_UnitAI);
		const cmpBld = Engine.QueryInterface(ent, IID_Builder);
		const cmpId2 = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpUAI || !cmpBld) continue;
		if (cmpId2 && cmpId2.HasClass("FastMoving")) continue;
		if (cmpId2 && cmpId2.HasClass("CitizenSoldier")) continue;
		const q2 = cmpUAI.orderQueue;
		if (!q2 || q2.length === 0) continue;
		const ord2 = q2[0];

		// Quem está CONSTRUINDO também é trabalhador, e do recurso a que pertence.
		// Este censo é separado do de pudim_GetIdleWorkersAndBestResource e ficou de fora
		// da correção anterior: aqui a ordem "Repair" era descartada de vez, então os 5
		// trabalhadores erguendo o celeiro sumiam da conta de comida. O déficit aparente
		// disparava e o mod tirava gente da madeira para cobrir um buraco que não existia.
		//
		// Quem ergue celeiro ou campo é trabalhador de comida por definição: é para lá que
		// ele vai assim que a obra terminar. Para as demais obras vale a memória de função
		// (builderOrigin), o mesmo mecanismo já usado no outro censo.
		//
		// Construtor NUNCA entra em woodWorkerPool: puxá-lo da obra para uma fazenda seria
		// justamente o desperdício que se quer evitar.
		if (ord2.type === "Repair") {
			const bt = ord2.data && ord2.data.target;
			const btId = bt ? Engine.QueryInterface(bt, IID_Identity) : null;
			if (btId && btId.HasClass("Field")) {
				totalGatherers++;
				currentFarmWorkers++; // vai coletar NESTE campo assim que terminar
			} else if (btId && (btId.HasClass("Farmstead") || btId.HasClass("DropsiteFood"))) {
				totalGatherers++;
				// Lado da comida, mas ainda não é gente de campo. Precisa entrar como
				// COBERTURA, não só no total: contá-lo apenas em totalGatherers aumentaria
				// desiredFoodWorkers e, com isso, o próprio déficit — o inverso do que se
				// quer. Ele é subtraído do déficit mais abaixo.
				pendingFoodWorkers++;
			} else if (builderOriginFarm[ent]) {
				totalGatherers++;     // outra obra: conta pelo recurso de origem
			}
			continue;
		}

		if (ord2.type !== "Gather") continue;
		totalGatherers++;
		const tgt2 = ord2.data && ord2.data.target;
		if (!tgt2) continue;
		const rs2 = Engine.QueryInterface(tgt2, IID_ResourceSupply);
		if (!rs2) continue;
		const rt2 = rs2.GetType();
		if (rt2.generic === "food") {
			const tId2 = Engine.QueryInterface(tgt2, IID_Identity);
			if (tId2 && tId2.HasClass("Field")) currentFarmWorkers++;
		} else if (rt2.generic === "wood") {
			woodWorkerPool.push(ent);
		}
	}

	if (totalGatherers === 0) return result;

	// Soldados em madeira aumentam demanda efetiva por comida (eles não fazem fazenda)
	let soldierWoodCount = 0;
	for (const ent of allEnts) {
		const cmpBs = Engine.QueryInterface(ent, IID_Builder);
		if (cmpBs) continue;
		const cmpIds = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIds || cmpIds.HasClass("FastMoving")) continue;
		const cmpUAIs = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUAIs || !cmpUAIs.orderQueue || !cmpUAIs.orderQueue.length) continue;
		const ords = cmpUAIs.orderQueue[0];
		if (ords.type !== "Gather") continue;
		const tgts = ords.data && ords.data.target;
		if (!tgts) continue;
		const rss = Engine.QueryInterface(tgts, IID_ResourceSupply);
		if (!rss) continue;
		const rts = rss.GetType();
		if (rts && rts.generic === "wood") soldierWoodCount++;
	}

	const effectiveTotal = totalGatherers + soldierWoodCount;
	// Quantos workers de comida o ratio exige no total
	const desiredFoodWorkers = Math.min(Math.ceil(effectiveTotal * foodW / totalW), totalGatherers);
	// Fruta cobre até naturalFoodCapacity workers — fazendas cobrem o excedente
	// 9 fazendas x 5 coletores = teto de 45 trabalhadores em comida vinda de fazenda.
	// Sem esse limite o alvo podia pedir mais gente do que as fazendas comportam, gerando
	// déficit permanente: o mod tentaria construir para sempre e os workers excedentes
	// ficariam sem vaga.
	const farmWorkerCap = PUDIM_MAX_FARMS * PUDIM_FIELD_CAPACITY;
	const farmWorkerTarget = Math.min(farmWorkerCap,
		Math.max(0, desiredFoodWorkers - naturalFoodCapacity));
	// pendingFoodWorkers: quem está erguendo celeiro. Já é gente da comida e volta para lá
	// ao terminar — abater do déficit é o que impede o mod de ver um buraco que não existe
	// e ir buscar reforço na madeira. Foi exatamente o caso relatado: 5 trabalhadores no
	// edifício agrícola e o mod tirando gente da madeira para "cobrir" a comida.
	const deficit = farmWorkerTarget - currentFarmWorkers - pendingFoodWorkers;

	result._dbg.pfw = pendingFoodWorkers;
	result._dbg.nfc = naturalFoodCount;
	result._dbg.ncap = naturalFoodCapacity;
	result._dbg.tg = totalGatherers;
	result._dbg.cfm = currentFarmWorkers;
	result._dbg.fwt = farmWorkerTarget;
	result._dbg.df = deficit;
	result._dbg.wp = woodWorkerPool.length;

	// ── Trava: abaixo de pop 100, quem está nascendo cobre o déficit ────────────────────
	// Tirar um trabalhador da madeira custa a viagem inteira (ida, volta e o tempo parado
	// no caminho). Com produção rodando, esse mesmo lugar seria preenchido de graça pela
	// próxima unidade — e foi o que se viu em jogo: o mod tirou um da madeira e, logo
	// depois, mandou o recém-nascido de volta para a madeira. Duas viagens para ficar no
	// mesmo lugar.
	// Desconta do déficit o que já está em produção e limita a 1 remanejamento por ciclo.
	// Não zera de vez para não travar: trainingCount é um lote (3-5), enquanto o déficit
	// cresce junto com a população — quando a comida satura de verdade, o déficit passa o
	// que está nascendo e a fazenda sai. Acima de pop 100 um coletor a menos é ruído e o
	// balanceamento volta ao normal.
	const popFarm = cmpPlayer.GetPopulationCount();
	let effDeficit = deficit;
	if (popFarm < 100) {
		let trainingCount = 0;
		for (const ent of allEnts) {
			const cmpPQ = Engine.QueryInterface(ent, IID_ProductionQueue);
			if (!cmpPQ) continue;
			for (const item of cmpPQ.GetQueue())
				if (item.productiontype === "unit") trainingCount += (item.count || 1);
		}
		result._dbg.trn = trainingCount;
		// Teto de UMA FAZENDA por ciclo (5 vagas), não de 1 trabalhador.
		//
		// O teto de 1 estrangulava a comida e foi a causa do desequilíbrio 10x32 com pesos
		// 3/3. A capacidade de comida é fruta + fazendas; com a fruta esgotada (nfc=0 no
		// log), ela só cresce quando um campo novo sobe. Com 1 trabalhador por ciclo, cada
		// campo saía com um construtor só, demorava a ficar pronto e abria 1 vaga de cada
		// vez — enquanto o auto-work, rodando a cada 500ms, despejava todo mundo na madeira.
		// A conta de cota estava certa o tempo todo (alvo 22 de comida, tinha 18); o gargalo
		// era a velocidade de abrir vaga.
		//
		// Cinco é o tamanho de um campo: eles erguem a fundação juntos e ficam colhendo ali,
		// que é exatamente o "cada fazenda comporta 5 trabalhadores". O desconto por
		// trainingCount continua valendo, então a regra de esperar quem está nascendo é
		// preservada — o que muda é o teto quando NÃO há ninguém nascendo.
		effDeficit = Math.min(deficit - trainingCount, PUDIM_FIELD_CAPACITY);
	}
	result._dbg.edf = effDeficit;

	if (effDeficit <= 0 || woodWorkerPool.length === 0) {
		result._dbg.reason = woodWorkerPool.length === 0 ? "nowood2"
			: (deficit > 0 ? "aguarda_nascimento" : "nodeficit");
		return result;
	}
	farFoodWorkers = woodWorkerPool.slice(0, effDeficit);

	// ── Verificar se fazendas existentes têm capacidade livre ────────────────────────────
	// (GetMaxGatherers de um campo = 5, conferido no template; GetNumGatherers = atual agora)
	// Se há espaço: redirecionar workers para a fazenda mais próxima.
	// Só construir nova fazenda quando não houver mais espaço nas existentes.
	const farmsWithCap = [];
	for (const ent of allEnts) {
		const cmpIdent = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdent || !cmpIdent.HasClass("Field")) continue;
		const rs = Engine.QueryInterface(ent, IID_ResourceSupply);
		if (!rs || rs.GetCurrentAmount() <= 0) continue;
		const freeSlots = rs.GetMaxGatherers() - rs.GetNumGatherers();
		if (freeSlots <= 0) continue;
		const cmpFPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpFPos || !cmpFPos.IsInWorld()) continue;
		const fp = cmpFPos.GetPosition2D();
		farmsWithCap.push({ id: ent, x: fp.x, z: fp.y, freeSlots });
	}

	result._dbg.fwc = farFoodWorkers.length;
	result._dbg.fmc = farmsWithCap.length;
	// Só redirecionar EM VEZ de construir quando a capacidade livre cobre todo o déficit.
	// Antes bastava UMA fazenda com UMA vaga para o mod devolver "assign" e nunca mais
	// construir — por isso, depois que as frutas acabavam, ele fazia as primeiras fazendas
	// e parava para sempre. Com o déficit maior que as vagas, agora constrói mais uma.
	const totalFreeSlots = farmsWithCap.reduce(function(s, f) { return s + f.freeSlots; }, 0);
	result._dbg.tfs = totalFreeSlots;
	if (farmsWithCap.length > 0 && totalFreeSlots >= farFoodWorkers.length) {
		// Distribuir workers para fazendas com espaço (mais próxima primeiro)
		const assignments = [];
		const usedSlots = {}; // farmId → slots já alocados nesta rodada
		for (const worker of farFoodWorkers) {
			const cmpWPos = Engine.QueryInterface(worker, IID_Position);
			if (!cmpWPos || !cmpWPos.IsInWorld()) continue;
			const wp = cmpWPos.GetPosition2D();
			let best = null, bestDist = Infinity;
			for (const farm of farmsWithCap) {
				const used = usedSlots[farm.id] || 0;
				if (used >= farm.freeSlots) continue;
				const dx = farm.x - wp.x, dz = farm.z - wp.z;
				const d = dx*dx + dz*dz;
				if (d < bestDist) { bestDist = d; best = farm; }
			}
			if (!best) break; // sem mais capacidade em nenhuma fazenda
			assignments.push({ workerId: worker, farmId: best.id });
			usedSlots[best.id] = (usedSlots[best.id] || 0) + 1;
		}
		if (assignments.length > 0) {
			result.action = "assign";
			result.farmAssignments = assignments;
			return result;
		}
	}

	// Fruta antes de fazenda: enquanto houver baga de pé dentro do território com vaga
	// livre, o campo espera. Antes essa checagem não existia — a capacidade natural
	// desconsiderava toda fruta a mais de 100m de um dropsite, então com bagas ainda
	// inteiras na base o sistema via "capacidade zero" e partia direto para os campos.
	// Essas mesmas bagas agora viram pedido de celeiro (ver farFruit em
	// pudim_GetIdleWorkersAndBestResource); erguido o celeiro, elas entram na capacidade
	// natural e a conta de déficit volta a decidir sozinha.
	// O piso de 5 vagas evita travar a economia para sempre por causa de meia moita: abaixo
	// disso a fruta restante não sustenta ninguém e a fazenda segue normalmente.
	result._dbg.tffs = territoryFruitFreeSlots;
	if (territoryFruitFreeSlots >= 5) {
		result._dbg.reason = "fruta_na_base:" + territoryFruitFreeSlots;
		return result;
	}

	// Uma fazenda de cada vez. Cada campo comporta 5 trabalhadores, e o ciclo de decisão
	// roda a cada 30s com os poucos trabalhadores livres do momento — sem esta trava, cada
	// ciclo abria um campo novo com 1 construtor. O resultado em jogo foram 3 fazendas
	// simultâneas com 1 trabalhador em cada: o custo em madeira sai todo de uma vez, as três
	// demoram três vezes mais para ficarem prontas e nenhuma produz enquanto isso.
	// Havendo fundação em aberto, todo mundo vai terminá-la; a próxima só começa depois.
	if (fieldFoundations.length > 0) {
		result.action = "assist";
		result.assistTarget = fieldFoundations[0];
		result.workersToRedirect = farFoodWorkers;
		result._dbg.reason = "fundacao_aberta:" + fieldFoundations.length;
		return result;
	}

	result.action = "build";

	let bId = null;
	if (farFoodWorkers.length > 0) {
		bId = farFoodWorkers[0];
	} else if (idleBuilders.length > 0) {
		bId = idleBuilders[0].ent;
	} else {
		for (const ent of allEnts) {
			const cmpId = Engine.QueryInterface(ent, IID_Identity);
			const cmpBuilder = Engine.QueryInterface(ent, IID_Builder);
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (cmpId && cmpBuilder && !cmpId.HasClass("FastMoving")) {
				if (cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 && cmpUnitAI.orderQueue[0].type === "Repair") continue;
				bId = ent; break;
			}
		}
	}
	result.builderId = bId;

	let civ = "gaul";
	if (ccEntity) {
		const ccIdent = Engine.QueryInterface(ccEntity, IID_Identity);
		if (ccIdent) civ = ccIdent.GetCiv();
	}
	let fieldTemplate = "structures/" + civ + "/field"; // Fallback
	if (bId) {
		const cmpBuilder = Engine.QueryInterface(bId, IID_Builder);
		if (cmpBuilder) {
			const buildables = cmpBuilder.GetEntitiesList();
			for (const tpl of buildables) {
				if (tpl.indexOf("field") !== -1) {
					fieldTemplate = tpl;
					break;
				}
			}
		}
	}
	result.template = fieldTemplate;

	let cx = mapSize/2, cz = mapSize/2;
	if (ccPositions.length > 0) {
		cx = ccPositions[0].x; cz = ccPositions[0].y;
	}
	result.ccX = cx;
	result.ccZ = cz;

	// Segurança territorial: proporção de tiles do jogador num anel amostrado.
	// Retorna 0..1 (1 = interior; 0 = na fronteira inimiga).
	const computeSafety = function(x, z, radius) {
		if (!cmpTerritoryManager) return 1.0;
		let owned = 0;
		for (let i = 0; i < 8; i++) {
			const angle = (i / 8) * 2 * Math.PI;
			if (cmpTerritoryManager.GetOwner(x + Math.cos(angle) * radius, z + Math.sin(angle) * radius) === player) owned++;
		}
		return owned / 8;
	};

	// Seed points em ORDEM DE PREFERÊNCIA: primeiro o Centro Cívico, depois os celeiros
	// do mais próximo do CC para o mais distante. Antes os celeiros vinham primeiro e o CC
	// só era considerado quando NÃO havia nenhum celeiro — o oposto do pretendido: as
	// fazendas fugiam do centro assim que o primeiro celeiro subia.
	const allSeeds = [];
	for (const cc of ccPositions) allSeeds.push({ x: cc.x, z: cc.y });
	if (allSeeds.length === 0) allSeeds.push({ x: cx, z: cz });

	// Celeiros ordenados pela distância ao CC mais próximo — "o agrícola mais próximo do
	// centro, e por aí vai".
	const fsByDist = farmsteadPositions.map(function(fs) {
		let best = Infinity;
		for (const s of allSeeds) {
			const dx = fs.x - s.x, dz = fs.z - s.z;
			best = Math.min(best, dx*dx + dz*dz);
		}
		return { x: fs.x, z: fs.z, dCC: best };
	}).sort(function(a, b) { return a.dCC - b.dCC; });
	for (const fs of fsByDist) allSeeds.push({ x: fs.x, z: fs.z });

	// Safety continua sendo calculada, mas agora só EXCLUI seeds na fronteira inimiga —
	// não reordena. A ordem é a preferência acima; segurança é filtro, não critério.
	for (const s of allSeeds) s.safety = computeSafety(s.x, s.z, 80);
	const safeSeeds = allSeeds.filter(s => s.safety >= 0.5);
	const seedPoints = safeSeeds.length > 0 ? safeSeeds : allSeeds.slice(0, 1);

	// Anéis de 6 até 90 units ao redor de cada seed (celeiro/CC).
	// O teto anterior era 30, com 8 direções fixas: 40 pontos por seed, dentro de um
	// círculo que o CC, as casas e as primeiras fazendas já ocupavam. Depois da terceira
	// fazenda nenhum candidato passava no teste de colisão e o mod parava de construir —
	// no log de 14/08 o resultado era `fc=3` com `action=build` a cada ciclo e o déficit
	// subindo (4 → 4 → 7), ou seja, decidia construir e nunca conseguia.
	// O número de direções acompanha o raio (~12 units entre pontos vizinhos do anel):
	// com 8 fixas, um anel de 90 deixaria vãos de 70 units e perderia espaço livre óbvio.
	// A ordenação abaixo continua preferindo perto e seguro, então os anéis largos só
	// entram em jogo quando os de perto acabaram.
	const candidates = [];
	// Tetos de custo: cada candidato faz uma consulta espacial. O teto POR SEED existe para
	// que o primeiro (o CC) não consuma a cota inteira e deixe os celeiros sem candidato.
	const PUDIM_FARM_CAND_PER_SEED = 250;
	const PUDIM_FARM_CAND_TOTAL = 600;
	outerSeeds: for (let si = 0; si < seedPoints.length; si++) {
		const seed = seedPoints[si];
		let nSeed = 0;
		for (let r = 6; r <= 90; r += 6) {
			const dirs = Math.max(8, Math.round(2 * Math.PI * r / 12));
			for (let i = 0; i < dirs; i++) {
				const angle = (i / dirs) * 2 * Math.PI;
				candidates.push({
					x: Math.max(15, Math.min(mapSize - 15, seed.x + Math.cos(angle) * r)),
					z: Math.max(15, Math.min(mapSize - 15, seed.z + Math.sin(angle) * r)),
					seedIdx: si,
					rSeed: r
				});
				if (++nSeed >= PUDIM_FARM_CAND_PER_SEED) break;
				if (candidates.length >= PUDIM_FARM_CAND_TOTAL) break outerSeeds;
			}
			if (nSeed >= PUDIM_FARM_CAND_PER_SEED) break;
		}
	}

	const validCandidates = [];
	for (const c of candidates) {
		if (c.x < 15 || c.x > mapSize - 15 || c.z < 15 || c.z > mapSize - 15) continue;
		if (cmpTerritoryManager.GetOwner(c.x, c.z) !== player) continue;
		const nearbyRes = cmpRangeManager.ExecuteQueryAroundPos(c, 0, 7, [0], IID_ResourceSupply, false);
		if (nearbyRes.length > 0) continue;
		// Calcular safety do candidato (raio 60m) para usar no sort
		c.safety = computeSafety(c.x, c.z, 60);
		validCandidates.push(c);
	}

	// Ordenar seguindo a preferência pedida: esgota o entorno do CC antes de passar ao
	// celeiro mais próximo do CC, e assim por diante. A segurança territorial passou a ser
	// desempate DENTRO de cada seed, não critério primário — como critério primário ela
	// embaralhava a ordem dos seeds e mandava a fazenda para o celeiro distante só porque
	// o entorno dele pontuava um tier acima.
	validCandidates.sort((a, b) => {
		if (a.seedIdx !== b.seedIdx) return a.seedIdx - b.seedIdx;
		const tierA = Math.round(a.safety * 4); // 0..4
		const tierB = Math.round(b.safety * 4);
		if (tierA !== tierB) return tierB - tierA; // mais seguro primeiro
		return a.rSeed - b.rSeed;                  // e mais colado ao seed
	});

	result.candidatePositions = validCandidates;
	// Retornar todos os workers coletando comida fora de fazendas (para dividir em grupos de 5)
	result.workersToRedirect = farFoodWorkers;
	return result;
};


// ─── DUMMY STUBS PARA FUNÇÕES DELETADAS ──────────────────────────────────────────

GuiInterface.prototype.pudim_GetAllyStats = function(player, args) {
    let cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
    let cmpPlayer = QueryPlayerIDInterface(player, IID_Player);
    if (!cmpPlayerManager || !cmpPlayer) return [];
    
    const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
    let allies = [];
    let cmpDiplomacy = QueryPlayerIDInterface(player, IID_Diplomacy);

    // ── Quem está sendo atacado: UMA varredura das entidades inimigas ────────────────
    // Esta varredura ficava DENTRO do laço de aliados: num 4v4 ela rodava 16 vezes por
    // segundo (4 aliados × 4 inimigos), percorrendo todas as entidades de cada inimigo.
    // Agora é uma passada só, montando dono-atacado → posições atingidas, e cada aliado
    // apenas consulta o mapa. O resultado é o mesmo com uma fração do custo.
    const attackedByOwner = {};
    {
        const globalEnemies = cmpDiplomacy ? (cmpDiplomacy.GetEnemies() || []) : [];
        for (const ep of globalEnemies) {
            const eEnts = cmpRangeManager.GetEntitiesByPlayer(ep) || [];
            for (const eE of eEnts) {
                const eAI = Engine.QueryInterface(eE, IID_UnitAI);
                if (!eAI || !eAI.orderQueue || !eAI.orderQueue.length) continue;
                const eOrd = eAI.orderQueue[0];
                if (eOrd.type !== "Attack" && eOrd.type !== "WalkAndFight") continue;
                const tgt = eOrd.data && eOrd.data.target;
                if (!tgt) continue;
                const tOwn = Engine.QueryInterface(tgt, IID_Ownership);
                if (!tOwn) continue;
                const owner = tOwn.GetOwner();
                if (owner <= 0) continue;
                const tHp = Engine.QueryInterface(tgt, IID_Health);
                if (!tHp || tHp.GetHitpoints() <= 0) continue;
                const tp = Engine.QueryInterface(tgt, IID_Position);
                if (!tp || !tp.IsInWorld()) continue;
                const tpp = tp.GetPosition2D();
                if (!attackedByOwner[owner]) attackedByOwner[owner] = [];
                attackedByOwner[owner].push({ x: tpp.x, z: tpp.y });
            }
        }
    }

    for (let i = 1; i < cmpPlayerManager.GetNumPlayers(); ++i) {
        let cmpAlly = QueryPlayerIDInterface(i, IID_Player);
        if (cmpAlly && cmpDiplomacy && (cmpDiplomacy.IsMutualAlly(i) || i === player)) {
            let stats = {
                "id": i,
                // Cor do jogador (componentes 0..1). Sem isto o cliente cai no branco
                // e todos os nomes da barra ficam iguais.
                "color": cmpAlly.GetColor ? cmpAlly.GetColor() : null,
                "isSelf": i === player,
                "popCount": cmpAlly.GetPopulationCount(),
                "popLimit": cmpAlly.GetPopulationLimit(),
                "res": cmpAlly.GetResourceCounts(),
                "phase": 1,
                "isResearchingPhase": false,
                "gatherers": { "food": 0, "wood": 0, "stone": 0, "metal": 0, "isUnderAttack": false },
                "inCombat": false,      // tropas deste jogador lutando agora
                "combatPos": null,      // {x, z} do foco da luta (para o flare)
                "combatSize": 0,        // unidades no foco — filtro de escaramuça
                "kills": 0,
                "deaths": 0,
                "support": 0, "infantry": 0, "cavalry": 0, "ranged": 0, "siege": 0, "champion": 0
            };
            
            const cmpStatisticsTracker = QueryPlayerIDInterface(i, IID_StatisticsTracker);
            if (cmpStatisticsTracker) {
                let tkills = 0, tdeaths = 0;
                if (cmpStatisticsTracker.enemyUnitsKilled) {
                    for (let key in cmpStatisticsTracker.enemyUnitsKilled) tkills += cmpStatisticsTracker.enemyUnitsKilled[key];
                }
                if (cmpStatisticsTracker.unitsLost) {
                    for (let key in cmpStatisticsTracker.unitsLost) tdeaths += cmpStatisticsTracker.unitsLost[key];
                }
                stats.kills = tkills;
                stats.deaths = tdeaths;
            }
            
            const cmpTechMgr = QueryPlayerIDInterface(i, IID_TechnologyManager);
            if (cmpTechMgr) {
                if (cmpTechMgr.IsTechnologyResearched("phase_city")) stats.phase = 3;
                else if (cmpTechMgr.IsTechnologyResearched("phase_town")) stats.phase = 2;
                
                if (cmpTechMgr.IsTechnologyQueued("phase_town") || cmpTechMgr.IsTechnologyQueued("phase_city")) {
                    stats.isResearchingPhase = true;
                }
            }
            
            // Inimigos REAIS deste jogador. Usado para não confundir caça com batalha:
            // atacar galinha/veado é ordem "Attack" contra Gaia (owner 0), não combate.
            const cmpAllyDiplo = QueryPlayerIDInterface(i, IID_Diplomacy);
            const allyEnemies = cmpAllyDiplo ? (cmpAllyDiplo.GetEnemies() || []) : [];
            const isRealEnemy = (owner) => owner > 0 && allyEnemies.indexOf(owner) !== -1;
            // Pontos de contato de combate — o flare vai no centro do maior aglomerado,
            // não na primeira unidade que aparecer na iteração (ordem arbitrária).
            const combatPoints = [];

            const ents = cmpRangeManager.GetEntitiesByPlayer(i);
            if (ents) {
                for (let ent of ents) {
                    const cmpIdentity = Engine.QueryInterface(ent, IID_Identity);
                    if (!cmpIdentity) continue;
                    
                    if (cmpIdentity.HasClass("Support")) stats.support++;
                    if (cmpIdentity.HasClass("CitizenSoldier") && !cmpIdentity.HasClass("FastMoving")) stats.infantry++;
                    if (cmpIdentity.HasClass("FastMoving")) stats.cavalry++;
                    if (cmpIdentity.HasClass("Ranged")) stats.ranged++;
                    if (cmpIdentity.HasClass("Siege")) stats.siege++;
                    if (cmpIdentity.HasClass("Champion")) stats.champion++;
                    
                    const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
                    const _ord0es = cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
                    if (_ord0es && _ord0es.type === "Gather") {
                        if (_ord0es.data && _ord0es.data.type) {
                            const resType = _ord0es.data.type.generic;
                            if (stats.gatherers[resType] !== undefined) {
                                stats.gatherers[resType]++;
                            }
                        }
                    }
                    
                    // Combate: unidade com ordem Attack/WalkAndFight cujo alvo esteja vivo.
                    // Serve para o pisca-pisca da barra de aliados e para o flare automático.
                    // Guardamos também a posição para o flare cair no local certo.
                    if (_ord0es && (_ord0es.type === "Attack" || _ord0es.type === "WalkAndFight")) {
                        const tgt = _ord0es.data && _ord0es.data.target;
                        if (tgt) {
                            // Só conta como combate se o alvo pertence a um jogador INIMIGO.
                            // Gaia (owner 0) = caça/animais: nunca é batalha.
                            const tOwnC = Engine.QueryInterface(tgt, IID_Ownership);
                            if (tOwnC && isRealEnemy(tOwnC.GetOwner())) {
                                const tgtHp = Engine.QueryInterface(tgt, IID_Health);
                                if (tgtHp && tgtHp.GetHitpoints() > 0) {
                                    const cp = Engine.QueryInterface(ent, IID_Position);
                                    if (cp && cp.IsInWorld()) {
                                        const cpp = cp.GetPosition2D();
                                        // formato {x, z}: é o que triggerFlareAction espera
                                        combatPoints.push({ x: cpp.x, z: cpp.y });
                                    }
                                }
                            }
                        }
                    }
                }
            }

            // Também conta como combate estar SOFRENDO ataque: inimigo com ordem de ataque
            // mirando uma unidade/estrutura deste jogador (pega quem está só apanhando).
            // Posição dos NOSSOS alvos atacados: é lá que o reforço precisa chegar.
            // Vem do mapa montado numa passada única antes deste laço.
            if (combatPoints.length === 0 && attackedByOwner[i])
                for (const p of attackedByOwner[i])
                    combatPoints.push(p);

            // Foco do combate: centroide do MAIOR aglomerado de contatos (raio 40m).
            // Antes usava a primeira unidade encontrada — com ordem de iteração arbitrária
            // o flare caía numa escaramuça isolada em vez da batalha principal.
            if (combatPoints.length > 0) {
                stats.inCombat = true;
                let bestIdx = 0, bestCount = -1;
                for (let a = 0; a < combatPoints.length; ++a) {
                    let c = 0;
                    for (let b = 0; b < combatPoints.length; ++b) {
                        const dxc = combatPoints[a].x - combatPoints[b].x;
                        const dzc = combatPoints[a].z - combatPoints[b].z;
                        if (dxc*dxc + dzc*dzc <= 40*40) ++c;
                    }
                    if (c > bestCount) { bestCount = c; bestIdx = a; }
                }
                let sx = 0, sz = 0, n = 0;
                for (const p of combatPoints) {
                    const dxc = p.x - combatPoints[bestIdx].x;
                    const dzc = p.z - combatPoints[bestIdx].z;
                    if (dxc*dxc + dzc*dzc <= 40*40) { sx += p.x; sz += p.z; ++n; }
                }
                stats.combatPos = { x: sx / n, z: sz / n };
                // Quantas unidades no foco — o flare exige um mínimo para não avisar escaramuça.
                stats.combatSize = bestCount;
            }

            allies.push(stats);
        }
    }
    return allies;
};
GuiInterface.prototype.pudim_GetAutoHouseData = function(player, data) {
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer) return null;

	const pop = cmpPlayer.GetPopulationCount();
	const popLimit = cmpPlayer.GetPopulationLimit();
	const maxPop = cmpPlayer.GetMaxPopulation();
	const threshold = data.threshold || 3;
	const rawHeadroom = popLimit - pop;

	// Fast-path: headroom grande demais para precisar calcular fila de treino
	if (rawHeadroom > threshold + 20) return { _skip: "pop+" + rawHeadroom + ">" + threshold, stuckGhosts: [] };
	if (popLimit >= maxPop) return { _skip: "atCap", stuckGhosts: [] };

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);

	// Contar unidades em treino (pop projetada): build antes de atingir o cap
	let trainingCount = 0;
	for (const ent of allEnts) {
		const cmpPQ = Engine.QueryInterface(ent, IID_ProductionQueue);
		if (!cmpPQ) continue;
		const q = cmpPQ.GetQueue();
		for (const item of q) {
			if (item.productiontype === "unit") trainingCount += (item.count || 1);
		}
	}
	const projectedHeadroom = rawHeadroom - trainingCount;
	if (projectedHeadroom > threshold) return { _skip: "pop+" + rawHeadroom + "|trn=" + trainingCount + ">" + threshold, stuckGhosts: [] };

	let civ = "gaul";
	let ccPosList = [];
	let housePosList = [];
	let isBuildingHouseActive = false;
	let houseFoundationCount = 0; // fundações ativas — cap em 2 para evitar burst
	let stuckGhosts = [];

	// Pré-passe: detectar se algum builder está a caminho de uma fundação de CASA especificamente.
	// Não basta checar order.type === "Repair" pois isso inclui storehouses, farmsteads etc.,
	// o que faria o sistema pensar que uma casa está sendo construída quando não está.
	let anyBuilderInTransit = false;
	for (const ent of allEnts) {
		const cmpBuilder = Engine.QueryInterface(ent, IID_Builder);
		if (!cmpBuilder) continue;
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		const _ord0h = cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
		if (!_ord0h || _ord0h.type !== "Repair") continue;
		const targetId = _ord0h.data && _ord0h.data.target;
		if (!targetId) continue;
		const targetIdent = Engine.QueryInterface(targetId, IID_Identity);
		const targetFound = Engine.QueryInterface(targetId, IID_Foundation);
		if (targetIdent && targetFound && targetIdent.HasClass("House")) {
			anyBuilderInTransit = true;
			break;
		}
	}

	let productionBuildingCount = 0; // CC + Barracks: cada um treina gente, então cada um "gasta" headroom mais rápido
	for (const ent of allEnts) {
		const cmpIdent = Engine.QueryInterface(ent, IID_Identity);
		if (cmpIdent) {
			if (cmpIdent.HasClass("CivCentre")) {
				civ = cmpIdent.GetCiv();
				const posCmp = Engine.QueryInterface(ent, IID_Position);
				if (posCmp && posCmp.IsInWorld()) ccPosList.push(posCmp.GetPosition2D());
				if (!Engine.QueryInterface(ent, IID_Foundation)) productionBuildingCount++;
			}
			if (cmpIdent.HasClass("Barracks") && !Engine.QueryInterface(ent, IID_Foundation))
				productionBuildingCount++;
			if (cmpIdent.HasClass("House")) {
				const posCmp = Engine.QueryInterface(ent, IID_Position);
				if (posCmp && posCmp.IsInWorld()) housePosList.push(posCmp.GetPosition2D());
			}
		}

		const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
		if (cmpFoundation && cmpIdent && cmpIdent.HasClass("House")) {
			houseFoundationCount++;
			if (cmpFoundation.GetNumBuilders() > 0) {
				// Pipeline: fundação a ≥60% NÃO conta como "ativa" — libera colocar a próxima
				// já, colada nesta; ao terminar, os builders emendam nela via autocontinue do
				// motor sem ficarem ociosos entre uma casa e outra.
				if (cmpFoundation.GetBuildProgress() < 0.6)
					isBuildingHouseActive = true;
			} else if (anyBuilderInTransit) {
				isBuildingHouseActive = true;
			} else {
				stuckGhosts.push(ent);
			}
		}
	}

	// Cap de casas em paralelo escala com CC+Quartéis: quanto mais edifícios de produção,
	// mais rápido a população cresce, então precisa de mais casas em construção ao mesmo
	// tempo pra não bater no teto (antes era sempre 2, fixo, virava gargalo com 2+ CCs/quartéis).
	const maxParallelHouses = Math.max(2, productionBuildingCount);
	if (houseFoundationCount >= maxParallelHouses)
		return { _skip: "max_parallel:" + maxParallelHouses + " fnd=" + houseFoundationCount, stuckGhosts: stuckGhosts };
	// Se uma casa está sendo construída e o headroom projetado ainda está OK, aguarda
	if (isBuildingHouseActive && projectedHeadroom > Math.floor(threshold / 2)) return { _skip: "huc:active", stuckGhosts: stuckGhosts };
	if (ccPosList.length === 0) return { _skip: "noCC", stuckGhosts: stuckGhosts };

	const ccPos = ccPosList[0];
	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const mapSize = cmpTerrain ? cmpTerrain.GetMapSize() : 512;

	let builders = [];
	let workerPosList = [];
	let idleBuilders = [];
	
	for (const ent of allEnts) {
		const cmpBuilder = Engine.QueryInterface(ent, IID_Builder);
		if (!cmpBuilder) continue;

		let canBuildHouse = false;
		for (const tpl of cmpBuilder.GetEntitiesList()) {
			if (tpl.indexOf("house") !== -1 && tpl.indexOf("storehouse") === -1 && tpl.indexOf("farmhouse") === -1 && tpl.indexOf("ice_house") === -1) {
				canBuildHouse = true;
				break;
			}
		}
		if (!canBuildHouse) continue;
		
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		const _ord0ah = cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
		if (_ord0ah && _ord0ah.type === "Repair") continue; // PROTEGE QUEM ESTÁ CONSTRUINDO

		builders.push(ent);

		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) {
		    idleBuilders.push(ent);
		}
	}

	if (builders.length === 0) return { _skip: "noBuilders", stuckGhosts: stuckGhosts };

	let targetX = ccPos.x;
	let targetZ = ccPos.y;

	// ── QUEM constrói é decidido ANTES de ONDE ────────────────────────────────────
	// A versão anterior fazia o inverso: ancorava a casa no centroide de `builders`,
	// que é TODA unidade capaz de construir — ou seja, a base inteira, cujo centroide
	// cai praticamente em cima do CC. Só depois escolhia os construtores, por uma
	// ordem (ocioso → recurso mais abundante → resto) que não olhava distância nenhuma.
	// O resultado observado em jogo: armazém erguido em (1043,1344), casas nascendo em
	// (1043,1206) e (1063,1206), e os lenhadores do armazém atravessando ~130 units
	// para construí-las. Escolhendo primeiro um construtor-semente e ancorando a casa
	// nele, a caminhada passa a ser mínima por construção.

	// Contar coletores por recurso para priorizar builders do recurso mais abundante
	const gatherersPerRes = {};
	for (const ent of allEnts) {
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
		const ord = cmpUnitAI.orderQueue[0];
		if (ord.type !== "Gather" && ord.type !== "GatherNearPosition" && ord.type !== "ReturnResource") continue;
		const resType = (ord.data && ord.data.type) ? ord.data.type.generic :
		                (ord.data && ord.data.resourceType) ? ord.data.resourceType.generic : null;
		if (resType) gatherersPerRes[resType] = (gatherersPerRes[resType] || 0) + 1;
	}
	// "Recurso mais abundante" = maior ESTOQUE, não maior número de coletores.
	// A versão anterior usava a contagem de coletores, e isso erra justamente no caso que
	// importa: comida com 30 coletores e 20 no estoque não é abundante — é escassa e com
	// muita gente correndo atrás dela. Tirar um construtor dali é o pior lugar possível.
	// O estoque diz onde realmente sobra. A contagem de coletores entra só como desempate,
	// para não escolher um recurso onde não há ninguém de quem tirar.
	const stockNow = cmpPlayer ? cmpPlayer.GetResourceCounts() : {};
	let mostAbundantRes = null;
	let bestStock = -1;
	for (const res in gatherersPerRes) {
		const amt = stockNow[res] || 0;
		if (amt > bestStock ||
		    (amt === bestStock && mostAbundantRes && gatherersPerRes[res] > gatherersPerRes[mostAbundantRes])) {
			bestStock = amt;
			mostAbundantRes = res;
		}
	}

	// Só entra na lista quem realmente sabe erguer casa (o filtro de template antes era
	// aplicado lá embaixo, na montagem de builderIds).
	const houseTemplateOf = function(bId) {
		const cmpB = Engine.QueryInterface(bId, IID_Builder);
		if (!cmpB) return null;
		for (const tpl of cmpB.GetEntitiesList())
			if (tpl.indexOf("house") !== -1 && tpl.indexOf("storehouse") === -1 && tpl.indexOf("farmhouse") === -1)
				return tpl;
		return null;
	};

	// Semente: ocioso primeiro (não custa coleta nenhuma), depois quem está no recurso
	// mais abundante, depois qualquer um. É a mesma preferência de antes — o que muda é
	// que ela agora define a ÂNCORA da casa em vez de ser aplicada a uma posição já fixada.
	let seedBuilder = null, seedTemplate = null;
	const pickSeed = function(list) {
		for (const ent of list) {
			const tpl = houseTemplateOf(ent);
			if (!tpl) continue;
			const p = Engine.QueryInterface(ent, IID_Position);
			if (!p || !p.IsInWorld()) continue;
			seedBuilder = ent; seedTemplate = tpl;
			return true;
		}
		return false;
	};
	if (!pickSeed(idleBuilders) && mostAbundantRes) {
		const sameRes = builders.filter(ent => {
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			const ord = cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
			if (!ord) return false;
			const resType = (ord.data && ord.data.type) ? ord.data.type.generic :
			                (ord.data && ord.data.resourceType) ? ord.data.resourceType.generic : null;
			return resType === mostAbundantRes;
		});
		pickSeed(sameRes);
	}
	if (!seedBuilder) pickSeed(builders);
	if (!seedBuilder) return { _skip: "noBuilder2", stuckGhosts: stuckGhosts };

	const seedPos = Engine.QueryInterface(seedBuilder, IID_Position).GetPosition2D();

	// Ajudantes: primeiro os ociosos, depois quem está no RECURSO MAIS ABUNDANTE, e só
	// então o resto — dentro de cada grupo, o mais próximo da semente.
	//
	// A versão anterior ordenava só por distância, então a casa podia levar embora a aldeã
	// da comida por ela estar dois passos mais perto, enquanto sobrava gente na madeira ao
	// lado. Tirar do recurso mais abundante é o que menos custa: é justamente onde há gente
	// de sobra. A distância continua valendo como desempate, para não recriar o problema dos
	// ajudantes atravessando a base.
	const maxBuildersForHouse = Math.max(2, Math.min(4, productionBuildingCount));
	const idleSet = new Set(idleBuilders);
	const resOf = function(ent) {
		const cmpUAI = Engine.QueryInterface(ent, IID_UnitAI);
		const ord = cmpUAI && cmpUAI.orderQueue && cmpUAI.orderQueue.length > 0 ? cmpUAI.orderQueue[0] : null;
		if (!ord) return null;
		return (ord.data && ord.data.type) ? ord.data.type.generic :
		       (ord.data && ord.data.resourceType) ? ord.data.resourceType.generic : null;
	};
	const helperPool = [];
	for (const ent of builders) {
		if (ent === seedBuilder) continue;
		if (!houseTemplateOf(ent)) continue;
		const p = Engine.QueryInterface(ent, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pp = p.GetPosition2D();
		const dx = pp.x - seedPos.x, dz = pp.y - seedPos.y;
		// 0 = ocioso (não custa coleta nenhuma), 1 = recurso mais abundante, 2 = os demais
		const rank = idleSet.has(ent) ? 0 : (mostAbundantRes && resOf(ent) === mostAbundantRes ? 1 : 2);
		helperPool.push({ id: ent, rank: rank, dSq: dx*dx + dz*dz });
	}
	helperPool.sort((a, b) => a.rank !== b.rank ? a.rank - b.rank : a.dSq - b.dSq);
	// 60 units de raio: além disso a viagem do ajudante custa mais do que ele acrescenta.
	// Se ninguém estiver perto, a casa sai com um construtor só — mais lenta, mas sem
	// arrancar gente da coleta do outro lado da base.
	// O filtro de distância é `continue`, não `break`: com a lista ordenada por vocação
	// primeiro, um candidato longe no grupo 1 não pode encerrar a varredura e esconder os
	// que vêm depois.
	const builderIds = [seedBuilder];
	for (const h of helperPool) {
		if (builderIds.length >= maxBuildersForHouse) break;
		if (h.dSq > 60*60) continue;
		builderIds.push(h.id);
	}
	const houseTemplate = seedTemplate;

	// Ângulo preferencial: direção do CC ao construtor-semente. A casa deve nascer perto
	// de quem vai erguê-la, não no limite do território. Só é usado como desempate na
	// varredura de território abaixo — a âncora de verdade é a posição da semente.
	let preferredAngle = null;
	const builderCentroid = { x: seedPos.x, z: seedPos.y };
	{
		const dx = seedPos.x - ccPos.x, dz = seedPos.y - ccPos.y;
		if (dx*dx + dz*dz > 1)
			preferredAngle = Math.atan2(dz, dx);
	}

	let bestAngle = 0;
	let bestScore = -Infinity;
	for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 4) {
	    let r = 0;
	    for (let step = 10; step < mapSize; step += 10) {
	        let testX = ccPos.x + Math.cos(angle) * step;
	        let testZ = ccPos.y + Math.sin(angle) * step;
	        if (!cmpTerritoryManager || cmpTerritoryManager.GetOwner(testX, testZ) !== player) {
	            break;
	        }
	        r = step;
	    }
	    let angularPenalty = 0;
	    if (preferredAngle !== null) {
	        let diff = Math.abs(angle - preferredAngle);
	        if (diff > Math.PI) diff = 2 * Math.PI - diff;
	        angularPenalty = diff * 40; // 40 units/rad — 180° oposto perde ~126 units de território
	    }
	    const score = r - angularPenalty;
	    if (score > bestScore) { bestScore = score; bestAngle = angle; }
	}
	
	// Âncora = POSIÇÃO DO CONSTRUTOR-SEMENTE, não um ponto no anel ao redor do CC.
	// Mínimo de 80 units do CC: footprint do CC (25) + o da casa (11) + a folga entre eles.
	// Atenção aos campos: ccPos é GetPosition2D() cru, {x, y} com y = z; builderCentroid é
	// {x, z}; e baseVillagePoint usa {x, y} com y = z, como o resto desta função espera.
	let baseVillagePoint;
	{
		const bdx = builderCentroid.x - ccPos.x, bdz = builderCentroid.z - ccPos.y;
		const bd = Math.sqrt(bdx*bdx + bdz*bdz);
		if (bd >= 80)
			baseVillagePoint = { x: builderCentroid.x, y: builderCentroid.z };
		else
		{
			// Colado demais no CC: empurra para fora na MESMA direção em que ele está,
			// para continuar sendo o ponto mais próximo dele que respeita o afastamento.
			const ang = bd > 0.01 ? Math.atan2(bdz, bdx) : bestAngle;
			baseVillagePoint = { x: ccPos.x + Math.cos(ang) * 80, y: ccPos.y + Math.sin(ang) * 80 };
		}
	}

	let candidates = [];
	const pushCandidate = (cx, cz) => {
		if (cmpTerritoryManager && cmpTerritoryManager.GetOwner(cx, cz) !== player) return;
		if (cx < 10 || cz < 10 || cx > mapSize - 10 || cz > mapSize - 10) return;
		candidates.push({ x: cx, z: cz });
	};

	// ENCOSTAR NUMA CASA EXISTENTE vem primeiro; a posição do construtor é o fallback.
	//
	// A ordem estava invertida e o resultado foi base espalhada. Ancorar sempre no
	// construtor cumpre "casa perto de quem constrói" para CADA casa isoladamente — o log
	// de 15:52 mostra and= entre 0 e 59, todos curtos — mas o conjunto vira bagunça: as
	// 11 casas daquela partida ficaram espalhadas por 211x225 units, porque os construtores
	// estavam espalhados. Cada decisão ótima sozinha, o todo péssimo.
	//
	// Encostando na casa existente MAIS PRÓXIMA do construtor, as duas coisas convivem: o
	// vilarejo cresce agrupado e a caminhada continua curta, porque a referência é sempre a
	// casa mais perto de quem vai construir. A janela é de 100 units (era 60): abaixo disso
	// o aglomerado era descartado com frequência e caíamos no espalhamento de novo.
	const sortedHouses = housePosList.slice().sort((a, b) => {
		const da = (a.x - builderCentroid.x) ** 2 + (a.y - builderCentroid.z) ** 2;
		const db = (b.x - builderCentroid.x) ** 2 + (b.y - builderCentroid.z) ** 2;
		return da - db;
	});
	for (const house of sortedHouses) {
		const hdx = house.x - builderCentroid.x, hdz = house.y - builderCentroid.z;
		if (hdx*hdx + hdz*hdz > 100*100) break; // lista ordenada: daqui pra frente só piora
		// Offset 20 units para evitar sobreposição (casa gaul ~20 world units de footprint)
		for (let i = 0; i < 8; i++) {
			const angle = i * Math.PI / 4;
			pushCandidate(
				house.x + Math.cos(angle) * 20,
				house.y + Math.sin(angle) * 20
			);
		}
	}

	// Sem casa por perto (início de partida, ou construtor realmente longe do vilarejo):
	// aí sim ancora nele. É o que faz a primeira casa nascer num lugar sensato.
	pushCandidate(baseVillagePoint.x, baseVillagePoint.y);
	for (let r = 14; r <= 44; r += 10) {
		for (let i = 0; i < 8; i++) {
			const a = bestAngle + i * Math.PI / 4;
			pushCandidate(baseVillagePoint.x + Math.cos(a) * r, baseVillagePoint.y + Math.sin(a) * r);
		}
	}

	// Espiral afastada do CC como último recurso (só se nada perto do construtor coube)
	for (let r = 70; r <= 150; r += 16) {
		for (let i = 0; i < 8; i++) {
			const a = bestAngle + i * Math.PI / 4;
			pushCandidate(ccPos.x + Math.cos(a) * r, ccPos.y + Math.sin(a) * r);
		}
	}

	return {
		"builderId": builderIds[0],
		"builderIds": builderIds,
		"template": houseTemplate,
		"candidatePositions": candidates,
		"stuckGhosts": stuckGhosts,
		"workersToRedirect": [],
		"productionBuildingCount": productionBuildingCount,
		// Posição do construtor-semente: o painel loga a distância até o ponto escolhido,
		// para que "casa longe do trabalhador" seja um número verificável no log e não
		// só uma impressão de quem está jogando.
		"anchorX": seedPos.x,
		"anchorZ": seedPos.y,
		// De onde vieram os construtores, para conferir a regra no log em vez de no olho.
		"fromRes": mostAbundantRes || "-"
	};
};
GuiInterface.prototype.pudim_GetScoutStatus = function(player, data) {
    const result = { "mapSize": 512, "ccList": [], "scouts": [] };
    const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
    if (cmpTerrain) result.mapSize = cmpTerrain.GetMapSize();

    const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
    if (cmpRangeManager) {
        const myEnts = cmpRangeManager.GetEntitiesByPlayer(player);
        for (const ent of myEnts) {
            const cmpId = Engine.QueryInterface(ent, IID_Identity);
            if (cmpId && cmpId.HasClass("CivCentre")) {
                const cmpPos = Engine.QueryInterface(ent, IID_Position);
                if (cmpPos && cmpPos.IsInWorld()) {
                    const p = cmpPos.GetPosition2D();
                    result.ccList.push({ x: p.x, z: p.y }); // normalizado: z = p.y
                }
            }
        }
    }

    if (!data || !data.scouts) return result;

    // Inimigos do jogador para detecção proativa de ameaças
    const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
    const playerEnt = cmpPlayerManager ? cmpPlayerManager.GetPlayerByID(player) : null;
    const cmpDiplomacy = playerEnt ? Engine.QueryInterface(playerEnt, IID_Diplomacy) : null;
    const enemyPlayers = cmpDiplomacy ? cmpDiplomacy.GetEnemies() : [];

    const FLEE_RADIUS = 80; // m — detectar inimigos a até 80m do scout

    for (const entStr in data.scouts) {
        const ent = +entStr;
        const cmpPos = Engine.QueryInterface(ent, IID_Position);
        if (!cmpPos || !cmpPos.IsInWorld()) continue;

        const p2d = cmpPos.GetPosition2D();
        const pos = { x: p2d.x, z: p2d.y }; // normalizado

        const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
        const isIdle = cmpUnitAI ? cmpUnitAI.IsIdle() : true;
        let orderType = "";
        if (cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0)
            orderType = cmpUnitAI.orderQueue[0].type;

        // Detecção proativa de ameaças: inimigos a ≤ FLEE_RADIUS do scout
        let inDanger = false;
        let enemyPos = null;
        let enemyIsBuilding = false;
        if (cmpRangeManager && enemyPlayers.length > 0) {
            // ExecuteQueryAroundPos espera Vector2D {x, y} (globalscripts/vector.js).
            // Passava-se {x, z}: o campo y ficava undefined, a consulta não devolvia nada e o
            // scout NUNCA detectava perigo — por isso o modo agressivo entrava na base
            // inimiga e morria. p2d é o GetPosition2D() original, já no formato correto.
            const nearEnemies = cmpRangeManager.ExecuteQueryAroundPos(
                p2d, 0, FLEE_RADIUS, enemyPlayers, IID_Identity, false
            );
            let minDist = Infinity;
            for (const eEnt of nearEnemies) {
                const eId = Engine.QueryInterface(eEnt, IID_Identity);
                if (!eId) continue;
                const isBuilding = eId.HasClass("Structure");
                if (!isBuilding && !eId.HasClass("CitizenSoldier") && !eId.HasClass("FastMoving") &&
                    !eId.HasClass("Hero") && !eId.HasClass("Siege")) continue;
                const ePos = Engine.QueryInterface(eEnt, IID_Position);
                if (!ePos || !ePos.IsInWorld()) continue;
                const ep = ePos.GetPosition2D();
                const dx = ep.x - p2d.x, dz = ep.y - p2d.y;
                const d = dx*dx + dz*dz;
                if (d < minDist) {
                    minDist = d;
                    inDanger = true;
                    enemyPos = { x: ep.x, z: ep.y }; // normalizado
                    enemyIsBuilding = isBuilding;
                }
            }
        }

        result.scouts.push({
            "ent": ent,
            "idle": isIdle,
            "orderType": orderType,
            "pos": pos,
            "inDanger": inDanger,
            "enemyPos": enemyPos,
            "enemyIsBuilding": enemyIsBuilding,
            "enemyIsMobile": inDanger && !enemyIsBuilding
        });
    }

    return result;
};
GuiInterface.prototype.pudim_GetAutoKiteData = function(player, data)
{
	const result = [];
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return result;
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpDiplomacy = Engine.QueryInterface(playerEnt, IID_Diplomacy);
	if (!cmpDiplomacy) return result;
	const enemies = cmpDiplomacy.GetEnemies();
	if (!enemies || enemies.length === 0) return result;
	const kiting = (data && data.kiting) ? data.kiting : {};

	// Recolhe posições só de inimigos MELEE: recuar de ranged inimigo é inútil (ele
	// continua atirando enquanto a unidade foge e perde DPS à toa).
	const enemyPositions = [];
	for (const ep of enemies) {
		const ents = cmpRangeManager.GetEntitiesByPlayer(ep);
		for (const ent of ents) {
			const cmpId = Engine.QueryInterface(ent, IID_Identity);
			if (!cmpId || (!cmpId.HasClass("CitizenSoldier") && !cmpId.HasClass("FastMoving"))) continue;
			if (cmpId.HasClass("Ranged")) continue;
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) {
				const p = cmpPos.GetPosition2D();
				enemyPositions.push({ x: p.x, y: p.y, id: ent });
			}
		}
	}
	if (enemyPositions.length === 0) return result;

	const myEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	for (const ent of myEnts) {
		if (kiting[ent]) continue; // Em cooldown
		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpId || !cmpId.HasClass("Ranged")) continue;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const pos = cmpPos.GetPosition2D();

		// Distância de segurança PROATIVA: 60% do próprio alcance máximo (mín. 9m).
		// O gatilho fixo antigo de 9m só disparava com o melee já em contato — a unidade
		// "chegava perto e depois recuava". Agora recua antes de o inimigo alcançá-la,
		// e a distância escala com o alcance real da arma (arqueiro kita mais cedo que
		// fundeiro; ambos continuam dentro do próprio alcance pra seguir atirando).
		const cmpAttack = Engine.QueryInterface(ent, IID_Attack);
		const ownRange = cmpAttack ? cmpAttack.GetFullAttackRange().max : 15;
		const safeDist = Math.max(9, ownRange * 0.6);

		let nearestDx = 0, nearestDz = 0, nearestDistSq = safeDist * safeDist;
		let nearestEnemyEnt = null;
		for (const ep of enemyPositions) {
			const dx = pos.x - ep.x, dz = pos.y - ep.y;
			const dsq = dx*dx + dz*dz;
			if (dsq < nearestDistSq) { nearestDistSq = dsq; nearestDx = dx; nearestDz = dz; nearestEnemyEnt = ep.id; }
		}
		if (nearestDistSq >= safeDist * safeDist) continue;

		// Recua até reabrir o próprio alcance (- 2m de folga pra atacar já ao parar)
		const dist = Math.sqrt(nearestDistSq) || 1;
		const step = Math.max(8, (ownRange - 2) - dist);
		result.push({ "ent": ent, "x": pos.x + (nearestDx/dist)*step, "z": pos.y + (nearestDz/dist)*step, "enemyTarget": nearestEnemyEnt });
	}
	return result;
};
GuiInterface.prototype.pudim_GetRepeatBuildStates = function(player, data) { return null; };
GuiInterface.prototype.pudim_GetActiveRepeatBuilders = function(player, data) { return null; };
GuiInterface.prototype.pudim_GetBuilderCurrentFoundation = function(player, data) {
    if (!data || !data.ents) return {};
    let result = {};
    for (const ent of data.ents) {
        const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
        const _ord0rb = cmpUnitAI && cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
        if (!_ord0rb) continue;
        if (_ord0rb.type === "Repair") {
            const target = _ord0rb.data && _ord0rb.data.target;
            const cmpFoundation = Engine.QueryInterface(target, IID_Foundation);
            if (cmpFoundation) {
                const cmpTemplateManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TemplateManager);
                const template = cmpTemplateManager.GetCurrentTemplateName(target);
                const posCmp = Engine.QueryInterface(target, IID_Position);
                if (posCmp && posCmp.IsInWorld()) {
                    const pos = posCmp.GetPosition2D();
                    result[ent] = { "foundationId": target, "template": template, "x": pos.x, "z": pos.y };
                }
            }
        }
    }
    return result;
};
GuiInterface.prototype.pudim_GetPlayerEconomyStats = function(player, data) { return null; };
GuiInterface.prototype.pudim_PushNotification = function(player, data) { return null; };
GuiInterface.prototype.pudim_GetInitialBalanceData = function(player, data)
{
	const result = { "femaleCitizens": [], "soldiers": [], "cavalry": null, "berryBush": null, "tree": null, "chicken": null };

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return result;
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	if (!Engine.QueryInterface(playerEnt, IID_Player)) return result;

	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);

	// Localiza a CC inicial e obtém posição
	let ccPos = null;
	for (const ent of allEnts) {
		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		if (cmpId && cmpId.HasClass("CivCentre")) {
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) { ccPos = cmpPos.GetPosition2D(); break; }
		}
	}
	if (!ccPos) return result;

	// Classifica unidades iniciais próximas da CC (raio 300 units)
	// Todos os civs usam support_civilian (classes: Human Organic) como unidade inicial —
	// nunca FemaleCitizen. Detectamos trabalhadores civis por IID_ResourceGatherer + !CitizenSoldier + !FastMoving.
	for (const ent of allEnts) {
		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpId || cmpId.HasClass("Structure")) continue;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const pos = cmpPos.GetPosition2D();
		const dx = pos.x - ccPos.x, dz = pos.y - ccPos.y;
		if (dx*dx + dz*dz > 300*300) continue;
		if (cmpId.HasClass("FemaleCitizen"))
			result.femaleCitizens.push(ent);
		else if (cmpId.HasClass("FastMoving"))
			{ if (!result.cavalry) result.cavalry = ent; }
		else if (cmpId.HasClass("CitizenSoldier"))
			result.soldiers.push(ent);
		else {
			// Trabalhador civil sem FemaleCitizen (ex: Ambactos gauleses, support_civilian de todos os civs).
			// Requer Organic para excluir barcos de pesca e unidades mecânicas.
			if (!cmpId.HasClass("Organic") || cmpId.HasClass("FishingBoat") || cmpId.HasClass("Ship")) continue;
			const cmpGatherer = Engine.QueryInterface(ent, IID_ResourceGatherer);
			if (cmpGatherer)
				result.femaleCitizens.push(ent);
		}
	}

	// Busca recursos mais próximos da CC (raio 200m — era 140m mas unidades ainda garnisonadas
	// no CC aparecem no mundo só depois de ~2-3s, e recursos podem estar até 180m do CC)
	const nearby = cmpRangeManager.ExecuteQueryAroundPos(ccPos, 0, 200, [0, player], IID_ResourceSupply, false);
	let bestFruitDist = Infinity, bestWoodDist = Infinity, bestMeatDist = Infinity;
	for (const ent of nearby) {
		const cmpRes = Engine.QueryInterface(ent, IID_ResourceSupply);
		if (!cmpRes || !cmpRes.IsAvailable()) continue;
		const resType = cmpRes.GetType();
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const pos = cmpPos.GetPosition2D();
		const dx = pos.x - ccPos.x, dz = pos.y - ccPos.y;
		const distSq = dx*dx + dz*dz;
		if (resType.generic === "food" && resType.specific === "fruit" && distSq < bestFruitDist)
			{ bestFruitDist = distSq; result.berryBush = ent; }
		else if (resType.generic === "wood" && distSq < bestWoodDist)
			{ bestWoodDist = distSq; result.tree = ent; }
		else if (resType.generic === "food" && resType.specific === "meat" && distSq < bestMeatDist) {
			const cmpId = Engine.QueryInterface(ent, IID_Identity);
			if (cmpId && cmpId.HasClass("Predator")) continue;
			bestMeatDist = distSq; result.chicken = ent;
		}
	}
	return result;
};
GuiInterface.prototype.pudim_GetMarketBarterData = function(player, data) { return null; };
GuiInterface.prototype.pudim_GetDefensiveGarrisonData = function(player, data) { return null; };
// Focus fire: direciona todos os soldados em combate para o alvo mais fraco.
// Prioridade: unidades de ataque à distância (Ranged) com HP mais baixo.
// Retorna: [{ units: [entityIds], target: entityId }] ou []
GuiInterface.prototype.pudim_GetFocusFireCorrections = function(player, data)
{
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpDiplomacy = Engine.QueryInterface(playerEnt, IID_Diplomacy);
	if (!cmpRangeManager || !cmpDiplomacy) return [];

	const enemies = cmpDiplomacy.GetEnemies();
	const myUnits = cmpRangeManager.GetEntitiesByPlayer(player);

	// Coletar meus soldados em combate (order type "Attack" com target vivo), com posição
	const attackingSoldiers = [];
	for (const ent of myUnits) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id || (!id.HasClass("CitizenSoldier") && !id.HasClass("FastMoving"))) continue;
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
		const ord = cmpUnitAI.orderQueue[0];
		if (ord.type !== "Attack" && ord.type !== "WalkAndFight") continue;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const p = cmpPos.GetPosition2D();
		attackingSoldiers.push({
			id: ent, x: p.x, z: p.y,
			currentTarget: ord.data && ord.data.target,
			isRanged: id.HasClass("Ranged")
		});
	}
	if (attackingSoldiers.length === 0) return [];

	// ── Alocação por GRUPO INIMIGO (não por posição dos meus soldados) ──────────────
	// Falha vista em replay: quase todo o exército foi no grupo inimigo PEQUENO enquanto
	// tomava flechas do grupo GRANDE ao lado, e só depois virou pro grande. O certo é
	// dividir: força suficiente (com margem) pra limpar o grupo pequeno rápido, e o
	// grosso do exército no grupo grande desde o início.

	// 1. Coletar inimigos vivos perto do COMBATE.
	// Antes isto varria (soldados × jogadores inimigos) — com 100 soldados e 7 inimigos eram
	// ~700 consultas de raio 120m a cada 2s, e foi uma das causas da queda de desempenho.
	// Agora: uma varredura por jogador inimigo, centrada no centroide das minhas tropas em
	// combate, com raio que cobre a dispersão delas + 120m de folga.
	const cX = attackingSoldiers.reduce((a, u) => a + u.x, 0) / attackingSoldiers.length;
	const cZ = attackingSoldiers.reduce((a, u) => a + u.z, 0) / attackingSoldiers.length;
	let spread = 0;
	for (const s of attackingSoldiers) {
		const dx = s.x - cX, dz = s.z - cZ;
		const d = dx*dx + dz*dz;
		if (d > spread) spread = d;
	}
	const scanRadius = Math.min(400, Math.sqrt(spread) + 120);

	const enemyUnits = [];
	const seenEnemy = new Set();
	{
		for (const ep of enemies) {
			const near = cmpRangeManager.ExecuteQueryAroundPos({ x: cX, y: cZ }, 0, scanRadius, [ep], IID_Health, false);
			for (const e of near) {
				if (seenEnemy.has(e)) continue;
				const cmpHealth = Engine.QueryInterface(e, IID_Health);
				if (!cmpHealth || cmpHealth.GetHitpoints() <= 0) continue;
				const eId = Engine.QueryInterface(e, IID_Identity);
				if (!eId || eId.HasClass("Structure")) continue;
				const ePos = Engine.QueryInterface(e, IID_Position);
				if (!ePos || !ePos.IsInWorld()) continue;
				const epos2 = ePos.GetPosition2D();
				seenEnemy.add(e);
				enemyUnits.push({
					id: e, x: epos2.x, z: epos2.y,
					hpRatio: cmpHealth.GetHitpoints() / cmpHealth.GetMaxHitpoints(),
					isRanged: eId.HasClass("Ranged")
				});
			}
		}
	}
	if (enemyUnits.length === 0) return [];

	// 2. Agrupar INIMIGOS em clusters de 50m (encadeamento simples)
	const enemyClusters = [];
	const eAssigned = new Set();
	for (const e of enemyUnits) {
		if (eAssigned.has(e.id)) continue;
		const cluster = [e];
		eAssigned.add(e.id);
		for (const o of enemyUnits) {
			if (eAssigned.has(o.id)) continue;
			for (const m of cluster) {
				const dx = o.x - m.x, dz = o.z - m.z;
				if (dx*dx + dz*dz <= 50*50) { cluster.push(o); eAssigned.add(o.id); break; }
			}
		}
		const cx = cluster.reduce((sum, u) => sum + u.x, 0) / cluster.length;
		const cz = cluster.reduce((sum, u) => sum + u.z, 0) / cluster.length;
		// Alvo do cluster: ranged mais fraco primeiro (derruba DPS inimigo mais rápido)
		cluster.sort((a, b) => {
			if (a.isRanged !== b.isRanged) return a.isRanged ? -1 : 1;
			return a.hpRatio - b.hpRatio;
		});
		enemyClusters.push({ units: cluster, x: cx, z: cz, target: cluster[0].id });
	}

	// 3. Alocar meus soldados: menores grupos inimigos primeiro, com força 1.3x o tamanho
	//    deles (mata rápido com margem, mínimo de perdas); TODO o restante vai pro maior.
	//    Candidatos por proximidade — quem já está perto não cruza a frente tomando dano —
	//    com leve preferência por melee (aguentam mais; ranged ficam pro grupo grande,
	//    atirando de trás, junto com o kiting que já os mantém a distância).
	enemyClusters.sort((a, b) => a.units.length - b.units.length);
	const largest = enemyClusters[enemyClusters.length - 1];
	const freeSoldiers = attackingSoldiers.slice();
	const corrections = [];
	for (const ec of enemyClusters) {
		if (freeSoldiers.length === 0) break;
		let group;
		if (ec === largest) {
			group = freeSoldiers.splice(0, freeSoldiers.length); // todo o restante
		} else {
			const need = Math.min(freeSoldiers.length, Math.ceil(ec.units.length * 1.3));
			freeSoldiers.sort((a, b) => {
				const da = (a.x - ec.x) ** 2 + (a.z - ec.z) ** 2;
				const db = (b.x - ec.x) ** 2 + (b.z - ec.z) ** 2;
				// bônus de 20m efetivos pra melee: tanque na linha de frente do grupo pequeno
				return (Math.sqrt(da) - (a.isRanged ? 0 : 20)) - (Math.sqrt(db) - (b.isRanged ? 0 : 20));
			});
			group = freeSoldiers.splice(0, need);
		}
		// NÃO reemitir ordem pra quem já está batendo num inimigo VÁLIDO deste mesmo grupo.
		// Cada comando "attack" reinicia o ciclo de ataque (aproximação + windup) da unidade:
		// re-mirando a cada 2s, o exército passava a partida andando e quase não dava dano —
		// era isso que fazia o mod "atrapalhar mais que ajudar" nas batalhas.
		// Só recebe ordem nova quem: (a) não tem alvo, (b) tem alvo morto/inválido, ou
		// (c) está batendo em alguém de OUTRA frente (alvo fora deste grupo).
		const clusterIds = new Set(ec.units.map(u => u.id));
		const toRedirect = group.filter(u => {
			if (!u.currentTarget) return true;
			if (u.currentTarget === ec.target) return false;
			const h = Engine.QueryInterface(u.currentTarget, IID_Health);
			if (!h || h.GetHitpoints() <= 0) return true;   // alvo morto
			return !clusterIds.has(u.currentTarget);        // alvo de outra frente
		}).map(u => u.id);
		if (toRedirect.length > 0)
			corrections.push({ units: toRedirect, target: ec.target });
	}
	return corrections;
};
GuiInterface.prototype.pudim_GetProductionBuildings = function(player, data) {
	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return { "buildings": [], "femaleCount": 0, "resources": {} };
	const ents = cmpRangeManager.GetEntitiesByPlayer(player);

	// Recursos disponíveis do jogador
	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager ? cmpPlayerManager.GetPlayerByID(player) : null;
	const cmpPlayer = playerEnt ? Engine.QueryInterface(playerEnt, IID_Player) : null;
	const resources = cmpPlayer ? cmpPlayer.GetResourceCounts() : {};

	// Contar trabalhadoras vivas (classe Female) para o limite de 50
	let femaleCount = 0;
	for (const ent of ents) {
		const id = Engine.QueryInterface(ent, IID_Identity);
		if (!id || !id.HasClass("Female")) continue;
		const hp = Engine.QueryInterface(ent, IID_Health);
		if (hp && hp.GetHitpoints() <= 0) continue;
		femaleCount++;
	}

	const buildings = [];
	for (const ent of ents) {
		const cmpProdQueue = Engine.QueryInterface(ent, IID_ProductionQueue);
		if (!cmpProdQueue) continue;
		const queue = cmpProdQueue.GetQueue();
		const id = Engine.QueryInterface(ent, IID_Identity);
		const isCC      = !!(id && id.HasClass("CivCentre"));
		const isBarracks = !!(id && id.HasClass("Barracks"));
		const alwaysQueue = isCC || isBarracks;

		buildings.push({
			"ent": ent,
			"autoqueue": cmpProdQueue.IsAutoQueueing(),
			"trainingQueue": queue,
			"queueEmpty": queue.length === 0,
			"alwaysQueue": alwaysQueue,
			"isCC": isCC,
			"isBarracks": isBarracks,
			// Lista de unidades treináveis: o painel precisa dela pra saber QUAL unidade
			// enfileirar quando a fila está vazia. Vive em IID_Trainer — ProductionQueue NÃO
			// tem GetEntitiesList (confirmado no motor 0.28), então o guard `? :` daqui caía
			// sempre no ramo vazio: o template nunca era resolvido e a auto-fila jamais
			// semeava a fila no início da partida (CC ficava parado sem treinar).
			// Mesma fonte que o GuiInterface do motor usa em state.trainer.entities.
			"trainerEntities": (function() {
				const cmpTrainer = Engine.QueryInterface(ent, IID_Trainer);
				return cmpTrainer ? cmpTrainer.GetEntitiesList() : [];
			})()
		});
	}
	return { "buildings": buildings, "femaleCount": femaleCount, "resources": resources };
};
GuiInterface.prototype.pudim_GetPlayerKD = function(player, data) { return null; };


// ─── Registrar funcoes expostas ao ScriptCall ────────────────────────────────────


// --- EXTRA DUMMIES ---
GuiInterface.prototype.pudim_GetThreats = function(player, data) { return null; };

// ── Armazém proativo: constrói armazém perto de floresta distante ANTES dos workers chegarem ──
// Chamado pelo panel quando pudim_GetIdleWorkersAndBestResource retorna suggestStorehouse.
// Verifica se há armazém/fundação perto, encontra builder civil, retorna candidatos de posição.
GuiInterface.prototype.pudim_GetProactiveStorehouseData = function(player, data)
{
	// Armazém serve madeira, pedra e metal — nunca aceita construtor vindo da comida.
	const pudimDropsiteIsFood = false;
	if (!data || data.nearX === undefined || data.nearZ === undefined) return null;

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer || cmpPlayer.GetResourceCounts().wood < 50) return null;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	const mapSize = cmpTerrain ? cmpTerrain.GetMapSize() : 512;
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	const nearX = data.nearX, nearZ = data.nearZ;
	// Workers recém-despachados (ex: balanceamento inicial) — nunca sequestrar como builder
	const protectedIds = new Set((data.protectedIds || []).map(Number));

	// nearX/nearZ é só a árvore que UM worker foi coletar — pode estar na borda entre duas
	// matas. Escaneia um raio maior ao redor dela pra achar o ponto mais denso de verdade
	// (a floresta grande de fato), e ancora o armazém lá em vez da árvore aleatória.
	let anchorX = nearX, anchorZ = nearZ, anchorDensity = 0;
	const nearbyTrees = cmpRangeManager.ExecuteQueryAroundPos({ x: nearX, y: nearZ }, 0, 150, [0], IID_ResourceSupply, false);
	const treePositions = [];
	for (const res of nearbyTrees) {
		const rs = Engine.QueryInterface(res, IID_ResourceSupply);
		if (!rs || !rs.IsAvailable()) continue;
		const rt = rs.GetType();
		if (!rt || rt.generic !== "wood") continue;
		const p = Engine.QueryInterface(res, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pos = p.GetPosition2D();
		if (cmpTerritoryManager) {
			const owner = cmpTerritoryManager.GetOwner(pos.x, pos.y);
			if (owner !== player && owner !== 0) continue;
		}
		treePositions.push({ x: pos.x, z: pos.y });
	}
	for (const t of treePositions) {
		let cnt = 0;
		for (const o of treePositions) {
			const dx = t.x - o.x, dz = t.z - o.z;
			if (dx*dx + dz*dz <= 50*50) cnt++;
		}
		if (cnt > anchorDensity) { anchorDensity = cnt; anchorX = t.x; anchorZ = t.z; }
	}

	// A mata precisa ser GRANDE o bastante para justificar um armazém.
	// Sem este corte, qualquer moita virava obra: em jogo o mod ergueu um armazém numa
	// mini-floresta ao lado do Centro Cívico que já estava sendo coletada e que o próprio CC
	// já cobria. O prédio custa 100 de madeira e tira 3 trabalhadores da coleta, e a mata
	// acaba em poucos minutos — aí é preciso outro armazém em outro lugar. Melhor deixar
	// esses coletores irem para uma floresta de verdade.
	// Conta apenas o núcleo (50m do ponto âncora), que é o que o armazém vai de fato servir.
	{
		let coreNodes = 0, coreWood = 0;
		for (const res of nearbyTrees) {
			const rs = Engine.QueryInterface(res, IID_ResourceSupply);
			if (!rs || !rs.IsAvailable()) continue;
			const rt = rs.GetType();
			if (!rt || rt.generic !== "wood") continue;
			const p = Engine.QueryInterface(res, IID_Position);
			if (!p || !p.IsInWorld()) continue;
			const pp = p.GetPosition2D();
			const dx = pp.x - anchorX, dz = pp.y - anchorZ;
			if (dx*dx + dz*dz > 50*50) continue;
			coreNodes++;
			coreWood += rs.GetCurrentAmount();
		}
		// 8 árvores e 4000 de madeira: abaixo disso a mata se esgota antes de o armazém
		// pagar o próprio custo.
		if (coreNodes < 8 || coreWood < 4000) return null;
	}

	// Abortar se já há armazém ou fundação de armazém a ≤ 70m da floresta real (âncora corrigida)
	for (const ent of allEnts) {
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci || !ci.HasClass("Storehouse")) continue;
		const p = Engine.QueryInterface(ent, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pos = p.GetPosition2D();
		const dx = pos.x - anchorX, dz = pos.y - anchorZ;
		if (dx*dx + dz*dz < 70*70) return null;
	}

	// Encontrar builder civil (não-soldado, não-cavalaria) — primeiro ocioso, depois coletando
	let builderEnt = null;
	for (const ent of allEnts) {
		if (protectedIds.has(ent)) continue;
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci || ci.HasClass("FastMoving") || ci.HasClass("CitizenSoldier")) continue;
		if (!Engine.QueryInterface(ent, IID_Builder)) continue;
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI) continue;
		if (cmpUnitAI.IsIdle()) { builderEnt = ent; break; }
	}
	if (!builderEnt) {
		// Ordem de preferência entre quem JÁ está coletando. Antes pegava o primeiro que
		// aparecesse na lista — no início de partida isso era tipicamente uma aldeã da
		// fruta, e a base perdia comida para erguer um dropsite (relatado em jogo: 2
		// trabalhadores saíram da comida para o armazém e a comida nunca se recuperou).
		// A comida é a coleta mais frágil no início (poucos arbustos, capacidade pequena),
		// então ela é sempre a última a ser sacrificada; madeira é a mais abundante.
		let best = null, bestRank = 99;
		for (const ent of allEnts) {
			if (protectedIds.has(ent)) continue;
			const ci = Engine.QueryInterface(ent, IID_Identity);
			if (!ci || ci.HasClass("FastMoving") || ci.HasClass("CitizenSoldier")) continue;
			if (!Engine.QueryInterface(ent, IID_Builder)) continue;
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (!cmpUnitAI) continue;
			const ord = cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
			if (ord && ord.type !== "Gather") continue;

			let rank = 1; // sem ordem: praticamente ocioso
			if (ord) {
				let generic = null;
				const tg = ord.data && ord.data.target;
				if (tg) {
					const rsB = Engine.QueryInterface(tg, IID_ResourceSupply);
					const tp = rsB && rsB.GetType();
					if (tp) generic = tp.generic;
				} else if (ord.data) {
					const rt = ord.data.type || ord.data.resourceType;
					if (rt) generic = rt.generic;
				}
				// REGRA DURA: o construtor tem de estar no MESMO lado que o dropsite serve.
				// Celeiro (comida) só aceita quem já está na comida; armazém (madeira,
				// pedra, metal) só aceita quem está nesses três. Não é preferência, é
				// proibição: um ranking que apenas deixasse o lado errado em último lugar
				// ainda o escolheria quando fosse a única opção — que é justamente o caso
				// no início de partida. Tirar gente do outro lado desfalca a coleta mais
				// frágil e, de quebra, a viagem se perde: o trabalhador termina longe do
				// recurso a que voltaria. Sem candidato válido é melhor adiar a construção;
				// ela sai alguns segundos depois, sem custo permanente.
				if ((generic === "food") !== pudimDropsiteIsFood) continue;
				rank = generic === "wood" ? 0 : 2;
			}
			if (rank < bestRank) {
				bestRank = rank; best = ent;
				if (rank === 0) break; // já está na madeira: não dá para melhorar
			}
		}
		builderEnt = best;
	}
	if (!builderEnt) return null;

	// Determinar template do armazém a partir do builder
	let template = "";
	const cmpBuilder = Engine.QueryInterface(builderEnt, IID_Builder);
	const buildables = cmpBuilder.GetEntitiesList();
	for (const tpl of buildables) { if (tpl.indexOf("storehouse") !== -1) { template = tpl; break; } }
	if (!template) for (const tpl of buildables) { if (tpl.indexOf("dropsite") !== -1) { template = tpl; break; } }
	if (!template) {
		const ci = Engine.QueryInterface(builderEnt, IID_Identity);
		if (ci) template = "structures/" + ci.GetCiv() + "/storehouse";
	}
	if (!template) return null;

	// Espiral centrada na floresta real (âncora); hintAngle aponta da âncora para o CC
	// (primeiros candidatos ficam entre a floresta e o CC, reduzindo caminhada)
	let hintAngle = 0;
	let minCCdSq = Infinity;
	for (const ent of allEnts) {
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci || !ci.HasClass("CivCentre")) continue;
		const p = Engine.QueryInterface(ent, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pos = p.GetPosition2D();
		const dx = pos.x - anchorX, dz = pos.y - anchorZ;
		const dSq = dx*dx + dz*dz;
		if (dSq < minCCdSq) {
			minCCdSq = dSq;
			hintAngle = Math.atan2(pos.x - anchorX, pos.y - anchorZ); // âncora → CC
		}
	}

	// Candidatos em espiral ~2m por anel ao redor da floresta real, 12 direções por anel
	const candidates = [];
	for (let r = 4; r <= 65; r += 2) {
		for (let i = 0; i < 12; i++) {
			const angle = hintAngle + (i * Math.PI / 6);
			candidates.push({
				x: Math.max(12, Math.min(mapSize - 12, anchorX + Math.cos(angle) * r)),
				z: Math.max(12, Math.min(mapSize - 12, anchorZ + Math.sin(angle) * r))
			});
		}
	}

	return { "builderId": builderEnt, "template": template, "candidatePositions": candidates, "resource": "wood", "workersToMove": [] };
};

// ── Farmstead proativo: constrói farmstead perto de fruta ANTES dos workers chegarem ──
// Chamado pelo panel quando pudim_GetIdleWorkersAndBestResource retorna suggestFarmstead.
GuiInterface.prototype.pudim_GetProactiveFarmsteadData = function(player, data)
{
	// Celeiro serve comida — só aceita construtor que já está na comida.
	const pudimDropsiteIsFood = true;
	if (!data || data.nearX === undefined || data.nearZ === undefined) return null;

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer || cmpPlayer.GetResourceCounts().wood < 60) return null;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const mapSize = cmpTerrain ? cmpTerrain.GetMapSize() : 512;
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);
	const nearX = data.nearX, nearZ = data.nearZ;
	const protectedIds = new Set((data.protectedIds || []).map(Number));

	// Abortar se já há farmstead (ou dropsite de comida) a ≤ 50m desta fruta
	for (const ent of allEnts) {
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci) continue;
		if (!ci.HasClass("Farmstead") && !ci.HasClass("DropsiteFood") && !ci.HasClass("CivCentre")) continue;
		const p = Engine.QueryInterface(ent, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pos = p.GetPosition2D();
		const dx = pos.x - nearX, dz = pos.y - nearZ;
		if (dx*dx + dz*dz < 50*50) return null;
	}

	// Encontrar builder civil (não-soldado, não-cavalaria)
	let builderEnt = null;
	for (const ent of allEnts) {
		if (protectedIds.has(ent)) continue;
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci || ci.HasClass("FastMoving") || ci.HasClass("CitizenSoldier")) continue;
		if (!Engine.QueryInterface(ent, IID_Builder)) continue;
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI) continue;
		if (cmpUnitAI.IsIdle()) { builderEnt = ent; break; }
	}
	if (!builderEnt) {
		// Ordem de preferência entre quem JÁ está coletando. Antes pegava o primeiro que
		// aparecesse na lista — no início de partida isso era tipicamente uma aldeã da
		// fruta, e a base perdia comida para erguer um dropsite (relatado em jogo: 2
		// trabalhadores saíram da comida para o armazém e a comida nunca se recuperou).
		// A comida é a coleta mais frágil no início (poucos arbustos, capacidade pequena),
		// então ela é sempre a última a ser sacrificada; madeira é a mais abundante.
		let best = null, bestRank = 99;
		for (const ent of allEnts) {
			if (protectedIds.has(ent)) continue;
			const ci = Engine.QueryInterface(ent, IID_Identity);
			if (!ci || ci.HasClass("FastMoving") || ci.HasClass("CitizenSoldier")) continue;
			if (!Engine.QueryInterface(ent, IID_Builder)) continue;
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (!cmpUnitAI) continue;
			const ord = cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
			if (ord && ord.type !== "Gather") continue;

			let rank = 1; // sem ordem: praticamente ocioso
			if (ord) {
				let generic = null;
				const tg = ord.data && ord.data.target;
				if (tg) {
					const rsB = Engine.QueryInterface(tg, IID_ResourceSupply);
					const tp = rsB && rsB.GetType();
					if (tp) generic = tp.generic;
				} else if (ord.data) {
					const rt = ord.data.type || ord.data.resourceType;
					if (rt) generic = rt.generic;
				}
				// REGRA DURA: o construtor tem de estar no MESMO lado que o dropsite serve.
				// Celeiro (comida) só aceita quem já está na comida; armazém (madeira,
				// pedra, metal) só aceita quem está nesses três. Não é preferência, é
				// proibição: um ranking que apenas deixasse o lado errado em último lugar
				// ainda o escolheria quando fosse a única opção — que é justamente o caso
				// no início de partida. Tirar gente do outro lado desfalca a coleta mais
				// frágil e, de quebra, a viagem se perde: o trabalhador termina longe do
				// recurso a que voltaria. Sem candidato válido é melhor adiar a construção;
				// ela sai alguns segundos depois, sem custo permanente.
				if ((generic === "food") !== pudimDropsiteIsFood) continue;
				rank = generic === "wood" ? 0 : 2;
			}
			if (rank < bestRank) {
				bestRank = rank; best = ent;
				if (rank === 0) break; // já está na madeira: não dá para melhorar
			}
		}
		builderEnt = best;
	}
	if (!builderEnt) return null;

	// Template de farmstead
	let template = "";
	const cmpBuilder = Engine.QueryInterface(builderEnt, IID_Builder);
	const buildables = cmpBuilder.GetEntitiesList();
	for (const tpl of buildables) { if (tpl.indexOf("farmstead") !== -1) { template = tpl; break; } }
	if (!template) {
		const ci = Engine.QueryInterface(builderEnt, IID_Identity);
		if (ci) template = "structures/" + ci.GetCiv() + "/farmstead";
	}
	if (!template) return null;

	// Espiral centrada no recurso; hintAngle aponta do recurso para o CC
	let hintAngle = 0;
	let minCCdSqFm = Infinity;
	for (const ent of allEnts) {
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci || !ci.HasClass("CivCentre")) continue;
		const p = Engine.QueryInterface(ent, IID_Position);
		if (!p || !p.IsInWorld()) continue;
		const pos = p.GetPosition2D();
		const dx = pos.x - nearX, dz = pos.y - nearZ;
		const dSq = dx*dx + dz*dz;
		if (dSq < minCCdSqFm) {
			minCCdSqFm = dSq;
			hintAngle = Math.atan2(pos.x - nearX, pos.y - nearZ); // recurso → CC
		}
	}

	// Candidatos em espiral ~2m por anel ao redor do recurso, 12 direções por anel
	const candidates = [];
	for (let r = 4; r <= 65; r += 2) {
		for (let i = 0; i < 12; i++) {
			const angle = hintAngle + (i * Math.PI / 6);
			const cx = Math.max(12, Math.min(mapSize - 12, nearX + Math.cos(angle) * r));
			const cz = Math.max(12, Math.min(mapSize - 12, nearZ + Math.sin(angle) * r));
			candidates.push({ x: cx, z: cz });
		}
	}

	return { "builderId": builderEnt, "template": template, "candidatePositions": candidates, "resource": "food", "workersToMove": [] };
};

GuiInterface.prototype.pudim_GetSmartDropsiteData = function(player, data)
{
	const result = { "action": "none", "builderId": null, "template": null,
	                 "candidatePositions": [], "resource": null, "workersToMove": [],
	                 "redirectX": 0, "redirectZ": 0,
	                 "_dbg": { tg: 0, fw: 0, wood: 0, ds: 0, grp: null, sc: 0, bsc: 0, bsd: -1, skip: "init" } };
	// Workers recém-despachados (ex: balanceamento inicial) — nunca sequestrar como builder
	const protectedIds = new Set(((data && data.protectedIds) || []).map(Number));

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer || cmpPlayer.GetResourceCounts().wood < 100) {
		result._dbg.skip = "wood<100";
		return result;
	}
	result._dbg.wood = Math.round(cmpPlayer.GetResourceCounts().wood);

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	const cmpTerritoryManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_TerritoryManager);
	const cmpTerrain = Engine.QueryInterface(SYSTEM_ENTITY, IID_Terrain);
	const mapSize = cmpTerrain ? cmpTerrain.GetMapSize() : 512;
	
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);

	const dropsites = [];
	const ccPositions = [];
	for (const ent of allEnts) {
		const cmpIdent = Engine.QueryInterface(ent, IID_Identity);
		const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
		const cmpDropsite = Engine.QueryInterface(ent, IID_ResourceDropsite);
		const isCC = !!(cmpIdent && cmpIdent.HasClass("CivCentre"));
		const isStorehouse = !!(cmpIdent && (cmpIdent.HasClass("Storehouse") || cmpIdent.HasClass("DropsiteWood")));
		const isFarmstead = !!(cmpIdent && (cmpIdent.HasClass("Farmstead") || cmpIdent.HasClass("DropsiteFood")));
		if (cmpDropsite || (cmpFoundation && cmpIdent && (cmpIdent.HasClass("Storehouse") || cmpIdent.HasClass("Farmstead") || cmpIdent.HasClass("DropsiteFood")))) {
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) {
				const p = cmpPos.GetPosition2D();
				dropsites.push({ x: p.x, y: p.y, isCC, isStorehouse, isFarmstead });
			}
		}
		if (isCC) {
			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (cmpPos && cmpPos.IsInWorld()) ccPositions.push(cmpPos.GetPosition2D());
		}
	}

	result._dbg.ds = dropsites.length;

	// ── Coletar workers longe de dropsites (recurso alvo > 15m de qualquer dropsite) ─────
	const farWoodPos = [];     // posições {x, z} dos recursos de madeira longe
	const farFoodPos = [];     // posições {x, z} dos recursos de frutas longe
	const farWoodWorkers = []; // IDs dos workers de madeira longe
	const farFoodWorkers = []; // IDs dos workers de frutas longe
	let builderEnt = null;

	for (const ent of allEnts) {
		if (protectedIds.has(ent)) continue; // recém-despachado — não vira builder nem far-worker
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
		const ord = cmpUnitAI.orderQueue[0];
		if (ord.type !== "Gather") continue;
		const tid = ord.data && ord.data.target;
		if (!tid) continue;
		const rs = Engine.QueryInterface(tid, IID_ResourceSupply);
		if (!rs || !rs.IsAvailable()) continue;
		const rtype = rs.GetType();
		if (!rtype) continue;
		const tp = Engine.QueryInterface(tid, IID_Position);
		if (!tp || !tp.IsInWorld()) continue;
		const rp = tp.GetPosition2D();

		let minDsSq = Infinity;
		for (const ds of dropsites) {
			const ddx = ds.x - rp.x, ddz = ds.y - rp.y;
			minDsSq = Math.min(minDsSq, ddx*ddx + ddz*ddz);
		}
		if (minDsSq <= 50*50) continue; // Já tem dropsite a ≤ 50m — workers próximos não oscilam

		const cmpEntId = Engine.QueryInterface(ent, IID_Identity);
		const isCavalry = !!(cmpEntId && cmpEntId.HasClass("FastMoving"));
		const isCitizenSoldier = !!(cmpEntId && cmpEntId.HasClass("CitizenSoldier"));
		if (!builderEnt && !isCavalry && !isCitizenSoldier) {
			const cmpB = Engine.QueryInterface(ent, IID_Builder);
			if (cmpB) builderEnt = ent;
		}
		// Skip worker fora do território do jogador (pode estar em batalha)
		if (cmpTerritoryManager) {
			const entPos = Engine.QueryInterface(ent, IID_Position);
			if (entPos && entPos.IsInWorld()) {
				const ep = entPos.GetPosition2D();
				if (cmpTerritoryManager.GetOwner(ep.x, ep.y) !== player) continue;
			}
		}
		if (rtype.generic === "wood") {
			if (isCavalry || isCitizenSoldier) continue; // nunca redirecionar soldados para farmstead
			farWoodPos.push({ x: rp.x, z: rp.y });
			farWoodWorkers.push(ent);
		} else if (rtype.generic === "food" && rtype.specific === "fruit") {
			if (isCavalry || isCitizenSoldier) continue; // soldados nunca vão para fazenda
			farFoodPos.push({ x: rp.x, z: rp.y });
			farFoodWorkers.push(ent);
		}
	}

	result._dbg.fw = farWoodPos.length + farFoodPos.length;
	if (farWoodPos.length === 0 && farFoodPos.length === 0) {
		result._dbg.skip = "no_far_workers_50m"; // rótulo alinhado ao limiar real (minDsSq <= 50*50) acima
		return result;
	}

	// ── Contar dropsites existentes para limitar spam ─────────────────────────────────────
	let storehouseCount = 0, farmsteadCount = 0;
	for (const ent of allEnts) {
		const ci = Engine.QueryInterface(ent, IID_Identity);
		if (!ci) continue;
		if (ci.HasClass("Storehouse")) storehouseCount++;
		else if (ci.HasClass("Farmstead")) farmsteadCount++;
	}
	result._dbg.sc = storehouseCount;

	// ── Selecionar recurso: maior necessidade, respeitar limite máximo ────────────────────
	const woodUrgent = farWoodPos.length > 0 && storehouseCount < 8;
	// Farmstead: constrói se 1+ worker coleta fruta longe de qualquer dropsite.
	// Máx 10 farmsteads (dropsites de comida); o limiar de 35m evita duplicatas.
	const foodUrgent = farmsteadCount < 10 && farFoodPos.length >= 1;

	let bestGroupKey = "";
	let activePos = null;
	if (woodUrgent && foodUrgent) {
		// Farmstead tem prioridade absoluta se não há nenhum ainda
		if (farmsteadCount === 0) { bestGroupKey = "food"; activePos = farFoodPos; }
		else if (farWoodPos.length >= farFoodPos.length) { bestGroupKey = "wood"; activePos = farWoodPos; }
		else { bestGroupKey = "food"; activePos = farFoodPos; }
	} else if (woodUrgent) {
		bestGroupKey = "wood"; activePos = farWoodPos;
	} else if (foodUrgent) {
		bestGroupKey = "food"; activePos = farFoodPos;
	} else {
		result._dbg.skip = "max_limit sh=" + storehouseCount + " fm=" + farmsteadCount;
		return result;
	}

	// ── Antes de construir: verificar se há recurso acessível perto de dropsite existente ─
	// Se há árvore/fruta a ≤ 25m de dropsite existente, redireciona o worker pra lá
	// em vez de desperdiçar recursos construindo um segundo armazém desnecessário.
	const activeWorkers = bestGroupKey === "wood" ? farWoodWorkers : farFoodWorkers;
	let accessibleX = 0, accessibleZ = 0, accessibleFound = false;
	for (const ds of dropsites) {
		const nearRes = cmpRangeManager.ExecuteQueryAroundPos(ds, 0, 25, [0, player], IID_ResourceSupply, false);
		for (const res of nearRes) {
			const rs = Engine.QueryInterface(res, IID_ResourceSupply);
			if (!rs || !rs.IsAvailable()) continue;
			const rt = rs.GetType();
			if (bestGroupKey === "wood" && rt.generic !== "wood") continue;
			if (bestGroupKey === "food" && (rt.generic !== "food" || rt.specific !== "fruit")) continue;
			const rpos = Engine.QueryInterface(res, IID_Position);
			if (!rpos || !rpos.IsInWorld()) continue;
			const rp = rpos.GetPosition2D();
			accessibleX = rp.x; accessibleZ = rp.y; accessibleFound = true;
			break;
		}
		if (accessibleFound) break;
	}
	// Só redireciona se o recurso acessível está perto do cluster de workers longe.
	// Sem isso, workers a 200m são redirecionados para árvores junto ao CC.
	if (accessibleFound) {
		const wcX = activePos.reduce((s, p) => s + p.x, 0) / activePos.length;
		const wcZ = activePos.reduce((s, p) => s + p.z, 0) / activePos.length;
		const dxA = accessibleX - wcX, dzA = accessibleZ - wcZ;
		if (dxA*dxA + dzA*dzA > 60*60) {
			accessibleFound = false;
			result._dbg.redirect_too_far = Math.round(Math.sqrt(dxA*dxA + dzA*dzA));
		}
	}
	if (accessibleFound) {
		result.action = "redirect";
		result.workersToMove = activeWorkers;
		result.resource = bestGroupKey;
		result.redirectX = accessibleX;
		result.redirectZ = accessibleZ;
		result._dbg.skip = "redirect_to_existing_ds";
		return result;
	}

	// ── Âncora = ponto mais denso dentro do território (maior floresta) ──────────────────
	// Escaneia ao redor do CC para encontrar TODAS as árvores no território do jogador,
	// depois seleciona o ponto com mais recursos a ≤ 50m (maior floresta disponível).
	const targetGeneric = bestGroupKey === "wood" ? "wood" : "food";
	const targetSpecific = bestGroupKey === "food" ? "fruit" : null;

	// ── Raio territorial dinâmico (como PetraBot usa territoryIndices) ───────────────────
	// PetraBot itera todos os tiles do grid territorial; no server-side não temos esse grid,
	// então sondamos em 12 direções a partir do CC até sair do território do jogador.
	// Isso garante que o scan escala com o território real (não usa número absoluto).
	let scanRadius = 100; // mínimo
	if (cmpTerritoryManager) {
		const probeStep = 20;
		const probeMax = Math.floor(mapSize * 0.48); // máximo ~48% do mapa, evita escanear lado inimigo
		for (const ccPos of ccPositions) {
			for (let d = 0; d < 12; d++) {
				const angle = (d / 12) * 2 * Math.PI;
				const dx = Math.cos(angle), dz = Math.sin(angle);
				for (let r = probeStep; r <= probeMax; r += probeStep) {
					const tx = ccPos.x + dx * r, tz = ccPos.y + dz * r;
					if (tx < 8 || tx > mapSize - 8 || tz < 8 || tz > mapSize - 8) break;
					if (cmpTerritoryManager.GetOwner(tx, tz) !== player) break;
					if (r + probeStep > scanRadius) scanRadius = r + probeStep;
				}
			}
		}
	}
	result._dbg.scanR = scanRadius;

	// Coletar todas as árvores/frutas no território a partir dos CCs
	const allTerritoryRes = [];
	const seenResIds = new Set();
	for (const ccPos of ccPositions) {
		const nearCC = cmpRangeManager.ExecuteQueryAroundPos(ccPos, 0, scanRadius, [0], IID_ResourceSupply, false);
		for (const res of nearCC) {
			if (seenResIds.has(res)) continue;
			const rs = Engine.QueryInterface(res, IID_ResourceSupply);
			if (!rs || !rs.IsAvailable()) continue;
			const rt = rs.GetType();
			if (!rt || rt.generic !== targetGeneric) continue;
			if (targetSpecific && rt.specific !== targetSpecific) continue;
			const rpos = Engine.QueryInterface(res, IID_Position);
			if (!rpos || !rpos.IsInWorld()) continue;
			const rp = rpos.GetPosition2D();
			// Só incluir se está em território do jogador ou neutro (não inimigo)
			const owner = cmpTerritoryManager ? cmpTerritoryManager.GetOwner(rp.x, rp.y) : 0;
			if (owner !== player && owner !== 0) continue;
			seenResIds.add(res);
			allTerritoryRes.push({ x: rp.x, z: rp.y });
		}
	}

	// Encontrar âncora: floresta mais densa (wood) OU cluster mais denso das frutas (food/farmstead)
	let anchorX = 0, anchorZ = 0, anchorDensity = 0;
	if (bestGroupKey === "food") {
		// Farmstead: âncora = ponto com mais vizinhos em 60m (cluster mais denso).
		// Centróide de 2 clusters distantes cairia no meio vazio entre eles.
		if (farFoodPos.length > 0) {
			for (const p of farFoodPos) {
				let cnt = 0;
				for (const q of farFoodPos) {
					const dx = p.x - q.x, dz = p.z - q.z;
					if (dx*dx + dz*dz <= 60*60) cnt++;
				}
				if (cnt > anchorDensity) { anchorDensity = cnt; anchorX = p.x; anchorZ = p.z; }
			}
		} else {
			// Proativo (farmsteadCount<2 mas sem workers longe): buscar cluster de frutas no território
			const MAX_SEEDS_F = 60;
			let seedPositionsF = allTerritoryRes.length > 0 ? allTerritoryRes : [];
			if (seedPositionsF.length > MAX_SEEDS_F) {
				const stepF = Math.ceil(seedPositionsF.length / MAX_SEEDS_F);
				seedPositionsF = seedPositionsF.filter((_, i) => i % stepF === 0);
			}
			for (const sp of seedPositionsF) {
				const pos2D = { x: sp.x, y: sp.z };
				const nearby = cmpRangeManager.ExecuteQueryAroundPos(pos2D, 0, 50, [0], IID_ResourceSupply, false);
				let cnt = 0;
				for (const res of nearby) {
					const rs = Engine.QueryInterface(res, IID_ResourceSupply);
					if (!rs || !rs.IsAvailable()) continue;
					const rt = rs.GetType();
					if (!rt || rt.generic !== "food" || rt.specific !== "fruit") continue;
					cnt++;
				}
				if (cnt > anchorDensity) { anchorDensity = cnt; anchorX = sp.x; anchorZ = sp.z; }
			}
			if (anchorDensity === 0) { result._dbg.skip = "no_fruit_anchor"; return result; }
		}
		result._dbg.density = anchorDensity;
		result._dbg.treesCnt = farFoodPos.length;
	} else {
		// Wood: usar activePos como sementes caso o scan territorial seja vazio
		// Limitar a 120 sementes (amostrar uniformemente se for muito grande) para não travar
		const rawSeeds = allTerritoryRes.length > 0 ? allTerritoryRes : activePos;
		const MAX_SEEDS = 120;
		let seedPositions = rawSeeds;
		if (rawSeeds.length > MAX_SEEDS) {
			const step = Math.ceil(rawSeeds.length / MAX_SEEDS);
			seedPositions = rawSeeds.filter((_, i) => i % step === 0);
		}
		for (const sp of seedPositions) {
			const pos2D = { x: sp.x, y: sp.z };
			const nearby = cmpRangeManager.ExecuteQueryAroundPos(pos2D, 0, 50, [0], IID_ResourceSupply, false);
			let cnt = 0;
			for (const res of nearby) {
				const rs = Engine.QueryInterface(res, IID_ResourceSupply);
				if (!rs || !rs.IsAvailable()) continue;
				const rt = rs.GetType();
				if (!rt || rt.generic !== targetGeneric) continue;
				if (targetSpecific && rt.specific !== targetSpecific) continue;
				cnt++;
			}
			if (cnt > anchorDensity) { anchorDensity = cnt; anchorX = sp.x; anchorZ = sp.z; }
		}
		result._dbg.density = anchorDensity;
		result._dbg.treesCnt = seedPositions.length;
	}

	// Limiar de dropsite: para madeira usa 85% da dist âncora→CC (CC é alternativa viable).
	// Para comida (farmstead) usa distância fixa de 35m — farmstead precisa estar colado na fruta,
	// independente da distância ao CC (trabalhadores caminham 212m/volta com farmstead a 106m).
	let anchorToCCDist = Infinity;
	if (ccPositions.length > 0) {
		for (const cc of ccPositions) {
			const ddx = cc.x - anchorX, ddz = cc.y - anchorZ;
			const d = Math.sqrt(ddx*ddx + ddz*ddz);
			if (d < anchorToCCDist) anchorToCCDist = d;
		}
	}
	// Wood: cap em 70m — armazém a >70m da floresta força caminhada excessiva
	// Food: 35m — farmstead precisa estar colado ao arbusto
	const buildThresh = bestGroupKey === "food"
		? 35
		: (anchorToCCDist < Infinity ? Math.min(anchorToCCDist * 0.85, 70) : 40);
	result._dbg.anchorCC = Math.round(anchorToCCDist);
	result._dbg.thresh = Math.round(buildThresh);

	let nearestDedicatedDist = Infinity;
	for (const ds of dropsites) {
		if (bestGroupKey === "wood" && !ds.isStorehouse) continue;
		if (bestGroupKey === "food" && !ds.isFarmstead) continue;
		const ddx = ds.x - anchorX, ddz = ds.y - anchorZ;
		const d = Math.sqrt(ddx*ddx + ddz*ddz);
		if (d < nearestDedicatedDist) nearestDedicatedDist = d;
	}
	result._dbg.nearestDed = Math.round(nearestDedicatedDist);
	if (nearestDedicatedDist <= buildThresh) {
		// Âncora principal já tem dropsite. Verificar se workers longe têm um cluster
		// secundário sem dropsite — se sim, recalcular âncora no centróide dos workers longe.
		if (bestGroupKey === "wood" && farWoodPos.length >= 5) {
			const wcX = farWoodPos.reduce((s, p) => s + p.x, 0) / farWoodPos.length;
			const wcZ = farWoodPos.reduce((s, p) => s + p.z, 0) / farWoodPos.length;
			let nearestSHToWorkers = Infinity;
			for (const ds of dropsites) {
				if (!ds.isStorehouse) continue;
				const ddx = ds.x - wcX, ddz = ds.y - wcZ;
				const d = Math.sqrt(ddx*ddx + ddz*ddz);
				if (d < nearestSHToWorkers) nearestSHToWorkers = d;
			}
			if (nearestSHToWorkers > 80) {
				// Cluster secundário sem armazém — recalcular âncora no centróide dos workers
				anchorX = wcX; anchorZ = wcZ;
				result._dbg.anchorCC = Math.round(anchorToCCDist);
				result._dbg.secondary_cluster = Math.round(nearestSHToWorkers);
				// Recalcular densidade na âncora secundária
				const pos2DSec = { x: anchorX, y: anchorZ };
				const nearbySec = cmpRangeManager.ExecuteQueryAroundPos(pos2DSec, 0, 50, [0], IID_ResourceSupply, false);
				let secDensity = 0;
				for (const res of nearbySec) {
					const rs = Engine.QueryInterface(res, IID_ResourceSupply);
					if (!rs || !rs.IsAvailable()) continue;
					const rt = rs.GetType();
					if (rt && rt.generic === "wood") secDensity++;
				}
				if (secDensity < 4) {
					result._dbg.skip = "secondary_too_sparse_" + secDensity;
					return result;
				}
				anchorDensity = secDensity;
				result._dbg.density = anchorDensity;
			} else {
				result._dbg.skip = "within_85pct_CC_dist nd=" + Math.round(nearestDedicatedDist) + " thr=" + Math.round(buildThresh);
				return result;
			}
		} else {
			result._dbg.skip = "within_85pct_CC_dist nd=" + Math.round(nearestDedicatedDist) + " thr=" + Math.round(buildThresh);
			return result;
		}
	}

	// Não construir se a floresta tem menos de 4 árvores (evita armazém ao lado de 1 árvore).
	if (bestGroupKey === "wood" && anchorDensity < 4) {
		result._dbg.skip = "too_few_resources_" + anchorDensity;
		return result;
	}
	// Celeiro: anchorDensity aqui conta TRABALHADORES próximos (não arbustos — ver seleção de
	// âncora acima), então não serve pra medir se vale os 100 de madeira. Conta arbustos de
	// fruta de verdade a 30m da âncora; exige pelo menos 2 (1 isolado esgota rápido e o
	// celeiro fica ocioso, mas exigir 4 como madeira seria demais pro tamanho normal de um
	// grupo de bagas).
	if (bestGroupKey === "food") {
		const realFruitNearby = cmpRangeManager.ExecuteQueryAroundPos(
			{ x: anchorX, y: anchorZ }, 0, 30, [0], IID_ResourceSupply, false);
		let fruitCount = 0;
		for (const res of realFruitNearby) {
			const rs = Engine.QueryInterface(res, IID_ResourceSupply);
			if (!rs || !rs.IsAvailable()) continue;
			const rt = rs.GetType();
			if (rt && rt.generic === "food" && rt.specific === "fruit") fruitCount++;
		}
		if (fruitCount < 2) {
			result._dbg.skip = "too_few_fruit_" + fruitCount;
			return result;
		}
	}

	// ── Identificar template baseado no builder ───────────────────────────────────────────
	if (!builderEnt) { result._dbg.skip = "noBuilder"; return result; }
	let dropsiteTemplate = "";
	const cmpBuilder = Engine.QueryInterface(builderEnt, IID_Builder);
	const buildables = cmpBuilder.GetEntitiesList();
	if (bestGroupKey === "wood") {
		for (const tpl of buildables) { if (tpl.indexOf("storehouse") !== -1) { dropsiteTemplate = tpl; break; } }
		if (!dropsiteTemplate) for (const tpl of buildables) { if (tpl.indexOf("dropsite") !== -1) { dropsiteTemplate = tpl; break; } }
	} else {
		for (const tpl of buildables) { if (tpl.indexOf("farmstead") !== -1) { dropsiteTemplate = tpl; break; } }
	}
	if (!dropsiteTemplate) {
		const cmpIdentB = Engine.QueryInterface(builderEnt, IID_Identity);
		if (cmpIdentB) dropsiteTemplate = "structures/" + cmpIdentB.GetCiv() + "/" + (bestGroupKey === "wood" ? "storehouse" : "farmstead");
	}
	if (!dropsiteTemplate) { result._dbg.skip = "noTpl"; return result; }

	// Ângulo âncora → CC (posiciona armazém na borda da floresta voltada para o CC)
	let hintAngle = 0;
	if (ccPositions.length > 0) {
		let nearCC = ccPositions[0], minCCd = Infinity;
		for (const cc of ccPositions) {
			const dx = cc.x - anchorX, dz = cc.y - anchorZ;
			const d = dx*dx + dz*dz;
			if (d < minCCd) { minCCd = d; nearCC = cc; }
		}
		hintAngle = Math.atan2(nearCC.y - anchorZ, nearCC.x - anchorX);
	}

	// Espiral fina: começa na âncora (ponto mais denso), passos de 2 units, 8 ângulos (45°)
	const candidates = [];
	for (let rOffset = 2; rOffset <= 80; rOffset += 2) {
		for (let i = 0; i < 8; i++) {
			const angle = hintAngle + (i * Math.PI / 4);
			candidates.push({
				"x": Math.max(12, Math.min(mapSize - 12, anchorX + Math.cos(angle) * rOffset)),
				"z": Math.max(12, Math.min(mapSize - 12, anchorZ + Math.sin(angle) * rOffset))
			});
		}
	}
	// Para farmstead: filtrar candidatos dentro de 30m do CC ou outro farmstead
	let validCandidates;
	if (bestGroupKey === "food") {
		validCandidates = candidates.filter(c => {
			for (const cc of ccPositions) {
				const dx = c.x - cc.x, dz = c.z - cc.y;
				if (dx*dx + dz*dz < 30*30) return false;
			}
			for (const ds of dropsites) {
				if (!ds.isFarmstead) continue;
				const dx = c.x - ds.x, dz = c.z - ds.y;
				if (dx*dx + dz*dz < 30*30) return false;
			}
			return true;
		});
		if (validCandidates.length === 0) {
			result._dbg.skip = "no_candidate_30m_clearance";
			return result;
		}
	} else {
		validCandidates = candidates;
	}

	// Workers a ≤ 80m da âncora ajudam a construir — ficam perto do recurso quando termina
	// Workers > 80m de madeira são redirecionados para coleta próxima da âncora (concentrar na floresta)
	// Food: âncora = centroide das frutas, workers > 80m do centroide ficam onde estão (mantém fruta atual)
	const workersToMove = [];
	const scatteredWorkers = [];
	for (let i = 0; i < activeWorkers.length; i++) {
		const wp = activePos[i];
		const dx = wp.x - anchorX, dz = wp.z - anchorZ;
		if (dx*dx + dz*dz < 80*80) workersToMove.push(activeWorkers[i]);
		else if (bestGroupKey === "wood") scatteredWorkers.push(activeWorkers[i]);
		// food longe do CC: não redirecionar, manter na fruta atual
	}
	result._dbg.wtm = workersToMove.length;
	result._dbg.scattered = scatteredWorkers.length;

	result.action = "build";
	result.builderId = builderEnt;
	result.template = dropsiteTemplate;
	result.candidatePositions = validCandidates;
	result.resource = bestGroupKey;
	result.workersToMove = workersToMove;
	result.scatteredWorkers = scatteredWorkers;
	result.anchorX = anchorX;
	result.anchorZ = anchorZ;

	result._dbg.skip = "ok";
	return result;
};

// Auto-research: detecta tecnologias disponíveis e agenda pesquisa quando há recursos sobrando.
// Usa IID_Researcher.GetTechnologiesList() para obter as techs REAIS do building, sem hardcode.
// Retorna: { research: [{ building: entityId, tech: techName, score: number }] }
GuiInterface.prototype.pudim_GetAutoResearchData = function(player, data)
{
	const result = { research: [] };

	const cmpTechMgr = QueryPlayerIDInterface(player, IID_TechnologyManager);
	if (!cmpTechMgr) return result;

	const cmpPlayerManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_PlayerManager);
	const playerEnt = cmpPlayerManager.GetPlayerByID(player);
	const cmpPlayer = Engine.QueryInterface(playerEnt, IID_Player);
	if (!cmpPlayer) return result;

	// Pesquisar apenas quando há recursos sobrando (≥ 600 em qualquer recurso ou ≥ 900 total)
	const res = cmpPlayer.GetResourceCounts();
	const total = (res.food || 0) + (res.wood || 0) + (res.stone || 0) + (res.metal || 0);
	const anyAbundant = (res.food > 600 || res.wood > 600 || res.metal > 500 || res.stone > 500);
	if (total < 900 && !anyAbundant) return result;

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return result;

	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);

	// Auto-pesquisa restrita a: Armazém, Edifício Agrícola e Forja (não CC, não forte, não quartel)
	const ALLOWED_RESEARCH_CLASSES = ["Storehouse", "Farmstead", "Forge", "Smith", "Blacksmith"];

	// ── Liberação de pesquisa por FASE ────────────────────────────────────────────
	// Fase 1 (Aldeia): só comida e madeira (+ capacidade de carga, que serve a todos)
	// Fase 2 (Vila):   + pedra e metal
	// Fase 3 (Cidade): + combate e saúde
	// phase_town/phase_city são techs "dummy" marcadas como pesquisadas via o campo
	// "replaces" da tech real (TechnologyManager.js:106-111) — logo IsTechnologyResearched
	// funciona para qualquer civ, inclusive as que têm variante própria (athen, pers).
	const isPhase2 = cmpTechMgr.IsTechnologyResearched("phase_town");
	const isPhase3 = cmpTechMgr.IsTechnologyResearched("phase_city");

	/**
	 * Classifica a tech pelos recursos que ela REALMENTE afeta, lendo as modificações do
	 * template (TechnologyTemplates.Get — mesma fonte usada pelo TechnologyManager).
	 * Classificar por nome era frágil: gather_wicker_baskets, comentado no código como
	 * "bônus de madeira", na verdade modifica ResourceGatherer/Rates/food.fruit — é comida.
	 * Retorna um Set com "food" | "wood" | "stone" | "metal", ou vazio se não for de coleta.
	 */
	const techResources = (tech) => {
		const out = new Set();
		let tpl = null;
		try { tpl = TechnologyTemplates.Get(tech); } catch(e) { return out; }
		if (!tpl || !tpl.modifications) return out;
		for (const mod of tpl.modifications) {
			const v = mod && mod.value;
			if (typeof v !== "string") continue;
			if (v.indexOf("ResourceGatherer/") !== 0) continue;
			// formatos: ResourceGatherer/Rates/food.fruit | ResourceGatherer/Capacities/wood
			const tail = v.split("/").pop();          // "food.fruit" ou "wood"
			const res = tail.split(".")[0];           // "food" | "wood" | "stone" | "metal"
			if (res === "food" || res === "wood" || res === "stone" || res === "metal")
				out.add(res);
		}
		return out;
	};

	/** true se a tech é permitida na fase atual */
	const allowedInPhase = (tech) => {
		const n = tech.toLowerCase();
		// Combate e saúde: só na Fase 3
		if (n.indexOf("attack_") !== -1 || n.indexOf("armor_") !== -1 || n.indexOf("health_") !== -1)
			return isPhase3;

		const resSet = techResources(tech);
		if (resSet.size === 0) return isPhase3; // não é de coleta: trata como não-prioritária

		// Capacidade de carga afeta food+wood também → liberada desde a Fase 1
		if (resSet.has("food") || resSet.has("wood")) return true;
		// Só pedra/metal → a partir da Fase 2
		return isPhase2;
	};

	// Existe pelo menos uma fazenda? Techs de GRÃOS dependem disso.
	let hasField = false;
	for (const fEnt of allEnts) {
		const fi = Engine.QueryInterface(fEnt, IID_Identity);
		if (fi && fi.HasClass("Field")) { hasField = true; break; }
	}

	/** true se a tech só rende com campo agrícola (mexe na taxa de food.grain) */
	const techNeedsField = (tech) => {
		let tpl = null;
		try { tpl = TechnologyTemplates.Get(tech); } catch(e) { return false; }
		if (!tpl || !tpl.modifications) return false;
		for (const mod of tpl.modifications) {
			const v = mod && mod.value;
			if (typeof v === "string" && v.indexOf("food.grain") !== -1) return true;
		}
		return false;
	};

	// Prioridade por padrão de nome da tecnologia — apenas techs econômicas de coleta
	const scoreTech = (tech) => {
		if (!allowedInPhase(tech)) return 0;
		// Sem nenhuma fazenda, +20% na coleta de grãos multiplica zero. Observado em jogo:
		// o mod tentou pesquisar "Treinamento de coletas" (300 comida, 200 madeira) com o
		// banco em 3 de comida e nenhum campo construído — o pior negócio possível.
		// Detecção pelo template (food.grain), não pelo nome, que varia por civilização.
		if (!hasField && techNeedsField(tech)) return 0;
		const n = tech.toLowerCase();
		// Fase de avanço: decisão manual do jogador — não pesquisar automaticamente
		if (n.indexOf("phase_") !== -1) return 0;
		// Techs excluídas explicitamente (inúteis ou imprevisíveis)
		if (n.indexOf("fertility") !== -1 || n.indexOf("festival") !== -1) return 0;
		// Cestos de vime: modifica ResourceGatherer/Rates/food.fruit — é bônus de COMIDA
		// (o comentário antigo dizia "madeira", conferido errado contra o JSON da tech)
		if (n.indexOf("wicker") !== -1) return 110;
		// Capacidade de carga (Cestas → Carrinho de Mão → Carroça): soma +5 em food, wood,
		// stone E metal de uma vez, então rende mais que qualquer tech de um recurso só.
		// Cestas já é liberada na Fase 1 (requirements: phase_village) e a regra de fase
		// daqui a permite; faltava prioridade — com 76 o armazém sempre escolhia outra antes.
		if (n.indexOf("gather_capacity") !== -1) return 105;
		if (n.indexOf("woodcutting") !== -1 || n.indexOf("lumbering") !== -1) return 100;
		if (n.indexOf("farming") !== -1 || n.indexOf("plows") !== -1 || n.indexOf("rotation") !== -1) return 92;
		if (n.indexOf("mining") !== -1 || n.indexOf("silver") !== -1) return 84;
		if (n.indexOf("gather_") !== -1) return 76;
		if (n.indexOf("health_") !== -1) return 30;
		if (n.indexOf("attack_infantry") !== -1 || n.indexOf("armor_infantry") !== -1) return 20;
		if (n.indexOf("attack_cavalry") !== -1 || n.indexOf("armor_cavalry") !== -1) return 15;
		return 0; // qualquer outra tech: não pesquisar automaticamente
	};

	// Pré-coletar techs atualmente em pesquisa em qualquer edifício (evita enviar duplicatas)
	// Uma passada só monta os DOIS conjuntos: antes eram dois laços sobre todas as
	// entidades, cada um chamando QueryInterface(ProductionQueue) e GetQueue() de novo
	// para ler exatamente a mesma fila. O "confirmadas" também usava Array.includes()
	// dentro do laço, que é busca linear — agora é Set.
	const alreadyQueued = new Set();
	const confirmedSet = new Set();
	for (const ent of allEnts) {
		const cmpPQ0 = Engine.QueryInterface(ent, IID_ProductionQueue);
		if (!cmpPQ0) continue;
		const q0 = cmpPQ0.GetQueue();
		if (!q0 || q0.length === 0) continue;
		for (const qItem of q0) {
			// Itens de pesquisa não têm unitTemplate; podem ter 'template' ou 'tech'
			if (qItem.tech) alreadyQueued.add(qItem.tech);
			if (!qItem.unitTemplate && qItem.template) alreadyQueued.add(qItem.template);
			// Confirmadas: qualquer item de fila, para o painel parar de reenviar
			const t = qItem.tech || qItem.template;
			if (t) confirmedSet.add(t);
		}
	}

	const blacklist = (data && Array.isArray(data.blacklist)) ? new Set(data.blacklist) : new Set();

	const confirmedTechs = Array.from(confirmedSet);
	// Também incluir as já concluídas que foram enviadas pelo painel
	if (data && Array.isArray(data.sentTechs)) {
		for (const t of data.sentTechs) {
			if (cmpTechMgr.IsTechnologyResearched(t) && !confirmedTechs.includes(t))
				confirmedTechs.push(t);
		}
	}
	result.confirmed = confirmedTechs;

	for (const ent of allEnts) {
		if (Engine.QueryInterface(ent, IID_Foundation)) continue;
		// Apenas Armazém, Edifício Agrícola e Forja — CC, forte, quartel, etc. ficam de fora
		const cmpIdentR = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpIdentR || !ALLOWED_RESEARCH_CLASSES.some(function(c) { return cmpIdentR.HasClass(c); })) continue;

		const cmpPQ = Engine.QueryInterface(ent, IID_ProductionQueue);
		if (!cmpPQ) continue;
		// Pular se já há pesquisa ativa neste edifício
		const queue = cmpPQ.GetQueue();
		const hasActiveResearch = queue && queue.some(function(q) { return q.productiontype === "technology"; });
		if (hasActiveResearch) continue;

		// IID_Researcher expõe GetTechnologiesList() — lista de techs disponíveis no building
		const cmpResearcher = Engine.QueryInterface(ent, IID_Researcher);
		if (!cmpResearcher) continue;
		let techList = [];
		try { techList = cmpResearcher.GetTechnologiesList() || []; } catch(e) { continue; }
		if (!techList.length) continue;

		let bestTech = null, bestScore = 4; // só pesquisa se score > 4
		for (const item of techList) {
			// item pode ser string, null, ou array (par mutuamente exclusivo)
			const candidates = Array.isArray(item) ? item : [item];
			for (const tech of candidates) {
				if (!tech || typeof tech !== "string") continue;
				if (alreadyQueued.has(tech)) continue;
				if (blacklist.has(tech)) continue;
				if (cmpTechMgr.IsTechnologyResearched(tech)) continue;
				// Verificar se está em andamento (checks separados: else if era bug)
				if (typeof cmpTechMgr.IsInProgress === "function" && cmpTechMgr.IsInProgress(tech)) continue;
				if (typeof cmpTechMgr.IsTechnologyQueued === "function" && cmpTechMgr.IsTechnologyQueued(tech)) continue;
				const score = scoreTech(tech);
				if (score > bestScore) { bestScore = score; bestTech = tech; }
			}
		}

		if (!bestTech) continue;
		alreadyQueued.add(bestTech);
		result.research.push({ building: ent, tech: bestTech, score: bestScore });
	}

	// Ordenar por score e limitar a 3 pesquisas simultâneas
	result.research.sort((a, b) => b.score - a.score);
	result.research = result.research.slice(0, 3);
	return result;
};

// Rastreia trabalhadores recém-nascidos detectando IDs novos entre chamadas.
// Chave: separado do estado de retreating/farm pois é sim-side state persistente.
var g_PudimPrevGathererIds = null;

// Feature: trabalhador nasce → ajuda a construir fundação de dropsite ativa.
// Feature: dropsite conclui → redireciona workers que coletam longe para perto do novo dropsite.
// Retorna: { foundations, assignments: [{foundationId, workerId}], completions: [{id,x,z,resourceType,workersToRedirect}] }
GuiInterface.prototype.pudim_GetDropsiteFoundationData = function(player, data)
{
	const prevFoundationIds = (data && data.prevFoundationIds) ? data.prevFoundationIds : [];
	const prevSet = new Set(prevFoundationIds.map(Number));
	// Workers recém-despachados (ex: balanceamento inicial) — nunca sequestrar como ajudante
	const protectedIds = new Set(((data && data.protectedIds) || []).map(Number));
	// Sob ordem MANUAL do jogador: intocáveis enquanto executam a ordem; assim que ficam
	// ociosos (terminaram de construir/coletar) voltam a ser gerenciados pelo mod.
	const playerOrdered = new Set(((data && data.playerOrdered) || []).map(Number));
	const isPlayerBusy = function(ent) {
		if (!playerOrdered.has(ent)) return false;
		const ua = Engine.QueryInterface(ent, IID_UnitAI);
		return !!(ua && !ua.IsIdle());
	};
	// Posições de armazém/celeiro que o PRÓPRIO MOD mandou construir (passadas pelo painel).
	// O sistema de "enviar ajuda" só deve agir nessas — construção iniciada pelo jogador
	// (incluindo QUALQUER edifício militar, que o mod nunca decide construir sozinho)
	// não deve receber ajuda automática.
	const modBuiltPositions = (data && data.modBuiltPositions) ? data.modBuiltPositions : [];
	const isModBuiltPos = (x, z) => {
		for (const p of modBuiltPositions) {
			const dx = x - p.x, dz = z - p.z;
			if (dx*dx + dz*dz <= 3*3) return true;
		}
		return false;
	};

	const result = {
		foundations: [],   // fundações ativas
		assignments: [],   // workers ociosos → ajudar fundação
		completions: []    // dropsite concluído → redirecionar workers distantes
	};

	const cmpRangeManager = Engine.QueryInterface(SYSTEM_ENTITY, IID_RangeManager);
	if (!cmpRangeManager) return result;
	const allEnts = cmpRangeManager.GetEntitiesByPlayer(player);

	// ── Passo 1: Fundações ativas de dropsite (armazém/celeiro) ─────────
	// Edifícios militares NUNCA entram aqui: o mod não os constrói por iniciativa própria,
	// então toda fundação militar é sempre do jogador — sem ajuda automática.
	const currentFoundations = new Map(); // id → { x, z, resourceType, numBuilders, isModBuilt }
	for (const ent of allEnts) {
		const cmpFoundation = Engine.QueryInterface(ent, IID_Foundation);
		if (!cmpFoundation) continue;
		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpId) continue;
		const isStorehouse = cmpId.HasClass("Storehouse") || cmpId.HasClass("DropsiteWood");
		const isFarmstead  = cmpId.HasClass("Farmstead")  || cmpId.HasClass("DropsiteFood");
		if (!isStorehouse && !isFarmstead) continue;
		const cmpPos = Engine.QueryInterface(ent, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const p = cmpPos.GetPosition2D();
		const numBuilders = cmpFoundation.GetNumBuilders();
		const resourceType = isStorehouse ? "wood" : "food";
		const isModBuilt = isModBuiltPos(p.x, p.y);
		// onSite: builders já registrados na fundação — evita contá-los de novo no passe
		// de "a caminho" (quem constrói também tem ordem Repair pro mesmo alvo)
		currentFoundations.set(ent, { x: p.x, z: p.y, resourceType, numBuilders, isModBuilt,
			onSite: new Set(cmpFoundation.GetBuilders()) });
		// progress distingue os dois motivos de uma fundação sumir: cancelamento do jogador
		// (havia obra feita) e decaimento por nunca ter recebido construtor (progresso 0).
		// O painel tratava os dois como cancelamento e bania o local para sempre.
		result.foundations.push({ id: ent, x: p.x, z: p.y, resourceType,
			progress: cmpFoundation.GetBuildProgress ? cmpFoundation.GetBuildProgress() : 0 });
	}

	// Dropsites existentes (qualquer um, incluindo CC) — usado no Passo 2 pra decidir se um
	// worker já está coletando com eficiência e deve ser deixado em paz
	const allDropsites = [];
	for (const ent of allEnts) {
		const cmpDs = Engine.QueryInterface(ent, IID_ResourceDropsite);
		if (!cmpDs) continue;
		if (Engine.QueryInterface(ent, IID_Foundation)) continue;
		const dsPos = Engine.QueryInterface(ent, IID_Position);
		if (!dsPos || !dsPos.IsInWorld()) continue;
		const dp = dsPos.GetPosition2D();
		allDropsites.push({ x: dp.x, z: dp.y, types: cmpDs.GetTypes() || [] });
	}

	// ── Passo 2: Dropsites concluídos (estavam em prevSet, saíram de fundação) ──
	for (const prevId of prevSet) {
		if (currentFoundations.has(prevId)) continue; // ainda é fundação
		const cmpId = Engine.QueryInterface(prevId, IID_Identity);
		if (!cmpId) continue; // entidade destruída (cancelado)
		if (Engine.QueryInterface(prevId, IID_Foundation)) continue; // ainda fundação?
		const isStorehouse = cmpId.HasClass("Storehouse") || cmpId.HasClass("DropsiteWood");
		const isFarmstead  = cmpId.HasClass("Farmstead")  || cmpId.HasClass("DropsiteFood");
		if (!isStorehouse && !isFarmstead) continue;
		const cmpPos = Engine.QueryInterface(prevId, IID_Position);
		if (!cmpPos || !cmpPos.IsInWorld()) continue;
		const p = cmpPos.GetPosition2D();
		const resourceType = isStorehouse ? "wood" : "food";

		// Encontrar workers coletando esse recurso que estão longe do novo dropsite
		const dsPos2D = { x: p.x, y: p.y };
		const nearGatherers = cmpRangeManager.ExecuteQueryAroundPos(dsPos2D, 0, 350, [player], IID_ResourceGatherer, false);
		const workersToRedirect = [];
		for (const w of nearGatherers) {
			if (protectedIds.has(w)) continue; // recém-comandado por outro sistema — não mexer
			const cmpId2 = Engine.QueryInterface(w, IID_Identity);
			if (!cmpId2) continue;
			if (cmpId2.HasClass("FastMoving") || cmpId2.HasClass("CitizenSoldier")) continue;
			const cmpUnitAI = Engine.QueryInterface(w, IID_UnitAI);
			if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
			if (cmpUnitAI.isGarrisoned) continue;
			const ord = cmpUnitAI.orderQueue[0];
			// Aceita quem está coletando ou voltando (ReturnResource)
			if (ord.type !== "Gather" && ord.type !== "ReturnResource" && ord.type !== "GatherNearPosition") continue;

			// Verificar tipo de recurso que o worker está coletando
			let rType = null;
			if (ord.type === "Gather" && ord.data && ord.data.target) {
				const cmpRS = Engine.QueryInterface(ord.data.target, IID_ResourceSupply);
				if (cmpRS) { const rt = cmpRS.GetType(); rType = rt ? rt.generic : null; }
			} else if (ord.data && ord.data.resourceType) {
				rType = ord.data.resourceType.generic || null;
			} else if (ord.data && ord.data.type) {
				rType = ord.data.type.generic || null;
			}
			if (rType !== resourceType) continue;

			// Verificar se o worker está longe do novo dropsite (> 80m)
			const cmpWPos = Engine.QueryInterface(w, IID_Position);
			if (!cmpWPos || !cmpWPos.IsInWorld()) continue;
			const wp = cmpWPos.GetPosition2D();
			const ddx = wp.x - p.x, ddz = wp.y - p.y;
			if (ddx*ddx + ddz*ddz < 80*80) continue; // já está perto

			// Só redirecionar quem coleta INEFICIENTEMENTE (alvo atual >80m de TODOS os
			// dropsites). Antes, qualquer coletor num raio de 350m era puxado pro dropsite
			// novo, mesmo trabalhando colado a outro dropsite — a cada armazém concluído,
			// meia economia migrava pelo mapa ("trabalhadores passeiam de uma parte pra outra").
			let curTargetPos = null;
			if (ord.type === "Gather" && ord.data && ord.data.target) {
				const tp = Engine.QueryInterface(ord.data.target, IID_Position);
				if (tp && tp.IsInWorld()) { const t2 = tp.GetPosition2D(); curTargetPos = { x: t2.x, z: t2.y }; }
			} else if (ord.type === "GatherNearPosition" &&
			           typeof ord.data.x === "number" && typeof ord.data.z === "number") {
				curTargetPos = { x: ord.data.x, z: ord.data.z };
			}
			if (curTargetPos) {
				let efficient = false;
				for (const ds of allDropsites) {
					if (!ds.types || ds.types.indexOf(resourceType) === -1) continue;
					const edx = curTargetPos.x - ds.x, edz = curTargetPos.z - ds.z;
					if (edx*edx + edz*edz <= 80*80) { efficient = true; break; }
				}
				if (efficient) continue; // já entrega perto — deixa em paz
			}

			// Encontrar recurso mais próximo do novo dropsite do tipo certo
			const nearRes = cmpRangeManager.ExecuteQueryAroundPos(dsPos2D, 5, 120, [0], IID_ResourceSupply, false);
			let bestRes = null, bestDistSq = Infinity;
			for (const res of nearRes) {
				const cmpRS2 = Engine.QueryInterface(res, IID_ResourceSupply);
				if (!cmpRS2 || !cmpRS2.IsAvailable()) continue;
				const rt2 = cmpRS2.GetType();
				if (!rt2 || rt2.generic !== resourceType) continue;
				if (resourceType === "food" && rt2.specific !== "fruit") continue;
				const cmpRPos = Engine.QueryInterface(res, IID_Position);
				if (!cmpRPos || !cmpRPos.IsInWorld()) continue;
				const rp = cmpRPos.GetPosition2D();
				const rdx = rp.x - p.x, rdz = rp.y - p.y;
				const dSq = rdx*rdx + rdz*rdz;
				if (dSq < bestDistSq) { bestDistSq = dSq; bestRes = { id: res, x: rp.x, z: rp.y }; }
			}
			if (!bestRes) continue;
			workersToRedirect.push({ workerId: w, targetRes: bestRes.id, x: bestRes.x, z: bestRes.z });
		}
		result.completions.push({ id: prevId, x: p.x, z: p.y, resourceType, workersToRedirect });
	}

	// ── Passo 3: Detectar workers recém-nascidos (IDs novos vs chamada anterior) ──
	const currentGathererIds = new Set();
	for (const ent of allEnts) {
		const cmpGatherer = Engine.QueryInterface(ent, IID_ResourceGatherer);
		if (!cmpGatherer) continue;
		const cmpId = Engine.QueryInterface(ent, IID_Identity);
		if (!cmpId || cmpId.HasClass("FastMoving") || cmpId.HasClass("CitizenSoldier")) continue;
		currentGathererIds.add(ent);
	}
	const newWorkers = [];
	if (g_PudimPrevGathererIds !== null) {
		for (const id of currentGathererIds) {
			if (!g_PudimPrevGathererIds.has(id)) newWorkers.push(id);
		}
	}
	g_PudimPrevGathererIds = currentGathererIds;

	// ── Passo 4: Atribuir workers (novos + ociosos) a fundações que precisam de ajuda ──
	// Só fundações que o MOD mandou construir (isModBuilt) — o jogador nunca recebe ajuda
	// não pedida numa construção que ele mesmo iniciou. Prioriza fundações com menos
	// construtores. Cap generoso (10): economicamente crítico, e sem limite rígido do motor
	// (só retorno decrescente suave via BuildTimeModifier).
	// 3, não 10. O replay 2026-08-11_0004 mostra 7 dos 8 aldeões iniciais puxados de uma vez
	// para um armazém, voltando à coleta e sendo puxados de novo logo depois. Um dropsite é
	// barato e rápido: 3 construtores já o levantam em segundos, e o ganho de tempo do 4º em
	// diante não paga o buraco que abre na coleta — ainda mais no início, quando cada
	// trabalhador parado é uma fatia enorme da economia.
	const MAX_BUILDERS_PER_FOUNDATION = 3;

	// GetNumBuilders() só conta quem JÁ chegou na fundação — quem foi designado e ainda está
	// caminhando tem ordem Repair mas não conta, então cada ciclo de 3s reatribuía mais gente
	// (visto no log: 10+ atribuições pra mesma fundação em ticks seguidos). Conta os a caminho.
	for (const ent of allEnts) {
		const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
		if (!cmpUnitAI || !cmpUnitAI.orderQueue || cmpUnitAI.orderQueue.length === 0) continue;
		const ord0 = cmpUnitAI.orderQueue[0];
		if (ord0.type !== "Repair" || !ord0.data || !ord0.data.target) continue;
		const fd = currentFoundations.get(ord0.data.target);
		if (fd && !fd.onSite.has(ent)) fd.numBuilders++;
	}

	const foundationsNeedingHelp = Array.from(currentFoundations.entries())
		.filter(([, f]) => f.isModBuilt && f.numBuilders < MAX_BUILDERS_PER_FOUNDATION)
		.sort((a, b) => a[1].numBuilders - b[1].numBuilders);

	if (foundationsNeedingHelp.length > 0) {
		// Conjunto de workers já designados nessa chamada para evitar dupla atribuição
		const assignedThisCall = new Set();

		// Candidatos: workers recém-nascidos, ociosos OU coletando perto da fundação (≤ 200m).
		// CitizenSoldier ENTRA: no início do jogo o pessoal da madeira são os soldados-cidadãos
		// (balanceamento inicial), e excluí-los deixava o armazém da floresta com 1-2 builders
		// enquanto a equipe inteira cortava árvore do lado. Cavalaria (FastMoving) continua
		// fora — não tem IID_Builder mesmo, mas o filtro explícito documenta a intenção.
		const candidates = [];
		for (const ent of allEnts) {
			if (protectedIds.has(ent)) continue; // recém-despachado — não vira ajudante
			const cmpId = Engine.QueryInterface(ent, IID_Identity);
			if (!cmpId || cmpId.HasClass("FastMoving")) continue;
			const cmpBuilder = Engine.QueryInterface(ent, IID_Builder);
			if (!cmpBuilder) continue;
			const cmpUnitAI = Engine.QueryInterface(ent, IID_UnitAI);
			if (!cmpUnitAI || cmpUnitAI.isGarrisoned) continue;

			const isNew = newWorkers.indexOf(ent) !== -1;
			const isIdle = cmpUnitAI.IsIdle();
			const ord0 = cmpUnitAI.orderQueue && cmpUnitAI.orderQueue.length > 0 ? cmpUnitAI.orderQueue[0] : null;
			const isNewWithGather = isNew && ord0 && ord0.type === "Gather";
			const isGathering = !isIdle && ord0 && ord0.type === "Gather";

			// Não redirecionar se já está reparando/construindo
			if (ord0 && ord0.type === "Repair") continue;

			const cmpPos = Engine.QueryInterface(ent, IID_Position);
			if (!cmpPos || !cmpPos.IsInWorld()) continue;
			const p = cmpPos.GetPosition2D();

			// Workers coletando: só incluir se estiverem a ≤ 200m de UMA fundação que precisa de ajuda
			// (florestas grandes podem ter coletores espalhados além de 150m da fundação)
			if (!isIdle && !isNewWithGather) {
				if (!isGathering) continue;
				let nearFound = false;
				for (const [, fd] of foundationsNeedingHelp) {
					const dx = p.x - fd.x, dz = p.y - fd.z; // p={x,y}, fd={x,z}
					if (dx*dx + dz*dz <= 200*200) { nearFound = true; break; }
				}
				if (!nearFound) continue;
			}

			// Determinar tipo de recurso que o worker ia coletar.
			// Cobre também GatherNearPosition e ReturnResource: o mod emite muito essas duas
			// ordens, e antes só "Gather" era reconhecido — quem estivesse voltando com
			// carga ou indo coletar perto de uma posição ficava com tipo nulo e escapava do
			// filtro logo abaixo, que era como aldeãs da fruta acabavam erguendo armazém.
			let workerResType = null;
			if (ord0 && ord0.data) {
				if (ord0.type === "Gather" && ord0.data.target) {
					const cmpRS = Engine.QueryInterface(ord0.data.target, IID_ResourceSupply);
					if (cmpRS) { const rt = cmpRS.GetType(); workerResType = rt ? rt.generic : null; }
				} else if (ord0.type === "GatherNearPosition" || ord0.type === "ReturnResource") {
					const rt = ord0.data.type || ord0.data.resourceType;
					if (rt) workerResType = rt.generic || null;
				}
			}

			// Prioridade: ociosos > novos > coletando (para não interromper quem está longe)
			const priority = isIdle ? 0 : (isNew ? 1 : 2);
			candidates.push({ id: ent, x: p.x, z: p.y, isNew, workerResType, priority });
		}
		candidates.sort((a, b) => a.priority - b.priority);

		for (const [foundId, foundData] of foundationsNeedingHelp) {
			let helpersAdded = 0;
			const needed = MAX_BUILDERS_PER_FOUNDATION - foundData.numBuilders;
			for (const cand of candidates) {
				if (helpersAdded >= needed) break;
				if (assignedThisCall.has(cand.id)) continue;
				// Dropsite: só ajuda quem já coleta o MESMO recurso que ele vai armazenar.
				// Ocioso (priority 0) e recém-nascido (1) entram sempre — não desfalcam nada.
				// Para quem está coletando a regra é dura, e o tipo DESCONHECIDO agora também
				// é recusado: antes o "cand.workerResType &&" transformava tipo nulo em
				// passe livre, que era o furo por onde a comida era drenada.
				if (cand.priority === 2 && cand.workerResType !== foundData.resourceType) continue;
				const dx = cand.x - foundData.x, dz = cand.z - foundData.z;
				if (dx*dx + dz*dz > 250*250) continue; // muito longe
				result.assignments.push({ foundationId: foundId, workerId: cand.id });
				assignedThisCall.add(cand.id);
				helpersAdded++;
				foundData.numBuilders++;
			}
		}
	}

	return result;
};

var pudim_exposedFunctions = {
  	"pudim_GetAllyStats": 1,
 	"pudim_GetAutoHouseData": 1,
  	"pudim_GetScoutStatus": 1,
  	"pudim_GetAutoKiteData": 1,
  	"pudim_GetCombatEstimation": 1,
  	"pudim_GetThreats": 1,
  	"pudim_GetIdleWorkersAndBestResource": 1,
  	"pudim_GetRepeatBuildStates": 1,
  	"pudim_GetActiveRepeatBuilders": 1,
  	"pudim_GetBuilderCurrentFoundation": 1,
  	"pudim_GetPlayerEconomyStats": 1,
  	"pudim_PushNotification": 1,
  	"pudim_GetInitialBalanceData": 1,
  	"pudim_GetMarketBarterData": 1,
  	"pudim_GetSmartDropsiteData": 1,
  	"pudim_GetProactiveStorehouseData": 1,
  	"pudim_GetProactiveFarmsteadData": 1,
  	"pudim_GetDefensiveGarrisonData": 1,
  	"pudim_GetFocusFireCorrections": 1,
  	"pudim_GetAutoRetreatData": 1,
  	"pudim_GetPanicData": 1,
  	"pudim_GetProductionBuildings": 1,
  	"pudim_GetScoutBorderTarget": 1,
  	"pudim_GetFarmBuildData": 1,
  	"pudim_GetPlayerKD": 1,
  	"pudim_GetAutoResearchData": 1,
  	"pudim_GetDropsiteFoundationData": 1
};

if (typeof pudim_patchApplyN !== "undefined") {
    pudim_patchApplyN(GuiInterface.prototype, "ScriptCall", function(target, that, args)
    {
        const [player, name, vargs] = args;
        if (name in pudim_exposedFunctions)
            return that[name](player, vargs);
        return target.apply(that, args);
    });
} else {
    // Rede de segurança: se !!!pudim_patchApplyN.js não tiver carregado por algum motivo,
    // substituímos ScriptCall na mão. Encadeia no original para não quebrar o jogo base.
    const oldScriptCall = GuiInterface.prototype.ScriptCall;
    GuiInterface.prototype.ScriptCall = function(player, name, args) {
        if (name in pudim_exposedFunctions && typeof this[name] === "function") {
            return this[name](player, args);
        }
        if (oldScriptCall) return oldScriptCall.apply(this, arguments);
        return null;
    };
}

Engine.ReRegisterComponentType(IID_GuiInterface, "GuiInterface", GuiInterface);
