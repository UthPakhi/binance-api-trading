const fs = require('fs');
let code = fs.readFileSync('src/components/ImportTradeModal.tsx', 'utf-8');

const titleOld = `Import Active Position`;
const titleNew = `Import Spot Holdings`;
code = code.replace(titleOld, titleNew);

const noFutOld = `No active USD-M Futures positions found.`;
const noFutNew = `No Spot holdings found (value > $5).`;
code = code.replace(noFutOld, noFutNew);

const fetchMsgOld = `Fetching live positions from Binance...`;
const fetchMsgNew = `Scanning Spot Wallet & recent trades...`;
code = code.replace(fetchMsgOld, fetchMsgNew);

const badgeOld = `<span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">{p.leverage}x</span>`;
const badgeNew = `<span className="text-[10px] bg-neutral-800 text-neutral-400 px-1.5 py-0.5 rounded">SPOT</span>`;
code = code.replace(badgeOld, badgeNew);

fs.writeFileSync('src/components/ImportTradeModal.tsx', code);
