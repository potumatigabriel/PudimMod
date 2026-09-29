/**
 * Estimador: inimigo VISÍVEL a caminho entra numa segunda chance (28/09).
 *
 * Log 211137 (replay 0007): "eles 25u ... chance 94%" e, no minuto seguinte, 87 perdas contra
 * 27 mortes. A estimativa só olhava 80m em volta do exército.
 *
 * Rodar:  node tools/test_estimador_a_caminho.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++; console.log("  FAIL " + name);
}
console.log("estimador: inimigo a caminho");

check("consulta o anel de 80 a 200m", /ExecuteQueryAroundPos\(\{ "x": cx2, "y": cy2 \}, 80, 200,/.test(sim));
check("só conta o que você VÊ (nada da névoa)",
	/if \(cmpRangeManager\.GetLosVisibility\(ent, player\) !== "visible"\) continue;/.test(sim));
check("só militares (soldado, herói, cerco), sem repetir quem já está nos 80m",
	/HasClass\("Soldier"\) \|\| idX\.HasClass\("Hero"\) \|\| idX\.HasClass\("Siege"\)/.test(sim) &&
	/if \(jaContados\.has\(ent\)\) continue;/.test(sim));
check("os de longe não entram no total da luta atual (bucket à parte)",
	/if \(collectStats\(ent, bucketExtra\)\) extra\.push\(ent\);/.test(sim));
check("a chance total nunca é maior que a da luta atual",
	/Math\.min\(result\.winChance, result\.winChanceTotal\)/.test(sim));
check("e é calculada depois da winChance",
	sim.indexOf("result.winChanceTotal = result.winChanceTotal === null") >
	sim.indexOf("result.winChance = Math.max(1, Math.min(99, Math.round(100 * tKillUs"));

check("o painel mostra '+N a caminho: X%'", /"\+" \+ aCaminho\.count \+ " a caminho: " \+ chanceCor \+ "%/.test(panel));
check("a cor e a barra usam a chance com os que vêm", /wanted = chanceCor >= 60/.test(panel) &&
	/totalWidth \* chanceCor \/ 100/.test(panel));
check("o log ESTIM registra os dois números", /"u a caminho \(hp" \+ data\.aCaminho\.totalHP/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
