/**
 * Barra de metas (28/09): roda o pudim_metas.js de verdade num jogo falso.
 *
 * Os números vêm da análise de 395 replays da A28 (ver o cabeçalho de pudim_metas.js). Este
 * teste prende a regra: ordem das metas, cores pelo ritmo, quartel pulado não trava a barra,
 * recorde só em partida justa e só jogando.
 *
 * Rodar:  node tools/test_metas.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const fonte = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_metas.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const xml = norm(fs.readFileSync(path.join(base, "gui", "session", "match_settings", "07_pudim_metas.xml"), "utf8"));
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

function jogo(o) {
	o = Object.assign({ t: 0, pop: 9, fase: "village", quarteis: 0, popMax: 200, observador: false,
	                    recurso: 300, cfg: {} }, o || {});
	const objs = {};
	const obj = n => objs[n] = objs[n] || { hidden: true, caption: "", tooltip: "", sprite: "",
		size: { left: 4, right: 4, top: 22, bottom: 27 } };
	const logs = [];
	const ctx = {
		Math, Number, String, isFinite,
		g_IsObserver: o.observador, g_ViewedPlayer: 1, g_PudimPanelOpen: false,
		g_InitAttributes: { settings: { StartingResources: o.recurso, CheatsEnabled: false, Nomad: false } },
		GetSimState: () => ({ timeElapsed: o.t * 1000, players: [null, { popCount: o.pop, phase: o.fase, popMax: o.popMax }] }),
		pudim_Log: (a, b, m) => logs.push(m),
		Engine: {
			TryGetGUIObjectByName: obj,
			GetPlayerID: () => 1,
			ConfigDB_GetValue: (_, k) => o.cfg[k] || "",
			ConfigDB_CreateValue: (_, k, v) => { o.cfg[k] = v; },
			ConfigDB_SaveChanges: () => {},
			GuiInterfaceCall: (n) => { if (n === "pudim_ContarQuarteis") return o.quarteis; throw new Error(n); }
		}
	};
	vm.createContext(ctx);
	vm.runInContext(fonte + "\nthis.api = { atualizar: pudim_AtualizarMetas, metas: PUDIM_METAS, avaliar: pudim_MetaAvaliar," +
		" refPop: pudim_MetaRefPop, feitas: () => g_PudimMetasFeitas };", ctx);
	return { o, objs, logs, api: ctx.api, passo(t, pop, extra) { o.t = t; o.pop = pop; Object.assign(o, extra || {}); ctx.api.atualizar(2000); } };
}
const corDe = j => { const s = j.objs.pudimMetasBar.sprite; return s.includes("60 190 80") ? "verde" : s.includes("220 180 50") ? "amarelo" : s.includes("210 70 60") ? "vermelho" : s.includes("90 150 220") ? "feito" : s; };

console.log("barra de metas");

// ── Os números da análise ────────────────────────────────────────────────────────────
{
	const j = jogo();
	const M = Object.fromEntries(j.api.metas.map(m => [m.id, m]));
	check("seis metas, na ordem do tempo da referência",
		j.api.metas.map(m => m.id).join() === "quartel1,quartel2,pop100,fase2,pop200,fase3" &&
		j.api.metas.every((m, i, a) => i === 0 || a[i - 1].ref <= m.ref));
	check("referência dos 20 mais rápidos a pop 200: 3:07/40, 5:35/71, 7:06, 9:09, 11:30, 12:49",
		M.quartel1.ref === 187 && M.quartel1.refPop === 40 && M.quartel2.ref === 335 && M.quartel2.refPop === 71 &&
		M.pop100.ref === 426 && M.fase2.ref === 549 && M.pop200.ref === 690 && M.fase3.ref === 769);
	check("recordes seus em multiplayer: pop 100 6:50, fase 2 7:17, pop 200 12:30, fase 3 13:02",
		M.pop100.recorde === 410 && M.fase2.recorde === 437 && M.pop200.recorde === 750 && M.fase3.recorde === 782);
	check("quartel não tem recorde (mais cedo não é melhor por si)", !M.quartel1.recorde && !M.quartel2.recorde);
	check("a curva de ritmo passa pelos pontos (5:35 → 71, 7:06 → 100)",
		Math.round(j.api.refPop(335, 9)) === 71 && Math.round(j.api.refPop(426, 9)) === 100);
}

// ── Partida andando ──────────────────────────────────────────────────────────────────
{
	const j = jogo();
	j.passo(5, 9);
	check("começo: a próxima é o 1º quartel, verde", /1º quartel/.test(j.objs.pudimMetasTxt.caption) && corDe(j) === "verde", j.objs.pudimMetasTxt.caption);
	j.passo(170, 42);
	check("pop 42 aos 2:50 sem quartel: amarelo, hora de fazer", corDe(j) === "amarelo" && /hora de fazer/.test(j.objs.pudimMetas.tooltip));
	j.passo(230, 50);
	check("passou 30 s da referência sem quartel: vermelho", corDe(j) === "vermelho");
	j.passo(240, 52, { quarteis: 1 });
	check("fez o 1º quartel: a próxima é o 2º", /2º quartel/.test(j.objs.pudimMetasTxt.caption));
	check("e o tempo e a pop ficam guardados", j.api.feitas().quartel1.t === 240 && j.api.feitas().quartel1.pop === 52);
	j.passo(300, 70, { quarteis: 2 });
	j.passo(380, 95);
	check("pop 95 aos 6:20, referência ~84: verde no ritmo", /Pop 100/.test(j.objs.pudimMetasTxt.caption) && corDe(j) === "verde");
	j.passo(390, 70);
	check("pop 70 aos 6:30 (referência ~88): vermelho", corDe(j) === "vermelho");
	j.passo(400, 100);
	check("pop 100 aos 6:40 (antes do recorde 6:50): grava novo recorde", j.o.cfg["pudim.metas.pop100"] === "400" && j.logs.some(l => /NOVO RECORDE/.test(l)));
	j.passo(420, 90);
	check("perder população depois não desfaz a meta", j.api.feitas().pop100 && /Fase 2/.test(j.objs.pudimMetasTxt.caption));
	j.passo(560, 150, { fase: "town" });
	check("fase 2 aos 9:20, pior que o recorde 7:17: não grava", j.o.cfg["pudim.metas.fase2"] === undefined && j.api.feitas().fase2);
	j.passo(690, 200); j.passo(760, 200, { fase: "city" });
	check("todas cumpridas: barra azul", corDe(j) === "feito" && /Todas as metas/.test(j.objs.pudimMetasTxt.caption));
	check("a dica lista todas com o tempo e a diferença para a referência",
		/1º quartel: 4:00 \(pop 52\)/.test(j.objs.pudimMetas.tooltip) && /\+0:53/.test(j.objs.pudimMetas.tooltip), j.objs.pudimMetas.tooltip);
}

// ── Quartel pulado, teto baixo, partida que não vale ─────────────────────────────────
{
	const j = jogo();
	j.passo(430, 101);
	check("pop 100 sem nenhum quartel: os quartéis saem da fila como pulados",
		j.api.feitas().quartel1.pulada && j.api.feitas().quartel2.pulada && /Fase 2/.test(j.objs.pudimMetasTxt.caption));
}
{
	const j = jogo({ popMax: 150 });
	j.passo(600, 150, { fase: "town", quarteis: 2 });
	check("teto de população 150: a meta de pop 200 é pulada", /Fase 3/.test(j.objs.pudimMetasTxt.caption), j.objs.pudimMetasTxt.caption);
}
{
	const j = jogo({ recurso: 1000 });
	j.passo(300, 100, { quarteis: 2 });
	check("recurso inicial 1000: não grava recorde, e a dica avisa",
		j.o.cfg["pudim.metas.pop100"] === undefined && /não vale recorde/.test(j.objs.pudimMetas.tooltip));
}
{
	const j = jogo({ observador: true });
	j.passo(300, 100, { quarteis: 2 });
	check("assistindo: mostra, mas nunca grava recorde", j.o.cfg["pudim.metas.pop100"] === undefined && j.objs.pudimMetas.hidden === false);
}
{
	const j = jogo({ cfg: { "pudim.metas.mostrar": "false" } });
	j.passo(10, 9);
	check("desligada nas opções: some", j.objs.pudimMetas.hidden === true);
}

// ── Tela, tique e simulação ──────────────────────────────────────────────────────────
check("a barra do XML bate com PUDIM_METAS_BAR_X1/X2 (4..224)",
	/name="pudimMetasBarBg" type="image" ghost="true" size="4 22 224 27"/.test(xml) &&
	/const PUDIM_METAS_BAR_X1 = 4;/.test(fonte) && /const PUDIM_METAS_BAR_X2 = 224;/.test(fonte));
check("fica à esquerda da coluna de pesquisas do jogo (100%-48)", /name="pudimMetas"[^>]*size="100%-280 40 100%-52 70"/.test(xml));
check("some com o painel aberto", /g_PudimPanelOpen\)\) \{\s*\n\s*raiz\.hidden = true;/.test(fonte));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
const chamada = execP.indexOf("pudim_AtualizarMetas(passo)");
check("atualizada no tique ACIMA da trava de espectador (só lê)", trava > 0 && chamada > 0 && chamada < trava);
check("a simulação conta quartel com fundação, pela classe Barracks, só lendo",
	// Desde 29/09 conta a fundação por padrão e só pula quando pedem `prontos` (fase 2).
	/GuiInterface\.prototype\.pudim_ContarQuarteis = function\(player, data\) \{[\s\S]{0,400}!id\.HasClass\("Barracks"\)\) continue;[\s\S]{0,300}if \(data && data\.prontos && Engine\.QueryInterface\(ent, IID_Foundation\)\) continue;\s*\+\+n;/.test(sim));
check("sem símbolo que a fonte do jogo pode não ter", !/[✓○−]/.test(fonte));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
