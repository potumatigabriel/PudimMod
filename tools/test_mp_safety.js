/**
 * Contrato de compatibilidade em multiplayer.
 *
 * Regra do projeto: o mod NUNCA pode ser incompatível com quem não o tem. Isso só se
 * sustenta enquanto tudo que ele põe em simulation/ for inerte — do contrário, máquina com
 * mod e máquina sem mod simulam coisas diferentes e a partida dessincroniza.
 *
 * mod.json declara "ignoreInCompatibilityChecks": true, que diz ao 0 A.D. "não exija este
 * mod dos outros jogadores". É essa declaração que permite um espectador sem o mod entrar.
 * Ela só é honesta se as verificações abaixo passarem — por isso elas são um teste, e não
 * um comentário.
 *
 * Fatos conferidos na engine (ComponentManagerSerialization.cpp):
 *   - SerializeState pula toda entidade com ENTITY_IS_LOCAL e também a SYSTEM_ENTITY, que é
 *     onde vive o GuiInterface. Logo, métodos e estado do GuiInterface não entram no hash.
 *   - m_NextEntityId é serializado; m_NextLocalEntityId não é. Entidade local (o preview de
 *     construção) não desloca contador nenhum do estado sincronizado.
 * E em globalscripts/Math.js: cos, sin, atan, atan2, pow, exp e log são substituídos por
 * implementações determinísticas; asin, acos e tan chamam error() de propósito.
 */
"use strict";
const fs = require("fs");
const path = require("path");

const RAIZ = path.join(__dirname, "..");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

function listarJs(dir) {
	const out = [];
	(function anda(d) {
		for (const nome of fs.readdirSync(d)) {
			const p = path.join(d, nome);
			const st = fs.statSync(p);
			if (st.isDirectory()) anda(p);
			else if (nome.endsWith(".js")) out.push(p);
		}
	})(dir);
	return out;
}

/** Remove comentários de bloco e de linha, para não acusar texto explicativo como código. */
function semComentarios(src) {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");
}

const simFiles = listarJs(path.join(RAIZ, "simulation"));
const simCodigo = {};
for (const f of simFiles) simCodigo[f] = semComentarios(fs.readFileSync(f, "utf8"));
const rel = f => path.relative(RAIZ, f).replace(/\\/g, "/");

console.log("compatibilidade em multiplayer");

// ── 1. Superficie da simulacao ─────────────────────────────────────────────────────────
const esperados = [
	"simulation/components/!!!pudim_patchApplyN.js",
	"simulation/components/GuiInterface~pudim.js",
	"simulation/components/ProductionQueue~pudim.js",
	"simulation/components/UnitAI~pudim.js",
	"simulation/helpers/Commands~pudim.js"
];
const achados = simFiles.map(rel).sort();
check("nenhum arquivo novo apareceu em simulation/ sem revisao",
	achados.length === esperados.length && achados.every((f, i) => f === esperados.slice().sort()[i]),
	achados.join(", "));

// ── 2. Os stubs continuam inertes ──────────────────────────────────────────────────────
// Foram esvaziados justamente por causa de OOS: sobrescrever ProgressTimeout, adicionar
// SerializableAttributes ou registrar comandos proprios faz as duas maquinas divergirem.
for (const nome of ["ProductionQueue~pudim.js", "UnitAI~pudim.js", "Commands~pudim.js"]) {
	const f = simFiles.find(x => x.endsWith(nome));
	const corpo = (simCodigo[f] || "").trim();
	check(nome + " continua sem codigo executavel", corpo.length === 0,
		corpo.slice(0, 80));
}

// ── 3. Nada de estado: o que for gravado no componente entra no hash ───────────────────
for (const f of simFiles) {
	const m = simCodigo[f].match(/\bthis\.[A-Za-z_$][\w$]*\s*=[^=]/g);
	check(rel(f) + " nao grava estado no componente", !m, m && m.join(" | "));
}
for (const f of simFiles) {
	check(rel(f) + " nao mexe em serializacao",
		!/SerializableAttributes|prototype\.Serialize\b|prototype\.Deserialize\b/.test(simCodigo[f]));
}

