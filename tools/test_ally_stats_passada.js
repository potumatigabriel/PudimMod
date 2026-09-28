/**
 * A barra de aliados com UMA passada de entidades e contagem pronta do motor (28/09).
 *
 * Antes: uma varredura pelos inimigos e outra por aliado, perguntando seis classes a cada
 * entidade, edifícios inclusive — a cada segundo. Agora a passada única só lê ORDENS
 * (coletor e combate), e os tipos de unidade saem de TechnologyManager.GetClassCounts /
 * GetTypeCountsByClass (conferidos em simulation/components/TechnologyManager.js da A28).
 *
 * O teste roda a versão ANTIGA (tirada do git, commit 764c822) e a NOVA sobre o mesmo mundo
 * falso e exige a MESMA resposta. Refatoração de desempenho que muda o resultado é bug.
 *
 * Rodar:  node tools/test_ally_stats_passada.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");
const { execSync } = require("child_process");

const base = path.join(__dirname, "..");
const ARQ = "simulation/components/GuiInterface~pudim.js";
const norm = s => s.split("\r\n").join("\n");
const novo = norm(fs.readFileSync(path.join(base, ARQ), "utf8"));
const antigo = norm(execSync("git show 764c822:" + ARQ, { cwd: base, encoding: "utf8", maxBuffer: 64 << 20 }));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

function extrair(sim) {
	const a = sim.indexOf("const PUDIM_TECH_ECO = [");
	const b = sim.indexOf("GuiInterface.prototype.pudim_GetAllyStats = function");
	const c = sim.indexOf("\n};", b) + 3;
	if (a < 0 || b < 0 || c < 3) throw new Error("trecho nao encontrado");
	return sim.slice(a, b) + sim.slice(b, c);
}

// ── O mundo falso ────────────────────────────────────────────────────────────────────
// Jogadores 1 e 2 aliados, 3 inimigo dos dois. Gaia (0) só tem uma galinha.
const IID = { Player: 1, Diplomacy: 2, TechnologyManager: 3, StatisticsTracker: 4,
	RangeManager: 5, PlayerManager: 6, Identity: 7, UnitAI: 8, Ownership: 9, Health: 10, Position: 11 };
const SYSTEM_ENTITY = 1;
const P = (x, z) => ({ x, z });
const ENTS = [
	// id, dono, template, classes, ordem, posição, vida
	[100, 1, "units/athen/support_female_citizen", ["Unit", "Support", "Worker"], { type: "Gather", data: { type: { generic: "food" } } }, P(10, 10)],
	[101, 1, "units/athen/support_female_citizen", ["Unit", "Support", "Worker"], { type: "Gather", data: { type: { generic: "wood" } } }, P(12, 10)],
	[102, 1, "units/athen/infantry_spearman_b", ["Unit", "CitizenSoldier", "Infantry", "Melee"], { type: "Attack", data: { target: 300 } }, P(100, 100)],
	[103, 1, "units/athen/infantry_javelineer_b", ["Unit", "CitizenSoldier", "Infantry", "Ranged"], { type: "Attack", data: { target: 900 } }, P(50, 50)],   // caça: não é combate
	[104, 1, "units/athen/cavalry_swordsman_b", ["Unit", "CitizenSoldier", "Cavalry", "FastMoving", "Melee"], { type: "Gather", data: { type: { generic: "food" } } }, P(60, 60)],
	[105, 1, "units/athen/champion_ranged", ["Unit", "Champion", "Infantry", "Ranged"], null, P(0, 0)],
	[106, 1, "structures/athen/civil_centre", ["Structure", "CivCentre"], null, P(0, 0)],
	[200, 2, "units/brit/infantry_slinger_b", ["Unit", "CitizenSoldier", "Infantry", "Ranged"], { type: "WalkAndFight", data: { target: 301 } }, P(400, 400)],
	[201, 2, "units/brit/siege_ram", ["Unit", "Siege", "Melee"], { type: "Gather", data: { type: { generic: "metal" } } }, P(1, 1)],
	[300, 3, "units/pers/infantry_archer_b", ["Unit", "CitizenSoldier", "Infantry", "Ranged"], { type: "Attack", data: { target: 201 } }, P(101, 101)],
	[301, 3, "units/pers/cavalry_archer_b", ["Unit", "CitizenSoldier", "Cavalry", "FastMoving", "Ranged"], { type: "Attack", data: { target: 999 } }, P(401, 401)],  // alvo morto
	[302, 3, "units/pers/support_female_citizen", ["Unit", "Support", "Worker"], { type: "Gather", data: { type: { generic: "stone" } } }, P(5, 5)],
	[900, 0, "gaia/fauna_chicken", ["Unit"], null, P(51, 51)],
	[999, 2, "units/brit/infantry_spearman_b", ["Unit", "CitizenSoldier", "Infantry"], null, P(402, 402), 0]
];
const porId = new Map(ENTS.map(e => [e[0], e]));

function mundo(sim) {
	const inimigos = { 1: [3], 2: [3], 3: [1, 2] };
	const aliados = { 1: [1, 2], 2: [1, 2], 3: [3] };
	const pesquisas = { 1: new Set(["gather_wicker_baskets", "attack_soldiers_will", "phase_town"]), 2: new Set(), 3: new Set(["barracks_batch_training"]) };
	function contagens(p) {
		const cc = {}, tc = {};
		for (const e of ENTS) {
			if (e[1] !== p) continue;
			for (const cl of e[3]) {
				cc[cl] = (cc[cl] || 0) + 1;
				tc[cl] = tc[cl] || {};
				tc[cl][e[2]] = (tc[cl][e[2]] || 0) + 1;
			}
		}
		return { cc, tc };
	}
	function playerIface(p, iid) {
		if (p < 1 || p > 3) return null;
		if (iid === IID.Player) return {
			GetColor: () => ({ r: p / 10, g: 0, b: 0 }), IsActive: () => true,
			GetPopulationCount: () => 10 * p, GetPopulationLimit: () => 20 * p, GetMaxPopulation: () => 300,
			GetResourceCounts: () => ({ food: 100 * p, wood: 50, stone: 0, metal: 5 })
		};
		if (iid === IID.Diplomacy) return {
			GetTeam: () => (p === 3 ? 2 : 1),
			IsMutualAlly: q => aliados[p].indexOf(q) >= 0,
			GetEnemies: () => inimigos[p].slice()
		};
		if (iid === IID.TechnologyManager) {
			const { cc, tc } = contagens(p);
			return {
				GetResearchedTechs: () => pesquisas[p],
				IsTechnologyResearched: t => pesquisas[p].has(t),
				IsTechnologyQueued: t => p === 2 && t === "phase_town",
				GetClassCounts: () => cc,
				GetTypeCountsByClass: () => tc
			};
		}
		if (iid === IID.StatisticsTracker) return { enemyUnitsKilled: { Unit: p, Infantry: 7 }, unitsLost: { Unit: 2 } };
		return null;
	}
	function entIface(id, iid) {
		if (id === SYSTEM_ENTITY) {
			if (iid === IID.PlayerManager) return { GetNumPlayers: () => 4 };
			if (iid === IID.RangeManager) return { GetEntitiesByPlayer: p => ENTS.filter(e => e[1] === p).map(e => e[0]) };
			return null;
		}
		const e = porId.get(id);
		if (!e) return null;
		if (iid === IID.Identity) return { HasClass: c => e[3].indexOf(c) >= 0 };
		if (iid === IID.UnitAI) return e[3].indexOf("Unit") >= 0 ? { orderQueue: e[4] ? [e[4]] : [] } : null;
		if (iid === IID.Ownership) return { GetOwner: () => e[1] };
		if (iid === IID.Health) return { GetHitpoints: () => (e[6] === undefined ? 100 : e[6]) };
		if (iid === IID.Position) return { IsInWorld: () => true, GetPosition2D: () => ({ x: e[5].x, y: e[5].z }) };
		return null;
	}
	const ctx = {
		GuiInterface: function() {}, SYSTEM_ENTITY,
		Engine: { QueryInterface: entIface },
		QueryPlayerIDInterface: (p, iid) => playerIface(p, iid === undefined ? IID.Player : iid),
		Map, Set
	};
	for (const k in IID) ctx["IID_" + k] = IID[k];
	ctx.GuiInterface.prototype = {};
	vm.createContext(ctx);
	vm.runInContext(extrair(sim), ctx);
	return ctx.GuiInterface.prototype.pudim_GetAllyStats;
}

const fAntiga = mundo(antigo), fNova = mundo(novo);
const casos = [
	["jogando como 1", 1, {}],
	["jogando como 3", 3, {}],
	["observador seguindo o 1", 1, { todos: true }],
	["observador sem jogador", -1, {}]
];
console.log("barra de aliados: passada unica = resultado de antes");
for (const [nome, p, args] of casos) {
	const a = JSON.stringify(fAntiga(p, args)), n = JSON.stringify(fNova(p, args));
	check(nome + ": mesma resposta", a === n, "\n    antes: " + a + "\n    agora: " + n);
}

// Os números em si, para ninguém "consertar" os dois lados juntos.
const eu = fNova(1, {}).find(s => s.id === 1);
check("coletores do jogador 1: 2 comida (mulher + cavalo), 1 madeira",
	eu.gatherers.food === 2 && eu.gatherers.wood === 1, JSON.stringify(eu.gatherers));
check("infantaria conta só cidadão-soldado a pé (lanceiro e dardeiro)", eu.infantry === 2, eu.infantry);
check("cavalaria 1, campeão 1, apoio 2, à distância 2",
	eu.cavalry === 1 && eu.champion === 1 && eu.support === 2 && eu.ranged === 2, JSON.stringify(eu));
check("caçar galinha não é combate, mas atacar o inimigo é", eu.inCombat === true && eu.combatSize === 1);
check("melhorias: 1 eco, 1 militar (fase não conta)", eu.upgEco === 1 && eu.upgMil === 1);
const aliado = fNova(1, {}).find(s => s.id === 2);
check("o aliado que só APANHA também está em combate (aríete atacado)", aliado.inCombat === true);

// Chamada repetida devolve o mesmo — o cache de melhorias não pode derivar.
check("segunda chamada igual à primeira (cache de melhorias estável)",
	JSON.stringify(fNova(1, {})) === JSON.stringify(fNova(1, {})));

// ── O código ─────────────────────────────────────────────────────────────────────────
const execS = novo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const corpo = execS.slice(execS.indexOf("pudim_GetAllyStats = function"));
const fim = corpo.indexOf("\n};");
const fn = corpo.slice(0, fim);
check("GetEntitiesByPlayer aparece UMA vez só na função", (fn.match(/GetEntitiesByPlayer/g) || []).length === 1);
check("nenhum HasClass por entidade", !/HasClass\(/.test(fn));
check("tipos de unidade vêm de GetClassCounts", /GetClassCounts\(\)/.test(fn));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
