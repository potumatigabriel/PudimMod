/**
 * Testa o abrigo e a fuga dos trabalhadores sob ataque.
 *
 * Relato de 19/08: "aldeões estão sendo atacados sem fugir". O log mostrava o pânico ATIVO
 * ("defendendo com 24 inimigo(s), protegendo trabalhadores") — o problema era o destino: no
 * ramo "pode defender" só o CENTRO CÍVICO entrava na lista de abrigos. Com 183 de população
 * e dezenas de casas, o CC enchia nas primeiras ~20 unidades e o resto ficava parado
 * apanhando, com as casas vazias ao lado.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PANEL = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");
const SIM = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("abrigo dos trabalhadores");

// ── 1. Casas voltaram a contar como abrigo ─────────────────────────────────────────────
check("o filtro que so aceitava CC saiu",
	PANEL.indexOf('panicData.shelters.filter(s => s.type === "cc" && s.freeSlots > 0)') < 0);
check("existe escolha de abrigo por categoria e distancia",
	/const escolherAbrigo = function\(w\)/.test(PANEL));
check("o trabalhador leva posicao para a escolha do abrigo mais perto",
	/x: wp2 \? wp2\.x : null, z: wp2 \? wp2\.y : null/.test(SIM));

// Réplica do ranking que está no código.
function rank(sh) { return (sh.type === "house" ? 0 : 1) + (sh.safe ? 0 : 2); }
check("casa segura e a primeira opcao", rank({ type: "house", safe: true }) === 0);
check("CC seguro vem depois da casa", rank({ type: "cc", safe: true }) === 1);
check("casa sob ameaca vem antes do CC sob ameaca",
	rank({ type: "house", safe: false }) < rank({ type: "cc", safe: false }));
check("abrigo sob ameaca ainda ganha de campo aberto (todos tem rank finito)",
	rank({ type: "cc", safe: false }) === 3);

// Escolha completa: casa perto vence CC perto, e entre casas vence a mais perto.
function escolher(w, abrigos) {
	let melhor = null, melhorRank = 99, melhorD = Infinity;
	for (const sh of abrigos) {
		if (sh.freeSlots <= 0) continue;
		const r = rank(sh);
		const dx = sh.x - w.x, dz = sh.z - w.z;
		const d = dx * dx + dz * dz;
		if (r < melhorRank || (r === melhorRank && d < melhorD)) { melhorRank = r; melhorD = d; melhor = sh; }
	}
	return melhor;
}
const w = { x: 0, z: 0 };
check("casa distante vence CC colado (casa tem prioridade)",
	escolher(w, [{ id: 1, type: "cc", safe: true, freeSlots: 5, x: 5, z: 0 },
	             { id: 2, type: "house", safe: true, freeSlots: 5, x: 60, z: 0 }]).id === 2);
check("entre casas vence a mais perto",
	escolher(w, [{ id: 3, type: "house", safe: true, freeSlots: 5, x: 60, z: 0 },
	             { id: 4, type: "house", safe: true, freeSlots: 5, x: 20, z: 0 }]).id === 4);
check("casa lotada e ignorada, cai no CC",
	escolher(w, [{ id: 5, type: "house", safe: true, freeSlots: 0, x: 10, z: 0 },
	             { id: 6, type: "cc", safe: true, freeSlots: 3, x: 90, z: 0 }]).id === 6);
check("tudo lotado devolve nada (dai o codigo manda fugir)",
	escolher(w, [{ id: 7, type: "house", safe: true, freeSlots: 0, x: 10, z: 0 }]) === null);
check("as vagas sao decrementadas para nao lotar o mesmo abrigo",
	/shelter\.freeSlots--;/.test(PANEL));

console.log("\nfuga quando nao ha abrigo");

// ── 2. Fuga na direcao OPOSTA ao atacante ──────────────────────────────────────────────
check("a simulacao calcula o ponto de fuga", /const pudimFleePoint = function\(wp\)/.test(SIM));
check("o ponto de fuga volta junto com o trabalhador",
	/fleeX: fuga \? fuga\.x : null, fleeZ: fuga \? fuga\.z : null/.test(SIM));
check("o painel manda andar quando nao ha abrigo",
	/\} else if \(worker\.fleeX !== null && worker\.fleeX !== undefined\)/.test(PANEL));
check("a ordem de fuga tem cooldown (senao o pathfinder reinicia todo ciclo)",
	/nowPanic - \(g_PudimFleeAt\[worker\.id\] \|\| 0\) > 5000/.test(PANEL));
check("a distancia sai do alcance real do inimigo, com piso",
	/Math\.max\(80, alcanceMax \+ 30\)/.test(SIM));
check("o alcance vem de Attack.GetFullAttackRange", /cmpAtk\.GetFullAttackRange\(\)\.max/.test(SIM));
check("testa um leque de rumos, nao so o oposto exato",
	/for \(let k = -3; k <= 3; \+\+k\)/.test(SIM) && /base \+ k \* \(Math\.PI \/ 9\)/.test(SIM));

// Réplica da geometria.
function pontoFuga(wx, wz, inimigos, alcanceMax, mapSize) {
	let sx = 0, sz = 0, n = 0;
	for (const e of inimigos) {
		const dx = wx - e.x, dz = wz - e.z;
		if (dx * dx + dz * dz > 120 * 120) continue;
		sx += e.x; sz += e.z; n++;
	}
	if (!n) return null;
	const cx = sx / n, cz = sz / n;
	let vx = wx - cx, vz = wz - cz;
	let len = Math.hypot(vx, vz);
	if (len < 1) { vx = 1; vz = 0; len = 1; }
	vx /= len; vz /= len;
	const dist = Math.max(80, alcanceMax + 30);
	const base = Math.atan2(vz, vx);
	let melhor = null, melhorD = -1;
	for (let k = -3; k <= 3; ++k) {
		const a = base + k * (Math.PI / 9);
		const tx = Math.max(12, Math.min(mapSize - 12, wx + Math.cos(a) * dist));
		const tz = Math.max(12, Math.min(mapSize - 12, wz + Math.sin(a) * dist));
		let perto = Infinity;
		for (const e of inimigos) {
			const dx = tx - e.x, dz = tz - e.z;
			perto = Math.min(perto, dx * dx + dz * dz);
		}
		if (perto > melhorD) { melhorD = perto; melhor = { x: tx, z: tz }; }
	}
	return melhor;
}
const MAPA = 1024;
const dist2 = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// Um atacante a oeste: o aldeao tem de acabar mais longe dele do que estava.
const umInimigo = [{ x: -30, z: 0 }];
const f1 = pontoFuga(0, 0, umInimigo, 72, MAPA);
check("foge para longe do atacante", dist2(f1, umInimigo[0]) > 30, dist2(f1, umInimigo[0]).toFixed(0));
check("nao corre PARA o atacante", f1.x > 0, "x=" + f1.x.toFixed(0));
check("sai do alcance de um arqueiro (72m)", dist2(f1, umInimigo[0]) > 72,
	dist2(f1, umInimigo[0]).toFixed(0));

// Cercado dos dois lados: o leque tem de achar a saida lateral.
const cerco = [{ x: -40, z: 0 }, { x: 40, z: 0 }];
const f2 = pontoFuga(0, 0, cerco, 20, MAPA);
const maisPerto2 = Math.min(dist2(f2, cerco[0]), dist2(f2, cerco[1]));
check("cercado, escolhe rumo que maximiza a distancia", maisPerto2 > 40, maisPerto2.toFixed(0));
check("a saida e lateral, nao para cima de um dos dois", Math.abs(f2.z) > 40, "z=" + f2.z.toFixed(0));

// Fugir nunca sai do mapa.
const f3 = pontoFuga(20, 20, [{ x: 60, z: 60 }], 72, MAPA);
check("o destino fica dentro do mapa", f3.x >= 12 && f3.z >= 12 && f3.x <= MAPA - 12);

// Inimigo em cima do aldeao (distancia zero) nao pode gerar divisao por zero.
const f4 = pontoFuga(100, 100, [{ x: 100, z: 100 }], 0, MAPA);
check("inimigo em cima do aldeao ainda produz um destino", f4 !== null && isFinite(f4.x));
check("e esse destino sai de perto", dist2(f4, { x: 100, z: 100 }) >= 80,
	dist2(f4, { x: 100, z: 100 }).toFixed(0));

// Inimigo longe demais nao dispara fuga (fora dos 120m que definem "em risco").
check("inimigo a mais de 120m nao gera fuga", pontoFuga(0, 0, [{ x: 400, z: 0 }], 72, MAPA) === null);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
