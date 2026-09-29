const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const t = `        auditedTrade.tp3Pct = 0;
      }

      res.json({ status: "success", tradeSetup: auditedTrade });`;

const r = `        auditedTrade.tp3Pct = 0;
      }

      // Inject into simulation engine
      const simId = 'suggest-' + Date.now();
      auditedTrade.id = simId;
      aiActiveVirtualTrades.push({
        ...auditedTrade,
        id: simId,
        isLong: true,
        type: 'Scalp',
        status: 'PENDING',
        createdAt: Date.now(),
        validForHours: 12
      });

      res.json({ status: "success", tradeSetup: auditedTrade });`;

code = code.replace(t, r);
fs.writeFileSync('server.ts', code);
console.log("Added tracking to suggest-trade");
