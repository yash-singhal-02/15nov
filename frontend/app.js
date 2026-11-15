"use strict";

import { createClient } from "@supabase/supabase-js";

const API_BASE = (window.CAMPUSCONNECT_API_BASE || import.meta.env.VITE_API_BASE || "").replace(/\/+$/, "");
const SUPABASE_URL = import.meta.env.VITE_SUPABASE_URL;
const SUPABASE_KEY = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY;
const supabase = SUPABASE_URL && SUPABASE_KEY ? createClient(SUPABASE_URL, SUPABASE_KEY) : null;
const previewEvents = [
  {
    id: "preview-hackathon",
    title: "Annual Hackathon 2025: AI & Future Tech",
    category: "Engineering · Tech Guild",
    description: "Collaborate with collegiate builders to craft frontier machine learning solutions, explore cloud compute, and meet the campus technology community.",
    organizer: "Clara Chen",
    organizer_email: "c.chen.cs@campus.edu",
    date: "2025-04-12T09:00:00",
    capacity: 150,
    registered: 112,
    status: "open",
    image_url: "https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?auto=format&fit=crop&w=1200&q=85",
  },
  {
    id: "preview-career-expo",
    title: "Campus Career & Internship Expo",
    category: "Student Affairs · All Majors",
    description: "Meet employers, discover internship opportunities, and get practical advice for your next career move.",
    organizer: "Miller Dean",
    organizer_email: "s.miller.dean@campus.edu",
    date: "2025-04-02T10:00:00",
    capacity: 300,
    registered: 285,
    status: "open",
    image_url: "https://images.unsplash.com/photo-1511578314322-379afb476865?auto=format&fit=crop&w=1200&q=85",
  },
  {
    id: "preview-robotics",
    title: "Robotics Workshop: Autonomous Rovers",
    category: "Robotics Club · Lab 4B",
    description: "Build and test a small autonomous rover with the campus robotics club. All experience levels are welcome.",
    organizer: "Daniel Vance",
    organizer_email: "d.vance.eng@campus.edu",
    date: "2025-04-05T13:30:00",
    capacity: 40,
    registered: 40,
    status: "closed",
    image_url: "https://images.unsplash.com/photo-1485827404703-89b55fcc595e?auto=format&fit=crop&w=1200&q=85",
  },
  {
    id: "preview-festival",
    title: "Spring Music & Arts Festival",
    category: "Student Union · Campus Amphitheater",
    description: "An afternoon of student bands, local artists, food, and creative community on the campus green.",
    organizer: "Miller Dean",
    organizer_email: "s.miller.dean@campus.edu",
    date: "2025-04-12T16:00:00",
    capacity: 500,
    registered: 310,
    status: "open",
    image_url: "https://images.unsplash.com/photo-1501386761578-eac5c94b800a?auto=format&fit=crop&w=1200&q=85",
  },
];

const previewRegistrations = [
  { id: "preview-reg-9821", event_id: "preview-hackathon", registered_at: "2025-04-10T09:14:00", status: "confirmed", ticket_code: "REG-9821" },
  { id: "preview-reg-7741", event_id: "preview-career-expo", registered_at: "2025-04-02T14:45:00", status: "confirmed", ticket_code: "REG-7741" },
  { id: "preview-reg-5520", event_id: "preview-robotics", registered_at: "2025-03-28T11:20:00", status: "attended", ticket_code: "REG-5520" },
];

const state = {
  view: "explore",
  role: "student",
  query: "",
  filter: "all",
  events: previewEvents.map(normalizeEvent),
  registrations: previewRegistrations,
  eventsArePreview: true,
  registrationsArePreview: true,
  currentUser: { name: "Demo user", email: "" },
  selectedUserId: "",
  userIsPreview: true,
  users: [],
  usersArePreview: true,
  lastSyncedAt: null,
};

const app = document.querySelector("#app");
const apiNotice = document.querySelector("#api-notice");
const dialog = document.querySelector("#event-dialog");
const dialogContent = document.querySelector("#dialog-content");
const userSwitchDialog = document.querySelector("#user-switch-dialog");
const userSwitchList = document.querySelector("#user-switch-list");
const toast = document.querySelector("#toast");
let toastTimer;

