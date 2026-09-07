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

// ── Unidades em treinamento ────────────────────────────────────────────────────────────
// "só mostra construções, tem que mostrar as unidades tambem".
// LOTE DE UNIDADE É O ITEM QUE TEM unitTemplate — não existe `productiontype`.
//
// Quarta API inventada neste arquivo (as outras: ProductionQueue.GetEntitiesList,
// RangeManager.GetMapSize, Identity.GetTemplateName). Esta eu herdei, e usei de novo sem
// conferir. Dois sintomas, uma causa: o indicador nunca mostrava linha de treino com a fila
// cheia na tela, e o log da proporção dizia `fila0` em TODAS as linhas de TODAS as partidas.
//
// Conferido no disco: moderngui/simulation/components/GuiInterface~moderngui.js percorre
// `cmpProductionQueue.queue` e separa lote (`queue.entity`) de pesquisa (`queue.technology`)
// — não há `productiontype` em lugar nenhum.
check("a fila de produção também vira linha",
	/if \(!item\.unitTemplate\) continue;/.test(execS));
check("e o campo fantasma sumiu do código executável",
	!/productiontype/.test(execS),
	(execS.match(/[^\s]*productiontype[^\s]*/g) || []).join(", "));
// Pesquisa é o que NÃO tem unitTemplate: testar pelo campo conferido em vez de inventar o
// nome do campo de tecnologia, que seria repetir o erro.
check("pesquisa é detectada pela ausência de unitTemplate, sem inventar outro nome",
	/queue\.some\(function\(q\) \{ return !q\.unitTemplate; \}\)/.test(execS));
check("a procedência da correção fica no código",
	/GuiInterface~moderngui\.js/.test(sim) && /QUARTA API INVENTADA/.test(sim));
// Agregado por TIPO: seis quartéis fazendo lanceiro são uma linha "×18", não seis iguais.
check("agregado por tipo de unidade, não por edifício",
	/porUnidade\[t\]\.quantos \+= \(item\.count \|\| 1\);/.test(execS));
check("o progresso é o do lote mais adiantado — é o que diz quando sai a próxima",
	/if \(p > porUnidade\[t\]\.progresso\) porUnidade\[t\]\.progresso = p;/.test(execS));
// Somar ou tirar média dos lotes daria um número que não corresponde a unidade nenhuma.
check("e NÃO é soma nem média dos lotes",
	!/porUnidade\[t\]\.progresso \+=/.test(execS));
check("o id de desempate é estável quando um edifício termina e outro assume",
	/if \(ent < porUnidade\[t\]\.id\) porUnidade\[t\]\.id = ent;/.test(execS));

// A ordenação, espelhada: obra antes de treino, a mais adiantada em cima, sem dançar.
function ordenar(obras) {
	return obras.slice().sort(function(a, b) {
		if (a.tipo !== b.tipo) return a.tipo === "obra" ? -1 : 1;
		if (a.progresso !== b.progresso) return b.progresso - a.progresso;
		return a.id - b.id;
	}).map(o => o.tipo[0] + o.id);
}
check("a mais adiantada vem primeiro",
	ordenar([{ tipo: "obra", id: 1, progresso: 0.2 }, { tipo: "obra", id: 2, progresso: 0.9 }])
		.join() === "o2,o1");
check("e duas no mesmo progresso não trocam de lugar entre ciclos",
	ordenar([{ tipo: "obra", id: 7, progresso: 0.5 }, { tipo: "obra", id: 3, progresso: 0.5 }])
		.join() === "o3,o7");
// Obra parada custa mais caro que fila lenta: ela vem primeiro mesmo com menos progresso.
check("construção vem antes de treinamento, mesmo com progresso menor",
	ordenar([{ tipo: "treino", id: 5, progresso: 0.99 }, { tipo: "obra", id: 9, progresso: 0.01 }])
		.join() === "o9,t5");

// ── Quem está construindo, agrupado por tipo ───────────────────────────────────────────
// "quero que mostre todas as unidades contruindo agrupadas por tipo".
//
// A linha da obra diz QUANTOS; esta diz QUEM. São perguntas diferentes: "o quartel tem 5"
// não conta se são aldeãs ou lanceiros, e é isso que decide se a economia está pagando a
// obra ou se o exército parou para construir.
check("os construtores da fundação viram linhas, agrupados por tipo",
	/lista = cmpFnd\.GetBuilders\(\) \|\| \[\];/.test(execS) &&
	/porConstrutor\[bt\]\.quantos\+\+;/.test(execS));
check("usa GetBuilders, a mesma chamada que o censo de armazéns já fazia",
	/cmpFnd\.GetBuilders/.test(execS));
check("com id de desempate estável quando um construtor troca pelo outro",
	/if \(b < porConstrutor\[bt\]\.id\) porConstrutor\[bt\]\.id = b;/.test(execS));
