/**
 * PudimMod — Barra de metas.
 *
 * Pedido de 28/09: "veja os melhores marcos, como menor tempo pra atingir pop 100, pra
 * chegar na fase 3 e pra atingir a população máxima (200); deixar uma barra de metas, onde
 * mostra a próxima meta, e se está perto ou longe de atingir, talvez com sistema de cores".
 * E: "veja o replay dos jogos multiplayers onde tem os melhores jogadores" e "quanto tempo e
 * quanto de pop, quem atingiu pop 200 mais rápido tinha pra fazer o primeiro e o segundo
 * quartel".
 *
 * DE ONDE VÊM OS NÚMEROS (análise de 395 replays da A28, 28/09):
 *   • só partidas JUSTAS: recurso inicial 300, sem trapaça, sem nômade, 2+ humanos;
 *   • REFERÊNCIA = mediana dos 20 jogadores que chegaram mais rápido a pop 200 (replays
 *     duplicados da mesma partida contados uma vez). Entre eles: chrstgtr (2055), SaidRdz
 *     (1987), Arpad_, Luxxo, justN4VI...
 *   • RECORDE = o seu melhor tempo em multiplayer, até o mod gravar um melhor (pudim.metas.*).
 *   • tempos são do RELÓGIO DA PARTIDA. População: amostra de 30 em 30 s do resumo do replay,
 *     interpolada. Fase: o pedido de pesquisa cujo gasto (500+500 / 750+750) aparece no resumo
 *     — pedido sem recurso o motor recusa — mais o tempo de pesquisa do jogo (30 s / 60 s,
 *     conferidos em simulation/data/technologies/phase_*.json). Quartel: o pedido de construir
 *     com 200 de madeira gastos na mesma janela.
 *
 * Quartel não tem "recorde": fazer mais cedo não é melhor por si. A referência dele diz
 * QUANDO os mais rápidos fizeram — em tempo e em população.
 */

const PUDIM_METAS = [
	{ "id": "quartel1", "nome": "1º quartel", "tipo": "quartel", "n": 1, "ref": 187, "refPop": 40 },
	{ "id": "quartel2", "nome": "2º quartel", "tipo": "quartel", "n": 2, "ref": 335, "refPop": 71 },
	{ "id": "pop100",   "nome": "Pop 100",    "tipo": "pop",     "n": 100, "ref": 426, "recorde": 410 },
	{ "id": "fase2",    "nome": "Fase 2",     "tipo": "fase",    "fase": "town", "ref": 549, "refPop": 151, "recorde": 437 },
	{ "id": "pop200",   "nome": "Pop 200",    "tipo": "pop",     "n": 200, "ref": 690, "recorde": 750 },
	{ "id": "fase3",    "nome": "Fase 3",     "tipo": "fase",    "fase": "city", "ref": 769, "recorde": 782 }
];

// Curva de população da referência (tempo em s → pop), para medir o RITMO a qualquer
// momento, não só na hora de cada meta. Pontos das mesmas medianas acima.
const PUDIM_METAS_CURVA = [[187, 40], [335, 71], [426, 100], [549, 151], [690, 200]];

const PUDIM_METAS_INTERVALO = 1000;
const PUDIM_METAS_QUARTEL_INTERVALO = 2000;
const PUDIM_METAS_BAR_X1 = 4;
const PUDIM_METAS_BAR_X2 = 224;
const PUDIM_METAS_COR = {
	"verde":    { "sprite": "color: 60 190 80 230",  "texto": "130 235 140" },
	"amarelo":  { "sprite": "color: 220 180 50 230", "texto": "240 215 110" },
	"vermelho": { "sprite": "color: 210 70 60 230",  "texto": "250 130 120" },
	"feito":    { "sprite": "color: 90 150 220 230", "texto": "150 200 250" }
};