function normalizeEvent(raw) {
  const capacity = Number(raw.capacity ?? raw.seats_total ?? raw.seatsTotal ?? 0);
  const registered = Number(raw.registered ?? raw.claimed ?? raw.seats_claimed ?? raw.seatsClaimed ?? 0);
  const organizer = raw.organizer && typeof raw.organizer === "object" ? raw.organizer : {};
  return {
    ...raw,
    id: String(raw.id ?? raw.event_id ?? ""),
    title: String(raw.title ?? raw.name ?? "Untitled event"),
    category: String(raw.category ?? raw.location ?? "Campus event"),
    description: String(raw.description ?? ""),
    organizer: String(raw.organizer_name ?? organizer.name ?? organizer.full_name ?? organizer.username ?? raw.organizer ?? raw.organizer_email ?? "Campus organizer"),
    organizer_email: String(raw.organizer_email ?? organizer.email ?? ""),
    date: raw.date ?? raw.start_time ?? raw.starts_at ?? raw.event_date ?? "",
    capacity: Number.isFinite(capacity) ? capacity : 0,
    registered: Number.isFinite(registered) ? registered : 0,
    status: String(raw.status ?? "open").toLowerCase(),
    image_url: String(raw.image_url ?? raw.image ?? ""),
  };
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[char]);
}

