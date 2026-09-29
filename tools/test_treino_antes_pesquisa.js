/**
 * Unidade antes de pesquisa por pontuação (28/09).
 *
 * Relato: "tá ficando uns segundos parados sem fazer unidades". Log 20260928-221547: a
 * auto-pesquisa mandou arado, servants e wedgemallet, e os quartéis ficaram "parado: sem
 * recurso (lanceiro pede 50F 50W)". Roda pudim_ReservaParaTreino num mundo falso.
 *
 * Rodar:  node tools/test_treino_antes_pesquisa.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("treino antes da pesquisa por pontuacao");

const a = panel.indexOf("function pudim_ReservaParaTreino()");
const b = panel.indexOf("function pudim_ProcessAutoResearch()");
const w = { pop: 85, limite: 100, vivos: { 311: 6, 6257: 6, 999: 2 } };
const ctx = {
	Math,
	g_PudimQueueSeededTpl: {
		311: "units/gaul/infantry_spearman_b",
		6257: "units/gaul/infantry_spearman_b",
		425: "units/gaul/support_female_citizen",   // CC destruído
		999: "units/gaul/infantry_spearman_b"        // capturado: é de outro jogador
	},
	GetSimState: () => ({ players: { 6: { popCount: w.pop, popLimit: w.limite } } }),
	GetEntityState: e => (w.vivos[e] ? { player: w.vivos[e] } : null),
	GetTemplateData: t => ({ cost: /spearman/.test(t) ? { food: 50, wood: 50, population: 1, time: 10 } : { food: 50 } }),
	Engine: { GetPlayerID: () => 6 }
};
vm.createContext(ctx);
vm.runInContext(panel.slice(a, b) + "\nthis.r = pudim_ReservaParaTreino; this.s = pudim_SomaCustos;", ctx);

let r = ctx.r();
check("uma unidade por edifício vivo e seu: 2 lanceiros = 100F 100W", r.food === 100 && r.wood === 100, JSON.stringify(r));
check("population e time do template não viram recurso", r.population === undefined && r.time === undefined);
w.pop = 100;
r = ctx.r();
check("população no teto: não há treino possível, a reserva some", Object.keys(r).length === 0, JSON.stringify(r));
const s = ctx.s({ food: 500, wood: 500 }, { food: 100, metal: 40 });
check("soma com o que já estava guardado (fase, cerco, cadeia)", s.food === 600 && s.wood === 500 && s.metal === 40);

check("a auto-pesquisa recebe a soma como reserva",
	/reserva: pudim_SomaCustos\(g_PudimGuardado\.total, pudim_ReservaParaTreino\(\)\),/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
