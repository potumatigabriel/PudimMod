/**
 * Testa a trava que impede o mod de mandar gente trabalhar no meio da batalha.
 *
 * Relato de 24/08: "no meio da batalha as unidades tao indo embora trabalhar".
 * O log da partida mostra o mecanismo:
 *
 *   1194.0s [PANIC] defendendo com 28 inimigo(s), protegendo trabalhadores
 *   1250.9s [PANIC] ameaça encerrada, retornando 152 unidade(s) ao trabalho
 *
 * 152 unidades devolvidas ao trabalho 57s depois de detectar 28 inimigos. A
 * liberação exigia 10s sem inimigo PERTO DA BASE — e a base fica calma assim que
 * a briga se desloca, seja porque avançamos, seja porque o inimigo recuou puxando
 * nosso exército atrás. underAttack olha o entorno da base; faltava olhar a batalha.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const RAIZ = path.join(__dirname, "..");
const SIM = fs.readFileSync(
	path.join(RAIZ, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const PANEL_SRC = fs.readFileSync(
	path.join(RAIZ, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("trava de combate");

// ── 1. A simulacao passa a reportar combate, separado de underAttack ───────────────────
check("pudim_GetPanicData devolve emCombate", /emCombate: false,/.test(SIM));
check("conta unidade NOSSA com ordem de Attack",
	/if \(ord && ord\.type === "Attack"\) \{ result\.emCombate = true; break; \}/.test(SIM));
check("conta tambem inimigo atacando algo nosso (pega quem so apanha)",
	/if \(own && own\.GetOwner\(\) === player\) \{ result\.emCombate = true; break; \}/.test(SIM));
check("e separado de underAttack, que segue olhando o entorno da base",
	SIM.indexOf("result.underAttack = true;") > 0);

// ── 2. O painel trava a soltura enquanto ha combate ────────────────────────────────────
check("o painel guarda o estado de combate", /g_PudimEmCombate = !!panicData\.emCombate;/.test(PANEL_SRC));
check("a soltura automatica para durante a batalha",
	/if \(!manual && g_PudimEmCombate\) \{/.test(PANEL_SRC));
check("a trava vem ANTES da trava de sem-CC (batalha manda primeiro)",
	PANEL_SRC.indexOf("if (!manual && g_PudimEmCombate) {") <
	PANEL_SRC.indexOf("if (!manual && (g_PudimNoCivCentre"));
check("o log da trava sai uma vez por batalha, nao a cada tique",
	/if \(!g_PudimHoldCombateLogged\)/.test(PANEL_SRC));

// ── 3. Comportamento: roda a funcao REAL de soltura ────────────────────────────────────
const inicio = PANEL_SRC.indexOf("function pudim_ReturnPanicUnitsToWork(manual)");
const fimMarca = 'if (statusEl) statusEl.caption = "Situação: Calma";\n\treturn true;\n}';
const fim = PANEL_SRC.indexOf(fimMarca, inicio);
if (inicio < 0 || fim < 0) {
	console.error("FALHA: não achei pudim_ReturnPanicUnitsToWork");
	process.exit(1);
}
const bloco = PANEL_SRC.slice(inicio, fim + fimMarca.length);

const posted = [];
const sandbox = {
	Engine: {
		PostNetworkCommand: c => posted.push(c),
		TryGetGUIObjectByName: () => ({ caption: "" })
	},
	pudim_Log: () => {},
	GetEntityState: () => null,
	Date: Date, Object: Object, Math: Math,
	g_PudimEmCombate: false,
	g_PudimHoldCombateLogged: false,
	g_PudimNoCivCentre: false,
	g_PudimSheltersUnderSiege: 0,
	g_PudimHoldGarrisonLogged: false,
	g_PudimPanicMode: true,
	g_PudimPanicFull: true,
	g_PudimPanicLastThreat: 1000,
	g_PudimPanicModeStartTime: 1000,
	g_PudimPanicGarrisoned: {},
	g_PudimPanicPreTask: {},
	g_PudimLastReleaseTime: {}
};
vm.createContext(sandbox);
vm.runInContext(bloco, sandbox);

function preparar(estado) {
	Object.assign(sandbox, {
		g_PudimEmCombate: false,
		g_PudimHoldCombateLogged: false,
		g_PudimNoCivCentre: false,
		g_PudimSheltersUnderSiege: 0,
		g_PudimHoldGarrisonLogged: false,
		g_PudimPanicMode: true,
		g_PudimPanicGarrisoned: { 7: { shelterID: 70 }, 8: { shelterID: 70 } },
		g_PudimPanicPreTask: {},
		g_PudimLastReleaseTime: {}
	}, estado || {});
	posted.length = 0;
}

// O caso do bug: base calma, batalha rolando.
preparar({ g_PudimEmCombate: true });
check("batalha em curso recusa a soltura", sandbox.pudim_ReturnPanicUnitsToWork() === false);
check("e ninguem e desguarnecido", posted.length === 0, JSON.stringify(posted));
check("o panico continua ativo", sandbox.g_PudimPanicMode === true);

// Batalha acabou: solta normalmente.
preparar();
check("sem batalha a soltura funciona", sandbox.pudim_ReturnPanicUnitsToWork() === true);
check("e desguarnece quem estava abrigado", posted.length === 2, posted.length);

// O jogador manda soltar: a trava nao vale para ele.
preparar({ g_PudimEmCombate: true });
check("o botao do jogador solta mesmo em batalha",
	sandbox.pudim_ReturnPanicUnitsToWork(true) === true && posted.length === 2,
	posted.length);

// Uma trava nao anula a outra: sem CC continua segurando mesmo fora de combate.
preparar({ g_PudimNoCivCentre: true });
check("sem centro civico continua segurando", sandbox.pudim_ReturnPanicUnitsToWork() === false);

// E o log da batalha sai uma vez, nao a cada tique.
preparar({ g_PudimEmCombate: true });
let linhas = 0;
sandbox.pudim_Log = () => { linhas++; };
for (let i = 0; i < 25; ++i) sandbox.pudim_ReturnPanicUnitsToWork();
check("25 tiques de batalha geram 1 linha de log", linhas === 1, linhas);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
