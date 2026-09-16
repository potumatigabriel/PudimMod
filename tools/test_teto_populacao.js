/**
 * No teto de populacao, parar de enfileirar. Ao abrir vaga, voltar na hora.
 *
 * Pedido de 15/09: "depois que a populacao atinge a populacao maxima, parar de treinar, Nao
 * ficar colocando unidades na fila (economizar recursos)... mas logo que morrer unidades,
 * colocar pra treinar imediatamente".
 *
 * MEDIDO no replay 2026-09-14_0004, cruzando a amostra de populacao (uma a cada 30s, de
 * metadata.json) com os comandos `train` da mesma janela:
 *
 *   t= 800s  pop 200   train  2        t=1037s  pop 200   train  0
 *   t= 830s  pop 200   train  0        t=1067s  pop 200   train 26
 *   t= 859s  pop 200   train  1        t=1096s  pop 200   train  5
 *   t= 889s  pop 200   train  0
 *   t= 919s  pop 200   train  0
 *   t= 948s  pop 200   train  3
 *
 * Dez amostras seguidas com a populacao cravada em 200, e 37 unidades enfileiradas nelas —
 * 26 numa janela so. O recurso sai do banco quando o lote comeca e fica preso num lote que
 * nao nasce.
 *
 * A regra vale nos DOIS tetos, e por isso usa o ATUAL (popLimit), nao o maximo da partida:
 * `popLimit - popCount` e quantas unidades podem nascer agora, e e a mesma conta que o jogo
 * usa para cinzar o botao de treino (o moderngui a repete em gui/session/PanelScripts.js).
 *
 * Rodar:  node tools/test_teto_populacao.js
 */
"use strict";
const fs = require("fs");
// A copia de trabalho e CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("teto de populacao: nao enfileirar o que nao pode nascer");

// ── 1. A simulacao manda o teto ATUAL ──────────────────────────────────────────────────
check("a simulacao envia popLimit, e nao so o maximo da partida",
	/"popLimit": cmpPlayer \? cmpPlayer\.GetPopulationLimit\(\) : 0,/.test(execS));
check("e continua enviando popCount, que e o outro lado da conta",
	/"popCount": cmpPlayer \? cmpPlayer\.GetPopulationCount\(\) : 0,/.test(execS));

// ── 2. A auto-fila calcula as vagas e para em zero ─────────────────────────────────────
check("a auto-fila calcula as vagas a partir do teto atual",
	/const vagasPop = Math\.max\(0, \(aqData\.popLimit \|\| 0\) - \(aqData\.popCount \|\| 0\)\);/.test(execP));
check("e 'cheio' passou a ser 'sem vaga', nao 'no maximo da partida'",
	/const popCheio = vagasPop <= 0;/.test(execP) &&
	!/const popCheio = \(aqData\.popMax/.test(execP));

// Os TRES caminhos que postam `train` respeitam o teto. Se um ficar de fora, o desperdicio
// volta por ele — foi assim que o popMax antigo cobria so a religacao da auto-fila do motor
// e deixava a semeadura do mod passar.
check("semeadura: o lote nao passa das vagas",
	/const affordable = Math\.min\(\s*\n?\s*pudim_ComputeAffordableCount\(template, desiredCount, res\), vagasPop\);/.test(execP));
check("troca por proporcao: nem acontece sem vaga, e o lote e limitado",
	/if \(isOurs && \(cur\.progress \|\| 0\) <= 0 && tplDesejado && !popCheio\)/.test(execP) &&
	/Math\.min\(desiredCount, affordable, vagasPop\)/.test(execP));
check("lote degradado: so troca se o lote inteiro couber nas vagas",
	/curCount < desiredCount &&\s*\n?\s*desiredCount <= vagasPop/.test(execP));
check("e a auto-fila do motor continua sem ser religada no teto",
	/if \(popCheio \|\| !podePagar\) continue;/.test(execP));

// A regra, espelhada.
const lote = (querido, paga, vagas) => Math.max(0, Math.min(querido, paga, vagas));
check("no teto nao sai lote nenhum — o caso das 26 do replay",
	lote(10, 10, 0) === 0);
check("com 3 vagas sai 3, nao 10 — nao prende o custo de 7 que nao nascem",
	lote(10, 10, 3) === 3);
check("o estoque continua mandando quando ele e o menor",
	lote(10, 2, 8) === 2);
check("e com espaco e dinheiro o lote e o desejado, como sempre foi",
	lote(10, 10, 50) === 10);

// ── 3. "Logo que morrer unidades, colocar pra treinar imediatamente" ───────────────────
//
// A auto-fila roda a cada 3s. Sem o gatilho, uma morte logo depois do ciclo custaria ate 3
// segundos de producao parada — justo depois de uma batalha, quando repor tropa mais vale.
check("ha um gatilho de retomada na transicao de sem-vaga para com-vaga",
	/if \(g_PudimSemVagaPop && vagasAgora > 0\) \{/.test(execP));
check("e ele nao espera o ciclo: enche o acumulador para o proximo quadro",
	/g_PudimAutoQueueAccum = PUDIM_AUTOQUEUE_INTERVAL;/.test(execP));
check("o estado e atualizado toda vez, senao o gatilho dispara uma vez so",
	/g_PudimSemVagaPop = vagasAgora === 0;/.test(execP));
check("o intervalo virou constante, em vez de 3000 solto em dois lugares",
	/const PUDIM_AUTOQUEUE_INTERVAL = 3000;/.test(execP) &&
	/if \(g_PudimAutoQueueAccum >= PUDIM_AUTOQUEUE_INTERVAL\)/.test(execP));

// A vaga por quadro vem do estado que o cliente ja tem — sem chamada nova a simulacao.
check("as vagas do quadro saem de g_SimState, sem chamada nova",
	/g_SimState\.players\[Engine\.GetPlayerID\(\)\]/.test(execP));
check("e 'nao sei' NAO vira 'pare de treinar'",
	/if \(!ps \|\| ps\.popLimit === undefined \|\| ps\.popCount === undefined\) return 1;/.test(execP) &&
	/catch \(e\) \{ return 1; \}/.test(execP));

// A regra do gatilho, espelhada.
function gatilho(seq) {
	let semVaga = false, disparos = 0;
	for (const v of seq) {
		if (semVaga && v > 0) disparos++;
		semVaga = v === 0;
	}
	return disparos;
}
check("cravado no teto, nenhum disparo — nada a retomar",
	gatilho([0, 0, 0, 0, 0]) === 0);
check("uma morte abre vaga e dispara uma vez",
	gatilho([0, 0, 1, 1, 1]) === 1);
check("duas batalhas, dois disparos",
	gatilho([0, 2, 0, 3]) === 2);
check("e sem nunca encher, nenhum disparo — o gatilho e da borda, nao do estado",
	gatilho([5, 4, 3, 2]) === 0);

// ── A procedencia ──────────────────────────────────────────────────────────────────────
check("a medicao do replay fica no codigo, com a janela das 26",
	/2026-09-14_0004/.test(panel) && /train 26/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