function imageUrl(value) {
  try {
    const url = new URL(value, window.location.href);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch (error) {
    return "";
  }
  return "";
}

function eventDate(value, options = { month: "short", day: "2-digit", hour: "numeric", minute: "2-digit" }) {
  const date = new Date(value);
  if (!value || Number.isNaN(date.getTime())) return "Date to be announced";
  return new Intl.DateTimeFormat(undefined, options).format(date);
}

function isClosed(event) {
  return ["closed", "full", "sold out", "cancelled"].includes(event.status) || (event.capacity > 0 && event.registered >= event.capacity);
}

function fillPercentage(event) {
  return event.capacity > 0 ? Math.min(100, Math.round((event.registered / event.capacity) * 100)) : 0;
}

function statusClass(event) {
  if (isClosed(event)) return "closed";
  if (fillPercentage(event) >= 85) return "soon";
  return "";
}

function eventStatus(event) {
  if (isClosed(event)) return "Full · Closed";
  if (fillPercentage(event) >= 85) return "Filling fast";
  return "Open registration";
}

function currentUserName() {
  return state.currentUser.name || state.currentUser.full_name || state.currentUser.username || state.currentUser.email || "Configured user";
}

function roleForUser(user) {
  return ["organizer", "organiser", "admin"].includes(String(user?.role || "").toLowerCase()) ? "organizer" : "student";
}

function initials(value) {
  return String(value || "U").split(/[\s@._-]+/).filter(Boolean).slice(0, 2).map((part) => part[0].toUpperCase()).join("");
}

function apiPath(path) {
  return `${API_BASE}${path}`;
}

async function request(path, options = {}) {
  let response;
  try {
    response = await fetch(apiPath(path), {
      ...options,
      headers: { Accept: "application/json", ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers },
    });
  } catch (error) {
    throw new Error("Could not reach the API. Check that the backend is running and the API base URL is configured.");
  }
  if (!response.ok) {
    let message = `Request failed (${response.status}).`;
    try {
      const body = await response.json();
      message = body.message || body.error || message;
    } catch (error) {
      // The response can be a plain-text Flask error page.
    }
    const apiError = new Error(message);
    apiError.status = response.status;
    throw apiError;
  }
  if (response.status === 204) return null;
  const body = await response.text();
  return body ? JSON.parse(body) : null;
}

function collectionFrom(payload, keys) {
  if (Array.isArray(payload)) return payload;
  for (const key of keys) {
    if (Array.isArray(payload?.[key])) return payload[key];
  }
  return [];
}

function setNotice(message) {
  apiNotice.textContent = message;
  apiNotice.hidden = !message;
}

function refreshNotice() {
  const messages = [];
  if (state.eventsArePreview) {
    messages.push(`Event API unavailable; showing preview events. ${state.eventsLoadError || ""}`.trim());
  }
  if (state.userIsPreview) {
    messages.push(`No public user profiles could be loaded. ${state.usersLoadError || ""}`.trim());
  }
  if (state.view === "tickets" && state.registrationsArePreview) {
    messages.push(`Registration API unavailable; showing sample tickets. ${state.registrationsLoadError || ""}`.trim());
  }
  if (messages.length) {
    setNotice(`${messages.join(" ")} Start the backend and configure its API base URL to load live data.`);
  } else {
    setNotice("");
  }
}

function statusFilterButton(value, label) {
  return `<button class="filter-button ${state.filter === value ? "active" : ""}" type="button" data-filter="${value}" aria-pressed="${state.filter === value}">${label}</button>`;
}

function eventCard(event) {
  const percent = fillPercentage(event);
  const closed = isClosed(event);
  const registration = state.registrations.find((item) => String(item.event_id ?? item.event?.id ?? "") === event.id);
  const cls = statusClass(event);
  const cover = imageUrl(event.image_url);
  const coverStyle = cover ? ` style="background-image:url('${escapeHtml(cover)}')"` : "";
  return `
    <article class="event-card">
      <div class="event-cover"${coverStyle}>
        <div class="cover-topline">
          <span class="status-pill ${cls}"><span class="status-dot"></span>${escapeHtml(eventStatus(event))}</span>
          <span class="category-pill">${escapeHtml(event.category.split("·")[0].trim())}</span>
        </div>
        <div class="event-cover-content">
          <p class="event-category">${escapeHtml(event.category)}</p>
          <h3>${escapeHtml(event.title)}</h3>
        </div>
      </div>
      <div class="event-details">
        <div class="organizer-line">
          <span class="organizer-name">♙ &nbsp;${escapeHtml(event.organizer_email || event.organizer)}</span>
          <span class="seats-left">${closed ? "No seats left" : `${Math.max(0, event.capacity - event.registered)} seats left`}</span>
        </div>
        <div class="capacity-meta"><span>Capacity: ${event.capacity || "—"} total</span><strong>${event.registered} claimed (${percent}%)</strong></div>
        <div class="progress-track" aria-label="${percent}% of seats claimed"><div class="progress-fill ${percent >= 95 ? "danger" : percent >= 85 ? "warning" : ""}" style="width:${percent}%"></div></div>
        <div class="event-card-footer">
          <span class="event-date"><span aria-hidden="true">▦</span>${escapeHtml(eventDate(event.date))}</span>
          <button class="button ${registration ? "button-soft" : closed ? "button-soft" : "button-primary"}" type="button" data-action="${registration ? "tickets" : closed ? "details" : "register"}" data-event-id="${escapeHtml(event.id)}">
            ${registration ? "Registered · Tickets" : closed ? "View details" : "Register now"} <span aria-hidden="true">${registration ? "▣" : closed ? "↗" : "→"}</span>
          </button>
        </div>
      </div>
    </article>`;
}

function renderExplore() {
  const term = state.query.trim().toLowerCase();
  const events = state.events.filter((event) => {
    const matchesText = !term || `${event.title} ${event.category} ${event.organizer} ${event.organizer_email}`.toLowerCase().includes(term);
    const matchesFilter = state.filter === "all" ||
      (state.filter === "open" && !isClosed(event)) ||
      (state.filter === "filling" && !isClosed(event) && fillPercentage(event) >= 85) ||
      (state.filter === "full" && isClosed(event));
    return matchesText && matchesFilter;
  });
  const claimed = state.events.reduce((sum, event) => sum + event.registered, 0);
  return `
    <section class="welcome-row">
      <div class="welcome-copy"><h1>Discover campus life</h1><p>Find your next idea, community, or unforgettable campus moment.</p></div>
      <div class="user-chip"><span class="person-avatar">${escapeHtml(initials(currentUserName()))}</span><span><strong>${escapeHtml(currentUserName())}</strong><small>${escapeHtml(state.currentUser.email || "")}</small></span><span class="persona-tag">${state.role.toUpperCase()}</span></div>
    </section>
    <section class="hero" aria-labelledby="hero-title">
      <div class="hero-content">
        <span class="eyebrow"><span class="live-dot"></span> Spring term · 2025</span>
        <h2 id="hero-title">Discover what's happening on campus</h2>
        <p>Book seats in faculty symposiums, coding sprints, and campus festivals in real time.</p>
      </div>
      <div class="hero-stats" aria-label="Campus event statistics">
        <div class="hero-stat"><strong>${state.events.length}</strong><span>Active events</span></div>
        <div class="hero-stat"><strong>${claimed.toLocaleString()}+</strong><span>Seats claimed</span></div>
      </div>
    </section>
    <section aria-label="Browse events">
      <div class="toolbar">
        <label class="search-box"><span class="skip-link">Search events by title or speaker</span><input id="event-search" type="search" placeholder="Search events by title or speaker..." value="${escapeHtml(state.query)}" autocomplete="off"></label>
        <div class="filter-row" aria-label="Filter events by availability">
          ${statusFilterButton("all", `All events (${state.events.length})`)}
          ${statusFilterButton("open", "Open seats")}
          ${statusFilterButton("filling", "Filling fast")}
          ${statusFilterButton("full", "Full / closed")}
        </div>
      </div>
      <div class="results-heading"><h2>Upcoming events</h2><span class="results-count">${events.length} ${events.length === 1 ? "event" : "events"}</span></div>
      ${events.length ? `<div class="event-grid">${events.map(eventCard).join("")}</div>` : `<div class="empty-state"><strong>No events match those filters</strong>Try a different search or availability filter.</div>`}
    </section>`;
}

function registrationEvent(registration) {
  const nested = registration.event || {};
  const id = String(registration.event_id ?? nested.id ?? "");
  return state.events.find((event) => event.id === id) || normalizeEvent(nested);
}

function renderTickets() {
  const registrations = state.registrations;
  const upcoming = registrations.filter((registration) => {
    const date = new Date(registrationEvent(registration).date);
    return !Number.isNaN(date.getTime()) && date >= new Date() && registration.status !== "attended";
  }).length;
  const confirmed = registrations.filter((item) => String(item.status || "confirmed").toLowerCase() === "confirmed").length;
  return `
    <section class="section-heading">
      <div><h1>My registered events</h1><p>Manage your event passes, check-in QR codes, and synced schedules.</p></div>
      <button class="button button-secondary" type="button" data-action="refresh">↻ &nbsp;Refresh</button>
    </section>
    <section class="ticket-profile">
      <span class="person-avatar">${escapeHtml(initials(currentUserName()))}</span>
      <span><strong>${escapeHtml(currentUserName())}</strong><small>${escapeHtml(state.currentUser.email || "")}</small></span>
      <span class="persona-tag">${state.role.toUpperCase()}</span>
    </section>
    <section class="stat-grid" aria-label="Registration summary">
      <div class="stat-card"><span class="stat-icon">✿</span><strong>${confirmed}</strong><span>Confirmed passes</span></div>
      <div class="stat-card"><span class="stat-icon">◷</span><strong>${upcoming}</strong><span>Upcoming this week</span></div>
      <div class="stat-card"><span class="stat-icon">⌛</span><strong>${registrations.filter((item) => item.status === "waitlisted").length}</strong><span>Waitlisted</span></div>
    </section>
    <section>
      <div class="results-heading"><h2>Active registrations</h2><span class="results-count">${registrations.length} total records</span></div>
      ${registrations.length ? `<div class="ticket-list">${registrations.map((registration) => {
        const event = registrationEvent(registration);
        const ticket = registration.ticket_code || registration.ticket_id || registration.id || "Confirmed";
        const status = String(registration.status || "confirmed");
        return `<article class="ticket-card">
          <div class="ticket-tags"><span class="ticket-tag green">● ${escapeHtml(isClosed(event) ? "Event full" : "Open / active")}</span><span class="ticket-tag">▧ ${escapeHtml(ticket)}</span></div>
          <h3>${escapeHtml(event.title)}</h3>
          <div class="ticket-meta"><span>▣ &nbsp;Registered: ${escapeHtml(eventDate(registration.registered_at ?? registration.created_at ?? registration.createdAt, { month: "long", day: "2-digit", year: "numeric", hour: "numeric", minute: "2-digit" }))}</span><span>♧ &nbsp;Capacity: <strong>${event.capacity || "—"} seats</strong></span><span>Seat allocation: <strong>${event.registered} / ${event.capacity || "—"}</strong></span></div>
          <div class="ticket-status-row"><span>✓ &nbsp;${escapeHtml(status[0].toUpperCase() + status.slice(1))} · Ticket #${escapeHtml(ticket)}</span><span>QR pass</span></div>
          <div class="ticket-actions">
            <button class="button button-primary" type="button" data-action="details" data-event-id="${escapeHtml(event.id)}">View event details &nbsp;→</button>
            ${status.toLowerCase() === "attended" ? "" : `<button class="button button-danger" type="button" data-action="deregister" data-registration-id="${escapeHtml(registration.id)}">Cancel registration</button>`}
          </div>
        </article>`;
      }).join("")}</div>` : `<div class="empty-state"><strong>No registrations yet</strong>Browse upcoming events to find something you love.<br><br><button class="button button-primary" type="button" data-view="explore">Browse events</button></div>`}
    </section>`;
}

function renderManage() {
  const totalSeats = state.events.reduce((sum, event) => sum + event.capacity, 0);
  const claimed = state.events.reduce((sum, event) => sum + event.registered, 0);
  const fullCount = state.events.filter(isClosed).length;
  const organizerEvents = state.role === "organizer"
    ? state.events.filter((event) => String(event.organizer_id) === String(state.currentUser.id))
    : [];
  return `
    <section class="section-heading">
      <div><h1>Organizer console</h1><p>Live seat telemetry and event controls for your campus community.</p></div>
      <span class="status-label"><span class="status-dot"></span>${state.eventsArePreview ? "Preview data" : `Live · ${state.lastSyncedAt ? new Date(state.lastSyncedAt).toLocaleTimeString() : "syncing"}`}</span>
    </section>
    <p class="manage-header-note">Viewing as ${escapeHtml(currentUserName())} (${escapeHtml(state.currentUser.email || "email unavailable")}) <button type="button" class="button button-soft" data-action="switch-user">Switch user ⇄</button></p>
    <section class="manage-summary" aria-label="Organizer metrics">
      <div class="manage-metric"><span>Total events</span><strong>${organizerEvents.length}</strong><small>Created &amp; managed</small></div>
      <div class="manage-metric"><span>Registrations</span><strong>${claimed.toLocaleString()}</strong><small>Students enrolled</small></div>
      <div class="manage-metric"><span>Available seats</span><strong>${Math.max(0, totalSeats - claimed).toLocaleString()}</strong><small>Remaining open</small></div>
      <div class="manage-metric"><span>At capacity</span><strong>${fullCount}</strong><small>Closed / max cap</small></div>
    </section>
    <section class="manage-layout">
      <div class="panel">
        <div class="panel-heading"><h2>Your events</h2><span>${organizerEvents.length} listed</span></div>
        ${organizerEvents.length ? `<div class="managed-list">${organizerEvents.map((event) => {
          const percent = fillPercentage(event);
          const closed = isClosed(event);
          return `<article class="managed-event">
            <div class="managed-event-top"><div><h3>${escapeHtml(event.title)}</h3><small>ID: ${escapeHtml(event.id)}</small></div><span class="status-label ${statusClass(event)}"><span class="status-dot"></span>${closed ? "Closed" : "Open"}</span></div>
            <div class="capacity-meta"><span>Capacity met: ${event.registered} / ${event.capacity}</span><strong>${Math.max(0, event.capacity - event.registered)} seats remaining</strong></div>
            <div class="progress-track"><div class="progress-fill ${percent >= 95 ? "danger" : percent >= 85 ? "warning" : ""}" style="width:${percent}%"></div></div>
            <div class="managed-event-bottom"><span>${escapeHtml(eventDate(event.date, { month: "short", day: "numeric", year: "numeric" }))}</span><button type="button" data-action="attendees" data-event-id="${escapeHtml(event.id)}">View registrations (${event.registered})</button></div>
          </article>`;
        }).join("")}</div>` : `<div class="empty-state"><strong>No managed events</strong>Switch to an organizer account to view managed events.</div>`}
      </div>
      <aside class="panel create-panel">
        <div class="panel-heading"><h2>Deploy new event</h2><span>Event form</span></div>
        <p>Publish a new campus event for students to discover and register.</p>
        <form id="create-event-form">
          <div class="form-field"><label for="new-title">Event title</label><input id="new-title" type="text" placeholder="e.g. Quantum Computing Seminar" disabled></div>
          <div class="form-field"><label for="new-capacity">Capacity</label><input id="new-capacity" type="number" placeholder="100" disabled></div>
          <div class="form-field"><label for="new-status">Initial status</label><select id="new-status" disabled><option>Open</option><option>Closed</option></select></div>
          <button class="button button-primary" type="submit" disabled>＋ &nbsp;Create event</button>
        </form>
        <div class="contract-note">Event creation is not supported by the current API contract. Add a <code>POST /api/events</code> endpoint to enable this form.</div>
      </aside>
    </section>`;
}

function render() {
  refreshNotice();
  app.innerHTML = state.view === "tickets" ? renderTickets() : state.view === "manage" ? renderManage() : renderExplore();
  document.querySelectorAll("[data-view]").forEach((button) => {
    button.classList.toggle("active", button.dataset.view === state.view);
    if (button.hasAttribute("aria-current")) button.setAttribute("aria-current", button.dataset.view === state.view ? "page" : "false");
  });
  document.querySelector("#role-label").textContent = `${currentUserName()} · ${state.role === "student" ? "Student view" : "Organizer view"}`;
  document.querySelector("#profile-button").textContent = initials(currentUserName());
}

function openUserSwitcher() {
  if (!state.users.length) {
    showToast("No public user profiles are available to switch to.");
    return;
  }
  userSwitchList.innerHTML = state.users.map((user) => {
    const selected = String(user.id) === String(state.currentUser.id);
    const label = user.name || user.full_name || user.username || user.email || "Campus user";
    return `<button type="button" class="user-switch-option ${selected ? "selected" : ""}" data-user-id="${escapeHtml(user.id)}">
      <span class="person-avatar">${escapeHtml(initials(user.email || label))}</span>
      <span><strong>${escapeHtml(user.email || label)}</strong><small>${escapeHtml(user.role || "student")}</small></span>
      ${selected ? '<span class="user-switch-current">Current</span>' : '<span class="switch-icon">↗</span>'}
    </button>`;
  }).join("");
  userSwitchDialog.showModal();
}

async function switchUser(userId) {
  const user = state.users.find((row) => String(row.id) === String(userId));
  if (!user) return;
  state.currentUser = {
    ...user,
    name: user.name || user.full_name || user.username || user.email || "Campus user",
  };
  state.selectedUserId = String(user.id);
  state.role = roleForUser(user);
  if (state.view === "manage" && state.role !== "organizer") state.view = "explore";
  localStorage.setItem("campusconnect-active-user", state.selectedUserId);
  userSwitchDialog.close();
  render();
  await loadRegistrations();
  render();
  showToast(`Switched to ${user.email || state.currentUser.name}.`);
}

function showToast(message) {
  toast.textContent = message;
  toast.classList.add("visible");
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => toast.classList.remove("visible"), 3500);
}

