const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const simCode = `
// --- AI VIRTUAL TRADING SIMULATION ENGINE ---
let aiSimulationHistory: any[] = [];
let aiActiveVirtualTrades: any[] = [];
let simulationBaseCapital = 10000; // $10k virtual portfolio

function checkVirtualTrades(livePrices: any) {
  const now = Date.now();
  let closedSome = false;
  
  aiActiveVirtualTrades = aiActiveVirtualTrades.filter(trade => {
    const live = livePrices.find((p: any) => p.symbol === trade.symbol);
    if (!live) return true; // keep active
    const price = parseFloat(live.price);
    
    // Setup expired before hitting entry
    if (trade.status === 'PENDING') {
      const hoursSince = (now - trade.createdAt) / (1000 * 60 * 60);
      if (hoursSince > trade.validForHours) {
        trade.status = 'EXPIRED';
        aiSimulationHistory.push(trade);
        closedSome = true;
        return false;
      }
      
      // Check entry
      if (trade.isLong && price <= trade.entry) trade.status = 'ACTIVE';
      if (!trade.isLong && price >= trade.entry) trade.status = 'ACTIVE';
      return true; // keep tracking
    }
    
    if (trade.status === 'ACTIVE') {
      // Risk = $100 per trade (1% of 10k)
      const riskAmount = simulationBaseCapital * 0.01;
      const slDist = Math.abs(trade.entry - trade.sl) / trade.entry;
      const posSize = slDist > 0 ? riskAmount / slDist : 0;
      
      // Check SL
      if ((trade.isLong && price <= trade.sl) || (!trade.isLong && price >= trade.sl)) {
        trade.status = 'CLOSED_SL';
        trade.pnl = -riskAmount;
        trade.closedAt = now;
        simulationBaseCapital += trade.pnl;
        aiSimulationHistory.push(trade);
        closedSome = true;
        return false;
      }
      
      // Check TPs (Simplify by assuming if TP1 hits, we take profit on the whole lot for this basic simulation)
      if ((trade.isLong && price >= trade.tp1) || (!trade.isLong && price <= trade.tp1)) {
        trade.status = 'CLOSED_TP1';
        const tpDist = Math.abs(trade.tp1 - trade.entry) / trade.entry;
        trade.pnl = posSize * tpDist;
        trade.closedAt = now;
        simulationBaseCapital += trade.pnl;
        aiSimulationHistory.push(trade);
        closedSome = true;
        return false;
      }
    }
    
    return true; // keep active
  });
  
  // Keep history manageable
  if (aiSimulationHistory.length > 50) {
    aiSimulationHistory = aiSimulationHistory.slice(-50);
  }
}

// Background loop to run simulation every 15 seconds
setInterval(async () => {
  if (aiActiveVirtualTrades.length === 0) return;
  try {
    const symbols = [...new Set(aiActiveVirtualTrades.map(t => t.symbol))];
    const symStr = JSON.stringify(symbols);
    const pRes = await fetch(\`https://api.binance.com/api/v3/ticker/price?symbols=\${symStr}\`);
    const pData = await pRes.json();
    if (Array.isArray(pData)) {
      checkVirtualTrades(pData);
    }
  } catch(e) {}
}, 15000);

app.get("/api/ai-performance", (req, res) => {
  const closedTrades = aiSimulationHistory.filter(t => t.status.startsWith('CLOSED'));
  const wins = closedTrades.filter(t => t.pnl > 0).length;
  const losses = closedTrades.filter(t => t.pnl < 0).length;
  const winRate = closedTrades.length > 0 ? (wins / closedTrades.length) * 100 : 0;
  const totalPnl = closedTrades.reduce((acc, t) => acc + t.pnl, 0);
  
  res.json({
    baseCapital: simulationBaseCapital,
    winRate: winRate.toFixed(1),
    totalTrades: closedTrades.length,
    totalPnl: totalPnl,
    history: [...aiSimulationHistory].reverse().slice(0, 10),
    active: aiActiveVirtualTrades
  });
});
// --- END VIRTUAL SIMULATION ---

`;

code = code.replace('// --- AI Background Signals Engine ---', simCode + '// --- AI Background Signals Engine ---');

// Also inject active trades when signals are generated
const cacheUpdate = `
    cachedSignals = data.signals;
    lastSignalTime = now;
`;

const newCacheUpdate = `
    cachedSignals = data.signals;
    lastSignalTime = now;
    
    // Inject into simulation engine if they aren't already there
    cachedSignals.forEach((sig: any) => {
      const existing = aiActiveVirtualTrades.find(t => t.id === sig.id);
      if (!existing && !aiSimulationHistory.find(t => t.id === sig.id)) {
        aiActiveVirtualTrades.push({
          ...sig,
          status: 'PENDING',
          createdAt: now
        });
      }
    });
`;
code = code.replace(cacheUpdate, newCacheUpdate);


// Inject performance into AI Prompt
const oldPrompt = "Identify 3 distinct trading opportunities (prefer BTC, ETH, SOL).";
const newPrompt = `Identify 3 distinct trading opportunities (prefer BTC, ETH, SOL).

CRITICAL PERFORMANCE FEEDBACK LOOP: 
Your recent simulated win rate is \${(() => {
  const closed = aiSimulationHistory.filter(t => t.status.startsWith('CLOSED'));
  const wins = closed.filter(t => t.pnl > 0).length;
  return closed.length > 0 ? (wins / closed.length * 100).toFixed(1) : 0;
})()}%. 
Total Simulated PnL: $\${aiSimulationHistory.reduce((acc, t) => acc + (t.pnl || 0), 0).toFixed(2)}.
Use this feedback to self-correct. If your win rate is dropping, tighten your invalidation levels and wait for deeper pullbacks before suggesting entries.`;

code = code.replace(oldPrompt, newPrompt);

fs.writeFileSync('server.ts', code);
console.log("Patched server.ts with AI Virtual Simulation Loop");
