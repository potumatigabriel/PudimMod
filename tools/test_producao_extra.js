/**
 * Recurso sobrando com todo quartel ocupado: avisa, e com a opção ligada constrói mais um (28/09).
 *
 * Replays de 28/09: 2 quartéis a partida inteira no 0007; no 0008, 2 até os 17,5 min e nenhum
 * estábulo, com o estoque passando de 3 a 5 mil. Roda pudim_ChecarProducaoExtra num mundo falso.
 *
 * Rodar:  node tools/test_producao_extra.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("producao extra");

const a = panel.indexOf("const PUDIM_PRODUCAO_SOBRA");
const b = panel.indexOf("/**\n * Constrói fazendas perto do CC");
function mundo(o) {
	o = Object.assign({ auto: false, atrasada: "units/gaul/infantry_spearman_b", estabulo: true }, o || {});
	const w = { avisos: [], logs: [] };
	const series = {};
	const ctx = {
		Math,
		g_PudimQuartelDisponiveis: o.estabulo ? ["quartel", "estabulo"] : ["quartel"],
		pudim_SerieEstado: t => (series[t] = series[t] || { ativo: false }),
		pudim_ProporcaoAtiva: () => true,
		pudim_UnidadeMaisAtrasada: () => ({ tpl: o.atrasada }),
		pudim_QuartelNome: t => t,
		pudim_QuartelAtualizarLabel: () => {},
		pudim_Log: (l, c, m) => w.logs.push(m),
		Engine: {
			ConfigDB_GetValue: (u, k) => (k === "pudim.producao.auto" ? String(o.auto) : ""),
			GuiInterfaceCall: (n, d) => { if (n === "pudim_PushNotification") w.avisos.push(d.message); }
		}
	};
	vm.createContext(ctx);
	vm.runInContext(panel.slice(a, b) + "\nthis.f = pudim_ChecarProducaoExtra;", ctx);
	// No jogo a primeira chamada vem com Date.now() enorme; aqui o relógio começa perto de 0.
	ctx.g_PudimProducaoUltima = -1e9;
	return { f: ctx.f, w, series };
}
const quartel = (ocupado) => ({ isCC: false, trainerEntities: ["units/gaul/infantry_spearman_b"],
	trainingQueue: ocupado ? [{}] : [] });
const cc = { isCC: true, trainerEntities: ["units/gaul/support_female_citizen", "units/gaul/infantry_spearman_b"], trainingQueue: [] };
const rico = { food: 800, wood: 900, stone: 300, metal: 200 };

{
	const m = mundo();
	const bs = [cc, quartel(true), quartel(true)];
	check("sobra há pouco: ainda não", m.f(bs, rico, 10, 100000) === null);
	check("sobra por 1 minuto, todos ocupados: avisa o quartel", m.f(bs, rico, 10, 161000) === "quartel" &&
		/construa mais 1 quartel/.test(m.w.avisos[0] || ""), m.w.avisos.join("|"));
	check("opção desligada: só avisa, não começa série", !(m.series.quartel && m.series.quartel.ativo));
	check("e não repete antes de 2 min", m.f(bs, rico, 10, 200000) === null);
}
{
	const m = mundo();
	m.f([quartel(true), quartel(false)], rico, 10, 1000);
	check("um quartel livre: não pede outro", m.f([quartel(true), quartel(false)], rico, 10, 71000) === null);
	m.f([quartel(true)], rico, 0, 1000);
	check("sem vaga de população: mais quartel não adianta", m.f([quartel(true)], rico, 0, 71000) === null);
	m.f([quartel(true)], { food: 3000, wood: 100 }, 10, 1000);
	check("sem madeira para a obra: não", m.f([quartel(true)], { food: 3000, wood: 100 }, 10, 71000) === null);
}
{
	const m = mundo({ auto: true, atrasada: "units/gaul/cavalry_javelineer_b" });
	m.f([quartel(true)], rico, 10, 1000);
	check("opção ligada, cavalaria atrasada: série de 1 estábulo", m.f([quartel(true)], rico, 10, 62000) === "estabulo" &&
		m.series.estabulo.ativo && m.series.estabulo.alvo === 1);
	const n = mundo({ auto: true, atrasada: "units/gaul/cavalry_javelineer_b", estabulo: false });
	n.f([quartel(true)], rico, 10, 1000);
	check("sem estábulo disponível (fase): quartel", n.f([quartel(true)], rico, 10, 62000) === "quartel");
	const s = mundo({ auto: true });
	s.series.quartel = { ativo: true };
	s.f([quartel(true)], rico, 10, 1000);
	check("série de quartel já rodando: não empilha outra", s.f([quartel(true)], rico, 10, 62000) === null);
}

check("chamado no fim do ciclo da fila, com o saldo do ciclo",
	/try \{ pudim_ChecarProducaoExtra\(buildings, res, vagasPop, nowQueue\); \} catch \(e\) \{\}/.test(panel));
const op = opts[0].options.find(x => x.config === "pudim.producao.auto");
check("a opção existe, em pt e en", !!op && /quartel/.test(op.label) && /barracks/.test(op.label_en));
const merc = opts[0].options.find(x => x.config === "pudim.mercado.auto");
check("o texto do mercado fala em 75 (e 60 só no urgente)", /75 por 100/.test(merc.tooltip) && /75 for every 100/.test(merc.tooltip_en));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