function findEvent(id) {
  return state.events.find((event) => event.id === id);
}

function showEventDetails(event) {
  if (!event) return;
  const cover = imageUrl(event.image_url);
  const coverStyle = cover ? ` style="background-image:linear-gradient(180deg,transparent,rgba(10,16,32,.22)),url('${escapeHtml(cover)}')"` : "";
  dialogContent.innerHTML = `
    <div class="dialog-cover"${coverStyle}></div>
    <div class="dialog-content">
      <span class="status-label ${statusClass(event)}"><span class="status-dot"></span>${escapeHtml(eventStatus(event))}</span>
      <h2 id="dialog-title">${escapeHtml(event.title)}</h2>
      <p>${escapeHtml(event.description || "More event details will be shared by the organizer.")}</p>
      <div class="detail-list"><span>▣ &nbsp;${escapeHtml(eventDate(event.date))}</span><span>♙ &nbsp;${escapeHtml(event.organizer)}${event.organizer_email ? ` · ${escapeHtml(event.organizer_email)}` : ""}</span><span>♧ &nbsp;${event.registered} of ${event.capacity || "—"} seats claimed (${fillPercentage(event)}%)</span></div>
      <button class="button button-primary" type="button" data-action="${isClosed(event) ? "closed" : "register"}" data-event-id="${escapeHtml(event.id)}" ${isClosed(event) ? "disabled" : ""}>${isClosed(event) ? "Registration closed" : "Register for event"}</button>
    </div>`;
  dialog.showModal();
}

