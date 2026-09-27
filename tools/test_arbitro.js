/**
 * O arbitro: toda ordem do mod a uma unidade passa por pudim_Ordenar.
 *
 * Relato de 27/09: "vejo muitos trabalhadores trocando de funcao e passeando pelo mapa
 * simultaneamente".
 *
 * MEDIDO em 167 partidas do Pudim (2.951 minutos). Ordem sua e ordem do mod foram separadas
 * pela assinatura do comando, conferida no codigo do motor: a interface manda `formation`
 * na coleta, reparo e guarnicao (unit_actions.js + AutoFormation.getNull com
 * formationwalkonly=true) e `pushFront` na caminhada; o mod nunca manda nenhum dos dois.
 *
 *   15.623  vezes o mod deu DUAS ordens diferentes a mesma unidade em < 3s  (9,1%)
 *           12.861 delas coleta -> coleta
 *   10.000  vezes o mod passou por cima de uma ordem SUA em < 3s
 *    7.578  vai-e-voltas A -> B -> A em < 90s; 5.814 deles do proprio auto-trabalho
 *
 * Este teste roda a funcao DE VERDADE, extraida do painel, num sandbox com relogio
 * controlado. Nao e uma copia da regra: se o codigo mudar, o teste mede o codigo novo.
 *
 * Rodar:  node tools/test_arbitro.js
 */
"use strict";
const fs = require("fs");
// A copia de trabalho e CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const scout = fs.readFileSync(path.join(base, "gui", "session", "session~pudim.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("o arbitro das ordens do mod");

// ── Extrair o arbitro do painel ────────────────────────────────────────────────────────
const ini = panel.indexOf("const PUDIM_TIPOS_DE_UNIDADE");
const fim = panel.indexOf("function pudim_MarkDispatched(");
check("o bloco do arbitro foi encontrado no painel", ini > 0 && fim > ini);
const bloco = panel.slice(ini, fim);

let agora = 1000000;
const postados = [];
const sandbox = {
	Engine: { PostNetworkCommand: c => postados.push(JSON.parse(JSON.stringify(c))) },
	Date: { now: () => agora },
	Set: Set, Math: Math, Array: Array, JSON: JSON,
	g_PudimPlayerOrders: {}
};
vm.createContext(sandbox);
// `const` de topo nao vira propriedade do contexto; expomos o que o teste precisa ler.
vm.runInContext(bloco + "\nthis.__arb = () => g_PudimArbitro; this.__res = () => g_PudimReserva;" +
	"\nthis.JANELA = PUDIM_JANELA_JOGADOR; this.RESERVA = PUDIM_RESERVA_MS;", sandbox);
const Ordenar = (cmd, dono) => vm.runInContext("pudim_Ordenar", sandbox)(cmd, dono);
const zera = () => {
	postados.length = 0;
	vm.runInContext("g_PudimReserva = {}; g_PudimArbitro = { enviadas: 0, jogador: 0, prioridade: 0, reordem: 0 };", sandbox);
	for (const k in sandbox.g_PudimPlayerOrders) delete sandbox.g_PudimPlayerOrders[k];
};
const coleta = (ids, alvo) => ({ "type": "gather", "entities": ids, "target": alvo, "queued": false, "pushFront": false });
const JANELA = sandbox.JANELA, RESERVA = sandbox.RESERVA;

check("a janela do jogador cobre a latencia com folga (>= 3s)", JANELA >= 3000, JANELA);
check("e a reserva e curta o bastante para nao prender ninguem (<= 4s)", RESERVA <= 4000, RESERVA);

// ── 1. Ordem sua manda ─────────────────────────────────────────────────────────────────
// A unidade 221 do replay 2026-09-27_0003: voce manda, o mod responde em 0,2s.
zera();
sandbox.g_PudimPlayerOrders[221] = agora - 200;
check("ordem sua ha 0,2s: o auto-trabalho NAO toca a unidade",
	Ordenar(coleta([221], 2182), "pudim_RunAutoWork") === false && postados.length === 0);
check("nem o panico — a diretriz e absoluta",
	Ordenar({ "type": "garrison", "entities": [221], "target": 9, "queued": false }, "pudim_ProcessPanic") === false);
sandbox.g_PudimPlayerOrders[221] = agora - (JANELA + 100);
check("passada a janela, vale a checagem de ocupado da simulacao (que ja existia)",
	Ordenar(coleta([221], 2182), "pudim_RunAutoWork") === true && postados.length === 1);

// Lote misto: so sai quem pode.
zera();
sandbox.g_PudimPlayerOrders[2] = agora - 100;
Ordenar(coleta([1, 2, 3], 50), "pudim_RunAutoWork");
check("num lote de tres, a unidade que voce comandou sai da ordem e as outras seguem",
	postados.length === 1 && postados[0].entities.join() === "1,3", postados.map(p => p.entities).join("|"));

