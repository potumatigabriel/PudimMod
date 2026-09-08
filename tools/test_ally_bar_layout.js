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

const icones = [];
const reIc = /<object type="image" size="(\d+) \d+ (\d+) \d+" sprite="stretched:session\/icons\/resources/g;
while ((m = reIc.exec(xml))) icones.push({ nome: "icone", x1: +m[1], x2: +m[2], larg: +m[2] - +m[1] });

check("achou os campos de texto no XML", Object.keys(campos).length >= 8,
	Object.keys(campos).join(", "));
check("e os ícones de recurso", icones.length === 4, icones.length);

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
// A correção veio de redistribuir, não de esticar: a barra não pode ter crescido.
check("e a barra NÃO ficou mais larga — o espaço saiu de quem sobrava",
	largBarra === 940, largBarra);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
