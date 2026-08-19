/**
 * Testa as duas correções do scout profundo, contra o código REAL de
 * simulation/components/GuiInterface~pudim.js.
 *
 * 1. O passo de órbita não pode mais usar Math.asin: o motor recusa asin dentro da
 *    simulação ("does not yet have a synchronization safe implementation") — erro vermelho
 *    em tela a cada waypoint e risco de dessincronizar em multiplayer. A substituição por
 *    comprimento de arco precisa continuar entregando corda MAIOR que o raio de chegada,
 *    senão o scout "chega" no ponto seguinte sem sair do lugar e queima a órbita parado.
 *
 * 2. Tile nunca visto tem de vencer qualquer tile já explorado, inclusive um colado no
 *    scout num mapa grande — era o "fica re-explorando o que já ta explorado".
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

console.log("scout profundo");

// ── 1. Nenhuma função Math não-determinística no componente de simulação ────────────────
const proibidas = ["asin", "acos", "atan(", "sinh", "cosh", "tanh", "random"];
const codigo = src.split("\n").filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l)).join("\n");
for (const fn of proibidas) {
	const re = new RegExp("Math\\." + fn.replace("(", "\\("));
	check("simulação não chama Math." + fn.replace("(", ""), !re.test(codigo));
}

// ── 2. O passo de órbita: corda >= raio de chegada, em vários tamanhos de mapa ──────────
// Replica exata da fórmula que ficou no código (conferida pela asserção logo abaixo).
function orbitDist(gridSize) { return Math.max(120, 0.5477 * gridSize * 1.15); }
function orbitStep(gridSize) {
	const arrivalRadius = 0.5477 * gridSize;
	return Math.min(1.2, (arrivalRadius * 1.3 * 1.2) / orbitDist(gridSize));
}
check("a fórmula do passo é a que está no código",
	src.indexOf("Math.min(1.2, (arrivalRadius * 1.3 * 1.2) / ORBIT_DIST)") > 0);
check("o raio da órbita é o que está no código",
	src.indexOf("Math.max(120, arrivalR0 * 1.15)") > 0);
check("a órbita nunca fica mais perto que os 120m táticos", orbitDist(64) === 120, orbitDist(64));

// gridSize = mapSize/8 nos tamanhos reais de mapa do jogo
for (const mapSize of [512, 768, 1024, 1536, 2048]) {
	const gridSize = mapSize / 8;
	const arrival = 0.5477 * gridSize;
	const s = orbitStep(gridSize);
	// corda real percorrida entre duas paradas da órbita
	const corda = 2 * orbitDist(gridSize) * Math.sin(s / 2);
	check("mapa " + mapSize + ": corda (" + corda.toFixed(0) + "m) > raio de chegada (" +
		arrival.toFixed(0) + "m)", corda > arrival, "s=" + s.toFixed(3));
}
// O clamp em 1.2 rad evita passo absurdo em mapa gigante (corda máx = 2R·sin(0.6) ≈ 135m)
check("passo nunca ultrapassa 1.2 rad", orbitStep(10000) === 1.2, orbitStep(10000));
// 32 passos precisam cobrir a volta inteira no menor mapa, senão a órbita nunca fecha
check("32 passos fecham a volta no mapa de 512", 32 * orbitStep(64) >= 2 * Math.PI,
	(32 * orbitStep(64)).toFixed(2));

// ── 3. Preferência dura por tile inexplorado ───────────────────────────────────────────
check("órbita tem passada que só aceita ponto não explorado",
	/soPontosNovos\s*&&\s*losAt\(cx,\s*cz\)\s*!==\s*"hidden"/.test(src));
check("varredura mantém trilho separado para tiles nunca vistos",
	/bestNewPos\s*=\s*\{\s*"x": x,\s*"z": z,\s*"unexplored": true\s*\}/.test(src));
check("inexplorado sempre vence explorado na escolha final",
	/if\s*\(bestNewPos\)\s*bestPos\s*=\s*bestNewPos;/.test(src));

// Cenário do bug: mapa 1536, tile já explorado a 10m do scout contra um nunca visto a 1200m.
// Com o bônus de +1000 e peso 1.0 na distância, o explorado ganhava. Com dois trilhos, não.
const scoreExplorado   = 0    - 10   + 10;   // exploreMod 0, distScout 10, angleCos 1
const scoreInexplorado = 1000 - 1200 + 10;   // exploreMod 1000, distScout 1200
check("o cenário do bug realmente invertia a escolha por score puro",
	scoreExplorado > scoreInexplorado,
	scoreExplorado + " vs " + scoreInexplorado);

// ── 4. A leitura de exploração é montada ANTES da órbita, senão a órbita não filtra ─────
check("losAt é definido antes do ramo de órbita",
	src.indexOf("let losAt = null;") < src.indexOf('if (mode === "deep" && enemyBasePos)'));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
