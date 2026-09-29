/**
 * Herói: posição SEM RISCO que cobre com a aura o MÁXIMO de tropa lutando (29/09).
 *
 * Relatos: "o herói tem que ficar perto das unidades que estão lutando, pra fornecer aura...
 * ele agora anda sempre fugindo pra longe" e "ele tem que ficar em posição sem risco, mas que
 * forneça aura a uma maior quantidade possível de unidades". Roda pudim_GetHeroAuraData num
 * motor falso, com o MatchesClassList copiado do motor (globalscripts/Templates.js).
 *
 * Rodar:  node tools/test_heroi_aura.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8").split("\r\n").join("\n");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("heroi: aura sem risco, cobrindo o maximo");

const i = sim.indexOf("const PUDIM_HEROI_FOLGA_AURA");
const j = sim.indexOf("GuiInterface.prototype.pudim_GetAutoKiteData");
check("a função foi encontrada", i > 0 && j > i);

// Cópia fiel de globalscripts/Templates.js (A28).
const MATCHES = `function MatchesClassList(classes, match) {
	if (!match || !classes) return undefined;
	if (typeof match === "string") match = match.split(/\\s+/);
	for (let sublist of match) {
		if (typeof sublist === "string") sublist = sublist.split(/[+\\s]+/);
		if (sublist.every(c => (c[0] === "!" && classes.indexOf(c.substr(1)) === -1) ||
		                       (c[0] !== "!" && classes.indexOf(c) !== -1))) return true;
	}
	return false;
}`;

function mundo(cfg) {
	const IID = { RangeManager: 1, PlayerManager: 2, Diplomacy: 3, Identity: 4, UnitAI: 5, Position: 6,
		Auras: 7, Attack: 8, UnitMotion: 9, Health: 10 };
	const ents = {};
	let prox = 100;
	const add = (o) => { const id = prox++; ents[id] = o; return id; };
	const heroi = add({ dono: 1, classes: ["Hero", "Soldier", "Human"], x: cfg.heroi[0], z: cfg.heroi[1], passivo: true, heroi: true });
	for (const [x, z] of cfg.nossos) add({ dono: 1, classes: ["Soldier", "Infantry", "Human"], x, z, atacando: true });
	for (const e of cfg.inimigos) add({ dono: 2, classes: ["Soldier"], x: e[0], z: e[1], alcance: e[2], vel: 9 });
	const comp = (ent, iid) => {
		if (ent === 0) {   // SYSTEM_ENTITY
			if (iid === IID.RangeManager) return {
				GetEntitiesByPlayer: p => Object.keys(ents).map(Number).filter(k => ents[k].dono === p),
				ExecuteQueryAroundPos: (pos, min, max, players) => Object.keys(ents).map(Number).filter(k => {
					const e = ents[k]; if (players.indexOf(e.dono) < 0 || !e.alcance) return false;
					const d = Math.hypot(e.x - pos.x, e.z - pos.y); return d >= min && d <= max; })
			};
			if (iid === IID.PlayerManager) return { GetPlayerByID: p => 1000 + p };
			return null;
		}
		if (ent >= 1000) return iid === IID.Diplomacy ? { GetEnemies: () => [0, 2] } : null;
		const e = ents[ent]; if (!e) return null;
		switch (iid) {
		case IID.Identity: return { HasClass: c => e.classes.indexOf(c) >= 0, GetClassesList: () => e.classes };
		case IID.UnitAI: return { GetStanceName: () => (e.passivo ? "passive" : "aggressive"),
			orderQueue: e.atacando ? [{ type: "Attack" }] : [] };
		case IID.Position: return { IsInWorld: () => true, GetPosition2D: () => ({ x: e.x, y: e.z }) };
		case IID.Auras: return e.heroi ? { GetAuraNames: () => ["a"], IsRangeAura: () => true, GetRange: () => 60,
			GetClasses: () => ["Soldier"] } : null;
		case IID.Attack: return e.alcance ? { GetFullAttackRange: () => ({ max: e.alcance }) } : null;
		case IID.UnitMotion: return e.vel ? { GetWalkSpeed: () => e.vel } : null;
		case IID.Health: return { GetHitpoints: () => 100, GetMaxHitpoints: () => 100 };
		}
		return null;
	};
	const ctx = { Math, Engine: { QueryInterface: comp }, SYSTEM_ENTITY: 0, GuiInterface: function() {} };
	for (const k in IID) ctx["IID_" + k] = IID[k];
	vm.createContext(ctx);
	vm.runInContext(MATCHES + "\nGuiInterface.prototype = {};\n" + sim.slice(i, j) +
		"\nthis.f = GuiInterface.prototype.pudim_GetHeroAuraData;", ctx);
	return { r: ctx.f(1, { playerOrdered: {} }), heroi };
}
const dist = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);

// Frente grande: 10 soldados em volta de (100,100); frente pequena: 2 em (260,100).
const grande = []; for (let k = 0; k < 10; k++) grande.push([95 + k, 100]);
const pequena = [[260, 100], [262, 100]];
// Inimigos NO MEIO da frente grande: lanceiro (4) e dois arqueiros (60) logo atrás dele.
const inimigos = [[100, 108, 4], [100, 130, 60], [104, 130, 60]];

{
	const { r } = mundo({ heroi: [100, -80], nossos: grande.concat(pequena), inimigos });
	check("com inimigo no meio da luta, ainda acha ponto seguro (não 'recua')", r.action === "posicionar",
		JSON.stringify(r));
	const p = [r.x, r.z];
	check("o ponto está fora do alcance dos arqueiros (+ folga)", dist(p, [100, 130]) > 60 && dist(p, [104, 130]) > 60,
		p.map(Math.round).join(","));
	const cobreGrande = grande.filter(u => dist(u, p) <= 54).length;
	check("e cobre a frente GRANDE (10), não a pequena (2)", cobreGrande >= 8 && r._dbg.cobre >= 8,
		"cobre=" + r._dbg.cobre + " grande=" + cobreGrande);
}
{
	// Parado num ponto seguro que já cobre a frente grande: não mexe.
	const { r } = mundo({ heroi: [100, 55], nossos: grande.concat(pequena), inimigos });
	check("já seguro e cobrindo quase o máximo: fica onde está", r.action === "none" &&
		r._dbg.reason === "ja_cobre_e_seguro", JSON.stringify(r._dbg));
}
{
	// Arqueiros cercando por todos os lados: nenhum ponto seguro cobre ninguém.
	const cerco = [];
	for (let k = 0; k < 12; k++) {
		const a = k * Math.PI / 6;
		cerco.push([100 + Math.cos(a) * 40, 100 + Math.sin(a) * 40, 60]);
	}
	const { r } = mundo({ heroi: [100, -80], nossos: grande, inimigos: cerco });
	check("cercado por arqueiros: nenhum ponto sem risco — fica fora", r.action === "recuar", JSON.stringify(r._dbg));
}
check("sem o modo 'com risco' (pedido: sempre sem risco)", !/comRisco|VIDA_ARRISCAR/.test(sim));
check("classes da aura pelo MatchesClassList do motor", /MatchesClassList\(u\.classes, afeta\)/.test(sim) &&
	/MatchesClassList\(u\.classes, classesAura\)/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
