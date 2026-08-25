/**
 * Quando o jogador apaga uma obra, ou desliga a auto-fila, o mod para.
 *
 * Dois relatos de 25/08, e os dois têm a mesma forma: o jogador dá um comando, o mod desfaz
 * no ciclo seguinte, e ele não tem como ganhar a disputa porque o mod repõe a cada poucos
 * segundos e ele só clica uma vez.
 *
 *   "as vezes o mod coloca em um local ruim, eu deleto e coloco em um local melhor, mas
 *    nunca consigo, pq assim que eu deleto, o mod coloca novamente"
 *
 *   "no quartel nao consigo desabilitar o treinamento automatico das unidades, quando
 *    coloco, o mod habilita novamente"
 *
 * As duas causas eram diferentes e valem ser separadas.
 *
 * A PRIMEIRA era um filtro. A quarentena de cancelamento existia e funcionava — só que o
 * censo que detecta uma fundação sumindo filtrava por Storehouse/Farmstead, então casa
 * apagada nunca chegava a ser registrada como apagada.
 *
 * A SEGUNDA era adivinhação. O motor desliga a auto-fila sozinho quando não dá para pagar a
 * unidade, e o comando chega igual ao do jogador — não há como saber quem clicou. O mod
 * chutava pelo estoque naquele instante: com recursos, foi o jogador; sem, foi o motor. O
 * chute é razoável e mesmo assim perde, porque o estoque oscila o tempo todo.
 *
 * Rodar:  node tools/test_respeita_jogador.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const panel = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("o mod para quando o jogador manda parar");

// ── 1. Apagar uma obra ─────────────────────────────────────────────────────────────────
console.log("\napagar uma obra");

check("o censo de fundações não filtra mais por armazém/celeiro",
	/const outraObra = !isStorehouse && !isFarmstead;/.test(sim));
check("e toda fundação volta para o painel, com a classe",
	/classe: cmpId\.HasClass\("House"\) \? "casa"/.test(sim));
check("mas só armazém e celeiro seguem para o resto da lógica",
	/if \(!outraObra\)\s*\n\s*currentFoundations\.set/.test(sim));
check("a posição guardada carrega a classe, para o log dizer o que sumiu",
	/g_PudimDropsiteFoundationPos\[f\.id\] = \{ x: f\.x, z: f\.z, classe: f\.classe \};/.test(panel));

// A quarentena por posição sozinha NÃO resolve o relato. Ela impede refazer no mesmo ponto,
// mas o mod continua livre para pousar a 45m dali no ciclo seguinte — e enquanto ele repõe a
// cada poucos segundos, o jogador não chega nem a escolher o lugar bom.
check("apagar pausa TODAS as obras, não só a daquele ponto",
	/const PUDIM_PAUSA_APOS_APAGAR = (\d+);/.test(panel) &&
	/function pudim_ObrasPausadas\(\)/.test(panel));
const PAUSA = +/const PUDIM_PAUSA_APOS_APAGAR = (\d+);/.exec(panel)[1];
check("a pausa é a que o jogador pediu: 10 segundos", PAUSA === 10000, PAUSA);
check("e ela começa a contar quando o cancelamento é registrado",
	/function pudim_MarkCancelled\(x, z\) \{\s*\n\s*g_PudimObrasPausadasAte = Date\.now\(\) \+ PUDIM_PAUSA_APOS_APAGAR;/.test(panel));

// Todos os construtores têm de consultar, senão a pausa vale para um e não para os outros.
for (const [rot, re] of [
	["casas", /g_PudimAutoHouseThreshold > 0 && !pudim_ObrasPausadas\(\)/],
	["armazéns e celeiros", /g_PudimAdvancedAIEnabled\["dropsites"\] && !pudim_ObrasPausadas\(\)/],
	["fazendas", /if \(pudim_ObrasPausadas\(\)\) return;\s*\n\s*const farmData/]
])
	check("a pausa vale para " + rot, re.test(panel));

// "antes de fazer, verifique se ainda precisa" — cada sistema já recalcula a necessidade a
// cada ciclo, então esperar 10s é o que faz a reavaliação acontecer DEPOIS do que o jogador
// fez. Se ele construiu no lugar bom, o mod simplesmente não precisa mais.
check("o log diz que a pausa vale para tudo, não só para aquele ponto",
	/nenhuma obra nova por/.test(panel));

// ── 2. Desligar a auto-fila ────────────────────────────────────────────────────────────
console.log("\ndesligar a auto-fila");

check("o mod nunca religa logo depois de ter sido desligado",
	/const PUDIM_QUEUE_ESPERA_RELIGAR = (\d+);/.test(panel) &&
	/if \(Date\.now\(\) - ultimoOff < PUDIM_QUEUE_ESPERA_RELIGAR\) continue;/.test(panel));
check("e duas desativações na mesma janela viram decisão permanente",
	/const PUDIM_QUEUE_OFF_JANELA = (\d+);/.test(panel) &&
	/if \(historico\.length >= 2\) \{/.test(panel));

const JANELA = +/const PUDIM_QUEUE_OFF_JANELA = (\d+);/.exec(panel)[1];
const ESPERA = +/const PUDIM_QUEUE_ESPERA_RELIGAR = (\d+);/.exec(panel)[1];
check("a espera é menor que a janela, senão a 2ª desativação nunca cabe nela",
	ESPERA < JANELA, ESPERA + " vs " + JANELA);
check("a janela dá tempo real de clicar de novo", JANELA >= 20000, JANELA);

// O chute pelo estoque CONTINUA existindo — ele acerta o caso comum e resolve na primeira
// vez. O que mudou é que ele deixou de ser a única palavra.
check("com recursos disponíveis, a 1ª desativação já basta",
	/if \(affordableNow >= 1\) \{[\s\S]{0,300}?g_PudimAutoQueueUserDisabled\.add\(b\.ent\);/.test(panel));
check("e sem recursos o mod NÃO religa no mesmo tique",
	/Sem recurso: provavelmente foi o motor\. Mesmo assim NÃO religa agora/.test(panel));

// ── 3. A regra modelada ────────────────────────────────────────────────────────────────
// Duas desativações dentro da janela = decisão. Uma só, sem recursos = provavelmente o motor.
function decidir(offs, agora, tinhaRecurso) {
	const recentes = offs.filter(t => agora - t < JANELA);
	if (recentes.length >= 2) return "jogador";
	if (tinhaRecurso) return "jogador";
	return "motor";
}
check("desligou uma vez com recursos: é o jogador",
	decidir([1000], 1000, true) === "jogador");
check("desligou uma vez sem recursos: provavelmente o motor",
	decidir([1000], 1000, false) === "motor");
check("desligou DUAS vezes sem recursos: é o jogador, e ponto",
	decidir([1000, 5000], 5000, false) === "jogador");
check("duas vezes muito espaçadas não contam como decisão",
	decidir([1000, 1000 + JANELA + 5000], 1000 + JANELA + 5000, false) === "motor");

// O caso do relato, completo: o jogador desliga num vale de recursos, o mod não religa na
// hora, ele desliga de novo, e aí fica desligado.
let historico = [];
let agora = 1000;
historico.push(agora);
check("relato: 1ª desativação num vale de recursos não é atropelada na hora",
	decidir(historico, agora, false) === "motor");
agora += ESPERA + 500;
historico.push(agora);
check("relato: a 2ª desativação encerra a discussão",
	decidir(historico, agora, false) === "jogador");

// ── 4. Multiplayer ─────────────────────────────────────────────────────────────────────
// Estado só na GUI; nada disto toca a simulação.
check("o estado da auto-fila vive só no painel",
	/var g_PudimQueueOffAt = \{\};/.test(panel) &&
	!/g_PudimQueueOffAt/.test(sim));
check("e a pausa das obras também",
	/var g_PudimObrasPausadasAte = 0;/.test(panel) &&
	!/g_PudimObrasPausadasAte/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
