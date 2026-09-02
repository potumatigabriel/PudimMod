/**
 * A distância mínima que o próprio template exige.
 *
 * Relato de 01/09: "mandei fazer torres e nada aconteceu". O log mostrou a ordem emitida 28
 * vezes na mesma coordenada, sempre recusada em silêncio, com "faltam 10" parado.
 *
 * A causa estava no template do jogo, e só apareceu quando deu para ler o public.zip (ele
 * fica travado enquanto a partida roda, e nas duas primeiras tentativas eu não consegui):
 *
 *   template_structure_defensive_tower.xml
 *     <BuildRestrictions>
 *       <Category>Tower</Category>
 *       <Distance><FromClass>Tower</FromClass><MinDistance>60</MinDistance></Distance>
 *
 * Torre exige 60m de outra torre. E a ordenação em anel da torre classifica os candidatos
 * por separação ANGULAR das existentes, não por distância — então ela escolhia um ponto
 * angularmente oposto que ainda estava dentro dos 60m, e o motor recusava sem dizer nada.
 *
 * O número não fica escrito no mod: é lido do template. É o que faz isto valer para qualquer
 * civilização e para qualquer tipo que ganhe uma restrição dessas, e evita que o mod discorde
 * do jogo quando o jogo mudar.
 *
 * Rodar:  node tools/test_distancia_minima.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("distancia minima vem do template");

// ── É lido, não cravado ────────────────────────────────────────────────────────────────
check("a restrição sai do template, via TemplateManager",
	/const tpl = cmpTM && cmpTM\.GetTemplate\(result\.template\);/.test(sim) &&
	/const br = tpl && tpl\.BuildRestrictions;/.test(sim));
// O componente e obtido DENTRO da funcao. Na primeira versao eu escrevi
// `cmpTemplateManager`, que nao existe nesse escopo — e como a leitura esta num try/catch,
// falharia em silencio: minDist ficaria 0 e o filtro nunca agiria. Quem pegou foi o
// tools/test_scope.js, antes de a partida pegar.
check("e o componente e obtido dentro da propria funcao",
	/const cmpTM = Engine\.QueryInterface\(SYSTEM_ENTITY, IID_TemplateManager\);/.test(sim));
check("lê MinDistance e FromClass, os dois campos reais do esquema",
	/br\.Distance\.MinDistance/.test(sim) && /br\.Distance\.FromClass/.test(sim));
// O 60 aparece só no comentário que cita o arquivo do jogo. Se estiver no código, alguém
// cravou — e aí o mod passa a discordar do jogo quando o jogo mudar.
const codigo = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");
check("o 60 NÃO está cravado no código",
	!/MinDistance[^\n]*60|minDist = 60/.test(codigo));
check("mas a procedência está escrita, com o arquivo citado",
	/template_structure_defensive_tower\.xml/.test(sim) &&
	/<MinDistance>60<\/MinDistance>/.test(sim));

// ── O filtro ───────────────────────────────────────────────────────────────────────────
check("só filtra quando há restrição de verdade",
	/if \(minDist > 0 && deClasse\) \{/.test(sim));
check("e a classe proibida é a do template, não uma lista escrita à mão",
	/if \(!cid \|\| !cid\.HasClass\(deClasse\)\) continue;/.test(sim));
check("compara em distância quadrada, sem raiz por candidato",
	/const md2 = minDist \* minDist;/.test(sim));
check("o log diz a regra aplicada e quantos candidatos ela cortou",
	/result\._dbg\.minDist = minDist \+ "de" \+ deClasse;/.test(sim) &&
	/result\._dbg\.cortados = antes - candidatos\.length;/.test(sim));

// ── A regra, espelhada ─────────────────────────────────────────────────────────────────
function filtra(cands, existentes, minDist) {
	if (!minDist || !existentes.length) return cands;
	return cands.filter(c => existentes.every(p =>
		(c.x-p.x)**2 + (c.z-p.z)**2 >= minDist*minDist));
}
const TORRE = 60;
const torreDePe = [{ x: 0, z: 0 }];

check("candidato a 30m de uma torre é cortado",
	filtra([{x: 30, z: 0}], torreDePe, TORRE).length === 0);
check("a 59m ainda é cortado — o limite é do motor, não aproximado",
	filtra([{x: 59, z: 0}], torreDePe, TORRE).length === 0);
check("a 61m passa", filtra([{x: 61, z: 0}], torreDePe, TORRE).length === 1);

// O caso do log: ponto angularmente oposto mas perto demais. Era exatamente esse que a
// ordenação em anel escolhia, porque ela só olha ângulo.
const oposto = { x: -40, z: 0 };
check("o ponto angularmente oposto mas a 40m continua sendo cortado",
	filtra([oposto], torreDePe, TORRE).length === 0,
	"e era esse que o anel escolhia");

// Sem restrição (quartel, casa), nada é cortado: a regra não pode vazar para outros tipos.
check("tipo sem restrição não perde candidato nenhum",
	filtra([{x: 5, z: 5}, {x: 10, z: 0}], torreDePe, 0).length === 2);
check("e sem nada de pé também não",
	filtra([{x: 5, z: 5}], [], TORRE).length === 1);

// Várias torres: basta UMA perto para cortar.
const varias = [{x: 0, z: 0}, {x: 200, z: 0}];
check("basta uma existente perto para o candidato cair",
	filtra([{x: 180, z: 0}], varias, TORRE).length === 0);
check("e um ponto longe de todas sobrevive",
	filtra([{x: 100, z: 0}], varias, TORRE).length === 1);

// ── Junto com a checagem de fundação ───────────────────────────────────────────────────
// As duas se complementam: esta EVITA o ponto ruim; a outra PERCEBE quando o motor recusa
// por um motivo que o mod não previu. Nenhuma torna a outra dispensável.
check("a checagem de 'a ordem virou fundação' continua existindo",
	/const PUDIM_QUARTEL_FALHAS_MAX = \d+;/.test(
		fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8")));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
