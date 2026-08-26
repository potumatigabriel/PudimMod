/**
 * Não inventar API do motor.
 *
 * Instrução do jogador, de 14/08: "sempre use api, nunca tente adivinhar as funções, se
 * precisa pesquise na internet". Eu desobedeci três vezes neste mesmo arquivo, e as três
 * falharam **em silêncio** — nenhuma levantou erro, todas produziram comportamento errado
 * que custou partidas inteiras para achar:
 *
 *   1. ProductionQueue.GetEntitiesList()  — vive em Trainer.
 *      A lista voltava vazia e o painel dizia "Nada para treinar ainda" com o centro cívico
 *      enfileirando aldeãs na tela.
 *
 *   2. RangeManager.GetMapSize()          — vive em Terrain.
 *      O `? :` caía sempre no fallback de 512, e num mapa de 1024 TODA posição candidata era
 *      recusada. A série de quartéis parava com cands=0.
 *
 *   3. Identity.GetTemplateName()         — vive em TemplateManager, como GetCurrentTemplateName.
 *      A guarda `if (!cmpId.GetTemplateName) continue;` era verdadeira para toda entidade, o
 *      continue pulava todas, e `existentes` ficava em ZERO para sempre. Com todas as
 *      contagens em zero a falta empatava entre todas as unidades, e no empate vence a
 *      primeira da lista, que é ordenada por nome: infantry_javelineer_b antes de
 *      infantry_swordsman_b. Em jogo isso apareceu como "só ta fazendo escaramurçador,
 *      nenhum espadachin", partida após partida.
 *
 * Nas três, a chamada CERTA já estava escrita em outro ponto do próprio mod.
 *
 * O que este teste faz de diferente: em vez de decorar os três erros, ele confere toda
 * chamada em `cmpId*` contra a lista REAL de métodos de Identity, extraída de
 * simulation/components/Identity.js do 0 A.D. 0.28. Um quarto método inventado quebra aqui,
 * em vez de quebrar numa partida.
 *
 * Rodar:  node tools/test_api_inventada.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const bruto = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");

// Sem comentários. Na primeira versão deste teste ele acusou o PRÓPRIO comentário em que
// documentei o erro — a frase 'if (!cmpId.GetTemplateName)' escrita para explicar o que
// tinha dado errado. Um teste que proíbe descrever o bug empurra a explicação para fora do
// código, que é o oposto do que se quer aqui. Ele confere o que EXECUTA.
const sim = bruto.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("nao inventar API do motor");

// ── Os métodos que Identity REALMENTE tem ──────────────────────────────────────────────
// Extraídos de simulation/components/Identity.js (public.zip, release-0.28.0 a2cae) com:
//   /Identity\.prototype\.(\w+)\s*=\s*function/
// Se o jogo atualizar e algum sumir, este teste avisa antes de a partida avisar.
const IDENTITY = ["Deserialize", "GetCiv", "GetClassesList", "GetGenericName", "GetLang",
	"GetName", "GetPhenotype", "GetPossiblePhenotypes", "GetRank", "GetRankTechName",
	"GetSelectionGroupName", "GetVisibleClassesList", "HasClass", "Init", "IsControllable",
	"IsUndeletable", "Mirage", "Serialize", "SetControllable", "SetName", "SetPhenotype"];

const chamados = new Set();
const re = /\bcmpId[A-Za-z0-9_]*\.([A-Za-z_]\w*)\s*\(/g;
let m;
while ((m = re.exec(sim)) !== null) chamados.add(m[1]);

check("há chamadas em cmpId para conferir", chamados.size > 0, chamados.size);
const inventados = [...chamados].filter(n => IDENTITY.indexOf(n) < 0);
check("toda chamada em cmpId existe mesmo em Identity",
	inventados.length === 0, inventados.join(", "));

// Também as referências sem parêntese — foi exatamente a forma do erro nº 3, uma guarda
// `if (!cmpId.GetTemplateName)`, que nunca chega a chamar e por isso nunca lança.
//
// `template` NÃO é método e é legítimo: todo componente do 0 A.D. carrega o próprio bloco
// XML em `this.template`, e Identity.js o lê em oito campos (Civ, GenericName, Rank...).
// SpecificName está no esquema dele mas não tem getter — daí `cmpIdentity.template
// .SpecificName` na linha 240, que é a forma de alcançá-lo.
const IDENTITY_PROPS = ["template"];
const refs = new Set();
const re2 = /\bcmpId[A-Za-z0-9_]*\.([A-Za-z_]\w*)\b(?!\s*\()/g;
while ((m = re2.exec(sim)) !== null) refs.add(m[1]);
const refsInventadas = [...refs].filter(n =>
	IDENTITY.indexOf(n) < 0 && IDENTITY_PROPS.indexOf(n) < 0);
check("e toda REFERÊNCIA a método de Identity também — guarda que testa método inexistente é sempre falsa",
	refsInventadas.length === 0, refsInventadas.join(", "));

// ── Os três erros, nominalmente ────────────────────────────────────────────────────────
console.log("\nos tres erros nao voltam");

check("o nome do template vem de GetCurrentTemplateName",
	/cmpTemplateManager\.GetCurrentTemplateName\(/.test(sim));
check("e nunca de Identity", sim.indexOf("GetTemplateName") < 0 ||
	!/cmpId[A-Za-z0-9_]*\.GetTemplateName/.test(sim));

// GetEntitiesList existe nos DOIS (Builder e Trainer têm), então o teste não pode proibir o
// nome — tem de proibir o par errado: pedir a lista de treináveis ao ProductionQueue.
check("a lista de treináveis vem do Trainer, não do ProductionQueue",
	/cmpTrainer\.GetEntitiesList\(\)/.test(sim) &&
	!/cmpP[Qq][A-Za-z]*\.GetEntitiesList/.test(sim) &&
	!/cmpProd[A-Za-z]*\.GetEntitiesList/.test(sim));
check("e a fila continua vindo de ProductionQueue — a divisão é essa",
	/cmpPQ\.GetQueue\(\)/.test(sim));

check("o tamanho do mapa vem do Terrain, não do RangeManager",
	/cmpTerrain[A-Za-z]*\.GetMapSize\(\)/.test(sim) &&
	!/cmpRangeManager\.GetMapSize/.test(sim));

// ── O rastro dos três fica escrito ─────────────────────────────────────────────────────
// Sem isso, o próximo a ler o código não sabe por que essas linhas são o que são, e
// "simplifica" de volta para a versão que parecia certa.
check("o porquê de cada um está no código, não só neste teste",
	/NAO DO Identity/.test(bruto) &&
	/GetEntitiesList vive em IID_Trainer/i.test(bruto) &&
	/GetMapSize vive em IID_Terrain/i.test(bruto));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
