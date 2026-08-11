# PudimMod — Documentação para Desenvolvedores

**Jogo:** 0 A.D. Alpha 28 (Boiorix)  
**Localização:** `Documents\My Games\0ad\mods\PudimMod\`  
**Dependência:** AutoCiv (fornece `autociv_patchApplyN`)

---

## 1. Funcionalidades

| Feature | Descrição | Status |
|---|---|---|
| Estimador de Combate | Painel lateral mostrando HP/DPS aliados vs inimigos | ✅ Funcionando |
| Auto-Trabalho | Envia cidadãos ociosos para coletar recursos automaticamente | ✅ Funcionando |
| Auto-Casa | Constrói casas automaticamente quando pop está próxima do limite | ✅ Funcionando |
| Repetir Construção | Construtores colocam fundações adjacentes ao terminar uma obra | ✅ Funcionando |
| Auto-Fila | Ativa autoqueue em todos os edifícios e reativa se desativado automaticamente | ✅ Funcionando |
| Auto-Scout (Cavalaria) | Exploração em espiral, bloqueia território inimigo, foge e não volta | ✅ Funcionando |
| Auto-Kite | Infantaria ranged foge de melee automaticamente a cada 600ms | ✅ Funcionando |
| Sistema de Pânico | Workers se abrigam ao ataque; retorno automático após ameaça cessada | ✅ Funcionando |
| Smart Dropsites | Posiciona armazém fora do cluster, foca florestas grandes longe de inimigos | ✅ Funcionando |
| Auto-Retreat | Tropas com HP < 20% recuam para curador/templo | ✅ Funcionando |
| Smart Focus Fire | Atiradores reorientam para alvos prioritários (curador, cerco, suporte) | ✅ Funcionando |
| Auto-Guarnição Defensiva | Arqueiros ociosos guarnicionam torres quando inimigos se aproximam | ✅ Funcionando |
| Mercado Inteligente | Troca automática no mercado quando há excesso/escassez extrema | ✅ Funcionando |
| Barra de Aliados | Relatório em tempo real: fase, pop, K/D, unidades por tipo, coletores por recurso (self + aliados) | ✅ Funcionando |
| Caçada (Cavalaria) | Cavalaria coleta apenas comida de animais, não outros recursos | ✅ Funcionando |

---

## 2. Regras Críticas — OOS (Out of Sync)

**O 0 A.D. em multiplayer usa lockstep:** a cada turno, ambas as máquinas calculam um hash do estado da simulação e comparam. Qualquer diferença = OOS e a partida termina.

### O que CAUSA OOS

| Padrão | Motivo |
|---|---|
| Adicionar propriedades a componentes de simulação (ex: `unitAI.pudim_foo = true`) | A propriedade entra no hash do estado serializado. Só existe na máquina com mod → hash diferente |
| Criar handlers de comandos de rede customizados em `Commands~pudim.js` | O handler só existe no modded client. O cliente sem mod recebe o comando, não acha o handler e ignora → estado diverge silenciosamente |
| Override de funções de simulação como `ProgressTimeout`, `OnAttacked` | Ambas as máquinas executam timers/eventos determinísticos. Com código diferente, o estado muda diferente |
| Adicionar campos a `SerializableAttributes` de componentes existentes | Campos entram no hash. Só existem na máquina com mod |
| `Math.random()` dentro de um hook de simulação que modifica estado | Avança o RNG de forma diferente por máquina |

### O que É SEGURO

| Padrão | Motivo |
|---|---|
| `Engine.GuiInterfaceCall("nome", data)` | Executa na simulação mas é read-only; resultado vai só para a GUI local |
| `Engine.PostNetworkCommand({ "type": "walk", ... })` | Comando padrão do jogo; processado identicamente por todas as máquinas |
| Variáveis em `pudim_panel.js` / `session~pudim.js` (GUI) | Código GUI não entra no estado da simulação |
| Leitura de estado via `GetEntityState(ent)` na GUI | Leitura pura, não modifica nada |
| `autociv_patchApplyN` em funções da GUI | Só afeta a camada de apresentação, nunca o estado simulado |

### Regra de Ouro

> **Tudo que modifica estado de jogo DEVE ir via `Engine.PostNetworkCommand` com um tipo de comando padrão do jogo. Nunca crie propriedades em componentes de simulação. Nunca crie handlers de comandos customizados.**

---

## 3. Estrutura de Arquivos

```
PudimMod/
├── mod.json                          # Metadados do mod (nome, versão, deps)
├── README.md                         # Descrição curta (pública)
├── OVERVIEW.md                       # Este arquivo (documentação técnica)
│
├── gui/
│   ├── common/
│   │   └── !!!pudim_patchApplyN.js   # Fallback de autociv_patchApplyN para GUI
│   ├── options/
│   │   └── options~pudim.js          # Opções do mod na tela de configuração
│   └── session/
│       ├── pudim_panel.js            # ★ ARQUIVO PRINCIPAL — toda a lógica GUI do mod
│       ├── session~pudim.js          # Hooks no ciclo de vida da sessão (init/tick/selection)
│       ├── pudim_ally_bar.js         # Relatório em tempo real: fase, pop, K/D, unidades, coletores
│       ├── pudim_ally_bar.xml        # Placeholder (movido para match_settings)
│       ├── match_settings/
│       │   ├── 02_pudim_panel.xml    # Painel lateral do PudimMod (sempre visível)
│       │   ├── 04_pudim_scout_panel.xml  # Painel flutuante dos botões Auto Scout
│       │   └── 05_pudim_ally_bar.xml    # Barra de aliados na parte superior
│       ├── selection_panels_left/
│       │   └── stance_panel.xml      # Adiciona botão "Repetir Construção" no painel de stance
│       └── selection_panels_right/
│           └── pudim_ally_bar.xml    # Placeholder XML (elemento raiz obrigatório)
│
└── simulation/
    ├── components/
    │   ├── !!!pudim_patchApplyN.js   # Fallback de autociv_patchApplyN para simulação
    │   ├── GuiInterface~pudim.js     # ★ Funções read-only expostas à GUI via GuiInterfaceCall
    │   ├── UnitAI~pudim.js           # VAZIO — nenhuma propriedade adicionada ao UnitAI (OOS-safe)
    │   └── ProductionQueue~pudim.js  # VAZIO — override de ProgressTimeout removido (causava OOS)
    └── helpers/
        └── Commands~pudim.js         # VAZIO — handlers customizados removidos (causavam OOS)
