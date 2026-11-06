import urllib.request
import json

req = urllib.request.urlopen('http://localhost:3000/api/debug/trades')
firestore_trades = json.loads(req.read()).get('trades', [])

closed_in_fs = [t for t in firestore_trades if t.get('status') in ['CLOSED_MANUAL', 'CLOSED'] or t.get('closedAt')]

# Load dry run verified trades
with open('/app/applet/scripts/reconcile_dry_run.py') as f:
    pass

import sys
sys.path.append('/app/applet/scripts')

discrepancies = []
for t in closed_in_fs:
    tid = t.get('id')
    sym = t.get('symbol')
    pnl = t.get('realizedProfitUsd')
    fee = t.get('feeUsd')
    tot_fee = t.get('totalFeesUsd')
    buy_usd = t.get('totalBuyUsd')
    sell_usd = t.get('totalSellUsd')
    notes = str(t.get('notes') or '')
    
    # Check if mathematical consistency is violated:
    # If both buy_usd and sell_usd exist, does pnl roughly equal sell_usd - fee - buy_usd?
    if buy_usd and sell_usd and pnl is not None:
        effective_fee = tot_fee if (tot_fee is not None and tot_fee > 0) else (fee or 0)
        expected_pnl = sell_usd - effective_fee - buy_usd
        diff = abs(pnl - expected_pnl)
        if diff > 0.05 and abs(pnl) > 0.01:
            discrepancies.append({
                'id': tid,
                'symbol': sym,
                'current_pnl': pnl,
                'expected_pnl': expected_pnl,
                'diff': diff,
                'buy_usd': buy_usd,
                'sell_usd': sell_usd,
                'fee': effective_fee,
                'notes': notes[:100]
            })

print(f"Total closed trades checked: {len(closed_in_fs)}")
print(f"Mathematical discrepancies found: {len(discrepancies)}")
for d in discrepancies[:20]:
    print(f"[{d['symbol']}] ID: {d['id']} | Current PnL: ${d['current_pnl']:.2f} vs Math Expected: ${d['expected_pnl']:.2f} (diff ${d['diff']:.2f}) | Buy: ${d['buy_usd']:.2f}, Sell: ${d['sell_usd']:.2f}, Fee: ${d['fee']:.4f}")
