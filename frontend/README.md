# CampusConnect frontend

This is a responsive, framework-free frontend. The Flask backend serves these files and the API from one origin, so no CORS setup or API URL override is needed.

## Run locally

1. Set `SUPABASE_URL` and `SUPABASE_KEY` in `backend/.env` (use a key that can update `public.users`). Set `CAMPUSCONNECT_DEMO_USER_EMAIL` to an email present in the `users` table, or leave it at the default `alex.turner@campus.edu`.
2. Start Flask from the repository root:

   ```powershell
   .\backend\venv\Scripts\python.exe backend\app.py
   ```

3. Open <http://127.0.0.1:5000>.

`GET /api/health` checks that the API is running. `GET /api/events` and `GET /api/events/{id}` read Supabase event rows; the event list includes organizer details when `organizer_id` matches a row in `users`, plus registration counts from `registration`. `GET /api/me` returns the configured demo user's safe profile fields. `GET /api/users` lists safe user fields, and `PATCH /api/users/{id}` changes a user's email and role. The organizer view has a simple editor for those fields; the configured demo account email stays tied to `CAMPUSCONNECT_DEMO_USER_EMAIL`. The browser refreshes profile, directory, and event data every five seconds while the page is visible. This is polling, not a Supabase Realtime websocket subscription.

Registration endpoints use the `registration` table and the configured demo user: `POST /api/registrations`, `GET /api/me/registrations`, and `DELETE /api/registrations/{registration_id}`. Cancelling deletes only the current demo user's registration row. The current `users` rows expose `id`, `email`, and `role`, but no name field; the UI therefore shows the real configured email until a `name`, `full_name`, or `username` column is added and populated. Event creation/deletion and real sign-in are not implemented. If Supabase credentials are missing, the site displays preview data and labels it as such.

The current role switch is a demo UI, not sign-in. Registration is attributed to the single configured demo account. User editing has no authentication or authorization and is intended only for this local app, which binds to `127.0.0.1`; do not expose it beyond localhost. Attendee lists remain unavailable until organizer authentication is added. Before deployment, replace this demo identity lookup with Supabase Auth and enforce authorization with database row-level security.
