/**
 * O teto de campos trava a construção, não a função inteira. E quem vai para a fazenda é
 * aldeão; exército só em último caso.
 *
 * Relatos de 31/08:
 *
 *   "no final ficou extremamente desbalanceado os recursos"
 *   "limitado a 9 campos, mas eles não estavam com capacidade total... no final tinham
 *    apenas 15 trabalhadores"
 *   "sempre na fazenda a preferencia é por aldeões/plebeus... só colocar exercito em
 *    ultimo caso"
 *
 * O log da partida mostra a causa do primeiro repetida 33 vezes seguidas:
 *
 *   fc=9 nfc=0 ncap=0 tg=0 oci0=0 esc= cfm=0 fwt=0 df=0 ... reason=limit action=none
 *
 * De 319s a 1292s — dezesseis minutos. TUDO zerado, inclusive `esc=`, porque o `return` do
 * teto saía antes de a função calcular qualquer coisa. Nove campos existiam, com 45 vagas
 * (9 × 5), e apenas 15 trabalhadores neles.
 *
 * A função faz três coisas, e o teto só diz respeito a uma:
 *
 *   build   erguer campo novo    <- só isto o teto limita
 *   assist  construtor para uma fundação de campo já aberta
 *   assign  mover trabalhador para vaga em campo existente
 *
 * `assign` era o que fecharia as 30 vagas ociosas, e estava morto junto. Foi também por
 * isso que a escassez do commit anterior não apareceu no log: ela é calculada depois deste
 * ponto e nunca era alcançada.
 *
 * O teto de 9 é decisão do jogador (19/08) e não muda: 15 campos deixaram 7904 de comida
 * parada no banco. O que muda é o alcance do freio.
 *
 * Rodar:  node tools/test_fazenda_teto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const bruto = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
// Sem comentários: eles citam o código antigo para explicar o bug, e um teste que proíbe
// descrever o defeito empurra a explicação para fora do arquivo.
const sim = bruto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("o teto trava a obra, nao a funcao");

const MAX = +/const PUDIM_MAX_FARMS = (\d+);/.exec(sim)[1];
const CAP = +/const PUDIM_FIELD_CAPACITY = (\d+);/.exec(sim)[1];

// O teto continua sendo o que o jogador decidiu. Se alguém "resolver" o desbalanceamento
// subindo-o, este teste avisa — a decisão dele tem motivo registrado.
check("o teto de campos continua em 9, como o jogador decidiu", MAX === 9, MAX);
check("e a capacidade do campo é a real do template", CAP === 5, CAP);
check("o motivo do teto continua escrito, para ninguém 'consertar' subindo",
	/7904 de comida parada|Voltou para 9 por decisão do jogador/.test(bruto));

// ── O teto virou condição, não saída ──────────────────────────────────────────────────
check("o teto virou uma condição, não um return",
	/const podeErguerCampo = farmCount < PUDIM_MAX_FARMS;/.test(sim));
check("e nenhum return solta 'limit' antes da conta",
	!/if \(farmCount >= PUDIM_MAX_FARMS[^\n]*return result;/.test(sim));
check("o freio age só na hora de erguer",
	/if \(!podeErguerCampo \|\| !hasWoodForFarm\) \{[\s\S]{0,140}?return result;\s*\}\s*\n\s*result\.action = "build";/.test(sim));
check("sem madeira também deixou de derrubar a função — mover trabalhador não custa madeira",
	!/if \(!hasWoodForFarm\) \{ result\._dbg\.reason = "nowood"; return result; \}/.test(sim));

// Sem CC continua sendo saída de verdade: não há de onde medir distância nem onde ancorar.
check("sem centro cívico ainda sai cedo, e com motivo próprio",
	/if \(ccPositions\.length === 0\) \{ result\._dbg\.reason = "sem_cc"; return result; \}/.test(sim));

// ── assign e assist têm de vir ANTES do freio ──────────────────────────────────────────
// É a ordem no arquivo que garante que eles rodem no teto. Se o freio subir, volta tudo.
const iAssign = sim.indexOf('result.action = "assign"');
const iAssist = sim.indexOf('result.action = "assist"');
const iFreio = sim.indexOf("if (!podeErguerCampo || !hasWoodForFarm)");
const iBuild = sim.indexOf('result.action = "build"');
check("assign vem antes do freio", iAssign > 0 && iAssign < iFreio,
	iAssign + " < " + iFreio);
check("assist também", iAssist > 0 && iAssist < iFreio);
check("e o build vem depois", iBuild > iFreio);

// ── A conta que o relato dá ────────────────────────────────────────────────────────────
// "limitado a 9 campos, mas eles não estavam com capacidade total... apenas 15 trabalhadores"
const VAGAS = MAX * CAP;
check("nove campos comportam 45 trabalhadores", VAGAS === 45, VAGAS);
check("e com 15 sobravam 30 vagas que assign preencheria", VAGAS - 15 === 30);

// ── Aldeão na fazenda; exército em último caso ─────────────────────────────────────────
console.log("\naldeao na fazenda, exercito por ultimo");

// Espelha a ordenação real: chave primária é ser soldado, secundária a ordem original
// (ocioso antes de coletor, que é como o pool foi montado).
function ordenar(pool) {
	const orig = {};
	pool.forEach((e, i) => { orig[e.id] = i; });
	return pool.slice().sort((a, b) => {
		const sa = a.soldado ? 1 : 0, sb = b.soldado ? 1 : 0;
		if (sa !== sb) return sa - sb;
		return orig[a.id] - orig[b.id];
	}).map(e => e.id);
}
const u = (id, soldado) => ({ id: id, soldado: soldado });

// O pool chega como "ociosos primeiro, depois quem colhe madeira". No caso relatado, o
// soldado ocioso vinha antes do plebeu que colhia.
const POOL = [u("soldado_ocioso", true), u("plebeu_ocioso", false),
              u("soldado_madeira", true), u("plebeu_madeira", false)];
check("todo aldeão vem antes de todo soldado",
	ordenar(POOL).join(",") === "plebeu_ocioso,plebeu_madeira,soldado_ocioso,soldado_madeira",
	ordenar(POOL).join(","));
check("mesmo o soldado ocioso perde para o aldeão que está colhendo",
	ordenar(POOL).indexOf("plebeu_madeira") < ordenar(POOL).indexOf("soldado_ocioso"));

// Dentro de cada grupo, a ordem antiga sobrevive: ocioso custa zero coleta.
check("entre aldeões, o ocioso continua vindo primeiro",
	ordenar(POOL).indexOf("plebeu_ocioso") < ordenar(POOL).indexOf("plebeu_madeira"));
check("e entre soldados também",
	ordenar(POOL).indexOf("soldado_ocioso") < ordenar(POOL).indexOf("soldado_madeira"));

// "Último caso" é último, não "nunca": com déficit e só soldado disponível, ele vai.
const SO_SOLDADO = [u("s1", true), u("s2", true)];
check("só havendo soldado, ele vai mesmo — 'último caso' não é 'nunca'",
	ordenar(SO_SOLDADO).length === 2);
// E o inverso: havendo aldeão de sobra, nenhum soldado é chamado.
const COM_SOBRA = [u("s1", true), u("p1", false), u("p2", false), u("p3", false)];
const chamados = ordenar(COM_SOBRA).slice(0, 3);   // déficit de 3
check("havendo aldeão suficiente, nenhum soldado é chamado",
	chamados.indexOf("s1") < 0, chamados.join(","));

check("a classe usada é a mesma do resto do mod",
	/cid\.HasClass\("CitizenSoldier"\) \|\| cid\.HasClass\("FastMoving"\)/.test(sim));
check("a ordenação é estável — sem isso o desempate dançaria a cada tique",
	/return ordemOriginal\[a\] - ordemOriginal\[b\];/.test(sim));
check("e o log diz quantos soldados havia no pool",
	/result\._dbg\.sold = poolFazenda\.filter\(ehSoldado\)\.length;/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
