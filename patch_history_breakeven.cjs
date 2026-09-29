const fs = require('fs');
let code = fs.readFileSync('src/components/History.tsx', 'utf-8');

// statusLabels
code = code.replace(
  "CLOSED_MANUAL: 'CLOSED'",
  "CLOSED_MANUAL: 'CLOSED',\n            BREAK_EVEN: 'BREAK EVEN'"
);

// statusColors
code = code.replace(
  "CLOSED_MANUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30'",
  "CLOSED_MANUAL: 'bg-blue-500/20 text-blue-400 border-blue-500/30',\n            BREAK_EVEN: 'bg-neutral-500/20 text-neutral-300 border-neutral-500/30'"
);

// Realized PnL visibility logic
code = code.replace(
  "{tStatus !== 'ACTIVE' && tStatus !== 'PENDING' ? (",
  "{tStatus !== 'ACTIVE' && tStatus !== 'PENDING' ? ("
);

// closedAt date logic
code = code.replace(
  "{trade.closedAt && ['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL'].includes(tStatus) && (",
  "{trade.closedAt && ['HIT_SL', 'HIT_TP1', 'HIT_TP2', 'HIT_TP3', 'CLOSED_MANUAL', 'BREAK_EVEN'].includes(tStatus) && ("
);

// Live PnL hide logic
code = code.replace(
  "{tStatus !== 'CLOSED_MANUAL' && tStatus !== 'HIT_SL' && tStatus !== 'HIT_TP3' && livePrices[trade.symbol] && (",
  "{tStatus !== 'CLOSED_MANUAL' && tStatus !== 'BREAK_EVEN' && tStatus !== 'HIT_SL' && tStatus !== 'HIT_TP3' && livePrices[trade.symbol] && ("
);

fs.writeFileSync('src/components/History.tsx', code);
