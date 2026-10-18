# Admiralty Platform Flow

**AI-Assisted Predictive Passenger Distribution System for MTR Stations**: hackathon prototype.

At rush hour, passengers bunch up at the platform doors closest to the tunnel they came out of, while other doors still have room. This system puts green, amber and red lights in the access tunnels and above each platform door. An AI model predicts how much room each door will have on the next train and steers passengers there **before** they pick a queue.

## Live prototype

Start here: **https://geoeoeo217.github.io/MTR-platform-flow/**

| What | Public link | File |
|---|---|---|
| **Live AI system**: input → counts → capacity → door recommendation → lights and announcement | https://geoeoeo217.github.io/MTR-platform-flow/live/ | `live/` |
| 2D simulator: side-by-side comparison with live scores | https://geoeoeo217.github.io/MTR-platform-flow/platform-flow/ | `platform-flow/index.html` |
| 3D platform: tunnels, door lights, passengers arriving and getting off | https://geoeoeo217.github.io/MTR-platform-flow/platform-flow/3d.html | `platform-flow/3d.html` |
| Demo reel: self-playing video demo with captions | https://geoeoeo217.github.io/MTR-platform-flow/demo/ | `demo/index.html` |
| Prototype proof: results, charts, screenshots | https://geoeoeo217.github.io/MTR-platform-flow/proof/ | `proof/index.html` |
| Hardware concept in 3D (4 devices) | https://geoeoeo217.github.io/MTR-platform-flow/hardware-3d.html | `hardware-3d.html` |

Each file runs offline in any browser: double-click it, or use VS Code's Live Server. The 3D pages need internet access to load Three.js.

## The live AI system (`live/`)

The simulations show the idea; `live/` is the working system, running in the browser. Press **▶ Run demo** and it runs the whole workflow, each step using the previous step's output:

| Step | What happens | Where the numbers come from |
|---|---|---|
| 1. Input | Webcam, an uploaded video or photo, the **Virtual CCTV** (simulated 3D video), a **demo scenario** (simulated counts) or **manual entry** | The badge on the input card always says which, and whether the data is real, simulated or typed |
| 2. Counts | People queuing at each door, and people on board each car | Camera inputs: COCO-SSD person detection (TensorFlow.js), with confidence per door. Scenarios and manual entry: the numbers shown, editable. On board: a car camera area, the entered numbers, or a clearly labelled simulated train-load feed |
| 3. Capacity | room = car capacity − on board + forecast getting off | The table shows the working for every door, e.g. `6 − 3 + 0` |
| 4. Recommendation | The green door with the most spare space (room − queue); amber if no door is green; “all doors full” if none | The card explains why, and which doors to avoid |
| 5. Guidance | Tunnel sign, door lights, and an optional GenAI announcement in English, 繁體中文 and 简体中文 | The sign uses rule-based text unless a GenAI announcement for the current lights exists; the badge says which |

**Checks and labels.** Low detection confidence, a door with no counting area, on-board numbers above capacity (capped), invalid typed numbers (ignored and outlined), disagreement between the camera AI and Claude, and “no people detected” all raise a visible flag on the recommendation. GenAI output always says which model wrote it and turns “out of date” when the lights change.

**Two scenarios** (simulated data): A, a morning rush with the crowd by the stairs at 1A–2A, and B, an evening with full middle cars and the crowd at 3A–4A. The recommendation switches from 4A to 1A. The **before/after** panel estimates the effect if a set share of people (default 60%, in Settings › Advanced) follow the lights. It is an estimate under that assumption, not a measurement.

**Forecast of people getting off.** A transparent baseline: the share of riders who got off at each door for the same weekday and 15-minute slot, averaged over the latest 2 weeks of history (4 weeks of sample data standing in for MTR records). When an exit line on a real camera counts people getting off, that train is added and today’s correction updates. Counts from the virtual CCTV are kept for the session only. Nothing else is trained.

**GenAI.** Optional, chosen in Settings: Ollama (free, local), Claude (your own API key, used only from your browser) or off. With Claude, a frame count can back up the detector in dense crowds; a small local model’s count is shown for comparison only. Without GenAI, everything except the announcement still works.

**Backup.** The previous version of the live system is kept unchanged in `archive/live-v1/` (online at `/archive/live-v1/`), and tagged `v1-backup` in git.

### Using Ollama (free)

