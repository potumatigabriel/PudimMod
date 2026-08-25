/**
 * Herói passivo: dentro da própria aura, fora do alcance inimigo.
 *
 * Pedido de 25/08:
 *
 *   "o heroi normalmente aumenta a forca das unidades, ou cura, ou traz bonus... entao se
 *    ele estiver em modo passivo (fuja se atacado), ele tem que ficar bem proximo as
 *    unidades que estao lutando, pra elas ficar dentro da aura dele, mas sem se expor,
 *    pra nunca morrer"
 *
 * São duas exigências que às vezes não cabem juntas, e o próprio pedido dá o desempate:
 * "pra NUNCA morrer". Herói morto não dá aura nenhuma e ainda entrega uma pilha de saque e
 * de experiência ao adversário. Então quando não dá para ter os dois, a segurança ganha e a
 * tropa luta sem o bônus — com isso registrado no log, para não virar silêncio.
 *
 * APIs conferidas na fonte do motor, não supostas (o mod roda em cima da 0.28.0; os
 * arquivos estão em binaries/data/mods/public/simulation):
 *
 *   components/Auras.js      GetAuraNames() → ids das auras da entidade
 *                            IsRangeAura(n) → GetType(n) == "range"
 *                            GetRange(n)    → +AuraTemplates.Get(n).radius, e devolve
 *                                             UNDEFINED se a aura não for do tipo range
 *                            GetClasses(n)  → AuraTemplates.Get(n).affects
 *   components/UnitAI.js     GetStanceName() → this.stance; "passive" está em g_Stances
 *   components/Attack.js     GetFullAttackRange() → {min,max}, já com as tecnologias
 *
 * Raios reais, levantados dos 151 arquivos de simulation/data/auras desta instalação:
 *   30 (14 auras)  35 (2)  40 (4)  45 (2)  50 (3)  60 (29)  70 (1)  75 (3)  80 (4)  100 (3)
 *
 * Rodar:  node tools/test_heroi_aura.js
 */
"use strict";
const fs = require("fs");
const path = require("path");

const src = fs.readFileSync(
	path.join(__dirname, "..", "simulation", "components", "GuiInterface~pudim.js"), "utf8");
const panel = fs.readFileSync(
	path.join(__dirname, "..", "gui", "session", "pudim_panel.js"), "utf8");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("heroi passivo na aura");

// ── As APIs são as reais ───────────────────────────────────────────────────────────────
check("o raio vem de Auras.GetRange, não de um número no código",
	/cmpAuras\.GetRange\(nome\)/.test(src));
check("e só de aura do tipo range — GetRange devolve undefined para as outras",
	/cmpAuras\.IsRangeAura\(nome\)/.test(src));
check("aura global não faz o herói se aproximar de nada",
	/so_aura_global/.test(src));
check("as classes afetadas vêm de Auras.GetClasses",
	/cmpAuras\.GetClasses\(nome\)/.test(src));
check("o stance vem de UnitAI.GetStanceName",
	/cmpAI\.GetStanceName\(\) !== "passive"/.test(src));
check("o alcance inimigo vem de Attack.GetFullAttackRange",
	/cmpAtk\.GetFullAttackRange\(\)\.max/.test(src));
check("o herói é identificado pela classe Hero do Identity",
	/cmpId\.HasClass\("Hero"\)/.test(src));
check("os inimigos vêm de Diplomacy.GetEnemies (Alpha 28 tirou isso de Player)",
	/cd\.GetEnemies\(\)\.filter\(id => id > 0\)/.test(src));

