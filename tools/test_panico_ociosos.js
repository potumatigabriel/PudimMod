/**
 * Ociosos voltam ao trabalho com a base calma, mesmo com batalha longe (28/09).
 *
 * Log 20260928-211137: "batalha em curso — segurando as unidades abrigadas" e ocio=39,
 * coleta F0 W2 por mais de um minuto. O pânico total travava o Auto-Trabalho enquanto
 * qualquer unidade nossa atacava em qualquer lugar.
 *
 * Rodar:  node tools/test_panico_ociosos.js
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
console.log("panico: ociosos com a base calma");

const a = panel.indexOf("function pudim_AutoTrabalhoLiberado(agora)");
const b = panel.indexOf("\n}", a) + 2;
const ctx = { g_PudimPanicFull: false, g_PudimBaseCalmaDesde: 0, pudim_CalmaExigida: () => 6000 };
vm.createContext(ctx);
vm.runInContext(panel.slice(a, b) + "\nthis.f = pudim_AutoTrabalhoLiberado;", ctx);
check("sem pânico total: roda", ctx.f(100000) === true);
ctx.g_PudimPanicFull = true;
check("pânico total com inimigo na base: parado", ctx.f(100000) === false);
ctx.g_PudimBaseCalmaDesde = 97000;
check("base calma há 3s (exige 6s): ainda parado", ctx.f(100000) === false);
check("base calma há 7s: volta, mesmo com o exército lutando longe", ctx.f(104000) === true);
ctx.pudim_CalmaExigida = () => 20000;
check("contra cavalaria a calma exigida é a longa", ctx.f(104000) === false);

check("a calma da base é medida pelo underAttack da simulação",
	/if \(panicData\.underAttack\) g_PudimBaseCalmaDesde = 0;\s*\n\s*else if \(!g_PudimBaseCalmaDesde\) g_PudimBaseCalmaDesde = now;/.test(panel));
check("o tique usa a liberação no lugar do !g_PudimPanicFull",
	/g_PudimInitialBalanceDone &&\s*\n\s*pudim_AutoTrabalhoLiberado\(Date\.now\(\)\)\)/.test(panel));
check("abrigado continua fora do Auto-Trabalho (a simulação pula isGarrisoned)",
	/cmpUnitAI\.isGarrisoned\)\s*\n\s*continue;/.test(sim));
check("e a soltura dos abrigados continua travada na batalha",
	/if \(!manual && g_PudimEmCombate\) \{/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
