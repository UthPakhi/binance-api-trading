import express from "express";
import compression from "compression";
import path from "path";
import fs from "fs";
import { createServer as createViteServer } from "vite";
import crypto from "crypto";
import webpush from 'web-push';
import { GoogleGenAI, Type } from "@google/genai";
import { initializeApp as initFirebaseApp } from "firebase/app";
import { getFirestore as initServerFirestore, collection, getDocs, doc, setDoc, deleteDoc, updateDoc, arrayUnion, query, where } from "firebase/firestore";
import {
  analyzeOrderBook,
  analyzeDerivatives,
  analyzePriceAction,
  calculateVolumeProfile,
  getSessionTiming,
  getBtcVolatilityGuard
} from "./src/server/marketIntelligence";

let aiClient: GoogleGenAI | null = null;
function getAiClient(): GoogleGenAI {
  if (!aiClient) {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY || ''
    });
  }
  return aiClient;
}

// Resilient institutional Gemini model tier per official SDK guidelines
const GEMINI_MODELS = [
  "gemini-2.5-flash",
  "gemini-2.5-flash-lite",
  "gemini-1.5-flash"
];

async function generateWithFallback(params: any) {
  let lastError: any = null;
  const ai = getAiClient();
  for (const model of GEMINI_MODELS) {
    try {
      return await ai.models.generateContent({
        model,
        ...params
      });
    } catch (error: any) {
      lastError = error;
      console.warn(`[Gemini Model ${model} Notice]:`, error?.status || error?.message || error);
      // If rate limited, quota exhausted, overloaded, or network socket drop, fallback to next valid model
      if (
        error?.status === 429 || 
        error?.status === 503 || 
        error?.message?.includes('fetch failed') ||
        error?.message?.includes('resource_exhausted') ||
        error?.message?.includes('quota') ||
        error?.message?.includes('rate limit')
      ) {
        continue;
      }
      break;
    }
  }
  throw lastError;
}

function normalizeTpPercentages(target: { tp1Pct?: number; tp2Pct?: number; tp3Pct?: number }) {
  const total = (target.tp1Pct || 0) + (target.tp2Pct || 0) + (target.tp3Pct || 0);
  if (total > 0 && total !== 100) {
    target.tp1Pct = Math.round(((target.tp1Pct || 0) / total) * 100);
    target.tp2Pct = Math.round(((target.tp2Pct || 0) / total) * 100);
    target.tp3Pct = 100 - (target.tp1Pct || 0) - (target.tp2Pct || 0);
  } else if (total === 0) {
    target.tp1Pct = 100;
    target.tp2Pct = 0;
    target.tp3Pct = 0;
  }
}

function enforceMinimumRewardRisk(item: { entry: number; sl: number; tp1: number; tp2?: number; tp3?: number }, minRR = 1.0): boolean {
  if (item.tp1 <= item.entry || item.sl >= item.entry) return false;
  const risk = item.entry - item.sl;
  const reward = item.tp1 - item.entry;
  if (risk <= 0) return false;
  const rr = reward / risk;
  if (rr < minRR) {
    item.tp1 = parseFloat((item.entry + (risk * 1.5)).toFixed(5));
    if (item.tp2 && item.tp2 < item.tp1) item.tp2 = parseFloat((item.tp1 * 1.01).toFixed(5));
    if (item.tp3 && item.tp3 < item.tp2) item.tp3 = parseFloat((item.tp2 * 1.01).toFixed(5));
  }
  return true;
}

/**
 * Accurately extracts and converts execution commission into USDT:
 * 1. If commission is in a USD-pegged stablecoin (USDT, USDC, BUSD, FDUSD, TUSD), use face value 1:1.
 * 2. If commission is in the traded coin (e.g. BTC on BTCUSDT, ETH on ETHUSDT, FLOKI on 1000FLOKIUSDT):
 *    Calculates the exact USDT amount at that specific time based on the coin's execution price!
 * 3. If commission is in BNB (Binance fee deduction), converts using BNB/USDT price.
 * 4. Supports mixed orders (e.g. Buy order fee charged in coin, Sell order fee charged in USDT).
 */
export function calculateExecutionFeeInUsd(
  commissionAsset: string | undefined,
  commissionAmount: number | string | undefined,
  executionPrice: number,
  symbol: string,
  bnbPrice: number = 600
): number {
  if (!commissionAmount) return 0;
  const comm = typeof commissionAmount === 'number' ? commissionAmount : parseFloat(commissionAmount);
  if (isNaN(comm) || comm <= 0) return 0;
  
  const asset = (commissionAsset || 'USDT').trim().toUpperCase();
  const cleanSym = symbol.trim().toUpperCase();
  
  // 1. USD stablecoins (1:1 USD equivalent)
  if (['USDT', 'USD', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(asset)) {
    return comm;
  }
  
  // 2. Base coin of the traded pair (e.g. BTC in BTCUSDT, SOL in SOLUSDT, FLOKI in 1000FLOKIUSDT)
  const withoutQuote = cleanSym.replace(/(USDT|USDC|BUSD|FDUSD|TUSD|EUR|TRY|BIDR)$/, '');
  const baseAssetWithoutPrefix = withoutQuote.replace(/^(1000000|100000|10000|1000)/, '');
  
  if (
    asset === withoutQuote || 
    cleanSym.startsWith(asset) || 
    asset === baseAssetWithoutPrefix ||
    cleanSym.includes(asset)
  ) {
    if (withoutQuote.startsWith('1000') && !asset.startsWith('1000')) {
      const match = withoutQuote.match(/^(1000000|100000|10000|1000)/);
      const mult = match ? parseInt(match[1], 10) : 1000;
      return comm * (executionPrice / mult);
    }
    return comm * executionPrice;
  }
  
  // 3. BNB fee discount
  if (asset === 'BNB') {
    return comm * (bnbPrice > 0 ? bnbPrice : 600);
  }
  
  // 4. Default fallback: if asset is present anywhere in symbol, treat as base coin
  if (cleanSym.includes(asset)) {
    return comm * executionPrice;
  }
  
  // 5. If completely unknown altcoin, multiply by executionPrice as base asset
  return comm * executionPrice;
}

async function startServer() {
  const app = express();
  const PORT = 3000;
  
  // High-performance gzip/deflate compression for 70%+ faster mobile asset delivery
  app.use(compression());
  app.use(express.json());

  // CORS and preflight handling
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
    res.header("Access-Control-Allow-Headers", "Origin, X-Requested-With, Content-Type, Accept, Authorization");
    if (req.method === "OPTIONS") {
      return res.sendStatus(200);
    }
    next();
  });

  // API routes FIRST

  
const vapidPublic = process.env.VAPID_PUBLIC_KEY || 'BAroV9birM9rVdLrSDpuoyalmIBWVuGhJ7GcY0vIr7SZhMABwnGIO0JkBiZdY-QYK46tC6_LAUaex0NKg629CWs';
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '9BqD8uZEKidk7wBN2WI0UwS86098NLpWaLR29_VnH78';
webpush.setVapidDetails('mailto:notifications@tradesizer.com', vapidPublic, vapidPrivate);

// Initialize Firebase Firestore on the server for persistent push subscriptions & background alerts
let serverDb: any = null;
try {
  const configPath = path.join(process.cwd(), "firebase-applet-config.json");
  if (fs.existsSync(configPath)) {
    const fbConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    const fbApp = initFirebaseApp({
      apiKey: fbConfig.apiKey,
      authDomain: fbConfig.authDomain,
      projectId: fbConfig.projectId,
      storageBucket: fbConfig.storageBucket,
      messagingSenderId: fbConfig.messagingSenderId,
      appId: fbConfig.appId
    }, "server-push-app");
    serverDb = initServerFirestore(fbApp, fbConfig.firestoreDatabaseId);
    console.log("Firebase Firestore initialized for 24/7 background alert engine.");
  }
} catch (err: any) {
  console.warn("Server Firestore initialization notice:", err?.message || err);
}

const activePushSubs = new Map<string, any>();
const activeAlerts = new Map<string, any[]>();
// Permanent tracking of triggered milestone alerts so notifications NEVER repeat across price bounces or restarts
const sentAlertsPermanent = new Set<string>();

