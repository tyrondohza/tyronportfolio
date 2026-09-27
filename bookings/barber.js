const $ = (selector, parent = document) => parent.querySelector(selector);
const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });

const state = { user: null, bookings: [], currency: "USD", view: "upcoming" };

async function api(path, options = {}) {
	let response;
	try {
		response = await fetch(path, {
			credentials: "same-origin",
			...options,
			headers: { ...(options.body ? { "Content-Type": "application/json" } : {}), ...options.headers }
		});
	} catch {
		throw new Error("Cannot reach the booking server. From the project root run `node bookings/server.js`, then reload this page at http://localhost:4173.");
	}
	const result = await response.json();
	if (!response.ok) throw new Error(result.error || "Something went wrong. Please try again.");
	return result;
}

function money(amount) {
	return new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency }).format(amount);
}

function showMessage(selector, message, isError = false) {
	const node = $(selector);
	node.textContent = message;
	node.classList.toggle("is-error", isError);
}

function showLogin(message = "") {
	$("#barberLogin").classList.remove("hidden");
	$("#barberWorkspace").classList.add("hidden");
	$("#barberSignOut").classList.add("hidden");
	$("#loginNotice").textContent = message || "Use your barber account to view and manage your appointments.";
	if (message) showMessage("#loginMessage", message, true);
}

function renderAppointments() {
	const upcoming = state.bookings.filter(booking => !["completed", "cancelled"].includes(booking.status));
	const completed = state.bookings.filter(booking => booking.status === "completed");
	$("#upcomingCount").textContent = upcoming.length;
	$("#completedCount").textContent = completed.length;
	$("#exportCalendar").disabled = state.bookings.every(booking => booking.status === "cancelled");
	$("#appointmentSummary").textContent = `${state.user.name} · ${state.bookings.length} ${state.bookings.length === 1 ? "appointment" : "appointments"}`;
	const appointments = state.view === "completed" ? completed : upcoming;
	if (!appointments.length) {
		$("#barberAppointmentList").innerHTML = `<p class="barber-empty-state">${state.view === "completed" ? "Completed visits will appear here." : "You’re all caught up. No upcoming appointments."}</p>`;
		return;
	}
	$("#barberAppointmentList").innerHTML = appointments.map(booking => {
		const actions = booking.status === "requested"
			? `<button class="text-action" type="button" data-booking-action="confirm" data-booking-id="${html(booking.id)}">Confirm booking</button><button class="text-action text-action-danger" type="button" data-booking-action="cancel" data-booking-id="${html(booking.id)}">Cancel</button>`
			: booking.status === "confirmed"
				? `<button class="primary-button complete-appointment" type="button" data-booking-action="complete" data-booking-id="${html(booking.id)}">Mark visit complete <span aria-hidden="true">✓</span></button><button class="text-action text-action-danger" type="button" data-booking-action="cancel" data-booking-id="${html(booking.id)}">Cancel</button>`
				: '<span class="completion-mark">✓ Visit complete</span>';
		return `<article class="barber-appointment">
			<div class="appointment-time"><time>${html(dateLabel(booking.date))}</time><strong>${html(booking.time)}</strong></div>
			<div class="appointment-client"><span class="appointment-initial">${html(booking.name.charAt(0).toUpperCase())}</span><div><h3>${html(booking.name)}</h3><p>${booking.services.map(html).join(" · ")}</p></div></div>
			<div class="appointment-payment"><strong>${money(booking.total)}</strong><span>${html(booking.payment)} · ${booking.paymentStatus === "paid" ? "paid" : "pay at shop"}</span></div>
			<span class="appointment-status appointment-status-${html(booking.status)}">${html(booking.status)}</span>
			<div class="appointment-actions">${actions}</div>
		</article>`;
	}).join("");
}

