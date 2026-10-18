"""Benchmark the AI guidance against no guidance, using the exact model inside platform-flow/index.html.

Runs every scenario x compliance level x seed for 60 simulated minutes and writes results.csv
(one row per run) and summary.csv (averaged over seeds).

Usage (macOS, no installs needed):  python3 proof/run_benchmark.py
Uses node if it is installed, otherwise macOS's built-in JavaScript engine (osascript).
"""
import csv, json, pathlib, re, shutil, subprocess, tempfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = pathlib.Path(__file__).resolve().parent
SCENARIOS = {"mon9": 240, "fri1830": 220, "wed14": 90, "sat16": 130}
COMPLIANCE = [0, 20, 40, 60, 80, 100]
SEEDS = [1, 2, 3, 4, 5]
MINUTES = 60

html = (ROOT / "platform-flow" / "index.html").read_text(encoding="utf-8")
js = re.search(r"<script>(.*)</script>", html, re.S).group(1)
core = js.split("// ---------- UI ----------")[0].replace("(()=>{", "", 1)
core = core.replace("this.er=rng(42)", "this.er=rng(SEED)").replace("this.r=rng(7)", "this.r=rng(SEED*101+7)")
assert "rng(SEED)" in core and "rng(SEED*101+7)" in core, "model code changed; update the seed patch"

harness = f"""
function runOnce(SEED, key, rate, comp) {{
{core}
  const w = new World(key, rate, comp);
  for (let i = 0; i < {MINUTES} * 60 / DT; i++) w.step(DT);
  const f = s => ({{cv: s.cvSum / s.samples, maxq: s.maxSum / s.samples, left: s.left,
                    wait: s.waitSum / Math.max(1, s.boarded), boarded: s.boarded, over: s.overSec}});
  const m = a => a.reduce((x, y) => x + y, 0) / Math.max(1, a.length);
  return {{base: f(w.sims[0]), ai: f(w.sims[1]), errHist: m(w.eH.slice(5)), errAi: m(w.eA.slice(5))}};
}}
const rows = [];
for (const [key, rate] of {json.dumps(list(SCENARIOS.items()))})
  for (const comp of {json.dumps(COMPLIANCE)})
    for (const seed of {json.dumps(SEEDS)})
      rows.push(Object.assign({{scenario: key, rate, compliance: comp, seed}}, runOnce(seed, key, rate, comp / 100)));
"""

with tempfile.TemporaryDirectory() as tmp:
    f = pathlib.Path(tmp) / "bench.js"
    if shutil.which("node"):
        f.write_text(harness + "\nconsole.log(JSON.stringify(rows));")
        out = subprocess.run(["node", f], capture_output=True, text=True, check=True).stdout
    else:
        f.write_text(harness + "\nJSON.stringify(rows);")
        p = subprocess.run(["osascript", "-l", "JavaScript", f], capture_output=True, text=True)
        if p.returncode: raise SystemExit(p.stderr[-2000:])
        out = p.stdout
rows = json.loads(out)

fields = ["scenario", "rate", "compliance", "seed"]
metrics = ["cv", "maxq", "left", "wait", "over"]
with open(OUT / "results.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(fields + [f"{m}_{s}" for s in ("base", "ai") for m in metrics] + ["forecast_err_hist", "forecast_err_ai"])
    for r in rows:
        w.writerow([r[k] for k in fields] + [round(r[s][m], 3) for s in ("base", "ai") for m in metrics]
                   + [round(r["errHist"], 2), round(r["errAi"], 2)])

summary = {}
for r in rows:
    summary.setdefault((r["scenario"], r["compliance"]), []).append(r)
with open(OUT / "summary.csv", "w", newline="") as fh:
    w = csv.writer(fh)
    w.writerow(["scenario", "compliance"] + [f"{m}_{s}" for s in ("base", "ai") for m in metrics] + ["forecast_err_hist", "forecast_err_ai"])
    for (sc, comp), rs in summary.items():
        avg = lambda get: round(sum(get(x) for x in rs) / len(rs), 3)
        w.writerow([sc, comp] + [avg(lambda x, s=s, m=m: x[s][m]) for s in ("base", "ai") for m in metrics]
                   + [avg(lambda x: x["errHist"]), avg(lambda x: x["errAi"])])
print(f"{len(rows)} runs written to {OUT/'results.csv'} and {OUT/'summary.csv'}")
