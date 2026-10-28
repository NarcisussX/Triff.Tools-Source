// Browser-only helpers shared by the website's fitting components.
export function isNativeRuntime() { return false; }
export function triffToolsUrl(path: string) { return path; }
export function triffApiUrl(path: string) { return path; }
export function triffApiFetch(input: string, init: RequestInit = {}) {
  const options = input.startsWith("/api/") && init.credentials == null
    ? { ...init, credentials: "include" as RequestCredentials } : init;
  return fetch(input, options);
}
export async function openTriffExternalUrl(path: string, target = "_blank", features = "noopener,noreferrer") {
  return Boolean(window.open(path, target, features));
}
