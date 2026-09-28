/**
 * Celeiro não sai quando a fruta já está perto de um ponto de entrega de comida (28/09).
 *
 * Pedido: "só não faz celeiros se as frutas estiverem muito perto de um dropsite". E depois:
 * "50 não é muito longe? os trabalhadores não vão gastar muito tempo andando pra entregar?".
 * Era: 50 do centro ao centro do CC são ~35 m de caminhada até a borda. A regra passou a
 * medir a caminhada até a BORDA, com 8 m de limite por trecho, nos dois caminhos que fazem celeiro.
 *
 * Rodar:  node tools/test_celeiro_perto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const sim = fs.readFileSync(path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8")
	.split("\r\n").join("\n");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
function corpo(nome) {
	const i = sim.indexOf("GuiInterface.prototype." + nome + " = function");
	return sim.slice(i, sim.indexOf("\n};", i));
}

console.log("celeiro perto de ponto de entrega");

// ── A conta que decidiu o número (A28) ───────────────────────────────────────────────
// Aldeã: carrega 10 de comida, fruta a 1/s (1,5 com cesto de vime), anda a 9 m/s.
const aproveita = (caminhada, taxa) => { const colhe = 10 / taxa; return colhe / (colhe + 2 * caminhada / 9); };
check("com 35 m de caminhada (o antigo 50 do centro do CC), perde-se quase metade do tempo",
	aproveita(35, 1) < 0.6 && aproveita(35, 1.5) < 0.5, aproveita(35, 1).toFixed(2) + " / " + aproveita(35, 1.5).toFixed(2));
check("com 8 m por trecho: 85% sem cesto, 79% com — perto o bastante para dispensar celeiro",
	Math.round(aproveita(8, 1) * 100) === 85 && Math.round(aproveita(8, 1.5) * 100) === 79,
	aproveita(8, 1).toFixed(3) + " / " + aproveita(8, 1.5).toFixed(3));
check("os limites de 80% citados no código batem: 11,25 m sem cesto, 7,5 m com",
	Math.abs(aproveita(11.25, 1) - 0.8) < 1e-9 && Math.abs(aproveita(7.5, 1.5) - 0.8) < 1e-9);
check("e 15 m por trecho já não serviria (75% / 67%) — foi o erro da primeira versão",
	aproveita(15, 1) < 0.76 && aproveita(15, 1.5) < 0.68);

// ── O código ─────────────────────────────────────────────────────────────────────────
check("uma constante só para a regra, 8 m de caminhada por trecho", /const PUDIM_FRUTA_PERTO_DE_ENTREGA = 8;/.test(sim));
check("a meia largura vem do template, como o jogo lê (ObstructionSnap.js)",
	/function pudim_MeiaLarguraEntrega\(ent, cmpIdent\)[\s\S]{0,400}t\.Obstruction\.Static\["@width"\]/.test(sim));
const smart = corpo("pudim_GetSmartDropsiteData");
check("armazém inteligente: cada ponto de entrega guarda a meia largura",
	/meia: pudim_MeiaLarguraEntrega\(ent, cmpIdent\)/.test(smart));
check("filtro de quem colhe fruta longe: só CC e celeiro, até a BORDA",
	/rtype\.specific === "fruit"\) \{[\s\S]{0,600}if \(!ds\.isCC && !ds\.isFarmstead\) continue;[\s\S]{0,200}- \(ds\.meia \|\| 0\)\);\s*\n\s*\}\s*\n\s*if \(entrega <= PUDIM_FRUTA_PERTO_DE_ENTREGA\) continue;/.test(smart));
check("e a madeira continua com a regra dela (50 de qualquer dropsite)",
	/\} else if \(minDsSq <= 50\*50\) continue;/.test(smart));
check("decisão de construir: para comida, CC e celeiro até a BORDA",
	/if \(bestGroupKey === "food"\) \{\s*\n\s*let entregaComida = Infinity;[\s\S]{0,400}Math\.sqrt\(ddx\*ddx \+ ddz\*ddz\) - \(ds\.meia \|\| 0\)\);/.test(smart) &&
	/if \(entregaComida <= PUDIM_FRUTA_PERTO_DE_ENTREGA\) \{\s*\n\s*result\._dbg\.skip = "fruta_perto_entrega:"/.test(smart));
check("e vem ANTES do limiar do celeiro dedicado",
	smart.indexOf("entregaComida <= PUDIM_FRUTA_PERTO_DE_ENTREGA") < smart.indexOf("if (nearestDedicatedDist <= buildThresh)"));
const pro = corpo("pudim_GetProactiveFarmsteadData");
check("o caminho proativo usa a MESMA regra (CC incluso, até a borda)",
	/!ci\.HasClass\("CivCentre"\)\) continue;[\s\S]{0,300}Math\.sqrt\(dx\*dx \+ dz\*dz\) - pudim_MeiaLarguraEntrega\(ent, ci\) <= PUDIM_FRUTA_PERTO_DE_ENTREGA\) return null;/.test(pro));
check("nenhum 50*50 solto sobrou no proativo", !/50\*50\) return null;/.test(pro));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
