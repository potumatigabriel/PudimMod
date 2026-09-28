/**
 * Ordem da pesquisa automática no começo (28/09): machado antes do cesto, cesta de capacidade
 * depois das de taxa.
 *
 * Pedido: "fazer o upgrade do machado antes do cesto". Replays: dos 15 mais rápidos a pop 200
 * com quartel medido, antes do 1º quartel 13 fizeram o machado, 14 o cesto de vime e só 1 a
 * cesta de capacidade — que o mod fazia primeiro.
 *
 * Rodar:  node tools/test_pesquisa_ordem.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const sim = fs.readFileSync(path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8")
	.split("\r\n").join("\n");
const corpo = sim.slice(sim.indexOf("const scoreTech = (tech) => {"), sim.indexOf("return 0; // qualquer outra tech"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
function nota(padrao) {
	const m = corpo.match(new RegExp("if \\(n\\.indexOf\\(\"" + padrao + "\"\\)[^\\n]*return (\\d+);"));
	return m ? +m[1] : null;
}

console.log("ordem da pesquisa automatica");
const machado = nota("woodcutting"), vime = nota("wicker"), capacidade = nota("gather_capacity");
const fazenda = nota("farming"), mineracao = nota("mining");
check("as notas foram achadas", [machado, vime, capacidade, fazenda, mineracao].every(x => x !== null),
	[machado, vime, capacidade, fazenda, mineracao].join(","));
check("machado antes do cesto de vime (pedido de 28/09)", machado > vime, machado + " vs " + vime);
check("cesto de vime antes da cesta de capacidade (replays: 14 de 15 contra 1 de 15)", vime > capacidade);
check("a cesta de capacidade fica depois das de taxa da fase", capacidade < fazenda && capacidade < mineracao);
check("o motivo está escrito no código", /13 fizeram o machado/.test(sim) && /só 1 a cesta de capacidade/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
