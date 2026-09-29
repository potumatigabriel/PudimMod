/**
 * Mercado automático (28/09).
 *
 * O "Mercado Inteligente" antigo vinha ligado e nunca trocou nada: a função da simulação
 * sempre devolveu null. Este teste prende a versão nova ao mercado do jogo (Barter.js da
 * A28: lotes de 100 ou 500, ganho = round(venda/compra × 100), preço piora 2% por troca) e
 * à regra do mod: compra o que falta, vende só o que sobra, e só a preço razoável.
 *
 * Rodar:  node tools/test_mercado.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const opts = JSON.parse(norm(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8")));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

const i = panel.indexOf("const PUDIM_MERCADO_PISO");
const j = panel.indexOf("/** Faz uma troca no mercado");
const ctx = {};
vm.createContext(ctx);
vm.runInContext(panel.slice(i, j) + "\nthis.escolher = pudim_EscolherTroca;", ctx);
const escolher = ctx.escolher;

// Preço de partida do jogo: truePrice 100, CONSTANT_DIFFERENCE 10 → vende a 90, compra a 110.
const INICIAL = { sell: { food: 90, wood: 90, stone: 90, metal: 90 },
                  buy:  { food: 110, wood: 110, stone: 110, metal: 110 } };

console.log("mercado automatico");

// ── Quando troca ─────────────────────────────────────────────────────────────────────
let t = escolher({ food: 500, wood: 2500, stone: 400, metal: 0 }, INICIAL, {});
check("metal zerado e madeira sobrando: vende madeira, compra metal",
	t && t.sell === "wood" && t.buy === "metal", JSON.stringify(t));
check("sempre 100 — o motor só aceita 100 ou 500", t && t.amount === 100);
check("o ganho é o do motor: round(90/110 × 100) = 82", t && t.ganho === 82, t && t.ganho);

t = escolher({ food: 800, wood: 600, stone: 1800, metal: 500 }, INICIAL, { metal: 700, wood: 300 });
check("guardando 700 de metal com 500: compra metal com a pedra que sobra",
	t && t.buy === "metal" && t.sell === "stone", JSON.stringify(t));
check("e a falta informada é a do guardado (200)", t && t.falta === 200, t && t.falta);

// ── Quando NÃO troca ─────────────────────────────────────────────────────────────────
check("nada faltando: não troca",
	escolher({ food: 800, wood: 3000, stone: 300, metal: 300 }, INICIAL, {}) === null);
check("falta, mas nada sobra acima de 1000: não troca",
	escolher({ food: 900, wood: 1050, stone: 500, metal: 0 }, INICIAL, {}) === null);
check("o guardado não conta como sobra (2000 de madeira, 1500 guardados)",
	escolher({ food: 900, wood: 2000, stone: 500, metal: 0 }, INICIAL, { wood: 1500 }) === null);
// Depois de muitas trocas a madeira vende a 50 e o metal custa 150: 33 por 100.
const RUIM = { sell: { food: 90, wood: 50, stone: 90, metal: 130 },
               buy:  { food: 110, wood: 70, stone: 110, metal: 150 } };
check("preço ruim demais (33 por 100): não troca — é o freio contra despejar tudo",
	escolher({ food: 500, wood: 3000, stone: 500, metal: 0 }, RUIM, {}) === null);
check("não vende o próprio recurso que falta",
	(() => { const r = escolher({ food: 0, wood: 50, stone: 0, metal: 3000 }, INICIAL, {});
	         return r && r.sell === "metal" && r.buy !== "metal"; })());
check("sem preços: não troca (sem mercado ou estado incompleto)",
	escolher({ food: 0, wood: 5000 }, null, {}) === null);

// ── A simulação do mercado, de ponta a ponta ─────────────────────────────────────────
// Reproduz Barter.js: cada troca afasta os preços em 2% × ganho/100. Com 5000 de madeira e
// metal zerado, o mod para antes de o preço ficar abaixo de 60 por 100 — e bem antes de
// esvaziar a madeira.
// Desde 28/09 a taxa normal é 0,75 e só o recurso URGENTE (parou um edifício) aceita 0,6.
function simular(urgentes) {
	const dif = { food: 0, wood: 0, stone: 0, metal: 0 };
	const precos = () => {
		const p = { sell: {}, buy: {} };
		for (const r in dif) {
			p.buy[r] = 100 * (100 + 10 + dif[r]) / 100;
			p.sell[r] = 100 * (100 - 10 + dif[r]) / 100;
		}
		return p;
	};
	const res = { food: 500, wood: 5000, stone: 500, metal: 0 };
	let trocas = 0;
	for (let k = 0; k < 200; ++k) {
		const x = escolher(res, precos(), { metal: 2000 }, urgentes);
		if (!x) break;
		const p = precos();
		const ganho = Math.round(p.sell[x.sell] / p.buy[x.buy] * 100);
		res[x.sell] -= 100; res[x.buy] += ganho;
		const d = 2 * ganho / 100;
		dif[x.sell] -= d; dif[x.buy] += d;
		++trocas;
	}
	return { trocas, res };
}
{
	const n = simular({}), u = simular({ metal: true });
	check("taxa normal (0,75): para cedo, sem descer o preço (" + n.trocas + " trocas)",
		n.trocas >= 1 && n.trocas <= 6, n.trocas);
	check("metal urgente (parou o treino): aceita até 0,6, mais trocas (" + u.trocas + ")",
		u.trocas > n.trocas && u.trocas < 40, u.trocas);
	check("e a madeira fica bem acima da folga de 1000", u.res.wood > 1000, u.res.wood);
}

// ── O código ─────────────────────────────────────────────────────────────────────────
check("lê preços e mercado do estado da GUI, sem consulta nova à simulação",
	/eu\.canBarter/.test(execP) && /eu\.barterPrices/.test(execP) &&
	!/GetMarketBarterData/.test(execP + sim));
check("manda o comando do jogo base, igual ao botão do mercado",
	/Engine\.PostNetworkCommand\(\{ "type": "barter", "sell": t\.sell, "buy": t\.buy, "amount": t\.amount \}\)/.test(execP));
check("desligado por padrão, com chave NOVA (a antiga ficou gravada como true)",
	/ConfigDB_GetValue\("user", "pudim\.mercado\.auto"\) !== "true"\) return;/.test(execP) &&
	!/pudim\.advanced\.barter/.test(execP));
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
const chamada = execP.indexOf("pudim_ProcessMercado(); } catch");
check("roda ABAIXO da trava de espectador (manda comando)", trava > 0 && chamada > trava);
check("desconta o que está guardado, e passa os urgentes", /pudim_EscolherTroca\(eu\.resourceCounts, eu\.barterPrices, g_PudimGuardado\.total, urgentes\)/.test(execP));
check("parada por recurso marca o recurso que faltou", /g_PudimFaltouRecursoEm\[r\] = nowQueue;/.test(execP));
const op = opts[0].options.find(o => o.config === "pudim.mercado.auto");
check("a opção existe, em pt e en, e diz que vem desligada",
	op && op.tooltip && op.tooltip_en && /Desligado por padrão/.test(op.tooltip));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
