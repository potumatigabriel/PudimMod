/**
 * Paliçada em espiral, da borda do território para dentro.
 *
 * Pedido de 25/08:
 *
 *   "tambem palisada, a palisada, é um muro externo, tentando circular a base, esse pegue 3
 *    construtores e vai fazendo circulo espiral da parte mais externa do territory manager
 *    pra parte mais interna, a quantidade que a pessoa escolhe, vai a quantidade de voltas
 *    completas da espiral... a onde falhar a construção contorna e continua fazendo, por
 *    exemplo arvores e etc"
 *
 * A decisão que carrega o resto: **quem calcula onde cada peça entra é o motor**.
 * SetWallPlacementPreview recebe início e fim e devolve as peças com posição e ângulo já
 * resolvidos, incluindo as curvas. Reproduzir esse cálculo à mão significaria inventar a
 * convenção de ângulo das peças e errar em toda curva — e não haveria como perceber sem
 * abrir o jogo e olhar.
 *
 * A segunda: **o território não é um círculo**. Por isso o raio é medido direção por
 * direção, e a espiral acompanha o formato real da base em vez de uma circunferência que
 * sobra de um lado e invade do outro.
 *
 * Rodar:  node tools/test_palicada.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const base = path.join(__dirname, "..");
const panel = fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8");
const sim = fs.readFileSync(
	path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const i18n = fs.readFileSync(path.join(base, "gui", "session", "pudim_i18n.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("palicada em espiral");

// ── O motor calcula as peças, não eu ───────────────────────────────────────────────────
check("as peças vêm de SetWallPlacementPreview",
	/Engine\.GuiInterfaceCall\("SetWallPlacementPreview", \{/.test(panel));
check("e o comando é construct-wall, com as peças que ele devolveu",
	/"type": "construct-wall"/.test(panel) && /"pieces": info\.pieces/.test(panel));
check("o snap de início e fim é repassado, como a interface do jogo faz",
	/"startSnappedEntity": info\.startSnappedEnt/.test(panel) &&
	/"endSnappedEntity": info\.endSnappedEnt/.test(panel));
// O wallSet vem do template, exatamente como gui/session/input.js ("wallSet =
// templateData.wallSet"). Sem ele o preview não sabe quais peças existem.
check("o wallSet vem do template, não é montado à mão",
	/GetTemplateData\(d\.template\)/.test(panel) && /td\.wallSet/.test(panel));
check("e sem wallSet a série é cancelada, não segue quebrada",
	/sem wallSet — cancelada/.test(panel));

// O preview cria entidades locais no motor; não limpar acumularia peças fantasma no mapa.
check("o preview é sempre limpo depois de usado",
	/const limpar = function\(\) \{/.test(panel) &&
	/SetWallPlacementPreview", \{\}\)/.test(panel));
check("inclusive quando o trecho é recusado",
	/limpar\(\);\s*\n\s*g_PudimPalicadaVaos\+\+;/.test(panel));

// ── Multiplayer ────────────────────────────────────────────────────────────────────────
// As duas novidades passaram pelo test_mp_safety e foram auditadas lá: construct-wall é do
// jogo base (TryConstructWall em Commands.js), e as peças do preview nascem de
// Engine.AddLocalEntity, que a serialização pula.
check("construct-wall está na lista de comandos auditados",
	fs.readFileSync(path.join(base, "tools", "test_mp_safety.js"), "utf8")
		.indexOf('"construct-wall"') > 0);
check("SetWallPlacementPreview também",
	fs.readFileSync(path.join(base, "tools", "test_mp_safety.js"), "utf8")
		.indexOf('"SetWallPlacementPreview"') > 0);

// ── A equipe ───────────────────────────────────────────────────────────────────────────
const EQUIPE = +/const PUDIM_PALICADA_EQUIPE = (\d+);/.exec(sim)[1];
check("são 3 construtores, como pedido", EQUIPE === 3, EQUIPE);
check("ocioso primeiro, depois quem colhe",
	/ociosos\.concat\(colhendo\)/.test(sim));
// "Esta coletando" nao e so Gather: o mod despacha com gather-near-position
// (GatherNearPosition) e quem volta com a carga esta em ReturnResource. Aceitar so
// "Gather" deixava a lista de candidatos praticamente vazia — foi o que travou a serie
// de quarteis, e o mesmo erro estava aqui.
check("as tres ordens de coleta contam como recrutavel",
	/else if \(PUDIM_ORDENS_COLETA\[ord\.type\]\) colhendo\.push\(ent\);/.test(sim));
check("e quem nao tem ordem nenhuma entra como ocioso",
	/if \(!ord\) ociosos\.push\(ent\);/.test(sim));
check("nem quem recebeu ordem do jogador",
	/if \(ordenados\[ent\]\) continue;/.test(sim));

// ── A espiral segue o território, não um círculo ───────────────────────────────────────
check("o raio é medido direção por direção",
	/const borda = \[\];/.test(sim) && /borda\.push\(r\);/.test(sim));
check("sondando com o TerritoryManager, até onde ainda é nosso",
	/cmpTerritoryManager\.GetOwner\(tx, tz\) !== player\) break;/.test(sim));
check("e o porquê está escrito — território não é círculo",
	/O território NÃO é um círculo/.test(sim));

const DIRECOES = +/const PUDIM_PALICADA_DIRECOES = (\d+);/.exec(sim)[1];
const PASSO = +/const PUDIM_PALICADA_PASSO = (\d+);/.exec(sim)[1];
const MARGEM = +/const PUDIM_PALICADA_MARGEM = (\d+);/.exec(sim)[1];

// palisades_long tem <Length>14</Length> (conferido em structures/palisades_long.xml). O
// espaçamento entre pontos tem de dar peças inteiras, não fatias de peça.
check("os pontos são densos o bastante para o motor encaixar peças",
	DIRECOES >= 24, DIRECOES);
const arcoNaBorda = (2 * Math.PI * 150) / DIRECOES;   // base grande, raio ~150
check("e não tão densos que cada trecho fique menor que uma peça",
	arcoNaBorda >= 14, arcoNaBorda.toFixed(0) + "m de arco vs 14 de peça");

// Espelha a geração: volta 0 na borda, cada volta entra PASSO para dentro.
function espiral(borda, voltas) {
	const pts = [];
	for (let v = 0; v < voltas; v++) {
		const recuo = MARGEM + v * PASSO;
		for (let i = 0; i <= borda.length; i++) {
			const idx = i % borda.length;
			const raio = borda[idx] - recuo;
			if (raio < PASSO) continue;
			pts.push({ volta: v, raio: raio, dir: idx });
		}
	}
	return pts;
}
const bordaRedonda = new Array(DIRECOES).fill(120);
const p1 = espiral(bordaRedonda, 1);
check("uma volta fecha o círculo (fim liga no começo)",
	p1.length === DIRECOES + 1, p1.length);
check("e fica dentro da borda, com margem",
	p1.every(p => p.raio <= 120 - MARGEM), p1[0].raio);

const p3 = espiral(bordaRedonda, 3);
check("três voltas dão três anéis", new Set(p3.map(p => p.volta)).size === 3);
check("cada volta é mais interna que a anterior",
	p3.find(p => p.volta === 1).raio < p3.find(p => p.volta === 0).raio &&
	p3.find(p => p.volta === 2).raio < p3.find(p => p.volta === 1).raio);
check("o passo entre voltas é o declarado",
	p3.find(p => p.volta === 0).raio - p3.find(p => p.volta === 1).raio === PASSO);

// Território irregular: a espiral acompanha, e onde é raso demais simplesmente não há ponto.
const bordaIrregular = bordaRedonda.slice();
for (let i = 0; i < 6; i++) bordaIrregular[i] = 30;   // um lado curto
const pi1 = espiral(bordaIrregular, 1);
check("num território irregular, o anel acompanha o formato",
	new Set(pi1.map(p => Math.round(p.raio))).size > 1);
const pi3 = espiral(bordaIrregular, 3);
const naFatiaCurta = pi3.filter(p => p.dir < 6 && p.volta === 2);
check("e onde o território é raso, a volta interna simplesmente não tem ponto ali",
	naFatiaCurta.length === 0, naFatiaCurta.length);
check("mas o resto da volta continua existindo",
	pi3.filter(p => p.volta === 2).length > 0);

// ── Contornar a falha ──────────────────────────────────────────────────────────────────
// "a onde falhar a construção contorna e continua fazendo, por exemplo arvores e etc"
check("trecho recusado é pulado, e o próximo segue",
	/if \(!info \|\| !info\.pieces \|\| !info\.pieces\.length\) \{[\s\S]{0,300}?g_PudimPalicadaVaos\+\+;\s*\n\s*return;/.test(panel));
check("os vãos são contados e ditos no fim",
	/trecho\(s\) sem passagem, contornados/.test(panel));
// Ligar o último ponto de uma volta ao primeiro da seguinte cortaria a base ao meio.
check("pontos de voltas diferentes nunca se ligam",
	/if \(a\.volta !== b\.volta\) return;/.test(panel));

// ── A espiral é traçada uma vez ────────────────────────────────────────────────────────
// O território cresce durante a partida; retraçar a cada trecho faria o muro se deslocar
// enquanto está sendo construído.
check("a espiral é traçada uma vez, no começo",
	/if \(!g_PudimPalicadaPontos\.length\) \{/.test(panel) &&
	/Retraçá-la a cada trecho faria o muro se deslocar/.test(panel));

// ── A fase: eu li errado e o jogador corrigiu ──────────────────────────────────────────
// structures/wallset_palisade traz Requirements "-phase_town phase_village". No sistema de
// tokens do 0 A.D. o "-" REMOVE um requisito herdado, não proíbe a fase. O pai
// (template_wallset) exige phase_town — muralha de pedra é fase 2 — e a paliçada tira essa
// exigência, ficando com phase_village, que se tem desde o início e nunca se perde.
check("está escrito que a paliçada vale em TODAS as fases",
	/a paliçada vale em TODAS as fases/.test(sim));
check("e a mensagem de indisponível não fala em fase",
	/esta civilização não constrói paliçada/.test(panel) &&
	panel.indexOf("só existe na fase 1") < 0);

// ── Integração ─────────────────────────────────────────────────────────────────────────
check("a paliçada é um tipo da série",
	/const PUDIM_QUARTEL_TIPOS = \[[^\]]*"palicada"\]/.test(panel));
check("mas tem processo próprio — não é 'mais um edifício'",
	/if \(g_PudimQuartelTipo === "palicada"\) \{ pudim_PalicadaToggle\(\); return; \}/.test(panel));
check("e o número no dropdown passa a significar VOLTAS",
	/pudim_T\("cap\.laps"\)/.test(panel) && /"cap\.laps":/.test(i18n));
check("o nome está nos dois idiomas",
	/"cap\.palisade":\s*\["Palisade", "Paliçada"\]/.test(i18n));
check("respeita a pausa de 10s de 'o jogador apagou uma obra'",
	/if \(pudim_ObrasPausadas\(\)\) return;[\s\S]{0,200}?g_PudimPalicadaUltima = agora;/.test(panel));
check("e a equipe é liberada ao terminar ou cancelar",
	(panel.match(/for \(const id of g_PudimPalicadaEquipe\) pudim_ProtectBuilder\(id, 0\);/g) || []).length >= 2);

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
