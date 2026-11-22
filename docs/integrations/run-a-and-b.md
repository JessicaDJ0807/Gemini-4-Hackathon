# Run A + B together and test shopping

Run commands from the repository root (the folder containing the top-level `package.json`). This guide is for B's web app at **http://127.0.0.1:3000**, backed by A's Python service on port 8001.

## Why you might see mock pictures

| What you run | Wardrobe pictures | Outfit planner |
| --- | --- | --- |
| `npm run dev` with empty `AI_BASE_URL` and `AI_SERVICE_TOKEN` | Nine SVG garment illustrations | Local mock |
| `npm run dev:full` with A and B combined | Ten checked-in JPEG wardrobe reference photos (`wd-01`–`wd-10`) | A's Gemini service |
| `npm run dev:shop-test` | Demo illustrations | Mock planner + simulated shopping/payment, port 3002 |

Setting `GEMINI_API_KEY` alone does **not** turn `npm run dev` into live outfit generation. The key also powers B's photo-to-style analysis, which runs independently. This is why style analysis can work while the wardrobe still looks like a mock.

A's **generated outfit/scene pictures** are a separate feature from its wardrobe photos. B currently shows the selected wardrobe photos in each daily look; it does not call A's `/v1/outfit-previews` endpoint yet. Starting live mode does not enable those generated preview images. The separately merged `apps/roamfit-tryon` studio also has its own app and setup; starting it is not the same as starting this A+B flow.

## 1. Use a checkout with both teams' changes

This B cleanup requires A's native `StyleProfile.directions`, `userTags` and `summary` support from **PR #5**, branch `feature/inspiration-weather-directions`. As checked on November 21, 2026, PR #5 is still open. B's new cleanup/chat changes are currently local on `product-integrations` and must be shared before teammates can pull them.

Once both changes are merged, use the latest `main`. Before then, test them together in a separate worktree **after B has pushed this update**:

```sh
git fetch origin
git worktree add -b test/a-b-local ../Gemini-4-Hackathon-ab-test origin/product-integrations
cd ../Gemini-4-Hackathon-ab-test
git merge --no-commit --no-ff origin/feature/inspiration-weather-directions
```

This is a local integration checkout; do not push it to either teammate's branch. If Git reports a conflict, resolve it before testing. If PR #5 is already merged into your base, no extra merge is needed. A worktree has its own local `.env` and Python environment; they are not copied by Git.

The live launcher now reads A's API schema. An older A service causes a clear startup error instead of silently dropping nested style edits. The cleanup intentionally removes B's former duplicate JSON-in-`preferences` bridge.

## 2. Set up Node, Python and the root `.env`

Use Node.js 22.9+ and Python 3.11+ (tested locally with Python 3.14). B has no Node package dependencies.

```sh
node --version
python3 --version
python3 -m venv services/ai/.venv
services/ai/.venv/bin/python -m pip install -r services/ai/requirements.txt
```

Only if you do not already have `.env`, copy the example:

```sh
cp -n .env.example .env
```

Edit `.env` beside the root `package.json`:

```dotenv
GEMINI_API_KEY=YOUR_OWN_GEMINI_KEY
GEMINI_MODEL=gemini-4-hydrogen
OUTFIT_MODEL=gemini-4-hydrogen
PORT=3000
AI_PORT=8001
PUBLIC_APP_URL=http://127.0.0.1:3000
AI_BASE_URL=
AI_SERVICE_TOKEN=
```

Use a model available to your hackathon project if its approved model ID differs. `dev:full` sets `AI_BASE_URL` internally and generates a shared service token when none is configured; you do not need to copy a token between services. Never commit `.env` or send your key in screenshots. Windows users should use WSL for this launcher because it uses `.venv/bin/python`.

## 3. Start the combined app

Stop previous development servers with **Ctrl+C**, then:

```sh
npm run dev:full
```

Wait for A to start and for B to print:

```text
Style onboarding: http://127.0.0.1:3000 (live mode)
```

Open that exact address and use it consistently. `localhost` and `127.0.0.1` have separate browser storage and Shop sessions. Keep this terminal running; Ctrl+C stops both processes.

Use photo inspiration or a manual style tag, confirm a destination and 1–7 trip dates, then continue to the wardrobe. You should see **ten photographic garments** and **Sample wardrobe · Styled with AI**. Generate outfits to call A.

A downloads wardrobe photos from B. If you change `PORT`, change `PUBLIC_APP_URL` to the same port. The launcher allows `127.0.0.1,localhost` as media hosts. A running on a different machine needs a B URL reachable from that machine and the matching hostname in A's `MEDIA_ALLOWED_HOSTS`.

## 4. Verify the actual mode and photo delivery

These read-only checks do not expose your key:

```sh
curl -s http://127.0.0.1:3000/api/config
curl -s http://127.0.0.1:8001/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3000/wardrobe-photos/wd-01.jpg
```

Expected: `provider` is `live`; A health is `ok`; the photo GET returns `200`. `/api/wardrobe` should contain ten `wd-*` items with `.jpg` image URLs. In browser DevTools → Network, `/api/outfit-plans` should return `wardrobeImagesUsed` with selected wardrobe IDs. Image-fetch warnings mean A may have reasoned from text only, even if B displayed the photos successfully.

