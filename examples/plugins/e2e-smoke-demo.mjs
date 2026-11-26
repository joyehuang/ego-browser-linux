export function assertText(haystack, needle, label = "page content") {
  const text = String(haystack ?? "");
  if (!text.includes(needle)) {
    throw new Error(`Expected ${label} to contain ${JSON.stringify(needle)}`);
  }
  return true;
}

export async function checkPage(ctx, opts = {}) {
  const targetUrl = opts.url || "https://example.com";
  const expectedText = opts.expect || "Example Domain";

  return ctx.withSpace(
    "e2e-smoke-demo",
    {
      profileId: opts.profileId || "isolated",
      keepOpen: Boolean(opts.keepOpen),
    },
    async (task, page) => {
      ctx.log(`navigating to ${targetUrl}`);
      await page.goto(targetUrl);
      const snapshot = await page.snapshot();
      const title = typeof page.title === "function" ? await page.title() : "";
      const finalUrl = typeof page.url === "function" ? await page.url() : targetUrl;
      assertText(`${title}\n${snapshot}`, expectedText, `page ${finalUrl}`);
      return {
        url: finalUrl,
        title,
        matched: true,
        spaceId: task.spaceId ?? task.id,
      };
    },
  );
}

export default {
  name: "smoke-demo",
  version: "1.0.0",
  description: "Example isolated E2E smoke test workflow",
  helpers: { assertText },
  workflows: { checkPage },
};
