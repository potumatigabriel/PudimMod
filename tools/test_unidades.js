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
// GetEntitiesList vive em IID_Trainer, NAO em IID_ProductionQueue. Na 0.28 a producao foi
// dividida: ProductionQueue cuida da fila, Trainer sabe o que da para treinar. Eu escrevi
// ProductionQueue e a lista veio vazia — o painel dizia "Nada para treinar ainda" com o
// centro civico enfileirando aldeas na tela.
check("e pergunta ao Trainer, que e quem sabe o que da para treinar",
	/cmpTrainer\.GetEntitiesList\(\)/.test(sim));
check("a FILA continua vindo de ProductionQueue — a divisao e essa",
	/const cmpPQ = Engine\.QueryInterface\(ent, IID_ProductionQueue\);[\s\S]{0,120}?cmpPQ\.GetQueue\(\)/.test(sim));
check("e o centro civico entra junto, como o jogador pediu",
	/O CENTRO CIVICO entra por aqui/.test(sim));

// SÓ O QUE DÁ PARA TREINAR AGORA. Trainer.GetEntitiesList devolve TUDO que o edifício pode
// treinar algum dia: CalculateEntitiesMap só trata substituição de civ e templates
// desabilitados, não fase nem tecnologia. Quem cinza o botão na interface do jogo é
// AreRequirementsMet, e era ela que faltava — o jogador via campeão na lista aos cinco
// minutos e ajustava uma proporção que não ia sair.
check("a lista é filtrada por requisito atendido",
	/Engine\.GuiInterfaceCall\("AreRequirementsMet",/.test(panel));
check("usando template.requirements, como a interface do jogo faz",
	/"requirements": td\.requirements, "player": jogador/.test(panel));
check("e na dúvida MOSTRA — esconder demais é pior que mostrar demais",
	/catch \(e\) \{ return true; \}/.test(panel));
check("AreRequirementsMet foi auditada no teste de multiplayer",
	fs.readFileSync(path.join(base, "tools", "test_mp_safety.js"), "utf8")
		.indexOf('"AreRequirementsMet"') > 0);

// NOME TRADUZIDO E SEM AMBIGUIDADE. Eu lia Identity.GenericName do template CRU, que é o
// texto-fonte em inglês; e nomes genéricos SE REPETEM de propósito no 0 A.D. (várias
// unidades romanas se chamam "Plebeu"), então duas linhas iguais apareciam na tela.
check("o nome vem de GetTemplateData, que é traduzido",
	/const td = GetTemplateData\(u\.tpl\);/.test(panel) &&
	/td\.name\.generic/.test(panel));
check("e o específico entra quando o genérico se repete",
	/nomes\[u\.nomeGenerico\] > 1 && u\.nomeEspecifico/.test(panel));
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

// ── Lote de treino ─────────────────────────────────────────────────────────────────────
//
// "sempre treine em lotes, se tiver recursos, assim a proporção tempo/unidades é mais
//  rapido. faça o tamanho do lote de treinamento proporcional a quantidade de locais que
//  podem treinar e a quantidade de recursos disponiveis"
//
// O ganho é real e está no motor: Trainer.GetBatchTime devolve `batchSize ^
// BatchTimeModifier`, com o modificador em 0.7 por padrão
// (simulation/components/Trainer.js). O tempo POR UNIDADE cai como N^-0,3.
console.log("");
console.log("lote de treino");

const MOD = 0.7;   // BatchTimeModifier padrão do motor
const porUnidade = n => Math.pow(n, MOD) / n;

check("o lote de 2 já é ~19% mais rápido por unidade",
	Math.abs(porUnidade(2) - 0.81) < 0.01, porUnidade(2).toFixed(2));
check("o de 5, ~38%", Math.abs(porUnidade(5) - 0.62) < 0.01, porUnidade(5).toFixed(2));
check("o de 10, ~50%", Math.abs(porUnidade(10) - 0.50) < 0.01, porUnidade(10).toFixed(2));
check("e o ganho é sempre decrescente — cada unidade a mais rende menos",
	[2, 3, 5, 8, 10].every((n, i, a) =>
		i === 0 || (porUnidade(n) < porUnidade(a[i - 1]) &&
		            porUnidade(a[i - 1]) - porUnidade(n) < 0.2)));

const TETO = +/const PUDIM_LOTE_MAX = (\d+);/.exec(panel)[1];
check("existe teto para o lote", TETO >= 5 && TETO <= 20, TETO);
// O lote inteiro só ENTREGA quando termina: um lote de 20 segura a primeira unidade por
// 8,14 tempos de treino. E tranca recursos que as fazendas podem precisar.
check("o teto mantém a espera pela primeira unidade sob controle",
	Math.pow(TETO, MOD) <= 6, Math.pow(TETO, MOD).toFixed(2));
check("o porquê do teto está escrito, não é número solto",
	/o lote inteiro só ENTREGA quando termina/i.test(panel) ||
	/só ENTREGA quando termina/.test(panel));

// A regra, espelhada.
function lote(cabe, numEdificios) {
	return Math.max(1, Math.min(TETO, Math.floor(cabe / Math.max(1, numEdificios))));
}
check("com recursos de sobra e um edifício, vai no teto", lote(40, 1) === TETO);
check("o estoque é dividido entre os edifícios que treinam",
	lote(12, 4) === 3, lote(12, 4));
check("sem recursos, o lote é 1 — nunca zero, senão nada é treinado",
	lote(0, 3) === 1, lote(0, 3));
check("um edifício a mais reduz o lote de cada um",
	lote(20, 2) > lote(20, 5));
check("e nunca passa do teto, por mais recurso que haja", lote(9999, 1) === TETO);

check("o lote sai de pudim_ComputeAffordableCount, não de um palpite",
	/pudim_ComputeAffordableCount\(template, PUDIM_LOTE_MAX, res \|\| \{\}\)/.test(panel));
// res já vem com a madeira das fazendas descontada, então o lote cede sozinho quando a
// comida está atrasada — sem precisar saber que a regra existe.
check("e respeita a reserva das fazendas sem saber que ela existe",
	/res\.wood = Math\.max\(0, \(\+res\.wood \|\| 0\) - g_PudimMadeiraReservada\);/.test(panel));

// ── Zerado não faz nada; configurado se sobrepõe ───────────────────────────────────────
check("há uma chave para 'a proporção está ativa'",
	/function pudim_ProporcaoAtiva\(\)/.test(panel));
check("com tudo zerado ela é falsa",
	/for \(const tpl in g_PudimUnitPesos\)[\s\S]{0,40}?if \(g_PudimUnitPesos\[tpl\] > 0\) return true;/.test(panel));
check("o lote só entra com a proporção ativa",
	/if \(!g_PudimPlayerQueueCount\[b\.ent\] && pudim_ProporcaoAtiva\(\)\)/.test(panel));
check("e o que o jogador enfileirou naquele edifício continua vindo antes",
	/g_PudimPlayerQueueCount\[b\.ent\] \|\|/.test(panel));
check("os pesos começam todos em zero",
	/var g_PudimUnitPesos = \{\};/.test(panel));

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
