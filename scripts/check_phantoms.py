import urllib.request
import json

req = urllib.request.urlopen('http://localhost:3000/api/debug/trades')
firestore_trades = json.loads(req.read()).get('trades', [])

print(f"Total Firestore trades: {len(firestore_trades)}")
closed_in_fs = [t for t in firestore_trades if t.get('status') in ['CLOSED_MANUAL', 'CLOSED'] or t.get('closedAt')]
print(f"Closed Firestore trades: {len(closed_in_fs)}")

# Check for phantom trades (cancelled limit orders or unexecuted)
phantoms = []
for t in closed_in_fs:
    sym = (t.get('symbol') or '').upper()
    notes = str(t.get('notes') or '')
    tid = str(t.get('id') or '')
    coins = float(t.get('positionSizeCoins') or 0)
    sold = float(t.get('soldCoins') or 0)
    pnl = t.get('realizedProfitUsd')
    sell_usd = float(t.get('totalSellUsd') or 0)
    
    if 'Canceled' in notes or 'Cancelled' in notes or 'CANCELED' in str(t.get('status')):
        phantoms.append((tid, sym, 'Canceled in notes'))
    elif tid.startswith('binance_limit_') and (pnl is None or pnl == 0) and sell_usd == 0:
        phantoms.append((tid, sym, 'Unexecuted limit order doc'))
    elif 'HYPE' in sym or 'ETHUSDC' in sym:
        phantoms.append((tid, sym, 'Disallowed phantom symbol'))

print(f"Found {len(phantoms)} phantom/cancelled trades in Firestore:")
for p in phantoms:
    print(f"  ID: {p[0]} | Symbol: {p[1]} | Reason: {p[2]}")
