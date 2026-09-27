const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const formatMoney = amount => new Intl.NumberFormat(undefined, { style: "currency", currency: state.currency }).format(amount);
const barberFor = id => state.barbers.find(barber => barber.id === id);
const durationFor = services => services.reduce((sum, service) => sum + (state.services[service]?.duration ?? 0), 0);
const dateLabel = value => new Date(`${value}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });

const state = {
	barbers: [], services: {}, settings: {}, currency: "USD", payments: {}, user: null,
	bookings: [], reviews: [], authMode: "signin", activeBooking: null
};

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

function showMessage(selector, text, isError = false) {
	const node = $(selector);
	node.textContent = text;
	node.classList.toggle("is-error", isError);
}

function renderOptions() {
	const options = state.barbers.map(barber => `<option value="${html(barber.id)}">${html(barber.name)}</option>`).join("");
	$("#barberSelect").innerHTML = '<option value="">Select a barber</option>' + options;
	$("#authBarber").innerHTML = '<option value="">Choose your barber profile</option>' + options;
	$("#serviceGrid").innerHTML = Object.entries(state.services).map(([name, service]) => `<label class="service-option"><input type="checkbox" name="service" value="${html(name)}"><span class="service-name">${html(name)}</span><span class="service-meta">${service.duration} min <b>${formatMoney(service.price)}</b></span></label>`).join("");
	const cancellation = state.settings.cancellationHours;
	$("#bookingRules").textContent = `Open ${state.settings.openingTime}–${state.settings.closingTime} · cancel or reschedule at least ${cancellation} hours before your visit.`;
}

function renderBarbers() {
	$("#barberGrid").innerHTML = state.barbers.map((barber, index) => {
		const booked = barber.status === "booked";
		const rating = barber.average === null ? "New" : `★ ${barber.average.toFixed(1)} <small>(${barber.count})</small>`;
		return `<article class="barber-card">
			<div class="barber-photo barber-photo-${index + 1}" role="img" aria-label="Portrait of ${html(barber.name)}"><span class="barber-status ${booked ? "is-booked" : ""}">${booked ? "Booked today" : "Free today"}</span></div>
			<div class="barber-info"><div><h3>${html(barber.name)}</h3><p>${html(barber.specialty)}</p></div><span class="rating" aria-label="${barber.average === null ? "No reviews yet" : `Rated ${barber.average} out of 5`}">${rating}</span></div>
			<button class="choose-barber" type="button" data-choose-barber="${html(barber.id)}" ${booked ? "disabled" : ""}>${booked ? "Unavailable today" : `Book with ${html(barber.name.split(" ")[0])} ↗`}</button>
		</article>`;
	}).join("");
}

function renderTotal() {
	const services = $$("input[name='service']:checked").map(input => input.value);
	const total = services.reduce((sum, service) => sum + state.services[service].price, 0);
	const duration = durationFor(services);
	$("#bookingTotal").textContent = services.length ? `${formatMoney(total)} · about ${duration} min` : "Choose a service to see your total.";
	renderTimes().catch(error => showMessage("#bookingMessage", error.message, true));
}

async function renderTimes() {
	const barberId = $("#barberSelect").value;
	const date = $("#bookingDate").value;
	const duration = durationFor($$("input[name='service']:checked").map(input => input.value)) || 30;
	const select = $("#bookingTime");
	if (!barberId || !date) {
		select.innerHTML = '<option value="">Choose a barber and date first</option>';
		return;
	}
	select.innerHTML = '<option value="">Loading available times…</option>';
	const { slots } = await api(`/api/slots?barberId=${encodeURIComponent(barberId)}&date=${encodeURIComponent(date)}&duration=${duration}`);
	select.innerHTML = slots.length
		? '<option value="">Select a time</option>' + slots.map(time => `<option value="${html(time)}">${html(time)}</option>`).join("")
		: '<option value="">No times available</option>';
}

function renderVisits() {
	const hint = $("#visitsHint");
	if (!state.user || state.user.role !== "client") {
		hint.textContent = "Sign in as a client to see your bookings.";
		$("#visitsList").innerHTML = '<p class="empty-state">Your next great haircut starts with a booking.</p>';
		return;
	}
	const bookings = state.bookings.filter(booking => booking.date >= localDate() && !["cancelled", "completed"].includes(booking.status));
	hint.textContent = `${state.user.name} · ${bookings.length} upcoming ${bookings.length === 1 ? "visit" : "visits"}`;
	$("#visitsList").innerHTML = bookings.length ? bookings.map(booking => `<article class="visit-row">
		<span class="visit-date">${html(dateLabel(booking.date))} · ${html(booking.time)}</span>
		<div><strong>${booking.services.map(html).join(" + ")}</strong><small>${html(booking.barberName)}</small></div>
		<div><strong>${formatMoney(booking.total)}</strong><small>${html(booking.payment)} · ${booking.paymentStatus === "paid" ? "paid" : "pay at shop"}</small></div>
		<span class="visit-state visit-state-${html(booking.status)}">${html(booking.status)}</span>
		${["requested", "confirmed"].includes(booking.status) ? `<div class="visit-actions"><button class="text-action" type="button" data-manage-booking="${html(booking.id)}">Reschedule</button><button class="text-action text-action-danger" type="button" data-cancel-booking="${html(booking.id)}">Cancel</button></div>` : ""}
	</article>`).join("") : '<p class="empty-state">No upcoming visits. Choose a barber and reserve your first visit.</p>';
}

function renderReviews() {
	const completed = state.bookings.filter(booking => booking.status === "completed");
	const alreadyReviewed = new Set(state.reviews.map(review => review.bookingId));
	const options = completed.filter(booking => !alreadyReviewed.has(booking.id));
	$("#reviewBooking").innerHTML = options.length
		? '<option value="">Choose a completed visit</option>' + options.map(booking => `<option value="${html(booking.id)}">${html(dateLabel(booking.date))} · ${html(booking.barberName)}</option>`).join("")
		: '<option value="">No unreviewed completed visits yet</option>';
	$("#reviewList").innerHTML = state.reviews.length ? `<p class="review-feed-label">RECENT WORDS FROM THE CHAIR</p>${state.reviews.slice(0, 4).map(review => `<article class="review-item"><span class="review-item-rating" aria-label="${review.rating} out of 5 stars">${"★".repeat(review.rating)}${"☆".repeat(5 - review.rating)}</span><p>${review.text ? `“${html(review.text)}”` : "A client left a rating."}</p><small>${html(review.name)} · ${html(review.barberName)}</small></article>`).join("")}` : '<p class="review-feed-label">Reviews from completed visits will appear here.</p>';
}

function renderAccountButton() {
	$("#accountButton").innerHTML = state.user ? `${html(state.user.name.split(" ")[0])} <span aria-hidden="true">↗</span>` : 'Sign in <span aria-hidden="true">↗</span>';
}

async function refreshBookings() {
	if (!state.user) {
		state.bookings = [];
		return;
	}
	const result = await api("/api/bookings");
	state.bookings = result.bookings;
}

async function refreshReviewsAndBarbers() {
	const [config, reviewResult] = await Promise.all([api("/api/config"), api("/api/reviews")]);
	state.barbers = config.barbers;
	state.services = config.services;
	state.settings = config.settings;
	state.currency = config.currency;
	state.payments = config.payments;
	state.reviews = reviewResult.reviews;
	renderOptions();
	renderBarbers();
	renderReviews();
}

function renderStaffView() {
	const session = state.user;
	const staffView = $("#staffView");
	if (!session || session.role !== "barber") {
		staffView.classList.add("hidden");
		return;
	}
	staffView.classList.remove("hidden");
	const barber = barberFor(session.barberId);
	$("#staffTitle").innerHTML = `${html(barber.name.split(" ")[0])}'s <em>chair.</em>`;
	const date = $("#staffAvailabilityDate").value;
	api(`/api/barbers/${encodeURIComponent(session.barberId)}/availability?date=${encodeURIComponent(date)}`).then(({ status }) => {
		$("#staffStatusText").textContent = status === "booked" ? "Not taking bookings on this date" : "Available for bookings on this date";
		$("#staffStatusButton").textContent = status === "booked" ? "Mark as free" : "Mark as booked";
		$("#staffStatusButton").setAttribute("aria-pressed", String(status === "free"));
	}).catch(error => showMessage("#authMessage", error.message, true));
	const upcoming = state.bookings.filter(booking => booking.date >= localDate() && !["cancelled", "completed"].includes(booking.status));
	$("#staffAppointments").innerHTML = upcoming.length ? upcoming.map(booking => `<article class="staff-appointment">
		<strong>${html(dateLabel(booking.date))} · ${html(booking.time)} · ${html(booking.services.join(" + "))}</strong>
		<span>${html(booking.name)} · ${html(booking.payment)} · ${html(booking.status)}</span>
		<div class="staff-appointment-actions">${booking.status === "requested" ? `<button class="text-action" type="button" data-staff-action="confirm" data-booking-id="${html(booking.id)}">Confirm</button>` : ""}<button class="text-action" type="button" data-staff-action="complete" data-booking-id="${html(booking.id)}">Mark complete</button><button class="text-action text-action-danger" type="button" data-staff-action="cancel" data-booking-id="${html(booking.id)}">Cancel</button></div>
	</article>`).join("") : '<p class="empty-state">No upcoming appointments.</p>';
}

