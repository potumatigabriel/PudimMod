/**
 * Teste vermelho por fim de linha não é defeito do mod — e escondeu defeitos de verdade.
 *
 * Em 05/09 a suíte tinha OITO testes vermelhos. Eu os tratei como dívida antiga ("procuram
 * funções renomeadas") por dois dias. Não era isso: a cópia de trabalho está em CRLF (o
 * autocrlf do git), e seis dos oito casavam trechos de MAIS DE UMA LINHA com "\n" literal.
 * A regra que eles verificam nunca mudou; só o byte entre as linhas.
 *
 * O custo não é o teste vermelho: é que uma suíte vermelha para de ser sinal. Enquanto os
 * oito estavam quebrados, qualquer regressão de verdade teria entrado sem ninguém ver.
 *
 * Este teste não deixa a armadilha voltar: todo teste que casa mais de uma linha do fonte
 * precisa ler normalizado.
 *
 * Rodar:  node tools/test_fim_de_linha.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const dir = path.join(__dirname);

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("fim de linha nao pode derrubar teste");

// ── A armadilha, demonstrada ───────────────────────────────────────────────────────────
const trecho = "if (a) {\r\n\tb();\r\n}";
check("busca literal com \\n falha em fonte CRLF — é exatamente o que acontecia",
	trecho.indexOf("if (a) {\n\tb();\n}") < 0);
check("e a mesma busca acerta depois de normalizar",
	trecho.split("\r\n").join("\n").indexOf("if (a) {\n\tb();\n}") >= 0);
// Regex com \s* já é imune; o problema é só a busca literal e o \n cravado.
check("regex com \\s* atravessa os dois formatos",
	/if \(a\) \{\s*b\(\);/.test(trecho));

// ── Nenhum teste pode voltar a casar multilinha sem normalizar ─────────────────────────
const arquivos = fs.readdirSync(dir)
	.filter(f => f.startsWith("test_") && f.endsWith(".js") && f !== "test_fim_de_linha.js");

check("a suíte tem testes para conferir", arquivos.length > 30, arquivos.length + " arquivos");

const suspeitos = [];
for (const f of arquivos) {
	const s = fs.readFileSync(path.join(dir, f), "utf8");
	// Lê o fonte do mod?
	if (!/readFileSync/.test(s)) continue;
	// Casa mais de uma linha? \n dentro de string literal, ou \n dentro de regex.
	const casaMultilinha = /\\n\\t/.test(s) || /\\s\*\\n/.test(s) || /\\n\\s\*/.test(s);
	if (!casaMultilinha) continue;
	// Normaliza na leitura?
	const normaliza = /_pudimLerOriginal/.test(s) ||
	                  /split\("\\r\\n"\)\.join\("\\n"\)/.test(s) ||
	                  /replace\(\/\\r\\n\/g/.test(s);
	if (!normaliza) suspeitos.push(f);
}
check("todo teste que casa multilinha lê normalizado",
	suspeitos.length === 0, suspeitos.join(", "));

// ── Os oito que quebraram, nominalmente ────────────────────────────────────────────────
// Ficam listados porque foram eles que provaram o ponto: seis eram só o fim de linha, e os
// outros dois (test_queue_respect e test_unidades) apontavam para uma linha que a mudança
// de precedência da proporção tinha substituído DE PROPÓSITO — dívida real, mas de duas
// linhas, não de um sistema inteiro.
for (const f of ["test_combate_trava.js", "test_log_custo.js", "test_panic_timeout.js",
                 "test_quartel_junto.js", "test_rally.js", "test_selecionar_guerreiros.js"]) {
	const s = fs.readFileSync(path.join(dir, f), "utf8");
	check(f + " lê normalizado", /_pudimLerOriginal/.test(s));
}

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
