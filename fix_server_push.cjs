const fs = require('fs');
let code = fs.readFileSync('server.ts', 'utf-8');

const importTarget = `import { GoogleGenAI, Type } from "@google/genai";`;
const importReplace = `import webpush from 'web-push';\nimport { GoogleGenAI, Type } from "@google/genai";`;

code = code.replace(importTarget, importReplace);

const vapidSetup = `
const vapidPublic = process.env.VAPID_PUBLIC_KEY || 'BAroV9birM9rVdLrSDpuoyalmIBWVuGhJ7GcY0vIr7SZhMABwnGIO0JkBiZdY-QYK46tC6_LAUaex0NKg629CWs';
const vapidPrivate = process.env.VAPID_PRIVATE_KEY || '9BqD8uZEKidk7wBN2WI0UwS86098NLpWaLR29_VnH78';
webpush.setVapidDetails('mailto:test@tradesizer.com', vapidPublic, vapidPrivate);

const activePushSubs = new Map<string, any>();
const activeAlerts = new Map<string, any[]>();

app.post("/api/push/subscribe", express.json(), (req, res) => {
  const { userId, subscription, alerts } = req.body;
  if (!userId || !subscription) return res.status(400).json({ status: "error" });
  activePushSubs.set(userId, subscription);
  if (alerts) activeAlerts.set(userId, alerts);
  res.json({ status: "success" });
});

app.post("/api/push/test", express.json(), async (req, res) => {
  const { userId } = req.body;
  const sub = activePushSubs.get(userId);
  if (!sub) return res.status(404).json({ status: "error", message: "Not subscribed" });
  try {
    await webpush.sendNotification(sub, JSON.stringify({
      title: 'Background Engine Active',
      body: 'Your device is securely connected to the cloud background engine. Notifications will now arrive even when the app is closed.',
      url: '/'
    }));
    res.json({ status: "success" });
  } catch (e: any) {
    res.status(500).json({ status: "error", message: e.message });
  }
});
`;

code = code.replace(`app.get("/api/health"`, `${vapidSetup}\n\n  app.get("/api/health"`);

fs.writeFileSync('server.ts', code);
