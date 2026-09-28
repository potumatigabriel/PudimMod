/**
 * Pesquisa na espera de recurso (28/09).
 *
 * Pedido (print da Cesta com "Recursos insuficientes"): "igual o posicionar prédio sem ter
 * recursos, tem que ter na fila fazer upgrade sem ter recursos... vc clica ele já fica em uma
 * fila fantasma, tendo o recurso, o sistema faz ele". Roda o código real num mundo falso.
 *
 * Rodar:  node tools/test_pesquisa_espera.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const sess = norm(fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("pesquisa na espera");

const i = panel.indexOf("const PUDIM_PESQUISA_ESPERA_MAX");
const j = panel.indexOf("// ─── Divisão de mercadorias do comércio");
function mundo(o) {
	o = Object.assign({ madeira: 50, requisito: true, predio: true }, o || {});
	const w = { agora: 1000000, cmds: [], avisos: [] };
	const botoes = {};
	const ctx = {
		Date: { now: () => w.agora }, Math,
		PUDIM_RESERVA_INTERVALO: 2000, g_PudimReservaAccum: 0,
		pudim_ObraLigada: () => true, pudim_Assistindo: () => false, controlsPlayer: () => true,
		pudim_CustoCurto: c => JSON.stringify(c), pudim_Log: () => {},
		pudim_FaltaParaObra: c => (c.wood || 0) > o.madeira ? { wood: c.wood - o.madeira } : null,
		GetSimState: () => ({ players: [null, { civ: "gaul" }] }),
		GetEntityState: e => (o.predio ? { player: 1, researcher: { techCostMultiplier: { wood: 0.5 } } } : null),
		GetTechnologyData: t => ({ cost: { food: 200, wood: 200 }, name: { generic: "Cestas" } }),
		Engine: {
			GetPlayerID: () => 1,
			PostNetworkCommand: c => w.cmds.push(c),
			TryGetGUIObjectByName: n => botoes[n] || null,
			GuiInterfaceCall: (n, d) => {
				if (n === "CheckTechnologyRequirements") return o.requisito;
				if (n === "pudim_PushNotification") { w.avisos.push(d.message); return; }
				throw new Error(n);
			}
		}
	};
	vm.createContext(ctx);
	vm.runInContext(panel.slice(i, j) + "\nthis.api = { esperar: pudim_TalvezEsperarPesquisa, liberar: pudim_LiberarPesquisaSemRecurso," +
		" processar: pudim_ProcessPesquisasEspera, lista: () => g_PudimPesquisasEspera };", ctx);
	return { ctx, w, o, botoes, api: ctx.api };
}

{
	const m = mundo();
	check("sem recurso: fica na espera (o original não roda)", m.api.esperar(77, "gather_capacity_basket") === true);
	const p = m.api.lista()[0];
	check("custo = template × multiplicador do prédio (200 de madeira × 0,5 = 100)",
		p && p.custo.wood === 100 && p.custo.food === 200, p && JSON.stringify(p.custo));
	check("e avisa na tela", /Pesquisa na espera: Cestas/.test(m.w.avisos[0] || ""));
	check("clicar de novo não duplica", m.api.esperar(77, "gather_capacity_basket") === true && m.api.lista().length === 1);
	m.api.processar();
	check("ainda sem recurso: não manda nada", m.w.cmds.length === 0);
	m.o.madeira = 500;
	m.api.processar();
	check("juntou: manda o mesmo comando do botão do jogo",
		m.w.cmds.length === 1 && m.w.cmds[0].type === "research" && m.w.cmds[0].entity === 77 &&
		m.w.cmds[0].template === "gather_capacity_basket", JSON.stringify(m.w.cmds));
	check("e sai da espera", m.api.lista().length === 0);
}
check("com recurso: segue o jogo normal", mundo({ madeira: 5000 }).api.esperar(77, "x") === false);
{
	const m = mundo({ predio: false });
	m.api.esperar(77, "x"); m.api.processar();
	check("prédio destruído: desiste e avisa", m.api.lista().length === 0 && /não existe mais/.test(m.w.avisos.pop()));
}
{
	const m = mundo();
	m.api.esperar(77, "x"); m.w.agora += 301000; m.api.processar();
	check("5 minutos sem juntar: desiste e avisa", m.api.lista().length === 0 && /5 minutos/.test(m.w.avisos.pop()));
}
{
	// Par de pesquisas: o de baixo em i + rowLength (7 + 8 = 15), o de cima em i (7).
	const m = mundo();
	m.botoes["unitResearchButton[15]"] = { enabled: false, hidden: false, tooltip: "" };
	m.botoes["unitResearchButton[7]"] = { enabled: false, hidden: false, tooltip: "" };
	m.api.liberar({ i: 7, rowLength: 8, player: 1, item: { tech: { pair: true, bottom: "a", top: "b" } } });
	check("par de pesquisas: os dois botões religados, nas posições do setupButton do jogo",
		m.botoes["unitResearchButton[15]"].enabled && m.botoes["unitResearchButton[7]"].enabled &&
		/pesquisa quando juntar/.test(m.botoes["unitResearchButton[7]"].tooltip));
	const r = mundo({ requisito: false });
	r.botoes["unitResearchButton[15]"] = { enabled: false, hidden: false, tooltip: "" };
	r.api.liberar({ i: 7, rowLength: 8, player: 1, item: { tech: "a" } });
	check("falta requisito: continua desligado", r.botoes["unitResearchButton[15]"].enabled === false);
	const u = mundo();
	u.botoes["unitResearchButton[15]"] = { enabled: false, hidden: false, tooltip: "" };
	u.api.liberar({ i: 7, rowLength: 8, player: 1, item: { tech: "a", isUpgrading: true } });
	check("prédio em melhoria: continua desligado", u.botoes["unitResearchButton[15]"].enabled === false);
}

// ── Ganchos, reserva, cancelar ───────────────────────────────────────────────────────
check("addResearchToQueue: sem recurso vai para a espera; com recurso chama o original",
	/if \(pudim_TalvezEsperarPesquisa\(args\[0\], args\[1\]\)\) return;[\s\S]{0,20}return target\.apply\(that, args\);/.test(sess));
check("o botão de pesquisa é religado por gancho em setupButton, depois do original",
	/pudim_patchApplyN\(g_SelectionPanels\.Research, "setupButton", function\(target, that, args\)\s*\{\s*const r = target\.apply\(that, args\);/.test(sess));
check("o custo entra na reserva", /for \(const p of g_PudimPesquisasEspera\)\s*\n\s*itens\.push\(\{ tipo: "pesquisa"/.test(panel));
check("o clique direito de cancelar obra cancela a pesquisa também", /g_PudimPesquisasEspera = \[\];/.test(execP));
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
check("processa abaixo da trava de espectador", trava > 0 && execP.indexOf("pudim_Medir(\"ProcessPesquisasEspera\"") > trava);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
