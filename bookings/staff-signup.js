const $ = (selector, parent = document) => parent.querySelector(selector);
const html = value => String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);

const state = { mode: "employee", setupAvailable: false, setupCodeRequired: false, profiles: [] };

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

function showMessage(text, error = false) {
	const node = $("#signupMessage");
	node.textContent = text;
	node.classList.toggle("is-error", error);
}

function setMode(mode) {
	state.mode = mode;
	const isOwner = mode === "owner";
	$("#staffSignupForm").dataset.mode = mode;
	$("#employeeTab").classList.toggle("active", !isOwner);
	$("#employeeTab").setAttribute("aria-selected", String(!isOwner));
	$("#ownerTab").classList.toggle("active", isOwner);
	$("#ownerTab").setAttribute("aria-selected", String(isOwner));
	$("#signupPhoneField").classList.toggle("hidden", isOwner);
	$("#signupSmsConsent").classList.toggle("hidden", isOwner);
	$("#signupProfileField").classList.toggle("hidden", isOwner);
	$("#signupInviteField").classList.toggle("hidden", isOwner);
	$("#signupOwnerCodeField").classList.toggle("hidden", !isOwner || !state.setupCodeRequired);
	$("#signupPhone").required = false;
	$("#signupSmsOptIn").checked = false;
	$("#signupProfile").required = !isOwner;
	$("#signupInvite").required = !isOwner;
	$("#signupOwnerCode").required = isOwner && state.setupCodeRequired;
	$("#signupSubmit").disabled = !isOwner && !state.profiles.some(profile => profile.profileAvailable);
	$("#signupTitle").innerHTML = isOwner ? "Set up the <em>shop.</em>" : "Create your <em>account.</em>";
	$("#signupIntro").textContent = isOwner
		? "Create the one shop owner account. Registration closes once it has been created."
		: "Activate the barber profile reserved for you by the shop.";
	$("#signupSubmit").innerHTML = `${isOwner ? "Create owner account" : "Create employee account"} <span aria-hidden="true">↗</span>`;
	$("#signupNote").textContent = isOwner
		? state.setupCodeRequired ? "Enter the one-time setup code configured on the shop server." : "Owner registration is available on the shop server only and closes after the first owner account is created."
		: "Employees need the shop owner's invite code. Each barber profile can only be claimed once.";
	showMessage("");
}

function renderProfiles() {
	const available = state.profiles.filter(profile => profile.profileAvailable);
	$("#signupProfile").innerHTML = '<option value="">Choose your barber profile</option>' + available.map(profile => `<option value="${html(profile.id)}">${html(profile.name)} · ${html(profile.specialty)}</option>`).join("");
	$("#employeeTab").disabled = available.length === 0;
	if (!available.length) {
		$("#signupIntro").textContent = "All existing barber profiles already have accounts. Ask the owner to add a profile for you.";
		$("#signupSubmit").disabled = true;
	}
}

document.addEventListener("DOMContentLoaded", async () => {
	try {
		const [setup, config, session] = await Promise.all([api("/api/owner/setup-status"), api("/api/config"), api("/api/session")]);
		state.setupAvailable = setup.available;
		state.setupCodeRequired = setup.codeRequired;
		state.profiles = config.barbers;
		renderProfiles();
		setMode("employee");
		if (session.user?.role === "owner") window.location.replace("owner.html");
		if (session.user?.role === "barber") window.location.replace("barber.html");
		$("#ownerTab").disabled = !state.setupAvailable;
		if (!state.setupAvailable) $("#ownerTab").title = "Owner registration has already been completed.";
		if (window.location.hash === "#owner" && state.setupAvailable) setMode("owner");
	} catch (error) {
		showMessage(`Staff registration is unavailable: ${error.message}`, true);
		$("#signupSubmit").disabled = true;
	}

	$("#employeeTab").addEventListener("click", () => setMode("employee"));
	$("#ownerTab").addEventListener("click", () => {
		if (!state.setupAvailable) {
			showMessage("The owner account has already been set up. Use the owner sign-in page.", true);
			return;
		}
		setMode("owner");
	});
	$("#staffSignupForm").addEventListener("submit", async event => {
		event.preventDefault();
		const ownerSignup = event.currentTarget.dataset.mode === "owner";
		const body = {
			name: $("#signupName").value.trim(),
			email: $("#signupEmail").value.trim(),
			password: $("#signupPassword").value
		};
		if (ownerSignup) {
			if (state.setupCodeRequired) body.setupCode = $("#signupOwnerCode").value;
		} else {
			body.role = "barber";
			body.barberId = $("#signupProfile").value;
			body.inviteCode = $("#signupInvite").value;
			body.phone = $("#signupPhone").value.trim();
			body.smsOptIn = $("#signupSmsOptIn").checked;
		}
		try {
			const result = await api(ownerSignup ? "/api/owner/bootstrap" : "/api/auth/signup", { method: "POST", body: JSON.stringify(body) });
			if (ownerSignup && result.user.role !== "owner") throw new Error("Owner account setup did not complete.");
			window.location.assign(ownerSignup ? "owner.html" : "barber.html");
		} catch (error) {
			if (ownerSignup && error.message.includes("already been created")) {
				state.setupAvailable = false;
				$("#ownerTab").disabled = true;
			}
			showMessage(error.message, true);
		}
	});
});