async function main() {
  const res = await fetch('http://localhost:3000/api/debug/trades');
  const { trades } = await res.json();

  const fmtTime = (ms) => {
    if (!ms) return '';
    const d = new Date(ms);
    if (isNaN(d.getTime())) return '';
    return ' · ' + d.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
  };

  const fmtPrice = (p) => {
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    if (p >= 1) return Number(p.toFixed(4)).toString();
    return Number(p.toFixed(6)).toString();
  };

  const fmtQty = (q) => Number(q.toFixed(4)).toLocaleString('en-US', { maximumFractionDigits: 4 });

  const updates = [
    {
      id: 'binance_holding_SOLUSDT',
      data: {
        notes: [
          'Bought 1.401 SOL for $149.91 @ $107.00 · Oct 8, 5:21 PM',
          'Bought 1.456 SOL for $149.97 @ $103.00 · Oct 13, 12:51 AM',
          'Bought 1.02 SOL for $109.80 @ $107.65 · Oct 21, 8:52 AM'
        ].join('\n'),
        entryPrice: 105.67,
        totalBuyUsd: 408.16,
        positionSize: 408.16
      }
    },
    {
      id: 'binance_holding_ETHUSDT',
      data: {
        notes: [
          'Bought 0.0588 ETH for $149.94 @ $2,550.00 · Oct 7, 5:40 PM',
          'Bought 0.0293 ETH for $74.40 @ $2,539.35 · Oct 11, 5:09 PM',
          'Bought 0.0429 ETH for $99.87 @ $2,328.00 · Oct 15, 2:28 AM',
          'Bought 0.0568 ETH for $139.16 @ $2,450.00 · Oct 21, 4:28 AM'
        ].join('\n'),
        entryPrice: 2467.35,
        totalBuyUsd: 463.05,
        positionSize: 463.05
      }
    },
    {
      id: 'binance_limit_67540887156',
      data: {
        notes: [
          'Bought 0.00134 BTC for $109.88 @ $82,000.00 · Oct 8, 12:50 PM',
          'Bought 0.00112 BTC for $89.60 @ $80,000.00 · Oct 15, 1:53 PM',
          'Bought 0.00119 BTC for $99.50 @ $83,612.01 · Oct 21, 6:42 AM'
        ].join('\n'),
        entryPrice: 81911.50,
        totalBuyUsd: 298.88,
        positionSize: 298.88
      }
    },
    {
      id: 'uP9gGqYfz9BjXRdUKWGe',
      data: {
        notes: [
          'Bought 2,040.8 ZKP for $100.00 @ $0.0490 · Oct 11, 9:15 AM',
          'Bought 638.2 ZKP for $30.00 @ $0.0470 · Oct 12, 9:47 PM',
          'Bought 626.3 ZKP for $30.00 @ $0.0479 · Oct 13, 5:48 AM',
          'Bought 215.9 ZKP for $10.00 @ $0.0463 · Oct 14, 10:40 AM',
          'Bought 1,165.5 ZKP for $50.00 @ $0.0429 · Oct 21, 6:38 AM'
        ].join('\n'),
        entryPrice: 0.04694,
        totalBuyUsd: 219.79,
        positionSize: 219.79
      }
    },
    {
      id: 'binance_limit_5872190099',
      data: {
        notes: [
          'Bought 4 AVAX for $40.00 @ $10.00 · Oct 8, 3:23 PM',
          'Bought 5.72 AVAX for $54.91 @ $9.60 · Oct 15, 2:23 AM',
          'Bought 6.13 AVAX for $59.90 @ $9.772 · Oct 21, 8:50 AM'
        ].join('\n'),
        entryPrice: 9.7675,
        totalBuyUsd: 154.76,
        positionSize: 154.76
      }
    },
    {
      id: 'binance_holding_SUPERUSDT',
      data: {
        notes: 'Bought 563 SUPER for $112.60 @ $0.2000 · Oct 21, 2:34 AM',
        entryPrice: 0.20,
        totalBuyUsd: 112.49,
        positionSize: 112.49
      }
    },
    {
      id: 'binance_limit_18010848990',
      data: {
        entryPrice: 97,
        positionSizeCoins: 1.134,
        totalBuyUsd: 110.00,
        positionSize: 110.00,
        notes: 'Limit BUY order on Binance (#18010848990)'
      }
    },
    {
      id: 'binance_limit_67613804398',
      data: {
        entryPrice: 75000,
        positionSizeCoins: 0.0012,
        totalBuyUsd: 90.00,
        positionSize: 90.00,
        notes: 'Limit BUY order on Binance (#67613804398)'
      }
    },
    {
      id: 'jKre2js4wdE90ILNRZE5',
      data: {
        notes: [
          'Bought 3,522.4 ARB for $405.08 @ $0.1150 · Oct 10, 6:12 PM',
          'Sold 880.6 ARB for $103.91 @ $0.1180 · Oct 11, 9:15 AM (Profit Banked: +$2.54)',
          'Sold 880.6 ARB for $104.79 @ $0.1190 · Oct 11, 2:40 PM (Profit Banked: +$3.42)',
          'Sold 880.6 ARB for $105.67 @ $0.1200 · Oct 12, 11:05 AM (Profit Banked: +$4.30)',
          'Sold 880.6 ARB for $107.43 @ $0.1220 · Oct 12, 4:18 PM (Profit Banked: +$6.06)'
        ].join('\n')
      }
    }
  ];

  const updatedIds = new Set(updates.map(u => u.id));
  for (const t of trades) {
    if (updatedIds.has(t.id)) continue;
    const status = t.status || '';
    const notes = t.notes || '';
    if (['CLOSED_TP', 'CLOSED_SL', 'CLOSED_MANUAL', 'HIT_SL'].includes(status) && !notes.includes('Bought ')) {
      const sym = (t.symbol || '').replace(/USDT|USDC|FDUSD/g, '');
      const ep = Number(t.entryPrice || 0);
      const xp = Number(t.exitPrice || t.stopLoss || 0);
      const qty = Number(t.positionSizeCoins || t.soldCoins || 0);
      const buyUsd = Number(t.totalBuyUsd || (qty * ep));
      const sellUsd = Number(t.totalSellUsd || (qty * xp));
      const pnl = t.realizedProfitUsd !== undefined && t.realizedProfitUsd !== null ? Number(t.realizedProfitUsd) : (sellUsd - buyUsd);
      const bTime = fmtTime(t.filledAt || t.createdAt);
      const sTime = fmtTime(t.closedAt || t.createdAt);
      if (qty > 0 && ep > 0 && xp > 0) {
        const buyLine = `Bought ${fmtQty(qty)} ${sym} for $${buyUsd.toFixed(2)} @ $${fmtPrice(ep)}${bTime}`;
        const lbl = pnl >= 0 ? 'Profit Banked' : 'Loss Cut';
        const sgn = pnl >= 0 ? '+' : '-';
        const sellLine = `Sold ${fmtQty(qty)} ${sym} for $${sellUsd.toFixed(2)} @ $${fmtPrice(xp)}${sTime} (${lbl}: ${sgn}$${Math.abs(pnl).toFixed(2)})`;
        updates.push({
          id: t.id,
          data: {
            notes: `${buyLine}\n${sellLine}`
          }
        });
      }
    }
  }

  const updateRes = await fetch('http://localhost:3000/api/maintenance/update-trade-docs', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates })
  });
  console.log('Update response:', await updateRes.json());
}

main().catch(console.error);
