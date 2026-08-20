/**
 * Testa o rally pós-obra extraindo o código REAL de gui/session/pudim_panel.js.
 *
 * O bug que motivou o rally: o construtor terminava o armazém na floresta B e caía no
 * despacho genérico, que o mandava de volta para a floresta A. O armazém ficava pronto e
 * sem ninguém entregando nele.
 *
 * Também cobre o `specific` do resourceType: UnitAI FINDINGNEWTARGET escolhe o próximo alvo
 * com `type.specific == resourceType.specific`; mandar só { generic } faz o coletor parar
 * depois de esvaziar o primeiro alvo.
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const SRC = path.join(__dirname, "..", "gui", "session", "pudim_panel.js");
const src = fs.readFileSync(SRC, "utf8");

const start = src.indexOf("var g_PudimDropsiteRally = {};");
const endMark = "\treturn taken;\n}";
const end = src.indexOf(endMark, start);
if (start < 0 || end < 0) {
	console.error("FALHA: não achei o bloco do rally em pudim_panel.js");
	process.exit(1);
}
const block = src.slice(start, end + endMark.length);

const posted = [];
const logged = [];
const sandbox = {
	Engine: { PostNetworkCommand: c => posted.push(c) },
	pudim_Log: (lvl, tag, msg) => logged.push(tag + ": " + msg),
	Date: Date,
	Math: Math,
	Object: Object,
	// Fundacoes de dropsite do mod que ainda estao de pe (id -> {x,z}).
	g_PudimDropsiteFoundationPos: {}
};
vm.createContext(sandbox);
vm.runInContext(block, sandbox);

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("rally pós-obra");

// 1. Construtores rallyados vão para a âncora, não para o despacho genérico.
sandbox.pudim_SetRally([11, 12, 13], 809.4, 170.2, "wood");
let taken = sandbox.pudim_ApplyRally([{ id: 11 }, { id: 12 }, { id: 99 }]);
check("só os construtores da obra são reclamados",
	!!taken[11] && !!taken[12] && !taken[99], JSON.stringify(taken));
check("uma única ordem agrupada para a âncora", posted.length === 1, posted.length);
check("ordem é gather-near-position na âncora",
	posted[0].type === "gather-near-position" &&
	Math.round(posted[0].x) === 809 && Math.round(posted[0].z) === 170,
	JSON.stringify(posted[0]));
check("entities = os 2 ociosos, não o terceiro",
	posted[0].entities.length === 2 && posted[0].entities.indexOf(99) === -1,
	JSON.stringify(posted[0].entities));

// 2. specific presente e correto — sem ele o coletor para no primeiro alvo esgotado.
check("resourceType.generic = wood", posted[0].resourceType.generic === "wood");
check("resourceType.specific = tree", posted[0].resourceType.specific === "tree",
	posted[0].resourceType.specific);
check("resourceTemplate é string (UnitAI chama template.indexOf)",
	typeof posted[0].resourceTemplate === "string");

// 3. O rally é consumido: repetir o ciclo não reenvia ordem para os mesmos.
posted.length = 0;
taken = sandbox.pudim_ApplyRally([{ id: 11 }, { id: 12 }]);
check("rally consumido não reenvia", posted.length === 0 && Object.keys(taken).length === 0);

// 4. Quem ainda não ficou ocioso mantém o rally guardado para o ciclo seguinte.
posted.length = 0;
taken = sandbox.pudim_ApplyRally([{ id: 13 }]);
check("construtor que só agora ficou ocioso é atendido depois",
	posted.length === 1 && posted[0].entities[0] === 13, JSON.stringify(posted));

// 5. Duas obras distintas geram duas ordens distintas (não mistura florestas).
posted.length = 0;
sandbox.pudim_SetRally([21], 100, 100, "wood");
sandbox.pudim_SetRally([22], 400, 400, "food");
sandbox.pudim_ApplyRally([{ id: 21 }, { id: 22 }]);
check("âncoras diferentes não são agrupadas", posted.length === 2, posted.length);
const foodCmd = posted.find(c => c.resourceType.generic === "food");
check("food usa specific=fruit", foodCmd && foodCmd.resourceType.specific === "fruit",
	foodCmd && foodCmd.resourceType.specific);

// 6. Rally vencido é descartado — âncora velha não deve puxar ninguém.
posted.length = 0;
sandbox.pudim_SetRally([31], 700, 700, "wood");
sandbox.g_PudimDropsiteRally[31].until = Date.now() - 1;
taken = sandbox.pudim_ApplyRally([{ id: 31 }]);
check("rally expirado não envia ordem", posted.length === 0 && !taken[31]);

// 7. Entrada inválida não cria rally fantasma.
posted.length = 0;
sandbox.pudim_SetRally([41], undefined, 10, "wood");
sandbox.pudim_SetRally([42], 10, 10, null);
taken = sandbox.pudim_ApplyRally([{ id: 41 }, { id: 42 }]);
check("âncora/recurso inválido é ignorado", posted.length === 0 && Object.keys(taken).length === 0);

// 8. Rally espera a obra sair do chao.
// O construtor pode aparecer ocioso por um instante sem a obra ter andado; era isso que
// arrancava gente da fundacao e criava o vaivem sobre o celeiro (log de 19/08, a obra de
// (661,816) passou 79s sem sair com 4 construtores e a comida caiu a zero).
posted.length = 0;
sandbox.g_PudimDropsiteFoundationPos = { 900: { x: 300, z: 300 } };
sandbox.pudim_SetRally([51], 310, 305, "wood", 300, 300);
taken = sandbox.pudim_ApplyRally([{ id: 51 }]);
check("fundacao de pe segura o rally", posted.length === 0 && !taken[51], JSON.stringify(posted));

// A obra some da lista quando termina (ou morre) — ai o rally libera.
sandbox.g_PudimDropsiteFoundationPos = {};
taken = sandbox.pudim_ApplyRally([{ id: 51 }]);
check("obra concluida libera o rally", posted.length === 1 && !!taken[51], JSON.stringify(posted));
check("o destino continua sendo a ancora, nao a obra",
	Math.round(posted[0].x) === 310 && Math.round(posted[0].z) === 305,
	JSON.stringify(posted[0]));

// Tolerancia de 10m: a fundacao assenta na grade, entao nao cai exatamente no ponto pedido.
posted.length = 0;
sandbox.g_PudimDropsiteFoundationPos = { 901: { x: 306, z: 304 } }; // 7.2m do pedido
sandbox.pudim_SetRally([52], 400, 400, "wood", 300, 300);
taken = sandbox.pudim_ApplyRally([{ id: 52 }]);
check("fundacao deslocada pela grade ainda segura", posted.length === 0 && !taken[52]);

// Obra de OUTRO lugar nao pode segurar este rally.
posted.length = 0;
sandbox.g_PudimDropsiteFoundationPos = { 902: { x: 800, z: 800 } };
taken = sandbox.pudim_ApplyRally([{ id: 52 }]);
check("obra distante nao segura o rally", posted.length === 1 && !!taken[52]);

// Rally antigo, sem posicao de obra, nao pode travar para sempre.
posted.length = 0;
sandbox.g_PudimDropsiteFoundationPos = { 903: { x: 10, z: 10 } };
sandbox.pudim_SetRally([53], 500, 500, "wood");
taken = sandbox.pudim_ApplyRally([{ id: 53 }]);
check("rally sem posicao de obra nao trava", posted.length === 1 && !!taken[53]);
sandbox.g_PudimDropsiteFoundationPos = {};

// 9. Tabela de subtipos bate com simulation/data/resources/*.json.
const esperado = { wood: "tree", food: "fruit", stone: "rock", metal: "ore" };
// `const` do bloco não vira propriedade do sandbox: lê de dentro do contexto.
const tabela = vm.runInContext("PUDIM_RES_SPECIFIC", sandbox);
let tabelaOk = true;
for (const k in esperado)
	if (tabela[k] !== esperado[k]) tabelaOk = false;
check("PUDIM_RES_SPECIFIC bate com os resources/*.json", tabelaOk, JSON.stringify(tabela));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
