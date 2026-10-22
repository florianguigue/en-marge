export async function api(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    signal: AbortSignal.timeout(10000),
    ...options,
    headers: { "Content-Type": "application/json", ...options.headers },
  });
  if (!response.ok) {
    const error = new Error("Stockage serveur indisponible.");
    error.status = response.status;
    throw error;
  }
  return response.json();
}

export const loadLibrary = () => api("/api/library");
export const writeLibrary = (books, revision) =>
  api("/api/library", {
    method: "PUT",
    body: JSON.stringify({ books, revision }),
  });
export const importLibrary = (books) =>
  api("/api/library/import", {
    method: "POST",
    body: JSON.stringify({ books }),
  });
export const loadSettings = () => api("/api/settings");
export const writeLanguage = (language) =>
  api("/api/settings", {
    method: "PUT",
    body: JSON.stringify({ language }),
  });
