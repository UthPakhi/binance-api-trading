const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

code = code.replace(
  "if (cachedSignals && (now - lastSignalTime < 15 * 60 * 1000)) {",
  "if (cachedSignals && (now - lastSignalTime < 15 * 60 * 1000) && req.query.force !== 'true') {"
);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts force refresh");
