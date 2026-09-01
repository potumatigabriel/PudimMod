/**
 * Botão para selecionar todos os guerreiros.
 *
 * Pedido de 31/08: "adicionar um botão no pudim mod, pra selecionar todos os guerreiros
 * (tudo que não for aldeão e do mercado)".
 *
 * O critério dele traduzido em classes do 0 A.D., conferidas nos templates do jogo base
 * (public.zip, release-0.28.0 a2cae) — não deduzidas:
 *
 *   template_unit_infantry                VisibleClasses "Citizen Worker Soldier Infantry"
 *   template_unit_champion                VisibleClasses "Soldier Champion"
 *   template_unit_hero                    VisibleClasses "Soldier Hero"
 *   template_unit_siege                   VisibleClasses "Siege", Classes "-Organic"
 *   template_unit_support_female_citizen  Classes "FemaleCitizen", VC "Citizen Worker"
 *   template_unit_support_trader          VisibleClasses "Trader Bribable"
 *
 * `Soldier` é a classe que cidadão-soldado, campeão e herói têm e que NENHUM aldeão ou
 * mercador tem — é exatamente a linha que o jogador descreveu. O cerco entra à parte, por
 * `Siege`, porque não herda Soldier.
 *
 * Isto importa porque eu já inventei API três vezes neste mod e as três falharam em
 * silêncio (ver tools/test_api_inventada.js). Classe errada aqui não daria erro: daria um
 * botão que seleciona quase certo, e ninguém perceberia até uma batalha dar errado.
 *
 * Rodar:  node tools/test_selecionar_guerreiros.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const xml = fs.readFileSync(
	path.join(base, "gui", "session", "match_settings", "02_pudim_panel.xml"), "utf8");
const i18n = fs.readFileSync(path.join(base, "gui", "session", "pudim_i18n.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("selecionar todos os guerreiros");

// ── Quem é guerreiro ───────────────────────────────────────────────────────────────────
check("a simulação expõe a lista",
	/GuiInterface\.prototype\.pudim_GetGuerreiros/.test(sim) &&
	/"pudim_GetGuerreiros": 1/.test(sim));
check("guerreiro é quem tem Soldier ou Siege",
	/if \(!cmpId\.HasClass\("Soldier"\) && !cmpId\.HasClass\("Siege"\)\) continue;/.test(sim));
check("e o mercador sai explicitamente — é o 'do mercado' do pedido",
	/if \(cmpId\.HasClass\("Trader"\)\) continue;/.test(sim));
check("só entra quem está no mundo",
	/if \(!p \|\| !p\.IsInWorld\(\)\) continue;/.test(sim));

// A procedência das classes fica escrita: sem isso, o próximo a ler não sabe se "Soldier"
// foi conferido ou chutado — e chutar classe aqui não dá erro, dá seleção quase certa.
check("a procedência das classes está no código, com os templates citados",
	/template_unit_champion\s+VisibleClasses "Soldier Champion"/.test(sim) &&
	/template_unit_support_trader/.test(sim));

// O aldeão não precisa de exclusão explícita (não tem Soldier), e é bom que o teste diga
// por quê — senão alguém "completa" a regra e muda o comportamento sem perceber.
check("aldeão não precisa de exclusão: FemaleCitizen não tem Soldier",
	/NENHUM\s*\n?\s*\*?\s*aldeao ou mercador tem|que NENHUM aldeao ou mercador tem/.test(sim));

// ── O botão ────────────────────────────────────────────────────────────────────────────
check("o botão existe no painel",
	/name="pudim_selectWarriorsBtn" type="button"/.test(xml));
check("e chama a função certa",
	/pudim_SelecionarGuerreiros\(\);/.test(xml) &&
	/function pudim_SelecionarGuerreiros\(\)/.test(panel));
check("o nome está nos dois idiomas",
	/"cap\.selWarriors":\s*\["Select Warriors", "Selecionar Guerreiros"\]/.test(i18n));
check("e o botão está no mapa de tradução",
	/"pudim_selectWarriorsBtn":\s*"cap\.selWarriors"/.test(i18n));

// Ele divide a linha com "Voltar ao Trabalho": custa zero altura, e o painel já passava
// raspando na tela do jogador (ver test_painel_cabe.js).
const mSel = /name="pudim_selectWarriorsBtn"[^>]*size="(\S+) (\d+) (\S+) (\d+)"/.exec(xml);
const mVolta = /name="pudim_backToWorkBtn2"[^>]*size="(\S+) (\d+) (\S+) (\d+)"/.exec(xml);
check("os dois botões dividem a mesma linha", !!mSel && !!mVolta &&
	mSel[2] === mVolta[2] && mSel[4] === mVolta[4],
	mSel && mVolta ? mVolta[2] + "-" + mVolta[4] + " vs " + mSel[2] + "-" + mSel[4] : "?");
check("e não se sobrepõem", !!mSel && mVolta[3] === "49%" && mSel[1] === "51%",
	mVolta ? mVolta[3] + " | " + mSel[1] : "?");

// Fica ABAIXO do estimador de combate, então tem de subir junto quando ele colapsa — foi o
// test_unidades que pegou isto, e sem ele o botão ficaria flutuando sobre outro controle.
check("o botão acompanha o colapso do estimador",
	/"pudim_backToWorkBtn2", "pudim_selectWarriorsBtn",/.test(panel));

// ── Multiplayer ────────────────────────────────────────────────────────────────────────
// A regra que não se negocia: o mod nunca pode ser incompatível com quem não o tem.
console.log("\nseguro no multiplayer");

const corpo = (function() {
	const i = panel.indexOf("function pudim_SelecionarGuerreiros()");
	return panel.slice(i, panel.indexOf("\n}\n", i));
})();
check("a seleção não emite comando de rede — é estado local da interface",
	corpo.indexOf("PostNetworkCommand") < 0);
check("usa a API do próprio jogo (g_Selection.reset/addList)",
	/g_Selection\.reset\(\);/.test(corpo) && /g_Selection\.addList\(ids\);/.test(corpo));
check("e está escrito por que isso é seguro",
	/selecao NAO passa pela rede|nao afeta quem joga sem o mod/.test(panel));
// Chamada ao motor dentro de try: uma exceção aqui pararia o tique inteiro do painel.
check("a chamada à simulação é protegida",
	/try \{ d = Engine\.GuiInterfaceCall\("pudim_GetGuerreiros", \{\}\); \} catch \(e\) \{ return; \}/.test(corpo));
check("sem guerreiro, não mexe na seleção do jogador",
	/if \(!ids\.length\) \{[\s\S]{0,140}?return;/.test(corpo));
check("e o log diz quantos foram", /guerreiro\(s\) selecionado\(s\)/.test(corpo));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