var g_PudimMetasAccum = PUDIM_METAS_INTERVALO;
var g_PudimMetasQuartelAccum = PUDIM_METAS_QUARTEL_INTERVALO;
var g_PudimMetasQuarteis = 0;
var g_PudimMetasFeitas = {};      // id → { t, pop }
var g_PudimMetasPopInicial = null;
var g_PudimMetasJogador = null;   // quem está sendo medido; trocou, recomeça

/** "7:06" */
function pudim_MetaTempo(s) {
	if (s === undefined || s === null || !isFinite(s)) return "-";
	s = Math.max(0, Math.round(s));
	return Math.floor(s / 60) + ":" + String(s % 60).padStart(2, "0");
}

/** Pop da referência no instante t (s), interpolada; antes do primeiro ponto, da largada. */
function pudim_MetaRefPop(t, popInicial) {
	const c = [[0, popInicial || 9]].concat(PUDIM_METAS_CURVA);
	for (let k = 1; k < c.length; ++k)
		if (t <= c[k][0])
			return c[k - 1][1] + (c[k][1] - c[k - 1][1]) * (t - c[k - 1][0]) / (c[k][0] - c[k - 1][0]);
	return c[c.length - 1][1];
}

/** Recorde gravado (s) ou o da análise. Só pop e fase têm recorde. */
function pudim_MetaRecorde(m) {
	const v = Number(Engine.ConfigDB_GetValue("user", "pudim.metas." + m.id));
	return (v > 0) ? v : m.recorde;
}

/** A partida vale para recorde? Mesmos critérios da análise dos replays. */
function pudim_MetaPartidaJusta() {
	try {
		const s = g_InitAttributes && g_InitAttributes.settings;
		return !!s && s.StartingResources === 300 && !s.CheatsEnabled && !s.Nomad;
	} catch (e) { return false; }
}

/**
 * O estado de uma meta agora: { feita, cor, frac, texto }. Pura: recebe tudo o que precisa.
 *   estado = { t (s), pop, fase ("village"|"town"|"city"), quarteis, popInicial, popMax }
 */
function pudim_MetaAvaliar(m, estado) {
	const t = estado.t, pop = estado.pop;
	const falta = m.ref - t;
	const ritmo = pop / Math.max(1, pudim_MetaRefPop(t, estado.popInicial));
	let cor, frac, detalhe;
	if (m.tipo === "pop") {
		frac = pop / m.n;
		cor = ritmo >= 0.95 ? "verde" : ritmo >= 0.85 ? "amarelo" : "vermelho";
		const dif = Math.round(pop - pudim_MetaRefPop(t, estado.popInicial));
		detalhe = "pop " + pop + "/" + m.n + " · ritmo " + (dif >= 0 ? "+" : "") + dif;
	} else if (m.tipo === "quartel") {
		frac = Math.min(1, pop / m.refPop);
		// Passou do tempo da referência: atrasado. Chegou na população em que eles faziam:
		// é a hora.
		cor = t > m.ref + 30 ? "vermelho" : pop >= m.refPop ? "amarelo" : "verde";
		detalhe = "ref pop " + m.refPop + " · agora " + pop + (pop >= m.refPop ? " — hora de fazer" : "");
	} else {
		frac = Math.min(1, t / m.ref);
		cor = falta > 90 ? "verde" : falta > 0 ? "amarelo" : "vermelho";
		detalhe = (m.refPop ? "ref pop " + m.refPop + " · " : "") + "agora pop " + pop;
	}
	const rec = pudim_MetaRecorde(m);
	const texto = m.nome + " · ref " + pudim_MetaTempo(m.ref) +
		(rec ? " · recorde " + pudim_MetaTempo(rec) : "") +
		" · " + (falta >= 0 ? "faltam " + pudim_MetaTempo(falta) : "atrasado " + pudim_MetaTempo(-falta));
	return { "cor": cor, "frac": Math.max(0, Math.min(1, frac)), "texto": texto, "detalhe": detalhe };
}

