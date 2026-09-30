/**
 * Pesquisa/obra na espera: aparece, tem prioridade sobre as obras do mod, e avisa ao sair (29/09).
 *
 * Relatos: "clique pra pesquisar quando tiver recursos não funciona", "não sei se funciona,
 * porque não fica azul igual da construção", "às vezes funcionou, mas não vi". Log: a pesquisa
 * entrou na espera ("faltam 53W") e 11s depois a casa automática gastou a madeira.
 *
 * Rodar:  node tools/test_espera_visivel.js
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
console.log("espera visivel e com prioridade");

// ── 1. O indicador lista o que está na espera ──────────────────────────────────────────
{
	const a = panel.indexOf("const PUDIM_NOMES_RECURSO");
	const b = panel.indexOf("function pudim_AtualizarObras()");
	const ctx = {
		Math,
		g_PudimPesquisasEspera: [{ tech: "gather_lumbering_ironaxes", nome: "Machado com cabeças de ferro", custo: { wood: 200, food: 100 } }],
		g_PudimObrasEspera: [],
		GetSimState: () => ({ players: { 1: { civ: "gaul", resourceCounts: { wood: 152, food: 400 } } } }),
		GetTechnologyData: () => ({ icon: "technologies/axe_iron.png" }),
		GetTemplateData: () => null, pudim_NomeDaObra: t => t,
		pudim_FaltaParaObra: c => ((c.wood || 0) > 152 ? { wood: c.wood - 152 } : null),
		Engine: { GetPlayerID: () => 1 }
	};
	vm.createContext(ctx);
	vm.runInContext(panel.slice(a, b) + "\nthis.f = pudim_ItensNaEspera;", ctx);
	const l = ctx.f();
	check("a pesquisa aparece, com o ícone da tecnologia", l.length === 1 && l[0].icone === "technologies/axe_iron.png");
	check("e diz o que falta, por extenso: 'faltam 48 madeira'", l[0].texto === "faltam 48 madeira", l[0].texto);
	check("a barra é o quanto do custo já existe (252 de 300)", Math.abs(l[0].progresso - 252 / 300) < 1e-9);
}
check("o indicador põe a espera no topo, antes das obras", /const obras = pudim_ItensNaEspera\(\)\.concat\(\(d && d\.obras\) \|\| \[\]\);/.test(panel));
check("com selo azulado", /seloBgE\.sprite = "color: 60 110 200 230";/.test(panel));
check("a dica do botão diz NA ESPERA e quanto falta", /NA ESPERA" \+ \(partes\.length \? ": faltam " \+ partes\.join\(", "\) : ""\)/.test(panel));
check("e a saída avisa na tela", /"Pesquisa na espera saiu: " \+ p\.nome/.test(panel));

// ── 2. As obras do mod respeitam o que você pediu ──────────────────────────────────────
{
	const a = panel.indexOf("const PUDIM_TIPOS_DE_UNIDADE");
	const b = panel.indexOf("function pudim_MarkDispatched(");
	const w = { enviados: [], pop: 27, lim: 30, madeira: 152 };
	const ctx = {
		Date, Math, Set, g_PudimPlayerOrders: {},
		g_PudimGuardado: { doJogador: { wood: 200, food: 100 } },
		pudim_Log: () => {}, GetEntityState: () => null,
		pudim_CustoDaObra: t => (/house/.test(t) ? { wood: 75 } : { wood: 100 }),
		Engine: { PostNetworkCommand: c => w.enviados.push(c), GetPlayerID: () => 1 }
	};
	Object.defineProperty(ctx, "GetSimState", { value: () => ({ players: { 1: { popCount: w.pop, popLimit: w.lim,
		resourceCounts: { wood: w.madeira, food: 400 } } } }) });
	vm.createContext(ctx);
	vm.runInContext(panel.slice(a, b) + "\nthis.ordenar = pudim_Ordenar;", ctx);
	check("com a pesquisa esperando 200 de madeira, o armazém do mod espera",
		ctx.ordenar({ type: "construct", entities: [1], template: "structures/gaul/storehouse", x: 1, z: 1 },
			"pudim_ProcessAdvancedAI") === false);
	check("a casa também, com vaga de população (27/30)",
		ctx.ordenar({ type: "construct", entities: [2], template: "structures/gaul/house", x: 1, z: 1 },
			"pudim_ProcessAdvancedAI") === false);
	w.pop = 30;
	check("mas com a população no teto (30/30) a casa sai — a produção nunca para",
		ctx.ordenar({ type: "construct", entities: [3], template: "structures/gaul/house", x: 1, z: 1 },
			"pudim_ProcessAdvancedAI") === true);
	w.madeira = 400; w.pop = 27;
	check("com recurso para os dois, a obra do mod sai",
		ctx.ordenar({ type: "construct", entities: [4], template: "structures/gaul/storehouse", x: 1, z: 1 },
			"pudim_ProcessAdvancedAI") === true);
	check("a sua obra na espera nunca é barrada por isso",
		ctx.ordenar({ type: "construct", entities: [5], template: "structures/gaul/barracks", x: 1, z: 1 },
			"pudim_ProcessObrasEspera") === true);
}

// ── 3. O lote de 1 não pega o que é seu ────────────────────────────────────────────────
check("a reserva separa o que é do jogador (pesquisa, obra, cerco, fase que ele guarda)",
	/it\.tipo === "obra" \|\| it\.tipo === "pesquisa" \|\| it\.tipo === "cerco" \|\| \(it\.tipo === "fase" && faseReserva\)/.test(panel));
check("e o estoque do lote de 1 desconta isso",
	/resReal\[r\] = Math\.max\(0, \(\+resReal\[r\] \|\| 0\) - \(g_PudimGuardado\.doJogador\[r\] \|\| 0\)\);/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
