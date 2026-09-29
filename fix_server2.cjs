const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');
code = code.replace(/}\n  }\);\n\\n\\n  app\.post\("\/api\/suggest-trade", async/g, '}\n  });\n\n  app.post("/api/suggest-trade", async');
code = code.replace(/}\n  }\);\\n\\n  app\.post\("\/api\/suggest-trade", async/g, '}\n  });\n\n  app.post("/api/suggest-trade", async');
fs.writeFileSync('server.ts', code);
