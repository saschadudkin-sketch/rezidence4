export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiBaseUrl(): string {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!value) {
    throw new Error("Не задан EXPO_PUBLIC_API_BASE_URL. Настройте адрес тестового API.");
  }

  const url = new URL(value);
  if (url.protocol !== "https:" && url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error("Мобильное приложение допускает только HTTPS API вне локальной разработки.");
  }
  return url.toString().replace(/\/$/, "");
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/api/v1/")) {
    throw new Error("Разрешены только versioned API paths /api/v1/.");
  }

  const baseUrl = getApiBaseUrl();
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      ...(init.body ? { "Content-Type": "application/json" } : {}),
      ...init.headers,
    },
  });

  if (!response.ok) {
    const safeMessage =
      response.status === 401
        ? "Сессия не подтверждена. Войдите заново."
        : response.status === 403
          ? "Недостаточно прав для этого действия."
          : response.status >= 500
            ? "Сервис временно недоступен."
            : `Запрос отклонён (код ${response.status}).`;
    throw new ApiError(safeMessage, response.status);
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}
