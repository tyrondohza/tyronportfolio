const $ = (selector, parent = document) => parent.querySelector(selector);
const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

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

function showMessage(message, isError = false) {
	const node = $("#accessMessage");
	node.textContent = message;
	node.classList.toggle("is-error", isError);
}

function setMode(mode) {
	const isNewHire = mode === "activate";
	$("#barberAccessForm").dataset.mode = mode;
	$("#signInTab").classList.toggle("active", !isNewHire);
	$("#signInTab").setAttribute("aria-selected", String(!isNewHire));
	$("#activateTab").classList.toggle("active", isNewHire);
	$("#activateTab").setAttribute("aria-selected", String(isNewHire));
	$("#nameField").classList.toggle("hidden", !isNewHire);
	$("#phoneField").classList.toggle("hidden", !isNewHire);
	$("#barberPhoneConsent").classList.toggle("hidden", !isNewHire);
	$("#profileField").classList.toggle("hidden", !isNewHire);
	$("#inviteField").classList.toggle("hidden", !isNewHire);
	$("#barberName").required = isNewHire;
	$("#barberProfile").required = isNewHire;
	$("#barberInvite").required = isNewHire;
	$("#barberPassword").autocomplete = isNewHire ? "new-password" : "current-password";
	$("#accessTitle").innerHTML = isNewHire ? "Let’s get you <em>set up.</em>" : "Welcome to your <em>chair.</em>";
	$("#accessIntro").textContent = isNewHire ? "Activate the barber profile reserved for you by the shop." : "Sign in with your barber account to manage your appointments.";
	$("#accessSubmit").innerHTML = `${isNewHire ? "Activate barber account" : "Sign in to barber desk"} <span aria-hidden="true">↗</span>`;
	$("#accessNote").innerHTML = isNewHire
		? 'You’ll need the shop owner’s invite code. <a class="access-inline-link" href="staff-signup.html#employee">Use the staff sign-up page ↗</a>'
		: 'Newly hired? Ask the shop owner for your invite code, then <a class="access-inline-link" href="staff-signup.html#employee">create your employee account ↗</a>.';
	showMessage("");
}

async function loadProfiles() {
	const { barbers } = await api("/api/config");
	$("#barberProfile").innerHTML = '<option value="">Choose your profile</option>' + barbers.map(barber => `<option value="${html(barber.id)}" ${barber.profileAvailable ? "" : "disabled"}>${html(barber.name)} · ${html(barber.profileAvailable ? barber.specialty : "Account already set up")}</option>`).join("");
	if (!barbers.some(barber => barber.profileAvailable)) showMessage("All four barber profiles already have accounts. Contact the shop owner to add a new profile.", true);
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		await loadProfiles();
		const { user } = await api("/api/session");
		if (user?.role === "barber") window.location.replace("barber.html");
	} catch (error) {
		showMessage(`Barber sign-in is unavailable: ${error.message}`, true);
	}

	$("#signInTab").addEventListener("click", () => setMode("signin"));
	$("#activateTab").addEventListener("click", () => setMode("activate"));
	$("#barberAccessForm").addEventListener("submit", async event => {
		event.preventDefault();
		const mode = event.currentTarget.dataset.mode;
		const isNewHire = mode === "activate";
		const body = {
			name: $("#barberName").value.trim(),
			email: $("#barberEmail").value.trim(),
			phone: $("#barberPhone").value.trim(),
			smsOptIn: $("#barberSmsOptIn").checked,
			password: $("#barberPassword").value
		};
		if (isNewHire) {
			body.role = "barber";
			body.barberId = $("#barberProfile").value;
			body.inviteCode = $("#barberInvite").value;
		}
		try {
			const result = await api(isNewHire ? "/api/auth/signup" : "/api/auth/login", { method: "POST", body: JSON.stringify(body) });
			if (result.user.role !== "barber") {
				await api("/api/auth/logout", { method: "POST", body: "{}" });
				throw new Error("That account is for a client. Use a barber account to enter the desk.");
			}
			window.location.assign("barber.html");
		} catch (error) {
			showMessage(error.message, true);
		}
	});
});