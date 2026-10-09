/** Shared route contract. Locale prefixes are reserved for translated UI pages. */
export const locales = [
	{ code: "en", name: "English" },
	{ code: "zh-cn", name: "简体中文" },
	{ code: "zh-tw", name: "繁體中文" },
	{ code: "ja", name: "日本語" },
	{ code: "ko", name: "한국어" },
	{ code: "es", name: "Español" },
	{ code: "id", name: "Bahasa Indonesia" },
	{ code: "th", name: "ไทย" },
	{ code: "tr", name: "Türkçe" },
	{ code: "vi", name: "Tiếng Việt" },
] as const;

export type Locale = (typeof locales)[number]["code"];

export function normalizeLocale(value: string): Locale {
	const normalized = value.toLowerCase().replaceAll("_", "-");
	if (normalized === "zh-hans") return "zh-cn";
	if (normalized === "zh-hant") return "zh-tw";
	return (
		locales.find(({ code }) => code === normalized)?.code ??
		locales.find(({ code }) => code === normalized.split("-")[0])?.code ??
		"en"
	);
}

export function splitLocalePath(
	path: string,
	base = "/",
): { locale?: Locale; path: string } {
	const root = `/${base.split("/").filter(Boolean).join("/")}`;
	let relative =
		root !== "/" && (path === root || path.startsWith(`${root}/`))
			? path.slice(root.length) || "/"
			: path;
	const first = relative.split("/")[1];
	const locale = locales.find(({ code }) => code === first)?.code;
	if (locale) relative = relative.slice(locale.length + 1) || "/";
	return { locale, path: relative };
}

export function localePath(
	path: string,
	locale: string,
	defaultLocale: string,
	base = "/",
): string {
	const suffixIndex = path.search(/[?#]/);
	const pathname = suffixIndex < 0 ? path : path.slice(0, suffixIndex);
	const suffix = suffixIndex < 0 ? "" : path.slice(suffixIndex);
	const relative = splitLocalePath(pathname, base).path;
	const prefix =
		normalizeLocale(locale) === normalizeLocale(defaultLocale)
			? ""
			: `/${normalizeLocale(locale)}`;
	return `${base.replace(/\/$/, "")}${prefix}${relative.startsWith("/") ? relative : `/${relative}`}${suffix}`;
}

// Middleware installs a request-local reader; never store a request's locale globally.
let serverLocale: (() => Locale | undefined) | undefined;
export function setServerLocaleReader(reader: () => Locale | undefined): void {
	serverLocale = reader;
}

export function currentLocale(fallback: string, base = "/"): Locale {
	return (
		(typeof window === "undefined"
			? serverLocale?.()
			: splitLocalePath(window.location.pathname, base).locale) ??
		normalizeLocale(fallback)
	);
}
