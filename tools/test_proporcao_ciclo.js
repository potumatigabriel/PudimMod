/**
 * A proporção conta o que o próprio ciclo já enfileirou (28/09).
 *
 * Replay 2026-09-28_0008, 20:36: oito quartéis semearam espadachim no mesmo segundo e, 5s
 * depois, o mod cancelou e trocou todos para dardeiro — 22 stop-production em 40s. Dentro do
 * laço, `emFila` só mudava quando a simulação era relida.
 *
 * Rodar:  node tools/test_proporcao_ciclo.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("proporcao dentro do ciclo");

// O contaFila real, extraído do laço.
const i = panel.indexOf("const contaFila = function(tpl, n) {");
const j = panel.indexOf("};", i) + 2;
check("contaFila existe", i > 0);
const a = panel.indexOf("function pudim_ProporcaoAlvo(permitidos, descontos, preferido)");
const b = panel.indexOf("function pudim_UnidadeMaisAtrasada(");
const ctx = { Math };
vm.createContext(ctx);
vm.runInContext(panel.slice(a, b) + "\nvar g_PudimUnitPesos, g_PudimUnitTodas;\n" +
	"this.run = function(pesos, todas, n) {\n g_PudimUnitPesos = pesos; g_PudimUnitTodas = todas;\n" +
	panel.slice(i, j) + "\n const saiu = [];\n for (let k = 0; k < n; k++) {\n" +
	"  const u = pudim_ProporcaoAlvo(['sw', 'jav'], null, null); saiu.push(u.tpl); contaFila(u.tpl, 1);\n }\n return saiu; };", ctx);
const saiu = ctx.run({ sw: 1, jav: 1 },
	[{ tpl: "sw", existentes: 10, emFila: 0 }, { tpl: "jav", existentes: 10, emFila: 0 }], 8);
const sw = saiu.filter(t => t === "sw").length;
check("oito quartéis no mesmo ciclo, 1:1: metade de cada, não oito iguais", sw === 4, saiu.join(","));

check("cada envio do laço entra na conta",
	(execP.match(/contaFila\(/g) || []).length >= 6, (execP.match(/contaFila\(/g) || []).length);
check("o cancelamento com a fila cheia desconta",
	/"entity": b\.ent, "id": item\.id \}\);\s*\n\s*contaFila\(seededTpl, -\(item\.count \|\| 1\)\);/.test(panel));
check("lote recém-semeado (7s) não é trocado de tipo",
	/const semeadoHaPouco = nowQueue - \(g_PudimQueueSeededAt\[b\.ent\] \|\| 0\) < 7000;/.test(panel) &&
	/pudim_ProporcaoAtiva\(\) && !semeadoHaPouco && b\.trainingQueue/.test(panel) &&
	/isOurs && pudim_ProporcaoAtiva\(\) && !semeadoHaPouco/.test(panel));
check("nowQueue é declarado antes do uso",
	panel.indexOf("const nowQueue = Date.now();") < panel.indexOf("const semeadoHaPouco"));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
