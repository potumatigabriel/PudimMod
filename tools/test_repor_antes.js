/**
 * Repor o proximo lote antes de a fila esvaziar.
 *
 * A auto-fila so semeava com a fila VAZIA: entre o fim de um lote e o proximo ciclo (3s) o
 * edificio ficava parado. Ideia do ModernGUI (PanelScripts.trainUnits: repoe quando a fila
 * tem um item com pouco tempo restante), reescrita — o repositorio deles nao tem licenca.
 *
 * Os campos vem do motor, Trainer.Item.GetBasicInfo: `timeRemaining` (ms), `progress` e
 * `neededSlots` (populacao que falta para o lote andar).
 *
 * A regra antiga continua valendo e e ela que limita esta: "a auto-fila mantem NO MAXIMO UM
 * lote" — apendar ja produziu filas com dezenas de grupos. Aqui a fila chega a 2 por um
 * instante e volta a 1.
 *
 * Rodar:  node tools/test_repor_antes.js
 */
"use strict";
const fs = require("fs");
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const panel = fs.readFileSync(path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("repor antes de esvaziar");

const JANELA = +/const PUDIM_REPOR_ANTES_MS = (\d+);/.exec(panel)[1];
const CICLO = +/const PUDIM_AUTOQUEUE_INTERVAL = (\d+);/.exec(panel)[1];
check("a janela e maior que o ciclo da auto-fila — senao o lote acaba entre dois ciclos",
	JANELA > CICLO, JANELA + " vs " + CICLO);
check("mas curta: nao e para empilhar lote cedo", JANELA <= 6000, JANELA);

// A regra, espelhada do codigo.
function repor(b, semeadoTpl) {
	const q0 = (b.fila && b.fila.length === 1) ? b.fila[0] : null;
	return !!(q0 && !b.autoqueue && q0.unitTemplate && q0.unitTemplate === semeadoTpl &&
		(q0.progress || 0) > 0 && typeof q0.timeRemaining === "number" &&
		q0.timeRemaining <= JANELA && !(q0.neededSlots > 0));
}
const lote = (extra) => Object.assign({ unitTemplate: "u/a", progress: 0.8, timeRemaining: 2000, neededSlots: 0 }, extra);

check("um lote do mod quase acabando: repoe", repor({ fila: [lote()] }, "u/a"));
check("lote ainda longe do fim: espera", !repor({ fila: [lote({ timeRemaining: 9000 })] }, "u/a"));
check("lote que nao comecou: espera", !repor({ fila: [lote({ progress: 0 })] }, "u/a"));
check("lote do JOGADOR (outro template): nao mexe", !repor({ fila: [lote({ unitTemplate: "u/b" })] }, "u/a"));
check("ja tem dois lotes: nunca empilha um terceiro", !repor({ fila: [lote(), lote()] }, "u/a"));
check("fila vazia nao e caso desta regra (a semeadura normal cuida)", !repor({ fila: [] }, "u/a"));
check("auto-fila do motor ligada: ela ja repete sozinha", !repor({ fila: [lote()], autoqueue: true }, "u/a"));
check("lote parado por falta de populacao: nao poe outro atras", !repor({ fila: [lote({ neededSlots: 2 })] }, "u/a"));

// No codigo.
check("a regra esta no codigo",
	/const reporAntes = !!\(q0 && !b\.autoqueue && q0\.unitTemplate &&/.test(execP) &&
	/q0\.unitTemplate === g_PudimQueueSeededTpl\[b\.ent\]/.test(execP) &&
	/q0\.timeRemaining <= PUDIM_REPOR_ANTES_MS && !\(q0\.neededSlots > 0\)\);/.test(execP));
check("e e ela que deixa a fila de um lote cair na semeadura",
	/if \(!b\.queueEmpty && !reporAntes\) \{/.test(execP));
check("o log diz quando a semeadura foi antecipada, para medir depois",
	/\(reporAntes \? " \(repondo antes de esvaziar, faltavam "/.test(execP));
check("a carencia de 7s entre semeaduras continua valendo",
	/if \(nowQueue - \(g_PudimQueueSeededAt\[b\.ent\] \|\| 0\) < 7000\) continue;/.test(execP));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
