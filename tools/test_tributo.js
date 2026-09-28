/**
 * Tributo automatico para aliado: so a sobra, so para quem precisa, aos poucos.
 *
 * Ideia do ModernGUI (PanelScripts.helpAlliesTribute), reescrita — o repositorio deles nao
 * tem licenca. Desligado por padrao.
 *
 * Fatos do motor (public.zip): o comando e {"type": "tribute", "player", "amounts"}
 * (Commands.js) e Player.TributeResource recusa quantidade nao inteira e jogador inativo.
 *
 * Rodar:  node tools/test_tributo.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const vm = require("vm");
const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("tributo automatico");

// ── A escolha de verdade, extraida do painel ───────────────────────────────────────────
const i = panel.indexOf("const PUDIM_TRIBUTO_GUARDA");
const j = panel.indexOf("/** Manda o tributo");
check("o bloco foi encontrado", i > 0 && j > i);
const ctx = { Math: Math };
vm.createContext(ctx);
vm.runInContext(panel.slice(i, j) + "\nthis.escolher = pudim_EscolherTributo;" +
	"\nthis.G = PUDIM_TRIBUTO_GUARDA; this.C = PUDIM_TRIBUTO_CARENCIA; this.M = PUDIM_TRIBUTO_MAX;", ctx);
const escolher = (eu, aliados, guardado, ultimo) => ctx.escolher(eu, aliados, guardado || {}, 100000, ultimo || {});
const G = ctx.G, C = ctx.C, M = ctx.M;

check("a guarda sua e alta e a carencia do aliado e baixa", G >= 500 && C <= 500, G + " / " + C);
check("o envio tem teto", M <= 1000, M);

let t = escolher({ res: { wood: 2400 } }, [{ id: 3, res: { wood: 100 } }]);
check("sobra de madeira e aliado sem madeira: envia", t && t.recurso === "wood" && t.para === 3, JSON.stringify(t));
check("no maximo o teto", t.qtd === M, t.qtd);
check("em multiplo de 100 (o motor exige inteiro)", t.qtd % 100 === 0);

t = escolher({ res: { wood: 1250 } }, [{ id: 3, res: { wood: 100 } }]);
check("envia so o que passa da guarda, arredondado para baixo", t && t.qtd === 200, t && t.qtd);

check("sem sobra acima da guarda, nao envia",
	escolher({ res: { wood: G + 50 } }, [{ id: 3, res: { wood: 0 } }]) === null);
check("aliado que nao precisa (acima da carencia) nao recebe",
	escolher({ res: { wood: 5000 } }, [{ id: 3, res: { wood: C + 1 } }]) === null);

t = escolher({ res: { wood: 5000 } }, [{ id: 3, res: { wood: 200 } }, { id: 5, res: { wood: 10 } }]);
check("entre dois aliados, vai para o mais necessitado", t && t.para === 5, t && t.para);

// O que esta reservado nao conta como sobra.
check("com a madeira reservada para um aries, a sobra some e nada e enviado",
	escolher({ res: { wood: 1400 } }, [{ id: 3, res: { wood: 0 } }], { wood: 400 }) === null);

// A espera por recurso.
check("madeira mandada ha pouco espera a sua vez",
	escolher({ res: { wood: 5000 } }, [{ id: 3, res: { wood: 0 } }], {}, { wood: 100000 - 1000 }) === null);
t = escolher({ res: { wood: 5000, food: 5000 } }, [{ id: 3, res: { wood: 0, food: 0 } }], {}, { wood: 100000 - 1000 });
check("mas outro recurso pode ir", t && t.recurso === "food", t && t.recurso);

// ── Onde a regra encosta no motor e na tela ────────────────────────────────────────────
check("o comando e o do jogo base, com a quantidade calculada",
	/"type": "tribute", "player": t\.para,\s*\n?\s*"amounts": \{ \[t\.recurso\]: t\.qtd \}/.test(execP));
check("aliado derrotado e pulado (a simulacao manda 'ativo')",
	/a && !a\.isSelf && a\.ativo !== false/.test(execP) &&
	/"ativo": cmpAlly\.IsActive \? cmpAlly\.IsActive\(\) : true,/.test(sim));
check("a opcao existe e vem DESLIGADA",
	opts[0].options.some(o => o.config === "pudim.tributo.auto") &&
	/ConfigDB_GetValue\("user", "pudim\.tributo\.auto"\) !== "true"\) return;/.test(execP));
const iTrava = panel.indexOf('if (typeof g_IsObserver !== "undefined" && g_IsObserver) return;');
const iTrib = panel.indexOf("try { pudim_ProcessTributo(); } catch (e) {}");
check("roda abaixo da trava de espectador — quem assiste nao manda nada", iTrava > 0 && iTrib > iTrava);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
