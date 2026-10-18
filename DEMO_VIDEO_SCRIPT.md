# Recording the demo video (about 100 seconds)

The demo plays itself. `demo/index.html` drives the real prototypes (3D platform, 2D simulator, hardware model) with on-screen captions, so all you do is record the screen.

Live: https://geoeoeo217.github.io/MTR-platform-flow/demo/ (available after you push)

## Steps (Mac)

1. Open the demo link above in Chrome. Close other tabs and turn on Do Not Disturb, so no notifications appear in the recording.
2. Wait until the start screen says **Ready.**
3. Press **⇧⌘5**, choose **Record Entire Screen**, and click **Record**.
4. Click **▶ Play demo**. The page goes full screen and plays for about 100 seconds.
5. When the "Use the space we already have" end card appears, wait 3 seconds, then press the **stop** button in the menu bar (or **⌘⌃Esc**).
6. The video is saved to your Desktop as a `.mov` file.
7. Upload it to YouTube as **Unlisted** (or to Google Drive with "Anyone with the link"), then put the link and a QR code on the prototype slide.

To add your voice, click **Options** in the ⇧⌘5 toolbar and pick your microphone before recording. Read the voiceover below as each caption appears.

## What plays, and an optional voiceover

| Time | Scene | Voiceover (optional) |
|---|---|---|
| 0:00 | Title card | "This is Rail Flow AI, our AI system for spreading passengers along MTR platforms." |
| 0:06 | 3D, inside Tunnel A | "At Admiralty, you can’t see the platform until you leave the tunnel. Our signs show which doors have room before you choose." |
| 0:16 | 3D, no guidance | "Without guidance, everyone queues next to their tunnel. Doors 2A and 3A overflow while the far doors stay empty." |
| 0:29 | 3D, AI lights on | "With our AI lights on, the same crowd spreads across all eight doors." |
| 0:42 | 3D, train arrives | "Purple passengers are getting off. The AI forecasts how many leave each door and learns from every train." |
| 1:00 | 2D side by side | "Same passengers, same trains. In 120 test runs, queue imbalance fell 73% and people left behind fell from over 7,000 an hour to 22." |
| 1:14 | 2D forecast table | "Every light is explainable: predicted load, people getting off, room and queue for each door." |
| 1:23 | Hardware | "We only add four devices: a camera with AI, an edge unit, the corridor sign and door lights." |
| 1:33 | End card | "Use the space we already have. Try it at the link on screen." |

The train scene fast-forwards until the next train arrives, so timings after 0:42 can shift by a few seconds.

To try it before pushing, run this in the Hackathon folder and open http://localhost:8000/demo/:

```bash
python3 -m http.server 8000
```
