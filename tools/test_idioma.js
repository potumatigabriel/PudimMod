/**
 * O mod fala a língua do jogo, não a minha.
 *
 * Pedido de 25/08: "se o jogo instalado estiver em outra lingua que n seja pt ou pt-br, tem
 * que ficar em ingles os botões e as explicações".
 *
 * O mod nasceu escrito em português e ficou assim. Pior: com pedaços em inglês por acidente
 * — "Smart Dropsites", "Auto-Retreat", "Smart Focus Fire" — que é o pior dos dois mundos.
 * Quem joga em português lia inglês no meio; quem joga em qualquer outra língua lia
 * português inteiro.
 *
 * O que existia e o que faltava, que é a parte interessante: `gui/session/pudim_i18n.js`
 * está no mod desde agosto, com `pudim_Lang()`, `pudim_T()` e um dicionário [en, pt]
 * completo — e já era usado nos tooltips do painel e do batedor. Só os RÓTULOS nunca foram
 * ligados nele, porque nascem do XML, onde o texto é fixo. Eu quase escrevi um segundo
 * módulo de idioma antes de encontrar o primeiro.
 *
 * Rodar:  node tools/test_idioma.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const i18n = fs.readFileSync(path.join(base, "gui", "session", "pudim_i18n.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const optsJs = fs.readFileSync(path.join(base, "gui", "options", "options~pudim.js"), "utf8");
const opts = JSON.parse(fs.readFileSync(path.join(base, "moddata", "pudim_options.json"), "utf8"));
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("o mod fala a lingua do jogo");

// ── Um módulo só ───────────────────────────────────────────────────────────────────────
// Esta é a asserção que me pouparia meia hora: eu criei um segundo pudim_i18n.js em
// gui/common antes de descobrir que o primeiro já existia. Duas definições de pudim_T() na
// mesma página se sobrescrevem, e qual delas vence depende da ordem alfabética do carregador.
check("existe UM módulo de idioma, não dois",
	!fs.existsSync(path.join(base, "gui", "common", "pudim_i18n.js")));
check("e ele expõe as funções que o resto usa",
	/function pudim_Lang\(\)/.test(i18n) && /function pudim_T\(key\)/.test(i18n));
check("o dicionário guarda o par [en, pt]",
	/return pudim_Lang\(\) === "pt" \? entry\[1\] : entry\[0\];/.test(i18n));
check("chave desconhecida devolve a própria chave, visível na tela",
	/if \(!entry\) return key;/.test(i18n));

// Falhar para o inglês, não para o português: se a detecção não funciona, é mais provável
// que o jogo esteja num idioma que o mod não fala.
check("o padrão é inglês quando a detecção não decide",
	/Nada conclusivo AINDA[\s\S]{0,120}?return "en";/.test(i18n));
// E o negativo NÃO é memorizado: a primeira chamada pode vir antes de o dicionário do jogo
// carregar, e travar em inglês para sempre seria pior que reavaliar.
check("e o resultado negativo não é memorizado",
	/Só memoriza resposta POSITIVA/.test(i18n));
check("as duas telas usam os MESMOS três passos",
	["pudim.lang", "gui.locale", "Madeira"].every(x => optsJs.indexOf(x) >= 0 && i18n.indexOf(x) >= 0));

// ── Os rótulos, que era o que faltava ──────────────────────────────────────────────────
check("existe um mapa de rótulos, irmão do de tooltips",
	/const PUDIM_CAPTION_MAP = \{/.test(i18n));
check("e um aplicador que escreve caption em vez de tooltip",
	/function pudim_ApplyCaptions\(\)/.test(i18n) &&
	/obj\.caption = pudim_T\(PUDIM_CAPTION_MAP\[objName\]\)/.test(i18n));
check("o painel chama o aplicador na inicialização",
	/try \{ pudim_ApplyCaptions\(\); \} catch\(e\) \{\}/.test(panel));
check("e reaplica junto dos tooltips enquanto o idioma não está resolvido",
	/pudim_ApplyTooltips\(\);\s*\n\s*pudim_ApplyCaptions\(\);/.test(i18n));

// Todo objeto do mapa tem de existir no XML, senão é entrada morta.
const mapa = [];
const reMapa = /"(pudim_[A-Za-z0-9_]+)":\s*"(cap\.[A-Za-z.]+)"/g;
let m;
while ((m = reMapa.exec(i18n)) !== null) mapa.push({ obj: m[1], chave: m[2] });
check("o mapa de rótulos tem entradas", mapa.length >= 15, mapa.length);

const semObjeto = mapa.filter(e => xml.indexOf('name="' + e.obj + '"') < 0);
check("todo objeto mapeado existe no XML", semObjeto.length === 0,
	semObjeto.map(e => e.obj).join(", "));

// TIPO DO OBJETO. Isto custou caro: eu mapeei "pudim_combatFlash", que é a IMAGEM de fundo
// que pisca na cor do combate, achando que era o cabeçalho. Imagem não tem caption, e como o
// aplicador roda no laço de atualização, o motor imprimia
// "Property 'caption' does not exist!" na tela do jogador SESSENTA VEZES POR SEGUNDO.
//
// try/catch não salva: o motor imprime antes de lançar. A defesa é não escrever no objeto
// errado — e é isto que esta asserção garante.
const SEM_CAPTION = ["image"];
const tipoDe = nome => {
	const m = new RegExp('<object name="' + nome + '"([^>]*)>').exec(xml);
	if (!m) return null;
	const t2 = /type="(\w+)"/.exec(m[1]);
	// Sem type explícito, o 0 A.D. trata como image — que é justamente o caso que quebrou.
	return t2 ? t2[1] : "image";
};
const tipoRuim = mapa.filter(e => SEM_CAPTION.indexOf(tipoDe(e.obj)) >= 0);
check("nenhum objeto mapeado é de um tipo que não aceita caption",
	tipoRuim.length === 0,
	tipoRuim.map(e => e.obj + " (" + tipoDe(e.obj) + ")").join(", "));

// E cada um tem de ter caption PRÓPRIA no XML — objeto sem caption declarada é sinal de que
// mapeei o irmão errado, que foi exatamente o que aconteceu.
const semCaptionPropria = mapa.filter(e => {
	const i0 = xml.indexOf('name="' + e.obj + '"');
	if (i0 < 0) return true;
	const fim = xml.indexOf("</object>", i0);
	const autoFechado = xml.lastIndexOf("/>", fim) > xml.indexOf(">", i0) - 2 &&
	                    xml.slice(i0, fim).indexOf("/>") >= 0 &&
	                    xml.slice(i0, fim).indexOf("/>") < xml.slice(i0, fim).indexOf("<object", 1);
	return xml.slice(i0, fim < 0 ? undefined : fim)
	          .indexOf('<translatableAttribute id="caption">') < 0;
});
check("todo objeto mapeado declara a própria caption no XML",
	semCaptionPropria.length === 0, semCaptionPropria.map(e => e.obj).join(", "));

// E o aplicador não pode confiar só no mapa: uma vez errado, tem de sair da lista.
check("o aplicador testa o objeto uma vez e descarta o que não aceita",
	/var g_PudimCaptionOk = null;/.test(i18n) &&
	/catch\(e\) \{ warn\("\[PudimMod\] " \+ objName \+ " nao aceita caption/.test(i18n));
check("e o teste é feito UMA vez, não a cada quadro",
	/if \(!g_PudimCaptionOk\)/.test(i18n));

const semChave = mapa.filter(e => i18n.indexOf('"' + e.chave + '":') < 0);
check("toda chave mapeada existe no dicionário", semChave.length === 0,
	semChave.map(e => e.chave).join(", "));

// Toda chave cap.* precisa dos dois idiomas, e eles não podem ser o mesmo texto — exceto
// palavras que realmente são iguais nas duas línguas.
const IGUAIS_DE_VERDADE = ["Metal", "Log"];
const chaves = [];
const reChave = /"(cap\.[A-Za-z.]+)":\s*\["((?:[^"\\]|\\.)*)",\s*\n?\s*"((?:[^"\\]|\\.)*)"\]/g;
while ((m = reChave.exec(i18n)) !== null)
	chaves.push({ k: m[1], en: m[2], pt: m[3] });
check("as chaves de rótulo têm os dois idiomas", chaves.length >= 30, chaves.length);

const naoTraduzidas = chaves.filter(c => c.en === c.pt && IGUAIS_DE_VERDADE.indexOf(c.en) < 0);
check("nenhuma ficou com o mesmo texto nos dois idiomas",
	naoTraduzidas.length === 0, naoTraduzidas.map(c => c.k + '="' + c.en + '"').join(", "));

// O lado inglês não pode ter sobrado em português.
const PT_SO = ["ç", "ã", "õ", "á", "é", "í", "ó", "ú", "â", "ê", "ô", "à"];
const enComPt = chaves.filter(c => PT_SO.some(x => c.en.indexOf(x) >= 0));
check("o lado inglês não tem acento português",
	enComPt.length === 0, enComPt.map(c => c.k).join(", "));

// ── Nada de texto fixo escapando no painel ─────────────────────────────────────────────
// O caso concreto: os nomes de Quartel/Estábulo eram literais e apareceriam em português
// num jogo em inglês, mesmo com todo o resto traduzido.
// Os cinco tipos da série saem do dicionário. Eram literais em JS e apareceriam em
// português num jogo em inglês mesmo com todo o resto traduzido.
check("os nomes dos edifícios da série saem do dicionário",
	/function pudim_QuartelNome\(tipo\)/.test(panel) &&
	/pudim_T\(PUDIM_QUARTEL_CHAVES\[tipo\] \|\| "cap\.barracks"\)/.test(panel));
check("todo tipo da série tem chave, e toda chave existe no dicionário", (function() {
	const tipos = /const PUDIM_QUARTEL_TIPOS = \[([^\]]*)\]/.exec(panel)[1]
		.split(",").map(s => s.trim().replace(/"/g, "")).filter(Boolean);
	const mapa = /const PUDIM_QUARTEL_CHAVES = \{([\s\S]*?)\};/.exec(panel)[1];
	return tipos.every(t => {
		// Escape dobrado de propósito: isto é uma STRING que vira regex, então "\\s" na
		// string produz "\s" no padrão. Com "\s" direto, o literal vira só "s".
		const m = new RegExp(t + ':\\s*"(cap\\.[a-z]+)"').exec(mapa);
		return m && i18n.indexOf('"' + m[1] + '":') >= 0;
	});
})());
check("e o botão da série monta o texto com pudim_T",
	/pudim_T\("cap\.serieStop"\)/.test(panel) && /pudim_T\("cap\.serieBuild"\)/.test(panel));

// ── As opções ──────────────────────────────────────────────────────────────────────────
console.log("\nas opcoes, nos dois idiomas");

const lista = opts[0].options;
check("toda opção tem os quatro campos: rótulo e dica em pt e en",
	lista.every(o => o.label && o.tooltip && o.label_en && o.tooltip_en), lista.length);
check("o carregador troca para inglês quando o jogo não é pt",
	/if \(o\.label_en\) o\.label = o\.label_en;/.test(optsJs) &&
	/if \(o\.tooltip_en\) o\.tooltip = o\.tooltip_en;/.test(optsJs));

// A tela de opções é outra página de GUI e não carrega os scripts da sessão, então a
// detecção é duplicada — mas a ORDEM tem de bater, senão o mesmo jogo mostraria o painel
// numa língua e as opções noutra.
check("as duas telas respeitam a preferência explícita pudim.lang",
	/Engine\.ConfigDB_GetValue\("user", "pudim\.lang"\)/.test(i18n) &&
	/Engine\.ConfigDB_GetValue\("user", "pudim\.lang"\)/.test(optsJs));
check("e as duas caem para inglês por padrão",
	/let idioma = "en";/.test(optsJs));
check("a duplicação está explicada, não é descuido",
	/outra pagina de GUI e nao carrega os scripts/.test(optsJs));

const ptComIngles = lista.filter(o =>
	["Smart ", "Auto-Retreat", "Focus Fire", "Counter-Train", "Settings", "Enabled"]
		.some(t => o.label.indexOf(t) >= 0));
check("nenhum rótulo em português ficou com termo em inglês",
	ptComIngles.length === 0, ptComIngles.map(o => o.config).join(", "));

const enComAcento = lista.filter(o =>
	PT_SO.some(x => o.label_en.indexOf(x) >= 0 || o.tooltip_en.indexOf(x) >= 0));
check("nenhum texto inglês ficou com acento português",
	enComAcento.length === 0, enComAcento.map(o => o.config).join(", "));

check("as explicações inglesas também explicam de verdade",
	lista.every(o => o.tooltip_en.length >= 90),
	lista.filter(o => o.tooltip_en.length < 90).map(o => o.config).join(", "));

// As duas versões têm de dizer a MESMA coisa, não uma ser resumo da outra.
const desproporcionais = lista.filter(o => {
	const r = o.tooltip.length / o.tooltip_en.length;
	return r < 0.6 || r > 1.7;
});
check("pt e en têm tamanho comparável — nenhuma é resumo da outra",
	desproporcionais.length === 0,
	desproporcionais.map(o => o.config + " (" +
		(o.tooltip.length / o.tooltip_en.length).toFixed(2) + ")").join(", "));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
