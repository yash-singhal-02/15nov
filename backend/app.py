import os
from pathlib import Path

from dotenv import load_dotenv
from flask import Flask, jsonify, request, send_from_directory
from postgrest import APIError
from supabase import Client, create_client


ROOT = Path(__file__).resolve().parent.parent
FRONTEND = ROOT / "frontend"
load_dotenv(Path(__file__).with_name(".env"))

app = Flask(__name__, static_folder=str(FRONTEND), static_url_path="")
_supabase = None


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
    return send_from_directory(FRONTEND, "index.html")


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


@app.post("/api/registrations")
def create_registration():
    payload = request.get_json(silent=True) or {}
    event_id = payload.get("event_id")
    if not event_id:
        return jsonify({"success": False, "error": "event_id is required."}), 400

    try:
        client = get_supabase()
        user_id = get_demo_user_id(client)
        if not user_id:
            return jsonify({
                "success": False,
                "error": "Demo student not found. Set CAMPUSCONNECT_DEMO_USER_EMAIL to an email in the users table.",
            }), 409

        event_response = client.table("events").select("id,capacity,status").eq("id", event_id).limit(1).execute()
        if not event_response.data:
            return jsonify({"success": False, "error": "Event not found."}), 404
        event = event_response.data[0]
        if str(event.get("status", "open")).lower() in {"closed", "cancelled", "full"}:
            return jsonify({"success": False, "error": "This event is closed for registration."}), 409

        registrations = client.table("registration")
        existing = registrations.select("id").eq("event_id", event_id).eq("user_id", user_id).limit(1).execute()
        if existing.data:
            return jsonify({"success": False, "error": "You already have a registration for this event."}), 409

        count = registrations.select("id", count="exact").eq("event_id", event_id).execute().count or 0
        capacity = event.get("capacity")
        if capacity is not None and count >= int(capacity):
            return jsonify({"success": False, "error": "This event is full."}), 409

        created = registrations.insert({"user_id": user_id, "event_id": event_id}).execute()
        return jsonify({"success": True, "registration": created.data[0] if created.data else None}), 201
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
    try:
        client = get_supabase()
        user_id = get_demo_user_id(client)
        if not user_id:
            return jsonify({
                "success": False,
                "error": "Demo student not found. Set CAMPUSCONNECT_DEMO_USER_EMAIL to an email in the users table.",
            }), 409

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
        user_id = get_demo_user_id(client)
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
