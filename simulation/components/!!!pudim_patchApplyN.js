/**
 * PudimMod — pudim_patchApplyN.js (lado simulação)
 *
 * Mesma função do arquivo homônimo em gui/common/, para o contexto da simulação.
 * Os dois contextos são isolados no 0AD, então cada um precisa da sua definição.
 *
 * Aqui é obrigatório o Engine.RegisterGlobal: cada componente da simulação roda no seu
 * próprio escopo, e sem registrar o global a função não estaria visível em
 * GuiInterface~pudim.js. O prefixo "!!!" garante que este arquivo carregue primeiro.
 */
// Guarda de idempotência: o 0AD recarrega os scripts da simulação (rejoin, deserialização),
// e Engine.RegisterGlobal falha se o mesmo global for registrado duas vezes.
if (typeof pudim_patchApplyN === "undefined")
{

global.pudim_patchApplyN = function()
{
	if (arguments.length < 2)
	{
		const error = new Error("PudimMod: argumentos insuficientes para o patch: " + arguments[0]);
		warn(error.message);
		warn(error.stack);
		return;
	}

	let prefix, method, patch;
	if (arguments.length == 2)
	{
		prefix = global;
		method = arguments[0];
		patch = arguments[1];
	}
	else
	{
		prefix = arguments[0];
		method = arguments[1];
		patch = arguments[2];
	}

	if (!(method in prefix))
	{
		const error = new Error("PudimMod: função não definida: " + method);
		warn(error.message);
		warn(error.stack);
		return;
	}

	prefix[method] = new Proxy(prefix[method], { "apply": patch });
};

Engine.RegisterGlobal("pudim_patchApplyN", global.pudim_patchApplyN);

}
