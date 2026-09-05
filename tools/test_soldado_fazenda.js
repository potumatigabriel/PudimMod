/**
 * Soldado na fazenda só sai se houver aldeão para entrar.
 *
 * Relato de 05/09: "quando esta sem aldeoes, use guerreiros nas fazendas... no ultimo jogo
 * fiquei colocando la e o mod tirando".
 *
 * A regra antiga era cega em dois pontos: expulsava TODO soldado de TODA fazenda, todo
 * ciclo, mesmo sem nenhum aldeão livre para ocupar a vaga — e sem olhar se a ordem tinha
 * vindo do jogador. pudim_GetFarmBuildData era o ÚNICO módulo do mod que não recebia
 * playerOrdered (zero ocorrências na função inteira), então a regra "se um trabalhador
 * receber uma ordem do jogador, não pode receber nenhuma ordem do mod" não valia ali.
 *
 * O preço está no replay 2026-09-05_0005, contra o pand-_-, mesma civ:
 *
 *   madeira colhida  Pudim 29.811  pand 30.553   (empate)
 *   comida colhida   Pudim 17.475  pand 35.485   (metade)
 *
 * Soldado expulso da fazenda ia para a MADEIRA. Era esse o desenho da economia.
 *
 * Rodar:  node tools/test_soldado_fazenda.js
 */
"use strict";
const fs = require("fs");
// A cópia de trabalho é CRLF (autocrlf do git) e as verificações deste arquivo casam
// trechos de MAIS DE UMA LINHA, com \n literal. Sem normalizar, elas falham sem que nada
// no mod tenha mudado — foi o que deixou 8 testes vermelhos por dias. Ver
// tools/test_fim_de_linha.js, que impede a regressão.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
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

console.log("soldado na fazenda");

// ── A ordem do jogador chega até aqui ──────────────────────────────────────────────────
check("o painel envia playerOrdered ao módulo de fazendas",
	/"pudim_GetFarmBuildData",\s*\n\s*\{ "weights": g_PudimResourceWeights, "builderOrigin": g_PudimGathererRes,\s*\n\s*"playerOrdered": pudim_GetPlayerOrderedIds\(\) \}/.test(panel));
check("e a simulação a lê",
	/const playerOrderedFarm = new Set\(\(\(data && data\.playerOrdered\) \|\| \[\]\)\.map\(Number\)\);/.test(exec));
check("a expulsão consulta as duas condições",
	/const dele = playerOrderedFarm\.has\(ent\);/.test(exec) &&
	/if \(!dele && aldeoesDisponiveis > 0\) \{/.test(exec));

// ── Quem conta como aldeão disponível ──────────────────────────────────────────────────
check("soldado e cavalaria não contam como aldeão disponível",
	/if \(!cid \|\| cid\.HasClass\("CitizenSoldier"\) \|\| cid\.HasClass\("FastMoving"\)\) continue;/.test(exec));
check("aldeão sob ordem do jogador também não conta — ele não está livre",
	/if \(playerOrderedFarm\.has\(ent\)\) continue;/.test(exec));
check("aldeão ocioso conta",
	/if \(!oq \|\| oq\.length === 0\) \{ aldeoesDisponiveis\+\+; continue; \}/.test(exec));
check("e aldeão na madeira conta — é a troca que o mod quer fazer",
	/if \(rsA && rsA\.GetType\(\)\.generic === "wood"\) aldeoesDisponiveis\+\+;/.test(exec));
// Quem já está na comida NÃO conta: trocá-lo só muda a vaga de lugar.
check("aldeão que já está na comida não conta como disponível",
	!/generic === "food"\) aldeoesDisponiveis/.test(exec));

// ── O saldo é consumido ────────────────────────────────────────────────────────────────
check("cada expulsão gasta um aldeão do saldo",
	/aldeoesDisponiveis--;/.test(exec));

// ── O soldado que FICA conta como trabalhador de comida ────────────────────────────────
// Sem isto o déficit ficava inflado e o mod erguia campo para um buraco inexistente.
check("soldado que fica é contado como coletor de comida",
	/\} else \{\s*\n[\s\S]{0,600}?currentFoodGatherersCount\+\+;\s*\n\s*\}\s*\n\s*\} else \{/.test(exec));

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
function evictions(soldadosEmFazendas, aldeoesLivres, playerOrdered) {
	let saldo = aldeoesLivres;
	const out = [];
	for (const s of soldadosEmFazendas) {
		if (playerOrdered.has(s)) continue;
		if (saldo <= 0) continue;
		out.push(s);
		saldo--;
	}
	return out;
}
const SOLDADOS = [101, 102, 103, 104, 105];
const nenhum = new Set();

check("sem aldeão livre, nenhum soldado é tirado — era o caso do relato",
	evictions(SOLDADOS, 0, nenhum).length === 0);
check("com 2 aldeões livres, saem 2 e não os 5",
	evictions(SOLDADOS, 2, nenhum).length === 2,
	evictions(SOLDADOS, 2, nenhum).length + " expulsos");
check("com aldeões de sobra, todos saem — o comportamento antigo continua valendo aí",
	evictions(SOLDADOS, 10, nenhum).length === 5);

// A ordem do jogador: intocável, com ou sem aldeão sobrando.
const meus = new Set([101, 102]);
const r = evictions(SOLDADOS, 10, meus);
check("soldado que VOCÊ pôs na fazenda não sai nem com aldeões sobrando",
	r.indexOf(101) < 0 && r.indexOf(102) < 0, "saíram: " + r.join(","));
check("e os outros continuam podendo sair", r.length === 3);
check("com tudo sob ordem sua, ninguém sai",
	evictions(SOLDADOS, 10, new Set(SOLDADOS)).length === 0);

// ── O diagnóstico ──────────────────────────────────────────────────────────────────────
check("quantos aldeões livres havia entra no log, para conferir depois",
	/result\._dbg\.aldLivres = aldeoesDisponiveis;/.test(exec));

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("os números do replay ficam no código",
	/29\.811 contra 30\.553/.test(sim) && /17\.475 contra 35\.485/.test(sim));
check("e está escrito que este era o único módulo sem playerOrdered",
	/unico modulo do mod que nao recebia/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
