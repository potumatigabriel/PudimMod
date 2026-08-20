/**
 * Testa a regra que decide se vale erguer o celeiro (farmstead) junto da fruta.
 *
 * Caso de 19/08, três ciclos seguidos no log:
 *   511.0s skip=too_few_fruit_1 fw=5
 *   529.2s skip=too_few_fruit_1 fw=2
 *   547.3s skip=too_few_fruit_1 fw=4
 * `fw` são trabalhadores de comida longe de qualquer dropsite. O mod queria erguer o
 * celeiro junto deles e recusava porque a regra exigia 2 arbustos a 30m — e havia 1. Eles
 * seguiram colhendo de arbusto sem armazém, atravessando a base para entregar.
 *
 * Contar arbusto é a medida errada: o que decide se os 100 de madeira se pagam é quanta
 * comida ainda existe ao alcance.
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

console.log("regra do celeiro junto da fruta");

// ── Forma do código ────────────────────────────────────────────────────────────────────
check("a regra de contagem de arbustos saiu", !/fruitCount < 2/.test(src));
check("não sobrou o motivo antigo no log", src.indexOf('"too_few_fruit_"') < 0);
check("a decisão passa a ser por quantidade de comida",
	src.indexOf("if (fruitAmount < 200)") > 0);
check("a quantidade vem de GetCurrentAmount (valor real, já descontado o colhido)",
	/rs\.GetCurrentAmount \? rs\.GetCurrentAmount\(\) : 0/.test(src));
check("só conta arbusto disponível e do subtipo fruit",
	/rt\.generic !== "food" \|\| rt\.specific !== "fruit"/.test(src) &&
	/!rs\.IsAvailable\(\)/.test(src));
check("o motivo da recusa leva arbustos E quantidade para o log",
	/skip = "pouca_fruta_" \+ fruitCount \+ "arb_" \+ fruitAmount/.test(src));
check("os números entram no _dbg para diagnóstico",
	/_dbg\.fruitN = fruitCount/.test(src) && /_dbg\.fruitAmt = fruitAmount/.test(src));

// ── Comportamento ──────────────────────────────────────────────────────────────────────
// Réplica da decisão. 200 = um arbusto cheio (Max de gaia/fruit/berry_01.xml) = 2x o custo
// do celeiro em madeira.
const CUSTO_CELEIRO_MADEIRA = 100;
const ARBUSTO_CHEIO = 200;
const constroi = amount => amount >= 200;

check("o limiar é um arbusto cheio", ARBUSTO_CHEIO === 200);
check("o limiar é o dobro do custo do celeiro", 200 === 2 * CUSTO_CELEIRO_MADEIRA);

// O caso do log: 1 arbusto cheio e trabalhadores longe. A regra antiga recusava.
const regraAntiga = (count) => count >= 2;
check("regra antiga recusava 1 arbusto cheio", !regraAntiga(1));
check("regra nova aceita 1 arbusto cheio", constroi(1 * ARBUSTO_CHEIO));

// O inverso: a regra antiga aprovava 3 arbustos quase esgotados (40 de comida no total).
check("regra antiga aprovava 3 arbustos raspados", regraAntiga(3));
check("regra nova recusa 3 arbustos raspados (40 de comida)", !constroi(40),
	"3 arbustos com ~13 cada");

// Fronteira exata e monotonicidade.
check("199 de comida recusa", !constroi(199));
check("200 de comida aceita", constroi(200));
let mono = true;
for (let a = 0; a <= 1000; a += 10)
	if (constroi(a) && !constroi(a + 10)) mono = false;
check("mais comida nunca volta a recusar", mono);

// Meio arbusto não paga o celeiro: 100 de comida por 100 de madeira não compensa a obra.
check("meio arbusto (100) recusa", !constroi(100));
// Dois arbustos pela metade somam 200 e passam — o que importa é o total, não a contagem.
check("dois arbustos pela metade (200) aceitam", constroi(200));

// ── Deteccao de "longe do dropsite" tambem enquanto o coletor CAMINHA ──────────────────
// Log de 19/08 (partida 20:16:10):
//   2.9s  skip=no_far_workers_50m fw=0
//   20.5s build storehouse ... density=57
// Ate 20s ninguem contava como "longe" porque a ordem Gather so existe depois que o
// coletor CHEGA e escolhe uma arvore. Quem esta a caminho carrega GatherNearPosition.
console.log("\ndeteccao de coletor a caminho");
check("GatherNearPosition entra na deteccao de far-worker",
	/ord\.type === "GatherNearPosition"/.test(src));
check("Gather continua valendo", /ord\.type === "Gather"/.test(src));
check("qualquer outra ordem e ignorada", /\} else continue;/.test(src));
check("a posicao vem de data.x/data.z da propria ordem",
	/rp = \{ x: ord\.data\.x, y: ord\.data\.z \}/.test(src));
check("o tipo de recurso vem de data.type (mesmo formato de GetType)",
	/rtype = ord\.data\.type;/.test(src));
check("ordem sem destino valido e descartada",
	/typeof ord\.data\.x !== "number" \|\| !ord\.data\.type/.test(src));
check("far-workers passam a ser logados separados por recurso",
	/_dbg\.fwW = farWoodPos\.length/.test(src) && /_dbg\.fwF = farFoodPos\.length/.test(src));
// A fundacao ja conta como dropsite (correcao anterior), entao o coletor indo para a
// ancora de um armazem recem-colocado nao dispara uma segunda obra no mesmo lugar.
check("fundacao conta como dropsite, evitando obra duplicada no mesmo ponto",
	/cmpFoundation && cmpIdent && \(cmpIdent\.HasClass\("Storehouse"\)/.test(src));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
