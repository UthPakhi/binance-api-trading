import fs from "fs";
import path from "path";

interface CsvRow {
  orderNo: string;
  time: string;
  timestamp: number;
  pair: string;
  side: "BUY" | "SELL";
  price: number;
  executedQty: number;
  executedAsset: string;
  amountUsd: number;
  feeAmount: number;
  feeAsset: string;
}

function parseCsv(filePath: string): CsvRow[] {
  const content = fs.readFileSync(filePath, "utf-8");
  const lines = content.trim().split("\n");
  const header = lines[0].split(",").map(s => s.trim().replace(/^"|"$/g, ""));
  
  const rows: CsvRow[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const parts = line.split(",").map(s => s.trim().replace(/^"|"$/g, ""));
    const raw: any = {};
    header.forEach((h, idx) => { raw[h] = parts[idx]; });

    const orderNo = raw["Order No"];
    const timeStr = raw["Time"];
    const timestamp = new Date(timeStr.replace(" ", "T") + "Z").getTime();
    const pair = raw["Pair"];
    const side = raw["Side"].toUpperCase() as "BUY" | "SELL";
    const price = parseFloat(raw["Price"]);

    const execMatch = (raw["Executed"] || "").match(/^([0-9.]+)([A-Z0-9]+)$/);
    const executedQty = execMatch ? parseFloat(execMatch[1]) : parseFloat(raw["Executed"]);
    const executedAsset = execMatch ? execMatch[2] : "";

    const amtMatch = (raw["Amount"] || "").match(/^([0-9.]+)([A-Z0-9]+)$/);
    const amountUsd = amtMatch ? parseFloat(amtMatch[1]) : parseFloat(raw["Amount"]);

    const feeMatch = (raw["Fee"] || "").match(/^([0-9.]+)([A-Z0-9]+)$/);
    const feeAmount = feeMatch ? parseFloat(feeMatch[1]) : parseFloat(raw["Fee"] || "0");
    const feeAsset = feeMatch ? feeMatch[2] : "USDT";

    rows.push({
      orderNo,
      time: timeStr,
      timestamp,
      pair,
      side,
      price,
      executedQty,
      executedAsset,
      amountUsd,
      feeAmount,
      feeAsset
    });
  }

  rows.sort((a, b) => a.timestamp - b.timestamp);
  return rows;
}

