# Optimized Coin Price Alert & Notification Engine

A high-performance, 24/7 coin price alerting system integrated into the top-right Bell Alert Manager, delivering real-time OS Web Push notifications, audible chimes, and in-app banners for any Spot, Futures, or Alpha coin with zero redundant network polling.

### User Review & Critical Decisions

> [!IMPORTANT]
> The following architectural and UX decisions reflect your confirmed requirements and establish how custom coin price alerts operate across foreground and background sessions.

- **Confirmed Decision 1 — Alert Condition Scope**: Users can configure **Target Price Above (`>=`) or Below (`<=`)** alerts for any coin symbol, with automatic condition inference based on whether the entered target price is currently higher or lower than the live market price.
- **Confirmed Decision 2 — Trigger & Persistence Lifecycle**: Alerts default to **One-Time Trigger** (automatically marking as triggered to prevent notification spam during price chop), with an **optional Recurring Toggle** (re-arming after a 60-second cooldown and price reset hysteresis).
- **Confirmed Decision 3 — Dedicated Bell Manager Panel**: All custom coin price alerts and active trade milestone monitors are managed inside a **unified two-tab popover panel inside the top-right Bell icon** (`Custom Coin Alerts` and `Trade Milestones`), keeping the main workspace clutter-free.

---

### 1. Overview & Core Concept

- **What It Does**: Allows traders to set standalone price alerts on any cryptocurrency (e.g., `BTCUSDT`, `SOLUSDT`, `TAOUSDT`, `FARTCOINUSDT`) independent of whether they have an open position. When the coin reaches the target threshold, the engine dispatches a multi-channel alert:
  1. **24/7 Cloud Web Push** (via VAPID to mobile iOS/Android PWA and desktop browsers even when the app is closed).
  2. **Synthesized Web Audio Chime** (distinct rising/falling crystal alert tone via Web Audio API).
  3. **OS System Banner & In-App Toast** when the app is open in the foreground.
- **Target Audience / Persona**: Active crypto spot and scalp traders who track key breakout levels, liquidity sweeps, and dip-buy zones across multiple coins simultaneously without staring at charts all day.
- **Key Value**: Combines exchange-wide coin monitoring with zero additional client/server API overhead by piggybacking on the existing unified ticker batch stream and `O(1)` symbol-indexed evaluation.

---

### 2. User Experience & Visual Design

- **Key User Flows**:
  1. **Opening the Alert Manager**: Clicking the top-right Bell icon opens the unified Alert Manager popover (when notification permissions are granted, or prompts for permission first).
  2. **Switching Views**: A clean segmented control at the top switches between **Coin Alerts** (standalone price alerts with live badge count) and **Trade Alerts** (automatic Entry, SL, and TP1–TP3 monitors for open positions).
  3. **Creating a Coin Alert**:
     - **Symbol Selector with Live Price Pill**: Autocomplete input supporting all Binance Spot, Futures, and Alpha symbols. Selecting a symbol immediately displays its live price (e.g., `BTCUSDT · $94,250.00`) and quick-offset buttons (`-5%`, `-2%`, `+2%`, `+5%`).
     - **Target Price Input & Smart Condition**: Typing a target price automatically selects **Above (`>=`)** if Target > Live Price, or **Below (`<=`)** if Target < Live Price, while allowing manual override.
     - **Delivery Mode Toggle**: Clean toggle between **One-time** (default) and **Recurring** (repeats with a 60s anti-spam cooldown), plus an optional short custom note (e.g., `"Sweep of daily low"`).
  4. **Managing Active & Triggered Alerts**:
     - Each alert row displays the symbol, live price, target price, percentage distance to target (`+1.84% away`), condition direction (`▲ Above` / `▼ Below`), recurring indicator, and a single-click mute/delete button.
     - Recently triggered one-time alerts appear in a collapsible **Triggered History** section with a one-click **Re-arm** button.

- **Visual Identity & Theme**:
  - *Aesthetic Direction*: High-density institutional dark trading cockpit matching the existing slate/zinc dark interface (`#09090b` / `#18181b`).
  - *Color Palette & Mood*:
    - Surface Canvas: Deep neutral zinc (`bg-neutral-900/95` with `border-neutral-800`).
    - Bullish / Above Target Accent: Crisp sky/emerald (`text-emerald-400`, `bg-emerald-500/10`).
    - Bearish / Below Target Accent: Amber/rose (`text-rose-400`, `bg-rose-500/10`).
    - Primary Interactive Accent: Electric sky blue (`text-sky-400`, `bg-sky-500/15`).
  - *Typography & Hierarchy*: Clean sans-serif UI labels paired with strict monospace tabular numerals (`font-mono tabular-nums`) for all live prices, target prices, and percentage distances so decimals never jitter during real-time ticks.
  - *Component Styling & Layout*: Single-elevation popover (`w-80 sm:w-[420px]`) with compact 40px row heights, subtle `1px` hairline dividers, and single-line controls (`whitespace-nowrap`).

