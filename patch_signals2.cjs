const fs = require('fs');
let code = fs.readFileSync('src/components/AiSignals.tsx', 'utf-8');

// Define formatCurrency locally inside AiSignals since it doesn't exist in utils
code = code.replace(
  "export function AiSignals({ onLoadSignal }: AiSignalsProps) {",
  `const formatCurrency = (val: number) => new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(val);\n\nexport function AiSignals({ onLoadSignal }: AiSignalsProps) {`
);

fs.writeFileSync('src/components/AiSignals.tsx', code);