/** A meta está cumprida neste estado? */
function pudim_MetaCumprida(m, estado) {
	if (m.tipo === "pop") return estado.pop >= m.n;
	if (m.tipo === "quartel") return estado.quarteis >= m.n;
	if (m.tipo === "fase") return m.fase === "town" ? (estado.fase === "town" || estado.fase === "city") : estado.fase === "city";
	return false;
}

/**
 * Marca as metas que acabaram de ser cumpridas. Devolve a lista das novas, para avisar.
 * Uma meta que ficou para trás (uma posterior já foi cumprida) sai da fila sem tempo: quem
 * joga de cavalaria nunca faz o 2º quartel, e a barra não pode ficar presa nele.
 */
function pudim_MetasMarcar(estado, feitas) {
	const novas = [];
	PUDIM_METAS.forEach((m, i) => {
		if (feitas[m.id] || !pudim_MetaCumprida(m, estado)) return;
		feitas[m.id] = { "t": estado.t, "pop": estado.pop };
		novas.push(m);
		for (let k = 0; k < i; ++k)
			if (!feitas[PUDIM_METAS[k].id] && PUDIM_METAS[k].tipo === "quartel")
				feitas[PUDIM_METAS[k].id] = { "pulada": true };
	});
	return novas;
}

function pudim_MetaProxima(feitas, popMax) {
	for (const m of PUDIM_METAS) {
		if (feitas[m.id]) continue;
		if (m.tipo === "pop" && popMax && popMax < m.n) continue;   // teto abaixo da meta
		return m;
	}
	return null;
}

function pudim_MetasDica(feitas, estado) {
	const linhas = ["[font=\"sans-bold-14\"]Metas da partida[/font]",
		"Referência: mediana dos 20 jogadores que chegaram mais rápido a pop 200 nos replays multiplayer (recurso inicial padrão). Recorde: o seu melhor.", ""];
	for (const m of PUDIM_METAS) {
		const f = feitas[m.id];
		const rec = pudim_MetaRecorde(m);
		let l = (f && f.pulada) ? m.nome + ": pulada" :
			f ? "[color=\"130 235 140\"]feito[/color]  " + m.nome + ": " + pudim_MetaTempo(f.t) + " (pop " + f.pop + ")" :
			"[color=\"200 200 200\"]falta[/color]  " + m.nome;
		l += "   [color=\"170 170 170\"]ref " + pudim_MetaTempo(m.ref) +
			(m.refPop ? " com pop " + m.refPop : "") + (rec ? " · recorde " + pudim_MetaTempo(rec) : "") + "[/color]";
		if (f && !f.pulada) {
			const d = Math.round(f.t - m.ref);
			l += "  [color=\"" + (d <= 0 ? "130 235 140" : "250 130 120") + "\"]" + (d <= 0 ? "-" : "+") +
				pudim_MetaTempo(Math.abs(d)) + "[/color]";
		}
		linhas.push(l);
	}
	if (!pudim_MetaPartidaJusta())
		linhas.push("", "[color=\"240 215 110\"]Esta partida não vale recorde (recurso inicial diferente de 300, trapaça ou nômade).[/color]");
	return linhas.join("\n");
}