async function loadEvents() {
  try {
    const payload = await request("/api/events");
    const events = collectionFrom(payload, ["events", "data"]).map(normalizeEvent);
    const changed = JSON.stringify(state.events) !== JSON.stringify(events) || state.eventsArePreview;
    state.events = events;
    state.eventsArePreview = false;
    state.eventsLoadError = "";
    state.lastSyncedAt = Date.now();
    if (changed) render();
  } catch (error) {
    state.eventsArePreview = true;
    state.eventsLoadError = error.message;
    render();
  }
}

async function loadUsers() {
  try {
    const payload = await request("/api/users");
    const users = collectionFrom(payload, ["users", "data"]);
    const storedId = localStorage.getItem("campusconnect-active-user");
    let selected = users.find((user) => String(user.id) === String(storedId));
    if (!selected && !storedId) {
      const configured = await request("/api/me").catch(() => null);
      selected = users.find((user) => String(user.id) === String(configured?.user?.id));
    }
    selected ||= users.find((user) => String(user.id) === String(state.currentUser.id)) || users[0] || null;
    const currentChanged = JSON.stringify(state.currentUser) !== JSON.stringify(selected || {});
    const changed = JSON.stringify(state.users) !== JSON.stringify(users) || state.usersArePreview;
    state.users = users;
    state.usersArePreview = false;
    state.usersLoadError = "";
    state.userIsPreview = !selected;
    if (selected) {
      state.currentUser = {
        ...selected,
        name: selected.name || selected.full_name || selected.username || selected.email || "Campus user",
      };
      state.selectedUserId = String(selected.id);
      state.role = roleForUser(selected);
      localStorage.setItem("campusconnect-active-user", state.selectedUserId);
    }
    if (changed || currentChanged) render();
  } catch (error) {
    state.usersArePreview = true;
    state.usersLoadError = error.message;
    state.userIsPreview = true;
    render();
  }
}