// ── 4. So o GuiInterface pode ser estendido ────────────────────────────────────────────
// Ele vive na SYSTEM_ENTITY, que a serializacao ignora. Qualquer outro componente da
// simulacao muda o comportamento do jogo e quebra quem nao tem o mod.
for (const f of simFiles) {
	const alvos = simCodigo[f].match(/\b([A-Z][\w]*)\.prototype\.\w+\s*=/g) || [];
	const proibidos = alvos.filter(a => !/^GuiInterface\./.test(a));
	check(rel(f) + " so estende GuiInterface", proibidos.length === 0, proibidos.join(", "));
	const patches = simCodigo[f].match(/pudim_patchApplyN\(\s*([A-Za-z]+)/g) || [];
	const patchesRuins = patches.filter(p => !/GuiInterface/.test(p));
	check(rel(f) + " so aplica patch em GuiInterface", patchesRuins.length === 0, patchesRuins.join(", "));
}

// ── 5. A simulacao nao emite comandos nem chama a GUI ──────────────────────────────────
for (const f of simFiles) {
	check(rel(f) + " nao emite comando de rede", !/Engine\.PostNetworkCommand/.test(simCodigo[f]));
	check(rel(f) + " nao chama GuiInterfaceCall", !/Engine\.GuiInterfaceCall/.test(simCodigo[f]));
}

// ── 6. Math nao-deterministico ─────────────────────────────────────────────────────────
// asin/acos/tan chamam error() em globalscripts/Math.js. hypot, cbrt, log2, log10, sinh,
// cosh, tanh, expm1, log1p e fround NAO sao substituidos ali, entao usam a implementacao
// nativa da plataforma, que pode diferir entre maquinas.
const proibidasMath = ["asin", "acos", "tan", "random", "hypot", "cbrt", "log2", "log10",
                       "sinh", "cosh", "tanh", "expm1", "log1p", "fround"];
for (const f of simFiles) {
	const achou = proibidasMath.filter(fn => new RegExp("Math\\." + fn + "\\b").test(simCodigo[f]));
	check(rel(f) + " nao usa Math nao-deterministico", achou.length === 0, achou.join(", "));
}
// atan2/cos/sin/pow/exp/log SAO substituidos pela engine e podem ser usados.
check("Math.atan2 continua liberado (a engine o substitui)",
	proibidasMath.indexOf("atan2") === -1);

// ── 7. Comandos de rede: so os do jogo base ────────────────────────────────────────────
// Um tipo de comando proprio seria ignorado por quem nao tem o mod — divergencia imediata.
const VANILLA = new Set(["attack", "autoqueue-on", "autoqueue-off", "barter", "construct",
	// construct-wall: tratado por TryConstructWall em simulation/helpers/Commands.js, do
	// jogo BASE, igual em todos os clientes — mesma classe de seguranca que "construct".
	// Entrou com a palicada, em 25/08.
	"construct-wall",
	"delete-entities", "garrison", "gather", "gather-near-position", "repair", "research",
	"stop", "stop-production", "train", "unload", "walk", "returnresource", "formation",
	"promote", "set-rallypoint", "unload-all"]);
const guiFiles = listarJs(path.join(RAIZ, "gui"));
const tiposUsados = new Set();
for (const f of guiFiles) {
	const src = semComentarios(fs.readFileSync(f, "utf8"));
	// Só o "type" que acompanha um PostNetworkCommand interessa.
	for (const bloco of src.split("Engine.PostNetworkCommand").slice(1)) {
		const m = bloco.slice(0, 400).match(/"type"\s*:\s*"([a-z-]+)"/);
		if (m) tiposUsados.add(m[1]);
	}
}
const foraDoPadrao = [...tiposUsados].filter(t => !VANILLA.has(t));
check("todo comando de rede e do jogo base", foraDoPadrao.length === 0, foraDoPadrao.join(", "));
check("o mod realmente envia comandos (o teste acima nao passou por vazio)",
	tiposUsados.size >= 10, tiposUsados.size);

// ── 8. GuiInterfaceCall do jogo base: so os que nao mudam estado sincronizado ──────────
// SetBuildingPlacementPreview cria entidade LOCAL (Engine.AddLocalEntity) e guarda o id em
// this.placementEntity do GuiInterface — e a serializacao pula os dois. Por isso e seguro.
//
// SetWallPlacementPreview entrou em 25/08, com a palicada, e foi conferido do mesmo jeito:
// em GuiInterface.js as pecas nascem de Engine.AddLocalEntity("preview|" + tpl) e ficam em
// this.placementWallEntities. Entidade local nao e serializada — ComponentManagerSerialization
// .cpp pula ENTITY_IS_LOCAL, e m_NextLocalEntityId tambem nao entra no estado. Chamar de um
// cliente so nao diverge nada.
//
// Este teste PEGOU as duas quando elas apareceram, que e exatamente o que se espera dele.
// AreRequirementsMet entrou em 25/08, com o filtro de unidades treinaveis. Conferido em
// GuiInterface.js: o corpo inteiro e um `return RequirementsHelper.AreRequirementsMet(...)`.
// Le e devolve, nao escreve nada. E o que a propria interface do jogo usa para cinzar botao
// de treino (gui/session/selection_panels.js).
const SEGUROS = new Set(["GetNeededResources", "SetBuildingPlacementPreview",
	"SetWallPlacementPreview", "AreRequirementsMet"]);
const chamadas = new Set();
for (const f of guiFiles) {
	const src = semComentarios(fs.readFileSync(f, "utf8"));
	for (const m of src.matchAll(/GuiInterfaceCall\(\s*"([A-Za-z_]+)"/g))
		if (!m[1].startsWith("pudim_")) chamadas.add(m[1]);
}
const naoAuditadas = [...chamadas].filter(c => !SEGUROS.has(c));
check("nenhuma chamada nova ao GuiInterface do jogo base sem auditoria",
	naoAuditadas.length === 0, naoAuditadas.join(", "));

// ── 9. ESPECTADOR NÃO EMITE COMANDO ────────────────────────────────────────────────────
//
// Pergunta de 11/09, depois de um Out-Of-Sync ao entrar para assistir: "pode ser por causa
// do mod?".
//
// O tique do mod tem uma trava — `if (g_IsObserver) return;` — justamente porque comando de
// rede vindo de quem assiste é caminho direto para OOS. Em 06/09 eu MOVI coisas para cima
// dessa trava (a barra de aliados, o indicador de obras, o estimador e a lista de unidades),
// porque elas só leem e desenham e não apareciam para quem assiste.
//
// "Só leem e desenham" era verdade quando eu movi. Nada garante que continue sendo: basta
// alguém acrescentar uma linha dentro de uma dessas funções. Este teste segue as funções
// chamadas ANTES da trava e reprova qualquer emissão de rede nelas.
{
	const painel = semComentarios(fs.readFileSync(
		path.join(RAIZ, "gui", "session", "pudim_panel.js"), "utf8"));
	const barra = semComentarios(fs.readFileSync(
		path.join(RAIZ, "gui", "session", "pudim_ally_bar.js"), "utf8"));

	const iTick = painel.indexOf("function pudim_Tick(dt)");
	const iTrava = painel.indexOf('g_IsObserver !== "undefined" && g_IsObserver) return;');
	check("o tique tem a trava de espectador", iTick >= 0 && iTrava > iTick,
		"tick=" + iTick + " trava=" + iTrava);

	// Quem é chamado antes da trava.
	const antes = painel.slice(iTick, iTrava);
	const chamadasAntes = [...new Set([...antes.matchAll(/(pudim_[A-Za-z]+)\(/g)]
		.map(m => m[1]))].filter(n => n !== "pudim_Tick");
	check("há funções rodando antes da trava (senão este teste não mede nada)",
		chamadasAntes.length >= 3, chamadasAntes.join(", "));

	// O corpo de cada uma, e das que elas chamam por sua vez.
	//
	// POR CONTAGEM DE CHAVES, e não por `indexOf("\n}\n")`. A primeira versão usava o
	// indexOf, e semComentarios() remove os blocos /* */ inteiros — inclusive as quebras de
	// linha deles. Sem o "\n}\n" no lugar esperado, a extração devolvia o RESTO DO ARQUIVO, e
	// aí toda função parecia emitir comando de rede: o teste acusou 100 funções de uma vez,
	// o que é sinal de teste quebrado, não de mod quebrado.
	const corpo = nome => {
		for (const src of [painel, barra]) {
			const i = src.indexOf("function " + nome + "(");
			if (i < 0) continue;
			const abre = src.indexOf("{", i);
			if (abre < 0) continue;
			let d = 0;
			for (let k = abre; k < src.length; k++) {
				if (src[k] === "{") d++;
				else if (src[k] === "}" && --d === 0) return src.slice(i, k + 1);
			}
			return src.slice(i);
		}
		return "";
	};
	// O extrator tem de devolver UMA função, não o arquivo. Sem esta âncora o teste volta a
	// acusar tudo e ninguém saberia que é ele que está errado.
	check("o extrator devolve o corpo de uma função só",
		corpo("pudim_AtualizarObras").length > 100 &&
		corpo("pudim_AtualizarObras").length < painel.length / 10,
		corpo("pudim_AtualizarObras").length + " caracteres");
	const vistos = new Set();
	const fila = chamadasAntes.slice();
	const emissores = [];
	while (fila.length) {
		const nome = fila.shift();
		if (vistos.has(nome)) continue;
		vistos.add(nome);
		const c = corpo(nome);
		if (!c) continue;
		if (/PostNetworkCommand|SendNetworkFlare/.test(c)) emissores.push(nome);
		for (const m of c.matchAll(/(pudim_[A-Za-z]+)\(/g))
			if (!vistos.has(m[1])) fila.push(m[1]);
	}
	check("nenhuma função do caminho do espectador emite comando de rede",
		emissores.length === 0, emissores.join(", "));
	check("e o rastreio realmente percorreu as funções", vistos.size >= 5,
		vistos.size + " função(ões) auditada(s)");

	// O flare automático marca o minimapa e, mesmo sendo local, não tem o que fazer para
	// quem assiste — a guarda própria dele é a segunda linha de defesa.
	check("o flare automático tem guarda própria de espectador",
		/function pudim_AutoFlareCombat[\s\S]{0,300}?g_IsObserver/.test(barra));
}

// ── 10. mod.json coerente com tudo acima ───────────────────────────────────────────────
const modJson = JSON.parse(fs.readFileSync(path.join(RAIZ, "mod.json"), "utf8"));
check("mod.json declara ignoreInCompatibilityChecks", modJson.ignoreInCompatibilityChecks === true);
check("essa declaracao so vale se as verificacoes acima passarem", fails === 0,
	fails + " verificacao(oes) falharam — a declaracao ficou MENTIROSA");

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
