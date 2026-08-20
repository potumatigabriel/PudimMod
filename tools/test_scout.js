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
// A orbita agora segue a fronteira do territorio inimigo (ver test_scout_safety.js). O que
// continua valendo aqui e a geometria do PASSO: a corda entre duas paradas tem de ser maior
// que o raio de chegada do cliente, senao o scout "chega" sem sair do lugar. O pior caso e o
// menor raio possivel da orbita, R_MIN.
function orbitDist(gridSize) { return Math.max(100, 0.5477 * gridSize * 1.15); }
function orbitStep(gridSize) {
	const arrivalRadius = 0.5477 * gridSize;
	return Math.min(1.2, (arrivalRadius * 1.3 * 1.2) / orbitDist(gridSize));
}
check("a fórmula do passo é a que está no código",
	src.indexOf("Math.min(1.2, (arrivalRadius * 1.3 * 1.2) / R_MIN)") > 0);
check("o piso da órbita é o que está no código",
	src.indexOf("Math.max(100, 0.5477 * gridSize * 1.15)") > 0);
check("o piso nunca fica abaixo dos 100m de segurança", orbitDist(64) === 100, orbitDist(64));

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
check("varredura mantém trilho separado para o que ninguém está vendo",
	src.indexOf('bestNewPos = { "x": x, "z": z, "unexplored": exploreMod >= 1000 };') > 0);
check("inexplorado sempre vence explorado na escolha final",
	/if\s*\(bestNewPos\)\s*bestPos\s*=\s*bestNewPos;/.test(src));

// Cenário do bug: mapa 1536, tile já explorado a 10m do scout contra um nunca visto a 1200m.
// Com o bônus de +1000 e peso 1.0 na distância, o explorado ganhava. Com dois trilhos, não.
const scoreExplorado   = 0    - 10   + 10;   // exploreMod 0, distScout 10, angleCos 1
const scoreInexplorado = 1000 - 1200 + 10;   // exploreMod 1000, distScout 1200
check("o cenário do bug realmente invertia a escolha por score puro",
	scoreExplorado > scoreInexplorado,
	scoreExplorado + " vs " + scoreInexplorado);

// ── 4. Viés para o lado do mapa oposto ao nosso ────────────────────────────────────────
check("existe trilho de inexplorado no lado oposto",
	/bestFarPos = \{ "x": x, "z": z, "unexplored": true, "farSide": true \}/.test(src));
check("o lado oposto tem precedencia sobre o inexplorado generico",
	src.indexOf("if (bestFarPos) bestPos = bestFarPos;") > 0 &&
	src.indexOf("else if (bestNewPos) bestPos = bestNewPos;") > 0);
check("o filtro só vale no modo profundo",
	/mode === "deep" && pudimFriendAlign\(x, z\) < PUDIM_SCOUT_HOME_CONE/.test(src));
check("o cone de casa é 0.2 (deixa a faixa neutra do centro livre)",
	/const PUDIM_SCOUT_HOME_CONE = 0\.2;/.test(src));
check("as direções amigas saem de Diplomacy.GetAllies (cobre nós e aliados)",
	/cmpDiploSc\.GetAllies\(\)/.test(src) && /if \(pid <= 0\) continue;/.test(src));

// Réplica da geometria que está no código, para exercitar os cenários reais de mapa.
const MAP = 1024, MID = MAP / 2;
function friendAlign(x, z, bases) {
	if (!bases.length) return 0;
	const vx = x - MID, vz = z - MID, len = Math.hypot(vx, vz);
	if (len < 1) return 0;
	let best = -1;
	for (const b of bases) {
		const bx = b.x - MID, bz = b.z - MID, bl = Math.hypot(bx, bz);
		if (bl <= 1) continue;
		const dot = (vx / len) * (bx / bl) + (vz / len) * (bz / bl);
		if (dot > best) best = dot;
	}
	return best;
}
const CONE = 0.2;
const aceita = (x, z, bases) => friendAlign(x, z, bases) < CONE;

// Mapa espelhado de 2 jogadores: nossa base no canto superior esquerdo.
const nossa = [{ x: 200, z: 200 }];
check("fundo do nosso quintal é recusado", !aceita(120, 120, nossa),
	friendAlign(120, 120, nossa).toFixed(2));
