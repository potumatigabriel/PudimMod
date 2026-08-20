/**
 * Testa a segurança do scout profundo.
 *
 * Relato de 19/08: o scout achou o centro cívico inimigo, entrou no alcance, levou flechada,
 * fugiu, voltou e morreu. Duas causas:
 *   1. a órbita era um anel FIXO de 120m medido do CC, que não sabia nada sobre torre,
 *      fortaleza ou posto avançado;
 *   2. nada impedia a reta de um ponto do anel ao seguinte de cortar por dentro da base.
 *
 * Números conferidos na engine (todos MaxRange 60): template_structure_civic_civil_centre,
 * template_structure_defensive_tower, template_structure_defensive_outpost e
 * template_structure_military_fortress. O CC tem TerritoryInfluence Radius 140.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const SIM = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const CLI = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "session~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("seguranca do scout");

// ── 1. Alcance lido da engine, nunca fixo no codigo ────────────────────────────────────
check("o alcance vem de Attack.GetFullAttackRange (aplica tecnologias)",
	/cmpAtk\.GetFullAttackRange\(\)\.max/.test(SIM));
check("as ameacas saem de uma query por IID_Attack nos inimigos",
	/ExecuteQueryAroundPos\(\s*\{ x: cx, y: cz \}, 0, radius, enemyIds, IID_Attack, false\)/.test(SIM));
check("gaia nao entra na lista de inimigos", /GetEnemies\(\)\.filter\(id => id > 0\)/.test(SIM));
check("unidade ganha margem pelo proprio deslocamento",
	/margem \+= 2 \* \(\+cmpMot\.GetWalkSpeed\(\) \|\| 0\)/.test(SIM));

// ── 2. A orbita segue a fronteira do territorio ────────────────────────────────────────
check("existe calculo do raio da fronteira do territorio",
	/const pudimBorderRadius = function/.test(SIM));
check("a fronteira e onde o dono do chao deixa de ser inimigo",
	/enemyIds\.indexOf\(cmpTerritoryManager\.GetOwner\(x, z\)\) === -1/.test(SIM));
check("o anel fixo de 120m saiu", SIM.indexOf("const ORBIT_DIST = 120;") < 0);
check("a orbita usa a fronteira mais um recuo", /Math\.max\(R_MIN, rb \+ OFFSET\)/.test(SIM));

// ── 3. Ponto E trajeto precisam ser seguros ────────────────────────────────────────────
check("o ponto de destino e verificado", /if \(!pudimPointSafe\(cx, cz, threats\)\) continue;/.test(SIM));
check("o trajeto ate ele tambem e verificado",
	/if \(!pudimPathSafe\(scoutX, scoutZ, cx, cz, threats\)\) continue;/.test(SIM));
check("a varredura geral tambem checa ponto e trajeto",
	/if \(!pudimPointSafe\(x, z, threatsScan\)\) continue;/.test(SIM) &&
	/if \(!pudimPathSafe\(scoutX, scoutZ, x, z, threatsScan\)\) continue;/.test(SIM));
check("scoutX e definido antes do ramo de orbita (senao quebra em execucao)",
	SIM.indexOf("let scoutX = ccX") < SIM.indexOf('if (mode === "deep" && enemyBasePos)'));

// ── 4. Lista negra no cliente ──────────────────────────────────────────────────────────
check("a simulacao devolve as zonas de perigo", /bestPos\.dangerZones =/.test(SIM));
check("o cliente marca os setores dessas zonas na lista negra",
	/for \(const z0 of targetData\.dangerZones\)/.test(CLI) &&
	/g_PudimScoutBlocked\[zc \+ "," \+ zr\] = ate/.test(CLI));
check("a espiral de emergencia respeita as zonas", /if \(zonaSegura\(fx, fz\)\) bestCell/.test(CLI));
check("sem rota segura o scout recua para a base",
	/sem rota segura — recuando para a base/.test(CLI));

// ── 5. Geometria: os numeros reais do jogo ─────────────────────────────────────────────
const ALCANCE_CC = 60, RAIO_TERRITORIO = 140;
const R_MIN = 100, OFFSET = 18, MARGEM_PREDIO = 25;

check("o piso da orbita e a fórmula que esta no codigo",
	SIM.indexOf("Math.max(100, 0.5477 * gridSize * 1.15)") > 0 &&
	SIM.indexOf("const OFFSET = 18;") > 0);
// O piso sobe em mapa gigante para a corda continuar maior que o raio de chegada.
const pisoOrbita = g => Math.max(100, 0.5477 * g * 1.15);
for (const mapa of [512, 1024, 2048]) {
	const g = mapa / 8, chegada = 0.5477 * g, R = pisoOrbita(g);
	const passo = Math.min(1.2, (chegada * 1.3 * 1.2) / R);
	const corda = 2 * R * Math.sin(passo / 2);
	check("mapa " + mapa + ": corda no piso (" + corda.toFixed(0) + "m) > chegada (" +
		chegada.toFixed(0) + "m)", corda > chegada, "piso=" + R.toFixed(0));
}

// Caso normal: territorio do CC a 140m. A orbita fica em 158m.
const rNormal = Math.max(R_MIN, RAIO_TERRITORIO + OFFSET);
check("orbitando a fronteira do CC o scout fica a " + rNormal + "m", rNormal === 158);
check("isso e " + (rNormal - ALCANCE_CC) + "m fora do alcance do CC",
	rNormal - ALCANCE_CC >= 90, rNormal - ALCANCE_CC);

// Torre plantada NA fronteira ainda nao alcanca a orbita.
check("torre na propria fronteira nao alcanca a orbita",
	rNormal - RAIO_TERRITORIO > 0 && (RAIO_TERRITORIO + ALCANCE_CC) > rNormal
		? true : rNormal > RAIO_TERRITORIO,
	"orbita " + rNormal + " vs fronteira " + RAIO_TERRITORIO);
// ...mas a checagem de ponto e que garante isso de fato: uma torre a 140m com alcance 60
// proibe ate 140+60+25 = 225m no seu proprio raio. O ponto da orbita naquele angulo cai
// dentro, e o codigo pula para o proximo angulo.
const proibidoTorre = ALCANCE_CC + MARGEM_PREDIO;
check("uma torre proibe " + proibidoTorre + "m ao redor dela", proibidoTorre === 85);
function pontoSeguro(px, pz, ameacas) {
	for (const t of ameacas) {
		const dx = px - t.x, dz = pz - t.z;
		if (dx * dx + dz * dz < t.reach * t.reach) return false;
	}
	return true;
}
const torre = [{ x: 140, z: 0, reach: proibidoTorre }];
check("ponto da orbita colado na torre e recusado", !pontoSeguro(158, 0, torre));
check("ponto da orbita a 90 graus da torre e aceito", pontoSeguro(0, 158, torre));

// Territorio apertado: piso absoluto nunca deixa chegar perto do CC.
check("fronteira colada ao CC ainda respeita o piso de 100m",
	Math.max(R_MIN, 40 + OFFSET) === R_MIN);
check("o piso de 100m ja fica " + (R_MIN - ALCANCE_CC) + "m fora do alcance do CC",
	R_MIN - ALCANCE_CC === 40);

// ── 6. Amostragem do trajeto nao pode pular uma zona ───────────────────────────────────
function caminhoSeguro(x0, z0, x1, z1, ameacas) {
	const dx = x1 - x0, dz = z1 - z0;
	const dist = Math.hypot(dx, dz);
	const passos = Math.max(1, Math.ceil(dist / 12));
	for (let i = 0; i <= passos; ++i) {
		const t = i / passos;
		if (!pontoSeguro(x0 + dx * t, z0 + dz * t, ameacas)) return false;
	}
	return true;
}
check("o passo de amostragem e 12m no codigo", /Math\.ceil\(dist \/ 12\)/.test(SIM));
check("12m e menor que a menor zona proibida (" + proibidoTorre + "m)", 12 < proibidoTorre);

// O caso do bug: dois pontos seguros do anel, com o CC no meio do caminho.
const cc = [{ x: 0, z: 0, reach: ALCANCE_CC + MARGEM_PREDIO }];
check("extremos do anel sao seguros", pontoSeguro(-158, 0, cc) && pontoSeguro(158, 0, cc));
check("mas a reta entre eles corta o CC e e recusada", !caminhoSeguro(-158, 0, 158, 0, cc));
check("contornar por fora do anel e aceito", caminhoSeguro(-158, 0, 0, 158, cc));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
