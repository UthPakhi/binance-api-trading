import urllib.request
import json
import time

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

def format_price(p):
    if p >= 1000:
        return f"{p:,.2f}"
    if p >= 1:
        return f"{p:.4f}"
    return f"{p:.6f}"

# 1. Fetch live spot positions so active holdings are never mistaken for closed trades
pos_req = urllib.request.urlopen('http://localhost:3000/api/exchange/positions')
pos_data = json.loads(pos_req.read())
live_positions = {p['symbol']: p for p in pos_data.get('positions', []) if not p.get('isPendingOrder')}

# 2. Fetch existing Firestore trades
fs_req = urllib.request.urlopen('http://localhost:3000/api/debug/trades')
fs_trades = json.loads(fs_req.read()).get('trades', [])
fs_trade_map = {t['id']: t for t in fs_trades if t.get('id')}

all_reconciled_trades = []

for sym in symbols:
    try:
        url = f'http://localhost:3000/api/exchange/myTrades?symbol={sym}'
        req = urllib.request.urlopen(url)
        data = json.loads(req.read())
        fills = data.get('trades', [])
        if not fills:
            continue
        
        sorted_fills = sorted(fills, key=lambda x: x['time'])
        
        clean_base = sym.replace('USDT', '').replace('USDC', '').replace('FDUSD', '')
        active_pos = live_positions.get(sym) or live_positions.get(clean_base)
        active_holding_qty = float(active_pos.get('positionAmt', 0)) if active_pos else 0.0
        
        # Group fills by orderId
        order_groups = []
        cur_order = None
        for f in sorted_fills:
            qty = float(f['qty'])
            price = float(f['price'])
            quote_qty = float(f.get('quoteQty') or (qty * price))
            comm = float(f.get('commission') or 0)
            comm_asset = f.get('commissionAsset', 'USDT')
            fee_usd = calc_fee_usd(comm, comm_asset, price, bnb_price)
            is_buyer = f['isBuyer']
            
            if cur_order and cur_order['orderId'] == f['orderId']:
                cur_order['qty'] += qty
                cur_order['quoteQty'] += quote_qty
                cur_order['feeUsd'] += fee_usd
                cur_order['time'] = max(cur_order['time'], f['time'])
                cur_order['fills'].append(f)
            else:
                if cur_order:
                    cur_order['price'] = cur_order['quoteQty'] / cur_order['qty']
                    order_groups.append(cur_order)
                cur_order = {
                    'orderId': f['orderId'],
                    'symbol': sym,
                    'isBuyer': is_buyer,
                    'qty': qty,
                    'quoteQty': quote_qty,
                    'price': price,
                    'feeUsd': fee_usd,
                    'time': f['time'],
                    'fills': [f]
                }
        if cur_order:
            cur_order['price'] = cur_order['quoteQty'] / cur_order['qty']
            order_groups.append(cur_order)
            
        # Reconcile orders into trade cycles
        buy_lots = []
        for ord in order_groups:
            if ord['isBuyer']:
                buy_lots.append(dict(ord))
            else:
                sell_qty = ord['qty']
                sell_rev = ord['quoteQty']
                sell_price = ord['price']
                sell_fee = ord['feeUsd']
                
                matched_buys = []
                remaining_sell = sell_qty
                
                # Exact or near-exact match first
                exact_idx = -1
                for idx, b in enumerate(buy_lots):
                    if abs(b['qty'] - sell_qty) <= max(sell_qty * 0.02, 0.0001):
                        exact_idx = idx
                        break
                if exact_idx != -1:
                    matched_buys.append(buy_lots.pop(exact_idx))
                else:
                    while remaining_sell > 0.0001 and len(buy_lots) > 0:
                        b = buy_lots[0]
                        if b['qty'] <= remaining_sell + 0.0001:
                            matched_buys.append(buy_lots.pop(0))
                            remaining_sell -= b['qty']
                        else:
                            portion = remaining_sell / b['qty']
                            matched_buys.append({
                                'orderId': b['orderId'],
                                'qty': remaining_sell,
                                'quoteQty': b['quoteQty'] * portion,
                                'price': b['price'],
                                'feeUsd': b['feeUsd'] * portion,
                                'time': b['time'],
                                'isBuyer': True
                            })
                            b['qty'] -= remaining_sell
                            b['quoteQty'] -= (b['quoteQty'] * portion)
                            b['feeUsd'] -= (b['feeUsd'] * portion)
                            remaining_sell = 0
                            break
                            
                if matched_buys:
                    total_buy_cost = sum(b['quoteQty'] for b in matched_buys)
                    total_buy_qty = sum(b['qty'] for b in matched_buys)
                    entry_vwap = total_buy_cost / total_buy_qty if total_buy_qty > 0 else sell_price
                    total_fees = sell_fee
                    net_profit = sell_rev - total_fees - total_buy_cost
                    start_time = min(b['time'] for b in matched_buys)
                    closed_time = ord['time']
                    
                    from datetime import datetime
                    def fmt_time(ms):
                        dt = datetime.fromtimestamp(ms / 1000.0)
                        return dt.strftime('%b %-d, %-I:%M %p')
                    def fmt_qty(q):
                        return f"{q:,.4f}".rstrip('0').rstrip('.') if '.' in f"{q:,.4f}" else f"{q:,.4f}"

                    buy_lines = []
                    for b in matched_buys:
                        b_qty_s = fmt_qty(b['qty'])
                        buy_lines.append(f"Bought {b_qty_s} {clean_base} for ${b['quoteQty']:.2f} @ ${format_price(b['price'])} · {fmt_time(b['time'])}")
                    
                    sign = '+' if net_profit >= 0 else '-'
                    pnl_str = f"{sign}${abs(net_profit):.2f}"
                    pnl_label = 'Profit Banked' if net_profit >= 0 else 'Loss Cut'
                    s_qty_s = fmt_qty(sell_qty)
                    sell_line = f"Sold {s_qty_s} {clean_base} for ${sell_rev:.2f} @ ${format_price(sell_price)} · {fmt_time(closed_time)} ({pnl_label}: {pnl_str})"
                    
                    full_notes = "\n".join(buy_lines + [sell_line])
                    
                    all_reconciled_trades.append({
                        'symbol': sym,
                        'entryPrice': round(entry_vwap, 8),
                        'exitPrice': round(sell_price, 8),
                        'positionSizeCoins': round(total_buy_qty, 6),
                        'soldCoins': round(sell_qty, 6),
                        'totalBuyUsd': round(total_buy_cost, 4),
                        'totalSellUsd': round(sell_rev, 4),
                        'feeUsd': round(total_fees, 6),
                        'sellFeeUsd': round(sell_fee, 6),
                        'totalFeesUsd': round(total_fees, 6),
                        'realizedProfitUsd': round(net_profit, 4),
                        'createdAt': start_time,
                        'filledAt': start_time,
                        'closedAt': closed_time,
                        'notes': full_notes,
                        'binanceOrderId': str(ord['orderId'])
                    })
    except Exception as e:
        print(f"Error {sym}: {e}")

# Only update 2026 trades
verified_2026 = [t for t in all_reconciled_trades if t['closedAt'] >= 1767225600000]
print(f"Total verified 2026 trades to sync: {len(verified_2026)}")

# Special case for consolidated ARB trade
# We already set jKre2js4wdE90ILNRZE5 with exact 4 executions!
arb_trade = next((t for t in fs_trades if t.get('id') == 'jKre2js4wdE90ILNRZE5'), None)

payload = {
    'verifiedTrades': verified_2026
}

post_req = urllib.request.Request(
    'http://localhost:3000/api/maintenance/sync-all-closed-trades',
    data=json.dumps(payload).encode('utf-8'),
    headers={'Content-Type': 'application/json'}
)

try:
    res = urllib.request.urlopen(post_req)
    result = json.loads(res.read())
    print("Sync Result:", json.dumps(result, indent=2))
except Exception as e:
    print("Sync Error:", e)
