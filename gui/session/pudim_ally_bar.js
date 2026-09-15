/**
 * PudimMod - pudim_ally_bar.js
 */

var g_PudimAllyBarLastUpdate = 0;
var g_PudimAllySelfLogAt = 0;
// Flash state keyed by player ID (not row index) — order can change between frames
var g_PudimAllyLastPhase = {};
var g_PudimAllyFlashEndTime = {};
var g_PudimAllyFlashType = {};

const PUDIM_PHASE_LABELS = { 1: "I", 2: "II", 3: "III", 4: "IV" };
const PUDIM_PHASE_COLORS = { 1: "200 200 100", 2: "100 200 140", 3: "80 150 240", 4: "200 100 240" };
// Respiro entre blocos de equipe, no modo observador. 8 px chega para o olho separar sem
// empurrar a barra para fora da tela: 8 jogadores em 4 equipes gastam 3 respiros = 24 px.
const PUDIM_GAP_EQUIPE = 8;
// Quantos caracteres do nick cabem no campo do nome.
//
// O campo tem 175px (ver as larguras em 03_pudim_ally_bar.xml) e a regua conservadora e de
// 9 px por caractere em sans-bold-14 — o piso observado e ~7,1, e a folga e deliberada
// porque medir fonte por captura de tela seria chute. Da 19 caracteres no rotulo inteiro.
//
// O rotulo nao e so o nick: leva prefixo e a fase.
//
//   assistindo   "T1 " + nick + "  III"  = 8 + nick  <= 19  ->  nick <= 11
//   jogando      "*"   + nick + "  III"  = 6 + nick  <= 19  ->  nick <= 13
//
// Dois valores em vez de um porque a estrela ocupa menos que o prefixo de equipe, e nao ha
// razao para encurtar o nome de quem esta jogando por causa do modo observador.
const PUDIM_NICK_MAX_OBS = 11;
const PUDIM_NICK_MAX = 13;
// No modo compacto (duas colunas) o campo do nome cai para 130px em sans-bold-12: o rótulo
// inteiro é "T1 " + nick + "  III", e 16 caracteres é o que cabe.
const PUDIM_NICK_MAX_COMPACTO = 8;

// ─── Duas colunas no modo observador ───────────────────────────────────────────────────
//
// Pedido de 14/09: "quando estiver como observador, colocar uma linha em baixo do ultimo de
// cada time com o total, se cober deixar mais compacto, e deixa cada time lado a lado,
// usando metade da tela, pra ter menos altura".
//
// Com 8 jogadores e 2 equipes, a barra corrida gastava 8 linhas + respiro. Lado a lado, com
// a linha de total de cada equipe, são 5 linhas de altura — menos da metade.
const PUDIM_ROW_H = 26;
const PUDIM_MAX_ROWS = 14;        // 9 jogadores + até 4 totais de equipe + folga
const PUDIM_COL_GAP = 16;         // respiro entre as duas colunas
const PUDIM_LARGURA_COMPACTA = 818;
const PUDIM_MARGEM_TELA = 16;
// O tamanho do painel do mod, quando ele está largo: é onde o conteúdo do XML termina.
const PUDIM_LARGURA_LARGA = 1024;
const PUDIM_BAR_SIZE_LARGA = "50%-440 36 50%+584 100%";

// ─── Onde cada campo fica, em cada um dos dois tamanhos ────────────────────────────────
//
// Os números saem da mesma régua conservadora do resto da barra: 9 px por caractere em
// sans-bold-14, escalada pelo tamanho da fonte (7,7 em 12; 7,1 em 11). O piso observado é
// ~7,1 em 14, então a folga é deliberada — medir fonte por captura de tela seria chute.
// tools/test_ally_bar_layout.js confere que nenhum campo invade o vizinho nos DOIS.
//
// No compacto o contador de coletores perde os parênteses ("1735·64" em vez de
// "1735 (64)"): são 2 caracteres por recurso, 4 recursos, e foi o que fez a coluna caber em
// 818px — com parênteses dava 882, e duas colunas não entravam numa tela de 1707.
const PUDIM_LAYOUT_LARGO = {
	"Name":    [10, 185, "sans-bold-14"],
	"Pop":     [190, 264, "sans-bold-14"],
	"IcoFood": [270, 286], "Food":  [290, 362, "sans-bold-13"],
	"IcoWood": [368, 384], "Wood":  [388, 460, "sans-bold-13"],
	"IcoStone":[466, 482], "Stone": [486, 558, "sans-bold-13"],
	"IcoMetal":[564, 580], "Metal": [584, 656, "sans-bold-13"],
	"Upg":     [662, 740, "sans-bold-13"],
	"Army":    [746, 910, "sans-12"],
	"KD":      [914, 1024, "sans-bold-13"]
};
const PUDIM_LAYOUT_COMPACTO = {
	"Name":    [6, 136, "sans-bold-12"],
	"Pop":     [140, 218, "sans-bold-12"],
	"IcoFood": [222, 236], "Food":  [239, 291, "sans-11"],
	"IcoWood": [295, 309], "Wood":  [312, 364, "sans-11"],
	"IcoStone":[368, 382], "Stone": [385, 437, "sans-11"],
	"IcoMetal":[441, 455], "Metal": [458, 510, "sans-11"],
	"Upg":     [514, 566, "sans-11"],
	"Army":    [570, 720, "sans-11"],
	"KD":      [724, 818, "sans-11"]
};
const PUDIM_CAMPOS_ICONE = ["IcoFood", "IcoWood", "IcoStone", "IcoMetal"];

