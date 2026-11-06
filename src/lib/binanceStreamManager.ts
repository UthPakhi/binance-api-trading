import crypto from 'crypto';
import {
  ExecutionEvent,
  generateStrictIdempotencyKey,
  generateEventFingerprint,
  classifyFeeCurrencyMode,
  round8
} from './executionLedger';

export interface StreamOpenOrder {
  symbol: string;
  orderId: string;
  clientOrderId: string;
  side: 'BUY' | 'SELL';
  type: string;
  status: string;
  price: number;
  stopPrice: number;
  origQty: number;
  executedQty: number;
  cummulativeQuoteQty: number;
  time: number;
  updateTime: number;
}

export interface StreamAssetBalance {
  asset: string;
  free: number;
  locked: number;
  updatedAt: number;
}

export type BinanceStreamEvent = 
  | { type: 'CONNECTED'; timestamp: number; mode?: 'LISTEN_KEY' | 'WS_API_TOKEN' }
  | { type: 'DISCONNECTED'; timestamp: number }
  | { type: 'HEARTBEAT'; timestamp: number }
  | { 
      type: 'EXECUTION_REPORT'; 
      idempotencyKey: string;
      symbol: string; 
      side: 'BUY' | 'SELL'; 
      orderType: string; 
      executionType: string;
      orderStatus: string; 
      orderId: string | number; 
      tradeId: string | number;
      clientOrderId?: string;
      origClientOrderId?: string;
      orderPrice: number;
      stopPrice: number;
      origQty: number;
      lastExecutedPrice: number; 
      lastExecutedQty: number; 
      lastQuoteQty: number;
      cumulativeFilledQty: number; 
      cumulativeQuoteQty: number;
      commissionAmount: number;
      commissionAsset?: string;
      transactionTime: number;
      orderCreationTime: number;
      isBuyerMaker: boolean;
    }
  | { 
      type: 'BALANCE_UPDATE'; 
      asset: string; 
      balanceDelta: number; 
      clearTime: number;
    }
  | { 
      type: 'OUTBOUND_ACCOUNT_POSITION'; 
      lastAccountUpdateTime: number; 
      balances: Array<{ asset: string; free: number; locked: number }>;
    };

export class BinanceStreamManager {
  private apiKey: string;
  private apiSecret: string;
  private ws: WebSocket | null = null;
  private currentListenKey: string | null = null;
  private currentListenToken: string | null = null;
  private connectionMode: 'LISTEN_KEY' | 'WS_API_TOKEN' | 'DISCONNECTED' = 'DISCONNECTED';
  private keepAliveTimer: NodeJS.Timeout | null = null;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private pingTimer: NodeJS.Timeout | null = null;
  private reconnectAttempts = 0;
  private isDestroyed = false;
  private isConnectedState = false;
  private lastEventTimestamp = 0;
  private listeners: Set<(event: BinanceStreamEvent) => void> = new Set();

  // Authoritative In-Memory State hydrated by WebSocket User Data Stream
  private balancesState = new Map<string, StreamAssetBalance>();
  private openOrdersState = new Map<string, StreamOpenOrder>();
  private executionLedgerState = new Map<string, ExecutionEvent>();

  constructor(
    apiKeyOrConfig: string | { apiKey: string; apiSecret: string },
    apiSecret?: string
  ) {
    if (typeof apiKeyOrConfig === 'object' && apiKeyOrConfig !== null) {
      this.apiKey = apiKeyOrConfig.apiKey || '';
      this.apiSecret = apiKeyOrConfig.apiSecret || '';
    } else {
      this.apiKey = typeof apiKeyOrConfig === 'string' ? apiKeyOrConfig : '';
      this.apiSecret = apiSecret || '';
    }
  }

  public onEvent(callback: (event: BinanceStreamEvent) => void): () => void {
    this.listeners.add(callback);
    return () => this.listeners.delete(callback);
  }

