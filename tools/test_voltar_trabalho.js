/**
 * "Voltar ao Trabalho (N)" — 28/09.
 *
 * Pergunta: "enviar ociosos agora e voltar ao trabalho, não fazem a mesma coisa?". Não: este
 * solta quem o pânico abrigou; o outro pega quem está parado no mapa. Agora o botão mostra
 * quantos o pânico está segurando e fica apagado sem ninguém.
 *
 * Rodar:  node tools/test_voltar_trabalho.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const i18n = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_i18n.js"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

const i = panel.indexOf("const PUDIM_VOLTAR_INTERVALO");
const j = panel.indexOf("\n}", panel.indexOf("function pudim_AtualizarBotaoVoltar")) + 2;
const btn = { caption: "", enabled: true, escritas: 0 };
let lang = "pt";
const vivos = new Set([1, 2, 3]);
const ctx = {
	g_PudimPanicGarrisoned: {},
	GetEntityState: id => (vivos.has(id) ? {} : null),
	pudim_T: k => (k === "cap.backToWork" ? (lang === "pt" ? "Voltar ao Trabalho" : "Back to Work") : k),
	Engine: { TryGetGUIObjectByName: () => new Proxy(btn, {
		set(o, k, v) { if (k === "caption") o.escritas++; o[k] = v; return true; } }) }
};
vm.createContext(ctx);
vm.runInContext(panel.slice(i, j) + "\nthis.atualizar = pudim_AtualizarBotaoVoltar;", ctx);

console.log("voltar ao trabalho (N)");
ctx.atualizar();
check("ninguém abrigado: botão apagado, sem número", btn.enabled === false && btn.caption === "Voltar ao Trabalho");
vm.runInContext("g_PudimPanicGarrisoned = { 1: { shelterID: 50 }, 2: { shelterID: 50 }, 9: { shelterID: 51 } };", ctx);
ctx.atualizar();
check("três no registro, um morto: mostra 2 e acende", btn.enabled === true && btn.caption === "Voltar ao Trabalho (2)", btn.caption);
const antes = btn.escritas;
ctx.atualizar(); ctx.atualizar();
check("sem mudança, não reescreve a legenda", btn.escritas === antes);
lang = "en";
ctx.atualizar();
check("idioma detectado depois: a legenda troca junto", btn.caption === "Back to Work (2)", btn.caption);
vm.runInContext("g_PudimPanicGarrisoned = {};", ctx);
ctx.atualizar();
check("soltou todo mundo: apaga de novo", btn.enabled === false && btn.caption === "Back to Work");

check("atualizado no tique ACIMA da trava de espectador (só lê e desenha)",
	(() => { const t = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
	         const c = execP.indexOf("pudim_AtualizarBotaoVoltar(); } catch");
	         return t > 0 && c > 0 && c < t; })());
check("e logo depois de você apertar, sem esperar o próximo segundo",
	/pudim_ReturnPanicUnitsToWork\(true\);\s*\n\s*try \{ pudim_AtualizarBotaoVoltar\(\); \} catch \(e\) \{\}/.test(execP));
check("a tradução fixa não escreve mais por cima (sairia a cada quadro)",
	!/^\s*"pudim_backToWorkBtn2":\s*"cap\.backToWork"/m.test(i18n));
check("as dicas dos dois botões dizem a diferença, em pt e en",
	/"Enviar Ociosos Agora\\", que cuida de quem está parado no mapa/.test(i18n) &&
	/para esses, use \\"Voltar ao Trabalho\\"/.test(i18n) &&
	/Not the same as \\"Send Idle Now\\"/.test(i18n));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
