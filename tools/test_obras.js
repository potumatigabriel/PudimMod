/**
 * O indicador de obras em andamento.
 *
 * Pedido de 06/09, apontando o indicador de pesquisa do jogo ("Colheitadeira", com o relógio
 * verde): "igual esse icone, mostrar as unidades contruindo".
 *
 * Nada aqui foi inventado — é a regra da casa, e ela já custou três APIs erradas neste
 * arquivo (ProductionQueue.GetEntitiesList, RangeManager.GetMapSize, Identity.GetTemplateName):
 *
 *   GetBuildProgress / GetNumBuilders   já usados no censo de fundações do próprio mod
 *   GetCurrentTemplateName              já usado na contagem de unidades
 *   "foundation|" como prefixo          já documentado no mod, vem de Commands.js
 *   stretched:session/portraits/<icon>  conferido no disco, em
 *                                       moderngui/gui/session/selection_details~moderngui.js
 *   ler size, mexer nas pontas, devolver  o mesmo que pudim_ally_bar.js faz nas linhas
 *
 * Rodar:  node tools/test_obras.js
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
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "06_pudim_obras.xml"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("indicador de obras em andamento");

// ── A simulação ────────────────────────────────────────────────────────────────────────
check("a função existe",
	/GuiInterface\.prototype\.pudim_GetObrasEmAndamento = function\(player, data\)/.test(execS));
// Sem isto o painel chama e recebe null — a falha mais silenciosa que este mod ja teve.
check("e está EXPOSTA ao ScriptCall — senão o painel chama no vazio",
	/"pudim_GetObrasEmAndamento": 1/.test(execS));

check("só entra fundação com construtor em cima",
	/if \(construtores <= 0\) continue;/.test(execS));
check("o prefixo de fundação sai antes de procurar o retrato",
	/if \(tpl\.indexOf\("foundation\|"\) === 0\) tpl = tpl\.slice\(11\);/.test(execS));
check("usa GetNumBuilders e GetBuildProgress, que o mod já usava",
	/cmpFnd\.GetNumBuilders \? cmpFnd\.GetNumBuilders\(\) : 0/.test(execS) &&
	/cmpFnd\.GetBuildProgress \? cmpFnd\.GetBuildProgress\(\) : 0/.test(execS));
check("a ordem é estável: progresso e, no empate, o id",
	/if \(a\.progresso !== b\.progresso\) return b\.progresso - a\.progresso;\s*\n\s*return a\.id - b\.id;/.test(execS));

// A ordenação, espelhada: a mais adiantada em cima, e sem dançar no empate.
function ordenar(obras) {
	return obras.slice().sort(function(a, b) {
		if (a.progresso !== b.progresso) return b.progresso - a.progresso;
		return a.id - b.id;
	}).map(o => o.id);
}
check("a mais adiantada vem primeiro",
	ordenar([{ id: 1, progresso: 0.2 }, { id: 2, progresso: 0.9 }]).join() === "2,1");
check("e duas no mesmo progresso não trocam de lugar entre ciclos",
	ordenar([{ id: 7, progresso: 0.5 }, { id: 3, progresso: 0.5 }]).join() === "3,7");

// ── O painel ───────────────────────────────────────────────────────────────────────────
check("o painel chama a simulação",
	/Engine\.GuiInterfaceCall\("pudim_GetObrasEmAndamento", \{\}\)/.test(execP));
check("e é chamado no tique, protegido, para não derrubar o resto",
	/try \{ pudim_AtualizarObras\(\); \} catch \(e\) \{\}/.test(execP));

// ── ASSISTINDO TAMBÉM ──────────────────────────────────────────────────────────────────
//
// Relato de 06/09, acompanhando um jogador: "n deveria aparecer as unidades sendo construido
// nesse cantinho?". Devia. O indicador estava DEPOIS do `return` que impede o mod de postar
// comando de rede assistindo — e essa trava não tem nada a dizer sobre quem só lê e desenha.
//
// A regra: leitura em cima do return, comando embaixo. A barra de aliados sempre esteve do
// lado certo; o indicador novo caiu do lado errado.
const iObras = execP.indexOf("pudim_AtualizarObras();");
const iTrava = execP.indexOf("g_IsObserver !== \"undefined\" && g_IsObserver) return;");
check("o indicador é atualizado ANTES da trava de espectador",
	iObras > 0 && iTrava > 0 && iObras < iTrava,
	"obras em " + iObras + ", trava em " + iTrava);
const iBarra = execP.indexOf("pudim_UpdateAllyBar();");
check("a barra de aliados também, como sempre esteve",
	iBarra > 0 && iBarra < iTrava);
check("e a razão está escrita, para ninguém 'arrumar' movendo de volta",
	/leitura em cima, comando embaixo/.test(panel));
check("some quando não há obra, como o indicador de pesquisa do jogo",
	/painel\.hidden = obras\.length === 0;/.test(execP));
check("o retrato usa o caminho conferido no disco",
	/"stretched:session\/portraits\/" \+ icone/.test(execP));
// Sem ícone no template, melhor nada do que um quadrado quebrado.
check("template sem ícone não vira sprite quebrado",
	/icone \? "stretched:session\/portraits\/" \+ icone : "color: 0 0 0 0"/.test(execP));
check("o selo mostra QUANTAS unidades estão na obra — é o que foi pedido",
	/selo\.caption = String\(o\.construtores\);/.test(execP));
check("as linhas empilham lendo o size e devolvendo, como a barra de aliados",
	/const sz = row\.size;\s*\n\s*sz\.top = i \* PUDIM_OBRAS_ALTURA;/.test(execP) &&
	/row\.size = sz;/.test(execP));

// ── A barra: o erro que quase entrou ───────────────────────────────────────────────────
// A primeira versão calculava a largura por bg.size.right com o XML em "100%-46". Nesse
// formato .right devolve -46 (o deslocamento), não a largura: a conta dava negativa e a
// barra nunca encheria. Em pixel os dois lados falam a mesma língua.
const X1 = +/const PUDIM_OBRAS_BAR_X1 = (\d+);/.exec(panel)[1];
const X2 = +/const PUDIM_OBRAS_BAR_X2 = (\d+);/.exec(panel)[1];
const mBg = /name="pudimObrasBarBg\[n\]"[^>]*size="(\d+) \d+ (\d+) \d+"/.exec(xml);
check("o fundo da barra está em pixel no XML, não em porcentagem", !!mBg,
	mBg ? "" : "size do pudimObrasBarBg não é 4 números");
check("e as pontas do JS batem com as do XML",
	mBg && +mBg[1] === X1 && +mBg[2] === X2,
	mBg ? ("XML " + mBg[1] + ".." + mBg[2] + " vs JS " + X1 + ".." + X2) : "");
check("nada calcula largura a partir de .right, que era o erro",
	!/size\.right - .*size\.left/.test(execP));

function larguraBarra(frac) {
	const f = Math.max(0, Math.min(1, frac || 0));
	return X1 + (X2 - X1) * f;
}
check("progresso 0 deixa a barra vazia", larguraBarra(0) === X1);
check("progresso 1 enche até o fim", larguraBarra(1) === X2);
check("meio caminho fica no meio", larguraBarra(0.5) === X1 + (X2 - X1) / 2);
check("progresso fora da faixa não estoura a barra",
	larguraBarra(5) === X2 && larguraBarra(-1) === X1);
check("e undefined não vira NaN na tela",
	larguraBarra(undefined) === X1);

// ── A tela ─────────────────────────────────────────────────────────────────────────────
const LINHAS = +/const PUDIM_OBRAS_LINHAS = (\d+);/.exec(panel)[1];
const mRepeat = /<repeat count="(\d+)" var="n">/.exec(xml);
check("o XML repete tantas linhas quantas o JS percorre",
	mRepeat && +mRepeat[1] === LINHAS,
	mRepeat ? (mRepeat[1] + " no XML vs " + LINHAS + " no JS") : "sem repeat");
check("o painel nasce escondido", /name="pudimObras"[^>]*hidden="true"/.test(xml));
// ghost: o indicador não pode roubar clique do jogo por baixo dele.
check("e é ghost, para não roubar clique do jogo",
	/name="pudimObras"[^>]*ghost="true"/.test(xml));

const ALT = +/const PUDIM_OBRAS_ALTURA = (\d+);/.exec(panel)[1];
const mRow = /name="pudimObrasRow\[n\]"[^>]*size="0 0 100% (\d+)"/.exec(xml);
check("a altura da linha no XML é a mesma que o JS usa para empilhar",
	mRow && +mRow[1] === ALT, mRow ? (mRow[1] + " vs " + ALT) : "sem size na linha");

// O painel tem de caber as linhas todas.
const mPainel = /name="pudimObras"[^>]*size="100%-(\d+) (\d+) 100%-(\d+) (\d+)"/.exec(xml);
check("o painel declara altura para todas as linhas",
	mPainel && (+mPainel[4] - +mPainel[2]) >= LINHAS * ALT,
	mPainel ? ((+mPainel[4] - +mPainel[2]) + "px para " + (LINHAS * ALT) + "px") : "");
// A barra e o selo têm de caber na largura declarada do painel.
const largura = mPainel ? (+mPainel[1] - +mPainel[3]) : 0;
check("a barra cabe na largura do painel", X2 <= largura, X2 + " de " + largura);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
