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

## Contact form

- `/api/contact` — validation, temp-mail block, rate limit, email dedupe
- Browser sends via Web3Forms + EmailJS after the gatekeeper allows
