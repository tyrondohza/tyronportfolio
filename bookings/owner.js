const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const state = { user: null, data: null, mode: "login", setupCodeRequired: false };

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

function message(selector, text, error = false) {
	const node = $(selector);
	node.textContent = text;
	node.classList.toggle("is-error", error);
}

function showAccess(note = "") {
	$("#ownerAccess").classList.remove("hidden");
	$("#ownerWorkspace").classList.add("hidden");
	$("#ownerNav").classList.add("hidden");
	$("#ownerSignOut").classList.add("hidden");
	if (note) $("#ownerAccessNote").textContent = note;
}

function setAccessMode(mode, setupAvailable) {
	state.mode = mode;
	const setup = mode === "setup";
	$("#ownerAccessForm").dataset.mode = mode;
	$("#ownerLoginTab").classList.toggle("active", !setup);
	$("#ownerLoginTab").setAttribute("aria-selected", String(!setup));
	$("#ownerSetupTab").classList.toggle("active", setup);
	$("#ownerSetupTab").setAttribute("aria-selected", String(setup));
	$("#ownerNameField").classList.toggle("hidden", !setup);
	$("#ownerCodeField").classList.toggle("hidden", !setup || !state.setupCodeRequired);
	$("#ownerName").required = setup;
	$("#ownerCode").required = setup && state.setupCodeRequired;
	$("#ownerPassword").autocomplete = setup ? "new-password" : "current-password";
	$("#ownerAccessTitle").innerHTML = setup ? "Set up shop <em>owner.</em>" : "Sign in to the <em>shop.</em>";
	$("#ownerAccessSubmit").innerHTML = `${setup ? "Create owner account" : "Sign in"} <span aria-hidden="true">↗</span>`;
	$("#ownerAccessNote").innerHTML = setup
		? state.setupCodeRequired ? "Create the one owner account with the setup code. Registration closes after the first account is created." : "Create the one owner account on the shop server. This setup closes after the first account is created."
		: 'No owner account yet? <a class="access-inline-link" href="staff-signup.html#owner">Open owner sign-up ↗</a>';
	$("#ownerSetupTab").classList.toggle("hidden", !setupAvailable);
	message("#ownerAccessMessage", "");
}

function renderMetrics() {
	const bookings = state.data.bookings;
	const active = state.data.barbers.filter(barber => barber.active !== false).length;
	const upcoming = bookings.filter(booking => ["requested", "confirmed"].includes(booking.status)).length;
	const completed = bookings.filter(booking => booking.status === "completed");
	const revenue = completed.reduce((sum, booking) => sum + booking.total, 0);
	const currency = state.data.settings.currency;
	const money = new Intl.NumberFormat(undefined, { style: "currency", currency }).format(revenue);
	$("#ownerMetrics").innerHTML = `<div class="owner-metric"><span>ACTIVE BARBERS</span><strong>${active}</strong></div><div class="owner-metric"><span>UPCOMING BOOKINGS</span><strong>${upcoming}</strong></div><div class="owner-metric"><span>COMPLETED VISITS</span><strong>${completed.length}</strong></div><div class="owner-metric"><span>COMPLETED TOTAL</span><strong>${money}</strong></div>`;
}

function renderBookings() {
	const bookings = [...state.data.bookings].sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
	$("#bookingCount").textContent = `${bookings.length} total`;
	$("#ownerBookingList").innerHTML = bookings.length ? bookings.map(booking => {
		const actions = booking.status === "cancelled" || booking.status === "completed" ? "" : `<div class="owner-booking-actions">${booking.status === "requested" ? `<button class="text-action" type="button" data-owner-booking="confirm" data-id="${html(booking.id)}">Confirm</button>` : ""}${booking.status === "confirmed" ? `<button class="text-action" type="button" data-owner-booking="complete" data-id="${html(booking.id)}">Mark complete</button>` : ""}<button class="text-action text-action-danger" type="button" data-owner-booking="cancel" data-id="${html(booking.id)}">Cancel</button></div>`;
		return `<article class="owner-booking-row"><div><time>${html(booking.date)} · ${html(booking.time)}</time><strong>${html(booking.name)}</strong><small>${html(booking.clientEmail)}</small></div><div><strong>${html(booking.barberName)}</strong><small>${booking.services.map(html).join(" · ")}</small></div><div><strong>${new Intl.NumberFormat(undefined, { style: "currency", currency: state.data.settings.currency }).format(booking.total)}</strong><small>${html(booking.payment)} · ${html(booking.status)}</small></div>${actions}</article>`;
	}).join("") : '<p class="owner-empty">No bookings yet.</p>';
}

