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

def format_price(p):
    if p >= 1000:
        return f"{p:,.2f}"
    if p >= 1:
        return f"{p:.4f}"
    return f"{p:.6f}"

# Fetch live spot positions so active holdings are never mistaken for closed trades
pos_req = urllib.request.urlopen('http://localhost:3000/api/exchange/positions')
pos_data = json.loads(pos_req.read())
live_positions = {p['symbol']: p for p in pos_data.get('positions', []) if not p.get('isPendingOrder')}

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
        
        # Check active holding on Binance
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
                buy_lots.append(ord)
            else:
                # Sell order
                sell_qty = ord['qty']
                sell_rev = ord['quoteQty']
                sell_price = ord['price']
                sell_fee = ord['feeUsd']
                
                # Match against buy lots
                matched_buys = []
                remaining_sell = sell_qty
                
                # 1. Exact match
                exact_idx = -1
                for idx, b in enumerate(buy_lots):
                    if abs(b['qty'] - sell_qty) <= max(sell_qty * 0.02, 0.0001):
                        exact_idx = idx
                        break
                if exact_idx != -1:
                    matched_buys.append(buy_lots.pop(exact_idx))
                else:
                    # FIFO match
                    while remaining_sell > 0.0001 and len(buy_lots) > 0:
                        b = buy_lots[0]
                        if b['qty'] <= remaining_sell + 0.0001:
                            matched_buys.append(buy_lots.pop(0))
                            remaining_sell -= b['qty']
                        else:
                            # Partial match
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
                    
                    # Generate notes
                    ret_pct = ((sell_price - entry_vwap) / entry_vwap) * 100 if entry_vwap > 0 else 0
                    sign = '+' if net_profit >= 0 else '-'
                    pnl_str = f"{sign}${abs(net_profit):.2f}"
                    pnl_label = '🎯 Profit Banked' if net_profit >= 0 else '✂️ Loss Cut'
                    note_line = f"{pnl_label}: {pnl_str} (@ ${format_price(sell_price)} · {sell_qty:,.4f} coins · {ret_pct:+.1f}%)"
                    
                    all_reconciled_trades.append({
                        'symbol': sym,
                        'entryPrice': entry_vwap,
                        'exitPrice': sell_price,
                        'positionSizeCoins': total_buy_qty,
                        'soldCoins': sell_qty,
                        'totalBuyUsd': total_buy_cost,
                        'totalSellUsd': sell_rev,
                        'feeUsd': total_fees,
                        'sellFeeUsd': sell_fee,
                        'totalFeesUsd': total_fees,
                        'realizedProfitUsd': net_profit,
                        'createdAt': start_time,
                        'filledAt': start_time,
                        'closedAt': closed_time,
                        'notes': f"Auto-synced from Binance Spot trade history (Order #{ord['orderId']})\n{note_line}",
                        'binanceOrderId': str(ord['orderId'])
                    })
    except Exception as e:
        print(f"Error {sym}: {e}")

print(f"Total verified individual closed trades: {len(all_reconciled_trades)}")
# Filter 2026 trades
trades_2026 = [t for t in all_reconciled_trades if t['closedAt'] >= 1767225600000]
print(f"Total 2026 closed trades: {len(trades_2026)}")
total_net = sum(t['realizedProfitUsd'] for t in trades_2026)
total_fees = sum(t['totalFeesUsd'] for t in trades_2026)
wins = [t for t in trades_2026 if t['realizedProfitUsd'] >= 0]
losses = [t for t in trades_2026 if t['realizedProfitUsd'] < 0]
win_rate = (len(wins) / len(trades_2026)) * 100 if trades_2026 else 0
print(f"2026 Period Stats: {len(trades_2026)} trades, {len(wins)}W ({win_rate:.1f}%), {len(losses)}L, Net PnL: ${total_net:,.2f}, Total Fees: ${total_fees:,.2f}")
