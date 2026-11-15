import React, { useCallback, useEffect, useMemo, useState } from "react";
import { createClient } from "@supabase/supabase-js";

const API = import.meta.env.VITE_API_BASE || "";
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const POLL_MS = 5000;

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(`${API}${path}`, {
      ...options,
      headers: {
        Accept: "application/json",
        ...(options.body ? { "Content-Type": "application/json" } : {}),
        ...options.headers,
      },
    });
  } catch {
    throw new Error("Could not reach CampusConnect API. Start the Flask backend and try again.");
  }
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(body.error || body.message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return body;
}

const isOrganizer = (user) => ["organizer", "organiser"].includes(String(user?.role || "").toLowerCase());
const isStudent = (user) => String(user?.role || "").toLowerCase() === "student";
const safeInitials = (value) => String(value || "U").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
const eventOpen = (event) => ["open", "upcoming"].includes(String(event.status || "open").toLowerCase()) && Number(event.registered || 0) < Number(event.capacity || 0);
const percentFull = (event) => event.capacity > 0 ? Math.min(100, Math.round((event.registered / event.capacity) * 100)) : 0;
const formatDate = (value) => value ? new Date(value).toLocaleString() : "Date not provided";

function Icon({ name, size = 18 }) {
  const paths = {
    explore: <><circle cx="12" cy="12" r="9"/><path d="m15.8 8.2-2.2 5.4-5.4 2.2 2.2-5.4z"/></>,
    ticket: <><path d="M3 8V5h18v3a3 3 0 0 0 0 6v5H3v-5a3 3 0 0 0 0-6Z"/><path d="M13 5v2m0 3v2m0 3v2"/></>,
    manage: <><rect x="3" y="3" width="8" height="8" rx="1.5"/><rect x="13" y="3" width="8" height="5" rx="1.5"/><rect x="13" y="10" width="8" height="11" rx="1.5"/><rect x="3" y="13" width="8" height="8" rx="1.5"/></>,
    plus: <><circle cx="12" cy="12" r="9"/><path d="M12 8v8m-4-4h8"/></>,
    refresh: <><path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.5 9a7 7 0 0 1 11.7-2L20 12M4 12l2.8 5a7 7 0 0 0 11.7-2"/></>,
    swap: <><path d="m16 3 4 4-4 4M4 7h16M8 21l-4-4 4-4m12 4H4"/></>,
    close: <><path d="m18 6-12 12M6 6l12 12"/></>,
    clock: <><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></>,
    users: <><path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/></>,
    trash: <><path d="M3 6h18m-2 0-.9 14H5.9L5 6m4 0V4h6v2m-5 4v6m4-6v6"/></>,
    edit: <><path d="m15 5 4 4M4 20l4-.8L19 8a2.1 2.1 0 0 0-3-3L5 16z"/></>,
    arrow: <><path d="M5 12h14m-6-6 6 6-6 6"/></>,
    search: <><circle cx="10.8" cy="10.8" r="6.8"/><path d="m16 16 4 4"/></>,
    check: <><path d="m5 12 4 4L19 6"/></>,
    lock: <><rect x="4" y="10" width="16" height="11" rx="2"/><path d="M8 10V7a4 4 0 0 1 8 0v3"/></>,
  };
  return <svg aria-hidden="true" width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] || paths.explore}</svg>;
}

function Avatar({ user, size = "normal" }) {
  return <span className={`avatar ${size}`} aria-hidden="true">{safeInitials(user?.email)}</span>;
}

