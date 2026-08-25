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
const SEGUROS = new Set(["GetNeededResources", "SetBuildingPlacementPreview",
	"SetWallPlacementPreview"]);
const chamadas = new Set();
for (const f of guiFiles) {
	const src = semComentarios(fs.readFileSync(f, "utf8"));
	for (const m of src.matchAll(/GuiInterfaceCall\(\s*"([A-Za-z_]+)"/g))
		if (!m[1].startsWith("pudim_")) chamadas.add(m[1]);
}
const naoAuditadas = [...chamadas].filter(c => !SEGUROS.has(c));
check("nenhuma chamada nova ao GuiInterface do jogo base sem auditoria",
	naoAuditadas.length === 0, naoAuditadas.join(", "));

// ── 9. mod.json coerente com tudo acima ────────────────────────────────────────────────
const modJson = JSON.parse(fs.readFileSync(path.join(RAIZ, "mod.json"), "utf8"));
check("mod.json declara ignoreInCompatibilityChecks", modJson.ignoreInCompatibilityChecks === true);
check("essa declaracao so vale se as verificacoes acima passarem", fails === 0,
	fails + " verificacao(oes) falharam — a declaracao ficou MENTIROSA");

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
