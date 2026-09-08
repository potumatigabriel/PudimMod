/**
 * Casa não toma a vaga da fazenda.
 *
 * Relato de 07/09, com a base gaulesa apertada em volta do centro cívico: "vc ta fazendo mto
 * perto do cc... as casas".
 *
 * PUDIM_CINTURAO_FAZENDA (60) existe desde o pedido das fazendas coladas no CC — "as
 * fazendas tem que ficar retas com o cc... assim cabem mais". O comentário dele diz
 * "reservado para fazenda; nenhuma série constrói aqui", e quartel, estábulo, forja e torre
 * obedecem. A CASA nunca obedeceu: o filtro de candidatos dela só olhava território, borda do
 * mapa, número de vizinhas e rota de coleta.
 *
 * O custo não é estético: o anel colado no CC é onde a fazenda rende, e a comida já era o
 * gargalo medido no replay 2026-09-05_0005 (17.475 contra 35.485 do pand-_-).
 *
 * Rodar:  node tools/test_casa_cinturao.js
 */
"use strict";
const fs = require("fs");
// A cópia de trabalho é CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("casa nao toma a vaga da fazenda");

const CINT = +/const PUDIM_CINTURAO_FAZENDA = (\d+);/.exec(sim)[1];

// ── O mesmo número das outras construções ──────────────────────────────────────────────
// Um cinturão só para a casa seria um segundo número a manter em dia com o alcance da
// fazenda. A série já usa este; a casa passa a usar o mesmo.
check("a casa usa o MESMO cinturão da série, não um número novo",
	/PUDIM_CINTURAO_FAZENDA \* PUDIM_CINTURAO_FAZENDA;/.test(execS));
check("e a série continua ancorada nele",
	/const PUDIM_QUARTEL_RAIO_MIN = PUDIM_CINTURAO_FAZENDA;/.test(execS));
check("o filtro de candidatos da casa consulta o cinturão",
	/else if \(!foraDoCinturao\(cx, cz\)\) noCinturao\.push\(\{ x: cx, z: cz \}\);/.test(execS));

// ── Preferência, não proibição ─────────────────────────────────────────────────────────
//
// No começo da partida não há casa nenhuma e o construtor está junto do CC. Barrar tudo
// dentro do cinturão deixaria o jogador SEM CASA, que é pior que casa mal colocada.
check("candidato dentro do cinturão não é descartado, vai para o fim da fila",
	/for \(const c of noCinturao\) candidates\.push\(c\);/.test(execS));
check("e entra ANTES dos que cortam rota de coleta",
	execS.indexOf("for (const c of noCinturao) candidates.push(c);") <
	execS.indexOf("for (const b of bloqueados) candidates.push(b);"));

// A regra, espelhada: três camadas, da melhor para a pior.
function escolher(pontos, cc, cinturao) {
	const limpos = [], dentro = [], rota = [];
	for (const p of pontos) {
		const d2 = (p.x - cc.x) ** 2 + (p.z - cc.z) ** 2;
		if (p.rota) rota.push(p);
		else if (d2 < cinturao * cinturao) dentro.push(p);
		else limpos.push(p);
	}
	return limpos.concat(dentro).concat(rota)[0];
}
const CC = { x: 100, z: 100 };

const comEspaco = [
	{ x: 100, z: 120, nome: "colado no cc" },
	{ x: 100, z: 180, nome: "fora do cinturao" }
];
check("havendo lugar fora, a casa não vai para o anel do CC",
	escolher(comEspaco, CC, CINT).nome === "fora do cinturao");

const soPerto = [{ x: 100, z: 120, nome: "colado no cc" }];
check("mas se só houver lugar perto, a casa sai do mesmo jeito",
	escolher(soPerto, CC, CINT).nome === "colado no cc");

const pertoOuRota = [
	{ x: 100, z: 120, nome: "colado no cc" },
	{ x: 100, z: 200, nome: "em cima da rota", rota: true }
];
// Tomar a vaga de uma fazenda custa comida uma vez; cortar a rota custa caminhada de TODOS
// os coletores daquela rota, o tempo todo.
check("entre o cinturão e a rota de coleta, o cinturão perde primeiro",
	escolher(pertoOuRota, CC, CINT).nome === "colado no cc");

// A borda exata: o cinturão é a distância mínima, não uma faixa aproximada.
const naBorda = [{ x: 100, z: 100 + CINT, nome: "na borda" }];
check("um ponto exatamente na borda do cinturão já conta como fora",
	escolher(naBorda, CC, CINT).nome === "na borda");
check("e um passo para dentro, não",
	escolher([{ x: 100, z: 100 + CINT - 1, nome: "dentro" },
	          { x: 100, z: 100 + CINT + 40, nome: "fora" }], CC, CINT).nome === "fora");

// Sem CC (destruído) não há anel a proteger, e barrar tudo seria travar a reconstrução.
check("sem centro cívico o cinturão não se aplica",
	/if \(!ccPos\) return true;/.test(execS));

// ── Dá para conferir no log ────────────────────────────────────────────────────────────
// `cint>0` com `limpos=0` é o caso em que a casa realmente não tinha para onde ir — e
// distingue isso de o cinturão nunca ter sido aplicado, que era o defeito.
check("quantos candidatos caíram no cinturão sai no retorno",
	/"noCinturao": noCinturao\.length,/.test(execS));
check("e o painel registra no log",
	/" cint=" \+ \(houseData\.noCinturao\|\|0\) \+/.test(panel));

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("está escrito por que é preferência e não proibição",
	/deixaria o jogador sem casa/i.test(sim));
check("e que o anel do CC é da fazenda, com o pedido original citado",
	/reservado para fazenda/.test(sim) && /retas com o cc/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
