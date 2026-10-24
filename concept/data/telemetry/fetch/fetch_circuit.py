#!/usr/bin/env python3
"""Generalised OpenF1 qualifying fetch: one folder per circuit.

Reuses the Silverstone pipeline (fetch_openf1.py: http_json, of1, build_lap, 5 m grid,
trapezoidal distance, raw samples) and writes to <out>/<circuit>/:

  <circuit>-2026-q-<code>.json   best VALID qualifying lap of every driver (5 m grid + raw samples)
  <circuit>-2026-q-index.json    session info, per-driver best laps, speed traps, deleted laps
  <circuit>-2026-q-weather.json  session weather
  <circuit>-circuit.json         corner markers (MultiViewer) projected onto the pole lap

Telemetry dropouts: OpenF1 sometimes freezes the feed (speed and rpm constant for seconds, throttle and
brake both 104). Such samples are removed, the lap is marked in `processing.dropouts`, and the channels are
null inside the gap (see build_lap).

Valid = not deleted by race control ("CAR n (XXX) TIME m:ss.mmm DELETED ..."), has a lap time and a
start timestamp. A lap file larger than --max-kb drops its `raw_car_data` block (noted in
`processing.raw_car_data`). Nothing is synthesised: a missing session or empty answer stops the run.

Usage
  python3 fetch_circuit.py --circuit monza --session_key 11357 [--year 2026] [--out DIR]
                           [--cache DIR] [--max-kb 80]
  python3 fetch_circuit.py --circuit monza --location Monza     # looks the Qualifying session up
"""
import argparse
import datetime as dt
import json
import math
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_openf1 as f1  # noqa: E402  (shared helpers; the Silverstone script is unchanged)

DELETED_RE = re.compile(r"CAR (\d+) \((\w+)\) TIME (\d+):(\d+\.\d+) DELETED")


def dumps(doc):
    return json.dumps(doc, separators=(",", ":"))

GAP_S = 0.8        # an invalid run that leaves more than this between valid samples is a dropout gap
FROZEN_MIN = 3     # identical speed + rpm for this many samples in a row (speed >= 50 km/h) = frozen feed


def find_invalid(car):
    """Indices of car_data samples that are not real readings.

    OpenF1 sometimes holds the last value while the feed drops out: speed, rpm and gear stay constant for
    seconds, with throttle and brake both reading 104 (an error code, not a percentage). A sample is invalid
    if throttle > 100, brake is not 0/100, or it sits in a run of at least FROZEN_MIN samples with identical
    speed and rpm at 50 km/h or more.
    """
    bad = [r["throttle"] > 100 or r["brake"] not in (0, 100) for r in car]
    i = 0
    while i < len(car):
        j = i
        while j + 1 < len(car) and car[j + 1]["rpm"] == car[i]["rpm"] and car[j + 1]["speed"] == car[i]["speed"]:
            j += 1
        if j - i + 1 >= FROZEN_MIN and car[i]["speed"] >= 50:
            for k in range(i, j + 1):
                bad[k] = True
        i = j + 1
    return bad


