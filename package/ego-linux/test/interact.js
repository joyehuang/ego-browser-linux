const fixture = process.env.FIXTURE_URL;
const task = await taskSpace("port-interact");
const page = task.page("p1");
const read = (id) => page.evaluate(`document.getElementById("${id}").textContent`);
const value = (id) => page.evaluate(`document.getElementById("${id}").value`);
const centerOf = (selector) =>
  page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

await page.goto(fixture);
await page.waitForLoadState();

const snap = await page.snapshot({ scope: "full_page" });
const buttonMatch = snap.match(/button "Increment counter" \[ref=(\d+)/);
const buttonRef = buttonMatch?.[1];
console.log("1. button ref:            " + buttonRef);

const center = await centerOf("#click-button");
console.log("2. @ref center:           " + JSON.stringify(center));

await page.click("@" + buttonRef);
console.log("3. after mouse click:     " + (await read("count")));

await page.click("loc=css:#click-button");
console.log("5. after locator click:   " + (await read("count")));

await page.fill("loc=css:#name-input", "Vikt");
console.log("6. locator fill:          " + (await value("name-input")));

const deepMatch = snap.match(/button "Deep button" \[ref=(\d+)/);
const deepRef = deepMatch?.[1];
console.log("7. deep iframe ref:       " + deepRef);
await page.click("@" + deepRef);
console.log("8. deep click ok:         true");

const shot = await page.screenshot();
console.log("9. screenshot:            " + shot);

console.log("10. tabs:                 " + JSON.stringify(await task.tabs()));
await task.finish({ keep: [] });
