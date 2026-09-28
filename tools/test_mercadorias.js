/**
 * Divisão de mercadorias do comércio lembrada entre partidas (28/09).
 *
 * Ideia do ModernGUI, reescrita sem substituir a tela do jogo: o mod observa a divisão
 * (GuiInterface.GetTradingGoods), grava quando ela muda e reaplica no início da partida
 * seguinte com o comando do jogo base (set-trading-goods). Player.SetTradingGoods da A28
 * recusa recurso fora dos comercializáveis e soma diferente de 100, com erro na tela — por
 * isso a gravada tem de ser validada contra a partida atual.
 *
 * Rodar:  node tools/test_mercadorias.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const opts = JSON.parse(norm(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8")));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

const i = panel.indexOf("const PUDIM_MERCADORIAS_CHAVE");
const j = panel.indexOf("/** Manda o tributo");
const fonte = panel.slice(i, j);

// Mundo falso: a simulação devolve `goods`; comando mudou `goods` só dois ciclos depois.
function montar(cfgInicial, goodsInicial) {
	const cfg = Object.assign({}, cfgInicial);
	const estado = { goods: Object.assign({}, goodsInicial), pendente: null, atraso: 0,
	                 comandos: [], gravacoes: [], agora: 100000, tempo: 5000 };
	const ctx = {
		Date: { now: () => estado.agora },
		Number, Object, String,
		GetSimState: () => ({ timeElapsed: estado.tempo }),
		pudim_Log: () => {},
		Engine: {
			ConfigDB_GetValue: (_, k) => cfg[k] || "",
			ConfigDB_CreateValue: (_, k, v) => { cfg[k] = v; estado.gravacoes.push(v); },
			ConfigDB_SaveChanges: () => {},
			GuiInterfaceCall: (nome) => {
				if (nome !== "GetTradingGoods") throw new Error(nome);
				if (estado.pendente && --estado.atraso <= 0) { estado.goods = estado.pendente; estado.pendente = null; }
				return Object.assign({}, estado.goods);
			},
			PostNetworkCommand: (c) => { estado.comandos.push(c); estado.pendente = Object.assign({}, c.tradingGoods); estado.atraso = 2; }
		}
	};
	vm.createContext(ctx);
	vm.runInContext(fonte + "\nthis.passo = pudim_ProcessMercadorias; this.validar = pudim_MercadoriasGravadas;", ctx);
	return { ctx, cfg, estado, passo: () => { ctx.passo(); estado.agora += 5000; } };
}
const PADRAO = { food: 25, wood: 25, stone: 25, metal: 25 };
const MINHA = "food:0,metal:60,stone:40,wood:0";

console.log("divisao de mercadorias lembrada");

// ── Validação da gravada ─────────────────────────────────────────────────────────────
{
	const m = montar({}, PADRAO);
	check("aceita a gravada com os mesmos recursos e soma 100",
		JSON.stringify(m.ctx.validar(MINHA, PADRAO)) === JSON.stringify({ food: 0, metal: 60, stone: 40, wood: 0 }));
	check("recusa soma diferente de 100 (o motor daria erro na tela)", m.ctx.validar("food:50,metal:60,stone:0,wood:0", PADRAO) === null);
	check("recusa recurso que a partida não tem (mod de recursos diferente)", m.ctx.validar("food:50,metal:50,glory:0,wood:0", PADRAO) === null);
	check("recusa número quebrado ou negativo", m.ctx.validar("food:-10,metal:60,stone:50,wood:0", PADRAO) === null &&
		m.ctx.validar("food:25.5,metal:24.5,stone:25,wood:25", PADRAO) === null);
	check("recusa texto vazio ou lixo", m.ctx.validar("", PADRAO) === null && m.ctx.validar("abc", PADRAO) === null);
}

// ── Início da partida com divisão gravada ────────────────────────────────────────────
{
	const m = montar({ "pudim.comercio.mercadorias": MINHA }, PADRAO);
	m.passo();
	check("reaplica a gravada no começo, com o comando do jogo base",
		m.estado.comandos.length === 1 && m.estado.comandos[0].type === "set-trading-goods" &&
		JSON.stringify(m.estado.comandos[0].tradingGoods) === JSON.stringify({ food: 0, metal: 60, stone: 40, wood: 0 }),
		JSON.stringify(m.estado.comandos));
	for (let k = 0; k < 4; ++k) m.passo();
	check("a leitura atrasada (divisão velha por dois ciclos) NÃO é gravada por cima",
		m.cfg["pudim.comercio.mercadorias"] === MINHA && m.estado.gravacoes.length === 0,
		JSON.stringify(m.estado.gravacoes));
	check("e só aplica uma vez", m.estado.comandos.length === 1);
	// Agora você muda na tela de comércio.
	m.estado.goods = { food: 50, metal: 50, stone: 0, wood: 0 };
	m.passo();
	check("quando você muda, grava a nova", m.cfg["pudim.comercio.mercadorias"] === "food:50,metal:50,stone:0,wood:0",
		m.cfg["pudim.comercio.mercadorias"]);
}

// ── Sem nada gravado ─────────────────────────────────────────────────────────────────
{
	const m = montar({}, PADRAO);
	for (let k = 0; k < 3; ++k) m.passo();
	check("sem gravada: não manda comando nem grava a do jogo", m.estado.comandos.length === 0 && m.estado.gravacoes.length === 0);
}

// ── Gravada igual à atual, desligado, começo da partida ──────────────────────────────
{
	const m = montar({ "pudim.comercio.mercadorias": "food:25,metal:25,stone:25,wood:25" }, PADRAO);
	m.passo();
	check("gravada igual à atual: não manda comando à toa", m.estado.comandos.length === 0);
	const d = montar({ "pudim.comercio.mercadorias": MINHA, "pudim.comercio.lembrar": "false" }, PADRAO);
	d.passo();
	check("desligado nas opções: não faz nada", d.estado.comandos.length === 0);
	const c = montar({ "pudim.comercio.mercadorias": MINHA }, PADRAO);
	c.estado.tempo = 200;
	c.passo();
	check("antes de 1 s de partida: espera", c.estado.comandos.length === 0);
	c.estado.tempo = 1200;
	c.passo();
	check("e depois aplica", c.estado.comandos.length === 1);
}

// ── O código ─────────────────────────────────────────────────────────────────────────
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
const chamada = execP.indexOf("pudim_ProcessMercadorias(); } catch");
check("roda ABAIXO da trava de espectador (manda comando)", trava > 0 && chamada > trava);
check("não substitui a classe da tela de comércio", !/TradeButtonManager\s*=/.test(execP));
const op = opts[0].options.find(o => o.config === "pudim.comercio.lembrar");
check("a opção existe, em pt e en", op && op.tooltip && op.tooltip_en);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
