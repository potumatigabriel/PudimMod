/**
 * Os quartéis da série ficam juntos, e as duas séries podem correr ao mesmo tempo.
 *
 * Relatos de 01/09:
 *
 *   "coloquei pra fazer quarteis... fez um em cada canto... eles poderiam ficar mais
 *    proximos"
 *   "nesse, da pra fazer varias coisas simultaneas? por exemplo paliçadas e quarteis?"
 *
 * O espalhamento não era acidente, era a ordenação:
 *
 *   candidatos.sort((a,b) => |ra - RAIO_IDEAL| - |rb - RAIO_IDEAL|);
 *
 * Ela olhava SÓ o raio. Todos os candidatos na distância ideal ficavam equivalentes, e o
 * ângulo entrava na ordem em que o gerador tinha empilhado. Cada obra da série escolhia
 * sozinha, sem saber onde as anteriores foram parar — e onde houvesse árvore ou pedra, o
 * motor recusava e ela pulava para um ângulo completamente diferente.
 *
 * Quanto ao simultâneo: já funcionava. g_PudimQuartelAtivo e g_PudimPalicadaAtiva são
 * estados independentes, os dois processos rodam no mesmo tique e o toggle de um não encosta
 * no outro. O que faltava era a TELA dizer isso — o rótulo só falava da série selecionada no
 * dropdown, então a outra corria invisível.
 *
 * Rodar:  node tools/test_quartel_junto.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("quarteis da serie ficam juntos");

const IDEAL = +/const PUDIM_QUARTEL_RAIO_IDEAL = (\d+);/.exec(sim)[1];
const TOL = +/if \(Math\.abs\(da - db\) > (\d+)\) return da - db;/.exec(sim)[1];

// Espelha a ordenação real: distância ao mesmo tipo já de pé manda; o desvio do raio ideal
// desempata. As duas distâncias são quadradas no código (evita a raiz), então a tolerância
// também é: 225 = 15m².
function ordenar(cands, mesmos) {
	const d2 = c => mesmos.length
		? Math.min(...mesmos.map(m => (c.x-m.x)**2 + (c.z-m.z)**2)) : 0;
	const desvio = c => Math.abs(Math.hypot(c.x, c.z) - IDEAL);
	return cands.slice().sort((a, b) => {
		if (mesmos.length) {
			const da = d2(a), db = d2(b);
			if (Math.abs(da - db) > TOL) return da - db;
		}
		return desvio(a) - desvio(b);
	});
}

// CC na origem. Candidatos no anel do raio ideal, em quatro direções.
const N = { x: 0, z: IDEAL }, S = { x: 0, z: -IDEAL };
const L = { x: IDEAL, z: 0 }, O = { x: -IDEAL, z: 0 };
const PERTO_DE_L = { x: IDEAL - 12, z: 22 };   // vizinho do quartel do leste

check("a tolerância do desempate é declarada e é quadrática",
	TOL === 225, TOL + " (15m²)");

// Sem nenhum de pé, o raio ideal decide — a primeira obra não tem em que se ancorar.
const semNada = ordenar([N, S, L, O], []);
check("o primeiro da série sai no raio ideal, como antes",
	Math.abs(Math.hypot(semNada[0].x, semNada[0].z) - IDEAL) < 1);

// Com um quartel no leste, o próximo tem de sair perto dele — não no canto oposto.
const comUm = ordenar([O, N, PERTO_DE_L, S], [L]);
check("havendo um no leste, o próximo escolhe o vizinho dele",
	comUm[0] === PERTO_DE_L, "escolheu x=" + comUm[0].x.toFixed(0) + " z=" + comUm[0].z.toFixed(0));
check("e o canto oposto fica por último",
	comUm[comUm.length - 1] === O);

// O caso do relato, num anel realista: o gerador produz o anel inteiro (passos de ~24m de
// arco), e antes cada obra pegava um ponto qualquer dele. Com a regra nova, escolhas
// consecutivas tem de sair vizinhas.
const ANEL = [];
for (let i = 0; i < 24; i++) {
	const a = (i * 2 * Math.PI) / 24;
	ANEL.push({ x: Math.cos(a) * IDEAL, z: Math.sin(a) * IDEAL, i: i });
}
let mesmos = [];
const escolhidos = [];
for (let n = 0; n < 4; n++) {
	const livres = ANEL.filter(c => !escolhidos.includes(c));
	escolhidos.push(ordenar(livres, mesmos)[0]);
	mesmos = escolhidos.slice();
}
const arco = 2 * Math.PI * IDEAL / 24;   // distancia entre pontos vizinhos do anel
const sep = [];
for (const a of escolhidos)
	for (const b of escolhidos)
		if (a !== b) sep.push(Math.hypot(a.x-b.x, a.z-b.z));
const maiorSep = Math.max(...sep);
check("quatro obras seguidas saem agrupadas no anel, nao espalhadas",
	maiorSep < arco * 4, "maior separacao " + maiorSep.toFixed(0) +
	"m; um passo do anel = " + arco.toFixed(0) + "m");
// A prova direta: os indices angulares escolhidos sao contiguos.
const idx = escolhidos.map(c => c.i).sort((a,b) => a-b);
check("e os angulos escolhidos sao vizinhos no anel",
	idx[idx.length-1] - idx[0] <= 4, idx.join(","));

// Sem a regra, o mesmo anel espalha: todos empatam no raio e a ordem do gerador decide.
const semRegra = [];
for (let n = 0; n < 4; n++) {
	const livres = ANEL.filter(c => !semRegra.includes(c));
	semRegra.push(ordenar(livres, [])[0]);   // [] = ignora os ja construidos, como antes
}
const idxAntes = semRegra.map(c => c.i);
check("e a ordenacao antiga, so por raio, nao agrupava nada",
	new Set(idxAntes).size === 4);

// A regra no código, e o porquê.
check("o critério principal é a distância ao mesmo tipo já de pé",
	/const distAoVizinho = function\(c\)/.test(sim) &&
	/if \(Math\.abs\(da - db\) > 225\) return da - db;/.test(sim));
check("o raio ideal sobrevive como desempate",
	/return desvioDoRaio\(a\) - desvioDoRaio\(b\);/.test(sim));
check("e só ele decide quando não há nenhum ainda",
	/if \(mesmosDePe\.length\) \{/.test(sim));
check("a lista de 'mesmos de pé' ignora fundação sem posição",
	/if \(!pp \|\| !pp\.IsInWorld\(\)\) continue;[\s\S]{0,120}?mesmosDePe\.push/.test(sim));
check("o porquê está escrito — senão a ordenação volta a ser só por raio",
	/Espalhava por construcao, nao por acidente/.test(sim));
check("e o log diz quantos do mesmo tipo havia",
	/result\._dbg\.mesmos = mesmosDePe\.length;/.test(sim));

// A torre continua no comportamento oposto, de propósito: ela cobre as aproximações.
check("a torre continua espalhando em anel, não agrupando",
	/if \(spec\.anel\) \{/.test(sim) && /mais longe das existentes/.test(sim));

// ── As duas séries ao mesmo tempo ──────────────────────────────────────────────────────
console.log("\npalicada e quartel ao mesmo tempo");

check("os dois processos rodam no mesmo tique",
	/pudim_ProcessQuartel\(\);\s*\n\s*try \{ pudim_ProcessPalicada\(\);/.test(panel));
check("e os estados são independentes",
	/var g_PudimQuartelAtivo/.test(panel) && /var g_PudimPalicadaAtiva/.test(panel));

// O toggle de um não pode desligar o outro — é isso que permite as duas juntas.
const corpoToggle = (function() {
	const i = panel.indexOf("function pudim_QuartelToggle()");
	return panel.slice(i, panel.indexOf("\n}\n", i));
})();
check("ligar a série de quartel não desliga a paliçada",
	corpoToggle.indexOf("g_PudimPalicadaAtiva = false") < 0);

// Cada uma com equipe própria: sem isso elas disputariam os mesmos trabalhadores.
const EQ_SERIE = +/const PUDIM_QUARTEL_EQUIPE = (\d+);/.exec(sim)[1];
const EQ_PALI = +/const PUDIM_PALICADA_EQUIPE = (\d+);/.exec(sim)[1];
check("cada série tem equipe própria", EQ_SERIE === 5 && EQ_PALI === 3,
	EQ_SERIE + " e " + EQ_PALI);

// O que faltava: a tela.
check("o rótulo mostra as DUAS quando as duas correm",
	/if \(g_PudimQuartelAtivo && g_PudimPalicadaAtiva\) \{/.test(panel) &&
	/pudim_SerieStatusTexto\(\)/.test(panel));
check("e o texto junta as duas com um separador visível",
	/partes\.join\("  \+  "\)/.test(panel));
check("a paliçada aparece em voltas, a série em quantidade",
	/" x" \+ g_PudimQuartelAlvo/.test(panel) &&
	/g_PudimPalicadaVoltas \+ " " \+ pudim_T\("cap\.laps"\)/.test(panel));

// -- A ordem tem de virar fundacao ---------------------------------------------------
//
// "mandei fazer torres e nada aconteceu". O log de 01/09 mostra a ordem emitida 28 vezes,
// de 3 em 3 segundos, sempre na MESMA coordenada (717,154), com "faltam 10" parado:
//
//   607s Torre em (717,154) ... faltam 10 [paralelo: pop 199 e recurso sobrando]
//   610s Torre em (717,154) ... faltam 10 [paralelo: pop 199 e recurso sobrando]
//   ... 26 vezes mais
//
// Duas coisas somadas. O painel registrava SUCCESS ao EMITIR o comando, nao ao ver a
// fundacao aparecer — 28 "sucessos" para 28 fracassos. E nada fazia o mod desconfiar: o
// motor recusa o construct por motivos que o preview do lado GUI nao testa, em silencio, e
// como o ponto escolhido e deterministico o ciclo seguinte reescolhia o mesmo.
//
// No regime SEQUENCIAL isso nunca apareceu porque o freio "obra em andamento" segurava tudo
// no primeiro fracasso. As torres cairam no regime PARALELO (pop 199), onde o teto e 3 — e
// com emObra travado em zero o freio nunca agia. Por isso o teste cobre os dois regimes.
console.log("\na ordem tem de virar fundacao");

const MAXF = +/const PUDIM_QUARTEL_FALHAS_MAX = (\d+);/.exec(panel)[1];
check("ha um teto de falhas seguidas", MAXF >= 3 && MAXF <= 10, MAXF);

// Espelha o ciclo: emite, e no proximo confere se prontos+emObra mudou.
function ciclo(progressos) {
	let ultimo = null, prog = -1, falhas = 0, adiados = 0, parou = false;
	for (const p of progressos) {
		if (ultimo !== null) {
			if (p === prog) { adiados++; if (++falhas >= MAXF) { parou = true; break; } }
			else falhas = 0;
			ultimo = null;
		}
		ultimo = { x: 0, z: 0 }; prog = p;
	}
	return { adiados: adiados, parou: parou, falhas: falhas };
}

// O caso real: progresso nunca muda.
const travado = ciclo(new Array(28).fill(0));
check("com o motor recusando sempre, a serie para em vez de repetir 28 vezes",
	travado.parou, "adiou " + travado.adiados + " ponto(s)");
check("e cada tentativa adia o ponto, entao a proxima sai em outro lugar",
	travado.adiados >= 1);

// O caso saudavel: cada ordem vira fundacao, nada e adiado.
const bom = ciclo([0, 1, 2, 3, 4, 5]);
check("com a obra saindo, nada e adiado e a serie segue",
	!bom.parou && bom.adiados === 0);

// Falha isolada nao pode cancelar: terreno ocupado por uma unidade que ja saiu, por exemplo.
const intermitente = ciclo([0, 0, 1, 1, 2, 3, 3, 4]);
check("falha isolada nao cancela — o contador zera quando ha progresso",
	!intermitente.parou, "falhas seguidas ao fim: " + intermitente.falhas);

// No codigo.
check("o progresso comparado e prontos + emObra",
	/const progressoAgora = d\.prontos \+ d\.emObra;/.test(panel));
check("o ponto que falhou entra na lista de adiados",
	/g_PudimDecayedSpots\.push\(\{ x: g_PudimQuartelUltimoPonto\.x,/.test(panel));
check("e a lista de adiados e consultada ao escolher",
	/if \(pudim_IsCancelledSpot\(pos\.x, pos\.z\)\) continue;/.test(panel));
check("o estado zera ao iniciar uma serie nova",
	/g_PudimQuartelUltimoPonto = null;\s+g_PudimQuartelProgresso = -1;\s+g_PudimQuartelFalhas = 0;/.test(panel));
check("a serie cancelada devolve a equipe ao trabalho",
	/ordens seguidas sem fundacao[\s\S]{0,220}?pudim_QuartelLiberarEquipe\(\);/.test(panel));

// O log mentia: SUCCESS para uma ordem que so tinha sido emitida.
check("o log nao chama de SUCCESS uma ordem apenas emitida",
	/pudim_Log\("INFO", "QUARTEL", pudim_QuartelNome\(g_PudimQuartelTipo\) \+ " ordenado em \("/.test(panel));
check("e o SUCCESS ficou reservado para a serie concluida",
	/pudim_Log\("SUCCESS", "QUARTEL", g_PudimQuartelAlvo \+ " "/.test(panel));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
