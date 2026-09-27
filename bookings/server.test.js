const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { after, before, test } = require("node:test");
const { createServer } = require("./server");

let server;
let baseUrl;
let dataDirectory;
let clientCookie;
let barberCookie;
let ownerCookie;
let bookingId;
const appointmentDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

async function api(endpoint, { method = "GET", body, cookie } = {}) {
	const response = await fetch(`${baseUrl}${endpoint}`, {
		method,
		headers: {
			...(body ? { "Content-Type": "application/json" } : {}),
			...(cookie ? { Cookie: cookie } : {})
		},
		...(body ? { body: JSON.stringify(body) } : {})
	});
	return { status: response.status, body: await response.json(), cookie: response.headers.get("set-cookie")?.split(";")[0] };
}

before(async () => {
	dataDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "goodcut-test-"));
	server = createServer({ dataFile: path.join(dataDirectory, "data.json"), barberInviteCode: "test-barber-code", ownerSetupCode: "test-owner-code" });
	await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
	baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
	if (server) await new Promise(resolve => server.close(resolve));
	if (dataDirectory) fs.rmSync(dataDirectory, { recursive: true, force: true });
});

test("secure sign-up, barber invite, bookings, management, and reviews", async () => {
	const publicConfig = await api("/api/config");
	assert.equal(publicConfig.status, 200);
	assert.equal(publicConfig.body.barbers.length, 4);
	assert.equal(publicConfig.body.payments.mobileMoney, false);
	assert.equal(publicConfig.body.settings.openingTime, "09:00");
	assert.equal((await api("/api/owner/setup-status")).body.available, true);

	const deniedOwnerSetup = await api("/api/owner/bootstrap", { method: "POST", body: { name: "Shop Owner", email: "owner@example.test", password: "a-long-owner-password", setupCode: "wrong-code" } });
	assert.equal(deniedOwnerSetup.status, 403);
	const ownerSetup = await api("/api/owner/bootstrap", { method: "POST", body: { name: "Shop Owner", email: "owner@example.test", password: "a-long-owner-password", setupCode: "test-owner-code" } });
	assert.equal(ownerSetup.status, 201);
	ownerCookie = ownerSetup.cookie;
	assert.equal((await api("/api/owner/setup-status")).body.available, false);
	assert.equal((await api("/api/owner/bootstrap", { method: "POST", body: { name: "Another Owner", email: "another-owner@example.test", password: "a-long-owner-password", setupCode: "test-owner-code" } })).status, 409);

	const clientSignup = await api("/api/auth/signup", {
		method: "POST",
		body: { name: "Test Client", email: "client@example.test", password: "a-long-test-password", role: "client" }
	});
	assert.equal(clientSignup.status, 201);
	clientCookie = clientSignup.cookie;
	assert.equal((await api("/api/owner/data", { cookie: clientCookie })).status, 403);
	const data = JSON.parse(fs.readFileSync(path.join(dataDirectory, "data.json"), "utf8"));
	assert.equal(data.users[0].password, undefined);
	assert.ok(data.users[0].passwordHash);
	assert.equal(data.users.find(user => user.email === "client@example.test").phone, null);
	const optedInClient = await api("/api/auth/signup", {
		method: "POST",
		body: { name: "SMS Client", email: "sms-client@example.test", password: "a-long-test-password", phone: "+15550102000", smsOptIn: true, role: "client" }
	});
	assert.equal(optedInClient.status, 201);
	const optedInData = JSON.parse(fs.readFileSync(path.join(dataDirectory, "data.json"), "utf8"));
	assert.equal(optedInData.users.find(user => user.email === "sms-client@example.test").phone, "+15550102000");

	const uninvitedBarber = await api("/api/auth/signup", {
		method: "POST",
		body: { name: "Test Barber", email: "barber@example.test", password: "a-long-test-password", role: "barber", barberId: "malik" }
	});
	assert.equal(uninvitedBarber.status, 403);

	const booking = await api("/api/bookings", {
		method: "POST", cookie: clientCookie,
		body: { barberId: "malik", services: ["Head + beard"], date: appointmentDate, time: "09:00", payment: "Cash" }
	});
	assert.equal(booking.status, 201);
	bookingId = booking.body.booking.id;
	assert.equal(booking.body.booking.total, 25);
	assert.equal(booking.body.booking.email, undefined);
	assert.equal(booking.body.booking.userId, undefined);

	const overlappingSlot = await api(`/api/slots?barberId=malik&date=${appointmentDate}&duration=30`);
	assert.equal(overlappingSlot.body.slots.includes("09:30"), false);
	const overlappingBooking = await api("/api/bookings", {
		method: "POST", cookie: clientCookie,
		body: { barberId: "malik", services: ["Haircut"], date: appointmentDate, time: "09:30", payment: "Cash" }
	});
	assert.equal(overlappingBooking.status, 409);

	const barberSignup = await api("/api/auth/signup", {
		method: "POST",
		body: { name: "Test Barber", email: "barber@example.test", password: "a-long-test-password", role: "barber", barberId: "malik", inviteCode: "test-barber-code" }
	});
	assert.equal(barberSignup.status, 201);
	barberCookie = barberSignup.cookie;
	const newBarber = await api("/api/owner/barbers", { method: "POST", cookie: ownerCookie, body: { name: "Sam Taylor", specialty: "Classic cuts" } });
	assert.equal(newBarber.status, 201);
	const profilesAfterAdd = await api("/api/config");
	assert.equal(profilesAfterAdd.body.barbers.length, 5);
	const serviceCatalog = { ...publicConfig.body.services, "Beard trim": { price: 14, duration: 20 } };
	const updatedServices = await api("/api/owner/services", { method: "PUT", cookie: ownerCookie, body: { services: serviceCatalog } });
	assert.equal(updatedServices.body.services["Beard trim"].price, 14);
	const updatedSettings = await api("/api/owner/settings", { method: "PUT", cookie: ownerCookie, body: { openingTime: "10:00", closingTime: "16:00", cancellationHours: 24, currency: "USD" } });
	assert.equal(updatedSettings.body.settings.cancellationHours, 24);
	const invalidHours = await api("/api/owner/settings", { method: "PUT", cookie: ownerCookie, body: { openingTime: "99:99", closingTime: "18:00", cancellationHours: 24, currency: "USD" } });
	assert.equal(invalidHours.status, 400);
	await api("/api/owner/settings", { method: "PUT", cookie: ownerCookie, body: { openingTime: "10:00", closingTime: "16:00", cancellationHours: 168, currency: "USD" } });
	const lateCancellation = await api(`/api/bookings/${bookingId}`, { method: "PATCH", cookie: clientCookie, body: { action: "cancel" } });
	assert.equal(lateCancellation.status, 409);
	await api("/api/owner/settings", { method: "PUT", cookie: ownerCookie, body: { openingTime: "10:00", closingTime: "16:00", cancellationHours: 0, currency: "USD" } });
	const ownerBookings = await api("/api/owner/data", { cookie: ownerCookie });
	assert.equal(ownerBookings.body.bookings[0].clientEmail, "client@example.test");
	const ownerSlots = await api(`/api/slots?barberId=malik&date=${appointmentDate}&duration=30`);
	assert.deepEqual(ownerSlots.body.slots.slice(0, 1), ["10:00"], JSON.stringify(ownerSlots.body));
	assert.equal(ownerSlots.body.slots.includes("16:00"), false);
	const disableNewBarber = await api(`/api/owner/barbers/${newBarber.body.barber.id}`, { method: "PATCH", cookie: ownerCookie, body: { active: false } });
	assert.equal(disableNewBarber.body.barber.active, false);
	const profilesAfterSignup = await api("/api/config");
	assert.equal(profilesAfterSignup.body.barbers.find(barber => barber.id === "malik").profileAvailable, false);
	const availabilityUpdate = await api("/api/barbers/malik/availability", { method: "PUT", cookie: barberCookie, body: { date: appointmentDate, status: "booked" } });
	assert.equal(availabilityUpdate.body.status, "booked");
	const availabilityRead = await api(`/api/barbers/malik/availability?date=${appointmentDate}`);
	assert.equal(availabilityRead.body.status, "booked");
	const anotherBarberUpdate = await api("/api/barbers/andre/availability", { method: "PUT", cookie: barberCookie, body: { date: appointmentDate, status: "booked" } });
	assert.equal(anotherBarberUpdate.status, 403);
	await api("/api/barbers/malik/availability", { method: "PUT", cookie: barberCookie, body: { date: appointmentDate, status: "free" } });

	const rescheduled = await api(`/api/bookings/${bookingId}`, { method: "PATCH", cookie: clientCookie, body: { action: "reschedule", date: appointmentDate, time: "10:00" } });
	assert.equal(rescheduled.body.booking.time, "10:00");

	const unconfirmedCompletion = await api(`/api/bookings/${bookingId}`, { method: "PATCH", cookie: barberCookie, body: { action: "complete" } });
	assert.equal(unconfirmedCompletion.status, 409);
	const confirmed = await api(`/api/bookings/${bookingId}`, { method: "PATCH", cookie: barberCookie, body: { action: "confirm" } });
	assert.equal(confirmed.body.booking.status, "confirmed");
	const completed = await api(`/api/bookings/${bookingId}`, { method: "PATCH", cookie: barberCookie, body: { action: "complete" } });
	assert.equal(completed.body.booking.status, "completed");
	const review = await api("/api/reviews", { method: "POST", cookie: clientCookie, body: { bookingId, rating: 5, text: "Excellent." } });
	assert.equal(review.status, 201);
	assert.equal(review.body.rating.average, 5);
	assert.equal(review.body.rating.count, 1);
	assert.equal(review.body.review.userId, undefined);
	assert.equal(review.body.review.bookingId, undefined);
	const publicReviews = await api("/api/reviews");
	assert.equal(publicReviews.body.reviews[0].userId, undefined);

	const duplicateReview = await api("/api/reviews", { method: "POST", cookie: clientCookie, body: { bookingId, rating: 5 } });
	assert.equal(duplicateReview.status, 409);
	const deactivateStaff = await api("/api/owner/barbers/malik", { method: "PATCH", cookie: ownerCookie, body: { active: false } });
	assert.equal(deactivateStaff.body.barber.active, false);
	assert.equal((await api("/api/bookings", { cookie: barberCookie })).status, 401);
	const deactivatedLogin = await api("/api/auth/login", { method: "POST", body: { email: "barber@example.test", password: "a-long-test-password" } });
	assert.equal(deactivatedLogin.status, 403);
});

test("owner can sign up once on localhost without a setup code", async () => {
	const localDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "goodcut-local-owner-"));
	const localServer = createServer({ dataFile: path.join(localDirectory, "data.json"), ownerSetupCode: "" });
	await new Promise(resolve => localServer.listen(0, "127.0.0.1", resolve));
	const localUrl = `http://127.0.0.1:${localServer.address().port}`;
	try {
		const setupStatus = await fetch(`${localUrl}/api/owner/setup-status`).then(response => response.json());
		assert.equal(setupStatus.available, true);
		assert.equal(setupStatus.codeRequired, false);
		const signup = await fetch(`${localUrl}/api/owner/bootstrap`, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({ name: "Local Owner", email: "local-owner@example.test", password: "a-long-local-owner-password" })
		});
		assert.equal(signup.status, 201);
		assert.equal((await signup.json()).user.role, "owner");
		const secondStatus = await fetch(`${localUrl}/api/owner/setup-status`).then(response => response.json());
		assert.equal(secondStatus.available, false);
	} finally {
		await new Promise(resolve => localServer.close(resolve));
		fs.rmSync(localDirectory, { recursive: true, force: true });
	}
});