function renderBarbers() {
	$("#ownerBarberList").innerHTML = state.data.barbers.map(barber => `<article class="owner-barber-row"><div><strong>${html(barber.name)}</strong><small>${html(barber.specialty)} · ${barber.profileAvailable ? "Login not set up" : "Login active"}</small></div><span class="owner-active-state ${barber.active === false ? "is-inactive" : ""}">${barber.active === false ? "Inactive" : "Active"}</span><button class="text-action" type="button" data-toggle-barber="${html(barber.id)}" data-active="${barber.active !== false}">${barber.active === false ? "Reactivate" : "Deactivate"}</button></article>`).join("");
}

function renderServices() {
	$("#ownerServiceList").innerHTML = Object.entries(state.data.services).map(([name, service]) => `<div class="owner-service-row"><label>Service<input type="text" data-service-name value="${html(name)}" maxlength="60"></label><label>Price (${html(state.data.settings.currency)})<input type="number" data-service-price min="0" step="1" value="${service.price}"></label><label>Minutes<input type="number" data-service-duration min="5" max="300" step="5" value="${service.duration}"></label><button class="text-action text-action-danger" type="button" data-remove-service>Remove</button></div>`).join("");
}

function renderSettings() {
	$("#shopOpening").value = state.data.settings.openingTime;
	$("#shopClosing").value = state.data.settings.closingTime;
	$("#shopCancellation").value = state.data.settings.cancellationHours;
	$("#shopCurrency").value = state.data.settings.currency;
}

function renderDashboard() {
	$("#ownerAccess").classList.add("hidden");
	$("#ownerWorkspace").classList.remove("hidden");
	$("#ownerNav").classList.remove("hidden");
	$("#ownerSignOut").classList.remove("hidden");
	$("#ownerHeading").innerHTML = `Welcome back,<br><em>${html(state.user.name.split(" ")[0])}.</em>`;
	renderMetrics();
	$("#ownerProviderStatus").innerHTML = `<span>Email confirmations: <strong>${state.data.notifications.email ? "Connected" : "Not configured"}</strong></span><span>SMS reminders: <strong>${state.data.notifications.sms ? "Connected" : "Not configured"}</strong></span><small>Connect Resend and Twilio environment variables on the server. Payment collection is not connected.</small>`;
	renderBookings();
	renderBarbers();
	renderServices();
	renderSettings();
}

async function loadDashboard() {
	const result = await api("/api/owner/data");
	state.data = result;
	renderDashboard();
}

async function refresh() {
	await loadDashboard();
}

async function saveServices() {
	const services = {};
	for (const row of $$(".owner-service-row")) {
		const inputs = row.querySelectorAll("input");
		const name = inputs[0].value.trim();
		const price = Number(inputs[1].value);
		const duration = Number(inputs[2].value);
		if (!name || Object.hasOwn(services, name)) throw new Error("Service names must be unique and cannot be blank.");
		services[name] = { price, duration };
	}
	const result = await api("/api/owner/services", { method: "PUT", body: JSON.stringify({ services }) });
	state.data.services = result.services;
	renderServices();
	message("#serviceMessage", "Service menu saved.");
}

