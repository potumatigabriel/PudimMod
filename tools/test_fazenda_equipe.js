/**
 * Fazenda: 5 por campo desde a obra, e quem está no campo fica (28/09).
 *
 * Pedido: "tem que já mandar os 5 aldeões pra cada fazenda, já desde a hora de construir, e
 * deixar sempre os trabalhadores na fazenda; se a pop for maior de 130 e a quantidade de
 * comida for maior que 3000, aí rebalanceia. Porque ao longo do jogo a principal unidade vai
 * ser a cavalaria, ela gasta muito mais comida".
 *
 * Rodar:  node tools/test_fazenda_equipe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("fazenda: equipe de 5 e campo intocavel");

// ── 1. Equipe em múltiplos de 5, rodando o trecho real ───────────────────────────────
{
	const i = sim.indexOf("\t{\n\t\tconst campos = Math.ceil(farFoodWorkers.length / PUDIM_FIELD_CAPACITY);");
	const j = sim.indexOf("\n\t}\n", i) + 3;
	const trecho = sim.slice(i, j);
	const rodar = (deficit, pool) => {
		const ctx = { Math, result: { _dbg: {} }, PUDIM_FIELD_CAPACITY: 5,
			poolFazenda: Array.from({ length: pool }, (_, k) => 100 + k) };
		ctx.farFoodWorkers = ctx.poolFazenda.slice(0, deficit);
		vm.createContext(ctx);
		vm.runInContext("var farFoodWorkers = this.farFoodWorkers;\n" + trecho + "\nthis.saida = farFoodWorkers;", ctx);
		return ctx.saida.length;
	};
	check("o trecho foi achado", trecho.length > 50, trecho.length);
	check("falta de 7 com gente sobrando: equipe de 10 (dois campos cheios), não 5+2", rodar(7, 20) === 10);
	check("falta de 3: equipe de 5", rodar(3, 20) === 5);
	check("falta de 5: fica 5", rodar(5, 20) === 5);
	check("pool curto: não inventa gente (falta 7, pool 8 → 8)", rodar(7, 8) === 8);
	check("a ordem do pool é mantida (ocioso e aldeão primeiro): continua sendo o começo dele",
		/if \(equipe > farFoodWorkers\.length\) farFoodWorkers = poolFazenda\.slice\(0, equipe\);/.test(sim));
}

// ── 2. O painel não abre campo pela metade depois do primeiro ────────────────────────
check("sobra incompleta depois do 1º campo: espera, não abre campo com 2",
	/if \(group\.length < GROUP_SIZE && farmsBuilt > 0\) \{[\s\S]{0,160}break;/.test(panel));

// ── 3. Quem está no campo fica ───────────────────────────────────────────────────────
check("os dois limites do pedido: pop > 130 E comida > 3000",
	/const PUDIM_FAZENDA_SOLTA_POP = 130;/.test(sim) && /const PUDIM_FAZENDA_SOLTA_COMIDA = 3000;/.test(sim) &&
	/const podeTirarDoCampo = popCountRb > PUDIM_FAZENDA_SOLTA_POP && comidaRb > PUDIM_FAZENDA_SOLTA_COMIDA;/.test(sim));
check("o rebalanceamento pula quem colhe campo, fora dessas condições",
	/if \(!podeTirarDoCampo && colheCampo\(ent\)\) continue;/.test(sim));
check("colher campo é ordem de coleta de food.grain",
	/return !!\(tp && tp\.generic === "food" && tp\.specific === "grain"\);/.test(sim));
check("e o longWalkers (troca por recurso mais perto) nunca mexe em campo",
	/if \(targetResType\.specific === "grain"\) continue;/.test(sim));
const podeTirar = (pop, comida) => pop > 130 && comida > 3000;
check("pop 140 com 2000 de comida: fica", podeTirar(140, 2000) === false);
check("pop 120 com 5000 de comida: fica", podeTirar(120, 5000) === false);
check("pop 150 com 3500 de comida: aí pode rebalancear", podeTirar(150, 3500) === true);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
