# Gera as referências da barra de metas (gui/session/pudim_metas.js). Rodar:  python tools/analise_marcos.py
# Saída em %TEMP%\marcos.json: uma linha por jogador humano por replay, com os marcos.
# Marcos por jogador em todos os replays da A28: pop 100, fase 2, fase 3, pop 200.
# id do jogador = índice em playerStates (0 é Gaia), NÃO índice+1.
import json, os, re, sys, collections

RAIZ = r"D:/OneDrive/Documentos/My Games/0ad/replays/0.28.0"
FASE = {"town": (30, {"food": 400, "wood": 400}), "city": (60, {"stone": 600, "metal": 600})}

def interp(ts, vs, alvo):
    for k in range(len(vs)):
        if vs[k] >= alvo:
            if k == 0: return ts[0]
            t0, t1, v0, v1 = ts[k-1], ts[k], vs[k-1], vs[k]
            return t0 + (t1 - t0) * (alvo - v0) / max(1e-9, (v1 - v0))
    return None

def comandos(d):
    t = 0.0
    out = []
    try:
        with open(os.path.join(d, "commands.txt"), encoding="utf-8") as f:
            for linha in f:
                if linha.startswith("turn "):
                    p = linha.split()
                    t += int(p[2]) / 1000.0
                elif linha.startswith("cmd "):
                    sp = linha.find(" ", 4)
                    jog = int(linha[4:sp])
                    if '"research"' not in linha and 'barracks' not in linha: continue
                    try: c = json.loads(linha[sp+1:])
                    except Exception: continue
                    tpl = c.get("template")
                    if not isinstance(tpl, str): continue
                    if c.get("type") == "research" and tpl.startswith("phase_"):
                        out.append((t, jog, tpl))
                    elif c.get("type") == "construct" and tpl.endswith("/barracks"):
                        out.append((t, jog, "quartel"))
    except FileNotFoundError:
        pass
    return out

def fase_real(cmds, jog, tipo, seq):
    """Primeiro pedido de fase cujo gasto aparece no resumo (senão o motor recusou)."""
    ts = seq["time"]; usados = seq.get("resourcesUsed", {})
    dur, minimo = FASE[tipo]
    for (t, j, tpl) in cmds:
        if j != jog or not tpl.startswith("phase_" + tipo): continue
        # janela de 30s que contém o pedido e a seguinte
        k = next((i for i in range(1, len(ts)) if ts[i] >= t), None)
        if k is None: continue
        ok = False
        for kk in (k, k+1):
            if kk >= len(ts): break
            if all((usados.get(r, [0]*len(ts))[kk] - usados.get(r, [0]*len(ts))[kk-1]) >= minimo[r] for r in minimo):
                ok = True; break
        if ok: return t + dur
    return None

def quarteis(cmds, jog, seq):
    """Instantes dos quartéis PAGOS: pedido na janela onde a madeira gasta cobre 200 por quartel."""
    ts = seq["time"]; mad = seq.get("resourcesUsed", {}).get("wood", [0]*len(ts))
    aceitos = []
    usados_janela = collections.Counter()
    for (t, j, tpl) in cmds:
        if j != jog or tpl != "quartel": continue
        k = next((i for i in range(1, len(ts)) if ts[i] >= t), None)
        if k is None: continue
        for kk in (k, k+1):
            if kk >= len(ts): break
            if mad[kk] - mad[kk-1] >= 200 * (usados_janela[kk] + 1):
                usados_janela[kk] += 1; aceitos.append(t); break
        if len(aceitos) >= 2: break
    return aceitos

def pop_em(ts, pop, t):
    if t is None: return None
    for k in range(1, len(ts)):
        if ts[k] >= t:
            return round(pop[k-1] + (pop[k]-pop[k-1]) * (t-ts[k-1]) / max(1e-9, ts[k]-ts[k-1]))
    return pop[-1]

linhas = []
for d in sorted(os.listdir(RAIZ)):
    caminho = os.path.join(RAIZ, d)
    mp = os.path.join(caminho, "metadata.json")
    if not os.path.isfile(mp): continue
    try: m = json.load(open(mp, encoding="utf-8"))
    except Exception: continue
    s = m.get("mapSettings", {})
    justo = s.get("StartingResources") == 300 and not s.get("CheatsEnabled") and not s.get("Nomad")
    cmds = comandos(caminho)
    humanos = [p for p in (s.get("PlayerData") or []) if p and not p.get("AI")]
    multi = len(humanos) >= 2
    for jid, p in enumerate(m["playerStates"]):
        if jid == 0: continue
        pd = (s.get("PlayerData") or [None]*9)
        info = pd[jid-1] if jid-1 < len(pd) else None
        if info and info.get("AI"): continue          # só humanos
        seq = p.get("sequences") or {}
        ts, pop = seq.get("time"), seq.get("populationCount")
        if not ts or not pop: continue
        nome = p.get("name", "?")
        mr = re.search(r"\((\d{3,4})\)\s*$", nome)
        linhas.append({
            "replay": d, "jogador": re.sub(r"\s*\(\d+\)\s*$", "", nome), "rating": int(mr.group(1)) if mr else None,
            "civ": p.get("civ"), "justo": justo, "multi": multi, "popcap": s.get("PopulationCap"),
            "duracao": ts[-1], "estado": p.get("state"),
            "pop100": interp(ts, pop, 100), "pop150": interp(ts, pop, 150), "pop200": interp(ts, pop, 200),
            "fase2": fase_real(cmds, jid, "town", seq), "fase3": fase_real(cmds, jid, "city", seq),
        })
        q = quarteis(cmds, jid, seq)
        L = linhas[-1]
        L["quartel1"] = q[0] if len(q) > 0 else None
        L["quartel2"] = q[1] if len(q) > 1 else None
        for k in ("fase2", "fase3", "quartel1", "quartel2"):
            L[k + "_pop"] = pop_em(ts, pop, L[k])

json.dump(linhas, open(os.path.join(os.environ.get("TEMP", "."), "marcos.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=0)
print(len(linhas), "linhas de jogador")