async function loadRegistrations() {
  try {
    const payload = await request(`/api/me/registrations?user_id=${encodeURIComponent(state.currentUser.id || "")}`);
    state.registrations = collectionFrom(payload, ["registrations", "data"]);
    state.registrationsArePreview = false;
    state.registrationsLoadError = "";
  } catch (error) {
    state.registrationsArePreview = true;
    state.registrationsLoadError = error.message;
  }
  render();
}

async function refreshCurrentView() {
  await Promise.all([loadEvents(), loadUsers()]);
  if (state.view === "tickets") {
    await loadRegistrations();
    return;
  }
}

async function registerForEvent(id) {
  const event = findEvent(id);
  if (!event || isClosed(event)) {
    showToast("This event is no longer accepting registrations.");
    return;
  }
  if (state.registrations.some((registration) => String(registration.event_id ?? registration.event?.id ?? "") === id)) {
    state.view = "tickets";
    render();
    showToast("You're already registered. Manage your pass in My tickets.");
    return;
  }
  if (state.eventsArePreview && state.registrationsArePreview) {
    const code = `DEMO-${Date.now().toString(36).toUpperCase()}`;
    state.registrations = [{
      id: `preview-${code.toLowerCase()}`,
      event_id: id,
      registered_at: new Date().toISOString(),
      status: "confirmed",
      ticket_code: code,
    }, ...state.registrations];
    event.registered += 1;
    state.view = "tickets";
    render();
    showToast("Preview registration created. You can cancel it and register again.");
    return;
  }
  try {
    await request("/api/registrations", { method: "POST", body: JSON.stringify({ event_id: id, user_id: state.currentUser.id }) });
    showToast("You're registered! Refreshing your tickets…");
    if (dialog.open) dialog.close();
    await Promise.all([loadEvents(), loadRegistrations()]);
  } catch (error) {
    if (error.status === 409) {
      showToast("You already have a registration for this event.");
    } else {
      showToast(`Registration failed: ${error.message}`);
    }
  }
}

