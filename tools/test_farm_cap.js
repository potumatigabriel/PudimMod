/**
 * Testa o teto de fazendas e o freio por estoque, contra o código REAL de
 * simulation/components/GuiInterface~pudim.js.
 *
 * Caso de 19/08: 15 campos e 66 trabalhadores em comida com 7904 de comida parada. O teto
 * era proporcional à população (até 20 campos) e o alvo vinha só da proporção de coleta,
 * que distribui por peso e ignora o estoque.
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

console.log("teto de fazendas e freio por estoque");

// ── 1. O teto voltou a ser fixo em 9 ───────────────────────────────────────────────────
check("PUDIM_MAX_FARMS é fixo em 9", /const PUDIM_MAX_FARMS = 9;/.test(src));
check("não sobrou teto proporcional à população",
	!/PUDIM_MAX_FARMS = Math\.max\(6/.test(src));
check("capacidade do campo continua 5 (MaxGatherers do template)",
	/const PUDIM_FIELD_CAPACITY = 5;/.test(src));

const MAX_FARMS = 9, FIELD_CAP = 5;
check("teto de trabalhadores vindos de fazenda = 45", MAX_FARMS * FIELD_CAP === 45);

// ── 2. Freio por estoque ───────────────────────────────────────────────────────────────
check("existe gate de estoque antes de construir",
	/if \(resCounts\.food > foodComfort\)/.test(src));
check("o gate roda depois do gate de madeira e antes do cálculo de déficit",
	src.indexOf('reason = "nowood"') < src.indexOf("resCounts.food > foodComfort") &&
	src.indexOf("resCounts.food > foodComfort") < src.indexOf("const deficit = farmWorkerTarget"));
check("o motivo entra no log com os números",
	/reason = "estoque_alto_" \+ Math\.round\(resCounts\.food\)/.test(src));

// Replica da fórmula que ficou no código (conferida pela asserção abaixo).
check("a fórmula do teste é a que está no código",
	src.indexOf("40 * Math.max(0, popCap - popNow) + 1000") > 0);
function comfort(popNow, popCap) { return 40 * Math.max(0, popCap - popNow) + 1000; }
function constroi(food, popNow, popCap) { return food <= comfort(popNow, popCap); }

// O caso real do print: pop 154/160, comida 7904.
check("caso real (154/160, 7904 comida): NÃO constrói",
	!constroi(7904, 154, 160), "conforto=" + comfort(154, 160));

// Começo de jogo: pop baixa, comida curta — tem de construir normalmente.
check("início (12/40, 300 comida): constrói", constroi(300, 12, 40),
	"conforto=" + comfort(12, 40));
check("meio de jogo (80/110, 900 comida): constrói", constroi(900, 80, 110),
	"conforto=" + comfort(80, 110));

// Muita vaga de população e comida alta: ainda vale plantar, porque a comida vai ser gasta
// enchendo essas vagas. É a razão de o conforto escalar com a folga de população.
check("pop 60/200 com 4000 de comida: constrói (folga grande de população)",
	constroi(4000, 60, 200), "conforto=" + comfort(60, 200));
check("pop 195/200 com 4000 de comida: NÃO constrói (sem onde gastar)",
	!constroi(4000, 195, 200), "conforto=" + comfort(195, 200));

// No teto de população o colchão fixo de 1000 é o que decide.
check("no teto de população o conforto é o colchão de 1000",
	comfort(200, 200) === 1000, comfort(200, 200));
check("no teto com 800 de comida ainda constrói", constroi(800, 200, 200));

// Monotonicidade: mais comida nunca pode voltar a liberar construção.
let mono = true;
for (let f = 0; f < 12000; f += 250)
	if (constroi(f, 154, 160) && !constroi(f - 250, 154, 160)) mono = false;
check("mais comida nunca reabre a construção", mono);

// ── 3. O alvo de trabalhadores respeita o teto dos campos ───────────────────────────────
check("farmWorkerCap deriva do teto x capacidade",
	/const farmWorkerCap = PUDIM_MAX_FARMS \* PUDIM_FIELD_CAPACITY;/.test(src));
check("o alvo é limitado por farmWorkerCap",
	/const farmWorkerTarget = Math\.min\(farmWorkerCap,/.test(src));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
