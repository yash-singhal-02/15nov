import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from postgrest import APIError
from supabase import Client, create_client


load_dotenv(Path(__file__).with_name(".env"))

app = Flask(__name__, static_folder=None)
_supabase = None


@app.after_request
def add_frontend_cors_headers(response):
    """Allow the separately deployed frontend to call this API."""
    allowed_origins = {
        origin.strip().rstrip("/")
        for origin in os.environ.get("CORS_ALLOWED_ORIGINS", "").split(",")
        if origin.strip()
    }
    origin = request.headers.get("Origin", "").rstrip("/")
    if origin in allowed_origins:
        response.headers["Access-Control-Allow-Origin"] = origin
        response.headers["Access-Control-Allow-Methods"] = "GET, POST, PATCH, DELETE, OPTIONS"
        response.headers["Access-Control-Allow-Headers"] = "Content-Type, Authorization"
        response.headers.add("Vary", "Origin")
    return response


def get_supabase() -> Client:
    """Create the Supabase client only when an API request needs it."""
    global _supabase
    if _supabase is None:
        url = os.environ.get("SUPABASE_URL")
        key = os.environ.get("SUPABASE_KEY")
        if not url or not key:
            raise RuntimeError("Set SUPABASE_URL and SUPABASE_KEY in backend/.env.")
        _supabase = create_client(url, key)
    return _supabase


@app.get("/")
def index():
    return jsonify({"success": True, "service": "CampusConnect API"})


@app.get("/api/health")
def health():
    return jsonify({"success": True, "service": "CampusConnect API"})


@app.get("/api/events")
def get_events():
    try:
        client = get_supabase()
        response = client.table("events").select("*").execute()
        events = response.data

        # Add organizer details from the existing users table without assuming
        # that the database has a PostgREST relationship configured.
        organizer_ids = {event.get("organizer_id") for event in events if event.get("organizer_id")}
        if organizer_ids:
            users = client.table("users").select("*").in_("id", list(organizer_ids)).execute().data
            safe_users = {}
            for user in users:
                safe_users[str(user.get("id"))] = {
                    key: user[key]
                    for key in ("id", "name", "full_name", "username", "email")
                    if user.get(key) is not None
                }
            for event in events:
                organizer = safe_users.get(str(event.get("organizer_id")))
                if organizer:
                    event["organizer"] = organizer
                    organizer_name = organizer.get("name") or organizer.get("full_name") or organizer.get("username")
                    if organizer_name:
                        event["organizer_name"] = organizer_name
                    event["organizer_email"] = organizer.get("email", "")

        # The UI's seat counts come from actual registration rows, not a
        # hardcoded/demo value in the event record.
        registration_rows = client.table("registration").select("event_id").execute().data
        counts = {}
        for row in registration_rows:
            event_id = str(row.get("event_id"))
            counts[event_id] = counts.get(event_id, 0) + 1
        for event in events:
            event["registered"] = counts.get(str(event.get("id")), 0)

        return jsonify({"success": True, "events": events})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to load events")
        return jsonify({"success": False, "error": str(error)}), 500


@app.get("/api/events/<event_id>")
def get_event(event_id):
    try:
        response = get_supabase().table("events").select("*").eq("id", event_id).limit(1).execute()
        if not response.data:
            return jsonify({"success": False, "error": "Event not found."}), 404
        return jsonify({"success": True, "event": response.data[0]})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to load event %s", event_id)
        return jsonify({"success": False, "error": str(error)}), 500


def get_demo_user_id(client: Client):
    """Resolve the configured demo account; replace this with Supabase Auth for real users."""
    email = os.environ.get("CAMPUSCONNECT_DEMO_USER_EMAIL", "alex.turner@campus.edu")
    response = client.table("users").select("id").eq("email", email).limit(1).execute()
    return response.data[0]["id"] if response.data else None