- **Interactive Feedback & Motion**:
  - Instant optimistic creation and deletion (<50ms UI feedback) backed by Firestore persistence and server push synchronization.
  - Live distance-to-target bar that subtly shifts color as price approaches within `0.5%` of the target level.

---

### 3. Key Product Decisions & Trade-Offs

- **Decision 1: Unified Piggybacked Price Stream (`O(1)` Symbol Index) vs. Per-Alert Polling**
  - *Chosen Approach*: Index all active custom coin alerts and trade milestone alerts into a single `Map<Symbol, Alert[]>` on both the client (`useBinanceTickers` union symbol set) and the server (existing 4-second batch ticker loop).
  - *Why*: Whether a user has 1 alert or 100 alerts across 40 coins, the server still makes the exact same single batch ticker fetch, and only evaluates alerts mapped to symbols whose price actually updated (`O(1)` lookup per symbol).
  - *Alternatives Considered*: Spawning separate timers or REST requests per alert was rejected because it causes rate-limit bans (`HTTP 429`) and battery drain on mobile PWAs.

- **Decision 2: Dual-Layer Evaluation (Foreground WebSocket + 24/7 Cloud Push Engine)**
  - *Chosen Approach*: Evaluate alerts locally on the client via real-time WebSocket ticks when the app is open, and simultaneously sync active custom alerts to Firestore (`price_alerts` collection) for the 24/7 server background engine.
  - *Why*: Foreground evaluation provides sub-second audio chimes and toast feedback while trading; background server evaluation guarantees Web Push delivery when the phone screen is locked or the browser tab is closed. Cross-layer idempotency keys (`triggered_push_alerts` + `lastTriggeredAt`) prevent duplicate notifications when transitioning between foreground and background.

- **Decision 3: Hysteresis & Cooldown State Machine for Recurring Alerts**
  - *Chosen Approach*: One-time alerts transition immediately to `status: 'TRIGGERED'` (`isActive: false`) upon crossing the target. Recurring alerts record `lastTriggeredAt` and enforce a **60-second cooldown + price cross-back check** before firing again.
  - *Why*: Cryptocurrency prices frequently oscillate around a target level for several seconds. Without cooldown and hysteresis, a recurring alert at `$95,000` would spam 15 notifications in a single minute.

---

### 4. Technical Architecture & Data Strategy *(Technical Reference)*

- **Architecture & Component Diagram**:

```
┌────────────────────────────────────────────────────────────────────────────┐
│                   BELL ALERT MANAGER UI (Top-Right Header)                 │
│  ┌───────────────────────────────────┬──────────────────────────────────┐  │
│  │ Tab 1: Custom Coin Price Alerts   │ Tab 2: Active Trade Milestones   │  │
│  │ • Symbol Autocomplete + Live Pill │ • Auto-monitored Entry / SL / TP │  │
│  │ • Target Price + Above/Below      │ • Per-trade status overview      │  │
│  │ • One-Time vs. Recurring Toggle   │ • Test Push Notification action  │  │
│  │ • Active & Triggered Alert List   │                                  │  │
│  └─────────────────┬─────────────────┴─────────────────┬────────────────┘  │
└────────────────────┼───────────────────────────────────┼───────────────────┘
                     │                                   │
                     ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               CLIENT REAL-TIME LAYER (Foreground Execution)                │
│  • Union Symbol Set: Trade Symbols ∪ Active Custom Alert Symbols           │
│  • Real-time WebSocket + Multi-Source Ticker Stream (Spot/Futures/Alpha)   │
│  • Instant Audio Chime (Web Audio API) + OS Banner + In-App Toast          │
└────────────────────┬───────────────────────────────────┬───────────────────┘
                     │ Optimistic Firestore Sync         │ POST /api/push/subscribe
                     ▼                                   ▼
┌────────────────────────────────────────────────────────────────────────────┐
│               24/7 CLOUD ENGINE & PERSISTENCE (Server + DB)                │
│  • Firestore `price_alerts` collection (userId, symbol, targetPrice, ...)  │
│  • Server O(1) Symbol-Indexed Evaluator (Piggybacked on 4s Batch Ticker)   │
│  • Deduplication Guard (`sentAlertsPermanent` + 60s Recurring Cooldown)    │
│  • Multi-Device VAPID Web Push Dispatcher (iOS Home Screen / Android / PC) │
└────────────────────────────────────────────────────────────────────────────┘
```

- **Data Model & State (`CustomPriceAlert` Entity)**:
  - `id`: Unique identifier (`alert_<timestamp>_<random>`)
  - `userId`: Owner UID (or `'anonymous'` fallback)
  - `symbol`: Normalized uppercase trading pair (e.g., `'BTCUSDT'`, `'SOLUSDT'`)
  - `targetPrice`: Numeric target threshold (`> 0`)
  - `condition`: `'above' | 'below'`
  - `recurring`: Boolean (`false` = One-Time default, `true` = Recurring)
  - `isActive`: Boolean (`true` when armed, `false` when one-time alert triggers or user pauses)
  - `note`: Optional short reminder label (max 80 chars)
  - `createdAt`: Epoch timestamp (ms)
  - `triggeredAt`: Optional epoch timestamp of last trigger
  - `triggerCount`: Integer count of times triggered