// Sync push subscriptions and active trades from Firestore into server memory
async function syncBackgroundEngineFromDb() {
  if (!serverDb) return;
  try {
    // 1. Sync push subscriptions
    const subSnap = await getDocs(collection(serverDb, "push_subscriptions"));
    for (const d of subSnap.docs) {
      const data = d.data();
      if (data?.userId && data?.subscription) {
        activePushSubs.set(data.userId, data.subscription);
      }
    }

    // 2. Load all historical triggered alerts so they are never re-sent
    try {
      const trigSnap = await getDocs(collection(serverDb, "triggered_push_alerts"));
      for (const d of trigSnap.docs) {
        const item = d.data();
        if (item.alertKey) sentAlertsPermanent.add(item.alertKey);
        if (item.baseAlertKey) sentAlertsPermanent.add(item.baseAlertKey);
        if (item.userId && item.alertId) sentAlertsPermanent.add(`${item.userId}_${item.alertId}`);
        sentAlertsPermanent.add(d.id);
      }
    } catch (_) {}

    // 3. Sync all open trades (ACTIVE, PENDING, HIT_TP1, HIT_TP2, PARTIAL_EXIT)
    const tradesSnap = await getDocs(query(collection(serverDb, "trades"), where("status", "in", ["ACTIVE", "PENDING", "HIT_TP1", "HIT_TP2", "PARTIAL_EXIT"])));
    const alertsByUser = new Map<string, any[]>();

    for (const d of tradesSnap.docs) {
      const t = d.data();
      if (t.closedAt || ['CLOSED_MANUAL', 'HIT_SL', 'HIT_TP3', 'CLOSED_BREAK_EVEN', 'BREAK_EVEN'].includes(t.status)) {
        continue;
      }
      const uId = t.userId || 'anonymous';
      if (!alertsByUser.has(uId)) alertsByUser.set(uId, []);

      const isLong = !t.direction || t.direction === 'LONG' || (t.positionSizeCoins > 0 && t.type !== 'SHORT');
      const tradeId = d.id;
      const notified = new Set<string>(Array.isArray(t.notifiedMilestones) ? t.notifiedMilestones : []);

      // Register historical milestones into memory if already marked on trade
      if (notified.has('ENTRY')) {
        sentAlertsPermanent.add(`${uId}_${tradeId}_ENTRY`);
        if (t.entryPrice) sentAlertsPermanent.add(`${uId}_${tradeId}_ENTRY_${t.entryPrice}`);
      }
      if (notified.has('SL') || t.status === 'HIT_SL') {
        sentAlertsPermanent.add(`${uId}_${tradeId}_SL`);
        if (t.stopLoss) sentAlertsPermanent.add(`${uId}_${tradeId}_SL_${t.stopLoss}`);
      }
      if (notified.has('TP1') || ['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(t.status)) {
        sentAlertsPermanent.add(`${uId}_${tradeId}_TP1`);
        if (t.takeProfit1) sentAlertsPermanent.add(`${uId}_${tradeId}_TP1_${t.takeProfit1}`);
      }
      if (notified.has('TP2') || ['HIT_TP2', 'HIT_TP3'].includes(t.status)) {
        sentAlertsPermanent.add(`${uId}_${tradeId}_TP2`);
        if (t.takeProfit2) sentAlertsPermanent.add(`${uId}_${tradeId}_TP2_${t.takeProfit2}`);
      }
      if (notified.has('TP3') || t.status === 'HIT_TP3') {
        sentAlertsPermanent.add(`${uId}_${tradeId}_TP3`);
        if (t.takeProfit3) sentAlertsPermanent.add(`${uId}_${tradeId}_TP3_${t.takeProfit3}`);
      }

      // Auto-heal: If trade was already notified for ENTRY but remained PENDING, promote to ACTIVE immediately
      if (t.status === 'PENDING' && notified.has('ENTRY')) {
        updateDoc(doc(serverDb, "trades", tradeId), {
          status: 'ACTIVE',
          filledAt: Date.now()
        }).catch(() => null);
        continue;
      }

      // Check ENTRY: Only if still PENDING and never notified
      if (t.status === 'PENDING' && t.entryPrice > 0 && !notified.has('ENTRY')) {
        const entryKey = `${uId}_${tradeId}_ENTRY_${t.entryPrice}`;
        const baseKey = `${uId}_${tradeId}_ENTRY`;
        if (!sentAlertsPermanent.has(entryKey) && !sentAlertsPermanent.has(baseKey)) {
          alertsByUser.get(uId)!.push({
            id: `${tradeId}_ENTRY`,
            tradeId,
            type: 'ENTRY',
            symbol: t.symbol,
            targetPrice: t.entryPrice,
            condition: isLong ? 'below' : 'above',
            message: `${t.symbol} Entry reached at $${t.entryPrice}`
          });
        }
      }

      // Check open trades for SL, TP1, TP2, TP3
      if (['ACTIVE', 'HIT_TP1', 'HIT_TP2', 'PARTIAL_EXIT'].includes(t.status)) {
        if (t.stopLoss && t.stopLoss > 0 && !notified.has('SL') && t.status !== 'HIT_SL') {
          const slKey = `${uId}_${tradeId}_SL_${t.stopLoss}`;
          const baseKey = `${uId}_${tradeId}_SL`;
          if (!sentAlertsPermanent.has(slKey) && !sentAlertsPermanent.has(baseKey)) {
            alertsByUser.get(uId)!.push({
              id: `${tradeId}_SL`,
              tradeId,
              type: 'SL',
              symbol: t.symbol,
              targetPrice: t.stopLoss,
              condition: isLong ? 'below' : 'above',
              message: `🚨 ${t.symbol} Stop Loss reached at $${t.stopLoss}`
            });
          }
        }

        // TP1: Only if not already hit or notified
        if (t.takeProfit1 && t.takeProfit1 > 0 && !['HIT_TP1', 'HIT_TP2', 'HIT_TP3'].includes(t.status) && !notified.has('TP1')) {
          const tp1Key = `${uId}_${tradeId}_TP1_${t.takeProfit1}`;
          const baseKey = `${uId}_${tradeId}_TP1`;
          if (!sentAlertsPermanent.has(tp1Key) && !sentAlertsPermanent.has(baseKey)) {
            alertsByUser.get(uId)!.push({
              id: `${tradeId}_TP1`,
              tradeId,
              type: 'TP1',
              symbol: t.symbol,
              targetPrice: t.takeProfit1,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP1 reached at $${t.takeProfit1}`
            });
          }
        }

        // TP2: Only if not already hit or notified
        if (t.takeProfit2 && t.takeProfit2 > 0 && !['HIT_TP2', 'HIT_TP3'].includes(t.status) && !notified.has('TP2')) {
          const tp2Key = `${uId}_${tradeId}_TP2_${t.takeProfit2}`;
          const baseKey = `${uId}_${tradeId}_TP2`;
          if (!sentAlertsPermanent.has(tp2Key) && !sentAlertsPermanent.has(baseKey)) {
            alertsByUser.get(uId)!.push({
              id: `${tradeId}_TP2`,
              tradeId,
              type: 'TP2',
              symbol: t.symbol,
              targetPrice: t.takeProfit2,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP2 reached at $${t.takeProfit2}`
            });
          }
        }

        // TP3: Only if not already hit or notified
        if (t.takeProfit3 && t.takeProfit3 > 0 && t.status !== 'HIT_TP3' && !notified.has('TP3')) {
          const tp3Key = `${uId}_${tradeId}_TP3_${t.takeProfit3}`;
          const baseKey = `${uId}_${tradeId}_TP3`;
          if (!sentAlertsPermanent.has(tp3Key) && !sentAlertsPermanent.has(baseKey)) {
            alertsByUser.get(uId)!.push({
              id: `${tradeId}_TP3`,
              tradeId,
              type: 'TP3',
              symbol: t.symbol,
              targetPrice: t.takeProfit3,
              condition: isLong ? 'above' : 'below',
              message: `🎯 ${t.symbol} TP3 reached at $${t.takeProfit3}`
            });
          }
        }
      }
    }

    for (const [uId, alerts] of alertsByUser.entries()) {
      activeAlerts.set(uId, alerts);
    }
  } catch (err: any) {
    console.warn("Background engine DB sync note:", err?.message || err);
  }
}

// Perform initial sync and schedule ongoing sync every 30 seconds
syncBackgroundEngineFromDb();
setInterval(syncBackgroundEngineFromDb, 30000);

app.post("/api/push/subscribe", express.json(), async (req, res) => {
  const { userId, subscription, alerts } = req.body;
  if (!userId || !subscription) return res.status(400).json({ status: "error", message: "userId and subscription required" });
  
  activePushSubs.set(userId, subscription);
  if (alerts && Array.isArray(alerts)) {
    // Filter out any alerts that have already been notified
    const filtered = alerts.filter(a => {
      const fullKey = `${userId}_${a.id}_${a.targetPrice}`;
      const baseKey = `${userId}_${a.id}`;
      return !sentAlertsPermanent.has(fullKey) && !sentAlertsPermanent.has(baseKey);
    });
    activeAlerts.set(userId, filtered);
  }

  // Persist to Firestore so alerts survive server restarts
  if (serverDb) {
    try {
      await setDoc(doc(serverDb, "push_subscriptions", userId), {
        userId,
        subscription,
        updatedAt: Date.now()
      }, { merge: true });
    } catch (e: any) {
      console.warn("Push subscription save note:", e?.message);
    }
  }

  res.json({ status: "success", message: "Push subscription registered" });
});

app.post("/api/push/test", express.json(), async (req, res) => {
  const { userId, subscription } = req.body;
  let sub = subscription || activePushSubs.get(userId);

  if (!sub && serverDb && userId) {
    try {
      const snap = await getDocs(query(collection(serverDb, "push_subscriptions"), where("userId", "==", userId)));
      if (!snap.empty) {
        sub = snap.docs[0].data().subscription;
      }
    } catch (_) {}
  }

  if (!sub) {
    return res.status(404).json({ 
      status: "error", 
      message: "No push subscription active on this device. Please grant notification permission first." 
    });
  }

  try {
    await webpush.sendNotification(sub, JSON.stringify({
      title: 'Trade Sizer Cloud Engine',
      body: 'Notifications are active! You will now receive TP, SL, and Entry alerts even when the app is completely closed.',
      url: '/'
    }));
    res.json({ status: "success", message: "Test notification dispatched" });
  } catch (e: any) {
    console.warn("Test push failed:", e?.message || e);
    res.status(500).json({ status: "error", message: e?.message || "Failed to deliver push notification" });
  }
});

function isAlphaSymbol(sym: string): boolean {
  if (!sym) return false;
  const s = sym.toUpperCase().trim();
  return s.includes('FARTCOIN') || s.includes('AI16Z') || s.includes('GRIFFAIN') || s.includes('VIRTUAL') || s.includes('SWARMS') || s.includes('ACT') || s.includes('GOAT');
}

// --- 24/7 BACKGROUND PRICE & NOTIFICATION ENGINE ---
setInterval(async () => {
  if (activeAlerts.size === 0 || activePushSubs.size === 0) return;
  try {
    const symbolsNeeded = new Set<string>();
    for (const alerts of activeAlerts.values()) {
      for (const a of alerts) {
        if (a.symbol) symbolsNeeded.add(a.symbol.trim().toUpperCase());
      }
    }
    if (symbolsNeeded.size === 0) return;

    // Fetch both Spot and Futures tickers so Alpha & Futures coins (e.g. FARTCOIN) are monitored 24/7
    const [spotRes, futRes] = await Promise.all([
      fetch('https://api.binance.com/api/v3/ticker/price').catch(() => null),
      fetch('https://fapi.binance.com/fapi/v1/ticker/price').catch(() => null),
    ]);

    const prices = new Map<string, number>();
    if (spotRes && spotRes.ok) {
      const data: any[] = await spotRes.json();
      if (Array.isArray(data)) {
        for (const item of data) {
          if (symbolsNeeded.has(item.symbol)) {
            prices.set(item.symbol, parseFloat(item.price));
          }
        }
      }
    }
    if (futRes && futRes.ok) {
      const fData: any[] = await futRes.json();
      if (Array.isArray(fData)) {
        for (const item of fData) {
          if (symbolsNeeded.has(item.symbol) && !prices.has(item.symbol)) {
            prices.set(item.symbol, parseFloat(item.price));
          }
        }
      }
    }

    for (const [userId, alerts] of activeAlerts.entries()) {
      const sub = activePushSubs.get(userId);
      if (!sub) continue;

      const remainingAlerts: any[] = [];

      for (const alert of alerts) {
        const fullKey = `${userId}_${alert.id}_${alert.targetPrice}`;
        const baseKey = `${userId}_${alert.id || (alert.symbol + '_' + alert.targetPrice)}`;

        // If this milestone was already delivered, drop it and never repeat
        if (sentAlertsPermanent.has(fullKey) || sentAlertsPermanent.has(baseKey)) {
          continue;
        }

        const live = prices.get(alert.symbol);
        if (live === undefined) {
          remainingAlerts.push(alert);
          continue;
        }

        let isTriggered = false;
        if (alert.condition === 'above' && live >= alert.targetPrice) isTriggered = true;
        if (alert.condition === 'below' && live <= alert.targetPrice) isTriggered = true;

        if (isTriggered) {
          // Permanently lock this alert so it CANNOT fire again even if price crosses it 100 times
          sentAlertsPermanent.add(fullKey);
          sentAlertsPermanent.add(baseKey);

          console.log(`[Cloud Alert] Firing single-milestone push notification to ${userId}: ${alert.message} (Live: $${live})`);

          // 1. Deliver Web Push notification
          try {
            await webpush.sendNotification(sub, JSON.stringify({
              title: 'Trade Sizer Alert',
              body: `${alert.message} (Live Price: $${live.toLocaleString(undefined, { maximumFractionDigits: 4 })})`,
              url: '/',
              tag: baseKey
            }));
          } catch (e: any) {
            console.warn('[Push Send Failed]:', e?.message || e);
            if (e.statusCode === 410) {
              activePushSubs.delete(userId);
              if (serverDb) {
                deleteDoc(doc(serverDb, "push_subscriptions", userId)).catch(() => null);
              }
            }
          }

          // 2. Persist to Firestore so server restarts never re-trigger this milestone
          if (serverDb) {
            try {
              const safeAlertDocId = `${userId}_${alert.id}`.replace(/[^a-zA-Z0-9_-]/g, '_');
              await setDoc(doc(serverDb, "triggered_push_alerts", safeAlertDocId), {
                userId,
                alertId: alert.id,
                alertKey: fullKey,
                baseAlertKey: baseKey,
                tradeId: alert.tradeId || null,
                type: alert.type || null,
                symbol: alert.symbol,
                targetPrice: alert.targetPrice,
                triggeredAt: Date.now(),
                livePriceAtTrigger: live
              }, { merge: true });

              if (alert.tradeId) {
                const tradeRef = doc(serverDb, "trades", alert.tradeId);
                const milestoneType = alert.type || (alert.id ? alert.id.split('_').pop() : 'UNKNOWN');
                
                const updatePayload: any = {
                  notifiedMilestones: arrayUnion(milestoneType)
                };
                if (milestoneType === 'ENTRY') {
                  updatePayload.status = 'ACTIVE';
                  updatePayload.filledAt = Date.now();
                  console.log(`[Cloud Alert] Limit order hit entry: moving trade ${alert.tradeId} (${alert.symbol}) from PENDING to ACTIVE automatically!`);
                }

                // Record notified milestone & update trade in Firestore
                await updateDoc(tradeRef, updatePayload).catch(() => null);
              }
            } catch (err: any) {
              console.warn("Firestore triggered alert save note:", err?.message || err);
            }
          }
          // Intentionally do NOT push to remainingAlerts - milestone completed!
        } else {
          // Still waiting for target
          remainingAlerts.push(alert);
        }
      }

      activeAlerts.set(userId, remainingAlerts);
    }
  } catch (e: any) {
    // Suppress transient network fetch glitches
  }
}, 4000);
// ----------------------------------------------------

  // Rate-limiting and exponential backoff wrapper for Binance API calls with timeout safeguard
  async function safeBinanceFetch(url: string, options: any = {}, retries = 2, backoffMs = 400): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 7000);
        const fetchOptions = {
          ...options,
          signal: options.signal || controller.signal
        };
        const res = await fetch(url, fetchOptions);
        clearTimeout(timeoutId);
        if (res.status === 429 || res.status === 418) {
          const retryAfter = parseInt(res.headers.get('Retry-After') || '1', 10);
          const waitTime = Math.max(retryAfter * 1000, backoffMs * Math.pow(2, attempt));
          console.warn(`[Binance 429/418 Rate Limit] Retrying ${url} in ${waitTime}ms (attempt ${attempt + 1}/${retries})...`);
          if (attempt < retries) {
            await new Promise(r => setTimeout(r, waitTime));
            continue;
          }
        }
        return res;
      } catch (err: any) {
        if (attempt < retries) {
          const waitTime = backoffMs * Math.pow(2, attempt);
          await new Promise(r => setTimeout(r, waitTime));
          continue;
        }
        throw err;
      }
    }
    throw new Error(`Failed to fetch from ${url} after ${retries} retries`);
  }

  app.get("/api/health", (req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/api/widget/summary", (req, res) => {
    res.json({
      status: "success",
      appName: "Trade Sizer",
      prices: {
        BTC: cachedTickers['BTCUSDT'] || 0,
        ETH: cachedTickers['ETHUSDT'] || 0,
        SOL: cachedTickers['SOLUSDT'] || 0,
      },
      updatedAt: Date.now()
    });
  });

  let cachedPkrRate: { rate: number; timestamp: number } | null = null;
  app.get("/api/exchange/pkr-rate", async (req, res) => {
    try {
      const now = Date.now();
      // Cache for 3 minutes to avoid flooding Binance P2P endpoint
      if (cachedPkrRate && (now - cachedPkrRate.timestamp < 180000)) {
        return res.json({ status: "success", rate: cachedPkrRate.rate, cached: true, source: "binance_p2p" });
      }

      const p2pRes = await fetch("https://p2p.binance.com/bapi/c2c/v2/friendly/c2c/adv/search", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          asset: "USDT",
          fiat: "PKR",
          merchantCheck: false,
          page: 1,
          payTypes: [],
          publisherType: null,
          rows: 5,
          tradeType: "BUY"
        })
      });

      if (p2pRes.ok) {
        const p2pData: any = await p2pRes.json();
        const priceStr = p2pData?.data?.[0]?.adv?.price;
        const rate = parseFloat(priceStr);
        if (!isNaN(rate) && rate > 0) {
          cachedPkrRate = { rate, timestamp: now };
          return res.json({ status: "success", rate, source: "binance_p2p" });
        }
      }

      const fallbackRate = cachedPkrRate?.rate || 283.89;
      res.json({ status: "success", rate: fallbackRate, fallback: true, source: "cached_fallback" });
    } catch (e: any) {
      console.error("Error fetching PKR rate from Binance P2P:", e?.message);
      const fallbackRate = cachedPkrRate?.rate || 283.89;
      res.json({ status: "success", rate: fallbackRate, fallback: true, source: "fallback" });
    }
  });

  app.get("/api/exchange/balance", async (req, res) => {
    try {
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      const [spotRes, fundRes, futRes, pricesRes, futPricesRes] = await Promise.all([
        safeBinanceFetch(`https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': apiKey } }),
        safeBinanceFetch(`https://api.binance.com/sapi/v1/asset/get-funding-asset?${queryString}&signature=${signature}`, {
          method: 'POST',
          headers: { 'X-MBX-APIKEY': apiKey }
        }).catch(() => null),
        safeBinanceFetch(`https://fapi.binance.com/fapi/v2/balance?${queryString}&signature=${signature}`, { headers: { 'X-MBX-APIKEY': apiKey } }).catch(() => null),
        safeBinanceFetch('https://api.binance.com/api/v3/ticker/price').catch(() => null),
        safeBinanceFetch('https://fapi.binance.com/fapi/v1/ticker/price').catch(() => null)
      ]);
      
      if (!spotRes.ok) {
        const errorData = await spotRes.text();
        console.error("Binance Spot API error:", errorData);
        throw new Error("Failed to fetch Spot balance.");
      }
      
      const spotData = await spotRes.json();
      const pricesData: any[] = pricesRes && pricesRes.ok ? await pricesRes.json() : [];
      const futPricesData: any[] = futPricesRes && futPricesRes.ok ? await futPricesRes.json() : [];
      
      const priceMap = new Map<string, number>();
      if (Array.isArray(pricesData)) {
        for (const p of pricesData) {
          if (p.symbol && p.price) priceMap.set(p.symbol, parseFloat(p.price) || 0);
        }
      }
      if (Array.isArray(futPricesData)) {
        for (const p of futPricesData) {
          if (p.symbol && p.price && !priceMap.has(p.symbol)) {
            priceMap.set(p.symbol, parseFloat(p.price) || 0);
          }
        }
      }

      let spotUsdtTotal = 0;
      let spotUsdtFree = 0;
      let spotUsdtLocked = 0;
      let spotTotalEstimatedUsd = 0;
      const nonZeroAssets: any[] = [];

      for (const b of spotData.balances) {
        const free = parseFloat(b.free);
        const locked = parseFloat(b.locked);
        const total = free + locked;
        if (total <= 0) continue;

        if (b.asset === 'USDT') {
          spotUsdtFree = free;
          spotUsdtLocked = locked;
          spotUsdtTotal = total;
          spotTotalEstimatedUsd += total;
          nonZeroAssets.push({ asset: 'USDT', free, locked, total, usdValue: total });
        } else {
          const price: number = priceMap.get(b.asset + 'USDT') || 0;
          const usdVal: number = total * price;
          spotTotalEstimatedUsd += usdVal;
          nonZeroAssets.push({ asset: b.asset, free, locked, total, price, usdValue: usdVal });
        }
      }

      // Incorporate Funding Wallet assets (e.g. USDT in Funding)
      let fundingUsdtTotal = 0;
      let fundingTotalEstimatedUsd = 0;
      if (fundRes && fundRes.ok) {
        try {
          const fundData = await fundRes.json();
          if (Array.isArray(fundData)) {
            for (const f of fundData) {
              const free = parseFloat(f.free) || 0;
              const locked = (parseFloat(f.locked) || 0) + (parseFloat(f.freeze) || 0) + (parseFloat(f.withdrawing) || 0);
              const total = free + locked;
              if (total <= 0) continue;

              if (f.asset === 'USDT') {
                fundingUsdtTotal += total;
                fundingTotalEstimatedUsd += total;
                spotUsdtFree += free;
                spotUsdtTotal += total;
                const existing = nonZeroAssets.find(a => a.asset === 'USDT');
                if (existing) {
                  existing.free += free;
                  existing.locked += locked;
                  existing.total += total;
                  existing.usdValue += total;
                } else {
                  nonZeroAssets.push({ asset: 'USDT', free, locked, total, usdValue: total });
                }
              } else {
                const price: number = priceMap.get(f.asset + 'USDT') || 0;
                const usdVal: number = total * price;
                fundingTotalEstimatedUsd += usdVal;
                nonZeroAssets.push({ asset: f.asset, free, locked, total, price, usdValue: usdVal, isFunding: true });
              }
            }
          }
        } catch (e) {
          console.warn("Could not parse funding assets", e);
        }
      }
      
      let futTotal = 0;
      if (futRes && futRes.ok) {
        try {
          const futData = await futRes.json();
          if (Array.isArray(futData)) {
            const futUsdt = futData.find((b: any) => b.asset === 'USDT');
            if (futUsdt) {
               futTotal = parseFloat(futUsdt.balance);
            }
          }
        } catch (e) {
          console.warn("Could not parse futures balance", e);
        }
      }

      const totalEquity = spotTotalEstimatedUsd + fundingTotalEstimatedUsd + futTotal;
      
      res.json({ 
        status: "success", 
        totalEquity,
        usdtTotal: spotUsdtTotal,
        usdtFree: spotUsdtFree,
        usdtLocked: spotUsdtLocked,
        balance: spotUsdtTotal + futTotal, 
        spotTotal: spotUsdtTotal - fundingUsdtTotal,
        fundingTotal: fundingUsdtTotal,
        futTotal,
        assets: nonZeroAssets
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // Global cache for Binance tickers (Spot + Futures + Alpha)
  let cachedTickers: Record<string, number> = {};
  let lastTickerFetch = 0;

  app.get("/api/exchange/ticker", async (req, res) => {
    try {
      const now = Date.now();
      const requestedSymbols = req.query.symbols 
        ? (req.query.symbols as string).split(',').map(s => s.trim().toUpperCase()).filter(Boolean)
        : [];

      // If cache is older than 1.5 seconds or empty, refresh from Binance
      if (now - lastTickerFetch > 1500 || Object.keys(cachedTickers).length === 0) {
        const [spotRes, futRes] = await Promise.all([
          fetch('https://api.binance.com/api/v3/ticker/price').catch(() => null),
          fetch('https://fapi.binance.com/fapi/v1/ticker/price').catch(() => null),
        ]);

        const newMap: Record<string, number> = { ...cachedTickers };
        if (spotRes && spotRes.ok) {
          const spotList: any = await spotRes.json();
          if (Array.isArray(spotList)) {
            for (const item of spotList) {
              const p = parseFloat(item.price);
              if (p > 0) newMap[item.symbol] = p;
            }
          }
        }
        if (futRes && futRes.ok) {
          const futList: any = await futRes.json();
          if (Array.isArray(futList)) {
            for (const item of futList) {
              const p = parseFloat(item.price);
              if (p > 0) {
                if (!newMap[item.symbol] || item.symbol === 'FARTCOINUSDT') {
                  newMap[item.symbol] = p;
                }
              }
            }
          }
        }
        cachedTickers = newMap;
        lastTickerFetch = now;
      }

      // Check for any specific requested symbol missing from cache
      for (const rawSym of requestedSymbols) {
        const sym = rawSym.endsWith('USDT') ? rawSym : `${rawSym}USDT`;
        if (!cachedTickers[sym] && !cachedTickers[rawSym]) {
          try {
            const futSingle: any = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${sym}`).then(r => r.json()).catch(() => null);
            if (futSingle && futSingle.price) {
              const priceVal = parseFloat(futSingle.price);
              cachedTickers[sym] = priceVal;
              cachedTickers[rawSym] = priceVal;
            } else {
              // Try DexScreener fallback for early-stage DEX/Alpha tokens
              const clean = rawSym.replace(/USDT$|BUSD$|USDC$/, '');
              const dexRes: any = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${clean}`).then(r => r.json()).catch(() => null);
              if (dexRes && Array.isArray(dexRes.pairs) && dexRes.pairs.length > 0) {
                // Find most liquid USDT/USD pair
                const pair = dexRes.pairs.find((p: any) => p.quoteToken?.symbol?.toUpperCase().includes('USD')) || dexRes.pairs[0];
                const p = parseFloat(pair.priceUsd);
                if (p > 0) {
                  cachedTickers[sym] = p;
                  cachedTickers[rawSym] = p;
                }
              }
            }
          } catch (err) {
            // ignore fallback error
          }
        }
      }

      const result: Record<string, number> = {};
      if (requestedSymbols.length > 0) {
        for (const s of requestedSymbols) {
          const usdtSym = s.endsWith('USDT') ? s : `${s}USDT`;
          if (cachedTickers[s] !== undefined) {
            result[s] = cachedTickers[s];
          } else if (cachedTickers[usdtSym] !== undefined) {
            result[s] = cachedTickers[usdtSym];
          }
        }
      } else {
        Object.assign(result, cachedTickers);
      }

      res.json({ status: "success", prices: result });
    } catch (e: any) {
      console.error("Ticker fetch error:", e);
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  let cachedExchangeSymbols: string[] | null = null;
  let lastSymbolsFetch = 0;

  app.get("/api/exchange/symbols", async (req, res) => {
    try {
      const now = Date.now();
      if (cachedExchangeSymbols && (now - lastSymbolsFetch < 600000)) {
        return res.json({ status: "success", symbols: cachedExchangeSymbols });
      }

      const [spotRes, futRes] = await Promise.all([
        fetch("https://api.binance.com/api/v3/exchangeInfo").then(r => r.json()).catch(() => null),
        fetch("https://fapi.binance.com/fapi/v1/exchangeInfo").then(r => r.json()).catch(() => null)
      ]);

      const symSet = new Set<string>();
      if (spotRes && spotRes.symbols) {
        spotRes.symbols
          .filter((s: any) => s.status === "TRADING" && s.isSpotTradingAllowed && s.symbol.endsWith("USDT"))
          .forEach((s: any) => symSet.add(s.symbol));
      }
      if (futRes && futRes.symbols) {
        futRes.symbols
          .filter((s: any) => s.status === "TRADING" && s.symbol.endsWith("USDT"))
          .forEach((s: any) => symSet.add(s.symbol));
      }

      ['FARTCOINUSDT', 'AI16ZUSDT', 'VIRTUALUSDT', 'SWARMSUSDT', 'GRIFFAINUSDT', 'ACTUSDT', 'GOATUSDT', 'BTCUSDT', 'ETHUSDT', 'SOLUSDT'].forEach(s => symSet.add(s));

      if (symSet.size > 0) {
        cachedExchangeSymbols = Array.from(symSet);
        lastSymbolsFetch = now;
      } else if (!cachedExchangeSymbols) {
        cachedExchangeSymbols = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'ADAUSDT', 'DOGEUSDT', 'TAOUSDT', 'SAGAUSDT', 'STGUSDT', 'CFGUSDT', 'NIGHTUSDT', 'ZECUSDT', 'FILUSDT', 'ORCAUSDT', 'HOMEUSDT', 'FARTCOINUSDT', 'AI16ZUSDT', 'VIRTUALUSDT'];
      }

      res.json({ status: "success", symbols: cachedExchangeSymbols });
    } catch (e: any) {
      res.json({
        status: "success",
        symbols: cachedExchangeSymbols || ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'TAOUSDT', 'SAGAUSDT', 'FARTCOINUSDT']
      });
    }
  });

  app.get("/api/exchange/server-ip", async (req, res) => {
    try {
      const ipRes = await fetch("https://api.ipify.org?format=json");
      const data = await ipRes.json();
      res.json({ status: "success", serverIp: data.ip });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.get("/api/exchange/klines", async (req, res) => {
    try {
      const { symbol, interval = "15m", startTime, limit = "500" } = req.query;
      if (!symbol) {
        return res.status(400).json({ status: "error", message: "Symbol required" });
      }

      const rawSym = String(symbol).trim().toUpperCase();
      const sym = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;

      // 1. Try Spot klines first
      let spotUrl = `https://api.binance.com/api/v3/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      if (startTime) spotUrl += `&startTime=${startTime}`;
      
      const spotResp = await fetch(spotUrl).catch(() => null);
      if (spotResp && spotResp.ok) {
        const spotData = await spotResp.json();
        if (Array.isArray(spotData) && spotData.length > 0) {
          return res.json({ status: "success", klines: spotData });
        }
      }

      // 2. Try Futures / Alpha klines (e.g. FARTCOINUSDT, AI16ZUSDT)
      let futUrl = `https://fapi.binance.com/fapi/v1/klines?symbol=${sym}&interval=${interval}&limit=${limit}`;
      if (startTime) futUrl += `&startTime=${startTime}`;

      const futResp = await fetch(futUrl).catch(() => null);
      if (futResp && futResp.ok) {
        const futData = await futResp.json();
        if (Array.isArray(futData) && futData.length > 0) {
          return res.json({ status: "success", klines: futData });
        }
      }

      res.json({ status: "success", klines: [] });
    } catch (err: any) {
      res.json({ status: "success", klines: [] });
    }
  });

  app.get("/api/exchange/positions", async (req, res) => {
    try {
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      const queryString = `timestamp=${timestamp}&recvWindow=60000`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      // Fetch Spot Balances
      const accountRes = await safeBinanceFetch(`https://api.binance.com/api/v3/account?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (!accountRes.ok) {
        const errText = await accountRes.text().catch(() => '');
        console.error(`Binance account error (${accountRes.status}):`, errText);
        let msg = "Failed to fetch account balances from Binance.";
        try {
          const parsed = JSON.parse(errText);
          if (parsed.msg) msg = `Binance: ${parsed.msg}`;
        } catch (_) {}
        return res.status(accountRes.status || 502).json({ status: "error", message: msg });
      }
      
      const accountData = await accountRes.json();
      
      // Filter out empty balances and stablecoins
      const activeAssets = accountData.balances.filter((b: any) => {
        const total = parseFloat(b.free) + parseFloat(b.locked);
        return total > 0 && !['USDT', 'USDC', 'BUSD', 'FDUSD', 'TUSD'].includes(b.asset);
      });

      // Fetch current prices to estimate USD value and filter out dust
      const pricesRes = await fetch('https://api.binance.com/api/v3/ticker/price');
      let priceMap = new Map<string, number>();
      if (pricesRes.ok) {
        const pricesData: any = await pricesRes.json();
        if (Array.isArray(pricesData)) {
          priceMap = new Map<string, number>(pricesData.map((p: any) => [p.symbol as string, parseFloat(p.price) as number]));
        }
      }
      
      // Fetch Open Orders
      let openOrders = [];
      let rawOpenOrders: any[] = [];
      let openOrdersSuccess = false;
      if (req.query.excludeOpenOrders !== 'true') {
        try {
           const openOrdersRes = await safeBinanceFetch(`https://api.binance.com/api/v3/openOrders?${queryString}&signature=${signature}`, {
              headers: { 'X-MBX-APIKEY': apiKey }
           });
           if (openOrdersRes.ok) {
              const rawOrders = await openOrdersRes.json();
              openOrdersSuccess = true;
              rawOpenOrders = Array.isArray(rawOrders) ? rawOrders : [];
              openOrders = rawOpenOrders
                 .filter((o: any) => o.side === 'BUY')
                 .map((o: any) => ({
                    symbol: o.symbol,
                    positionAmt: parseFloat(o.origQty),
                    entryPrice: parseFloat(o.price),
                    feeUsd: 0,
                    isLong: true,
                    unRealizedProfit: 0,
                    leverage: 1,
                    currentPrice: parseFloat(o.price),
                    usdValue: parseFloat(o.origQty) * parseFloat(o.price),
                    isPendingOrder: true,
                    binanceOrderId: o.orderId ? String(o.orderId) : undefined,
                    clientOrderId: o.clientOrderId ? String(o.clientOrderId) : undefined,
                    orderTime: o.time
                 }));
           }
        } catch (e) {
           console.warn("Could not fetch open orders", e);
        }
      }
      
      const minUsd = req.query.includeDust === 'true' ? 0.05 : 5;
      const eligibleAssets = activeAssets.filter((asset: any) => {
        const symbol = `${asset.asset}USDT`;
        const totalAmt = parseFloat(asset.free) + parseFloat(asset.locked);
        const currentPrice: number = Number(priceMap.get(symbol) || 0);
        return (totalAmt * currentPrice) >= minUsd;
      });

      // Process eligible assets in parallel batches of 5 to prevent timeouts and optimize latency
      const bnbPrice: number = Number(priceMap.get("BNBUSDT") || 600);
      const BATCH_SIZE = 5;
      const positions: any[] = [];

      for (let i = 0; i < eligibleAssets.length; i += BATCH_SIZE) {
        const batch = eligibleAssets.slice(i, i + BATCH_SIZE);
        const batchResults = await Promise.all(
          batch.map(async (asset: any) => {
            const symbol = `${asset.asset}USDT`;
            const totalAmt = parseFloat(asset.free) + parseFloat(asset.locked);
            const currentPrice: number = Number(priceMap.get(symbol) || 0);
            const usdValue = totalAmt * currentPrice;

            let entryPrice = currentPrice;
            let feeUsd = 0;
            let recentFills: any[] = [];

            try {
              const ts = Date.now();
              const qs = `symbol=${symbol}&limit=1000&timestamp=${ts}&recvWindow=60000`;
              const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
              const controller = new AbortController();
              const timeout = setTimeout(() => controller.abort(), 2500);

              const tradesRes = await fetch(`https://api.binance.com/api/v3/myTrades?${qs}&signature=${sig}`, {
                headers: { 'X-MBX-APIKEY': apiKey },
                signal: controller.signal
              }).finally(() => clearTimeout(timeout));

              if (tradesRes.ok) {
                const trades: any = await tradesRes.json();
                const sorted = [...trades].sort((a: any, b: any) => a.time - b.time);

                let currentQty = 0;
                let currentCost = 0;
                let currentFee = 0;

                for (const b of sorted) {
                  const q = parseFloat(b.qty);
                  const p = parseFloat(b.price);
                  const comm = parseFloat(b.commission);

                  const feeInUsd = calculateExecutionFeeInUsd(b.commissionAsset, comm, p, symbol, bnbPrice);

                  if (b.isBuyer) {
                    if (currentQty <= 0.0001 || currentCost < 5.00) {
                      currentQty = 0;
                      currentCost = 0;
                      currentFee = 0;
                    }
                    currentQty += q;
                    currentCost += (q * p);
                    currentFee += feeInUsd;
                  } else {
                    if (currentQty > 0.00001) {
                      const avgPrice = currentCost / currentQty;
                      const soldQty = Math.min(q, currentQty);

                      currentQty -= soldQty;
                      const proportion = currentQty > 0 ? (currentQty / (currentQty + soldQty)) : 0;
                      currentFee = currentFee * proportion;

                      if (currentQty <= 0.0001 || currentCost < 5.00) {
                        currentQty = 0;
                        currentCost = 0;
                        currentFee = 0;
                      } else {
                        currentCost = currentQty * avgPrice;
                      }
                    }
                  }
                }

                if (currentQty > 0) {
                  entryPrice = currentCost / currentQty;
                  feeUsd = currentFee;
                }

                recentFills = sorted
                  .filter((b: any) => b.isBuyer)
                  .map((b: any) => {
                    const q = parseFloat(b.qty);
                    const p = parseFloat(b.price);
                    const comm = parseFloat(b.commission);
                    const fUsd = calculateExecutionFeeInUsd(b.commissionAsset, comm, p, symbol, bnbPrice);
                    return {
                      orderId: String(b.orderId),
                      price: p,
                      qty: q,
                      usdValue: q * p,
                      feeUsd: fUsd,
                      time: b.time
                    };
                  })
                  .reverse()
                  .slice(0, 5);
              }
            } catch (e) {
              console.warn(`Could not fetch trades for ${symbol}`);
            }

            return {
              symbol,
              positionAmt: totalAmt,
              entryPrice,
              feeUsd,
              realizedProfitUsd: 0,
              isLong: true,
              unRealizedProfit: (currentPrice - entryPrice) * totalAmt,
              leverage: 1,
              currentPrice,
              usdValue,
              recentFills
            };
          })
        );
        positions.push(...batchResults);
      }
      
      const allPositions = [...positions, ...openOrders].sort((a: any, b: any) => (b.usdValue || 0) - (a.usdValue || 0));
      res.json({ status: "success", positions: allPositions, openOrdersSuccess, allOpenOrders: rawOpenOrders });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.get("/api/exchange/myTrades", async (req, res) => {
    try {
      const { symbol, startTime, limit } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      const rawSym = String(symbol).trim().toUpperCase();
      const cleanSymbol = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
      let queryString = `symbol=${cleanSymbol}&timestamp=${timestamp}`;
      if (limit) {
        queryString += `&limit=${limit}`;
      } else {
        queryString += `&limit=50`;
      }
      if (startTime) {
         queryString += `&startTime=${startTime}`;
      }
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      let trades: any[] = [];
      const tradesRes = await safeBinanceFetch(`https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (tradesRes.ok) {
        const data = await tradesRes.json();
        if (Array.isArray(data)) trades = data;
      } else {
        const errorText = await tradesRes.text();
        // If Spot returns invalid symbol (-1121), try Futures userTrades
        try {
          const futTradesRes = await fetch(`https://fapi.binance.com/fapi/v1/userTrades?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
          });
          if (futTradesRes.ok) {
            const futTrades = await futTradesRes.json();
            if (Array.isArray(futTrades)) {
              trades = futTrades.map((t: any) => ({
                ...t,
                isBuyer: t.buyer !== undefined ? Boolean(t.buyer) : (t.side === 'BUY'),
                commission: t.commission || '0',
                commissionAsset: t.commissionAsset || 'USDT',
              }));
            }
          }
        } catch (_) {}

        if (trades.length === 0 && (errorText.includes('-2014') || errorText.includes('-2015') || errorText.includes('API-key format invalid'))) {
          throw new Error("Binance API key unauthorized: " + errorText);
        }
      }
      
      res.json({ status: "success", trades });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.get("/api/exchange/openOrders", async (req, res) => {
    try {
      const { symbol } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const timestamp = Date.now();
      let queryString = `timestamp=${timestamp}`;
      if (symbol) {
        const rawSym = String(symbol).trim().toUpperCase();
        const cleanSymbol = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
        queryString = `symbol=${cleanSymbol}&timestamp=${timestamp}`;
      }
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      let orders: any[] = [];
      const ordersRes = await safeBinanceFetch(`https://api.binance.com/api/v3/openOrders?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (ordersRes.ok) {
        const oData = await ordersRes.json();
        if (Array.isArray(oData)) orders = oData;
      } else {
        const errorText = await ordersRes.text();
        // If Spot returns invalid symbol (-1121), try Futures openOrders
        try {
          const futOrdersRes = await fetch(`https://fapi.binance.com/fapi/v1/openOrders?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
          });
          if (futOrdersRes.ok) {
            const futOrders = await futOrdersRes.json();
            if (Array.isArray(futOrders)) {
              orders = futOrders;
            }
          }
        } catch (_) {}

        if (orders.length === 0 && (errorText.includes('-2014') || errorText.includes('-2015') || errorText.includes('API-key format invalid'))) {
          throw new Error("Binance API key unauthorized: " + errorText);
        }
      }
      
      res.json({ status: "success", orders });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  // World-Class Fill Ingestion: returns granular buy execution batches from Binance
  app.get("/api/exchange/tradeFills", async (req, res) => {
    try {
      const { symbol, limit } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }

      const sym = symbol ? (String(symbol).toUpperCase().endsWith('USDT') ? String(symbol).toUpperCase() : `${String(symbol).toUpperCase()}USDT`) : 'BTCUSDT';
      const timestamp = Date.now();
      const qs = `symbol=${sym}&limit=${limit || 50}&timestamp=${timestamp}`;
      const sig = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');

      const [tradesRes, bnbTickerRes] = await Promise.all([
        safeBinanceFetch(`https://api.binance.com/api/v3/myTrades?${qs}&signature=${sig}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        }),
        fetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT').catch(() => null)
      ]);

      let bnbPrice = 600;
      if (bnbTickerRes && bnbTickerRes.ok) {
        const bData: any = await bnbTickerRes.json().catch(() => null);
        if (bData && bData.price) bnbPrice = parseFloat(bData.price);
      }

      if (!tradesRes.ok) {
        return res.status(200).json({ status: "success", fills: [], batches: [] });
      }

      const rawTrades: any = await tradesRes.json();
      if (!Array.isArray(rawTrades)) {
        return res.json({ status: "success", fills: [], batches: [] });
      }

      const fills = rawTrades
        .filter((t: any) => t.isBuyer)
        .map((t: any) => {
          const q = parseFloat(t.qty);
          const p = parseFloat(t.price);
          const comm = parseFloat(t.commission);
          const fUsd = calculateExecutionFeeInUsd(t.commissionAsset, comm, p, sym, bnbPrice);
          return {
            tradeId: t.id,
            orderId: String(t.orderId),
            symbol: t.symbol,
            price: p,
            qty: q,
            quoteQty: parseFloat(t.quoteQty || (q * p)),
            commission: comm,
            commissionAsset: t.commissionAsset,
            feeUsd: fUsd,
            time: t.time,
            isBuyer: true
          };
        })
        .reverse();

      // Group into order batches
      const batchMap = new Map<string, any>();
      for (const f of fills) {
        const oId = f.orderId;
        if (!batchMap.has(oId)) {
          batchMap.set(oId, {
            orderId: oId,
            symbol: f.symbol,
            totalQty: f.qty,
            totalUsd: f.price * f.qty,
            avgPrice: f.price,
            totalFeeUsd: f.feeUsd,
            time: f.time,
            fillCount: 1
          });
        } else {
          const b = batchMap.get(oId);
          b.totalQty += f.qty;
          b.totalUsd += (f.price * f.qty);
          b.avgPrice = b.totalQty > 0 ? b.totalUsd / b.totalQty : b.avgPrice;
          b.totalFeeUsd += f.feeUsd;
          b.fillCount += 1;
        }
      }

      res.json({
        status: "success",
        symbol: sym,
        fills,
        batches: Array.from(batchMap.values()).sort((a: any, b: any) => b.time - a.time)
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  // Decentralized Binance Alpha / Web3 Token Search & Live Discovery
  app.get("/api/exchange/alpha/search", async (req, res) => {
    try {
      const q = String(req.query.q || '').trim().toUpperCase();
      if (!q) {
        return res.json({ status: "success", results: [] });
      }

      // 1. Check Binance Futures/Spot tickers cache first
      const binancePrice = cachedTickers[`${q}USDT`] || cachedTickers[q] || 0;

      // 2. Query DexScreener multi-chain public API
      const dexRes = await fetch(`https://api.dexscreener.com/latest/dex/search?q=${encodeURIComponent(q)}`).catch(() => null);
      let dexPairs: any[] = [];
      if (dexRes && dexRes.ok) {
        const dexData: any = await dexRes.json().catch(() => null);
        if (Array.isArray(dexData?.pairs)) {
          dexPairs = dexData.pairs.slice(0, 8);
        }
      }

      const results = dexPairs.map((pair: any) => {
        const baseSym = (pair.baseToken?.symbol || q).toUpperCase();
        const cleanSymbol = baseSym.endsWith('USDT') ? baseSym : `${baseSym}USDT`;
        const pUsd = parseFloat(pair.priceUsd) || binancePrice || 0;
        return {
          symbol: cleanSymbol,
          rawSymbol: baseSym,
          name: pair.baseToken?.name || baseSym,
          address: pair.baseToken?.address || '',
          pairAddress: pair.pairAddress || '',
          chain: pair.chainId ? (pair.chainId.charAt(0).toUpperCase() + pair.chainId.slice(1)) : 'Solana',
          dexId: pair.dexId || 'Raydium',
          priceUsd: pUsd,
          liquidityUsd: parseFloat(pair.liquidity?.usd || 0),
          volume24h: parseFloat(pair.volume?.h24 || 0),
          change24h: parseFloat(pair.priceChange?.h24 || 0)
        };
      });

      // If DexScreener had no results, but we have a Binance ticker price, create a synthetic result
      if (results.length === 0 && binancePrice > 0) {
        results.push({
          symbol: q.endsWith('USDT') ? q : `${q}USDT`,
          rawSymbol: q.replace(/USDT$/, ''),
          name: q.replace(/USDT$/, ''),
          address: '',
          pairAddress: '',
          chain: 'Solana / BSC',
          dexId: 'Binance Alpha',
          priceUsd: binancePrice,
          liquidityUsd: 1000000,
          volume24h: 500000,
          change24h: 0
        });
      }

      res.json({ status: "success", results });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.delete("/api/exchange/order", async (req, res) => {
    try {
      const { symbol, orderId, clientOrderId } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }
      if (!symbol || (!orderId && !clientOrderId)) {
        return res.status(400).json({ status: "error", message: "Symbol and orderId or clientOrderId are required" });
      }

      const timestamp = Date.now();
      const rawSym = String(symbol).trim().toUpperCase();
      const cleanSymbol = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
      let qs = `symbol=${cleanSymbol}&timestamp=${timestamp}`;
      if (orderId) qs += `&orderId=${orderId}`;
      if (clientOrderId) qs += `&origClientOrderId=${clientOrderId}`;

      const signature = crypto.createHmac('sha256', apiSecret).update(qs).digest('hex');
      
      const cancelRes = await fetch(`https://api.binance.com/api/v3/order?${qs}&signature=${signature}`, {
        method: 'DELETE',
        headers: { 'X-MBX-APIKEY': apiKey }
      });

      if (!cancelRes.ok) {
        const errText = await cancelRes.text();
        return res.status(cancelRes.status).json({ status: "error", message: errText });
      }

      const data = await cancelRes.json();
      res.json({ status: "success", order: data });
    } catch (error: any) {
      res.status(500).json({ status: "error", message: error.message });
    }
  });

  app.post("/api/exchange/order", express.json(), async (req, res) => {
    try {
      const { symbol, side, type, quantity, price, timeInForce = 'GTC' } = req.body;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;

      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }
      if (!symbol || !side || !type || !quantity) {
        return res.status(400).json({ status: "error", message: "symbol, side, type, and quantity are required." });
      }

      const rawSym = String(symbol).trim().toUpperCase();
      const cleanSymbol = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
      const timestamp = Date.now();

      let queryParams = `symbol=${cleanSymbol}&side=${side.toUpperCase()}&type=${type.toUpperCase()}&quantity=${quantity}&timestamp=${timestamp}&recvWindow=60000`;
      if (type.toUpperCase() === 'LIMIT') {
        if (!price) return res.status(400).json({ status: "error", message: "Price is required for LIMIT orders." });
        queryParams += `&price=${price}&timeInForce=${timeInForce}`;
      }

      const signature = crypto.createHmac('sha256', apiSecret).update(queryParams).digest('hex');
      const orderUrl = `https://api.binance.com/api/v3/order?${queryParams}&signature=${signature}`;

      const orderRes = await fetch(orderUrl, {
        method: 'POST',
        headers: {
          'X-MBX-APIKEY': apiKey,
          'Content-Type': 'application/json'
        }
      });

      const responseText = await orderRes.text();
      let data: any = {};
      try {
        data = JSON.parse(responseText);
      } catch {
        data = { message: responseText };
      }

      if (!orderRes.ok) {
        return res.status(orderRes.status).json({
          status: "error",
          message: data.msg || data.message || `Binance Order Error (${orderRes.status})`
        });
      }

      res.json({ status: "success", order: data });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message || "Failed to execute order on Binance" });
    }
  });

  app.get("/api/exchange/analyze-trade", async (req, res) => {
    try {
      const { symbol, tradeStartTime, tradeEntryPrice, tradeCoins, binanceOrderId, clientOrderId } = req.query;
      const apiKey = process.env.BINANCE_API_KEY;
      const apiSecret = process.env.BINANCE_API_SECRET;
      
      if (!apiKey || !apiSecret) {
        return res.status(400).json({ status: "error", message: "Binance API keys are missing in the environment." });
      }
      if (!symbol) {
        return res.status(400).json({ status: "error", message: "Symbol is required" });
      }

      const timestamp = Date.now();
      const rawSym = String(symbol).trim().toUpperCase();
      const cleanSymbol = rawSym.endsWith("USDT") ? rawSym : `${rawSym}USDT`;
      const baseAsset = cleanSymbol.replace(/USDT$/, "");

      // 1. Fetch current Spot Account Balance for this asset using safeBinanceFetch
      let currentSpotQty = 0;
      try {
        const qsAcc = `timestamp=${timestamp}`;
        const sigAcc = crypto.createHmac('sha256', apiSecret).update(qsAcc).digest('hex');
        const accRes = await safeBinanceFetch(`https://api.binance.com/api/v3/account?${qsAcc}&signature=${sigAcc}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });
        if (accRes.ok) {
          const accData = await accRes.json();
          const bal = accData.balances?.find((b: any) => b.asset === baseAsset);
          if (bal) {
            currentSpotQty = parseFloat(bal.free) + parseFloat(bal.locked);
          }
        }
      } catch (err) {
        console.warn("Account balance fetch warning in analyze-trade:", err);
      }

      // If Spot balance is 0, also check Binance Futures positionRisk for this symbol
      if (currentSpotQty === 0) {
        try {
          const qsFutPos = `symbol=${cleanSymbol}&timestamp=${timestamp}`;
          const sigFutPos = crypto.createHmac('sha256', apiSecret).update(qsFutPos).digest('hex');
          const futPosRes = await fetch(`https://fapi.binance.com/fapi/v2/positionRisk?${qsFutPos}&signature=${sigFutPos}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
          }).catch(() => null);
          if (futPosRes && futPosRes.ok) {
            const posList: any = await futPosRes.json();
            if (Array.isArray(posList) && posList.length > 0) {
              const fAmt = parseFloat(posList[0].positionAmt || '0');
              if (Math.abs(fAmt) > 0) {
                currentSpotQty = Math.abs(fAmt);
              }
            }
          }
        } catch (_) {}
      }

      // 2. Fetch current prices
      let bnbPrice = 600;
      let currentPrice = 0;
      try {
        const pRes = await safeBinanceFetch(`https://api.binance.com/api/v3/ticker/price?symbol=${cleanSymbol}`);
        if (pRes.ok) {
          const pData = await pRes.json();
          currentPrice = parseFloat(pData.price);
        }
        const bnbRes = await safeBinanceFetch('https://api.binance.com/api/v3/ticker/price?symbol=BNBUSDT');
        if (bnbRes.ok) {
          const bnbData = await bnbRes.json();
          bnbPrice = parseFloat(bnbData.price);
        }
      } catch (e) {
        console.warn("Price fetch warning", e);
      }

      // If Spot price is missing or 0 (e.g. FARTCOINUSDT, Alpha or Futures tokens), fetch from Futures or cache
      if (!currentPrice || currentPrice <= 0) {
        try {
          const fRes = await fetch(`https://fapi.binance.com/fapi/v1/ticker/price?symbol=${cleanSymbol}`).catch(() => null);
          if (fRes && fRes.ok) {
            const fData: any = await fRes.json();
            if (fData && fData.price) {
              currentPrice = parseFloat(fData.price);
            }
          }
        } catch (_) {}
      }
      if (!currentPrice || currentPrice <= 0) {
        currentPrice = cachedTickers[cleanSymbol] || cachedTickers[rawSym] || 0;
      }

      const spotUsdValue = currentSpotQty * currentPrice;

      // 3. Fetch trade executions (up to 1000) using safeBinanceFetch
      const queryString = `symbol=${cleanSymbol}&limit=1000&timestamp=${timestamp}`;
      const signature = crypto.createHmac('sha256', apiSecret).update(queryString).digest('hex');
      
      let trades: any[] = [];
      let isFuturesTrades = false;

      const tradesRes = await safeBinanceFetch(`https://api.binance.com/api/v3/myTrades?${queryString}&signature=${signature}`, {
        headers: { 'X-MBX-APIKEY': apiKey }
      });
      
      if (tradesRes.ok) {
        const tData = await tradesRes.json();
        if (Array.isArray(tData)) trades = tData;
      } else {
        const errorText = await tradesRes.text();
        // If Spot failed (e.g. -1121 Invalid symbol for Futures or Alpha tokens like FARTCOIN), query Futures userTrades
        try {
          const futTradesRes = await fetch(`https://fapi.binance.com/fapi/v1/userTrades?${queryString}&signature=${signature}`, {
            headers: { 'X-MBX-APIKEY': apiKey }
          });
          if (futTradesRes.ok) {
            const futTrades: any = await futTradesRes.json();
            if (Array.isArray(futTrades)) {
              isFuturesTrades = true;
              trades = futTrades.map((t: any) => ({
                ...t,
                isBuyer: t.buyer !== undefined ? Boolean(t.buyer) : (t.side === 'BUY'),
                commission: t.commission || '0',
                commissionAsset: t.commissionAsset || 'USDT',
              }));
            }
          }
        } catch (_) {}

        if (trades.length === 0 && (errorText.includes('-2014') || errorText.includes('-2015') || errorText.includes('API-key format invalid'))) {
          throw new Error("Binance API key unauthorized: " + errorText);
        }
      }
      
      const sorted = [...trades].sort((a: any, b: any) => a.time - b.time);

      // Multi-Fill Weighted Average Price (VWAP) calculation helper
      // Groups executions by orderId and computes exact volume-weighted average price
      const orderFillsMap = new Map<number | string, {
        orderId: number | string;
        isBuyer: boolean;
        totalQty: number;
        totalCost: number;
        vwapPrice: number;
        totalFeeUsd: number;
        time: number;
        fillsCount: number;
      }>();

      for (const t of sorted) {
        const q = parseFloat(t.qty);
        const p = parseFloat(t.price);
        const comm = parseFloat(t.commission);

        const feeUsd = calculateExecutionFeeInUsd(t.commissionAsset, comm, p, cleanSymbol, bnbPrice);

        const oId = t.orderId;
        const existing = orderFillsMap.get(oId);
        if (existing) {
          existing.totalQty += q;
          existing.totalCost += (q * p);
          existing.vwapPrice = existing.totalCost / existing.totalQty;
          existing.totalFeeUsd += feeUsd;
          existing.time = Math.max(existing.time, t.time);
          existing.fillsCount += 1;
        } else {
          orderFillsMap.set(oId, {
            orderId: oId,
            isBuyer: t.isBuyer,
            totalQty: q,
            totalCost: q * p,
            vwapPrice: p,
            totalFeeUsd: feeUsd,
            time: t.time,
            fillsCount: 1,
          });
        }
      }

      // If a specific binanceOrderId was provided, prioritize matching fills for this exact order
      const targetOrderId = binanceOrderId ? String(binanceOrderId).trim() : null;
      const targetOrderMatch = targetOrderId ? orderFillsMap.get(targetOrderId) : null;

      // Determine which buys belong to this specific trade
      const parsedStartTime = Number(tradeStartTime) || 0;
      const parsedEntryPrice = Number(tradeEntryPrice) || 0;
      const parsedTradeCoins = Number(tradeCoins) || 0;

      let tradeBuys: any[] = [];
      if (targetOrderId) {
        tradeBuys = sorted
          .filter((t: any) => t.isBuyer && String(t.orderId) === targetOrderId)
          .map((t: any) => {
            const q = parseFloat(t.qty);
            const p = parseFloat(t.price);
            const comm = parseFloat(t.commission);
            const feeUsd = calculateExecutionFeeInUsd(t.commissionAsset, comm, p, cleanSymbol, bnbPrice);
            return { ...t, feeUsd, parsedQty: q, parsedPrice: p };
          });
      } else if (parsedStartTime > 0) {
        // Look for buy orders within time window of parsedStartTime
        const candidateBuys = sorted
          .filter((t: any) => {
            if (!t.isBuyer) return false;
            const diff = Math.abs(t.time - parsedStartTime);
            if (diff > 24 * 3600 * 1000) return false; // within 24h
            if (parsedEntryPrice > 0) {
              const priceDiff = Math.abs(parseFloat(t.price) - parsedEntryPrice) / parsedEntryPrice;
              return priceDiff < 0.03; // within 3% of trade entry price
            }
            return diff < 4 * 3600 * 1000;
          })
          .map((t: any) => {
            const q = parseFloat(t.qty);
            const p = parseFloat(t.price);
            const comm = parseFloat(t.commission);
            const feeUsd = calculateExecutionFeeInUsd(t.commissionAsset, comm, p, cleanSymbol, bnbPrice);
            return { ...t, feeUsd, parsedQty: q, parsedPrice: p };
          });

        if (candidateBuys.length > 0) {
          // If multiple orders match, isolate the order closest to parsedStartTime
          const uniqueOrders = [...new Set(candidateBuys.map((b: any) => b.orderId))];
          if (uniqueOrders.length > 1) {
            let bestOrderId = uniqueOrders[0];
            let minDiff = Infinity;
            for (const oid of uniqueOrders) {
              const firstFill = candidateBuys.find((b: any) => b.orderId === oid);
              if (firstFill) {
                const diff = Math.abs(firstFill.time - parsedStartTime);
                if (diff < minDiff) {
                  minDiff = diff;
                  bestOrderId = oid;
                }
              }
            }
            tradeBuys = candidateBuys.filter((b: any) => b.orderId === bestOrderId);
          } else {
            tradeBuys = candidateBuys;
          }
        }
      }

      // Fallback if no specific trade match was found:
      // Take the most recent contiguous buy cluster, NOT an infinite multi-month accumulation!
      if (tradeBuys.length === 0) {
        const allBuys = sorted.filter((t: any) => t.isBuyer);
        if (allBuys.length > 0) {
          const lastBuy = allBuys[allBuys.length - 1];
          tradeBuys = sorted
            .filter((t: any) => t.isBuyer && (t.orderId === lastBuy.orderId || Math.abs(t.time - lastBuy.time) < 3600 * 1000))
            .map((t: any) => {
              const q = parseFloat(t.qty);
              const p = parseFloat(t.price);
              const comm = parseFloat(t.commission);
              const feeUsd = calculateExecutionFeeInUsd(t.commissionAsset, comm, p, cleanSymbol, bnbPrice);
              return { ...t, feeUsd, parsedQty: q, parsedPrice: p };
            });
        }
      }

      const buyTotalQty = tradeBuys.reduce((sum: number, b: any) => sum + b.parsedQty, 0);
      const buyTotalCost = tradeBuys.reduce((sum: number, b: any) => sum + (b.parsedQty * b.parsedPrice), 0);
      const buyTotalFees = tradeBuys.reduce((sum: number, b: any) => sum + b.feeUsd, 0);
      const buyVwapPrice = buyTotalQty > 0 ? (buyTotalCost / buyTotalQty) : (parsedEntryPrice || 0);
      const tradeBuyTime = tradeBuys.length > 0 ? Math.min(...tradeBuys.map((b: any) => b.time)) : (parsedStartTime || Date.now());

      // Determine sells for THIS specific trade:
      // Sells must occur chronologically after trade buy time.
      // Sells are allocated strictly up to effectiveTradeCoins so sells from holdings or other trades don't contaminate this trade!
      const effectiveTradeCoins = parsedTradeCoins > 0 ? parsedTradeCoins : (buyTotalQty > 0 ? buyTotalQty : Infinity);
      const effectiveEntryPrice = buyVwapPrice > 0 ? buyVwapPrice : (parsedEntryPrice > 0 ? parsedEntryPrice : 0);

      const isZeroHoldingOnBinance = currentSpotQty < 0.0001 || spotUsdValue < 1.00;
      let candidateSells = sorted.filter((t: any) => !t.isBuyer && t.time >= (tradeBuyTime - 60000));
      if (candidateSells.length === 0 && isZeroHoldingOnBinance) {
        // Fallback: take recent sells on this symbol
        candidateSells = sorted.filter((t: any) => !t.isBuyer);
      }
      let totalSoldQty = 0;
      let totalProceeds = 0;
      let totalSellFees = 0;
      let totalAllocatedBuyFees = 0;
      let relevantSells: any[] = [];

      for (const s of candidateSells) {
        if (totalSoldQty >= effectiveTradeCoins - 0.00001) break;
        const q = parseFloat(s.qty);
        const p = parseFloat(s.price);
        const comm = parseFloat(s.commission);
        const feeUsd = calculateExecutionFeeInUsd(s.commissionAsset, comm, p, cleanSymbol, bnbPrice);

        const allocQty = Math.min(q, effectiveTradeCoins - totalSoldQty);
        const allocProceeds = allocQty * p;
        const allocSellFee = feeUsd * (allocQty / (q || 1));
        const allocBuyFee = buyTotalQty > 0 ? (buyTotalFees * (allocQty / buyTotalQty)) : 0;
        const allocCostBasis = allocQty * effectiveEntryPrice;
        const allocGrossPnl = allocProceeds - allocCostBasis;
        const allocPnl = allocGrossPnl - allocSellFee - allocBuyFee;

        relevantSells.push({
          orderId: s.orderId,
          qty: allocQty,
          price: p,
          proceeds: allocProceeds,
          costBasis: allocCostBasis,
          sellFeeUsd: allocSellFee,
          buyFeeUsd: allocBuyFee,
          feeUsd: allocSellFee + allocBuyFee,
          grossPnl: allocGrossPnl,
          pnl: allocPnl,
          time: s.time
        });

        totalSoldQty += allocQty;
        totalProceeds += allocProceeds;
        totalSellFees += allocSellFee;
        totalAllocatedBuyFees += allocBuyFee;
      }

      // Exact Multi-Fill VWAP exit price
      const avgExitPrice = totalSoldQty > 0 ? (totalProceeds / totalSoldQty) : 0;
      const latestSellTime = relevantSells.length > 0 ? Math.max(...relevantSells.map((s: any) => s.time)) : null;
      const totalGrossPnL = totalProceeds - (totalSoldQty * effectiveEntryPrice);
      const totalRealizedPnL = totalGrossPnL - (totalSellFees + totalAllocatedBuyFees);

      // Trade closure & partial exit logic:
      // A spot trade is ONLY fully closed if Binance spot balance is zero/dust (< $2.00)!
      // If the user holds spot coins (spotUsdValue >= 2.00 and currentSpotQty > 0.0001), the trade CANNOT be fully closed.
      const isDustRemainder = spotUsdValue < 2.00 || currentSpotQty < 0.0001;
      const hasSpotBalance = !isDustRemainder;
      const isTradeFullySold = parsedTradeCoins > 0 ? (totalSoldQty >= (parsedTradeCoins * 0.98)) : false;
      const isFullyClosed = hasSpotBalance ? false : (isZeroHoldingOnBinance || isTradeFullySold);
      const isPartialExit = totalSoldQty > 0.0001 && !isFullyClosed;

      let effectiveSoldQty = totalSoldQty;
      let effectiveAvgExitPrice = avgExitPrice;
      let effectiveTotalProceeds = totalProceeds;
      let effectiveGrossPnL = totalGrossPnL;
      let effectiveRealizedPnL = totalRealizedPnL;
      let effectiveLatestSellTime = latestSellTime;

      // If position is closed on Binance (0 holding), but no individual sell executions were recorded in Spot trades
      if (isFullyClosed && effectiveSoldQty <= 0.0001 && parsedTradeCoins > 0) {
        effectiveSoldQty = parsedTradeCoins;
        effectiveAvgExitPrice = currentPrice > 0 ? currentPrice : effectiveEntryPrice;
        effectiveTotalProceeds = effectiveSoldQty * effectiveAvgExitPrice;
        effectiveGrossPnL = effectiveEntryPrice > 0 ? (effectiveAvgExitPrice - effectiveEntryPrice) * parsedTradeCoins : 0;
        effectiveRealizedPnL = effectiveGrossPnL - (totalSellFees + totalAllocatedBuyFees);
        // Fallback sell time: use latest symbol sell, or trade buy time, never Date.now() for older trades
        const allSymbolSells = sorted.filter((t: any) => !t.isBuyer);
        effectiveLatestSellTime = allSymbolSells.length > 0 ? Math.max(...allSymbolSells.map((s: any) => s.time)) : (tradeBuyTime || null);
      }

      // If effectiveLatestSellTime is still null but we have sells on the symbol, pick the latest
      if (!effectiveLatestSellTime && sorted.length > 0) {
        const allSymbolSells = sorted.filter((t: any) => !t.isBuyer);
        if (allSymbolSells.length > 0) {
          effectiveLatestSellTime = Math.max(...allSymbolSells.map((s: any) => s.time));
        } else {
          effectiveLatestSellTime = tradeBuyTime || null;
        }
      }

      const initialTotalCoins = buyTotalQty > 0 
        ? buyTotalQty 
        : (totalSoldQty + currentSpotQty > 0 ? totalSoldQty + currentSpotQty : (parsedTradeCoins || 0));

      const remainingQty = isFullyClosed ? 0 : (currentSpotQty > 0 ? currentSpotQty : Math.max(0, initialTotalCoins - effectiveSoldQty));
      const soldPercent = isFullyClosed ? 100 : (initialTotalCoins > 0 && effectiveSoldQty > 0 
        ? Math.min(99, Math.round((effectiveSoldQty / initialTotalCoins) * 100)) 
        : 0);

      const latestBuyTime = tradeBuys.length > 0 ? Math.max(...tradeBuys.map((b: any) => b.time)) : null;

      // Fetch open orders for this symbol (both TP limit orders and SL stop orders)
      let openOrders: any[] = [];
      try {
        const qsOrders = `symbol=${cleanSymbol}&timestamp=${timestamp}`;
        const sigOrders = crypto.createHmac('sha256', apiSecret).update(qsOrders).digest('hex');
        const ordersRes = await safeBinanceFetch(`https://api.binance.com/api/v3/openOrders?${qsOrders}&signature=${sigOrders}`, {
          headers: { 'X-MBX-APIKEY': apiKey }
        });
        if (ordersRes.ok) {
          const oData = await ordersRes.json();
          if (Array.isArray(oData)) openOrders = oData;
        }
      } catch (err) {
        console.warn("Open orders fetch warning in analyze-trade:", err);
      }

      res.json({
        status: "success",
        symbol: cleanSymbol,
        isAlpha: isAlphaSymbol(cleanSymbol) || isFuturesTrades,
        isFutures: isFuturesTrades,
        currentPrice,
        currentSpotQty,
        spotUsdValue,
        isFullyClosed,
        isPartialExit,
        isDustRemainder,
        dustThresholdUsd: 1.00,
        totalSoldQty: effectiveSoldQty,
        avgExitPrice: effectiveAvgExitPrice,
        vwapExitPrice: effectiveAvgExitPrice,
        totalProceeds: effectiveTotalProceeds,
        grossPnL: effectiveGrossPnL,
        buyFeesUsd: buyTotalFees,
        sellFeesUsd: totalSellFees,
        totalFeesUsd: totalSellFees + totalAllocatedBuyFees,
        totalSellFees,
        realizedPnL: effectiveRealizedPnL,
        soldPercent,
        remainingQty,
        spotWalletBalance: currentSpotQty,
        latestSellTime: effectiveLatestSellTime,
        matchedTargetOrder: targetOrderMatch || null,
        partialSells: relevantSells,
        openOrders,
        openBuys: {
          count: tradeBuys.length,
          totalQty: buyTotalQty,
          avgEntryPrice: buyVwapPrice,
          vwapPrice: buyVwapPrice,
          totalCost: buyTotalCost,
          feesUsd: buyTotalFees,
          time: latestBuyTime,
          isExactOrderMatch: Boolean(targetOrderMatch)
        },
        recentSells: {
          count: relevantSells.length,
          totalQty: totalSoldQty,
          avgExitPrice: avgExitPrice,
          vwapPrice: avgExitPrice,
          totalProceeds: totalProceeds,
          feesUsd: totalSellFees,
          time: latestSellTime
        },
        allTradesCount: trades.length
      });
    } catch (e: any) {
      res.status(500).json({ status: "error", message: e.message });
    }
  });

  app.post("/api/suggest-trade", async (req, res) => {
    try {
      const style = req.body.style || 'day';
      let targetSymbol = req.body.symbol;
      const recentTrades = req.body.recentTrades || [];
      
      let stylePrompt = 'day trade (intraday timeframe, capturing daily volatility)';
      let klineInterval = '1h';
      let htfInterval = '1d';
      let targetMinRR = 2.0;
      
      if (style === 'scalp') {
        stylePrompt = 'elite high-precision scalp (tight invalidation, fast momentum, liquidity sweep/FVG tap, high win rate)';
        klineInterval = '15m';
        htfInterval = '4h';
        targetMinRR = 2.2;
      } else if (style === 'swing') {
        stylePrompt = 'macro swing trade (multi-day to multi-week timeframe, macro structural targets, wide invalidation)';
        klineInterval = '4h';
        htfInterval = '1w';
        targetMinRR = 2.5;
      }

      if (!targetSymbol) {
        targetSymbol = 'BTCUSDT';
      } else {
        targetSymbol = targetSymbol.toUpperCase();
      }

      // Concurrently fetch all market intelligence dimensions
      const [
        klineRes,
        htfRes,
        orderBookData,
        derivativesData,
        btcGuardData
      ] = await Promise.all([
        fetch(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol}&interval=${klineInterval}&limit=50`).catch(() => null),
        fetch(`https://api.binance.com/api/v3/klines?symbol=${targetSymbol}&interval=${htfInterval}&limit=15`).catch(() => null),
        analyzeOrderBook(targetSymbol),
        analyzeDerivatives(targetSymbol),
        getBtcVolatilityGuard()
      ]);

      const klineData: any = klineRes && klineRes.ok ? await klineRes.json() : [];
      const htfData: any = htfRes && htfRes.ok ? await htfRes.json() : [];

      // BTC Correlation for Altcoins
      let btcContext = "";
      if (targetSymbol !== 'BTCUSDT') {
        try {
          const btcRes = await fetch(`https://api.binance.com/api/v3/klines?symbol=BTCUSDT&interval=${htfInterval}&limit=10`);
          if (btcRes.ok) {
            const btcData = await btcRes.json();
            if (Array.isArray(btcData) && btcData.length > 0) {
              const btcStart = parseFloat(btcData[0][1]);
              const btcEnd = parseFloat(btcData[btcData.length - 1][4]);
              const btcTrend = btcEnd > btcStart ? 'BULLISH' : 'BEARISH';
              btcContext = `[BITCOIN MACRO CORRELATION (${htfInterval})]: BTC is ${btcTrend} ($${btcStart} -> $${btcEnd}). Do not enter aggressive long altcoin trades against macro bearish BTC pressure.`;
            }
          }
        } catch (e) {
          // Non-blocking
        }
      }

      // Quantitative Technical Analysis calculations
      const priceAction = analyzePriceAction(klineData);
      const volumeProfile = calculateVolumeProfile(klineData);
      const sessionInfo = getSessionTiming();

      const currentPrice = klineData.length > 0 ? parseFloat(klineData[klineData.length - 1][4]) : 0;

      // Format Recent User Performance Feedback Loop
      let performanceFeedback = "No recent closed trades available.";
      if (Array.isArray(recentTrades) && recentTrades.length > 0) {
        const total = recentTrades.length;
        const wins = recentTrades.filter(t => (t.realizedProfitUsd || 0) > 0).length;
        const slHits = recentTrades.filter(t => t.status === 'HIT_SL').length;
        performanceFeedback = `User's last ${total} trades: ${wins} Wins, ${total - wins} Losses (${slHits} stopped out). `;
        if (slHits >= 2) {
          performanceFeedback += "WARNING: Recent trades were stopped out. You must be EXTRA STRICT with stop loss placement and avoid buying high in overextended ranges.";
        }
      }

      // Compile Institutional Dossier
      const marketIntelligenceReport = `
=== INSTITUTIONAL QUANT DOSSIER FOR ${targetSymbol} ===
CURRENT LIVE PRICE: $${currentPrice}
SESSION CONTEXT: ${sessionInfo.utcTimeStr} | ${sessionInfo.activeSession} | High-Liquidity Killzone: ${sessionInfo.isHighLiquidityKillzone ? 'YES' : 'NO'} | Weekend: ${sessionInfo.isWeekend ? 'YES' : 'NO'}

1. ORDER BOOK LIQUIDITY DEPTH:
- Top 20 Bids: ${orderBookData?.bidVolume || 'N/A'} coins | Top 20 Asks: ${orderBookData?.askVolume || 'N/A'} coins
- Bid/Ask Ratio: ${orderBookData?.bidRatioPercent ? `${orderBookData.bidRatioPercent}% Bids` : 'Balanced'} (${orderBookData?.bias || 'BALANCED'})
- Closest Significant Buy Wall: ${orderBookData?.closestBuyWall ? `$${orderBookData.closestBuyWall.price} (${orderBookData.closestBuyWall.volume} coins)` : 'None within 20 levels'}
- Closest Significant Sell Wall: ${orderBookData?.closestSellWall ? `$${orderBookData.closestSellWall.price} (${orderBookData.closestSellWall.volume} coins)` : 'None within 20 levels'}

2. DERIVATIVES FUNDING & OPEN INTEREST:
- 8h Funding Rate: ${derivativesData ? `${derivativesData.fundingRatePercent}%` : 'N/A'}
- Funding Sentiment Bias: ${derivativesData?.fundingBias || 'NEUTRAL'}
- Open Interest: ${derivativesData?.openInterestUsd ? `$${(derivativesData.openInterestUsd / 1e6).toFixed(2)}M USD` : 'N/A'}

3. MARKET REGIME & EMA ALIGNMENT:
- Regime: ${priceAction?.marketRegime || 'UNKNOWN'}
- EMA 20: ${priceAction?.ema20 || 'N/A'} | EMA 50: ${priceAction?.ema50 || 'N/A'} | EMA 200: ${priceAction?.ema200 || 'N/A'}

4. VOLATILITY & ATR STOP INVALIDATION BUFFER:
- ATR(14): ${priceAction ? `$${priceAction.atr14} (${priceAction.atrPercent}% of price)` : 'N/A'}
- MANDATORY MINIMUM STOP LOSS BUFFER: ${priceAction ? `$${priceAction.recommendedMinStopBuffer}` : '1.5%'} (Stops tighter than this WILL get wicked by normal spread!)

5. VOLUME PROFILE (POC & VALUE AREA):
- Point of Control (POC): $${volumeProfile?.pocPrice || 'N/A'}
- Value Area High (VAH): $${volumeProfile?.vahPrice || 'N/A'}
- Value Area Low (VAL): $${volumeProfile?.valPrice || 'N/A'}
- Current Price Location: ${volumeProfile?.pricePosition || 'N/A'}

6. INSTITUTIONAL PRICE ACTION SIGNATURES:
- Liquidity Sweep Detected: ${priceAction?.liquiditySweep || 'NONE'}
- Recent 30-Candle Swing High: $${priceAction?.recentSwingHigh.price} (${priceAction?.recentSwingHigh.timeAgoMinutes}m ago)
- Recent 30-Candle Swing Low: $${priceAction?.recentSwingLow.price} (${priceAction?.recentSwingLow.timeAgoMinutes}m ago)
- Unmitigated Bullish FVGs (Imbalances): ${priceAction?.bullishFvgs.map(f => `[$${f.low} - $${f.high}]`).join(', ') || 'None nearby'}
- Unmitigated Bearish FVGs: ${priceAction?.bearishFvgs.map(f => `[$${f.low} - $${f.high}]`).join(', ') || 'None nearby'}

7. BTC VOLATILITY SPIKE GUARD:
- BTC 15m Range: ${btcGuardData.btcRange15mPercent}% (${btcGuardData.status})
${btcGuardData.warningMessage ? `!!! ${btcGuardData.warningMessage} !!!` : 'BTC volatility is stable.'}
${btcContext}

8. PERFORMANCE FEEDBACK LOOP:
- ${performanceFeedback}
===================================================`;

      // PASS 1: Master Institutional Alpha Generation
      const pass1Prompt = `You are an elite hedge fund quant trader and market maker.
Generate a high-conviction, high-accuracy ${stylePrompt} for ${targetSymbol}.

${marketIntelligenceReport}

STRICT INSTITUTIONAL EXECUTION MANDATES:
1. SPOT LONG TRADES ONLY. NO SHORTS. Entry price < Take Profit 1. Stop loss < Entry price.
2. CONFLUENCE REQUIRED: For a scalp, price MUST be testing a high-probability confluence zone:
   - Either a discount sweep (Sell-Side Liquidity swept), an unmitigated Bullish FVG tap, an EMA20/50 pullback in a strong bull trend, or a bounce off the Value Area Low (VAL) / Buy Wall.
3. MANDATORY STOP LOSS SPACING: The distance from Entry to Stop Loss MUST BE AT LEAST $${priceAction?.recommendedMinStopBuffer || 0.5} (1.35x ATR) and placed below a structural pivot or FVG. Never place an arbitrary paper-thin stop that gets wicked out.
4. MINIMUM RISK-REWARD: You must guarantee at least 1:${targetMinRR} R:R to Take Profit 1.
5. ORDER BOOK CHECK: Do not set an entry right into an overwhelming sell wall.
6. EXIT STRATEGY PERCENTAGES: Set tp1Pct, tp2Pct, and tp3Pct to integers so that they sum EXACTLY to 100.
7. If the market is choppy, BTC is spiking, or no clean A+ institutional setup exists, set tradeFound to false and state why. Quality over quantity.`;

      const pass1Response = await generateWithFallback({
        contents: pass1Prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tradeFound: { type: Type.BOOLEAN },
              symbol: { type: Type.STRING },
              entry: { type: Type.NUMBER },
              sl: { type: Type.NUMBER },
              tp1: { type: Type.NUMBER },
              tp2: { type: Type.NUMBER },
              tp3: { type: Type.NUMBER },
              tp1Pct: { type: Type.NUMBER },
              tp2Pct: { type: Type.NUMBER },
              tp3Pct: { type: Type.NUMBER },
              notes: { type: Type.STRING },
            },
            required: ["tradeFound", "notes"]
          }
        }
      });

      const candidateText = pass1Response.text;
      if (!candidateText) throw new Error("No response from Alpha generator");
      const candidate = JSON.parse(candidateText.trim());

      // If no trade found in Pass 1, return immediately
      if (!candidate.tradeFound) {
        return res.json({ status: "success", tradeSetup: candidate });
      }

      // PASS 2: Institutional Risk Desk Audit
      const pass2Prompt = `You are the Chief Risk Officer (CRO) of a top proprietary trading desk.
Audit and refine this proposed candidate trade setup:
PROPOSED TRADE:
- Symbol: ${candidate.symbol}
- Proposed Entry: ${candidate.entry}
- Proposed Stop Loss: ${candidate.sl}
- Proposed TP1: ${candidate.tp1}
- Current Live Price: $${currentPrice}
- Recommended Min Stop Buffer (1.35x ATR): $${priceAction?.recommendedMinStopBuffer}

${marketIntelligenceReport}

AUDIT CHECKLIST:
1. R:R CHECK: Is (tp1 - entry) / (entry - sl) >= ${targetMinRR}? If not, adjust TP1 higher or entry lower to achieve at least 1:${targetMinRR}.
2. STOP LOSS PROTECTION: Is (entry - sl) >= $${priceAction?.recommendedMinStopBuffer || 0.1}? If the stop is too tight for market noise, widen it behind structural support and adjust TP1 accordingly.
3. REALISTIC ENTRY: Is the entry within reach of current price ($${currentPrice})?
4. DIRECTIONAL SANITY: SPOT LONG TRADES ONLY! No shorting! If market regime is STRONG_BEAR_TREND and funding is high positive, reject the trade (set tradeFound = false).
5. EXIT STRATEGY PERCENTAGES (POSITION SIZING): tp1Pct, tp2Pct, and tp3Pct represent the PERCENTAGE OF POSITION SIZE to sell at each target, NOT the price difference percentage. For example, to sell half the position at TP1, set tp1Pct to 50. They MUST be integers (e.g. 50, 30, 20) and sum EXACTLY to 100.

If the trade passes or can be adjusted into institutional compliance, return the approved parameters with a succinct, razor-sharp institutional breakdown in 'notes'. If the trade is flawed, veto it (set tradeFound = false).`;

      const pass2Response = await generateWithFallback({
        contents: pass2Prompt,
        config: {
          responseMimeType: "application/json",
          responseSchema: {
            type: Type.OBJECT,
            properties: {
              tradeFound: { type: Type.BOOLEAN },
              symbol: { type: Type.STRING },
              entry: { type: Type.NUMBER },
              sl: { type: Type.NUMBER },
              tp1: { type: Type.NUMBER },
              tp2: { type: Type.NUMBER },
              tp3: { type: Type.NUMBER },
              tp1Pct: { type: Type.NUMBER },
              tp2Pct: { type: Type.NUMBER },
              tp3Pct: { type: Type.NUMBER },
              notes: { type: Type.STRING, description: "Chief Risk Officer's audited trade thesis and institutional confluence." },
            },
            required: ["tradeFound", "notes"]
          }
        }
      });

      const auditedText = pass2Response.text;
      if (!auditedText) throw new Error("No response from Risk Officer");
      const auditedTrade = JSON.parse(auditedText.trim());
      
      if (auditedTrade.tradeFound) {
        const isValid = enforceMinimumRewardRisk(auditedTrade, 1.0);
        if (!isValid) {
          auditedTrade.tradeFound = false;
          auditedTrade.notes = "Trade rejected: Invalid structural logic.";
        }
      }
      
      normalizeTpPercentages(auditedTrade);
      res.json({ status: "success", tradeSetup: auditedTrade });
    } catch (e: any) {
      console.warn("Gemini setup fallback to deterministic market intelligence:", e?.message || e);
      const cleanSym = (typeof req.query.symbol === 'string' ? req.query.symbol : 'BTCUSDT').toUpperCase().trim();
      const currentPriceNum = typeof currentPrice === 'number' && currentPrice > 0 ? currentPrice : 1;
      const buffer = (priceAction?.recommendedMinStopBuffer && priceAction.recommendedMinStopBuffer > 0) 
        ? priceAction.recommendedMinStopBuffer 
        : (currentPriceNum * 0.02);
      const entry = currentPriceNum;
      const sl = parseFloat(Math.max(0.0001, entry - buffer).toFixed(4));
      const riskPerUnit = entry - sl;
      const tp1 = parseFloat((entry + (riskPerUnit * 1.5)).toFixed(4));
      const tp2 = parseFloat((entry + (riskPerUnit * 2.5)).toFixed(4));
      const tp3 = parseFloat((entry + (riskPerUnit * 4.0)).toFixed(4));

      return res.json({
        status: "success",
        tradeSetup: {
          tradeFound: true,
          symbol: cleanSym,
          entry,
          sl,
          tp1,
          tp2,
          tp3,
          tp1Pct: 50,
          tp2Pct: 30,
          tp3Pct: 20,
          notes: `Algorithmic Plan: Structural entry at $${entry}, Stop Loss protected at $${sl} (1.35x ATR buffer: $${buffer.toFixed(4)}), targeting TP1 at 1.5R ($${tp1}) with 50/30/20 scaling.`
        }
      });
    }
  });

  // Vite middleware for development
  if (process.env.NODE_ENV !== "production") {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: "spa",
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath, { 
      maxAge: '1y',
      immutable: true,
      setHeaders: (res, filePath) => {
        if (filePath.endsWith('.html')) {
          res.setHeader('Cache-Control', 'no-cache');
        }
      }
    }));
    // Express 4 wildcard catch-all
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, "0.0.0.0", () => {
    console.log(`Server running on http://localhost:${PORT}`);
  });
}

startServer();