function renderAccountDialog() {
	const signedIn = Boolean(state.user);
	$("#authView").classList.toggle("hidden", signedIn);
	$("#clientView").classList.toggle("hidden", !signedIn || state.user.role !== "client");
	$("#staffView").classList.toggle("hidden", !signedIn || state.user.role !== "barber");
	if (state.user?.role === "client") {
		$("#clientName").textContent = `${state.user.name.split(" ")[0]}.`;
		$("#clientEmail").textContent = state.user.email;
	}
	if (state.user?.role === "barber") renderStaffView();
}

function openAccount() {
	renderAccountDialog();
	$("#accountDialog").showModal();
}

function setAuthMode(mode) {
	state.authMode = mode;
	const isSignup = mode === "signup";
	$$('.auth-tab').forEach(tab => {
		const active = tab.dataset.mode === mode;
		tab.classList.toggle("active", active);
		tab.setAttribute("aria-selected", String(active));
	});
	$("#nameFieldWrap").classList.toggle("hidden", !isSignup);
	$("#phoneFieldWrap").classList.toggle("hidden", !isSignup);
	$("#phoneConsentWrap").classList.toggle("hidden", !isSignup);
	$("#roleFieldWrap").classList.toggle("hidden", !isSignup);
	$("#authPassword").autocomplete = isSignup ? "new-password" : "current-password";
	$("#authPassword").required = isSignup;
	$("#authName").required = isSignup;
	$("#authRole").required = isSignup;
	$("#authForm").dataset.mode = mode;
	$("#dialogTitle").innerHTML = isSignup ? "Come on <em>in.</em>" : "Sign in <em>or join us.</em>";
	$(".auth-submit").innerHTML = `${isSignup ? "Create account" : "Sign in"} <span aria-hidden="true">↗</span>`;
	$("#authMessage").textContent = "";
	updateRoleFields();
}

