const crypto = require("node:crypto");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { promisify } = require("node:util");

const scrypt = promisify(crypto.scrypt);
const ROOT = path.resolve(__dirname, "..");
const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;
const MAX_BODY_BYTES = 32 * 1024;
const BARBERS = [
	{ id: "malik", name: "Malik Reed", specialty: "The clean classic" },
	{ id: "james", name: "James Cole", specialty: "Fades & texture" },
	{ id: "andre", name: "Andre Brooks", specialty: "Beards & detail" },
	{ id: "leo", name: "Leo Grant", specialty: "Colour & care" }
];
const SERVICES = {
	"Haircut": { price: 18, duration: 30 },
	"Beard shave": { price: 12, duration: 20 },
	"Head shave": { price: 15, duration: 25 },
	"Head + beard": { price: 25, duration: 45 },
	"Massage": { price: 20, duration: 30 },
	"Dye application": { price: 28, duration: 45 }
};

function emptyStore() {
	return {
		users: [], sessions: [], bookings: [], availability: {}, reviews: [],
		barbers: BARBERS.map(barber => ({ ...barber, active: true })),
		services: { ...SERVICES },
		settings: { openingTime: "09:00", closingTime: "18:00", cancellationHours: 0, currency: process.env.SHOP_CURRENCY || "USD" },
		remindersSent: []
	};
}

function createStore(dataFile) {
	fs.mkdirSync(path.dirname(dataFile), { recursive: true });
	let store;
	try { store = { ...emptyStore(), ...JSON.parse(fs.readFileSync(dataFile, "utf8")) }; }
	catch (error) {
		if (error.code !== "ENOENT") throw error;
		store = emptyStore();
	}
	store.barbers ||= BARBERS.map(barber => ({ ...barber, active: true }));
	store.services ||= { ...SERVICES };
	store.settings = { ...emptyStore().settings, ...store.settings };
	store.availability ||= {};
	store.reviews ||= [];
	store.remindersSent ||= [];
	const save = () => {
		const temporaryFile = `${dataFile}.${process.pid}.tmp`;
		fs.writeFileSync(temporaryFile, JSON.stringify(store, null, 2), { mode: 0o600 });
		fs.renameSync(temporaryFile, dataFile);
	};
	return { store, save };
}

function sendJson(response, status, value, headers = {}) {
	response.writeHead(status, {
		"Content-Type": "application/json; charset=utf-8",
		"Cache-Control": "no-store",
		"X-Content-Type-Options": "nosniff",
		...headers
	});
	response.end(JSON.stringify(value));
}

function fail(status, message) {
	const error = new Error(message);
	error.status = status;
	return error;
}

async function readJson(request) {
	let body = "";
	for await (const chunk of request) {
		body += chunk;
		if (Buffer.byteLength(body) > MAX_BODY_BYTES) throw fail(413, "Request is too large.");
	}
	if (!body) return {};
	try { return JSON.parse(body); }
	catch { throw fail(400, "Request body must be valid JSON."); }
}

function cookieValue(request, name) {
	const header = request.headers.cookie || "";
	const entry = header.split(";").map(value => value.trim()).find(value => value.startsWith(`${name}=`));
	return entry ? decodeURIComponent(entry.slice(name.length + 1)) : "";
}

function isLocalRequest(request) {
	const address = (request.socket.remoteAddress || "").replace(/^::ffff:/, "");
	return address === "127.0.0.1" || address === "::1";
}

