/**
 * Fila nunca parada por falta de casa, reforço na obra e casa perto do construtor (28/09).
 *
 * Pedido (print 24/25 com lotes de 2 e 3 parados): "nunca deixe que a fila de unidades fique
 * parada; se só tiver espaço pra 1 unidade, só faça 1; depois, quando tiver mais casas, volte
 * ao normal; se tiver risco de o limite populacional atrapalhar, envie mais construtores pra
 * agilizar; sempre fazer casas perto do construtor". E: "como casa é rápido, pega os
 * construtores pra ajudar mais perto que tiver, e depois devolve eles pra onde estavam".
 *
 * Rodar:  node tools/test_fila_casa.js
 */
"use strict";
const fs = require("fs");
const path = require("path");
const vm = require("vm");

const base = path.join(__dirname, "..");
const norm = s => s.split("\r\n").join("\n");
const sim = norm(fs.readFileSync(path.join(base, "simulation", "components", "GuiInterface~pudim.js"), "utf8"));
const panel = norm(fs.readFileSync(path.join(base, "gui", "session", "pudim_panel.js"), "utf8"));
const execP = panel.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/^\s*\/\/.*$/gm, " ");

let fails = 0;
function check(name, cond, extra) {
	if (cond) { console.log("  ok   " + name); return; }
	fails++;
	console.log("  FAIL " + name + (extra !== undefined ? "  →  " + extra : ""));
}

console.log("fila, reforco e casa perto");

// ── 1. Lote parado por população vira lote do tamanho das vagas ──────────────────────
check("detecta lote parado: primeiro da fila, neededSlots > 0, sem progresso, do mod",
	/if \(doMod && \(cab\.neededSlots \|\| 0\) > 0 && \(cab\.progress \|\| 0\) <= 0 &&\s*\n\s*cab\.id !== undefined && cabem >= 1 && cabem < \(cab\.count \|\| 1\)\)/.test(execP));
check("só lote do mod (o template que ele semeou) — o seu não se toca",
	/const doMod = !!\(cab\.unitTemplate && cab\.unitTemplate === g_PudimQueueSeededTpl\[b\.ent\]\);/.test(execP));
check("as vagas contam o custo de população do template",
	/const cabem = custoPop > 0 \? Math\.floor\(vagasPop \/ custoPop\) : 0;/.test(execP));
check("cancela e repõe com as vagas que há (o motor devolve o recurso de lote sem progresso)",
	/"type": "stop-production", "entity": b\.ent, "id": cab\.id[\s\S]{0,200}"template": cab\.unitTemplate, "count": cabem/.test(execP));

