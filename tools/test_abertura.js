/**
 * A abertura da partida: 4 na fruta, 4 na madeira, o cavalo na galinha.
 *
 * Pedido de 14/09: "o inicio tm que ser 4 trabalhadores nas frutas e 4 guerreiras na madeira
 * e o cavalo nas galinhas".
 *
 * A abertura JA EXISTIA e funciona — o log da partida 20260914-193640 mostra ela achando
 * tudo no primeiro decimo de segundo:
 *
 *   0,1s  BALANCE  fc=4 sol=4 cav=191 berry=200 tree=194 chicken=208
 *
 * O que a desmontava vinha DEPOIS, no mesmo log:
 *
 *   14,2s CASAS    build em (265,843) builders=2 de=wood
 *
 * A casa automatica levava DOIS dos oito, segundos depois de eles receberem a ordem de
 * coleta — e eles estavam protegidos por 15s (artesas) e 20s (soldados e cavalo). A
 * protecao existia e era respeitada pelo auto-trabalho e pelo armazem; a casa era a unica
 * obra que nao recebia a lista.
 *
 * Este teste prende as duas pontas: a abertura em si e a protecao contra a casa.
 *
 * Rodar:  node tools/test_abertura.js
 */
"use strict";
const fs = require("fs");
// A copia de trabalho e CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("a abertura da partida");

// ── 1. Os tres destinos ────────────────────────────────────────────────────────────────
// A simulacao SO OLHA: quem manda comando e o painel. Ela separa os tres grupos e acha os
// tres alvos; sem qualquer um dos seis, a abertura pedida nao existe.
const corpoIni = (function() {
	const i = execS.indexOf("pudim_GetInitialBalanceData = function");
	const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
	return j < 0 ? execS.slice(i) : execS.slice(i, j);
})();
check("o recorte pegou a funcao da abertura, e nao o arquivo todo",
	corpoIni.length > 500 && corpoIni.length < execS.length / 3, corpoIni.length + " caracteres");
for (const campo of ["femaleCitizens", "soldiers", "cavalry", "berryBush", "tree", "chicken"])
	check("a simulacao devolve " + campo, corpoIni.indexOf(campo) > 0);

check("trabalhador e quem colhe e nao e soldado nem montado",
	/HasClass\("FemaleCitizen"\)/.test(corpoIni) &&
	/IID_ResourceGatherer/.test(corpoIni));
check("o cavalo e a unidade rapida", /HasClass\("FastMoving"\)/.test(corpoIni));
// Fruta e carne sao os dois "food" do inicio; sem o `specific` os dois viram o mesmo alvo.
check("a fruta e food/fruit",
	/generic === "food" && resType\.specific === "fruit"/.test(corpoIni));
check("a galinha e food/meat",
	/generic === "food" && resType\.specific === "meat"/.test(corpoIni));
// Urso e lobo tambem sao carne. Mandar o cavalo sozinho num predador e perde-lo aos 20s.
check("e predador nao conta como galinha", /HasClass\("Predator"\)\) continue;/.test(corpoIni));

// ── 2. Quem manda ──────────────────────────────────────────────────────────────────────
const corpoExec = (function() {
	const i = execP.indexOf("function pudim_ExecuteInitialBalance()");
	let nivel = 0;
	const j = execP.indexOf("{", i);
	for (let k = j; k < execP.length; k++) {
		if (execP[k] === "{") nivel++;
		else if (execP[k] === "}") { nivel--; if (nivel === 0) return execP.slice(i, k + 1); }
	}
	return execP.slice(i);
})();
check("o recorte pegou a funcao do painel",
	corpoExec.length > 500 && corpoExec.length < execP.length / 3,
	corpoExec.length + " caracteres");
const alvos = [...corpoExec.matchAll(/"target": data\.(\w+)/g)].map(m => m[1]);
check("os tres destinos sao mandados, e sao estes tres",
	alvos.join(",") === "berryBush,tree,chicken", alvos.join(", "));
check("e a ordem e de coletar", (corpoExec.match(/"type": "gather"/g) || []).length === 3);

// ── 3. A protecao, que e o que faltava ─────────────────────────────────────────────────
check("os tres grupos saem protegidos",
	(corpoExec.match(/pudim_ProtectBuilder\(/g) || []).length >= 3);
check("a casa automatica recebe a lista de protegidos",
	/pudim_GetAutoHouseData", \{[\s\S]{0,160}protectedIds: pudim_GetProtectedBuilderIds\(\)/.test(execP));
check("e a simulacao da casa a usa para descartar candidato",
	/const protectedHouseIds = new Set\(\(\(data && data\.protectedIds\) \|\| \[\]\)\.map\(Number\)\);/.test(execS) &&
	/if \(protectedHouseIds\.has\(ent\)\) continue;/.test(execS));

// A regra, espelhada: protegido nunca entra na lista de construtores.
function candidatos(todos, protegidos) {
	const p = new Set(protegidos);
	return todos.filter(e => !p.has(e));
}
const ABERTURA = [11, 12, 13, 14, 21, 22, 23, 24, 31];   // 4 + 4 + 1, como no log
check("com a abertura inteira protegida, a casa nao acha construtor",
	candidatos(ABERTURA, ABERTURA).length === 0);
check("e assim que a protecao expira eles voltam a valer",
	candidatos(ABERTURA, []).length === 9);
check("um trabalhador nascido depois nao esta protegido e pode erguer a casa",
	candidatos(ABERTURA.concat([99]), ABERTURA).join() === "99");

// ── A procedencia ──────────────────────────────────────────────────────────────────────
check("a medicao do log fica no codigo, com a linha que denuncia",
	/builders=2/.test(sim) && /20260914-193640/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
