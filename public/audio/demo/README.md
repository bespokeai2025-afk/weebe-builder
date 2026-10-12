# Demo call recordings

Drop MP3s here and the node demo on the landing page plays them instead of
the browser speech voice. No code change needed: `callAudio.ts` checks for
each file and falls back to browser speech per line if one is missing.

The current files were generated with Cartesia (model sonic-2) on 2026-10-09
by `node scripts/gen-demo-voice.mjs`: Ava = "Jacqueline - Reassuring Agent",
caller = "Carson - Curious Conversationalist". Edit the lines or voice IDs in
that script and re-run it to regenerate. The page only plays these files; it
never calls a voice provider at runtime.

| File | Speaker | Line |
|---|---|---|
| `turn-1.mp3` | agent | Good afternoon, Harborview Dental — this is Ava. How can I help? |
| `turn-2.mp3` | caller | Hi — I'd like to book a consultation. |
| `turn-3.mp3` | agent | Of course. Have you visited us before? |
| `turn-4.mp3` | caller | No, first time. I'm looking at implants. |
| `turn-5.mp3` | agent | Perfect. I have Thursday at 2:30, or Friday morning. |
| `turn-6.mp3` | caller | Thursday at 2:30 works. |
| `turn-7.mp3` | agent | Booked. I've texted you the details — see you Thursday. |
