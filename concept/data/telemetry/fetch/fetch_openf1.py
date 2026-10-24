#!/usr/bin/env python3
"""Reproduce concept/data/telemetry/*.json from public sources.

Sources
  * OpenF1 API (https://api.openf1.org/v1), historical data, no key needed:
    sessions, drivers, laps, stints, weather, car_data, location.
  * MultiViewer circuit API (https://api.multiviewer.app/api/v1/circuits/..),
    the same corner list FastF1's Session.get_circuit_info() uses.

Why not FastF1: FastF1 3.9.0 reads livetiming.formula1.com/static, which on
2026-10-24 answered HTTP 401 (CloudFront) to anonymous requests; FastF1 then
asks for F1_USERNAME / F1_PASSWORD. OpenF1 serves the same timing feed.

Standard library only. Respects the OpenF1 free tier (30 req/min).
HTTPS_PROXY and SSL_CERT_FILE from the environment are honoured by urllib.

Usage
  python3 fetch_openf1.py [--out DIR] [--cache DIR] [--year 2026]
                          [--location Silverstone] [--session Qualifying]
"""
import argparse
import bisect
import datetime as dt
import hashlib
import json
import math
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

OPENF1 = "https://api.openf1.org/v1"
MULTIVIEWER = "https://api.multiviewer.app/api/v1/circuits/{key}/{year}"
STEP_M = 5.0
WINDOW_PAD_S = 3.0
MIN_INTERVAL_S = 2.1  # 30 req/min free tier
UA = "purple-concept-telemetry/1.0 (+https://github.com/rayhankhilji/purple)"

_last_call = [0.0]


