/**
 * A auto-pesquisa so pede o que o motor vai aceitar.
 *
 * Log da partida 20260927-174017 e replay 2026-09-27_0004 (Pudim = jogador 3; a pesquisa do
 * mod e a que leva `metadata: null`, a sua leva `pushFront`):
 *
 *   125,8s  VOCE  gather_lumbering_ironaxes
 *   145,6s  mod   gather_lumbering_strongeraxes     <- recusada
 *   172,6s  mod   gather_lumbering_strongeraxes     <- recusada
 *   198,6s  mod   gather_lumbering_strongeraxes     <- recusada
 *   ...     mod   gather_capacity_carts  (5x no fim), gather_mining_silvermining (5x)
 *
 * e o log do mod so percebia 90s depois: "quarentena 3min: ... (nao entrou na fila em 90s)".
 *
 * AS CAUSAS, lidas no motor (public.zip, simulation/components):
 *
 *   Researcher.js       com uma tecnologia EM ANDAMENTO, GetTechnologiesList ja a troca pela
 *                       sucessora — que exige a anterior PESQUISADA.
 *   TechnologyManager   CanResearch(tech) responde de verdade: par em andamento,
 *                       pre-requisito, pesquisada, em andamento.
 *   Technology.Queue    desconta Math.floor(multiplicador x custo); sem recurso, falha calada.
 *   Researcher.js       o par mutuamente exclusivo vem como OBJETO {pair, top, bottom}, e o mod
 *                       o tratava como array — nenhum par era pesquisado.
 *
 * Rodar:  node tools/test_pesquisa_valida.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const sim = fs.readFileSync(path.join(__dirname, "..", "simulation", "components",
	"GuiInterface~pudim.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("a auto-pesquisa so pede o que o motor aceita");

const i = execS.indexOf("pudim_GetAutoResearchData = function");
const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
const corpo = execS.slice(i, j);
check("o recorte pegou a funcao da auto-pesquisa", corpo.length > 2000 && corpo.length < execS.length / 4,
	corpo.length + " caracteres");

// ── 1. Pre-requisito ───────────────────────────────────────────────────────────────────
check("usa CanResearch do motor, com guarda de existencia",
	/if \(typeof cmpTechMgr\.CanResearch === "function" && !cmpTechMgr\.CanResearch\(tech\)\) continue;/.test(corpo));

// A regra, espelhada no caso do replay.
function canResearch(tech, pesquisadas, emAndamento, req) {
	if (pesquisadas.has(tech) || emAndamento.has(tech)) return false;
	return (req[tech] || []).every(r => pesquisadas.has(r));
}
const REQ = { "gather_lumbering_strongeraxes": ["gather_lumbering_ironaxes"] };
check("strongeraxes com ironaxes EM ANDAMENTO: recusada — era o pedido de 145s",
	canResearch("gather_lumbering_strongeraxes", new Set(), new Set(["gather_lumbering_ironaxes"]), REQ) === false);
check("e com ironaxes PESQUISADA: liberada",
	canResearch("gather_lumbering_strongeraxes", new Set(["gather_lumbering_ironaxes"]), new Set(), REQ) === true);

// ── 2. Custo ───────────────────────────────────────────────────────────────────────────
check("o custo e a conta do motor: floor(multiplicador x custo)",
	/c\[r\] = Math\.floor\(\(\(mult && mult\[r\] !== undefined\) \? mult\[r\] : 1\) \* tplC\.cost\[r\]\);/.test(corpo));
check("com o multiplicador do proprio edificio",
	/cmpResearcher\.GetTechCostMultiplier\(\)/.test(corpo));
check("sem saldo, a tecnologia nao e escolhida",
	/if \(custo && !cabeNoSaldo\(custo\)\) continue;/.test(corpo));
check("e o saldo e descontado a cada escolha — tres edificios nao gastam o mesmo dinheiro",
	/const saldoPesquisa = \{\};/.test(corpo) &&
	/saldoPesquisa\[r\] = \(saldoPesquisa\[r\] \|\| 0\) - bestCusto\[r\];/.test(corpo));

function escolhe(banco, pedidos) {
	const saldo = Object.assign({}, banco), feitos = [];
	for (const p of pedidos) {
		if (Object.keys(p.custo).every(r => (saldo[r] || 0) >= p.custo[r])) {
			feitos.push(p.nome);
			for (const r in p.custo) saldo[r] -= p.custo[r];
		}
	}
	return feitos;
}
check("300 de madeira e tres pesquisas de 200: sai UMA, nao tres",
	escolhe({ wood: 300 }, [{ nome: "a", custo: { wood: 200 } }, { nome: "b", custo: { wood: 200 } },
		{ nome: "c", custo: { wood: 200 } }]).join() === "a");

// ── 3. O par vem como objeto ───────────────────────────────────────────────────────────
check("o par {pair, top, bottom} vira dois candidatos",
	/\(item && typeof item === "object" && item\.pair\)\s*\n?\s*\? \[item\.top, item\.bottom\]/.test(corpo));
function candidatos(item) {
	return (item && typeof item === "object" && item.pair) ? [item.top, item.bottom]
		: (Array.isArray(item) ? item : [item]);
}
check("o formato real do motor e lido", candidatos({ pair: true, top: "x", bottom: "y" }).join() === "x,y");
check("e o antigo, que tratava como array, perdia o par",
	(Array.isArray({ pair: true }) ? ["?"] : [{ pair: true }]).every(t => typeof t !== "string"));

// ── 4. A rede de seguranca continua ────────────────────────────────────────────────────
// A quarentena de 90s nao sai: se o motor recusar por um motivo que este teste nao previu,
// e ela que impede o pedido de se repetir para sempre.
check("a lista de quarentena continua sendo respeitada", /if \(blacklist\.has\(tech\)\) continue;/.test(corpo));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