async function cancelRegistration(registrationId) {
  if (!registrationId || !window.confirm("Cancel this event registration? You can register again later if seats are available.")) return;
  const registration = state.registrations.find((item) => String(item.id) === registrationId);
  const eventId = String(registration?.event_id ?? registration?.event?.id ?? "");
  const event = findEvent(eventId);
  if (state.eventsArePreview && state.registrationsArePreview) {
    state.registrations = state.registrations.filter((item) => String(item.id) !== registrationId);
    if (event) event.registered = Math.max(0, event.registered - 1);
    render();
    showToast("Registration cancelled. You can register for this event again.");
    return;
  }
  try {
    await request(`/api/registrations/${encodeURIComponent(registrationId)}?user_id=${encodeURIComponent(state.currentUser.id)}`, { method: "DELETE" });
    showToast("Registration cancelled. You can register for this event again.");
    await Promise.all([loadEvents(), loadRegistrations()]);
  } catch (error) {
    showToast(`Could not cancel registration: ${error.message}`);
  }
}

async function loadAttendees(id) {
  const event = findEvent(id);
  if (!event) return;
  dialogContent.innerHTML = `<div class="dialog-content"><h2 id="dialog-title">Event registrations</h2><p>Loading attendee list…</p></div>`;
  dialog.showModal();
  try {
    const payload = await request(`/api/events/${encodeURIComponent(id)}/registrations?organizer_id=${encodeURIComponent(state.currentUser.id)}`);
    const registrations = collectionFrom(payload, ["registrations", "data"]);
    dialogContent.innerHTML = `<div class="dialog-content"><h2 id="dialog-title">${escapeHtml(event.title)} · Attendees</h2><p>${registrations.length} registration records</p><div class="attendee-list">${registrations.length ? registrations.map((registration) => `<div class="attendee-row"><span>${escapeHtml(registration.name ?? registration.user?.name ?? registration.email ?? registration.user?.email ?? "Registered attendee")}<small>${escapeHtml(registration.email ?? registration.user?.email ?? "Registration confirmed")}</small></span><span class="ticket-tag green">${escapeHtml(registration.status ?? "Registered")}</span></div>`).join("") : `<p>No registrations yet.</p>`}</div></div>`;
  } catch (error) {
    dialogContent.innerHTML = `<div class="dialog-content"><h2 id="dialog-title">Attendee list unavailable</h2><p class="dialog-error">${escapeHtml(error.message)}</p><p>Attendee lists require organizer authentication and the event registration endpoint.</p></div>`;
  }
}

