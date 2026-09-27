/**
 * A ficha da unidade ao passar o mouse na lista de proporcao.
 *
 * Pedido de 27/09: "ao passar o mouse sobre a unidade em proporcao da unidade, mostrar o
 * modal com dados da unidade".
 *
 * A RECEITA NAO FOI INVENTADA. E a mesma que o jogo usa no botao de treinar, lida no disco
 * em gui/session/selection_panels~training.js (copia do moderngui, o unico lugar onde da
 * para conferir com o jogo aberto travando o public.zip):
 *
 *   getEntityNamesFormatted, getVisibleEntityClassesFormatted, getAurasTooltip,
 *   getEntityTooltip, getEntityCostTooltip
 *   e, sob a opcao "showdetailedtooltips": getHealthTooltip, getAttackTooltip,
 *   getHealerTooltip, getResistanceTooltip, getGarrisonTooltip, getTurretsTooltip,
 *   getProjectilesTooltip, getSpeedTooltip, getResourceDropsiteTooltip
 *
 * Os oito que este mod usa foram conferidos um a um em mods instalados. Os detalhados vao
 * SEMPRE, e nao atras da opcao do jogo: esta lista existe para COMPARAR unidades, e sem
 * ataque e resistencia nao ha o que comparar.
 *
 * Rodar:  node tools/test_ficha_unidade.js
 */
"use strict";
const fs = require("fs");
// A copia de trabalho e CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("ficha da unidade no mouse");

// ── 1. O rotulo precisa RECEBER mouse ──────────────────────────────────────────────────
//
// Objeto `ghost` nao recebe mouse, e sem mouse nao ha tooltip. Os rotulos nasceram ghost
// (nao tinham o que clicar) e por isso a ficha nunca apareceria neles.
const rotulos = [...xml.matchAll(/<object name="(pudim_unitLabel\d+)"([^>]*)>/g)];
check("os rotulos de unidade existem no XML", rotulos.length >= 5, rotulos.length);
const aindaGhost = rotulos.filter(m => /ghost="true"/.test(m[2])).map(m => m[1]);
check("e NENHUM deles e ghost — ghost nao recebe mouse, logo nao tem tooltip",
	aindaGhost.length === 0, aindaGhost.join(", "));
// A mensagem de lista vazia CONTINUA ghost de proposito: ela ocupa o mesmo lugar das duas
// primeiras linhas, e roubar o mouse delas seria pior que nao ter tooltip nenhum.
check("mas pudim_unitVazio continua ghost, que e o certo",
	/<object name="pudim_unitVazio"[^>]*ghost="true"/.test(xml));

// ── 2. A ficha e montada e posta na linha inteira ──────────────────────────────────────
check("existe a funcao que monta a ficha",
	/function pudim_TooltipUnidade\(u\)/.test(execP));
check("ela sai do template, que e a fonte dos dados",
	/td = GetTemplateData\(u\.tpl\)/.test(execP));
check("a ficha vai nos QUATRO objetos da linha, nao so no texto",
	/for \(const parte of \["Label", "Minus", "Val", "Plus"\]\) \{[\s\S]{0,260}o\.tooltip = ficha;/.test(execP));
check("com o estilo de tooltip da sessao, como o resto do mod",
	/o\.tooltip_style = "sessionToolTipBold";/.test(execP));

// ── 3. Os oito ajudantes, e a guarda em cada um ────────────────────────────────────────
const AJUDANTES = [
	"getEntityNamesFormatted", "getVisibleEntityClassesFormatted", "getEntityTooltip",
	"getEntityCostTooltip", "getHealthTooltip", "getAttackTooltip",
	"getResistanceTooltip", "getSpeedTooltip"
];
for (const a of AJUDANTES)
	check("usa " + a, new RegExp("typeof " + a + ' === "function"').test(execP));
check("sao os oito, nem mais nem menos",
	AJUDANTES.filter(a => execP.indexOf(a) >= 0).length === AJUDANTES.length);

// CADA chamada guardada. Um ajudante ausente neste contexto derrubaria a lista inteira — e a
// lista e o que o jogador usa. Vale mais perder uma linha da ficha do que a tela.
check("cada ajudante e chamado so se existir",
	(execP.match(/typeof get\w+ === "function" \? get\w+ : null/g) || []).length === AJUDANTES.length,
	(execP.match(/typeof get\w+ === "function" \? get\w+ : null/g) || []).length + " de " + AJUDANTES.length);
check("e a chamada em si tambem vai dentro de try",
	/try \{\s*\n?\s*const t = \(arg2 === undefined\) \? fn\(td\) : fn\(td, arg2\);/.test(execP));
check("falha de template nao derruba nada: devolve ficha vazia",
	/catch \(e\) \{ return ""; \}\s*\n?\s*if \(!td\) return "";/.test(execP));

// ── 4. O que so o mod sabe ─────────────────────────────────────────────────────────────
// A ficha do jogo diz o que a unidade E; o mod acrescenta onde ela esta na conta DELE —
// que e a razao de a lista existir.
check("a ficha acrescenta a contagem do mod",
	/" em campo, " \+ \(u\.emFila \|\| 0\) \+ " na fila, peso " \+ peso/.test(execP));
check("e avisa quando o peso zero significa 'nao treina'",
	/\(peso > 0 \? "" : " \(nao treina\)"\)/.test(execP));

// ── 5. Assistindo, a ficha e do jogador que esta sendo visto ───────────────────────────
// O custo depende do jogador (descontos de tecnologia). Usar o proprio id assistindo daria
// o custo de quem nao esta em jogo — mesmo erro que o indicador de obras ja teve.
check("o custo usa g_ViewedPlayer quando se esta assistindo",
	/typeof g_ViewedPlayer !== "undefined" && g_ViewedPlayer > 0/.test(execP) &&
	/\? g_ViewedPlayer : Engine\.GetPlayerID\(\)/.test(execP));

// ── A procedencia ──────────────────────────────────────────────────────────────────────
check("a origem da receita fica escrita no codigo",
	/selection_panels~training\.js/.test(panel));
check("e esta dito por que os detalhados vao sempre",
	/COMPARAR unidades/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