function updateRoleFields() {
	const isSignup = state.authMode === "signup";
	const isBarber = $("#authRole").value === "barber";
	$("#staffFieldWrap").classList.toggle("hidden", !isSignup || !isBarber);
	$("#inviteFieldWrap").classList.toggle("hidden", !isSignup || !isBarber);
	$("#authBarber").required = isSignup && isBarber;
	$("#authInvite").required = isSignup && isBarber;
}

async function submitAuth(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const signup = form.dataset.mode === "signup";
	const body = {
		name: $("#authName").value.trim(),
		email: $("#authEmail").value.trim(),
		phone: $("#authPhone").value.trim(),
		smsOptIn: $("#authSmsOptIn").checked,
		password: $("#authPassword").value,
		role: $("#authRole").value,
		barberId: $("#authBarber").value,
		inviteCode: $("#authInvite").value
	};
	try {
		const result = await api(signup ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body: JSON.stringify(body) });
		state.user = result.user;
		await refreshBookings();
		await refreshReviewsAndBarbers();
		renderVisits();
		renderAccountButton();
		form.reset();
		$("#accountDialog").close();
		if (state.user.role === "barber") renderStaffView();
	} catch (error) {
		showMessage("#authMessage", error.message, true);
	}
}

async function submitBooking(event) {
	event.preventDefault();
	if (!state.user || state.user.role !== "client") {
		showMessage("#bookingMessage", "Sign in as a client to request your booking.", true);
		openAccount();
		setAuthMode("signin");
		return;
	}
	const services = $$("input[name='service']:checked").map(input => input.value);
	if (!services.length) return showMessage("#bookingMessage", "Choose at least one service to continue.", true);
	try {
		const result = await api("/api/bookings", { method: "POST", body: JSON.stringify({
			services, barberId: $("#barberSelect").value, date: $("#bookingDate").value,
			time: $("#bookingTime").value, payment: $("input[name='payment']:checked").value
		}) });
		showMessage("#bookingMessage", "Your booking request is saved. We look forward to seeing you.");
		const date = $("#bookingDate").value;
		$("#bookingForm").reset();
		$("#bookingDate").value = date;
		renderTotal();
		await refreshBookings();
		await refreshReviewsAndBarbers();
		renderVisits();
		renderStaffView();
	} catch (error) {
		showMessage("#bookingMessage", error.message, true);
		await renderTimes().catch(() => {});
	}
}

