export class ApiError extends Error {
  constructor(
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = "ApiError";
  }
}
export type CompletionOptions = {
  apiKey: string;
  model: string;
  systemPrompt: string;
  prompt: string;
  maxOutputTokens: number;
  inputTokenBudget?: number;
  signal?: AbortSignal;
};
export async function complete(options: CompletionOptions): Promise<string> {
  if (
    options.inputTokenBudget !== undefined &&
    Math.ceil((options.systemPrompt.length + options.prompt.length) / 3) + 24 >
      options.inputTokenBudget
  ) {
    throw new ApiError(
      "context_too_long",
      "La petición completa supera el presupuesto de entrada. Acorta el prompt o aumenta el presupuesto.",
    );
  }
  const timeout = AbortSignal.timeout(120000);
  const signal = options.signal
    ? AbortSignal.any([timeout, options.signal])
    : timeout;
  let response: Response;
  try {
    response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      signal,
      headers: {
        Authorization: `Bearer ${options.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: options.model,
        messages: [
          { role: "system", content: options.systemPrompt },
          { role: "user", content: options.prompt },
        ],
        max_tokens: options.maxOutputTokens,
      }),
    });
  } catch (error) {
    if (options.signal?.aborted)
      throw new ApiError("cancelled", "Operación cancelada.");
    if (timeout.aborted)
      throw new ApiError(
        "timeout",
        "OpenRouter tardó más de dos minutos. Prueba otro modelo o un límite menor.",
      );
    throw new ApiError(
      "network",
      "No se pudo conectar con OpenRouter. Comprueba tu conexión.",
    );
  }
  const body = (await response.json().catch(() => null)) as {
    error?: { code?: number; message?: string };
    choices?: { message?: { content?: string }; finish_reason?: string }[];
  } | null;
  if (!response.ok || body?.error) {
    const status = body?.error?.code ?? response.status;
    const detail = body?.error?.message || "";
    if (status === 401 || status === 403)
      throw new ApiError(
        "invalid_key",
        "Clave de OpenRouter inválida o sin permisos. Revisa la configuración.",
      );
    if (status === 402)
      throw new ApiError("credits", "Saldo insuficiente en OpenRouter.");
    if (
      status === 413 ||
      /context|too many tokens|maximum.*tokens/i.test(detail)
    )
      throw new ApiError(
        "context_too_long",
        "El contexto supera el límite del modelo. Reduce el presupuesto de entrada en Configuración.",
      );
    if (status === 429)
      throw new ApiError(
        "rate_limit",
        "OpenRouter ha limitado las peticiones. Espera y vuelve a intentarlo.",
      );
    throw new ApiError(
      "api_error",
      `OpenRouter devolvió un error (${status}). Revisa el ID del modelo o prueba otro.`,
    );
  }
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === "length")
    throw new ApiError(
      "output_limit",
      "La respuesta alcanzó el límite de salida. Aumenta ese límite o pide un análisis más breve.",
    );
  const content = choice?.message?.content;
  if (typeof content !== "string" || !content.trim())
    throw new ApiError(
      "empty",
      "El modelo no devolvió texto. Prueba otro modelo o aumenta el límite de salida.",
    );
  return content;
}
