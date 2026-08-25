/**
 * Construção em série de quartéis e estábulos.
 *
 * Pedido de 25/08:
 *
 *   "colocar uma opcao de construir automaticamente quartel ou estabulos... escolho o tipo
 *    Quartel/Estabulo, e um drop com a quantidade, de 1 a 10. Dai vai pegar 5
 *    trabalhadores/guerreiros do recurso mais abundante, e fazer as construcoes
 *    sequencialmente, nao simultaneamente, e ao finalizar, eles voltam a trabalhar. Agora se
 *    tiver muitos recursos sobrando, e a populacao maior que 180, pode fazer os
 *    quarteis/estabulos simultaneamente."
 *
 * O "sequencialmente" é a parte que este teste protege mais de perto, porque é a que se
 * perde primeiro numa refatoração e a que mais custa em jogo. Cinco trabalhadores numa obra
 * terminam ela rápido e voltam a colher; cinco obras com um trabalhador cada ficam
 * meio-prontas por muito tempo, com o custo já pago e nenhuma unidade saindo de nenhuma.
 * A diferença é ter um quartel treinando aos 8 minutos ou cinco esqueletos aos 12.
 *
 * A exceção que ele pediu é igualmente concreta: perto do teto de população o gargalo deixa
 * de ser recurso e passa a ser quantos lugares treinam ao mesmo tempo. As duas condições
 * têm de valer JUNTAS — população alta sem recurso deixaria fundações paradas, e recurso
 * sobrando com população baixa é justamente quando terminar rápido importa mais.
 *
 * Rodar:  node tools/test_quartel_serie.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const panel = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const xml = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("construcao em serie de quarteis/estabulos");

// ── A interface que ele descreveu ──────────────────────────────────────────────────────
check("existe um dropdown de tipo",
	/name="pudim_quartelTipo" type="dropdown"/.test(xml));
check("e um dropdown de quantidade",
	/name="pudim_quartelQtd" type="dropdown"/.test(xml));
check("os dois usam o estilo real do motor",
	(xml.match(/style="ModernDropDown"/g) || []).length >= 2);
check("e o evento real do motor (SelectionChange, conferido em gui/locale/locale.xml)",
	/<action on="SelectionChange">pudim_QuartelSetTipo\(\);<\/action>/.test(xml) &&
	/<action on="SelectionChange">pudim_QuartelSetQtd\(\);<\/action>/.test(xml));
check("há um botão para ligar e para cancelar a série",
	/name="pudim_quartelBtn" type="button"/.test(xml) &&
	/pudim_QuartelToggle\(\);/.test(xml));
check("a quantidade vai de 1 a 10, como pedido",
	/for \(let i = 1; i <= 10; i\+\+\) nums\.push\(String\(i\)\);/.test(panel));
check("os dropdowns são populados pela API real (.list/.list_data/.selected)",
	/tipo\.list = /.test(panel) && /tipo\.list_data = /.test(panel) &&
	/qtd\.list = /.test(panel) && /qtd\.selected = 0;/.test(panel));
// A altura do painel nao e cravada aqui: ela muda quando o layout muda, e um numero fixo
// so faria este teste quebrar por motivo errado. O que importa e que XML e JS concordem —
// quem garante que a secao esta VISIVEL e o test_painel_cabe.js, que faz a conta da tela.
check("XML e JS concordam sobre a altura do painel", (function() {
	// A ancora vertical tambem muda (o painel desceu para nao cobrir os botoes do topo),
	// entao o padrao captura as duas pontas em vez de cravar a de cima.
	const a = /50%-(\d+) 100%-20 50%\+(\d+)"/.exec(xml);
	const b = /50%-(\d+) 100%-20 50%\+(\d+)"/.exec(panel);
	return a && b && a[1] === b[1] && a[2] === b[2];
})());
check("e o init dos dropdowns é chamado de verdade",
	/pudim_QuartelInit\(\);/.test(panel));

// ── "Esta coletando" nao e so a ordem Gather ──────────────────────────────────────────
//
// Isto custou duas partidas. O mod despacha a maior parte dos coletores com
// gather-near-position, cuja ordem no UnitAI e GatherNearPosition — e quem volta com a carga
// esta em ReturnResource. O recrutador aceitava so "Gather" e descartava o resto, entao
// sobravam apenas os OCIOSOS. Como o auto-trabalho roda a cada 500ms e o construtor a cada
// 2,5s, todo ocioso ja tinha ordem quando a vez do construtor chegava: lista vazia, serie
// travada, e nenhuma linha no log dizendo por que.
check("as tres ordens de coleta contam como recrutavel",
	/const PUDIM_ORDENS_COLETA = \{ "Gather": 1, "GatherNearPosition": 1, "ReturnResource": 1 \};/.test(sim));
check("o recrutador de quarteis usa a tabela",
	/if \(ord && PUDIM_ORDENS_COLETA\[ord\.type\]\)/.test(sim));
check("e o da palicada tambem — mesmo erro, mesma correcao",
	/else if \(PUDIM_ORDENS_COLETA\[ord\.type\]\) colhendo\.push\(ent\);/.test(sim));
check("gather-near-position e mesmo o que o mod usa para despachar",
	(panel.match(/gather-near-position/g) || []).length >= 5);
// Quem ataca ou guarnece continua fora: recrutar dali seria tirar unidade de combate.
check("ordem que nao e coleta continua fora",
	/\} else if \(ord\) \{[\s\S]{0,120}?continue;/.test(sim));

// ── Nenhuma saida silenciosa ──────────────────────────────────────────────────────────
// O log mostrava "serie iniciada" e mais nada, para sempre. Silencio nao e neutro: ele
// transforma um bug de dez minutos num de dois dias.
check("existe um caminho unico de parada, que registra o motivo",
	/const parar = function\(motivo, extra\)/.test(panel));
const paradas = (panel.match(/parar\(/g) || []).length;
check("e todas as saidas passam por ele", paradas >= 4, paradas);
check("o log e limitado, para nao inundar a tela",
	/agora - \(g_PudimQuartelLogAt \|\| 0\) > 15000/.test(panel));
for (const motivo of ["o jogador apagou uma obra", "obra em andamento",
                      "sem trabalhador livre", "posicoes foi aceita pelo motor"])
	check('diz "' + motivo.slice(0, 28) + '"', panel.indexOf(motivo) > 0);

// ── O tamanho do mapa vem do componente certo ─────────────────────────────────────────
//
// GetMapSize vive em IID_Terrain, NAO em IID_RangeManager. Eu escrevi RangeManager nas duas
// funcoes novas e o `? :` caia sempre no fallback de 512 — o resto do mod ja usava
// cmpTerrain.GetMapSize() em oito lugares.
//
// O estrago era invisivel em mapa pequeno e TOTAL em mapa grande: no log do jogador as obras
// saiam em (951,1027), entao toda posicao candidata caia no teste `cx > mapSize - 10` com
// mapSize=512. A serie parava com "cands=0", que so deu para ver depois que as saidas
// silenciosas ganharam log.
check("o tamanho do mapa vem de IID_Terrain",
	/const cmpTerrainMapa = Engine\.QueryInterface\(SYSTEM_ENTITY, IID_Terrain\);/.test(sim));
check("e nenhuma funcao pede GetMapSize ao RangeManager",
	sim.indexOf("cmpRangeManager.GetMapSize") < 0);
check("o mod inteiro usa a mesma fonte",
	(sim.match(/IID_Terrain\)/g) || []).length >= 8);

// ── A equipe ───────────────────────────────────────────────────────────────────────────
const EQUIPE = +/const PUDIM_QUARTEL_EQUIPE = (\d+);/.exec(sim)[1];
check("são 5 trabalhadores por obra, como pedido", EQUIPE === 5, EQUIPE);
check("tirados do recurso mais abundante",
	/return contagem\[b\] - contagem\[a\];/.test(sim));
check("com ocioso na frente — custa coleta nenhuma",
	/if \(a === "ocioso"\) return -1;/.test(sim));
check("quem já está numa obra não é recrutado",
	/if \(ord && ord\.type === "Repair"\) continue;/.test(sim));
check("nem quem recebeu ordem do jogador",
	/if \(ordenados\[ent\]\) continue;/.test(sim));
check("nem quem está ocupado com outra coisa (atacar, guarnecer)",
	/\} else if \(ord\) \{\s*\n\s*continue;/.test(sim));
check("cavalaria fica de fora",
	/cmpIdU\.HasClass\("FastMoving"\)\) continue;/.test(sim));

// ── Sequencial por padrão ──────────────────────────────────────────────────────────────
const POP = +/const PUDIM_QUARTEL_POP_PARALELO = (\d+);/.exec(panel)[1];
const MAXP = +/const PUDIM_QUARTEL_MAX_PARALELO = (\d+);/.exec(panel)[1];
const FOLGA = +/const PUDIM_QUARTEL_FOLGA = (\d+);/.exec(panel)[1];

check("o limiar de população é o que ele pediu: 180", POP === 180, POP);
check("a simulação usa o MESMO limiar que o painel",
	POP === +/const PUDIM_QUARTEL_POP_PARALELO = (\d+);/.exec(sim)[1]);
check("existe teto no regime paralelo, para não virar spam", MAXP >= 2 && MAXP <= 5, MAXP);

// A regra, espelhada.
function teto(pop, madeira, pedra, faltam) {
	const folgado = madeira >= FOLGA && pedra >= FOLGA / 3;
	const paralelo = folgado && pop > POP;
	return paralelo ? Math.min(MAXP, faltam) : 1;
}
check("padrão é UMA obra por vez", teto(50, 5000, 5000, 10) === 1, teto(50, 5000, 5000, 10));
check("população alta SEM recurso continua sequencial",
	teto(190, 100, 100, 10) === 1);
check("recurso sobrando com população baixa continua sequencial",
	teto(100, 9000, 9000, 10) === 1);
check("as duas condições juntas liberam o paralelo",
	teto(190, 9000, 9000, 10) === MAXP, teto(190, 9000, 9000, 10));
check("exatamente 180 ainda é sequencial — o pedido foi MAIOR que 180",
	teto(180, 9000, 9000, 10) === 1);
check("o paralelo nunca abre mais obras do que faltam",
	teto(190, 9000, 9000, 2) === 2);

check("e o freio sequencial é a obra em andamento, não um relógio",
	/if \(d\.emObra >= tetoObras\) \{/.test(panel));
check("a simulação conta quantas estão em obra",
	/if \(fundacao\) result\.emObra\+\+;/.test(sim));

// ── Voltar ao trabalho ─────────────────────────────────────────────────────────────────
check("a equipe é protegida enquanto constrói",
	/pudim_ProtectBuilder\(id, agora \+ 60000\);/.test(panel));
check("e liberada ao terminar a série",
	/pudim_QuartelLiberarEquipe\(\);/.test(panel) &&
	/function pudim_QuartelLiberarEquipe/.test(panel));
// Liberar é só soltar a proteção: o despacho já recolhe unidade ociosa a cada 500ms. Emitir
// uma ordem de coleta aqui competiria com ele — o mesmo erro de dois sistemas mandando na
// mesma unidade que já custou caro em outras partes do mod.
check("liberar é soltar a proteção, não emitir ordem concorrente",
	/pudim_ProtectBuilder\(id, 0\);/.test(panel));
check("cancelar no meio também devolve a equipe",
	/g_PudimQuartelAtivo = false;\s*\n\s*\/\/ Cancelar devolve/.test(panel));

// ── Integração com o resto do mod ──────────────────────────────────────────────────────
// A ordem inverteu de proposito: a lista de tipos disponiveis precisa atualizar mesmo sem
// serie ativa, para a forja aparecer quando a fase liberar. A pausa continua valendo — ela
// so e checada depois de ler os dados, e antes de qualquer construcao.
check("respeita a pausa de 10s depois de o jogador apagar uma obra",
	/if \(pudim_ObrasPausadas\(\)\) return;/.test(panel) &&
	panel.indexOf("if (pudim_ObrasPausadas()) return;") <
	panel.indexOf('"entities": d.builderIds'));
check("e a lista de tipos atualiza antes de qualquer checagem de serie ativa",
	panel.indexOf("pudim_QuartelAtualizarLista(d.disponiveis)") <
	panel.indexOf("if (!g_PudimQuartelAtivo) { g_PudimQuartelUltima = agora; return; }"));
check("e não constrói onde o jogador já cancelou",
	/if \(pudim_IsCancelledSpot\(pos\.x, pos\.z\)\) continue;[\s\S]{0,400}?SetBuildingPlacementPreview/.test(panel));
check("a posição é validada pelo preview do próprio motor",
	/SetBuildingPlacementPreview[\s\S]{0,300}?r\.success/.test(panel));
check("e o preview é limpo depois, para não ficar fantasma na tela",
	/SetBuildingPlacementPreview", \{ "template": "" \}/.test(panel));

// O template sai do Builder da unidade, então funciona em qualquer civilização sem lista de
// nomes no código — e civ sem estábulo é detectada em vez de falhar em silêncio.
check("o template vem do Builder da própria unidade",
	/if \(cmpBuilder\.GetEntitiesList\) \{[\s\S]{0,80}?cmpBuilder\.GetEntitiesList\(\) \|\| \[\]/.test(sim));
// A trava de fase sai da MESMA fonte: o que o Builder lista e o que da para erguer agora.
check("e a lista de tipos disponiveis sai da mesma fonte",
	/result\.disponiveis\.push\(t2\)/.test(sim));
check("nao ha lista de fases escrita no codigo",
	sim.indexOf('"forja": 2') < 0 && sim.indexOf("fase === 2") < 0);
check("civilização sem o edifício é avisada, não ignorada",
	/civ_sem_/.test(sim) && /esta civilização não constrói/.test(panel));

// ── Multiplayer ────────────────────────────────────────────────────────────────────────
check("a função está registrada na lista de chamadas permitidas",
	/"pudim_GetBarracksBuildData": 1/.test(sim));
// Sem janela de distancia: ela so media quantos comentarios ha entre a funcao e o
// comando, e quebrava toda vez que o codigo ganhava explicacao. O que importa e que o
// comando saia DEPOIS do comeco da funcao, e por PostNetworkCommand.
check("o painel escreve só por PostNetworkCommand", (function() {
	const i = panel.indexOf("function pudim_ProcessQuartel");
	const j = panel.indexOf('"entities": d.builderIds');
	return i > 0 && j > i &&
		/Engine\.PostNetworkCommand/.test(panel.slice(i, j + 60));
})());
check("e o estado da série vive só na GUI",
	/var g_PudimQuartelAtivo = false;/.test(panel) && !/g_PudimQuartelAtivo/.test(sim));

// ── A série termina, e no número certo ────────────────────────────────────────────────
//
// "isso terminou uma obra, parte pra proxima ate acabar a sequencia" — é isso mesmo, e o
// "até acabar" tinha um bug de contagem.
//
// g_PudimQuartelBase guarda quantos daquele tipo já existiam quando a série começou, para o
// alvo ser "quantos NOVOS" e não um total. Ele nascia 0, e 0 significava DUAS coisas: "ainda
// não medi" e "não havia nenhum". Quem começa a série sem nenhum quartel cai nas duas ao
// mesmo tempo: a base era remedida a cada ciclo, e quando a primeira obra concluía, prontos
// virava 1 e a base virava 1 junto — aquela primeira obra deixava de ser contada.
//
// Pedir 3 construía 4. Sempre que se começava do zero.
console.log("");
console.log("a serie termina no numero pedido");

check("o sentinela não colide com um valor legítimo",
	/var g_PudimQuartelBase = null;/.test(panel));
check("e o teste é contra null, não contra zero",
	/if \(g_PudimQuartelBase === null\) g_PudimQuartelBase = d\.prontos;/.test(panel));
check("começar uma série nova reseta para o sentinela, não para zero",
	/g_PudimQuartelBase = null;\s*\n\s*g_PudimQuartelUltima = 0;/.test(panel));

// A contagem, espelhada: quantas obras a série chega a erguer.
function quantasErgue(alvo, jaTinha) {
	let base = null, prontos = jaTinha, erguidas = 0;
	for (let c = 0; c < 60; c++) {
		if (base === null) base = prontos;
		if (alvo - Math.max(0, prontos - base) <= 0) return erguidas;
		erguidas++;
		prontos++;   // a obra conclui antes do ciclo seguinte
	}
	return -1;       // não terminou: seria série infinita
}
for (const [alvo, jaTinha] of [[1, 0], [3, 0], [10, 0], [1, 5], [3, 2], [10, 7]])
	check("pedir " + alvo + " com " + jaTinha + " já pronto(s) ergue " + alvo,
		quantasErgue(alvo, jaTinha) === alvo, quantasErgue(alvo, jaTinha));

check("e a série sempre termina — nunca fica erguendo para sempre",
	[1, 3, 10].every(a => quantasErgue(a, 0) > 0));

// A forma ERRADA, para provar que o teste está medindo algo de verdade.
function quantasErgueBugado(alvo, jaTinha) {
	let base = 0, prontos = jaTinha, erguidas = 0;
	for (let c = 0; c < 60; c++) {
		if (base === 0) base = prontos;
		if (alvo - Math.max(0, prontos - base) <= 0) return erguidas;
		erguidas++;
		prontos++;
	}
	return -1;
}
check("com o sentinela antigo o erro se reproduz (o teste vale de verdade)",
	quantasErgueBugado(3, 0) === 4, quantasErgueBugado(3, 0));
check("e ele só aparecia começando do zero — por isso passou despercebido",
	quantasErgueBugado(3, 2) === 3, quantasErgueBugado(3, 2));


console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
