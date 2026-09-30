/**
 * A reserva nunca para a produção; a fase automática só guarda perto de sair (29/09).
 *
 * Replay 2026-09-29_0006: "parado: sem recurso (fundeiro pede 50F 20W 30S)" com F480 no
 * estoque — a fase automática guardava 500F 500W e a madeira nunca chegou a 500. Pedido:
 * "nunca pode parar de fazer unidades, pode diminuir o tamanho dos lotes, mas não parar".
 *
 * Rodar:  node tools/test_reserva_nao_para.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("reserva nao para a producao");

// ── 1. A fase automática só entra no guardado perto de sair ────────────────────────────
const a = panel.indexOf("function pudim_AtualizarReserva() {");
const b = panel.indexOf("/** A fase sozinha, quando ligada e quando dá.");
function reserva(estoque, faseManual, quarteis) {
	if (quarteis === undefined) quarteis = 1;
	const ctx = {
		Math, PUDIM_FASE_GUARDA_FRACAO: 0.6, PUDIM_MODO_CERCO: 2, g_PudimModoTreino: 0,
		g_PudimObrasEspera: [], g_PudimPesquisasEspera: [], g_PudimCadeias: {},
		pudim_CadeiasAtivas: () => [], pudim_AtualizarBotaoPausa: () => {}, pudim_Log: () => {},
		GetSimState: () => ({ players: { 1: { resourceCounts: estoque } } }),
		Engine: {
			GetPlayerID: () => 1,
			ConfigDB_GetValue: (u, k) => (k === "pudim.reserva.faseauto" ? "true" :
				k === "pudim.reserva.fase" ? String(!!faseManual) : ""),
			GuiInterfaceCall: (n, d) => n === "pudim_ContarQuarteis" ? (d && d.prontos ? quarteis : 99) :
				({ fase: { tech: "phase_town_brit", custo: { food: 500, wood: 500 }, pronto: true, cc: 150 } })
		}
	};
	vm.createContext(ctx);
	vm.runInContext("var g_PudimGuardado;\n" + panel.slice(a, b) + "\npudim_AtualizarReserva(); this.g = g_PudimGuardado;", ctx);
	return ctx.g;
}
let g = reserva({ food: 480, wood: 126 });
check("0006: F480 W126 — a madeira não tem 60% da fase: nada guardado", !g.total.food && !g.total.wood,
	JSON.stringify(g.total));
check("mas a fase continua conhecida (a pesquisa automática sai quando der)", g.fase && g.fase.tech === "phase_town_brit");
g = reserva({ food: 480, wood: 320 });
check("F480 W320 (tudo acima de 60%): aí guarda os 500/500", g.total.food === 500 && g.total.wood === 500);
g = reserva({ food: 480, wood: 320 }, false, 0);
check("sem quartel PRONTO: a fase automática nem guarda nem é pesquisada (29/09)",
	!g.total.food && !g.fase, JSON.stringify(g));
g = reserva({ food: 100, wood: 50 }, true);
check("reserva da fase que VOCÊ ligou: guarda desde o início, como antes", g.total.food === 500);

// ── 2. Na semeadura: sem livre, lote de 1 do estoque de verdade ────────────────────────
check("o estoque de verdade é copiado antes das reservas",
	/const resReal = \{\};\s*\n\s*for \(const k in resBruto\) resReal\[k\] = resBruto\[k\];/.test(panel));
check("e descontado junto com o livre a cada lote",
	/res\[rk\] = Math\.max\(0, \(\+res\[rk\] \|\| 0\) - td\.cost\[rk\] \* n\);\s*\n\s*resReal\[rk\] = Math\.max\(0, \(\+resReal\[rk\] \|\| 0\) - td\.cost\[rk\] \* n\);/.test(panel));
check("livre não paga nem 1 e o estoque paga: lote de 1",
	/if \(affordable <= 0 && vagasPop > 0 &&\s*\n\s*pudim_ComputeAffordableCount\(template, 1, resReal\) >= 1\) \{\s*\n\s*affordable = 1;/.test(panel));
check("e o log diz que foi a reserva", /lote de 1 com o recurso guardado: a reserva não para a produção/.test(panel));
check("o mercado só acha que faltou quando falta no estoque de verdade",
	/\(\+cF\[r\] \|\| 0\) > \(\+resReal\[r\] \|\| 0\)\) g_PudimFaltouRecursoEm\[r\] = nowQueue;/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