// Qual layout está aplicado agora. Mover 13 objetos em 14 linhas custa 182 escritas; fazer
// isso a cada segundo seria desperdício, e a troca só acontece quando se entra ou sai do
// modo observador.
var g_PudimAllyLayoutAtual = null;

/** Largura da janela, do jeito que o autociv a lê (autociv_minimapExpand.js). */
function pudim_LarguraTela() {
	const s = Engine.TryGetGUIObjectByName("session");
	if (!s || !s.getComputedSize) return 0;
	try { const r = s.getComputedSize(); return r.right - r.left; } catch (e) { return 0; }
}

/**
 * Move os campos de todas as linhas para o layout pedido.
 *
 * O `size` é escrito como STRING de propósito. O objeto devolvido por `.size` guarda o
 * deslocamento e a porcentagem em campos separados — foi o que o indicador de obras
 * ensinou, onde `size.right` de `100%-46` devolve -46. As linhas nascem com `100%` na
 * direita, então escrever só o número deixaria a direita em "100% + x".
 */
function pudim_AplicarLayoutBarra(compacto) {
	const alvo = compacto ? "compacto" : "largo";
	if (g_PudimAllyLayoutAtual === alvo) return;
	g_PudimAllyLayoutAtual = alvo;
	const L = compacto ? PUDIM_LAYOUT_COMPACTO : PUDIM_LAYOUT_LARGO;
	for (let i = 0; i < PUDIM_MAX_ROWS; ++i)
		for (const campo in L) {
			const o = Engine.TryGetGUIObjectByName("pudimAlly" + campo + "[" + i + "]");
			if (!o) continue;
			const ehIcone = PUDIM_CAMPOS_ICONE.indexOf(campo) >= 0;
			// Ícone quadrado de 16px centrado na linha; texto ocupando a altura útil.
			const y = ehIcone ? " 5 " : " 2 ";
			const y2 = ehIcone ? " 21" : " 24";
			try { o.size = L[campo][0] + y + L[campo][1] + y2; } catch (e) {}
			if (L[campo][2]) try { o.font = L[campo][2]; } catch (e) {}
		}
}

/**
 * A lista que vai para a tela: os jogadores e, assistindo, o total de cada equipe.
 *
 * O total é uma linha SINTÉTICA — não vem da simulação, é a soma do bloco. Ele responde a
 * pergunta que a barra corrida não respondia: qual equipe está na frente. Somar de olho
 * quatro linhas de recurso no meio de uma partida não acontece.
 */
function pudim_MontarLinhasEquipe(allies, ordemEquipe) {
	const linhas = [];
	let bloco = null;
	const fecha = () => {
		if (!bloco || bloco.n < 2) { bloco = null; return; }   // time de um só não precisa de total
		bloco.tot.name = "T" + bloco.rot + " total (" + bloco.n + ")";
		linhas.push(bloco.tot);
		bloco = null;
	};
	for (const d of allies) {
		const t = ordemEquipe(d && d.team);
		if (!bloco || bloco.t !== t) {
			fecha();
			bloco = { "t": t, "n": 0, "rot": (t === 9999 ? "-" : (d.team + 1)),
				"tot": { "isTotal": true, "id": "tot" + t, "team": d && d.team,
					"popCount": 0, "popLimit": 0, "res": { "food": 0, "wood": 0, "stone": 0, "metal": 0 },
					"gatherers": { "food": 0, "wood": 0, "stone": 0, "metal": 0 },
					"upgEco": 0, "upgMil": 0, "kills": 0, "deaths": 0,
					"support": 0, "infantry": 0, "cavalry": 0, "ranged": 0, "siege": 0 } };
		}
		linhas.push(d);
		bloco.n++;
		const T = bloco.tot;
		T.popCount += d.popCount || 0;
		T.popLimit += d.popLimit || 0;
		for (const r of ["food", "wood", "stone", "metal"]) {
			T.res[r] += Math.floor((d.res || {})[r] || 0);
			T.gatherers[r] += ((d.gatherers || {})[r] || 0);
		}
		for (const k of ["upgEco", "upgMil", "kills", "deaths",
		                 "support", "infantry", "cavalry", "ranged", "siege"])
			T[k] += d[k] || 0;
	}
	fecha();
	return linhas;
}

