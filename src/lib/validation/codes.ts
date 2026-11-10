// Derives a short, readable identifier from a display name and makes it unique among `taken`.
export function uniqueCode(name: string, fallbackPrefix: string, taken: Set<string>) {
  const base =
    name
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 30) || fallbackPrefix;
  let code = base;
  for (let n = 2; taken.has(code); n++) code = `${base}-${n}`;
  return code;
}
