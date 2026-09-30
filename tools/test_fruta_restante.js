/**
 * Campos: a fruta que SOBRA decide, não as vagas do arbusto (29/09).
 *
 * Replays 2026-09-29_0005 e _0006: nenhum campo feito pelo mod. Log: "nfc=13 ncap=104 ...
 * reason=nodeficit" — 13 arbustos × 8 vagas contados como 104 trabalhadores de comida cobertos,
 * com a fruta acabando; a comida travou quartel e CC.
 *
 * Rodar:  node tools/test_fruta_restante.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8").split("\r\n").join("\n");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8").split("\r\n").join("\n");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("fruta restante decide os campos");

const TAXA = +(/const PUDIM_FRUTA_TAXA = ([\d.]+);/.exec(sim) || [])[1];
const HOR = +(/const PUDIM_FRUTA_HORIZONTE = (\d+);/.exec(sim) || [])[1];
check("constantes no código (taxa 1/s, horizonte 120s)", TAXA === 1 && HOR === 120, TAXA + " " + HOR);

// A mesma conta do código: min(vagas, restante / (taxa × horizonte)), e o alvo de campo é o
// que a fruta não cobre.
const cap = (vagas, restante) => Math.min(vagas, Math.floor(restante / (TAXA * HOR)));
const alvoCampo = (desejados, vagas, restante) => Math.max(0, desejados - cap(vagas, restante));
check("0006: 13 arbustos cheios (2600): cobrem 21, com 20 desejados ainda não precisa de campo",
	alvoCampo(20, 104, 2600) === 0);
check("com metade da fruta (1300): cobre 10 — campos para os outros 10, ANTES de acabar",
	alvoCampo(20, 104, 1300) === 10, alvoCampo(20, 104, 1300));
check("com 300 de fruta sobrando: praticamente tudo vira campo", alvoCampo(20, 104, 300) === 18);
check("como era (só as vagas): 104 cobria tudo até a última baga", Math.max(0, 20 - 104) === 0);
check("e as vagas continuam sendo teto (4 arbustos cheios = 32 vagas, 800 de fruta)", cap(32, 5000) === 32);

check("a soma da fruta restante vem de ResourceSupply.GetCurrentAmount, dos arbustos contados",
	/naturalFoodCount\+\+;\s*\n\s*frutaRestante \+= rs\.GetCurrentAmount\(\);/.test(sim));
check("e a capacidade é o menor dos dois",
	/naturalFoodCapacity = Math\.min\(naturalFoodCapacity, capPelaFruta\);/.test(sim));
check("antes do cálculo do alvo de campo",
	sim.indexOf("naturalFoodCapacity = Math.min(naturalFoodCapacity, capPelaFruta);") <
	sim.indexOf("Math.max(0, desiredFoodWorkers - naturalFoodCapacity)"));
check("o log FARM mostra fruta e capf", /" fruta=" \+ \(d\.fruta\|\|0\) \+ " capf=" \+ \(d\.capf\|\|0\)/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