// ── 2. A economia nao se desfaz ────────────────────────────────────────────────────────
// Onde moravam as 12.861 coleta->coleta: despacho e redirecionamento na mesma funcao.
zera();
Ordenar(coleta([7], 100), "pudim_RunAutoWork");
agora += 1000;
check("o auto-trabalho nao troca o alvo que ele mesmo deu ha 1s",
	Ordenar(coleta([7], 200), "pudim_RunAutoWork") === false && postados.length === 1);
check("e isso conta como 'reordem' na telemetria",
	sandbox.__arb().reordem === 1);
check("mas continuacao EM FILA do mesmo sistema passa",
	Ordenar({ "type": "gather", "entities": [7], "target": 300, "queued": true }, "pudim_RunAutoWork") === true);
agora += RESERVA;
check("passada a reserva, o auto-trabalho pode reordenar",
	Ordenar(coleta([7], 200), "pudim_RunAutoWork") === true);

// ── 3. Prioridade: defesa > obra > economia ────────────────────────────────────────────
zera();
Ordenar(coleta([8], 100), "pudim_RunAutoWork");
agora += 500;
check("o panico tira do perigo quem o auto-trabalho acabou de mandar",
	Ordenar({ "type": "garrison", "entities": [8], "target": 9, "queued": false }, "pudim_ProcessPanic") === true);

// A unidade 218: construir a obra 8799 e colher, alternando a cada 1-4s.
zera();
Ordenar({ "type": "repair", "entities": [218], "target": 8799, "queued": false }, "pudim_ProcessDropsiteFoundations");
agora += 1200;
check("o auto-trabalho nao desfaz a obra que o construtor acabou de mandar",
	Ordenar(coleta([218], 1415), "pudim_RunAutoWork") === false);
check("e isso conta como 'prioridade' na telemetria", sandbox.__arb().prioridade === 1);
check("a obra continua com a obra: foi UMA ordem, nao seis",
	postados.length === 1 && postados[0].type === "repair");

zera();
Ordenar({ "type": "garrison", "entities": [9], "target": 1, "queued": false }, "pudim_ProcessPanic");
agora += 500;
check("e a obra nao arranca do abrigo quem o panico acabou de guardar",
	Ordenar({ "type": "repair", "entities": [9], "target": 5, "queued": false }, "pudim_ProcessRepeatBuildings") === false);

// A IA avancada faz retirada E construcao: prioridade por tipo.
zera();
Ordenar(coleta([10], 100), "pudim_RunAutoWork");
check("na IA avancada, a retirada (walk) e defesa",
	Ordenar({ "type": "walk", "entities": [10], "x": 1, "z": 1, "queued": false }, "pudim_ProcessAdvancedAI") === true);

// ── 4. Navegacao reordena a si mesma ───────────────────────────────────────────────────
// Kite, heroi e batedores dao passos seguidos de proposito e tem cooldown proprio.
zera();
Ordenar({ "type": "walk", "entities": [11], "x": 1, "z": 1, "queued": false }, "pudim_ForceScoutTick");
agora += 1500;
check("o batedor continua dando passos a cada 1,5s",
	Ordenar({ "type": "walk", "entities": [11], "x": 2, "z": 2, "queued": false }, "pudim_ForceScoutTick") === true);
zera();
Ordenar({ "type": "walk", "entities": [12], "x": 1, "z": 1, "queued": false }, "pudim_ProcessAutoKite");
check("e o kite recua e, em fila, ataca",
	Ordenar({ "type": "attack", "entities": [12], "target": 99, "queued": true }, "pudim_ProcessAutoKite") === true &&
	postados.length === 2);

// ── 5. O que o arbitro NAO toca ────────────────────────────────────────────────────────
zera();
sandbox.g_PudimPlayerOrders[500] = agora;
check("ordem de EDIFICIO passa direto, sem filtro",
	Ordenar({ "type": "train", "entities": [500], "template": "x", "count": 1 }, "pudim_ProcessAutoQueue") === true &&
	postados.length === 1);
zera();
sandbox.g_PudimPlayerOrders[13] = agora;
check("botao que VOCE aperta (guarnecer cerco) e ordem sua, e passa",
	Ordenar({ "type": "garrison", "entities": [13], "target": 1, "queued": false }, "pudim_GuarnecerCerco") === true);

// ── 6. A reserva nao vaza memoria ──────────────────────────────────────────────────────
zera();
for (let i = 0; i < 199; i++) Ordenar(coleta([10000 + i], 1), "pudim_RunAutoWork");
agora += RESERVA + 1;
for (let i = 0; i < 201; i++) Ordenar(coleta([20000 + i], 1), "pudim_RunAutoWork");
const restantes = Object.keys(sandbox.__res()).filter(k => +k < 20000).length;
check("reservas vencidas de unidades que nao voltam sao limpas", restantes === 0, restantes + " sobraram");

