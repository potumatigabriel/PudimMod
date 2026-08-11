# PudimMod (0 A.D. Mod)

O **PudimMod** é um mod utilitário para o jogo de estratégia **0 A.D.** (Alpha 28). O objetivo é reduzir a microgestão, automatizar comportamentos econômicos e fornecer ferramentas táticas avançadas — sem causar OOS (dessincronização) em multiplayer.

---

## Recursos Principais

### 1. Estimador de Combate
- Exibe HP total, DPS e contagem por tipo (infantaria M/R, cavalaria, cerco, suporte) para aliados e inimigos próximos.
- Barra dinâmica de probabilidade de vitória baseada em poder ofensivo.

### 2. Auto-Trabalho (Worker Quotas)
- Distribui trabalhadores ociosos em cotas percentuais configuráveis por recurso (comida, madeira, pedra, metal).
- Soldados e cavalarias têm repulsa natural à comida; mulheres ganham prioridade em fazendas.
- Lenhadores expandem raio de busca até 400m se a madeira próxima acabar, priorizando florestas densas longe de instalações inimigas.

### 3. Auto-Fila Automática
- Ativa autoqueue em todos os edifícios de produção no início da partida.
- Reativa automaticamente a cada 8 segundos se o jogo desativar por falta de recursos — a fila nunca para sozinha.

### 4. Auto-Scout de Cavalaria
- Cavalaria selecionada explora o mapa em modo **Local** (perto do CC) ou **Deep** (mapa inteiro).
- Memória de setores 8×8: visita setores inexplorados mais próximos do CC primeiro, criando padrão espiral/circular.
- Fuga automática ao detectar ameaças a 90m — voa 120m em direção oposta.
- **Marca território inimigo**: ao fugir de estruturas inimigas (CC, torre, castelo), bloqueia permanentemente o setor e os adjacentes — o scout nunca volta para a base inimiga.
- **Anti-stuck triplo**: (1) movimento <10 unidades/2s → recua ao CC e bloqueia setor imediatamente; (2) timeout de 10s sem progresso → abandona alvo; (3) idle longe do destino → bloqueia setor alvo e atual. Elimina travamento em lagos e terreno impassável.
- Auto-desativação ao receber comando manual (caminhar, atacar, coletar).
- Exploração circular: setores inexplorados mais próximos do CC têm prioridade; depois revisa os mais antigos.

### 5. Inteligência Econômica Avançada
- **Mercado Inteligente (Auto-Barter):** Troca automática quando recurso > 2000 e outro < 500.
- **Smart Dropsites:** Detecta trabalhadores longe de armazéns (>60m), calcula centroide do cluster florestal, posiciona novo armazém fora da floresta com 8 candidatos validados. Foca em florestas grandes (≥4 nós de recurso) e evita clusters próximos a CC inimigos (< 200m).
- **Redistribuição pós-armazém:** Workers movidos de 3 em 3 para diferentes árvores próximas ao novo armazém.

### 6. Inteligência Militar Avançada
- **Auto-Kite:** Infantaria ranged foge automaticamente de inimigos melee a <9m, a cada 600ms.
- **Retirada Estratégica (Auto-Retreat):** Tropas com HP < 20% recuam para curador ou templo mais próximo.
- **Foco de Fogo Inteligente:** Atiradores reorientam alvos para curadores, cerco e suporte inimigo em raio de 50m.
- **Auto-Guarnição Defensiva:** Arqueiros ociosos entram em torres/fortalezas quando inimigos se aproximam.
- **Sistema de Pânico:** Exército inimigo perto do CC → workers se abrigam em casas/CC, ranged entram em torres. Retorno automático após 6s sem ameaça. Ativável/desativável no painel.

### 7. Repetir Construção
- Construtores posicionam nova fundação adjacente ao terminar um edifício.

### 8. Barra de Aliados
- Relatório em tempo real para você e aliados: fase (I–IV), pop, K/D, aldeões, infantaria, cavalaria, arqueiros, cerco e coletores por recurso (F/W/S/M).
- Fundo azul translúcido quando um jogador está evoluindo de fase; pisca verde por 4 segundos ao concluir.
- Tudo na mesma barra — sem widgets separados no topo.

---

## Painel de Controle
Acessível pelo ícone do pudim no menu superior. Permite:
- Ligar/desligar Auto-Trabalho e ajustar cotas por recurso
- Toggles de todas as IAs avançadas (ON/OFF individuais)
- Botão "Voltar ao Trabalho" após o sistema de pânico
- Auto-casas com threshold configurável

---

## Compatibilidade
- **100% OOS-safe em multiplayer**: todo estado fica na GUI, ações via comandos de rede padrão.
- Requer **AutoCiv** (fornece `autociv_patchApplyN`).
- Testado em 0 A.D. Alpha 28 (Boiorix).
