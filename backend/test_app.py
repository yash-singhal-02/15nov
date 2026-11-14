"""Flask API workflow tests using an isolated in-memory Supabase test double."""

import copy
import sys
import threading
import unittest
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from types import SimpleNamespace

from postgrest import APIError

sys.path.insert(0, str(Path(__file__).resolve().parent))
import app as campus_app  # noqa: E402


class Query:
    def __init__(self, client, table):
        self.client = client
        self.table_name = table
        self.operation = "select"
        self.values = None
        self.filters = []
        self.columns = "*"
        self.count_rows = False
        self.limit_count = None

    def select(self, columns="*", count=None):
        self.columns = columns
        self.count_rows = count == "exact"
        return self

    def eq(self, key, value):
        self.filters.append((key, value))
        return self

    def in_(self, key, values):
        self.filters.append((key, set(values)))
        return self

    def limit(self, count):
        self.limit_count = count
        return self

    def insert(self, values):
        self.operation, self.values = "insert", values
        return self

    def update(self, values):
        self.operation, self.values = "update", values
        return self

    def delete(self):
        self.operation = "delete"
        return self

    def execute(self):
        rows = self.client.tables[self.table_name]
        if self.operation == "insert":
            value_rows = self.values if isinstance(self.values, list) else [self.values]
            inserted = []
            for value in value_rows:
                row = copy.deepcopy(value)
                row.setdefault("id", self.client.next_id(self.table_name))
                if self.table_name == "registration":
                    row.setdefault("createdat", "2026-11-14T00:00:00+00:00")
                rows.append(row)
                inserted.append(row)
            return SimpleNamespace(data=copy.deepcopy(inserted), count=len(inserted))

        matched = [row for row in rows if self._matches(row)]
        if self.limit_count is not None:
            matched = matched[:self.limit_count]
        if self.operation == "update":
            for row in matched:
                row.update(copy.deepcopy(self.values))
            return SimpleNamespace(data=copy.deepcopy(matched), count=len(matched))
        if self.operation == "delete":
            matched_ids = {id(row) for row in matched}
            rows[:] = [row for row in rows if id(row) not in matched_ids]
            return SimpleNamespace(data=copy.deepcopy(matched), count=len(matched))

        output = copy.deepcopy(matched)
        if self.table_name == "registration" and "event:events(*)" in self.columns:
            for row in output:
                row["event"] = next((copy.deepcopy(event) for event in self.client.tables["events"] if event["id"] == row["event_id"]), None)
        return SimpleNamespace(data=output, count=len(matched) if self.count_rows else None)

    def _matches(self, row):
        for key, expected in self.filters:
            if isinstance(expected, set):
                if row.get(key) not in expected:
                    return False
            elif str(row.get(key)) != str(expected):
                return False
        return True


class Rpc:
    def __init__(self, client, args):
        self.client = client
        self.args = args

    def execute(self):
        lock = self.client.event_locks.setdefault(self.args["p_event_id"], threading.Lock())
        with lock:
            return self._register()

    def _register(self):
        user_id = self.args["p_user_id"]
        event_id = self.args["p_event_id"]
        user = next((row for row in self.client.tables["users"] if row["id"] == user_id), None)
        if not user:
            raise APIError({"message": "User not found."})
        if user["role"] != "student":
            raise APIError({"message": "Only student users can register."})
        event = next((row for row in self.client.tables["events"] if row["id"] == event_id), None)
        if not event:
            raise APIError({"message": "Event not found."})
        if event["status"] not in {"open", "upcoming"}:
            raise APIError({"message": "This event is closed."})
        if any(row["event_id"] == event_id and row["user_id"] == user_id for row in self.client.tables["registration"]):
            raise APIError({"message": "You are already registered for this event."})
        count = sum(row["event_id"] == event_id for row in self.client.tables["registration"])
        if count >= event["capacity"]:
            raise APIError({"message": "This event is full."})
        inserted = Query(self.client, "registration").insert({"user_id": user_id, "event_id": event_id}).execute().data[0]
        return SimpleNamespace(data={"registration": inserted})


class FakeSupabase:
    def __init__(self):
        self.tables = {
            "users": [
                {"id": "student-1", "email": "one@example.edu", "role": "student"},
                {"id": "student-2", "email": "two@example.edu", "role": "student"},
                {"id": "organizer-1", "email": "host@example.edu", "role": "organizer"},
            ],
            "events": [
                {"id": "event-open", "organizer_id": "organizer-1", "title": "Open event", "capacity": 1, "status": "upcoming"},
                {"id": "event-closed", "organizer_id": "organizer-1", "title": "Closed event", "capacity": 2, "status": "closed"},
            ],
            "registration": [],
        }
        self.counter = 0
        self.event_locks = {}

    def next_id(self, table):
        self.counter += 1
        return f"{table}-{self.counter}"

    def table(self, name):
        return Query(self, name)

    def rpc(self, name, args):
        if name != "register_for_event":
            raise AssertionError(f"Unexpected RPC: {name}")
        return Rpc(self, args)


