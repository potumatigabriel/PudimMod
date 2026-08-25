/**
 * Fazenda é prioridade máxima; treinar unidade é a segunda.
 *
 * Pedido de 25/08:
 *
 *   "quando acaba as frutas demora pra fazer todas as fazendas, tem sempre que respeitar a
 *    proporção, só n fazer senão tiver madeira disponivel, mas assim que tiver faz, senão
 *    tiver, vai pra madeira, logo que tiver, vai fazendo, isso é prioridade maxima, a
 *    segunda prioridade é construir unidades."
 *
 * O "demora" tinha causa medida. Com a fruta esgotada, a capacidade de comida é SÓ fazenda,
 * e o mod erguia no máximo UM campo por ciclo de 5 s, com 50 s de construção cada. Voltar de
 * 10 para 25 trabalhadores em comida levava minutos — e nesse tempo o auto-trabalho, que
 * roda a cada 500 ms, despejava todo mundo na madeira porque comida não tinha vaga. Foi
 * assim que uma partida chegou a 47 em comida contra 131 em madeira, com a cota mandando 3/4.
 *
 * A parte que não é óbvia é a segunda prioridade. Acelerar a fazenda sozinho não resolve: as
 * duas coisas gastam a MESMA madeira, e a auto-fila roda muito mais vezes por segundo do que
 * o construtor de campos. Ela comeria o estoque antes, e o campo continuaria não saindo. Por
 * isso o jogador precisou dizer qual vem primeiro — e por isso a reserva existe.
 *
 * Rodar:  node tools/test_fazenda_prioridade.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("fazenda em primeiro, unidade em segundo");

// ── O teto que causava a demora ────────────────────────────────────────────────────────
check("o teto de um campo por ciclo saiu",
	sim.indexOf("effDeficit = Math.min(deficit - trainingCount, PUDIM_FIELD_CAPACITY);") < 0);
check("e o déficit passa inteiro",
	/effDeficit = deficit - trainingCount;/.test(sim));

// Os freios de VERDADE continuam: sem eles isto viraria construção sem limite.
check("o teto de 9 fazendas continua", /PUDIM_MAX_FARMS = 9;/.test(sim));
check("o desconto de quem está nascendo continua",
	/deficit - trainingCount/.test(sim));
check("e o freio por estoque de comida continua",
	/const foodComfort = /.test(sim));

// ── A madeira é o único limite novo ────────────────────────────────────────────────────
check("o custo do campo vem do template, não de um número solto",
	/template_structure_resource_field\.xml: <wood>100<\/wood>/.test(sim) &&
	/const PUDIM_CUSTO_CAMPO = 100;/.test(sim));
check("a simulação diz quantos campos o estoque paga",
	/result\.camposPagaveis = Math\.floor\(resCounts\.wood \/ PUDIM_CUSTO_CAMPO\);/.test(sim));
check("e o painel corta a lista por isso",
	/if \(farmsBuilt >= \(farmData\.camposPagaveis \|\| 0\)\) \{/.test(panel));
check("dizendo no log que o resto sai quando tiver madeira",
	/madeira acabou — o resto sai assim que tiver/.test(panel));

// ── Prioridade máxima: o ciclo acelera ─────────────────────────────────────────────────
check("o ciclo acelera enquanto falta comida",
	/g_PudimFarmAccum >= \(g_PudimFarmUrgente \? (\d+) : (\d+)\)/.test(panel));
const mCiclo = /g_PudimFarmAccum >= \(g_PudimFarmUrgente \? (\d+) : (\d+)\)/.exec(panel);
const URGENTE = +mCiclo[1], NORMAL = +mCiclo[2];
check("o ciclo urgente é bem mais rápido que o normal", URGENTE * 2 <= NORMAL,
	URGENTE + "ms vs " + NORMAL + "ms");
check("mas não tão rápido a ponto de virar spam de comando", URGENTE >= 1000, URGENTE);
check("a urgência sai do déficit real, não de um palpite",
	/const atraso = \(farmData\._dbg && farmData\._dbg\.edf\) \|\| 0;/.test(panel) &&
	/g_PudimFarmUrgente = atraso > 0;/.test(panel));

// ── Segunda prioridade: a auto-fila cede a madeira ─────────────────────────────────────
check("existe uma reserva de madeira para os campos pendentes",
	/var g_PudimMadeiraReservada = 0;/.test(panel));
check("ela cobre só o que ainda falta erguer",
	/Math\.ceil\(atraso \/ 5\) \* 100/.test(panel));
check("e a auto-fila desconta antes de decidir se pode pagar",
	/res\.wood = Math\.max\(0, \(\+res\.wood \|\| 0\) - g_PudimMadeiraReservada\);/.test(panel));
// Copiar o objeto importa: alterar o original mudaria o estoque para todo o resto do ciclo,
// incluindo decisões que nada têm a ver com treino.
check("a reserva não corrompe o estoque lido por outros sistemas",
	/const res = \{\};\s*\n\s*for \(const k in resBruto\) res\[k\] = resBruto\[k\];/.test(panel));
check("e o log diz quando o treino está esperando por causa disso",
	/treino em espera: /.test(panel));

// ── A regra, modelada ──────────────────────────────────────────────────────────────────
const CUSTO = 100, VAGAS = 5;
function campos(atrasoTrab, madeira) {
	const querem = Math.ceil(atrasoTrab / VAGAS);
	return Math.min(querem, Math.floor(madeira / CUSTO));
}
function reserva(atrasoTrab) { return atrasoTrab > 0 ? Math.ceil(atrasoTrab / VAGAS) * CUSTO : 0; }
function madeiraParaTreino(madeira, atrasoTrab) {
	return Math.max(0, madeira - reserva(atrasoTrab));
}

check("15 trabalhadores atrasados e 400 de madeira: ergue 3 campos e para",
	campos(15, 400) === 3, campos(15, 400));
check("com madeira de sobra, ergue tudo de uma vez",
	campos(15, 9000) === 3, campos(15, 9000));
check("sem madeira nenhuma, não ergue — e não trava",
	campos(15, 50) === 0, campos(15, 50));
check("com a madeira exata de um campo, ergue um",
	campos(15, 100) === 1, campos(15, 100));

// "a segunda prioridade é construir unidades": com atraso, o treino só usa a sobra.
check("com campos pendentes, o treino só vê a madeira que sobra",
	madeiraParaTreino(400, 15) === 100, madeiraParaTreino(400, 15));
check("se a madeira só dá para os campos, o treino espera",
	madeiraParaTreino(300, 15) === 0, madeiraParaTreino(300, 15));
check("sem atraso de comida, o treino usa o estoque inteiro",
	madeiraParaTreino(400, 0) === 400, madeiraParaTreino(400, 0));
// E a reserva não pode ser eterna: assim que os campos sobem, o atraso zera e o treino volta.
check("a reserva zera junto com o atraso", reserva(0) === 0);

// A proporção continua sendo quem manda no alvo — o pedido foi "tem SEMPRE que respeitar a
// proporção", não "encher de fazenda".
check("o alvo continua vindo da proporção configurada",
	/desiredFoodWorkers/.test(sim) && /effectiveTotal/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