check("canto oposto (base inimiga provável) é aceito", aceita(824, 824, nossa),
	friendAlign(824, 824, nossa).toFixed(2));
check("flanco perpendicular é aceito", aceita(824, 200, nossa),
	friendAlign(824, 200, nossa).toFixed(2));
check("centro do mapa é aceito (sem lado definido)", aceita(MID, MID, nossa));

// Time de 2 contra 2: nós em cima à esquerda, aliado embaixo à esquerda.
const timeEsq = [{ x: 200, z: 200 }, { x: 200, z: 824 }];
check("fundo do aliado também é recusado", !aceita(150, 880, timeEsq),
	friendAlign(150, 880, timeEsq).toFixed(2));
check("lado inimigo (direita) continua aceito", aceita(880, 500, timeEsq),
	friendAlign(880, 500, timeEsq).toFixed(2));

// Sem nenhuma base conhecida o filtro não pode barrar nada (alinhamento 0 < 0.2).
check("sem base conhecida nada é barrado", aceita(100, 100, []));

// O filtro é uma preferência, não uma prisão: quando não sobra tile no lado oposto,
// o código cai para bestNewPos. Isso é garantido pelo else-if verificado acima.

// ── 5. Modo local ("Explorar Base"): espiral cobrindo a base inteira ───────────────────
check("local deixou de exigir tile de BORDA do territorio",
	src.indexOf("let isBorder = false;") < 0);
check("local passa a incluir o territorio nosso, por raio",
	src.indexOf("if (distCCIn > baseRadius) continue;") > 0);
check("profundo continua pulando o territorio nosso",
	/if \(mode === "deep"\)[\s\S]{0,400}?if \(owner === player\) continue;/.test(src));
check("raio da base vem da estrutura nossa mais distante, com piso",
	src.indexOf("let baseRadius = 100;") > 0 && /idb\.HasClass\("Structure"\)/.test(src));
check("existe raio-alvo em espiral derivado de theta",
	src.indexOf("const spiralR = 0.25 * baseRadius + 0.75 * baseRadius * (thetaNorm / (2 * Math.PI));") > 0);
check("score local usa aderencia ao anel da espiral",
	src.indexOf("score = exploreMod + angleCos * 100 - Math.abs(distCC - spiralR) * 2;") > 0);
check("local prioriza ponto cego: hidden > fogged > visible",
	/visL === "hidden" \? 1000 : \(visL === "fogged" \? 300 : 0\)/.test(src));

// Réplica do raio da espiral, para checar que ela realmente varre da borda interna à externa.
function spiralR(theta, baseRadius) {
	const t = ((theta % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
	return 0.25 * baseRadius + 0.75 * baseRadius * (t / (2 * Math.PI));
}
const R = 200;
check("espiral comeca a 25% do raio da base", Math.abs(spiralR(0, R) - 50) < 0.01, spiralR(0, R));
check("espiral termina perto da borda da base", spiralR(2 * Math.PI - 0.01, R) > 0.99 * R,
	spiralR(2 * Math.PI - 0.01, R).toFixed(1));
// theta avanca 45 graus por waypoint no cliente: 8 paradas cobrem uma volta inteira.
const raios = [];
for (let k = 0; k < 8; k++) raios.push(spiralR(k * Math.PI / 4, R));
let cresce = true;
for (let k = 1; k < 8; k++) if (raios[k] <= raios[k - 1]) cresce = false;
check("os 8 waypoints de uma volta tem raios estritamente crescentes", cresce,
	raios.map(r => r.toFixed(0)).join(","));
check("nenhum anel fica com buraco maior que o passo da varredura (20m)",
	raios.every((r, k) => k === 0 || r - raios[k - 1] <= 20),
	raios.map(r => r.toFixed(0)).join(","));
// A volta seguinte recomeca do anel interno: cobertura ciclica, sem deixar o miolo para tras.
check("a volta seguinte reinicia no anel interno",
	Math.abs(spiralR(2 * Math.PI, R) - spiralR(0, R)) < 0.01);

// ── 6. A leitura de exploração é montada ANTES da órbita, senão a órbita não filtra ─────
check("losAt é definido antes do ramo de órbita",
	src.indexOf("let losAt = null;") < src.indexOf('if (mode === "deep" && enemyBasePos)'));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