/**
 * Distribui os blocos de equipe em duas colunas, equilibrando a altura.
 *
 * "deixa cada time lado a lado": com duas equipes é uma de cada lado. Com quatro, duas de
 * cada lado — e aí o que importa é as colunas terminarem juntas, senão a barra fica com a
 * altura da maior e o ganho evapora.
 *
 * Escreve `_col` e `_row` em cada linha e devolve quantas linhas a coluna mais alta tem.
 */
function pudim_DistribuirColunas(linhas, ordemEquipe, colunas) {
	const blocos = [];
	for (const l of linhas) {
		const t = ordemEquipe(l.team);
		if (!blocos.length || blocos[blocos.length - 1].t !== t) blocos.push({ "t": t, "itens": [] });
		blocos[blocos.length - 1].itens.push(l);
	}
	const altura = [0, 0];
	for (const b of blocos) {
		// Coluna mais curta leva o próximo bloco. Com uma coluna só, sempre a primeira.
		const c = (colunas < 2 || altura[0] <= altura[1]) ? 0 : 1;
		if (altura[c] > 0) altura[c] += 1;   // uma linha de respiro entre blocos
		for (const l of b.itens) {
			l._col = c;
			l._row = altura[c];
			altura[c]++;
		}
	}
	return Math.max(altura[0], altura[1]);
}

/**
 * Cor do jogador (componentes 0..1) clareada para leitura sobre fundo escuro.
 * As cores cruas do jogo têm tons bem escuros (azul do P1 = 10,10,190; verde-escuro
 * = 20,80,60) que praticamente somem no preto do painel. Aqui a cor é elevada até um
 * brilho mínimo mantendo o matiz, para continuar identificando o jogador de relance.
 * @returns {string} "r g b" em 0..255, sem alfa.
 */
function pudim_LightenPlayerColor(c) {
    let r = Math.round((c.r || 0) * 255);
    let g = Math.round((c.g || 0) * 255);
    let b = Math.round((c.b || 0) * 255);
    const maxc = Math.max(r, g, b);
    // Sobe o canal mais forte até 235 preservando a proporção entre canais (matiz)
    if (maxc > 0 && maxc < 235) {
        const k = 235 / maxc;
        r = Math.min(255, Math.round(r * k));
        g = Math.min(255, Math.round(g * k));
        b = Math.min(255, Math.round(b * k));
    }
    // Piso de luminância: mistura com branco se ainda estiver escuro demais.
    // Misturar com branco na fração m da luminância L para: L + m*(255 - L).
    // Logo, para atingir o alvo T: m = (T - L) / (255 - L). O denominador tem de ser
    // (255 - L), não 255 — com 255 a mistura fica curta e o azul escuro do P1
    // (10,10,190) parava em luminância 119, abaixo do piso (pego por teste).
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b;
    if (lum < 130) {
        const m = (130 - lum) / (255 - lum);
        r = Math.min(255, Math.round(r + (255 - r) * m));
        g = Math.min(255, Math.round(g + (255 - g) * m));
        b = Math.min(255, Math.round(b + (255 - b) * m));
    }
    return r + " " + g + " " + b;
}

/** Fundo da linha: cor do jogador bem escurecida, para diferenciar sem ofuscar o texto */
function pudim_RowTint(c, alpha) {
    const r = Math.round((c.r || 0) * 255 * 0.32);
    const g = Math.round((c.g || 0) * 255 * 0.32);
    const b = Math.round((c.b || 0) * 255 * 0.32);
    return "color: " + r + " " + g + " " + b + " " + alpha;
}

