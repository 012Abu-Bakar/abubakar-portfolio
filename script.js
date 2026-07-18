const header = document.querySelector(".site-header");
const navToggle = document.querySelector(".nav-toggle");
const navLinks = document.querySelector(".nav-links");
const yearEl = document.getElementById("year");
const contactForm = document.getElementById("contact-form");
const config = window.PORTFOLIO_CONFIG || {};

const STORAGE_KEY = "portfolio_submitted_emails";
const COOLDOWN_KEY = "portfolio_last_submit_at";
const RATE_KEY = "portfolio_submit_hits";
const CLIENT_COOLDOWN_MS = 60 * 1000;
const CLIENT_MAX_PER_HOUR = 5;
const CLIENT_RATE_WINDOW_MS = 60 * 60 * 1000;
const DUPLICATE_MESSAGE =
  "We have received your response. We will connect with you soon.";
const RATE_MESSAGE =
  "Too many requests. Please try again after some time (max 5 per hour).";

yearEl.textContent = new Date().getFullYear();

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
