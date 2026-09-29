/**
 * O log não repete o que não mudou (28/09).
 *
 * Medido nos logs guardados em user.cfg: "N tipo(s) fora por requisito" era 36% dos bytes,
 * DROP GATE 4,6%, HEROI sem_heroi 4%, PROP ~12%. Com o teto de 32 KB por partida, o log
 * cobria só 1 a 7 minutos — e a análise dos replays de 28/09 teve de ser feita sem ele.
 *
 * Rodar:  node tools/test_log_ruido.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8").split("\r\n").join("\n");

let fails = 0;
function check(name, cond) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++; console.log("  FAIL " + name);
}
console.log("log sem ruido");

check("fora por requisito: só quando o número muda",
	/antes - lista\.length !== g_PudimUnitForaLogado/.test(panel) && /var g_PudimUnitForaLogado = 0;/.test(panel));
check("DROP GATE: só quando o portão muda", /if \(gate !== g_PudimDropGateLogado\)/.test(panel) &&
	/var g_PudimDropGateLogado = null;/.test(panel));
check("DROP skip: mesmo motivo a cada 60s", /skip === g_PudimDropSkipLogado \? 60000 : 15000/.test(panel) &&
	/var g_PudimDropSkipLogado = null;/.test(panel));
check("HEROI: sem_heroi dito uma vez", /reason === "sem_heroi" && g_PudimHeroSemLogado\)/.test(panel) &&
	/let g_PudimHeroSemLogado = false;/.test(panel));
check("PROP: mesma escolha a cada 60s, escolha nova a cada 20s", /\(mudou \? 20000 : 60000\)/.test(panel) &&
	/var g_PudimPropDiagEscolha = \{\};/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
