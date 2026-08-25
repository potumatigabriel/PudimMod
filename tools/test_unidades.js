/**
 * Proporção de unidades, e o estimador que colapsa.
 *
 * Pedidos de 25/08:
 *
 *   "faz um pra construir automaticamente unidades... pra balancear elas... ai a gente
 *    coloca as proporções, tem que aparecer na lista todas que estão disponíveis no momento,
 *    elas vão mudar conforme o jogo andar, construir quarteis, estabulos, passar de fase,
 *    liberar campeões e etc"
 *
 *   "estimador de combate deixar compactado, e ao clicar no titulo expande e ao clicar de
 *    novo colapsa"
 *
 * "no momento" é o que decide o desenho do balanceador. Uma lista fixa de tipos estaria
 * errada em toda partida: cada civilização treina coisas diferentes, o quartel libera um
 * conjunto, o estábulo outro, e a fase libera campeão. A lista não é escrita no código — é
 * perguntada aos edifícios de pé, via ProductionQueue.GetEntitiesList(), que é a mesma fonte
 * que a interface do próprio jogo usa para desenhar os botões de treino.
 *
 * E o estimador ocupava 182px do painel o tempo todo — mais que qualquer outra seção — para
 * um número que fica em zero na maior parte da partida.
 *
 * Rodar:  node tools/test_unidades.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("proporcao de unidades");

// ── A lista é perguntada, não escrita ──────────────────────────────────────────────────
check("a simulação expõe o que dá para treinar",
	/GuiInterface\.prototype\.pudim_GetTrainableUnits/.test(sim) &&
	/"pudim_GetTrainableUnits": 1/.test(sim));
check("e pergunta aos edifícios, pela API do motor",
	/cmpPQ\.GetEntitiesList\(\)/.test(sim));
check("fundação não conta — ela ainda não treina nada",
	/if \(Engine\.QueryInterface\(ent, IID_Foundation\)\) continue;[\s\S]{0,120}?_dbg\.edificios/.test(sim));
check("o que já está na fila conta como 'vai existir'",
	/porTpl\[item\.unitTemplate\]\.emFila \+= \(item\.count \|\| 1\)/.test(sim));
// Unidade promovida muda de template (sufixo _a/_b/_e), então contar por igualdade exata
// deixaria de fora justamente as veteranas.
check("unidade promovida ainda é contada como do tipo",
	/replace\(\/_\[abe\]\$\/, ""\)/.test(sim));
check("a ordem da lista é estável",
	/result\.unidades\.sort\(function\(a, b\) \{ return a\.tpl < b\.tpl/.test(sim));

// ── A interface ────────────────────────────────────────────────────────────────────────
const LINHAS = +/const PUDIM_UNIT_LINHAS = (\d+);/.exec(panel)[1];
check("há linhas fixas no XML para preencher", LINHAS >= 5, LINHAS);
for (let i = 0; i < LINHAS; i++)
	check("a linha " + i + " existe completa no XML",
		["Label", "Minus", "Val", "Plus"].every(parte =>
			xml.indexOf('name="pudim_unit' + parte + i + '"') > 0));
check("as linhas nascem escondidas — a lista é dinâmica",
	(xml.match(/name="pudim_unit(Label|Minus|Val|Plus)\d"[^>]*hidden="true"/g) || []).length >= LINHAS * 4);
check("e o JS as mostra conforme o que existe",
	/function pudim_DesenharUnidades\(\)/.test(panel) &&
	/o\.hidden = !mostra/.test(panel));
check("há mensagem para quando não há nada a treinar",
	xml.indexOf('name="pudim_unitVazio"') > 0 &&
	/vazio\.hidden = g_PudimUnitLista\.length > 0/.test(panel));
// Sem número na tela, o jogador ajusta a proporção sem saber o que já tem.
check("o rótulo mostra quantas já existem",
	/lbl\.caption = u\.nome \+ " \(" \+ u\.existentes \+ "\)"/.test(panel));
check("a lista é relida periodicamente, porque muda durante a partida",
	/g_PudimUnitAccum >= (\d+)/.test(panel) && /pudim_AtualizarUnidades\(\)/.test(panel));

// Cabem 7 linhas; com mais tipos, esconder o que o jogador configurou seria o pior corte.
check("com mais tipos que linhas, os pesados aparecem primeiro",
	/if \(pa !== pb\) return pb - pa;/.test(panel));

// ── A conta da proporção ───────────────────────────────────────────────────────────────
// Espelha pudim_UnidadeMaisAtrasada: peso é fatia, não quantidade.
function maisAtrasada(us, pesos) {
	const pesadas = us.filter(u => (pesos[u.tpl] || 0) > 0);
	if (!pesadas.length) return null;
	let somaPeso = 0, total = 0;
	for (const u of pesadas) { somaPeso += pesos[u.tpl]; total += u.existentes + u.emFila; }
	if (somaPeso <= 0) return null;
	const b = Math.max(total, 1);
	let melhor = null, maior = -Infinity;
	for (const u of pesadas) {
		const falta = b * (pesos[u.tpl] / somaPeso) - (u.existentes + u.emFila);
		if (falta > maior || (Math.abs(falta - maior) < 0.001 && melhor &&
		    pesos[u.tpl] > pesos[melhor.tpl])) { maior = falta; melhor = u; }
	}
	return melhor;
}
const U = (tpl, ex, fila) => ({ tpl: tpl, existentes: ex, emFila: fila || 0 });

check("sem peso nenhum, o mod não escolhe exército pelo jogador",
	maisAtrasada([U("lanceiro", 0), U("arqueiro", 0)], {}) === null);
check("com um só pesado, é sempre ele",
	maisAtrasada([U("lanceiro", 5), U("arqueiro", 0)], { lanceiro: 3 }).tpl === "lanceiro");
check("do zero, sai primeiro o de maior peso",
	maisAtrasada([U("lanceiro", 0), U("arqueiro", 0)],
		{ lanceiro: 3, arqueiro: 1 }).tpl === "lanceiro");
// 3 lanceiros para 1 arqueiro: com 3 e 0, o arqueiro está atrás da sua fatia.
check("com 3 lanceiros e 0 arqueiros na proporção 3:1, vem o arqueiro",
	maisAtrasada([U("lanceiro", 3), U("arqueiro", 0)],
		{ lanceiro: 3, arqueiro: 1 }).tpl === "arqueiro");
check("e depois volta ao lanceiro",
	maisAtrasada([U("lanceiro", 3), U("arqueiro", 1)],
		{ lanceiro: 3, arqueiro: 1 }).tpl === "lanceiro");
// A FILA CONTA. Sem isso o mod pediria a mesma unidade a cada ciclo enquanto a primeira
// ainda nem saiu, e a proporção nunca sairia do lugar.
check("o que já está na fila conta como existente",
	maisAtrasada([U("lanceiro", 3), U("arqueiro", 0, 1)],
		{ lanceiro: 3, arqueiro: 1 }).tpl === "lanceiro");
check("peso zero nunca é escolhido",
	maisAtrasada([U("lanceiro", 99), U("arqueiro", 0)],
		{ lanceiro: 3, arqueiro: 0 }).tpl === "lanceiro");

// ── Onde ela entra na auto-fila ────────────────────────────────────────────────────────
// A ordem importa e já custou caro: o jogador pôs 5 guerreiros e voltavam 2 aldeões.
const iJogador = panel.indexOf("let template = g_PudimPlayerQueueTpl[b.ent] || null;");
const iProporcao = panel.indexOf("const atrasada = pudim_UnidadeMaisAtrasada();");
const iPalpite = panel.indexOf("const trainerEnts = b.trainerEntities || [];");
check("a escolha do jogador vem primeiro", iJogador > 0 && iJogador < iProporcao);
check("a proporção vem depois dela", iProporcao > 0 && iProporcao < iPalpite);
check("e o palpite antigo fica por último", iPalpite > 0);
// Pedir cavalaria num quartel faz o motor recusar em silêncio e a fila fica parada.
check("só escolhe unidade que AQUELE edifício treina",
	/\(b\.trainerEntities \|\| \[\]\)\.indexOf\(atrasada\.tpl\) >= 0/.test(panel));
check("e respeita o teto de mulheres",
	/if \(!\(atFemaleCap && isFemaleTemplate\(atrasada\.tpl\)\)\)/.test(panel));

// ── Estimador colapsável ───────────────────────────────────────────────────────────────
console.log("\nestimador que colapsa");

check("o título virou botão",
	/name="pudim_combatHeader" type="button"/.test(xml) &&
	/pudim_ToggleCombatBox\(\);/.test(xml));
check("nasce colapsado", /var g_PudimCombatAberto = false;/.test(panel));
check("o miolo some quando colapsado",
	/const PUDIM_COMBAT_MIOLO = \[/.test(panel) &&
	/o\.hidden = !g_PudimCombatAberto/.test(panel));
check("e tudo abaixo sobe junto",
	/const PUDIM_ABAIXO_DO_COMBATE = \[/.test(panel) &&
	/sz\.top = b\.top \+ desloca/.test(panel));
check("o painel encolhe junto, sem moldura vazia sobre o mapa",
	/sz\.bottom = g_PudimPainelBaseBottom \+ desloca/.test(panel));
check("o título mostra a seta do estado", /"▼ " : "▶ "/.test(panel));

// O size do motor é um objeto VIVO (gui/hotkeys/HotkeyPicker.js lê .size e escreve .top sem
// reatribuir). Guardar a referência faria a tabela de base mudar junto com o primeiro
// deslocamento, e o segundo clique somaria em cima do valor já deslocado.
check("a tabela de posições guarda NÚMEROS, não o objeto size",
	/g_PudimYBase\[nome\] = \{ top: o\.size\.top, bottom: o\.size\.bottom \}/.test(panel));
check("e o porquê está escrito", /O `size` devolvido pelo motor e VIVO/.test(panel));

// Todo objeto abaixo do estimador tem de estar na lista, senão fica para trás ao colapsar.
const naLista = (/const PUDIM_ABAIXO_DO_COMBATE = \[([\s\S]*?)\];/.exec(panel)[1]
	.match(/"pudim_\w+"/g) || []).map(s => s.replace(/"/g, ""));
const doXml = [];
const re2 = /<object name="(pudim_\w+)"[^>]*size="([^"]+)"/g;
let m2;
while ((m2 = re2.exec(xml)) !== null) {
	const p = m2[2].split(/\s+/);
	if (p.length !== 4) continue;
	const y1 = Number(p[1]);
	if (Number.isFinite(y1) && y1 >= 236) doXml.push(m2[1]);
}
const faltando = doXml.filter(n => naLista.indexOf(n) < 0);
check("nenhum objeto abaixo do estimador ficou fora da lista",
	faltando.length === 0, faltando.join(", "));

// ── O conselheiro saiu ─────────────────────────────────────────────────────────────────
check("o Conselheiro Estratégico saiu do painel",
	xml.indexOf("pudim_counselorHeader") < 0 && xml.indexOf("pudim_counselorTip") < 0);
check("e ninguém tenta mais escrever nele",
	panel.indexOf("pudim_ProcessCounselor();") < 0);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
