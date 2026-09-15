/**
 * A barra de aliados não pode cortar nem quebrar linha.
 *
 * Relato de 08/09: "quando o nick e grande, cai de linha, tb a parte de população/capacidade
 * quanto tem mais de 3 caracteres de cada, corta o ultimo, ex 200/200 aparece 200/20".
 *
 * Os dois campos estavam apertados desde sempre, e o prefixo de equipe ("T1 "), que entrei em
 * 06/09 para o modo observador, consumiu o que restava do nome.
 *
 *   "200/200"            7 caracteres não cabiam em  45px  em sans-bold-14
 *   "T1 tesla2402  III" 17 caracteres não cabiam em 120px em sans-bold-14
 *
 * SOBRE A MEDIDA DE FONTE: não dá para medir a fonte daqui, e estimar largura por captura de
 * tela seria chute. O que existe é um PISO observado — ~6,4 e ~7,1 px por caractere — e é
 * dele que sai a régua conservadora de 9 px/caractere usada abaixo. Se algum dia um rótulo
 * cortar mesmo passando neste teste, é a régua que está frouxa, não o teste que está errado.
 *
 * Rodar:  node tools/test_ally_bar_layout.js
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
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "03_pudim_ally_bar.xml"), "utf8");
const js = fs.readFileSync(path.join(base, "gui", "session", "pudim_ally_bar.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("a barra de aliados nao corta nem quebra linha");

// ── Ler o layout do XML, não repeti-lo aqui ────────────────────────────────────────────
const campos = {};
const re = /name="(pudimAlly\w+)\[n\]"[^>]*size="(\d+) \d+ (\d+) \d+"/g;
let m;
while ((m = re.exec(xml))) campos[m[1]] = { x1: +m[2], x2: +m[3], larg: +m[3] - +m[2] };

// Os ícones de recurso GANHARAM NOME em 14/09. Sem nome não dava para movê-los, e o modo
// compacto de duas colunas move todo mundo. Eles entram em `campos` como os demais, então
// a checagem de colisão passou a cobri-los de graça.
const icones = [];
check("achou os campos de texto no XML", Object.keys(campos).length >= 8,
	Object.keys(campos).join(", "));
check("e os quatro ícones de recurso têm nome, para poderem ser movidos",
	Object.keys(campos).filter(k => /^pudimAllyIco/.test(k)).length === 4,
	Object.keys(campos).filter(k => /^pudimAllyIco/.test(k)).join(", "));

// ── Régua conservadora ─────────────────────────────────────────────────────────────────
const PX_BOLD14 = 9;   // piso observado ~7,1 — 9 é folga deliberada
const PX_BOLD13 = 8;
const PX_12 = 7;
const cabe = (texto, larg, px) => texto.length * px <= larg;

// ── O CAMPO DE POPULAÇÃO ───────────────────────────────────────────────────────────────
//
// ERRO MEU, DE 08/09, e vale registrar porque é a mesma armadilha de sempre: dimensionei
// este campo pela string do RELATO ("200/200", 7 caracteres) em vez da legenda que o código
// realmente escreve. Este teste conferia a mesma string errada, então passava.
//
// A legenda de verdade era `contagem/limite +livres (máximo)` — até 16 caracteres. Era ela
// que estourava: "18/30" aparecia sem o "+12" porque o resto não cabia.
//
// O máximo da partida saiu da legenda: é o MESMO número para todos os jogadores, e nove
// linhas repetindo "(200)" gastavam seis caracteres cada para não distinguir ninguém.
//
// RÉGUA DESTE CAMPO: 7 px/caractere, não os 9 dos nomes. A legenda é só dígito e sinal, que
// são estreitos, e há medida de FOLGA observada: "18/25 +7" (8 caracteres) cabia nos 45px
// antigos, ou seja ≤5,6 px/caractere. 7 mantém margem sobre isso.
const PX_DIGITOS = 7;
const pop = campos.pudimAllyPop;
check("o campo de população existe", !!pop);

// A legenda vem da FÓRMULA DO CÓDIGO, não de uma string escrita à mão aqui.
const mPop = /popObj\.caption = d\.popCount \+ "\/" \+ d\.popLimit \+[\s\S]{0,200}?;/.exec(js);
check("a legenda da população foi encontrada no código", !!mPop);
const legendaPop = mPop ? mPop[0] : "";
check("e o máximo da partida NÃO está mais nela",
	legendaPop.indexOf("popMax") < 0,
	"ainda repete o máximo em todas as linhas");

// Pior caso real: todos os campos no maior valor possível.
const piorPop = "200/200 +0";
console.log("   pior população: \"" + piorPop + "\" (" + piorPop.length + " chars) em " +
	pop.larg + "px");
check("a legenda inteira cabe — era o \"200/20\" e o \"18/30\" do relato",
	cabe(piorPop, pop.larg, PX_DIGITOS),
	pop.larg + "px para " + (piorPop.length * PX_DIGITOS) + "px");
// Era 45px: o teste tem de reprovar o valor antigo, senão não está medindo nada.
check("e a largura ANTIGA (45px) seria reprovada por este mesmo teste",
	!cabe(piorPop, 45, PX_DIGITOS));
// E a legenda ANTIGA, com o máximo, não caberia nem no campo novo — foi ela o problema.
check("a legenda ANTIGA (com o máximo) não caberia nem hoje",
	!cabe("200/200 +0 (200)", pop.larg, PX_DIGITOS),
	(16 * PX_DIGITOS) + "px contra " + pop.larg + "px");

const nome = campos.pudimAllyName;
check("o campo de nome existe", !!nome);
// Dois cortes: a estrela de "sou eu" ocupa menos que o prefixo de equipe, e não há razão
// para encurtar o nome de quem está jogando por causa do modo observador.
const NICK_OBS = +/const PUDIM_NICK_MAX_OBS = (\d+);/.exec(js)[1];
const NICK = +/const PUDIM_NICK_MAX = (\d+);/.exec(js)[1];
const piorObs = "T1 " + "M".repeat(NICK_OBS) + "  III";
const piorJog = "★" + "M".repeat(NICK) + "  III";
console.log("   pior nome assistindo: \"" + piorObs + "\" (" + piorObs.length + " chars) em " +
	nome.larg + "px");
check("o pior nome assistindo cabe — era a quebra de linha do relato",
	cabe(piorObs, nome.larg, PX_BOLD14),
	(piorObs.length * PX_BOLD14) + "px necessários");
check("o pior nome jogando também cabe",
	cabe(piorJog, nome.larg, PX_BOLD14),
	(piorJog.length * PX_BOLD14) + "px necessários");
check("e o campo ANTIGO (120px) seria reprovado nos dois casos",
	!cabe(piorObs, 120, PX_BOLD14) && !cabe(piorJog, 120, PX_BOLD14));
// Jogando cabe mais nick, porque o prefixo é menor. Se um dia ficarem iguais, é sinal de
// que alguém copiou o valor sem refazer a conta.
check("jogando cabe mais nick que assistindo", NICK > NICK_OBS,
	NICK + " contra " + NICK_OBS);

// ── Os demais campos ───────────────────────────────────────────────────────────────────
// Conteúdo real, do que aparece na tela: "4579 (50)" e "Al:66 In:106 Ca:2 Ar:38".
for (const [campo, texto, px] of [
	["pudimAllyFood", "4579 (50)", PX_BOLD13],
	["pudimAllyWood", "8204 (23)", PX_BOLD13],
	["pudimAllyStone", "3001 (24)", PX_BOLD13],
	["pudimAllyMetal", "2275 (24)", PX_BOLD13],
	["pudimAllyArmy", "Al:66 In:106 Ca:2 Ar:38", PX_12],
	["pudimAllyKD", "214k/169d 1.3", PX_BOLD13]
])
	check(campo.replace("pudimAlly", "") + ' cabe "' + texto + '"',
		campos[campo] && cabe(texto, campos[campo].larg, px),
		campos[campo] ? (campos[campo].larg + "px para " + (texto.length * px) + "px") : "sem campo");

// ── Nada invade o vizinho ──────────────────────────────────────────────────────────────
const todos = Object.keys(campos).filter(k => k !== "pudimAllyBgOverlay")
	.map(k => ({ nome: k, x1: campos[k].x1, x2: campos[k].x2 }))
	.concat(icones)
	.sort((a, b) => a.x1 - b.x1);
const colisoes = [];
for (let i = 1; i < todos.length; i++)
	if (todos[i].x1 < todos[i - 1].x2)
		colisoes.push(todos[i - 1].nome + "(" + todos[i - 1].x2 + ") > " +
		              todos[i].nome + "(" + todos[i].x1 + ")");
check("nenhum campo invade o seguinte", colisoes.length === 0, colisoes.join("; "));

// ── Tudo cabe na barra ─────────────────────────────────────────────────────────────────
const mBarra = /name="pudimAllyBar"[^>]*size="50%-(\d+) \d+ 50%\+(\d+)/.exec(xml);
check("a barra declara sua largura", !!mBarra);
const largBarra = mBarra ? (+mBarra[1] + +mBarra[2]) : 0;
const fim = Math.max(...todos.map(o => o.x2));
check("o último campo termina dentro da barra", fim <= largBarra,
	"fim=" + fim + " barra=" + largBarra);
// Em 08/09 a correção do nome e da população veio de REDISTRIBUIR, e a barra continuou com
// 940. Em 14/09 ela cresceu — mas por um motivo declarado: entrou a coluna de melhorias
// ("colocar a quantidade de upgrade, separados em economico e militar"). Crescimento com
// causa nomeada, e travado no tamanho exato, para um alargamento distraído reprovar.
const LARGA = +/const PUDIM_LARGURA_LARGA = (\d+);/.exec(js)[1];
check("a barra tem exatamente a largura declarada na JS", largBarra === LARGA,
	largBarra + " no XML contra " + LARGA + " na JS");
check("e o crescimento sobre os 940 de 08/09 é só a coluna de melhorias",
	largBarra - 940 === campos.pudimAllyUpg.larg + 6,
	(largBarra - 940) + "px a mais para um campo de " + campos.pudimAllyUpg.larg + "px");
check("as melhorias cabem em \"E29 M41\"",
	cabe("E29 M41", campos.pudimAllyUpg.larg, PX_BOLD13),
	campos.pudimAllyUpg.larg + "px");

// ── O MODO COMPACTO, DE DUAS COLUNAS ───────────────────────────────────────────────────
//
// Pedido de 14/09: "deixa cada time lado a lado, usando metade da tela, pra ter menos
// altura". O layout largo vive no XML; o compacto vive na JS, e é aplicado movendo cada
// campo. Os dois precisam da MESMA régua — foi por medir um e usar o outro que o campo de
// população cortou o "+12" em 08/09.
function lerLayout(nome) {
	const m = new RegExp("const " + nome + " = \\{([\\s\\S]*?)\\n\\};").exec(js);
	if (!m) return null;
	const out = {};
	const re2 = /"(\w+)":\s*\[(\d+),\s*(\d+)(?:,\s*"([\w-]+)")?\]/g;
	let mm;
	while ((mm = re2.exec(m[1])))
		out[mm[1]] = { x1: +mm[2], x2: +mm[3], larg: +mm[3] - +mm[2], font: mm[4] || null };
	return out;
}
const largo = lerLayout("PUDIM_LAYOUT_LARGO");
const compacto = lerLayout("PUDIM_LAYOUT_COMPACTO");
check("a JS declara os dois layouts", !!largo && !!compacto);
check("e eles têm os mesmos campos",
	Object.keys(largo).sort().join(",") === Object.keys(compacto).sort().join(","),
	Object.keys(largo).length + " contra " + Object.keys(compacto).length);

// O layout largo da JS TEM de bater com o XML, senão a primeira volta ao modo largo
// desmonta a barra em silêncio.
const divergem = Object.keys(largo).filter(k => {
	const c = campos["pudimAlly" + k];
	return !c || c.x1 !== largo[k].x1 || c.x2 !== largo[k].x2;
});
check("o layout largo da JS é o mesmo do XML", divergem.length === 0, divergem.join(", "));

// Nada invade o vizinho no compacto.
const ordemC = Object.keys(compacto).map(k => ({ nome: k, x1: compacto[k].x1, x2: compacto[k].x2 }))
	.sort((a, b) => a.x1 - b.x1);
const colC = [];
for (let i = 1; i < ordemC.length; i++)
	if (ordemC[i].x1 < ordemC[i - 1].x2)
		colC.push(ordemC[i - 1].nome + "(" + ordemC[i - 1].x2 + ") > " +
		          ordemC[i].nome + "(" + ordemC[i].x1 + ")");
check("no compacto nenhum campo invade o seguinte", colC.length === 0, colC.join("; "));

// E cabe o conteúdo, com a régua da fonte de cada campo. sans-11 e sans-bold-12 saem da
// mesma proporção do resto: 9 px/caractere em 14, escalado pelo tamanho.
const PX_BOLD12 = 9 * 12 / 14;
const PX_11 = 9 * 11 / 14;
const NICK_C = +/const PUDIM_NICK_MAX_COMPACTO = (\d+);/.exec(js)[1];
for (const [campo, texto, px] of [
	["Name", "T1 " + "M".repeat(NICK_C) + "  III", PX_BOLD12],
	["Pop", "200/200 +0", PX_BOLD12],
	["Food", "4579·50", PX_11],
	["Metal", "2275·24", PX_11],
	["Upg", "E29 M41", PX_11],
	["Army", "A:66 I:106 C:2 R:38", PX_11],
	["KD", "214k/169d 1.3", PX_11]
])
	check("compacto: " + campo + ' cabe "' + texto + '"',
		cabe(texto, compacto[campo].larg, px),
		compacto[campo].larg + "px para " + Math.ceil(texto.length * px) + "px");

// E a coluna compacta tem de caber em metade de uma tela real. 1707 é a largura do monitor
// do jogador (a mesma que tools/test_painel_cabe.js usa para a altura).
const COMPACTA = +/const PUDIM_LARGURA_COMPACTA = (\d+);/.exec(js)[1];
const GAP = +/const PUDIM_COL_GAP = (\d+);/.exec(js)[1];
const MARGEM = +/const PUDIM_MARGEM_TELA = (\d+);/.exec(js)[1];
const fimC = Math.max(...ordemC.map(o => o.x2));
check("a coluna compacta termina na largura declarada", fimC === COMPACTA,
	fimC + " contra " + COMPACTA);
check("e duas colunas cabem na tela de 1707px do jogador",
	2 * COMPACTA + GAP + 2 * MARGEM <= 1707,
	(2 * COMPACTA + GAP + 2 * MARGEM) + "px");
// A barra LARGA não caberia duas vezes — é por isso que o compacto existe.
check("com o layout largo elas NÃO caberiam — o compacto não é enfeite",
	2 * LARGA + GAP + 2 * MARGEM > 1707);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
