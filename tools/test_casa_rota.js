/**
 * Casa nunca entre o coletor e o dropsite.
 *
 * Relato de 25/08, jogando: "as casas nunca devem ficar entre os coletores e o dropsite,
 * senão atrapalha e reduz a velocidade das coletas".
 *
 * Isso é literal no motor. O pathfinding trata o edifício como obstáculo, então uma casa
 * pousada no corredor entre o arbusto e o CC faz cada viagem contornar. O custo não é
 * único: é por carga, para o resto da partida, e não aparece em lugar nenhum da interface.
 * Uma casa mal colocada perto de um bosque com 15 lenhadores custa mais do que qualquer
 * micro que o mod faça no resto do jogo.
 *
 * O que este teste protege:
 *   1. a regra existe e é geométrica (distância ponto-segmento), não um chute de raio;
 *   2. ela é PREFERÊNCIA e não veto — casa é população, e não construir é pior;
 *   3. o trecho colado no dropsite é isento, senão a base fica sem lugar para casa nenhuma.
 *
 * Rodar:  node tools/test_casa_rota.js
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

console.log("casa fora da rota de coleta");

// ── Forma do código ────────────────────────────────────────────────────────────────────
check("as constantes da regra existem",
	/const PUDIM_CASA_ROTA_FOLGA = (\d+);/.test(src) &&
	/const PUDIM_CASA_ROTA_ISENCAO = (\d+);/.test(src) &&
	/const PUDIM_CASA_ROTA_MAX = (\d+);/.test(src));

const FOLGA = +/const PUDIM_CASA_ROTA_FOLGA = (\d+);/.exec(src)[1];
const ISENCAO = +/const PUDIM_CASA_ROTA_ISENCAO = (\d+);/.exec(src)[1];
const ROTA_MAX = +/const PUDIM_CASA_ROTA_MAX = (\d+);/.exec(src)[1];

check("o dropsite vem do componente, não de uma lista de nomes de template",
	/IID_ResourceDropsite/.test(src) && /cmpDs\.GetTypes\(\)/.test(src));
check("a rota liga o recurso ao dropsite que ACEITA aquele recurso",
	/ds\.tipos\.indexOf\(generico\) === -1/.test(src));
check("fundação de dropsite não conta como rota (ainda não recebe carga)",
	/if \(Engine\.QueryInterface\(ent, IID_Foundation\)\) continue;[\s\S]{0,200}?dropsitesRota\.push/.test(src));
check("o filtro é distância ponto-segmento, não distância ao ponto",
	/const distRota = \(px, pz, r\)/.test(src) && /len2 > 0 \?/.test(src));
check("o candidato bloqueado vai para uma lista separada",
	/if \(naRota\(cx, cz\)\) bloqueados\.push/.test(src));
check("e é anexado no FIM, virando preferência e não veto",
	/for \(const b of bloqueados\) candidates\.push\(b\);/.test(src));
check("o painel recebe o número de rotas e de candidatos limpos, para o log",
	/"rotasEvitadas": rotasColeta\.length/.test(src) &&
	/"candidatosLimpos": limpos/.test(src));

// ── A geometria ────────────────────────────────────────────────────────────────────────
// Espelha distRota do mod. Um segmento AB e um ponto P: o mais perto de P dentro de AB.
function distSeg(px, pz, ax, az, bx, bz) {
	const vx = bx - ax, vz = bz - az;
	const len2 = vx * vx + vz * vz;
	let t = len2 > 0 ? ((px - ax) * vx + (pz - az) * vz) / len2 : 0;
	if (t < 0) t = 0; else if (t > 1) t = 1;
	const qx = ax + t * vx, qz = az + t * vz;
	return Math.sqrt((px - qx) * (px - qx) + (pz - qz) * (pz - qz));
}
function naRota(px, pz, r) {
	const ddx = px - r.bx, ddz = pz - r.bz;
	if (ddx * ddx + ddz * ddz <= ISENCAO * ISENCAO) return false;
	return distSeg(px, pz, r.ax, r.az, r.bx, r.bz) < FOLGA;
}

// Cenário do relato: bosque a oeste (0,0), CC a leste (100,0). Os lenhadores andam pela
// linha z=0 e voltam carregados por ela.
const rota = { ax: 0, az: 0, bx: 100, bz: 0 };

check("casa bem no meio do corredor é rejeitada", naRota(50, 0, rota));
check("casa ligeiramente ao lado, ainda no corredor, é rejeitada", naRota(50, FOLGA - 2, rota));
check("casa afastada do corredor passa", !naRota(50, FOLGA + 4, rota));
check("casa depois do recurso, fora do segmento, passa", !naRota(-30, 0, rota));
check("casa depois do dropsite, fora do segmento, passa", !naRota(140, 0, rota));

// A isenção existe porque TODAS as rotas convergem no dropsite, e o dropsite fica junto do
// CC, que é onde o vilarejo naturalmente cresce. Sem ela a base não teria onde pôr casa.
check("colado no dropsite a regra não vale", !naRota(100 - ISENCAO / 2, 0, rota));
check("mas logo depois da isenção ela volta a valer", naRota(100 - ISENCAO - 5, 0, rota));

// A folga precisa caber a casa inteira mais passagem. A casa gaul tem ~20 units de
// footprint (comentário do próprio código, na geração de candidatos com offset 20).
check("a folga cobre meia casa mais passagem para a fila de coletores",
	FOLGA >= 10 + 4, FOLGA);
check("mas não é tão larga que reserve a base inteira", FOLGA <= 25, FOLGA);
check("a isenção é maior que a folga, senão o nó do dropsite ficaria inviável",
	ISENCAO > FOLGA, ISENCAO + " vs " + FOLGA);

// Rota muito longa não entra na lista: ela vai ganhar um dropsite próprio pelo detector de
// caminhada longa, e reservar 150m de corredor tomaria metade do território.
check("rota longa demais é ignorada", ROTA_MAX <= 150 && ROTA_MAX >= 80, ROTA_MAX);

// ── Não pode travar a construção ───────────────────────────────────────────────────────
// Uma base madura tem rotas em todas as direções. Se cada candidato caísse em alguma
// delas, a regra viraria "nunca mais construa casa" — e ficar sem população perde o jogo
// muito mais rápido do que um corredor atrapalhado.
const rotasEstrela = [];
for (let i = 0; i < 8; i++) {
	const a = i * Math.PI / 4;
	rotasEstrela.push({ ax: Math.cos(a) * 90, az: Math.sin(a) * 90, bx: 0, bz: 0 });
}
const candidatos = [];
for (let r = 14; r <= 44; r += 10)
	for (let i = 0; i < 8; i++) {
		const a = i * Math.PI / 4 + Math.PI / 8;
		candidatos.push({ x: Math.cos(a) * r, z: Math.sin(a) * r });
	}
const limpos = candidatos.filter(c => !rotasEstrela.some(r => naRota(c.x, c.z, r)));
check("com rotas em 8 direções ainda sobra lugar limpo entre elas",
	limpos.length > 0, limpos.length + " de " + candidatos.length);

// E mesmo no pior caso — nenhum lugar limpo — a lista final não pode ficar vazia.
const bloqueadosTodos = candidatos.filter(c => rotasEstrela.some(r => naRota(c.x, c.z, r)));
const listaFinal = limpos.concat(bloqueadosTodos);
check("a lista final nunca perde candidatos: limpos primeiro, bloqueados depois",
	listaFinal.length === candidatos.length, listaFinal.length);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