document.addEventListener("DOMContentLoaded", async () => {
	let setupAvailable = false;
	try {
		const setupStatus = await api("/api/owner/setup-status");
		setupAvailable = setupStatus.available;
		state.setupCodeRequired = setupStatus.codeRequired;
		const { user } = await api("/api/session");
		if (user?.role === "owner") {
			state.user = user;
			await loadDashboard();
		} else {
			showAccess(user ? "This page is for the shop owner account." : "Sign in with the shop owner account.");
			setAccessMode("login", setupAvailable);
		}
	} catch (error) {
		showAccess("Owner sign-in is unavailable. Check that the shop server is running.");
		message("#ownerAccessMessage", error.message, true);
	}

	$("#ownerLoginTab").addEventListener("click", () => setAccessMode("login", setupAvailable));
	$("#ownerSetupTab").addEventListener("click", () => setAccessMode("setup", setupAvailable));
	$("#ownerAccessForm").addEventListener("submit", async event => {
		event.preventDefault();
		const setup = event.currentTarget.dataset.mode === "setup";
		const body = { name: $("#ownerName").value.trim(), email: $("#ownerEmail").value.trim(), password: $("#ownerPassword").value };
		if (setup && state.setupCodeRequired) body.setupCode = $("#ownerCode").value;
		try {
			const result = await api(setup ? "/api/owner/bootstrap" : "/api/auth/login", { method: "POST", body: JSON.stringify(body) });
			if (result.user.role !== "owner") {
				await api("/api/auth/logout", { method: "POST", body: "{}" });
				throw new Error("That account does not have shop owner access.");
			}
			state.user = result.user;
			await loadDashboard();
		} catch (error) {
			message("#ownerAccessMessage", error.message, true);
		}
	});
	$("#ownerSignOut").addEventListener("click", async () => {
		try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
		finally { state.user = null; showAccess(); }
	});
	$("#addBarberForm").addEventListener("submit", async event => {
		event.preventDefault();
		const form = event.currentTarget;
		try {
			await api("/api/owner/barbers", { method: "POST", body: JSON.stringify({ name: $("#newBarberName").value.trim(), specialty: $("#newBarberSpecialty").value.trim() }) });
			form.reset();
			await refresh();
		} catch (error) { message("#ownerActionMessage", error.message, true); }
	});
	$("#ownerBarberList").addEventListener("click", async event => {
		const button = event.target.closest("[data-toggle-barber]");
		if (!button) return;
		try {
			await api(`/api/owner/barbers/${encodeURIComponent(button.dataset.toggleBarber)}`, { method: "PATCH", body: JSON.stringify({ active: button.dataset.active !== "true" }) });
			await refresh();
		} catch (error) { message("#ownerActionMessage", error.message, true); }
	});
	$("#addServiceForm").addEventListener("submit", event => {
		event.preventDefault();
		const name = $("#newServiceName").value.trim();
		if (!name || Object.hasOwn(state.data.services, name)) return message("#serviceMessage", "That service already exists or has no name.", true);
		state.data.services[name] = { price: Number($("#newServicePrice").value), duration: Number($("#newServiceDuration").value) };
		renderServices();
		event.currentTarget.reset();
	});
	$("#ownerServiceList").addEventListener("click", event => {
		const button = event.target.closest("[data-remove-service]");
		if (!button) return;
		const row = button.closest(".owner-service-row");
		const name = row.querySelector("[data-service-name]").value;
		delete state.data.services[name];
		row.remove();
	});
	$("#saveServices").addEventListener("click", async () => {
		try { await saveServices(); }
		catch (error) { message("#serviceMessage", error.message, true); }
	});
	$("#ownerSettingsForm").addEventListener("submit", async event => {
		event.preventDefault();
		try {
			const result = await api("/api/owner/settings", { method: "PUT", body: JSON.stringify({ openingTime: $("#shopOpening").value, closingTime: $("#shopClosing").value, cancellationHours: Number($("#shopCancellation").value), currency: $("#shopCurrency").value.trim().toUpperCase() }) });
			state.data.settings = result.settings;
			renderSettings();
			renderMetrics();
			renderServices();
			message("#settingsMessage", "Shop settings saved.");
		} catch (error) { message("#settingsMessage", error.message, true); }
	});
	$("#ownerBookingList").addEventListener("click", async event => {
		const button = event.target.closest("[data-owner-booking]");
		if (!button) return;
		const action = button.dataset.ownerBooking;
		if (action === "cancel" && !window.confirm("Cancel this booking?")) return;
		try {
			await api(`/api/bookings/${encodeURIComponent(button.dataset.id)}`, { method: "PATCH", body: JSON.stringify({ action }) });
			await refresh();
		} catch (error) { message("#ownerActionMessage", error.message, true); }
	});
});