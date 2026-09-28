/**
 * Casa demais no começo da partida.
 *
 * Relato de 13/09: "no começo faz muitas casas, mesmo tendo colocado limite diferente. n pode
 * no começo, pq cada recurso importa pra upgrades".
 *
 * MEDIDO NOS REPLAYS, e não por impressão. Casas INICIADAS nos 3 primeiros minutos, contando
 * os comandos `construct` de `.../house` em 8 partidas recentes:
 *
 *   Pudim (com o mod)   mediana 10   (5 a 15, em 7 partidas)
 *   todos os outros     mediana  2   (1 a 10, em 48 jogadores)
 *
 * Cinco vezes mais. Duas causas, e as duas ficam neste teste:
 *
 *   1. a projeção de população descontava o lote em produção, que o motor JÁ tinha somado à
 *      população (Player.TryReservePopulationSlots). Desde 28/09 a regra é a folga real.
 *   2. o teto de casas simultâneas tinha PISO 2 — duas casas ao mesmo tempo no primeiro
 *      minuto, quando a madeira vale mais.
 *
 * Rodar:  node tools/test_casa_inicio.js
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
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("casa no comeco da partida");

// ── 1. A folga é a REAL: o treino já está dentro da população (28/09) ──────────────────
//
// Relato de 28/09 (print, 24/30 com lote de 3 em treino): "está programado pra só fazer
// casa quando faltar 3 de população e mesmo assim fez casa mesmo tendo 6 de população
// disponível". Conferido em simulation/components/Player.js da A28:
// TryReservePopulationSlots faz `this.popUsed += num` quando o lote COMEÇA, e
// GetPopulationCount devolve `this.popUsed`. A projeção de 14/09 descontava de novo o lote
// em produção — que era justamente o já reservado. 6 − 3 = 3 ≤ 3, casa.
const corpoCasa = (function() {
	const i = execS.indexOf("pudim_GetAutoHouseData = function");
	const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
	return j < 0 ? execS.slice(i) : execS.slice(i, j);
})();
check("o recorte pegou a função da casa, e não o arquivo todo",
	corpoCasa.length > 500 && corpoCasa.length < execS.length / 3,
	corpoCasa.length + " caracteres");
check("a regra é a folga real contra o limite do jogador",
	/if \(rawHeadroom > threshold\) return \{ _skip: "pop\+" \+ rawHeadroom/.test(corpoCasa));
check("e a folga real é limite − população, a mesma conta da barra do jogo",
	/const rawHeadroom = popLimit - pop;/.test(corpoCasa));
check("o treino NÃO é descontado de novo (nem com teto)",
	!/rawHeadroom - trainingUsado/.test(corpoCasa) && !/projectedHeadroom/.test(corpoCasa));
check("o treino continua no log, marcado como já dentro da população",
	/"\|trn=" \+ trainingCount \+\s*\n?\s*"\(ja na pop\)>" \+ threshold/.test(corpoCasa));

// A regra, espelhada.
const decide = (vagas, limite) => vagas <= limite;
check("o caso do print: 24/30 com 3 em treino — 6 livres, limite 3: NÃO constrói", decide(6, 3) === false);
check("com 3 livres, constrói", decide(3, 3) === true);
check("o caso de 14/09 continua sem casa: folga 11 no começo", decide(11, 5) === false);

// ── 2. Uma casa por vez enquanto só há o centro cívico ─────────────────────────────────
check("o piso de casas simultâneas é 1, não 2",
	/const maxParallelHouses = Math\.max\(1, productionBuildingCount\);/.test(execS));
check("e o teto continua crescendo com os edifícios de produção",
	/Math\.max\(1, productionBuildingCount\)/.test(execS));

const teto = n => Math.max(1, n);
check("só o centro cívico: uma casa por vez", teto(1) === 1);
check("com quartel e estábulo, o teto acompanha", teto(3) === 3);
// O teto existe porque com muitos edifícios a população sobe rápido; não pode virar 1 fixo.
check("o teto NÃO é 1 fixo — isso viraria gargalo no meio da partida", teto(5) === 5);

// ── 3. O limite do jogador continua mandando ───────────────────────────────────────────
check("limite baixo constrói menos, como o jogador espera", decide(8, 3) === false && decide(3, 3) === true);
check("limite alto constrói mais", decide(8, 12) === true);
check("com casa em obra, espera a folga real cair à metade do limite",
	/if \(isBuildingHouseActive && rawHeadroom > Math\.floor\(threshold \/ 2\)\)/.test(corpoCasa));

// ── 5. E o padrão volta a 3 ────────────────────────────────────────────────────────────
// Pedido de 14/09: "tambem deixar por padrão, ao inves de 5, pra 3, a quantidade de espaco
// minimo disponivel pra criar casa". Era 5 porque "com 3 a casa saía tarde demais" — mas
// quem atrasava a casa era a conta da fila, não o número, e ela foi corrigida acima.
const painel = fs.readFileSync(
	path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
check("o padrão do limite de casas é 3",
	/var g_PudimAutoHouseThreshold = 3;/.test(painel));
// Os degraus do botão continuam existindo: o número é escolha do jogador, não do mod.
check("e o jogador continua podendo mudar pelos degraus do botão",
	/g_PudimAutoHouseThreshold === 5\) g_PudimAutoHouseThreshold = 3;/.test(painel) &&
	/g_PudimAutoHouseThreshold === 3\) g_PudimAutoHouseThreshold = 0;/.test(painel));

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("a medição dos replays fica no código, com os dois números",
	/mediana 10/.test(sim) && /mediana  2/.test(sim));
// A frase quebra em duas linhas de comentário, então o \s+ é obrigatório — a primeira versão
// procurava a frase inteira numa linha só e reprovava um texto que estava lá.
check("e está escrito por que o piso 2 era caro no primeiro minuto",
	/duas\s*(?:\/\/)?\s*vezes a madeira, de uma vez/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