def http_json(url, cache_dir=None):
    if cache_dir:
        name = hashlib.sha1(url.encode()).hexdigest()[:16] + ".json"
        path = os.path.join(cache_dir, name)
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    for attempt in range(6):
        wait = MIN_INTERVAL_S - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=60) as r:
                data = json.loads(r.read().decode("utf-8-sig"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404 and url.startswith(OPENF1):
                data = []  # OpenF1 answers 404 "no results" for an empty query
                break
            if e.code in (429, 500, 502, 503, 504) and attempt < 5:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit("HTTP %s for %s" % (e.code, url))
    if cache_dir:
        with open(path, "w") as f:
            json.dump(data, f)
    return data


def of1(endpoint, cache_dir, **params):
    # OpenF1 filter syntax: key>value / key<value go in the key itself
    parts = []
    for k, v in params.items():
        op = "="
        if k.endswith("__gt"):
            k, op = k[:-4], ">"
        elif k.endswith("__lt"):
            k, op = k[:-4], "<"
        parts.append(urllib.parse.quote(k) + op + urllib.parse.quote(str(v), safe=""))
    return http_json(OPENF1 + "/" + endpoint + "?" + "&".join(parts), cache_dir)


def ts(s):
    return dt.datetime.fromisoformat(s).timestamp()


def iso(t):
    return dt.datetime.fromtimestamp(t, dt.timezone.utc).isoformat()


def interp(xs, ys, x):
    """Linear interpolation, xs ascending; clamps at the ends."""
    i = bisect.bisect_left(xs, x)
    if i <= 0:
        return ys[0]
    if i >= len(xs):
        return ys[-1]
    x0, x1 = xs[i - 1], xs[i]
    if x1 == x0:
        return ys[i]
    return ys[i - 1] + (ys[i] - ys[i - 1]) * (x - x0) / (x1 - x0)


def step(xs, ys, x):
    """Value of the last sample at or before x (zero-order hold)."""
    i = bisect.bisect_right(xs, x) - 1
    return ys[max(i, 0)]


def build_lap(cache, session_key, drv, lap, compound, tyre_age, preloaded=None):
    t0 = ts(lap["date_start"])
    t1 = t0 + lap["lap_duration"]
    lo, hi = iso(t0 - WINDOW_PAD_S), iso(t1 + WINDOW_PAD_S)
    if preloaded:
        car = [r for r in preloaded[0] if t0 - WINDOW_PAD_S < r["_t"] < t1 + WINDOW_PAD_S]
        loc = [r for r in preloaded[1] if t0 - WINDOW_PAD_S < r["_t"] < t1 + WINDOW_PAD_S]
    else:
        car = of1("car_data", cache, session_key=session_key, driver_number=drv["driver_number"],
                  date__gt=lo, date__lt=hi)
        loc = of1("location", cache, session_key=session_key, driver_number=drv["driver_number"],
                  date__gt=lo, date__lt=hi)
    car.sort(key=lambda r: r["date"])
    loc.sort(key=lambda r: r["date"])
    # drop duplicate timestamps
    car = [r for i, r in enumerate(car) if i == 0 or r["date"] != car[i - 1]["date"]]
    loc = [r for i, r in enumerate(loc) if i == 0 or r["date"] != loc[i - 1]["date"]]
    ct = [ts(r["date"]) - t0 for r in car]
    lt = [ts(r["date"]) - t0 for r in loc]
    v = [r["speed"] / 3.6 for r in car]
    # distance by trapezoidal integration of speed over time
    d = [0.0]
    for i in range(1, len(ct)):
        d.append(d[-1] + 0.5 * (v[i] + v[i - 1]) * (ct[i] - ct[i - 1]))
    d0 = interp(ct, d, 0.0)
    d = [x - d0 for x in d]
    length = interp(ct, d, lap["lap_duration"])
    # x/y path length over the lap (raw units are decimetres)
    lx = [r["x"] for r in loc]
    ly = [r["y"] for r in loc]
    path = 0.0
    prev = None
    tt = 0.0
    while tt <= lap["lap_duration"] + 1e-9:
        p = (interp(lt, lx, tt), interp(lt, ly, tt))
        if prev:
            path += math.hypot(p[0] - prev[0], p[1] - prev[1])
        prev = p
        tt += 0.05
    path_m = path / 10.0

    n = int(length // STEP_M)
    grid = [i * STEP_M for i in range(n + 1)]
    if length - grid[-1] > 0.5:
        grid.append(length)
    ch = {k: [] for k in ("distance_m", "time_s", "speed_kmh", "throttle_pct", "brake", "gear",
                          "rpm", "x_m", "y_m")}
    drs_vals = [r["drs"] for r in car]
    has_drs = any(x is not None for x in drs_vals)
    if has_drs:
        ch["drs"] = []
    thr = [r["throttle"] for r in car]
    rpm = [r["rpm"] for r in car]
    brk = [r["brake"] for r in car]
    gear = [r["n_gear"] for r in car]
    spd = [r["speed"] for r in car]
    for g in grid:
        t = interp(d, ct, g)
        ch["distance_m"].append(round(g, 1))
        ch["time_s"].append(round(t, 3))
        ch["speed_kmh"].append(round(interp(ct, spd, t), 1))
        ch["throttle_pct"].append(round(interp(ct, thr, t)))
        ch["brake"].append(bool(step(ct, brk, t)))
        ch["gear"].append(step(ct, gear, t))
        ch["rpm"].append(round(interp(ct, rpm, t)))
        ch["x_m"].append(round(interp(lt, lx, t) / 10.0, 1))
        ch["y_m"].append(round(interp(lt, ly, t) / 10.0, 1))
        if has_drs:
            ch["drs"].append(step(ct, drs_vals, t))

    in_lap = [r for r, t in zip(car, ct) if 0 <= t <= lap["lap_duration"]]
    in_t = [t for t in ct if 0 <= t <= lap["lap_duration"]]
    full = sum(1 for r in in_lap if r["throttle"] >= 99)
    raw = {"time_s": [round(t, 3) for t in in_t],
           "distance_m": [round(interp(ct, d, t), 1) for t in in_t],
           "speed_kmh": [r["speed"] for r in in_lap], "throttle_pct": [r["throttle"] for r in in_lap],
           "brake": [r["brake"] for r in in_lap], "gear": [r["n_gear"] for r in in_lap],
           "rpm": [r["rpm"] for r in in_lap]}
    return {
        "source": "OpenF1 API car_data + location + laps + stints (api.openf1.org/v1)",
        "session_key": session_key,
        "driver": {"number": drv["driver_number"], "code": drv["name_acronym"],
                   "name": drv["full_name"], "team": drv["team_name"]},
        "lap": {
            "lap_number": lap["lap_number"],
            "lap_time_s": lap["lap_duration"],
            "sector_s": [lap["duration_sector_1"], lap["duration_sector_2"], lap["duration_sector_3"]],
            "speed_trap_kmh": lap["st_speed"],
            "i1_speed_kmh": lap["i1_speed"],
            "i2_speed_kmh": lap["i2_speed"],
            "compound": compound,
            "tyre_age_at_stint_start_laps": tyre_age,
            "date_start_utc": lap["date_start"],
        },
        "processing": {
            "step_m": STEP_M,
            "distance": "trapezoidal integral of speed over time from lap start (OpenF1 has no distance channel)",
            "length_m_speed_integral": round(length, 1),
            "length_m_xy_path": round(path_m, 1),
            "raw_car_samples_in_lap": len(in_lap),
            "raw_location_samples_in_lap": sum(1 for t in lt if 0 <= t <= lap["lap_duration"]),
            "raw_full_throttle_sample_share": round(full / max(len(in_lap), 1), 4),
            "interpolation": "speed/throttle/rpm/x/y linear in time; brake/gear/drs zero-order hold",
            "raw_car_data": "the un-interpolated OpenF1 car_data samples inside the lap (brake 0/100 as sent)",
            "xy_units": "metres (OpenF1 x/y divided by 10), F1 timing frame",
            "drs": "present" if has_drs else "absent: OpenF1 drs field null for every sample of this lap",
        },
        "channels": ch,
        "raw_car_data": raw,
    }


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("--out", default=os.path.dirname(here))
    ap.add_argument("--cache", default=None, help="directory to cache raw API responses")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--location", default="Silverstone")
    ap.add_argument("--session", default="Qualifying")
    ap.add_argument("--race-drivers", default="VER,HAD",
                    help="comma-separated codes for race laps ('' to skip)")
    a = ap.parse_args()
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
    os.makedirs(a.out, exist_ok=True)
    accessed = dt.date.today().isoformat()

    sessions = of1("sessions", a.cache, year=a.year, location=a.location)
    sess = [s for s in sessions if s["session_name"] == a.session]
    if not sess:
        raise SystemExit("no %s session for %s %s" % (a.session, a.location, a.year))
    sess = sess[0]
    sk = sess["session_key"]
    print("session", sk, sess["session_name"], sess["date_start"], file=sys.stderr)

    drivers = {d["driver_number"]: d for d in of1("drivers", a.cache, session_key=sk)}
    laps = of1("laps", a.cache, session_key=sk)
    stints = of1("stints", a.cache, session_key=sk)

    def compound_for(dn, ln):
        for s in stints:
            if s["driver_number"] == dn and s["lap_start"] <= ln <= (s["lap_end"] or 999):
                return s["compound"], s["tyre_age_at_start"]
        return None, None

    # lap times deleted by race control (track limits etc.) are not eligible
    deleted = set()
    for r in of1("race_control", a.cache, session_key=sk):
        m = re.search(r"CAR (\d+) \(\w+\) TIME (\d+):(\d+\.\d+) DELETED", r.get("message") or "")
        if m:
            deleted.add((int(m.group(1)), round(int(m.group(2)) * 60 + float(m.group(3)), 3)))

    def is_deleted(l):
        return (l["driver_number"], round(l["lap_duration"], 3)) in deleted

    timed = [l for l in laps if l.get("lap_duration") and l.get("date_start")
             and l["driver_number"] in drivers and not is_deleted(l)]
    best = {}
    for l in timed:
        dn = l["driver_number"]
        if dn not in best or l["lap_duration"] < best[dn]["lap_duration"]:
            best[dn] = l
    by_team = {}
    for dn, l in best.items():
        team = drivers[dn]["team_name"]
        if team not in by_team or l["lap_duration"] < by_team[team]["lap_duration"]:
            by_team[team] = l
    pole = min(best.values(), key=lambda l: l["lap_duration"])

    index = []
    team_best = {id(l) for l in by_team.values()}
    for l in sorted(best.values(), key=lambda l: l["lap_duration"]):
        drv = drivers[l["driver_number"]]
        team = drv["team_name"]
        comp, age = compound_for(l["driver_number"], l["lap_number"])
        print("lap", drv["name_acronym"], team, l["lap_duration"], file=sys.stderr)
        doc = build_lap(a.cache, sk, drv, l, comp, age)
        doc["session"] = {"year": a.year, "event": sess.get("location"), "session": a.session,
                          "date_start_utc": sess["date_start"]}
        doc["accessed"] = accessed
        doc["is_pole_lap"] = l is pole
        doc["is_team_best"] = id(l) in team_best
        fn = "silverstone-2026-q-%s.json" % drv["name_acronym"].lower()
        with open(os.path.join(a.out, fn), "w") as f:
            json.dump(doc, f, separators=(",", ":"))
        index.append({"file": fn, "code": drv["name_acronym"], "team": team,
                      "lap_time_s": l["lap_duration"], "compound": comp, "pole": l is pole,
                      "team_best": id(l) in team_best})

    # session best laps of every driver (timing only, no telemetry)
    all_best = sorted(({"code": drivers[dn]["name_acronym"], "team": drivers[dn]["team_name"],
                        "lap_number": l["lap_number"], "lap_time_s": l["lap_duration"],
                        "sector_s": [l["duration_sector_1"], l["duration_sector_2"], l["duration_sector_3"]],
                        "speed_trap_kmh": l["st_speed"]}
                       for dn, l in best.items()), key=lambda r: r["lap_time_s"])
    max_st = {}
    for l in laps:
        if l.get("st_speed") and l["driver_number"] in drivers:
            c = drivers[l["driver_number"]]["name_acronym"]
            max_st[c] = max(max_st.get(c, 0), l["st_speed"])
    deleted_laps = sorted(({"code": drivers[l["driver_number"]]["name_acronym"], "lap_number": l["lap_number"],
                            "lap_time_s": l["lap_duration"]} for l in laps
                           if l.get("lap_duration") and l["driver_number"] in drivers and is_deleted(l)),
                          key=lambda r: (r["code"], r["lap_number"]))
    with open(os.path.join(a.out, "silverstone-2026-q-index.json"), "w") as f:
        json.dump({"source": "OpenF1 API (api.openf1.org/v1)", "accessed": accessed,
                   "note": "best laps exclude lap times deleted by race control (OpenF1 race_control)",
                   "deleted_lap_times": deleted_laps,
                   "session_key": sk, "session": a.session, "year": a.year,
                   "telemetry_laps": index, "best_lap_per_driver": all_best,
                   "max_speed_trap_kmh_session": max_st}, f, indent=1)

    # weather during the session
    w = of1("weather", a.cache, session_key=sk)
    w.sort(key=lambda r: r["date"])
    s0, s1 = ts(sess["date_start"]), ts(sess["date_end"])
    w = [r for r in w if s0 - 600 <= ts(r["date"]) <= s1 + 600]
    keys = ["air_temperature", "track_temperature", "humidity", "pressure", "wind_speed",
            "wind_direction", "rainfall"]
    with open(os.path.join(a.out, "silverstone-2026-q-weather.json"), "w") as f:
        json.dump({"source": "OpenF1 API weather (api.openf1.org/v1)", "accessed": accessed,
                   "session_key": sk,
                   "units": {"air_temperature": "degC", "track_temperature": "degC",
                             "humidity": "%", "pressure": "mbar", "wind_speed": "m/s",
                             "wind_direction": "deg", "rainfall": "0/1"},
                   "date_utc": [r["date"] for r in w],
                   **{k: [r[k] for r in w] for k in keys}}, f, separators=(",", ":"))

    # circuit corners (MultiViewer, as FastF1 uses) + distance on the pole lap
    circ = http_json(MULTIVIEWER.format(key=sess["circuit_key"], year=a.year), a.cache)
    pole_code = drivers[pole["driver_number"]]["name_acronym"].lower()
    with open(os.path.join(a.out, "silverstone-2026-q-%s.json" % pole_code)) as f:
        pch = json.load(f)["channels"]
    corners = []
    for c in circ["corners"]:
        cx, cy = c["trackPosition"]["x"] / 10.0, c["trackPosition"]["y"] / 10.0
        j = min(range(len(pch["x_m"])), key=lambda i: (pch["x_m"][i] - cx) ** 2 + (pch["y_m"][i] - cy) ** 2)
        corners.append({"number": c["number"], "letter": c.get("letter") or "",
                        "angle_deg": round(c["angle"], 1), "x_m": round(cx, 1), "y_m": round(cy, 1),
                        "distance_m_on_pole_lap": pch["distance_m"][j],
                        "match_error_m": round(math.hypot(pch["x_m"][j] - cx, pch["y_m"][j] - cy), 1)})
    with open(os.path.join(a.out, "silverstone-circuit.json"), "w") as f:
        json.dump({"source": "MultiViewer circuit API (api.multiviewer.app), as used by FastF1 get_circuit_info()",
                   "accessed": accessed, "circuit_key": sess["circuit_key"],
                   "layout_year_served": circ.get("year"), "rotation_deg": circ.get("rotation"),
                   "corners": corners}, f, indent=1)

    if a.race_drivers:
        fetch_race(a, accessed, [c.strip().upper() for c in a.race_drivers.split(",") if c.strip()])


RACE_CHUNK_S = 900  # full-race car_data / location are fetched in 15-minute windows


def fetch_full(cache, endpoint, sk, dn, s0, s1):
    out = []
    t = s0
    while t < s1:
        out += of1(endpoint, cache, session_key=sk, driver_number=dn,
                   date__gt=iso(t), date__lt=iso(min(t + RACE_CHUNK_S, s1)))
        t += RACE_CHUNK_S
    for r in out:
        r["_t"] = ts(r["date"])
    out.sort(key=lambda r: r["_t"])
    return [r for i, r in enumerate(out) if i == 0 or r["_t"] != out[i - 1]["_t"]]


def fetch_race(a, accessed, codes):
    sessions = of1("sessions", a.cache, year=a.year, location=a.location)
    sess = [x for x in sessions if x["session_name"] == "Race"][0]
    sk = sess["session_key"]
    s0, s1 = ts(sess["date_start"]) - 600, ts(sess["date_end"]) + 600
    print("race session", sk, file=sys.stderr)
    drivers = {d["driver_number"]: d for d in of1("drivers", a.cache, session_key=sk)}
    laps = of1("laps", a.cache, session_key=sk)
    stints = of1("stints", a.cache, session_key=sk)
    pits = of1("pit", a.cache, session_key=sk)
    rc = of1("race_control", a.cache, session_key=sk)
    race_laps = max(l["lap_number"] for l in laps)

    # neutralised periods: VSC / SC deployed until ending (+90 s to cover the restart)
    neutral, open_t = [], None
    for r in sorted(rc, key=lambda r: r["date"]):
        m = (r.get("message") or "").upper()
        if r.get("category") != "SafetyCar":
            continue
        if "DEPLOYED" in m and open_t is None:
            open_t = ts(r["date"])
        elif ("ENDING" in m or "IN THIS LAP" in m) and open_t is not None:
            # VSC ENDING: green ~10-15 s later; SC IN THIS LAP: green at the end of that lap
            neutral.append((open_t, ts(r["date"]) + (20 if "ENDING" in m else 120)))
            open_t = None
    if open_t is not None:
        neutral.append((open_t, s1))
    deleted = set()
    for r in rc:
        m = re.search(r"CAR (\d+) \(\w+\) TIME (\d+):(\d+\.\d+) DELETED", r.get("message") or "")
        if m:
            deleted.add((int(m.group(1)), round(int(m.group(2)) * 60 + float(m.group(3)), 3)))

    by_code = {d["name_acronym"]: d for d in drivers.values()}
    index = {"source": "OpenF1 API (api.openf1.org/v1)", "accessed": accessed, "session_key": sk,
             "session": "Race", "year": a.year, "race_laps": race_laps,
             "neutralised_utc": [[iso(x), iso(y)] for x, y in neutral],
             "eligibility": "green laps only: not lap 1, not pit in/out laps, not overlapping a VSC/SC "
                            "period (VSC: deployed to ENDING + 20 s; SC: deployed to IN THIS LAP + 120 s), lap time not deleted by race control",
             "overtake_note": "OpenF1 carries no Overtake-mode (or DRS / active-aero) channel. The 'overtake' lap "
                              "is the green lap with the highest full-throttle share among laps in which OpenF1 "
                              "`overtakes` records an on-track pass by this driver (passes on a car that pitted "
                              "within 60 s are ignored); min_gap_ahead_s comes from OpenF1 `intervals`.",
             "drivers": {}}
    for code in codes:
        drv = by_code[code]
        dn = drv["driver_number"]
        car = fetch_full(a.cache, "car_data", sk, dn, s0, s1)
        loc = fetch_full(a.cache, "location", sk, dn, s0, s1)
        ivals = of1("intervals", a.cache, session_key=sk, driver_number=dn)
        passes = of1("overtakes", a.cache, session_key=sk, overtaking_driver_number=dn)
        pit_laps = {p["lap_number"] for p in pits if p["driver_number"] == dn}
        my = sorted((l for l in laps if l["driver_number"] == dn), key=lambda l: l["lap_number"])
        cts = [r["_t"] for r in car]

        def ctx(l):
            for st in stints:
                if st["driver_number"] == dn and st["lap_start"] <= l["lap_number"] <= (st["lap_end"] or 999):
                    return {"stint": st["stint_number"], "compound": st["compound"],
                            "tyre_age_laps": st["tyre_age_at_start"] + l["lap_number"] - st["lap_start"]}
            return {"stint": None, "compound": None, "tyre_age_laps": None}

        rows = []
        for l in my:
            if not l.get("lap_duration") or not l.get("date_start"):
                continue
            t0 = ts(l["date_start"])
            t1 = t0 + l["lap_duration"]
            green = (l["lap_number"] > 1 and not l.get("is_pit_out_lap") and l["lap_number"] not in pit_laps
                     and not any(x < t1 and t0 < y for x, y in neutral)
                     and (dn, round(l["lap_duration"], 3)) not in deleted)
            i, j = bisect.bisect_left(cts, t0), bisect.bisect_right(cts, t1)
            smp = car[i:j]
            share = sum(1 for r in smp if r["throttle"] >= 99) / max(len(smp), 1)
            ps = []
            for p in passes:
                pt = ts(p["date"])
                if t0 <= pt <= t1 and not any(q["driver_number"] == p["overtaken_driver_number"]
                                              and abs(ts(q["date"]) - pt) < 60 for q in pits):
                    ps.append(drivers.get(p["overtaken_driver_number"], {}).get("name_acronym",
                                                                              p["overtaken_driver_number"]))
            gaps = [iv["interval"] for iv in ivals
                    if isinstance(iv.get("interval"), (int, float)) and t0 - 5 <= ts(iv["date"]) <= t1]
            rows.append({"lap_number": l["lap_number"], "lap_time_s": l["lap_duration"], "green": green,
                         "full_throttle_share": round(share, 4), "passes": ps,
                         "min_gap_ahead_s": min(gaps) if gaps else None, **ctx(l), "_lap": l})
        greens = [r for r in rows if r["green"]]
        picks = [("fastest%d" % (k + 1), r) for k, r in enumerate(sorted(greens, key=lambda r: r["lap_time_s"])[:3])]
        taken = {id(r) for _, r in picks}
        rest = [r for r in greens if id(r) not in taken]
        cand = [r for r in rest if r["passes"]]
        if cand:
            picks.append(("overtake", max(cand, key=lambda r: r["full_throttle_share"])))
        elif rest:
            picks.append(("full_throttle", max(rest, key=lambda r: r["full_throttle_share"])))
        files = []
        for role, r in picks:
            l = r["_lap"]
            print("race lap", code, role, l["lap_number"], l["lap_duration"], file=sys.stderr)
            doc = build_lap(a.cache, sk, drv, l, r["compound"], None, preloaded=(car, loc))
            doc["session"] = {"year": a.year, "event": sess.get("location"), "session": "Race",
                              "date_start_utc": sess["date_start"]}
            doc["accessed"] = accessed
            doc["role"] = role
            doc["race_context"] = {k: r[k] for k in ("lap_number", "stint", "compound", "tyre_age_laps",
                                                     "full_throttle_share", "passes", "min_gap_ahead_s")}
            doc["race_context"]["race_laps"] = race_laps
            doc["race_context"]["laps_remaining_after"] = race_laps - l["lap_number"]
            doc["race_context"]["fuel_note"] = ("fuel load is not published; lap number, laps remaining "
                                                "and pit history are the available proxies")
            doc["lap"].pop("tyre_age_at_stint_start_laps", None)
            doc["lap"]["tyre_age_laps"] = r["tyre_age_laps"]
            fn = "silverstone-2026-r-%s-lap%02d.json" % (code.lower(), l["lap_number"])
            with open(os.path.join(a.out, fn), "w") as f:
                json.dump(doc, f, separators=(",", ":"))
            files.append({"file": fn, "role": role, "lap_number": l["lap_number"],
                          "lap_time_s": l["lap_duration"], "compound": r["compound"],
                          "tyre_age_laps": r["tyre_age_laps"]})
        index["drivers"][code] = {
            "team": drv["team_name"], "laps_in_data": len(my), "pit_laps": sorted(pit_laps),
            "telemetry_laps": files,
            "laps": [{k: v for k, v in r.items() if k != "_lap"} for r in rows]}
    with open(os.path.join(a.out, "silverstone-2026-r-index.json"), "w") as f:
        json.dump(index, f, separators=(",", ":"))


if __name__ == "__main__":
    main()
