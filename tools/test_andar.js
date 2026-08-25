/**
 * Orçamento de caminhada: um único controle para todos os sistemas que mandam andar.
 *
 * O número que motivou isto, medido no replay de 24/08: **65% das reordenações de kite
 * aconteciam em menos de 6 s** — apesar de o kite ter cooldown de 6 s por unidade.
 *
 * O cooldown funcionava. Ele só não era o único sistema mandando. Kite, fuga do pânico,
 * abrigo e auto-retirada tinham cada um o SEU mapa de controle, e nenhum enxergava o outro:
 *
 *     g_PudimKiting[id]            cooldown de 6 s
 *     g_PudimFleeAt[id]            cooldown de 5 s
 *     g_PudimRetreating[id]        sem timestamp nenhum
 *     g_PudimPanicGarrisoned[id]   sem timestamp nenhum
 *
 * A unidade recebia um walk do kite e 1 s depois um walk da fuga. Cada walk cancela o
 * anterior, então ela andava um segundo para o primeiro destino, virava, e não chegava a
 * lugar nenhum. É a mesma classe de erro dos três sistemas de economia empurrando o mesmo
 * trabalhador em direções opostas, e na tela é o que o jogador chamou de "bagunçando
 * durante a luta".
 *
 * O que este teste protege é o cuidado que a solução exige: um cooldown único e cego
 * SERIA PIOR. Fugir da morte é mais urgente que reposicionar, e segurar uma fuga por causa
 * de um kite de 1 s atrás mata a unidade. Por isso cada emissor tem prioridade, e urgência
 * maior nunca espera.
 *
 * Rodar:  node tools/test_andar.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const panel = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("orcamento de caminhada");

// ── Todo emissor de walk passa pelo orçamento ──────────────────────────────────────────
// Esta é a asserção que impede a regressão silenciosa: alguém adiciona um sistema novo que
// manda andar, esquece de registrar, e o problema volta sem nenhum sinal.
const walks = (panel.match(/"type": "walk"/g) || []).length;
const podes = (panel.match(/pudim_PodeAndar\(/g) || []).length;
const regs = (panel.match(/pudim_RegistrarAndada\(/g) || []).length;
check("cada emissor de walk consulta o orçamento", podes >= walks,
	walks + " walks, " + podes + " consultas");
check("e cada um registra que a ordem saiu", regs >= walks,
	walks + " walks, " + regs + " registros");

check("as prioridades existem e são distintas", (function() {
	const nomes = ["FUGIR", "ABRIGO", "RETIRAR", "KITE", "HEROI"];
	const vals = nomes.map(n => {
		const m = new RegExp("const PUDIM_ANDAR_" + n + "\\s*=\\s*(\\d+);").exec(panel);
		return m ? +m[1] : null;
	});
	return vals.every(v => v !== null) && new Set(vals).size === nomes.length;
})());

const PRI = {};
for (const n of ["FUGIR", "ABRIGO", "RETIRAR", "KITE", "HEROI"])
	PRI[n] = +new RegExp("const PUDIM_ANDAR_" + n + "\\s*=\\s*(\\d+);").exec(panel)[1];
const MIN = +/const PUDIM_ANDAR_MIN_ENTRE = (\d+);/.exec(panel)[1];

// A ordem das prioridades não é gosto: é o custo de ignorar cada uma. Ignorar uma fuga mata
// a unidade; ignorar um reposicionamento de herói não custa nada.
check("fugir é a prioridade mais alta", PRI.FUGIR > PRI.ABRIGO && PRI.FUGIR > PRI.RETIRAR);
check("abrigo vem acima de retirada", PRI.ABRIGO > PRI.RETIRAR);
check("retirada vem acima de kite", PRI.RETIRAR > PRI.KITE);
check("posicionar o herói é o que menos urge", PRI.HEROI < PRI.KITE);

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
function fazer() {
	const mapa = {};
	return {
		pode: (id, pri, agora) => {
			const u = mapa[id];
			if (!u) return true;
			if (pri > u.pri) return true;
			return (agora - u.em) >= MIN;
		},
		reg: (id, pri, agora) => { mapa[id] = { em: agora, pri: pri }; },
		mapa: mapa
	};
}

let o = fazer();
check("unidade nunca ordenada pode andar", o.pode(1, PRI.KITE, 1000));

// O caso exato do replay: kite ordena, e 1 s depois a fuga precisa passar.
o = fazer();
o.reg(1, PRI.KITE, 1000);
check("logo apos um kite, OUTRO kite espera", !o.pode(1, PRI.KITE, 1500));
check("mas a fuga passa na hora — segurar uma fuga mata a unidade",
	o.pode(1, PRI.FUGIR, 1500));
check("a retirada tambem passa, e mais urgente que kite",
	o.pode(1, PRI.RETIRAR, 1500));
check("o heroi NAO passa: ele e menos urgente que o kite",
	!o.pode(1, PRI.HEROI, 1500));

// E o inverso: depois de uma fuga, nada de menor urgência atrapalha.
o = fazer();
o.reg(1, PRI.FUGIR, 1000);
check("depois de uma fuga, o kite nao a interrompe", !o.pode(1, PRI.KITE, 1500));
check("nem a retirada", !o.pode(1, PRI.RETIRAR, 1500));
check("nem outra fuga logo em seguida", !o.pode(1, PRI.FUGIR, 1500));
check("mas passado o intervalo, tudo volta a poder",
	o.pode(1, PRI.KITE, 1000 + MIN) && o.pode(1, PRI.FUGIR, 1000 + MIN));

// Unidades diferentes não se atrapalham.
o = fazer();
o.reg(1, PRI.FUGIR, 1000);
check("o orcamento e por unidade, nao global", o.pode(2, PRI.KITE, 1100));

// ── O número escolhido ─────────────────────────────────────────────────────────────────
// Precisa ser maior que o tempo que o motor leva para virar a unidade e ela sair do lugar,
// senão o walk novo chega antes de o anterior valer alguma coisa — que é o desperdício. E
// menor que os cooldowns próprios dos sistemas, senão vira o freio de tudo e engessa a
// reação.
check("o intervalo cobre o tempo de a unidade sair do lugar", MIN >= 1500, MIN);
check("e e menor que o cooldown proprio do kite (6s)", MIN < 6000, MIN);
check("e menor que o da fuga (5s)", MIN < 5000, MIN);

// ── Os cooldowns antigos continuam existindo ───────────────────────────────────────────
// Este orçamento resolve o que nenhum deles podia ver — o outro sistema —, e não substitui
// nenhum. Tirar os antigos deixaria cada sistema livre para se reordenar a cada 2,5 s.
check("o cooldown de 6s do kite continua la", /g_PudimKiting\[ent\] > 6000/.test(panel));
check("o de 5s da fuga tambem", /g_PudimFleeAt\[worker\.id\] \|\| 0\) > 5000/.test(panel));

// ── Sem vazamento ──────────────────────────────────────────────────────────────────────
// 200 de população numa partida longa, com unidades morrendo e nascendo, enche o mapa de
// entradas de quem nao existe mais.
check("entradas velhas sao descartadas", /function pudim_LimparAndadas/.test(panel));
check("e a limpeza e chamada de verdade", /pudim_LimparAndadas\(now\);/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
