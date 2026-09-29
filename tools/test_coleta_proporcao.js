/**
 * A coleta segue a proporção de unidades (28/09).
 *
 * Relato: "parou de fazer as tropas". Log: espadachim e escaramuçador 1:1, Metal 0 nas
 * prioridades, ninguém no metal, M0 — o espadachim nunca ficava pagável. Pedido: "sim, mas se
 * não tiver metal, treina o que for possível". Roda pudim_PesosDeColeta num mundo falso.
 *
 * Rodar:  node tools/test_coleta_proporcao.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("coleta segue a proporcao");

const a = panel.indexOf("function pudim_ProporcaoAtiva()");
const b = panel.indexOf("// Teto do lote.");
const custos = {
	"units/rome/infantry_swordsman_b": { food: 50, metal: 40, population: 1, time: 10 },
	"units/rome/infantry_javelineer_b": { food: 50, wood: 50, population: 1, time: 10 },
	"units/rome/support_civilian": { food: 50, population: 1 }
};
const logs = [];
const ctx = {
	Math, Object,
	g_PudimResourceWeights: { food: 3, wood: 4, stone: 0, metal: 0 },
	g_PudimUnitPesos: {},
	g_PudimUnitTodas: Object.keys(custos).map(tpl => ({ tpl, existentes: 0, emFila: 0 })),
	GetTemplateData: t => ({ cost: custos[t] }),
	pudim_Log: (l, c, m) => logs.push(c + " " + m)
};
vm.createContext(ctx);
vm.runInContext(panel.slice(a, b) + "\nthis.f = pudim_PesosDeColeta;", ctx);

let p = ctx.f({ food: 100, wood: 100, stone: 0, metal: 0 });
check("sem proporção: os seus pesos, intactos", p.metal === 0 && p.food === 3 && p.wood === 4);

ctx.g_PudimUnitPesos = { "units/rome/infantry_swordsman_b": 1, "units/rome/infantry_javelineer_b": 1 };
p = ctx.f({ food: 100, wood: 100, stone: 0, metal: 0 });
check("espadachim pesado, metal 0 e sem estoque: metal ganha peso 1", p.metal === 1, JSON.stringify(p));
check("pedra continua 0: nenhuma unidade pesada custa pedra", p.stone === 0);
check("comida e madeira seguem os seus pesos", p.food === 3 && p.wood === 4);
check("e o painel continua mostrando o seu 0", ctx.g_PudimResourceWeights.metal === 0);
check("avisa no log uma vez", logs.filter(l => /metal em 0 nas prioridades/.test(l)).length === 1, logs.join(" | "));
ctx.f({ food: 100, wood: 100, stone: 0, metal: 0 });
check("sem repetir o aviso a cada ciclo", logs.filter(l => /metal em 0 nas prioridades/.test(l)).length === 1);

// 5 lotes de 40 = 200. Histerese: liga abaixo de 200, desliga só acima de 400.
p = ctx.f({ food: 100, wood: 100, stone: 0, metal: 300 });
check("com 300 de metal (entre 200 e 400) continua coletando", p.metal === 1);
p = ctx.f({ food: 100, wood: 100, stone: 0, metal: 450 });
check("passou do dobro: volta ao seu 0", p.metal === 0 && /metal juntou/.test(logs[logs.length - 1]));
p = ctx.f({ food: 100, wood: 100, stone: 0, metal: 300 });
check("e só religa quando cair abaixo de 5 lotes", p.metal === 0);

ctx.g_PudimResourceWeights = { food: 3, wood: 4, stone: 0, metal: 2 };
p = ctx.f({ food: 0, wood: 0, stone: 0, metal: 0 });
check("peso que você pôs manda: não é trocado", p.metal === 2);

check("o Auto-Trabalho usa os pesos com a proporção",
	/"weights": pudim_PesosDeColeta\(\(GetSimState\(\)\.players\[Engine\.GetPlayerID\(\)\] \|\| \{\}\)\.resourceCounts\)/.test(panel));
check("a semeadura parada por recurso deixa rastro no log",
	/parado: sem recurso para " \+/.test(panel) && /var g_PudimQueueParadoLogAt = \{\};/.test(panel));
check("e sem recurso para a mais atrasada, continua fazendo a pagável", /function pudim_ProporcaoPagavel\(/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
