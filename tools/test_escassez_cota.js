/**
 * A cota de coleta tem de seguir o estoque, não só o peso.
 *
 * Relato de 03/09: "balanceamento de recursos errado... algumas unidades sumiram ao longo do
 * jogo, como aldeas". São dois defeitos; este teste cobre o primeiro (o segundo está em
 * test_lista_unidades_ordem.js).
 *
 * Medido nas duas capturas da partida, não por inspeção:
 *
 *   21:25 — comida 91 com 43 coletores, madeira 815 com 58, metal 216 com 50, pop 169.
 *           Pesos 3/3/0/1 dão alvo 65/65/0/22: o metal tinha 50 para uma cota de 22, e a
 *           tela repetia "Recursos insuficientes - 68 Comida".
 *   21:46 — comida 220 com 27, madeira 1281 com 18, metal 1072 com 1, pop 117.
 *           Pesos 4/3/0/1 dão alvo 23/17/0/6 contra 27/18/0/1. A contagem de GENTE estava
 *           certa; errado era o alvo, porque peso distribui pessoas e o que faltava era
 *           estoque.
 *
 * A conta que corrige isso já existia no mod desde 31/08 — mas só dentro do módulo de
 * fazendas. A duplicação é que escondeu o defeito: corrigir a fazenda não corrigia quem
 * despacha os trabalhadores. Agora é uma função só, usada nos dois lados.
 *
 * Rodar:  node tools/test_escassez_cota.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const exec = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("cota de coleta segue o estoque");

// ── A função é uma só ──────────────────────────────────────────────────────────────────
check("existe uma função compartilhada de pesos efetivos",
	/function pudim_PesosEfetivos\(weights, banco\)/.test(exec));
check("a cota de coleta usa ela",
	/const efCota = pudim_PesosEfetivos\(weights, bancoCota\);/.test(exec));
check("o módulo de fazendas usa a MESMA — a duplicação foi o que escondeu o defeito",
	/const efFarm = pudim_PesosEfetivos\(weights, bancoFarm\);/.test(exec));
check("e a conta não ficou duplicada: só um Math.sqrt de escassez no arquivo",
	(exec.match(/Math\.sqrt\(media \/ Math\.max/g) || []).length === 1,
	(exec.match(/Math\.sqrt\(media \/ Math\.max/g) || []).length + " ocorrência(s)");
check("o alvo por recurso sai do peso EFETIVO, não do cru",
	/const targetQuota = \(efCota\.pesos\[type\] \/ totalWeight\) \* totalWorkers;/.test(exec));
check("e o total também, senão as frações não somam 1",
	/totalWeight \+= efCota\.pesos\[type\];/.test(exec));

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
const MIN = +/const PUDIM_ESCASSEZ_MIN = ([\d.]+);/.exec(sim)[1];
const MAX = +/const PUDIM_ESCASSEZ_MAX = ([\d.]+);/.exec(sim)[1];

function pesosEfetivos(weights, banco) {
	const rs = ["food", "wood", "stone", "metal"];
	let soma = 0, n = 0;
	for (const r of rs) if ((weights[r] || 0) > 0) { soma += (+banco[r] || 0); n++; }
	const media = n > 0 ? soma / n : 0;
	const out = {};
	for (const r of rs) {
		const p = weights[r] || 0;
		let f = 1;
		if (p > 0 && media > 0)
			f = Math.max(MIN, Math.min(MAX, Math.sqrt(media / Math.max(+banco[r] || 0, 1))));
		out[r] = p * f;
	}
	return out;
}
function cotas(weights, banco, trabalhadores) {
	const ef = pesosEfetivos(weights, banco);
	let tot = 0;
	for (const r in ef) if ((weights[r] || 0) > 0) tot += ef[r];
	const q = {};
	for (const r in ef) if ((weights[r] || 0) > 0) q[r] = (ef[r] / tot) * trabalhadores;
	return q;
}

// O caso das 21:46, com os números da captura.
const W2 = { food: 4, wood: 3, stone: 0, metal: 1 };
const B2 = { food: 220, wood: 1281, stone: 277, metal: 1072 };
const q2 = cotas(W2, B2, 46);
console.log("   21:46 alvo comida " + q2.food.toFixed(1) + " (antes 23), madeira " +
	q2.wood.toFixed(1) + " (antes 17,3), metal " + q2.metal.toFixed(1) + " (antes 5,8)");
check("a comida, que estava caindo, ganha gente",
	q2.food > 23, q2.food.toFixed(1) + " contra 23 do peso cru");
check("a madeira, com 1281 parados, perde gente",
	q2.wood < 17.25, q2.wood.toFixed(1) + " contra 17,3");
check("e o alvo da comida passa dos 27 que ela JÁ tinha — senão nada se move",
	q2.food > 27, q2.food.toFixed(1) + " contra 27 de fato");

// O caso das 21:25.
const W1 = { food: 3, wood: 3, stone: 0, metal: 1 };
const B1 = { food: 91, wood: 815, stone: 300, metal: 216 };
const q1 = cotas(W1, B1, 151);
check("21:25: comida com 91 no estoque puxa mais gente que a madeira com 815",
	q1.food > q1.wood, q1.food.toFixed(0) + " contra " + q1.wood.toFixed(0));
check("e o metal, que tinha 50 coletores, cai bem abaixo disso",
	q1.metal < 50, q1.metal.toFixed(0));

// Estoques parelhos: os pesos do jogador valem exatamente como escritos. Esta é a
// propriedade que impede a escassez de virar um segundo sistema de prioridades por trás
// das costas dele.
const par = cotas({ food: 3, wood: 1, stone: 0, metal: 0 }, { food: 500, wood: 500 }, 100);
check("com estoques iguais, a proporção é a do jogador e nada mais",
	Math.abs(par.food - 75) < 0.01 && Math.abs(par.wood - 25) < 0.01,
	par.food.toFixed(1) + "/" + par.wood.toFixed(1));

// Peso zero continua zero: escassez não ressuscita recurso que o jogador não quer.
const zero = cotas({ food: 1, wood: 1, stone: 0, metal: 0 }, { food: 900, wood: 900, stone: 1 }, 50);
check("pedra com peso 0 não entra na cota, por mais escassa que esteja",
	zero.stone === undefined);

// Os limites: um recurso zerado não pode sequestrar a base.
const extremo = cotas({ food: 1, wood: 1 }, { food: 1, wood: 100000 }, 100);
check("recurso zerado não leva a base inteira — o teto de " + MAX + "x segura",
	extremo.food <= 95, extremo.food.toFixed(1) + " de 100");
check("e o recurso abundante não fica sem ninguém",
	extremo.wood >= 5, extremo.wood.toFixed(1));

// ── A drenagem do excesso ──────────────────────────────────────────────────────────────
// 1 por ciclo era o certo enquanto cada trabalhador pesava no total. Com 169 de população e
// 28 de excesso no metal, levava mais de dois minutos.
function pull(bigPop, surplus) {
	return bigPop ? Math.max(1, Math.min(4, Math.floor(surplus / 8))) : 1;
}
check("com população baixa continua 1 por ciclo, como sempre foi",
	pull(false, 30) === 1);
check("com pop alta e o excesso de 28 do metal, drena mais rápido",
	pull(true, 28) === 3, pull(true, 28) + " por ciclo");
check("excesso pequeno ainda tira só 1 — não é para virar realocação em massa",
	pull(true, 9) === 1);
check("e há um teto, para não abrir buraco do outro lado",
	pull(true, 200) === 4);
check("a regra está no código, com a população como chave",
	/const pullCount = bigPopRb\s*\n?\s*\? Math\.max\(1, Math\.min\(4, Math\.floor\(worstSurplus \/ 8\)\)\)\s*\n?\s*: 1;/.test(exec));

// ── Dá para conferir depois da partida ─────────────────────────────────────────────────
check("o fator de escassez sai no log de balanceamento",
	/escassez/.test(panel) && /result\._bal\.esc/.test(panel));
check("e a simulação o envia",
	/result\._bal\.esc\[type\] = Math\.round\(efCota\.fatores\[type\] \* 100\) \/ 100;/.test(exec));

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("os números medidos ficam no código, não só neste teste",
	/madeira 1281 e metal 1072 parados, comida 220 caindo/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
