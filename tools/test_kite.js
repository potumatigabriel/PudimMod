/**
 * Testa o recuo das unidades a distancia (kite) e a regra de combatentes na batalha.
 *
 * Origem: replay 2026-08-24_0003, "ele ficou bagunçando durante a luta". Na janela de
 * 100 s do pico (turnos 7350-7650), 305 unidades receberam walk E attack, e as mais
 * afetadas levaram 9 ou 10 walks cada — uma reordenacao a cada 7,5 s. Cada walk cancela o
 * ataque em curso, entao elas passaram a batalha andando em vez de atirar.
 *
 * A causa estava na regra: recuava quando o inimigo entrava a 60% do NOSSO alcance, e
 * parava a NOSSO alcance menos 2 m. Para um arqueiro (60) isso dispara com um lanceiro
 * ainda a 36 m e para a 58 m, de onde o mesmo lanceiro reabre o gatilho em segundos.
 *
 * Alcances reais dos templates do jogo, que sustentam os numeros daqui:
 *   espadachim 3 | lanceiro 4 | dardeiro 30 | fundeiro 45 | arqueiro 60
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const SIM = fs.readFileSync(
	path.join(RAIZ, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const PANEL = fs.readFileSync(
	path.join(RAIZ, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// ── Réplica da decisão que está no código ──────────────────────────────────────────────
const FOLGA_TIRO = 3, MARGEM_RANGED = 3, SEG_APROX = 2;

function gatilho(ameaca) {
	return ameaca.ranged
		? ameaca.alcance + MARGEM_RANGED
		: ameaca.alcance + SEG_APROX * (ameaca.vel || 9);
}
/** Devolve a distancia de destino, ou null quando nao vale recuar. */
function kite(meuAlcance, ameaca, distAtual) {
	const destino = meuAlcance - FOLGA_TIRO;
	const g = gatilho(ameaca);
	if (destino <= g) return null;          // recuar nao tira do perigo
	if (distAtual >= g) return null;        // ainda longe o bastante
	if (destino - distAtual <= 0) return null;
	return destino;
}

const ESPADACHIM = { alcance: 3, ranged: false, vel: 9 };
const LANCEIRO   = { alcance: 4, ranged: false, vel: 9 };
const CAVALARIA  = { alcance: 4, ranged: false, vel: 16 };
const DARDEIRO   = { alcance: 30, ranged: true };
const FUNDEIRO   = { alcance: 45, ranged: true };
const ARQUEIRO   = { alcance: 60, ranged: true };

console.log("recuo das unidades a distancia");

// ── 1. A regra que o jogador pediu: distancia de corpo a corpo ─────────────────────────
check("arqueiro recua de lanceiro que se aproxima", kite(60, LANCEIRO, 15) === 57);
check("arqueiro recua de espadachim", kite(60, ESPADACHIM, 12) !== null);
check("o gatilho do lanceiro e alcance + 2s de caminhada", gatilho(LANCEIRO) === 4 + 18);
check("cavalaria, mais rapida, dispara o gatilho de mais longe",
	gatilho(CAVALARIA) > gatilho(LANCEIRO), gatilho(CAVALARIA) + " vs " + gatilho(LANCEIRO));
check("lanceiro ainda longe nao dispara nada", kite(60, LANCEIRO, 40) === null);

// ── 2. A outra metade do pedido: so recua de quem alcanca MENOS ────────────────────────
check("arqueiro recua de fundeiro (45 < 60)", kite(60, FUNDEIRO, 40) === 57);
check("arqueiro recua de dardeiro (30 < 60)", kite(60, DARDEIRO, 25) === 57);
check("arqueiro NAO recua de outro arqueiro (alcance igual)", kite(60, ARQUEIRO, 40) === null);
check("fundeiro NAO recua de arqueiro (alcance maior)", kite(45, ARQUEIRO, 30) === null);
check("fundeiro recua de dardeiro (30 < 45)", kite(45, DARDEIRO, 25) === 42);
check("dardeiro nao recua de fundeiro nem de arqueiro",
	kite(30, FUNDEIRO, 20) === null && kite(30, ARQUEIRO, 20) === null);
check("dardeiro ainda recua de corpo a corpo", kite(30, LANCEIRO, 15) === 27);

// ── 3. O ponto do bug: a folga tem de matar o vai-e-vem ────────────────────────────────
// Recuar de 22 para 57 deixa a unidade MUITO fora do gatilho, entao ela nao volta a
// disparar no ciclo seguinte — que era o que gerava 9 walks por unidade.
const destinoLanceiro = kite(60, LANCEIRO, 21);
check("arqueiro para bem fora do gatilho do lanceiro",
	destinoLanceiro > gatilho(LANCEIRO) * 2, destinoLanceiro + " vs gatilho " + gatilho(LANCEIRO));
check("e no destino o gatilho nao reabre", kite(60, LANCEIRO, destinoLanceiro) === null);
check("contra fundeiro tambem nao reabre no destino",
	kite(60, FUNDEIRO, kite(60, FUNDEIRO, 40)) === null);

