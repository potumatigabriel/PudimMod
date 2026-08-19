/**
 * Testa a válvula de segurança do pânico com o código REAL de pudim_ReturnPanicUnitsToWork.
 *
 * Bug de 19/08: a válvula de 120s chamava a soltura e logava "forçando retorno ao trabalho"
 * sem olhar o resultado. Quando a trava de "sem CC / abrigo cercado" recusava a soltura, ela
 * não limpava g_PudimPanicModeStartTime — a condição continuava verdadeira e o timeout
 * redisparava a cada tique. Foram 119 linhas de PANIC no log, uma por 1,5s até o fim da
 * partida.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "gui", "session", "pudim_panel.js");
const src = fs.readFileSync(SRC, "utf8");

const start = src.indexOf("function pudim_ReturnPanicUnitsToWork(manual)");
const endMark = 'if (statusEl) statusEl.caption = "Situação: Calma";\n\treturn true;\n}';
const end = src.indexOf(endMark, start);
if (start < 0 || end < 0) {
	console.error("FALHA: não achei pudim_ReturnPanicUnitsToWork em pudim_panel.js");
	process.exit(1);
}
const block = src.slice(start, end + endMark.length);

const posted = [], logged = [];
const sandbox = {
	Engine: {
		PostNetworkCommand: c => posted.push(c),
		TryGetGUIObjectByName: () => ({ caption: "" })
	},
	pudim_Log: (lvl, tag, msg) => logged.push(msg),
	GetEntityState: () => null,
	Date: Date, Object: Object, Math: Math,
	// Globais que a função lê/escreve
	g_PudimNoCivCentre: false,
	g_PudimSheltersUnderSiege: 0,
	g_PudimHoldGarrisonLogged: false,
	g_PudimPanicMode: false,
	g_PudimPanicFull: false,
	g_PudimPanicLastThreat: 0,
	g_PudimPanicModeStartTime: 0,
	g_PudimPanicGarrisoned: {},
	g_PudimPanicPreTask: {},
	g_PudimLastReleaseTime: {}
};
vm.createContext(sandbox);
vm.runInContext(block, sandbox);

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("válvula de segurança do pânico");

function reset(estado) {
	Object.assign(sandbox, {
		g_PudimNoCivCentre: false,
		g_PudimSheltersUnderSiege: 0,
		g_PudimHoldGarrisonLogged: false,
		g_PudimPanicMode: true,
		g_PudimPanicFull: true,
		g_PudimPanicLastThreat: 1000,
		g_PudimPanicModeStartTime: 1000,
		g_PudimPanicGarrisoned: { 7: { shelterID: 70 } },
		g_PudimPanicPreTask: {},
		g_PudimLastReleaseTime: {}
	}, estado || {});
	posted.length = 0;
	logged.length = 0;
}

// 1. Situação normal: solta, devolve true e zera o estado do pânico.
reset();
let r = sandbox.pudim_ReturnPanicUnitsToWork();
check("soltura normal devolve true", r === true, r);
check("desguarnece quem estava abrigado",
	posted.length === 1 && posted[0].type === "unload" && posted[0].garrisonHolder === 70,
	JSON.stringify(posted));
check("zera g_PudimPanicMode", sandbox.g_PudimPanicMode === false);
check("zera g_PudimPanicModeStartTime", sandbox.g_PudimPanicModeStartTime === 0);

// 2. Abrigo cercado: recusa, devolve false, e NÃO desguarnece ninguém.
reset({ g_PudimSheltersUnderSiege: 13 });
r = sandbox.pudim_ReturnPanicUnitsToWork();
check("cerco recusa a soltura (false)", r === false, r);
check("cerco não emite unload", posted.length === 0, JSON.stringify(posted));
check("cerco mantém o pânico ativo", sandbox.g_PudimPanicMode === true);

// 3. Sem CC: mesma recusa — regra "se ficar sem cc, não pode desguarnecer".
reset({ g_PudimNoCivCentre: true });
r = sandbox.pudim_ReturnPanicUnitsToWork();
check("sem CC recusa a soltura (false)", r === false, r);
check("sem CC não emite unload", posted.length === 0);

// 4. A recusa loga UMA vez, não a cada tique — a origem do spam.
reset({ g_PudimSheltersUnderSiege: 13 });
for (let i = 0; i < 20; i++) sandbox.pudim_ReturnPanicUnitsToWork();
check("20 tiques de cerco geram 1 linha de log", logged.length === 1, logged.length);

// 5. O jogador manda soltar: a trava não vale, solta mesmo sob cerco.
reset({ g_PudimSheltersUnderSiege: 13 });
r = sandbox.pudim_ReturnPanicUnitsToWork(true);
check("manual solta mesmo sob cerco", r === true && posted.length === 1,
	r + " / " + posted.length);

// 6. O ponto do bug: a chamada da válvula precisa CONSUMIR o retorno e rearmar a janela.
//    Sem isso o timeout redispara a cada tique enquanto o cerco durar.
const valvula = src.slice(src.indexOf("PUDIM_PANIC_MAX_DURATION)) {"));
const trecho = valvula.slice(0, 900);
check("a válvula testa o retorno de pudim_ReturnPanicUnitsToWork",
	/if\s*\(pudim_ReturnPanicUnitsToWork\(\)\)/.test(trecho));
check("a válvula rearma g_PudimPanicModeStartTime quando a soltura é recusada",
	/g_PudimPanicModeStartTime\s*=\s*now;/.test(trecho));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
