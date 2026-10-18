# Admiralty Platform Flow

**AI-Assisted Predictive Passenger Distribution System for MTR Stations**: hackathon prototype.

At rush hour, passengers bunch up at the platform doors closest to the tunnel they came out of, while other doors still have room. This system puts green, amber and red lights in the access tunnels and above each platform door. An AI model predicts how much room each door will have on the next train and steers passengers there **before** they pick a queue.

## Live prototype

Start here: **https://geoeoeo217.github.io/MTR-platform-flow/**

| What | Public link | File |
|---|---|---|
| 2D simulator: side-by-side comparison with live scores | https://geoeoeo217.github.io/MTR-platform-flow/platform-flow/ | `platform-flow/index.html` |
| 3D platform: tunnels, door lights, passengers arriving and getting off | https://geoeoeo217.github.io/MTR-platform-flow/platform-flow/3d.html | `platform-flow/3d.html` |
| Demo reel: self-playing video demo with captions | https://geoeoeo217.github.io/MTR-platform-flow/demo/ | `demo/index.html` |
| Prototype proof: results, charts, screenshots | https://geoeoeo217.github.io/MTR-platform-flow/proof/ | `proof/index.html` |
| Hardware concept in 3D (4 devices) | https://geoeoeo217.github.io/MTR-platform-flow/hardware-3d.html | `hardware-3d.html` |

Each file runs offline in any browser: double-click it, or use VS Code's Live Server. The 3D pages need internet access to load Three.js.

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