async function submitReview(event) {
	event.preventDefault();
	const form = event.currentTarget;
	if (!state.user || state.user.role !== "client") {
		showMessage("#reviewMessage", "Sign in as a client to leave a review.", true);
		openAccount();
		setAuthMode("signin");
		return;
	}
	try {
		await api("/api/reviews", { method: "POST", body: JSON.stringify({ bookingId: $("#reviewBooking").value, rating: Number($("#reviewRating").value), text: $("#reviewText").value.trim() }) });
		form.reset();
		showMessage("#reviewMessage", "Thanks for sharing how your visit went.");
		await refreshReviewsAndBarbers();
	} catch (error) {
		showMessage("#reviewMessage", error.message, true);
	}
}

async function loadManageTimes() {
	const booking = state.activeBooking;
	if (!booking || !$("#manageDate").value) return;
	const { slots } = await api(`/api/slots?barberId=${encodeURIComponent(booking.barberId)}&date=${encodeURIComponent($("#manageDate").value)}&duration=${booking.duration}&excludeBookingId=${encodeURIComponent(booking.id)}`);
	$("#manageTime").innerHTML = slots.length
		? '<option value="">Select a time</option>' + slots.map(time => `<option value="${html(time)}">${html(time)}</option>`).join("")
		: '<option value="">No times available</option>';
}

