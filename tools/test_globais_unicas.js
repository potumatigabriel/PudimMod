/**
 * Nenhuma global declarada duas vezes na GUI do mod.
 *
 * Os arquivos de gui/session dividem UM escopo global, e `var` repetido não dá erro: as duas
 * declarações viram a MESMA variável. Em 28/09 a obra na espera nasceu com
 * `var g_PudimObrasAccum`, nome que já era do indicador de obras. O indicador zerava o
 * contador a cada segundo, antes de a obra chegar a vê-lo cheio — a obra na espera nunca
 * teria saído. Os testes dela passavam porque chamavam a função direto, sem o tique.
 *
 * Rodar:  node tools/test_globais_unicas.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const pasta = path.join(base, "gui", "session");
const arquivos = fs.readdirSync(pasta).filter(f => f.endsWith(".js")).map(f => path.join(pasta, f));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("globais unicas na GUI do mod");
const vistos = {};
for (const f of arquivos) {
	const src = fs.readFileSync(f, "utf8").split("\r\n").join("\n").replace(/\/\*[\s\S]*?\*\//g, " ");
	for (const m of src.matchAll(/^(?:var|const|let|function)\s+([A-Za-z_$][\w$]*)/gm))
		(vistos[m[1]] = vistos[m[1]] || []).push(path.basename(f));
}
const repetidas = Object.keys(vistos).filter(k => vistos[k].length > 1);
check("nenhuma global declarada duas vezes (" + Object.keys(vistos).length + " conferidas em " +
	arquivos.length + " arquivos)", repetidas.length === 0,
	repetidas.map(k => k + " em " + vistos[k].join(", ")).join(" ; "));
check("a varredura achou as globais de verdade (não passou por vazio)",
	vistos.g_PudimObrasAccum && vistos.g_PudimObraEsperaAccum && Object.keys(vistos).length > 200);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
