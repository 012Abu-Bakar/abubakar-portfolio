const VISITS_KEY = "portfolio:visits";
const COUNTS_KEY = "portfolio:source_counts";
const MAX_RETURN = 200;

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

function parseAuth(req) {
  const header = req.headers.authorization || "";
  if (header.startsWith("Bearer ")) {
    return header.slice(7).trim();
  }
  let body = req.body;
  if (typeof body === "string") {
    try {
      body = JSON.parse(body);
    } catch {
      body = {};
    }
  }
  body = body || {};
  if (typeof body.password === "string") return body.password;
  try {
    const url = new URL(req.url || "/", "http://localhost");
    return url.searchParams.get("password") || "";
  } catch {
    return "";
  }
}

function json(res, status, body) {
  res.statusCode = status;
  res.setHeader("Content-Type", "application/json");
  res.setHeader("Cache-Control", "no-store");
  res.end(JSON.stringify(body));
}

async function loadStats() {
  if (hasUpstash()) {
    const [visitsRes, countsRes] = await Promise.all([
      redisCommand(["LRANGE", VISITS_KEY, 0, MAX_RETURN - 1]),
      redisCommand(["HGETALL", COUNTS_KEY]),
    ]);

    const rawVisits = Array.isArray(visitsRes?.result) ? visitsRes.result : [];
    const visits = rawVisits
      .map((item) => {
        try {
          return typeof item === "string" ? JSON.parse(item) : item;
        } catch {
          return null;
        }
      })
      .filter(Boolean);

    const flat = Array.isArray(countsRes?.result) ? countsRes.result : [];
    const bySource = {};
    for (let i = 0; i < flat.length; i += 2) {
      const key = flat[i];
      const val = Number(flat[i + 1] || 0);
      if (key) bySource[key] = val;
    }

    return {
      total: Object.values(bySource).reduce((a, b) => a + b, 0),
      bySource,
      visits,
      storage: "upstash",
    };
  }

  const store = getStore();
  return {
    total: store.visits.length,
    bySource: { ...store.sourceCounts },
    visits: store.visits.slice(0, MAX_RETURN),
    storage: "memory",
  };
}

module.exports = async function handler(req, res) {
  try {
    if (req.method === "OPTIONS") {
      res.statusCode = 204;
      res.setHeader("Access-Control-Allow-Origin", "*");
      res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
      res.setHeader(
        "Access-Control-Allow-Headers",
        "Content-Type, Authorization"
      );
      res.end();
      return;
    }

    if (req.method !== "GET" && req.method !== "POST") {
      return json(res, 405, { success: false, message: "Method not allowed" });
    }

    const expected = process.env.STATS_PASSWORD || "";
    if (!expected) {
      return json(res, 503, {
        success: false,
        message: "STATS_PASSWORD is not configured on the server.",
      });
    }

    const provided = parseAuth(req);
    if (!provided || provided !== expected) {
      return json(res, 401, {
        success: false,
        message: "Invalid password.",
      });
    }

    const stats = await loadStats();
    return json(res, 200, {
      success: true,
      ...stats,
    });
  } catch {
    return json(res, 500, {
      success: false,
      message: "Failed to load stats.",
    });
  }
};
