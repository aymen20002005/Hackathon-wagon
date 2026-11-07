import { startServer } from "./server.js";
import { runTestPack } from "./testpack.js";

const { server, baseUrl } = await startServer({ port: 0 });
const pack = await runTestPack({ baseUrl, allowedHosts: [new URL(baseUrl).host, `127.0.0.1:${new URL(baseUrl).port}`] });
for (const r of pack.results) console.log(`${r.pass ? "PASS" : "FAIL"} ${r.id} [${r.focus}] ${r.title}\n     expected: ${r.expected}\n     actual:   ${r.actual}`);
console.log(`\n${pack.passed}/${pack.total} passed`);
server.close();
process.exit(pack.passed === pack.total ? 0 : 1);
