# Deploying HaenyeoMNG to Vercel

The repo is already initialized and committed locally. These steps push it to
GitHub and deploy on Vercel. You'll do the parts that need your accounts.

## 1. Push to GitHub

Create an empty repo on GitHub (no README/gitignore — the repo already has them),
then from the project folder (`C:\Users\Lenre\OneDrive\Desktop\HaenyeoMNG`) run:

```bash
git remote add origin https://github.com/<your-username>/haenyeo-scheduling.git
git push -u origin main
```

`.env.local` is gitignored, so your Supabase values are **not** pushed — you'll set
them in Vercel in step 3.

## 2. Import into Vercel

1. Go to https://vercel.com/new and pick the GitHub repo you just pushed.
2. Vercel auto-detects **Vite**. Leave the defaults:
   - Build command: `vite build` (or `npm run build`)
   - Output directory: `dist`
   - Install command: `npm install`

## 3. Set environment variables (required)

In the Vercel import screen (or Project → Settings → Environment Variables), add
these two for the **Production** (and Preview) environments:

| Name | Value |
|---|---|
| `VITE_SUPABASE_URL` | `https://uasylyslmlxfjxwfsosf.supabase.co` |
| `VITE_SUPABASE_ANON_KEY` | `sb_publishable_6643hWCKC93dC0tMaAA_yg_HLrr1JJI` |

These match your local `.env.local`. The app reads them at build time, so if you
add them after the first deploy, trigger a redeploy.

> The publishable/anon key is safe to expose in the client bundle — Row Level
> Security is what protects the data, and it's enabled on every table. Never put
> a `service_role` key in these variables.

## 4. Deploy

Click **Deploy**. When it finishes you'll get a `*.vercel.app` URL. Open it — you
should see the manager login screen. Sign in with a Supabase account (created
under Authentication → Users) and the hub loads with live data.

## 5. Custom domain (optional)

Project → Settings → Domains → add your domain and follow the DNS instructions.

## Local development reminder

In a fresh terminal (Node is installed system-wide now):

```bash
npm install     # first time only
npm run dev     # http://localhost:5173
```
