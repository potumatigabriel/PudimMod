/**
 * As melhorias na barra de aliados, separadas em economica e militar.
 *
 * Pedido de 14/09: "no allybar, colocar a quantidade de upgrade, separados em economico e
 * militar".
 *
 * A LISTA DE BAIXO NAO FOI INVENTADA. Ela saiu dos comandos `research` de 40 replays —
 * todos os nomes de tecnologia que apareceram de fato em partida, com quantas vezes cada
 * um. Sao 92, e estao aqui inteiros para que:
 *
 *   1. um nome cair no balde errado reprove, em vez de aparecer torto na tela;
 *   2. quando o jogo acrescentar tecnologia nova, a diferenca fique visivel aqui.
 *
 * A API tambem esta conferida no disco, nao suposta: GetResearchedTechs() devolve um Set, e
 * o autociv o usa assim em simulation/components/GuiInterface~autociv.js:
 *
 *   "researchedTechsCount": cmpTechnologyManager?.GetResearchedTechs().size ?? 0
 *
 * Rodar:  node tools/test_upgrades.js
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
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const barra = fs.readFileSync(path.join(base, "gui", "session", "pudim_ally_bar.js"), "utf8");
const execS = sim.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("melhorias: economica e militar");

// ── A regra, lida do proprio codigo ────────────────────────────────────────────────────
// A lista de prefixos e extraida da simulacao em vez de repetida aqui: um teste que guarda
// a sua propria copia da regra passa a medir a copia, nao o codigo.
const mEco = /const PUDIM_TECH_ECO = \[([\s\S]*?)\n\];/.exec(execS);
check("a lista de prefixos economicos esta na simulacao", !!mEco);
const ECO = mEco ? [...mEco[1].matchAll(/"([^"]+)"/g)].map(m => m[1]) : [];
check("e tem conteudo", ECO.length >= 8, ECO.length + " prefixo(s)");

function classe(tech) {
	if (typeof tech !== "string") return null;
	if (tech.indexOf("phase_") === 0) return null;
	for (const p of ECO) if (tech.indexOf(p) === 0) return "eco";
	return "mil";
}

// ── As 92 tecnologias medidas ──────────────────────────────────────────────────────────
// Formato: nome -> balde esperado. "null" = nem uma coisa nem outra (as fases).
const MEDIDAS = {
	"archer_attack_spread": "mil", "archery_tradition": "mil", "attack_soldiers_will": "mil",
	"barracks_batch_training": "mil", "cavalry_health": "mil", "cavalry_movement_speed": "mil",
	"colonization": "eco", "cost_healer": "mil", "crossbow_training": "mil",
	"garrison_heal": "mil",
	"gather_animals_stockbreeding": "eco", "gather_capacity_basket": "eco",
	"gather_capacity_carts": "eco", "gather_capacity_wheelbarrow": "eco",
	"gather_farming_chain_pump": "eco", "gather_farming_fertilizer": "eco",
	"gather_farming_fertilizer_ptol": "eco", "gather_farming_harvester": "eco",
	"gather_farming_plows": "eco", "gather_farming_seed_drill": "eco",
	"gather_farming_training": "eco", "gather_farming_training_ptol": "eco",
	"gather_farming_water_weeding": "eco", "gather_lumbering_ironaxes": "eco",
	"gather_lumbering_sharpaxes": "eco", "gather_lumbering_strongeraxes": "eco",
	"gather_mining_serfs": "eco", "gather_mining_servants": "eco",
	"gather_mining_shaftmining": "eco", "gather_mining_silvermining": "eco",
	"gather_mining_slaves": "eco", "gather_mining_wedgemallet": "eco",
	"gather_wicker_baskets": "eco", "gather_wicker_baskets_maur": "eco",
	"heal_range": "mil", "heal_rate": "mil", "heal_rate_2": "mil",
	"health_civilians_01": "eco", "health_regen_units": "mil",
	"hoplite_tradition": "mil", "krypteia": "mil", "outpost_vision": "mil",
	"phase_city_athen": null, "phase_city_generic": null, "phase_city_pers": null,
	"phase_town_athen": null, "phase_town_generic": null, "phase_town_pers": null,
	"poison_arrows": "mil", "poison_blades": "mil",
	"pop_house_01": "eco", "pop_house_02": "eco",
	"reformed_army_sele": "mil", "resettlement": "eco", "roman_reforms": "mil",
	"roman_roads": "eco",
	"siege_attack": "mil", "siege_bolt_accuracy": "mil", "siege_cost_time": "mil",
	"siege_health": "mil", "siege_pack_unpack": "mil", "silvershields": "mil",
	"soldier_attack_melee_01": "mil", "soldier_attack_melee_02": "mil",
	"soldier_attack_melee_03": "mil", "soldier_attack_melee_03_variant": "mil",
	"soldier_attack_ranged_01": "mil", "soldier_attack_ranged_02": "mil",
	"soldier_attack_ranged_03": "mil", "soldier_resistance_hack_01": "mil",
	"soldier_resistance_hack_02": "mil", "soldier_resistance_hack_03": "mil",
	"soldier_resistance_pierce_01": "mil", "soldier_resistance_pierce_02": "mil",
	"soldier_resistance_pierce_03": "mil",
	"stable_batch_training": "mil",
	"tower_crenellations": "mil", "tower_garrison": "mil", "tower_health": "mil",
	"tower_murderholes": "mil", "tower_range": "mil", "tower_watch": "mil",
	"trade_commercial_treaty": "eco", "trade_gain_01": "eco", "trade_gain_02": "eco",
	"tyrtean_paeans": "mil", "unlock_champion_cavalry": "mil",
	"unlock_champion_infantry": "mil", "unlock_civilians_house_generic": "eco",
	"unlock_neodamodes": "mil", "unlock_shared_dropsites": "eco",
	"wonder_population_cap": "eco"
};
const nomes = Object.keys(MEDIDAS);
check("as 92 tecnologias medidas nos replays estao no teste", nomes.length === 92, nomes.length);

const erradas = nomes.filter(n => classe(n) !== MEDIDAS[n]);
check("cada uma cai no balde certo", erradas.length === 0,
	erradas.map(n => n + " -> " + classe(n) + " (esperado " + MEDIDAS[n] + ")").join(", "));

// Os numeros da distribuicao, para a proporcao nao passar despercebida se alguem mexer.
const conta = b => nomes.filter(n => MEDIDAS[n] === b).length;
console.log("   economicas " + conta("eco") + " | militares " + conta("mil") +
            " | fases " + conta(null));
check("ha economicas e militares de sobra nos dois lados",
	conta("eco") >= 20 && conta("mil") >= 40);

// ── As fases ficam FORA das duas contas ────────────────────────────────────────────────
// A fase ja aparece na barra ao lado do nome ("II", "III"); conta-la de novo infla os dois
// numeros sem dizer nada novo.
check("fase nao conta como melhoria",
	classe("phase_town_generic") === null && classe("phase_city_generic") === null);
check("e isso esta escrito na regra, nao acontecendo por acaso",
	/if \(tech\.indexOf\("phase_"\) === 0\) return null;/.test(execS));

// ── O padrao e MILITAR, e de proposito ─────────────────────────────────────────────────
// As economicas formam um conjunto fechado (colheita, casa, comercio, assentamento); o lado
// militar e uma cauda longa de nomes proprios de civilizacao. Cair no militar erra menos.
check("nome desconhecido cai em militar", classe("tecnologia_que_nao_existe_ainda") === "mil");
check("e isso e o `return \"mil\"` do fim da funcao",
	/for \(const p of PUDIM_TECH_ECO\)[\s\S]{0,80}return "mil";/.test(execS));
check("entrada invalida nao vira contagem", classe(null) === null && classe(42) === null);

// ── A ponta da simulacao ───────────────────────────────────────────────────────────────
check("a simulacao envia os dois numeros por jogador",
	/"upgEco": 0, "upgMil": 0,/.test(execS));
check("e os conta a partir de GetResearchedTechs",
	/for \(const tech of cmpTechAlly\.GetResearchedTechs\(\)\)/.test(execS) &&
	/IID_TechnologyManager/.test(execS));
check("com guarda, porque nem todo jogador tem o componente",
	/if \(cmpTechAlly && cmpTechAlly\.GetResearchedTechs\)/.test(execS));

// ── A ponta da tela ────────────────────────────────────────────────────────────────────
check("a barra tem um campo para eles", /pudimAllyUpg\[/.test(barra));
check("e escreve E de economica e M de militar",
	/"\]E" \+ \(d\.upgEco \|\| 0\)/.test(barra) && /"\]M" \+ \(d\.upgMil \|\| 0\)/.test(barra));
// O total da equipe soma os dois, como soma o resto.
check("o total da equipe tambem soma as melhorias",
	/"upgEco", "upgMil"/.test(barra));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
