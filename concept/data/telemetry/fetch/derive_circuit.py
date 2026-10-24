#!/usr/bin/env python3
"""Derive the per-circuit README tables from the fetched JSON (no network).

Usage: python3 derive_circuit.py --circuit monza [--official-m 5793] [--racepace-key monza]
                                 [--lap CODE] [--groups "1,2:Rettifilo;3:Curva Grande"]
Prints Markdown to stdout. Generic version of derive.py (which keeps the Silverstone corner names).
Channels can be null inside a telemetry dropout (see fetch_circuit.py); every table skips those points
and says so where a result depends on them.
"""
import argparse
import json
import os
import re


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--circuit", required=True)
    ap.add_argument("--root", default=os.path.dirname(here))
    ap.add_argument("--official-m", type=float, default=None)
    ap.add_argument("--racepace-key", default=None)
    ap.add_argument("--racepace", default=os.path.join(here, "..", "..", "..", "..", "js", "data", "racepace2026.js"))
    ap.add_argument("--min-straight-m", type=float, default=300.0)
    ap.add_argument("--lap", default=None, help="driver code to analyse instead of the pole lap")
    ap.add_argument("--groups", default="", help='corner groups and names, e.g. "1,2:Rettifilo;3:Curva Grande"')
    ap.add_argument("--tables-only", action="store_true", help="skip the per-driver and cross-check tables")
    a = ap.parse_args()
    d = os.path.join(a.root, a.circuit)
    pre = "%s-2026-q-" % a.circuit
    idx = json.load(open(os.path.join(d, pre + "index.json")))
    circ = json.load(open(os.path.join(d, a.circuit + "-circuit.json")))
    if a.lap:
        pole = [l for l in idx["telemetry_laps"] if l["code"] == a.lap.upper()][0]
    else:
        pole = [l for l in idx["telemetry_laps"] if l["pole"]][0]
    doc = json.load(open(os.path.join(d, pole["file"])))
    ch = doc["channels"]
    D, V, B, T, G, TS = (ch[k] for k in ("distance_m", "speed_kmh", "brake", "throttle_pct", "gear", "time_s"))
    n = len(D)
    L = D[-1]
    pr = doc["processing"]
    ok = lambda i: V[i] is not None
    print("%s lap: %s (%s) lap %d, %.3f s, %s. Lap length: %.1f m speed integral, %.1f m X/Y path%s." % (
        "Pole" if pole["pole"] else "Analysed", doc["driver"]["name"], doc["driver"]["team"], doc["lap"]["lap_number"],
        doc["lap"]["lap_time_s"], doc["lap"].get("compound"), pr["length_m_speed_integral"], pr["length_m_xy_path"],
        (", official %.0f m (speed integral %+.2f%%, X/Y path %+.2f%%)" % (
            a.official_m, 100 * (pr["length_m_speed_integral"] / a.official_m - 1),
            100 * (pr["length_m_xy_path"] / a.official_m - 1))) if a.official_m else ""))
    if pr["dropouts"]:
        print("Telemetry dropouts on this lap: %s." % "; ".join(
            "%.0f to %.0f m (%.1f s)" % (x["distance_start_m"], x["distance_end_m"], x["t_end_s"] - x["t_start_s"])
            for x in pr["dropouts"]))
    ls = []
    for l in idx["telemetry_laps"]:
        p = json.load(open(os.path.join(d, l["file"])))["processing"]
        ls.append((p["length_m_speed_integral"], p["length_m_xy_path"], l["code"], bool(p["dropouts"])))
    clean = [x for x in ls if not x[3]]
    print("\nLap length over %d laps: speed integral %.0f to %.0f m, X/Y path %.0f to %.0f m. "
          "%d laps without a dropout: speed integral %.0f to %.0f m, median %.0f m; X/Y median %.0f m." % (
              len(ls), min(x[0] for x in ls), max(x[0] for x in ls), min(x[1] for x in ls), max(x[1] for x in ls),
              len(clean), min(x[0] for x in clean), max(x[0] for x in clean),
              sorted(x[0] for x in clean)[len(clean) // 2], sorted(x[1] for x in ls)[len(ls) // 2]))
    print("Laps with a dropout: %s.\n" % (", ".join(x[2] for x in ls if x[3]) or "none"))

    # corner units: groups from --groups, every other corner alone
    names, groups = {}, []
    for part in [p for p in a.groups.split(";") if p.strip()]:
        nums, nm = part.split(":")
        groups.append([int(x) for x in nums.split(",")])
        names[tuple(groups[-1])] = nm
    by_num = {c["number"]: c for c in circ["corners"]}
    used = {x for g in groups for x in g}
    units = [[by_num[x] for x in g if x in by_num] for g in groups] + [[c] for c in circ["corners"] if c["number"] not in used]
    units = [u for u in units if u]
    units.sort(key=lambda u: min(c["distance_m_on_pole_lap"] for c in u))
    mk_of = lambda c: c["distance_m_on_pole_lap"]

    def at(dist):
        return min(range(n), key=lambda i: abs(D[i] - dist))

    print("| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |")
    print("|---|---|---|---|---|---|---|---|---|")
    f0 = lambda x: "-" if x is None else "%.0f" % x
    for k, u in enumerate(units):
        first = min(mk_of(c) for c in u)
        last = max(mk_of(c) for c in u)
        prev_last = max(mk_of(c) for c in units[k - 1]) if k > 0 else first - 500
        next_first = min(mk_of(c) for c in units[k + 1]) if k + 1 < len(units) else last + 240
        lo = max((prev_last + first) / 2, first - 250)
        hi = min((next_first + last) / 2, last + 120)
        idxs = [i for i in range(n) if lo <= D[i] <= hi]
        tn = "T" + "/".join(str(c["number"]) for c in u)
        nm = names.get(tuple(c["number"] for c in u), "")
        label = "%s (%s)" % (nm, tn) if nm else tn
        mk = "/".join("%.0f" % mk_of(c) for c in u)
        valid = [i for i in idxs if ok(i)]
        if not valid:
            print("| %s | %s | - | - | - | - | - | - | telemetry dropout across the window |" % (label, mk))
            continue
        m = min(valid, key=lambda i: V[i])
        gap_in = len(valid) < len(idxs)
        j = m
        while j > idxs[0] and ok(j) and not B[j]:
            j -= 1
        bstart = entry = lift = None
        note = []
        if not ok(j):
            note.append("braking start falls in a telemetry dropout")
            jb = j
        elif B[j]:
            while j > idxs[0] and ok(j - 1) and B[j - 1]:
                j -= 1
            if j > idxs[0] and not ok(j - 1):
                note.append("braking start inside or before a dropout: value is the first braking sample")
            bstart = D[j]
            entry = max(V[i] for i in range(n) if D[j] - 50 <= D[i] <= D[j] and ok(i))
            jb = j
        else:
            jb = m
        kk = jb
        while kk > idxs[0] and ok(kk) and T[kk] >= 95:
            kk -= 1
        if ok(kk) and T[kk] < 95:
            while kk > idxs[0] and ok(kk - 1) and T[kk - 1] < 95:
                kk -= 1
            lift = D[kk]
        flat = bstart is None and lift is None and not gap_in
        vmin, dmin, gmin = V[m], D[m], G[m]
        if flat:
            im = at(first)
            if ok(im):
                vmin, dmin, gmin = V[im], first, G[im]
                note.append("no slowing (throttle >= 95%% in the window): speed at marker, throttle %d%%" % T[im])
        elif bstart is None and not note:
            note.append("lift, no brake")
        if gap_in and not note:
            note.append("part of the window is a telemetry dropout")
        print("| %s | %s | %.0f | %d | %.0f | %s | %s | %s | %s |" % (
            label, mk, vmin, gmin, dmin, f0(lift), f0(bstart), f0(entry), "; ".join(note)))

    # straights: contiguous throttle >= 95 % without brake, at least --min-straight-m long
    print("\n| Straight (from m to m) | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Peak minus end km/h | Lift or brake at m |")
    print("|---|---|---|---|---|---|---|---|")
    i = 0
    while i < n:
        if ok(i) and T[i] >= 95 and not B[i]:
            j = i
            while j + 1 < n and ok(j + 1) and T[j + 1] >= 95 and not B[j + 1]:
                j += 1
            if D[j] - D[i] >= a.min_straight_m:
                seg = range(i, j + 1)
                pk = max(seg, key=lambda x: V[x])
                nxt = D[min(j + 1, n - 1)]
                tail = " (dropout)" if j + 1 < n and not ok(j + 1) else ""
                print("| %.0f to %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f%s |" % (
                    D[i], D[j], D[j] - D[i], V[i], V[pk], D[pk], V[j], V[pk] - V[j], nxt, tail))
            i = j + 1
        else:
            i += 1
    vs = [i for i in range(n) if ok(i)]
    m = max(vs, key=lambda x: V[x])
    mn = min(vs, key=lambda x: V[x])
    print("\nLap maximum: %.0f km/h at %.0f m. Minimum: %.0f km/h at %.0f m." % (V[m], D[m], V[mn], D[mn]))
    print("Trap readings (OpenF1) on this lap: i1 %s, i2 %s, finish line/trap st_speed %s km/h." % (
        doc["lap"]["i1_speed_kmh"], doc["lap"]["i2_speed_kmh"], doc["lap"]["speed_trap_kmh"]))
    pairs = [i for i in range(1, n) if ok(i) and ok(i - 1)]
    dt_all = sum(TS[i] - TS[i - 1] for i in pairs)
    dt_full = sum(TS[i] - TS[i - 1] for i in pairs if T[i] >= 99 and T[i - 1] >= 99)
    d_full = sum(D[i] - D[i - 1] for i in pairs if T[i] >= 99 and T[i - 1] >= 99)
    d_all = sum(D[i] - D[i - 1] for i in pairs)
    dt_brake = sum(TS[i] - TS[i - 1] for i in pairs if B[i] and B[i - 1])
    print("Full throttle (>= 99%%): %.1f%% of valid lap time, %.1f%% of valid distance (valid = %.1f%% of the lap's time); "
          "raw-sample share %.1f%%. Brake on: %.1f%% of valid time." % (
              100 * dt_full / dt_all, 100 * d_full / d_all, 100 * dt_all / TS[-1],
              100 * pr["raw_full_throttle_sample_share"], 100 * dt_brake / dt_all))
    s = doc["lap"]["sector_s"]
    ends = [s[0], s[0] + s[1]]
    print("Sectors: S1 %.3f, S2 %.3f, S3 %.3f s (sum %.3f); S1/S2 end at about %.0f m / %.0f m.\n" % (
        s[0], s[1], s[2], sum(s), D[min(range(n), key=lambda i: abs(TS[i] - ends[0]))],
        D[min(range(n), key=lambda i: abs(TS[i] - ends[1]))]))
    wf = os.path.join(d, pre + "weather.json")
    if os.path.exists(wf):
        import datetime as dt
        w = json.load(open(wf))
        rng = lambda k: "%.1f to %.1f" % (min(w[k]), max(w[k]))
        tl = dt.datetime.fromisoformat(doc["lap"]["date_start_utc"]).timestamp() + doc["lap"]["lap_time_s"]
        j = min(range(len(w["date_utc"])), key=lambda i: abs(dt.datetime.fromisoformat(w["date_utc"][i]).timestamp() - tl))
        print("Weather (%d samples, %s to %s UTC): rainfall max %s; air %s degC; track %s degC; humidity %s %%; "
              "pressure %s mbar; wind %s m/s. Sample nearest the end of this lap (%s UTC): air %.1f, track %.1f, "
              "humidity %.1f %%, wind %.1f m/s from %d deg, rainfall %s.\n" % (
                  len(w["date_utc"]), w["date_utc"][0][11:16], w["date_utc"][-1][11:16], max(w["rainfall"]),
                  rng("air_temperature"), rng("track_temperature"), rng("humidity"), rng("pressure"),
                  rng("wind_speed"), w["date_utc"][j][11:19], w["air_temperature"][j], w["track_temperature"][j],
                  w["humidity"][j], w["wind_speed"][j], w["wind_direction"][j], w["rainfall"][j]))
    if a.tables_only:
        return

    # best-fit speed trap position over all laps on the analysed trace
    laps = [json.load(open(os.path.join(d, l["file"]))) for l in idx["telemetry_laps"]]
    laps = [lp for lp in laps if lp["lap"]["speed_trap_kmh"]]
    fits = []
    for j in range(0, n, 2):
        if not ok(j):
            continue
        px, py = ch["x_m"][j], ch["y_m"][j]
        err, cnt = 0.0, 0
        for lp in laps:
            c = lp["channels"]
            kk = min(range(len(c["x_m"])), key=lambda i: (c["x_m"][i] - px) ** 2 + (c["y_m"][i] - py) ** 2)
            if c["speed_kmh"][kk] is None:
                continue
            err += (c["speed_kmh"][kk] - lp["lap"]["speed_trap_kmh"]) ** 2
            cnt += 1
        if cnt >= len(laps) - 3:
            fits.append(((err / cnt) ** 0.5, D[j]))
    if fits:
        rms, dfit = min(fits)
        print("Best-fit trap position over %d laps: %.0f m on this trace (RMS %.1f km/h); trace there: %s km/h.\n" % (
            len(laps), dfit, rms, V[at(dfit)]))

    print("| Driver | Team | Lap | Best Q lap s | Compound | S1 | S2 | S3 | i1 | i2 | trap | max trap in session |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|")
    for r in idx["best_lap_per_driver"]:
        print("| %s | %s | %d | %.3f | %s | %.3f | %.3f | %.3f | %s | %s | %s | %s |" % (
            r["code"], r["team"], r["lap_number"], r["lap_time_s"], r["compound"], *r["sector_s"],
            r["i1_speed_kmh"], r["i2_speed_kmh"], r["speed_trap_kmh"],
            idx["max_speed_trap_kmh_session"].get(r["code"])))
    print("\nDeleted lap times: %s\n" % (", ".join("%s lap %d %.3f" % (x["code"], x["lap_number"], x["lap_time_s"])
                                                  for x in idx["deleted_lap_times"]) or "none"))
    of = os.path.join(d, pre + "official.json")
    if os.path.exists(of):
        off = json.load(open(of))
        mine = {r["code"]: r for r in idx["best_lap_per_driver"]}

        def sec(s):
            m_, x = s.split(":")
            return int(m_) * 60 + float(x)

        print("| Pos | Driver | Q1 | Q2 | Q3 | Official best s | OpenF1 best valid s | diff ms | Lap in OpenF1 |")
        print("|---|---|---|---|---|---|---|---|---|")
        nm_ = 0
        for r in off["classification"]:
            ts_ = [sec(x) for x in r["q1_q2_q3"] if x]
            ob = min(ts_)
            mi = mine.get(r["code"])
            diff = round((mi["lap_time_s"] - ob) * 1000) if mi else None
            nm_ += diff == 0
            print("| %d | %s | %s | %s | %s | %.3f | %s | %s | %s |" % (
                r["pos"], r["code"], *[x or "-" for x in r["q1_q2_q3"]], ob,
                "%.3f" % mi["lap_time_s"] if mi else "-", "%+d" % diff if diff is not None else "-",
                mi["lap_number"] if mi else "-"))
        print("\n%d of %d official best laps match OpenF1 to the millisecond.\n" % (nm_, len(off["classification"])))
    if a.racepace_key and os.path.exists(a.racepace):
        js = open(a.racepace).read()
        rp = json.loads(re.search(r"EI\.RACEPACE\s*=\s*(\{.*\});", js, re.S).group(1))[a.racepace_key]
        print("| Driver | OpenF1 best valid Q s | racepace2026.js q s | diff s | OpenF1 max trap | racepace speedTrapQuali | diff |")
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
        print("\nPole in racepace2026.js: %s %.3f s." % (rp["pole"]["code"], rp["pole"]["s"]))


if __name__ == "__main__":
    main()
