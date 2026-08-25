/**
 * Tamanho do lote e estabilidade da proporção — rodando o código de verdade.
 *
 * Relato de 25/08: "demora muitos ciclos e as vezes n troca as unidades construidas em
 * prporçào de unidades... tambem está fazendo de 1 em 1, ao inves de lotes".
 *
 * As duas causas saíram do log da partida, e as duas eram erro de projeto meu:
 *
 *   lote=1 cabe=10 edif=15 prop=on reserva=0 w=2856 f=1459
 *
 * `cabe` já vinha limitado a PUDIM_LOTE_MAX=10, e eu o dividia por `edif`. Com 15,
 * floor(10/15) = 0 → lote 1. E `edif` era 15 com um centro cívico e um quartel de pé,
 * porque pudim_GetProductionBuildings aceita tudo que tem IID_ProductionQueue — e no
 * 0 A.D. quase toda construção tem, já que ProductionQueue também pesquisa tecnologia.
 * Casa, armazém e celeiro estavam na conta. Quanto mais a base crescia, menor o lote.
 *
 * A segunda: `emFila` conta na proporção (e tem de contar, senão o mod pede a mesma unidade
 * de novo a cada ciclo). Mas então semear 5 escaramuçadores empurra a falta para o
 * espadachim, o ciclo seguinte cancela os 5, e a falta volta para o escaramuçador. No log
 * há cancelamentos em 227s e 330s sem nenhuma unidade ter saído no meio.
 *
 * Este teste EXECUTA as funções, em vez de procurar padrões no texto. Um regex confirmaria
 * que eu escrevi uma divisão; só rodando dá para ver que ela dá 1.
 *
 * Rodar:  node tools/test_lote_proporcao.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// ── Extrair as funções do painel e rodá-las de verdade ─────────────────────────────────
// Contando chaves: o painel é um arquivo de sessão de jogo, não um módulo, então não há o
// que importar. Extrair é o que permite testar o comportamento sem abrir o 0 A.D.
function extrair(nome) {
	const ini = panel.indexOf("function " + nome + "(");
	if (ini < 0) throw new Error("função não encontrada: " + nome);
	let i = panel.indexOf("{", ini), nivel = 0;
	for (; i < panel.length; i++) {
		if (panel[i] === "{") nivel++;
		else if (panel[i] === "}" && --nivel === 0) return panel.slice(ini, i + 1);
	}
	throw new Error("chaves não fecham em " + nome);
}
function constante(nome) {
	return new RegExp("const " + nome + " = (\\d+);").exec(panel)[0];
}
// `const` no topo de um script em vm vai para o escopo léxico dele, não para o objeto do
// contexto — ctx.PUDIM_LOTE_MAX seria undefined. Então o valor vem do texto.
const LOTE_MAX = +/const PUDIM_LOTE_MAX = (\d+);/.exec(panel)[1];

const CUSTO = {
	"units/skirmisher": { cost: { food: 50, wood: 50 } },
	"units/swordsman":  { cost: { food: 60, metal: 20 } },
	"units/woman":      { cost: { food: 50 } }
};
const ctx = {
	g_PudimUnitTodas: [],
	g_PudimUnitPesos: {},
	g_PudimMadeiraReservada: 0,
	GetTemplateData: t => CUSTO[t] || null,
	pudim_ProporcaoAtiva: () => true,
	console: console
};
vm.createContext(ctx);
vm.runInContext([
	constante("PUDIM_LOTE_MAX"),
	constante("PUDIM_LOTE_TETO_CONTA"),
	extrair("pudim_ComputeAffordableCount"),
	extrair("pudim_QuantosTreinam"),
	extrair("pudim_LoteIdeal"),
	extrair("pudim_LoteDiag"),
	extrair("pudim_ProporcaoAlvo"),
	extrair("pudim_UnidadeMaisAtrasada"),
	extrair("pudim_ProporcaoTrocaria")
].join("\n\n"), ctx);

const cc      = { ent: 150,  trainerEntities: ["units/woman", "units/skirmisher", "units/swordsman"] };
const quartel = { ent: 6177, trainerEntities: ["units/skirmisher", "units/swordsman"] };
const casa    = { ent: 900,  trainerEntities: [] };   // tem ProductionQueue, treina nada
const armazem = { ent: 901,  trainerEntities: [] };
const celeiro = { ent: 902,  trainerEntities: [] };
const RICO    = { food: 1459, wood: 2856, metal: 800, stone: 500 };

console.log("tamanho do lote");

// ── O caso exato do log ────────────────────────────────────────────────────────────────
// 15 "edifícios", 1 CC e 1 quartel de verdade, estoque farto. Dava 1.
const quinze = [cc, quartel, casa, armazem, celeiro,
                casa, armazem, celeiro, casa, armazem, celeiro, casa, armazem, celeiro, casa];
check("o caso do log de 25/08 não treina mais de 1 em 1",
	ctx.pudim_LoteIdeal("units/skirmisher", RICO, quinze) > 1,
	ctx.pudim_LoteDiag("units/skirmisher", RICO, quinze));
check("com estoque farto, vai ao lote máximo",
	ctx.pudim_LoteIdeal("units/skirmisher", RICO, quinze) === LOTE_MAX,
	ctx.pudim_LoteIdeal("units/skirmisher", RICO, quinze) + " de " + LOTE_MAX);

// A raiz: casa, armazém e celeiro têm IID_ProductionQueue (para pesquisar tecnologia) e
// entravam na divisão como se fossem disputar o estoque.
check("casa, armazém e celeiro não contam como quem treina",
	ctx.pudim_QuantosTreinam("units/skirmisher", quinze) === 2,
	ctx.pudim_QuantosTreinam("units/skirmisher", quinze));
check("e uma unidade só do centro cívico conta um edifício",
	ctx.pudim_QuantosTreinam("units/woman", quinze) === 1);
check("template desconhecido não divide por zero",
	ctx.pudim_QuantosTreinam("units/nada", quinze) === 1);

// ── Crescer a base não pode encolher o lote ────────────────────────────────────────────
// É o que mais denunciava o erro: quanto mais casa e armazém em pé — ou seja, quanto MAIS
// rico o jogador —, menor o lote.
const antes = ctx.pudim_LoteIdeal("units/skirmisher", RICO, [cc, quartel]);
const depois = ctx.pudim_LoteIdeal("units/skirmisher", RICO, quinze);
check("construir casas e armazéns não encolhe o lote", depois >= antes,
	antes + " → " + depois);

// ── O estoque continua mandando ────────────────────────────────────────────────────────
// A divisão não pode ter sumido: se dois quartéis semeiam no mesmo tique, cada um leva
// metade, senão o primeiro come o estoque e o segundo fica a ver navios.
const POUCO = { food: 300, wood: 300 };
check("estoque curto ainda limita o lote",
	ctx.pudim_LoteIdeal("units/skirmisher", POUCO, [cc]) === 6,
	ctx.pudim_LoteDiag("units/skirmisher", POUCO, [cc]));
check("e é dividido entre quem vai gastar do mesmo estoque",
	ctx.pudim_LoteIdeal("units/skirmisher", POUCO, [cc, quartel]) === 3,
	ctx.pudim_LoteDiag("units/skirmisher", POUCO, [cc, quartel]));
check("sem recurso nenhum, nunca devolve zero (1 é o mínimo)",
	ctx.pudim_LoteIdeal("units/skirmisher", { food: 0, wood: 0 }, [cc]) === 1);
check("o metal também entra na conta, não só comida e madeira",
	ctx.pudim_LoteIdeal("units/swordsman", { food: 9999, metal: 60 }, [cc]) === 3,
	ctx.pudim_LoteDiag("units/swordsman", { food: 9999, metal: 60 }, [cc]));

// O ganho que isso persegue: Trainer.GetBatchTime(n) = n^BatchTimeModifier, e o modificador
// do 0 A.D. é 0.7 — o tempo POR UNIDADE cai com n^-0.3.
const porUnidade = n => Math.pow(n, 0.7) / n;
check("lote 5 sai ~38% mais rápido por unidade que lote 1",
	Math.abs((1 - porUnidade(5) / porUnidade(1)) - 0.38) < 0.01);
check("lote 10, ~50%",
	Math.abs((1 - porUnidade(10) / porUnidade(1)) - 0.50) < 0.01);

// ── A proporção não pode ficar cancelando a si mesma ───────────────────────────────────
console.log("\nproporcao estavel");

function cenario(pesos, unidades) {
	ctx.g_PudimUnitPesos = pesos;
	ctx.g_PudimUnitTodas = unidades;
}
const T = { skirm: "units/skirmisher", sword: "units/swordsman", woman: "units/woman" };

// Dois pesos iguais, nada construído, 5 escaramuçadores recém-semeados. Contando a fila, a
// falta está no espadachim — e era isso que mandava cancelar os 5.
cenario({ [T.skirm]: 1, [T.sword]: 1 }, [
	{ tpl: T.skirm, existentes: 0, emFila: 5 },
	{ tpl: T.sword, existentes: 0, emFila: 0 }
]);
check("contando a fila, a falta realmente aponta para o outro tipo",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities).tpl === T.sword);
check("mas descontado o lote, não há troca a fazer — o ciclo se fecha aqui",
	ctx.pudim_ProporcaoTrocaria(quartel.trainerEntities, T.skirm, 5) === null);

// E depois que o lote sai, aí sim troca: é o comportamento que o jogador quer.
cenario({ [T.skirm]: 1, [T.sword]: 1 }, [
	{ tpl: T.skirm, existentes: 5, emFila: 0 },
	{ tpl: T.sword, existentes: 0, emFila: 0 }
]);
check("com o lote pronto, o alvo passa para o outro tipo",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities).tpl === T.sword);

// O caso que o jogador relatou: mulheres em série, ele põe peso no escaramuçador.
cenario({ [T.skirm]: 1 }, [
	{ tpl: T.skirm, existentes: 0, emFila: 0 },
	{ tpl: T.woman, existentes: 22, emFila: 3 }
]);
check("peso só no escaramuçador: cancela as mulheres enfileiradas",
	(ctx.pudim_ProporcaoTrocaria(cc.trainerEntities, T.woman, 3) || {}).tpl === T.skirm);

// ── Cada edifício pergunta pelo que ELE treina ─────────────────────────────────────────
// O quartel 6177 semeou lanceiro vinte vezes com prop=on porque a mais atrasada NO GERAL
// era cavalaria, que quartel não faz — e a checagem seguinte recusava e caía no palpite.
cenario({ "units/cavalry": 5, [T.skirm]: 1 }, [
	{ tpl: "units/cavalry", existentes: 0, emFila: 0 },
	{ tpl: T.skirm, existentes: 3, emFila: 0 }
]);
check("quem não treina cavalaria pede o melhor que consegue treinar",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities).tpl === T.skirm);
check("e quem treina cavalaria pede cavalaria",
	ctx.pudim_UnidadeMaisAtrasada(["units/cavalry", T.skirm]).tpl === "units/cavalry");
check("edifício que não treina nada com peso não pede nada",
	ctx.pudim_UnidadeMaisAtrasada([]) === null);

// ── Empate não pode alternar ───────────────────────────────────────────────────────────
cenario({ [T.skirm]: 1, [T.sword]: 1 }, [
	{ tpl: T.skirm, existentes: 4, emFila: 0 },
	{ tpl: T.sword, existentes: 4, emFila: 0 }
]);
check("empate perfeito ainda escolhe alguém",
	!!ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities));
check("mas com empate, quem já estava permanece — sem alternar a cada ciclo",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities, T.sword).tpl === T.sword &&
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities, T.skirm).tpl === T.skirm);
check("e empate não gera troca",
	ctx.pudim_ProporcaoTrocaria(quartel.trainerEntities, T.sword, 1) === null &&
	ctx.pudim_ProporcaoTrocaria(quartel.trainerEntities, T.skirm, 1) === null);

// Peso maior desempata quando não há preferido — senão a ordem da lista decidiria.
cenario({ [T.skirm]: 3, [T.sword]: 1 }, [
	{ tpl: T.skirm, existentes: 0, emFila: 0 },
	{ tpl: T.sword, existentes: 0, emFila: 0 }
]);
check("do zero, o de maior peso sai primeiro",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities).tpl === T.skirm);

// ── Peso zero é "não quero" ────────────────────────────────────────────────────────────
cenario({ [T.skirm]: 0, [T.sword]: 0 }, [
	{ tpl: T.skirm, existentes: 0, emFila: 0 },
	{ tpl: T.sword, existentes: 0, emFila: 0 }
]);
check("tudo zerado não pede nada — a auto-fila do jogo segue como estava",
	ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities) === null);

// ── Convergência: rodar o ciclo até o fim, e ver se ele para ───────────────────────────
// O teste que de fato responde ao relato. Simula o laço do painel: escolhe, semeia,
// pergunta se troca. Se a troca for instável, isto não converge.
cenario({ [T.skirm]: 2, [T.sword]: 1 }, [
	{ tpl: T.skirm, existentes: 0, emFila: 0 },
	{ tpl: T.sword, existentes: 0, emFila: 0 }
]);
// O lote é modelado como o motor o trata: enquanto `progress <= 0` ele pode ser cancelado;
// assim que começa, o cancelamento jogaria fora o tempo investido e o mod não mexe mais.
let lote = null, trocas = 0, produzidas = 0;
const u = t => ctx.g_PudimUnitTodas.find(x => x.tpl === t);
for (let ciclo = 0; ciclo < 500 && produzidas < 30; ciclo++) {
	if (!lote) {
		const tpl = ctx.pudim_UnidadeMaisAtrasada(quartel.trainerEntities, null).tpl;
		u(tpl).emFila += 3;
		lote = { tpl: tpl, restam: 3, iniciado: false };
		continue;
	}
	if (!lote.iniciado) {
		const troca = ctx.pudim_ProporcaoTrocaria(quartel.trainerEntities, lote.tpl,
			u(lote.tpl).emFila);
		if (troca) { u(lote.tpl).emFila -= lote.restam; lote = null; trocas++; continue; }
		lote.iniciado = true;
		continue;
	}
	u(lote.tpl).emFila -= 1;                // uma unidade sai da fila
	u(lote.tpl).existentes += 1;
	produzidas++;
	if (--lote.restam <= 0) lote = null;
}
check("30 unidades saem sem o mod cancelar a si mesmo", produzidas === 30, produzidas);
check("e sem nenhum cancelamento inútil", trocas === 0, trocas);
const fim = ctx.g_PudimUnitTodas.reduce((a, x) => (a[x.tpl] = x.existentes, a), {});
const razao = fim[T.skirm] / fim[T.sword];
check("a proporção 2:1 pedida é a que sai", Math.abs(razao - 2) < 0.35,
	fim[T.skirm] + ":" + fim[T.sword] + " = " + razao.toFixed(2));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
