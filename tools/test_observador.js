/**
 * Observador vê todos os jogadores, agrupados por equipe.
 *
 * Pedido de 06/09: "tambem quando sou observador, mostrar os status de todos os jogadores,
 * separados por equipe".
 *
 * A barra de aliados já existia e simplesmente não aparecia para quem assiste: a primeira
 * linha de pudim_GetAllyStats era `if (!cmpPlayerManager || !cmpPlayer) return []`, e sem
 * jogador (assistindo sem seguir ninguém) não há cmpPlayer. A falta de jogador DESLIGAVA a
 * barra; agora é ela que LIGA o modo observador.
 *
 * Nada foi chutado — conferido no disco, em mods instalados que rodam contra este motor:
 *
 *   g_IsObserver                 autociv, moderngui e localratings usam essa global
 *   GetTeam() em IID_Diplomacy   QueryPlayerIDInterface(player, IID_Diplomacy).GetTeam()
 *   equipe 0-based, -1 = nenhuma  `state.team != -1 ? state.team + 1 : ""`
 *
 * Rodar:  node tools/test_observador.js
 */
"use strict";
const fs = require("fs");
// A cópia de trabalho é CRLF; ver tools/test_fim_de_linha.js.
const _pudimLerOriginal = fs.readFileSync;
fs.readFileSync = function() {
	const r = _pudimLerOriginal.apply(fs, arguments);
	return typeof r === "string" ? r.split("\r\n").join("\n") : r;
};
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const barra = fs.readFileSync(path.join(base, "gui", "session", "pudim_ally_bar.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
const execB = barra.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("observador ve todos, por equipe");

// ── A simulação ────────────────────────────────────────────────────────────────────────
check("a falta de jogador liga o modo observador, não devolve lista vazia",
	/const observando = !cmpPlayer \|\| !!\(args && args\.todos\);/.test(execS));
// Observador SEGUINDO um jogador chega na simulação com o id dele: cmpPlayer existe, e sem
// este segundo caminho a barra mostraria os aliados daquele jogador em vez de todo mundo —
// falharia justamente enquanto se acompanha alguém, que é o uso normal de quem assiste.
check("e o painel diz que está observando, porque só o cliente sabe disso",
	/Engine\.GuiInterfaceCall\("pudim_GetAllyStats", \{ "todos": observando \}\)/.test(execB));
// A regressão que importa: se o return vazio voltar, a barra some para quem assiste.
check("e o return vazio por falta de jogador NÃO existe mais",
	!/if \(!cmpPlayerManager \|\| !cmpPlayer\) return \[\];/.test(execS));
check("sem PlayerManager continua devolvendo vazio — aí não há o que mostrar",
	/if \(!cmpPlayerManager\) return \[\];/.test(execS));

check("observando entra todo jogador; jogando, a regra de aliado não muda",
	/const entra = observando\s*\n\s*\? !!cmpAlly\s*\n\s*: !!\(cmpAlly && cmpDiplomacy && \(cmpDiplomacy\.IsMutualAlly\(i\) \|\| i === player\)\);/.test(execS));

check("a equipe vem de IID_Diplomacy, não de IID_Player",
	/const cmpDipAlly = QueryPlayerIDInterface\(i, IID_Diplomacy\);/.test(execS) &&
	/"team": \(cmpDipAlly && cmpDipAlly\.GetTeam\) \? cmpDipAlly\.GetTeam\(\) : -1,/.test(execS));
check("e a procedência disso está escrita, com quem foi conferido",
	/autociv e moderngui usam/.test(sim));

// Observando não há "meus inimigos": a varredura de quem está sob ataque passa a olhar
// todos, senão nenhum jogador apareceria como atacado na tela de quem assiste.
check("a varredura de ataques cobre todos os jogadores no modo observador",
	/if \(observando\) \{\s*\n\s*globalEnemies = \[\];\s*\n\s*for \(let p = 1; p < cmpPlayerManager\.GetNumPlayers\(\); \+\+p\) globalEnemies\.push\(p\);/.test(execS));

// ── O painel ───────────────────────────────────────────────────────────────────────────
check("usa a global do jogo, não um estado próprio",
	/const observando = \(typeof g_IsObserver !== "undefined"\) && !!g_IsObserver;/.test(execB));
check("e tolera a global não existir, para não quebrar em contexto sem ela",
	/typeof g_IsObserver !== "undefined"/.test(execB));

check("a ordenação por equipe só vale observando",
	/if \(observando\) \{\s*\n\s*const ta = ordemEquipe\(a && a\.team\), tb = ordemEquipe\(b && b\.team\);/.test(execB));
check("há um respiro entre blocos de equipe",
	/const PUDIM_GAP_EQUIPE = \d+;/.test(execB) &&
	/desloc \+= PUDIM_GAP_EQUIPE;/.test(execB));
check("e o respiro acumula, para o bloco inteiro descer junto",
	/sz\.top = i \* 26 \+ desloc;/.test(execB) &&
	/sz\.bottom = \(i \+ 1\) \* 26 \+ desloc;/.test(execB));
check("a equipe entra no rótulo, com +1 e '-' para quem não tem",
	/"\[" \+ \(ordemEquipe\(d\.team\) === 9999 \? "-" : \(d\.team \+ 1\)\) \+ "\] "/.test(execB));

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
const ordemEquipe = t => (t === undefined || t === null || t < 0) ? 9999 : t;

function ordenar(lista, observando) {
	return lista.slice().sort(function(a, b) {
		if (observando) {
			const ta = ordemEquipe(a.team), tb = ordemEquipe(b.team);
			if (ta !== tb) return ta - tb;
		}
		const pa = a.popCount || 0, pb = b.popCount || 0;
		if (pb !== pa) return pb - pa;
		return a.id - b.id;
	}).map(p => p.id + "/T" + (ordemEquipe(p.team) === 9999 ? "-" : p.team));
}

// Um 2v2 com as populações fora de ordem de propósito.
const PARTIDA = [
	{ id: 1, team: 0, popCount: 40 },
	{ id: 2, team: 1, popCount: 90 },
	{ id: 3, team: 0, popCount: 70 },
	{ id: 4, team: 1, popCount: 55 }
];
const obs = ordenar(PARTIDA, true);
console.log("   observando: " + obs.join("  |  "));
check("observando, as equipes ficam juntas",
	obs.join() === "3/T0,1/T0,2/T1,4/T1", obs.join());
check("e dentro da equipe a maior população vem primeiro",
	obs[0] === "3/T0" && obs[2] === "2/T1");

const jogando = ordenar(PARTIDA, false);
check("jogando, nada muda: a ordem continua sendo só por população",
	jogando.join() === "2/T1,3/T0,4/T1,1/T0", jogando.join());

// Sem equipe (-1) vai para o fim, senão quebra a leitura dos blocos.
const COM_AVULSO = PARTIDA.concat([{ id: 5, team: -1, popCount: 200 }]);
const comAvulso = ordenar(COM_AVULSO, true);
check("quem não tem equipe fica no fim, mesmo com a maior população",
	comAvulso[comAvulso.length - 1] === "5/T-", comAvulso.join());

// O respiro: um por FRONTEIRA de equipe, não um por linha.
function respiros(lista) {
	let n = 0;
	for (let i = 1; i < lista.length; i++)
		if (ordemEquipe(lista[i].team) !== ordemEquipe(lista[i - 1].team)) n++;
	return n;
}
const ordenados = PARTIDA.slice().sort((a, b) => ordemEquipe(a.team) - ordemEquipe(b.team));
check("2 equipes = 1 respiro", respiros(ordenados) === 1, respiros(ordenados));
const GAP = +/const PUDIM_GAP_EQUIPE = (\d+);/.exec(barra)[1];
const MAXR = +/const PUDIM_MAX_ROWS = (\d+);/.exec(barra)[1];
// O pior caso real: 8 jogadores em 4 equipes.
const alturaMax = MAXR * 26 + 3 * GAP;
check("mesmo no pior caso a barra não cresce demais",
	alturaMax <= 300, alturaMax + "px");
check("e há linha para todos os jogadores de uma partida cheia",
	MAXR >= 8, MAXR + " linhas");

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
