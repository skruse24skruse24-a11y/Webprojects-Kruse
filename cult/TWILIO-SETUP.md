# Cult IVR — Twilio Setup & Reference Notes

Notes for turning the browser menu preview (`cult.html` + `app.js`) into a **real
phone number people can call** and navigate with their keypad ("press 1 for...").

These notes are provider-agnostic at heart, but written against **Twilio** because it is
the easiest starting point. Telnyx and SignalWire are cheaper drop-in alternatives (see
the bottom of this file).

---

## 1. How a real IVR works (the mental model)

Three pieces, only two of which cost money:

1. **A phone number (DID)** people dial — a small monthly rental.
2. **Inbound minutes** — a per-minute charge while a caller is on the line.
3. **The "menu brain"** — a webhook (small serverless function) that returns instructions
   telling Twilio what to say and what to listen for. This is effectively **free** at hobby
   volume (Twilio Functions includes 10,000 invocations/month free).

You do NOT run a phone server or manage audio streams. On each call / keypress, Twilio
sends an HTTP request to your webhook, and your webhook returns a tiny bit of XML called
**TwiML** describing the response.

---

## 2. The two TwiML verbs that make the menu

- `<Say>` — built-in **text-to-speech**. This is how a menu "ends in a text": the leaf
  message is simply read aloud. No recording required, no extra cost.
- `<Gather>` — collects keypad input (DTMF). When the caller presses a digit, Twilio
  POSTs it back to your webhook as a `Digits` parameter, and you return the next node.

Minimal example of the welcome menu:

```xml
<Response>
  <Gather numDigits="1" action="/menu" method="POST">
    <Say>Welcome to the Order of the Open Source.
         Press 1 for gathering times. Press 2 for membership.
         Press 3 to hear the sacred text.</Say>
  </Gather>
  <!-- If no key is pressed, loop back to the start. -->
  <Redirect>/voice</Redirect>
</Response>
```

Then the `/menu` endpoint reads `Digits` and returns the next node's TwiML (another
`<Gather>` for a sub-menu, or a `<Say>` for a leaf message).

The key idea: **the exact same JSON tree in `app.js` can drive this.** Keep the tree as
data; have one small function that converts a node into either a `<Gather><Say>...` (menu)
or a `<Say>` (leaf). That keeps the logic portable between providers.

---

## 3. Step-by-step setup (Twilio)

1. **Create a Twilio account.** Free trial includes ~$15 credit — enough to buy a number
   and test without spending real money.
2. **Buy a phone number.** Console → Phone Numbers → Buy a number. Pick a *local* number
   (cheapest). Make sure it has the **Voice** capability.
3. **Write the menu brain as a Twilio Function** (serverless, free tier):
   - Console → Functions & Assets → create a Service.
   - Add a Function (e.g. `/voice`) that returns the welcome TwiML, and `/menu` that reads
     `event.Digits` and returns the next node.
   - Example handler:
     ```js
     exports.handler = (context, event, callback) => {
       const twiml = new Twilio.twiml.VoiceResponse();
       const gather = twiml.gather({ numDigits: 1, action: '/menu', method: 'POST' });
       gather.say('Press 1 for gathering times. Press 2 for membership.');
       twiml.redirect('/voice'); // reprompt if nothing pressed
       return callback(null, twiml);
     };
     ```
4. **Point the number at your Function.** Phone number settings → "A call comes in" →
   choose your Function (`/voice`). Save.
5. **Call the number from a real phone and test.** Adjust the tree and redeploy.

> Alternative to Functions: **Twilio Studio** is a drag-and-drop flow builder (1,000 flow
> executions/month free). Good if you prefer clicking over code. Either works.

> You can also host the webhook yourself (e.g. a Vercel serverless function like the one
> already in this repo's `/api/send.js`). Twilio just needs a public URL that returns TwiML.

---

## 4. Rough cost (US, as of 2026)

- **Local number:** ~$1.15 / month.
- **Inbound minutes:** ~$0.0085 / min (a 90-second menu call ≈ $0.01).
- **Menu logic (Functions):** 10,000 invocations/month free.

For a low-traffic feature, expect **~$1–2/month** plus pennies in call minutes. The number
rental dominates the bill.

---

## 5. Can I record my own voice for the IVR? (YES)

Three distinct things people mean by "record voice" — don't confuse them:

### A. Play your OWN recorded prompts instead of robot TTS  ✅ what you likely want
Instead of `<Say>` (text-to-speech), use **`<Play>`** with the URL of an audio file you
recorded yourself:

```xml
<Response>
  <Gather numDigits="1" action="/menu">
    <Play>https://your-host.example.com/prompts/welcome.mp3</Play>
  </Gather>
</Response>
```

- Record the prompts however you like (phone, laptop, Audacity, a studio booth).
- Export as **MP3 or WAV** (8kHz mono is plenty for phone audio).
- Host the files anywhere public — including **Twilio Assets** (upload under Functions &
  Assets), an S3 bucket, or even this repo's static hosting.
- You can freely **mix** `<Play>` (recorded) and `<Say>` (TTS) in the same menu.

This is the normal way to get a human-voiced, "produced" sounding IVR.

### B. Premium / custom text-to-speech voices
If you want it spoken but nicer than the default robot voice, `<Say>` supports better
voices (e.g. Amazon Polly / Google voices) via the `voice` attribute — no recording needed,
small or no extra cost depending on the voice.

### C. Record the CALLER'S voice (voicemail / leave-a-message)
Different feature: the **`<Record>`** verb records what the *caller* says and gives you an
audio file + optional transcription afterward. Use this if a menu branch should let callers
leave a message (e.g. "press 0 to leave an offering... after the tone"). Recording and
transcription have their own small per-minute fees.

**Summary:** Yes — record your own prompts and play them with `<Play>` (option A). Use
`<Record>` only if you also want to capture the caller's voice.

---

## 6. Cheaper drop-in alternatives (optional, for later)

All three below are pay-as-you-go. Telnyx and SignalWire are **TwiML-compatible**, so the
same menu code ports over with minimal changes if cost ever matters at scale.

| Provider   | Local number /mo | Inbound /min | TwiML-compatible? |
|------------|------------------|--------------|-------------------|
| Twilio     | ~$1.15           | ~$0.0085     | native            |
| Telnyx     | ~$1.00           | ~$0.0052     | yes (TeXML)       |
| SignalWire | ~$0.50           | ~$0.0066     | yes (Compat SDK)  |

Recommendation: **build on Twilio first** (best docs + free tier), keep the menu tree as
provider-agnostic JSON, and only migrate if volume makes per-minute cost significant.

---

## 7. Gotchas to remember

- **Keep menus short** — you pay per minute and long robotic menus annoy callers.
- **Number registration/compliance** — some US numbers require identity/address info;
  toll-free numbers need verification. Voice-only is light; adding **SMS** triggers A2P
  10DLC registration (extra setup + small fees).
- **Reprompt on no input** — always include a `<Redirect>` after `<Gather>` so a caller who
  presses nothing hears the menu again instead of silence.
- **Secrets stay server-side** — never put Twilio auth tokens in client-side code.
