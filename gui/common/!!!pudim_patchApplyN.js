/**
 * PudimMod — pudim_patchApplyN.js (lado GUI)
 *
 * Envolve uma função existente num Proxy para interceptar a chamada, permitindo rodar
 * código antes/depois do original sem reescrever o arquivo do jogo.
 *
 * O AutoCiv tem uma função equivalente (autociv_patchApplyN) e o PudimMod usava a dele.
 * Agora temos a nossa, com nome próprio: o mod funciona sem o AutoCiv instalado e, com
 * os dois ativos, cada um mexe só no seu global — sem disputa de namespace.
 *
 * O prefixo "!!!" no nome do arquivo garante o carregamento antes dos demais: o 0AD
 * carrega cada <script directory="..."/> em ordem alfabética, e "!" vem antes de tudo.
 *
 * Uso:
 *   pudim_patchApplyN("nomeDaFuncaoGlobal", (target, that, args) => { ... });
 *   pudim_patchApplyN(objeto, "metodo", (target, that, args) => { ... });
 *
 * O patch recebe (target, that, args) e é responsável por chamar target.apply(that, args)
 * se quiser preservar o comportamento original.
 */
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
