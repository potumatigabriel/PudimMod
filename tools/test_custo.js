/**
 * A regua de custo: quanto cada sistema do mod gasta por minuto.
 *
 * Pedido de 27/09: "veja possiveis bugs e melhorias de performance". Nao havia um unico
 * numero de custo no mod — otimizar sem isso seria escolher o alvo no chute. Este teste
 * garante que a regua existe, mede os sistemas inteiros e, principalmente, que ela NAO muda
 * o comportamento de quem ela mede: nao engole erro e devolve o valor da funcao.
 *
 * Rodar:  node tools/test_custo.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const vm = require("vm");

const panel = fs.readFileSync(path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("a regua de custo");

const i = panel.indexOf("var g_PudimCusto = {};");
const j = panel.indexOf("/** Uma linha por minuto");
const k = panel.indexOf("\n}\n", panel.indexOf("function pudim_LogCusto()")) + 3;
check("o bloco da regua existe", i > 0 && j > i && k > j);
let agora = 0;
const logs = [];
const sb = { Date: { now: () => agora }, Object: Object,
	pudim_Log: (l, c, m) => logs.push(c + ": " + m) };
vm.createContext(sb);
vm.runInContext(panel.slice(i, k) + "\nthis.__c = () => g_PudimCusto;", sb);
const Medir = vm.runInContext("pudim_Medir", sb);

check("devolve o valor da funcao medida", Medir("x", () => 42) === 42);
let passou = false;
try { Medir("erro", () => { throw new Error("boom"); }); } catch (e) { passou = e.message === "boom"; }
check("NAO engole erro: a excecao chega a quem ja a tratava", passou);
check("e mesmo com erro o tempo e contado", sb.__c().erro && sb.__c().erro.n === 1);

vm.runInContext("g_PudimCusto = {};", sb);
Medir("lento", () => { agora += 30; });
Medir("lento", () => { agora += 10; });
Medir("rapido", () => { agora += 1; });
const c = sb.__c();
check("soma o tempo por sistema", c.lento.ms === 40 && c.lento.n === 2);
check("e guarda o pior caso", c.lento.max === 30);

vm.runInContext("pudim_LogCusto();", sb);
check("a linha do minuto sai com o total e os mais caros primeiro",
	/^CUSTO: 41ms\/min \| lento 40ms\/2x max30 \| rapido 1ms\/1x max1$/.test(logs[0] || ""), logs[0]);
check("e zera para o minuto seguinte", Object.keys(sb.__c()).length === 0);

// No tique, os sistemas sao medidos por inteiro.
const tick = panel.slice(panel.indexOf("function pudim_Tick(dt)"),
	panel.indexOf("\nfunction ", panel.indexOf("function pudim_Tick(dt)") + 20));
const medidos = [...tick.matchAll(/pudim_Medir\("([A-Za-z]+)", pudim_\1\)/g)].map(m => m[1]);
check("os sistemas do tique passam pela regua", medidos.length >= 15, medidos.length);
check("inclusive os pesados: auto-trabalho, panico, IA avancada e barra de aliados",
	["RunAutoWork", "ProcessPanic", "ProcessAdvancedAI", "UpdateAllyBar"].every(n => medidos.indexOf(n) >= 0));
check("e o nome medido e o da propria funcao — sem rotulo trocado",
	![...tick.matchAll(/pudim_Medir\("([A-Za-z]+)", (pudim_[A-Za-z]+)\)/g)].some(m => "pudim_" + m[1] !== m[2]));
check("a linha de custo sai junto com o retrato do minuto",
	/pudim_LogSnapshot\(\);\s*\n\s*try \{ pudim_LogCusto\(\); \} catch \(e\) \{\}/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
