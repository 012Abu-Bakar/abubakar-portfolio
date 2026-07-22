# Abu Bakar — Portfolio

Personal portfolio for QA / Test Automation (full-time + freelance).

**Live:** [https://abubakar-portfolio.vercel.app](https://abubakar-portfolio.vercel.app)

## Setup

1. Copy `config.example.js` → `config.js`
2. Add your Web3Forms + EmailJS keys in `config.js`
3. Open locally:

```bash
npx serve . -l 3000
```

## Deploy

```bash
npx vercel deploy --prod
```

Keep Vercel Deployment Protection (SSO) **off** so the public link works without login.

Alias should remain: `abubakar-portfolio.vercel.app`

## Contact form

- `/api/contact` — validation, temp-mail block, rate limit, email dedupe
- Browser sends via Web3Forms + EmailJS after the gatekeeper allows
- Submissions include traffic source / UTM fields (`Came from: linkedin`, etc.)

## Visit analytics

Two layers:

1. **Vercel Web Analytics** — enable in the Vercel project → Analytics. Script is loaded from `/_vercel/insights/script.js`.
2. **Private visit log** — client beacon → `/api/visit` → Upstash Redis; view at [`/stats.html`](https://abubakar-portfolio.vercel.app/stats.html) (password-protected, not in public nav).

### Env vars (Vercel project → Settings → Environment Variables)

| Variable | Purpose |
|---|---|
| `UPSTASH_REDIS_REST_URL` | Upstash Redis REST URL |
| `UPSTASH_REDIS_REST_TOKEN` | Upstash Redis REST token |
| `STATS_PASSWORD` | Password for `/stats.html` / `/api/stats` |

Without Upstash, visits fall back to in-memory storage (lost on cold starts). Still set `STATS_PASSWORD` so the dashboard works.

### One-time Upstash setup

1. Create a free Redis DB at [upstash.com](https://upstash.com)
2. Copy **REST URL** + **REST TOKEN**
3. In Vercel → Project → Settings → Environment Variables, add the three vars above for **Production**
4. Redeploy
5. Optional: Vercel → Analytics → enable **Web Analytics**

```bash
# Or via CLI (from portfolio folder, after `vercel link`):
npx vercel env add UPSTASH_REDIS_REST_URL production
npx vercel env add UPSTASH_REDIS_REST_TOKEN production
npx vercel env add STATS_PASSWORD production
npx vercel deploy --prod
```

### UTM share links (use these on social)

- LinkedIn: `https://abubakar-portfolio.vercel.app/?utm_source=linkedin&utm_medium=social`
- Instagram: `https://abubakar-portfolio.vercel.app/?utm_source=instagram&utm_medium=social`

Instagram often strips referrers — the UTM bio link is required for reliable Insta counts.

Personal tracked link example: `https://abubakar-portfolio.vercel.app/?ref=recruiter-name`
