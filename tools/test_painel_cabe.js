/**
 * O painel tem de caber na tela, e as opções têm de estar em português.
 *
 * Em 25/08 o jogador não achou a seção de construção em série que eu tinha acabado de
 * adicionar. Ela existia e funcionava — só estava **abaixo da borda inferior do monitor**.
 *
 * O painel ia até `50%+642`, cerca de 1156 px de altura. A tela dele tem 1067. Pior: ele já
 * passava 16 px da borda ANTES da minha mudança, então a dica do Conselheiro vinha cortada
 * ao meio e ninguém tinha notado. Eu acrescentei 92 px a algo que já não cabia.
 *
 * Nada no código dizia isso. Um `size` em XML é aceito com qualquer número, o jogo desenha
 * o que couber e cala sobre o resto — é exatamente o tipo de erro que só aparece quando
 * alguém procura um botão e não acha. Este teste faz a conta.
 *
 * A solução veio do jogador: mover os interruptores de liga/desliga para Menu > Opções >
 * PudimMod, onde cada um pode ter explicação de verdade. Isso liberou ~370 px e resolveu
 * dois problemas de uma vez, porque as opções também estavam metade em inglês
 * ("Smart Dropsites", "Auto-Retreat", "Smart Focus Fire") num jogo em pt-BR.
 *
 * Rodar:  node tools/test_painel_cabe.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("o painel cabe na tela");

// ── A conta ────────────────────────────────────────────────────────────────────────────
// O painel é ancorado em 50%-514, então numa tela de altura H ele começa em H/2-514 e a
// borda inferior da tela cai em y = H - (H/2 - 514) nas coordenadas do painel.
//
// 1067 é a resolução real do monitor do jogador (system_info.txt: 1707x1067). Um monitor
// menor apertaria mais, mas este é o caso que de fato quebrou, e um teste que fixa o caso
// real vale mais que um limite inventado.
const TELA = 1067;
const ANCORA_TOPO = 514;
const CORTE = TELA - (Math.floor(TELA / 2) - ANCORA_TOPO);

const itens = [];
const re = /<object name="([^"]+)"[^>]*size="([^"]+)"/g;
let m;
while ((m = re.exec(xml)) !== null) {
	const p = m[2].split(/\s+/);
	if (p.length !== 4) continue;
	const y1 = Number(p[1]), y2 = Number(p[3]);
	if (!Number.isFinite(y1) || !Number.isFinite(y2)) continue;
	itens.push({ nome: m[1], y1, y2 });
}
check("o XML tem objetos posicionados para medir", itens.length > 20, itens.length);

const foraDaTela = itens.filter(i => i.y2 > CORTE);
check("nenhum objeto do painel cai fora da tela",
	foraDaTela.length === 0, foraDaTela.map(i => i.nome + " (até " + i.y2 + ")").join(", "));

const fim = Math.max(...itens.map(i => i.y2));
check("e sobra folga real, não passa raspando", CORTE - fim >= 40,
	"fim=" + fim + ", corte=" + CORTE + ", folga=" + (CORTE - fim));

// A altura declarada do painel tem de acompanhar o conteúdo: painel curto demais corta, e
// painel longo demais desenha moldura sobre o jogo sem nada dentro.
const alturaDeclarada = +/50%-514 100%-20 50%\+(\d+)"/.exec(xml)[1] + ANCORA_TOPO;
check("a altura declarada cobre o conteúdo", alturaDeclarada >= fim,
	"declarada=" + alturaDeclarada + " conteudo=" + fim);
check("sem sobra exagerada de moldura vazia", alturaDeclarada - fim <= 60,
	alturaDeclarada - fim);
check("e o JS usa a MESMA altura do XML (ele reescreve o size ao expandir)",
	panel.indexOf("50%+" + (alturaDeclarada - ANCORA_TOPO)) > 0,
	"50%+" + (alturaDeclarada - ANCORA_TOPO));

// O caso concreto: a seção que o jogador não achou.
const serie = itens.filter(i => i.nome.indexOf("pudim_quartel") === 0);
check("a seção de construção em série existe", serie.length >= 4, serie.length);
check("e está visível — foi ela que sumiu da tela",
	serie.every(i => i.y2 <= CORTE),
	serie.map(i => i.nome + ":" + i.y2).join(" "));

// Sem sobreposição: dois botões no mesmo y é clique roubado.
const ordenados = itens.slice().sort((a, b) => a.y1 - b.y1);
const sobrepostos = [];
for (let i = 0; i < ordenados.length; i++)
	for (let j = i + 1; j < ordenados.length; j++) {
		const a = ordenados[i], b = ordenados[j];
		if (b.y1 >= a.y2) break;
		// Sobreposição deliberada: fundo que pisca, rótulo dentro de botão, e os pares
		// lado a lado (mesma faixa de y, colunas diferentes).
		if (a.nome.indexOf("Flash") >= 0 || b.nome.indexOf("Flash") >= 0) continue;
		if (a.y1 === b.y1 && a.y2 === b.y2) continue;
		if (a.nome.indexOf("Bg") >= 0 || b.nome.indexOf("Bg") >= 0) continue;
		// A barra de titulo: o titulo fica na moldura (y negativo) e os tres botoes nos
		// cantos. Eles convivem de proposito e nao disputam clique.
		if (a.nome === "pudim_header" || b.nome === "pudim_header") continue;
		sobrepostos.push(a.nome + " x " + b.nome);
	}
check("nenhum objeto se sobrepõe por acidente",
	sobrepostos.length === 0, sobrepostos.slice(0, 4).join(", "));

// ── Os interruptores saíram do painel ──────────────────────────────────────────────────
console.log("\nos interruptores foram para as opcoes");

const saidos = ["pudim_toggleCombatBtn", "pudim_toggleBarterBtn", "pudim_toggleDropsitesBtn",
                "pudim_toggleRetreatBtn", "pudim_toggleFocusBtn", "pudim_toggleGarrisonBtn",
                "pudim_toggleDebugBtn", "pudim_togglePanicBtn", "pudim_toggleCounterTrainBtn",
                "pudim_toggleAutoQueueBtn"];
for (const n of saidos)
	check("o botão " + n.replace("pudim_toggle", "").replace("Btn", "") + " saiu do painel",
		xml.indexOf('name="' + n + '"') < 0);

// A função que atualizava os rótulos continua existindo e não pode explodir sem eles.
check("o atualizador de rótulos usa TryGet, então não quebra sem os botões",
	/const obj = Engine\.TryGetGUIObjectByName\(cfg\.labelId\);/.test(panel));

// Auto-Casas FICA no painel: é um ciclador que reinicia a cada partida de propósito, então
// é decisão da partida e não configuração permanente.
check("Auto-Casas continua no painel — é decisão da partida, não configuração",
	xml.indexOf('name="pudim_toggleAutoHouseBtn"') > 0 &&
	/Sem persistência: toda partida recomeça no padrão 5/.test(panel));
check("e o painel diz onde os interruptores foram parar",
	xml.indexOf('name="pudim_optionsHint"') > 0);

// ── As opções: pt-BR e explicação de verdade ───────────────────────────────────────────
console.log("\nas opcoes, em pt-BR e explicadas");

const lista = opts[0].options;
check("todas as opções têm rótulo, dica e chave de configuração",
	lista.every(o => o.label && o.tooltip && o.config), lista.length);
check("todos os interruptores que saíram do painel estão nas opções",
	["combat", "retreat", "focus", "garrison", "panic", "countertrain",
	 "dropsites", "barter", "autoqueue"].every(k =>
		lista.some(o => o.config === "pudim.advanced." + k)));
check("inclusive as mensagens de debug, com a chave certa",
	lista.some(o => o.config === "pudim.debug.show"));
check("a chave de debug é a que o painel realmente lê",
	/Engine\.ConfigDB_GetValue\("user", "pudim\.debug\.show"\)/.test(panel));

// Cada chave declarada nas opções tem de ser lida em algum lugar, senão o jogador mexe num
// controle que não faz nada.
const semUso = lista.filter(o => panel.indexOf('"' + o.config + '"') < 0);
check("nenhuma opção aponta para uma chave que ninguém lê",
	semUso.length === 0, semUso.map(o => o.config).join(", "));

// O jogo do jogador é pt-BR. "Smart Dropsites", "Auto-Retreat" e "Smart Focus Fire" estavam
// em inglês no painel; nas opções isso não pode se repetir.
const INGLES = ["Smart ", "Auto-Retreat", "Focus Fire", "Counter-Train", "Dropsites",
                "Enabled", "Settings", "Toggle", "Threshold"];
const comIngles = [];
for (const o of lista)
	for (const t of INGLES)
		if (o.label.indexOf(t) >= 0) comIngles.push(o.label + " <- " + t);
check("nenhum rótulo em inglês", comIngles.length === 0, comIngles.slice(0, 3).join(" | "));

// Explicação de verdade, não repetição do rótulo.
const curtas = lista.filter(o => o.tooltip.length < 90);
check("toda dica explica de fato — nada com menos de 90 caracteres",
	curtas.length === 0, curtas.map(o => o.config).join(", "));
const repetidas = lista.filter(o =>
	o.tooltip.toLowerCase().indexOf(o.label.replace(/\[[^\]]*\]/g, "").trim().toLowerCase()) === 0);
check("e nenhuma dica é só o rótulo repetido", repetidas.length === 0,
	repetidas.map(o => o.config).join(", "));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