function today() {
	const now = new Date();
	return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function isCalendarDate(value) {
	if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
	const date = new Date(`${value}T00:00:00Z`);
	return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function isClockTime(value) {
	if (typeof value !== "string" || !/^\d{2}:\d{2}$/.test(value)) return false;
	const [hour, minute] = value.split(":").map(Number);
	return hour < 24 && minute < 60;
}

function minutes(time) {
	const [hour, minute] = time.split(":").map(Number);
	return hour * 60 + minute;
}

function durationFor(services, catalog = SERVICES) {
	return services.reduce((total, service) => total + catalog[service].duration, 0);
}

function publicUser(user) {
	return { id: user.id, name: user.name, email: user.email, role: user.role, barberId: user.barberId };
}

function createServer(options = {}) {
	const dataFile = options.dataFile || process.env.BOOKINGS_DATA_FILE || path.join(__dirname, "data.json");
	const inviteCode = options.barberInviteCode ?? process.env.BARBER_INVITE_CODE;
	const ownerSetupCode = options.ownerSetupCode ?? process.env.OWNER_SETUP_CODE;
	const { store, save } = createStore(dataFile);
	const loginAttempts = new Map();
	let ownerBootstrapPending = false;

	function getSession(request) {
		const token = cookieValue(request, "goodcut_session");
		if (!token) return null;
		const tokenHash = crypto.createHash("sha256").update(token).digest("hex");
		const session = store.sessions.find(item => item.tokenHash === tokenHash && item.expiresAt > Date.now());
		if (!session) return null;
		return store.users.find(user => user.id === session.userId) || null;
	}

	function requireUser(user, role) {
		if (!user) throw fail(401, "Sign in to continue.");
		if (user.role === "barber" && store.barbers.find(barber => barber.id === user.barberId)?.active === false) throw fail(403, "This barber account has been deactivated.");
		if (role && user.role !== role) throw fail(403, "You do not have permission to do that.");
	}

	function findBarber(id, includeInactive = false) {
		const barber = store.barbers.find(item => item.id === id);
		if (!barber || (!includeInactive && barber.active === false)) throw fail(404, "Barber not found.");
		return barber;
	}

	function ratingFor(barberId) {
		const reviews = store.reviews.filter(review => review.barberId === barberId);
		return {
			average: reviews.length ? Math.round(reviews.reduce((sum, review) => sum + review.rating, 0) / reviews.length * 10) / 10 : null,
			count: reviews.length
		};
	}

	function publicBooking(booking) {
		const barber = store.barbers.find(item => item.id === booking.barberId);
		const { userId, email, phone, ...publicFields } = booking;
		return { ...publicFields, barberName: barber?.name || "Barber" };
	}

	function publicReview(review) {
		const barber = store.barbers.find(item => item.id === review.barberId);
		return { name: review.name, barberId: review.barberId, barberName: barber?.name || "Barber", rating: review.rating, text: review.text, createdAt: review.createdAt };
	}

	function availabilityFor(barberId, date) {
		return store.availability[barberId]?.[date] || "free";
	}

	async function notifyBooking(booking, event) {
		const barberAccount = store.users.find(account => account.role === "barber" && account.barberId === booking.barberId);
		const barber = findBarber(booking.barberId, true);
		const detail = `${booking.services.join(", ")} with ${barber.name} on ${booking.date} at ${booking.time}.`;
		const text = `${event}. ${detail} Total: ${booking.total} ${store.settings.currency}.`;
		let delivered = false;
		const emails = [...new Set([booking.email, barberAccount?.email].filter(Boolean))];
		if (process.env.RESEND_API_KEY && process.env.EMAIL_FROM) {
			for (const email of emails) {
				try {
					const response = await fetch("https://api.resend.com/emails", {
						method: "POST",
						headers: { Authorization: `Bearer ${process.env.RESEND_API_KEY}`, "Content-Type": "application/json" },
						body: JSON.stringify({ from: process.env.EMAIL_FROM, to: [email], subject: `The Good Cut · ${event}`, text }),
						signal: AbortSignal.timeout(8000)
					});
					if (!response.ok) throw new Error(`Email provider returned ${response.status}`);
					delivered = true;
				} catch (error) { console.error("Email notification failed:", error.message); }
			}
		}
		const twilioSid = process.env.TWILIO_ACCOUNT_SID;
		const twilioToken = process.env.TWILIO_AUTH_TOKEN;
		const twilioFrom = process.env.TWILIO_FROM_NUMBER;
		const phones = [...new Set([booking.phone, barberAccount?.phone].filter(Boolean))];
		if (phones.length && twilioSid && twilioToken && twilioFrom) {
			for (const phone of phones) {
				try {
					const credentials = Buffer.from(`${twilioSid}:${twilioToken}`).toString("base64");
					const response = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${encodeURIComponent(twilioSid)}/Messages.json`, {
						method: "POST",
						headers: { Authorization: `Basic ${credentials}`, "Content-Type": "application/x-www-form-urlencoded" },
						body: new URLSearchParams({ From: twilioFrom, To: phone, Body: text }),
						signal: AbortSignal.timeout(8000)
					});
					if (!response.ok) throw new Error(`SMS provider returned ${response.status}`);
					delivered = true;
				} catch (error) { console.error("SMS notification failed:", error.message); }
			}
		}
		return delivered;
	}

	async function sendUpcomingReminders() {
		const now = Date.now();
		for (const booking of store.bookings) {
			if (booking.status === "cancelled" || booking.status === "completed" || store.remindersSent.includes(booking.id)) continue;
			const appointmentTime = new Date(`${booking.date}T${booking.time}:00`).getTime();
			const hoursUntil = (appointmentTime - now) / (60 * 60 * 1000);
			if (hoursUntil <= 0 || hoursUntil > 24) continue;
			const delivered = await notifyBooking(booking, "Appointment reminder");
			if (delivered) {
				store.remindersSent.push(booking.id);
				save();
			}
		}
	}

	function availableSlots(barberId, date, duration, ignoreBookingId = "") {
		findBarber(barberId);
		if (!isCalendarDate(date) || date < today()) return [];
		if (!Number.isInteger(duration) || duration < 1 || duration > 300) throw fail(400, "Invalid service duration.");
		if (availabilityFor(barberId, date) === "booked") return [];
		const opening = minutes(store.settings.openingTime);
		const closing = minutes(store.settings.closingTime);
		const appointments = store.bookings.filter(booking => booking.id !== ignoreBookingId && booking.barberId === barberId && booking.date === date && booking.status !== "cancelled");
		const result = [];
		for (let start = opening; start + duration <= closing; start += 30) {
			const time = `${String(Math.floor(start / 60)).padStart(2, "0")}:${String(start % 60).padStart(2, "0")}`;
			const end = start + duration;
			const overlaps = appointments.some(booking => start < minutes(booking.time) + booking.duration && minutes(booking.time) < end);
			const hasPassed = date === today() && start <= minutes(new Date().toTimeString().slice(0, 5));
			if (!overlaps && !hasPassed) result.push(time);
		}
		return result;
	}

	async function routeApi(request, response, url) {
		const user = getSession(request);
		const { pathname, searchParams } = url;

		if (request.method === "GET" && pathname === "/api/config") {
			const barbers = store.barbers.filter(barber => barber.active !== false).map(barber => ({ ...barber, ...ratingFor(barber.id), status: availabilityFor(barber.id, today()), profileAvailable: !store.users.some(user => user.barberId === barber.id) }));
			return sendJson(response, 200, { barbers, services: store.services, currency: store.settings.currency, settings: store.settings, notifications: { email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) }, payments: { cash: true, mobileMoney: false } });
		}
		if (request.method === "GET" && pathname === "/api/session") {
			return sendJson(response, 200, { user: user ? publicUser(user) : null });
		}
		if (request.method === "GET" && pathname === "/api/owner/setup-status") {
			const available = !store.users.some(account => account.role === "owner") && (Boolean(ownerSetupCode) || isLocalRequest(request));
			return sendJson(response, 200, { available, codeRequired: Boolean(ownerSetupCode) });
		}
		if (request.method === "POST" && pathname === "/api/owner/bootstrap") {
			if (ownerBootstrapPending || store.users.some(account => account.role === "owner")) throw fail(409, "The owner account has already been created.");
			const body = await readJson(request);
			if (ownerSetupCode && body.setupCode !== ownerSetupCode) throw fail(403, "The owner setup code is incorrect.");
			if (!ownerSetupCode && !isLocalRequest(request)) throw fail(403, "Owner registration without a setup code is only available on the shop server itself.");
			const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
			const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
			const password = typeof body.password === "string" ? body.password : "";
			if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "Enter a valid name and email address.");
			if (password.length < 12 || password.length > 128) throw fail(400, "Use a password between 12 and 128 characters.");
			if (store.users.some(account => account.email === email)) throw fail(409, "An account with that email already exists.");
			ownerBootstrapPending = true;
			const salt = crypto.randomBytes(16).toString("hex");
			let passwordHash;
			try { passwordHash = (await scrypt(password, salt, 64)).toString("hex"); }
			catch (error) { ownerBootstrapPending = false; throw error; }
			const owner = { id: crypto.randomUUID(), name, email, passwordHash, salt, role: "owner", barberId: null, createdAt: new Date().toISOString() };
			store.users.push(owner);
			const token = crypto.randomBytes(32).toString("base64url");
			store.sessions.push({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId: owner.id, expiresAt: Date.now() + SESSION_TTL });
			save();
			ownerBootstrapPending = false;
			const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
			return sendJson(response, 201, { user: publicUser(owner) }, { "Set-Cookie": `goodcut_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
		}
		if (request.method === "GET" && pathname === "/api/owner/data") {
			requireUser(user, "owner");
			const barbers = store.barbers.map(barber => ({ ...barber, ...ratingFor(barber.id), profileAvailable: !store.users.some(account => account.barberId === barber.id) }));
			const bookings = store.bookings.map(booking => ({ ...publicBooking(booking), clientEmail: booking.email, clientPhone: booking.phone || "" }));
			const notifications = { email: Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM), sms: Boolean(process.env.TWILIO_ACCOUNT_SID && process.env.TWILIO_AUTH_TOKEN && process.env.TWILIO_FROM_NUMBER) };
			return sendJson(response, 200, { barbers, services: store.services, settings: store.settings, notifications, bookings: bookings.sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)) });
		}
		if (request.method === "POST" && pathname === "/api/owner/barbers") {
			requireUser(user, "owner");
			const body = await readJson(request);
			const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
			const specialty = typeof body.specialty === "string" ? body.specialty.trim().slice(0, 80) : "";
			if (name.length < 2 || specialty.length < 2) throw fail(400, "Enter a barber name and specialty.");
			const barber = { id: `barber-${crypto.randomBytes(6).toString("hex")}`, name, specialty, active: true };
			store.barbers.push(barber);
			save();
			return sendJson(response, 201, { barber });
		}
		const ownerBarberMatch = pathname.match(/^\/api\/owner\/barbers\/([a-z0-9-]+)$/);
		if (ownerBarberMatch && request.method === "PATCH") {
			requireUser(user, "owner");
			const barber = findBarber(ownerBarberMatch[1], true);
			const body = await readJson(request);
			if (typeof body.name === "string") {
				if (body.name.trim().length < 2) throw fail(400, "Barber name must contain at least 2 characters.");
				barber.name = body.name.trim().slice(0, 80);
			}
			if (typeof body.specialty === "string") {
				if (body.specialty.trim().length < 2) throw fail(400, "Specialty must contain at least 2 characters.");
				barber.specialty = body.specialty.trim().slice(0, 80);
			}
			if (typeof body.active === "boolean") barber.active = body.active;
			if (barber.active === false) {
				const barberAccount = store.users.find(account => account.role === "barber" && account.barberId === barber.id);
				if (barberAccount) store.sessions = store.sessions.filter(session => session.userId !== barberAccount.id);
			}
			save();
			return sendJson(response, 200, { barber });
		}
		if (request.method === "PUT" && pathname === "/api/owner/services") {
			requireUser(user, "owner");
			const body = await readJson(request);
			if (!body.services || typeof body.services !== "object" || Array.isArray(body.services)) throw fail(400, "Provide a service catalog.");
			const entries = Object.entries(body.services);
			if (!entries.length || entries.length > 30) throw fail(400, "Keep between 1 and 30 services.");
			const services = {};
			for (const [name, details] of entries) {
				const label = name.trim().slice(0, 60);
				if (label.length < 2 || !Number.isInteger(details.price) || details.price < 0 || details.price > 100000 || !Number.isInteger(details.duration) || details.duration < 5 || details.duration > 300) throw fail(400, "Each service needs a name, a valid price, and a 5–300 minute duration.");
				services[label] = { price: details.price, duration: details.duration };
			}
			store.services = services;
			save();
			return sendJson(response, 200, { services: store.services });
		}
		if (request.method === "PUT" && pathname === "/api/owner/settings") {
			requireUser(user, "owner");
			const body = await readJson(request);
			if (!isClockTime(body.openingTime) || !isClockTime(body.closingTime) || minutes(body.closingTime) <= minutes(body.openingTime)) throw fail(400, "Enter valid opening and closing times.");
			if (!Number.isInteger(body.cancellationHours) || body.cancellationHours < 0 || body.cancellationHours > 168) throw fail(400, "Cancellation notice must be between 0 and 168 hours.");
			if (typeof body.currency !== "string" || !/^[A-Z]{3}$/.test(body.currency)) throw fail(400, "Use a three-letter currency code.");
			try { new Intl.NumberFormat(undefined, { style: "currency", currency: body.currency }).format(0); }
			catch { throw fail(400, "That currency code is not supported."); }
			store.settings = { openingTime: body.openingTime, closingTime: body.closingTime, cancellationHours: body.cancellationHours, currency: body.currency };
			save();
			return sendJson(response, 200, { settings: store.settings });
		}
		if (request.method === "GET" && pathname === "/api/reviews") {
			const reviews = store.reviews.filter(review => !searchParams.has("barberId") || review.barberId === searchParams.get("barberId"));
			return sendJson(response, 200, { reviews: reviews.slice(-20).reverse().map(publicReview) });
		}
		if (request.method === "GET" && pathname === "/api/slots") {
			return sendJson(response, 200, { slots: availableSlots(searchParams.get("barberId"), searchParams.get("date"), Number(searchParams.get("duration")), searchParams.get("excludeBookingId") || "") });
		}
		const availabilityMatch = pathname.match(/^\/api\/barbers\/([a-z0-9-]+)\/availability$/);
		if (availabilityMatch && request.method === "GET") {
			findBarber(availabilityMatch[1]);
			const date = searchParams.get("date");
			if (!isCalendarDate(date)) throw fail(400, "Choose a valid date.");
			return sendJson(response, 200, { status: availabilityFor(availabilityMatch[1], date) });
		}
		if (request.method === "GET" && pathname === "/api/bookings") {
			requireUser(user);
			const bookings = user.role === "barber"
				? store.bookings.filter(booking => booking.barberId === user.barberId)
				: store.bookings.filter(booking => booking.userId === user.id);
			return sendJson(response, 200, { bookings: bookings.map(publicBooking).sort((a, b) => `${a.date}${a.time}`.localeCompare(`${b.date}${b.time}`)) });
		}

		if (request.method === "POST" && pathname === "/api/auth/signup") {
			const body = await readJson(request);
			const name = typeof body.name === "string" ? body.name.trim().slice(0, 80) : "";
			const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
			const password = typeof body.password === "string" ? body.password : "";
			const phone = body.smsOptIn === true && typeof body.phone === "string" ? body.phone.trim().slice(0, 24) : "";
			const role = body.role === "barber" ? "barber" : "client";
			if (name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw fail(400, "Enter a valid name and email address.");
			if (password.length < 12 || password.length > 128) throw fail(400, "Use a password between 12 and 128 characters.");
			if (phone && !/^[+0-9()\-\s]{7,24}$/.test(phone)) throw fail(400, "Enter a valid phone number, including country code for SMS.");
			if (store.users.some(account => account.email === email)) throw fail(409, "An account with that email already exists.");
			let barberId = null;
			if (role === "barber") {
				if (!inviteCode || body.inviteCode !== inviteCode) throw fail(403, "A valid barber invite code is required.");
				barberId = body.barberId;
				findBarber(barberId);
				if (store.users.some(account => account.barberId === barberId)) throw fail(409, "That barber profile already has an account.");
			}
			const salt = crypto.randomBytes(16).toString("hex");
			const passwordHash = (await scrypt(password, salt, 64)).toString("hex");
			const newUser = { id: crypto.randomUUID(), name, email, phone: phone || null, passwordHash, salt, role, barberId, createdAt: new Date().toISOString() };
			store.users.push(newUser);
			const token = crypto.randomBytes(32).toString("base64url");
			store.sessions.push({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId: newUser.id, expiresAt: Date.now() + SESSION_TTL });
			save();
			const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
			return sendJson(response, 201, { user: publicUser(newUser) }, { "Set-Cookie": `goodcut_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
		}

		if (request.method === "POST" && pathname === "/api/auth/login") {
			const address = request.socket.remoteAddress || "unknown";
			const recentAttempts = (loginAttempts.get(address) || []).filter(attempt => attempt > Date.now() - 15 * 60 * 1000);
			if (recentAttempts.length >= 10) throw fail(429, "Too many sign-in attempts. Please wait and try again.");
			const body = await readJson(request);
			const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
			const password = typeof body.password === "string" ? body.password : "";
			const account = store.users.find(item => item.email === email);
			const salt = account?.salt || "00000000000000000000000000000000";
			const candidate = await scrypt(password, salt, 64);
			const expected = Buffer.from(account?.passwordHash || "00".repeat(64), "hex");
			if (!account || !crypto.timingSafeEqual(candidate, expected)) {
				recentAttempts.push(Date.now());
				loginAttempts.set(address, recentAttempts);
				throw fail(401, "Email or password is incorrect.");
			}
			if (account.role === "barber" && store.barbers.find(barber => barber.id === account.barberId)?.active === false) throw fail(403, "This barber account has been deactivated.");
			loginAttempts.delete(address);
			const token = crypto.randomBytes(32).toString("base64url");
			store.sessions = store.sessions.filter(item => item.expiresAt > Date.now());
			store.sessions.push({ tokenHash: crypto.createHash("sha256").update(token).digest("hex"), userId: account.id, expiresAt: Date.now() + SESSION_TTL });
			save();
			const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
			return sendJson(response, 200, { user: publicUser(account) }, { "Set-Cookie": `goodcut_session=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${SESSION_TTL / 1000}${secure}` });
		}

		if (request.method === "POST" && pathname === "/api/auth/logout") {
			if (user) {
				const token = cookieValue(request, "goodcut_session");
				const hash = crypto.createHash("sha256").update(token).digest("hex");
				store.sessions = store.sessions.filter(item => item.tokenHash !== hash);
				save();
			}
			return sendJson(response, 200, { user: null }, { "Set-Cookie": "goodcut_session=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0" });
		}

		if (availabilityMatch && request.method === "PUT") {
			requireUser(user, "barber");
			if (user.barberId !== availabilityMatch[1]) throw fail(403, "You can only update your own availability.");
			const body = await readJson(request);
			if (!isCalendarDate(body.date) || body.date < today()) throw fail(400, "Choose today or a future date.");
			if (!store.availability[user.barberId]) store.availability[user.barberId] = {};
			if (body.status === "booked") store.availability[user.barberId][body.date] = "booked";
			else if (body.status === "free") delete store.availability[user.barberId][body.date];
			else throw fail(400, "Availability must be free or booked.");
			save();
			return sendJson(response, 200, { status: availabilityFor(user.barberId, body.date) });
		}

		if (request.method === "POST" && pathname === "/api/bookings") {
			requireUser(user, "client");
			const body = await readJson(request);
			const barber = findBarber(body.barberId);
			const services = Array.isArray(body.services) ? [...new Set(body.services)] : [];
			if (!services.length || services.some(service => !Object.hasOwn(store.services, service))) throw fail(400, "Choose at least one valid service.");
			if (!isCalendarDate(body.date) || body.date < today()) throw fail(400, "Choose today or a future date.");
			if (!/^\d{2}:\d{2}$/.test(body.time)) throw fail(400, "Choose an available time.");
			if (!availableSlots(barber.id, body.date, durationFor(services, store.services)).includes(body.time)) throw fail(409, "That time is no longer available. Choose another slot.");
			if (!["Cash", "Mobile money"].includes(body.payment)) throw fail(400, "Choose cash or mobile money.");
			const booking = {
				id: crypto.randomUUID(), userId: user.id, name: user.name, email: user.email,
				phone: user.phone || null,
				barberId: barber.id, services, date: body.date, time: body.time,
				duration: durationFor(services, store.services), total: services.reduce((sum, service) => sum + store.services[service].price, 0),
				payment: body.payment, paymentStatus: "due", status: "requested", createdAt: new Date().toISOString()
			};
			store.bookings.push(booking);
			save();
			void notifyBooking(booking, "Booking requested");
			return sendJson(response, 201, { booking: publicBooking(booking) });
		}

		const bookingMatch = pathname.match(/^\/api\/bookings\/([0-9a-f-]+)$/i);
		if (bookingMatch && request.method === "PATCH") {
			requireUser(user);
			const booking = store.bookings.find(item => item.id === bookingMatch[1]);
			if (!booking) throw fail(404, "Booking not found.");
			const isClientOwner = user.role === "client" && booking.userId === user.id;
			const isAssignedBarber = user.role === "barber" && booking.barberId === user.barberId;
			const isOwner = user.role === "owner";
			if (!isClientOwner && !isAssignedBarber && !isOwner) throw fail(403, "You do not have permission to change this booking.");
			const body = await readJson(request);
			if (body.action === "cancel") {
				if (booking.status === "completed" || booking.status === "cancelled") throw fail(409, "This booking can no longer be cancelled.");
				if (isClientOwner) {
					const hoursUntilAppointment = (new Date(`${booking.date}T${booking.time}:00`).getTime() - Date.now()) / (60 * 60 * 1000);
					if (hoursUntilAppointment <= 0 || hoursUntilAppointment < store.settings.cancellationHours) throw fail(409, `Bookings must be cancelled at least ${store.settings.cancellationHours} hours ahead.`);
				}
				booking.status = "cancelled";
			} else if (body.action === "reschedule" && (isClientOwner || isOwner)) {
				if (booking.status !== "requested" && booking.status !== "confirmed") throw fail(409, "This booking can no longer be rescheduled.");
				if (isClientOwner) {
					const hoursUntilAppointment = (new Date(`${booking.date}T${booking.time}:00`).getTime() - Date.now()) / (60 * 60 * 1000);
					if (hoursUntilAppointment <= 0 || hoursUntilAppointment < store.settings.cancellationHours) throw fail(409, `Changes must be made at least ${store.settings.cancellationHours} hours ahead.`);
				}
				if (!isCalendarDate(body.date) || body.date < today() || !/^\d{2}:\d{2}$/.test(body.time)) throw fail(400, "Choose a valid future date and time.");
				if (!availableSlots(booking.barberId, body.date, booking.duration, booking.id).includes(body.time)) throw fail(409, "That time is no longer available. Choose another slot.");
				booking.date = body.date;
				booking.time = body.time;
			} else if (body.action === "complete" && (isAssignedBarber || isOwner)) {
				if (booking.status !== "confirmed") throw fail(409, "Confirm the booking before marking the visit complete.");
				booking.status = "completed";
			} else if (body.action === "confirm" && (isAssignedBarber || isOwner)) {
				if (booking.status !== "requested") throw fail(409, "Only requested bookings can be confirmed.");
				booking.status = "confirmed";
			} else {
				throw fail(400, "That booking action is not allowed.");
			}
			booking.updatedAt = new Date().toISOString();
			save();
			if (body.action === "cancel" || body.action === "reschedule" || body.action === "confirm" || body.action === "complete") void notifyBooking(booking, `Booking ${booking.status}`);
			return sendJson(response, 200, { booking: publicBooking(booking) });
		}

		if (request.method === "POST" && pathname === "/api/reviews") {
			requireUser(user, "client");
			const body = await readJson(request);
			const booking = store.bookings.find(item => item.id === body.bookingId && item.userId === user.id);
			if (!booking || booking.status !== "completed") throw fail(403, "Reviews are available after a completed visit.");
			if (store.reviews.some(review => review.bookingId === booking.id)) throw fail(409, "You have already reviewed this visit.");
			const rating = Number(body.rating);
			if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw fail(400, "Choose a rating from 1 to 5.");
			const review = { id: crypto.randomUUID(), bookingId: booking.id, userId: user.id, name: user.name, barberId: booking.barberId, rating, text: typeof body.text === "string" ? body.text.trim().slice(0, 240) : "", createdAt: new Date().toISOString() };
			store.reviews.push(review);
			save();
			return sendJson(response, 201, { review: publicReview(review), rating: ratingFor(review.barberId) });
		}

		return sendJson(response, 404, { error: "API endpoint not found." });
	}

	const server = http.createServer(async (request, response) => {
		response.setHeader("X-Content-Type-Options", "nosniff");
		response.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
		response.setHeader("X-Frame-Options", "DENY");
		response.setHeader("Content-Security-Policy", "default-src 'self'; img-src 'self' https://images.unsplash.com data:; style-src 'self' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; script-src 'self'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'");
		try {
			const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
			if (url.pathname.startsWith("/api/")) return await routeApi(request, response, url);
			if (request.method !== "GET" && request.method !== "HEAD") return sendJson(response, 405, { error: "Method not allowed." });
			const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
			const assetPath = path.resolve(ROOT, `.${pathname}`);
			if (!assetPath.startsWith(`${ROOT}${path.sep}`) || pathname.split("/").some(part => part.startsWith(".")) || pathname.endsWith("data.json")) return sendJson(response, 404, { error: "Not found." });
			const contentTypes = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg", ".webp": "image/webp" };
			const contentType = contentTypes[path.extname(assetPath)];
			if (!contentType) return sendJson(response, 404, { error: "Not found." });
			const content = await fs.promises.readFile(assetPath);
			response.writeHead(200, { "Content-Type": contentType, "Cache-Control": "no-cache" });
			response.end(request.method === "HEAD" ? undefined : content);
		} catch (error) {
			if (response.headersSent) return response.end();
			const status = Number.isInteger(error.status) ? error.status : 500;
			if (status === 500) console.error(error);
			sendJson(response, status, { error: status === 500 ? "Something went wrong. Please try again." : error.message });
		}
	});
	const reminderTimer = setInterval(() => { void sendUpcomingReminders(); }, 15 * 60 * 1000);
	reminderTimer.unref();
	server.on("close", () => clearInterval(reminderTimer));
	return server;
}

if (require.main === module) {
	const port = Number(process.env.PORT || 4173);
	createServer().listen(port, () => console.log(`The Good Cut is running at http://localhost:${port}/bookings/index.html`));
}

module.exports = { createServer };