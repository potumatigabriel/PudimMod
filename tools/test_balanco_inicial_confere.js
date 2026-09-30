/**
 * Balanceamento inicial: espera o 1º turno e confere se a ordem pegou (29/09).
 *
 * Replays 2026-09-29_0005 e _0006: a ordem inicial saía aos 0,0s e não chegava à partida; a
 * primeira ordem de trabalho do mod era aos 9s. Roda pudim_ExecuteInitialBalance num mundo
 * falso em que a primeira ordem "se perde" (as unidades continuam ociosas).
 *
 * Rodar:  node tools/test_balanco_inicial_confere.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("balanceamento inicial confere");

const a = panel.indexOf("var g_PudimInitialFemaleDispatched");
const b = panel.indexOf("/**\n * Retorna trabalhadores do pânico às suas tarefas anteriores");
check("trecho encontrado", a > 0 && b > a);
const w = { agora: 1000000, tempo: 0, ordens: [], ociosos: [10, 11, 12, 13, 20, 21, 30] };
const ctx = {
	Date: { now: () => w.agora }, Math, Set,
	pudim_Log: () => {}, pudim_ProtectBuilder: () => {},
	pudim_Ordenar: (c) => { w.ordens.push({ t: w.agora, ids: c.entities.slice(), alvo: c.target }); return true; },
	Engine: { GuiInterfaceCall: () => ({ femaleCitizens: [10, 11, 12, 13], soldiers: [20, 21], cavalry: 30,
		berryBush: 500, tree: 600, chicken: 700, ociosos: w.ociosos.slice() }) }
};
Object.defineProperty(ctx, "g_SimState", { get: () => ({ timeElapsed: w.tempo }) });
vm.createContext(ctx);
vm.runInContext("var g_PudimBalanceUltimaLinha = null;\n" + panel.slice(a, b) +
	"\nthis.f = pudim_ExecuteInitialBalance;", ctx);

check("aos 0s de simulação: não manda nada (a ordem do 1º tique se perdia)", ctx.f() === false && w.ordens.length === 0);
w.tempo = 800; w.agora += 800;
ctx.f();
const primeira = w.ordens.length;
check("depois do 1º turno: manda aldeãs à fruta, soldados à madeira, cavalo à galinha",
	w.ordens.some(o => o.alvo === 500 && o.ids.length === 4) && w.ordens.some(o => o.alvo === 600) &&
	w.ordens.some(o => o.alvo === 700), JSON.stringify(w.ordens));
// A ordem "se perdeu": todo mundo continua ocioso.
w.agora += 1000; w.tempo += 1000;
check("1s depois, ainda parados: não repete antes de 3,5s (o árbitro barraria)", ctx.f() === false && w.ordens.length === primeira);
w.agora += 3000; w.tempo += 3000;
ctx.f();
check("3,5s+ e ainda parados: manda de novo", w.ordens.length > primeira && w.ordens.slice(primeira).some(o => o.alvo === 500));
// Agora pegou: ninguém ocioso.
w.ociosos.length = 0;
w.agora += 1000; w.tempo += 1000;
let feito = ctx.f();
w.agora += 1000; w.tempo += 1000;
feito = ctx.f() || feito;
check("com todos trabalhando, o balanceamento termina", feito === true);

check("a simulação informa quem está ocioso (UnitAI.IsIdle)",
	/result\.ociosos = \[\];[\s\S]{0,300}if \(ai && ai\.IsIdle && ai\.IsIdle\(\)\) result\.ociosos\.push\(ent\);/.test(sim));
check("a espera é maior que a reserva do árbitro", /const PUDIM_BAL_CONFERE_MS = 3500;/.test(panel) &&
	/const PUDIM_RESERVA_MS = 3000;/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
