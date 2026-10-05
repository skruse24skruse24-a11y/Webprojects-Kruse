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

---

## 8. Full list of available functionalities (reference)

A Twilio IVR is far more than "press 1". Everything below is available to mix into the tree.

### Input — how a caller responds
- **Keypad digits (DTMF)** — `<Gather numDigits="1">`, the classic "press 1".
- **Speech recognition** — `<Gather input="speech">`: the caller can *say* "membership"
  instead of pressing a key. Supports `hints`, `language`, and tunable `speechModel`.
- **Both at once** — `<Gather input="dtmf speech">` accepts a press OR a spoken word.

### Output — what the caller hears
- **`<Say>`** — text-to-speech. Supports many languages and higher-quality **neural voices**
  (e.g. `voice="Polly.Joanna-Generative"` or a Google Chirp voice) so it's not robotic.
  `loop` repeats it.
- **`<Play>`** — play your own recorded MP3/WAV prompt (see section 5).

### Recording the caller (see section 9 for the deep dive)
- **`<Record>`** — capture a prompted reply (voicemail style), optional transcription.
- **`<Start><Recording>`** — record the whole call in the background while the menu continues.

### Routing / connecting
- **`<Dial>`** — connect the caller to a real phone number, a SIP address, or a browser/app
  client. Features: call **screening** and **whisper** messages, **simulring** (ring several
  numbers), sequential hunt, and recording both legs on separate channels (`record="record-from-answer-dual"`).
- **`<Enqueue>` / `<Queue>` / `<Leave>`** — put callers in a hold queue with wait music and
  position announcements.
- **`<Conference>`** — multi-party calls.
- **Flow control** — `<Hangup>`, `<Reject>` (decline without being billed), `<Pause>`,
  `<Redirect>` (jump to another TwiML document).

### Advanced / AI
- **`<Connect>`** — stream the call's audio in real time to AI: natural-language **virtual
  agents** (ConversationRelay / Dialogflow) so callers can just talk, or raw media **streams**
  (websockets) for live transcription / custom AI.
- **`<Pay>`** — PCI-compliant payment collection (Stripe, Braintree, CardConnect). Card data
  routes directly to the processor and never touches your server.

### Around the call
- **SMS follow-up** — text the caller a link/summary after they choose an option (requires
  A2P 10DLC registration).
- **Caller data** — your webhook receives the caller's number, city/state, etc., so you can
  route by area code or time of day. Business-hours logic lives in your webhook.
- **Recordings & Transcription REST API**, **Studio** visual flow builder, and **Functions**
  (serverless hosting) are all available.

---

## 9. Recording the caller's voice (deep dive)

Two mechanisms, and the difference matters if you want recording in **most branches**:

| | `<Record>` | `<Start><Recording>` |
|---|---|---|
| Records | The caller's prompted reply | The whole call's audio |
| Blocking? | **Yes** — pauses the menu until they finish / hang up / press a key | **No** — the menu keeps going |
| Channels | **Mono only** | Mono or **dual** (each party on its own channel) |
| Best for | "Leave a message after the beep" branches | Logging / compliance across the whole call |
| Transcription | `transcribe="true"` + `transcribeCallback` (clip ~2–120s) | via recording/transcription configs |

### `<Record>` example (a "leave a message" branch)
```xml
<Response>
  <Say>Leave your confession after the beep. Press pound when finished.</Say>
  <Record
    action="/after-recording"
    recordingStatusCallback="/save-recording"
    maxLength="60"
    finishOnKey="#"
    playBeep="true"
    transcribe="true"
    transcribeCallback="/save-transcript" />
  <Say>We did not receive a recording. Goodbye.</Say>
</Response>
```
When the recording is ready, Twilio POSTs to `recordingStatusCallback` with `RecordingUrl`,
`RecordingDuration`, etc. The transcription (if enabled) arrives separately at
`transcribeCallback`.

### `<Start><Recording>` example (record the whole call, keep going)
```xml
<Response>
  <Start>
    <Recording channels="dual" recordingStatusCallback="/save-recording" />
  </Start>
  <Say>This call may be recorded.</Say>
  <Gather numDigits="1" action="/menu"><Say>Press 1 for gatherings...</Say></Gather>
</Response>
```

### Important caveats
- **Consent / legal:** many jurisdictions require two-party consent. Announce "this call may
  be recorded" and keep `playBeep="true"`. This is a legal requirement, not optional polish.
- **Cost (small, but real):** recording ~$0.0025/min, storage ~$0.0005/min per month,
  transcription ~$0.05/min. Fine at hobby scale; just know "record everything" isn't free.

### Design pattern: recording in most branches
Extend the menu tree with a new node type (alongside "menu" and "leaf") — call it a **record
node**. Shape:

```js
confession: {
  type: "record",
  prompt: "Share your confession after the beep.", // spoken by <Say> or played via <Play>
  maxLength: 60,        // seconds
  transcribe: true,     // ask Twilio for a text transcript
  action: "/save",      // webhook that stores RecordingUrl / transcript
  confirm: "Your confession is received. Blessings."
}
```
Your TwiML generator then renders a record node as: `<Say>` (prompt) → `<Record>` (with beep +
callbacks) → `<Say>` (confirm). Because the tree stays data-driven, you can sprinkle record
nodes across as many branches as you like without changing the engine — just add nodes with
`type: "record"`.

