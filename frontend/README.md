# CampusConnect frontend

This is the React frontend. The Flask API runs separately on Render.

## Run locally

1. Install dependencies and copy `.env.example` to `.env.local`. For a local Flask API, leave `VITE_API_BASE` blank. To use Render, set it to your Render API URL. Set `VITE_SUPABASE_URL` to your Supabase project URL and `VITE_SUPABASE_PUBLISHABLE_KEY` to the publishable key.
2. Start the frontend from this directory:

   ```bash
   npm install
   npm run dev
   ```

3. Open the Vite URL printed in the terminal. Do not open `dist/index.html` as a `file://` URL.

For local development with a local Flask server, leave `VITE_API_BASE` blank; Vite proxies `/api` to `http://127.0.0.1:5000`. For Vercel, set all three `VITE_*` variables in the project settings and redeploy. Set `CORS_ALLOWED_ORIGINS` in Render to the exact frontend origin(s), comma-separated if needed.

Apply `backend/migrations/001_atomic_registration.sql` and `backend/migrations/002_enable_realtime.sql` in the Supabase SQL Editor. The second migration enables change notifications for `public.users`, `public.events`, and `public.registration`. Realtime and API reads also require suitable `SELECT` grants and RLS policies for the publishable-key role. Keep RLS enabled and only grant the access your app needs.

`GET /api/health` checks that the API is running. The frontend subscribes to Realtime changes on the three public tables and retains a five-second refresh as a fallback. The API reads the app's `public.users`, `public.events`, and `public.registration` tables. It does not read Supabase Auth's private `auth.users` table.

Registration uses the selected `public.users` row and the `register_for_event` database function. Event create, update, and delete use the API and persist to Supabase. This persona switch is a demo, not authentication; add Supabase Auth and user-scoped RLS policies before using it for a public production app.

The current role switch is a demo UI, not sign-in. The app reads the public `users` profile table; Supabase Auth users in `auth.users` are private and will not appear automatically. The API's organizer checks use rows in `public.users`, not authenticated identity, so add Supabase Auth and user-scoped authorization before allowing public users to write data.
