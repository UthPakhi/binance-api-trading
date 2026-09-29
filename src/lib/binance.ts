import { useState, useEffect, useRef } from 'react';

let cachedSymbols: string[] | null = null;
let fetchingSymbols: Promise<string[]> | null = null;

const DEFAULT_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT',
  'TAOUSDT', 'SAGAUSDT', 'STGUSDT', 'CFGUSDT', 'NIGHTUSDT', 'ZECUSDT', 'FILUSDT',
  'ORCAUSDT', 'HOMEUSDT', 'FARTCOINUSDT', 'AI16ZUSDT', 'VIRTUALUSDT', 'SWARMSUSDT',
  'GRIFFAINUSDT', 'ACTUSDT', 'GOATUSDT'
];

export const fetchBinanceSymbols = async (): Promise<string[]> => {
  if (cachedSymbols && cachedSymbols.length > 0) return cachedSymbols;
  try {
    const saved = localStorage.getItem('trade_sizer_cached_symbols');
    if (saved) {
      const parsed = JSON.parse(saved);
      if (Array.isArray(parsed) && parsed.length > 0) {
        cachedSymbols = parsed;
      }
    }
  } catch {}

  if (fetchingSymbols) return cachedSymbols || fetchingSymbols;
  
  fetchingSymbols = fetch('/api/exchange/symbols')
    .then(async (res) => {
      if (!res.ok) throw new Error('Symbols fetch failed');
      const data = await res.json();
      if (data && Array.isArray(data.symbols) && data.symbols.length > 0) {
        cachedSymbols = data.symbols;
        try {
          localStorage.setItem('trade_sizer_cached_symbols', JSON.stringify(data.symbols));
        } catch {}
        return data.symbols;
      }
      return cachedSymbols || DEFAULT_SYMBOLS;
    })
    .catch(() => {
      if (!cachedSymbols) cachedSymbols = DEFAULT_SYMBOLS;
      return cachedSymbols;
    });
    
  return cachedSymbols || fetchingSymbols;
};

