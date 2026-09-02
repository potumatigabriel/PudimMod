/**
 * O log não pode custar mais que o mod.
 *
 * Pergunta do jogador em 01/09: "o jogo está fechando.. será que o mod está consumindo
 * muitos recursos?".
 *
 * Está — e este era o pior ponto. A versão anterior de pudim_Log fazia, A CADA LINHA:
 *
 *   ConfigDB_GetValue    lê a sessão inteira como string
 *   JSON.parse           parseia tudo
 *   push
 *   JSON.stringify       re-serializa TUDO
 *   ConfigDB_CreateValue grava a string inteira de volta
 *
 * Isso é O(n²) no número de entradas. Este teste roda a conta de verdade, e os números do
 * commit vieram daqui:
 *
 *   1000 entradas ->   ~0,5 s no total,  ~98 MB de JSON processado
 *   5000 entradas ->  ~12   s no total, ~2,4 GB de JSON processado
 *
 * Com 5000 entradas cada linha custava ~2,4 ms da thread da interface. E o log da partida
 * nomad mostrou o balanceamento inicial gerando ~50 linhas por segundo: a esse ritmo o
 * registro do log sozinho engasga o jogo.
 *
 * Rodar:  node tools/test_log_custo.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

const ENTRADA = { ts: 0, level: "DEBUG", cat: "BALANCE",
                  msg: "fc=0 sol=0 cav=0 berry=0 tree=0 chicken=0" };

// ── O padrão ANTIGO: reserializa tudo a cada linha ─────────────────────────────────────
function custoQuadratico(n) {
	let store = "", bytes = 0;
	for (let i = 0; i < n; i++) {
		let arr = [];
		try { arr = store ? JSON.parse(store) : []; } catch (e) {}
		arr.push(Object.assign({}, ENTRADA, { ts: i }));
		if (arr.length > 5000) arr = arr.slice(arr.length - 5000);
		store = JSON.stringify(arr);
		bytes += store.length * 2;
	}
	return bytes;
}

// ── O padrão NOVO: array em memória, serializa no flush de 10s ─────────────────────────
function custoLinear(n, linhasPorFlush) {
	const arr = [];
	let bytes = 0;
	for (let i = 0; i < n; i++) {
		arr.push(Object.assign({}, ENTRADA, { ts: i }));
		if (arr.length > 5000) arr.shift();
		if ((i + 1) % linhasPorFlush === 0) bytes += JSON.stringify(arr).length;
	}
	return bytes;
}

console.log("o log nao pode custar mais que o mod");

// 10s de flush; a 5 linhas/s dá 50 linhas por flush. É o ritmo normal do mod.
const POR_FLUSH = 50;

for (const n of [1000, 5000]) {
	const antes = custoQuadratico(n);
	const depois = custoLinear(n, POR_FLUSH);
	const fator = antes / depois;
	console.log("   %d entradas: %s MB -> %s MB  (%sx menos)",
		n, (antes/1048576).toFixed(0), (depois/1048576).toFixed(1), fator.toFixed(0));
	check(n + " entradas: o novo processa ao menos 20x menos JSON",
		fator >= 20, fator.toFixed(0) + "x");
}

// A propriedade que importa não é "é mais rápido", é que o custo por linha para de crescer.
// Era isso que fazia o fim da partida ser muito pior que o começo.
const cq1 = custoQuadratico(1000) / 1000;
const cq5 = custoQuadratico(5000) / 5000;
check("no padrão antigo, o custo POR LINHA cresce com o tamanho do log",
	cq5 > cq1 * 3, (cq5/cq1).toFixed(1) + "x pior no fim da partida");

const cl1 = custoLinear(1000, POR_FLUSH) / 1000;
const cl5 = custoLinear(5000, POR_FLUSH) / 5000;
check("no novo, o custo por linha fica estável até o teto do buffer",
	cl5 < cl1 * 6, (cl5/cl1).toFixed(1) + "x");

// ── No código ──────────────────────────────────────────────────────────────────────────
console.log("\nno codigo");

const corpo = (function() {
	const i = panel.indexOf("function pudim_Log(level, catOrMsg, msgOrUndef)");
	return panel.slice(i, panel.indexOf("\n}\n", i));
})();

// Sem comentários: o comentário desta função DESCREVE o padrão antigo (é onde os números
// medidos ficam registrados), e proibir descrevê-lo empurraria a explicação para fora do
// código. Confere o que executa. É a terceira vez que esta armadilha aparece nos testes
// deste mod — ver test_api_inventada.js e test_abrigo_perto.js.
const corpoExec = corpo.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
check("a linha de log só empurra no array em memória",
	/g_PudimLogSessao\.push\(entry\);/.test(corpoExec));
check("e NÃO lê o ConfigDB a cada linha",
	corpoExec.indexOf("ConfigDB_GetValue") < 0);
check("nem faz JSON.parse a cada linha",
	corpoExec.indexOf("JSON.parse") < 0);
// Contra o corpo SEM comentários: a explicação da investigação vive dentro deste bloco e
// empurraria qualquer janela fixa para fora do alvo.
check("a serialização acontece só dentro do flush de 10s",
	/if \(entry\.ts - g_PudimLogLastSave > 10000\) \{[\s\S]*?JSON\.stringify\(g_PudimLogSessao\)/.test(corpoExec));
check("e o SaveChanges também",
	/if \(entry\.ts - g_PudimLogLastSave > 10000\) \{[\s\S]*?ConfigDB_SaveChanges\("user"\)/.test(corpoExec));
check("o array tem teto, senão a memória cresce sem limite numa partida longa",
	/if \(g_PudimLogSessao\.length > PUDIM_LOG_SESSAO_MAX\)\s*\n\s*g_PudimLogSessao\.shift\(\);/.test(panel));
check("o teto é declarado como constante",
	/const PUDIM_LOG_SESSAO_MAX = \d+;/.test(panel));
check("os números medidos ficam no código, não só neste teste",
	/2,4 GB de JSON processado/.test(panel));

// -- Teto em BYTES: nenhuma linha de config gigante ----------------------------------
//
// Investigacao dos fechamentos (01/09). Os oito desde 25/08 sao IDENTICOS no registro de
// erros do Windows:
//
//   modulo ucrtbase.dll, excecao 0xc0000409, deslocamento 0x11858
//
// que e o CRT abortando o processo de proposito, sempre no mesmo ponto. Nao e falta de
// memoria: o crashlog registra 17,6 GB livres.
//
// O que o mod fazia: 97% do user.cfg era log dele, e a maior LINHA unica do arquivo tinha
// 228.326 bytes. Isso esta muito fora do uso normal de um .cfg.
//
// NAO esta provado que era a causa, e o teste nao afirma que esta. O que ele garante e que
// o mod nao produz mais linhas desse tamanho — o resto e a proxima partida que diz.
console.log("\nteto em bytes do log persistido");

const BYTES_MAX = +/const PUDIM_LOG_BYTES_MAX = (\d+);/.exec(panel)[1];
check("ha um teto em bytes declarado", BYTES_MAX > 0, (BYTES_MAX/1024).toFixed(0) + " KB");
check("e ele e bem menor que a linha de 228 KB que apareceu no user.cfg",
	BYTES_MAX < 228326 / 4, (BYTES_MAX/1024).toFixed(0) + " KB vs 223 KB");
check("mas grande o bastante para uma partida util", BYTES_MAX >= 16384);

// Espelha o corte: enquanto passar do teto, joga fora um quarto das entradas mais antigas.
function cortar(n, bytesMax) {
	const arr = [];
	for (let i = 0; i < n; i++) arr.push(Object.assign({}, ENTRADA, { ts: i }));
	let texto = JSON.stringify(arr);
	let voltas = 0;
	while (texto.length > bytesMax && arr.length > 20) {
		arr.splice(0, Math.max(1, Math.floor(arr.length / 4)));
		texto = JSON.stringify(arr);
		voltas++;
	}
	return { bytes: texto.length, restantes: arr.length, voltas: voltas };
}

const r = cortar(5000, BYTES_MAX);
check("5000 entradas cabem no teto depois do corte",
	r.bytes <= BYTES_MAX, r.bytes + " bytes");
check("e sobra log de verdade, nao duas linhas",
	r.restantes >= 100, r.restantes + " entradas");
// Cortar de um em um refaria o stringify a cada volta — o custo quadratico que acabou de
// sair daqui. Um quarto por vez resolve em poucas voltas.
check("o corte converge em poucas voltas", r.voltas <= 12, r.voltas + " voltas");

const pequeno = cortar(50, BYTES_MAX);
check("log pequeno nao e cortado", pequeno.restantes === 50 && pequeno.voltas === 0);

check("o corte esta no codigo, dentro do flush",
	/while \(texto\.length > PUDIM_LOG_BYTES_MAX && g_PudimLogSessao\.length > 20\)/.test(panel));
check("e corta um quarto por vez, nao um por vez",
	/g_PudimLogSessao\.splice\(0, Math\.max\(1, Math\.floor\(g_PudimLogSessao\.length \/ 4\)\)\);/.test(panel));
check("a investigacao fica registrada no codigo, com o codigo de excecao",
	/0xc0000409/.test(panel) && /ucrtbase\.dll/.test(panel));
check("e esta escrito que a causa NAO esta provada",
	/NAO esta provado que era a causa/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
