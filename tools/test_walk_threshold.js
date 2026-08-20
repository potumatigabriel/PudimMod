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
	src.indexOf("walkThresh = Math.max(35, (cap2 * spd2) / (2 * rate2));") > 0);
check("a taxa vem de GetGatherRates com a chave generic.specific",
	/rates2\[targetResType\.generic \+ "\." \+ targetResType\.specific\]/.test(src));
check("a capacidade vem de GetCapacity do próprio coletor",
	/cmpGath2\.GetCapacity\(targetResType\.generic\)/.test(src));
check("a velocidade vem de UnitMotion.GetWalkSpeed",
	/cmpMot2\.GetWalkSpeed\(\)/.test(src));
check("distância e limiar voltam para o log",
	/dropDist: Math\.round\(nearestDropDist\)/.test(src) && /thresh: Math\.round\(walkThresh\)/.test(src));

// ── Comportamento ──────────────────────────────────────────────────────────────────────
const PISO = 35, FALLBACK = 100;
function limiar(cap, spd, rate) {
	if (!(rate > 0 && cap > 0 && spd > 0)) return FALLBACK;
	return Math.max(PISO, (cap * spd) / (2 * rate));
}
const CAP = 10, SPD = 9;
const casos = [
	["fruta",  1.0,  45],
	["madeira", 0.7, 64],
	["pedra",  0.35, 129],
	["metal",  0.35, 129]
];
for (const [nome, taxa, esperado] of casos) {
	const d = limiar(CAP, SPD, taxa);
	check(nome + ": empate em ~" + esperado + "m", Math.abs(d - esperado) < 1, d.toFixed(1));
}

// No limiar o tempo andando é igual ao tempo colhendo — é essa a definição.
for (const [nome, taxa] of casos) {
	const d = limiar(CAP, SPD, taxa);
	const tColhe = CAP / taxa;
	const tAnda = 2 * d / SPD;
	check(nome + ": no limiar anda tanto quanto colhe", Math.abs(tColhe - tAnda) < 0.01,
		tColhe.toFixed(1) + "s vs " + tAnda.toFixed(1) + "s");
}

// O limiar antigo era frouxo justo onde mais dói: madeira é o grosso da economia.
check("100m fixo deixava passar 36m de desperdício em madeira",
	FALLBACK - limiar(CAP, SPD, 0.7) > 35, (FALLBACK - limiar(CAP, SPD, 0.7)).toFixed(0));
check("100m fixo deixava passar 55m em fruta",
	FALLBACK - limiar(CAP, SPD, 1.0) > 54, (FALLBACK - limiar(CAP, SPD, 1.0)).toFixed(0));
check("100m fixo era severo demais com pedra/metal",
	limiar(CAP, SPD, 0.35) > FALLBACK, limiar(CAP, SPD, 0.35).toFixed(0));

// Melhorias de coleta e de velocidade deslocam o limiar sozinhas, na direção certa.
check("coletar mais rápido aproxima o limiar", limiar(CAP, SPD, 1.4) < limiar(CAP, SPD, 0.7));
check("andar mais rápido afasta o limiar", limiar(CAP, 12, 0.7) > limiar(CAP, SPD, 0.7));
check("carregar mais afasta o limiar", limiar(15, SPD, 0.7) > limiar(CAP, SPD, 0.7));

// Piso e degradação segura.
check("piso de 35m protege contra vaivém colado no dropsite",
	limiar(CAP, SPD, 100) === PISO, limiar(CAP, SPD, 100));
check("taxa zero cai no fallback de 100m", limiar(CAP, SPD, 0) === FALLBACK);
check("componente ausente cai no fallback", limiar(0, 0, 0) === FALLBACK);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
