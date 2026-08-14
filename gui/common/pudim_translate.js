/**
 * PudimMod — ponte de tradução do chat (lado do jogo).
 *
 * Por que uma ponte por arquivo
 * -----------------------------
 * O JS da GUI do 0 A.D. não tem HTTP. Não existe fetch nem XHR: as únicas
 * funções de rede expostas ao script são a lobby (XMPP, em C++) e o mod.io
 * (URL fixa). Chamar o Google Tradutor direto daqui é impossível sem patch
 * em C++.
 *
 * O que dá pra fazer é ler e gravar arquivo — Engine.WriteJSONFile e
 * Engine.ReadJSONFile são APIs públicas, as mesmas que o jogo usa para salvar
 * campanha e configuração de partida. Então:
 *
 *     este arquivo  --escreve-->  saves/campaigns/pudim_tr_req.json
 *     tools/pudim_tradutor.py     lê, traduz no Google, escreve o _res
 *     este arquivo  <----lê-----  saves/campaigns/pudim_tr_res.json
 *
 * A pasta não foi escolhida por gosto. O ReadJSONFile/WriteJSONFile da GUI só
 * aceita uma lista fechada de caminhos — "gui/", "simulation/", "maps/",
 * "campaigns/", "saves/campaigns/", "config/matchsettings.json" e
 * "config/matchsettings.mp.json". Qualquer outro lugar responde
 * "Restricted access to ...". Dessa lista, "saves/campaigns/" é a única pasta
 * do usuário que dá para gravar, então é onde a ponte mora. Não atrapalha as
 * campanhas: o jogo lista só "*.0adcampaign" ali (gui/campaigns/load_modal/
 * LoadModal.js:66), e os nossos são ".json".
 *
 * Fica em gui/common/ de propósito: tanto session.xml quanto lobby.xml
 * declaram <script directory="gui/common/"/>, então a ponte carrega sozinha
 * nas duas telas, sem duplicar código.
 *
 * Sem o tradutor rodando nada quebra — pudim_TrEstaVivo() devolve false e a
 * interface avisa que ele está desligado.
 */

// ─── Protocolo ────────────────────────────────────────────────────────────────

const PUDIM_TR_REQ = "saves/campaigns/pudim_tr_req.json";
const PUDIM_TR_RES = "saves/campaigns/pudim_tr_res.json";

/**
 * De quanto em quanto tempo olhamos o arquivo de resposta, em ms.
 * 500 dá sensação de imediato sem custar nada perceptível: é um ReadJSONFile
 * de um arquivo pequeno, e só roda enquanto há frase pendente ou a cada 3s
 * para atualizar o sinal de vida.
 */
const PUDIM_TR_INTERVALO = 500;
const PUDIM_TR_INTERVALO_OCIOSO = 3000;

/**
 * O tradutor regrava res.json a cada 5s como sinal de vida. Se o carimbo está
 * mais velho que isto, consideramos que ele foi fechado.
 */
const PUDIM_TR_TOLERANCIA_VIDA = 15;

var g_PudimTr = {
	/** id -> texto traduzido, já confirmado pelo tradutor. */
	"cache": {},
	/** id -> texto original, pedido e ainda sem resposta. */
	"pendentes": {},
	/** Carimbo de tempo (segundos) do último sinal de vida lido. */
	"vivoEm": 0,
	/** Evita agendar dois laços de polling ao mesmo tempo. */
	"rodando": false,
	/** Handlers avisados sempre que chega tradução nova. */
	"ouvintes": []
};

// ─── Identificação das frases ─────────────────────────────────────────────────

/**
 * Tags de cor e de ícone que o chat do 0 A.D. embute no texto.
 * Traduzir com elas dentro suja o resultado, então saem antes de enviar — e
 * também antes de gerar o id, para que a mesma frase dita por dois jogadores
 * de cores diferentes conte como uma tradução só.
 */
const PUDIM_TR_TAGS = /\[\/?(?:color|font|icon|imgleft|imgright)[^\]]*\]/g;

function pudim_TrLimpar(texto)
{
	return String(texto || "").replace(PUDIM_TR_TAGS, "").trim();
}

/**
 * Id curto e estável para uma frase (hash FNV-1a de 32 bits, em base 36).
 *
 * Serve de chave nos dois lados da ponte. Usar o texto inteiro como chave
 * funcionaria, mas encheria o JSON de repetição — e frase de chat pode ter
 * até 1024 caracteres.
 */
function pudim_TrId(texto)
{
	const limpo = pudim_TrLimpar(texto);
	let hash = 0x811c9dc5;
	for (let i = 0; i < limpo.length; ++i)
	{
		hash ^= limpo.charCodeAt(i);
		hash = (hash * 0x01000193) >>> 0;
	}
	return hash.toString(36) + "_" + limpo.length.toString(36);
}

// ─── Consulta ─────────────────────────────────────────────────────────────────

/**
 * @returns true se o programa auxiliar deu sinal de vida há pouco.
 */