  private emit(event: BinanceStreamEvent) {
    this.lastEventTimestamp = Date.now();
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch (err) {
        console.error('[BinanceStreamManager] Listener error:', err);
      }
    }
  }

  public isConnected(): boolean {
    return this.isConnectedState && this.ws !== null && this.ws.readyState === WebSocket.OPEN;
  }

  public getStatus() {
    return {
      isConnected: this.isConnected(),
      mode: this.connectionMode,
      listenKeyActive: Boolean(this.currentListenKey || this.currentListenToken),
      lastEventTimestamp: this.lastEventTimestamp,
      trackedBalancesCount: this.balancesState.size,
      trackedOpenOrdersCount: this.openOrdersState.size,
      trackedExecutionsCount: this.executionLedgerState.size,
      reconnectAttempts: this.reconnectAttempts
    };
  }

  public getBalances(): Map<string, StreamAssetBalance> {
    return this.balancesState;
  }

  public getBalancesSnapshot(): StreamAssetBalance[] {
    return Array.from(this.balancesState.values());
  }

  public getAssetBalance(asset: string): StreamAssetBalance | undefined {
    return this.balancesState.get(asset.toUpperCase().trim());
  }

  public getOpenOrders(symbol?: string): StreamOpenOrder[] {
    return this.getOpenOrdersSnapshot(symbol);
  }

  public getOpenOrdersSnapshot(symbol?: string): StreamOpenOrder[] {
    const all = Array.from(this.openOrdersState.values());
    if (!symbol) return all;
    const cleanSym = symbol.toUpperCase().trim();
    return all.filter(o => o.symbol.toUpperCase() === cleanSym);
  }

  public getLedgerEvents(symbol?: string): ExecutionEvent[] {
    return this.getExecutionEvents(symbol);
  }

  public getExecutionEvents(symbol?: string): ExecutionEvent[] {
    const all = Array.from(this.executionLedgerState.values());
    if (!symbol) return all.sort((a, b) => a.timestamp - b.timestamp);
    const cleanSym = symbol.toUpperCase().trim();
    return all.filter(e => e.symbol.toUpperCase() === cleanSym).sort((a, b) => a.timestamp - b.timestamp);
  }

  /**
   * Seeds or reconciles the in-memory state from a cold-start or periodic REST checksum validation.
   */
  public seedFromRestSnapshot(params: {
    balances?: Array<{ asset: string; free: string | number; locked: string | number }>;
    openOrders?: any[];
    fills?: any[];
    bnbPrice?: number;
  }) {
    const now = Date.now();
    if (Array.isArray(params.balances)) {
      for (const b of params.balances) {
        const asset = String(b.asset || '').toUpperCase().trim();
        if (!asset) continue;
        const free = parseFloat(String(b.free || '0'));
        const locked = parseFloat(String(b.locked || '0'));
        if (free + locked > 0 || this.balancesState.has(asset)) {
          this.balancesState.set(asset, { asset, free, locked, updatedAt: now });
        }
      }
    }

    if (Array.isArray(params.openOrders)) {
      this.openOrdersState.clear();
      for (const o of params.openOrders) {
        const orderId = String(o.orderId);
        this.openOrdersState.set(orderId, {
          symbol: String(o.symbol || '').toUpperCase(),
          orderId,
          clientOrderId: String(o.clientOrderId || ''),
          side: o.side === 'SELL' ? 'SELL' : 'BUY',
          type: String(o.type || 'LIMIT'),
          status: String(o.status || 'NEW'),
          price: parseFloat(String(o.price || '0')),
          stopPrice: parseFloat(String(o.stopPrice || '0')),
          origQty: parseFloat(String(o.origQty || '0')),
          executedQty: parseFloat(String(o.executedQty || '0')),
          cummulativeQuoteQty: parseFloat(String(o.cummulativeQuoteQty || '0')),
          time: Number(o.time || now),
          updateTime: Number(o.updateTime || o.time || now)
        });
      }
    }

    if (Array.isArray(params.fills)) {
      const bnbPrice = params.bnbPrice || 600;
      for (const f of params.fills) {
        const sym = String(f.symbol || '').toUpperCase();
        const orderId = String(f.orderId || '');
        const tradeId = String(f.id ?? f.tradeId ?? '');
        const price = parseFloat(String(f.price || '0'));
        const qty = parseFloat(String(f.qty || '0'));
        const quoteQty = parseFloat(String(f.quoteQty || (price * qty)));
        const comm = parseFloat(String(f.commission || '0'));
        const commAsset = String(f.commissionAsset || 'USDT').toUpperCase();
        const isBuyer = Boolean(f.isBuyer);
        const timestamp = Number(f.time || f.timestamp || now);

        const feeMode = classifyFeeCurrencyMode(sym, commAsset);
        let feeUsd = 0;
        if (comm > 0) {
          if (feeMode === 'QUOTE_ASSET') feeUsd = round8(comm);
          else if (feeMode === 'BNB') feeUsd = round8(comm * bnbPrice);
          else feeUsd = round8(comm * price);
        }

        const idempotencyKey = generateStrictIdempotencyKey({
          symbol: sym,
          orderId,
          tradeId,
          isBuyer,
          price,
          qty,
          timestamp
        });

        if (!this.executionLedgerState.has(idempotencyKey)) {
          this.executionLedgerState.set(idempotencyKey, {
            eventId: idempotencyKey,
            orderId,
            tradeId,
            symbol: sym,
            side: isBuyer ? 'BUY' : 'SELL',
            price: round8(price),
            qty: round8(qty),
            quoteQty: round8(quoteQty),
            feeUsd,
            commissionAmount: round8(comm),
            commissionAsset: commAsset,
            feeMode,
            feeCurrencyMode: feeMode,
            timestamp,
            isBuyer,
            fingerprint: generateEventFingerprint({ orderId, tradeId, symbol: sym, price, qty, timestamp, isBuyer }),
            idempotencyKey
          });
        }
      }
    }
  }

  public async start() {
    if (!this.apiKey || !this.apiSecret) {
      console.warn('[BinanceStreamManager] API credentials not provided, stream disabled.');
      return;
    }
    this.isDestroyed = false;
    await this.connect();
  }

  public stop() {
    this.isDestroyed = true;
    this.isConnectedState = false;
    this.connectionMode = 'DISCONNECTED';
    if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    if (this.pingTimer) clearInterval(this.pingTimer);
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
  }

  /**
   * Standard Binance Spot User Data Stream `listenKey` creation (`POST /api/v3/userDataStream`)
   */
  private async acquireListenKey(): Promise<string | null> {
    const endpoints = [
      'https://api.binance.com/api/v3/userDataStream',
      'https://api1.binance.com/api/v3/userDataStream',
      'https://api2.binance.com/api/v3/userDataStream',
      'https://api3.binance.com/api/v3/userDataStream'
    ];
    for (const url of endpoints) {
      try {
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': this.apiKey }
        });
        if (!res.ok) continue;
        const data = await res.json();
        if (data && data.listenKey) {
          this.currentListenKey = data.listenKey;
          return data.listenKey;
        }
      } catch (_) {}
    }
    return null;
  }

  /**
   * Standard Binance `listenKey` keepalive (`PUT /api/v3/userDataStream?listenKey=...` every 30m)
   */
  private async keepAliveListenKey(): Promise<boolean> {
    if (!this.currentListenKey) return false;
    try {
      const url = `https://api.binance.com/api/v3/userDataStream?listenKey=${encodeURIComponent(this.currentListenKey)}`;
      const res = await fetch(url, {
        method: 'PUT',
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  /**
   * Fallback WebSocket API `userListenToken` acquisition (`POST /sapi/v1/userListenToken`)
   */
  private async acquireListenToken(): Promise<string | null> {
    try {
      const ts = Date.now();
      const qs = `timestamp=${ts}`;
      const sig = crypto.createHmac('sha256', this.apiSecret).update(qs).digest('hex');
      const url = `https://api.binance.com/sapi/v1/userListenToken?${qs}&signature=${sig}`;

      const res = await fetch(url, {
        method: 'POST',
        headers: { 'X-MBX-APIKEY': this.apiKey }
      });

      if (!res.ok) return null;
      const data = await res.json();
      if (data && data.token) {
        this.currentListenToken = data.token;
        return data.token;
      }
      return null;
    } catch {
      return null;
    }
  }

  private async connect() {
    if (this.isDestroyed) return;

    try {
      const listenKey = await this.acquireListenKey();
      if (listenKey) {
        this.connectWithListenKey(listenKey);
        return;
      }

      const token = await this.acquireListenToken();
      if (token) {
        this.connectWithListenToken(token);
        return;
      }

      console.warn('[BinanceStreamManager] Could not acquire listenKey or listenToken, scheduling retry...');
      this.scheduleReconnect();
    } catch (err: any) {
      console.warn('[BinanceStreamManager] Connection failed:', err?.message || err);
      this.scheduleReconnect();
    }
  }

  private connectWithListenKey(listenKey: string) {
    if (this.isDestroyed) return;
    const wsUrl = `wss://stream.binance.com:9443/ws/${listenKey}`;
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.isConnectedState = true;
      this.connectionMode = 'LISTEN_KEY';
      console.log('[BinanceStreamManager] ⚡ Connected to Binance User Data Stream via listenKey (wss://stream.binance.com:9443).');
      this.emit({ type: 'CONNECTED', timestamp: Date.now(), mode: 'LISTEN_KEY' });

      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      this.keepAliveTimer = setInterval(async () => {
        const ok = await this.keepAliveListenKey();
        if (!ok && !this.isDestroyed) {
          console.warn('[BinanceStreamManager] listenKey keepalive failed, reconnecting...');
          this.reconnect();
        } else {
          this.emit({ type: 'HEARTBEAT', timestamp: Date.now() });
        }
      }, 25 * 60 * 1000);
    };

    ws.onmessage = (event) => this.handleMessage(event);
    ws.onerror = (err) => console.warn('[BinanceStreamManager] WebSocket error:', err);
    ws.onclose = () => {
      this.isConnectedState = false;
      this.connectionMode = 'DISCONNECTED';
      this.emit({ type: 'DISCONNECTED', timestamp: Date.now() });
      if (this.keepAliveTimer) clearInterval(this.keepAliveTimer);
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    };
  }

  private connectWithListenToken(token: string) {
    if (this.isDestroyed) return;
    const wsUrl = 'wss://ws-api.binance.com:443/ws-api/v3';
    const ws = new WebSocket(wsUrl);
    this.ws = ws;

    ws.onopen = () => {
      this.reconnectAttempts = 0;
      this.isConnectedState = true;
      this.connectionMode = 'WS_API_TOKEN';
      console.log('[BinanceStreamManager] Connected to ws-api.binance.com. Subscribing to user stream...');

      ws.send(JSON.stringify({
        id: `sub_${Date.now()}`,
        method: 'userDataStream.subscribe.listenToken',
        params: { listenToken: token }
      }));

      this.emit({ type: 'CONNECTED', timestamp: Date.now(), mode: 'WS_API_TOKEN' });

      if (this.pingTimer) clearInterval(this.pingTimer);
      this.pingTimer = setInterval(() => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          try {
            this.ws.send(JSON.stringify({ id: `ping_${Date.now()}`, method: 'ping' }));
            this.emit({ type: 'HEARTBEAT', timestamp: Date.now() });
          } catch (_) {}
        }
      }, 180000);
    };

    ws.onmessage = (event) => this.handleMessage(event);
    ws.onerror = (err) => console.warn('[BinanceStreamManager] WebSocket error:', err);
    ws.onclose = () => {
      this.isConnectedState = false;
      this.connectionMode = 'DISCONNECTED';
      this.emit({ type: 'DISCONNECTED', timestamp: Date.now() });
      if (this.pingTimer) clearInterval(this.pingTimer);
      if (!this.isDestroyed) {
        this.scheduleReconnect();
      }
    };
  }

  private reconnect() {
    if (this.ws) {
      try {
        this.ws.close();
      } catch (_) {}
      this.ws = null;
    }
    this.scheduleReconnect();
  }

  private handleMessage(event: MessageEvent | any) {
    try {
      const raw = typeof event.data === 'string' ? event.data : event.data.toString();
      const parsed = JSON.parse(raw);

      if (parsed.status === 200 && parsed.result?.subscriptionId !== undefined) {
        console.log('[BinanceStreamManager] User data stream active! Subscription ID:', parsed.result.subscriptionId);
        return;
      }

      const payload = parsed.event || parsed;
      this.handleStreamEvent(payload);
    } catch {
      // Ignore non-JSON frames
    }
  }

  /**
   * Processes a raw User Data Stream payload (`executionReport`, `outboundAccountPosition`, `balanceUpdate`, `listenKeyExpired`)
   * and updates the authoritative in-memory state with strict idempotency guarantees.
   */
  public handleStreamEvent(payload: any) {
    if (!payload) return;
    const eventType = payload.e || payload.event;
    if (eventType === 'executionReport') {
      this.handleExecutionReport(payload);
    } else if (eventType === 'outboundAccountPosition') {
      this.handleAccountPosition(payload);
    } else if (eventType === 'balanceUpdate') {
      this.handleBalanceUpdate(payload);
    } else if (eventType === 'listenKeyExpired') {
      console.warn('[BinanceStreamManager] listenKeyExpired received, reconnecting immediately...');
      this.reconnect();
    }
  }

  private handleExecutionReport(msg: any) {
    const symbol = String(msg.s || '').toUpperCase();
    const side: 'BUY' | 'SELL' = msg.S === 'SELL' ? 'SELL' : 'BUY';
    const orderType = String(msg.o || 'LIMIT');
    const executionType = String(msg.x || 'NEW'); // NEW, CANCELED, REPLACED, REJECTED, TRADE, EXPIRED
    const orderStatus = String(msg.X || 'NEW');   // NEW, PARTIALLY_FILLED, FILLED, CANCELED, PENDING_CANCEL, REJECTED, EXPIRED
    const orderId = String(msg.i || '');
    const tradeId = msg.t !== undefined && msg.t !== -1 ? String(msg.t) : '';
    const clientOrderId = msg.c ? String(msg.c) : undefined;
    const origClientOrderId = msg.C ? String(msg.C) : undefined;
    const orderPrice = parseFloat(msg.p || '0');
    const stopPrice = parseFloat(msg.P || '0');
    const origQty = parseFloat(msg.q || '0');
    const lastExecutedPrice = parseFloat(msg.L || '0');
    const lastExecutedQty = parseFloat(msg.l || '0');
    const lastQuoteQty = parseFloat(msg.Y || '0') || round8(lastExecutedPrice * lastExecutedQty);
    const cumulativeFilledQty = parseFloat(msg.z || '0');
    const cumulativeQuoteQty = parseFloat(msg.Z || '0');
    const commissionAmount = parseFloat(msg.n || '0');
    const commissionAsset = msg.N ? String(msg.N).toUpperCase() : undefined;
    const transactionTime = Number(msg.T || msg.E || Date.now());
    const orderCreationTime = Number(msg.O || transactionTime);
    const isBuyerMaker = Boolean(msg.m);

    // 1. Update Stateful Open Orders Map in real-time
    if (['NEW', 'PARTIALLY_FILLED'].includes(orderStatus)) {
      this.openOrdersState.set(orderId, {
        symbol,
        orderId,
        clientOrderId: clientOrderId || '',
        side,
        type: orderType,
        status: orderStatus,
        price: orderPrice,
        stopPrice,
        origQty,
        executedQty: cumulativeFilledQty,
        cummulativeQuoteQty: cumulativeQuoteQty,
        time: orderCreationTime,
        updateTime: transactionTime
      });
    } else if (['FILLED', 'CANCELED', 'EXPIRED', 'REJECTED'].includes(orderStatus)) {
      this.openOrdersState.delete(orderId);
    }

    // 2. If a trade fill occurred (executionType === 'TRADE' or lastExecutedQty > 0), record in Execution Ledger with strict idempotency key
    const idempotencyKey = generateStrictIdempotencyKey({
      symbol,
      orderId,
      tradeId: tradeId || `${transactionTime}`,
      side,
      price: lastExecutedPrice || orderPrice,
      qty: lastExecutedQty || cumulativeFilledQty,
      timestamp: transactionTime
    });

    if ((executionType === 'TRADE' || lastExecutedQty > 0) && lastExecutedPrice > 0) {
      if (this.executionLedgerState.has(idempotencyKey)) {
        // Strict idempotency filter: duplicate executionReport frame ignored
        return;
      }

      const feeMode = classifyFeeCurrencyMode(symbol, commissionAsset);
      let feeUsd = 0;
      if (commissionAmount > 0) {
        if (feeMode === 'QUOTE_ASSET') feeUsd = round8(commissionAmount);
        else if (feeMode === 'BNB') feeUsd = round8(commissionAmount * 600);
        else feeUsd = round8(commissionAmount * lastExecutedPrice);
      }

      this.executionLedgerState.set(idempotencyKey, {
        eventId: idempotencyKey,
        orderId,
        tradeId: tradeId || undefined,
        symbol,
        side,
        price: round8(lastExecutedPrice),
        qty: round8(lastExecutedQty),
        quoteQty: round8(lastQuoteQty),
        feeUsd,
        commissionAmount: round8(commissionAmount),
        commissionAsset,
        feeMode,
        feeCurrencyMode: feeMode,
        timestamp: transactionTime,
        isBuyer: side === 'BUY',
        fingerprint: generateEventFingerprint({
          orderId,
          tradeId,
          symbol,
          price: lastExecutedPrice,
          qty: lastExecutedQty,
          timestamp: transactionTime,
          isBuyer: side === 'BUY'
        }),
        idempotencyKey
      });
    }

    console.log(
      `[BinanceStreamManager] ⚡ ExecutionReport: ${symbol} ${side} ${orderStatus} (${executionType}) - Fill: ${lastExecutedQty} @ $${lastExecutedPrice} (Order #${orderId}, Trade #${tradeId || 'N/A'})`
    );

    this.emit({
      type: 'EXECUTION_REPORT',
      idempotencyKey,
      symbol,
      side,
      orderType,
      executionType,
      orderStatus,
      orderId,
      tradeId,
      clientOrderId,
      origClientOrderId,
      orderPrice,
      stopPrice,
      origQty,
      lastExecutedPrice,
      lastExecutedQty,
      lastQuoteQty,
      cumulativeFilledQty,
      cumulativeQuoteQty,
      commissionAmount,
      commissionAsset,
      transactionTime,
      orderCreationTime,
      isBuyerMaker
    });
  }

  private handleAccountPosition(msg: any) {
    const lastAccountUpdateTime = Number(msg.u || msg.E || Date.now());
    const rawBalances = Array.isArray(msg.B) ? msg.B : [];
    const balances = rawBalances.map((b: any) => {
      const asset = String(b.a || '').toUpperCase().trim();
      const free = parseFloat(b.f || '0');
      const locked = parseFloat(b.l || '0');
      if (asset) {
        this.balancesState.set(asset, {
          asset,
          free,
          locked,
          updatedAt: lastAccountUpdateTime
        });
      }
      return { asset, free, locked };
    });

    console.log(`[BinanceStreamManager] ⚡ AccountPosition update: ${balances.length} assets updated in real-time.`);

    this.emit({
      type: 'OUTBOUND_ACCOUNT_POSITION',
      lastAccountUpdateTime,
      balances
    });
  }

  private handleBalanceUpdate(msg: any) {
    const asset = String(msg.a || '').toUpperCase().trim();
    const balanceDelta = parseFloat(msg.d || '0');
    const clearTime = Number(msg.T || msg.E || Date.now());

    if (asset && this.balancesState.has(asset)) {
      const current = this.balancesState.get(asset)!;
      this.balancesState.set(asset, {
        ...current,
        free: Math.max(0, round8(current.free + balanceDelta)),
        updatedAt: clearTime
      });
    }

    console.log(`[BinanceStreamManager] ⚡ BalanceUpdate: ${asset} delta: ${balanceDelta}`);

    this.emit({
      type: 'BALANCE_UPDATE',
      asset,
      balanceDelta,
      clearTime
    });
  }

  private scheduleReconnect() {
    if (this.isDestroyed) return;
    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(1.5, this.reconnectAttempts), 30000);
    console.log(`[BinanceStreamManager] Reconnecting in ${(delay / 1000).toFixed(1)}s (attempt ${this.reconnectAttempts})...`);
    
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => {
      this.connect();
    }, delay);
  }
}
