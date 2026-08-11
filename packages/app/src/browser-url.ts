const ALLOWED_BROWSER_SCHEMES = new Set(["http:", "https:", "file:", "about:"]);

function hasAllowedBrowserScheme(value: string): boolean {
  try {
    return ALLOWED_BROWSER_SCHEMES.has(new URL(value).protocol);
  } catch {
    return false;
  }
}

function hasLocalhostPrefix(value: string): boolean {
  return value.startsWith("localhost") || value.startsWith("127.0.0.1");
}

function looksLikeBrowserUrl(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length === 0) return false;
  if (hasAllowedBrowserScheme(trimmed) || hasLocalhostPrefix(trimmed)) return true;
  return !trimmed.includes(" ") && trimmed.includes(".") && !trimmed.includes("@");
}

function normalizeBrowserNavigationInput(value: string): string | null {
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (hasAllowedBrowserScheme(trimmed)) return trimmed;
  if (hasLocalhostPrefix(trimmed)) return `http://${trimmed}`;
  if (looksLikeBrowserUrl(trimmed)) return `https://${trimmed}`;
  return `https://www.google.com/search?q=${encodeURIComponent(trimmed)}`;
}

export { normalizeBrowserNavigationInput };