```

### Arquivos Chave

**`gui/session/pudim_panel.js`** — Toda a lógica de gameplay do mod:
- Sistema de logs (`pudim_Log`, `pudim_LogInfo`, etc.)
- Estado GUI-side de repeat-building (`g_PudimRepeatBuilding`, etc.)
- Tick de processamento (`pudim_Tick`, `pudim_ProcessRepeatBuildings`)
- Auto-trabalho, auto-casa, estimador de combate, scout

**`gui/session/session~pudim.js`** — Hooks no ciclo de vida:
- Patcha `init` para inicializar o mod
- Patcha `onTick` para chamar `pudim_Tick` e o tick de scout
- Patcha `updateUnitCommands` para atualizar botões de seleção
- Patcha `onSelectionChange` para esconder painel scout sem cavalaria
- Patcha `onSimulationUpdate` para detectar mudanças de seleção

**`simulation/components/GuiInterface~pudim.js`** — Interface de leitura (somente):
- Registra funções via `pudim_exposedFunctions`
- Nunca escreve em componentes de simulação
- Funções: `pudim_GetScoutOrders`, `pudim_GetAutoHouseData`, `pudim_GetAllyStats`, `pudim_GetBuilderCurrentFoundation`, etc.

---

## 4. Como Funciona Cada Feature

### Auto-Scout
- **Ativação:** Jogador clica no botão flutuante "Auto Scout Local" ou "Auto Scout Deep"
- **Auto-desativação:** Se o jogador enviar comando manual (Gather, Attack, etc.) à unidade, ela é removida automaticamente do scout (detectado via `orderType` retornado pelo GuiInterface)
- **Estado:** `g_PudimScouts[entId] = "local"|"deep"` — variável GUI, não vai para simulação. `g_PudimScoutActivatedAt` guarda timestamp de ativação para grace period de 3s.
- **Memória de setores 8×8:** `g_PudimScoutSectors["col,row"] = timestamp`, `g_PudimScoutBlocked["col,row"] = Infinity`
- **Exploração circular:** Score de setor = `distFromCC` se inexplorado, ou `1e9 - (now - t)` se visitado. Setores perto do CC têm prioridade → padrão espiral natural.
- **Detecção de preso (água/montanha):** Três mecanismos combinados:
  1. **Movimento lento:** Se posição muda < 10 unidades em 2s (cavalo normal ≈ 28/tick), bloqueia setor alvo+atual+3×3 e recua ao CC imediatamente (sem manobra perpendicular).
  2. **Timeout de alvo:** Se o mesmo alvo está sendo perseguido há >10s e o scout está a >50% da largura do setor de distância, abandona e recua.
  3. **Idle longe do alvo:** Se a unidade fica idle mas está longe do alvo (pathfinder falhou), bloqueia os setores alvo e atual.
- **Bloqueio de território inimigo:** `pudim_GetScoutStatus` retorna `flee.fromPos` e `flee.isBuilding`. Se `isBuilding = true` (CC, torre, castelo), GUI bloqueia o setor da estrutura E os 8 adjacentes permanentemente via `g_PudimScoutBlocked`. Scout nunca volta para base inimiga.
- **Fuga:** Distância aumentada para 120m (era 100m) para garantir saída do raio de detecção de 90m.
- **Tick:** `pudim_ForceScoutTick()` a cada 2s via hook `onTick` em `session~pudim.js`
- **Painel:** `pudimScoutPanelRight` — flutuante no canto inferior direito, aparece só com cavalaria selecionada

### Repetir Construção
- **Ativação:** Botão "Repetir Construção" no painel de stance (aparece para unidades com `IID_Builder`)
- **Estado:** `g_PudimRepeatBuilding[entId] = true` — variável GUI
- **Detecção de conclusão:** Tick chama `pudim_GetBuilderCurrentFoundation` (read-only) para saber se o construtor ficou idle após terminar uma obra
- **Nova ordem:** GUI envia `Engine.PostNetworkCommand({type:"construct", ...})` para o construtor

### Auto-Trabalho
- **Ativação:** Botão no painel lateral; ativo por padrão
- **Tick:** A cada 5 segundos, chama `pudim_GetIdleWorkersAndBestResource` (GuiInterface), depois envia `gather` commands
- **Prioridade:** Configurável por recurso (comida, madeira, pedra, metal)

### Auto-Fila (Autoqueue)
- **Comportamento:** Ativa autoqueue em TODOS os edifícios de produção no início da partida e a cada 8s.
- **Problema resolvido:** O vanilla desativa autoqueue quando recursos acabam. O mod reativa automaticamente no próximo tick.
- **Implementação:** `pudim_ProcessAutoQueue()` → `pudim_GetProductionBuildings` (GuiInterface) → filtra edifícios com `autoqueue = false` → `{ type: "autoqueue", entities: [...], autoqueue: true }` (OOS-safe).
- **Init:** `g_PudimAutoQueueAccum = 7000` em `pudim_Init` garante disparo logo no primeiro tick da partida.

### Auto-Casa
- **Ativação:** Slider de threshold no painel lateral
- **Tick:** A cada 2.5 segundos, chama `pudim_GetAutoHouseData` se pop está próxima do limite
- **Resultado:** Envia `construct` command para construir casa; só seleciona unidades com `IID_Builder` (não cavalaria)

### Estimador de Combate
- **Leitura:** `pudim_GetCombatEstimate` via GuiInterface (contagem de HP, DPS, tipos de unidades)
- **Display:** Painel lateral com barras de força aliada vs inimiga e probabilidade de vitória

---

## 5. Como Adicionar uma Nova Feature com Segurança

### Passo 1: Decidir onde o estado fica
- Se é estado do jogador local (ex: "está no modo X"): variável em `pudim_panel.js` ✅
- Se precisa ler dados da simulação: função em `GuiInterface~pudim.js` ✅
- **NUNCA** adicionar propriedades em componentes de simulação ❌

### Passo 2: Registrar função GuiInterface (se necessário)
Em `GuiInterface~pudim.js`, adicionar:
```js
// No objeto pudim_exposedFunctions:
"pudim_MinhaNovaFuncao": 1,

