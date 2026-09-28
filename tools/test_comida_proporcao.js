/**
 * Comida é do aldeão; proporção de unidades não trava por falta de recurso (28/09).
 *
 * Pedidos: "na comida, a prioridade sempre é os aldeões, porque eles catam mais rápido comida,
 * e guerreiros são mais rápidos nos outros recursos"; "quando balanceia as unidades, se não
 * tem recursos da que mais precisa, faz das que tem recursos; quando tiver recursos, tenta
 * balancear o tipo de tropas".
 *
 * Rodar:  node tools/test_comida_proporcao.js
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
console.log("comida do aldeao e proporcao pagavel");

// ── 1. Comida: aldeão primeiro ───────────────────────────────────────────────────────
check("aldeão com falta de comida: comida vem primeiro, sem disputa",
	/if \(isFemale\) \{\s*\n\s*if \(\(localDeficits\.food \|\| 0\) > 0\) localDeficits\.food = 1e6;/.test(sim));
check("soldado só vai para a comida se a falta passar dos aldeões ainda por distribuir",
	/if \(localDeficits\.food <= civisRestantes\) localDeficits\.food = -1e6;\s*\n\s*else localDeficits\.food -= 1\.5;/.test(sim));
check("os aldeões por distribuir são contados antes, com a mesma regra de civil do laço",
	/let civisRestantes = 0;[\s\S]{0,400}civisRestantes\+\+;/.test(sim) && /if \(isFemale\) civisRestantes--;/.test(sim));
check("e soldado continua fora do CAMPO (só fruta), como antes",
	/Soldados NUNCA vão para Fields/.test(sim));

// ── 2. Proporção: a mais atrasada que dá para pagar, rodando o código real ────────────
{
	const a = panel.indexOf("function pudim_ProporcaoAlvo(permitidos, descontos, preferido)");
	const b = panel.indexOf("function pudim_UnidadeMaisAtrasada(");
	const c = panel.indexOf("function pudim_ProporcaoPagavel(");
	const d = panel.indexOf("\n}", c) + 2;
	const ctx = { Math, Set, g_PudimUnitPesos: {}, g_PudimUnitTodas: [], pagaveis: {} };
	vm.createContext(ctx);
	vm.runInContext(panel.slice(a, b) + "\n" + panel.slice(c, d) +
		"\nfunction pudim_ComputeAffordableCount(tpl, n, res) { return pagaveis[tpl] ? 1 : 0; }" +
		"\nthis.f = pudim_ProporcaoPagavel;", ctx);
	// Cavalaria peso 3 (mais atrasada), lanceiro 2, fundeiro 1; nenhuma ainda.
	ctx.g_PudimUnitPesos = { cav: 3, lan: 2, fun: 1 };
	ctx.g_PudimUnitTodas = [{ tpl: "cav", existentes: 0, emFila: 0 }, { tpl: "lan", existentes: 0, emFila: 0 }, { tpl: "fun", existentes: 0, emFila: 0 }];
	const perm = ["cav", "lan", "fun"];
	ctx.pagaveis = { cav: true, lan: true, fun: true };
	check("com recurso para tudo: a mais atrasada (cavalaria)", ctx.f(perm, null, {}).tpl === "cav");
	ctx.pagaveis = { lan: true, fun: true };
	const r = ctx.f(perm, null, {});
	check("sem recurso para a cavalaria: faz a SEGUINTE mais atrasada (lanceiro)", r.tpl === "lan" && r.substituta === "cav", JSON.stringify(r));
	ctx.pagaveis = { fun: true };
	check("sem para cavalaria nem lanceiro: fundeiro", ctx.f(perm, null, {}).tpl === "fun");
	ctx.pagaveis = {};
	check("nenhuma cabe: fica a mais atrasada (espera, como antes)", ctx.f(perm, null, {}).tpl === "cav");
	ctx.pagaveis = { lan: true };
	check("só entre as que AQUELE edifício treina", ctx.f(["cav", "fun"], null, {}).tpl === "cav");
}
check("a fila semeia pela pagável, com o recurso livre (já sem a reserva)",
	/const atrasada = pudim_ProporcaoPagavel\(b\.trainerEntities \|\| \[\],\s*\n\s*g_PudimQueueSeededTpl\[b\.ent\], res\);/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
