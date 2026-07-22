const crypto = require("crypto");

const MAX_REQUESTS = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const URL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const MAX_LEADS_STORED = 300;
const COOKIE_RL = "pf_li_rl";
const COOKIE_URL = "pf_li_url";
const LEADS_KEY = "portfolio:linkedin_leads";
const SECRET =
  process.env.CONTACT_SECRET || "portfolio-contact-v1-abubakar-secure";
const DUPLICATE_MESSAGE =
  "Thanks — I've already got your LinkedIn. I'll follow up soon.";
const RATE_MESSAGE =
  "Too many requests. Please try again after some time (max 5 per hour).";

function getStore() {
  if (!globalThis.__portfolioLinkedInStore) {
    globalThis.__portfolioLinkedInStore = {
      ipHits: new Map(),
      urls: new Map(),
      leads: [],
    };
  }
  return globalThis.__portfolioLinkedInStore;
}

function cleanupStore(store, now) {
  for (const [ip, hits] of store.ipHits.entries()) {
    const fresh = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length) store.ipHits.set(ip, fresh);
    else store.ipHits.delete(ip);
  }
  for (const [url, ts] of store.urls.entries()) {
    if (now - ts > URL_TTL_MS) store.urls.delete(url);
  }
}

function getClientIp(req) {
  const forwarded = req.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers["x-real-ip"] || req.socket?.remoteAddress || "unknown";
}

function sign(payload) {
  return crypto.createHmac("sha256", SECRET).update(payload).digest("base64url");
}

function readSignedCookie(req, name) {
  const header = req.headers.cookie || "";
  const part = header
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(`${name}=`));
  if (!part) return null;
  const value = part.slice(name.length + 1);
  const dot = value.lastIndexOf(".");
  if (dot < 1) return null;
  const payload = value.slice(0, dot);
  const sig = value.slice(dot + 1);
  if (!payload || !sig || sign(payload) !== sig) return null;
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
  } catch {
    return null;
  }
}

function makeSignedCookie(name, data, maxAgeSec) {
  const payload = Buffer.from(JSON.stringify(data)).toString("base64url");
  const sig = sign(payload);
  const secure = process.env.VERCEL ? "; Secure" : "";
  return `${name}=${payload}.${sig}; Path=/; HttpOnly${secure}; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function sanitizeText(value, maxLen) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/[\r\n]+/g, " ")
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

function normalizeLinkedInUrl(raw) {
  let input = String(raw || "").trim();
  if (!input) return null;
  if (!/^https?:\/\//i.test(input)) {
    input = `https://${input}`;
  }

  let parsed;
  try {
    parsed = new URL(input);
  } catch {
    return null;
  }

  const host = parsed.hostname.replace(/^www\./i, "").toLowerCase();
  const isLinkedInHost =
    host === "linkedin.com" ||
    host === "lnkd.in" ||
    /^[a-z]{2}\.linkedin\.com$/.test(host);

  if (!isLinkedInHost) return null;

  // Short links: keep as-is after basic cleanup
  if (host === "lnkd.in") {
    const path = parsed.pathname.replace(/\/+$/, "");
    if (!/^\/[A-Za-z0-9_-]+$/.test(path)) return null;
    return `https://lnkd.in${path}`;
  }

  const path = parsed.pathname.replace(/\/+$/, "") || "/";
  const profilePath =
    /^\/in\/[A-Za-z0-9._%-]+$/i.test(path) ||
    /^\/pub\/[A-Za-z0-9._%-]+(\/[A-Za-z0-9._%-]+){0,4}$/i.test(path) ||
    /^\/mwlite\/in\/[A-Za-z0-9._%-]+$/i.test(path) ||
    /^\/company\/[A-Za-z0-9._%-]+$/i.test(path);

  if (!profilePath) return null;

  return `https://www.linkedin.com${path}`;
}

function getCookieHits(req, now) {
  const data = readSignedCookie(req, COOKIE_RL);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits.filter((t) => typeof t === "number" && now - t < RATE_WINDOW_MS);
}

function getCookieUrls(req, now) {
  const data = readSignedCookie(req, COOKIE_URL);
  const urls = data && typeof data === "object" ? data : {};
  const out = {};
  for (const [url, ts] of Object.entries(urls)) {
    if (typeof ts === "number" && now - ts < URL_TTL_MS) out[url] = ts;
  }
  return out;
}