// ─── Flare automático de combate ──────────────────────────────────────────────
// Marca no minimapa o foco de uma batalha real — UMA vez por batalha, não em série.
//
// SOMENTE LOCAL: usamos renderAndPlayFlare (gui/session/unit_actions.js), que desenha o
// marcador, faz o ping no minimapa, toca o som e escreve no chat — tudo no nosso cliente.
// Quem avisa os aliados é Engine.SendNetworkFlare, chamado apenas dentro de
// triggerFlareAction — que de propósito NÃO usamos aqui. Assim o aviso não incomoda
// ninguém. Isso também pula o cooldown global de flare do jogo, o que é desejado:
// nosso próprio controle (um por batalha) já limita a frequência, e o flare manual do
// jogador continua com o cooldown dele intacto.
var g_PudimFlaredThisBattle = {};   // playerId -> já sinalizou a batalha em curso
var g_PudimCombatQuietTicks = {};   // playerId -> ticks seguidos sem combate

// Mínimo de unidades no foco para valer um flare. Caça a animais já é filtrada no
// servidor (alvo Gaia não é inimigo); isto barra escaramuça de 1-2 unidades.
const PUDIM_AUTOFLARE_MIN_UNITS = 3;
// Ticks (de 1s) sem combate para considerar a batalha encerrada e liberar novo flare.
const PUDIM_COMBAT_END_TICKS = 10;

function pudim_AutoFlareCombat(now, allies) {
    if (typeof renderAndPlayFlare !== "function") return; // API ausente: não faz nada
    if (typeof g_IsObserver !== "undefined" && g_IsObserver) return;

    for (const d of allies) {
        if (!d) continue;
        const pid = d.id;
        const fighting = d.inCombat && d.combatPos &&
                         (d.combatSize || 0) >= PUDIM_AUTOFLARE_MIN_UNITS;

        if (!fighting) {
            // A batalha só termina após alguns ticks quietos — sem isso, a troca de alvo
            // entre dois golpes zeraria o estado e o flare voltaria a disparar em série.
            g_PudimCombatQuietTicks[pid] = (g_PudimCombatQuietTicks[pid] || 0) + 1;
            if (g_PudimCombatQuietTicks[pid] >= PUDIM_COMBAT_END_TICKS)
                g_PudimFlaredThisBattle[pid] = false;
            continue;
        }

        g_PudimCombatQuietTicks[pid] = 0;
        if (g_PudimFlaredThisBattle[pid]) continue; // um flare por batalha
        g_PudimFlaredThisBattle[pid] = true;
        try {
            renderAndPlayFlare({ "x": d.combatPos.x, "z": d.combatPos.z },
                               Engine.GetPlayerGUID());
        } catch(e) {}
        return; // no máximo um flare por atualização
    }
}

