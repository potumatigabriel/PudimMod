/**
 * PudimMod — options~pudim.js
 * Adiciona as opções de configuração do PudimMod no menu de opções do 0 A.D.
 */

pudim_patchApplyN("init", function(target, that, args) {
	const promise = target.apply(that, args);

	try
	{
		let options = Engine.ReadJSONFile("moddata/pudim_options.json");

		// Idioma do jogo decide o texto. O arquivo traz os dois: label/tooltip em portugues
		// e label_en/tooltip_en em ingles.
		//
		// Pedido de 25/08: "se o jogo instalado estiver em outra lingua que n seja pt ou
		// pt-br, tem que ficar em ingles os botoes e as explicacoes". O mod nasceu em
		// portugues e ficou assim, entao quem joga em qualquer outra lingua lia portugues.
		//
		// Falha para o INGLES, nao para o portugues: se a deteccao nao funcionar, e mais
		// provavel que o jogo esteja num idioma que este mod nao fala.
		// Mesma ordem de decisao de pudim_Lang() em gui/session/pudim_i18n.js. Ela nao pode
		// ser chamada daqui: a tela de opcoes e outra pagina de GUI e nao carrega os scripts
		// da sessao. Duplicar SEIS LINHAS e melhor do que mover o dicionario inteiro de
		// lugar so para compartilha-las — mas a ordem tem de bater, senao o mesmo jogo
		// mostraria o painel numa lingua e as opcoes noutra.
		// MESMA ORDEM de pudim_Lang(), em gui/session/pudim_i18n.js — os tres passos, nao
		// dois. Ela nao pode ser chamada daqui: a tela de opcoes e outra pagina de GUI e nao
		// carrega os scripts da sessao. Duplicar custa estas linhas; divergir custaria o
		// mesmo jogo mostrando o painel numa lingua e as opcoes noutra, que e pior.
		let idioma = "en";
		try {
			// 1) Preferencia explicita do jogador.
			const forcado = Engine.ConfigDB_GetValue("user", "pudim.lang");
			if (forcado === "pt" || forcado === "en")
				idioma = forcado;
			else
			{
				// 2) O LOCALE DO JOGO, pela API do motor — a mesma fonte de pudim_Lang().
				//    O 0 A.D. usa o locale do sistema e nao grava nada no user.cfg quando o
				//    jogador nunca escolheu idioma na mao, entao procurar por chave de
				//    configuracao falha justamente no caso mais comum.
				const lang = Engine.GetLocaleLanguage(Engine.GetCurrentLocale());
				if (lang)
					idioma = (lang === "pt") ? "pt" : "en";
				else
					// 3) Sem a API: as chaves de configuracao, se existirem.
					for (const chave of ["locale", "language", "gui.locale"])
					{
						const loc = Engine.ConfigDB_GetValue("user", chave) || "";
						if (loc) { idioma = loc.toLowerCase().indexOf("pt") === 0 ? "pt" : "en"; break; }
					}
			}
		} catch (e) { }

		if (idioma === "en" && options)
			for (const grupo of options)
				for (const o of (grupo.options || []))
				{
					if (o.label_en) o.label = o.label_en;
					if (o.tooltip_en) o.tooltip = o.tooltip_en;
				}

		if (Array.isArray(g_Options) && options)
		{
			g_Options = g_Options.concat(options);

			// Re-renderizar os botões de abas para incluir a aba do PudimMod
			if (typeof placeTabButtons === "function")
			{
				placeTabButtons(
					g_Options,
					false,
					g_TabButtonHeight,
					g_TabButtonDist,
					selectPanel,
					displayOptions
				);
			}
		}
	}
	catch (e)
	{
		warn("[PudimMod] Erro ao carregar opções: " + e);
	}

	return promise;
});
