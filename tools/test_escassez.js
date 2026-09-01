/**
 * O que está sobrando cede vez ao que está faltando — e o ocioso conta como mão de obra.
 *
 * Pedidos de 31/08:
 *
 *   "se um recurso está muito abundante, tem que focar no que está pouco"
 *   "e por algum motivo, ficaram muitos trabalhadores ociosos"
 *
 * Os dois são o MESMO defeito visto de dois ângulos, e o log da partida mostra isso numa
 * linha só:
 *
 *   fc=5 tg=4 cfm=4 fwt=2 df=-2 ocio=53 vagas=0 reason=nodeficit
 *
 * Cinquenta e três trabalhadores parados, comida em 86, madeira em 9582 — e o módulo de
 * fazendas concluindo "sem déficit, não faz nada". Duas causas somadas:
 *
 *   1. A meta de comida saía de `Math.ceil(effectiveTotal * foodW / totalW)`, e nem
 *      `effectiveTotal` nem o teto `Math.min(..., totalGatherers)` incluíam os ociosos. Isso
 *      fecha um ciclo que se alimenta sozinho: alguém fica ocioso → tg cai → a meta cai →
 *      o déficit fica negativo → nenhum campo novo → nenhuma vaga → ele continua ocioso.
 *      `fc=5` ficou parado 500 segundos assim.
 *
 *   2. Os pesos eram os do painel, fixos, cegos ao estoque. Com madeira 9582 contra comida
 *      86, "comida 4 / madeira 3" seguia mandando quase metade da gente para a madeira.
 *
 * O balanceador, note-se, já pedia o certo (`F4/61 W57/20` — 61 em comida, tem 4). O alvo
 * dele nunca foi o problema; o problema era o módulo de fazendas discordar e ser ele quem
 * decide se um campo novo sai.
 *
 * Rodar:  node tools/test_escassez.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// ── A fórmula, espelhada a partir das constantes REAIS do código ───────────────────────
// Espelhar já me traiu uma vez (test_unidades reproduzia a divisão errada do lote junto com
// a regra, e passava verdinho enquanto o jogo treinava de 1 em 1). Aqui as constantes são
// LIDAS do código, então mexer nelas move o teste junto; e o que se verifica são
// propriedades da fórmula — neutra quando parelho, limitada nos extremos —, não o número.
const MIN = +/const PUDIM_ESCASSEZ_MIN = ([\d.]+);/.exec(sim)[1];
const MAX = +/const PUDIM_ESCASSEZ_MAX = ([\d.]+);/.exec(sim)[1];

function fatores(pesos, banco) {
	const rs = ["food", "wood", "stone", "metal"];
	let soma = 0, n = 0;
	for (const r of rs) if ((pesos[r] || 0) > 0) { soma += (+banco[r] || 0); n++; }
	const media = n > 0 ? soma / n : 0;
	const out = {};
	for (const r of rs) {
		const p = pesos[r] || 0;
		let f = 1;
		if (p > 0 && media > 0)
			f = Math.max(MIN, Math.min(MAX, Math.sqrt(media / Math.max(+banco[r] || 0, 1))));
		out[r] = { peso: p * f, fator: f };
	}
	return out;
}
function fatia(pesos, banco, r) {
	const f = fatores(pesos, banco);
	const tot = Object.keys(f).reduce((a, k) => a + f[k].peso, 0);
	return tot > 0 ? f[r].peso / tot : 0;
}

console.log("escassez manda mais que o slider");

check("os limites são declarados no código", MIN > 0 && MAX > MIN, MIN + ".." + MAX);

// ── O caso exato do log de 31/08 ───────────────────────────────────────────────────────
const PESOS = { food: 4, wood: 3, stone: 0, metal: 1 };
const CRISE = { food: 86, wood: 9582, stone: 200, metal: 4285 };
const fCrise = fatores(PESOS, CRISE);

check("com a comida em 86 e a madeira em 9582, a comida é puxada",
	fCrise.food.fator > 1, fCrise.food.fator.toFixed(2));
check("e a madeira é freada", fCrise.wood.fator < 1, fCrise.wood.fator.toFixed(2));
const fatiaComida = fatia(PESOS, CRISE, "food");
check("a comida passa a levar a maior parte da gente",
	fatiaComida > 0.6, (fatiaComida * 100).toFixed(0) + "%");
// Antes: 4/8 = 50% para a comida, com 9582 de madeira parada no banco.
check("é bem mais que os 50% que o slider sozinho dava",
	fatiaComida > 4 / 8 + 0.15, (fatiaComida * 100).toFixed(0) + "% vs 50%");

// ── Parelho: o mod não se intromete ────────────────────────────────────────────────────
// É a parte que protege o jogador: sem desequilíbrio, o que ele configurou vale como está.
const PARELHO = { food: 1000, wood: 1000, stone: 1000, metal: 1000 };
const fPar = fatores(PESOS, PARELHO);
check("com estoques parelhos, todo fator é 1",
	["food", "wood", "metal"].every(r => Math.abs(fPar[r].fator - 1) < 0.01));
check("e a divisão volta a ser exatamente a do painel",
	Math.abs(fatia(PESOS, PARELHO, "food") - 4 / 8) < 0.01,
	fatia(PESOS, PARELHO, "food").toFixed(3));

// Peso zero continua zero: "não quero pedra" não pode virar "um pouco de pedra" só porque
// a pedra está baixa.
check("recurso com peso zero continua fora, por mais escasso que esteja",
	fatores(PESOS, { food: 500, wood: 500, stone: 0, metal: 500 }).stone.peso === 0);
check("e nem entra na média que decide os fatores dos outros",
	Math.abs(fatia(PESOS, { food: 500, wood: 500, stone: 0, metal: 500 }, "food") - 4 / 8) < 0.01);

// ── Os extremos não podem sequestrar a base ────────────────────────────────────────────
const ZERADO = { food: 0, wood: 20000, stone: 0, metal: 20000 };
const fZero = fatores(PESOS, ZERADO);
check("comida zerada puxa forte, mas dentro do limite",
	fZero.food.fator === MAX, fZero.food.fator);
check("e a madeira farta não é zerada — o teto de baixo segura",
	fZero.wood.fator >= MIN, fZero.wood.fator.toFixed(2));
check("mesmo no extremo, a madeira não fica sem ninguém",
	fatia(PESOS, ZERADO, "wood") > 0.02, fatia(PESOS, ZERADO, "wood").toFixed(3));
check("banco vazio não quebra a conta (divisão por zero)",
	Number.isFinite(fatia(PESOS, { food: 0, wood: 0, stone: 0, metal: 0 }, "food")));

// A raiz quadrada é o que impede o extremo de virar tudo-ou-nada; sem ela, 9582 contra 86
// daria fator 111 na comida e 0,009 na madeira.
check("a suavização é raiz quadrada, não razão crua",
	/Math\.sqrt\(media \/ Math\.max\(\+bancoFarm\[r\] \|\| 0, 1\)\)/.test(sim));
check("e a média só considera recursos com peso",
	/if \(\(weights\[r\] \|\| 0\) > 0\) \{ soma \+= \(\+bancoFarm\[r\] \|\| 0\); n\+\+; \}/.test(sim));

// ── O ocioso conta ─────────────────────────────────────────────────────────────────────
console.log("\no ocioso e mao de obra, nao ausencia");

check("os ociosos entram no total da conta",
	/const effectiveTotal = totalGatherers \+ soldierWoodCount \+ ociosos;/.test(sim));
check("e no teto — o travamento em totalGatherers era metade do ciclo",
	/totalGatherers \+ ociosos\);/.test(sim) &&
	!/Math\.min\(Math\.ceil\(effectiveTotal \* foodW \/ totalW\), totalGatherers\)/.test(sim));
check("a contagem vem de idleBuilders, que já era coletada acima",
	/const ociosos = idleBuilders\.length;/.test(sim));

// Simula o ciclo: 5 campos cheios (25 vagas), 53 ociosos, nada de fruta.
// Com a regra velha o alvo caía junto com tg e nada acontecia; com a nova ele reflete a
// mão de obra que existe de fato.
function alvoComida(tg, ociosos, fatiaF, cap) {
	return Math.min(cap, Math.ceil((tg + ociosos) * fatiaF));
}
const CAP = 45;   // PUDIM_MAX_FARMS x PUDIM_FIELD_CAPACITY
const alvoVelho = Math.min(CAP, Math.min(Math.ceil(4 * 0.5), 4));
const alvoNovo = alvoComida(4, 53, fatiaComida, CAP);
check("no caso do log, o alvo deixa de ser 2 e passa a pedir gente de verdade",
	alvoNovo > 20, alvoVelho + " → " + alvoNovo);
check("e o déficit fica positivo, então campo novo sai",
	alvoNovo - 4 > 0, alvoNovo - 4);
check("sem estourar o teto de vagas de fazenda", alvoNovo <= CAP, alvoNovo);

// O ciclo não pode se reabrir: mais ociosos nunca podem BAIXAR o alvo.
let anterior = 0, monotono = true;
for (const o of [0, 5, 10, 20, 40, 53]) {
	const a = alvoComida(4, o, fatiaComida, CAP);
	if (a < anterior) monotono = false;
	anterior = a;
}
check("mais ociosos nunca reduz o alvo — era esse o ciclo que se alimentava sozinho",
	monotono);

// ── Dá para diagnosticar sem adivinhar ─────────────────────────────────────────────────
check("o log mostra os fatores de escassez e os ociosos",
	/" oci0=" \+ \(d\.oci0\|\|0\)/.test(panel) && /" esc=" \+ \[/.test(panel));
check("e a simulação os expõe", /result\._dbg\["esc_" \+ r\]/.test(sim) &&
	/result\._dbg\.oci0 = ociosos;/.test(sim));

// ── A fruta nao pode segurar o campo quando nao da conta ──────────────────────────────
//
// Pergunta do jogador em 01/09: "o balanceamento de comida/madeira está correto?". O log
// respondeu com o momento exato em que nao estava, aos 127s:
//
//   fwt=14 df=11 esc=f4/w0.72 tffs=9 reason=fruta_na_base:9 action=none
//
// Escassez de comida no TETO (fator 4), deficit de 11 trabalhadores, e zero campos
// erguidos — porque havia 9 vagas de fruta e o piso era fixo em 5. Nove nao cobrem onze,
// e fruta acaba enquanto campo fica: esperar ali chega tarde duas vezes.
console.log("\nfruta so segura o campo se der conta");

const PISO = 5;   // o piso original, que continua valendo por baixo
function seguraCampo(vagasFruta, deficit) {
	return vagasFruta >= PISO && vagasFruta >= deficit;
}
check("o caso do log: 9 vagas nao seguram um deficit de 11",
	!seguraCampo(9, 11));
check("mas 9 vagas seguram um deficit de 4 — fruta e de graca",
	seguraCampo(9, 4));
check("e meia moita nunca segura nada, por menor que seja a falta",
	!seguraCampo(4, 1), "piso de " + PISO);
check("vagas iguais ao deficit ainda seguram — cobre exatamente",
	seguraCampo(11, 11));
// Sem deficit nenhum a fruta segura, e e o que se quer: nao ha o que construir.
check("sem deficit, a fruta segura e nenhum campo sai", seguraCampo(9, 0));

check("a regra no codigo compara com o deficit, nao so com o piso",
	/if \(territoryFruitFreeSlots >= 5 && territoryFruitFreeSlots >= effDeficit\)/.test(sim));
check("e o log diz o deficit que ela alegou cobrir",
	/" cobre deficit " \+ effDeficit/.test(sim));
// O piso de 5 sobrevive, e o motivo original dele também: abaixo disso a fruta que resta
// não sustenta ninguém, e não vale adiar campo por meia moita.
check("o piso de 5 continua, com o porquê original preservado",
	/a fruta restante não sustenta ninguém/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
