/**
 * Testa que a auto-fila nunca troca o TIPO de unidade escolhido pelo jogador, e que as techs
 * de pedra/metal acompanham as prioridades de coleta.
 *
 * Relato de 19/08: o jogador pôs 5 guerreiros no centro cívico e, quando o lote esvaziou, a
 * auto-fila semeou 2 aldeões. A escolha de template era refeita do zero a cada semeadura,
 * com preferência pela aldeã, e nada olhava o que estava ali antes.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const PANEL = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");
const SIM = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("auto-fila respeita a escolha do jogador");

// ── 1. Estado separado para a escolha do jogador ───────────────────────────────────────
check("existe memoria propria do que o jogador enfileirou",
	/var g_PudimPlayerQueueTpl = \{\};/.test(PANEL) &&
	/var g_PudimPlayerQueueCount = \{\};/.test(PANEL));
check("so grava quando o item NAO e o que o mod semeou",
	/if \(qItem\.unitTemplate !== g_PudimQueueSeededTpl\[b\.ent\]\)/.test(PANEL));
check("o tamanho so e lido com o lote fresco (o motor decrementa count)",
	/if \(\(qItem\.progress \|\| 0\) < 0\.15\) \{\s*\n\s*const obs = qItem\.count \|\| 1;/.test(PANEL));

// ── 2. A semeadura usa a escolha do jogador ────────────────────────────────────────────
check("a semeadura comeca pela escolha do jogador",
	/let template = g_PudimPlayerQueueTpl\[b\.ent\] \|\| null;/.test(PANEL));
check("a preferencia por aldea so vale quando o jogador nunca escolheu",
	/if \(!template\) \{\s*\n\s*\/\/ Usar trainerEntities/.test(PANEL));
check("o limite de 50 mulheres nao troca um template do jogador",
	PANEL.indexOf("const doJogador = !!template;") > 0 &&
	PANEL.indexOf("trainerEnts.find(isFemaleTemplate) || trainerEnts[0]") >
	PANEL.indexOf("const doJogador = !!template;"));
check("o tamanho do jogador tem precedencia sobre o padrao do mod",
	/const desiredCount = g_PudimPlayerQueueCount\[b\.ent\] \|\|/.test(PANEL));
check("o log diz de quem foi a escolha", /\(doJogador \? " \(escolha do jogador\)" : ""\)/.test(PANEL));

// ── 3. A quantidade continua se adaptando ao estoque (pedido anterior do jogador) ───────
// "se tiver menos recursos que a quantidade selecionada faz o que da, depois volta ao normal"
check("a quantidade ainda passa por pudim_ComputeAffordableCount",
	/const affordable = pudim_ComputeAffordableCount\(template, desiredCount, res\);/.test(PANEL));

// Réplica: com 146 de comida e aldeã a 50, cabem 2 — foi o "2" que apareceu na tela.
function cabem(estoque, custo, desejado) { return Math.min(desejado, Math.floor(estoque / custo)); }
check("146 de comida com aldea a 50 da 2 (o numero do print)", cabem(146, 50, 5) === 2);
check("com estoque cheio volta ao lote escolhido", cabem(1000, 50, 5) === 5);
// ...mas o TIPO nunca muda junto: é essa a separação que faltava.

// ── 4. Sem insistir na auto-fila onde o motor vai recusar ──────────────────────────────
check("a simulacao devolve populacao atual e maxima",
	/"popCount": cmpPlayer \? cmpPlayer\.GetPopulationCount\(\)/.test(SIM) &&
	/"popMax":   cmpPlayer \? cmpPlayer\.GetMaxPopulation\(\)/.test(SIM));
check("o painel calcula se a populacao esta no teto", /const popCheio = /.test(PANEL));
check("no teto ou sem recurso, nao tenta religar a auto-fila",
	/if \(popCheio \|\| !podePagar\) continue;/.test(PANEL));

console.log("\ntechs de pedra e metal seguem as prioridades");

// ── 5. Peso > 0 libera a tech antes da Fase 2 ──────────────────────────────────────────
check("o painel envia os pesos para a auto-pesquisa",
	/weights: g_PudimResourceWeights/.test(PANEL));
check("a simulacao le os pesos de pedra e metal",
	/const wStone = \+\(\(data && data\.weights && data\.weights\.stone\) \|\| 0\)/.test(SIM) &&
	/const wMetal = \+\(\(data && data\.weights && data\.weights\.metal\) \|\| 0\)/.test(SIM));
check("pedra com peso libera a tech", /if \(resSet\.has\("stone"\) && wStone > 0\) return true;/.test(SIM));
check("metal com peso libera a tech", /if \(resSet\.has\("metal"\) && wMetal > 0\) return true;/.test(SIM));
check("sem peso continua esperando a Fase 2", /return isPhase2;/.test(SIM));

// Réplica da decisão.
function permitida(recursos, wStone, wMetal, isPhase2) {
	if (recursos.includes("food") || recursos.includes("wood")) return true;
	if (recursos.includes("stone") && wStone > 0) return true;
	if (recursos.includes("metal") && wMetal > 0) return true;
	return isPhase2;
}
const F1 = false, F2 = true;
check("fase 1, pedra 0: tech de pedra barrada", !permitida(["stone"], 0, 0, F1));
check("fase 1, pedra 1: tech de pedra liberada", permitida(["stone"], 1, 0, F1));
check("fase 1, metal 1: tech de metal liberada", permitida(["metal"], 0, 1, F1));
check("fase 1, pedra 1: tech de METAL segue barrada", !permitida(["metal"], 1, 0, F1));
check("fase 2 libera as duas mesmo com peso 0",
	permitida(["stone"], 0, 0, F2) && permitida(["metal"], 0, 0, F2));
check("comida e madeira nunca dependem de peso nem de fase",
	permitida(["food"], 0, 0, F1) && permitida(["wood"], 0, 0, F1));
check("tech que mexe em pedra E metal basta um peso",
	permitida(["stone", "metal"], 0, 1, F1));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