function pudim_UpdateAllyBar() {
    const now = Date.now();
    if (now - g_PudimAllyBarLastUpdate < 1000) return;
    g_PudimAllyBarLastUpdate = now;

    // Quem sabe que está assistindo é o CLIENTE, não a simulação: observador seguindo um
    // jogador chega lá com o id dele, e a simulação não teria como distinguir isso de quem
    // está jogando de verdade. Ver o bloco "OBSERVADOR VÊ TODO MUNDO" em
    // GuiInterface~pudim.js.
    const observando = (typeof g_IsObserver !== "undefined") && !!g_IsObserver;

    let allies;
    try { allies = Engine.GuiInterfaceCall("pudim_GetAllyStats", { "todos": observando }); }
    catch(e) { return; }
    const container = Engine.TryGetGUIObjectByName("pudimAllyBar");

    if (!allies || allies.length === 0) {
        if (container) container.hidden = true;
        return;
    }

    if (container) container.hidden = false;

    // ── OBSERVANDO: TODO MUNDO, AGRUPADO POR EQUIPE ─────────────────────────────────────
    //
    // Pedido de 06/09: "quando sou observador, mostrar os status de todos os jogadores,
    // separados por equipe".
    //
    // g_IsObserver é a global do jogo — a mesma que autociv, moderngui e localratings usam,
    // conferida no disco. Não é um estado que o mod precise inventar nem manter.
    //
    // Jogando, a ordem continua a de sempre: maior população no topo, que é a comparação
    // que interessa de relance entre aliados. (`observando` já foi lido lá em cima, na
    // chamada da simulação — uma leitura só por ciclo.)

    // -1 é "sem equipe" (cada um por si) e vai para o fim: são os avulsos, e deixá-los no
    // meio quebraria a leitura dos blocos.
    const ordemEquipe = t => (t === undefined || t === null || t < 0) ? 9999 : t;

    allies.sort(function(a, b) {
        if (observando) {
            const ta = ordemEquipe(a && a.team), tb = ordemEquipe(b && b.team);
            if (ta !== tb) return ta - tb;
        } else {
            // A SUA LINHA FICA NO TOPO, SEMPRE.
            //
            // Relato de 08/09: "so mostra dos outros, mas n a minha". A sua linha e a
            // referencia contra a qual as outras sao lidas — se ela troca de lugar conforme
            // a populacao sobe e desce, achar a propria linha vira uma busca a cada olhada,
            // e no meio de uma briga isso e o mesmo que ela nao estar la.
            //
            // Assistindo nao se aplica: nao ha "sua" linha, e o agrupamento por equipe manda.
            if (a && a.isSelf) return -1;
            if (b && b.isSelf) return 1;
        }
        const pa = (a && a.popCount) || 0, pb = (b && b.popCount) || 0;
        if (pb !== pa) return pb - pa;
        return ((a && a.id) || 0) - ((b && b.id) || 0); // empate: ordem estável por ID
    });

    // DIAGNOSTICO, porque "so mostra dos outros" nao distingue duas causas muito diferentes:
    // a sua linha nao VEIO da simulacao, ou veio e nao foi desenhada. Uma linha a cada 30s,
    // e so quando ela realmente falta.
    if (!observando && !allies.some(a => a && a.isSelf) &&
        now - g_PudimAllySelfLogAt > 30000) {
        g_PudimAllySelfLogAt = now;
        try {
            pudim_Log("WARN", "ALIADOS", "a propria linha nao veio da simulacao: " +
                allies.length + " jogador(es), ids=" + allies.map(a => a && a.id).join(","));
        } catch (e) {}
    }

    pudim_AutoFlareCombat(now, allies);

    // ── DUAS COLUNAS, E O TOTAL DE CADA EQUIPE ──────────────────────────────────────────
    //
    // Assistindo, a lista ganha uma linha de soma por equipe e os blocos vão lado a lado.
    // Jogando nada disso se aplica: são poucos aliados e a barra larga continua melhor.
    //
    // Duas colunas só quando elas REALMENTE cabem. A largura da janela vem de
    // getComputedSize() do objeto "session", como o autociv a lê; se a medida falhar, o
    // valor é 0 e o caminho é o de sempre — nunca apertar a barra por causa de uma medida
    // que não veio.
    const larguraTela = pudim_LarguraTela();
    const cabemDuas = larguraTela >= 2 * PUDIM_LARGURA_COMPACTA + PUDIM_COL_GAP + 2 * PUDIM_MARGEM_TELA;
    const colunas = (observando && cabemDuas) ? 2 : 1;
    const compacto = colunas === 2;

    const linhas = observando ? pudim_MontarLinhasEquipe(allies, ordemEquipe) : allies;
    if (observando) pudim_DistribuirColunas(linhas, ordemEquipe, colunas);

    pudim_AplicarLayoutBarra(compacto);
    if (container) {
        const largura = compacto ? PUDIM_LARGURA_COMPACTA : PUDIM_LARGURA_LARGA;
        try {
            container.size = compacto
                ? ("50%-" + (largura + PUDIM_COL_GAP / 2) + " 36 50%+" +
                   (largura + PUDIM_COL_GAP / 2) + " 100%")
                : PUDIM_BAR_SIZE_LARGA;
        } catch (e) {}
    }

    // Deslocamento acumulado pelos respiros entre equipes, no modo de coluna única.
    let desloc = 0;

    for (let i = 0; i < PUDIM_MAX_ROWS; ++i) {
        const row = Engine.TryGetGUIObjectByName("pudimAllyRow[" + i + "]");
        if (!row) continue;

        if (i >= linhas.length) {
            row.hidden = true;
            continue;
        }

        row.hidden = false;
        const d = linhas[i];
        const pid = d.id;

        // Observando, um respiro entre equipes. É o que faz o olho ler BLOCOS em vez de uma
        // lista corrida — sem isso, "separados por equipe" vira só uma ordenação, que ninguém
        // enxerga. O deslocamento acumula, então cada bloco desce junto.
        if (observando && colunas === 1 && i > 0 &&
            ordemEquipe(d.team) !== ordemEquipe(linhas[i - 1].team))
            desloc += PUDIM_GAP_EQUIPE;

        // O `size` vai como STRING: a linha nasce com `100%` na direita, e escrever só o
        // número deixaria a direita em "100% + x". Ver a nota em pudim_AplicarLayoutBarra.
        const col = compacto ? (d._col || 0) : 0;
        const lin = compacto ? (d._row || 0) : i;
        const x1 = compacto ? col * (PUDIM_LARGURA_COMPACTA + PUDIM_COL_GAP) : 0;
        const x2 = x1 + (compacto ? PUDIM_LARGURA_COMPACTA : PUDIM_LARGURA_LARGA);
        const y1 = lin * PUDIM_ROW_H + (compacto ? 0 : desloc);
        try { row.size = x1 + " " + y1 + " " + x2 + " " + (y1 + PUDIM_ROW_H); } catch (e) {}

        // Flash state keyed by player ID
        const prevPhase = g_PudimAllyLastPhase[pid];
        if (prevPhase !== undefined && d.phase > prevPhase) {
            g_PudimAllyFlashEndTime[pid] = now + 4000;
            g_PudimAllyFlashType[pid] = "phase_done";
        } else if (d.isResearchingPhase && g_PudimAllyFlashType[pid] !== "phase_done") {
            if (g_PudimAllyFlashType[pid] !== "phase_upgrade") {
                g_PudimAllyFlashEndTime[pid] = now + 999999;
                g_PudimAllyFlashType[pid] = "phase_upgrade";
            }
        } else if (d.gatherers && d.gatherers.isUnderAttack && !d.isSelf &&
                   g_PudimAllyFlashType[pid] !== "phase_done" && g_PudimAllyFlashType[pid] !== "phase_upgrade") {
            g_PudimAllyFlashEndTime[pid] = now + 2000;
            g_PudimAllyFlashType[pid] = "under_attack";
        } else if (!d.isResearchingPhase && g_PudimAllyFlashType[pid] === "phase_upgrade") {
            g_PudimAllyFlashEndTime[pid] = 0;
            g_PudimAllyFlashType[pid] = null;
        } else if (!(d.gatherers && d.gatherers.isUnderAttack) && g_PudimAllyFlashType[pid] === "under_attack") {
            g_PudimAllyFlashEndTime[pid] = 0;
            g_PudimAllyFlashType[pid] = null;
        }
        g_PudimAllyLastPhase[pid] = d.phase;

        let nameObj  = Engine.TryGetGUIObjectByName("pudimAllyName[" + i + "]");
        let popObj   = Engine.TryGetGUIObjectByName("pudimAllyPop[" + i + "]");
        let foodObj  = Engine.TryGetGUIObjectByName("pudimAllyFood[" + i + "]");
        let woodObj  = Engine.TryGetGUIObjectByName("pudimAllyWood[" + i + "]");
        let stoneObj = Engine.TryGetGUIObjectByName("pudimAllyStone[" + i + "]");
        let metalObj = Engine.TryGetGUIObjectByName("pudimAllyMetal[" + i + "]");
        let kdObj    = Engine.TryGetGUIObjectByName("pudimAllyKD[" + i + "]");
        let armyObj  = Engine.TryGetGUIObjectByName("pudimAllyArmy[" + i + "]");

        let cColor = d.color || {r: 1, g: 1, b: 1};
        // Cor do jogador CLAREADA: as cores cruas do jogo incluem tons escuros (o azul do
        // P1 é 10,10,190) que somem no fundo preto do painel. Clarear garante contraste.
        let colorStr = pudim_LightenPlayerColor(cColor) + " 255";

        // Observando, a equipe entra no rótulo. O respiro separa os blocos, mas quem chega
        // no meio da partida precisa saber QUAL bloco é qual sem contar linhas.
        // "-" para quem está sem equipe, que é o -1 do motor.
        //
        // SEM COLCHETE. A primeira versão escrevia "[2] Nome" e o jogo despejou
        //
        //   Invalid tag "[2" at 2 in '[2] Atrik  [color="80 150 240"]III[/color]'
        //
        // na tela, uma linha por jogador por atualização. Colchete abre TAG no texto da
        // interface (é assim que [color=...] funciona), então "[2]" é uma tag inválida, não
        // um rótulo. "T2" diz a mesma coisa e não disputa com a marcação.
        const prefix = observando
            ? "T" + (ordemEquipe(d.team) === 9999 ? "-" : (d.team + 1)) + " "
            : (d.isSelf ? "★" : " ");
        let nick = (g_Players && g_Players[pid] && g_Players[pid].name) ? g_Players[pid].name : ("P" + pid);
        // O NOME É TEXTO DO JOGADOR, E ELE PODE TER COLCHETE.
        //
        // O erro de hoje ("Invalid tag") veio de um colchete meu, mas o mesmo vale para o
        // nick: clã entre colchetes é comum no lobby, e um "[FUN]Bob" derrubaria a barra em
        // erro para TODO MUNDO que usa o mod. escapeText é o helper do próprio jogo para
        // isto — o comentário dele diz "apply escapeText on player provided input to avoid
        // players breaking the game for everybody". Com a guarda de existência, porque nem
        // todo contexto de interface o carrega.
        if (typeof escapeText === "function") { try { nick = escapeText(nick); } catch (e) {} }
        nick = nick.replace(/\s*\(\d+\)\s*$/, "").trim();
        // 14, e nao 16: o prefixo de equipe ("T1 ") entrou em 06/09 para o modo observador e
        // comeu o espaco que o corte antigo supunha. O pior caso agora e
        // "T1 " + 14 do nick + "  III" = 22 caracteres, dentro dos 175px do campo.
        // Ver o comentario de larguras em 03_pudim_ally_bar.xml.
        const nickMax = compacto ? PUDIM_NICK_MAX_COMPACTO
                                 : (observando ? PUDIM_NICK_MAX_OBS : PUDIM_NICK_MAX);
        if (nick.length > nickMax) nick = nick.slice(0, nickMax - 1) + "~";
        const phaseLabel = PUDIM_PHASE_LABELS[d.phase] || "";
        const phaseColor = PUDIM_PHASE_COLORS[d.phase] || "160 160 160";

        if (nameObj) {
            // A linha de total não tem nick nem fase: ela é a soma do bloco, e o rótulo já
            // diz de qual equipe e de quantos jogadores.
            nameObj.caption = d.isTotal
                ? "[color=\"255 235 150\"]" + d.name + "[/color]"
                : prefix + nick + "  [color=\"" + phaseColor + "\"]" + phaseLabel + "[/color]";
            nameObj.textcolor = d.isTotal ? "255 235 150 255" : colorStr;
        }
        if (popObj) {
            // Mesmo formato da barra superior do jogo: usados/teto-atual (maximo).
            // O teto atual (GetPopulationLimit) e o espaco disponivel para crescer, dado
            // pelas casas ja construidas; o valor entre parenteses e o maximo da partida.
            // O "+N" e quantas vagas de populacao ainda sobram — "o que e esse + 7?".
            // Pergunta legitima: e o numero que diz se ja precisa de casa, e a cor responde
            // sozinha (vermelho <=2, amarelo <=6, verde acima).
            const free = Math.max(0, (d.popLimit || 0) - (d.popCount || 0));
            const freeColor = free <= 2 ? "255 120 120" : (free <= 6 ? "255 220 120" : "150 220 150");
            // O MAXIMO DA PARTIDA SAIU DAQUI.
            //
            // Ele era o "(200)" no fim, e e o MESMO numero para todos os jogadores da
            // partida: nove linhas repetindo 200 gastavam seis caracteres cada para nao
            // distinguir ninguem. Era ele que estourava o campo e cortava o resto — "18/30"
            // aparecia sem o "+12" porque a legenda inteira tinha 15 caracteres.
            popObj.caption = d.popCount + "/" + d.popLimit +
                " [color=\"" + freeColor + "\"]+" + free + "[/color]";
        }

        const g = d.gatherers || {};
        const rf = Math.floor((d.res || {}).food || 0);
        const rw = Math.floor((d.res || {}).wood || 0);
        const rs = Math.floor((d.res || {}).stone || 0);
        const rm = Math.floor((d.res || {}).metal || 0);

        // No compacto o coletor vem sem parênteses ("1735·64"): são dois caracteres por
        // recurso, e foram eles que fizeram a coluna caber em 794px. Ver PUDIM_LAYOUT_COMPACTO.
        const cnt = (n, cor) => compacto
            ? " [color=\"" + cor + "\"]·" + n + "[/color]"
            : " [color=\"" + cor + "\"](" + n + ")[/color]";
        if (foodObj)  foodObj.caption  = rf + cnt(g.food  || 0, "255 240 150 200");
        if (woodObj)  woodObj.caption  = rw + cnt(g.wood  || 0, "200 255 150 200");
        if (stoneObj) stoneObj.caption = rs + cnt(g.stone || 0, "220 220 220 200");
        if (metalObj) metalObj.caption = rm + cnt(g.metal || 0, "180 230 255 200");

        // ── MELHORIAS: ECONÔMICA E MILITAR ──────────────────────────────────────────────
        // Pedido de 14/09. Quem pesquisou colheita e casa está na frente na economia; quem
        // pesquisou ataque e resistência está na frente na tropa — e os dois números juntos
        // dizem em que o adversário gastou o tempo dele. A classificação dos 92 nomes de
        // tecnologia medidos nos replays está em pudim_ClasseDaTecnologia, na simulação.
        const upgObj = Engine.TryGetGUIObjectByName("pudimAllyUpg[" + i + "]");
        if (upgObj)
            upgObj.caption = "[color=\"150 220 150\"]E" + (d.upgEco || 0) + "[/color] " +
                             "[color=\"255 170 120\"]M" + (d.upgMil || 0) + "[/color]";

        let kills  = d.kills  || 0;
        let deaths = d.deaths || 0;
        let ratio  = deaths === 0 ? kills : (kills / deaths).toFixed(1);
        if (kdObj) kdObj.caption = "[color=\"80 210 80\"]" + kills + "k[/color]/[color=\"210 80 80\"]" + deaths + "d[/color] [color=\"220 220 220\"]" + ratio + "[/color]";

        if (armyObj) {
            let s = d.support || 0; let inf = d.infantry || 0; let cav = d.cavalry || 0;
            let arq = d.ranged || 0; let sie = d.siege || 0;
            // No compacto os rótulos ficam de uma letra: "Al In Ca Ar" viram "A I C R",
            // quatro caracteres a menos, sem perder qual é qual (a cor já distingue).
            //
            // Os rótulos saem para VARIÁVEIS antes de entrar na legenda, e não para um
            // vetor indexado dentro dela. `r[0]` no meio da string faz o teste de colchetes
            // (tools/test_observador.js) apontar um "[0" que não existe na tela — e esse
            // teste nasceu do erro real "Invalid tag [2", então enfraquecê-lo para caber um
            // atalho meu seria trocar a proteção pela conveniência.
            const rAl = compacto ? "A" : "Al", rIn = compacto ? "I" : "In";
            const rCa = compacto ? "C" : "Ca", rAr = compacto ? "R" : "Ar";
            const rSi = compacto ? "S" : "Si";
            armyObj.caption = "[color=\"220 220 220\"]" + rAl + ":" + s + "[/color] " +
                              "[color=\"180 200 255\"]" + rIn + ":" + inf + "[/color] " +
                              "[color=\"255 190 140\"]" + rCa + ":" + cav + "[/color] " +
                              "[color=\"180 240 180\"]" + rAr + ":" + arq + "[/color]" +
                              (sie > 0 ? " [color=\"220 180 220\"]" + rSi + ":" + sie + "[/color]" : "");
        }
    }

    pudim_UpdateAllyFlash(now, linhas);
}

