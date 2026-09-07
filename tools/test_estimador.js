/**
 * O estimador de batalha, conferido contra a fórmula do motor.
 *
 * Pedido de 07/09: "analise os logs e replays e veja se o estimador de batalha está bom ou se
 * a logica pode ser melhorada, sempre consulte a api oficial, nunca chute nada".
 *
 * PRIMEIRO ACHADO, e ele limita a resposta: o estimador NUNCA registrou uma previsão. Em
 * nenhum log de nenhuma partida há uma linha dele. Então a CALIBRAGEM ("quando diz 70%, ganha
 * 70% das vezes?") não tinha como ser medida — só a MATEMÁTICA, contra a fonte oficial.
 *
 * A fonte, lida de public.zip com o jogo fechado:
 *
 *   simulation/helpers/Attack.js, AttackHelper.GetTotalAttackEffects:
 *     total += effectData.Damage[type] * Math.pow(0.9, resistanceStrengths.Damage[type] || 0)
 *     return total * bonusMultiplier;
 *
 *   simulation/helpers/Attack.js, AttackHelper.GetAttackBonus:
 *     attackBonus *= bonus.Multiplier   para cada Bonus cujas Classes casam com o alvo
 *
 *   simulation/components/Attack.js, Attack.CanAttack:
 *     recusa o tipo quando o alvo casa com RestrictedClasses
 *
 * Rodar:  node tools/test_estimador.js
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
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("estimador de batalha");

// ── 1. A média tem de ser do ABATIMENTO, não da armadura ───────────────────────────────
//
// 0.9^x é convexo, então por Jensen  média(0.9^x) >= 0.9^média(x).  Tirar a média das
// armaduras e só depois exponenciar subestimava o próprio dano, e quanto mais desigual o
// exército inimigo, pior.
function comoEra(resistencias) {
	const media = resistencias.reduce((s, r) => s + r, 0) / resistencias.length;
	return Math.pow(0.9, media);
}
function comoE(resistencias) {
	return resistencias.reduce((s, r) => s + Math.pow(0.9, r), 0) / resistencias.length;
}
const GRUPO = [0, 10];
console.log("   armaduras " + GRUPO.join("/") + ": antes " + comoEra(GRUPO).toFixed(3) +
	", agora " + comoE(GRUPO).toFixed(3) +
	"  (" + Math.round((comoE(GRUPO) / comoEra(GRUPO) - 1) * 100) + "% mais dano)");
check("a média do fator é maior que o fator da média — Jensen, não opinião",
	comoE(GRUPO) > comoEra(GRUPO));
check("e com o grupo homogêneo as duas coincidem, como têm de coincidir",
	Math.abs(comoE([5, 5, 5]) - comoEra([5, 5, 5])) < 1e-12);
// Quanto mais desigual o grupo, maior o erro que havia.
check("o erro antigo cresce com a desigualdade do grupo",
	(comoE([0, 20]) / comoEra([0, 20])) > (comoE([0, 4]) / comoEra([0, 4])));
check("o código guarda o FATOR médio, não a armadura média",
	/soma\.Hack \+= Math\.pow\(0\.9, r\.Hack\);/.test(execS) &&
	/foe\.mitig\[t\] = soma\[t\] \/ foe\.total;/.test(execS));
check("e o dano por golpe usa esse fator direto",
	/perHit \+= dmg \* \(foe\.mitig\[dt\] !== undefined \? foe\.mitig\[dt\] : 1\);/.test(execS));
check("o campo antigo (resist médio) não sobrou em lugar nenhum",
	!/foe\.resist/.test(execS));

// A conta continua sendo a do motor: dano * 0.9^armadura, somado por tipo de dano.
check("a fórmula do motor está citada no código, com o arquivo",
	/simulation\/helpers\/Attack\.js/.test(sim) &&
	/Math\.pow\(0\.9, resistencia\[tipo\]\)/.test(sim));

// ── 2. Ataque que o motor recusaria não pode contar ────────────────────────────────────
check("RestrictedClasses é consultado",
	/restritas = cmpAttack\.GetRestrictedClasses\(type\) \|\| \[\];/.test(execS));
check("e o DPS é ponderado pela fração do inimigo que o tipo alcança",
	/fracAlcancavel = atingiveis \/ foe\.total;/.test(execS) &&
	/perHit \*= fracAlcancavel;/.test(execS));
check("tipo que não alcança ninguém é descartado, não vira dano zero somado",
	/if \(fracAlcancavel <= 0\) continue;/.test(execS));

function fracao(restritas, classCount) {
	const total = Object.keys(classCount).reduce((s, c) => s + classCount[c], 0);
	if (!restritas.length || !total) return 1;
	let ok = 0;
	for (const c in classCount) if (restritas.indexOf(c) === -1) ok += classCount[c];
	return ok / total;
}
check("sem restrição, o DPS vale inteiro",
	fracao([], { cavalry: 4 }) === 1);
check("restrito a metade do exército vale metade",
	fracao(["cavalry"], { cavalry: 5, meleeInf: 5 }) === 0.5);
check("restrito a tudo vale zero",
	fracao(["cavalry"], { cavalry: 5 }) === 0);

// ── 3. Os dois lados pela mesma régua ──────────────────────────────────────────────────
//
// O inimigo já descartava quem não tem IID_Attack. O lado aliado aceitava tudo que estivesse
// selecionado — e a vida das aldeãs entrava em `totalHP / DPS inimigo`, aumentando o tempo de
// sobrevivência sem aumentar o dano.
check("quem não pode atacar sai do balanço de força",
	/if \(!cmpAttack\)\s*\n\s*return null;/.test(execS));
check("mas continua na contagem de tipos, que é informação",
	execS.indexOf("bucket.types[typeStr] = (bucket.types[typeStr] || 0) + 1;") <
	execS.indexOf("if (!cmpAttack)\n\t\t\treturn null;"));
check("o lado inimigo mantém a mesma régua",
	/const cmpAttack = Engine\.QueryInterface\(ent, IID_Attack\);\s*\n\s*if \(!cmpAttack\)\s*\n\s*continue;/.test(execS));

// A regra, espelhada: a chance não pode subir só por selecionar não-combatentes junto.
function chance(hpNosso, dpsNosso, hpDeles, dpsDeles) {
	const tMatar = dpsNosso > 0 ? hpDeles / dpsNosso : Infinity;
	const tMorrer = dpsDeles > 0 ? hpNosso / dpsDeles : Infinity;
	if (!isFinite(tMatar) && !isFinite(tMorrer)) return 50;
	if (!isFinite(tMorrer)) return 95;
	if (!isFinite(tMatar)) return 5;
	return Math.max(1, Math.min(99, Math.round(100 * tMorrer / (tMorrer + tMatar))));
}
const semAldeas = chance(1000, 50, 1000, 50);
const comAldeas = chance(1000 + 20 * 60, 50, 1000, 50);   // 20 aldeãs de 60 de vida
console.log("   mesma tropa, com 20 aldeãs selecionadas junto: " +
	semAldeas + "% -> " + comAldeas + "% (era o que acontecia)");
check("selecionar aldeãs junto inflava a chance — por isso saíram do balanço",
	comAldeas > semAldeas + 5, semAldeas + " para " + comAldeas);
check("com tropas iguais a chance é 50%", semAldeas === 50);
check("quem mata mais rápido tem mais chance", chance(1000, 100, 1000, 50) > 50);
check("e a chance é simétrica",
	chance(1000, 100, 800, 50) + chance(800, 50, 1000, 100) === 100);

// ── 4. Agora dá para medir o acerto ────────────────────────────────────────────────────
check("a previsão passa a ser registrada",
	/function pudim_LogCombate\(data\)/.test(execP) &&
	/pudim_Log\("INFO", "ESTIM",/.test(execP));
check("com os dois tempos e a chance, que é o que se confere no replay",
	/matamos em/.test(panel) && /morremos em/.test(panel) && /chance/.test(panel));
check("só registra quando há dois lados de verdade",
	/if \(data\.allies\.count <= 0 \|\| data\.enemies\.count <= 0\) return;/.test(execP));
// O log é caro (ver test_log_custo.js) e o estimador roda a cada 3s.
check("com throttle, senão o log vira o gargalo",
	/if \(agora - g_PudimCombatLogAt < PUDIM_COMBAT_LOG_MS\) return;/.test(execP));
const MS = +/const PUDIM_COMBAT_LOG_MS = (\d+);/.exec(panel)[1];
check("e o intervalo é bem maior que o ciclo do estimador", MS >= 15000, MS + "ms");
check("está escrito que a calibragem ainda não foi medida",
	/NUNCA REGISTROU UMA PREVISÃO/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
