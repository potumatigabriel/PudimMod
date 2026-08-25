# -*- coding: utf-8 -*-
"""
Mede o desempenho do mod num replay, e compara com a linha de base.

Nasceu da pergunta de 24/08: "da pra saber se as melhorias de hoje sao o melhor
caminho?". Dava para levantar a hipotese, mas nao para responder — porque nao
havia com o que comparar. Este programa fixa as metricas e a linha de base, para
a resposta deixar de ser opiniao.

O que ele mede, e por que cada coisa:

  troca ($)      valor em recursos do que matamos dividido pelo do que perdemos.
                 E a medida certa de "ganhar combate": contar unidades trata um
                 aldeao e um campeao como a mesma coisa.
  desvantagem    posicao da nossa populacao entre os jogadores, ao longo do jogo.
                 Sem isso, "venceu o combate" pode ser so "tinha mais gente".
  comandando     troca nas janelas em que o mod deu >=5 ordens de ataque, contra
                 as em que ficou calado. Separa o merito da micro do resto.
  w/atq          walks por ataque nas janelas de combate. ~1,0 e o kite normal
                 (um recuo seguido de um ataque enfileirado); bem acima disso e
                 reordenacao a toa.
  composicao     de que o exercito e feito. Regra de kite so vale para quem tem
                 alcance, e "arqueiro se afasta de atirador mais curto" so vale
                 se houver atiradores de alcances diferentes em campo.

CUIDADO COM A DURACAO DO TURNO. Ela NAO e fixa: sai de timeElapsed dividido pelo
numero de turnos. Chutar 0,5 s quando o valor real era 0,2 s foi o erro que me
fez datar a batalha em 61 min quando ela estava aos 24 min.

Rodar:
    python tools/analisar_replay.py                # o replay mais recente
    python tools/analisar_replay.py 2026-08-24_0003
    python tools/analisar_replay.py --jogador Pudim
"""
import argparse
import collections
import io
import json
import os
import re
import sys

JANELA = 30          # segundos por janela de analise
MIN_COMBATE = 300    # valor minimo trocado para a janela contar como combate
MIN_ATAQUES = 5      # ordens de ataque para dizer que o mod estava comandando

# Linha de base: as duas partidas com combate real anteriores as mudancas de
# 24/08. Servem de referencia — se o numero novo nao sair daqui, a mudanca nao
# mexeu no que se propunha a mexer.
BASE = {
    "2026-08-23_0003": {"troca": 2.28, "comandando": None, "calado": None},
    "2026-08-24_0003": {"troca": 1.94, "comandando": 1.75, "calado": 2.15},
}

# Alcances dos templates do jogo, para anotar a composicao.
ALCANCE = {
    "archer": 60, "slinger": 45, "javelineer": 30,
    "spearman": 4, "swordsman": 3, "pikeman": 4, "maceman": 3,
}


def achar_replays():
    for base in (os.path.expanduser("~"), "D:\\", "C:\\"):
        pass
    candidatos = []
    doc = os.environ.get("USERPROFILE") or os.path.expanduser("~")
    for raiz in (r"D:\OneDrive\Documentos\My Games\0ad",
                 os.path.join(doc, "Documents", "My Games", "0ad"),
                 os.path.join(doc, "Documentos", "My Games", "0ad"),
                 os.path.expanduser("~/.local/share/0ad")):
        p = os.path.join(raiz, "replays")
        if os.path.isdir(p):
            for versao in sorted(os.listdir(p), reverse=True):
                d = os.path.join(p, versao)
                if os.path.isdir(d):
                    candidatos.append(d)
    return candidatos


def carregar(pasta):
    meta = json.load(io.open(os.path.join(pasta, "metadata.json"), encoding="utf-8"))
    return meta