function App() {
  const [users, setUsers] = useState([]);
  const [activeUser, setActiveUser] = useState(null);
  const [events, setEvents] = useState([]);
  const [registrations, setRegistrations] = useState([]);
  const [view, setView] = useState("explore");
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const [dialog, setDialog] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [userMenu, setUserMenu] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [lastSynced, setLastSynced] = useState(null);

  const loadEvents = useCallback(async () => {
    const payload = await request("/api/events");
    setEvents(Array.isArray(payload.events) ? payload.events : []);
  }, []);

  const loadUsers = useCallback(async () => {
    const payload = await request("/api/users");
    const rows = Array.isArray(payload.users) ? payload.users : [];
    setUsers(rows);
    return rows;
  }, []);

  const loadRegistrations = useCallback(async (userId) => {
    if (!userId) {
      setRegistrations([]);
      return;
    }
    const payload = await request(`/api/me/registrations?user_id=${encodeURIComponent(userId)}`);
    setRegistrations(Array.isArray(payload.registrations) ? payload.registrations : []);
  }, []);

  const refresh = useCallback(async (selectedId = activeUser?.id) => {
    try {
      const [nextUsers] = await Promise.all([loadUsers(), loadEvents()]);
      const selected = nextUsers.find((user) => String(user.id) === String(selectedId));
      setActiveUser(selected || null);
      if (selectedId) await loadRegistrations(selectedId);
      setLastSynced(Date.now());
      setError("");
    } catch (caught) {
      setError(caught.message);
    } finally {
      setLoading(false);
    }
  }, [activeUser?.id, loadEvents, loadRegistrations, loadUsers]);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const [userPayload, eventPayload, mePayload] = await Promise.all([
          request("/api/users"), request("/api/events"), request("/api/me").catch(() => null),
        ]);
        if (!mounted) return;
        const nextUsers = Array.isArray(userPayload.users) ? userPayload.users : [];
        setUsers(nextUsers);
        setEvents(Array.isArray(eventPayload.events) ? eventPayload.events : []);
        const storedId = localStorage.getItem("campusconnect-active-user");
        const selected = nextUsers.find((user) => String(user.id) === String(storedId))
          || nextUsers.find((user) => String(user.id) === String(mePayload?.user?.id))
          || nextUsers[0]
          || null;
        setActiveUser(selected);
        if (selected) localStorage.setItem("campusconnect-active-user", selected.id);
        if (selected) {
          const registrationPayload = await request(`/api/me/registrations?user_id=${encodeURIComponent(selected.id)}`);
          if (mounted) setRegistrations(registrationPayload.registrations || []);
        }
        setLastSynced(Date.now());
      } catch (caught) {
        if (mounted) setError(caught.message);
      } finally {
        if (mounted) setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, []);

  useEffect(() => {
    if (!activeUser?.id) return undefined;
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") refresh(activeUser.id);
    }, POLL_MS);
    const onFocus = () => refresh(activeUser.id);
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(timer);
      window.removeEventListener("focus", onFocus);
    };
  }, [activeUser?.id, refresh]);

  useEffect(() => {
    if (!supabase) return undefined;
    const channel = supabase.channel("campusconnect-live-data");
    for (const table of ["users", "events", "registration"]) {
      channel.on("postgres_changes", {
        event: "*",
        schema: "public",
        table,
      }, () => refresh(activeUser?.id));
    }
    channel.subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [activeUser?.id, refresh]);

  useEffect(() => {
    if (!toast) return undefined;
    const timer = window.setTimeout(() => setToast(""), 3200);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const myEvents = useMemo(() => events.filter((event) => String(event.organizer_id) === String(activeUser?.id)), [events, activeUser?.id]);
  const studentOwnedEventCount = events.filter((event) => users.some((user) => String(user.id) === String(event.organizer_id) && isStudent(user))).length;
  const filteredEvents = useMemo(() => events.filter((event) => {
    const textMatches = `${event.title || ""} ${event.organizer_email || ""}`.toLowerCase().includes(query.trim().toLowerCase());
    const open = eventOpen(event);
    const filterMatches = filter === "all" || (filter === "open" && open) || (filter === "closed" && !open);
    return textMatches && filterMatches;
  }), [events, filter, query]);
  const totalRegistrations = events.reduce((sum, event) => sum + Number(event.registered || 0), 0);
  const totalCapacity = events.reduce((sum, event) => sum + Number(event.capacity || 0), 0);

  async function switchUser(user) {
    setActiveUser(user);
    localStorage.setItem("campusconnect-active-user", user.id);
    setUserMenu(false);
    setView("explore");
    setError("");
    try {
      await loadRegistrations(user.id);
      setToast(`Viewing as ${user.email} · ${user.role}`);
    } catch (caught) {
      setError(caught.message);
    }
  }

  async function register(event) {
    if (!activeUser || !isStudent(activeUser)) return setError("Switch to a student user to register.");
    setBusy(true);
    setError("");
    try {
      await request("/api/registrations", { method: "POST", body: JSON.stringify({ event_id: event.id, user_id: activeUser.id }) });
      setDialog(null);
      setToast("Registration confirmed.");
      await refresh(activeUser.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function deregister(registration) {
    if (!activeUser || !window.confirm(`Cancel your registration for ${registration.event?.title || "this event"}?`)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/registrations/${encodeURIComponent(registration.id)}?user_id=${encodeURIComponent(activeUser.id)}`, { method: "DELETE" });
      setToast("Registration cancelled. The seat is available again.");
      await refresh(activeUser.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function saveEvent(form, existing = null) {
    if (!activeUser || !isOrganizer(activeUser)) return setError("Switch to an organizer user to manage events.");
    const formData = new FormData(form);
    const payload = {
      title: String(formData.get("title") || "").trim(),
      capacity: Number(formData.get("capacity")),
      status: formData.get("status"),
      organizer_id: activeUser.id,
    };
    setBusy(true);
    setError("");
    try {
      await request(existing ? `/api/events/${encodeURIComponent(existing.id)}` : "/api/events", {
        method: existing ? "PATCH" : "POST",
        body: JSON.stringify(payload),
      });
      setDialog(null);
      setToast(existing ? "Event updated." : "Event published to Supabase.");
      await refresh(activeUser.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function deleteEvent(event) {
    if (!activeUser || !window.confirm(`Delete “${event.title}”? Events with registrations must be cleared first.`)) return;
    setBusy(true);
    setError("");
    try {
      await request(`/api/events/${encodeURIComponent(event.id)}?organizer_id=${encodeURIComponent(activeUser.id)}`, { method: "DELETE" });
      setToast("Event deleted.");
      await refresh(activeUser.id);
    } catch (caught) {
      setError(caught.message);
    } finally {
      setBusy(false);
    }
  }

  async function showRoster(event) {
    setDialog({ type: "roster", event, loading: true, registrations: [] });
    try {
      const payload = await request(`/api/events/${encodeURIComponent(event.id)}/registrations?organizer_id=${encodeURIComponent(activeUser.id)}`);
      setDialog({ type: "roster", event, loading: false, registrations: payload.registrations || [] });
    } catch (caught) {
      setDialog({ type: "roster", event, loading: false, error: caught.message, registrations: [] });
    }
  }

  function openEvent(event) { setDialog({ type: "event", event }); }

  const navItems = [
    ["explore", "Explore", "explore"], ["tickets", "Tickets", "ticket"],
    ...(isOrganizer(activeUser) ? [["manage", "Manage", "manage"]] : []),
  ];

  return <div className="app-shell">
    <header className="topbar">
      <div className="brand"><div className="brand-mark"><Icon name="ticket" size={21} /></div><div><strong>CampusConnect</strong><span>Campus events</span></div></div>
      <nav className="desktop-nav" aria-label="Main navigation">{navItems.map(([key, label, icon]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}><Icon name={icon} size={17} />{label}</button>)}</nav>
      <div className="top-actions">
        <button className="switch-pill" onClick={() => setUserMenu(true)} disabled={!users.length}><span className={`role-dot ${isOrganizer(activeUser) ? "organizer" : ""}`}></span><span>{activeUser?.email || "Loading user…"}<small>{activeUser?.role || ""}</small></span><Icon name="swap" size={15} /></button>
        <Avatar user={activeUser} />
      </div>
    </header>

    <main className="page">
      {error && <div className="error-banner" role="alert"><span>{error}</span><button onClick={() => setError("")} aria-label="Dismiss"><Icon name="close" size={16}/></button></div>}
      {loading ? <div className="loading-state"><span className="spinner" />Loading live Supabase data…</div> : !activeUser ? <div className="empty-state"><strong>No users found</strong><p>Add a user row in the Supabase <code>users</code> table to switch personas.</p></div> : <>
        {view === "explore" && <>
          <section className="welcome-row"><div><span className="eyebrow"><span className="live-dot" /> Live from Supabase</span><h1>Discover campus life</h1><p>Browse events and register with your selected student persona.</p></div><div className="profile-card"><Avatar user={activeUser}/><div><strong>{activeUser.email}</strong><span>{activeUser.role}</span></div><button className="button button-subtle" onClick={() => setUserMenu(true)}><Icon name="swap" size={15}/> Switch</button></div></section>
          <section className="hero"><div className="hero-copy"><span className="hero-kicker"><span className="live-dot"/> Campus events</span><h2>Find your next idea, community, or unforgettable campus moment.</h2><p>Browse real events, live seat availability, and registration status from your campus database.</p></div><div className="hero-stats"><div><strong>{events.length}</strong><span>Events</span></div><div><strong>{totalRegistrations}</strong><span>Registered</span></div><div><strong>{Math.max(0, totalCapacity - totalRegistrations)}</strong><span>Seats open</span></div></div></section>
          <section className="browse-section"><div className="section-heading"><div><span className="eyebrow">Campus calendar</span><h2>Campus events</h2></div><button className="icon-button" onClick={() => refresh()} aria-label="Refresh data"><Icon name="refresh"/></button></div>
            <div className="toolbar"><label className="search-field"><Icon name="search" size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search events…" /></label><div className="filter-tabs">{[["all", "All"], ["open", "Open seats"], ["closed", "Full / closed"]].map(([key, label]) => <button key={key} onClick={() => setFilter(key)} className={filter === key ? "selected" : ""}>{label}<span>{key === "all" ? events.length : events.filter((event) => key === "open" ? eventOpen(event) : !eventOpen(event)).length}</span></button>)}</div></div>
            {filteredEvents.length ? <div className="event-grid">{filteredEvents.map((event) => <EventCard key={event.id} event={event} onOpen={() => openEvent(event)} onRegister={() => register(event)} onTickets={() => setView("tickets")} busy={busy} canRegister={isStudent(activeUser)} isRegistered={registrations.some((row) => String(row.event_id) === String(event.id))} />)}</div> : <div className="empty-state"><strong>{events.length ? "No events match" : "No events yet"}</strong><p>{events.length ? "Try another search or availability filter." : "Events created by organizers will appear here."}</p>{isOrganizer(activeUser) && <button className="button button-primary" onClick={() => setDialog({ type: "event-form" })}><Icon name="plus"/> Create an event</button>}</div>}
          </section>
        </>}

        {view === "tickets" && <section className="tickets-view"><div className="section-heading"><div><span className="eyebrow">Your schedule</span><h1>My registrations</h1><p>Registrations for <strong>{activeUser.email}</strong></p></div><button className="icon-button" onClick={() => refresh()} aria-label="Refresh registrations"><Icon name="refresh"/></button></div><div className="metric-row"><Metric label="Registrations" value={registrations.length} icon="ticket"/><Metric label="Open events" value={registrations.filter((row) => events.find((event) => String(event.id) === String(row.event_id))?.status === "open").length} icon="clock"/><Metric label="Seats held" value={registrations.length} icon="check"/></div>
          {registrations.length ? <div className="registration-list">{registrations.map((registration) => {
            const currentEvent = events.find((event) => String(event.id) === String(registration.event_id));
            const enriched = { ...registration, event: { ...(registration.event || {}), ...(currentEvent || {}) } };
            return <RegistrationCard key={registration.id} registration={enriched} onCancel={() => deregister(enriched)} busy={busy}/>;
          })}</div> : <div className="empty-state"><div className="empty-icon"><Icon name="ticket" size={23}/></div><strong>No registrations yet</strong><p>Browse events and book a seat.</p><button className="button button-primary" onClick={() => setView("explore")}>Browse events <Icon name="arrow" size={16}/></button></div>}
        </section>}

        {view === "manage" && isOrganizer(activeUser) && <section className="manage-view"><div className="section-heading"><div><span className="eyebrow"><span className="live-dot"/> Synced with Supabase</span><h1>Organizer console</h1><p>Manage events owned by <strong>{activeUser.email}</strong>.</p></div><button className="button button-primary" onClick={() => setDialog({ type: "event-form" })}><Icon name="plus"/> New event</button></div>
          <div className="metric-row"><Metric label="Your events" value={myEvents.length} icon="manage"/><Metric label="Registrations" value={myEvents.reduce((n, event) => n + Number(event.registered || 0), 0)} icon="users"/><Metric label="Seats available" value={myEvents.reduce((n, event) => n + Math.max(0, Number(event.capacity || 0) - Number(event.registered || 0)), 0)} icon="ticket"/><Metric label="Full / closed" value={myEvents.filter((event) => !eventOpen(event)).length} icon="lock"/></div>
          <div className="section-heading section-heading-compact"><div><h2>Your events</h2><p>Live registrations refresh every five seconds.</p></div><span className="sync-label"><span className="live-dot"/> {lastSynced ? `Updated ${new Date(lastSynced).toLocaleTimeString()}` : "Syncing"}</span></div>
          {myEvents.length ? <div className="managed-list">{myEvents.map((event) => <ManagedEvent key={event.id} event={event} onRoster={() => showRoster(event)} onEdit={() => setDialog({ type: "event-form", event })} onDelete={() => deleteEvent(event)} onToggle={() => updateEventStatus(event, activeUser, refresh, setError, setToast, setBusy)} busy={busy}/>)}</div> : <div className="empty-state"><strong>{events.length ? "No events assigned to this organizer" : "No events created yet"}</strong><p>{events.length ? `${studentOwnedEventCount} existing event${studentOwnedEventCount === 1 ? " is" : "s are"} assigned to student-role users in Supabase. Change the owner role or organizer_id to manage those rows here.` : "Create an event to publish it to students."}</p><button className="button button-primary" onClick={() => setDialog({ type: "event-form" })}><Icon name="plus"/> Create event</button></div>}
        </section>}
      </>}
    </main>

    <nav className="bottom-nav" aria-label="Mobile navigation">{navItems.map(([key, label, icon]) => <button key={key} className={view === key ? "active" : ""} onClick={() => setView(key)}><Icon name={icon} size={21}/><span>{label}</span></button>)}</nav>
    <div className="sync-footnote"><span className="live-dot"/> Auto-refreshing every 5 seconds</div>
    {toast && <div className="toast" role="status"><Icon name="check" size={17}/>{toast}</div>}

    {userMenu && <Modal title="Switch active persona" subtitle="Choose a real user row from Supabase" onClose={() => setUserMenu(false)}><div className="persona-list">{users.map((user) => <button key={user.id} className={`persona-option ${String(user.id) === String(activeUser?.id) ? "active" : ""}`} onClick={() => switchUser(user)}><Avatar user={user}/><span><strong>{user.email}</strong><small>{user.role}</small></span>{String(user.id) === String(activeUser?.id) && <Icon name="check"/>}</button>)}</div></Modal>}
    {dialog?.type === "event" && <Modal title="Event details" subtitle="Live event and registration details" onClose={() => setDialog(null)}><div className="detail-hero"><StatusPill event={dialog.event}/><h2>{dialog.event.title}</h2><p>Organizer: {dialog.event.organizer_email || "Campus organizer"}</p></div><div className="detail-metrics"><Metric label="Capacity" value={dialog.event.capacity} icon="users"/><Metric label="Registered" value={dialog.event.registered} icon="check"/><Metric label="Available" value={Math.max(0, dialog.event.capacity - dialog.event.registered)} icon="ticket"/></div><Capacity event={dialog.event}/>{isStudent(activeUser) && (registrations.some((row) => String(row.event_id) === String(dialog.event.id)) ? <button className="button button-subtle button-wide" onClick={() => { setDialog(null); setView("tickets"); }}>Already registered · View tickets <Icon name="ticket"/></button> : <button className="button button-primary button-wide" disabled={busy || !eventOpen(dialog.event)} onClick={() => register(dialog.event)}>{busy ? "Registering…" : eventOpen(dialog.event) ? "Register for event" : "Registration closed"}</button>)}</Modal>}
    {dialog?.type === "event-form" && <Modal title={dialog.event ? "Edit event" : "Create event"} subtitle="Changes save directly to the Supabase events table" onClose={() => !busy && setDialog(null)}><form className="event-form" onSubmit={(e) => { e.preventDefault(); saveEvent(e.currentTarget, dialog.event); }}><label>Event title<input name="title" required maxLength="180" defaultValue={dialog.event?.title || ""} placeholder="e.g. Campus technology meetup"/></label><label>Capacity<input name="capacity" required type="number" min="1" step="1" defaultValue={dialog.event?.capacity || ""} placeholder="100"/></label><label>Registration status<select name="status" defaultValue={dialog.event?.status || "upcoming"}><option value="upcoming">Upcoming / open</option><option value="open">Open</option><option value="closed">Closed</option></select></label><p className="form-hint">This database schema stores event title, capacity, status, and organizer. No date or description fields are available.</p><button className="button button-primary button-wide" disabled={busy}>{busy ? "Saving…" : dialog.event ? "Save changes" : "Publish event"}</button></form></Modal>}
    {dialog?.type === "roster" && <Modal title={dialog.event.title} subtitle={`${dialog.loading ? "Loading" : dialog.registrations.length} registered students`} onClose={() => setDialog(null)}>{dialog.loading ? <div className="loading-state"><span className="spinner"/>Loading roster…</div> : dialog.error ? <div className="error-inline">{dialog.error}</div> : dialog.registrations.length ? <div className="roster-list">{dialog.registrations.map((row) => <div className="roster-row" key={row.id}><Avatar user={row.user}/><div><strong>{row.user?.email || row.user_id}</strong><small>Registered {formatDate(row.createdat)}</small></div><span className="status-pill status-open">Registered</span></div>)}</div> : <div className="empty-state compact"><strong>No registrations yet</strong><p>Student registrations will show here as they arrive.</p></div>}</Modal>}
  </div>;
}

async function updateEventStatus(event, user, refresh, setError, setToast, setBusy) {
  const currentlyOpen = ["open", "upcoming"].includes(String(event.status || "").toLowerCase());
  setBusy(true); setError("");
  try {
    await request(`/api/events/${encodeURIComponent(event.id)}`, { method: "PATCH", body: JSON.stringify({ organizer_id: user.id, title: event.title, capacity: event.capacity, status: currentlyOpen ? "closed" : "open" }) });
    setToast(currentlyOpen ? "Registration closed." : "Registration reopened.");
    await refresh(user.id);
  } catch (caught) { setError(caught.message); }
  finally { setBusy(false); }
}

function EventCard({ event, onOpen, onRegister, onTickets, busy, canRegister, isRegistered }) {
  const pct = percentFull(event);
  const open = eventOpen(event);
  return <article className="event-card"><button className="event-art" onClick={onOpen} aria-label={`View ${event.title}`}><div className="art-glow"/><span className="art-mark">CC</span><StatusPill event={event}/><div className="art-caption"><span>Campus event</span><h3>{event.title}</h3></div></button><div className="event-card-body"><div className="organizer-row"><span><Avatar user={{ email: event.organizer_email }} size="tiny"/> {event.organizer_email || "Campus organizer"}</span><b className={open ? "seats-available" : "seats-full"}>{open ? `${Math.max(0, event.capacity - event.registered)} seats left` : "Full / closed"}</b></div><Capacity event={event}/><div className="card-footer"><button className="text-button" onClick={onOpen}>View details <Icon name="arrow" size={14}/></button><button className={`button ${isRegistered ? "button-subtle" : open && canRegister ? "button-primary" : "button-muted"}`} onClick={isRegistered ? onTickets : onRegister} disabled={!isRegistered && (!open || !canRegister || busy)}>{isRegistered ? "Registered · Tickets" : !canRegister ? "Student only" : open ? "Register" : "Closed"} <Icon name={isRegistered ? "ticket" : open ? "arrow" : "lock"} size={14}/></button></div></div></article>;
}

function Capacity({ event }) {
  const count = Number(event.registered || 0); const capacity = Number(event.capacity || 0); const pct = percentFull(event);
  return <div className="capacity"><div className="capacity-label"><span>Capacity · {count} / {capacity}</span><strong>{pct}%</strong></div><div className="capacity-track"><span className={pct >= 95 ? "danger" : pct >= 70 ? "warning" : ""} style={{ width: `${pct}%` }}/></div></div>;
}

function StatusPill({ event }) {
  const open = eventOpen(event);
  return <span className={`status-pill ${open ? "status-open" : "status-closed"}`}><span className="status-dot"/>{open ? "Open registration" : ["open", "upcoming"].includes(String(event.status || "").toLowerCase()) ? "Full" : "Closed"}</span>;
}

function RegistrationCard({ registration, onCancel, busy }) {
  const event = registration.event || {};
  return <article className="registration-card"><div className="registration-top"><span className="status-pill status-open"><span className="status-dot"/>Registered</span><span className="ticket-code">{String(registration.id).slice(0, 8).toUpperCase()}</span></div><h3>{event.title || "Event unavailable"}</h3><div className="registration-meta"><span><Icon name="clock" size={15}/> Registered {formatDate(registration.createdat)}</span><span><Icon name="users" size={15}/> {event.registered || 0} / {event.capacity || 0} seats</span></div><Capacity event={event}/><div className="registration-footer"><span>Seat confirmed for {event.title || "this event"}</span><button className="button button-danger" onClick={onCancel} disabled={busy}>Deregister</button></div></article>;
}

function ManagedEvent({ event, onRoster, onEdit, onDelete, onToggle, busy }) {
  const open = eventOpen(event);
  const statusOpen = ["open", "upcoming"].includes(String(event.status || "").toLowerCase());
  return <article className="managed-event"><div className="managed-event-main"><div className="managed-event-heading"><div><div className="managed-title-line"><h3>{event.title}</h3><StatusPill event={event}/></div><small>Event ID · {event.id}</small></div><div className="event-actions"><button className="icon-button" onClick={onEdit} title="Edit event"><Icon name="edit"/></button><button className="icon-button danger-icon" onClick={onDelete} title="Delete event"><Icon name="trash"/></button></div></div><Capacity event={event}/><div className="managed-meta"><span>{event.registered || 0} registered</span><b>{Math.max(0, event.capacity - event.registered)} seats available</b></div><div className="managed-actions"><button className="button button-subtle" onClick={onRoster}><Icon name="users"/> View registrations ({event.registered || 0})</button><button className={`button ${statusOpen ? "button-warn" : "button-success"}`} onClick={onToggle} disabled={busy}>{statusOpen ? "Close registration" : "Reopen event"}</button></div>{event.registered > 0 && <p className="delete-note"><Icon name="lock" size={13}/> Delete is blocked while registrations exist.</p>}</div></article>;
}

function Metric({ label, value, icon }) { return <div className="metric-card"><span className="metric-icon"><Icon name={icon} size={17}/></span><span className="metric-label">{label}</span><strong>{value}</strong></div>; }

function Modal({ title, subtitle, children, onClose }) {
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}><section className="modal" role="dialog" aria-modal="true" aria-label={title}><header className="modal-header"><div><h2>{title}</h2><p>{subtitle}</p></div><button className="icon-button" onClick={onClose} aria-label="Close"><Icon name="close"/></button></header>{children}</section></div>;
}

export default App;
