export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`/api/v1${path}`, {
    ...init,
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });

  const isJson = response.headers.get("content-type")?.includes("application/json");
  const body = isJson ? await response.json() : null;

  if (!response.ok) {
    const err = body?.error ?? {};
    const fieldErrors = err.details?.fieldErrors as Record<string, string[]> | undefined;
    const firstFieldError = fieldErrors ? Object.values(fieldErrors).flat()[0] : undefined;
    const baseMessage = err.message ?? "Something went wrong. Please try again.";
    throw new ApiError(
      response.status,
      err.code ?? "UNKNOWN_ERROR",
      firstFieldError ? `${baseMessage} ${firstFieldError}` : baseMessage,
      err.details
    );
  }

  return body as T;
}

export const apiClient = {
  get: <T>(path: string, init?: Pick<RequestInit, "cache">) => request<T>(path, { ...init, method: "GET" }),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "POST", body: data ? JSON.stringify(data) : undefined }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PATCH", body: data ? JSON.stringify(data) : undefined }),
  put: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: "PUT", body: data ? JSON.stringify(data) : undefined }),
  delete: <T>(path: string) => request<T>(path, { method: "DELETE" }),
};
