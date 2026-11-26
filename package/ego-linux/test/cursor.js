const fixture = process.env.FIXTURE_URL;
const task = await taskSpace("port-cursor");
const page = task.page("p1");
const HOST = "document.getElementById(\x27ego-agent-cursor-overlay\x27)";
const SHADOW = `${HOST}.__egoShadow`;
const probe = (expression) => page.evaluate(expression);
const centerOf = (selector) =>
  page.evaluate(`(() => {
    const r = document.querySelector(${JSON.stringify(selector)}).getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  })()`);

await page.goto(fixture);
await page.waitForLoadState();

const center = await centerOf("#click-button");
await page.mouse.click(center.x, center.y, { label: "counting" });

for (let attempt = 0; attempt < 40; attempt += 1) {
  if (await probe(`!!${HOST}`)) break;
  await page.waitForTimeout(50);
}

console.log("1. overlay present:      " + (await probe(`!!${HOST}`)));

const transform = await probe(`${SHADOW}.getElementById(\x27pointer\x27).style.transform`);
const args = String(transform).replace(/^[^(]*\(/, "");
const [x, y] = (args.match(/-?[\d.]+/g) || []).map(Number);
console.log(
  "2. cursor tracks click:  " +
    (Math.abs(x - center.x) < 1 && Math.abs(y - center.y) < 1) +
    ` (${transform} vs ${center.x},${center.y})`,
);

console.log("3. badge text:           " + (await probe(`${SHADOW}.getElementById(\x27text\x27).textContent`)));
console.log("4. hit test at cursor:   " + (await probe(`document.elementFromPoint(${center.x}, ${center.y}).id`)));
console.log("5. click still landed:   " + (await probe("document.getElementById(\x27count\x27).textContent")));

const snap = await page.snapshot({ scope: "full_page" });
console.log("6. overlay in snapshot:  " + snap.includes("ego-agent-cursor"));

await page.mouse.move(center.x, center.y);
await page.waitForTimeout(300);
const beforeWheel = await probe(`${SHADOW}.getElementById(\x27pointer\x27).style.transform`);
await page.mouse.wheel(0, 200);
await page.waitForTimeout(200);
const afterScroll = await probe(`${SHADOW}.getElementById(\x27pointer\x27).style.transform`);
console.log("7. cursor held on wheel: " + (afterScroll === beforeWheel));

const pressState = () => probe(`${SHADOW}.getElementById(\x27pointer\x27).className`);
await page.mouse.move(center.x, center.y);
await page.mouse.down();
await page.waitForTimeout(80);
console.log("8. pressed on down:      " + ((await pressState()) === "press"));

await page.mouse.up();
await page.waitForTimeout(400);
console.log("9. released on up:       " + ((await pressState()) === ""));

const onScreen = () =>
  probe(`(() => {
    const r = ${SHADOW}.getElementById(\x27arrow\x27).getBoundingClientRect();
    return Math.round(r.top);
  })()`);
await page.evaluate("document.body.style.minHeight = \x272400px\x27");
const beforeScroll = await onScreen();
await page.evaluate("window.scrollTo(0, 220)");
await page.waitForTimeout(250);
const afterScrollTop = await onScreen();
console.log(
  "10. travels with page:   " +
    (Math.abs(beforeScroll - afterScrollTop - 220) <= 2) +
    ` (${beforeScroll} -> ${afterScrollTop})`,
);
await page.evaluate("window.scrollTo(0, 0)");
await page.waitForTimeout(250);

const shownShape = () =>
  probe(`[...${SHADOW}.querySelectorAll(\x27svg.shape.on\x27)].map(s => s.id).join()`);
const badgeText = () => probe(`${SHADOW}.getElementById(\x27text\x27).textContent`);

const link = await centerOf("a");
await page.mouse.move(link.x, link.y);
await page.waitForTimeout(200);
console.log("11. hand over a link:    " + (await shownShape()));
console.log("12. names what it is on: " + (await badgeText()));

const field = await centerOf("#name-input");
await page.mouse.move(field.x, field.y);
await page.waitForTimeout(200);
console.log("13. beam over a field:   " + (await shownShape()));

await page.fill("loc=css:#name-input", "Ada");
await page.waitForTimeout(200);
console.log("14. says it is typing:   " + (await badgeText()));
console.log("15. marks the field:     " + (await probe(`${SHADOW}.getElementById(\x27ring\x27).className`)));
await page.waitForTimeout(1000);
console.log("16. lets go when done:   " + (await probe(`${SHADOW}.getElementById(\x27ring\x27).className`) === ""));

const bandCount = () => probe(`${SHADOW}.getElementById(\x27bands\x27).children.length`);
const byText = await ego.highlight("must survive the snapshot", { note: "explaining this" });
await page.waitForTimeout(500);
console.log("17. highlight lines:     " + byText.lines);
console.log("18. bands drawn:         " + (await bandCount()));
console.log("19. note in badge:       " + (await badgeText()));

await ego.highlight("h1", { note: "the heading" });
await page.waitForTimeout(600);
console.log(
  "20. band matches text:   " +
    (await probe(`(() => {
      const range = document.createRange();
      range.selectNodeContents(document.querySelector(\x27h1\x27));
      const want = range.getBoundingClientRect();
      const band = ${SHADOW}.getElementById(\x27bands\x27).children[0].getBoundingClientRect();
      return Math.round(Math.abs(band.width - want.width)) + \x27,\x27 + Math.round(Math.abs(band.left - want.left));
    })()`)),
);

const miss = await ego.highlight("no such words appear anywhere on this page");
console.log("21. miss draws nothing:  " + (miss.done === false && miss.lines === 0));

await ego.clearHighlight();
await page.waitForTimeout(200);
console.log("22. cleared:             " + ((await bandCount()) === 0));

await page.snapshot({ scope: "full_page" });
await page.waitForTimeout(300);
console.log("23. says what it reads:  " + (await badgeText()));
console.log("24. marks the lines:     " + ((await bandCount()) > 0));

await page.mouse.move(center.x, center.y);
await page.waitForTimeout(150);
const sweepDone = await probe(`document.getElementById(\x27ego-agent-cursor-overlay\x27).__egoSweep.done`);
console.log("25. input ends the read: " + sweepDone);

const trail = await probe(`(() => {
  const log = document.getElementById(\x27ego-agent-cursor-overlay\x27).__egoLog || [];
  return log.map(e => e.text).join(\x27 | \x27);
})()`);
console.log("26. trail:               " + trail);

await page.evaluate("document.body.style.minHeight = \x273000px\x27");
await page.mouse.move(center.x, center.y);
await page.waitForTimeout(250);
await page.evaluate("window.scrollTo(0, 1400)");
await page.waitForTimeout(250);
const docked = JSON.parse(
  await probe(`(() => {
    const badge = ${SHADOW}.getElementById(\x27badge\x27).getBoundingClientRect();
    const arrow = ${SHADOW}.getElementById(\x27arrow\x27).getBoundingClientRect();
    return JSON.stringify({
      gone: arrow.bottom < 0,
      onScreen:
        badge.top >= 0 && badge.left >= 0 &&
        badge.bottom <= innerHeight && badge.right <= innerWidth,
      hint: ${SHADOW}.getElementById(\x27hint\x27).textContent,
      independent: !${SHADOW}.getElementById(\x27pointer\x27)
        .contains(${SHADOW}.getElementById(\x27badge\x27)),
    });
  })()`),
);
console.log("27. cursor leaves view:  " + docked.gone);
console.log("28. badge stays in it:   " + docked.onScreen);
console.log("29. and points back:     " + docked.hint);
console.log("30. drawn independently: " + docked.independent);

await page.evaluate("window.scrollTo(0, 0)");
await page.waitForTimeout(250);
const moveFor = async (mx, my) => {
  await page.mouse.move(mx, my);
  await page.waitForTimeout(80);
  return parseInt(await probe(`${SHADOW}.getElementById(\x27pointer\x27).style.transitionDuration`), 10);
};
await moveFor(center.x, center.y);
const near = await moveFor(center.x + 6, center.y);
const far = await moveFor(30, 30);
console.log("31. motion scales:       " + (near < far) + ` (${near}ms vs ${far}ms)`);
await task.finish({ keep: [] });