function pudim_TrEstaVivo()
{
	return (Date.now() / 1000 - g_PudimTr.vivoEm) < PUDIM_TR_TOLERANCIA_VIDA;
}

/**
 * @returns a tradução da frase, ou null se ainda não temos.
 */
function pudim_TrObter(texto)
{
	return g_PudimTr.cache[pudim_TrId(texto)] || null;
}

/**
 * Enfileira uma frase para tradução.
 *
 * @returns a tradução, se já estiver em cache — nesse caso nada é pedido.
 *          Senão null, e a resposta chega depois pelos ouvintes.
 */
function pudim_TrPedir(texto)
{
	const limpo = pudim_TrLimpar(texto);
	if (!limpo)
		return null;

	const id = pudim_TrId(limpo);
	if (g_PudimTr.cache[id])
		return g_PudimTr.cache[id];

	if (!g_PudimTr.pendentes[id])
	{
		g_PudimTr.pendentes[id] = limpo;
		pudim_TrEnviarPedido();
	}

	return null;
}

/**
 * Registra quem deve ser avisado quando chegar tradução nova.
 * O handler recebe o array de ids que acabaram de chegar.
 */
function pudim_TrAoTraduzir(handler)
{
	g_PudimTr.ouvintes.push(handler);
}

// ─── Escrita e leitura dos arquivos ───────────────────────────────────────────

/**
 * Grava req.json com tudo que está pendente.
 *
 * Manda a fila inteira, não só o item novo: se o tradutor foi aberto depois do
 * jogo, ou reiniciou no meio da partida, ele encontra tudo que ficou faltando
 * no primeiro arquivo que ler, sem precisar de reenvio.
 */
function pudim_TrEnviarPedido()
{
	const itens = Object.keys(g_PudimTr.pendentes).map(id => ({
		"id": id,
		"text": g_PudimTr.pendentes[id]
	}));

	try {
		Engine.WriteJSONFile(PUDIM_TR_REQ, { "items": itens, "t": Date.now() });
	} catch (e) {
		warn("PudimMod: falha ao gravar o pedido de tradução: " + e);
	}
}

/**
 * Lê res.json e move para o cache o que chegou.
 * @returns o array de ids novos (vazio se nada mudou).
 */
function pudim_TrLerResposta()
{
	let dados = null;
	try {
		if (!Engine.FileExists(PUDIM_TR_RES))
			return [];
		dados = Engine.ReadJSONFile(PUDIM_TR_RES);
	} catch (e) {
		// Arquivo pego no meio de uma escrita, ou JSON quebrado. A próxima
		// leitura resolve — não vale poluir o log a cada 500ms.
		return [];
	}

	if (!dados)
		return [];

	if (dados.vivo)
		g_PudimTr.vivoEm = dados.vivo;

	const traduzidas = dados.done;
	if (!traduzidas)
		return [];

	const novos = [];
	for (const id in traduzidas)
	{
		if (g_PudimTr.cache[id])
			continue;

		g_PudimTr.cache[id] = traduzidas[id];
		if (g_PudimTr.pendentes[id])
		{
			delete g_PudimTr.pendentes[id];
			novos.push(id);
		}
	}

	return novos;
}

// ─── Laço de verificação ──────────────────────────────────────────────────────

function pudim_TrTique()
{
	const novos = pudim_TrLerResposta();

	if (novos.length)
		for (const ouvinte of g_PudimTr.ouvintes)
			try {
				ouvinte(novos);
			} catch (e) {
				warn("PudimMod: erro no ouvinte de tradução: " + e);
			}

	// Enquanto há frase esperando, olhamos rápido; parado, devagar.
	const temPendente = Object.keys(g_PudimTr.pendentes).length > 0;
	setTimeout(pudim_TrTique, temPendente ? PUDIM_TR_INTERVALO : PUDIM_TR_INTERVALO_OCIOSO);
}

/**
 * Prepara a ponte. Pode ser chamada mais de uma vez sem efeito colateral.
 */
function pudim_TrIniciar()
{
	if (g_PudimTr.rodando)
		return;

	g_PudimTr.rodando = true;

	// Cria os dois arquivos se ainda não existem.
	//
	// Isso não é enfeite: o VFS do jogo indexa os diretórios ao carregar, e um
	// arquivo que nasce depois disso pode não ser enxergado. Criando os dois
	// aqui, o caminho já fica conhecido e o auxiliar só sobrescreve — e
	// sobrescrita o hotload do VFS acompanha.
	//
	// A condição do FileExists importa: se o tradutor já estava rodando com
	// traduções na mão, gravar por cima apagaria tudo.
	try {
		if (!Engine.FileExists(PUDIM_TR_REQ))
			Engine.WriteJSONFile(PUDIM_TR_REQ, { "items": [], "t": Date.now() });

		if (!Engine.FileExists(PUDIM_TR_RES))
			Engine.WriteJSONFile(PUDIM_TR_RES, { "done": {}, "vivo": 0 });
	} catch (e) {
		warn("PudimMod: não consegui preparar a ponte de tradução: " + e);
	}

	pudim_TrTique();
}
