/**
 * As casas não podem fechar o cerco em volta de ninguém.
 *
 * Relato de 01/09: "fez casas muito proximas e aldeoes ficaram presos".
 *
 * A suspeita óbvia — "estão perto demais" — estava ERRADA, e isso importa registrar porque
 * a correção que ela sugeriria (afastar as casas) espalharia o vilarejo sem resolver nada.
 *
 * Medi 1625 casas em 30 replays (`construct` de `.../house` no commands.txt): a mediana da
 * distância à vizinha mais próxima é 15,4m, com moda forte em 14-16m. O mod usava 20 — mais
 * FOLGADO que a prática humana.
 *
 * O problema é a TOPOLOGIA. O gerador propunha 8 direções a raio 20 em volta de cada casa, e
 * a corda entre dois candidatos vizinhos do anel é
 *
 *   2 × 20 × sen(π/8) = 15,3m
 *
 * exatamente a distância de duas casas encostadas. O anel de 8 fecha sozinho. Humanos
 * encostam casas tanto quanto, mas em FILA — e fila tem duas pontas abertas.
 *
 * Rodar:  node tools/test_casa_nao_prende.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("casas nao fecham cerco");

const ADJ = +/const PUDIM_CASA_ADJACENTE = (\d+);/.exec(sim)[1];
const MAXV = +/const PUDIM_CASA_MAX_VIZINHAS = (\d+);/.exec(sim)[1];
const RAIO = +/const PUDIM_CASA_ANEL_RAIO = (\d+);/.exec(sim)[1];
const DIRS = +/const PUDIM_CASA_ANEL_DIRECOES = (\d+);/.exec(sim)[1];

// ── A geometria que fechava o anel ─────────────────────────────────────────────────────
const corda = d => 2 * RAIO * Math.sin(Math.PI / d);

check("a adjacência medida está no código, com a procedência",
	ADJ >= 14 && ADJ <= 17, ADJ + "m");
check("e o número de casas medidas está escrito, não é 'eu acho'",
	/1625 casas de 30 replays/.test(sim));

check("com 8 direções a corda dava casas encostadas — o anel fechava",
	corda(8) < ADJ, corda(8).toFixed(1) + "m vs " + ADJ + "m de adjacência");
check("com o número atual de direções, sobra passagem",
	corda(DIRS) > ADJ, corda(DIRS).toFixed(1) + "m vs " + ADJ + "m");
// Passagem de verdade: uma unidade precisa de ~2m de folga para atravessar.
const folga = corda(DIRS) - ADJ;
check("e a folga é passável, não simbólica", folga >= 3, folga.toFixed(1) + "m");
// Não pode ser tão poucas direções que o vilarejo vire uma linha só.
check("mas ainda há direções bastantes para o vilarejo crescer em volta",
	DIRS >= 5, DIRS);

// ── O teto de vizinhas: fila sim, bolsão não ───────────────────────────────────────────
// Espelha casaPerto + a recusa: conta casas dentro do raio de vizinhança.
const RVIZ = ADJ + 3;
function vizinhas(casas, c) {
	return casas.filter(h => Math.hypot(h.x - c.x, h.z - c.z) < RVIZ).length;
}
const aceita = (casas, c) => vizinhas(casas, c) <= MAXV;

// Uma fila de casas: a próxima na ponta tem 1 vizinha, e passa.
const fila = [{x: 0, z: 0}, {x: ADJ, z: 0}, {x: 2*ADJ, z: 0}];
check("continuar uma fila é permitido — é assim que o vilarejo cresce",
	aceita(fila, { x: 3*ADJ, z: 0 }), vizinhas(fila, { x: 3*ADJ, z: 0 }) + " vizinha(s)");

// O buraco no meio de um bolsão: a casa que o taparia tem vizinhas por todos os lados.
const bolsao = [];
for (let i = 0; i < 6; i++) {
	const a = (i * 2 * Math.PI) / 6;
	bolsao.push({ x: Math.cos(a) * ADJ, z: Math.sin(a) * ADJ });
}
check("mas tapar o meio de um bolsão é recusado — era ali que o aldeão ficava preso",
	!aceita(bolsao, { x: 0, z: 0 }), vizinhas(bolsao, { x: 0, z: 0 }) + " vizinha(s)");

// O caso limite que separa os dois. As vizinhas têm de estar DENTRO do raio da candidata —
// na primeira versão deste teste eu as espalhei longe e o cenário não testava nada.
// Candidata na origem, vizinhas à distância de adjacência em direções diferentes.
function emVolta(quantas) {
	const fora = [];
	for (let i = 0; i < quantas; i++) {
		const a = (i * 2 * Math.PI) / Math.max(quantas, 3);
		fora.push({ x: Math.cos(a) * ADJ, z: Math.sin(a) * ADJ });
	}
	return fora;
}
const noLimite = emVolta(MAXV);
check("com exatamente o teto de vizinhas ainda passa",
	aceita(noLimite, { x: 0, z: 0 }), vizinhas(noLimite, { x: 0, z: 0 }) + " vizinha(s)");
const acimaDoLimite = emVolta(MAXV + 1);
check("uma a mais e recusa",
	!aceita(acimaDoLimite, { x: 0, z: 0 }), vizinhas(acimaDoLimite, { x: 0, z: 0 }) + " vizinha(s)");

// Longe de tudo continua livre: o teto não pode travar a primeira casa nem a expansão.
check("terreno livre não é afetado pelo teto",
	aceita(bolsao, { x: 200, z: 200 }));

// ── No código ──────────────────────────────────────────────────────────────────────────
check("a recusa está no filtro de candidatos, que todo caminho usa",
	/if \(casaPerto\(cx, cz\) > PUDIM_CASA_MAX_VIZINHAS\) return;/.test(sim));
check("e o filtro é aplicado ANTES de separar rota de livre",
	sim.indexOf("if (casaPerto(cx, cz) > PUDIM_CASA_MAX_VIZINHAS) return;") <
	sim.indexOf("if (naRota(cx, cz)) bloqueados.push"));
check("o anel usa as constantes, não números soltos",
	/for \(let i = 0; i < PUDIM_CASA_ANEL_DIRECOES; i\+\+\)/.test(sim) &&
	/Math\.cos\(angle\) \* PUDIM_CASA_ANEL_RAIO/.test(sim));
check("o raio de vizinhança sai da adjacência, não é um número independente",
	/const PUDIM_CASA_VIZINHA_RAIO = PUDIM_CASA_ADJACENTE \+ 3;/.test(sim));
check("o porquê está escrito — senão alguém 'melhora' voltando para 8 direções",
	/o anel de 8 fecha\s*\n?\s*\/\/ sozinho|anel de 8 fecha/.test(sim));
check("e está registrado que afastar as casas NÃO era a correção",
	/mais FOLGADO que a pratica humana/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