def duracao_turno(pasta, meta):
    """timeElapsed / total de turnos. Nunca chutar — ver o cabecalho."""
    ultimo = 0
    for linha in io.open(os.path.join(pasta, "commands.txt"), encoding="utf-8", errors="replace"):
        if linha.startswith("turn "):
            ultimo = int(linha.split()[1])
    if not ultimo:
        return 0.2, 0
    return (meta["timeElapsed"] / 1000.0) / ultimo, ultimo


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("replay", nargs="?", help="nome da pasta do replay")
    ap.add_argument("--jogador", default="Pudim", help="prefixo do nome (padrao: Pudim)")
    args = ap.parse_args()

    raizes = achar_replays()
    if not raizes:
        print("Nao achei a pasta de replays."); return 1

    pasta = None
    for r in raizes:
        if args.replay:
            p = os.path.join(r, args.replay)
            if os.path.isdir(p): pasta = p; break
        else:
            dirs = sorted(x for x in os.listdir(r)
                          if os.path.isdir(os.path.join(r, x))
                          and os.path.exists(os.path.join(r, x, "commands.txt")))
            if dirs: pasta = os.path.join(r, dirs[-1]); break
    if not pasta:
        print("Replay nao encontrado."); return 1

    nome_replay = os.path.basename(pasta)
    meta = carregar(pasta)
    dt, turnos = duracao_turno(pasta, meta)
    minutos = meta["timeElapsed"] / 60000.0

    jogadores = [p for p in meta["playerStates"] if p["name"] != "Gaia"]
    idx = None
    for i, ps in enumerate(meta["playerStates"]):
        if ps["name"].startswith(args.jogador): idx = i; break
    if idx is None:
        print("Jogador '%s' nao esta neste replay. Ha: %s"
              % (args.jogador, ", ".join(p["name"] for p in jogadores)))
        return 1
    eu = meta["playerStates"][idx]
    s = eu["sequences"]
    tempo, kills, perdas = s["time"], s["enemyUnitsKilledValue"], s["unitsLostValue"]

    print("=" * 72)
    print("%s   %.0f min   %d turnos de %.0f ms   jogador: %s (%s)"
          % (nome_replay, minutos, turnos, dt * 1000, eu["name"], eu["state"]))
    print("=" * 72)

    # ── Troca final ────────────────────────────────────────────────────────────
    print("\nTROCA DE RECURSOS (valor do que matou / valor do que perdeu)")
    linhas = []
    for ps in jogadores:
        q = ps["sequences"]
        k, p = q["enemyUnitsKilledValue"][-1], q["unitsLostValue"][-1]
        linhas.append((k / p if p else 0, ps["name"][:16], ps["state"], k, p))
    linhas.sort(reverse=True)
    for pos, (tr, nome, estado, k, p) in enumerate(linhas, 1):
        marca = "  <<<" if nome.startswith(args.jogador) else ""
        print("  %d. %-16s %-9s matou %6d  perdeu %6d  troca %5.2f%s"
              % (pos, nome, estado, k, p, tr, marca))

    minha = next(x for x in linhas if x[1].startswith(args.jogador))
    print("\n  posicao: %d de %d" % (linhas.index(minha) + 1, len(linhas)))

    # ── Desvantagem numerica ───────────────────────────────────────────────────
    print("\nPOPULACAO (a vitoria veio da micro ou de ter mais gente?)")
    pops = {p["name"][:12]: p["sequences"]["populationCount"] for p in jogadores}
    meu_nome = eu["name"][:12]
    posicoes = []
    for i in range(len(tempo)):
        vals = sorted((v[i] for v in pops.values()), reverse=True)
        posicoes.append(vals.index(pops[meu_nome][i]) + 1)
    # so a partir do minuto 5: antes disso todo mundo empata
    ini = next((i for i, t in enumerate(tempo) if t >= 300), 0)
    uteis = posicoes[ini:]
    if uteis:
        atras = sum(1 for p in uteis if p > (len(pops) + 1) // 2)
        print("  posicao mediana em populacao: %d de %d"
              % (sorted(uteis)[len(uteis) // 2], len(pops)))
        print("  tempo na metade de baixo: %d%% do jogo" % (100 * atras / len(uteis)))
        if atras < len(uteis) * 0.3:
            print("  --> NAO estava em desvantagem numerica: a vitoria nao testa isso")

    # ── Comandos por janela ────────────────────────────────────────────────────
    cmds = collections.defaultdict(collections.Counter)
    turno = 0
    for linha in io.open(os.path.join(pasta, "commands.txt"), encoding="utf-8", errors="replace"):
        if linha.startswith("turn "):
            turno = int(linha.split()[1]); continue
        if not linha.startswith("cmd %d " % idx): continue
        mt = re.search(r'"type":"([a-z-]+)"', linha)
        if mt: cmds[int(turno * dt // JANELA)][mt.group(1)] += 1

    print("\nJANELAS DE COMBATE (%ds cada)" % JANELA)
    print("  min   matou$ perdeu$  troca | atq  walk  w/atq")
    com, calado, ratios = [], [], []
    for i in range(1, len(tempo)):
        dk, dl = kills[i] - kills[i - 1], perdas[i] - perdas[i - 1]
        if dk + dl < MIN_COMBATE: continue
        c = cmds[int(tempo[i] // JANELA)]
        a, w = c["attack"] + c["attack-walk"], c["walk"]
        tr = dk / dl if dl else None
        rt = w / a if a else None
        if rt is not None: ratios.append(rt)
        (com if a >= MIN_ATAQUES else calado).append((dk, dl))
        print("  %4.0f  %7d %7d  %5s | %3d %5d  %s"
              % (tempo[i] / 60, dk, dl, ("%.2f" % tr) if tr is not None else "  -",
                 a, w, ("%.2f" % rt) if rt is not None else "-"))

    def agrega(v):
        k = sum(x[0] for x in v); p = sum(x[1] for x in v)
        return (k / p if p else None), len(v)

    tc, nc = agrega(com)
    tq, nq = agrega(calado)
    print("\n  mod COMANDANDO (>=%d ataques): troca %s  em %d janelas"
          % (MIN_ATAQUES, ("%.2f" % tc) if tc else "-", nc))
    print("  mod calado                   : troca %s  em %d janelas"
          % (("%.2f" % tq) if tq else "-", nq))
    if ratios:
        ratios.sort()
        print("  walks por ataque: mediana %.2f  (perto de 1,00 = kite normal)"
              % ratios[len(ratios) // 2])

    # ── Composicao ─────────────────────────────────────────────────────────────
    print("\nCOMPOSICAO FINAL")
    cc = eu.get("classCounts") or {}
    for classe in ("Ranged", "Melee", "Infantry", "Cavalry", "Champion", "Siege"):
        if cc.get(classe): print("  %-10s %d" % (classe, cc[classe]))
    inf = (eu.get("typeCountsByClass") or {}).get("Infantry") or {}
    alcances = set()
    if inf:
        print("  por tipo:")
        for k, v in sorted(inf.items(), key=lambda x: -x[1]):
            base = k.split("/")[-1]
            alc = next((a for nome, a in ALCANCE.items() if nome in base), None)
            if alc and alc > 10: alcances.add(alc)
            print("    %-32s %3d%s" % (base, v, ("   alcance %d" % alc) if alc else ""))
    if len(alcances) < 2:
        print("  --> so um alcance de atirador em campo: a regra 'recuar de atirador")
        print("      mais curto' nao tem em quem se aplicar nesta partida")

    # ── Comparacao com a linha de base ─────────────────────────────────────────
    print("\nCOMPARACAO COM A LINHA DE BASE (antes das mudancas de 24/08)")
    for nome, b in sorted(BASE.items()):
        print("  %s  troca %.2f%s" % (nome, b["troca"],
              ("   comandando %.2f / calado %.2f" % (b["comandando"], b["calado"]))
              if b["comandando"] else ""))
    print("  %s  troca %.2f%s   <<< esta partida"
          % (nome_replay, minha[0],
             ("   comandando %.2f / calado %.2f" % (tc, tq)) if tc and tq else ""))
    if tc and tq:
        print()
        if tc > tq:
            print("  --> comandando ficou MELHOR que calado: a micro do mod esta somando.")
        else:
            print("  --> comandando ainda nao supera calado. A micro nao e o gargalo;")
            print("      olhar composicao e contra-unidades rende mais que ajustar recuo.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