document.addEventListener("click", async (event) => {
  const viewButton = event.target.closest("[data-view]");
  if (viewButton) {
    event.preventDefault();
    state.view = viewButton.dataset.view;
    if (state.view === "tickets") await loadRegistrations();
    else if (state.view === "explore" || state.view === "manage") render();
    return;
  }
  const filterButton = event.target.closest("[data-filter]");
  if (filterButton) {
    state.filter = filterButton.dataset.filter;
    render();
    document.querySelector("#event-search")?.focus();
    return;
  }
  const actionButton = event.target.closest("[data-action]");
  if (!actionButton) return;
  const id = actionButton.dataset.eventId;
  switch (actionButton.dataset.action) {
    case "register":
      await registerForEvent(id);
      break;
    case "deregister":
      await cancelRegistration(actionButton.dataset.registrationId);
      break;
    case "tickets":
      state.view = "tickets";
      await loadRegistrations();
      break;
    case "details":
      showEventDetails(findEvent(id));
      break;
    case "attendees":
      await loadAttendees(id);
      break;
    case "refresh":
      await refreshCurrentView();
      break;
    case "switch-user":
      openUserSwitcher();
      break;
    case "closed":
      showToast("This event is no longer accepting registrations.");
      break;
    default:
      break;
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "event-search") {
    const start = event.target.selectionStart;
    const end = event.target.selectionEnd;
    state.query = event.target.value;
    render();
    const input = document.querySelector("#event-search");
    input.focus();
    input.setSelectionRange(start, end);
  }
});

document.addEventListener("submit", (event) => {
  if (event.target.id === "create-event-form") {
    event.preventDefault();
    showToast("Event creation is not available in the current backend API.");
  }
});

document.querySelector("#role-switch").addEventListener("click", () => {
  openUserSwitcher();
});

document.querySelector("#profile-button").addEventListener("click", () => {
  openUserSwitcher();
});

userSwitchList.addEventListener("click", (event) => {
  const option = event.target.closest("[data-user-id]");
  if (option) switchUser(option.dataset.userId);
});

render();
refreshCurrentView();
window.setInterval(() => {
  if (document.visibilityState === "visible") refreshCurrentView();
}, 5000);

if (supabase) {
  const channel = supabase.channel("campusconnect-live-data")
    .on("postgres_changes", { event: "*", schema: "public", table: "users" }, refreshCurrentView)
    .on("postgres_changes", { event: "*", schema: "public", table: "events" }, refreshCurrentView)
    .on("postgres_changes", { event: "*", schema: "public", table: "registration" }, refreshCurrentView)
    .subscribe();
  window.addEventListener("beforeunload", () => supabase.removeChannel(channel), { once: true });
}
