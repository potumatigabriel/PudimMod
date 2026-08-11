/**
 * PudimMod — options~pudim.js
 * Adiciona as opções de configuração do PudimMod no menu de opções do 0 A.D.
 */

pudim_patchApplyN("init", function(target, that, args) {
	const promise = target.apply(that, args);

	try
	{
		let options = Engine.ReadJSONFile("moddata/pudim_options.json");

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