function exportCalendar() {
	const escapeCalendarText = value => String(value).replace(/\\/g, "\\\\").replace(/\n/g, "\\n").replace(/,/g, "\\,").replace(/;/g, "\\;");
	const events = state.bookings.filter(booking => booking.status !== "cancelled").map(booking => {
		const start = new Date(`${booking.date}T${booking.time}:00`);
		const end = new Date(start.getTime() + booking.duration * 60 * 1000);
		const formatLocal = date => `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, "0")}${String(date.getDate()).padStart(2, "0")}T${String(date.getHours()).padStart(2, "0")}${String(date.getMinutes()).padStart(2, "0")}00`;
		const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
		return ["BEGIN:VEVENT", `UID:${booking.id}@thegoodcut`, `DTSTAMP:${stamp}`, `DTSTART:${formatLocal(start)}`, `DTEND:${formatLocal(end)}`, `SUMMARY:${escapeCalendarText(`The Good Cut · ${booking.name}`)}`, `DESCRIPTION:${escapeCalendarText(booking.services.join(", "))}`, "END:VEVENT"].join("\r\n");
	});
	const calendar = ["BEGIN:VCALENDAR", "VERSION:2.0", "PRODID:-//The Good Cut//Appointments//EN", "CALSCALE:GREGORIAN", ...events, "END:VCALENDAR"].join("\r\n");
	const file = new Blob([calendar], { type: "text/calendar;charset=utf-8" });
	const link = document.createElement("a");
	link.href = URL.createObjectURL(file);
	link.download = `the-good-cut-${state.user.barberId}.ics`;
	link.click();
	URL.revokeObjectURL(link.href);
}

async function loadDashboard() {
	const { user } = await api("/api/session");
	if (!user) {
		state.user = null;
		showLogin();
		return;
	}
	if (user.role !== "barber") {
		state.user = null;
		showLogin("This page is for barber accounts. Sign in with a barber account to continue.");
		return;
	}
	state.user = user;
	const [config, result] = await Promise.all([api("/api/config"), api("/api/bookings")]);
	state.currency = config.currency;
	state.bookings = result.bookings.filter(booking => booking.barberId === user.barberId);
	$("#dashboardTitle").innerHTML = `Welcome back,<br><em>${html(user.name.split(" ")[0])}.</em>`;
	$("#barberLogin").classList.add("hidden");
	$("#barberWorkspace").classList.remove("hidden");
	$("#barberSignOut").classList.remove("hidden");
	renderAppointments();
}

async function updateBooking(bookingId, action) {
	const button = $(`[data-booking-id="${CSS.escape(bookingId)}"][data-booking-action="${action}"]`);
	if (button) button.disabled = true;
	try {
		await api(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: "PATCH", body: JSON.stringify({ action }) });
		await loadDashboard();
		showMessage("#dashboardMessage", action === "complete" ? "Visit marked complete." : action === "confirm" ? "Booking confirmed." : "Booking cancelled.");
	} catch (error) {
		showMessage("#dashboardMessage", error.message, true);
		if (button) button.disabled = false;
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	$("#currentDate").textContent = new Date().toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
	try { await loadDashboard(); }
	catch (error) { showLogin(error.message); }

	$("#barberLoginForm").addEventListener("submit", async event => {
		event.preventDefault();
		try {
			await api("/api/auth/login", { method: "POST", body: JSON.stringify({ email: $("#barberEmail").value.trim(), password: $("#barberPassword").value }) });
			$("#barberLoginForm").reset();
			showMessage("#loginMessage", "");
			await loadDashboard();
		} catch (error) {
			showMessage("#loginMessage", error.message, true);
		}
	});

	$("#upcomingTab").addEventListener("click", () => {
		state.view = "upcoming";
		$("#upcomingTab").classList.add("active");
		$("#upcomingTab").setAttribute("aria-selected", "true");
		$("#completedTab").classList.remove("active");
		$("#completedTab").setAttribute("aria-selected", "false");
		renderAppointments();
	});
	$("#completedTab").addEventListener("click", () => {
		state.view = "completed";
		$("#completedTab").classList.add("active");
		$("#completedTab").setAttribute("aria-selected", "true");
		$("#upcomingTab").classList.remove("active");
		$("#upcomingTab").setAttribute("aria-selected", "false");
		renderAppointments();
	});
	$("#exportCalendar").addEventListener("click", exportCalendar);
	$("#barberAppointmentList").addEventListener("click", event => {
		const button = event.target.closest("[data-booking-action]");
		if (!button) return;
		const { bookingAction, bookingId } = button.dataset;
		if (bookingAction === "cancel" && !window.confirm("Cancel this appointment?")) return;
		updateBooking(bookingId, bookingAction);
	});
	$("#barberSignOut").addEventListener("click", async () => {
		try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
		finally {
			state.user = null;
			state.bookings = [];
			showLogin();
		}
	});
});