def build_lap(cache, session_key, drv, lap):
    """Like fetch_openf1.build_lap (5 m grid, trapezoidal distance, raw samples) with dropout handling.

    Invalid samples (see find_invalid) are removed. Where that leaves more than GAP_S between valid samples
    the lap has a dropout gap: speed/throttle/brake/gear/rpm are null on the grid inside it (never
    interpolated), and the distance across it is the X/Y path length between the neighbouring valid samples,
    so the distance axis stays continuous. Shorter invalid runs are bridged by linear interpolation.
    """
    t0 = f1.ts(lap["date_start"])
    T = lap["lap_duration"]
    t1 = t0 + T
    lo, hi = f1.iso(t0 - f1.WINDOW_PAD_S), f1.iso(t1 + f1.WINDOW_PAD_S)
    car = f1.of1("car_data", cache, session_key=session_key, driver_number=drv["driver_number"],
                 date__gt=lo, date__lt=hi)
    loc = f1.of1("location", cache, session_key=session_key, driver_number=drv["driver_number"],
                 date__gt=lo, date__lt=hi)
    car.sort(key=lambda r: r["date"])
    loc.sort(key=lambda r: r["date"])
    car = [r for i, r in enumerate(car) if i == 0 or r["date"] != car[i - 1]["date"]]
    loc = [r for i, r in enumerate(loc) if i == 0 or r["date"] != loc[i - 1]["date"]]
    lt = [f1.ts(r["date"]) - t0 for r in loc]
    lx = [r["x"] for r in loc]
    ly = [r["y"] for r in loc]

    def xy_path(ta, tb):  # metres, X/Y raw units are decimetres
        path, prev, tt = 0.0, None, ta
        while tt <= tb + 1e-9:
            pnt = (f1.interp(lt, lx, tt), f1.interp(lt, ly, tt))
            if prev:
                path += math.hypot(pnt[0] - prev[0], pnt[1] - prev[1])
            prev = pnt
            tt += 0.05
        return path / 10.0

    bad = find_invalid(car)
    n_bad_in_lap = sum(1 for r, b in zip(car, bad) if b and t0 <= f1.ts(r["date"]) <= t1)
    good = [r for r, b in zip(car, bad) if not b]
    ct = [f1.ts(r["date"]) - t0 for r in good]
    gaps = [(ct[i - 1], ct[i]) for i in range(1, len(ct)) if ct[i] - ct[i - 1] > GAP_S and
            any(b and ct[i - 1] < f1.ts(r["date"]) - t0 < ct[i] for r, b in zip(car, bad))]
    gap_after = {i for i in range(1, len(ct)) if (ct[i - 1], ct[i]) in set(gaps)}
    v = [r["speed"] / 3.6 for r in good]
    d = [0.0]
    for i in range(1, len(ct)):
        if i in gap_after:
            d.append(d[-1] + xy_path(ct[i - 1], ct[i]))
        else:
            d.append(d[-1] + 0.5 * (v[i] + v[i - 1]) * (ct[i] - ct[i - 1]))
    d0 = f1.interp(ct, d, 0.0)
    d = [x - d0 for x in d]
    length = f1.interp(ct, d, T)
    path_m = xy_path(0.0, T)

    nn = int(length // f1.STEP_M)
    grid = [i * f1.STEP_M for i in range(nn + 1)]
    if length - grid[-1] > 0.5:
        grid.append(length)
    ch = {k: [] for k in ("distance_m", "time_s", "speed_kmh", "throttle_pct", "brake", "gear", "rpm", "x_m", "y_m")}
    thr = [r["throttle"] for r in good]
    rpm = [r["rpm"] for r in good]
    brk = [r["brake"] for r in good]
    gear = [r["n_gear"] for r in good]
    spd = [r["speed"] for r in good]
    drs_vals = [r["drs"] for r in good]
    has_drs = any(x is not None for x in drs_vals)
    if has_drs:
        ch["drs"] = []
    for g in grid:
        t = f1.interp(d, ct, g)
        in_gap = any(a < t < b for a, b in gaps)
        ch["distance_m"].append(round(g, 1))
        ch["time_s"].append(round(t, 3))
        ch["speed_kmh"].append(None if in_gap else round(f1.interp(ct, spd, t), 1))
        ch["throttle_pct"].append(None if in_gap else round(f1.interp(ct, thr, t)))
        ch["brake"].append(None if in_gap else bool(f1.step(ct, brk, t)))
        ch["gear"].append(None if in_gap else f1.step(ct, gear, t))
        ch["rpm"].append(None if in_gap else round(f1.interp(ct, rpm, t)))
        ch["x_m"].append(round(f1.interp(lt, lx, t) / 10.0, 1))
        ch["y_m"].append(round(f1.interp(lt, ly, t) / 10.0, 1))
        if has_drs:
            ch["drs"].append(None if in_gap else f1.step(ct, drs_vals, t))

    keep = [(r, t) for r, t in zip(good, ct) if 0 <= t <= T]
    full = sum(1 for r, _ in keep if r["throttle"] >= 99)
    raw = {"time_s": [round(t, 3) for _, t in keep],
           "distance_m": [round(f1.interp(ct, d, t), 1) for _, t in keep],
           "speed_kmh": [r["speed"] for r, _ in keep], "throttle_pct": [r["throttle"] for r, _ in keep],
           "brake": [r["brake"] for r, _ in keep], "gear": [r["n_gear"] for r, _ in keep],
           "rpm": [r["rpm"] for r, _ in keep]}
    dropouts = []
    for a, b in gaps:
        if b < 0 or a > T:
            continue
        dropouts.append({"t_start_s": round(a, 3), "t_end_s": round(b, 3),
                         "distance_start_m": round(f1.interp(ct, d, a), 1),
                         "distance_end_m": round(f1.interp(ct, d, b), 1)})
    return {
        "source": "OpenF1 API car_data + location + laps + stints (api.openf1.org/v1)",
        "session_key": session_key,
        "driver": {"number": drv["driver_number"], "code": drv["name_acronym"],
                   "name": drv["full_name"], "team": drv["team_name"]},
        "lap": {
            "lap_number": lap["lap_number"], "lap_time_s": T,
            "sector_s": [lap["duration_sector_1"], lap["duration_sector_2"], lap["duration_sector_3"]],
            "speed_trap_kmh": lap["st_speed"], "i1_speed_kmh": lap["i1_speed"], "i2_speed_kmh": lap["i2_speed"],
            "date_start_utc": lap["date_start"],
        },
        "processing": {
            "step_m": f1.STEP_M,
            "distance": "trapezoidal integral of speed over time from lap start (OpenF1 has no distance channel)",
            "length_m_speed_integral": round(length, 1),
            "length_m_xy_path": round(path_m, 1),
            "raw_car_samples_in_lap": len(keep),
            "raw_car_samples_excluded_invalid": n_bad_in_lap,
            "raw_location_samples_in_lap": sum(1 for t in lt if 0 <= t <= T),
            "raw_full_throttle_sample_share": round(full / max(len(keep), 1), 4),
            "interpolation": "speed/throttle/rpm/x/y linear in time; brake/gear/drs zero-order hold",
            "raw_car_data": "the un-interpolated valid OpenF1 car_data samples inside the lap (brake 0/100 as sent)",
            "xy_units": "metres (OpenF1 x/y divided by 10), F1 timing frame",
            "drs": "present" if has_drs else "absent: OpenF1 drs field null for every sample of this lap",
            "dropouts": dropouts,
            "dropout_rule": ("invalid samples (throttle > 100, brake not 0/100, or speed and rpm frozen over 3+ "
                             "samples) are removed; where that leaves more than %.1f s between valid samples, "
                             "speed/throttle/brake/gear/rpm are null on the grid inside the gap, distance across "
                             "the gap is the X/Y path length, and time_s inside it is linear between the two "
                             "valid samples" % GAP_S),
        },
        "channels": ch,
        "raw_car_data": raw,
    }


def main():
    here = os.path.dirname(os.path.abspath(__file__))
    ap = argparse.ArgumentParser()
    ap.add_argument("--circuit", required=True, help="folder / file prefix, e.g. monza")
    ap.add_argument("--session_key", type=int, default=None)
    ap.add_argument("--location", default=None, help="OpenF1 session location, if no --session_key")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--session", default="Qualifying")
    ap.add_argument("--out", default=os.path.dirname(here), help="telemetry root; files go to <out>/<circuit>/")
    ap.add_argument("--cache", default=None)
    ap.add_argument("--max-kb", type=float, default=80.0)
    a = ap.parse_args()
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
    out = os.path.join(a.out, a.circuit)
    os.makedirs(out, exist_ok=True)
    accessed = dt.date.today().isoformat()
    pre = "%s-%d-q-" % (a.circuit, a.year)

    if a.session_key:
        sess = f1.of1("sessions", a.cache, session_key=a.session_key)
    elif a.location:
        sess = [s for s in f1.of1("sessions", a.cache, year=a.year, location=a.location)
                if s["session_name"] == a.session]
    else:
        raise SystemExit("give --session_key or --location")
    if not sess:
        raise SystemExit("OpenF1 has no such session")
    sess = sess[0]
    sk = sess["session_key"]
    print("session", sk, sess["session_name"], sess["location"], sess["date_start"], file=sys.stderr)

    drivers = {d["driver_number"]: d for d in f1.of1("drivers", a.cache, session_key=sk)}
    laps = f1.of1("laps", a.cache, session_key=sk)
    stints = f1.of1("stints", a.cache, session_key=sk)
    rc = f1.of1("race_control", a.cache, session_key=sk)
    if not drivers or not laps:
        raise SystemExit("OpenF1 returned no drivers/laps for session %s" % sk)

    def compound_for(dn, ln):
        for s in stints:
            if s["driver_number"] == dn and s["lap_start"] <= ln <= (s["lap_end"] or 999):
                return s["compound"], s["tyre_age_at_start"]
        return None, None

    # deleted laps from race control; every message mentioning DELETED is kept for the index
    deleted, rc_deleted = set(), []
    for r in sorted(rc, key=lambda r: r["date"]):
        msg = r.get("message") or ""
        if "DELETED" not in msg.upper():
            continue
        rc_deleted.append({"date_utc": r["date"], "lap": r.get("lap_number"), "message": msg})
        m = DELETED_RE.search(msg)
        if m:
            deleted.add((int(m.group(1)), round(int(m.group(3)) * 60 + float(m.group(4)), 3)))

    def is_deleted(l):
        return (l["driver_number"], round(l["lap_duration"], 3)) in deleted

    timed = [l for l in laps if l.get("lap_duration") and l.get("date_start") and l["driver_number"] in drivers]
    valid = [l for l in timed if not is_deleted(l)]
    best = {}
    for l in valid:
        dn = l["driver_number"]
        if dn not in best or l["lap_duration"] < best[dn]["lap_duration"]:
            best[dn] = l
    no_time = sorted(drivers[dn]["name_acronym"] for dn in drivers if dn not in best)
    by_team = {}
    for dn, l in best.items():
        team = drivers[dn]["team_name"]
        if team not in by_team or l["lap_duration"] < by_team[team]["lap_duration"]:
            by_team[team] = l
    pole = min(best.values(), key=lambda l: l["lap_duration"])
    team_best = {id(l) for l in by_team.values()}

    index, sizes = [], {}
    for l in sorted(best.values(), key=lambda l: l["lap_duration"]):
        drv = drivers[l["driver_number"]]
        comp, age = compound_for(l["driver_number"], l["lap_number"])
        print("lap", drv["name_acronym"], drv["team_name"], l["lap_duration"], file=sys.stderr)
        doc = build_lap(a.cache, sk, drv, l)
        doc["lap"]["compound"] = comp
        doc["lap"]["tyre_age_at_stint_start_laps"] = age
        doc["session"] = {"year": a.year, "event": sess.get("location"), "country": sess.get("country_name"),
                          "circuit": sess.get("circuit_short_name"), "session": sess["session_name"],
                          "date_start_utc": sess["date_start"]}
        doc["accessed"] = accessed
        doc["is_pole_lap"] = l is pole
        doc["is_team_best"] = id(l) in team_best
        text = dumps(doc)
        if len(text) > a.max_kb * 1000:
            doc.pop("raw_car_data")
            doc["processing"]["raw_car_data"] = ("omitted: file would exceed %g KB; "
                                                 "raw_car_samples_in_lap gives the count" % a.max_kb)
            text = dumps(doc)
        fn = pre + drv["name_acronym"].lower() + ".json"
        with open(os.path.join(out, fn), "w") as f:
            f.write(text)
        sizes[fn] = len(text)
        index.append({"file": fn, "code": drv["name_acronym"], "team": drv["team_name"],
                      "lap_number": l["lap_number"], "lap_time_s": l["lap_duration"], "compound": comp,
                      "pole": l is pole, "team_best": id(l) in team_best,
                      "raw_samples_included": "raw_car_data" in doc, "bytes": len(text),
                      "dropouts": doc["processing"]["dropouts"]})

    all_best = sorted(({"code": drivers[dn]["name_acronym"], "team": drivers[dn]["team_name"],
                        "lap_number": l["lap_number"], "lap_time_s": l["lap_duration"],
                        "sector_s": [l["duration_sector_1"], l["duration_sector_2"], l["duration_sector_3"]],
                        "i1_speed_kmh": l["i1_speed"], "i2_speed_kmh": l["i2_speed"],
                        "speed_trap_kmh": l["st_speed"],
                        "compound": compound_for(dn, l["lap_number"])[0]}
                       for dn, l in best.items()), key=lambda r: r["lap_time_s"])
    max_speed = {k: {} for k in ("i1_speed", "i2_speed", "st_speed")}
    for l in laps:
        if l["driver_number"] in drivers:
            c = drivers[l["driver_number"]]["name_acronym"]
            for k in max_speed:
                if l.get(k):
                    max_speed[k][c] = max(max_speed[k].get(c, 0), l[k])
    deleted_laps = sorted(({"code": drivers[l["driver_number"]]["name_acronym"], "lap_number": l["lap_number"],
                            "lap_time_s": l["lap_duration"]} for l in timed if is_deleted(l)),
                          key=lambda r: (r["code"], r["lap_number"]))
    with open(os.path.join(out, pre + "index.json"), "w") as f:
        json.dump({"source": "OpenF1 API (api.openf1.org/v1)", "accessed": accessed,
                   "circuit": a.circuit, "session_key": sk, "meeting_key": sess.get("meeting_key"),
                   "session": sess["session_name"], "year": a.year, "event": sess.get("location"),
                   "circuit_short_name": sess.get("circuit_short_name"), "circuit_key": sess.get("circuit_key"),
                   "date_start_utc": sess["date_start"], "date_end_utc": sess["date_end"],
                   "note": "best laps exclude lap times deleted by race control (OpenF1 race_control)",
                   "deleted_lap_times": deleted_laps,
                   "race_control_deleted_messages": rc_deleted,
                   "drivers_in_session": len(drivers), "drivers_without_valid_lap": no_time,
                   "telemetry_laps": index, "best_lap_per_driver": all_best,
                   "max_speed_trap_kmh_session": max_speed["st_speed"],
                   "max_i1_kmh_session": max_speed["i1_speed"],
                   "max_i2_kmh_session": max_speed["i2_speed"]}, f, indent=1)

    w = f1.of1("weather", a.cache, session_key=sk)
    w.sort(key=lambda r: r["date"])
    s0, s1 = f1.ts(sess["date_start"]), f1.ts(sess["date_end"])
    # the session can overrun its scheduled end (red flags): cover every lap that was written
    s1 = max([s1] + [f1.ts(l["date_start"]) + l["lap_duration"] for l in best.values()])
    w = [r for r in w if s0 - 600 <= f1.ts(r["date"]) <= s1 + 600]
    keys = ["air_temperature", "track_temperature", "humidity", "pressure", "wind_speed",
            "wind_direction", "rainfall"]
    with open(os.path.join(out, pre + "weather.json"), "w") as f:
        json.dump({"source": "OpenF1 API weather (api.openf1.org/v1)", "accessed": accessed, "session_key": sk,
                   "units": {"air_temperature": "degC", "track_temperature": "degC", "humidity": "%",
                             "pressure": "mbar", "wind_speed": "m/s", "wind_direction": "deg",
                             "rainfall": "0/1"},
                   "date_utc": [r["date"] for r in w], **{k: [r[k] for r in w] for k in keys}},
                  f, separators=(",", ":"))

    # corner markers (MultiViewer, as FastF1 get_circuit_info uses) on the pole lap
    try:
        circ = f1.http_json(f1.MULTIVIEWER.format(key=sess["circuit_key"], year=a.year), a.cache)
    except SystemExit as e:  # e.g. HTTP 404 for a layout year
        print("MultiViewer unavailable:", e, file=sys.stderr)
        circ = None
    if circ and circ.get("corners"):
        pole_code = drivers[pole["driver_number"]]["name_acronym"].lower()
        with open(os.path.join(out, pre + pole_code + ".json")) as f:
            pch = json.load(f)["channels"]
        corners = []
        for c in circ["corners"]:
            cx, cy = c["trackPosition"]["x"] / 10.0, c["trackPosition"]["y"] / 10.0
            j = min(range(len(pch["x_m"])), key=lambda i: (pch["x_m"][i] - cx) ** 2 + (pch["y_m"][i] - cy) ** 2)
            corners.append({"number": c["number"], "letter": c.get("letter") or "",
                            "angle_deg": round(c["angle"], 1), "x_m": round(cx, 1), "y_m": round(cy, 1),
                            "distance_m_on_pole_lap": pch["distance_m"][j],
                            "match_error_m": round(math.hypot(pch["x_m"][j] - cx, pch["y_m"][j] - cy), 1)})
        with open(os.path.join(out, a.circuit + "-circuit.json"), "w") as f:
            json.dump({"source": "MultiViewer circuit API (api.multiviewer.app), as used by FastF1 get_circuit_info()",
                       "accessed": accessed, "circuit_key": sess["circuit_key"],
                       "layout_year_served": circ.get("year"), "rotation_deg": circ.get("rotation"),
                       "corners": corners}, f, indent=1)
    print("done", a.circuit, sk, "drivers", len(best), "pole",
          drivers[pole["driver_number"]]["name_acronym"], pole["lap_duration"],
          "deleted", len(deleted_laps), file=sys.stderr)


if __name__ == "__main__":
    main()