// ── 2. Reforço na casa, rodando a função real ────────────────────────────────────────
const i = sim.indexOf("const PUDIM_CASA_REFORCO_MAX = 5;");
const j = sim.indexOf("// ── QUARTÉIS DO JOGADOR, CONTANDO FUNDAÇÃO");
function mundo(o) {
	const E = {};   // id -> componentes
	const add = (id, c) => { E[id] = c; };
	add(50, { House: true, fnd: { prog: 0.4, nb: 1 }, pos: [100, 100] });
	add(51, { House: true, fnd: { prog: 0.8, nb: 2 }, pos: [300, 300] });   // a mais adiantada
	add(60, { cc: true, pq: o.fila || [] });
	// construtores: distância à casa 51 (300,300)
	add(1, { builder: true, idle: false, ord: { type: "Gather", data: { target: 900 } }, pos: [310, 300] });   // 10
	add(2, { builder: true, idle: true, ord: null, pos: [360, 300] });                                          // 60, ocioso
	add(3, { builder: true, idle: false, ord: { type: "GatherNearPosition", data: { x: 5, z: 6, type: { generic: "wood", specific: "tree" } } }, pos: [320, 300] }); // 20
	add(4, { builder: true, idle: false, ord: { type: "Repair", data: {} }, pos: [305, 300] });                // construindo outra coisa
	add(5, { builder: true, idle: false, ord: { type: "Gather", data: { target: 901 } }, pos: [305, 305] });   // ordem SUA
	add(6, { builder: true, idle: false, ord: { type: "Gather", data: { target: 902 } }, pos: [500, 500] });   // longe
	add(7, { builder: true, idle: false, ord: { type: "Gather", data: { target: 903 } }, pos: [330, 300] });   // 30
	const IID = { RangeManager: 1, Identity: 2, Foundation: 3, Position: 4, ProductionQueue: 5, Builder: 6, UnitAI: 7, Player: 8 };
	const ctx = {
		Math, Set, Number, GuiInterface: function() {}, SYSTEM_ENTITY: 0,
		QueryPlayerIDInterface: () => ({ GetPopulationLimit: () => o.limite, GetPopulationCount: () => o.pop, GetMaxPopulation: () => 200 }),
		Engine: { QueryInterface: (id, iid) => {
			if (id === 0 && iid === IID.RangeManager) return { GetEntitiesByPlayer: () => Object.keys(E).map(Number) };
			const e = E[id]; if (!e) return null;
			if (iid === IID.Identity) return { HasClass: c => (c === "House" && e.House) };
			if (iid === IID.Foundation) return e.fnd ? { GetBuildProgress: () => e.fnd.prog, GetNumBuilders: () => e.fnd.nb } : null;
			if (iid === IID.Position) return { IsInWorld: () => true, GetPosition2D: () => ({ x: e.pos ? e.pos[0] : 0, y: e.pos ? e.pos[1] : 0 }) };
			if (iid === IID.ProductionQueue) return e.pq ? { GetQueue: () => e.pq } : null;
			if (iid === IID.Builder) return e.builder ? { GetEntitiesList: () => ["structures/gaul/house", "structures/gaul/storehouse"] } : null;
			if (iid === IID.UnitAI) return e.builder ? { IsIdle: () => e.idle, orderQueue: e.ord ? [e.ord] : [] } : null;
			return null;
		} }
	};
	for (const k in IID) ctx["IID_" + k] = IID[k];
	ctx.GuiInterface.prototype = {};
	vm.createContext(ctx);
	vm.runInContext(sim.slice(i, j), ctx);
	return ctx.GuiInterface.prototype.pudim_GetReforcoCasa(1, { playerOrdered: [5], protectedIds: [] });
}
{
	check("folga de 5 e nada parado: não reforça", mundo({ limite: 30, pop: 25 }) === null);
	const r = mundo({ limite: 25, pop: 24 });
	check("1 vaga: reforça a casa MAIS ADIANTADA (80%)", r && r.alvo === 51 && r.progresso === 80, JSON.stringify(r));
	check("até somar 5: tinha 2, entram 3", r && r.ajudantes.length === 3);
	check("os MAIS PERTO, só por distância (10, 20, 30) — ocioso a 60 não passa na frente",
		r && r.ajudantes.map(a => a.id).join() === "1,3,7", r && r.ajudantes.map(a => a.id).join());
	check("quem constrói outra coisa, ordem sua e quem está longe ficam de fora",
		r && !r.ajudantes.some(a => [4, 5, 6].indexOf(a.id) >= 0));
	check("volta para onde estava: o mesmo alvo, ou a mesma posição e tipo",
		r && r.ajudantes[0].volta.alvo === 900 && r.ajudantes[1].volta.x === 5 && r.ajudantes[1].volta.tipo.generic === "wood");
	const p = mundo({ limite: 40, pop: 30, fila: [{ unitTemplate: "u", count: 3, neededSlots: 2, progress: 0 }] });
	check("folga grande, mas lote parado por população: reforça também", p && p.ajudantes.length === 3);
}
check("o painel manda construir e, EM FILA, a volta",
	/"type": "repair", "entities": \[a\.id\], "target": r\.alvo,[\s\S]{0,300}"type": "gather", "entities": \[a\.id\], "target": a\.volta\.alvo, "queued": true/.test(execP) &&
	/"type": "gather-near-position", "entities": \[a\.id\],[\s\S]{0,160}"queued": true/.test(execP));
check("e não reforça a mesma obra de novo antes de 15 s (quem vai ainda está a caminho)",
	/const PUDIM_REFORCO_ESPERA = 15000;/.test(panel) && /if \(agora - \(g_PudimReforcoFeito\[r\.alvo\] \|\| 0\) < PUDIM_REFORCO_ESPERA\) return;/.test(execP));
const trava = execP.indexOf("if (typeof g_IsObserver !== \"undefined\" && g_IsObserver) return;");
check("roda abaixo da trava de espectador (manda comando)", trava > 0 && execP.indexOf("pudim_Medir(\"ProcessReforcoCasa\"") > trava);

// ── 3. Casa perto do construtor ──────────────────────────────────────────────────────
check("a casa só encosta numa vizinha a até 40 do construtor (era 100)",
	/const PUDIM_CASA_PERTO_CONSTRUTOR = 40;/.test(sim) &&
	/> PUDIM_CASA_PERTO_CONSTRUTOR \* PUDIM_CASA_PERTO_CONSTRUTOR\) break;/.test(sim));

console.log(fails === 0 ? "\nTODOS OS TESTES PASSARAM" : "\n" + fails + " TESTE(S) FALHARAM");
process.exit(fails === 0 ? 0 : 1);
