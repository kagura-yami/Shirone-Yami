import assert from "node:assert/strict";
import test from "node:test";
import {
	localePath,
	normalizeLocale,
	splitLocalePath,
} from "../src/i18n/locale.ts";

test("locale aliases and fallback", () => {
	assert.equal(normalizeLocale("zh_CN"), "zh-cn");
	assert.equal(normalizeLocale("en_GB"), "en");
	assert.equal(normalizeLocale("unknown"), "en");
});

test("switching retains page, query and hash without stacking locale or base", () => {
	assert.equal(
		localePath("/blog/zh-cn/posts/hello/?a=1#intro", "ja", "en", "/blog/"),
		"/blog/ja/posts/hello/?a=1#intro",
	);
	assert.equal(
		localePath("/blog/ja/archive/", "en", "en", "/blog/"),
		"/blog/archive/",
	);
	assert.equal(localePath("/", "zh_CN", "zh_CN"), "/");
	assert.deepEqual(splitLocalePath("/blogger/ja/", "/blog/"), {
		locale: undefined,
		path: "/blogger/ja/",
	});
});
