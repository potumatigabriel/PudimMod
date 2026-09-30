/**
 * A casa acompanha a produção (29/09).
 *
 * Print de 29/09: "só tá fazendo de 2 em 2, ao invés de usar o máximo de recursos e o máximo
 * de pop disponível". Log: 22/25, 30/35, 36/40 — a comida pagava 4-5 e só havia 2-3 vagas,
 * porque a casa só começava faltando 3.
 *
 * Rodar:  node tools/test_casa_producao.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8").split("\r\n").join("\n");
const i = sim.indexOf("GuiInterface.prototype.pudim_GetAutoHouseData");
const corpo = sim.slice(i, sim.indexOf("\n};", i));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("casa acompanha a producao");

const MAX = +(/const PUDIM_CASA_LIMIAR_MAX = (\d+);/.exec(sim) || [])[1];
check("teto de 25", MAX === 25, MAX);
const efetivo = (botao, fila) => Math.min(MAX, Math.max(botao, fila));
check("só o CC com lote de 3 e 2 esperando: 5 (perto do botão 3 — sem casa demais no começo)", efetivo(3, 5) === 5);
check("três quartéis em lote de 5 e o CC em 3: 18", efetivo(3, 18) === 18);
check("fila enorme não passa do teto", efetivo(3, 60) === 25);
check("o botão continua sendo o mínimo", efetivo(12, 4) === 12);

check("toda unidade da fila conta (andando ou esperando vaga)",
	/if \(!item\.unitTemplate\) continue;\s*\n\s*filaTotal \+= \(item\.count \|\| 1\);\s*\n\s*if \(\(item\.progress \|\| 0\) <= 0\) continue;/.test(corpo));
check("a mesma conta do código", /threshold = Math\.min\(PUDIM_CASA_LIMIAR_MAX, Math\.max\(thresholdBotao, filaTotal\)\);/.test(corpo));
check("e ela vem ANTES da decisão pela folga",
	corpo.indexOf("threshold = Math.min(PUDIM_CASA_LIMIAR_MAX") < corpo.indexOf("if (rawHeadroom > threshold) return"));
check("o atalho de folga grande não pula o cálculo quando as filas pedem mais",
	/if \(rawHeadroom > Math\.max\(thresholdBotao, PUDIM_CASA_LIMIAR_MAX\) \+ 20\)/.test(corpo));
check("o log diz de onde veio o número", /"\(botao " \+ thresholdBotao \+ ", filas " \+ filaTotal \+ "\)"/.test(corpo));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
