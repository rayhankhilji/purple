#!/usr/bin/env python3
"""Derive the README tables from the fetched JSON (no network).

Usage: python3 derive.py [--dir ..] [--racepace ../../../../js/data/racepace2026.js]
Prints Markdown to stdout.
"""
import argparse
import json
import os
import re

# name, corner numbers (F1 / MultiViewer numbering), search window as offsets in m from the
# first / last marker on the pole trace, or None where the car does not slow to a local minimum
# (then the speed at the marker is reported).
GROUPS = [
    ("Abbey", [1], None), ("Farm", [2], None),
    ("Village", [3], (-160, 85)), ("The Loop", [4], (-85, 70)), ("Aintree", [5], None),
    ("Brooklands", [6], (-250, 110)), ("Luffield", [7], (-115, 125)), ("Woodcote", [8], None),
    ("Copse", [9], (-90, 260)), ("Maggotts", [10, 11], None), ("Becketts", [12, 13], (-45, 90)),
    ("Chapel", [14], None), ("Stowe", [15], (-280, 220)), ("Vale", [16], (-135, 65)),
    ("Club", [17, 18], None),
]
STRAIGHTS = [("Hamilton (pit) straight, end", 18, 1), ("Wellington Straight, end", 5, 6),
             ("Hangar Straight, end", 14, 15)]


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default=os.path.dirname(here))
    ap.add_argument("--racepace", default=os.path.join(here, "..", "..", "..", "..", "js", "data", "racepace2026.js"))
    ap.add_argument("--gears", default="HAD,VER", help="quali laps for the per-gear tables")
    a = ap.parse_args()
    idx = json.load(open(os.path.join(a.dir, "silverstone-2026-q-index.json")))
    circ = json.load(open(os.path.join(a.dir, "silverstone-circuit.json")))
    cd = {c["number"]: c["distance_m_on_pole_lap"] for c in circ["corners"]}
    pole = [l for l in idx["telemetry_laps"] if l["pole"]][0]
    doc = json.load(open(os.path.join(a.dir, pole["file"])))
    ch = doc["channels"]
    D, V, B, T, G, TS = (ch[k] for k in ("distance_m", "speed_kmh", "brake", "throttle_pct", "gear", "time_s"))
    L = D[-1]
    n = len(D)

    def at(d):
        return min(range(n), key=lambda i: abs(D[i] - d))

    print("Pole lap: %s (%s) lap %d, %.3f s, %s, lap length (speed integral) %.0f m\n" % (
        doc["driver"]["name"], doc["driver"]["team"], doc["lap"]["lap_number"],
        doc["lap"]["lap_time_s"], doc["lap"]["compound"], L))
    print("| Corner (Tn) | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |")
    print("|---|---|---|---|---|---|---|---|---|")
    for name, nums, win in GROUPS:
        tn = "T" + "/".join(str(x) for x in nums)
        mk = "/".join("%.0f" % cd[x] for x in nums)
        if win is None:
            ms = [at(cd[x]) for x in nums]
            print("| %s (%s) | %s | %s | %s | %s | - | - | - | no local minimum: speed at marker, throttle %s%% |" % (
                name, tn, mk, "/".join("%.0f" % V[i] for i in ms), "/".join(str(G[i]) for i in ms),
                mk, "/".join(str(T[i]) for i in ms)))
            continue
        lo, hi = cd[nums[0]] + win[0], cd[nums[-1]] + win[1]
        idxs = [i for i in range(n) if lo <= D[i] <= hi]
        m = min(idxs, key=lambda i: V[i])
        j = m
        while j > idxs[0] and not B[j]:
            j -= 1
        bstart = entry = lift = "-"
        note = ""
        if B[j]:
            while j > idxs[0] and B[j - 1]:
                j -= 1
            bstart = "%.0f" % D[j]
            entry = "%.0f" % max(V[k] for k in range(n) if D[j] - 50 <= D[k] <= D[j])
            jb = j
        else:
            jb = m
        k = jb
        while k > idxs[0] and T[k] >= 95:
            k -= 1
        if T[k] < 95:
            while k > idxs[0] and T[k - 1] < 95:
                k -= 1
            lift = "%.0f" % D[k]
            if bstart == "-":
                note = "no brake; %.0f km/h at lift" % V[k]
        elif bstart == "-":
            note = "flat (throttle >= 95% throughout)"
        print("| %s (%s) | %s | %.0f | %d | %.0f | %s | %s | %s | %s |" % (
            name, tn, mk, V[m], G[m], D[m], lift, bstart, entry, note))

    print("\n| Straight | Peak speed km/h | Peak at m | Speed at end (lift/brake point) km/h | End at m |")
    print("|---|---|---|---|---|")
    for name, a_, b_ in STRAIGHTS:
        if a_ > b_:
            idxs = [i for i in range(n) if D[i] >= cd[a_]] + [i for i in range(n) if D[i] <= cd[b_]]
        else:
            idxs = [i for i in range(n) if cd[a_] <= D[i] <= cd[b_]]
        m = max(idxs, key=lambda i: V[i])
        e = idxs[idxs.index(m)]
        for i in idxs[idxs.index(m):]:
            if T[i] < 95 or B[i]:
                break
            e = i
        print("| %s | %.0f | %.0f | %.0f | %.0f |" % (name, V[m], D[m], V[e], D[e]))
    m = max(range(n), key=lambda i: V[i])
    print("\nLap maximum: %.0f km/h at %.0f m (Woodcote to Copse straight)." % (V[m], D[m]))
    st = doc["lap"]["speed_trap_kmh"]
    print("Official speed trap (OpenF1 `st_speed`) on the pole lap: %d km/h; i1 %s, i2 %s km/h." % (
        st, doc["lap"]["i1_speed_kmh"], doc["lap"]["i2_speed_kmh"]))
    # locate the trap: position on the pole-lap trace where every team lap's speed best matches its st_speed
    laps = [json.load(open(os.path.join(a.dir, l["file"]))) for l in idx["telemetry_laps"]]
    fits = []
    for j in range(0, n, 2):
        px, py = ch["x_m"][j], ch["y_m"][j]
        err = 0.0
        for lp in laps:
            c = lp["channels"]
            k = min(range(len(c["x_m"])), key=lambda i: (c["x_m"][i] - px) ** 2 + (c["y_m"][i] - py) ** 2)
            err += (c["speed_kmh"][k] - lp["lap"]["speed_trap_kmh"]) ** 2
        fits.append(((err / len(laps)) ** 0.5, D[j]))
    rms, dfit = min(fits)
    print("Best-fit trap position over the %d qualifying laps: %.0f m on the pole trace (RMS %.1f km/h); pole trace there: %.0f km/h.\n" % (
        len(laps), dfit, rms, V[at(dfit)]))

    # full throttle share
    dt_full = sum(TS[i] - TS[i - 1] for i in range(1, n) if T[i] >= 99 and T[i - 1] >= 99)
    d_full = sum(D[i] - D[i - 1] for i in range(1, n) if T[i] >= 99 and T[i - 1] >= 99)
    dt_brake = sum(TS[i] - TS[i - 1] for i in range(1, n) if B[i] and B[i - 1])
    print("Full throttle (>= 99%%): %.1f%% of lap time, %.1f%% of distance; raw-sample share %.1f%%. Braking: %.1f%% of lap time." % (
        100 * dt_full / TS[-1], 100 * d_full / L, 100 * doc["processing"]["raw_full_throttle_sample_share"],
        100 * dt_brake / TS[-1]))
    s = doc["lap"]["sector_s"]
    ends = [s[0], s[0] + s[1]]
    print("Sectors: S1 %.3f, S2 %.3f, S3 %.3f s (sum %.3f); S1/S2 end at about %.0f m / %.0f m of the trace.\n" % (
        s[0], s[1], s[2], sum(s), D[min(range(n), key=lambda i: abs(TS[i] - ends[0]))],
        D[min(range(n), key=lambda i: abs(TS[i] - ends[1]))]))

    # cross-check vs racepace2026.js
    js = open(a.racepace).read()
    rp = json.loads(re.search(r"EI\.RACEPACE\s*=\s*(\{.*\});", js, re.S).group(1))["silverstone"]
    print("| Driver | OpenF1 best Q lap s | racepace2026.js q s | diff s | OpenF1 max speed trap km/h | racepace speedTrapQuali | diff |")
    print("|---|---|---|---|---|---|---|")
    for r in idx["best_lap_per_driver"]:
        c = r["code"]
        q = rp["q"].get(c)
        stj = rp["speedTrapQuali"].get(c)
        sto = idx["max_speed_trap_kmh_session"].get(c)
        print("| %s | %.3f | %s | %s | %s | %s | %s |" % (
            c, r["lap_time_s"], q if q is not None else "-",
            "%+.3f" % (r["lap_time_s"] - q) if q is not None else "-", sto, stj,
            "%+.1f" % (sto - stj) if (sto and stj) else "-"))
    print("\nPole in racepace2026.js: %s %.3f s.\n" % (rp["pole"]["code"], rp["pole"]["s"]))
    if os.path.exists(os.path.join(a.dir, "silverstone-2026-r-index.json")):
        race_report(a.dir)
    for code in a.gears.split(","):
        f = os.path.join(a.dir, "silverstone-2026-q-%s.json" % code.strip().lower())
        if code.strip() and os.path.exists(f):
            gear_report(f)



