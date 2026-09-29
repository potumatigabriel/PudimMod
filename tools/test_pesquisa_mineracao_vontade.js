/**
 * Auto-pesquisa: mineração só com mineradores; Vontade de Lutar na fortaleza (28/09).
 *
 * Replays de 28/09: o mod fez 4 a 6 techs de mineração por partida, algumas com "colet S0 M0";
 * os melhores, 2 a 3. E os três melhores pesquisaram attack_soldiers_will (fortaleza) perto
 * dos 15 min; o mod nunca, porque a fortaleza não estava entre os edifícios pesquisados.
 *
 * Rodar:  node tools/test_pesquisa_mineracao_vontade.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8").split("\r\n").join("\n");
const i = sim.indexOf("GuiInterface.prototype.pudim_GetAutoResearchData");
const corpo = sim.slice(i, sim.indexOf("\n};", i));

let fails = 0;
function check(name, cond) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++; console.log("  FAIL " + name);
}
console.log("pesquisa: mineracao e vontade de lutar");

check("conta mineradores pela primeira ordem (pedra/metal)",
	/const mineradores = \{ stone: 0, metal: 0 \};/.test(corpo) && /mineradores\[g\]\+\+;/.test(corpo));
check("na Fase 2, tech só de pedra/metal exige PUDIM_MINERADORES_MIN mineradores",
	/if \(!isPhase2\) return false;\s*\n\s*for \(const r of resSet\)\s*\n\s*if \(\(r === "stone" \|\| r === "metal"\) && \(mineradores\[r\] \|\| 0\) >= PUDIM_MINERADORES_MIN\)/.test(corpo));
check("com peso seu em pedra/metal continua liberada antes (regra antiga)",
	/if \(resSet\.has\("stone"\) && wStone > 0\) return true;/.test(corpo));
check("PUDIM_MINERADORES_MIN = 5", /const PUDIM_MINERADORES_MIN = 5;/.test(sim));
check("mineradores é contado antes de allowedInPhase",
	corpo.indexOf("const mineradores") > 0 && corpo.indexOf("const mineradores") < corpo.indexOf("const allowedInPhase"));

check("fortaleza entra na lista de edifícios", /"Blacksmith", "Fortress"\]/.test(corpo));
check("mas só com attack_soldiers_will",
	/const PUDIM_FORTALEZA_TECHS = new Set\(\["attack_soldiers_will"\]\);/.test(corpo) &&
	/if \(cmpIdentR\.HasClass\("Fortress"\) && !PUDIM_FORTALEZA_TECHS\.has\(tech\)\) continue;/.test(corpo));
check("com nota abaixo das da forja (52 < 55 < 60)", /if \(PUDIM_FORTALEZA_TECHS\.has\(tech\)\) return 52;/.test(corpo) &&
	corpo.indexOf("return 52;") < corpo.indexOf("return 60;"));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
