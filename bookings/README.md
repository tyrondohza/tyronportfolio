# The Good Cut

The site is a small Node.js application with a server-rendered static frontend and a JSON API. It has no external runtime dependencies. Use Node.js 20 or newer.

## Run locally

From the project root in PowerShell:

```powershell
$env:BARBER_INVITE_CODE = "choose-a-private-invite-code"
$env:SHOP_CURRENCY = "USD"
node bookings/server.js
```

Open `http://localhost:4173/bookings/index.html`. Client accounts can sign up on the site. Barber accounts require the invite code above and an available profile. Use passwords of at least 12 characters.

Barbers manage appointments at `http://localhost:4173/bookings/barber.html`. Requested bookings can be confirmed, then marked complete after the visit; completed appointments appear in the Completed tab.

Newly hired barbers can sign in or activate their reserved profile at `http://localhost:4173/bookings/barber-access.html`. Account activation requires the owner’s invite code; each profile can only be claimed once.

The combined staff sign-up page is `http://localhost:4173/bookings/staff-signup.html`. Choose Employee to activate an available barber profile with the invite code, or Shop owner to create the single owner account. On localhost, owner registration needs no setup code, is limited to a local connection, and closes after the first account is created. Owners can add barber profiles from the dashboard. If the owner account has already been created, owner registration is disabled; existing owners use the owner sign-in page.

The shop owner opens `http://localhost:4173/bookings/owner.html`. On the first run, create the owner account with `OWNER_SETUP_CODE`; this setup closes after the first account is created. The owner can manage bookings, barber profiles, service names/prices, opening hours, cancellation notice, and currency. Deactivate a barber profile rather than deleting it to preserve appointment history.

The server writes accounts, hashed passwords, sessions, bookings, availability, and reviews to `bookings/data.json`. That private file is excluded from Git. Back it up securely; it contains personal account and appointment information.

## Tests

```powershell
node --test bookings/server.test.js
```

## Email and SMS reminders

Transactional email uses Resend when both `RESEND_API_KEY` and `EMAIL_FROM` are set. SMS uses Twilio when `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, and `TWILIO_FROM_NUMBER` are set. Customers and barbers must opt in before their mobile number is stored for texts. Booking updates are sent when configured; reminders are checked every 15 minutes for appointments within 24 hours. Configure credentials in the host's secret manager, not in source files.

Barbers can download their bookings to an `.ics` calendar file from the barber dashboard. It imports into common calendar applications; it does not sync changes back from Google Calendar.

## Payments and deployment

Cash bookings are recorded as due at the shop. A mobile-money choice can be saved with a booking, but the prototype does not charge a customer or confirm a transfer. A real payment flow needs a supported payment provider, merchant account, and country-specific credentials; add secrets through the hosting provider's secret manager, never to this repository.

For a public deployment, set `NODE_ENV=production`, `BARBER_INVITE_CODE`, `OWNER_SETUP_CODE`, and an ISO `SHOP_CURRENCY` code in the host's environment settings. A setup code is required for remote first-owner registration; without it, owner setup is accepted only from a loopback connection. Use HTTPS and a host with a persistent disk mounted for the data file. This JSON store is intended for one Node server process; multiple instances need a shared database before launch.

The repository includes a `Dockerfile` for a single-instance container deployment. From the project root, build and run it with a persistent volume:

```powershell
docker build -f bookings/Dockerfile -t the-good-cut .
docker volume create the-good-cut-data
docker run --name the-good-cut -p 4173:4173 -v the-good-cut-data:/data -e BARBER_INVITE_CODE="replace-this" -e OWNER_SETUP_CODE="replace-this-too" -e SHOP_CURRENCY="USD" the-good-cut
```

Add email/SMS credentials with `-e` or, preferably, the host's secret manager. To deploy publicly, create a hosting account, attach persistent storage, configure a domain and HTTPS, then provide the shop's payment country and provider before enabling mobile-money charging. The current code records the customer's mobile-money choice but intentionally does not claim a payment was made.