function runAudit() {
  const csvPath = "./public/assets/aistudio/Binance-Spot-Trade-History-202610201901_UTC_5_-part1-of1_9fc46edd.csv";
  const fills = parseCsv(csvPath);
  console.log(`Parsed ${fills.length} fills from CSV.`);

  const byPair = new Map<string, CsvRow[]>();
  for (const f of fills) {
    if (!byPair.has(f.pair)) byPair.set(f.pair, []);
    byPair.get(f.pair)!.push(f);
  }

  console.log(`Found ${byPair.size} distinct trading pairs in past 3 months.\n`);

  interface PairAnalysis {
    pair: string;
    totalBuyCoins: number;
    totalSellCoins: number;
    netCoins: number;
    totalBuyUsd: number;
    totalSellUsd: number;
    isComplete: boolean;
    isPartiallyOpen: boolean;
    hasMissingBuys: boolean;
    closedCycles: any[];
  }

  const results: PairAnalysis[] = [];

  for (const [pair, pairFills] of byPair.entries()) {
    let buyCoins = 0;
    let sellCoins = 0;
    let buyUsd = 0;
    let sellUsd = 0;

    const buyLots: { orderNo: string; qty: number; remainingQty: number; price: number; usd: number; time: string; timestamp: number }[] = [];
    const closedCycles: any[] = [];
    let hasMissingBuys = false;

    const ordersMap = new Map<string, { orderNo: string; side: "BUY" | "SELL"; price: number; qty: number; usd: number; feeUsd: number; time: string; timestamp: number }>();
    for (const f of pairFills) {
      if (!ordersMap.has(f.orderNo)) {
        ordersMap.set(f.orderNo, {
          orderNo: f.orderNo,
          side: f.side,
          price: f.price,
          qty: 0,
          usd: 0,
          feeUsd: 0,
          time: f.time,
          timestamp: f.timestamp
        });
      }
      const ord = ordersMap.get(f.orderNo)!;
      ord.qty += f.executedQty;
      ord.usd += f.amountUsd;
      let feeUsd = f.feeAmount;
      if (f.feeAsset === "BNB") feeUsd *= 600;
      else if (f.feeAsset !== "USDT" && f.feeAsset !== "USDC") feeUsd *= f.price;
      ord.feeUsd += feeUsd;
    }

    const orders = Array.from(ordersMap.values()).sort((a, b) => a.timestamp - b.timestamp);

    for (const ord of orders) {
      if (ord.side === "BUY") {
        buyCoins += ord.qty;
        buyUsd += ord.usd;
        buyLots.push({
          orderNo: ord.orderNo,
          qty: ord.qty,
          remainingQty: ord.qty,
          price: ord.usd / ord.qty,
          usd: ord.usd,
          time: ord.time,
          timestamp: ord.timestamp
        });
      } else {
        sellCoins += ord.qty;
        sellUsd += ord.usd;

        let needed = ord.qty;
        let matchedCost = 0;
        let matchedQty = 0;

        for (const lot of buyLots) {
          if (lot.remainingQty <= 0.00000001) continue;
          const take = Math.min(lot.remainingQty, needed);
          lot.remainingQty -= take;
          needed -= take;
          matchedCost += take * lot.price;
          matchedQty += take;
          if (needed <= 0.00000001) break;
        }

        if (needed > 0.0001 && buyLots.length === 0) {
          hasMissingBuys = true;
        }

        const cycleSellUsd = ord.usd;
        const cyclePnl = cycleSellUsd - matchedCost - ord.feeUsd;

        closedCycles.push({
          sellOrderNo: ord.orderNo,
          sellTime: ord.time,
          sellTimestamp: ord.timestamp,
          sellPrice: ord.usd / ord.qty,
          sellQty: ord.qty,
          sellUsd: ord.usd,
          matchedBuyCost: matchedCost,
          matchedQty,
          unmatchedQty: needed,
          pnl: cyclePnl,
          feeUsd: ord.feeUsd
        });
      }
    }

    const netCoins = buyCoins - sellCoins;
    const isComplete = Math.abs(netCoins) < 0.0001 || (buyCoins > 0 && Math.abs(netCoins) / buyCoins < 0.005);
    const isPartiallyOpen = netCoins > 0.0001 && !isComplete;

    results.push({
      pair,
      totalBuyCoins: buyCoins,
      totalSellCoins: sellCoins,
      netCoins,
      totalBuyUsd: buyUsd,
      totalSellUsd: sellUsd,
      isComplete,
      isPartiallyOpen,
      hasMissingBuys,
      closedCycles
    });
  }

  console.log("=== PAIR AUDIT SUMMARY ===");
  let fullyClosedCount = 0;
  let partiallyOpenCount = 0;
  let missingBuysCount = 0;

  for (const r of results) {
    if (r.hasMissingBuys) {
      missingBuysCount++;
      console.log(`[MISSING BUYS] ${r.pair}: Bought ${r.totalBuyCoins.toFixed(4)}, Sold ${r.totalSellCoins.toFixed(4)} (Sell happened before any buy in 3M window)`);
    } else if (r.isPartiallyOpen) {
      partiallyOpenCount++;
      console.log(`[PARTIALLY OPEN] ${r.pair}: Bought ${r.totalBuyCoins.toFixed(4)}, Sold ${r.totalSellCoins.toFixed(4)}, Net: ${r.netCoins.toFixed(4)}`);
    } else {
      fullyClosedCount++;
      console.log(`[FULLY CLOSED] ${r.pair}: Bought ${r.totalBuyCoins.toFixed(4)}, Sold ${r.totalSellCoins.toFixed(4)}, Closed cycles: ${r.closedCycles.length}`);
    }
  }

  console.log(`\nTotals: Fully Closed: ${fullyClosedCount}, Partially Open: ${partiallyOpenCount}, Missing Buys/Incomplete: ${missingBuysCount}`);
}

runAudit();