// A regra antiga reabria: gatilho 60%*60 = 36, destino 58 — mas com o inimigo andando
// 18m em 2s, ele voltava para dentro dos 36 quase de imediato. Com a nova, ele precisa
// atravessar de 57 ate 22.
const folgaNova = destinoLanceiro - gatilho(LANCEIRO);
const folgaAntiga = (60 - 2) - (60 * 0.6);
check("a folga nova e bem maior que a antiga",
	folgaNova > folgaAntiga * 1.5, folgaNova.toFixed(0) + " vs " + folgaAntiga.toFixed(0));

// ── 4. Forma do codigo ─────────────────────────────────────────────────────────────────
check("o alcance sai de Attack.GetFullAttackRange", /cmpAtk\.GetFullAttackRange\(\)\.max/.test(SIM));
check("a velocidade do corpo a corpo sai de UnitMotion", /cmpMot\.GetWalkSpeed\(\)/.test(SIM));
check("so recua de quem cabe dentro do nosso alcance util",
	/if \(destinoDist <= a\.gatilho\) continue;/.test(SIM));
check("as constantes estao nomeadas, nao soltas no meio do codigo",
	/PUDIM_KITE_FOLGA_TIRO = 3/.test(SIM) && /PUDIM_KITE_MARGEM_RANGED = 3/.test(SIM) &&
	/PUDIM_KITE_SEG_APROXIMACAO = 2/.test(SIM));
check("nao sobrou a regra antiga dos 60% do proprio alcance",
	SIM.indexOf("ownRange * 0.6") < 0);
check("o cooldown do kite subiu de 3s para 6s",
	/now - g_PudimKiting\[ent\] > 6000/.test(PANEL));
check("animal e barco de pesca nao contam como ameaca",
	/cmpId\.HasClass\("Animal"\) \|\| cmpId\.HasClass\("FishingBoat"\)/.test(SIM));

// ── 5. Recua E ataca: o ciclo tem de se fechar ────────────────────────────────────────
// "tem que manter distancia segura, mas atacando tambem, retrai e ataca, retrai e ataca."
// O recuo so serve se a unidade voltar a atirar ao chegar; senao vira fuga.
check("o ataque e enfileirado DEPOIS do recuo, nao no lugar dele",
	/"type": "attack",[\s\S]{0,140}"queued": true/.test(PANEL));
check("o recuo em si nao e enfileirado (cancela o que estava fazendo e ja sai)",
	/"type": "walk",[\s\S]{0,140}"queued": false/.test(PANEL));
check("o alvo do ataque e a propria ameaca da qual recuou",
	/"enemyTarget": pior\.id/.test(SIM));

// O destino tem de deixar a unidade DENTRO do proprio alcance, senao ela chega e nao
// alcanca ninguem — recuaria de novo no ciclo seguinte sem nunca atirar.
for (const caso of [["arqueiro", 60, LANCEIRO], ["fundeiro", 45, ESPADACHIM],
                    ["dardeiro", 30, LANCEIRO], ["arqueiro", 60, FUNDEIRO]]) {
	const nome = caso[0], alc = caso[1], ameaca = caso[2];
	const destino = kite(alc, ameaca, gatilho(ameaca) - 1);
	check(nome + " para dentro do proprio alcance (atira ao chegar)",
		destino !== null && destino < alc, destino + " < " + alc);
}
// E fora do alcance de quem o perseguia — as duas coisas ao mesmo tempo.
const destFundeiro = kite(60, FUNDEIRO, 40);
check("arqueiro fica fora do alcance do fundeiro e dentro do seu",
	destFundeiro > FUNDEIRO.alcance && destFundeiro < 60, destFundeiro);

console.log("\ncombatente nao trabalha durante batalha");

check("existe a guarda de batalha no auto-trabalho",
	/if \(batalhaEmCurso && cmpIdentity &&/.test(SIM));
check("cobre CitizenSoldier E cavalaria",
	/cmpIdentity\.HasClass\("CitizenSoldier"\) \|\| cmpIdentity\.HasClass\("FastMoving"\)/.test(SIM));
check("batalha e detectada por ordem de Attack de qualquer unidade nossa",
	/if \(ob && ob\.type === "Attack"\) \{ batalhaEmCurso = true; break; \}/.test(SIM));
check("o motivo entra no diagnostico de nao-alocados",
	/tried: "batalha_em_curso"/.test(SIM));
check("e o estado vai para o log de balanceamento",
	/_bal\.batalha = batalhaEmCurso;/.test(SIM));
check("a guarda vem ANTES da regra local dos 100m",
	SIM.indexOf('tried: "batalha_em_curso"') < SIM.indexOf('tried: "inimigo_a_100m"'));
check("a deteccao roda uma vez, fora do laco de trabalhadores",
	SIM.indexOf("let batalhaEmCurso = false;") < SIM.indexOf("const idleWorkersList = [];"));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
