import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

test("header icons exist before hydration", async ({ browser, request }) => {
	const response = await request.get("/");
	expect(await response.text()).toContain('data-header-fallback="search"');
	const context = await browser.newContext({ javaScriptEnabled: false });
	const page = await context.newPage();
	await page.goto("/");
	await expect(
		page.locator('[data-header-fallback="search"] svg'),
	).toBeVisible();
	await expect(
		page.locator('[data-header-fallback="theme"] .fallback-auto'),
	).toBeVisible();
	await context.close();
});

test("language reveal waits for fonts and header hydration", async ({
	page,
}) => {
	await page.route(/\.(?:woff2?|ttf)(?:\?|$)/, async (route) => {
		await new Promise((resolve) => setTimeout(resolve, 400));
		await route.continue();
	});
	await page.addInitScript(() => {
		new MutationObserver(() => {
			if (
				document.documentElement.hasAttribute("data-language-navigation") &&
				!document.documentElement.hasAttribute("data-language-loading")
			) {
				(window as any).__languageRevealState = {
					fonts: document.fonts.status,
					pendingIslands: document.querySelectorAll("#navbar astro-island[ssr]")
						.length,
				};
			}
		}).observe(document, {
			subtree: true,
			attributes: true,
			attributeFilter: ["data-language-loading"],
		});
		window.addEventListener("pagereveal", (event) => {
			(window as any).__languageTransition = Boolean(
				(event as any).viewTransition,
			);
		});
	});
	await page.goto("/posts/guide/");
	await page.evaluate(() => document.fonts.ready);
	await page.locator("[data-language-switch] summary").click();
	await page.locator('[data-language="zh-cn"]').click();
	await expect(page).toHaveURL(/\/zh-cn\/posts\/guide\/$/);
	await expect(page.locator("html")).toHaveAttribute(
		"data-language-navigation",
		"",
	);
	await expect(page.locator("html")).not.toHaveAttribute(
		"data-language-loading",
	);
	await expect(page.locator("#navbar astro-island[ssr]")).toHaveCount(0);
	expect(await page.evaluate(() => document.fonts.status)).toBe("loaded");
	expect(await page.evaluate(() => (window as any).__languageTransition)).toBe(
		true,
	);
	expect(
		await page.evaluate(() => (window as any).__languageRevealState),
	).toEqual({ fonts: "loaded", pendingIslands: 0 });
	await page.screenshot({ path: "test-results/language-ready.png" });
});

test("banner header stays transparent from first paint across language loads", async ({
	page,
}) => {
	await page.addInitScript(() => {
		const frames: string[] = [];
		(window as any).__headerFrames = frames;
		const sample = () => {
			const header = document.getElementById("navbar");
			if (
				header &&
				getComputedStyle(header).position === "fixed" &&
				window.scrollY === 0
			) {
				frames.push(getComputedStyle(header).backgroundColor);
			}
			requestAnimationFrame(sample);
		};
		requestAnimationFrame(sample);
	});
	await page.goto("/posts/guide/");
	await page.locator("[data-language-switch] summary").click();
	await page.locator('[data-language="zh-cn"]').click();
	await expect(page).toHaveURL(/\/zh-cn\/posts\/guide\/$/);
	await expect(page.locator("#navbar")).toHaveCSS(
		"background-color",
		"rgba(0, 0, 0, 0)",
	);
	await expect
		.poll(() => page.evaluate(() => (window as any).__headerFrames.length))
		.toBeGreaterThan(5);
	expect(
		await page.evaluate(() =>
			(window as any).__headerFrames.filter(
				(color: string) => color !== "rgba(0, 0, 0, 0)",
			),
		),
	).toEqual([]);
	await page.evaluate(() => window.scrollTo(0, window.innerHeight));
	await expect(page.locator("#navbar")).not.toHaveClass(
		/top-app-bar--transparent/,
	);
});

test("translated SSR and concurrent locale requests remain isolated", async ({
	request,
}) => {
	const [zh, ja, en] = await Promise.all([
		request.get("/zh-cn/archive/"),
		request.get("/ja/archive/"),
		request.get("/archive/"),
	]);
	for (const response of [zh, ja, en]) expect(response.ok()).toBeTruthy();
	expect(await zh.text()).toContain('lang="zh-cn"');
	expect(await zh.text()).toContain("归档分组");
	expect(await ja.text()).toContain("アーカイブのグループ化");
	expect(await en.text()).toContain("Group archive by");
});

test("switch language, preserve URL state, persist preference and navigate with Swup", async ({
	page,
}) => {
	await page.goto("/archive/?tag=Blogging#content-wrapper");
	await page.locator("[data-language-switch] summary").click();
	await page.locator('[data-language="zh-cn"]').click();
	await expect(page).toHaveURL(
		/\/zh-cn\/archive\/\?tag=Blogging#content-wrapper$/,
	);
	await expect(page.locator("html")).toHaveAttribute("lang", "zh-cn");
	await expect(page.locator("[data-language-switch] summary")).toHaveAttribute(
		"aria-label",
		"界面语言",
	);
	await page.reload();
	await expect(page.locator("#swup-container")).toContainText("标签");
	await page.waitForFunction(() => Boolean(window.swup));
	await page.evaluate(() => {
		document
			.querySelector("#navbar")
			?.setAttribute("data-test-persistent", "yes");
	});
	await page.locator("#category-bar a").first().click();
	await expect(page).toHaveURL(/\/zh-cn\/$/);
	await expect(page.locator("#swup-container")).toHaveAttribute(
		"data-current-page",
		"home",
	);
	await expect(page.locator("html")).not.toHaveClass(/is-changing/);
	await expect(page.locator("#navbar")).toHaveAttribute(
		"data-test-persistent",
		"yes",
	);
	await page.locator("[data-language-switch] summary").click();
	await expect(page.locator('[data-language="en"]')).toHaveAttribute(
		"href",
		/\/$/,
	);
	await page.locator('[data-language="en"]').click();
	await expect(page).toHaveURL(/:\d+\/$/);
	await expect(page.locator("[data-language-switch] summary")).toHaveAttribute(
		"aria-label",
		"Language",
	);
	await page.goto("/archive/");
	await expect(page).toHaveURL(/\/archive\/$/);
});

test("mobile language menu fits viewport and closes with Escape", async ({
	page,
}) => {
	await page.setViewportSize({ width: 375, height: 812 });
	await page.goto("/zh-cn/");
	await page.locator("[data-language-switch] summary").click();
	const menu = page.locator("[data-language-switch] nav");
	await expect(menu).toBeVisible();
	const box = await menu.boundingBox();
	if (!box) throw new Error("Language menu has no layout box");
	expect(box.x).toBeGreaterThanOrEqual(0);
	expect(box.x + box.width).toBeLessThanOrEqual(375);
	await page.screenshot({ path: "test-results/language-mobile.png" });
	await page.keyboard.press("Escape");
	await expect(menu).toBeHidden();
	await expect(page.locator("[data-language-switch] summary")).toBeFocused();
});

test("translated language menu has accessible labels and contrast", async ({
	page,
}) => {
	await page.emulateMedia({ reducedMotion: "reduce" });
	await page.goto("/zh-cn/archive/");
	await page.waitForFunction(() =>
		document.documentElement.style
			.getPropertyValue("--mc-primary")
			.startsWith("#"),
	);
	await page.locator("[data-language-switch] summary").click();
	const results = await new AxeBuilder({ page })
		.include("[data-language-switch]")
		.analyze();
	expect(results.violations).toEqual([]);
	await page.screenshot({ path: "test-results/language-desktop.png" });
});
