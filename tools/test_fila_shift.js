/**
 * Fila com shift: o mod nao entra no meio dela.
 *
 * Relato de 28/09: "quando dou ordens as unidades segurando shift, cria uma fila no 0ad, as
 * vezes o mod quando acaba a primeira ordem, ja manda fazer outra coisa".
 *
 * MEDIDO em setembro (8.527 filas suas; ordem sua = com `formation`/`pushFront`, conferido no
 * motor): o mod entrou em 29% delas antes de voce mandar de novo.
 *
 *   construir+coletar 439 | entregar+coletar 281 | reparar+coletar 265
 *   quem entrou: auto-trabalho 1.642, panico 449, construtor 378
 *   29% das entradas chegaram DEPOIS dos 2 min de protecao
 *   76% das do auto-trabalho com populacao 140+ — a faixa do rebalanceamento
 *
 * QUATRO FUROS, quatro correcoes:
 *   1. a protecao contava 2 min do ULTIMO clique; fila longa sobrevivia ao relogio
 *   2. construir e muralha (tryPlaceBuilding/tryPlaceWall) nao passavam pelo gancho
 *   3. o rebalanceamento puxava candidatos de `activeGatherers` sem checar ordem sua
 *   4. construtor de casa e de armazem nao recebiam a lista de ordens suas
 *
 * Fato do motor que sustenta a regra (UnitAI.js, FinishOrder): com fila, a unidade passa a
 * proxima ordem NA HORA; isIdle so vira verdadeiro com a fila vazia. Logo "protegida ate
 * ficar ociosa" e o mesmo que "protegida enquanto tiver fila sua".
 *
 * Rodar:  node tools/test_fila_shift.js
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

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sess = fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// Extrai uma funcao de topo contando chaves.
function funcao(src, nome) {
	const i = src.indexOf("function " + nome + "(");
	if (i < 0) return "";
	let d = 0;
	for (let k = src.indexOf("{", i); k < src.length; k++) {
		if (src[k] === "{") d++;
		else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
	}
	return "";
}

console.log("fila com shift");

// ── A logica de verdade, num sandbox ───────────────────────────────────────────────────
let agora = 0;
const teclas = {};
const sb = {
	Date: { now: () => agora },
	Engine: { HotkeyIsPressed: h => !!teclas[h] },
	g_Selection: { toList: () => selecao.slice() },
	g_PudimPlayerOrders: {}
};
let selecao = [];
vm.createContext(sb);
const consts = ["PUDIM_PLAYER_ORDER_PROTECTION", "PUDIM_PLAYER_QUEUE_PROTECTION"]
	.map(c => (panel.match(new RegExp("const " + c + " = \\d+;")) || [""])[0]).join("\n");
check("as duas protecoes estao declaradas no painel", !/^\n|\n$/.test(consts) && consts.split("\n").length === 2);
vm.runInContext(consts + "\nvar g_PudimPlayerQueued = {};\n" +
	funcao(sess, "pudim_MarcarOrdemDoJogador") + "\n" + funcao(panel, "pudim_GetPlayerOrderedIds") +
	"\nthis.PROT = PUDIM_PLAYER_ORDER_PROTECTION; this.PROT_FILA = PUDIM_PLAYER_QUEUE_PROTECTION;", sb);
const marcar = () => vm.runInContext("pudim_MarcarOrdemDoJogador()", sb);
const protegidos = () => vm.runInContext("pudim_GetPlayerOrderedIds()", sb);
const zera = () => { vm.runInContext("g_PudimPlayerOrders = {}; g_PudimPlayerQueued = {};", sb); for (const k in teclas) delete teclas[k]; };
const MIN = 60000;

check("a ordem simples continua protegida por 2 minutos", sb.PROT === 2 * MIN, sb.PROT);
check("a fila ganha uma rede bem maior (a regra real e 'ate ficar ociosa')", sb.PROT_FILA >= 5 * MIN, sb.PROT_FILA);

// 1. Ordem simples: como sempre foi.
zera(); agora = 0; selecao = [10];
marcar();
agora = 1 * MIN;
check("ordem simples: protegida com 1 min", protegidos().indexOf(10) >= 0);
agora = 3 * MIN;
check("ordem simples: livre depois de 2 min, como antes", protegidos().indexOf(10) < 0);

// 2. Fila com shift: construir e, com shift, coletar — a cadeia mais atingida.
zera(); agora = 0; selecao = [20];
marcar();                          // construir, sem shift
agora = 4000; teclas["session.queue"] = true;
marcar();                          // coletar, com shift
delete teclas["session.queue"];
agora = 3 * MIN;
check("fila com shift: AINDA protegida aos 3 min — era aqui que o relogio vencia",
	protegidos().indexOf(20) >= 0);
agora = 9 * MIN;
check("e ainda aos 9 min, se a unidade continuar ocupada com ela", protegidos().indexOf(20) >= 0);
agora = 11 * MIN;
check("a rede de 10 min solta quem ficou coletando para sempre", protegidos().indexOf(20) < 0);

// 3. Ordem nova SEM shift troca a fila inteira: a fila antiga acabou.
zera(); agora = 0; selecao = [30];
teclas["session.queue"] = true; marcar(); delete teclas["session.queue"];
agora = 1000;
marcar();                          // voce muda de ideia, sem shift
agora = 3 * MIN;
check("ordem sem shift depois da fila: volta a valer os 2 min", protegidos().indexOf(30) < 0);

// 4. pushorderfront tambem e fila: executa agora e MANTEM o resto.
zera(); agora = 0; selecao = [40];
teclas["session.pushorderfront"] = true; marcar(); delete teclas["session.pushorderfront"];
agora = 3 * MIN;
check("ordem com pushorderfront conta como fila", protegidos().indexOf(40) >= 0);

// 5. A selecao inteira e marcada — com `orderone` o jogo manda so para uma, e marcar todas
// protege a mais, nunca a menos.
zera(); agora = 0; selecao = [50, 51, 52];
teclas["session.queue"] = true; marcar(); delete teclas["session.queue"];
agora = 3 * MIN;
check("todas as unidades da selecao ficam protegidas", [50, 51, 52].every(u => protegidos().indexOf(u) >= 0));

// ── Os ganchos ─────────────────────────────────────────────────────────────────────────
check("as teclas sao as que o jogo le em input.js",
	/Engine\.HotkeyIsPressed\("session\.queue"\)/.test(sess) &&
	/Engine\.HotkeyIsPressed\("session\.pushorderfront"\)/.test(sess));
check("clique direito e minimapa: o gancho de sempre, agora pela funcao comum",
	/pudim_patchApplyN\("handleUnitAction", function\(target, that, args\)\s*\{\s*try \{ pudim_MarcarOrdemDoJogador\(\); \} catch \(e\) \{\}/.test(sess));
check("CONSTRUIR tambem e registrado — tryPlaceBuilding mandava direto, sem gancho",
	/pudim_patchApplyN\("tryPlaceBuilding", function\(target, that, args\)\s*\{\s*try \{ pudim_MarcarOrdemDoJogador\(\); \} catch \(e\) \{\}/.test(sess));
check("e muralha tambem (tryPlaceWall)",
	/pudim_patchApplyN\("tryPlaceWall", function\(target, that, args\)\s*\{\s*try \{ pudim_MarcarOrdemDoJogador\(\); \} catch \(e\) \{\}/.test(sess));
check("os ganchos sempre chamam a funcao original — o mod observa, nao altera a sua ordem",
	(sess.match(/return target\.apply\(that, args\);/g) || []).length >= 3);

// ── Os sistemas que pegavam unidade sua ────────────────────────────────────────────────
check("rebalanceamento: candidato com ordem sua e pulado",
	/if \(count >= pullCount\) break;[\s\S]{0,40}if \(pudimSkipUnit\(ent, Engine\.QueryInterface\(ent, IID_UnitAI\)\)\) continue;/.test(execS));
check("construtor de casa: recebe a lista e pula quem esta ocupado com ordem sua",
	/const houseOrdered = new Set\(/.test(execS) &&
	/if \(houseOrdered\.has\(ent\) && cmpUnitAI && !cmpUnitAI\.IsIdle\(\)\) continue;/.test(execS) &&
	/threshold: g_PudimAutoHouseThreshold,[\s\S]{0,120}playerOrdered: pudim_GetPlayerOrderedIds\(\)/.test(panel));
check("armazem: recebe a lista e pula as suas",
	/const dropOrdered = new Set\(/.test(execS) && /if \(dropOrdered\.has\(ent\)\) continue;/.test(execS) &&
	/pudim_GetSmartDropsiteData", \{[\s\S]{0,120}playerOrdered: pudim_GetPlayerOrderedIds\(\)/.test(panel));

// ── Multiplayer ────────────────────────────────────────────────────────────────────────
// Tudo aqui e estado de interface: decide o que o SEU cliente deixa de mandar. Nada disto
// entra na simulacao, e todos os clientes recebem os mesmos comandos.
check("a marcacao da fila vive so na interface", !/g_PudimPlayerQueued/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
