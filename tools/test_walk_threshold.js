/**
 * Testa o limiar de "caminhada demais" do detector de long walker.
 *
 * Pedido de 19/08: detectar quem anda muito para entregar e ou mover para recurso do mesmo
 * tipo perto de um dropsite, ou erguer um dropsite perto do recurso. O detector já fazia as
 * duas coisas — o que estava errado era QUANDO ele acordava: um limiar fixo de 100m,
 * igual para todos os recursos.
 *
 * O coletor alterna encher a carga e levar até o dropsite:
 *     encher    = capacidade / taxa
 *     ida+volta = 2 x distancia / velocidade
 * Igualando, a distancia em que ele passa a gastar mais tempo andando do que colhendo:
 *     d = capacidade x velocidade / (2 x taxa)
 *
 * Números conferidos na engine:
 *   template_unit.xml                      → WalkSpeed 9
 *   template_unit_support_female_citizen   → Capacities 10; food.fruit 1.0, wood.tree 0.7,
 *                                            stone.rock 0.35, metal.ore 0.35
 */
"use strict";
const fs = require("fs");
const path = require("path");

const SRC = path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js");
const src = fs.readFileSync(SRC, "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("limiar de caminhada longa");

// ── Forma do código ────────────────────────────────────────────────────────────────────
check("o limiar fixo de 100m saiu do caminho de decisão",
	src.indexOf("if (nearestDropDist <= 100) continue;") < 0);
check("a decisão usa o limiar calculado",
	src.indexOf("if (nearestDropDist <= walkThresh) continue;") > 0);
check("a fórmula é capacidade x velocidade / (2 x taxa)",
	src.indexOf("const empate = (cap2 * spd2) / (2 * rate2);") > 0);
check("são DOIS limiares: um para construir, outro para mover",
	/walkThresh = Math\.max\(PUDIM_WALK_PISO_OBRA, empate\);/.test(src) &&
	/moveThresh = Math\.max\(PUDIM_WALK_PISO, PUDIM_WALK_MARGEM \* empate\);/.test(src));
check("o limiar de obra é menor que o de mover",
	+/const PUDIM_WALK_PISO_OBRA = (\d+);/.exec(src)[1] <
	+/const PUDIM_WALK_PISO = (\d+);/.exec(src)[1]);
check("o coletor carrega a marca de quem pode ser movido",
	/podeMover: nearestDropDist > moveThresh/.test(src));
check("com margem sobre o empate, e não no empate",
	/const PUDIM_WALK_MARGEM = 1\.5;/.test(src));
check("e com o piso em 55m",
	/const PUDIM_WALK_PISO = 55;/.test(src));
check("a taxa vem de GetGatherRates com a chave generic.specific",
	/rates2\[targetResType\.generic \+ "\." \+ targetResType\.specific\]/.test(src));
check("a capacidade vem de GetCapacity do próprio coletor",
	/cmpGath2\.GetCapacity\(targetResType\.generic\)/.test(src));
check("a velocidade vem de UnitMotion.GetWalkSpeed",
	/cmpMot2\.GetWalkSpeed\(\)/.test(src));
check("distância e limiar voltam para o log",
	/dropDist: Math\.round\(nearestDropDist\)/.test(src) && /thresh: Math\.round\(walkThresh\)/.test(src));

// ── Comportamento ──────────────────────────────────────────────────────────────────────
// Espelha o cálculo do mod. MARGEM e PISO existem porque o EMPATE não é o ponto de agir:
// no empate o coletor ainda entrega meia carga por ciclo, e movê-lo custa uma viagem
// inteira sem colher nada. Ver o teste da regressão de 25/08, no fim do arquivo.
const MARGEM = 1.5, PISO = 55, FALLBACK = 100 * MARGEM;
function empate(cap, spd, rate) { return (cap * spd) / (2 * rate); }
function limiar(cap, spd, rate) {
	if (!(rate > 0 && cap > 0 && spd > 0)) return FALLBACK;
	return Math.max(PISO, MARGEM * empate(cap, spd, rate));
}
const CAP = 10, SPD = 9;
const casos = [
	["fruta",  1.0,  45],
	["madeira", 0.7, 64],
	["pedra",  0.35, 129],
	["metal",  0.35, 129]
];
for (const [nome, taxa, esperado] of casos) {
	const d = empate(CAP, SPD, taxa);
	check(nome + ": empate em ~" + esperado + "m", Math.abs(d - esperado) < 1, d.toFixed(1));
}

// No EMPATE o tempo andando é igual ao tempo colhendo — é essa a definição dele.
for (const [nome, taxa] of casos) {
	const d = empate(CAP, SPD, taxa);
	const tColhe = CAP / taxa;
	const tAnda = 2 * d / SPD;
	check(nome + ": no empate anda tanto quanto colhe", Math.abs(tColhe - tAnda) < 0.01,
		tColhe.toFixed(1) + "s vs " + tAnda.toFixed(1) + "s");
}

// E o gatilho fica DEPOIS do empate: só age quando já anda bem mais do que colhe.
for (const [nome, taxa] of casos) {
	const d = limiar(CAP, SPD, taxa);
	check(nome + ": o gatilho não é o empate", d > empate(CAP, SPD, taxa) || d === PISO,
		d.toFixed(0) + " vs empate " + empate(CAP, SPD, taxa).toFixed(0));
}

// O limiar antigo era frouxo justo onde mais dói: madeira é o grosso da economia.
check("100m fixo deixava passar desperdício em madeira",
	limiar(CAP, SPD, 0.7) < 100, limiar(CAP, SPD, 0.7).toFixed(0));
check("100m fixo deixava passar desperdício em fruta",
	limiar(CAP, SPD, 1.0) < 100, limiar(CAP, SPD, 1.0).toFixed(0));
check("100m fixo era severo demais com pedra/metal",
	limiar(CAP, SPD, 0.35) > 100, limiar(CAP, SPD, 0.35).toFixed(0));

// Melhorias de coleta e de velocidade deslocam o limiar sozinhas, na direção certa.
check("coletar mais rápido aproxima o limiar", limiar(CAP, SPD, 1.4) < limiar(CAP, SPD, 0.7));
check("andar mais rápido afasta o limiar", limiar(CAP, 12, 0.7) > limiar(CAP, SPD, 0.7));
check("carregar mais afasta o limiar", limiar(15, SPD, 0.7) > limiar(CAP, SPD, 0.7));

// Piso e degradação segura.
check("o piso protege contra vaivém colado no dropsite",
	limiar(CAP, SPD, 100) === PISO, limiar(CAP, SPD, 100));
check("taxa zero cai no fallback", limiar(CAP, SPD, 0) === FALLBACK);
check("componente ausente cai no fallback", limiar(0, 0, 0) === FALLBACK);

// ── A regressão de 25/08, cravada ─────────────────────────────────────────────────────
//
// O jogador viu os coletores de fruta indo e voltando sem parar e chamou de "passeio". O
// log dava o número exato, repetido a cada ciclo:
//
//     251.9s [WALK] longe do dropsite: 4 ... food 42m/lim35 x4
//     270.6s [WALK] redirecionando 2 walker(s) sem dropsite disponível
//     272.2s [WALK] longe do dropsite: 4 ... food 42m/lim35 x4
//
// 42m de um arbusto até o CC é distância banal — o CC sozinho tem ~20m de footprint. O
// limiar tinha caído para 35 porque a taxa de fruta subiu com as melhorias, e agir no
// empate transformou uma coleta normal em realocação perpétua. Pior: o despacho, que usa
// outro critério, mandava OUTROS coletores para a mesma fruta no mesmo tique.
//
// A taxa exata daquela partida não está no log; o que importa é que NENHUMA taxa de fruta
// plausível pode marcar 42m como caminhada longa.
console.log("");
console.log("regressao de 25/08: o passeio dos coletores de fruta");
const DIST_RELATADA = 42;
for (const taxa of [1.0, 1.15, 1.3, 1.5, 2.0, 3.0]) {
	const d = limiar(CAP, SPD, taxa);
	check("fruta a taxa " + taxa.toFixed(2) + ": " + DIST_RELATADA + "m não é caminhada longa",
		DIST_RELATADA <= d, "limiar " + d.toFixed(0));
}
check("com a fórmula antiga o relato se reproduz (o teste vale de verdade)",
	42 > Math.max(35, empate(CAP, SPD, 1.5)), Math.max(35, empate(CAP, SPD, 1.5)).toFixed(0));

// O piso tem de cobrir a fruta de base: arbustos ficam tipicamente a 40-50m do CC.
check("o piso cobre o arbusto de base típico (até 50m)", PISO >= 50, PISO);

// ── A contradição dos 83m, do mesmo dia ───────────────────────────────────────────────
//
// Segunda observação do jogador, olhando os lenhadores contornarem um quarteirão de casas:
// "a essa distância talvez fosse melhor outro armazém mais próximo às árvores, não seria?"
//
// O log mostrava o mod discordando de si mesmo em duas linhas quase simultâneas:
//
//     1026s [WALK] longe do dropsite: 7 ... wood 83m/lim77
//     1004s [DROP] skip=within_85pct_CC_dist nd=57 thr=70 fw=12
//
// O detector via 83m e pedia socorro; o construtor via 57m e recusava. Mediam coisas
// diferentes — o detector olha cada trabalhador, o construtor olhava o CENTRÓIDE do grupo,
// que por ser média encolhe justamente a cauda que está andando demais.
//
// E havia um segundo erro por baixo: um limiar só para duas decisões de custo muito
// diferente. Construir custa 100 de madeira e não move ninguém; mover custa duas caminhadas
// e a carga parcial largada. A 83m com 19 lenhadores a obra é óbvia e mover é discutível.
console.log("");
console.log("contradicao dos 83m: obra e movimento nao sao a mesma decisao");
const PISO_OBRA = 40;
function limiarObra(cap, spd, rate) {
	if (!(rate > 0 && cap > 0 && spd > 0)) return 100;
	return Math.max(PISO_OBRA, empate(cap, spd, rate));
}
const DIST_MADEIRA = 83;
// A taxa exata da partida não está no log, mas dá para cercá-la: o mod reportou lim77 com a
// fórmula antiga (empate puro, piso 35), então empate ≈ 77 → taxa ≈ 0.58.
const TAXA_DAQUELA_PARTIDA = (CAP * SPD) / (2 * 77);
check("a taxa inferida do log bate com o lim77 reportado",
	Math.abs(empate(CAP, SPD, TAXA_DAQUELA_PARTIDA) - 77) < 0.5,
	empate(CAP, SPD, TAXA_DAQUELA_PARTIDA).toFixed(1));
check("83m de madeira JUSTIFICA construir um armazém",
	DIST_MADEIRA > limiarObra(CAP, SPD, TAXA_DAQUELA_PARTIDA),
	"limiar de obra " + limiarObra(CAP, SPD, TAXA_DAQUELA_PARTIDA).toFixed(0));
check("mas NÃO justifica arrancar os lenhadores de lá",
	DIST_MADEIRA < limiar(CAP, SPD, TAXA_DAQUELA_PARTIDA),
	"limiar de mover " + limiar(CAP, SPD, TAXA_DAQUELA_PARTIDA).toFixed(0));
check("os dois limiares não podem coincidir, senão a distinção não existe",
	limiarObra(CAP, SPD, 0.7) < limiar(CAP, SPD, 0.7));

// A eficiência a 83m explica por que a obra compensa tão rápido.
const tColhe83 = CAP / TAXA_DAQUELA_PARTIDA;
const tAnda83 = 2 * DIST_MADEIRA / SPD;
const efAntes = tColhe83 / (tColhe83 + tAnda83);
const tAndaDepois = 2 * 15 / SPD;   // armazém a ~15m das árvores
const efDepois = tColhe83 / (tColhe83 + tAndaDepois);
check("a 83m o lenhador passa menos da metade do tempo colhendo",
	efAntes < 0.5, (efAntes * 100).toFixed(0) + "%");
check("com armazém perto ele volta para acima de 75%",
	efDepois > 0.75, (efDepois * 100).toFixed(0) + "%");
// 19 lenhadores é o fw= do log naquele instante.
const ganhoPorSeg = 19 * TAXA_DAQUELA_PARTIDA * (efDepois - efAntes);
check("com 19 lenhadores o armazém (100 de madeira) se paga em menos de 30s",
	100 / ganhoPorSeg < 30, (100 / ganhoPorSeg).toFixed(0) + "s");

// ── E o construtor tem de usar o MESMO número que o detector ──────────────────────────
check("existe um helper único de limiar de obra, para os dois sistemas",
	/function pudim_LimiarObra\(ent, generico\)/.test(src));
check("o gate do armazém chama esse helper em vez de um número fixo",
	/nearestSHToWorkers > pudim_LimiarObra\(/.test(src) &&
	src.indexOf("if (nearestSHToWorkers > 80) {") < 0);
check("e mede o PIOR trabalhador, não o centróide do grupo",
	/for \(const p of farWoodPos\) \{[\s\S]{0,400}?if \(dMin > nearestSHToWorkers/.test(src));
check("o pior lenhador vai para o log, para dar para conferir em jogo",
	/result\._dbg\.piorLenhador/.test(src));
check("o helper indexa a taxa como generic.specific, igual ao motor",
	/generico \+ "\." \+ esp/.test(src));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
