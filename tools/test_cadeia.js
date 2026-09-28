/**
 * Pesquisa em cadeia: voce pesquisa um passo, o mod continua a cadeia.
 *
 * Ideia do ModernGUI ("mass production" de uma cadeia de tecnologias), reescrita — o
 * repositorio deles nao tem licenca.
 *
 * Fatos do motor (public.zip): a cadeia esta na propria tecnologia, `supersedes` aponta para
 * a anterior (strongeraxes.supersedes = ironaxes); TechnologyTemplates.GetAll() devolve
 * todas; a sua pesquisa sai por addResearchToQueue(entity, tech) em
 * selection_panels_helpers.js.
 *
 * Este teste EXECUTA pudim_GetPlanoReserva numa caixa de areia com um motor falso, em vez
 * de so procurar texto no codigo: o andar pela cadeia tem casos sutis.
 *
 * Rodar:  node tools/test_cadeia.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const vm = require("vm");
const base = path.join(__dirname, "..");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sess = fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8");
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("pesquisa em cadeia");

// ── A funcao da simulacao, extraida ────────────────────────────────────────────────────
const i = sim.indexOf("GuiInterface.prototype.pudim_GetPlanoReserva = function");
const j = sim.indexOf("GuiInterface.prototype.pudim_GetAutoResearchData");
check("a funcao foi encontrada", i > 0 && j > i);
const fonte = sim.slice(i, j);

// ── Um motor falso, so com o que a funcao usa ──────────────────────────────────────────
function motor(cfg) {
	const IID = { RangeManager: 1, PlayerManager: 2, TechnologyManager: 3, Player: 4, Foundation: 5,
		Identity: 6, Researcher: 7, ProductionQueue: 8 };
	const SYSTEM = 1;
	const techs = {
		"gather_lumbering_ironaxes": { cost: { wood: 200, food: 100 } },
		"gather_lumbering_strongeraxes": { cost: { wood: 400, metal: 200 }, supersedes: "gather_lumbering_ironaxes" },
		"gather_lumbering_sharpaxes": { cost: { wood: 500, metal: 300 }, supersedes: "gather_lumbering_strongeraxes" },
		"gather_capacity_basket": { cost: { wood: 100 } }
	};
	const comp = {
		[SYSTEM]: {
			[IID.RangeManager]: { GetEntitiesByPlayer: () => [100] },
			[IID.PlayerManager]: { GetPlayerByID: () => 50 }
		},
		50: {
			[IID.TechnologyManager]: {
				IsTechnologyResearched: t => cfg.pesquisadas.indexOf(t) >= 0,
				IsInProgress: t => cfg.andamento.indexOf(t) >= 0,
				IsTechnologyQueued: () => false,
				CanResearch: t => cfg.pode.indexOf(t) >= 0
			},
			[IID.Player]: { GetResourceCounts: () => cfg.banco }
		},
		100: {   // o armazem
			[IID.Identity]: { HasClass: () => false },
			[IID.Researcher]: { GetTechnologiesList: () => cfg.oferta, GetTechCostMultiplier: () => ({ wood: 1, metal: 1, food: 1 }) },
			[IID.ProductionQueue]: { GetQueue: () => [] }
		}
	};
	const ctx = {
		Engine: { QueryInterface: (e, iid) => (comp[e] || {})[iid] || null },
		SYSTEM_ENTITY: SYSTEM,
		TechnologyTemplates: { Get: n => techs[n], GetAll: () => techs },
		GuiInterface: function() {}
	};
	for (const k in IID) ctx["IID_" + k] = IID[k];
	vm.createContext(ctx);
	vm.runInContext("GuiInterface.prototype = {};\n" + fonte, ctx);
	return (dados) => vm.runInContext("GuiInterface.prototype.pudim_GetPlanoReserva", ctx)(1, dados);
}
const CAD = { "cadeias": ["gather_lumbering_ironaxes"] };

// Voce acabou de mandar o machado de ferro: ele esta em andamento.
let r = motor({ pesquisadas: [], andamento: ["gather_lumbering_ironaxes"], pode: [],
	oferta: [], banco: { wood: 2000, metal: 2000 } })(CAD);
check("com o primeiro passo EM ANDAMENTO, a cadeia espera", r.cadeia.length === 0 && r.acabou.length === 0,
	JSON.stringify(r));

// Machado de ferro pronto; o armazem ja oferece o proximo e da para pagar.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes"], andamento: [],
	pode: ["gather_lumbering_strongeraxes"], oferta: ["gather_lumbering_strongeraxes"],
	banco: { wood: 2000, metal: 2000 } })(CAD);
check("primeiro passo pronto: o proximo e candidato",
	r.cadeia.length === 1 && r.cadeia[0].tech === "gather_lumbering_strongeraxes" && r.cadeia[0].ent === 100,
	JSON.stringify(r.cadeia));
check("com o custo do motor e 'pronto' porque da para pagar",
	r.cadeia[0].custo.wood === 400 && r.cadeia[0].custo.metal === 200 && r.cadeia[0].pronto === true);

// Sem dinheiro: continua candidato, mas nao 'pronto' — e o que o painel RESERVA.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes"], andamento: [],
	pode: ["gather_lumbering_strongeraxes"], oferta: ["gather_lumbering_strongeraxes"],
	banco: { wood: 100, metal: 0 } })(CAD);
check("sem recurso: o passo fica reservado, esperando o dinheiro",
	r.cadeia.length === 1 && r.cadeia[0].pronto === false);

// Requisito nao cumprido (o passo 2 exige a fase de vila): nao reserva nada.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes"], andamento: [],
	pode: [], oferta: ["gather_lumbering_strongeraxes"], banco: { wood: 2000, metal: 2000 } })(CAD);
check("sem o requisito (falta a fase), nao reserva: guardar para o que nao existe para a economia",
	r.cadeia.length === 0 && r.acabou.length === 0);

// Dois passos prontos: anda ate o terceiro.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes", "gather_lumbering_strongeraxes"], andamento: [],
	pode: ["gather_lumbering_sharpaxes"], oferta: ["gather_lumbering_sharpaxes"],
	banco: { wood: 2000, metal: 2000 } })(CAD);
check("com dois passos prontos, o candidato e o terceiro",
	r.cadeia.length === 1 && r.cadeia[0].tech === "gather_lumbering_sharpaxes");

// Cadeia inteira pronta: acabou.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes", "gather_lumbering_strongeraxes", "gather_lumbering_sharpaxes"],
	andamento: [], pode: [], oferta: [], banco: { wood: 2000 } })(CAD);
check("cadeia completa: o painel e avisado para esquecer", r.acabou.indexOf("gather_lumbering_ironaxes") >= 0);

// Tecnologia sem continuacao nenhuma.
r = motor({ pesquisadas: ["gather_capacity_basket"], andamento: [], pode: [], oferta: [], banco: {} })(
	{ "cadeias": ["gather_capacity_basket"] });
check("pesquisa sem continuacao nao vira cadeia eterna", r.acabou.indexOf("gather_capacity_basket") >= 0);

// O par {pair, top, bottom} tambem e oferta.
r = motor({ pesquisadas: ["gather_lumbering_ironaxes"], andamento: [],
	pode: ["gather_lumbering_strongeraxes"],
	oferta: [{ pair: true, top: "gather_lumbering_strongeraxes", bottom: "x" }],
	banco: { wood: 2000, metal: 2000 } })(CAD);
check("tecnologia oferecida dentro de um par tambem conta", r.cadeia.length === 1);

// ── A interface ────────────────────────────────────────────────────────────────────────
check("a sua pesquisa e registrada pelo gancho de addResearchToQueue",
	/pudim_patchApplyN\("addResearchToQueue", function\(target, that, args\)/.test(sess) &&
	/g_PudimCadeias\[tech\] = Date\.now\(\);/.test(sess));
// Desde 28/09 há uma exceção: sem recurso, a pesquisa vai para a espera (pesquisa na espera,
// tools/test_pesquisa_espera.js) e sai quando juntar. Com recurso, sai do mesmo jeito.
check("e o gancho chama a funcao original — só não quando a pesquisa ficou na espera",
	/g_PudimCadeias\[tech\] = Date\.now\(\);[\s\S]{0,200}if \(pudim_TalvezEsperarPesquisa\(args\[0\], args\[1\]\)\) return;[\s\S]{0,20}return target\.apply\(that, args\);/.test(sess));
check("a opcao existe no menu e vem LIGADA (so age sobre o que voce comecou)",
	opts[0].options.some(o => o.config === "pudim.pesquisa.cadeia") &&
	/ConfigDB_GetValue\("user", "pudim\.pesquisa\.cadeia"\) !== "false"/.test(sess));
check("cadeia terminada e esquecida", /delete g_PudimCadeias\[t\];/.test(panel));
check("o passo pronto e mandado sem passar na frente", /"template": it\.nome,\s*\n?\s*"pushFront": false/.test(panel));
check("com anti-repeticao por tecnologia (a pesquisa demora um turno para aparecer)",
	/if \(agora - \(g_PudimCadeiaMandadaEm\[it\.nome\] \|\| 0\) < 8000\) continue;/.test(panel));
check("e a auto-pesquisa por pontuacao nao escolhe de novo o que ja tem dono",
	/reservadas: g_PudimGuardado\.itens\.map\(i => i\.nome\),/.test(panel) &&
	/if \(reservadasP\.has\(tech\)\) continue;/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