def pct(xs, q):
    xs = sorted(xs)
    if not xs:
        return float("nan")
    k = (len(xs) - 1) * q
    i = int(k)
    return xs[i] if i + 1 >= len(xs) else xs[i] + (xs[i + 1] - xs[i]) * (k - i)


def gear_report(path):
    doc = json.load(open(path))
    r = doc["raw_car_data"]
    V, R, G, T, B, X = r["speed_kmh"], r["rpm"], r["gear"], r["throttle_pct"], r["brake"], r["distance_m"]
    n = len(V)
    print("#### %s (%s), qualifying lap %d, %.3f s: %d raw samples\n" % (
        doc["driver"]["code"], doc["driver"]["team"], doc["lap"]["lap_number"], doc["lap"]["lap_time_s"], n))
    print("| Gear | Samples | rpm min to max | km/h per 1000 rpm, median (IQR, n) | km/h range | Upshift to next: rpm / km/h (median, n) |")
    print("|---|---|---|---|---|---|")
    for g in sorted(set(G)):
        if g == 0:
            continue
        idx = [i for i in range(n) if G[i] == g]
        steady = [V[i] / (R[i] / 1000.0) for i in idx
                  if 0 < i < n - 1 and G[i - 1] == g and G[i + 1] == g and not B[i] and R[i] > 5000]
        ups = [i for i in idx if i + 1 < n and G[i + 1] == g + 1 and not B[i]]
        up = ("%.0f / %.0f (%d)" % (pct([R[i] for i in ups], .5), pct([V[i] for i in ups], .5), len(ups))) if ups else "-"
        ratio = ("%.2f (%.2f to %.2f, %d)" % (pct(steady, .5), pct(steady, .25), pct(steady, .75), len(steady))) if steady else "-"
        print("| %d | %d | %d to %d | %s | %d to %d | %s |" % (
            g, len(idx), min(R[i] for i in idx), max(R[i] for i in idx), ratio,
            min(V[i] for i in idx), max(V[i] for i in idx), up))
    print("\nObserved max rpm: %d (gear %d, %d km/h, at %.0f m)." % (
        max(R), G[R.index(max(R))], V[R.index(max(R))], X[R.index(max(R))]))
    ch = doc["channels"]
    D, CV, CT, CG = ch["distance_m"], ch["speed_kmh"], ch["throttle_pct"], ch["gear"]
    print("\nFull-throttle segments (throttle >= 99% on the 5 m grid, at least 50 m long):\n")
    print("| Start m | End m | Length m | Entry km/h | Exit km/h | Peak km/h | Gears |")
    print("|---|---|---|---|---|---|---|")
    i = 0
    while i < len(D):
        if CT[i] >= 99:
            j = i
            while j + 1 < len(D) and CT[j + 1] >= 99:
                j += 1
            if D[j] - D[i] >= 50:
                seq = []
                for g in CG[i:j + 1]:
                    if not seq or seq[-1] != g:
                        seq.append(g)
                print("| %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %s |" % (
                    D[i], D[j], D[j] - D[i], CV[i], CV[j], max(CV[i:j + 1]), "-".join(map(str, seq))))
            i = j + 1
        else:
            i += 1
    print()


def race_report(d):
    ri = json.load(open(os.path.join(d, "silverstone-2026-r-index.json")))
    print("Race: %d laps; neutralised (UTC): %s\n" % (ri["race_laps"], "; ".join(
        "%s to %s" % (a[11:19], b[11:19]) for a, b in ri["neutralised_utc"])))
    print("| File | Driver | Role | Lap | Lap time s | Compound | Tyre age (laps) | Laps remaining | Full throttle (raw share) | Passes in lap | Min gap ahead s |")
    print("|---|---|---|---|---|---|---|---|---|---|---|")
    for code, dd in ri["drivers"].items():
        rows = {r["lap_number"]: r for r in dd["laps"]}
        for f in dd["telemetry_laps"]:
            r = rows[f["lap_number"]]
            print("| `%s` | %s | %s | %d | %.3f | %s | %s | %d | %.1f%% | %s | %s |" % (
                f["file"], code, f["role"], r["lap_number"], r["lap_time_s"], r["compound"], r["tyre_age_laps"],
                ri["race_laps"] - r["lap_number"], 100 * r["full_throttle_share"], ", ".join(r["passes"]) or "-",
                r["min_gap_ahead_s"]))
    print()


if __name__ == "__main__":
    main()
