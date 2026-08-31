/**
 * O abrigo é o mais perto de quem está fugindo — não o primeiro da lista.
 *
 * Relato de 31/08:
 *
 *   "agora poucos, os coletores de madeira viram um perigo, ao inves de irem para casas
 *    proximas, andaram pra longe.. o trabalhador, sempre tem que procurar uma casa mais
 *    proxima que não esteja cheia da posicao dele"
 *
 * A causa era uma função sem argumentos:
 *
 *   const pickWorkerShelter = () =>
 *       safeHouses.find(s => s.freeSlots > 0) || ...
 *
 * `.find` devolve o PRIMEIRO da lista, na ordem em que a simulação empilhou as entidades.
 * Todo trabalhador em pânico ia para a mesma casa até ela encher, estivesse a dez metros ou
 * do outro lado da base — um lenhador na mata ganhava a casa que por acaso viesse primeiro.
 * Sob ataque, atravessar a base é pior que não abrigar.
 *
 * O detalhe que dói: a simulação JÁ mandava `x`/`z` de cada trabalhador exatamente para
 * isto, e o comentário dela dizia "sem ela o painel não tem como escolher o abrigo MAIS
 * PERTO". O painel é que nunca usou. Mesma família do armazém que media pelo centroide
 * enquanto o detector media por trabalhador: o dado certo estava lá, ninguém leu.
 *
 * Rodar:  node tools/test_abrigo_perto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

// ── Extrair a função real e rodá-la ────────────────────────────────────────────────────
// Espelhar a regra num teste já me traiu antes: o espelho reproduzia o erro junto com o
// código e passava verdinho. Aqui roda o que está no arquivo.
function extrairArrow(nome) {
	const ini = panel.indexOf("const " + nome + " = ");
	if (ini < 0) throw new Error("não encontrei " + nome);
	let i = panel.indexOf("{", ini), nivel = 0;
	for (; i < panel.length; i++) {
		if (panel[i] === "{") nivel++;
		else if (panel[i] === "}" && --nivel === 0) return panel.slice(ini, i + 1) + ";";
	}
	throw new Error("chaves não fecham em " + nome);
}
const ctx = {};
vm.createContext(ctx);
vm.runInContext(extrairArrow("maisPerto") + "\nthis.maisPerto = maisPerto;", ctx);
const maisPerto = ctx.maisPerto;

const casa = (id, x, z, vagas) => ({ id: id, x: x, z: z, freeSlots: vagas });

console.log("o abrigo mais perto, com vaga");

// ── O caso relatado: lenhador longe, casas espalhadas ──────────────────────────────────
// A ordem da lista é a que a simulação produz — id crescente, não distância. A casa 1 vem
// primeiro e era sempre ela que ganhava.
const CASAS = [casa(1, 300, 300, 5), casa(2, 60, 55, 5), casa(3, 200, 180, 5)];
const lenhador = { x: 50, z: 50 };
check("o lenhador vai para a casa ao lado dele, não para a primeira da lista",
	maisPerto(CASAS, lenhador.x, lenhador.z).id === 2,
	"escolheu " + maisPerto(CASAS, lenhador.x, lenhador.z).id);
check("e quem está do outro lado vai para a de lá",
	maisPerto(CASAS, 305, 295).id === 1);
check("a do meio serve quem está no meio",
	maisPerto(CASAS, 195, 185).id === 3);

// ── Cheia não conta, por mais perto que esteja ─────────────────────────────────────────
// "uma casa mais proxima que não esteja cheia" — as duas condições juntas.
const COM_CHEIA = [casa(1, 51, 51, 0), casa(2, 400, 400, 5)];
check("casa colada mas cheia é ignorada",
	maisPerto(COM_CHEIA, 50, 50).id === 2);
check("todas cheias devolve nada, para o chamador tentar a faixa seguinte",
	maisPerto([casa(1, 51, 51, 0), casa(2, 60, 60, 0)], 50, 50) === null);
check("lista vazia também", maisPerto([], 50, 50) === null);

// ── Capacidade é consumida ao longo do pânico ──────────────────────────────────────────
// O laço decrementa freeSlots depois de despachar. Sem isso, vinte trabalhadores seriam
// mandados para a mesma casa de cinco vagas.
const LOTACAO = [casa(1, 50, 50, 2), casa(2, 90, 90, 2)];
const destinos = [];
for (let i = 0; i < 4; i++) {
	const s = maisPerto(LOTACAO, 48, 48);
	if (!s) break;
	destinos.push(s.id);
	s.freeSlots--;
}
check("quatro fugindo enchem a mais perto e transbordam para a seguinte",
	destinos.join(",") === "1,1,2,2", destinos.join(","));
check("e o quinto não acha vaga", maisPerto(LOTACAO, 48, 48) === null);
check("o painel decrementa a vaga de verdade",
	/shelter\.freeSlots--;/.test(panel));

// ── Sem posição, não quebra ────────────────────────────────────────────────────────────
// Unidade fora do mundo (embarcada, em transição) chega com x null. Melhor abrigar em
// qualquer lugar que estourar no meio do pânico.
check("unidade sem posição ainda recebe um abrigo",
	maisPerto(CASAS, null, null) !== null);
check("e abrigo sem posição não é escolhido por acidente de conta",
	maisPerto([{ id: 9, freeSlots: 3 }], 50, 50).id === 9);

// ── As faixas de prioridade continuam ──────────────────────────────────────────────────
// Distância pura mandaria gente para a casa colada no inimigo por ser dois metros mais
// perto. Seguro antes de inseguro, casa antes de CC; DENTRO da faixa, o mais perto.
console.log("\nas faixas de prioridade sobrevivem");

check("seguro vem antes de inseguro, e casa antes de CC",
	/maisPerto\(safeHouses, x, z\) \|\|\s*\n\s*maisPerto\(safeCCs, x, z\) \|\|\s*\n\s*maisPerto\(anyHouses, x, z\) \|\|\s*\n\s*maisPerto\(anyCCs, x, z\)/.test(panel));
check("e está escrito por que a distância não atropela a faixa",
	/casa colada no inimigo so por|colada no inimigo/.test(panel));

// ── A posição chega de verdade nos dois lados ──────────────────────────────────────────
console.log("\na posicao chega ate quem escolhe");

check("o trabalhador leva a posição dele na chamada",
	/pickWorkerShelter\(worker\.x, worker\.z\)/.test(panel));
check("e a simulação a manda",
	/x: wp2 \? wp2\.x : null, z: wp2 \? wp2\.y : null/.test(sim));

// O soldado nem posição recebia — mesma regra, mesma correção, e é a torre mais perto que
// importa quando ele está sob fogo.
check("o soldado também leva a posição",
	/pickSoldierShelter\(soldier\.x, soldier\.z\)/.test(panel));
check("e a simulação passou a mandá-la para ele",
	/result\.atRiskSoldiers\.push\(\{ id: ent,\s*\n\s*x: sp2 \? sp2\.x : null, z: sp2 \? sp2\.y : null \}\);/.test(sim));

// A regressão exata: função de escolha sem argumento.
check("nenhuma escolha de abrigo volta a ser sem argumento",
	!/pickWorkerShelter\(\)/.test(panel) && !/pickSoldierShelter\(\)/.test(panel));
// Sem comentários: a explicação do bug cita o código velho, e proibir descrevê-lo empurraria
// a explicação para fora do arquivo. O mesmo tropeço aconteceu em test_api_inventada.js.
const codigo = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
check("e nenhuma volta ao .find, que devolve o primeiro da lista",
	!/safeHouses\.find\(/.test(codigo) && !/soldierShelters\.find\(/.test(codigo));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
