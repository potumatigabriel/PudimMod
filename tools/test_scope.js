/**
 * Caça variável usada sem existir no escopo da função.
 *
 * Bug de 19/08, em jogo: "result is not defined" em GuiInterface~pudim.js:2138, dentro de
 * pudim_GetScoutBorderTarget. Eu escrevi `result.threats = ...` numa função cujo retorno se
 * chama `bestPos` — `result` existe em OUTRAS funções do mesmo arquivo, então nem o
 * `node --check` nem os testes por regex acusavam. O scout quebrava a cada waypoint.
 *
 * `node --check` só valida sintaxe, e um smoke test com tudo stubado não chega nas linhas
 * profundas. A verificação certa é estática e por escopo: para cada função, o que ela usa
 * tem de estar declarado nela, nos parâmetros, no escopo do arquivo, ou ser global conhecido.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");
const ARQUIVOS = [
	"simulation/components/GuiInterface~pudim.js",
	"gui/session/pudim_panel.js",
	"gui/session/pudim_ally_bar.js",
	"gui/session/session~pudim.js"
];

// Globais do 0 A.D. e do JS que nunca são declarados no arquivo.
const GLOBAIS = new Set([
	"Engine", "Math", "JSON", "Object", "Array", "String", "Number", "Boolean", "Date", "Set",
	"Map", "RegExp", "Error", "Infinity", "NaN", "undefined", "console", "global", "isFinite",
	"isNaN", "parseInt", "parseFloat", "arguments", "this",
	// 0 A.D.
	"SYSTEM_ENTITY", "INVALID_ENTITY", "Resources", "TechnologyTemplates", "VisionSharing",
	"QueryPlayerIDInterface", "QueryOwnerInterface", "QueryMiragedInterface",
	"ApplyValueModificationsToEntity", "GuiInterface", "Vector2D", "Vector3D",
	"warn", "error", "print", "uneval", "clone", "deepfreeze", "translate", "sprintf",
	"markForTranslation", "translateWithContext", "g_ResourceData",
	// GUI do jogo base
	"GetEntityState", "GetTemplateData", "GetSimState", "Engine", "g_SimState", "g_Selection",
	"g_ViewedPlayer", "g_IsObserver", "g_PlayerAssignments", "g_LastTickTime",
	"getEntityOrHolder", "playerColor", "colorizePlayernameHelper", "clearSelection",
	"globalThis", "g_Players", "g_CivData", "g_DiplomacyColors", "g_MaxZoom"
]);

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

/** Remove comentários e literais de string, para não confundir texto com código. */
function limpar(src) {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, " ")
		.replace(/\/\/[^\n]*/g, " ")
		.replace(/"(?:\\.|[^"\\])*"/g, '""')
		.replace(/'(?:\\.|[^'\\])*'/g, "''")
		.replace(/`(?:\\.|[^`\\])*`/g, "``");
}

/** Nomes declarados num pedaço de código: const/let/var, parâmetros e for-of/in. */
function declarados(txt) {
	const nomes = new Set();
	// Lista de declaradores: `let a = null, b = null;` — pegar TODOS, não só o primeiro.
	// Era essa a falha que enchia o relatório de falso positivo (rtype, ccPositions, taken).
	for (const m of txt.matchAll(/\b(?:const|let|var)\s+([^;\n]*)/g)) {
		let prof = 0, atual = "";
		const partes = [];
		for (const ch of m[1]) {
			if ("([{".indexOf(ch) !== -1) ++prof;
			else if (")]}".indexOf(ch) !== -1) --prof;
			if (ch === "," && prof === 0) { partes.push(atual); atual = ""; }
			else atual += ch;
		}
		partes.push(atual);
		for (const parte of partes) {
			// Corta em "=", e também em " of "/" in " para pegar `for (const x of lista)`.
			const n = parte.trim().split("=")[0].split(/\s+(?:of|in)\s+/)[0].trim();
			if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n);
		}
	}
	// desestruturação simples: const { a, b } = ... / const [a, b] = ...
	for (const m of txt.matchAll(/\b(?:const|let|var)\s*[{[]([^}\]]*)[}\]]/g))
		for (const parte of m[1].split(","))
			{ const n = parte.trim().split(":").pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n); }
	// parâmetros de qualquer function(...) e de arrow (a, b) =>
	for (const m of txt.matchAll(/function\s*[\w$]*\s*\(([^)]*)\)/g))
		for (const parte of m[1].split(","))
			{ const n = parte.trim().split("=")[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n); }
	for (const m of txt.matchAll(/\(([^()]*)\)\s*=>/g))
		for (const parte of m[1].split(","))
			{ const n = parte.trim().split("=")[0].trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n); }
	for (const m of txt.matchAll(/([A-Za-z_$][\w$]*)\s*=>/g)) nomes.add(m[1]);
	// Parametro desestruturado de arrow: .filter(([, f]) => ...) e ({ a, b }) => ...
	for (const m of txt.matchAll(/\(\s*[[{]([^\]}]*)[\]}]\s*\)\s*=>/g))
		for (const parte of m[1].split(","))
			{ const n = parte.trim().split(":").pop().trim(); if (/^[A-Za-z_$][\w$]*$/.test(n)) nomes.add(n); }
	// function declarada com nome
	for (const m of txt.matchAll(/function\s+([A-Za-z_$][\w$]*)/g)) nomes.add(m[1]);
	return nomes;
}

/** Fatia o arquivo em blocos de função de topo, para dar escopo a cada um. */
function funcoes(src) {
	const marcas = [];
	const re = /^(?:GuiInterface\.prototype\.([\w$]+)|function\s+([\w$]+))/gm;
	for (const m of re.exec ? [...src.matchAll(re)] : []) marcas.push({ i: m.index, nome: m[1] || m[2] });
	const out = [];
	for (let k = 0; k < marcas.length; ++k) {
		const fim = k + 1 < marcas.length ? marcas[k + 1].i : src.length;
		out.push({ nome: marcas[k].nome, corpo: src.slice(marcas[k].i, fim) });
	}
	return out;
}

console.log("variavel fora de escopo");

for (const rel of ARQUIVOS) {
	const src = limpar(fs.readFileSync(path.join(RAIZ, rel), "utf8"));
	const doArquivo = declarados(src.replace(/^(?:GuiInterface\.prototype\.[\w$]+|function\s+[\w$]+)[\s\S]*$/m, ""));
	// Globais do próprio mod, declarados em qualquer lugar do arquivo (var g_Pudim*, const PUDIM_*)
	for (const m of src.matchAll(/\b(?:var|const|let)\s+(g_[\w$]+|PUDIM_[\w$]+|pudim[\w$]*)/g))
		doArquivo.add(m[1]);
	for (const m of src.matchAll(/\bfunction\s+(pudim[\w$]*)/g)) doArquivo.add(m[1]);
	// IID_* e nomes de outros arquivos do mod
	const globalOk = n => GLOBAIS.has(n) || /^IID_/.test(n) || /^g_Pudim/.test(n) ||
		/^PUDIM_/.test(n) || /^pudim_/.test(n) || doArquivo.has(n);

	const suspeitos = [];
	for (const f of funcoes(src)) {
		const locais = declarados(f.corpo);
		// Uso como objeto: `nome.` ou `nome[`. É onde este bug se manifesta.
		for (const m of f.corpo.matchAll(/(?:^|[^\w$.])([a-z][\w$]*)\s*(?:\.|\[)/g)) {
			const n = m[1];
			if (locais.has(n) || globalOk(n)) continue;
			// palavras-chave e coisas que não são variáveis
			if (["return", "typeof", "new", "delete", "void", "in", "of", "if", "else", "for",
			     "while", "do", "switch", "case", "break", "continue", "function", "try",
			     "catch", "finally", "throw", "true", "false", "null",
			     "const", "let", "var", "await", "yield", "instanceof"].indexOf(n) !== -1) continue;
			suspeitos.push(f.nome + ": " + n);
		}
	}
	const unicos = [...new Set(suspeitos)];
	check(rel + " nao usa variavel fora de escopo", unicos.length === 0,
		unicos.slice(0, 8).join(" | ") + (unicos.length > 8 ? " (+" + (unicos.length - 8) + ")" : ""));
}

// O detector precisa realmente pegar o bug que motivou o teste.
const AMOSTRA = `
GuiInterface.prototype.pudim_Bom = function(player, data) {
	const result = { a: 1 };
	result.b = 2;
	return result;
};
GuiInterface.prototype.pudim_Ruim = function(player, data) {
	const bestPos = { a: 1 };
	result.threats = 3;
	return bestPos;
};
`;
const achadosAmostra = [];
for (const f of funcoes(limpar(AMOSTRA))) {
	const locais = declarados(f.corpo);
	for (const m of f.corpo.matchAll(/(?:^|[^\w$.])([a-z][\w$]*)\s*(?:\.|\[)/g))
		if (!locais.has(m[1]) && !GLOBAIS.has(m[1])) achadosAmostra.push(f.nome + ":" + m[1]);
}
check("o detector pega o caso real (result em pudim_Ruim)",
	achadosAmostra.indexOf("pudim_Ruim:result") !== -1, achadosAmostra.join(", "));
check("e nao acusa a funcao correta",
	achadosAmostra.indexOf("pudim_Bom:result") === -1, achadosAmostra.join(", "));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
