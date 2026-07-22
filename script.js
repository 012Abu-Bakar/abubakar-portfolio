const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
const yearEl = document.getElementById("year");
const contactForm = document.getElementById("contact-form");
const config = window.PORTFOLIO_CONFIG || {};

const STORAGE_KEY = "portfolio_submitted_emails";
const COOLDOWN_KEY = "portfolio_last_submit_at";
const RATE_KEY = "portfolio_submit_hits";
const VISITOR_KEY = "portfolio_visitor_id";
const TRAFFIC_KEY = "portfolio_traffic_source";
const CLIENT_COOLDOWN_MS = 60 * 1000;
const CLIENT_MAX_PER_HOUR = 5;
const CLIENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const DUPLICATE_MESSAGE =
  "We have received your response. We will connect with you soon.";
const RATE_MESSAGE =
  "Too many requests. Please try again after some time (max 5 per hour).";

if (yearEl) yearEl.textContent = new Date().getFullYear();

function getOrCreateVisitorId() {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id =
        typeof crypto !== "undefined" && crypto.randomUUID
          ? crypto.randomUUID()
          : `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    return `v_${Date.now().toString(36)}`;
  }
}

function hostFromReferrer(referrer) {
  try {
    if (!referrer) return "";
    return new URL(referrer).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function mapPlatform(utmSource, referrer) {
  const utm = String(utmSource || "").toLowerCase().trim();
  if (utm) {
    if (utm.includes("linkedin")) return "linkedin";
    if (utm.includes("instagram") || utm === "ig") return "instagram";
    if (utm.includes("github")) return "github";
    if (utm.includes("twitter") || utm === "x") return "twitter";
    if (utm.includes("facebook") || utm === "fb") return "facebook";
    if (utm.includes("google")) return "google";
    return utm.replace(/[^a-z0-9_-]/g, "").slice(0, 40) || "other";
  }

  const host = hostFromReferrer(referrer);
  if (!host) return "direct";
  if (host.includes("linkedin.") || host === "lnkd.in") return "linkedin";
  if (host.includes("instagram.") || host === "l.instagram.com") return "instagram";
  if (host.includes("github.")) return "github";
  if (host.includes("twitter.") || host === "t.co" || host === "x.com") return "twitter";
  if (host.includes("facebook.") || host === "fb.com" || host === "m.facebook.com")
    return "facebook";
  if (host.includes("google.") || host === "google.com") return "google";
  return host.split(".")[0] || "referral";
}

function captureTrafficContext() {
  const params = new URLSearchParams(window.location.search);
  const utm_source = params.get("utm_source") || "";
  const utm_medium = params.get("utm_medium") || "";
  const utm_campaign = params.get("utm_campaign") || "";
  const refParam = params.get("ref") || "";
  const referrer = document.referrer || "";
  const source = mapPlatform(utm_source || refParam, referrer);

  const ctx = {
    source,
    utm_source,
    utm_medium,
    utm_campaign,
    referrer,
    ref: refParam,
    visitorId: getOrCreateVisitorId(),
    path: window.location.pathname + window.location.search,
    timestamp: new Date().toISOString(),
  };

  try {
    sessionStorage.setItem(TRAFFIC_KEY, JSON.stringify(ctx));
  } catch {
    /* ignore */
  }
  return ctx;
}

function getTrafficContext() {
  try {
    const raw = sessionStorage.getItem(TRAFFIC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === "object") return parsed;
    }
  } catch {
    /* ignore */
  }
  return captureTrafficContext();
}

function sendVisitBeacon(ctx) {
  const payload = {
    source: ctx.source,
    utm_source: ctx.utm_source,
    utm_medium: ctx.utm_medium,
    utm_campaign: ctx.utm_campaign,
    referrer: ctx.referrer,
    visitorId: ctx.visitorId,
    path: ctx.path,
    timestamp: ctx.timestamp,
  };

  try {
    if (navigator.sendBeacon) {
      const blob = new Blob([JSON.stringify(payload)], {
        type: "application/json",
      });
      navigator.sendBeacon("/api/visit", blob);
      return;
    }
  } catch {
    /* fall through */
  }

  fetch("/api/visit", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(payload),
    keepalive: true,
  }).catch(() => {});
}

const trafficContext = captureTrafficContext();
sendVisitBeacon(trafficContext);

document.querySelectorAll("[data-scroll-top]").forEach((link) => {
  link.addEventListener("click", (e) => {
    e.preventDefault();
    window.scrollTo({ top: 0, behavior: "smooth" });
    history.replaceState(null, "", "#top");
  });
});

window.addEventListener("scroll", () => {
  header.classList.toggle("scrolled", window.scrollY > 20);
});

navToggle.addEventListener("click", () => {
  const isOpen = navLinks.classList.toggle("open");
  navToggle.classList.toggle("open", isOpen);
  navToggle.setAttribute("aria-expanded", isOpen);
});

navLinks.querySelectorAll("a").forEach((link) => {
  link.addEventListener("click", () => {
    navLinks.classList.remove("open");
    navToggle.classList.remove("open");
    navToggle.setAttribute("aria-expanded", "false");
  });
});

const observer = new IntersectionObserver(
  (entries) => {
    entries.forEach((entry) => {
      if (entry.isIntersecting) {
        entry.target.style.opacity = "1";
        entry.target.style.transform = "translateY(0)";
      }
    });
  },
  { threshold: 0.1, rootMargin: "0px 0px -40px 0px" }
);

document
  .querySelectorAll(
    ".stat-card, .skill-group, .timeline-item, .project-card, .service-card, .achievement-card"
  )
  .forEach((el) => {
    el.style.opacity = "0";
    el.style.transform = "translateY(20px)";
    el.style.transition = "opacity 0.5s ease, transform 0.5s ease";
    observer.observe(el);
  });

function isConfigured(value) {
  return value && !String(value).startsWith("YOUR_");
}

function isValidEmailFormat(email) {
  const re =
    /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+$/;
  return re.test(email);
}

function getSubmittedEmails() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    return Array.isArray(list) ? list : [];
  } catch {
    return [];
  }
}

function getClientHits() {
  try {
    const raw = localStorage.getItem(RATE_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const now = Date.now();
    return Array.isArray(list)
      ? list.filter((t) => typeof t === "number" && now - t < CLIENT_RATE_WINDOW_MS)
      : [];
  } catch {
    return [];
  }
}

function recordClientHit() {
  const now = Date.now();
  const hits = [...getClientHits(), now];
  localStorage.setItem(RATE_KEY, JSON.stringify(hits));
  localStorage.setItem(COOLDOWN_KEY, String(now));
}

function markEmailSubmitted(email) {
  const list = getSubmittedEmails();
  if (!list.includes(email)) {
    list.push(email);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(list));
  }
  recordClientHit();
}

function showStatus(formStatus, text, type) {
  formStatus.textContent = text;
  formStatus.className = `form-status ${type}`;
  formStatus.hidden = false;
}

async function sendToWeb3Forms({ name, email, type, message }) {
  const traffic = getTrafficContext();
  const cameFrom = [
    traffic.source && `Came from: ${traffic.source}`,
    traffic.utm_source && `utm_source=${traffic.utm_source}`,
    traffic.utm_medium && `utm_medium=${traffic.utm_medium}`,
    traffic.utm_campaign && `utm_campaign=${traffic.utm_campaign}`,
    traffic.ref && `ref=${traffic.ref}`,
    traffic.referrer && `referrer=${traffic.referrer}`,
  ]
    .filter(Boolean)
    .join(" | ");

  const response = await fetch("https://api.web3forms.com/submit", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      access_key: config.WEB3FORMS_ACCESS_KEY,
      subject: `Portfolio Inquiry — ${type}`,
      from_name: "Abu Bakar Portfolio",
      name,
      email,
      type,
      message,
      source: traffic.source || "direct",
      utm_source: traffic.utm_source || "",
      utm_medium: traffic.utm_medium || "",
      utm_campaign: traffic.utm_campaign || "",
      referrer: traffic.referrer || "",
      traffic_source: cameFrom || "Came from: direct",
    }),
  });
  const data = await response.json();
  if (!response.ok || !data.success) {
    throw new Error(data.message || "Failed to send");
  }
}

async function sendAutoReply({ name, email, type }) {
  if (
    !isConfigured(config.EMAILJS_PUBLIC_KEY) ||
    !isConfigured(config.EMAILJS_SERVICE_ID) ||
    !isConfigured(config.EMAILJS_TEMPLATE_ID) ||
    typeof emailjs === "undefined"
  ) {
    return false;
  }

  emailjs.init(config.EMAILJS_PUBLIC_KEY);
  await emailjs.send(config.EMAILJS_SERVICE_ID, config.EMAILJS_TEMPLATE_ID, {
    name,
    email,
    to_name: name,
    to_email: email,
    reply_email: email,
    engagement_type: type,
  });
  return true;
}

if (contactForm) {
  const formStatus = document.getElementById("form-status");
  const submitBtn = document.getElementById("submit-btn");
  const emailInput = document.getElementById("email");

  emailInput?.addEventListener("blur", () => {
    const email = emailInput.value.trim().toLowerCase();
    if (email && !isValidEmailFormat(email)) {
      emailInput.setCustomValidity("Please enter a valid email address.");
    } else {
      emailInput.setCustomValidity("");
    }
  });

  contactForm.addEventListener("submit", async (e) => {
    e.preventDefault();

    const name = document.getElementById("name").value.trim();
    const email = document.getElementById("email").value.trim().toLowerCase();
    const type = document.getElementById("type").value;
    const message = document.getElementById("message").value.trim();
    const botcheck = contactForm.querySelector('[name="botcheck"]')?.checked;

    formStatus.hidden = true;
    formStatus.className = "form-status";

    if (!isConfigured(config.WEB3FORMS_ACCESS_KEY)) {
      showStatus(
        formStatus,
        "Form not configured. Please email abubakartechab@gmail.com directly.",
        "error"
      );
      return;
    }

    if (!isValidEmailFormat(email)) {
      showStatus(
        formStatus,
        "Please enter a valid email address (not a temporary email).",
        "error"
      );
      return;
    }

    if (getSubmittedEmails().includes(email)) {
      showStatus(formStatus, DUPLICATE_MESSAGE, "success");
      contactForm.reset();
      return;
    }

    const lastSubmit = Number(localStorage.getItem(COOLDOWN_KEY) || 0);
    if (Date.now() - lastSubmit < CLIENT_COOLDOWN_MS) {
      showStatus(
        formStatus,
        "Please wait a moment before sending another message.",
        "error"
      );
      return;
    }

    if (getClientHits().length >= CLIENT_MAX_PER_HOUR) {
      showStatus(formStatus, RATE_MESSAGE, "error");
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = "Sending...";

    try {
      // 1) Server gatekeeper: validation, temp-mail block, rate limit, dedupe
      const gateRes = await fetch("/api/contact", {
        method: "POST",
        credentials: "same-origin",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
        },
        body: JSON.stringify({
          name,
          email,
          type,
          message,
          botcheck: botcheck ? "1" : "",
        }),
      });

      const gate = await gateRes.json().catch(() => ({}));

      if (gateRes.status === 429) {
        recordClientHit();
        showStatus(formStatus, gate.message || RATE_MESSAGE, "error");
        return;
      }

      if (!gateRes.ok || !gate.success) {
        showStatus(
          formStatus,
          gate.message ||
            "Something went wrong. Please email me directly at abubakartechab@gmail.com",
          "error"
        );
        return;
      }

      if (gate.duplicate || gate.allowed === false) {
        markEmailSubmitted(email);
        showStatus(formStatus, gate.message || DUPLICATE_MESSAGE, "success");
        contactForm.reset();
        return;
      }

      const payload = gate.sanitized || { name, email, type, message };

      // 2) Browser-side delivery (required by Web3Forms free plan)
      await sendToWeb3Forms(payload);

      let autoReplySent = false;
      try {
        autoReplySent = await sendAutoReply(payload);
      } catch {
        autoReplySent = false;
      }

      markEmailSubmitted(payload.email);
      showStatus(
        formStatus,
        autoReplySent
          ? "Message sent! A confirmation email has been sent to you."
          : "Message sent! I'll get back to you soon.",
        "success"
      );
      contactForm.reset();
    } catch {
      showStatus(
        formStatus,
        "Something went wrong. Please email me directly at abubakartechab@gmail.com",
        "error"
      );
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = "Send Message";
    }
  });
}
