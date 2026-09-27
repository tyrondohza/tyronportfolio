const BARBERS = [
	{ id: "malik", name: "Malik Reed", specialty: "The clean classic", rating: 4.9 },
	{ id: "james", name: "James Cole", specialty: "Fades & texture", rating: 4.8 },
	{ id: "andre", name: "Andre Brooks", specialty: "Beards & detail", rating: 5.0 },
	{ id: "leo", name: "Leo Grant", specialty: "Colour & care", rating: 4.9 }
];

const SERVICES = {
	"Haircut": { price: 18, duration: 30 },
	"Beard shave": { price: 12, duration: 20 },
	"Head shave": { price: 15, duration: 25 },
	"Head + beard": { price: 25, duration: 45 },
	"Massage": { price: 20, duration: 30 },
	"Dye application": { price: 28, duration: 45 }
};

const STORAGE = {
	accounts: "goodcut.accounts",
	session: "goodcut.session",
	bookings: "goodcut.bookings",
	availability: "goodcut.availability",
	reviews: "goodcut.reviews"
};

const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const read = (key, fallback) => {
	try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
	catch { return fallback; }
};
const write = (key, value) => localStorage.setItem(key, JSON.stringify(value));
const money = amount => `$${amount}`;
const today = () => new Date().toISOString().slice(0, 10);
const currentSession = () => read(STORAGE.session, null);
const serviceDuration = services => services.reduce((sum, service) => sum + (SERVICES[service]?.duration ?? 0), 0);
const timeInMinutes = time => {
	const [hour, minute] = time.split(":").map(Number);
	return hour * 60 + minute;
};
const bookingDuration = booking => booking.duration ?? serviceDuration(booking.services);

function getAvailability() {
	return { ...Object.fromEntries(BARBERS.map(barber => [barber.id, "free"])), ...read(STORAGE.availability, {}) };
}

function getBarber(id) {
	return BARBERS.find(barber => barber.id === id);
}

function renderBarberOptions() {
	const options = BARBERS.map(barber => `<option value="${barber.id}">${barber.name}</option>`).join("");
	$("#barberSelect").insertAdjacentHTML("beforeend", options);
	$("#reviewBarber").insertAdjacentHTML("beforeend", options);
	$("#authBarber").insertAdjacentHTML("beforeend", options);
}

function renderBarbers() {
	const availability = getAvailability();
	$("#barberGrid").innerHTML = BARBERS.map(barber => {
		const booked = availability[barber.id] === "booked";
		return `<article class="barber-card">
			<div class="barber-photo" role="img" aria-label="Portrait of ${barber.name}"><span class="barber-status ${booked ? "is-booked" : ""}">${booked ? "Booked" : "Free today"}</span></div>
			<div class="barber-info"><div><h3>${barber.name}</h3><p>${barber.specialty}</p></div><span class="rating" aria-label="Rated ${barber.rating} out of 5">★ ${barber.rating.toFixed(1)}</span></div>
			<button class="choose-barber" type="button" data-choose-barber="${barber.id}" ${booked ? "disabled" : ""}>${booked ? "Unavailable today" : "Book with " + barber.name.split(" ")[0] + " ↗"}</button>
		</article>`;
	}).join("");
}

function renderTimes() {
	const barberId = $("#barberSelect").value;
	const date = $("#bookingDate").value;
	const timeSelect = $("#bookingTime");
	timeSelect.innerHTML = "";
	if (!barberId || !date) {
		timeSelect.innerHTML = '<option value="">Choose a barber and date first</option>';
		return;
	}

	if (date === today() && getAvailability()[barberId] === "booked") {
		timeSelect.innerHTML = '<option value="">Barber is booked today</option>';
		return;
	}

	const selectedDuration = serviceDuration($$("input[name='service']:checked").map(input => input.value)) || 30;
	const bookedAppointments = read(STORAGE.bookings, []).filter(booking => booking.barberId === barberId && booking.date === date);
	const slots = [];
	for (let hour = 9; hour < 18; hour++) {
		for (const minute of [0, 30]) {
			const value = `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
			const start = timeInMinutes(value);
			const end = start + selectedDuration;
			const overlaps = bookedAppointments.some(booking => {
				const existingStart = timeInMinutes(booking.time);
				const existingEnd = existingStart + bookingDuration(booking);
				return start < existingEnd && existingStart < end;
			});
			const hasPassed = date === today() && start <= timeInMinutes(new Date().toTimeString().slice(0, 5));
			if (end <= 18 * 60 && !overlaps && !hasPassed) slots.push(value);
		}
	}
	timeSelect.innerHTML = slots.length
		? '<option value="">Select a time</option>' + slots.map(time => `<option value="${time}">${time}</option>`).join("")
		: '<option value="">No times available</option>';
}

function renderTotal() {
	const selected = $$("input[name='service']:checked").map(input => input.value);
	const total = selected.reduce((sum, service) => sum + SERVICES[service].price, 0);
	const duration = selected.reduce((sum, service) => sum + SERVICES[service].duration, 0);
	$("#bookingTotal").textContent = selected.length ? `${money(total)} · about ${duration} min` : "Choose a service to see your total.";
}

function renderVisits() {
	const session = currentSession();
	const list = $("#visitsList");
	const hint = $("#visitsHint");
	if (!session || session.role !== "client") {
		hint.textContent = "Sign in as a client to see your bookings on this device.";
		list.innerHTML = '<p class="empty-state">Your next great haircut starts with a booking.</p>';
		return;
	}

	const bookings = read(STORAGE.bookings, []).filter(booking => booking.email === session.email).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`));
	hint.textContent = `${session.name} · ${bookings.length} ${bookings.length === 1 ? "booking" : "bookings"}`;
	list.innerHTML = bookings.length ? bookings.map(booking => {
		const barber = getBarber(booking.barberId);
		const date = new Date(`${booking.date}T00:00:00`).toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" });
		return `<article class="visit-row"><span class="visit-date">${date} · ${booking.time}</span><div><strong>${booking.services.join(" + ")}</strong><small>${barber ? barber.name : "Your barber"}</small></div><div><strong>${money(booking.total)}</strong><small>${booking.payment} · pay at shop</small></div><span class="visit-state">${booking.status}</span></article>`;
	}).join("") : '<p class="empty-state">No bookings yet. Choose a barber and reserve your first visit.</p>';
}

