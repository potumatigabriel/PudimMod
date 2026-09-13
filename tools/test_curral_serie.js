/**
 * Curral na Construção em Série.
 *
 * Pedido de 05/09: "adicione curral na lista de construção em serie".
 *
 * O TEMPLATE está conferido, não suposto: `corral` aparece nos comandos `construct` dos
 * replays como structures/gaul/corral, structures/rome/corral, structures/mace/corral e
 * structures/spart/corral — 70 construções em 12 partidas. Dado do próprio motor.
 *
 * O NOME DA CLASSE não deu para conferir: o public.zip fica travado com o jogo aberto, e o
 * pedido veio com a partida em curso. Chutar "Corral" repetiria o erro da torre — o censo
 * contaria zero, "faltam N" nunca desceria, e a falha seria silenciosa (ver
 * test_distancia_minima.js e o relato de 03/09 sobre o contador que não descia).
 *
 * Por isso o curral entra com classe NULA e o censo passa a identificar pelo template.
 * Funciona para qualquer civilização e não depende de eu adivinhar nada.
 *
 * Rodar:  node tools/test_curral_serie.js
 */
"use strict";
const fs = require("fs");
// A cópia de trabalho é CRLF (autocrlf do git) e as verificações deste arquivo casam
// trechos de MAIS DE UMA LINHA, com \n literal. Ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");
const i18n = fs.readFileSync(path.join(base, "gui", "session", "pudim_i18n.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("curral na construcao em serie");

// ── Está na lista, nas três pontas ─────────────────────────────────────────────────────
check("o tipo entra em PUDIM_QUARTEL_TIPOS",
	/const PUDIM_QUARTEL_TIPOS = \[[^\]]*"curral"[^\]]*\];/.test(panel));
check("com chave de tradução, não literal em português",
	/curral:\s*"cap\.corral",/.test(panel) && /"cap\.corral":\s*\["Corral", "Curral"\]/.test(i18n));
check("e a simulação conhece o tipo",
	/"curral":\s*\{ classe: null,\s*tpl: "corral",\s*anel: false \}/.test(execS));

// ── O template é o conferido ───────────────────────────────────────────────────────────
check("o template é 'corral', o mesmo que os replays mostram",
	/tpl: "corral"/.test(execS));
check("a procedência do nome fica no código, com as civs vistas",
	/structures\/gaul\/corral/.test(sim) && /structures\/rome\/corral/.test(sim));
check("e está escrito por que a CLASSE não foi cravada",
	/Chutar "Corral" seria repetir o erro\s*\n?\s*\/\/ da torre|repetir o erro/.test(sim));

// ── O censo não depende da classe ──────────────────────────────────────────────────────
check("existe um identificador que aceita classe OU template",
	/const ehDoTipo = function\(ent, cmpId\) \{/.test(execS));
check("usa a classe quando ela é conhecida",
	/if \(classe\) return !!\(cmpId && cmpId\.HasClass\(classe\)\);/.test(execS));
check("e cai no template quando não é",
	/return nome\.slice\(nome\.lastIndexOf\("\/"\) \+ 1\) === spec\.tpl;/.test(execS));
// Fundação vem como "foundation|structures/<civ>/<x>" — sem tirar o prefixo, obra em
// andamento nunca contaria e "faltam N" ficaria parado, que é o defeito que se quer evitar.
check("o prefixo de fundação é removido antes de comparar",
	/if \(nome\.indexOf\("foundation\|"\) === 0\) nome = nome\.slice\(11\);/.test(execS));
// Igualdade no fim do caminho, não "contém": a mesma armadilha de storehouse/warehouse.
check("compara por igualdade no fim do caminho, não por 'contém'",
	!/indexOf\(spec\.tpl\) >= 0/.test(execS));

check("os três lugares que olhavam a classe passaram a usar o identificador",
	(execS.match(/ehDoTipo\(ent, c/g) || []).length === 3,
	(execS.match(/ehDoTipo\(ent, c/g) || []).length + " de 3");
check("e não sobrou HasClass(classe) solto fora dele",
	(execS.match(/HasClass\(classe\)/g) || []).length === 1);

// ── A tela ─────────────────────────────────────────────────────────────────────────────
// Sete tipos podem correr juntos (seis + paliçada), então são precisas sete vagas.
const TIPOS = /const PUDIM_QUARTEL_TIPOS = \[([^\]]*)\];/.exec(panel)[1].split(",").length;
const VAGAS = +/const PUDIM_SERIE_VAGAS = (\d+);/.exec(panel)[1];
check("há uma vaga de lista por tipo possível", VAGAS === TIPOS,
	"vagas=" + VAGAS + " tipos=" + TIPOS);
check("a vaga nova existe no XML, com rótulo e X",
	xml.indexOf('name="pudim_serieRot6"') > 0 && xml.indexOf('name="pudim_serieX6"') > 0);
check("e o X dela cancela a vaga 6",
	xml.indexOf("pudim_SerieCancelar(6);") > 0);
check("a vaga nova entra na lista dos objetos que descem com o estimador",
	/"pudim_serieRot6", "pudim_serieX6",/.test(panel));

// ── O painel não cresceu ───────────────────────────────────────────────────────────────
// A fileira nova coube no vão que já existia entre os botões e o cabeçalho de unidades:
// nada foi empurrado para fora da tela. test_painel_cabe.js mede a folga; aqui basta
// garantir que ninguém voltou a ocupar a faixa da fileira nova.
const objs = [];
const re = /name="([a-zA-Z_0-9]+)"[^>]*size="([^"]*)"/g;
let m;
while ((m = re.exec(xml))) {
	const p = m[2].split(" ");
	if (p.length === 4) objs.push({ nome: m[1], y1: Number(p[1]), y2: Number(p[3]) });
}
const naFaixa = objs.filter(o =>
	Number.isFinite(o.y1) && o.y1 < 750 && o.y2 > 730 && o.nome.indexOf("pudim_serie") !== 0);
check("nada colide com a fileira nova (730-750)",
	naFaixa.length === 0, naFaixa.map(o => o.nome + " " + o.y1 + "-" + o.y2).join(", "));

// As linhas de unidade da sexta em diante (13/09) ficam no XML esperando serem exibidas: a
// lista cresce em tempo de execução, e só aparece o que cabe na tela. Elas não contam como
// "fim do painel" — quem mede isso é tools/test_painel_cabe.js, com a régua certa.
const extraUnidade = n => {
	const mm = /^pudim_unit(?:Label|Minus|Val|Plus)(\d+)$/.exec(n);
	return !!mm && +mm[1] >= 5;
};
const fim = Math.max(...objs
	.filter(o => Number.isFinite(o.y2) && !extraUnidade(o.nome)).map(o => o.y2));
check("e o painel continua terminando onde terminava", fim === 974, "fim=" + fim);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
