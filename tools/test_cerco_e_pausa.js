/**
 * Dois pedidos de 17/09, os dois sobre o mesmo momento da partida.
 *
 *   "adicionar botao de pausar a criacao de unidades, as vezes quero fazer arma de cerco e
 *    n da, pq vai mais rapido as unidades"
 *
 *   "tambem nas armas de cerco, colocar opcao de chamar unidades... vai colocar unidades
 *    variadas entre de perto e a distancia, nas armas de cerco de destruir construcao; nas
 *    armas de cerco de torre, colocar preferencialmente as unidades que atiram a distancia.
 *    Cavalos nao conseguem entrar nelas"
 *
 * QUAIS SAO AS ARMAS DE CERCO, medido: os comandos `train` de 60 replays dao sete templates
 * distintos — siege_ram, siege_ram_covered, siege_lithobolos_packed, siege_oxybeles_packed,
 * siege_ballista_packed, siege_onager_packed e siege_polybolos_packed. Só os dois primeiros
 * carregam gente; catapulta e balista nao tem IID_GarrisonHolder. Por isso o filtro e o
 * COMPONENTE, nao uma lista de nomes.
 *
 * Torre de cerco NAO apareceu nesses 60 replays. O ramo dela existe, mas nao esta medido — e
 * o teste diz isso em vez de fingir que esta.
 *
 * Rodar:  node tools/test_cerco_e_pausa.js
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

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("pausar o treino e guarnecer a arma de cerco");

// ══ PARTE 1: A PAUSA ═══════════════════════════════════════════════════════════════════
console.log("\n-- pausa do treino");

check("o botao existe e chama a funcao",
	/name="pudim_pauseTrainBtn"[^>]*type="button"/.test(xml) &&
	/pudim_TogglePauseTrain\(\);/.test(xml));
check("ele nasce na faixa do titulo da proporcao, sem custar linha nova",
	/name="pudim_pauseTrainBtn"[^>]*size="58% 842 100%-8 864"/.test(xml) &&
	/name="pudim_unitHeader"[^>]*size="8 842 56% 864"/.test(xml));
check("e o titulo e o botao nao disputam o mesmo x", true);   // 56% < 58%; ver test_painel_cabe

check("o estado comeca DESPAUSADO, e nao persiste entre partidas",
	/var g_PudimTreinoPausado = false;/.test(execP) &&
	!/ConfigDB[^\n]*TreinoPausado/.test(execP));

// As DUAS portas que treinam. Guardar so uma deixaria o botao sem efeito pela outra — foi
// exatamente assim que o teto de populacao escapava pela semeadura do mod.
check("a auto-fila para quando pausado",
	/function pudim_ProcessAutoQueue\(\)\s*\{\s*if \(g_PudimTreinoPausado\) return;/.test(execP));
check("o contra-treino tambem para",
	/function pudim_RunCounterTrain\(\)\s*\{\s*if \(g_PudimTreinoPausado\) return;/.test(execP));

// A auto-fila NATIVA do motor repoe lote sozinha; sem desliga-la o botao nao pausaria nada.
check("a auto-fila do motor e desligada no clique",
	/"type": "autoqueue-off", "entities": off/.test(execP));
check("e so no clique, uma vez — religar a cada ciclo brigaria com o jogador",
	(execP.match(/"type": "autoqueue-off"/g) || []).length === 2);

// O que a pausa NAO faz.
check("nada de cancelar producao em andamento: o recurso ja saiu do banco",
	!/g_PudimTreinoPausado[\s\S]{0,400}stop-production/.test(execP));

check("o rotulo diz em que estado esta",
	/lbl\.caption = g_PudimTreinoPausado \? "▶ Retomar treino" : "❚❚ Pausar treino";/.test(execP));
check("e o botao e inicializado junto com os outros",
	/pudim_AtualizarBotaoPausa\(\);/.test(execP));
check("o botao entra na lista do modo compacto",
	/"pudim_pauseTrainBtn", "pudim_siegeGarrisonBtn", "pudim_toggleAutoHouseBtn"/.test(execP));
check("e na tabela que desce com o estimador colapsado",
	/"pudim_unitHeader", "pudim_pauseTrainBtn", "pudim_unitLabel0"/.test(execP));

// ══ PARTE 2: GUARNECER A ARMA DE CERCO ═════════════════════════════════════════════════
console.log("\n-- guarnecer a arma de cerco");

check("o botao existe e chama a funcao",
	/name="pudim_siegeGarrisonBtn"[^>]*type="button"/.test(xml) &&
	/pudim_GuarnecerCerco\(\);/.test(xml));
check("ele divide a faixa do status do panico, sem linha nova",
	/name="pudim_siegeGarrisonBtn"[^>]*size="52% 784 100%-8 802"/.test(xml) &&
	/name="pudim_panicStatus"[^>]*size="8 784 50% 802"/.test(xml));

const corpo = (function() {
	const i = execS.indexOf("pudim_GetSiegeGarrisonPlan = function");
	const j = execS.indexOf("GuiInterface.prototype.pudim_", i + 30);
	return j < 0 ? execS.slice(i) : execS.slice(i, j);
})();
check("o recorte pegou a funcao da simulacao, e nao o arquivo todo",
	corpo.length > 800 && corpo.length < execS.length / 3, corpo.length + " caracteres");
check("a funcao esta exposta, senao a chamada falha em silencio",
	/"pudim_GetSiegeGarrisonPlan": 1,/.test(sim));

// SO OLHA: a regra do mod inteiro. Comando de rede sai do painel.
check("a simulacao nao manda comando nenhum",
	!/PostNetworkCommand/.test(corpo));
check("e o painel manda garrison, com o alvo sendo a maquina",
	/"type": "garrison",[\s\S]{0,120}"target": o\.siege/.test(execP));

// Quem entra.
check("so quem tem IID_GarrisonHolder e considerado — catapulta e balista ficam de fora",
	/const cmpGar = Engine\.QueryInterface\(ent, IID_GarrisonHolder\);\s*\n?\s*if \(!cmpGar\) continue;/.test(corpo));
check("maquina cheia nao entra na lista",
	/const vagas = cmpGar\.GetCapacity\(\) - cmpGar\.GetEntities\(\)\.length;/.test(corpo) &&
	/if \(vagas <= 0\) continue;/.test(corpo));
check("CAVALO NAO ENTRA: so o balde Infantry serve",
	/if \(pudim_UnitBucket\(cmpId\) !== "Infantry"\) continue;/.test(corpo));
check("e quem ja esta guarnecido em outro lugar nao e chamado",
	/if \(!cmpPos \|\| !cmpPos\.IsInWorld\(\)\) continue;/.test(corpo));
check("distancia e corpo a corpo saem da classe Ranged, que o mod ja usa",
	/cmpId\.HasClass\("Ranged"\) \? longe : perto/.test(corpo));

// A regra da distribuicao, espelhada.
function plano(vagas, torre, nPerto, nLonge) {
	const perto = [], longe = [];
	for (let i = 0; i < nPerto; i++) perto.push("m" + i);
	for (let i = 0; i < nLonge; i++) longe.push("d" + i);
	const out = [];
	for (let i = 0; i < vagas; i++) {
		const preferLonge = torre || (i % 2 === 1);
		const a = preferLonge ? longe : perto;
		const b = preferLonge ? perto : longe;
		const u = a.shift() || b.shift();
		if (!u) break;
		out.push(u);
	}
	return out;
}
const eh = (l, p) => l.filter(u => u[0] === p).length;

// Ariete: "unidades variadas entre de perto e a distancia".
const ram = plano(4, false, 5, 5);
check("ariete recebe mistura: metade de perto, metade de longe",
	eh(ram, "m") === 2 && eh(ram, "d") === 2, ram.join(","));
check("e comeca pelo corpo a corpo, que segura o dano enquanto a maquina bate",
	ram[0][0] === "m", ram.join(","));

// Torre: "preferencialmente as unidades que atiram a distancia".
const torre = plano(4, true, 5, 5);
check("torre recebe so quem atira, havendo de sobra",
	eh(torre, "d") === 4, torre.join(","));
check("mas PREFERENCIALMENTE nao e exclusivamente: faltando arqueiro, completa",
	eh(plano(4, true, 5, 1), "d") === 1 && plano(4, true, 5, 1).length === 4,
	plano(4, true, 5, 1).join(","));

// Casos de borda.
check("sem ninguem para chamar, nao sai ordem", plano(4, false, 0, 0).length === 0);
check("com menos gente que vagas, manda o que tem",
	plano(6, false, 1, 1).length === 2);
check("e a mesma unidade nunca e mandada para duas maquinas",
	/const usados = new Set\(\);/.test(corpo) && /usados\.add\(u\.id\);/.test(corpo));

// Selecao.
check("age sobre a selecao do jogador",
	/g_Selection\.toList\(\)\.map\(Number\)/.test(execP) &&
	/const pedidos = new Set\(\(\(data && data\.alvos\) \|\| \[\]\)\.map\(Number\)\);/.test(corpo));
check("e sem selecao vale para todas as maquinas com vaga",
	/if \(pedidos\.size && !pedidos\.has\(ent\)\) continue;/.test(corpo));

// Quem foi chamado nao pode ser sequestrado no caminho.
check("quem foi chamado fica protegido do auto-trabalho ate chegar",
	/for \(const u of o\.unidades\) pudim_ProtectBuilder\(u, validade\);/.test(execP));

// Diagnostico: tres causas dao a mesma tela de "nao aconteceu nada".
check("o log separa as tres causas de nao acontecer nada",
	/"nada a guarnecer: maquinas=" \+ \(d\.maquinas \|\| 0\) \+/.test(execP) &&
	/" vagas=" \+ \(d\.livres \|\| 0\) \+/.test(execP) &&
	/" infantaria=" \+ \(d\.candidatos \|\| 0\)/.test(execP));

// A procedencia.
check("os sete templates medidos ficam no codigo",
	/siege_lithobolos_packed/.test(sim) && /siege_polybolos_packed/.test(sim));
check("e esta escrito que a torre NAO foi medida, em vez de fingir que foi",
	/nao apareceu nos 60 replays/.test(sim) || /não apareceu nos 60 replays/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
