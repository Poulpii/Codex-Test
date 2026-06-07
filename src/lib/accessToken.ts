const ACCESS_TOKEN_KEY = "copropro_access_token";

export function initAccessToken() {
  try {
    const url = new URL(window.location.href);
    const token = url.searchParams.get("token") || url.searchParams.get("access_token");
    if (!token) return;
    sessionStorage.setItem(ACCESS_TOKEN_KEY, token);
    url.searchParams.delete("token");
    url.searchParams.delete("access_token");
    window.history.replaceState({}, document.title, `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // L'app locale reste utilisable sans jeton.
  }
}

export function currentAccessToken() {
  try {
    return sessionStorage.getItem(ACCESS_TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function documentHref(href: string) {
  const token = currentAccessToken();
  if (!token || !String(href || "").startsWith("Documents/")) return href || "#";
  const separator = href.includes("?") ? "&" : "?";
  return `${href}${separator}token=${encodeURIComponent(token)}`;
}