export function useBinanceTickers(symbols: string[], refreshTrigger: number = 0) {
  const [prices, setPrices] = useState<Record<string, number>>({});
  const pricesRef = useRef<Record<string, number>>({});
  const lastUpdateRef = useRef<number>(Date.now());
  const lastWsMessageRef = useRef<number>(Date.now());
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);
  const pollIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const watchdogIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const wsRef = useRef<WebSocket | null>(null);
  const futWsRef = useRef<WebSocket | null>(null);
  const [reconnectCounter, setReconnectCounter] = useState<number>(0);

  useEffect(() => {
    const activeSymbols = symbols
      .filter(Boolean)
      .map(s => s.toUpperCase().trim())
      .filter(s => /^[A-Z0-9]+$/.test(s));

    if (activeSymbols.length === 0) {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      if (futWsRef.current) {
        try { futWsRef.current.close(); } catch (_) {}
        futWsRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }
      return;
    }

    // Function to fetch prices via our multi-source backend (Spot + Futures + Alpha)
    const fetchPrices = async () => {
      try {
        const res = await fetch(`/api/exchange/ticker?symbols=${encodeURIComponent(activeSymbols.join(','))}`);
        if (res.ok) {
          const data = await res.json();
          if (data && data.prices) {
            let changed = false;
            for (const [sym, price] of Object.entries(data.prices)) {
              const numPrice = Number(price);
              if (numPrice > 0 && pricesRef.current[sym] !== numPrice) {
                pricesRef.current[sym] = numPrice;
                changed = true;
              }
            }
            if (changed) {
              setPrices({ ...pricesRef.current });
              lastUpdateRef.current = Date.now();
            }
          }
        }
      } catch (err) {
        // Backend ticker will retry on next poll cycle; avoid direct browser cross-origin requests
      }
    };

    // Initial instant fetch
    fetchPrices();

    // Regular polling every 2 seconds to guarantee live updates reliably as a safety baseline
    pollIntervalRef.current = setInterval(fetchPrices, 2000);

    // Watchdog timer: checks socket heartbeat every 4 seconds.
    // If the WebSocket heartbeat hasn't received messages in > 6 seconds, triggers instant REST snapshot
    // and re-establishes fresh socket connections.
    lastWsMessageRef.current = Date.now();
    watchdogIntervalRef.current = setInterval(() => {
      const now = Date.now();
      const timeSinceLastWs = now - lastWsMessageRef.current;
      if (timeSinceLastWs > 6000) {
        // Socket heartbeat has stalled: trigger immediate REST snapshot fallback
        fetchPrices();
        // If socket is dead/stuck for > 10 seconds, trigger reconnection
        if (timeSinceLastWs > 10000) {
          lastWsMessageRef.current = now; // reset heartbeat window
          setReconnectCounter(prev => prev + 1);
        }
      }
    }, 4000);

    // Setup Spot WebSocket for standard spot symbols if supported
    if (typeof WebSocket !== 'undefined') {
      try {
        const spotStreams = activeSymbols
          .filter(s => s !== 'FARTCOINUSDT' && s.length <= 15)
          .slice(0, 15)
          .map(s => `${s.toLowerCase()}@ticker`)
          .join('/');

        if (spotStreams) {
          if (wsRef.current) {
            try { wsRef.current.close(); } catch (_) {}
            wsRef.current = null;
          }

          // Use standard HTTPS port 443 rather than 9443 to avoid Safari WebKit pattern errors
          const wsUrl = `wss://stream.binance.com/stream?streams=${spotStreams}`;
          const ws = new WebSocket(wsUrl);
          wsRef.current = ws;

          ws.onerror = (e) => {
            try {
              e.preventDefault?.();
              ws.close();
            } catch (_) {}
          };

          ws.onclose = () => {
            // If closed unexpectedly, trigger fallback fetch immediately
            fetchPrices();
          };

          ws.onmessage = (event) => {
            lastWsMessageRef.current = Date.now();
            try {
              const data = JSON.parse(event.data);
              if (data?.data?.s && data?.data?.c) {
                const sym = data.data.s;
                const price = parseFloat(data.data.c);
                if (price > 0) {
                  pricesRef.current[sym] = price;
                  
                  const now = Date.now();
                  if (now - lastUpdateRef.current > 800) {
                    setPrices({ ...pricesRef.current });
                    lastUpdateRef.current = now;
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                  } else {
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                    timeoutRef.current = setTimeout(() => {
                      setPrices({ ...pricesRef.current });
                      lastUpdateRef.current = Date.now();
                    }, 800);
                  }
                }
              }
            } catch (e) {
              // Ignore WS parse errors
            }
          };
        }
      } catch (wsErr) {
        // Fall back gracefully to REST polling without throwing
      }

      // Setup Futures WebSocket for Alpha and Futures tokens
      try {
        const futStreams = activeSymbols
          .filter(s => s.length <= 15)
          .slice(0, 15)
          .map(s => `${s.toLowerCase()}@ticker`)
          .join('/');

        if (futStreams) {
          if (futWsRef.current) {
            try { futWsRef.current.close(); } catch (_) {}
            futWsRef.current = null;
          }

          const futWs = new WebSocket(`wss://fstream.binance.com/stream?streams=${futStreams}`);
          futWsRef.current = futWs;

          futWs.onerror = (e) => {
            try {
              e.preventDefault?.();
              futWs.close();
            } catch (_) {}
          };

          futWs.onclose = () => {
            fetchPrices();
          };

          futWs.onmessage = (event) => {
            lastWsMessageRef.current = Date.now();
            try {
              const data = JSON.parse(event.data);
              if (data?.data?.s && data?.data?.c) {
                const sym = data.data.s;
                const price = parseFloat(data.data.c);
                if (price > 0) {
                  pricesRef.current[sym] = price;
                  const now = Date.now();
                  if (now - lastUpdateRef.current > 800) {
                    setPrices({ ...pricesRef.current });
                    lastUpdateRef.current = now;
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                  } else {
                    if (timeoutRef.current) clearTimeout(timeoutRef.current);
                    timeoutRef.current = setTimeout(() => {
                      setPrices({ ...pricesRef.current });
                      lastUpdateRef.current = Date.now();
                    }, 800);
                  }
                }
              }
            } catch (e) {
              // Ignore parse errors on futures ws
            }
          };
        }
      } catch (fWsErr) {
        // Fall back gracefully to REST polling without throwing
      }
    }

    return () => {
      if (wsRef.current) {
        try { wsRef.current.close(); } catch (_) {}
        wsRef.current = null;
      }
      if (futWsRef.current) {
        try { futWsRef.current.close(); } catch (_) {}
        futWsRef.current = null;
      }
      if (pollIntervalRef.current) {
        clearInterval(pollIntervalRef.current);
        pollIntervalRef.current = null;
      }
      if (watchdogIntervalRef.current) {
        clearInterval(watchdogIntervalRef.current);
        watchdogIntervalRef.current = null;
      }
      if (timeoutRef.current) {
        clearTimeout(timeoutRef.current);
      }
    };
  }, [symbols.join(','), refreshTrigger, reconnectCounter]);

  return prices;
}