function checkIpRateLimit(store, ip, now) {
  const hits = (store.ipHits.get(ip) || []).filter(
    (t) => now - t < RATE_WINDOW_MS
  );
  if (hits.length >= MAX_REQUESTS) {
    return { allowed: false, hits };
  }
  hits.push(now);
  store.ipHits.set(ip, hits);
  return { allowed: true, hits };
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

function json(res, status, body, cookies = []) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  if (cookies.length === 1) {
    res.setHeader("Set-Cookie", cookies[0]);
  } else if (cookies.length > 1) {
    res.setHeader("Set-Cookie", cookies);
  }
  res.end(JSON.stringify(body));
}

async function storeLead(lead) {
  if (hasUpstash()) {
    await redisCommand(["LPUSH", LEADS_KEY, JSON.stringify(lead)]);
    await redisCommand(["LTRIM", LEADS_KEY, 0, MAX_LEADS_STORED - 1]);
    return;
  }

  const store = getStore();
  store.leads.unshift(lead);
  if (store.leads.length > MAX_LEADS_STORED) {
    store.leads.length = MAX_LEADS_STORED;
  }
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
        return json(res, 400, {
          success: false,
          message: "Invalid request body",
        });
      }
    }
    body = body || {};

    const name = sanitizeText(body.name, 80);
    const linkedinUrl = normalizeLinkedInUrl(body.linkedinUrl || body.url);
    const honeypot = String(body.botcheck || body.company || "").trim();
    const visitorId = sanitizeText(body.visitorId, 64);
    const source = normalizeSource(body.source);
    const referrer = sanitizeText(body.referrer, 300);

    if (honeypot) {
      return json(res, 200, {
        success: true,
        duplicate: true,
        allowed: false,
        message: DUPLICATE_MESSAGE,
      });
    }

    if (!linkedinUrl) {
      return json(res, 400, {
        success: false,
        message:
          "Please enter a valid LinkedIn profile URL (e.g. linkedin.com/in/your-name).",
      });
    }

    const store = getStore();
    const now = Date.now();
    cleanupStore(store, now);

    const cookieHits = getCookieHits(req, now);
    if (cookieHits.length >= MAX_REQUESTS) {
      return json(
        res,
        429,
        { success: false, message: RATE_MESSAGE },
        [
          makeSignedCookie(COOKIE_RL, { hits: cookieHits }, 3600),
          makeSignedCookie(COOKIE_URL, getCookieUrls(req, now), 30 * 24 * 3600),
        ]
      );
    }

    const ip = getClientIp(req);
    const ipRate = checkIpRateLimit(store, ip, now);
    if (!ipRate.allowed) {
      return json(res, 429, { success: false, message: RATE_MESSAGE });
    }

    const cookieUrls = getCookieUrls(req, now);
    const urlKey = linkedinUrl.toLowerCase();
    const isDuplicate =
      Boolean(cookieUrls[urlKey]) || store.urls.has(urlKey);

    if (isDuplicate) {
      return json(
        res,
        200,
        {
          success: true,
          duplicate: true,
          allowed: false,
          message: DUPLICATE_MESSAGE,
        },
        [
          makeSignedCookie(COOKIE_RL, { hits: cookieHits }, 3600),
          makeSignedCookie(COOKIE_URL, cookieUrls, 30 * 24 * 3600),
        ]
      );
    }

    const lead = {
      id: `${now}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date(now).toISOString(),
      name: name || "",
      linkedinUrl,
      visitorId,
      source,
      referrer,
    };

    await storeLead(lead);

    const nextHits = [...cookieHits, now];
    cookieUrls[urlKey] = now;
    store.urls.set(urlKey, now);

    return json(
      res,
      200,
      {
        success: true,
        duplicate: false,
        allowed: true,
        remaining: Math.max(0, MAX_REQUESTS - nextHits.length),
        sanitized: { name: name || "", linkedinUrl, visitorId, source },
        message: "Thanks — I'll follow up on LinkedIn soon.",
      },
      [
        makeSignedCookie(COOKIE_RL, { hits: nextHits }, 3600),
        makeSignedCookie(COOKIE_URL, cookieUrls, 30 * 24 * 3600),
      ]
    );
  } catch {
    return json(res, 500, {
      success: false,
      message:
        "Something went wrong. Please email me directly at abubakartechab@gmail.com",
    });
  }
};
