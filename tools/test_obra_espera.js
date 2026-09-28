/**
 * Obra na espera de recurso (28/09).
 *
 * Posicionar prédio sem ter o recurso: o mod guarda a obra, deixa um fantasma LOCAL no lugar,
 * reserva o custo e manda o mesmo "construct" do seu clique quando juntar. Este teste roda o
 * código de verdade num mundo falso e prende:
 *   • quando entra na espera (sem recurso, lugar válido) e quando NÃO (com recurso: o jogo
 *     segue normal; lugar inválido; espectador);
 *   • o comando que sai depois é o de tryPlaceBuilding (input.js da A28), com os construtores
 *     que você escolheu, e eles ficam marcados como sob ordem sua;
 *   • as desistências (tempo, construtores mortos, lugar ocupado) apagam o fantasma e avisam;
 *   • o botão só é religado quando o ÚNICO bloqueio é recurso.
 * E, na simulação, que o fantasma é entidade LOCAL de "preview|" e só se apaga o que foi criado.
 *
 * Rodar:  node tools/test_obra_espera.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const sess = norm(fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8"));
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const opts = JSON.parse(norm(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8")));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

const a = panel.indexOf("const PUDIM_OBRA_ESPERA_MAX");
const b = panel.indexOf("// ─── Divisão de mercadorias do comércio");
const fonte = panel.slice(a, b);

function mundo(o) {
	o = Object.assign({ madeira: 50, lugarOk: true, requisito: true, limite: 5, observador: false,
	                    selecao: [11, 12], vivos: { 11: 1, 12: 1 } }, o || {});
	const w = { agora: 1000000, ordens: [], avisos: [], fantasmas: new Set(), apagados: [], proximo: 900,
	            resetou: 0, sementes: 0, reserva: 0 };
	const ctx = {
		Date: { now: () => w.agora }, Object, String,
		g_IsObserver: o.observador,
		PUDIM_RESERVA_INTERVALO: 2000,
		g_PudimReservaAccum: 0,
		g_PudimPlayerOrders: {}, g_PudimPlayerQueued: {},
		g_AutoFormation: { getNull: () => "null" },
		placementSupport: { mode: "building", template: "structures/athen/barracks",
			position: { x: 100, z: 200 }, angle: 1.5, actorSeed: 7,
			Reset() { this.mode = null; w.resetou++; }, RandomizeActorSeed() { w.sementes++; } },
		g_Selection: { toList: () => o.selecao.slice(), size: () => o.selecao.length },
		GetTemplateData: () => ({ cost: { wood: 300, stone: 100, time: 150, population: 0 },
		                          name: { specific: "Quartel" }, requirements: {} }),
		GetEntityState: e => (o.vivos[e] ? { player: 1 } : null),
		updateBuildingPlacementPreview: () => o.lugarOk,
		controlsPlayer: () => true,
		getEntityLimitAndCount: () => ({ canBeAddedCount: o.limite }),
		pudim_CustoCurto: c => JSON.stringify(c),
		pudim_Log: () => {},
		pudim_Ordenar: (cmd, dono) => { w.ordens.push({ cmd, dono }); return true; },
		Engine: {
			ConfigDB_GetValue: () => "",
			GetPlayerID: () => 1,
			GuiInterfaceCall: (nome, d) => {
				if (nome === "GetNeededResources") {
					const falta = {};
					if ((d.cost.wood || 0) > o.madeira) falta.wood = d.cost.wood - o.madeira;
					return falta;
				}
				if (nome === "pudim_CriarFantasma") { const id = w.proximo++; w.fantasmas.add(id); return id; }
				if (nome === "pudim_ApagarFantasma") { w.apagados.push(d.ent); return w.fantasmas.delete(d.ent); }
				if (nome === "SetBuildingPlacementPreview") return d.template ? { success: o.lugarOk } : null;
				if (nome === "pudim_PushNotification") { w.avisos.push(d.message); return; }
				if (nome === "AreRequirementsMet") return o.requisito;
				throw new Error("chamada inesperada: " + nome);
			}
		}
	};
	vm.createContext(ctx);
	vm.runInContext(fonte + "\nthis.api = { esperar: pudim_TalvezEsperarObra, processar: pudim_ProcessObrasEspera," +
		" liberar: pudim_LiberarBotaoSemRecurso, cancelar: pudim_CancelarObrasEspera," +
		" lista: () => g_PudimObrasEspera };", ctx);
	return { ctx, w, o, api: ctx.api };
}

console.log("obra na espera de recurso");

// ── Entrar na espera ─────────────────────────────────────────────────────────────────
{
	const m = mundo();
	const r = m.api.esperar(false, false);
	const obra = m.api.lista()[0];
	check("sem recurso e lugar válido: fica na espera (o original não roda)", r === true && m.api.lista().length === 1);
	check("guarda os campos do seu clique", obra && obra.x === 100 && obra.z === 200 && obra.angle === 1.5 &&
		obra.actorSeed === 7 && obra.entities.join() === "11,12");
	check("o custo guardado é só recurso (sem tempo nem população)",
		obra && JSON.stringify(obra.custo) === JSON.stringify({ wood: 300, stone: 100 }), obra && JSON.stringify(obra.custo));
	check("cria o fantasma e avisa", obra && obra.fantasma === 900 && m.w.avisos.length === 1 && /faltam/.test(m.w.avisos[0]));
	check("sai do modo de posicionar, como o jogo faz sem shift", m.w.resetou === 1);
	check("e pede a reserva já no próximo ciclo", m.ctx.g_PudimReservaAccum === 2000);
	const s = mundo(); s.api.esperar(true, false);
	check("com shift: continua posicionando (nova semente, sem reset)", s.w.resetou === 0 && s.w.sementes === 1);
}
check("com recurso: segue o jogo normal", mundo({ madeira: 5000 }).api.esperar(false, false) === false);
check("lugar inválido: segue o original (que toca o som de erro)", mundo({ lugarOk: false }).api.esperar(false, false) === false);
check("espectador: nunca", mundo({ observador: true }).api.esperar(false, false) === false);
check("sem ninguém selecionado: nunca", mundo({ selecao: [] }).api.esperar(false, false) === false);

// ── Sair da espera ───────────────────────────────────────────────────────────────────
{
	const m = mundo();
	m.api.esperar(true, false);
	m.api.processar();
	check("ainda sem recurso: espera", m.w.ordens.length === 0 && m.api.lista().length === 1);
	m.o.madeira = 400;
	m.ctx.placementSupport.mode = "building";
	m.api.processar();
	check("você posicionando outra coisa: não mexe (usaria o mesmo fantasma do jogo)", m.w.ordens.length === 0);
	m.ctx.placementSupport.mode = null;
	m.api.processar();
	const c = m.w.ordens[0] && m.w.ordens[0].cmd;
	check("juntou: manda o construct de tryPlaceBuilding", c && c.type === "construct" &&
		c.template === "structures/athen/barracks" && c.x === 100 && c.z === 200 && c.angle === 1.5 &&
		c.actorSeed === 7 && c.autorepair === true && c.autocontinue === true && c.queued === true &&
		c.formation === "null", JSON.stringify(c));
	check("com os SEUS construtores, como botão do jogador no árbitro",
		c && c.entities.join() === "11,12" && m.w.ordens[0].dono === "pudim_ProcessObrasEspera");
	check("e eles ficam marcados como sob ordem sua (com fila, porque foi com shift)",
		m.ctx.g_PudimPlayerOrders[11] === m.w.agora && m.ctx.g_PudimPlayerQueued[12] === m.w.agora);
	check("o fantasma some quando a obra sai", m.w.apagados.join() === "900" && m.api.lista().length === 0);
}
{
	const m = mundo({ vivos: { 12: 1 } });
	m.api.esperar(false, false); m.o.madeira = 400; m.ctx.placementSupport.mode = null;
	m.api.processar();
	check("construtor morto fica de fora; o vivo constrói", m.w.ordens[0] && m.w.ordens[0].cmd.entities.join() === "12");
}
{
	const m = mundo({ vivos: {} });
	m.api.esperar(false, false); m.ctx.placementSupport.mode = null;
	m.api.processar();
	check("todos os construtores mortos: desiste, apaga o fantasma e avisa",
		m.api.lista().length === 0 && m.w.apagados.length === 1 && /construtores morreram/.test(m.w.avisos.pop()));
}
{
	const m = mundo();
	m.api.esperar(false, false); m.ctx.placementSupport.mode = null;
	m.w.agora += 181000;
	m.api.processar();
	check("3 minutos sem juntar: desiste e avisa", m.api.lista().length === 0 && /3 minutos/.test(m.w.avisos.pop()));
}
{
	const m = mundo();
	m.api.esperar(false, false); m.ctx.placementSupport.mode = null;
	m.o.madeira = 400; m.o.lugarOk = false;
	m.api.processar();
	check("o lugar foi ocupado: desiste e avisa, sem mandar comando",
		m.w.ordens.length === 0 && /lugar ficou ocupado/.test(m.w.avisos.pop()));
}
{
	const m = mundo();
	m.api.esperar(true, false); m.ctx.placementSupport.mode = "building"; m.api.esperar(true, false);
	m.api.cancelar();
	check("clique direito cancela todas e apaga os fantasmas", m.api.lista().length === 0 && m.w.apagados.length === 2);
}

// ── O botão ──────────────────────────────────────────────────────────────────────────
function botao(o) {
	const m = mundo(o);
	const data = { button: { enabled: false, tooltip: "custo" }, item: "structures/athen/barracks",
	               player: 1, playerState: {} };
	m.api.liberar(data);
	return data.button;
}
check("só falta recurso: o botão é religado e a dica explica", (b => b.enabled && /quando juntar/.test(b.tooltip))(botao()));
check("falta requisito: continua desligado", botao({ requisito: false }).enabled === false);
check("limite de prédios atingido: continua desligado", botao({ limite: 0 }).enabled === false);
check("espectador: continua desligado", botao({ observador: true }).enabled === false);

// ── Ganchos e reserva ────────────────────────────────────────────────────────────────
check("tryPlaceBuilding consulta a espera ANTES de chamar o original",
	/pudim_patchApplyN\("tryPlaceBuilding"[\s\S]{0,400}if \(pudim_TalvezEsperarObra\(args\[0\], args\[1\]\)\) return true;[\s\S]{0,40}return target\.apply\(that, args\);/.test(sess));
check("o botão de construção é religado por gancho em setupButton, que chama o original primeiro",
	/pudim_patchApplyN\(g_SelectionPanels\.Construction, "setupButton", function\(target, that, args\)\s*\{\s*const r = target\.apply\(that, args\);/.test(sess));
check("a obra entra na reserva (a auto-fila não come o custo dela)",
	/for \(const o of g_PudimObrasEspera\)\s*\n\s*itens\.push\(\{ tipo: "obra"/.test(panel));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
check("o processamento roda ABAIXO da trava de espectador", trava > 0 && execP.indexOf("pudim_Medir(\"ProcessObrasEspera\"") > trava);
const op = opts[0].options.find(x => x.config === "pudim.obra.espera");
check("a opção existe, em pt e en", op && op.tooltip && op.tooltip_en);

// ── A simulação: fantasma local, e só se apaga o que foi criado ──────────────────────
{
	const i = sim.indexOf("const g_PudimFantasmas = new Set();");
	const j = sim.indexOf("// Geometria da regra \"casa nunca entre o coletor e o dropsite\".");
	const criados = [], destruidos = [], cor = [];
	const ctx = {
		GuiInterface: function() {}, Set,
		IID_Position: 1, IID_Ownership: 2, IID_Visual: 3,
		Engine: {
			AddLocalEntity: t => { criados.push(t); return 5000 + criados.length; },
			AddEntity: () => { throw new Error("AddEntity e SINCRONIZADO: proibido"); },
			DestroyEntity: e => destruidos.push(e),
			QueryInterface: (e, iid) => iid === 1 ? { JumpTo() {}, SetYRotation() {} } :
				iid === 2 ? { SetOwner() {} } : { SetActorSeed() {}, SetShadingColor(...c) { cor.push(c); } }
		}
	};
	ctx.GuiInterface.prototype = {};
	vm.createContext(ctx);
	vm.runInContext(sim.slice(i, j), ctx);
	const G = ctx.GuiInterface.prototype;
	const ent = G.pudim_CriarFantasma(1, { template: "structures/athen/barracks", x: 1, z: 2, angle: 0, actorSeed: 3 });
	check("o fantasma é entidade LOCAL com o filtro preview| (o mesmo do posicionamento do jogo)",
		criados.join() === "preview|structures/athen/barracks" && ent === 5001);
	check("azulado: nem o vermelho de inválido nem o branco de pronto", cor.length === 1 && cor[0][2] > cor[0][0]);
	check("apagar um id que NÃO é fantasma não faz nada (a GUI não apaga entidade real)",
		G.pudim_ApagarFantasma(1, { ent: 42 }) === false && destruidos.length === 0);
	check("apagar o fantasma funciona, uma vez só",
		G.pudim_ApagarFantasma(1, { ent: ent }) === true && G.pudim_ApagarFantasma(1, { ent: ent }) === false &&
		destruidos.join() === String(ent));
	check("template vazio ou ausente: nem tenta", G.pudim_CriarFantasma(1, { template: "" }) === null && criados.length === 1);
}

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
