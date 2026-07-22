const MAX_VISITS_STORED = 500;
const RATE_WINDOW_MS = 60 * 1000;
const MAX_HITS_PER_WINDOW = 30;
const VISITS_KEY = "portfolio:visits";
const COUNTS_KEY = "portfolio:source_counts";

function getStore() {
  if (!globalThis.__portfolioVisitStore) {
    globalThis.__portfolioVisitStore = {
      ipHits: new Map(),
      visits: [],
      sourceCounts: {},
    };
  }
  return globalThis.__portfolioVisitStore;
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function sanitizeText(value, maxLen) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .trim()
    .slice(0, maxLen);
}

function hasUpstash() {
  return Boolean(
    process.env.UPSTASH_REDIS_REST_URL && process.env.UPSTASH_REDIS_REST_TOKEN
  );
}

async function redisCommand(command) {
  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;
  const res = await fetch(`${url}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(command),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Upstash error ${res.status}: ${text}`);
  }
  return res.json();
}

function checkRateLimit(ip, now) {
  const store = getStore();
  const hits = (store.ipHits.get(ip) || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (hits.length >= MAX_HITS_PER_WINDOW) {
    return false;
  }
  hits.push(now);
  store.ipHits.set(ip, hits);
  return true;
}

function guessDevice(ua) {
  const s = String(ua || "").toLowerCase();
  if (!s) return "unknown";
  if (/bot|crawl|spider|slurp|preview/i.test(s)) return "bot";
  if (/mobile|android|iphone|ipod|iemobile|opera mini/i.test(s)) return "mobile";
  if (/ipad|tablet|kindle|silk/i.test(s)) return "tablet";
  return "desktop";
}

function normalizeSource(raw) {
  const s = sanitizeText(raw, 40).toLowerCase();
  if (!s) return "direct";
  if (s.includes("linkedin")) return "linkedin";
  if (s.includes("instagram") || s === "ig") return "instagram";
  if (s.includes("github")) return "github";
  if (s.includes("twitter") || s === "x") return "twitter";
  if (s.includes("facebook") || s === "fb") return "facebook";
  if (s.includes("google")) return "google";
  if (s === "direct" || s === "none") return "direct";
  return s.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "other";
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function storeVisit(visit) {
  if (hasUpstash()) {
    await redisCommand(["LPUSH", VISITS_KEY, JSON.stringify(visit)]);
    await redisCommand(["LTRIM", VISITS_KEY, 0, MAX_VISITS_STORED - 1]);
    await redisCommand(["HINCRBY", COUNTS_KEY, visit.source, 1]);
    return;
  }

  const store = getStore();
  store.visits.unshift(visit);
  if (store.visits.length > MAX_VISITS_STORED) {
    store.visits.length = MAX_VISITS_STORED;
  }
  store.sourceCounts[visit.source] = (store.sourceCounts[visit.source] || 0) + 1;
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
      res.setHeader("Access-Control-Allow-Headers", "Content-Type");
      res.end();
      return;
    }

    res.setHeader("Access-Control-Allow-Origin", "*");

    if (req.method !== "POST") {
      return json(res, 405, { success: false, message: "Method not allowed" });
    }

    let body = req.body;
    if (typeof body === "string") {
      try {
        body = JSON.parse(body);
      } catch {
        return json(res, 400, { success: false, message: "Invalid JSON" });
      }
    }
    body = body || {};

    const now = Date.now();
    const ip = getClientIp(req);
    if (!checkRateLimit(ip, now)) {
      return json(res, 429, { success: false, message: "Too many requests" });
    }

    const ua = sanitizeText(req.headers["user-agent"], 300);
    const country =
      sanitizeText(req.headers["x-vercel-ip-country"], 8) ||
      sanitizeText(req.headers["cf-ipcountry"], 8) ||
      "";

    const visit = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: sanitizeText(body.timestamp, 40) || new Date(now).toISOString(),
      path: sanitizeText(body.path, 200) || "/",
      source: normalizeSource(body.source),
      utm_source: sanitizeText(body.utm_source, 80),
      utm_medium: sanitizeText(body.utm_medium, 80),
      utm_campaign: sanitizeText(body.utm_campaign, 80),
      referrer: sanitizeText(body.referrer, 300),
      visitorId: sanitizeText(body.visitorId, 64),
      country,
      device: guessDevice(ua),
    };

    await storeVisit(visit);

    return json(res, 200, { success: true });
  } catch {
    return json(res, 500, { success: false, message: "Failed to record visit" });
  }
};