// Implementação:
GuiInterface.prototype.pudim_MinhaNovaFuncao = function(player, data) {
    // Apenas leitura — nunca modifique componentes aqui
    const result = [];
    // ... lógica read-only ...
    return result;
};
```

### Passo 3: Chamar da GUI
Em `pudim_panel.js`:
```js
const dados = Engine.GuiInterfaceCall("pudim_MinhaNovaFuncao", { parametro: valor });
if (dados && dados.length > 0) {
    // Processar e enviar comandos padrão
    Engine.PostNetworkCommand({ "type": "walk", "entities": [...], "x": ..., "z": ..., "queued": false });
}
```

### Passo 4: Usar logs para debug
```js
pudim_LogInfo("MinhaFeature: " + JSON.stringify(dados));
pudim_LogWarn("MinhaFeature: sem resultado");
pudim_LogError("MinhaFeature: estado inválido");
```

---

## 6. Pitfalls Comuns (Erros que Causaram OOS)

| Erro | Como foi corrigido |
|---|---|
| `UnitAI.Init` patch adicionando `pudim_repeatBuilding`, `pudim_lastBuiltTemplate`, `pudim_lastBuiltPos` a cada unidade | Arquivo `UnitAI~pudim.js` guttado; estado movido para `g_PudimRepeatBuilding` na GUI |
| Handlers customizados `pudim-toggle-repeat`, `pudim-back-to-work` em `Commands~pudim.js` | Arquivo guttado; substituído por comandos padrão `construct` |
| `ProductionQueue.prototype.ProgressTimeout` override + `SerializableAttributes.push("waitingAutoqueue")` | Arquivo `ProductionQueue~pudim.js` guttado; feature de "esperar recursos" removida |
| Patches em `OnAttacked`, `TriggerPanic` do UnitAI | Removidos (modificavam estado da simulação) |
| `pudim_GetAutoHouseData` selecionando cavalaria como construtor | Adicionado check `Engine.QueryInterface(ent, IID_Builder)` |
| `cmpRangeManager.GetLosVisibility(rx, rz, player)` passando coordenadas como entity ID | Removida a verificação de fog-of-war; substituída por scoring de distância |
| `illegal character U+0083` em `Commands~pudim.js` | Arquivo reescrito com UTF-8 limpo |
| `caption="..."` em XML (atributo inválido no RelaxNG) | Substituído por `<action on="load">this.caption = "...";</action>` |
| Painel scout mostrando sem cavalaria selecionada | Adicionado patch `onSelectionChange` em `session~pudim.js` |
| Scout chamando `pudim_GetScoutOrders` (não registrado) | Reescrito para usar `pudim_GetScoutStatus`; GUI faz toda a lógica de setor |
| Scout preso em água/montanha indefinidamente | Três mecanismos: (1) movimento <10u/2s → recuo imediato, (2) timeout 10s → recuo, (3) idle longe do alvo → bloquear. Sem manobra perpendicular que aprofundava o stuck. |
| Scout voltando para base inimiga após fugir | `pudim_GetScoutStatus` retorna `flee.fromPos` + `flee.isBuilding`; GUI bloqueia setor + 8 adjacentes se for estrutura |
| Armazém construído dentro da floresta | GuiInterface retorna 8 candidatos fora do cluster; GUI valida com `SetBuildingPlacementPreview` |
| Autoqueue desativando sozinho por falta de recursos | `pudim_ProcessAutoQueue` reativa a cada 8s via `pudim_GetProductionBuildings` (OOS-safe) |
| `evasive.png` inexistente causando `CCacheLoader failed` | Corrigido para `passive.png` em `session~pudim.js` |

---

## 7. Sistema de Logs

### Uso
```js
pudim_LogInfo("Mensagem informativa");
pudim_LogWarn("Aviso");
pudim_LogError("Erro crítico");
pudim_Log("CUSTOM", "Nível customizado");
```

### Output
- **mainlog.html:** Arquivo de log do 0 A.D. em `AppData\Local\0ad\logs\mainlog.html`. Todas as chamadas `pudim_Log` aparecem aqui com prefixo `[PudimMod][LEVEL]`.
- **pudimmod.log:** Se `Engine.WriteFile` estiver disponível no contexto GUI, um arquivo dedicado é gerado em `AppData\Local\0ad\logs\pudimmod.log` (flush a cada 5s, contém todo o buffer em formato ISO timestamp).
- **Buffer em memória:** `pudim_LogGetBuffer()` retorna até 500 entradas da sessão atual.
- **ConfigDB:** Entradas salvas em `pudim.log.YYYY-MM-DD`. Logs com mais de 7 dias são removidos automaticamente no `pudim_Init`.

### Onde verificar logs
1. Durante o jogo: console do 0 A.D. (Ctrl+F5 ou `mainlog.html`)
2. Após fechar: `C:\Users\<user>\AppData\Local\0ad\logs\mainlog.html`
3. Arquivo dedicado (se disponível): `C:\Users\<user>\AppData\Local\0ad\logs\pudimmod.log`
4. OOS dump: `C:\Users\<user>\AppData\Local\0ad\logs\oos_dump.txt`

---

## 8. Tipos de Comandos de Rede Padrão Seguros

Esses tipos podem ser usados em `Engine.PostNetworkCommand` sem risco de OOS:

| type | Descrição | Parâmetros principais |
|---|---|---|
| `walk` | Mover unidade | `entities`, `x`, `z`, `queued` |
| `construct` | Construir edifício | `entities`, `template`, `x`, `z`, `angle`, `autorepair`, `autocontinue`, `queued` |
| `gather` | Coletar recurso | `entities`, `target`, `queued` |
| `garrison` | Guarnecer edifício | `entities`, `target`, `queued` |
| `autoqueue` | Ligar/desligar auto-fila | `entities`, `autoqueue` (bool) |
| `barter` | Trocar recursos no mercado | `sell`, `buy`, `amount` |
| `stop` | Parar unidade | `entities`, `queued` |
| `attack` | Atacar entidade | `entities`, `target`, `queued` |
