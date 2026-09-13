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
 *   1. a projeção de população somava TODO lote da fila como se já tivesse nascido. O próprio
 *      mod enfileira lotes de até 10 (pudim_LoteIdeal), então bastava um lote para a projeção
 *      afundar abaixo do limite e a casa sair.
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

// ── 1. A projeção só conta quem está mesmo vindo ───────────────────────────────────────
check("lote que ainda não começou não entra na projeção",
	/if \(\(item\.progress \|\| 0\) <= 0\) continue;\s*\n\s*trainingCount \+= \(item\.count \|\| 1\);/.test(execS));
check("e o campo do template continua sendo o filtro de unidade",
	/if \(!item\.unitTemplate\) continue;/.test(execS));
// Se voltar a somar tudo, a regressão volta inteira. O recorte é só a função da casa: há
// OUTRA função que conta a fila inteira de propósito (a projeção de população do painel), e
// a primeira versão deste teste reprovava por causa dela — teste medindo o arquivo errado.
const corpoCasa = (function() {
	const i = execS.indexOf("pudim_GetAutoHouseData = function");
	const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
	return j < 0 ? execS.slice(i) : execS.slice(i, j);
})();
check("o recorte pegou a função da casa, e não o arquivo todo",
	corpoCasa.length > 500 && corpoCasa.length < execS.length / 3,
	corpoCasa.length + " caracteres");
check("a soma cega de todo lote NÃO voltou na regra da casa",
	!/if \(item\.unitTemplate\) trainingCount \+= \(item\.count \|\| 1\);/.test(corpoCasa));

// A regra, espelhada.
function projecao(vagas, fila) {
	let vindo = 0;
	for (const it of fila) if (it.unitTemplate && (it.progress || 0) > 0) vindo += (it.count || 1);
	return vagas - vindo;
}
const LOTE_GRANDE = [{ unitTemplate: "u", count: 10, progress: 0 }];
const LOTE_ANDANDO = [{ unitTemplate: "u", count: 10, progress: 0.4 }];
const LIMITE = 5;

check("lote de 10 só enfileirado não puxa a projeção para baixo",
	projecao(8, LOTE_GRANDE) === 8);
check("e por isso NÃO dispara casa — era esta a causa medida",
	projecao(8, LOTE_GRANDE) > LIMITE);
check("o mesmo lote, já em produção, conta inteiro",
	projecao(8, LOTE_ANDANDO) === -2);
check("e aí a casa sai, que é o comportamento certo",
	projecao(8, LOTE_ANDANDO) <= LIMITE);
// Pesquisa não é unidade e nunca contou; a guarda continua valendo.
check("item de pesquisa não conta como população",
	projecao(8, [{ progress: 0.9, count: 1 }]) === 8);

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
// A correção não pode passar por cima do que ele configurou: o limite é dele, e o que mudou
// foi a CONTA que decide se o limite foi atingido.
check("o limite configurado continua sendo o critério",
	/if \(projectedHeadroom > threshold\)/.test(execS));
check("e o log mostra os dois números para conferir depois",
	/"pop\+" \+ rawHeadroom \+ "\|trn=" \+ trainingCount \+ ">" \+ threshold/.test(execS));

function decide(vagas, fila, limite) { return projecao(vagas, fila) <= limite; }
check("limite baixo constrói menos, como o jogador espera",
	decide(8, LOTE_ANDANDO, 3) === true && decide(8, [], 3) === false);
check("limite alto constrói mais",
	decide(8, [], 12) === true);

// ── A procedência ──────────────────────────────────────────────────────────────────────
check("a medição dos replays fica no código, com os dois números",
	/mediana 10/.test(sim) && /mediana  2/.test(sim));
// A frase quebra em duas linhas de comentário, então o \s+ é obrigatório — a primeira versão
// procurava a frase inteira numa linha só e reprovava um texto que estava lá.
check("e está escrito por que o piso 2 era caro no primeiro minuto",
	/duas\s*(?:\/\/)?\s*vezes a madeira, de uma vez/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