function pudim_UpdateAllyFlash(now, allies) {
    for (let i = 0; i < PUDIM_MAX_ROWS; ++i) {
        const row = Engine.TryGetGUIObjectByName("pudimAllyRow[" + i + "]");
        if (!row || row.hidden) continue;

        const d = allies && allies[i];
        const pid = d ? d.id : null;
        const flashEnd  = pid !== null ? (g_PudimAllyFlashEndTime[pid] || 0) : 0;
        const flashType = pid !== null ? g_PudimAllyFlashType[pid] : null;

        const bgOverlay = Engine.TryGetGUIObjectByName("pudimAllyBgOverlay[" + i + "]");

        // EM COMBATE tem prioridade sobre tudo: pisca vermelho escuro enquanto houver
        // tropas lutando (próprias ou do aliado) e para sozinho quando a luta acabar —
        // o estado vem da simulação a cada atualização, não de um timer.
        if (d && d.inCombat) {
            const blink = (Math.floor(now / 400) % 2 === 0);
            row.sprite = blink ? "color: 120 12 12 215" : "color: 45 6 6 200";
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            continue;
        }

        if (d && d.isTotal) {
            // A linha de soma fecha o bloco da equipe: fundo neutro e mais claro, para o
            // olho separar "um jogador" de "o time inteiro" sem ler o rótulo.
            row.sprite = "color: 60 55 30 215";
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
        } else if (d && d.isSelf) {
            // Próprio jogador: fundo na própria cor (mais forte) para destacar a sua linha
            row.sprite = pudim_RowTint(d.color || { r: 0.1, g: 0.3, b: 0.8 }, 210);
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
        } else if (flashEnd > now) {
            if (flashType === "phase_upgrade") {
                row.sprite = "color: 20 140 50 150";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            } else if (flashType === "phase_done") {
                const blink = (Math.floor(now / 300) % 2 === 0);
                row.sprite = blink ? "color: 20 60 200 210" : "color: 0 0 0 190";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            } else if (flashType === "under_attack") {
                row.sprite = "color: 160 10 10 150";
                if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
            }
        } else {
            if (pid !== null && flashType) {
                g_PudimAllyFlashType[pid] = null;
                g_PudimAllyFlashEndTime[pid] = 0;
            }
            // Fundo padrão: tom escuro da cor do jogador, para identificar a linha de relance
            row.sprite = d && d.color ? pudim_RowTint(d.color, 190) : "color: 0 0 0 190";
            if (bgOverlay) bgOverlay.sprite = "color: 0 0 0 0";
        }
    }
}
