# Deploy Edge Functions (required for Group mode)

If you see "Edge Function returned a non-2xx status code" or "(404) Edge Function 'create-line' not found", the functions aren’t deployed to your Supabase project.

## 1. Install Supabase CLI (if needed)

```bash
npm install -g supabase
```

Or use `npx supabase` without installing (see below).

## 2. Log in and link your project

```bash
npx supabase login
```

Sign in in the browser, then:

```bash
npx supabase link --project-ref YOUR_PROJECT_REF
```

- **YOUR_PROJECT_REF**: Supabase Dashboard → **Project Settings** (gear) → **General** → **Reference ID** (short string like `abcdefghijklmnop`).

When prompted, choose your project or enter the ref.

## 3. Deploy the three functions

From the **project root** (where `supabase/functions/` lives):

```bash
npx supabase functions deploy create-line
npx supabase functions deploy get-line-state
npx supabase functions deploy set-line-state
```

Wait until each command reports success.

## 4. Confirm in the dashboard

Supabase Dashboard → **Edge Functions**. You should see:

- create-line  
- get-line-state  
- set-line-state  

## 5. Same project as the app

`VITE_SUPABASE_URL` in Vercel must point to the **same** Supabase project you linked and deployed to. If you have multiple projects, check Project Settings → API → Project URL and compare with your env var.
