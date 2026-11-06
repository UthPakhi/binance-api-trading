import urllib.request
import json
import os

symbols = [
    '0GUSDT', 'ADAUSDT', 'ALLOUSDT', 'ARBUSDT', 'AXLUSDT', 'BNBUSDT', 'BTCUSDT', 
    'CETUSUSDT', 'CFGUSDT', 'CFXUSDT', 'CHIPUSDT', 'CTSIUSDT', 'DIAUSDT', 'DUSKUSDT', 'ETHUSDT', 
    'FETUSDT', 'FILUSDT', 'FLOKIUSDT', 'FLOWUSDT', 'HOMEUSDT', 'IBMBUSDT', 
    'INITUSDT', 'JTOUSDT', 'LTCUSDT', 'MEGAUSDT', 'MMTUSDT', 'NIGHTUSDT', 'NILUSDT', 'NOMUSDT', 
    'ONDOUSDT', 'OPNUSDT', 'ORCAUSDT', 'PLUMEUSDT', 'PUMPUSDT', 'SAGAUSDT', 'SCRUSDT', 'SHELLUSDT', 
    'SOLUSDT', 'STGUSDT', 'SUIUSDT', 'SYRUPUSDT', 'TAOUSDT', 'TUTUSDT', 'ZECUSDT'
]

bnb_price = 600.0

def calc_fee_usd(comm, asset, price, bnb_p):
    if not comm or comm <= 0:
        return 0.0
    if asset in ['USDT', 'USDC', 'FDUSD', 'BUSD']:
        return comm
    if asset == 'BNB':
        return comm * bnb_p
    return comm * price

# Fetch current Firestore trades
req = urllib.request.urlopen('http://localhost:3000/api/debug/trades')
firestore_trades = json.loads(req.read()).get('trades', [])
print(f"Total trades currently in Firestore: {len(firestore_trades)}")

reconstructed_trades = []

for sym in symbols:
    try:
        url = f'http://localhost:3000/api/exchange/myTrades?symbol={sym}'
        req = urllib.request.urlopen(url)
        data = json.loads(req.read())
        fills = data.get('trades', [])
        if not fills:
            continue
        
        sorted_fills = sorted(fills, key=lambda x: x['time'])
        
        current_buys = []
        current_sells = []
        running_qty = 0.0
        
        for f in sorted_fills:
            qty = float(f['qty'])
            price = float(f['price'])
            quote_qty = float(f.get('quoteQty') or (qty * price))
            comm = float(f.get('commission') or 0)
            comm_asset = f.get('commissionAsset', 'USDT')
            fee_usd = calc_fee_usd(comm, comm_asset, price, bnb_price)
            is_buyer = f['isBuyer']
            
            fill_obj = {
                'id': f['id'],
                'orderId': f['orderId'],
                'qty': qty,
                'price': price,
                'quoteQty': quote_qty,
                'comm': comm,
                'commAsset': comm_asset,
                'feeUsd': fee_usd,
                'time': f['time'],
                'isBuyer': is_buyer
            }
            
            if is_buyer:
                if running_qty <= 0.0001 and len(current_sells) > 0 and len(current_buys) > 0:
                    reconstructed_trades.append((sym, current_buys, current_sells))
                    current_buys = []
                    current_sells = []
                current_buys.append(fill_obj)
                running_qty += qty
            else:
                current_sells.append(fill_obj)
                running_qty = max(0.0, running_qty - qty)
                if running_qty <= 0.0001 and len(current_buys) > 0:
                    reconstructed_trades.append((sym, current_buys, current_sells))
                    current_buys = []
                    current_sells = []
                    
        if len(current_buys) > 0 and len(current_sells) > 0:
            reconstructed_trades.append((sym, current_buys, current_sells))
    except Exception as e:
        print(f"Error processing {sym}: {e}")

print(f"Total reconstructed closed trade cycles: {len(reconstructed_trades)}")
for sym, buys, sells in reconstructed_trades:
    if not buys or not sells:
        continue
    buy_cost = sum(b['quoteQty'] for b in buys)
    buy_qty = sum(b['qty'] for b in buys)
    sell_rev = sum(s['quoteQty'] for s in sells)
    sell_qty = sum(s['qty'] for s in sells)
    sell_fees = sum(s['feeUsd'] for s in sells)
    net_pnl = sell_rev - sell_fees - buy_cost
    vwap_entry = buy_cost / buy_qty if buy_qty > 0 else 0
    vwap_exit = sell_rev / sell_qty if sell_qty > 0 else 0
    start_time = min(b['time'] for b in buys)
    end_time = max(s['time'] for s in sells)
    # Only report trades from 2026 onwards (time >= 1767225600000)
    if end_time >= 1767225600000:
        print(f"[{sym}] 2026 Trade: Entry ${vwap_entry:.5f} -> Exit ${vwap_exit:.5f} | Coins: {sell_qty:.4f} | Spent: ${buy_cost:.2f} | Rev: ${sell_rev:.2f} | Fees: ${sell_fees:.4f} | Net: ${net_pnl:.2f} | EndTime: {end_time}")