/** Lê o jogo e desenha. Só lê (o recorde vai para o user.cfg, que é local). */
function pudim_AtualizarMetas(dt) {
	const raiz = Engine.TryGetGUIObjectByName("pudimMetas");
	if (!raiz) return;
	if (Engine.ConfigDB_GetValue("user", "pudim.metas.mostrar") === "false" ||
	    (typeof g_PudimPanelOpen !== "undefined" && g_PudimPanelOpen)) {
		raiz.hidden = true;
		return;
	}
	const assistindo = typeof g_IsObserver !== "undefined" && !!g_IsObserver;
	const jogador = (typeof g_ViewedPlayer !== "undefined" && g_ViewedPlayer > 0) ? g_ViewedPlayer : Engine.GetPlayerID();
	const sim = GetSimState();
	const ps = sim && sim.players && sim.players[jogador];
	if (!ps || jogador <= 0) { raiz.hidden = true; return; }
	if (g_PudimMetasJogador !== jogador) {
		// Assistindo, trocar de jogador recomeça a conta: as metas são de quem está na tela.
		g_PudimMetasJogador = jogador;
		g_PudimMetasFeitas = {};
		g_PudimMetasQuarteis = 0;
		g_PudimMetasQuartelAccum = PUDIM_METAS_QUARTEL_INTERVALO;
		g_PudimMetasPopInicial = null;
	}
	// A largada vale só se a barra começou no começo do jogo; entrando no meio (partida salva,
	// reconexão, observador que chegou depois), a população atual não é a inicial.
	if (g_PudimMetasPopInicial === null)
		g_PudimMetasPopInicial = (sim.timeElapsed || 0) < 10000 ? ps.popCount : 9;

	// Quartel: consulta à simulação só enquanto faltar algum, e a cada 2 s.
	g_PudimMetasQuartelAccum += dt || 0;
	if (g_PudimMetasQuarteis < 2 && g_PudimMetasQuartelAccum >= PUDIM_METAS_QUARTEL_INTERVALO) {
		g_PudimMetasQuartelAccum = 0;
		try { g_PudimMetasQuarteis = Math.max(g_PudimMetasQuarteis, +Engine.GuiInterfaceCall("pudim_ContarQuarteis", { "jogador": jogador }) || 0); } catch (e) {}
	}

	const estado = { "t": (sim.timeElapsed || 0) / 1000, "pop": ps.popCount, "fase": ps.phase,
		"quarteis": g_PudimMetasQuarteis, "popInicial": g_PudimMetasPopInicial, "popMax": ps.popMax };
	const novas = pudim_MetasMarcar(estado, g_PudimMetasFeitas);
	for (const m of novas) {
		const rec = pudim_MetaRecorde(m);
		let msg = "Meta: " + m.nome + " em " + pudim_MetaTempo(estado.t) + " (ref " + pudim_MetaTempo(m.ref) + ")";
		// Recorde novo: só jogando (não assistindo) e só em partida justa.
		if (m.tipo !== "quartel" && !assistindo && pudim_MetaPartidaJusta() && (!rec || estado.t < rec)) {
			Engine.ConfigDB_CreateValue("user", "pudim.metas." + m.id, String(Math.round(estado.t)));
			Engine.ConfigDB_SaveChanges("user");
			msg += " — NOVO RECORDE (era " + pudim_MetaTempo(rec) + ")";
		}
		try { pudim_Log("INFO", "METAS", msg); } catch (e) {}
	}

	const txt = Engine.TryGetGUIObjectByName("pudimMetasTxt");
	const bar = Engine.TryGetGUIObjectByName("pudimMetasBar");
	const prox = pudim_MetaProxima(g_PudimMetasFeitas, estado.popMax);
	let cor, frac, texto;
	if (!prox) {
		cor = "feito"; frac = 1; texto = "Todas as metas cumpridas";
	} else {
		const a = pudim_MetaAvaliar(prox, estado);
		cor = a.cor; frac = a.frac; texto = a.texto;
		raiz.tooltip = a.detalhe + "\n\n" + pudim_MetasDica(g_PudimMetasFeitas, estado);
	}
	if (!prox) raiz.tooltip = pudim_MetasDica(g_PudimMetasFeitas, estado);
	const c = PUDIM_METAS_COR[cor];
	if (txt) txt.caption = "[color=\"" + c.texto + "\"]" + texto + "[/color]";
	if (bar) {
		bar.sprite = c.sprite;
		const b = bar.size;
		b.left = PUDIM_METAS_BAR_X1;
		b.right = PUDIM_METAS_BAR_X1 + (PUDIM_METAS_BAR_X2 - PUDIM_METAS_BAR_X1) * frac;
		bar.size = b;
	}
	raiz.hidden = false;
}
