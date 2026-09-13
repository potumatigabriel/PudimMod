/**
 * O XML do painel tem de ser XML válido — e ninguém conferia isso.
 *
 * Em 06/09 eu adicionei a vaga do curral e o objeto foi parar DEPOIS do </object> raiz, fora
 * da árvore. O painel inteiro deixou de carregar: no jogo do usuário, em partida online,
 * apareceu uma cortina de erro vermelho por cima da tela —
 *
 *   Failed to get GUI object by name: object 'pudim_quartelBtnLabel' not found
 *
 * repetida a cada tique, e nenhum controle do mod na tela.
 *
 * A suíte tinha 46 testes e passou tudo. test_painel_cabe.js mede POSIÇÕES lendo o XML com
 * regex — regex não repara em estrutura, então um objeto fora da raiz passa batido. É a
 * mesma classe de erro dos testes que liam o próprio comentário: verificar o que é fácil de
 * ler em vez do que precisa estar certo.
 *
 * Este teste faz o que o motor faz: tenta montar a árvore.
 *
 * Rodar:  node tools/test_xml_valido.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("todo XML do mod e XML valido");

/**
 * Analisador mínimo, só o que importa aqui: as tags fecham na ordem certa, e nada sobra
 * depois do elemento raiz. Não usa biblioteca — o mod não tem dependências, e adicionar uma
 * para rodar um teste seria pior que escrever estas trinta linhas.
 */
