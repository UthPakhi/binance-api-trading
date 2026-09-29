const fs = require('fs');
let code = fs.readFileSync('src/components/EditTradeModal.tsx', 'utf-8');

// Add to dropdown
code = code.replace(
  '<option value="CLOSED_MANUAL">Closed Manually</option>',
  '<option value="CLOSED_MANUAL">Closed Manually</option>\n                <option value="BREAK_EVEN">Closed at Break Even</option>'
);

// handleStatusChange logic
code = code.replace(
  "else if (newStatus === 'ACTIVE') setRealizedProfit('0');",
  "else if (newStatus === 'ACTIVE') setRealizedProfit('0');\n    else if (newStatus === 'BREAK_EVEN') setRealizedProfit('0');"
);

// Hide Realized PnL input if BREAK_EVEN
code = code.replace(
  "{status !== 'ACTIVE' && (",
  "{status !== 'ACTIVE' && status !== 'PENDING' && status !== 'BREAK_EVEN' && ("
);

fs.writeFileSync('src/components/EditTradeModal.tsx', code);