---

## 10. `<Dial>` (call forwarding) and `<Queue>` / `<Enqueue>` explained

### `<Dial>` — forwarding a call to another number
Yes — you can forward a caller to any real phone. `<Dial>` bridges the current caller to a new
party and keeps both on the line until someone hangs up.

```xml
<Response>
  <Say>Connecting you to the high priest. Please hold.</Say>
  <Dial callerId="+15551112222">+15558675310</Dial>
</Response>
```

Key points:
- The forwarded party answers and the two are connected; when they hang up, the call ends
  (or continues to `<Dial>`'s `action` URL if you set one).
- **Caller ID:** by default the person you forward to sees the *original caller's* number. Set
  `callerId` to a number you own to override what they see.
- **The original caller must stay on the line** the whole time — forwarding bridges them, it
  doesn't hand off and release.
- **Nouns you can dial** (nest inside `<Dial>`):
  - `<Number>` — a phone number (you can list up to **10** to ring them all at once;
    first to answer wins — "simulring"). Each `<Number>` can have a `url` that plays a
    "whisper"/screening message to the *answering* party before connecting.
  - `<Sip>` — a SIP address. `<Client>` — a browser/app user. `<Conference>` — a room.
    `<Queue>` — connect to a waiting caller (see below).
- **Sequential forwarding** ("find me / follow me"): give `<Dial>` an `action` URL; after the
  first attempt ends/fails, Twilio requests it and you return the next `<Dial>` to try the next
  number in turn.
- **Recording the bridged call:** `<Dial record="record-from-answer-dual">` records both legs
  on separate channels, with a `recordingStatusCallback`.

> Note: forwarding to a real phone adds the normal outbound per-minute cost for that leg on top
> of the inbound call. (You said leaves won't be real phone calls — so `<Dial>` is optional and
> mostly relevant if you ever want a "press 0 to reach a human" branch.)

### `<Enqueue>` + `<Queue>` — how call queues actually work
A queue is a two-sided mechanism:

1. **Put a caller on hold** with `<Enqueue>` (names the queue; FIFO — first in, first out):
   ```xml
   <Response>
     <Enqueue waitUrl="/wait">believers</Enqueue>
   </Response>
   ```
   While waiting, the caller hears whatever the **`waitUrl`** returns — an MP3/WAV, or a TwiML
   document. When that document runs out of verbs, Twilio **re-requests `waitUrl`**, which is
   what loops the hold music indefinitely. If you omit `waitUrl`, Twilio plays a default
   classical hold playlist.

2. **Connect an agent to the first waiting caller** from a *separate* call, by dialing the
   queue by name:
   ```xml
   <Response>
     <Dial><Queue url="about-to-connect.xml">believers</Queue></Dial>
   </Response>
   ```
   `<Queue>` pulls the first enqueued caller out and bridges them. Its optional `url` plays a
   message to the waiting caller right before they're connected ("you're being connected...").

**Announcing position / wait time:** each time Twilio requests your `waitUrl`, it includes
parameters you can read and speak back:
- `QueuePosition` — the caller's current spot in line.
- `CurrentQueueSize` — how many callers are waiting.
- `QueueTime` — seconds this caller has waited; `AvgQueueTime` — average wait.
- `QueueSid`, `MaxQueueSize`.

So a real position announcement looks like:
```xml
<Response>
  <Say>You are number {{QueuePosition}} in line. Please continue to hold.</Say>
  <Play>https://your-host.example.com/hold.mp3</Play>
</Response>
```

**The catch:** a real `<Queue>` only moves callers forward when *something dequeues them* —
i.e. a human agent (or TaskRouter) dialing the queue. With no agents, callers sit there
forever, and `QueuePosition`/`CurrentQueueSize` reflect *reality* (usually "you are number 1"),
which ruins any illusion of a crowd.

### Faking a large queue — yes, use a recorded message (don't use a real queue)
If the goal is theatrical ("you are caller number 47, estimated wait 25 minutes...") and no
real agent is ever going to pick up, a **real queue is the wrong tool** — it would just report
the true (tiny) numbers and strand the caller. Instead, fake it with a plain menu node:

```xml
<Response>
  <Say voice="Polly.Joanna">
    Thank you for your patience. You are currently number 47 in the queue.
    Your estimated wait time is 25 minutes.
  </Say>
  <Play>https://your-host.example.com/hold.mp3</Play>   <!-- hold music / ambience -->
  <Redirect>/next</Redirect>   <!-- then move them on to the real destination -->
</Response>
```

Why the recorded/`<Say>` approach is better here:
- **Full control of the illusion** — you pick the number ("47"), the wait time, and the vibe;
  nothing has to be true.
- **No agent required** — a real queue needs a dequeuer; this doesn't.
- **Cheaper and simpler** — no queue resource, no second "agent" call, just TwiML + audio.
- **You can randomize** — have your webhook inject a random/escalating position each call for
  flavor (e.g. "number 47" one call, "number 112" the next).

Use a **real** `<Enqueue>`/`<Queue>` only if you genuinely intend to connect callers to a live
person. For a scripted "everyone is very busy, please hold" effect, a recorded message +
`<Play>` hold audio is the right, cheap choice.
