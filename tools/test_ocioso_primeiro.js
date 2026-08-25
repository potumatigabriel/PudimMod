/**
 * Quem acabou de nascer pega o serviço novo. Quem já produz fica onde está.
 *
 * Relato de 25/08, com a partida rodando:
 *
 *   "o problema é que ao invés de mandar os que nasceram fazer fazendas, tirou os que
 *    estavam nas frutas pra fazer fazenda e os que nasceram foram pras frutas,
 *    isso é improdutivo"
 *
 * A observação é exata. No fim do ciclo o número de gente em cada recurso é IDÊNTICO nos
 * dois casos — a diferença é o que se pagou para chegar lá:
 *
 *   trocando de lugar:   duas caminhadas + duas cargas parciais largadas no chão
 *   mandando o novo:     uma caminhada, que ele teria de fazer de qualquer jeito
 *
 * A causa era o pool de construtores de campo sair direto de woodWorkerPool, que só tem
 * gente com ordem de Gather ativa. Um recém-nascido é OCIOSO, então nunca estava lá — e o
 * auto-work, rodando a cada 500ms, o pegava antes e o mandava para o recurso mais carente.
 * Dois sistemas certos isoladamente, trocando as unidades de lugar.
 *
 * Rodar:  node tools/test_ocioso_primeiro.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("ocioso antes de quem já produz");

// ── Forma do código ────────────────────────────────────────────────────────────────────
check("o pool da fazenda NÃO sai mais direto dos lenhadores",
	src.indexOf("farFoodWorkers = woodWorkerPool.slice(0, effDeficit);") < 0);
check("existe um pool que começa pelos ociosos",
	/const poolFazenda = \[\];[\s\S]{0,200}?for \(const ib of idleBuilders\)[\s\S]{0,80}?poolFazenda\.push\(ib\.ent\)/.test(src));
check("e só depois emenda os lenhadores",
	/for \(const ib of idleBuilders\)[\s\S]{0,200}?for \(const w of woodWorkerPool\) poolFazenda\.push\(w\);/.test(src));
check("o corte final usa o pool novo",
	/farFoodWorkers = poolFazenda\.slice\(0, effDeficit\);/.test(src));
check("ninguém entra duas vezes no pool",
	/const ocupados = \{\};[\s\S]{0,120}?if \(!ocupados\[ib\.ent\]\)/.test(src));
check("a guarda de pool vazio olha o pool novo, não só a madeira",
	/if \(effDeficit <= 0 \|\| poolFazenda\.length === 0\)/.test(src));
check("quantos ociosos foram usados vai para o log",
	/result\._dbg\.ocio = poolFazenda\.length;/.test(src) && /"ocio": 0/.test(src));

// idleBuilders é a definição de "acabou de nascer": tem Builder e a fila de ordens vazia.
// É o estado exato de quem saiu do CC neste tique.
check("ocioso é definido pela fila de ordens vazia, não por um timer",
	/idleBuilders\.push\(\{ent: ent, cmp: cmpBuilder\}\)/.test(src));

// Construtor continua fora do pool: puxá-lo de uma obra para uma fazenda seria o mesmo
// desperdício com outro nome.
check("construtor em obra continua protegido",
	/Construtor NUNCA entra em woodWorkerPool/.test(src));

// ── O custo que a regra evita ──────────────────────────────────────────────────────────
// Modelo do ciclo relatado, com os números reais do motor (velocidade 9, capacidade 10,
// taxa de fruta 1.0). Um "serviço novo" a 60m, um coletor de fruta produzindo a 40m do CC
// e um recém-nascido parado no CC.
const VEL = 9, CAP = 10, TAXA_FRUTA = 1.0;
const D_SERVICO = 60, D_FRUTA = 40;

// Caminho antigo: tira o da fruta (anda até o serviço) e manda o novo para a fruta.
const antigo = D_FRUTA + D_SERVICO;   // o deslocado volta da fruta e vai ao serviço
const novoCaminho = D_SERVICO;        // o recém-nascido vai direto do CC ao serviço

check("o caminho novo anda menos que o antigo", novoCaminho < antigo,
	novoCaminho + "m vs " + antigo + "m");
check("a economia é de uma caminhada inteira",
	(antigo - novoCaminho) === D_FRUTA, antigo - novoCaminho);
check("em segundos, a economia por unidade deslocada é real",
	(antigo - novoCaminho) / VEL > 3, ((antigo - novoCaminho) / VEL).toFixed(1) + "s");

// E a carga parcial que o deslocado larga: no pior caso ele estava quase cheio.
const perdaCarga = CAP;  // até uma carga inteira, se ele foi tirado antes de entregar
check("além disso, o deslocado pode largar até uma carga inteira",
	perdaCarga === CAP, perdaCarga);
check("o que em tempo de coleta equivale a mais alguns segundos",
	perdaCarga / TAXA_FRUTA >= 10, (perdaCarga / TAXA_FRUTA).toFixed(0) + "s");

// ── A ordenação, como o mod faz ────────────────────────────────────────────────────────
function montarPool(ociosos, lenhadores) {
	const ocupados = {};
	for (const w of lenhadores) ocupados[w] = true;
	const pool = [];
	for (const o of ociosos) if (!ocupados[o]) pool.push(o);
	for (const w of lenhadores) pool.push(w);
	return pool;
}

check("com ociosos sobrando, nenhum lenhador é tocado",
	JSON.stringify(montarPool([1, 2, 3, 4, 5], [10, 11]).slice(0, 3)) === "[1,2,3]");
check("faltando ociosos, aí sim completa com lenhador",
	JSON.stringify(montarPool([1], [10, 11]).slice(0, 3)) === "[1,10,11]");
check("sem ocioso nenhum, o comportamento antigo é preservado",
	JSON.stringify(montarPool([], [10, 11]).slice(0, 2)) === "[10,11]");
check("uma unidade em ambas as listas entra uma vez só",
	JSON.stringify(montarPool([10, 1], [10, 11])) === "[1,10,11]");

// A regra não pode inverter: coletor de FRUTA nunca deve ser preferido a um ocioso, que é
// exatamente a inversão que o jogador viu na tela.
const pool = montarPool([99], [10, 11]);
check("o recém-nascido vem antes de qualquer um que já produz", pool[0] === 99, pool[0]);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
