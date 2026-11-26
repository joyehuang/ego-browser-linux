const fixture = process.env.FIXTURE_URL;

const alpha = await taskSpace("port smoke alpha");
console.log("1. created:      " + JSON.stringify({ id: alpha.id, name: alpha.name, ownership: alpha.ownership }));

const pAlpha = alpha.page("p1");
await pAlpha.goto(fixture);
await pAlpha.waitForLoadState();
console.log("2. alpha page:   " + (await pAlpha.title()));

const beta = await taskSpace("port smoke beta");
console.log("3. second space: " + JSON.stringify({ id: beta.id, name: beta.name }));
const pBeta = beta.page("p1");
await pBeta.goto("about:blank#beta");
console.log("4. beta page:    " + (await pBeta.url()));

console.log("5. back in alpha:" + (await pAlpha.title()));
console.log("6. list:         " + JSON.stringify((await listTaskSpaces()).map((s) => ({ id: s.id, name: s.name, ownership: s.ownership }))));

await alpha.handOff();
console.log("7. after handOff:" + JSON.stringify((await listTaskSpaces()).filter((s) => s.id === alpha.id).map((s) => s.ownership)));

const resumedAlpha = await takeOverTaskSpace(alpha.id);
await resumedAlpha.finish({ keep: [] });
await beta.finish({ keep: [] });
console.log("8. after cleanup:" + JSON.stringify((await listTaskSpaces()).filter((s) => s.id === alpha.id || s.id === beta.id)));
