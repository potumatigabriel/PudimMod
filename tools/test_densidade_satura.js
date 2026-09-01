/**
 * A densidade satura: passado o ponto em que a mata dá conta, árvore a mais não vale nada.
 *
 * Relato de 01/09: "tem arvores mais proximas ao armazem, mas o mod manda pra essa um pouco
 * mais longe".
 *
 * A causa estava na própria fórmula de escolha de recurso:
 *
 *   score = density × 40 − distToDropsite × 3 − distToWorker × 1.5
 *
 * `density` conta vizinhas num raio de 60m. E dentro de uma mata, a árvore do INTERIOR
 * sempre tem mais vizinhas que a da borda — é geometria, não qualidade. Com peso 40, cada
 * vizinha a mais compra 13,3m de distância ao armazém (40/3); dez de diferença entre borda e
 * miolo compram 133m. A árvore colada no armazém perdia sempre.
 *
 * Ou seja: a densidade não estava escolhendo entre MATAS, que era o propósito declarado no
 * código ("preferir floresta próxima de armazém existente"); estava escolhendo o miolo da
 * mesma mata, contra o transporte. E o rendimento de um lenhador é quase todo viagem de ida
 * e volta.
 *
 * Saturando, as duas pontas de qualquer mata de verdade empatam em densidade e a distância
 * decide. O que a densidade ainda faz — e por isso continua na conta — é descartar a árvore
 * solitária, que não chega ao teto e perde, como deve: ela acaba e obriga a remarcar.
 *
 * Rodar:  node tools/test_densidade_satura.js
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

// Constantes lidas do código — mexer nelas move o teste junto, em vez de deixá-lo mentir.
const TETO = +/const PUDIM_DENSIDADE_SUFICIENTE = (\d+);/.exec(sim)[1];
const W_DENS = +/const densityWeight = type === "food" \? 20 : (\d+);/.exec(sim)[1];
const W_DROP = +/const distToDropsiteWeight = type === "food" \? 2 : (\d+);/.exec(sim)[1];
const W_WORK = +/const distToWorkerWeight = type === "food" \? 1 : ([\d.]+);/.exec(sim)[1];

function score(dens, distDropsite, distWorker, satura) {
	const d = satura ? Math.min(dens, TETO) : dens;
	return d * W_DENS - distDropsite * W_DROP - distWorker * W_WORK;
}

console.log("densidade satura, distancia decide");

check("o teto é declarado no código", TETO > 0, TETO);
check("e os pesos continuam os do código", W_DENS === 40 && W_DROP === 3,
	W_DENS + "/" + W_DROP + "/" + W_WORK);

// ── O caso relatado ────────────────────────────────────────────────────────────────────
// Árvore na borda, colada no armazém (5m), com 9 vizinhas. Árvore no miolo, 35m mais longe
// do armazém, com 20 vizinhas. Mesma mata.
const BORDA  = { dens: 9,  drop: 5,  work: 12 };
const MIOLO  = { dens: 20, drop: 40, work: 30 };

const antesBorda = score(BORDA.dens, BORDA.drop, BORDA.work, false);
const antesMiolo = score(MIOLO.dens, MIOLO.drop, MIOLO.work, false);
check("sem saturar, o miolo ganhava da árvore colada no armazém",
	antesMiolo > antesBorda, Math.round(antesBorda) + " vs " + Math.round(antesMiolo));

const depoisBorda = score(BORDA.dens, BORDA.drop, BORDA.work, true);
const depoisMiolo = score(MIOLO.dens, MIOLO.drop, MIOLO.work, true);
check("saturando, a árvore perto do armazém ganha",
	depoisBorda > depoisMiolo, Math.round(depoisBorda) + " vs " + Math.round(depoisMiolo));

// ── A densidade ainda serve para o que foi feita ───────────────────────────────────────
// Árvore avulsa: acaba rápido e obriga a remarcar. Tem de perder mesmo estando mais perto.
const AVULSA = { dens: 1, drop: 8, work: 10 };
const MATA   = { dens: 12, drop: 45, work: 40 };
check("árvore solitária continua perdendo para a mata, mesmo mais perto",
	score(MATA.dens, MATA.drop, MATA.work, true) > score(AVULSA.dens, AVULSA.drop, AVULSA.work, true),
	Math.round(score(AVULSA.dens, AVULSA.drop, AVULSA.work, true)) + " vs " +
	Math.round(score(MATA.dens, MATA.drop, MATA.work, true)));
check("e duas árvores soltas também perdem",
	score(MATA.dens, MATA.drop, MATA.work, true) > score(2, 8, 10, true));

// Onde fica a fronteira: com o teto em 8, quanta distância uma mata cheia ainda paga sobre
// uma árvore quase-solitária? É o que separa "descarta avulsa" de "atravessa o mapa".
const margemAvulsa = (TETO - 1) * W_DENS / W_DROP;
check("a mata cheia vence a avulsa por uma margem de distância finita e sensata",
	margemAvulsa > 50 && margemAvulsa < 150, margemAvulsa.toFixed(0) + "m");

// ── Dentro da mata, a distância manda ──────────────────────────────────────────────────
// É a propriedade que fecha o relato: acima do teto, densidade não desempata mais nada.
check("duas árvores acima do teto empatam em densidade",
	score(TETO, 0, 0, true) === score(TETO + 50, 0, 0, true));
let ordenado = true;
for (let d = 5; d <= 120; d += 5)
	if (score(30, d, d, true) >= score(30, d - 5, d - 5, true)) { ordenado = false; break; }
check("e entre elas vence sempre a mais perto, sem excecao",
	ordenado);

// A saturação não pode ser tão baixa que qualquer moita empate com uma floresta.
check("o teto é alto o bastante para ainda distinguir moita de floresta",
	TETO >= 5, TETO);

// ── Está no código, e no lugar certo ───────────────────────────────────────────────────
check("a saturação entra no score, não só na variável",
	/const densEfetiva = Math\.min\(density, PUDIM_DENSIDADE_SUFICIENTE\);/.test(sim) &&
	/const score = \(densEfetiva \* densityWeight\)/.test(sim));
check("e o density cru não é mais usado no score",
	!/const score = \(density \* densityWeight\)/.test(sim));
check("o porquê está escrito — senão alguém 'melhora' tirando o teto",
	/escolhendo o miolo da mesma mata/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
