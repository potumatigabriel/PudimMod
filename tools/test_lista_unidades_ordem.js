/**
 * A aldeã não pode sumir da Proporção de Unidades.
 *
 * Relato de 03/09: "algumas unidades sumiram ao longo do jogo, como aldeas".
 *
 * A lista tem cinco linhas. Quem as ocupa era decidido por peso e, no empate, por ORDEM
 * ALFABÉTICA DO TEMPLATE — e os templates são units/<civ>/<nome>, onde
 * support_female_citizen é a última de todas. A aldeã era, por construção, sempre a
 * primeira a ser cortada.
 *
 * Na captura da Fase III as cinco linhas mostravam: Brennus (0), Cavalaria espadachim,
 * Dardeiro de cavalaria, Trompetista e Vercingetórix (1). Dois heróis (limitados a um cada)
 * e um músico ocupando lugar, com a aldeã — que ele produzia o tempo todo — fora da tela.
 *
 * O desempate agora é por quantas o jogador TEM, mais as em fila.
 *
 * Rodar:  node tools/test_lista_unidades_ordem.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const exec = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("a aldea nao some da lista");

const LINHAS = +/const PUDIM_UNIT_LINHAS = (\d+);/.exec(panel)[1];

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
const pesos = {};
function ordenar(lista) {
	return lista.slice().sort(function(a, b) {
		const pa = pesos[a.tpl] || 0, pb = pesos[b.tpl] || 0;
		if (pa !== pb) return pb - pa;
		const ua = (a.existentes || 0) + (a.emFila || 0);
		const ub = (b.existentes || 0) + (b.emFila || 0);
		if (ua !== ub) return ub - ua;
		return a.tpl < b.tpl ? -1 : (a.tpl > b.tpl ? 1 : 0);
	});
}
const visiveis = lista => ordenar(lista).slice(0, LINHAS).map(u => u.tpl.split("/").pop());

// A tela da captura, com os números que ela mostrava.
const CIV = "units/gaul/";
const faseIII = [
	{ tpl: CIV + "hero_brennus",           existentes: 0,  emFila: 0 },
	{ tpl: CIV + "hero_vercingetorix",     existentes: 1,  emFila: 0 },
	{ tpl: CIV + "support_trumpeter",      existentes: 0,  emFila: 0 },
	{ tpl: CIV + "cavalry_swordsman_b",    existentes: 70, emFila: 0 },
	{ tpl: CIV + "cavalry_javelineer_b",   existentes: 38, emFila: 0 },
	{ tpl: CIV + "infantry_spearman_b",    existentes: 3,  emFila: 0 },
	{ tpl: CIV + "support_female_citizen", existentes: 46, emFila: 2 }
];
pesos[CIV + "cavalry_swordsman_b"] = 1;
pesos[CIV + "cavalry_javelineer_b"] = 1;

const tela = visiveis(faseIII);
console.log("   linhas: " + tela.join(", "));
check("a aldeã aparece — era ela que sumia", tela.indexOf("support_female_citizen") >= 0);
check("os dois tipos com peso continuam na tela, antes de tudo",
	tela.indexOf("cavalry_swordsman_b") >= 0 && tela.indexOf("cavalry_javelineer_b") >= 0);
check("herói com zero em campo não ocupa mais linha",
	tela.indexOf("hero_brennus") < 0);
check("nem o músico", tela.indexOf("support_trumpeter") < 0);

// A regressão exata: com o desempate alfabético a aldeã ficava de fora deste mesmo cenário.
function alfabetico(lista) {
	return lista.slice().sort(function(a, b) {
		const pa = pesos[a.tpl] || 0, pb = pesos[b.tpl] || 0;
		if (pa !== pb) return pb - pa;
		return a.tpl < b.tpl ? -1 : (a.tpl > b.tpl ? 1 : 0);
	}).slice(0, LINHAS).map(u => u.tpl.split("/").pop());
}
check("e o desempate ANTIGO realmente a cortava — o cenário testa o que quebrou",
	alfabetico(faseIII).indexOf("support_female_citizen") < 0,
	alfabetico(faseIII).join(", "));

// Peso continua acima de tudo: o que o jogador configurou nunca sai da tela, mesmo com
// zero em campo. Esconder justamente o que ele ajustou é o pior corte possível.
pesos[CIV + "hero_brennus"] = 2;
check("tipo com peso fica na tela mesmo sem nenhum em campo",
	visiveis(faseIII).indexOf("hero_brennus") >= 0);
delete pesos[CIV + "hero_brennus"];

// Empate de tudo (início de partida) cai no alfabético, e a ordem não pode dançar.
const zerados = [
	{ tpl: CIV + "b", existentes: 0, emFila: 0 },
	{ tpl: CIV + "a", existentes: 0, emFila: 0 }
];
check("com tudo zerado a ordem é estável, não aleatória",
	visiveis(zerados).join() === "a,b");

// A fila conta junto: unidade recém-pedida não é tratada como inexistente.
const comFila = [
	{ tpl: CIV + "x", existentes: 0, emFila: 9 },
	{ tpl: CIV + "y", existentes: 3, emFila: 0 }
];
check("o que está na fila conta como usado", visiveis(comFila)[0] === "x");

// ── No código ──────────────────────────────────────────────────────────────────────────
check("o desempate por uso está no código",
	/const ua = \(a\.existentes \|\| 0\) \+ \(a\.emFila \|\| 0\);/.test(exec) &&
	/if \(ua !== ub\) return ub - ua;/.test(exec));
check("o peso continua vindo primeiro",
	exec.indexOf("if (pa !== pb) return pb - pa;") < exec.indexOf("if (ua !== ub) return ub - ua;"));
check("e o alfabético continua como último critério, para a ordem não dançar",
	/if \(ua !== ub\) return ub - ua;\s*\n\s*return a\.tpl < b\.tpl \? -1 :/.test(exec));
// A exibição continua por NOME: reordenar ao clicar em + fazia o botão fugir do cursor.
check("a exibição segue ordenada por nome, não por esta ordem de escolha",
	/g_PudimUnitLista = lista\.slice\(0, PUDIM_UNIT_LINHAS\)\.sort\(/.test(exec));
check("a procedência fica no código, com o que a tela mostrava",
	/Trompetista e Vercingetórix/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
