/**
 * O estábulo tem de obedecer à proporção de unidades.
 *
 * Relato de 02/09: "o criador automatico de unidades no estaulo não funciona".
 *
 * A causa NÃO era a escolha da unidade nem o tamanho do lote: era o estábulo nunca chegar à
 * semeadura. `alwaysQueue = isCC || isBarracks`, e tudo que não é um dos dois entrava no ramo
 * "off por padrão", que adicionava o edifício a g_PudimAutoQueueUserDisabled — o mesmo
 * conjunto que guarda "o jogador desligou, não mexa". A semeadura começa pulando esse
 * conjunto, então o estábulo ficava mudo com peso na cavalaria ou sem.
 *
 * Medido no replay 2026-09-02_0004 e no log da mesma partida:
 *
 *   - os 4 estábulos (9072, 9334, 9537, 10223) só receberam ordens x1 irregulares, e em
 *     1057s, 1301s, 1341s e 1474s DOIS templates diferentes no mesmo segundo
 *     (cavalry_javelineer_b x1 + cavalry_swordsman_b x1). O mod nunca manda dois tipos ao
 *     mesmo edifício no mesmo tique: era o jogador clicando na mão.
 *   - o quartel 7308, no mesmo intervalo, recebia lote a cada ~18s.
 *   - o jogador ligou a auto-fila nativa do estábulo seis vezes (872s, 926s, 1027s, 1055s,
 *     1249s, 1260s) e o mod desligou 2s depois em todas — correto com proporção ativa, mas
 *     a semeadura que deveria substituí-la estava barrada.
 *
 * A correção separa "desligado por padrão do mod" de "desligado pelo jogador".
 *
 * Rodar:  node tools/test_estabulo_semeia.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
// Sem comentários: a explicação acima cita os nomes antigos, e conferir o texto em vez do
// código já enganou quatro testes deste mod (ver test_api_inventada.js).
const exec = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("estabulo obedece a proporcao");

// ── Os dois estados são conjuntos diferentes ───────────────────────────────────────────
check("existe um conjunto só para o desligado-por-padrão",
	/var g_PudimAutoQueuePadraoOff = new Set\(\);/.test(exec));
check("o ramo 'demais construções' usa ele, não o do jogador",
	/g_PudimAutoQueuePadraoOff\.add\(b\.ent\);/.test(exec));
// A regressão que importa: se voltar a marcar UserDisabled ali, o estábulo emudece de novo.
const ramoPadrao = (function() {
	const i = exec.indexOf("g_PudimAutoQueuePadraoOff.add(b.ent)");
	return i < 0 ? "" : exec.slice(Math.max(0, i - 400), i + 100);
})();
check("e NÃO marca o edifício como desativado pelo jogador",
	ramoPadrao.indexOf("g_PudimAutoQueueUserDisabled.add") < 0);

// ── A semeadura ────────────────────────────────────────────────────────────────────────
check("a semeadura continua pulando o que o JOGADOR desligou",
	/if \(g_PudimAutoQueueUserDisabled\.has\(b\.ent\)\) continue;/.test(exec));
check("mas o desligado-por-padrão só é pulado sem proporção configurada",
	/if \(g_PudimAutoQueuePadraoOff\.has\(b\.ent\) && !propAtiva\) continue;/.test(exec));
// A ordem importa: a guarda do jogador tem de vir antes, senão a proporção passaria por cima
// de uma decisão dele.
check("a guarda do jogador vem antes da do padrão",
	exec.indexOf("g_PudimAutoQueueUserDisabled.has(b.ent)) continue;") <
	exec.indexOf("g_PudimAutoQueuePadraoOff.has(b.ent) && !propAtiva"));

check("ligar na mão limpa o padrão — passa a ser escolha do jogador",
	/g_PudimAutoQueuePadraoOff\.delete\(b\.ent\);/.test(exec));
check("o ramo 'Pudim tinha ativado, agora está off' ignora o padrão-off",
	/g_PudimAutoQueueManagedByMod\.has\(b\.ent\) &&\s*\n\s*!g_PudimAutoQueueUserDisabled\.has\(b\.ent\) &&\s*\n\s*!g_PudimAutoQueuePadraoOff\.has\(b\.ent\)/.test(exec));

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
function semeia(b, propAtiva, userOff, padraoOff) {
	if (userOff.has(b)) return false;
	if (padraoOff.has(b) && !propAtiva) return false;
	return true;
}
const ESTABULO = 9072, QUARTEL = 7308, CASA = 4242;
const padraoOff = new Set([ESTABULO, CASA]);
const userOff = new Set();

check("sem proporção, o estábulo segue off por padrão (nada muda)",
	!semeia(ESTABULO, false, userOff, padraoOff));
check("com proporção, o estábulo é semeado — era o defeito relatado",
	semeia(ESTABULO, true, userOff, padraoOff));
check("o quartel é semeado nos dois casos",
	semeia(QUARTEL, false, userOff, padraoOff) && semeia(QUARTEL, true, userOff, padraoOff));
// Casa/armazém/celeiro têm IID_ProductionQueue por causa de tecnologia e entram nesta lista.
// Eles passam nesta guarda, e param logo depois por não treinarem nada com peso.
check("a casa também passa a guarda — quem a barra é o filtro de peso, adiante",
	semeia(CASA, true, userOff, padraoOff));
check("e esse filtro existe: sem unidade com peso, o edifício fica parado",
	/if \(!template && pudim_ProporcaoAtiva\(\)\)\s*\n\s*continue;/.test(exec));

// A decisão do jogador continua acima de tudo, com ou sem proporção.
userOff.add(ESTABULO);
check("estábulo desligado PELO JOGADOR não é semeado nem com proporção",
	!semeia(ESTABULO, true, userOff, padraoOff));

// ── A procedência fica no código ───────────────────────────────────────────────────────
check("o replay medido está citado no código",
	/2026-09-02_0004/.test(panel));
check("e a evidência de que as ordens x1 eram do jogador, não do mod",
	/DOIS templates diferentes no mesmo segundo/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