function renderAccountButton() {
	const session = currentSession();
	$("#accountButton").innerHTML = session ? `${session.name.split(" ")[0]} <span aria-hidden="true">↗</span>` : 'Sign in <span aria-hidden="true">↗</span>';
}

function renderStaffView() {
	const session = currentSession();
	const staffView = $("#staffView");
	const authView = $("#authView");
	if (!session || session.role !== "barber") {
		staffView.classList.add("hidden");
		authView.classList.remove("hidden");
		return;
	}

	authView.classList.add("hidden");
	staffView.classList.remove("hidden");
	const barber = getBarber(session.barberId);
	const isBooked = getAvailability()[session.barberId] === "booked";
	$("#staffTitle").innerHTML = `${barber.name.split(" ")[0]}'s <em>chair.</em>`;
	$("#staffStatusText").textContent = isBooked ? "Not taking bookings today" : "Available for bookings";
	$("#staffStatusButton").textContent = isBooked ? "Mark as free" : "Mark as booked";
	$("#staffStatusButton").setAttribute("aria-pressed", String(!isBooked));
	const appointments = read(STORAGE.bookings, []).filter(booking => booking.barberId === session.barberId && booking.date === today()).sort((a, b) => a.time.localeCompare(b.time));
	$("#staffAppointments").innerHTML = appointments.length ? appointments.map(booking => `<div class="staff-appointment"><strong>${booking.time} · ${booking.services.join(" + ")}</strong>${booking.name} · ${booking.payment}</div>`).join("") : '<p class="empty-state">No appointments scheduled for today.</p>';
}

function openAccount() {
	const session = currentSession();
	$("#accountDialog").showModal();
	if (session?.role === "barber") renderStaffView();
	else {
		$("#staffView").classList.add("hidden");
		$("#authView").classList.remove("hidden");
	}
}

function setAuthMode(mode) {
	const isSignup = mode === "signup";
	$$(".auth-tab").forEach(tab => {
		const active = tab.dataset.mode === mode;
		tab.classList.toggle("active", active);
		tab.setAttribute("aria-selected", String(active));
	});
	$("#nameFieldWrap").classList.toggle("hidden", !isSignup);
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
	const staff = $("#authRole").value === "barber";
	$("#staffFieldWrap").classList.toggle("hidden", !staff);
	$("#authBarber").required = staff && $("#authForm").dataset.mode === "signup";
}

function setSession(session) {
	write(STORAGE.session, session);
	renderAccountButton();
	renderVisits();
	renderStaffView();
}

