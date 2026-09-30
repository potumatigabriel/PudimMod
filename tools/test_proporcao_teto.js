/**
 * Pedra/metal pela proporção: no máximo 5, sem escassez; troca de verdade na fazenda (29/09).
 *
 * Print de 29/09: "nem coloquei pedra na lista, e tá mandando coletores" — 18 na pedra, alvo
 * 21, com o fator de escassez 3,02 triplicando o peso 1 que a proporção deu. E "o jogo tá
 * tirando toda hora meus coletores da fazenda" — soldado saía do campo e ninguém entrava.
 *
 * Rodar:  node tools/test_proporcao_teto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("proporcao com teto e troca na fazenda");

// ── 1. A cota, com o código real ──────────────────────────────────────────────────────
const i = sim.indexOf("\t\tconst quotaDe = {};");
const j = sim.indexOf("\t\tresult._bal.prop = Array.from(propRec);");
check("trecho da cota encontrado", i > 0 && j > i);
function cota(pesos, total, prop) {
	const ctx = { Math, Set, PUDIM_COLETA_PROP_MAX: 5, efCota: { pesos: pesos }, activeWeights: Object.keys(pesos),
		totalWeight: Object.values(pesos).reduce((a, b) => a + b, 0), totalWorkers: total, propRec: new Set(prop) };
	vm.createContext(ctx);
	vm.runInContext(sim.slice(i, j) + "\nthis.q = quotaDe;", ctx);
	return ctx.q;
}
// O print: comida 3, madeira 4, pedra 1 (da proporção), 64 trabalhadores.
let q = cota({ food: 3, wood: 4, stone: 1 }, 64, ["stone"]);
check("pedra da proporção: no máximo 5 (era alvo 21)", Math.round(q.stone) === 5, JSON.stringify(q));
check("o resto (59) se divide entre comida e madeira pelos pesos 3:4",
	Math.abs(q.food - 59 * 3 / 7) < 0.01 && Math.abs(q.wood - 59 * 4 / 7) < 0.01);
q = cota({ food: 3, wood: 4, stone: 1 }, 16, ["stone"]);
check("com pouca gente, a pedra fica com a fatia normal (2 de 16), abaixo do teto", Math.abs(q.stone - 2) < 0.01);
q = cota({ food: 3, wood: 4, stone: 2 }, 64, []);
check("pedra que VOCÊ pesou (não da proporção): sem teto", Math.abs(q.stone - 64 * 2 / 9) < 0.01);
check("recurso da proporção usa o peso cru (sem o fator de escassez)",
	/for \(const r of propRec\) efCota\.pesos\[r\] = weights\[r\];/.test(sim));
check("o painel informa quais vieram da proporção", /"proporcaoRec": Object\.keys\(g_PudimColetaPropLigada\),/.test(panel));
check("e mostra '0 +5' em laranja no peso", /" \+" \+ PUDIM_COLETA_PROP_TETO \+ "\[\/color\]"/.test(panel));

// ── 2. A troca na fazenda ─────────────────────────────────────────────────────────────
check("a saída do soldado leva um aldeão de verdade (o mais perto do campo)",
	/const pegarAldeao = function\(fx, fz\)/.test(sim) && /villagerId: aldeao \}\);/.test(sim));
check("com a comida em falta, ninguém sai do campo",
	/const comidaEmFalta = fatorComidaFarm > PUDIM_FAZENDA_TROCA_ESCASSEZ;/.test(sim) &&
	/const PUDIM_FAZENDA_TROCA_ESCASSEZ = 1\.1;/.test(sim));
check("o painel manda o aldeão primeiro; se não sair, o soldado fica",
	/if \(!ev\.villagerId\) continue;\s*\n\s*const entrou = pudim_Ordenar\(\{ "type": "gather", "entities": \[ev\.villagerId\], "target": ev\.farmId,/.test(panel) &&
	/if \(!entrou\) continue;/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