def get_user(client: Client, user_id: str):
    response = client.table("users").select("*").eq("id", user_id).limit(1).execute()
    return response.data[0] if response.data else None


def get_organizer(client: Client, user_id: str):
    user = get_user(client, user_id)
    if not user:
        return None
    if str(user.get("role", "")).lower() not in {"organizer", "organiser"}:
        return None
    return user


@app.get("/api/me")
def get_current_user():
    """Return the configured demo user's safe profile fields."""
    try:
        client = get_supabase()
        email = os.environ.get("CAMPUSCONNECT_DEMO_USER_EMAIL", "alex.turner@campus.edu")
        response = client.table("users").select("*").eq("email", email).limit(1).execute()
        if not response.data:
            return jsonify({"success": False, "error": "Configured demo user was not found in users."}), 404
        user = response.data[0]
        safe_user = {
            key: user[key]
            for key in ("id", "name", "full_name", "username", "email", "role")
            if user.get(key) is not None
        }
        return jsonify({"success": True, "user": safe_user})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to load configured demo user")
        return jsonify({"success": False, "error": str(error)}), 500


@app.get("/api/users")
def get_users():
    """Return a limited directory from the app's public users table."""
    try:
        response = get_supabase().table("users").select("*").execute()
        users = []
        for user in response.data:
            safe_user = {
                key: user[key]
                for key in ("id", "name", "full_name", "username", "email", "role")
                if user.get(key) is not None
            }
            users.append(safe_user)
        return jsonify({"success": True, "users": users})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to load users")
        return jsonify({"success": False, "error": str(error)}), 500


@app.patch("/api/users/<user_id>")
def update_user(user_id):
    """Update a user's email and role for this localhost demo app."""
    payload = request.get_json(silent=True) or {}
    email = payload.get("email")
    role = payload.get("role")
    if not isinstance(email, str) or "@" not in email.strip():
        return jsonify({"success": False, "error": "A valid email is required."}), 400
    if not isinstance(role, str) or not role.strip():
        return jsonify({"success": False, "error": "A role is required."}), 400

    try:
        client = get_supabase()
        users = client.table("users")
        existing = users.select("id,email").eq("id", user_id).limit(1).execute()
        if not existing.data:
            return jsonify({"success": False, "error": "User not found or could not be updated."}), 404
        configured_email = os.environ.get("CAMPUSCONNECT_DEMO_USER_EMAIL", "alex.turner@campus.edu")
        if existing.data[0].get("email") == configured_email and email.strip() != configured_email:
            return jsonify({"success": False, "error": "The configured demo user's email is set in backend/.env."}), 409
        users.update({"email": email.strip(), "role": role.strip()}).eq("id", user_id).execute()
        updated = users.select("*").eq("id", user_id).limit(1).execute()
        if not updated.data:
            return jsonify({"success": False, "error": "User update could not be confirmed."}), 502
        user = updated.data[0]
        safe_user = {
            key: user[key]
            for key in ("id", "email", "role")
            if user.get(key) is not None
        }
        return jsonify({"success": True, "user": safe_user})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to update user %s", user_id)
        return jsonify({"success": False, "error": str(error)}), 500


@app.post("/api/events")
def create_event():
    payload = request.get_json(silent=True) or {}
    title = payload.get("title")
    organizer_id = payload.get("organizer_id")
    try:
        capacity = int(payload.get("capacity", 0))
    except (TypeError, ValueError):
        return jsonify({"success": False, "error": "capacity must be a positive integer."}), 400
    status = str(payload.get("status", "open")).lower()
    if not isinstance(title, str) or not title.strip() or not organizer_id or capacity < 1:
        return jsonify({"success": False, "error": "title, organizer_id, and a positive capacity are required."}), 400
    if status not in {"open", "upcoming", "closed", "cancelled"}:
        return jsonify({"success": False, "error": "Unsupported event status."}), 400
    try:
        client = get_supabase()
        if not get_organizer(client, str(organizer_id)):
            return jsonify({"success": False, "error": "An organizer user is required to create events."}), 403
        created = client.table("events").insert({
            "title": title.strip(),
            "capacity": capacity,
            "status": status,
            "organizer_id": organizer_id,
        }).execute()
        if not created.data:
            return jsonify({"success": False, "error": "Supabase did not return the created event."}), 502
        return jsonify({"success": True, "event": created.data[0]}), 201
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to create event")
        return jsonify({"success": False, "error": "Unable to create event."}), 500