// Construtor não progride — quem progride é a obra.
check("construtor não inventa progresso",
	/"tipo": "construtor",[\s\S]{0,200}"progresso": 0/.test(execS));
check("e o painel não escreve 0% nele",
	/lbl\.caption = o\.tipo === "construtor"\s*\n\s*\? nome\s*\n\s*: nome \+ "  " \+ Math\.round/.test(execP));
check("nem desenha a barra vazia, que sugeriria progresso parado em zero",
	/if \(barBg\) barBg\.hidden = o\.tipo === "construtor";/.test(execP) &&
	/if \(bar\) bar\.hidden = o\.tipo === "construtor";/.test(execP));

check("a ordem dos grupos é obra, construtor, treino",
	/const ordemTipo = \{ "obra": 0, "construtor": 1, "treino": 2 \};/.test(execS));
check("e entre construtores vence o tipo mais numeroso",
	/if \(a\.tipo === "construtor" && a\.quantos !== b\.quantos\) return b\.quantos - a\.quantos;/.test(execS));

function ordenar3(obras) {
	const ordemTipo = { "obra": 0, "construtor": 1, "treino": 2 };
	return obras.slice().sort(function(a, b) {
		if (a.tipo !== b.tipo) return ordemTipo[a.tipo] - ordemTipo[b.tipo];
		if (a.tipo === "construtor" && a.quantos !== b.quantos) return b.quantos - a.quantos;
		if (a.progresso !== b.progresso) return b.progresso - a.progresso;
		return a.id - b.id;
	}).map(o => o.tipo[0] + (o.quantos || 0));
}
const CENA = [
	{ tipo: "treino", id: 1, progresso: 0.5, quantos: 3 },
	{ tipo: "construtor", id: 2, progresso: 0, quantos: 2 },
	{ tipo: "obra", id: 3, progresso: 0.55, quantos: 4 },
	{ tipo: "construtor", id: 4, progresso: 0, quantos: 7 }
];
check("os três grupos saem na ordem certa, com o construtor maior na frente",
	ordenar3(CENA).join() === "o4,c7,c2,t3", ordenar3(CENA).join());

// Três grupos precisam caber: com poucas linhas o último nunca aparece. (O número de linhas
// é lido mais abaixo, na seção da tela — aqui basta a regra de que são três grupos.)
check("são três grupos, e a ordem entre eles é fixa",
	/const ordemTipo = \{ "obra": 0, "construtor": 1, "treino": 2 \};/.test(execS));

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
// 06/09, assistindo: "o estimador de batalha nao ta funcionando", e a Proporção de Unidades
// dizendo "Nada para treinar ainda" com a base inteira produzindo. Os dois só leem e
// desenham, e estavam abaixo do return.
const iComb = execP.indexOf("pudim_RefreshCombat();", iBarra);
check("o estimador de combate também é atualizado antes da trava",
	iComb > 0 && iComb < iTrava, "estimador em " + iComb + ", trava em " + iTrava);
const iUni = execP.indexOf("pudim_AtualizarUnidades(); } catch(e) {}");
check("e a lista da proporção de unidades também",
	iUni > 0 && iUni < iTrava, "lista em " + iUni + ", trava em " + iTrava);
check("e a razão está escrita, para ninguém 'arrumar' movendo de volta",
	/leitura em cima, comando embaixo/.test(panel));
check("some quando não há obra, como o indicador de pesquisa do jogo",
	/painel\.hidden = obras\.length === 0;/.test(execP));
check("o retrato usa o caminho conferido no disco",
	/"stretched:session\/portraits\/" \+ icone/.test(execP));
// Sem ícone no template, melhor nada do que um quadrado quebrado.
check("template sem ícone não vira sprite quebrado",
	/icone \? "stretched:session\/portraits\/" \+ icone : "color: 0 0 0 0"/.test(execP));
check("o selo mostra o número: construtores na obra, ou unidades na fila",
	/selo\.caption = String\(o\.quantos\);/.test(execP));
// O mesmo "4" quer dizer três coisas diferentes na mesma coluna — construtores na obra,
// unidades daquele tipo construindo, unidades na fila. A cor é o que separa.
check("e a cor do selo diz o que o número significa, nos três casos",
	/seloBg\.sprite = o\.tipo === "treino" \? "color: 40 80 140 230"\s*\n\s*: \(o\.tipo === "construtor" \? "color: 70 90 110 230" : "color: 40 120 50 230"\);/.test(execP));
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
// São três grupos disputando as linhas (obra, construtor, treino). Com poucas, o último
// nunca aparece — foi o defeito relatado duas vezes.
check("e há linhas bastantes para os três grupos caberem",
	LINHAS >= 6, LINHAS + " linhas para 3 grupos");
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
