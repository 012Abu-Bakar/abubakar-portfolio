const crypto = require("crypto");
const disposableDomains = require("./_disposable-domains");

const MAX_REQUESTS = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour
const EMAIL_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days
const COOKIE_RL = "pf_rl";
const COOKIE_EM = "pf_em";
const SECRET =
  process.env.CONTACT_SECRET || "portfolio-contact-v1-abubakar-secure";
const DUPLICATE_MESSAGE =
  "We have received your response. We will connect with you soon.";
const RATE_MESSAGE =
  "Too many requests. Please try again after some time (max 5 per hour).";

function getStore() {
  if (!globalThis.__portfolioContactStore) {
    globalThis.__portfolioContactStore = {
      ipHits: new Map(),
      emails: new Map(),
    };
  }
  return globalThis.__portfolioContactStore;
}

function cleanupStore(store, now) {
  for (const [ip, hits] of store.ipHits.entries()) {
    const fresh = hits.filter((t) => now - t < RATE_WINDOW_MS);
    if (fresh.length) store.ipHits.set(ip, fresh);
    else store.ipHits.delete(ip);
  }
  for (const [email, ts] of store.emails.entries()) {
    if (now - ts > EMAIL_TTL_MS) store.emails.delete(email);
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

function sanitizeMessage(value, maxLen) {
  return String(value || "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/<[^>]*>/g, "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLen);
}

function isValidEmailFormat(email) {
  if (!email || email.length > 254) return false;
  const re =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email);
}

function isDisposableEmail(email) {
  const domain = email.split("@")[1]?.toLowerCase();
  if (!domain) return true;
  if (disposableDomains.has(domain)) return true;

  const tempPatterns = [
    /temp-?mail/i,
    /tempmail/i,
    /mail\.tm$/i,
    /mailticking/i,
    /snapmail/i,
    /guerrillamail/i,
    /mailinator/i,
    /yopmail/i,
    /throwaway/i,
    /trash-?mail/i,
    /fakeinbox/i,
    /disposable/i,
    /10minute/i,
    /minutemail/i,
    /mailnesia/i,
    /maildrop/i,
    /mailsac/i,
    /getnada/i,
    /moakt/i,
    /tmpmail/i,
    /tmpbox/i,
    /tmpeml/i,
    /burnermail/i,
    /inboxkitten/i,
    /emailondeck/i,
    /mailpoof/i,
  ];

  if (tempPatterns.some((re) => re.test(domain))) return true;
  if (
    /^(temp|tmp|trash|fake|spam|disposable|throwaway|burner)/i.test(domain)
  ) {
    return true;
  }
  return false;
}

function getCookieHits(req, now) {
  const data = readSignedCookie(req, COOKIE_RL);
  const hits = Array.isArray(data?.hits) ? data.hits : [];
  return hits.filter((t) => typeof t === "number" && now - t < RATE_WINDOW_MS);
}

function getCookieEmails(req, now) {
  const data = readSignedCookie(req, COOKIE_EM);
  const emails = data && typeof data === "object" ? data : {};
  const out = {};
  for (const [email, ts] of Object.entries(emails)) {
    if (typeof ts === "number" && now - ts < EMAIL_TTL_MS) out[email] = ts;
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
    const email = String(body.email || "").trim().toLowerCase();
    const typeRaw = sanitizeText(body.type || "other", 40);
    const message = sanitizeMessage(body.message, 5000);
    const honeypot = String(body.botcheck || body.company || "").trim();
    const allowedTypes = new Set([
      "full-time",
      "freelance",
      "automation-project",
      "other",
    ]);
    const type = allowedTypes.has(typeRaw) ? typeRaw : "other";

    if (honeypot) {
      return json(res, 200, {
        success: true,
        duplicate: true,
        allowed: false,
        message: DUPLICATE_MESSAGE,
      });
    }

    if (!name || name.length < 2) {
      return json(res, 400, {
        success: false,
        message: "Please enter a valid name.",
      });
    }

    if (!message || message.length < 10) {
      return json(res, 400, {
        success: false,
        message: "Please enter a message (at least 10 characters).",
      });
    }

    if (!isValidEmailFormat(email)) {
      return json(res, 400, {
        success: false,
        message: "Please enter a valid email address.",
      });
    }

    if (isDisposableEmail(email)) {
      return json(res, 400, {
        success: false,
        message:
          "Temporary or disposable emails are not allowed. Please use a valid personal or work email.",
      });
    }

    const store = getStore();
    const now = Date.now();
    cleanupStore(store, now);

    // Durable browser rate limit (signed cookie) + soft IP memory limit
    const cookieHits = getCookieHits(req, now);
    if (cookieHits.length >= MAX_REQUESTS) {
      return json(
        res,
        429,
        { success: false, message: RATE_MESSAGE },
        [
          makeSignedCookie(COOKIE_RL, { hits: cookieHits }, 3600),
          makeSignedCookie(COOKIE_EM, getCookieEmails(req, now), 30 * 24 * 3600),
        ]
      );
    }

    const ip = getClientIp(req);
    const ipRate = checkIpRateLimit(store, ip, now);
    if (!ipRate.allowed) {
      return json(res, 429, { success: false, message: RATE_MESSAGE });
    }

    const cookieEmails = getCookieEmails(req, now);
    const isDuplicate =
      Boolean(cookieEmails[email]) || store.emails.has(email);

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
          makeSignedCookie(COOKIE_EM, cookieEmails, 30 * 24 * 3600),
        ]
      );
    }

    // Count this allowed attempt
    const nextHits = [...cookieHits, now];
    cookieEmails[email] = now;
    store.emails.set(email, now);

    return json(
      res,
      200,
      {
        success: true,
        duplicate: false,
        allowed: true,
        remaining: Math.max(0, MAX_REQUESTS - nextHits.length),
        sanitized: { name, email, type, message },
        message: "Validation passed.",
      },
      [
        makeSignedCookie(COOKIE_RL, { hits: nextHits }, 3600),
        makeSignedCookie(COOKIE_EM, cookieEmails, 30 * 24 * 3600),
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