async function manageBookingAction(bookingId, action) {
	try {
		await api(`/api/bookings/${encodeURIComponent(bookingId)}`, { method: "PATCH", body: JSON.stringify({ action }) });
		await refreshBookings();
		await refreshReviewsAndBarbers();
		renderVisits();
		renderStaffView();
	} catch (error) {
		showMessage("#bookingMessage", error.message, true);
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	const dateInput = $("#bookingDate");
	dateInput.min = localDate();
	dateInput.value = localDate();
	$("#manageDate").min = localDate();
	$("#staffAvailabilityDate").min = localDate();
	$("#staffAvailabilityDate").value = localDate();
	try {
		await refreshReviewsAndBarbers();
		renderOptions();
		const session = await api("/api/session");
		state.user = session.user;
		await refreshBookings();
		renderAccountButton();
		renderVisits();
		renderReviews();
		renderAccountDialog();
		renderTotal();
	} catch (error) {
		showMessage("#bookingMessage", `Booking service is unavailable: ${error.message}`, true);
	}

	$("#accountButton").addEventListener("click", openAccount);
	$("#closeDialog").addEventListener("click", () => $("#accountDialog").close());
	$("#closeManageDialog").addEventListener("click", () => $("#manageBookingDialog").close());
	$("#accountDialog").addEventListener("click", event => { if (event.target === $("#accountDialog")) $("#accountDialog").close(); });
	$("#manageBookingDialog").addEventListener("click", event => { if (event.target === $("#manageBookingDialog")) $("#manageBookingDialog").close(); });
	$$('.auth-tab').forEach(tab => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));
	$("#authRole").addEventListener("change", updateRoleFields);
	$("#authForm").addEventListener("submit", submitAuth);
	$("#bookingForm").addEventListener("submit", submitBooking);
	$("#reviewForm").addEventListener("submit", submitReview);
	$("#bookingDate").addEventListener("change", () => renderTimes().catch(error => showMessage("#bookingMessage", error.message, true)));
	$("#barberSelect").addEventListener("change", () => renderTimes().catch(error => showMessage("#bookingMessage", error.message, true)));
	$("#serviceGrid").addEventListener("change", renderTotal);
	$("#barberGrid").addEventListener("click", event => {
		const button = event.target.closest("[data-choose-barber]");
		if (!button || button.disabled) return;
		$("#barberSelect").value = button.dataset.chooseBarber;
		renderTimes().catch(error => showMessage("#bookingMessage", error.message, true));
		$("#book").scrollIntoView({ behavior: "smooth" });
	});
	$("#visitsList").addEventListener("click", event => {
		const cancel = event.target.closest("[data-cancel-booking]");
		if (cancel && window.confirm("Cancel this booking?")) manageBookingAction(cancel.dataset.cancelBooking, "cancel");
		const manage = event.target.closest("[data-manage-booking]");
		if (manage) {
			state.activeBooking = state.bookings.find(booking => booking.id === manage.dataset.manageBooking);
			$("#manageBookingId").value = state.activeBooking.id;
			$("#manageDate").value = state.activeBooking.date;
			$("#manageTime").innerHTML = "";
			$("#manageBookingDialog").showModal();
			loadManageTimes().catch(error => showMessage("#manageMessage", error.message, true));
		}
	});
	$("#manageDate").addEventListener("change", () => loadManageTimes().catch(error => showMessage("#manageMessage", error.message, true)));
	$("#manageBookingForm").addEventListener("submit", async event => {
		event.preventDefault();
		try {
			await api(`/api/bookings/${encodeURIComponent($("#manageBookingId").value)}`, { method: "PATCH", body: JSON.stringify({ action: "reschedule", date: $("#manageDate").value, time: $("#manageTime").value }) });
			$("#manageBookingDialog").close();
			await refreshBookings();
			renderVisits();
		} catch (error) {
			showMessage("#manageMessage", error.message, true);
			await loadManageTimes().catch(() => {});
		}
	});
	$("#staffAvailabilityDate").addEventListener("change", renderStaffView);
	$("#staffStatusButton").addEventListener("click", async () => {
		const status = $("#staffStatusButton").getAttribute("aria-pressed") === "true" ? "booked" : "free";
		try {
			await api(`/api/barbers/${encodeURIComponent(state.user.barberId)}/availability`, { method: "PUT", body: JSON.stringify({ date: $("#staffAvailabilityDate").value, status }) });
			await refreshReviewsAndBarbers();
			renderStaffView();
			await renderTimes().catch(() => {});
		} catch (error) { showMessage("#authMessage", error.message, true); }
	});
	$("#staffAppointments").addEventListener("click", event => {
		const button = event.target.closest("[data-staff-action]");
		if (button) manageBookingAction(button.dataset.bookingId, button.dataset.staffAction);
	});
	const signOut = async () => {
		try { await api("/api/auth/logout", { method: "POST", body: "{}" }); }
		finally {
			state.user = null;
			state.bookings = [];
			renderAccountButton();
			renderVisits();
			renderReviews();
			renderAccountDialog();
			$("#accountDialog").close();
		}
	};
	$("#signOutButton").addEventListener("click", signOut);
	$("#clientSignOutButton").addEventListener("click", signOut);
});