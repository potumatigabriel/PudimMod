/**
 * Nenhum trabalhador é mandado para zona de perigo (29/09).
 *
 * Pedido: "os aldeões não podem ser mandados perto de regiões perigosas, se tem inimigos, tem
 * que evitar região de perigo de ataque". Replay 2026-09-29_0005: de 7:24 a 9:03 a rotina de
 * armazém mandou 3 aldeões à obra 2137 a cada 3-6s com inimigo em volta; mortes de 6 a 28.
 *
 * Rodar:  node tools/test_zonas_perigo.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("zonas de perigo");

// ── 1. A simulação: zonas só do que o jogador vê ───────────────────────────────────────
{
	const i = sim.indexOf("const PUDIM_PERIGO_FOLGA");
	const j = sim.indexOf("GuiInterface.prototype.pudim_GetZonasDePerigo");
	const k = sim.indexOf("\n};", j) + 3;
	const IID = { RangeManager: 1, PlayerManager: 2, Diplomacy: 3, Identity: 4, Attack: 5, Position: 6,
		UnitMotion: 7, Foundation: 8, Mirage: 9, UnitAI: 10 };
	const ents = {
		// inimigo (jogador 2): lanceiro visível, arqueiro na névoa, torre na névoa, casa sem ataque
		50: { dono: 2, x: 100, z: 100, alc: 4, vel: 9, vis: "visible" },
		51: { dono: 2, x: 300, z: 300, alc: 60, vis: "fogged" },
		52: { dono: 2, x: 500, z: 100, alc: 76, predio: true, vis: "fogged" },
		53: { dono: 2, x: 600, z: 100, predio: true, vis: "visible" },
		// nosso CC
		10: { dono: 1, x: 0, z: 0, cc: true, predio: true, vis: "visible" },
		// Gaia perto do CC: lobo agressivo e veado passivo (sem ataque)
		90: { dono: 0, x: 40, z: 0, alc: 3, vel: 10, vis: "visible", stance: "aggressive" },
		91: { dono: 0, x: 60, z: 0, alc: 3, vel: 10, vis: "visible", stance: "passive" }
	};
	const comp = (e, iid) => {
		if (e === 0) {
			if (iid === IID.RangeManager) return {
				GetEntitiesByPlayer: p => Object.keys(ents).map(Number).filter(k => ents[k].dono === p),
				GetLosVisibility: (en) => ents[en].vis,
				ExecuteQueryAroundPos: (pos, a, b, players) => Object.keys(ents).map(Number).filter(k =>
					players.indexOf(ents[k].dono) >= 0 && ents[k].alc && Math.hypot(ents[k].x - pos.x, ents[k].z - pos.y) <= b)
			};
			if (iid === IID.PlayerManager) return { GetPlayerByID: p => 1000 + p };
			return null;
		}
		if (e >= 1000) return iid === IID.Diplomacy ? { GetEnemies: () => [0, 2] } : null;
		const o = ents[e]; if (!o) return null;
		switch (iid) {
		case IID.Identity: return { HasClass: c => (c === "Structure" && !!o.predio) || (c === "CivCentre" && !!o.cc) };
		case IID.Attack: return o.alc ? { GetFullAttackRange: () => ({ max: o.alc }) } : null;
		case IID.Position: return { IsInWorld: () => true, GetPosition2D: () => ({ x: o.x, y: o.z }) };
		case IID.UnitMotion: return o.vel ? { GetWalkSpeed: () => o.vel } : null;
		case IID.UnitAI: return o.stance ? { GetStanceName: () => o.stance } : null;
		}
		return null;
	};
	const ctx = { Math, Engine: { QueryInterface: comp }, SYSTEM_ENTITY: 0, GuiInterface: function() {} };
	for (const n in IID) ctx["IID_" + n] = IID[n];
	vm.createContext(ctx);
	vm.runInContext("GuiInterface.prototype = {};\n" + sim.slice(i, k) +
		"\nthis.f = GuiInterface.prototype.pudim_GetZonasDePerigo;", ctx);
	const z = ctx.f(1, {}).zonas;
	const em = (x, y) => z.find(q => q.x === x && q.z === y);
	check("lanceiro visível: alcance 4 + 2s × 9 + folga 8 = 30m", em(100, 100) && em(100, 100).r === 30, JSON.stringify(z));
	check("arqueiro só na névoa: NÃO entra (nada da névoa é revelado)", !em(300, 300));
	check("torre na névoa: entra (prédio não anda e você já viu)", em(500, 100) && em(500, 100).r === 84);
	check("casa sem ataque: não é perigo", !em(600, 100));
	check("lobo agressivo perto do CC: perigo; veado passivo: não", !!em(40, 0) && !em(60, 0));
}

// ── 2. O árbitro barra trabalho com destino na zona ────────────────────────────────────
{
	const a = panel.indexOf("const PUDIM_TIPOS_DE_UNIDADE");
	const b = panel.indexOf("function pudim_MarkDispatched(");
	const w = { enviados: [], logs: [] };
	const ctx = {
		Date, Math, Set,
		g_PudimPlayerOrders: {},
		pudim_Log: (l, c, m) => w.logs.push(m),
		GetEntityState: e => (e === 2137 ? { position: { x: 105, y: 0, z: 100 } } : e === 700 ? { position: { x: 400, y: 0, z: 400 } } : null),
		Engine: { PostNetworkCommand: c => w.enviados.push(c) }
	};
	vm.createContext(ctx);
	vm.runInContext(panel.slice(a, b) + "\nthis.ordenar = pudim_Ordenar; this.set = z => { g_PudimZonasPerigo = z; };", ctx);
	ctx.set([{ x: 100, z: 100, r: 30 }]);
	check("reparar obra dentro da zona (a 2137 do replay): barrado",
		ctx.ordenar({ type: "repair", entities: [1, 2, 3], target: 2137 }, "pudim_ProcessDropsiteFoundations") === false &&
		w.enviados.length === 0 && /ordem barrada/.test(w.logs[0] || ""));
	check("construir casa dentro da zona: barrado",
		ctx.ordenar({ type: "construct", entities: [4], x: 110, z: 95, template: "h" }, "pudim_RunAutoWork:construct") === false);
	check("coletar fora da zona: passa", ctx.ordenar({ type: "gather", entities: [5], target: 700 }, "pudim_RunAutoWork") === true);
	check("abrigar (defesa) dentro da zona: passa",
		ctx.ordenar({ type: "garrison", entities: [6], target: 2137 }, "pudim_ProcessPanic") === true);
	check("botão seu (obra na espera) dentro da zona: passa",
		ctx.ordenar({ type: "construct", entities: [7], x: 100, z: 100, template: "h" }, "pudim_ProcessObrasEspera") === true);
}

// ── 3. As peças ligadas ────────────────────────────────────────────────────────────────
check("o painel relê o mapa a cada 1s", /pudim_Medir\("AtualizarPerigo", pudim_AtualizarPerigo\)/.test(panel) &&
	/const PUDIM_PERIGO_INTERVALO = 1000;/.test(panel));
check("o Auto-Trabalho recebe o mapa", /"perigo": g_PudimZonasPerigo,/.test(panel));
check("e descarta recurso e campo dentro da zona",
	/if \(!isSafe \|\| emPerigo\(resPos\.x, resPos\.y\)\) continue;/.test(sim) &&
	/if \(emPerigo\(resPos\.x, resPos\.y\)\) continue;   \/\/ campo sob ataque/.test(sim));
check("a volta automática do pânico deixa abrigado quem voltaria para o perigo",
	/if \(!manual && g_PudimZonasPerigo\.length\) \{/.test(panel) && /if \(ficam\[entId\]\) continue;/.test(panel));
check("a função está exposta à interface", /"pudim_GetZonasDePerigo": 1,/.test(sim));
check("o SNAP mostra quantas ordens o perigo barrou", /" per" \+ \(g_PudimArbitro\.perigo \|\| 0\)/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
