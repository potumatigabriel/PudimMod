/**
 * Foco de fogo em grupos de arqueiros: um alvo por rajada (28/09).
 *
 * Pedido: "se tiver 100 arqueiros, os 100 mandar em 1 só desperdiça; o ideal é um grupo de x
 * arqueiros (o suficiente pra matar a unidade) atirar em uma unidade só, outro grupo em
 * outra... matando uma unidade inimiga por disparo". Roda pudim_FocoRajada de verdade, com a
 * conta de dano do jogo (AttackHelper.GetTotalAttackEffects) num mundo falso.
 *
 * Rodar:  node tools/test_foco_rajada.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const sim = fs.readFileSync(path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8")
	.split("\r\n").join("\n");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}
console.log("foco de fogo em grupos");

const a = sim.indexOf("const PUDIM_FOCO_ACERTO = 0.75;");
const b = sim.indexOf("GuiInterface.prototype.pudim_GetFocusFireCorrections = function");
const vida = {};
const ctx = {
	Math, Set, IID_Attack: 1, IID_Health: 2,
	// Flecha de 8 de dano: com 0,75 de acerto, 6 por arqueiro por rajada.
	AttackHelper: { GetTotalAttackEffects: () => 8 },
	Engine: { QueryInterface: (id, iid) => iid === 1 ? { GetAttackEffectsData: () => ({ Damage: { Pierce: 8 } }) } :
		iid === 2 ? { GetHitpoints: () => (vida[id] === undefined ? 100 : vida[id]) } : null }
};
vm.createContext(ctx);
vm.runInContext(sim.slice(a, b) + "\nthis.f = pudim_FocoRajada;", ctx);
const arq = (n, alvo) => Array.from({ length: n }, (_, k) => ({ id: 1000 + k, x: k, z: 0, currentTarget: alvo }));

{
	// 20 arqueiros, 3 alvos de 30 de vida: 5 flechas matam cada um (5 × 6 = 30).
	const alvos = [{ id: 1, hp: 30, x: 0, z: 0 }, { id: 2, hp: 30, x: 5, z: 0 }, { id: 3, hp: 30, x: 10, z: 0 }];
	const r = ctx.f(arq(20, null), alvos);
	const n = t => (r.find(c => c.target === t) || { units: [] }).units.length;
	check("cada alvo recebe só as flechas que o matam (5 para 30 de vida a 6 por flecha)",
		n(2) === 5 && n(3) === 5, [n(1), n(2), n(3)].join(","));
	check("os que sobram reforçam o primeiro alvo (5 + 5 de sobra)", n(1) === 10);
	check("ninguém fica de fora nem vai em dois alvos", n(1) + n(2) + n(3) === 20);
}
{
	// Quem JÁ atira num alvo que ainda precisa dele continua (não reinicia a mira).
	const alvos = [{ id: 1, hp: 30, x: 0, z: 0 }, { id: 2, hp: 30, x: 5, z: 0 }];
	const us = arq(3, 2).concat(arq(10, null).map((u, k) => Object.assign(u, { id: 2000 + k })));
	const r = ctx.f(us, alvos);
	const mudaram = r.flatMap(c => c.units);
	check("os 3 que já atiram no alvo 2 (que ainda precisa) não recebem ordem nova",
		![1000, 1001, 1002].some(id => mudaram.indexOf(id) >= 0), JSON.stringify(r));
	const no2 = (r.find(c => c.target === 2) || { units: [] }).units.length;
	check("e o alvo 2 recebe só o que falta: 2 a mais (3 + 2 = 5)", no2 === 2, no2);
}
{
	// Alvo já com flecha de mais: o excedente é repartido para outro.
	const alvos = [{ id: 1, hp: 12, x: 0, z: 0 }, { id: 2, hp: 30, x: 5, z: 0 }];
	const r = ctx.f(arq(8, 1), alvos);
	const para2 = (r.find(c => c.target === 2) || { units: [] }).units.length;
	check("8 num alvo de 12 de vida (2 bastam): 5 vão para o alvo 2, 1 sobra para o primeiro",
		para2 === 5, JSON.stringify(r));
}
check("sem arqueiro ou sem alvo: nada", ctx.f([], [{ id: 1, hp: 10 }]).length === 0 && ctx.f(arq(3, null), []).length === 0);

// ── O código ─────────────────────────────────────────────────────────────────────────
check("dano pela conta do jogo, com os efeitos do ataque à distância do arqueiro",
	/atk\.GetAttackEffectsData\("Ranged"\)/.test(sim) && /AttackHelper\.GetTotalAttackEffects\(alvo, ef, "Damage", 1\) \* PUDIM_FOCO_ACERTO/.test(sim));
check("o foco reparte os de longe e deixa os de perto no alvo do grupo",
	/const rajada = pudim_FocoRajada\(group\.filter\(u => u\.isRanged\), ec\.units\);[\s\S]{0,120}group = group\.filter\(u => !u\.isRanged\);/.test(sim));
check("a vida absoluta do alvo vai junto (hp)", /hp: cmpHealth\.GetHitpoints\(\),/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
