/**
 * Reserva de recurso: guardar para a proxima fase e para uma arma de cerco.
 *
 * Ideia do ModernGUI (PanelScripts, "priority queue": o treino automatico nao gasta o que
 * esta reservado para um item prioritario), reescrita — o repositorio deles nao tem licenca.
 *
 * Origem no nosso: "as vezes quero fazer arma de cerco e n da, pq vai mais rapido as
 * unidades" (17/09). O botao de pausa resolvia parando TUDO; guardar resolve melhor — a
 * producao continua e so o custo de uma arma de cerco fica fora do alcance.
 *
 * Fatos do motor usados (public.zip):
 *   TechnologyManager.CanResearch — par em andamento, pre-requisito, pesquisada, em andamento
 *   Technology.Queue             — custo = Math.floor(multiplicador x custo do template)
 *   Researcher.GetTechCostMultiplier, Researcher.GetTechnologiesList (par vem como objeto)
 *   ProductionQueue.AddItem      — pushFront PAUSA o lote em andamento e poe o novo na frente
 *
 * Rodar:  node tools/test_reserva.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("reserva de recurso");

// ── 1. A simulacao so olha ─────────────────────────────────────────────────────────────
const corpo = (function() {
	const i = execS.indexOf("pudim_GetPlanoReserva = function");
	const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
	return execS.slice(i, j);
})();
check("a funcao da reserva existe e foi recortada sozinha", corpo.length > 800 && corpo.length < execS.length / 4);
check("esta exposta", /"pudim_GetPlanoReserva": 1,/.test(sim));
check("e nao manda comando nenhum", !/PostNetworkCommand/.test(corpo));
check("a fase so conta quando o motor diz que PODE ser pesquisada",
	/t\.indexOf\("phase_"\) === 0 &&[\s\S]{0,120}cmpTechMgr\.CanResearch\(t\)/.test(corpo));
check("o custo e a conta do motor, com o multiplicador do CC",
	/Math\.floor\(\(\(mult && mult\[r\] !== undefined\) \? mult\[r\] : 1\) \* tpl\.cost\[r\]\)/.test(corpo) &&
	/cmpR\.GetTechCostMultiplier\(\)/.test(corpo));
check("o par {pair, top, bottom} e aberto", /else if \(it && it\.pair\) \{ out\.push\(it\.top\); out\.push\(it\.bottom\); \}/.test(corpo));
check("e o CC escolhido e o da fila mais curta", /if \(!melhor \|\| t < melhor\.t\)/.test(corpo));

// ── 2. As opcoes ───────────────────────────────────────────────────────────────────────
const cfgs = opts[0].options.map(o => o.config);
for (const c of ["pudim.reserva.fase", "pudim.reserva.faseauto"]) {
	check("opcao " + c + " declarada no menu", cfgs.indexOf(c) >= 0);
	check("e desligada por padrao (so vale se for \"true\")",
		new RegExp('ConfigDB_GetValue\\("user", "' + c.replace(/\./g, "\\.") + '"\\) (===|!==) "true"').test(execP));
}
const opFase = opts[0].options.find(o => o.config === "pudim.reserva.faseauto");
check("a fase automatica explica que e decisao de estrategia, nos dois idiomas",
	/estrat/.test(opFase.tooltip) && /strategic/.test(opFase.tooltip_en));

// ── 3. Quem gasta desconta a reserva ───────────────────────────────────────────────────
check("auto-fila: o que esta guardado sai do dinheiro livre",
	/for \(const r in g_PudimGuardado\.total\)\s*\n?\s*res\[r\] = Math\.max\(0, \(\+res\[r\] \|\| 0\) - \(g_PudimGuardado\.total\[r\] \|\| 0\)\);/.test(execP));
check("auto-fila: com reserva, a auto-fila NATIVA fica desligada (ela gastaria sozinha)",
	/const modSemeia = propAtiva \|\| pudim_ReservaAtiva\(\);/.test(execP) &&
	/if \(b\.alwaysQueue && modSemeia\)/.test(execP));
check("contra-treino: nao age com reserva (manda lote sem olhar custo)",
	/if \(g_PudimTreinoPausado\) return;[\s\S]{0,300}if \(pudim_ReservaAtiva\(\)\) return;/.test(execP));
// Desde 28/09 somada a uma unidade por edifício de produção (test_treino_antes_pesquisa.js).
check("auto-pesquisa: recebe a reserva", /reserva: pudim_SomaCustos\(g_PudimGuardado\.total, /.test(execP));
check("e a simulacao a desconta do saldo",
	/for \(const r in reservaP\) saldoPesquisa\[r\] = \(saldoPesquisa\[r\] \|\| 0\) - \(reservaP\[r\] \|\| 0\);/.test(execS));

// A conta, espelhada: 900 de madeira, aries de 300W guardado, lote de soldado a 50W.
function livre(banco, guardado) {
	const r = Object.assign({}, banco);
	for (const k in guardado) r[k] = Math.max(0, (r[k] || 0) - guardado[k]);
	return r;
}
const l = livre({ wood: 900, metal: 250 }, { wood: 300, metal: 200 });
check("com 900W e aries de 300W guardado, sobram 600W para o treino", l.wood === 600);
check("e o metal guardado nao vira lote de soldado", l.metal === 50);

// ── 4. Nao passar por cima de voce ─────────────────────────────────────────────────────
check("o mod lembra quem ELE apagou, para nao confundir com decisao sua",
	/var g_PudimDesligadoPeloMod = new Map\(\);/.test(execP) &&
	/g_PudimDesligadoPeloMod\.set\(b\.ent, Date\.now\(\)\);/.test(execP));
check("e religa quando o motivo acaba",
	/if \(!modSemeia\) \{\s*\n?\s*toEnable\.push\(b\.ent\);\s*\n?\s*g_PudimDesligadoPeloMod\.delete\(b\.ent\);/.test(execP));
check("se VOCE religar, o mod nao apaga de novo",
	/g_PudimReligadoPeloJogador\.add\(b\.ent\);/.test(execP) &&
	/!g_PudimReligadoPeloJogador\.has\(b\.ent\)\) \{/.test(execP));
check("e 'religou' so conta depois de 5s — antes disso pode ser so a latencia",
	/Date\.now\(\) - g_PudimDesligadoPeloMod\.get\(b\.ent\) > 5000/.test(execP));

// ── 5. O botao de tres estados ─────────────────────────────────────────────────────────
check("o modo cerco reserva a arma que da para treinar AGORA (lista ja filtrada por requisito)",
	/function pudim_CercoDisponivel\(\)/.test(execP) && /siege_ram/.test(execP));
check("aries primeiro, senao a primeira arma de cerco disponivel",
	/const ram = lista\.find\(u => u\.tpl && u\.tpl\.indexOf\("siege_ram"\) !== -1\);/.test(execP));

// ── 6. A fase automatica ───────────────────────────────────────────────────────────────
check("passa na frente do lote, que fica pausado sem perder progresso",
	/"type": "research", "entity": f\.cc, "template": f\.tech,\s*\n?\s*"pushFront": true/.test(execP));
check("e nao repete o pedido durante a latencia",
	/if \(agora - g_PudimFaseMandadaEm < 8000\) return;/.test(execP));
check("so com a opcao ligada e so quando ha recurso",
	/if \(!f \|\| !f\.pronto \|\| !f\.cc \|\| !f\.tech\) return;/.test(execP));

// ── 7. Multiplayer ─────────────────────────────────────────────────────────────────────
const iTrava = panel.indexOf('if (typeof g_IsObserver !== "undefined" && g_IsObserver) return;');
const iRes = panel.indexOf('pudim_Medir("AtualizarReserva", pudim_AtualizarReserva)');
check("a reserva e a fase automatica rodam ABAIXO da trava de espectador",
	iTrava > 0 && iRes > iTrava, "trava " + iTrava + ", reserva " + iRes);
check("e o estado da reserva vive so na interface", !/g_PudimGuardado/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
