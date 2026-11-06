import urllib.request
import json

for sym in ['ARBUSDT', 'SOLUSDT']:
    url = f'http://localhost:3000/api/exchange/myTrades?symbol={sym}'
    req = urllib.request.urlopen(url)
    fills = json.loads(req.read()).get('trades', [])
    sorted_fills = sorted(fills, key=lambda x: x['time'])
    
    print(f"=== {sym} Fills ({len(sorted_fills)}) ===")
    running_qty = 0.0
    for f in sorted_fills:
        qty = float(f['qty'])
        price = float(f['price'])
        quote = float(f.get('quoteQty') or (qty * price))
        comm = float(f.get('commission') or 0)
        asset = f.get('commissionAsset')
        side = 'BUY' if f['isBuyer'] else 'SELL'
        if f['isBuyer']:
            running_qty += qty
        else:
            running_qty = max(0.0, running_qty - qty)
        print(f"{f['time']} | {side} {qty:.4f} @ {price:.4f} (quote: ${quote:.2f}, fee: {comm} {asset}) | balance: {running_qty:.4f} | OrderId: {f['orderId']}")