- **Interactive Component & State Mapping**:
  - **Symbol Selection & Quick Offsets**: Selecting a symbol looks up `livePrices[symbol]` (or fetches an instant quote if not yet in the active stream) and pre-populates quick percentage buttons (`-5%`, `-2%`, `+2%`, `+5%`) that calculate exact tick-rounded target prices.
  - **Condition Auto-Detection**: Changing the target price compares `targetPrice` against `livePrices[symbol]` and automatically highlights `Above` or `Below`, while locking manual selection if the user explicitly clicks a condition button.
  - **Lifecycle Controls**:
    - *Pause / Resume / Re-arm Toggle*: Flips `isActive: true/false` in Firestore and clears the permanent lock key on the server so re-armed alerts can fire again.
    - *Delete Action*: Optimistically removes the alert from state and deletes the document from Firestore.

---

### 5. Self-Prompt Specification for Implementation

> [!NOTE]
> As requested, below is the exact, self-contained engineering prompt designed for executing this feature with maximum performance and zero regression.

```markdown
### ENGINEERING PROMPT: OPTIMIZED COIN PRICE ALERTS & NOTIFICATION ENGINE

**Objective**: Upgrade the application's notification system (`PriceAlertManager`, `TradeContext`, `notificationHelper`, and `server.ts`) to support standalone, user-configurable Coin Price Alerts alongside existing Trade Milestone Alerts, inside a unified two-tab Bell Alert Manager popover.

#### 1. Data Model & Firestore Persistence
- Define the `PriceAlert` interface in `src/types.ts`:
  - `id: string`, `userId: string`, `symbol: string`, `targetPrice: number`, `condition: 'above' | 'below'`, `recurring: boolean`, `isActive: boolean`, `note?: string`, `createdAt: number`, `lastTriggeredAt?: number`, `triggerCount?: number`.
- Sync user price alerts in real time via Firestore collection `price_alerts` with `localStorage` fallback (`trade_sizer_custom_price_alerts`) for instant cold-start hydration.
- Merge all active custom alert symbols (`alert.isActive === true`) into the `useBinanceTickers` symbol subscription list in `TradeContext` so live WebSocket and REST prices automatically stream for every watched coin.

#### 2. O(1) Optimization & Deduplication Engine (Client & Server)
- **Zero Extra Polling**: Piggyback custom coin alerts onto the existing 4-second batch ticker cycle in `server.ts` (`syncBackgroundEngineFromDb` and the price evaluation loop) and the client `livePrices` effect.
- **One-Time vs. Recurring State Machine**:
  - For **One-Time Alerts (`recurring: false`)**: When `livePrice >= targetPrice` (`above`) or `livePrice <= targetPrice` (`below`), fire the notification once, set `isActive: false`, record `lastTriggeredAt: Date.now()`, increment `triggerCount`, and record the idempotency key in `sentAlertsPermanent` / `triggered_push_alerts`.
  - For **Recurring Alerts (`recurring: true`)**: Enforce a 60-second cooldown (`Date.now() - (lastTriggeredAt || 0) >= 60_000`) so price chop around the target never spams notifications. Keep `isActive: true` and update `lastTriggeredAt`.
  - **Re-Arm Support**: When a user re-arms a triggered alert or edits its target price, generate a fresh `updatedAt` / state version so neither client nor server suppresses the newly armed alert.

#### 3. Multi-Channel Alert Delivery (`notificationHelper.ts`)
- Add `notifyCustomPriceAlert({ symbol, targetPrice, livePrice, condition, note, recurring, userId })`:
  - Synthesize a distinct crystal alert chime in `playNotificationChime('alert')`.
  - Trigger OS system notification via Service Worker (`showSystemNotification`) and high-contrast in-app toast.
  - Dispatch 24/7 Cloud Web Push via `/api/push/notify` and `/api/push/subscribe`.

#### 4. Dedicated Two-Tab Bell Alert Manager UI (`PriceAlertManager.tsx`)
- Upgrade the top-right Bell popover into a clean, two-tab cockpit:
  - **Tab 1: Coin Alerts (`Custom Price Alerts`)**:
    - Symbol search/autocomplete supporting all exchange symbols + instant live price display.
    - Target price input with tabular numerals (`font-mono tabular-nums`), quick-offset buttons (`-5%`, `-2%`, `+2%`, `+5%`), and automatic `Above` / `Below` condition selection.
    - One-Time vs. Recurring toggle and optional note field.
    - Active Alerts list showing live price, target price, `%` distance to target, condition badge, recurring icon, pause/re-arm toggle, and delete button.
    - Triggered Alerts history section with one-click Re-arm and Clear All Triggered actions.
  - **Tab 2: Trade Milestones (`Position SL/TP Monitors`)**:
    - Preserve existing active trade Entry, SL, TP1, TP2, TP3 monitoring list and Test Notification button.
- Show an active count indicator on the Bell button when custom coin alerts or trade monitors are armed.
```