function submitBooking(event) {
	event.preventDefault();
	const session = currentSession();
	const message = $("#bookingMessage");
	message.textContent = "";
	if (!session || session.role !== "client") {
		message.textContent = "Sign in as a client to request your booking.";
		openAccount();
		setAuthMode("signin");
		return;
	}

	const services = $$("input[name='service']:checked").map(input => input.value);
	const barberId = $("#barberSelect").value;
	const date = $("#bookingDate").value;
	const time = $("#bookingTime").value;
	const payment = $("input[name='payment']:checked").value;
	if (!services.length) { message.textContent = "Choose at least one service to continue."; return; }
	if (!barberId || !date || !time) { message.textContent = "Choose an available barber, date, and time."; return; }
	if (date < today()) { message.textContent = "Please choose today or a future date."; return; }
	if (date === today() && timeInMinutes(time) <= timeInMinutes(new Date().toTimeString().slice(0, 5))) { message.textContent = "That time has already passed. Please choose a later slot."; renderTimes(); return; }
	if (date === today() && getAvailability()[barberId] === "booked") { message.textContent = "That barber is marked as booked today. Please choose another barber."; renderTimes(); return; }

	const bookings = read(STORAGE.bookings, []);
	const duration = serviceDuration(services);
	const start = timeInMinutes(time);
	if (bookings.some(booking => {
		if (booking.barberId !== barberId || booking.date !== date) return false;
		const existingStart = timeInMinutes(booking.time);
		return start < existingStart + bookingDuration(booking) && existingStart < start + duration;
	})) {
		message.textContent = "That time was just taken. Please choose another slot.";
		renderTimes();
		return;
	}
	const total = services.reduce((sum, service) => sum + SERVICES[service].price, 0);
	bookings.push({ id: crypto.randomUUID ? crypto.randomUUID() : String(Date.now()), email: session.email, name: session.name, barberId, date, time, services, payment, total, duration, status: "Requested" });
	write(STORAGE.bookings, bookings);
	message.textContent = "Your booking request is saved. We look forward to seeing you.";
	renderVisits();
	renderTimes();
	renderStaffView();
	$("#bookingForm").reset();
	$("#bookingDate").value = date;
	renderTotal();
}

function submitAuth(event) {
	event.preventDefault();
	const form = event.currentTarget;
	const mode = form.dataset.mode;
	const name = $("#authName").value.trim();
	const email = $("#authEmail").value.trim().toLowerCase();
	const password = $("#authPassword").value;
	const role = $("#authRole").value;
	const accounts = read(STORAGE.accounts, []);
	const message = $("#authMessage");
	message.textContent = "";

	if (mode === "signup") {
		if (accounts.some(account => account.email === email)) { message.textContent = "An account with that email already exists. Sign in instead."; return; }
		const account = { name, email, password, role, barberId: role === "barber" ? $("#authBarber").value : null };
		accounts.push(account);
		write(STORAGE.accounts, accounts);
		setSession({ name, email, role, barberId: account.barberId });
		$("#authForm").reset();
		$("#accountDialog").close();
		return;
	}

	const account = accounts.find(item => item.email === email && item.password === password);
	if (!account) { message.textContent = "Those details don't match an account on this device."; return; }
	setSession({ name: account.name, email: account.email, role: account.role, barberId: account.barberId });
	$("#authForm").reset();
	$("#accountDialog").close();
}

function submitReview(event) {
	event.preventDefault();
	const session = currentSession();
	const message = $("#reviewMessage");
	if (!session || session.role !== "client") {
		message.textContent = "Sign in as a client before leaving a review.";
		openAccount();
		setAuthMode("signin");
		return;
	}
	const reviews = read(STORAGE.reviews, []);
	reviews.push({ email: session.email, name: session.name, barberId: $("#reviewBarber").value, rating: Number($("#reviewRating").value), text: $("#reviewText").value.trim(), date: today() });
	write(STORAGE.reviews, reviews);
	message.textContent = "Thanks for sharing how your visit went.";
	event.currentTarget.reset();
}

document.addEventListener("DOMContentLoaded", () => {
	renderBarberOptions();
	const dateInput = $("#bookingDate");
	dateInput.min = today();
	dateInput.value = today();
	renderBarbers();
	renderTotal();
	renderAccountButton();
	renderVisits();
	renderStaffView();
	renderTimes();

	$("#accountButton").addEventListener("click", openAccount);
	$("#closeDialog").addEventListener("click", () => $("#accountDialog").close());
	$("#accountDialog").addEventListener("click", event => { if (event.target === $("#accountDialog")) $("#accountDialog").close(); });
	$$(".auth-tab").forEach(tab => tab.addEventListener("click", () => setAuthMode(tab.dataset.mode)));
	$("#authRole").addEventListener("change", updateRoleFields);
	$("#authForm").addEventListener("submit", submitAuth);
	$("#bookingForm").addEventListener("submit", submitBooking);
	$("#reviewForm").addEventListener("submit", submitReview);
	$("#bookingDate").addEventListener("change", renderTimes);
	$("#barberSelect").addEventListener("change", renderTimes);
	$("#serviceGrid").addEventListener("change", renderTotal);
	$("#barberGrid").addEventListener("click", event => {
		const button = event.target.closest("[data-choose-barber]");
		if (!button || button.disabled) return;
		$("#barberSelect").value = button.dataset.chooseBarber;
		renderTimes();
		$("#book").scrollIntoView({ behavior: "smooth" });
	});
	$("#staffStatusButton").addEventListener("click", () => {
		const session = currentSession();
		if (!session || session.role !== "barber") return;
		const availability = getAvailability();
		availability[session.barberId] = availability[session.barberId] === "booked" ? "free" : "booked";
		write(STORAGE.availability, availability);
		renderBarbers();
		renderTimes();
		renderStaffView();
	});
	$("#signOutButton").addEventListener("click", () => {
		localStorage.removeItem(STORAGE.session);
		renderAccountButton();
		renderVisits();
		renderStaffView();
		$("#accountDialog").close();
	});
});
