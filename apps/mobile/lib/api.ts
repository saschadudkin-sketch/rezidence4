export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = "ApiError";
  }
}

function getApiBaseUrl(): URL {
  const value = process.env.EXPO_PUBLIC_API_BASE_URL?.trim();
  if (!value) {
    throw new Error("Не задан EXPO_PUBLIC_API_BASE_URL. Настройте адрес тестового API.");
  }

  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("EXPO_PUBLIC_API_BASE_URL должен быть корректным URL API.");
  }

  if (
    url.protocol !== "https:" &&
    url.hostname !== "localhost" &&
    url.hostname !== "127.0.0.1"
  ) {
    throw new Error("Мобильное приложение допускает только HTTPS API вне локальной разработки.");
  }

  if (url.username || url.password || url.search || url.hash || url.pathname !== "/") {
    throw new Error("Укажите только origin API без логина, пароля, пути, query-параметров или hash.");
  }

  return url;
}

export async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
): Promise<T> {
  if (!path.startsWith("/api/v1/")) {
    throw new Error("Разрешены только versioned API paths /api/v1/.");
  }

  const baseUrl = getApiBaseUrl();
  const requestUrl = new URL(path, baseUrl);

  // Проверяем уже нормализованный URL: строки вроде /api/v1/../auth
  // после нормализации выходят из /api/v1/ и не должны попасть в legacy API.
  if (
    requestUrl.origin !== baseUrl.origin ||
    !requestUrl.pathname.startsWith("/api/v1/")
  ) {
    throw new Error("Запрос должен оставаться в пределах versioned API /api/v1/.");
  }

  const response = await fetch(requestUrl.toString(), {
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