class CampusConnectApiTests(unittest.TestCase):
    def setUp(self):
        self.db = FakeSupabase()
        self.original_get_supabase = campus_app.get_supabase
        campus_app.get_supabase = lambda: self.db
        campus_app.app.config.update(TESTING=True)
        self.client = campus_app.app.test_client()

    def tearDown(self):
        campus_app.get_supabase = self.original_get_supabase

    def test_students_register_deregister_and_capacity_recovers(self):
        first = self.client.post("/api/registrations", json={"event_id": "event-open", "user_id": "student-1"})
        self.assertEqual(first.status_code, 201)
        registration_id = first.json["registration"]["id"]
        events = self.client.get("/api/events")
        open_event = next(row for row in events.json["events"] if row["id"] == "event-open")
        self.assertEqual(open_event["registered"], 1)

        duplicate = self.client.post("/api/registrations", json={"event_id": "event-open", "user_id": "student-1"})
        self.assertEqual(duplicate.status_code, 409)
        full = self.client.post("/api/registrations", json={"event_id": "event-open", "user_id": "student-2"})
        self.assertEqual(full.status_code, 409)
        closed = self.client.post("/api/registrations", json={"event_id": "event-closed", "user_id": "student-2"})
        self.assertEqual(closed.status_code, 409)

        cancelled = self.client.delete(f"/api/registrations/{registration_id}?user_id=student-1")
        self.assertEqual(cancelled.status_code, 200)
        second = self.client.post("/api/registrations", json={"event_id": "event-open", "user_id": "student-2"})
        self.assertEqual(second.status_code, 201)

        mine = self.client.get("/api/me/registrations?user_id=student-2")
        self.assertEqual(mine.status_code, 200)
        self.assertEqual(len(mine.json["registrations"]), 1)

    def test_simultaneous_registrations_cannot_overbook(self):
        def submit(user_id):
            with campus_app.app.test_client() as client:
                return client.post("/api/registrations", json={"event_id": "event-open", "user_id": user_id}).status_code

        with ThreadPoolExecutor(max_workers=2) as pool:
            statuses = list(pool.map(submit, ("student-1", "student-2")))
        self.assertCountEqual(statuses, [201, 409])
        self.assertEqual(sum(row["event_id"] == "event-open" for row in self.db.tables["registration"]), 1)

    def test_flask_serves_the_built_react_app_and_assets(self):
        page = self.client.get("/")
        self.assertEqual(page.status_code, 200)
        html = page.get_data(as_text=True)
        page.close()
        self.assertIn("CampusConnect", html)
        asset_path = next(part.split('"')[1] for part in html.split() if part.startswith('src="/assets/'))
        asset = self.client.get(asset_path)
        self.assertEqual(asset.status_code, 200)
        asset.close()

    def test_organizer_create_edit_roster_and_delete_constraints(self):
        created = self.client.post("/api/events", json={
            "organizer_id": "organizer-1", "title": "New event", "capacity": 2, "status": "open",
        })
        self.assertEqual(created.status_code, 201)
        event_id = created.json["event"]["id"]

        denied = self.client.post("/api/events", json={
            "organizer_id": "student-1", "title": "Not allowed", "capacity": 2, "status": "open",
        })
        self.assertEqual(denied.status_code, 403)

        updated = self.client.patch(f"/api/events/{event_id}", json={
            "organizer_id": "organizer-1", "title": "Updated event", "capacity": 2, "status": "closed",
        })
        self.assertEqual(updated.status_code, 200)
        self.assertEqual(updated.json["event"]["status"], "closed")
        closed_registration = self.client.post("/api/registrations", json={"event_id": event_id, "user_id": "student-1"})
        self.assertEqual(closed_registration.status_code, 409)

        reopened = self.client.patch(f"/api/events/{event_id}", json={
            "organizer_id": "organizer-1", "title": "Updated event", "capacity": 2, "status": "open",
        })
        self.assertEqual(reopened.status_code, 200)
        first_registration = self.client.post("/api/registrations", json={"event_id": event_id, "user_id": "student-1"})
        second_registration = self.client.post("/api/registrations", json={"event_id": event_id, "user_id": "student-2"})
        self.assertEqual(first_registration.status_code, 201)
        self.assertEqual(second_registration.status_code, 201)
        too_small = self.client.patch(f"/api/events/{event_id}", json={
            "organizer_id": "organizer-1", "title": "Updated event", "capacity": 1, "status": "open",
        })
        self.assertEqual(too_small.status_code, 409)

        roster = self.client.get(f"/api/events/{event_id}/registrations?organizer_id=organizer-1")
        self.assertEqual(roster.status_code, 200)
        self.assertEqual(roster.json["count"], 2)
        attendee_emails = {row["user"]["email"] for row in roster.json["registrations"]}
        self.assertEqual(attendee_emails, {"one@example.edu", "two@example.edu"})
        denied_roster = self.client.get(f"/api/events/{event_id}/registrations?organizer_id=student-1")
        self.assertEqual(denied_roster.status_code, 403)

        blocked_delete = self.client.delete(f"/api/events/{event_id}?organizer_id=organizer-1")
        self.assertEqual(blocked_delete.status_code, 409)
        for registration in (first_registration, second_registration):
            registration_id = registration.json["registration"]["id"]
            self.client.delete(f"/api/registrations/{registration_id}?user_id={registration.json['registration']['user_id']}")
        deleted = self.client.delete(f"/api/events/{event_id}?organizer_id=organizer-1")
        self.assertEqual(deleted.status_code, 200)


if __name__ == "__main__":
    unittest.main()
