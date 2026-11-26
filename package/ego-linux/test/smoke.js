const fixture = process.env.FIXTURE_URL;

const task = await taskSpace("port-smoke");
const page = task.page("p1");
await page.goto(fixture);
await page.waitForLoadState();

const info = await page.info();
console.log("URL:      " + info.url);
console.log("TITLE:    " + info.title);

const tabs = await task.tabs();
console.log("TABS:     " + tabs.length + " (active: " + tabs.filter((t) => t.active).length + ")");

const snap = await page.snapshot({ scope: "full_page", includeStableLocator: true });
const refMatches = snap.match(/\[ref=\d+/g) || [];
console.log("REFS:     " + refMatches.length);
console.log("--- SNAPSHOT ---");
console.log(snap);
await task.finish({ keep: [] });
