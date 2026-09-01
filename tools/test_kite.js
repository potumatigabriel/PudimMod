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
const FOLGA_TIRO = 3, MARGEM_RANGED = 3, SEG_APROX = 1;

function gatilho(ameaca) {
	return ameaca.ranged
		? ameaca.alcance + MARGEM_RANGED
		: ameaca.alcance + SEG_APROX * (ameaca.vel || 9);
}
/** Devolve a distancia de destino, ou null quando nao vale recuar. */
function kite(meuAlcance, ameaca, distAtual) {
	const destino = meuAlcance - FOLGA_TIRO;
	const g = gatilho(ameaca);
	// Vale recuar quando o ponto de parada fica fora do ALCANCE DA ARMA dele — nao fora
	// do gatilho. Comparar com o gatilho classificava cavalaria como "nao adianta" e
	// desligava o recuo contra a maior ameaca a uma unidade de alcance.
	if (destino <= ameaca.alcance + MARGEM_RANGED) return null;
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
check("arqueiro recua de lanceiro que se aproxima", kite(60, LANCEIRO, 10) === 57);
check("arqueiro recua de espadachim", kite(60, ESPADACHIM, 8) !== null);
check("o gatilho do lanceiro e alcance + 1s de caminhada", gatilho(LANCEIRO) === 4 + 9);

// ── O bug de 24/08: o dardeiro parou de recuar de CAVALARIA ───────────────────────────
// A viabilidade comparava o destino (27) com o gatilho da cavalaria (36) e concluia "nao
// adianta recuar". So que cavalaria e a maior ameaca a uma unidade de alcance, e a logica
// do kite nunca foi escapar da perseguicao — e obrigar o perseguidor a refazer a
// distancia enquanto apanha. Tres partidas seguidas com a troca no fundo do lobby.
check("dardeiro RECUA de cavalaria (era o bug)", kite(30, CAVALARIA, 15) === 27);
check("dardeiro recua de lanceiro", kite(30, LANCEIRO, 10) === 27);
check("dardeiro recua de espadachim", kite(30, ESPADACHIM, 10) === 27);
check("e a folga contra cavalaria e positiva",
	kite(30, CAVALARIA, 15) - gatilho(CAVALARIA) > 0,
	kite(30, CAVALARIA, 15) - gatilho(CAVALARIA));
check("cavalaria, mais rapida, dispara o gatilho de mais longe",
	gatilho(CAVALARIA) > gatilho(LANCEIRO), gatilho(CAVALARIA) + " vs " + gatilho(LANCEIRO));
check("lanceiro ainda longe nao dispara nada", kite(60, LANCEIRO, 40) === null);
check("lanceiro a 15m ja nao dispara: o gatilho apertou de 22 para 13",
	kite(60, LANCEIRO, 15) === null);

// ── 2. A outra metade do pedido: so recua de quem alcanca MENOS ────────────────────────
check("arqueiro recua de fundeiro (45 < 60)", kite(60, FUNDEIRO, 40) === 57);
check("arqueiro recua de dardeiro (30 < 60)", kite(60, DARDEIRO, 25) === 57);
check("arqueiro NAO recua de outro arqueiro (alcance igual)", kite(60, ARQUEIRO, 40) === null);
check("fundeiro NAO recua de arqueiro (alcance maior)", kite(45, ARQUEIRO, 30) === null);
check("fundeiro recua de dardeiro (30 < 45)", kite(45, DARDEIRO, 25) === 42);
check("dardeiro nao recua de fundeiro nem de arqueiro",
	kite(30, FUNDEIRO, 20) === null && kite(30, ARQUEIRO, 20) === null);
check("dardeiro ainda recua de corpo a corpo", kite(30, LANCEIRO, 10) === 27);

// ── 3. O ponto do bug: a folga tem de matar o vai-e-vem ────────────────────────────────
// Recuar de 22 para 57 deixa a unidade MUITO fora do gatilho, entao ela nao volta a
// disparar no ciclo seguinte — que era o que gerava 9 walks por unidade.
const destinoLanceiro = kite(60, LANCEIRO, 10);
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

// Dardeiro (30) e a unidade que o exercito de fato usa, e foi ela que eu deixei pior na
// primeira versao: com SEG_APROX=2 a folga contra lanceiro caia para 5m, MENOS que os 10m
// da regra antiga. Com 1s ela volta a 14m.
const folgaDardeiro = kite(30, LANCEIRO, 10) - gatilho(LANCEIRO);
check("a folga do dardeiro supera a da regra antiga (10m)", folgaDardeiro >= 10,
	folgaDardeiro);

// ── 4. Forma do codigo ─────────────────────────────────────────────────────────────────
check("o alcance sai de Attack.GetFullAttackRange", /cmpAtk\.GetFullAttackRange\(\)\.max/.test(SIM));
check("a velocidade do corpo a corpo sai de UnitMotion", /cmpMot\.GetWalkSpeed\(\)/.test(SIM));
check("a viabilidade compara com o ALCANCE do inimigo, nao com o gatilho",
	/if \(destinoDist <= a\.alcance \+ PUDIM_KITE_MARGEM_RANGED\) continue;/.test(SIM));
check("nao sobrou a comparacao antiga com o gatilho",
	SIM.indexOf("destinoDist <= a.gatilho") < 0);
check("as constantes estao nomeadas, nao soltas no meio do codigo",
	/PUDIM_KITE_FOLGA_TIRO = 3/.test(SIM) && /PUDIM_KITE_MARGEM_RANGED = 3/.test(SIM) &&
	/PUDIM_KITE_SEG_APROXIMACAO = 1/.test(SIM));
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

console.log("\ncombatente e a batalha: o que prende e a BASE sob ataque");

// Regra do jogador em 24/08: "quando tem luta, as unidades de combate nao podem ficar em
// auto servico". Eu implementei do jeito mais amplo possivel: `batalhaEmCurso` = QUALQUER
// unidade nossa com ordem Attack em qualquer ponto do mapa. Um soldado atacando uma ovelha
// parava o exercito inteiro.
//
// Refinamento dele em 31/08: "quando estou em batalha, longe da base, os guerreiros que
// nascem, tem que ir pro trabalho, agora se minha base estiver sendo atacada, nao pode ir
// pro trabalho".
//
// No log de 31/08 o custo da versao ampla aparece aos 641s: "2 sem alvo
// [batalha_em_curso]" com a base calma — nenhum PANIC no periodo. Dois soldados parados por
// causa de briga do outro lado do mapa. Aos 1615s foram 66, mas ali a base ESTAVA sob
// ameaca (PANIC as 1410s, encerrada as 1642s), entao aqueles a nova regra segura tambem.
//
// A distincao virou LOCAL, com as duas metades que ja existiam nesta funcao:
//   baseUnderAttack  3+ inimigos a 80m de um CC   -> ninguem trabalha
//   inimigo a 100m   checado por unidade          -> quem esta no contato fica
check("o que prende o exercito e a base sob ataque",
	/if \(baseUnderAttack && cmpIdentity &&/.test(SIM));
check("e nao mais batalha em qualquer lugar do mapa",
	!/if \(batalhaEmCurso && cmpIdentity/.test(SIM));
check("cobre CitizenSoldier E cavalaria",
	/cmpIdentity\.HasClass\("CitizenSoldier"\) \|\| cmpIdentity\.HasClass\("FastMoving"\)/.test(SIM));
check("o motivo entra no diagnostico de nao-alocados",
	/tried: "base_sob_ataque"/.test(SIM));

// A intencao de 24/08 sobrevive na checagem por unidade: soldado perto da luta fica na
// luta. O que mudou foi o soldado LONGE dela.
check("quem esta a 100m de inimigo continua fora do trabalho",
	/tried: "inimigo_a_100m"/.test(SIM));
check("e a cavalaria entrou nessa checagem — antes escapava dela",
	/enemies\.length > 0 &&[\s\S]{0,120}?HasClass\("FastMoving"\)/.test(SIM));
check("a guarda da base vem ANTES da regra local dos 100m",
	SIM.indexOf('tried: "base_sob_ataque"') < SIM.indexOf('tried: "inimigo_a_100m"'));

// baseUnderAttack e invasao de verdade, nao um batedor passando: o raio ja foi 200m e
// causava bloqueio permanente em partidas 1v3.
check("base sob ataque exige 3+ inimigos a 80m de um centro civico",
	/0, 80, enemies, IID_UnitAI, false\)/.test(SIM) &&
	/if \(enemyNearCC >= 3\) \{ baseUnderAttack = true; break outer; \}/.test(SIM));

// batalhaEmCurso continua sendo calculado: serve ao diagnostico, so nao decide mais sozinho.
check("batalha em curso continua no log de balanceamento",
	/_bal\.batalha = batalhaEmCurso;/.test(SIM));
check("e a deteccao dela roda uma vez, fora do laco de trabalhadores",
	SIM.indexOf("let batalhaEmCurso = false;") < SIM.indexOf("const idleWorkersList = [];"));

console.log("\nordem manual do jogador manda em combate");

// Relato de 24/08: cavalaria atravessando o mapa para um ataque furtivo parava sozinha
// para atacar quem estava no caminho. A protecao de ordem manual existia so no
// auto-trabalho; os tres sistemas de combate nem recebiam a lista. O foco de fogo emite
// attack com queued:false, que cancela a caminhada na hora.
const envios = (PANEL.match(/playerOrdered": pudim_GetPlayerOrderedIds\(\)/g) || []).length;
check("o painel envia playerOrdered aos tres sistemas", envios >= 3, envios);
check("o kite ignora unidade com ordem sua", /if \(kiteOrdered\.has\(ent\)\) continue;/.test(SIM));
check("o foco de fogo ignora unidade com ordem sua", /if \(ffOrdered\.has\(ent\)\) continue;/.test(SIM));
check("a auto-retirada ignora unidade com ordem sua", /if \(arOrdered\.has\(ent\)\) continue;/.test(SIM));
// O mesmo padrao de leitura ja existia nas funcoes de auto-trabalho, entao o total passa
// de tres. O que importa e que os tres de COMBATE agora estejam entre eles — o que as
// assercoes acima ja garantem, cada uma pelo nome da sua variavel.
const leituras = (SIM.match(/data && data\.playerOrdered\) \|\| \[\]\)\.map\(Number\)/g) || []).length;
check("todos leem a lista do mesmo jeito", leituras >= 5, leituras);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
