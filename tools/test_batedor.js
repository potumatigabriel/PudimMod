/**
 * Batedor que não morre (28/09).
 *
 * Pedido: "o auto scout do cavalo, o que explora recursos em volta da base e o modo batedor
 * que procura bases inimigas, e explorar a base deles, mas sem se expor, e sempre evitando
 * ser morto"; "tratar quem corre como mais perigoso"; "fugir até a cavalaria inimiga sumir do
 * radar". Roda a detecção de perigo (simulação) e a rota de fuga (painel) de verdade.
 *
 * Rodar:  node tools/test_batedor.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const sess = norm(fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("batedor");

// ── 1. Detecção de perigo, rodando pudim_GetScoutStatus ──────────────────────────────
function status(ents) {
	const IID = { Terrain: 1, RangeManager: 2, Identity: 3, Position: 4, PlayerManager: 5, Diplomacy: 6,
		UnitAI: 7, Health: 8, Garrisonable: 9, Vision: 10, Attack: 11, Ownership: 12, UnitMotion: 13, Foundation: 14 };
	const E = {};
	for (const e of ents) E[e.id] = e;
	const ctx = {
		Math, GuiInterface: function() {}, SYSTEM_ENTITY: 0,
		Engine: { QueryInterface: (id, iid) => {
			if (id === 0) {
				if (iid === IID.Terrain) return { GetMapSize: () => 1000 };
				if (iid === IID.PlayerManager) return { GetPlayerByID: () => 99 };
				if (iid === IID.RangeManager) return {
					GetEntitiesByPlayer: p => ents.filter(e => e.dono === p).map(e => e.id),
					ExecuteQueryAroundPos: (c, mn, mx, jogadores, iidQ) => ents.filter(e => e.pos && jogadores.indexOf(e.dono) >= 0 &&
						Math.hypot(e.pos[0] - c.x, e.pos[1] - c.y) <= mx && (iidQ !== IID.Attack || e.alcance !== undefined)).map(e => e.id)
				};
			}
			if (id === 99 && iid === IID.Diplomacy) return { GetEnemies: () => [0, 2] };
			const e = E[id]; if (!e) return null;
			if (iid === IID.Identity) return { HasClass: c => (e.classes || []).indexOf(c) >= 0 };
			if (iid === IID.Position) return { IsInWorld: () => !!e.pos, GetPosition2D: () => ({ x: e.pos[0], y: e.pos[1] }) };
			if (iid === IID.UnitAI) return { IsIdle: () => false, orderQueue: [{ type: "Walk" }], GetStanceName: () => e.postura || "" };
			if (iid === IID.Health) return e.hp ? { GetHitpoints: () => e.hp[0], GetMaxHitpoints: () => e.hp[1] } : null;
			if (iid === IID.Garrisonable) return { IsGarrisoned: () => !!e.dentro, HolderID: () => e.dentro };
			if (iid === IID.Vision) return { GetRange: () => 80 };
			if (iid === IID.Attack) return e.alcance !== undefined ? { GetFullAttackRange: () => ({ max: e.alcance }) } : null;
			if (iid === IID.Ownership) return { GetOwner: () => e.dono };
			if (iid === IID.UnitMotion) return e.anda ? { GetWalkSpeed: () => e.anda, GetRunMultiplier: () => 1.4 } : null;
			if (iid === IID.Foundation) return null;
			return null;
		} }
	};
	for (const k in IID) ctx["IID_" + k] = IID[k];
	ctx.GuiInterface.prototype = {};
	const a = sim.indexOf("GuiInterface.prototype.pudim_GetScoutStatus = function");
	const b = sim.indexOf("\n};", a) + 3;
	vm.createContext(ctx);
	vm.runInContext(sim.slice(a, b), ctx);
	return ctx.GuiInterface.prototype.pudim_GetScoutStatus(1, { scouts: { 10: "deep" } });
}
const batedor = { id: 10, dono: 1, pos: [500, 500], hp: [100, 100], classes: ["FastMoving"] };
{
	const r = status([batedor,
		{ id: 20, dono: 2, pos: [540, 500], classes: ["Structure", "House"] },                   // casa: não ataca
		{ id: 21, dono: 2, pos: [560, 500], classes: ["Structure", "CivCentre"], alcance: 60 }]);  // CC a 60
	const s = r.scouts[0];
	check("casa inimiga ao lado NÃO é ameaça; o CC que atira, a 60 com alcance 60+25, é",
		s.inDanger && s.ameacas.length === 1 && s.enemyIsBuilding === true, JSON.stringify(s.ameacas));
	check("o CC dentro da visão (80) entra na memória de bases", s.ccsInimigos.length === 1);
}
{
	// Infantaria a 50, alcance 0, anda 9: 25 + 2×9 = 43 → fora. Cavalaria a 120, anda 18×1,4:
	// 25 + 5×25,2 = 151 → dentro. É o "tratar quem corre como mais perigoso".
	const r = status([batedor,
		{ id: 30, dono: 2, pos: [550, 500], classes: ["Infantry"], alcance: 0, anda: 9 },
		{ id: 31, dono: 2, pos: [620, 500], classes: ["FastMoving"], alcance: 0, anda: 18 }]);
	const s = r.scouts[0];
	check("infantaria a 50 sem alcance: fora da zona (25 + 2 s andando = 43)",
		!s.ameacas.some(a => a.x === 550), JSON.stringify(s.ameacas));
	check("cavalaria a 120: DENTRO da zona (25 + 5 s correndo = 151)", s.ameacas.some(a => a.x === 620 && a.r === 151));
	check("cavalaria a 120 está fora da visão (80): ainda não conta como 'no radar'", s.cavNoRadar === false);
	const r2 = status([batedor, { id: 31, dono: 2, pos: [570, 500], classes: ["FastMoving"], alcance: 0, anda: 18 }]);
	check("cavalaria a 70, dentro da visão: 'no radar' — ele foge até ela sumir", r2.scouts[0].cavNoRadar === true);
}
{
	const r = status([batedor,
		{ id: 40, dono: 0, pos: [520, 500], classes: ["Animal"], alcance: 2, anda: 9 },                       // veado
		{ id: 41, dono: 0, pos: [480, 500], classes: ["Animal"], alcance: 2, anda: 9, postura: "violent" }]); // lobo
	const s = r.scouts[0];
	check("bicho da Gaia só conta se ataca por conta (violent/aggressive)", s.ameacas.length === 1 && s.ameacas[0].x === 480);
}
{
	const r = status([{ id: 10, dono: 1, pos: null, hp: [30, 100], dentro: 77 }]);
	check("guarnecido: o painel recebe a vida e o abrigo, para soltar quando curar",
		r.scouts[0].guarnecido === true && r.scouts[0].abrigo === 77 && Math.abs(r.scouts[0].hpFrac - 0.3) < 1e-9);
}

// ── 2. Rota de fuga, rodando a função do painel ──────────────────────────────────────
{
	const a = sess.indexOf("function pudim_ScoutRotaDeFuga(");
	const b = sess.indexOf("\n}", a) + 2;
	const ctx = { Math };
	vm.createContext(ctx);
	vm.runInContext(sess.slice(a, b) + "\nthis.f = pudim_ScoutRotaDeFuga;", ctx);
	// Dentro da zona de um CC a leste; casa a oeste.
	const info = { ameacas: [{ x: 560, z: 500, r: 85 }], fugaDe: { x: 560, z: 500 }, visao: 80 };
	const f = ctx.f({ x: 500, z: 500 }, info, [{ id: 1, x: 200, z: 500 }], [], 1000);
	check("foge para o lado oposto e termina fora da zona", f.x < 500 && Math.hypot(f.x - 560, f.z - 500) >= 85, JSON.stringify(f));
	// Cercado por duas zonas (leste e oeste): sai por norte/sul, nunca atravessando uma delas.
	const cerco = { ameacas: [{ x: 600, z: 500, r: 130 }, { x: 400, z: 500, r: 130 }], fugaDe: { x: 500, z: 500 }, visao: 80 };
	const g = ctx.f({ x: 500, z: 500 }, cerco, [{ id: 1, x: 150, z: 500 }], [], 1000);
	check("entre duas zonas, sai pelo corredor — mesmo com a casa do outro lado de uma delas",
		Math.abs(g.x - 500) < 80 && Math.abs(g.z - 500) > 100, JSON.stringify(g));
}

// ── 3. O painel ──────────────────────────────────────────────────────────────────────
check("checa a cada 0,6 s (era 2 s)", /const PUDIM_SCOUT_TICK = 600;/.test(sess) &&
	/if \(now - g_LastScoutTick < PUDIM_SCOUT_TICK\) return;/.test(sess));
check("abaixo de 50% de vida entra no abrigo; com 90% sai",
	/const PUDIM_SCOUT_CURAR_ABAIXO = 0\.5;/.test(sess) && /const PUDIM_SCOUT_CURADO = 0\.9;/.test(sess) &&
	/"type": "garrison", "entities": \[ent\], "target": ab\.id/.test(sess) &&
	/"type": "unload", "garrisonHolder": scoutInfo\.abrigo, "entities": \[ent\]/.test(sess));
check("a ordem de guarnecer para curar NÃO desliga o batedor (não é ordem sua)",
	sess.indexOf('if (orderType === "Garrison") continue;') > 0 &&
	sess.indexOf('if (orderType === "Garrison") continue;') < sess.indexOf("// Auto-desativar se o jogador deu um comando manual"));
check("com cavalaria no radar, a fuga continua mesmo sem ameaça no alcance",
	/if \(inDanger \|\| scoutInfo\.cavNoRadar\) \{/.test(sess));
check("só a célula de quem atira fica bloqueada (era 3×3 por qualquer prédio)",
	!/for \(let dc = -1; dc <= 1; dc\+\+\) \{\s*\n\s*for \(let dr = -1; dr <= 1; dr\+\+\) \{\s*\n\s*const nc = tc \+ dc;/.test(sess));
check("lembra de cada CC inimigo e passa à próxima base depois de 10 destinos",
	/const PUDIM_SCOUT_VISITAS_BASE = 10;/.test(sess) && /g_PudimScoutBases\.push\(/.test(sess) &&
	/"enemyBasePos": baseAlvo \? \{ "x": baseAlvo\.x, "z": baseAlvo\.z \} : null,/.test(sess));

// ── 4. A escolha de destino ──────────────────────────────────────────────────────────
check("com base conhecida, procura o ponto MAIS FUNDO seguro que revele algo",
	/if \(!pudimPointSafe\(cx, cz, threats\)\) continue;\s*\n\s*if \(!pudimPathSafe\(scoutX, scoutZ, cx, cz, threats\)\) continue;[^\n]*\n\s*if \(novidade\(cx, cz\) >= 4\)/.test(sim));
check("e a folga da cavalaria vale também ali (5 s correndo)",
	/margem \+= 5 \* anda \* \(cmpMot\.GetRunMultiplier/.test(sim));
check("Explorar Base vai até a fronteira do nosso território",
	/if \(mode !== "deep"\) \{\s*\n\s*for \(let i = 0; i < 16; \+\+i\) \{[\s\S]{0,400}if \(cmpTerritoryManager\.GetOwner\(tx, tz\) !== player\) break;/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
