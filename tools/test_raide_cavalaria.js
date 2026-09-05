/**
 * Raide de cavalaria: o anti vai-e-volta não pode matar o aldeão.
 *
 * Relato de 05/09, sobre a derrota do replay 2026-09-05_0005: "o que atrapalhou foi que ele
 * veio com cavalos na minha base muito cedo e matou aldeoes de comida".
 *
 * O que o replay mostra (comandos e séries do metadata, não inspeção):
 *
 *   min 10,0  pand-_- tinha 0 cavalaria treinada, 52 infantaria, 76 civis
 *   min 12,0  43 cavalarias — parou civis E infantaria no minuto 9,5 e virou tudo em cavalo
 *   min 12,6  primeiro pânico da partida inteira; o mod reagiu em 2 segundos
 *   min 13    162 guarnições
 *   min 14    57 SOLTURAS — e a população continuou caindo (139 no 14,5 para 132 no 15)
 *   coleta de comida: 927/30s antes do raide, 19/30s no minuto 14, nunca acima de 460 depois
 *
 * Duas regras do mod se voltaram contra ele, as duas por medirem tempo e não perigo:
 *
 *   PUDIM_REGARRISON_COOLDOWN (20s) impedia re-guarnecer quem tinha acabado de ser solto —
 *   inclusive com o cavalo em cima.
 *   PUDIM_PANIC_CALMA_MS (5s) soltava todo mundo assim que o raide se afastava do raio, que
 *   contra cavalaria é o intervalo entre duas passadas.
 *
 * Rodar:  node tools/test_raide_cavalaria.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
// Normaliza o fim de linha: a cópia de trabalho é CRLF e várias verificações abaixo casam
// trechos de mais de uma linha. Ver test_fim_de_linha.js.
const ler = f => fs.readFileSync(f, "utf8").split("\r\n").join("\n");
const sim = ler(path.join(base, "simulation", "components", "GuiInterface~pudim.js"));
const panel = ler(path.join(base, "gui", "session", "pudim_panel.js"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("raide de cavalaria");

const PERIGO = +/const PUDIM_PERIGO_IMEDIATO = (\d+);/.exec(panel)[1];
const COOLDOWN = +/const PUDIM_REGARRISON_COOLDOWN = (\d+);/.exec(panel)[1];
const CALMA = +/const PUDIM_PANIC_CALMA_MS = (\d+);/.exec(panel)[1];
const CALMA_R = +/const PUDIM_PANIC_CALMA_RAPIDA_MS = (\d+);/.exec(panel)[1];
const RISCO = +/const PUDIM_RISCO_RAIO = (\d+);/.exec(sim)[1];

// ── A distância sobe da simulação ──────────────────────────────────────────────────────
check("a simulação mede a distância ao inimigo mais próximo, não só 'sim ou não'",
	/let nearEnemy = false, perto2 = Infinity;/.test(execS) &&
	/const distInimigo = Math\.round\(Math\.sqrt\(perto2\)\);/.test(execS));
check("e ela viaja junto com o trabalhador em risco",
	/dist: distInimigo,/.test(execS));
// A varredura não pode mais parar no primeiro inimigo dentro do raio: precisa do MENOR.
check("a varredura não para no primeiro inimigo — precisa do mais próximo de todos",
	!/if \(d2 < PUDIM_RISCO_RAIO\*PUDIM_RISCO_RAIO\) \{ nearEnemy = true; break; \}/.test(execS));

// ── O cooldown cede ao perigo imediato ─────────────────────────────────────────────────
check("pudim_CanGarrison recebe a distância",
	/function pudim_CanGarrison\(entId, dist\) \{/.test(execP));
check("e com o inimigo em cima o cooldown não se aplica",
	/if \(dist !== undefined && dist !== null && dist <= PUDIM_PERIGO_IMEDIATO\) return true;/.test(execP));
check("os dois pontos de guarnição passam a distância",
	(execP.match(/pudim_CanGarrison\(worker\.id, worker\.dist\)/g) || []).length === 2,
	(execP.match(/pudim_CanGarrison\(worker\.id, worker\.dist\)/g) || []).length + " de 2");
check("a régua de perigo é bem menor que o raio de risco — não anula o cooldown inteiro",
	PERIGO < RISCO / 1.5, PERIGO + "m contra raio de risco de " + RISCO + "m");

// A regra, espelhada.
function podeGuarnecer(soltoHaMs, dist) {
	if (dist !== undefined && dist <= PERIGO) return true;
	return soltoHaMs === null || soltoHaMs > COOLDOWN;
}
check("aldeão solto há 6s com cavalo a 15m é guarnecido — era o caso do relato",
	podeGuarnecer(6000, 15));
check("aldeão solto há 6s com inimigo a 55m continua barrado (anti vai-e-volta vale)",
	!podeGuarnecer(6000, 55));
check("passado o cooldown, é guarnecido a qualquer distância do raio",
	podeGuarnecer(COOLDOWN + 1, 55));
check("quem nunca foi solto é guarnecido normalmente",
	podeGuarnecer(null, 55));

// ── A calma exigida depende de QUEM invadiu ────────────────────────────────────────────
check("a simulação conta quantos invasores são rápidos",
	/if \(eid2 && eid2\.HasClass\("FastMoving"\)\) rapidos\+\+;/.test(execS) &&
	/result\.fastEnemies = rapidos;/.test(execS));
check("o painel marca a ameaça como rápida",
	/if \(panicData\.underAttack && \(panicData\.fastEnemies \|\| 0\) > 0\)\s*\n\s*g_PudimAmeacaRapida = true;/.test(execP));
check("e a memória zera quando o pânico acaba, para não herdar ataque antigo",
	/else if \(!g_PudimPanicMode\)\s*\n\s*g_PudimAmeacaRapida = false;/.test(execP));
check("as duas solturas usam a calma variável, não a constante",
	(execP.match(/pudim_CalmaExigida\(\)/g) || []).length === 3,
	(execP.match(/pudim_CalmaExigida\(\)/g) || []).length + " (1 definição + 2 usos)");
check("a calma contra cavalaria é bem maior que a normal",
	CALMA_R >= CALMA * 4, (CALMA_R / 1000) + "s contra " + (CALMA / 1000) + "s");
// Mas não pode passar do teto que força o retorno, senão a economia nunca volta.
const MAXDUR = +/PUDIM_PANIC_MAX_DURATION = (\d+);/.exec(panel)[1];
check("e continua bem abaixo do teto que força o retorno de qualquer jeito",
	CALMA_R < MAXDUR / 2, (CALMA_R / 1000) + "s contra teto de " + (MAXDUR / 1000) + "s");

function calma(rapida) { return rapida ? CALMA_R : CALMA; }
check("tropa a pé: solta com a calma curta, como sempre foi",
	10000 > calma(false));
check("cavalaria: 10s de sumiço NÃO soltam ninguém — é só a volta do raide",
	!(10000 > calma(true)));
check("mas 30s soltam: o raide foi mesmo embora",
	30000 > calma(true));

// ── As travas que já existiam continuam ────────────────────────────────────────────────
check("batalha em curso ainda segura todo mundo",
	/if \(!manual && g_PudimEmCombate\) \{/.test(execP));
check("sem CC ou com abrigo cercado, ninguém sai sozinho",
	/if \(!manual && \(g_PudimNoCivCentre \|\| g_PudimSheltersUnderSiege > 0\)\)/.test(execP));
check("e o botão Voltar ao Trabalho continua soltando na mão",
	/pudim_ReturnPanicUnitsToWork\(true\);/.test(execP));

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("os números do replay ficam no código",
	/162 guarnições no minuto 13, 57 solturas no minuto 14/.test(panel));
check("e o replay é citado pelo nome",
	/2026-09-05_0005/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
