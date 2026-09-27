const $ = (selector, parent = document) => parent.querySelector(selector);

const localDate = (date = new Date()) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
const addDays = (value, days) => {
	const date = new Date(`${value}T00:00:00`);
	date.setDate(date.getDate() + days);
	return localDate(date);
};
const REQUESTS_KEY = "alderHouse.stayRequests";
const NOTES_KEY = "alderHouse.guestNotes";
const safeRead = key => {
	try { return JSON.parse(localStorage.getItem(key) || "[]"); }
	catch { return []; }
};
const safeWrite = (key, value) => {
	try { localStorage.setItem(key, JSON.stringify(value)); return true; }
	catch { return false; }
};

const roomGalleries = [
	{
		name: "The Garden Room",
		capacity: 2,
		details: "King bed · Garden view · 2 guests · From $145 per night",
		photos: [
			{ src: "https://images.unsplash.com/photo-1590490360182-c33d57733427?auto=format&fit=crop&w=1500&q=86", alt: "Garden Room king bed with soft daylight" },
			{ src: "https://images.unsplash.com/photo-1611892440504-42a792e24d32?auto=format&fit=crop&w=1500&q=86", alt: "Garden Room sitting area and natural finishes" },
			{ src: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1500&q=86", alt: "Garden Room details and bedside lighting" }
		]
		},
	{
		name: "The Corner Suite",
		capacity: 3,
		details: "King bed · Separate sitting area · 3 guests · From $210 per night",
		photos: [
			{ src: "https://images.unsplash.com/photo-1566665797739-1674de7a421a?auto=format&fit=crop&w=1500&q=86", alt: "Corner Suite with a spacious king bed" },
			{ src: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1500&q=86", alt: "Corner Suite lounge and reading chair" },
			{ src: "https://images.unsplash.com/photo-1582719478250-c89cae4dc85b?auto=format&fit=crop&w=1500&q=86", alt: "Corner Suite room interior" }
		]
		},
	{
		name: "The House Loft",
		capacity: 2,
		details: "King bed · Deep soaking tub · 2 guests · From $185 per night",
		photos: [
			{ src: "https://images.unsplash.com/photo-1618773928121-c32242e63f39?auto=format&fit=crop&w=1500&q=86", alt: "House Loft with a warm modern interior" },
			{ src: "https://images.unsplash.com/photo-1595576508898-0ad5c879a061?auto=format&fit=crop&w=1500&q=86", alt: "House Loft bedroom with layered linens" },
			{ src: "https://images.unsplash.com/photo-1578683010236-d716f9a3f461?auto=format&fit=crop&w=1500&q=86", alt: "House Loft sitting area and window light" }
		]
	}
];

document.addEventListener("DOMContentLoaded", () => {
	const checkIn = $("#checkIn");
	const checkOut = $("#checkOut");
	const form = $("#stayForm");
	const message = $("#staySearchMessage");
	const roomChoice = $("#selectedRoom");
	const roomRate = $("#selectedRoomRate");
	const requestPreview = $("#stayRequestPreview");
	const emailRequest = $("#openGuestDetails");
	const guestDetailsDialog = $("#guestDetailsDialog");
	const gallery = $("#roomGallery");
	let currentGalleryRoom = 0;
	let currentGalleryPhoto = 0;
	let swipeStartX = null;
	checkIn.min = localDate();
	checkIn.value = localDate();
	const roomCapacity = $("#selectedRoomCapacity");
	checkOut.min = addDays(checkIn.value, 1);
	checkOut.value = addDays(checkIn.value, 1);

	function updateRequestPreview() {
		if (!checkIn.value || !checkOut.value || checkOut.value <= checkIn.value) return;
		const nights = Math.round((new Date(`${checkOut.value}T00:00:00`) - new Date(`${checkIn.value}T00:00:00`)) / 86400000);
		const guests = Number($("#guestCount").value);
		const roomName = roomChoice.value;
		const roomNightlyRate = Number(roomRate.value);
		const maxGuests = Number(roomCapacity.value);
		const dateDetails = `${checkIn.value} to ${checkOut.value} · ${nights} ${nights === 1 ? "night" : "nights"} · ${guests} ${guests === 1 ? "guest" : "guests"}`;
		$("#stayRequestTitle").textContent = roomName || "Choose a room to complete your request";
		$("#stayRequestDetails").textContent = dateDetails;
		$("#stayRequestEstimate").textContent = roomName && roomNightlyRate ? `Sample estimate $${roomNightlyRate * nights}` : "Sample rates only";
		const canEmail = Boolean(roomName && roomNightlyRate && guests <= maxGuests);
		emailRequest.disabled = !canEmail;
		requestPreview.hidden = false;
		if (roomName && guests > maxGuests) message.textContent = `${roomName} accommodates up to ${maxGuests} guests. Choose fewer guests or a larger room.`;
	}

	function chooseRoom(name, rate, capacity) {
		roomChoice.value = name;
		roomRate.value = rate;
		roomCapacity.value = capacity;
		document.querySelectorAll("[data-room]").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.room === name)));
		updateRequestPreview();
		message.textContent = Number($("#guestCount").value) > capacity
			? `${name} accommodates up to ${capacity} guests. Choose fewer guests or a larger room.`
			: `${name} selected. Dates and sample estimate are shown below; email to confirm availability and current rates.`;
	}

	function renderGallery() {
		const room = roomGalleries[currentGalleryRoom];
		const photo = room.photos[currentGalleryPhoto];
		$("#galleryTitle").textContent = room.name;
		$("#galleryDescription").textContent = room.details;
		$("#galleryPhoto").src = photo.src;
		$("#galleryPhoto").alt = photo.alt;
		$("#galleryCount").textContent = `${currentGalleryPhoto + 1} / ${room.photos.length}`;
		$("#galleryChooseRoom").dataset.room = room.name;
		$("#galleryChooseRoom").dataset.capacity = String(room.capacity);
		$("#galleryChooseRoom").dataset.rate = String([145, 210, 185][currentGalleryRoom]);
	}

	function showGallery(roomIndex) {
		currentGalleryRoom = roomIndex;
		currentGalleryPhoto = 0;
		renderGallery();
		gallery.showModal();
	}

	function moveGalleryPhoto(direction) {
		const count = roomGalleries[currentGalleryRoom].photos.length;
		currentGalleryPhoto = (currentGalleryPhoto + direction + count) % count;
		renderGallery();
	}

	checkIn.addEventListener("change", () => {
		checkOut.min = addDays(checkIn.value, 1);
		if (checkOut.value <= checkIn.value) checkOut.value = checkOut.min;
		if (roomChoice.value) updateRequestPreview();
	});
	checkOut.addEventListener("change", () => { if (roomChoice.value) updateRequestPreview(); });
	$("#guestCount").addEventListener("change", () => { if (roomChoice.value) updateRequestPreview(); });
	function requestSummary() {
		const nights = Math.round((new Date(`${checkOut.value}T00:00:00`) - new Date(`${checkIn.value}T00:00:00`)) / 86400000);
		return {
			room: roomChoice.value,
			rate: Number(roomRate.value),
			maxGuests: Number(roomCapacity.value),
			checkIn: checkIn.value,
			checkOut: checkOut.value,
			nights,
			guests: Number($("#guestCount").value)
		};
	}

	function showGuestDetails() {
		const stay = requestSummary();
		if (stay.guests > stay.maxGuests) {
			message.textContent = `${stay.room} accommodates up to ${stay.maxGuests} guests. Choose fewer guests or a larger room.`;
			return;
		}
		$("#guestDetailsForm").reset();
		$("#guestDetailsForm").hidden = false;
		$("#guestDetailsConfirmation").hidden = true;
		$("#guestDetailsMessage").textContent = "";
		$("#guestDialogSummary").textContent = `${stay.room} · ${stay.checkIn} to ${stay.checkOut} · ${stay.nights} ${stay.nights === 1 ? "night" : "nights"} · ${stay.guests} ${stay.guests === 1 ? "guest" : "guests"} · sample estimate $${stay.rate * stay.nights}`;
		guestDetailsDialog.showModal();
	}

	function renderRequestResults(email) {
		const results = safeRead(REQUESTS_KEY).filter(request => request.email.toLowerCase() === email.trim().toLowerCase());
		const container = $("#requestLookupResults");
		container.replaceChildren();
		if (!results.length) {
			container.textContent = "No stay requests for that email are saved in this browser.";
			return;
		}
		results.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).forEach(request => {
			const card = document.createElement("article");
			card.className = "request-result-card";
			const heading = document.createElement("strong");
			heading.textContent = `${request.room} · ${request.checkIn} to ${request.checkOut}`;
			const reference = document.createElement("span");
			reference.textContent = `Reference ${request.reference} · ${request.status}`;
			const detail = document.createElement("small");
			detail.textContent = `${request.guests} ${request.guests === 1 ? "guest" : "guests"} · sample estimate $${request.estimate}`;
			card.append(heading, reference, detail);
			container.append(card);
		});
	}

	function renderGuestNotes() {
		const notes = safeRead(NOTES_KEY);
		const container = $("#guestReviewList");
		container.replaceChildren();
		if (!notes.length) {
			const empty = document.createElement("p");
			empty.className = "local-note-empty";
			empty.textContent = "No browser-local guest notes yet.";
			container.append(empty);
			return;
		}
		notes.slice(-3).reverse().forEach(note => {
			const card = document.createElement("article");
			card.className = "local-guest-note";
			const stars = document.createElement("span");
			stars.className = "review-stars";
			stars.textContent = `${"★".repeat(note.rating)}${"☆".repeat(5 - note.rating)} · Browser-local, unverified`;
			const copy = document.createElement("p");
			copy.textContent = `“${note.comment}”`;
			const byline = document.createElement("small");
			byline.textContent = note.name;
			card.append(stars, copy, byline);
			container.append(card);
		});
	}

	emailRequest.addEventListener("click", showGuestDetails);
	$("#guestDetailsClose").addEventListener("click", () => guestDetailsDialog.close());
	guestDetailsDialog.addEventListener("click", event => { if (event.target === guestDetailsDialog) guestDetailsDialog.close(); });
	$("#guestDetailsForm").addEventListener("submit", event => {
		event.preventDefault();
		const stay = requestSummary();
		const guest = {
			name: $("#guestFullName").value.trim(),
			email: $("#guestEmail").value.trim(),
			phone: $("#guestPhone").value.trim(),
			notes: $("#guestNotes").value.trim()
		};
		const reference = `AH-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
		const request = { ...stay, ...guest, reference, status: "Awaiting hotel reply", createdAt: new Date().toISOString(), estimate: stay.rate * stay.nights };
		const requests = safeRead(REQUESTS_KEY);
		requests.push(request);
		if (!safeWrite(REQUESTS_KEY, requests)) {
			$("#guestDetailsMessage").textContent = "This browser cannot save requests. Please email the hotel directly.";
			return;
		}
		const emailBody = `Hello Alder House,\n\nI would like to ask about this stay request.\n\nReference: ${reference}\nGuest: ${guest.name}\nEmail: ${guest.email}\nPhone: ${guest.phone || "Not provided"}\nRoom: ${stay.room}\nCheck in: ${stay.checkIn}\nCheck out: ${stay.checkOut}\nNights: ${stay.nights}\nGuests: ${stay.guests}\nSample estimate: $${request.estimate}\nAdditional notes: ${guest.notes || "None"}\n\nPlease confirm actual availability and rates. This is an inquiry, not a confirmed reservation.\n`;
		const mailto = `mailto:dohzatyron0@gmail.com?${new URLSearchParams({ subject: `Alder House stay request ${reference}`, body: emailBody })}`;
		$("#guestDetailsForm").hidden = true;
		$("#guestDetailsConfirmation").hidden = false;
		$("#guestDetailsConfirmationText").textContent = `Request ${reference} is saved in this browser and is awaiting a reply. Your stay is not confirmed yet.`;
		$("#guestDetailsEmailLink").href = mailto;
		$("#guestDetailsDialogTitle").textContent = "Request saved.";
		renderRequestResults(guest.email);
	});

	$("#requestLookupForm").addEventListener("submit", event => {
		event.preventDefault();
		renderRequestResults($("#lookupEmail").value);
	});

	$("#guestReviewForm").addEventListener("submit", event => {
		event.preventDefault();
		const notes = safeRead(NOTES_KEY);
		notes.push({ name: $("#reviewName").value.trim(), rating: Number($("#reviewRating").value), comment: $("#reviewComment").value.trim(), createdAt: new Date().toISOString() });
		if (!safeWrite(NOTES_KEY, notes)) {
			$("#guestReviewMessage").textContent = "This browser cannot save your note.";
			return;
		}
		event.currentTarget.reset();
		$("#guestReviewMessage").textContent = "Guest note saved in this browser. It is not verified or shared with other visitors.";
		renderGuestNotes();
	});
	renderGuestNotes();

	form.addEventListener("submit", event => {
		event.preventDefault();
		if (checkOut.value <= checkIn.value) {
			message.textContent = "Choose a check-out date after check-in.";
			checkOut.focus();
			return;
		}
		const nights = Math.round((new Date(`${checkOut.value}T00:00:00`) - new Date(`${checkIn.value}T00:00:00`)) / 86400000);
		const guests = Number($("#guestCount").value);
		const room = roomChoice.value ? ` ${roomChoice.value} is selected.` : " Choose a room below to personalize your request.";
		message.textContent = `${nights} ${nights === 1 ? "night" : "nights"} · ${guests} ${guests === 1 ? "guest" : "guests"}.${room} Sample rates only; contact the hotel to confirm availability.`;
		updateRequestPreview();
		$("#rooms").scrollIntoView({ behavior: "smooth" });
	});

	document.querySelectorAll("[data-room]").forEach(button => button.addEventListener("click", () => {
		chooseRoom(button.dataset.room, Number(button.dataset.rate), Number(button.dataset.capacity));
		$("#reserve").scrollIntoView({ behavior: "smooth" });
	}));
	document.querySelectorAll("[data-gallery-room]").forEach(button => button.addEventListener("click", () => showGallery(Number(button.dataset.galleryRoom))));
	$("#galleryPrevious").addEventListener("click", () => moveGalleryPhoto(-1));
	$("#galleryNext").addEventListener("click", () => moveGalleryPhoto(1));
	$("#galleryClose").addEventListener("click", () => gallery.close());
	$("#galleryChooseRoom").addEventListener("click", event => {
		chooseRoom(event.currentTarget.dataset.room, Number(event.currentTarget.dataset.rate), Number(event.currentTarget.dataset.capacity));
		gallery.close();
		$("#reserve").scrollIntoView({ behavior: "smooth" });
	});
	$(".package-choose").addEventListener("click", event => {
		const button = event.currentTarget;
		chooseRoom(button.dataset.packageRoom, Number(button.dataset.packageRate), 2);
		checkIn.value = localDate();
		checkOut.value = addDays(checkIn.value, 2);
		checkOut.min = addDays(checkIn.value, 1);
		updateRequestPreview();
		message.textContent = "The sample Weekend Reset package is selected. Contact the hotel to confirm package details, rates, and availability.";
		$("#reserve").scrollIntoView({ behavior: "smooth" });
	});
	gallery.addEventListener("click", event => { if (event.target === gallery) gallery.close(); });
	const galleryStage = $("#galleryPhotoStage");
	galleryStage.addEventListener("pointerdown", event => { swipeStartX = event.clientX; });
	galleryStage.addEventListener("pointerup", event => {
		if (swipeStartX === null) return;
		const movement = event.clientX - swipeStartX;
		if (Math.abs(movement) > 55) moveGalleryPhoto(movement < 0 ? 1 : -1);
		swipeStartX = null;
	});
	document.addEventListener("keydown", event => {
		if (!gallery.open) return;
		if (event.key === "ArrowLeft") moveGalleryPhoto(-1);
		if (event.key === "ArrowRight") moveGalleryPhoto(1);
	});
});