/**
 * Celeiro não sai quando a fruta já está perto de um ponto de entrega de comida (28/09).
 *
 * Pedido: "só não faz celeiros se as frutas estiverem muito perto de um dropsite". O caminho
 * do armazém inteligente, para comida, só contava CELEIRO e ignorava o CC. Os dois caminhos
 * (esse e o proativo) passam a usar a mesma regra.
 *
 * Rodar:  node tools/test_celeiro_perto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const sim = fs.readFileSync(path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8")
	.split("\r\n").join("\n");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
function corpo(nome) {
	const i = sim.indexOf("GuiInterface.prototype." + nome + " = function");
	return sim.slice(i, sim.indexOf("\n};", i));
}

console.log("celeiro perto de ponto de entrega");
check("uma constante só para a regra, 50", /const PUDIM_FRUTA_PERTO_DE_ENTREGA = 50;/.test(sim));
const smart = corpo("pudim_GetSmartDropsiteData");
check("armazém inteligente: para comida, conta CC E celeiro",
	/if \(bestGroupKey === "food"\) \{\s*\n\s*let entregaComida = Infinity;\s*\n\s*for \(const ds of dropsites\) \{\s*\n\s*if \(!ds\.isCC && !ds\.isFarmstead\) continue;/.test(smart));
check("e desiste com a fruta a até PUDIM_FRUTA_PERTO_DE_ENTREGA, avisando no log",
	/if \(entregaComida <= PUDIM_FRUTA_PERTO_DE_ENTREGA\) \{\s*\n\s*result\._dbg\.skip = "fruta_perto_entrega:"/.test(smart));
check("a checagem vem ANTES da decisão de construir (antes do limiar do celeiro dedicado)",
	smart.indexOf("entregaComida <= PUDIM_FRUTA_PERTO_DE_ENTREGA") < smart.indexOf("if (nearestDedicatedDist <= buildThresh)"));
const pro = corpo("pudim_GetProactiveFarmsteadData");
check("o caminho proativo usa a MESMA constante (e conta o CC)",
	/!ci\.HasClass\("CivCentre"\)\) continue;[\s\S]{0,300}<= PUDIM_FRUTA_PERTO_DE_ENTREGA \* PUDIM_FRUTA_PERTO_DE_ENTREGA\) return null;/.test(pro));
check("nenhum 50*50 solto sobrou no proativo", !/< 50\*50\) return null;/.test(pro));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