// ── 7. Nenhuma ordem a unidade escapa do arbitro ───────────────────────────────────────
// Se alguem acrescentar um Engine.PostNetworkCommand de coleta direto, o arbitro fica cego
// para ele e a briga volta. Esta checagem pega isso no primeiro teste.
const TIPOS = ["gather", "gather-near-position", "walk", "garrison", "repair", "attack",
	"construct", "construct-wall", "stop"];
function escapados(src, nomeArq) {
	const achou = [];
	const semArb = src.slice(0, src.indexOf("function pudim_Ordenar(")) +
		src.slice(src.indexOf("function pudim_MarkDispatched("));
	const alvo = nomeArq === "painel" ? semArb : src;
	for (const b of alvo.split("Engine.PostNetworkCommand(").slice(1)) {
		const m = b.slice(0, 300).match(/"type"\s*:\s*"([a-z-]+)"/);
		if (m && TIPOS.indexOf(m[1]) >= 0) achou.push(m[1]);
		// comando montado em variavel dentro do auto-trabalho
		if (!m && /^cmd\)/.test(b)) achou.push("(cmd)");
	}
	return achou;
}
const esc = escapados(panel, "painel").concat(escapados(scout, "scout"));
check("nenhuma ordem a unidade chama Engine.PostNetworkCommand direto", esc.length === 0, esc.join(", "));
check("e as 42 ordens convertidas passam pelo arbitro",
	(panel.match(/pudim_Ordenar\(/g) || []).length - 1 + (scout.match(/pudim_Ordenar\(/g) || []).length >= 42,
	((panel.match(/pudim_Ordenar\(/g) || []).length - 1 + (scout.match(/pudim_Ordenar\(/g) || []).length) + " chamadas");
// Sem dono o arbitro nao sabe a prioridade nem a quem pertence a reserva. Le cada chamada
// ate o parentese que a fecha de verdade (conta aninhamento, pula strings).
function argsDe(src, i) {
	let nivel = 0;
	for (let j = i; j < src.length; j++) {
		const c = src[j];
		if (c === '"' || c === "'") { const q = c; j++; while (j < src.length && src[j] !== q) { if (src[j] === "\\") j++; j++; } continue; }
		if (c === "(") nivel++;
		else if (c === ")" && --nivel === 0) return src.slice(i + 1, j);
	}
	return null;
}
const semDono = [];
for (const src of [panel, scout]) {
	let k = -1;
	while ((k = src.indexOf("pudim_Ordenar(", k + 1)) >= 0) {
		if (src.slice(k - 9, k) === "function ") continue;   // a propria definicao
		const a = argsDe(src, k + "pudim_Ordenar".length);
		if (!a || !/,\s*"pudim_[A-Za-z]+"\s*$/.test(a))
			semDono.push(src.slice(k, k + 60).replace(/\s+/g, " "));
	}
}
check("cada chamada diz quem e o dono", semDono.length === 0, semDono.slice(0, 3).join(" | "));

// ── 8. Multiplayer ─────────────────────────────────────────────────────────────────────
// O arbitro so decide QUAIS comandos o seu cliente manda. Todos os clientes recebem os
// mesmos comandos; nada disto entra na simulacao.
check("o arbitro vive so na interface: a simulacao nao o conhece",
	!/g_PudimReserva|pudim_Ordenar/.test(sim));

// ── 9. E o panico passou a respeitar voce ──────────────────────────────────────────────
check("o panico recebe a lista de ordens suas",
	/pudim_GetPanicData",\s*\n?\s*\{ "playerOrdered": pudim_GetPlayerOrderedIds\(\) \}/.test(panel));
check("e a simulacao pula quem voce comandou",
	/const panicOrdered = new Set\(/.test(sim) && /if \(panicOrdered\.has\(ent\)\) continue;/.test(sim));
check("soldado ATACANDO nao e guardado em torre — e tira-lo da luta",
	/\} else if \(isSoldier && !atacando\(ent\)\) \{/.test(sim) &&
	/o\.type === "Attack" \|\| o\.type === "WalkAndFight"/.test(sim));

// ── 10. A telemetria sai no retrato do minuto ──────────────────────────────────────────
check("o SNAP mostra o que o arbitro barrou, e por que",
	/" \| arb ok" \+ g_PudimArbitro\.enviadas \+ " jog" \+ g_PudimArbitro\.jogador \+/.test(panel) &&
	/" pri" \+ g_PudimArbitro\.prioridade \+ " reo" \+ g_PudimArbitro\.reordem/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
