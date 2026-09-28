/**
 * Fazendas em grade, encostadas (28/09).
 *
 * Relato: "a construção automática de fazendas melhorou muito, mas ainda está um pouco
 * desordenada". No replay 2026-09-28_0004 os campos saíram de pontos de ANEL em volta do CC,
 * cada um "onde coube", e dois saíram no mesmo segundo a 10 de distância (um em cima do
 * outro; o motor recusou o segundo).
 *
 * Este teste roda a geração de candidatos de verdade (o trecho da grade de
 * pudim_GetFarmBuildData) e o filtro do painel para o mesmo ciclo.
 *
 * Rodar:  node tools/test_fazenda_grade.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// O trecho da grade, rodado com o que ele precisa em volta.
const i = sim.indexOf("\tlet passoCampo = 22;");
const j = sim.indexOf("\tconst validCandidates = [];", i);
const trecho = sim.slice(i, j);
function gerar(o) {
	const ctx = {
		Math, Set, result: {},
		fieldTemplate: "structures/gaul/field", fieldPositions: o.campos || [],
		cx: 500, cz: 500, seedPoints: o.seeds || [{ x: 500, z: 500 }],
		PUDIM_FAZENDA_ANEL_MIN: 6, PUDIM_FAZENDA_ANEL_MAX: 90,
		SYSTEM_ENTITY: 1, IID_TemplateManager: 9,
		Engine: { QueryInterface: () => ({ GetTemplate: () => ({ Obstruction: { Static: { "@width": o.largura || "22.0" } } }) }) }
	};
	vm.createContext(ctx);
	vm.runInContext(trecho + "\nthis.saida = { candidates, passoCampo, origem };", ctx);
	return Object.assign(ctx.saida, { result: ctx.result });
}

console.log("fazendas em grade");
{
	const g = gerar({});
	check("o passo é a obstrução do template (22) + meio metro de folga", g.passoCampo === 22.5 && g.result.passoCampo === 22.5);
	const alinhados = g.candidates.every(c => {
		const a = (c.x - 500) / 22.5, b = (c.z - 500) / 22.5;
		return Math.abs(a - Math.round(a)) < 1e-9 && Math.abs(b - Math.round(b)) < 1e-9;
	});
	check("sem campo, a grade se alinha ao CC", g.origem.x === 500 && alinhados);
	check("todo candidato dentro do alcance (6 a 90 do seed)", g.candidates.every(c => c.rSeed >= 6 && c.rSeed <= 90));
	check("nenhum ponto repetido", new Set(g.candidates.map(c => c.x + "," + c.z)).size === g.candidates.length);
	const pares = [];
	for (const a of g.candidates) for (const b of g.candidates)
		if (a !== b && Math.abs(a.x - b.x) < 22 && Math.abs(a.z - b.z) < 22) pares.push([a, b]);
	check("dois candidatos nunca se sobrepõem (é uma grade de passo ≥ lado)", pares.length === 0, pares.length);
}
{
	// Um campo já existe fora do alinhamento do CC: a grade se alinha a ELE.
	const campo = { x: 530.3, z: 471.7 };
	const g = gerar({ campos: [campo] });
	check("com campo existente, a grade se alinha ao campo", g.origem === campo || (g.origem.x === campo.x && g.origem.z === campo.z));
	const vizinhos = g.candidates.filter(c => c.encosta === 1);
	check("os 4 vizinhos do campo são marcados como encostados",
		vizinhos.length === 4 && vizinhos.every(c => Math.abs(Math.abs(c.x - campo.x) + Math.abs(c.z - campo.z) - 22.5) < 1e-6),
		vizinhos.map(c => c.x.toFixed(1) + "," + c.z.toFixed(1)).join(" "));
}
{
	const g = gerar({ largura: "30.0" });
	check("civilização com campo de outro tamanho: o passo acompanha o template", g.passoCampo === 30.5);
}
{
	// Dois seeds (CC e celeiro) perto um do outro: o mesmo nó não entra duas vezes.
	const g = gerar({ seeds: [{ x: 500, z: 500 }, { x: 540, z: 500 }] });
	check("seeds vizinhos não duplicam nós da grade", new Set(g.candidates.map(c => c.x + "," + c.z)).size === g.candidates.length);
	check("e continuam usando a MESMA grade (blocos alinhados)", g.candidates.every(c => {
		const a = (c.x - 500) / 22.5; return Math.abs(a - Math.round(a)) < 1e-9; }));
}

// ── A ordem e o painel ───────────────────────────────────────────────────────────────
check("na mesma faixa de segurança, ganha quem encosta em mais campos",
	/if \(tierA !== tierB\) return tierB - tierA;[^\n]*\n\s*if \(a\.encosta !== b\.encosta\) return b\.encosta - a\.encosta;/.test(sim));
check("o painel pula candidato que sobrepõe um campo escolhido no MESMO ciclo",
	/if \(escolhidos\.some\(e => Math\.abs\(e\.x - pos\.x\) < lado && Math\.abs\(e\.z - pos\.z\) < lado\)\) continue;/.test(panel) &&
	/escolhidos\.push\(\{ x: foundX, z: foundZ \}\);/.test(panel));
check("e o lado vem da simulação (o mesmo passo da grade)", /const lado = farmData\.passoCampo \|\| 22;/.test(panel));
check("a largura é lida como o jogo lê (Obstruction.Static[\"@width\"], Transform.js/ObstructionSnap.js)",
	/tplCampo\.Obstruction\.Static\["@width"\]/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