@app.patch("/api/events/<event_id>")
def update_event(event_id):
    payload = request.get_json(silent=True) or {}
    organizer_id = payload.get("organizer_id")
    updates = {}
    if "title" in payload:
        if not isinstance(payload["title"], str) or not payload["title"].strip():
            return jsonify({"success": False, "error": "title cannot be empty."}), 400
        updates["title"] = payload["title"].strip()
    if "capacity" in payload:
        try:
            updates["capacity"] = int(payload["capacity"])
        except (TypeError, ValueError):
            return jsonify({"success": False, "error": "capacity must be a positive integer."}), 400
        if updates["capacity"] < 1:
            return jsonify({"success": False, "error": "capacity must be a positive integer."}), 400
    if "status" in payload:
        updates["status"] = str(payload["status"]).lower()
        if updates["status"] not in {"open", "upcoming", "closed", "cancelled"}:
            return jsonify({"success": False, "error": "Unsupported event status."}), 400
    if not updates or not organizer_id:
        return jsonify({"success": False, "error": "organizer_id and at least one event field are required."}), 400
    try:
        client = get_supabase()
        if not get_organizer(client, str(organizer_id)):
            return jsonify({"success": False, "error": "An organizer user is required to edit events."}), 403
        events = client.table("events")
        existing = events.select("*").eq("id", event_id).limit(1).execute()
        if not existing.data:
            return jsonify({"success": False, "error": "Event not found."}), 404
        event = existing.data[0]
        if str(event.get("organizer_id")) != str(organizer_id):
            return jsonify({"success": False, "error": "Only the event organizer can edit it."}), 403
        if "capacity" in updates:
            count = client.table("registration").select("id", count="exact").eq("event_id", event_id).execute().count or 0
            if updates["capacity"] < count:
                return jsonify({"success": False, "error": "Capacity cannot be lower than the number of registrations."}), 409
        changed = events.update(updates).eq("id", event_id).execute()
        if not changed.data:
            return jsonify({"success": False, "error": "Supabase did not return the updated event."}), 502
        return jsonify({"success": True, "event": changed.data[0]})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to update event %s", event_id)
        return jsonify({"success": False, "error": "Unable to update event."}), 500


@app.delete("/api/events/<event_id>")
def delete_event(event_id):
    organizer_id = request.args.get("organizer_id")
    if not organizer_id:
        return jsonify({"success": False, "error": "organizer_id is required."}), 400
    try:
        client = get_supabase()
        if not get_organizer(client, organizer_id):
            return jsonify({"success": False, "error": "An organizer user is required to delete events."}), 403
        events = client.table("events")
        existing = events.select("*").eq("id", event_id).limit(1).execute()
        if not existing.data:
            return jsonify({"success": False, "error": "Event not found."}), 404
        if str(existing.data[0].get("organizer_id")) != str(organizer_id):
            return jsonify({"success": False, "error": "Only the event organizer can delete it."}), 403
        registrations = client.table("registration").select("id").eq("event_id", event_id).limit(1).execute()
        if registrations.data:
            return jsonify({"success": False, "error": "Cancel registrations before deleting this event."}), 409
        events.delete().eq("id", event_id).execute()
        return jsonify({"success": True, "message": "Event deleted."})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to delete event %s", event_id)
        return jsonify({"success": False, "error": "Unable to delete event."}), 500