// ── As regras da casa continuam valendo ────────────────────────────────────────────────
check("ordem do jogador manda mais que o mod",
	/if \(ordenados\[ent\]\) \{ result\._dbg\.reason = "ordem_do_jogador"/.test(src));
check("só age em passivo — nos outros stances o jogador quer o herói lutando",
	/stance_nao_passivo/.test(src));
check("não emite ordem se ele já cobre e já está seguro",
	/ja_cobre_e_seguro/.test(src));
check("nem por deslocamento minúsculo",
	/const PUDIM_HEROI_MIN_MOVER = (\d+);/.test(src));
check("há intervalo entre ordens, para a caminhada não ser cancelada toda hora",
	/agora - g_PudimHeroLastAt < 4000/.test(panel));
check("o herói fica protegido de outros sistemas durante a caminhada",
	/pudim_ProtectBuilder\(d\.heroId, agora \+ 4000\)/.test(panel));
check("a decisão mora na simulação; o painel só emite a ordem",
	/pudim_GetHeroAuraData/.test(panel) && /GuiInterface\.prototype\.pudim_GetHeroAuraData/.test(src));
check("a função está registrada na lista de chamadas permitidas",
	/"pudim_GetHeroAuraData": 1/.test(src));

// Multiplayer: leitura na simulação, escrita só por PostNetworkCommand.
check("o painel escreve por PostNetworkCommand, nunca direto na simulação",
	/pudim_ProcessHeroAura[\s\S]{0,2200}?Engine\.PostNetworkCommand\(\{[\s\S]{0,120}?"type": "walk"/.test(panel));
check("a função da simulação não escreve nada — só lê componentes",
	!/pudim_GetHeroAuraData[\s\S]*?(?=GuiInterface\.prototype\.pudim_GetAutoKiteData)/.test(src) ||
	!/pudim_GetHeroAuraData[\s\S]*?PostNetworkCommand[\s\S]*?(?=GuiInterface\.prototype\.pudim_GetAutoKiteData)/.test(src));

// ── A geometria da escolha ─────────────────────────────────────────────────────────────
const FOLGA = +/const PUDIM_HEROI_FOLGA_AURA = (\d+);/.exec(src)[1];
const MARGEM = +/const PUDIM_HEROI_MARGEM_ARMA = (\d+);/.exec(src)[1];
const PASSOS = +/const PUDIM_HEROI_PASSOS = (\d+);/.exec(src)[1];
const MIN_MOVER = +/const PUDIM_HEROI_MIN_MOVER = (\d+);/.exec(src)[1];

// Espelha a escolha do mod: anéis de fora para dentro, e dentro de cada anel o ponto mais
// distante da ameaça mais próxima.
function escolher(raio, luta, ameacas) {
	const alvo = Math.max(0, raio - FOLGA);
	const exposto = (px, pz) => ameacas.some(a =>
		(px - a.x) ** 2 + (pz - a.z) ** 2 < a.alcance * a.alcance);
	for (let anel = 0; anel < 4; anel++) {
		const d = alvo * (1 - anel * 0.22);
		let melhor = null, melhorScore = -Infinity;
		for (let i = 0; i < PASSOS; i++) {
			const ang = (i * 2 * Math.PI) / PASSOS;
			const px = luta.x + Math.cos(ang) * d, pz = luta.z + Math.sin(ang) * d;
			if (exposto(px, pz)) continue;
			let folga = Infinity;
			for (const a of ameacas)
				folga = Math.min(folga, Math.hypot(px - a.x, pz - a.z) - a.alcance);
			if (folga === Infinity) folga = 1000;
			const score = folga - d * 0.05;
			if (score > melhorScore) { melhorScore = score; melhor = { x: px, z: pz, d: d }; }
		}
		if (melhor) return melhor;
	}
	return null;
}

const luta = { x: 0, z: 0 };
// Inimigos vindo do leste. Lanceiro: alcance 4 + margem 12 + 2s de caminhada (2 x 9) = 34.
const lanceiro = { x: 30, z: 0, alcance: 4 + MARGEM + 18 };
// Arqueiro: alcance 60, o mais longo do jogo entre unidades.
const arqueiro = { x: 40, z: 0, alcance: 60 + MARGEM + 18 };

const p1 = escolher(60, luta, [lanceiro]);
check("com aura 60 e lanceiro por perto, acha lugar", p1 !== null);
check("e esse lugar está fora do alcance do lanceiro",
	p1 && Math.hypot(p1.x - lanceiro.x, p1.z - lanceiro.z) >= lanceiro.alcance,
	p1 && Math.hypot(p1.x - lanceiro.x, p1.z - lanceiro.z).toFixed(0));
check("e dentro da aura, senão não serve para nada",
	p1 && Math.hypot(p1.x - luta.x, p1.z - luta.z) <= 60,
	p1 && Math.hypot(p1.x, p1.z).toFixed(0));
check("do lado OPOSTO ao inimigo, sem ninguém precisar dizer onde é a retaguarda",
	p1 && p1.x < 0, p1 && p1.x.toFixed(0));

// O anel mais afastado é preferido: dentro da aura, 20m e 55m valem igual para a tropa e
// valem muito diferente para a vida do herói.
check("fica no anel mais afastado quando ele já é seguro",
	p1 && Math.abs(p1.d - (60 - FOLGA)) < 0.01, p1 && p1.d.toFixed(1));

// Aura curta (30) com arqueiro: a aura inteira cai dentro do alcance dele.
const p2 = escolher(30, luta, [arqueiro]);
check("aura curta contra arqueiro: nenhum ponto seguro, e o mod admite isso",
	p2 === null);
check("nesse caso o código recua em vez de expor o herói",
	/result\.action = "recuar";/.test(src) && /aura_toda_exposta/.test(src));
check("e registra, para não virar silêncio: a tropa está lutando sem o bônus",
	/tropa luta sem bonus/.test(panel));

// Cercado por dois lados: ainda deve achar a brecha perpendicular.
const p3 = escolher(60, luta, [
	{ x: 35, z: 0, alcance: 4 + MARGEM + 18 },
	{ x: 0, z: 35, alcance: 4 + MARGEM + 18 }
]);
check("cercado por dois lados, acha a brecha", p3 !== null,
	p3 && "(" + p3.x.toFixed(0) + "," + p3.z.toFixed(0) + ")");
check("e a brecha está longe dos dois",
	p3 && Math.hypot(p3.x - 35, p3.z) >= 34 && Math.hypot(p3.x, p3.z - 35) >= 34);

// Sem inimigo nenhum por perto não há por que o herói correr para lugar nenhum longe.
const p4 = escolher(60, luta, []);
check("sem ameaça, ele fica no limite da aura (mais longe é sempre melhor)",
	p4 && Math.abs(p4.d - (60 - FOLGA)) < 0.01, p4 && p4.d.toFixed(1));

// ── Os números escolhidos ──────────────────────────────────────────────────────────────
check("a folga da aura absorve o passo do herói sem ser exagerada",
	FOLGA >= 4 && FOLGA <= 12, FOLGA);
check("a margem sobre a arma inimiga é maior que zero e não absurda",
	MARGEM >= 8 && MARGEM <= 30, MARGEM);
check("passos suficientes para cercar a luta sem buraco grande",
	PASSOS >= 12, PASSOS + " passos = " + (360 / PASSOS).toFixed(0) + " graus");
check("o passo angular no raio 60 deixa buraco menor que um corpo",
	(2 * Math.PI * 60) / PASSOS < 30, ((2 * Math.PI * 60) / PASSOS).toFixed(0) + "m");
check("não emite ordem por menos de 10m",
	MIN_MOVER >= 10, MIN_MOVER);

// A margem de tempo embutida (2s de caminhada do inimigo) tem de cobrir o passo real: um
// lanceiro a velocidade 9 anda 18m em 2s, e é isso que separa "seguro" de "morto".
check("a margem de tempo cobre 2 segundos de caminhada inimiga",
	/margem \+= 2 \* \(\+cmpMot\.GetWalkSpeed\(\) \|\| 0\)/.test(src));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
