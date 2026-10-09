import { defineMiddleware } from "astro:middleware";
import { AsyncLocalStorage } from "node:async_hooks";
import type { MiddlewareHandler } from "astro";
import { siteConfig } from "../config/siteConfig.ts";
import {
	type Locale,
	normalizeLocale,
	setServerLocaleReader,
	splitLocalePath,
} from "./locale.ts";

const scope = new AsyncLocalStorage<Locale>();
setServerLocaleReader(() => scope.getStore());

export const onRequest: MiddlewareHandler = defineMiddleware(
	(context, next) => {
		const locale =
			splitLocalePath(context.url.pathname, siteConfig.base).locale ??
			normalizeLocale(siteConfig.lang);
		return scope.run(locale, next);
	},
);