@app.get("/api/events/<event_id>/registrations")
def get_event_registrations(event_id):
    organizer_id = request.args.get("organizer_id")
    try:
        client = get_supabase()
        if not organizer_id or not get_organizer(client, organizer_id):
            return jsonify({"success": False, "error": "An organizer user is required to view the roster."}), 403
        event = client.table("events").select("id,organizer_id").eq("id", event_id).limit(1).execute()
        if not event.data:
            return jsonify({"success": False, "error": "Event not found."}), 404
        if str(event.data[0].get("organizer_id")) != str(organizer_id):
            return jsonify({"success": False, "error": "Only the event organizer can view this roster."}), 403
        rows = client.table("registration").select("*").eq("event_id", event_id).execute().data
        user_ids = list({row.get("user_id") for row in rows if row.get("user_id")})
        users = client.table("users").select("*").in_("id", user_ids).execute().data if user_ids else []
        by_id = {str(user.get("id")): user for user in users}
        for row in rows:
            user = by_id.get(str(row.get("user_id")), {})
            row["user"] = {key: user[key] for key in ("id", "email", "name", "full_name", "username") if user.get(key) is not None}
        return jsonify({"success": True, "registrations": rows, "count": len(rows)})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to load event roster %s", event_id)
        return jsonify({"success": False, "error": "Unable to load event roster."}), 500


@app.post("/api/registrations")
def create_registration():
    payload = request.get_json(silent=True) or {}
    event_id = payload.get("event_id")
    if not event_id or not payload.get("user_id"):
        return jsonify({"success": False, "error": "event_id and user_id are required."}), 400

    try:
        client = get_supabase()
        created = client.rpc("register_for_event", {
            "p_user_id": payload["user_id"],
            "p_event_id": event_id,
        }).execute()
        result = created.data if isinstance(created.data, dict) else {}
        return jsonify({"success": True, "registration": result.get("registration")}), 201
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        app.logger.warning("Registration request failed: %s", error.message)
        return jsonify({"success": False, "error": error.message}), 502
    except Exception as error:
        app.logger.exception("Unable to register for event %s", event_id)
        return jsonify({"success": False, "error": "Unable to complete registration."}), 500


@app.delete("/api/registrations/<registration_id>")
def delete_registration(registration_id):
    user_id = request.args.get("user_id")
    if not user_id:
        return jsonify({"success": False, "error": "user_id is required."}), 400
    try:
        client = get_supabase()
        registrations = client.table("registration")
        existing = (
            registrations.select("id")
            .eq("id", registration_id)
            .eq("user_id", user_id)
            .limit(1)
            .execute()
        )
        if not existing.data:
            return jsonify({"success": False, "error": "Registration not found."}), 404

        (
            registrations.delete()
            .eq("id", registration_id)
            .eq("user_id", user_id)
            .execute()
        )
        return jsonify({"success": True, "message": "Registration cancelled."})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        app.logger.warning("Registration cancellation failed: %s", error.message)
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to cancel registration %s", registration_id)
        return jsonify({"success": False, "error": "Unable to cancel registration."}), 500


@app.get("/api/me/registrations")
def get_my_registrations():
    try:
        client = get_supabase()
        user_id = request.args.get("user_id") or get_demo_user_id(client)
        if not user_id:
            return jsonify({"success": True, "registrations": []})
        response = (
            client.table("registration")
            .select("*, event:events(*)")
            .eq("user_id", user_id)
            .execute()
        )
        return jsonify({"success": True, "registrations": response.data})
    except RuntimeError as error:
        return jsonify({"success": False, "error": str(error)}), 503
    except APIError as error:
        return jsonify({"success": False, "error": error.message}), 502
    except Exception:
        app.logger.exception("Unable to load demo user registrations")
        return jsonify({"success": False, "error": "Unable to load registrations."}), 500


if __name__ == "__main__":
    app.run(host="127.0.0.1", port=int(os.environ.get("PORT", "5000")), debug=True)