function analisar(txt) {
	const pilha = [];
	let raizFechada = false;
	// COMENTÁRIO NÃO PODE CONTER "--".
	//
	// É regra do XML (a especificação proíbe "--" dentro de um comentário), e o motor a
	// aplica: em 07/09 um travessão que eu escrevi como "--" derrubou o arquivo inteiro —
	//
	//   Parse error: 06_pudim_obras.xml:21: Comment must not contain '--' (double-hyphen)
	//   Failed to parse XML file ... GUI: Error reading included XML
	//
	// e o indicador simplesmente não existia na tela. Passei três rodadas procurando o
	// motivo no JS, com o defeito no comentário.
	//
	// Este teste existia e não pegou, porque PULAVA os comentários em vez de validá-los —
	// verificou o que era fácil de checar, não o que o motor exige. Mesma classe de erro dos
	// testes que liam o próprio comentário e do regex que mediu posição sem ver estrutura.
	for (const c of (txt.match(/<!--[\s\S]*?-->/g) || []))
		if (c.slice(4, -3).indexOf("--") >= 0)
			return 'comentário com "--" (proibido em XML): ' +
			       c.slice(0, 60).replace(/\s+/g, " ") + "...";

	const re = /<\?[\s\S]*?\?>|<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\/?([A-Za-z_][\w.:-]*)((?:[^>"']|"[^"]*"|'[^']*')*?)(\/?)>/g;
	let m;
	while ((m = re.exec(txt))) {
		const inteiro = m[0];
		if (inteiro.startsWith("<?") || inteiro.startsWith("<!--") || inteiro.startsWith("<![CDATA[")) continue;
		const nome = m[1];
		const fechaSozinha = m[3] === "/";
		if (inteiro.startsWith("</")) {
			if (!pilha.length) return "fechou </" + nome + "> sem abrir";
			const topo = pilha.pop();
			if (topo !== nome) return "esperava </" + topo + "> e veio </" + nome + ">";
			if (!pilha.length) raizFechada = true;
		} else if (!fechaSozinha) {
			if (raizFechada) return "elemento <" + nome + "> DEPOIS do fechamento da raiz";
			pilha.push(nome);
		} else {
			if (raizFechada) return "elemento <" + nome + "/> DEPOIS do fechamento da raiz";
			// Raiz que fecha em si mesma (<a/>) também é uma raiz.
			if (!pilha.length) raizFechada = true;
		}
	}
	if (pilha.length) return "ficou aberto: " + pilha.join(" > ");
	// Arquivo só com declaração e comentário é legítimo: dois deles ficaram assim de
	// propósito quando a barra de aliados mudou de lugar. Vazio não é malformado.
	return null;
}

// O próprio analisador tem de reprovar o caso que passou batido.
const QUEBRADO = '<?xml version="1.0"?>\n<object name="raiz">\n  <object name="a"/>\n</object>\n' +
                 '  <object name="fora"/>\n';
check("o analisador pega objeto depois da raiz — o erro exato de 06/09",
	analisar(QUEBRADO) !== null, analisar(QUEBRADO));
check("e aprova o mesmo conteúdo com o objeto DENTRO",
	analisar('<?xml version="1.0"?>\n<object name="raiz">\n  <object name="a"/>\n  <object name="fora"/>\n</object>\n') === null);
check("pega tag fechada fora de ordem",
	analisar("<a><b></a></b>") !== null);
check("pega tag que ficou aberta",
	analisar("<a><b></b>") !== null);
check("e não se engana com comentário nem declaração",
	analisar('<?xml version="1.0"?>\n<!-- <object name="isto e comentario"> -->\n<a/>') === null);
// O erro exato de 07/09, que derrubou o arquivo inteiro e me custou três rodadas.
check('pega "--" dentro de comentário — a regra que o motor aplica',
	analisar('<?xml version="1.0"?>\n<!-- abriu -- fechou -->\n<a/>') !== null,
	analisar('<?xml version="1.0"?>\n<!-- abriu -- fechou -->\n<a/>'));
check("e não confunde com o fechamento normal do comentário",
	analisar('<?xml version="1.0"?>\n<!-- comentario normal -->\n<a/>') === null);
check("nem com hífen simples, que é permitido",
	analisar('<?xml version="1.0"?>\n<!-- meia-noite, bem-vindo -->\n<a/>') === null);

// ── Os arquivos de verdade ─────────────────────────────────────────────────────────────
function xmls(dir, achados) {
	for (const nome of fs.readdirSync(dir)) {
		const p = path.join(dir, nome);
		const st = fs.statSync(p);
		if (st.isDirectory()) xmls(p, achados);
		else if (nome.endsWith(".xml")) achados.push(p);
	}
	return achados;
}
const arquivos = xmls(path.join(base, "gui"), []);
check("achou os XML da interface", arquivos.length > 0, arquivos.length + " arquivo(s)");

for (const f of arquivos) {
	const erro = analisar(fs.readFileSync(f, "utf8"));
	check(path.relative(base, f).replace(/\\/g, "/") + " é XML bem formado", erro === null, erro);
}

// ── E todo objeto referenciado pelo JS existe no XML ───────────────────────────────────
// O erro na tela do jogador foi um nome não encontrado. Conferir os nomes fecha o outro
// lado do mesmo buraco: XML válido mas sem o objeto que o JS procura.
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xmlTxt = arquivos.map(f => fs.readFileSync(f, "utf8")).join("\n");

const usados = new Set();
const reUso = /(?:Try)?GetGUIObjectByName\("([^"]+)"\)/g;
let u;
while ((u = reUso.exec(panel))) usados.add(u[1]);
// Nomes montados por concatenação ("pudim_unitLabel" + i) não dá para conferir assim.
// Objetos do JOGO BASE, que por definição não estão nos XML do mod. `session` é a raiz da
// tela de partida, e é de onde sai o tamanho da janela — mesmo caminho que o autociv usa em
// gui/session/autociv_minimapExpand.js ("sessionPanel.getComputedSize()"). Só entram aqui
// nomes conferidos em código instalado, nunca supostos.
const DO_JOGO_BASE = ["session"];
const faltando = [...usados]
	.filter(n => DO_JOGO_BASE.indexOf(n) < 0)
	.filter(n => xmlTxt.indexOf('name="' + n + '"') < 0).sort();
// Estes quatro já não existiam quando este teste nasceu (06/09): são referências mortas a
// objetos removidos em limpezas antigas. Não quebram nada — todas usam TryGet e têm guarda —
// mas significam caminho de código morto, e o do conselheiro merece uma olhada.
// Ficam FIXADOS aqui para que uma referência morta NOVA reprove o teste.
const MORTAS_CONHECIDAS = ["pudim_counselorCameraBtn", "pudim_counselorTip",
                           "pudim_toggleCombatLabel", "pudim_toggleDebugLabel"];
const novasMortas = faltando.filter(n => MORTAS_CONHECIDAS.indexOf(n) < 0);
check("nenhuma referência morta NOVA a objeto de interface",
	novasMortas.length === 0, novasMortas.join(", "));
check("e a lista de mortas conhecidas não cresceu nem encolheu sem aviso",
	faltando.join(",") === MORTAS_CONHECIDAS.join(","), faltando.join(", "));

// ── E nada busca sem a forma Try ───────────────────────────────────────────────────────
// GetGUIObjectByName imprime erro na tela do jogo quando não acha. Foi o que virou a
// cortina vermelha: seis chamadas sem Try, uma delas a cada tique.
check("nenhuma busca usa a forma que grita na tela do jogo",
	panel.indexOf("Engine.GetGUIObjectByName") < 0,
	(panel.match(/Engine\.GetGUIObjectByName\("[^"]+"\)/g) || []).join(", "));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