1. Install Ollama from https://ollama.com and open the app.
2. Download the small vision model once (about 1.9 GB, runs on 8 GB RAM):

   ```bash
   ollama pull qwen3-vl:2b-instruct
   ```

3. Run the page from your own computer, so it can talk to Ollama. In the project folder:

   ```bash
   python3 -m http.server 8000
   ```

   Then open http://localhost:8000/live/, open **Settings**, and pick **Ollama**.

To use Ollama from the GitHub Pages link instead, allow that site and restart the Ollama app:

```bash
launchctl setenv OLLAMA_ORIGINS "https://geoeoeo217.github.io"
```

Files: `live/js/vision.js` (camera AI), `live/js/virtualcam.js` (virtual CCTV), `live/js/genai.js` (Claude), `live/js/forecast.js`, `live/js/decision.js`, `live/js/app.js`; sample history in `live/data/history-sample.csv` (regenerate with `python3 live/tools/make_sample_history.py`).

## Results (Monday 09:00 rush, 60% of passengers follow the lights)

| Metric | Without guidance | With AI | Change |
|---|---|---|---|
| Queue imbalance (coefficient of variation) | 1.12 | 0.30 | −73% |
| Longest door queue | 189 | 41 | −78% |
| People left behind per hour | 7,309 | 22 | −99.7% |
| Average wait | 131 s | 71 s | −45% |
| Alighting forecast error (passengers/car) | 5.6 (historical avg) | 3.8 (AI) | −32% |

Averages over 5 seeds × 60 simulated minutes. All 120 runs are listed in `proof/results.csv`. Averages per scenario and compliance level are in `proof/summary.csv`.

Reproduce them on macOS with no installs:

```bash
python3 proof/run_benchmark.py
```

The script pulls the exact model code out of `platform-flow/index.html`, so the benchmark and the demo cannot drift apart.

## Hardware

Only 4 new devices are needed. Everything else comes from systems MTR already runs.

| We build | Job | Hackathon prototype |
|---|---|---|
| CCTV camera + AI | Counts people queuing at each door and people getting off | Webcam + YOLO person detection |
| Edge AI unit | Runs the forecast and picks the light colours | Laptop (or Raspberry Pi 5) |
| Corridor sign | Shows which doors have room, before the platform | ESP32 + WS2812B LED strip |
| Door indicator light | Green, amber or red above each platform door | Same ESP32 + a short LED strip |

| Reused from MTR | Used for |
|---|---|
| Train load-weighing sensors (already used for braking) | Load per car of the approaching train |
| Existing platform CCTV | Can replace our camera |
| Load change before and after the doors open, plus gate data | Building the historical alighting table |

## How it works

1. **Collect**: queue count per door (CCTV), load per car of the approaching train (car load sensors), and historical alighting by station, day and hour.
2. **Predict**: alighting per car = historical average × a correction learned online from every train. Room per door = capacity − load + alighting.
3. **Recommend**: ratio = people queuing or walking to a door ÷ predicted room. Under 0.7 is green, under 1.0 is amber, otherwise red. An over-full queue area is red regardless.
4. **Update lights**: tunnel signs and door lights refresh every 2 seconds. People who follow the lights are spread across the green doors in proportion to spare room, so one green door doesn't become the next crowd.
5. **Evaluate**: score evenness, people left behind and wait time, and feed each train's real alighting back into the forecast.

## Limits

- All data is simulated. A pilot would add the 4 devices above and reuse MTR's train load sensors, CCTV and gate data.
- Passengers without guidance are modelled as queuing near the tunnel they came out of. Real behaviour should be measured in a pilot.
- The forecast learns per train within one session. The production design stores data and averages each day-and-hour slot over recent weeks.
- The system advises passengers and staff. It does not replace staff, platform screen doors or any safety system.

## Project layout

```
live/                      live AI system: camera AI, capacity, recommendation, lights, GenAI
archive/live-v1/           backup of the previous live system
platform-flow/index.html   2D simulator (model + UI)
platform-flow/3d.html      3D platform view (same model)
hardware-3d.html           3D hardware concept (4 devices)
proof/index.html           prototype proof page
proof/run_benchmark.py     benchmark script
proof/results.csv          120 benchmark runs
proof/summary.csv          averages per scenario and compliance level
proof/screens/             screenshots for the deck
demo/index.html            self-playing demo reel for recording the video
pitch/                     pitch deck source and QR codes
DEMO_VIDEO_SCRIPT.md       how to record the demo video, with voiceover
```