A real request can take up to two minutes. A timeout, unavailable model or invalid response shows an error; B never silently substitutes mock outfits in live mode. Retry only after checking the message and model/key configuration.

## 5. Test the chatbot payment flow without spending money

Run the automated suite:

```sh
npm test
```

Payment tests mock all Shop calls. They cover session/origin isolation, device sign-in and polling, exact signed variants, saved-address copying, delivery selection, refreshed totals, user-selected payment methods, double-click protection, uncertain payment outcomes and confirmed orders. No real Shop account or card is used.

To click through the UI yourself, open a separate terminal:

```sh
npm run dev:shop-test
```

Open **http://127.0.0.1:3002**. The onboarding page identifies payment-test mode and hides photo uploads. Use a manual tag to continue. The shopping panel must say **PAYMENT TEST · Simulated data · No charges**. This launcher injects fake Shop and Gemini responses and does not load `.env`. It is a local fixture app, not Shopify's sandbox and not evidence that a merchant will accept a live payment.

1. Add a manual style tag, confirm a trip, and reach the wardrobe. Use Paris and a date more than 15 days away to avoid a forecast request.
2. Uncheck both demo shoe items and generate outfits. Under **Complete the look**, click **Shop this piece**. Products appear on the page. The test server returns a fixed shirt fixture for any query; select **Size: M** and **Add to bag**.
3. Open **Bag → Review checkout → Connect Shop**. Simulated approval takes five seconds; do not enter real credentials.
4. Checkout opens after approval. Select the demo saved address and **Standard delivery**.
5. Review all totals and notices. Choose **Shop Pay** explicitly; payment is disabled until you do.
6. Click **Simulate paying USD 81.00 with Shop Pay** for one shirt. The panel should show **Order confirmed**, `TEST-ORDER-NO-CHARGE`, and the simulation notice. The purchased bag empties.

## 6. What is still needed for a real Shop Pay test

Use the normal live app at port 3000, not the test app. Generate your outfits, then use **Shop this piece** under a missing item. Choose an available variant from the product cards on the page, add it to the bag, and open **Bag & checkout**. **Connect Shop** opens Shop's official approval page; return to the panel after approval. Choose a saved address, delivery option and the payment method the merchant actually offers.

The app displays the merchant's final total, notices and legal links before its explicit **Pay [amount] with Shop Pay** control. That button places a real order. Only the shopper should authorize a real purchase. Adding or changing a card happens on Shop, not by typing card data into chat.

In-panel payment is available only when the merchant returns `ready_for_complete` and a Shop Pay instrument. A merchant may require verification on its own checkout page; the panel explains this and provides the original store link without automatically opening it. After an unclear outcome, use **Refresh payment status**; do not start a replacement purchase. Only a merchant `completed` result with an order confirms success.

This local prototype uses Shop's documented public device-flow client. A distributed app needs its own registered Shop OAuth app with `personal_agent` access, a persistent protected session store and deployment hardening. Tokens and private checkout/payment records currently live only in server memory. Restarting the server ends Shop sessions; do not restart while a payment is pending. Disconnect removes this local session; remove/revoke the connection through Shop to revoke access there.

Live Shop authorization, shipping/tax recalculation and an actual merchant purchase remain user-run validation steps. See [Shop authentication](https://shop.dev/docs/authentication), [sign-in](https://shop.dev/docs/sign-in) and [checkout](https://shop.dev/docs/checkout).

## Verification for this change

- B: 87 automated tests passed, including mocked Shop Pay scenarios.
- A PR #5: 37 offline checks passed in an isolated combined checkout.
- Combined live launch: `/api/config` reported `live`, ten JPEG wardrobe items loaded, and a real Gemini request returned HTTP 200 with all three selected wardrobe image IDs in `wardrobeImagesUsed`.
- Browser: simulated checkout passed through saved address, delivery, explicit Shop Pay choice and a confirmed test order. The revised UI keeps product search and variants on the page; the corner panel contains only Bag and Checkout.
- Live chatbot search: Gemini produced the query and Shop returned five real products (HTTP 200); no checkout was created.
- No real Shop account authorization or merchant charge was performed. A real payment remains unverified.

## Troubleshooting

| Symptom | Check |
| --- | --- |
| SVG garments or “Demo · mock outfits” | Wrong launcher, old process, or port 3002. Stop it and run `npm run dev:full` on the combined checkout. |
| Photo-style analysis works, but outfits are mocked | A Gemini key enables B's style adapter independently. Use `dev:full` for A's planner. |
| “A is missing native nested StyleProfile support” | Include PR #5 and restart A; main alone does not yet contain it. |
| Port already in use | Stop the earlier terminal process, or choose unused `PORT`/`AI_PORT` and match `PUBLIC_APP_URL`. |
| JPEGs show in B, but `wardrobeImagesUsed` is empty | Check A can fetch B's absolute image URLs and `MEDIA_ALLOWED_HOSTS`. |
| Expecting a generated model/scene photo | B's daily-look UI currently displays garment references. A's generated-preview endpoint is not wired to it yet. |
| Incomplete dates or invalid AI output | Keep B's validation; report the response to A. PR #5 still has the previously reported date-coverage issue. |
| “Product selection has expired” | Search again and re-add the variant; signed offers last 30 minutes and expire on restart. |
| Shop session unavailable after restart | Reconnect only when no purchase is pending. If a payment was submitted, check Shop/store status before starting again. |
