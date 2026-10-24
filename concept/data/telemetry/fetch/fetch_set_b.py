#!/usr/bin/env python3
"""Telemetry set B: 2026 qualifying at Suzuka, Hungaroring, Singapore and Montreal.

Adapted from fetch_openf1.py (the Silverstone pipeline), which is left untouched. Same source
(OpenF1, https://api.openf1.org/v1), same 5 m grid, same lap file format. Differences:
  * one folder per circuit under concept/data/telemetry/<slug>/, files named <slug>-2026-q-<code>.json
  * the session is looked up from the OpenF1 `sessions` endpoint by circuit_short_name and must have
    ended before --today (default 2026-10-24)
  * a lap file over 80 KB loses its `raw_car_data` block (the 5 m grid stays)
  * extra quality fields (largest gap between car_data samples, X/Y start/end gap)
  * `derive` sub-command prints the README tables (corners, straights, lap list) with no network use

Standard library only. Respects the OpenF1 free tier (30 req/min) and backs off on 429.
HTTPS_PROXY and SSL_CERT_FILE from the environment are honoured by urllib; TLS is always verified.

Usage
  python3 fetch_set_b.py fetch  [--cache DIR] [--out DIR] [--only suzuka,...]
  python3 fetch_set_b.py derive --circuit suzuka [--lap RUS] [--out DIR]
"""
import argparse
import bisect
import datetime as dt
import hashlib
import json
import math
import os
import re
import statistics
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
MAX_FILE_BYTES = 80 * 1024
DROPOUT_GAP_S = 1.5  # car_data gap above which the channels are treated as missing
UA = "purple-concept-telemetry/1.0 (+https://github.com/rayhankhilji/purple)"

# slug -> OpenF1 circuit_short_name (as in `sessions`) and the grand prix name
CIRCUITS = {
    "suzuka": {"short": "Suzuka", "gp": "Japanese Grand Prix"},
    "hungaroring": {"short": "Hungaroring", "gp": "Hungarian Grand Prix"},
    "singapore": {"short": "Singapore", "gp": "Singapore Grand Prix"},
    "montreal": {"short": "Montreal", "gp": "Canadian Grand Prix"},
}

_last_call = [0.0]


def http_json(url, cache_dir=None):
    if cache_dir:
        name = hashlib.sha1(url.encode()).hexdigest()[:16] + ".json"
        path = os.path.join(cache_dir, name)
        if os.path.exists(path):
            with open(path) as f:
                return json.load(f)
    data = None
    for attempt in range(8):
        wait = MIN_INTERVAL_S - (time.time() - _last_call[0])
        if wait > 0:
            time.sleep(wait)
        _last_call[0] = time.time()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "application/json"})
        try:
            with urllib.request.urlopen(req, timeout=90) as r:
                data = json.loads(r.read().decode("utf-8-sig"))
            break
        except urllib.error.HTTPError as e:
            if e.code == 404 and url.startswith(OPENF1):
                data = []  # OpenF1 answers 404 "no results" for an empty query
                break
            if e.code in (429, 500, 502, 503, 504) and attempt < 7:
                ra = e.headers.get("Retry-After")
                time.sleep(float(ra) if ra and ra.isdigit() else 5 * 2 ** min(attempt, 4))
                continue
            raise SystemExit("HTTP %s for %s" % (e.code, url))
        except (urllib.error.URLError, TimeoutError, ConnectionError) as e:
            if attempt < 7:
                time.sleep(5 * (attempt + 1))
                continue
            raise SystemExit("network error %s for %s" % (e, url))
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


def build_lap(cache, session_key, drv, lap, compound, tyre_age):
    t0 = ts(lap["date_start"])
    t1 = t0 + lap["lap_duration"]
    lo, hi = iso(t0 - WINDOW_PAD_S), iso(t1 + WINDOW_PAD_S)
    car = of1("car_data", cache, session_key=session_key, driver_number=drv["driver_number"],
              date__gt=lo, date__lt=hi)
    loc = of1("location", cache, session_key=session_key, driver_number=drv["driver_number"],
              date__gt=lo, date__lt=hi)
    car.sort(key=lambda r: r["date"])
    loc.sort(key=lambda r: r["date"])
    car = [r for i, r in enumerate(car) if i == 0 or r["date"] != car[i - 1]["date"]]
    loc = [r for i, r in enumerate(loc) if i == 0 or r["date"] != loc[i - 1]["date"]]
    if len(car) < 50 or len(loc) < 50:
        raise SystemExit("too few samples for %s lap %s: car %d loc %d" % (
            drv["name_acronym"], lap["lap_number"], len(car), len(loc)))
    T = lap["lap_duration"]

    # --- car_data dropouts -------------------------------------------------------------------
    # During a dropout the feed repeats one frozen sample and marks it with throttle > 100 and/or brake
    # not in {0, 100} (e.g. throttle 104, brake 104). The sample just before the first marked one is
    # frozen too, so any run of 3+ identical (speed, rpm, throttle, gear) samples counts as frozen.
    # Frozen / marked samples are dropped. They are never replaced by estimates.
    bad = [r["throttle"] > 100 or r["brake"] not in (0, 100) for r in car]
    i = 0
    while i < len(car):
        j = i
        key = (car[i]["speed"], car[i]["rpm"], car[i]["throttle"], car[i]["n_gear"])
        while j + 1 < len(car) and (car[j + 1]["speed"], car[j + 1]["rpm"], car[j + 1]["throttle"],
                                    car[j + 1]["n_gear"]) == key:
            j += 1
        if j - i + 1 >= 3:
            for k in range(i + 1, j + 1):
                bad[k] = True
        i = j + 1
    n_dropped = sum(1 for r, b in zip(car, bad) if b and 0 <= ts(r["date"]) - t0 <= T)
    car = [r for r, b in zip(car, bad) if not b]
    ct = [ts(r["date"]) - t0 for r in car]
    lt = [ts(r["date"]) - t0 for r in loc]
    lx = [r["x"] for r in loc]
    ly = [r["y"] for r in loc]

    # cumulative X/Y path length S(t) in metres (location is not affected by the car_data dropouts)
    st_t = [lt[0] + k * 0.05 for k in range(int((lt[-1] - lt[0]) / 0.05) + 1)]
    S = [0.0]
    for k in range(1, len(st_t)):
        S.append(S[-1] + math.hypot(interp(lt, lx, st_t[k]) - interp(lt, lx, st_t[k - 1]),
                                    interp(lt, ly, st_t[k]) - interp(lt, ly, st_t[k - 1])) / 10.0)

    def xy_s(t):
        return interp(st_t, S, t)

    # --- distance: trapezoid of speed over valid samples; X/Y arc length across a dropout > GAP_S ---
    v = [r["speed"] / 3.6 for r in car]
    cn_t, cn_v = list(ct), list(v)
    if cn_t[0] - lt[0] > DROPOUT_GAP_S:  # no valid sample at the start of the window: virtual node
        cn_t.insert(0, lt[0])
        cn_v.insert(0, None)
    if lt[-1] - cn_t[-1] > DROPOUT_GAP_S:  # no valid sample at the end of the window
        cn_t.append(lt[-1])
        cn_v.append(None)
    tn, dn = [cn_t[0]], [0.0]
    gaps_out = []
    for i in range(1, len(cn_t)):
        if cn_t[i] - cn_t[i - 1] > DROPOUT_GAP_S:
            k = int((cn_t[i] - cn_t[i - 1]) / 0.25)
            for q in range(1, k + 2):
                tq = cn_t[i - 1] + q * (cn_t[i] - cn_t[i - 1]) / (k + 1)
                dn.append(dn[-1] + xy_s(tq) - xy_s(tn[-1]))
                tn.append(tq)
            gaps_out.append((cn_t[i - 1], cn_t[i]))
        else:
            tn.append(cn_t[i])
            dn.append(dn[-1] + 0.5 * (cn_v[i] + cn_v[i - 1]) * (cn_t[i] - cn_t[i - 1]))
    d0 = interp(tn, dn, 0.0)
    dn = [x - d0 for x in dn]
    length = interp(tn, dn, T)
    d_gap_total = 0.0
    dropouts = []
    for (ga, gb) in gaps_out:
        a_, b_ = max(ga, 0.0), min(gb, T)
        if b_ > a_:
            dropouts.append({"t_start_s": round(a_, 2), "t_end_s": round(b_, 2),
                             "distance_start_m": round(interp(tn, dn, a_), 1),
                             "distance_end_m": round(interp(tn, dn, b_), 1)})
            d_gap_total += interp(tn, dn, b_) - interp(tn, dn, a_)
    # xy path over the lap
    path = 0.0
    tt = 0.0
    prev = None
    while tt <= T + 1e-9:
        p = (interp(lt, lx, tt), interp(lt, ly, tt))
        if prev:
            path += math.hypot(p[0] - prev[0], p[1] - prev[1])
        prev = p
        tt += 0.05
    path_m = path / 10.0
    p0 = (interp(lt, lx, 0.0), interp(lt, ly, 0.0))
    p1 = (interp(lt, lx, T), interp(lt, ly, T))
    xy_gap = math.hypot(p1[0] - p0[0], p1[1] - p0[1]) / 10.0
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
        t = interp(dn, tn, g)
        ch["distance_m"].append(round(g, 1))
        ch["time_s"].append(round(t, 3))
        if any(ga < t < gb for ga, gb in gaps_out):
            # inside a dropout: the car channels are missing (null), X/Y are still measured
            for k in ("speed_kmh", "throttle_pct", "brake", "gear", "rpm"):
                ch[k].append(None)
            if has_drs:
                ch["drs"].append(None)
        else:
            ch["speed_kmh"].append(round(interp(ct, spd, t), 1))
            ch["throttle_pct"].append(round(interp(ct, thr, t)))
            ch["brake"].append(bool(step(ct, brk, t)))
            ch["gear"].append(step(ct, gear, t))
            ch["rpm"].append(round(interp(ct, rpm, t)))
            if has_drs:
                ch["drs"].append(step(ct, drs_vals, t))
        ch["x_m"].append(round(interp(lt, lx, t) / 10.0, 1))
        ch["y_m"].append(round(interp(lt, ly, t) / 10.0, 1))

    sel = [(r, t) for r, t in zip(car, ct) if 0 <= t <= T]
    in_lap = [r for r, _ in sel]
    in_t = [t for _, t in sel]
    gaps = [b - a for a, b in zip(in_t, in_t[1:])]
    full = sum(1 for r in in_lap if r["throttle"] >= 99)
    raw = {"time_s": [round(t, 3) for t in in_t],
           "distance_m": [round(interp(tn, dn, t), 1) for t in in_t],
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
            "distance": ("trapezoidal integral of speed over time from lap start (OpenF1 has no distance channel); "
                         "across a car_data dropout longer than %.1f s the increment is the X/Y arc length instead" % DROPOUT_GAP_S),
            "length_m": round(length, 1),
            "distance_from_xy_during_dropouts_m": round(d_gap_total, 1),
            "dropouts": dropouts,
            "invalid_car_samples_dropped": n_dropped,
            "dropout_rule": ("car_data samples with throttle > 100 or brake not in {0,100}, and runs of 3+ identical "
                             "(speed, rpm, throttle, gear) samples after the first, are dropped; where the remaining "
                             "samples are more than %.1f s apart the speed/throttle/brake/gear/rpm grid values are null" % DROPOUT_GAP_S),
            "length_m_xy_path": round(path_m, 1),
            "xy_start_end_gap_m": round(xy_gap, 1),
            "raw_car_samples_in_lap": len(in_lap),
            "max_gap_between_car_samples_s": round(max(gaps), 3) if gaps else None,
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


def resolve_deleted(rc, laps, drivers):
    """Map race-control 'DELETED' messages to (driver, lap). Message forms seen in 2026:
      'CAR 11 (PER) TIME 1:31.451 DELETED - ...'            -> lap with that time
      'CAR LEC TIME 1:36.518 DELETED - ... (Q1)'             -> lap with that time
      'CAR 10 (GAS) LAP DELETED - ... LAP 4 16:08:19 (PIT)'  -> the driver's lap containing that local clock time
      'CAR 12 (ANT) LAP DELETED - ... (NEXT LAP PIT)'        -> no lap id: the lap that ended last before the message
      'CAR LAW TIME DELETED - ... (Q2)'                      -> no lap id and posted after the session: unresolved
    Returns one dict per message; 'lap_number' is None when it cannot be resolved."""
    by_num = {d["driver_number"]: d for d in drivers.values()}
    by_code = {d["name_acronym"]: d["driver_number"] for d in drivers.values()}
    done = [l for l in laps if l.get("lap_duration") and l.get("date_start")]
    out = []
    for r in rc:
        msg = r.get("message") or ""
        if "DELETED" not in msg.upper():
            continue
        mt = ts(r["date"])
        dn = None
        m = re.search(r"CAR (\d+)\b", msg)
        if m:
            dn = int(m.group(1))
        else:
            m = re.search(r"CAR ([A-Z]{3})\b", msg)
            if m:
                dn = by_code.get(m.group(1))
        mine = [l for l in done if l["driver_number"] == dn]
        lap, method = None, "unresolved"
        tm = re.search(r"TIME (\d+):(\d+\.\d+)", msg)
        ck = re.search(r"LAP (\d+) (\d\d):(\d\d):(\d\d)", msg)
        if tm:
            secs = round(int(tm.group(1)) * 60 + float(tm.group(2)), 3)
            c = [l for l in mine if round(l["lap_duration"], 3) == secs]
            if c:
                lap, method = c[0], "lap time in message"
        elif ck:
            local = int(ck.group(2)) * 3600 + int(ck.group(3)) * 60 + int(ck.group(4))
            day = dt.datetime.fromtimestamp(mt, dt.timezone.utc).replace(hour=0, minute=0, second=0)
            utc_s = mt - day.timestamp()
            off = round(((local - utc_s + 43200) % 86400 - 43200) / 3600.0)  # local clock minus UTC, hours
            cand = [day.timestamp() + local - off * 3600 + k * 86400 for k in (-1, 0, 1)]
            tt = min(cand, key=lambda x: abs(x - mt))
            c = [l for l in mine if ts(l["date_start"]) - 1 <= tt <= ts(l["date_start"]) + l["lap_duration"] + 1]
            if c:
                lap, method = c[0], "clock time in message (UTC offset %+dh); lap number in message %s" % (
                    off, ck.group(1))
            else:
                # the lap may have no recorded time (aborted / stoppage): bound it by the next lap's start
                allm = sorted((l for l in laps if l["driver_number"] == dn and l.get("date_start")),
                              key=lambda l: l["lap_number"])
                for l, nx in zip(allm, allm[1:]):
                    if ts(l["date_start"]) - 1 <= tt <= ts(nx["date_start"]) and not l.get("lap_duration"):
                        lap, method = l, ("clock time in message (UTC offset %+dh) falls in an OpenF1 lap with no "
                                          "recorded time; lap number in message %s" % (off, ck.group(1)))
                        break
        elif "(Q" not in msg:
            c = [l for l in mine if ts(l["date_start"]) + l["lap_duration"] <= mt + 1
                 and mt - (ts(l["date_start"]) + l["lap_duration"]) < 300]
            if c:
                lap = max(c, key=lambda l: ts(l["date_start"]))
                method = "inferred: lap that ended last before the message"
        out.append({"date": r["date"], "message": msg, "car": dn,
                    "code": by_num[dn]["name_acronym"] if dn in by_num else None,
                    "lap_number": lap["lap_number"] if lap else None,
                    "lap_time_s": lap["lap_duration"] if lap else None, "method": method})
    return out


def fetch_circuit(slug, cfg, a, accessed):
    out = os.path.join(a.out, slug)
    os.makedirs(out, exist_ok=True)
    sessions = of1("sessions", a.cache, year=a.year, circuit_short_name=cfg["short"])
    sess = [s for s in sessions if s["session_name"] == "Qualifying"]
    if not sess:
        raise SystemExit("no Qualifying session for %s %s" % (cfg["short"], a.year))
    sess = sess[0]
    if ts(sess["date_end"]) > ts(a.today + "T00:00:00+00:00"):
        raise SystemExit("%s qualifying has not finished before %s" % (slug, a.today))
    sk = sess["session_key"]
    print(slug, "session", sk, sess["date_start"], file=sys.stderr)

    drivers = {d["driver_number"]: d for d in of1("drivers", a.cache, session_key=sk)}
    laps = of1("laps", a.cache, session_key=sk)
    stints = of1("stints", a.cache, session_key=sk)
    rc = of1("race_control", a.cache, session_key=sk)
    deleted_msgs = resolve_deleted(rc, laps, drivers)
    for m in deleted_msgs:
        if m["lap_number"] is None:
            print("NOTE: DELETED message not tied to a lap:", m["message"], file=sys.stderr)
    deleted = {(m["car"], m["lap_number"]) for m in deleted_msgs if m["lap_number"] is not None}

    def compound_for(dn, ln):
        for s in stints:
            if s["driver_number"] == dn and s["lap_start"] <= ln <= (s["lap_end"] or 999):
                return s["compound"], s["tyre_age_at_start"]
        return None, None

    def is_deleted(l):
        return (l["driver_number"], l["lap_number"]) in deleted

    # a flying lap has a time and all three sectors; this drops laps cut short by a stoppage or crash
    # (Singapore HAD lap 2: 263.003 s with only sector 1)
    timed = [l for l in laps if l.get("lap_duration") and l.get("date_start")
             and l["driver_number"] in drivers and not l.get("is_pit_out_lap")
             and all(l.get("duration_sector_%d" % k) for k in (1, 2, 3))]
    valid = [l for l in timed if not is_deleted(l)]
    best = {}
    for l in valid:
        dn = l["driver_number"]
        if dn not in best or l["lap_duration"] < best[dn]["lap_duration"]:
            best[dn] = l
    by_team = {}
    for dn, l in best.items():
        team = drivers[dn]["team_name"]
        if team not in by_team or l["lap_duration"] < by_team[team]["lap_duration"]:
            by_team[team] = l
    pole = min(best.values(), key=lambda l: l["lap_duration"])
    team_best = {id(l) for l in by_team.values()}

    index, oversize = [], []
    for l in sorted(best.values(), key=lambda l: l["lap_duration"]):
        drv = drivers[l["driver_number"]]
        comp, age = compound_for(l["driver_number"], l["lap_number"])
        print("lap", drv["name_acronym"], drv["team_name"], l["lap_duration"], file=sys.stderr)
        doc = build_lap(a.cache, sk, drv, l, comp, age)
        doc["session"] = {"year": a.year, "event": sess.get("location"), "circuit": sess.get("circuit_short_name"),
                          "session": "Qualifying", "date_start_utc": sess["date_start"]}
        doc["accessed"] = accessed
        doc["is_pole_lap"] = l is pole
        doc["is_team_best"] = id(l) in team_best
        fn = "%s-2026-q-%s.json" % (slug, drv["name_acronym"].lower())
        text = json.dumps(doc, separators=(",", ":"))
        if len(text.encode()) > MAX_FILE_BYTES:
            doc.pop("raw_car_data")
            doc["processing"]["raw_car_data"] = ("dropped: the file would exceed 80 KB; raw sample count is in "
                                                 "raw_car_samples_in_lap")
            text = json.dumps(doc, separators=(",", ":"))
            oversize.append(drv["name_acronym"])
        with open(os.path.join(out, fn), "w") as f:
            f.write(text)
        index.append({"file": fn, "code": drv["name_acronym"], "team": drv["team_name"],
                      "lap_number": l["lap_number"], "lap_time_s": l["lap_duration"],
                      "sector_s": [l["duration_sector_1"], l["duration_sector_2"], l["duration_sector_3"]],
                      "speed_trap_kmh": l["st_speed"], "compound": comp, "pole": l is pole,
                      "team_best": id(l) in team_best,
                      "length_m": doc["processing"]["length_m"],
                      "dropout_s": round(sum(x["t_end_s"] - x["t_start_s"] for x in doc["processing"]["dropouts"]), 2),
                      "invalid_car_samples_dropped": doc["processing"]["invalid_car_samples_dropped"],
                      "length_m_xy_path": doc["processing"]["length_m_xy_path"],
                      "xy_start_end_gap_m": doc["processing"]["xy_start_end_gap_m"],
                      "max_gap_between_car_samples_s": doc["processing"]["max_gap_between_car_samples_s"],
                      "file_bytes": len(text.encode()), "raw_dropped": drv["name_acronym"] in oversize})

    max_st = {}
    for l in laps:
        if l.get("st_speed") and l["driver_number"] in drivers:
            c = drivers[l["driver_number"]]["name_acronym"]
            max_st[c] = max(max_st.get(c, 0), l["st_speed"])
    deleted_laps = sorted(({"code": drivers[l["driver_number"]]["name_acronym"], "lap_number": l["lap_number"],
                            "lap_time_s": l["lap_duration"]} for l in timed if is_deleted(l)),
                          key=lambda r: (r["code"], r["lap_number"]))
    no_time = sorted(drivers[dn]["name_acronym"] for dn in drivers if dn not in best)
    with open(os.path.join(out, "%s-2026-q-index.json" % slug), "w") as f:
        json.dump({"source": "OpenF1 API (api.openf1.org/v1)", "accessed": accessed,
                   "note": "best laps exclude lap times deleted by race control (OpenF1 race_control) and pit-out laps",
                   "session_key": sk, "session": "Qualifying", "year": a.year,
                   "grand_prix": cfg["gp"], "circuit": sess.get("circuit_short_name"),
                   "session_start_utc": sess["date_start"], "session_end_utc": sess["date_end"],
                   "drivers_in_session": len(drivers), "drivers_without_valid_timed_lap": no_time,
                   "deleted_lap_times": deleted_laps,
                   "race_control_deleted_messages": deleted_msgs,
                   "telemetry_laps": index,
                   "max_speed_trap_kmh_session": max_st}, f, indent=1)

    w = of1("weather", a.cache, session_key=sk)
    w.sort(key=lambda r: r["date"])
    # the scheduled session end can be earlier than the last lap (Singapore ran about 20 minutes late)
    s0 = ts(sess["date_start"])
    s1 = max([ts(sess["date_end"])] + [ts(l["date_start"]) + (l.get("lap_duration") or 0)
                                       for l in laps if l.get("date_start")])
    w = [r for r in w if s0 - 600 <= ts(r["date"]) <= s1 + 600]
    keys = ["air_temperature", "track_temperature", "humidity", "pressure", "wind_speed",
            "wind_direction", "rainfall"]
    with open(os.path.join(out, "%s-2026-q-weather.json" % slug), "w") as f:
        json.dump({"source": "OpenF1 API weather (api.openf1.org/v1)", "accessed": accessed,
                   "session_key": sk,
                   "units": {"air_temperature": "degC", "track_temperature": "degC",
                             "humidity": "%", "pressure": "mbar", "wind_speed": "m/s",
                             "wind_direction": "deg", "rainfall": "0/1"},
                   "date_utc": [r["date"] for r in w],
                   **{k: [r[k] for r in w] for k in keys}}, f, separators=(",", ":"))

    # circuit corners (MultiViewer, as FastF1 uses) + distance on the pole lap
    pole_code = drivers[pole["driver_number"]]["name_acronym"].lower()
    with open(os.path.join(out, "%s-2026-q-%s.json" % (slug, pole_code))) as f:
        pch = json.load(f)["channels"]
    try:
        circ = http_json(MULTIVIEWER.format(key=sess["circuit_key"], year=a.year), a.cache)
    except SystemExit as e:
        print("MultiViewer failed:", e, file=sys.stderr)
        circ = None
    if circ:
        corners = []
        for c in circ["corners"]:
            cx, cy = c["trackPosition"]["x"] / 10.0, c["trackPosition"]["y"] / 10.0
            j = min(range(len(pch["x_m"])), key=lambda i: (pch["x_m"][i] - cx) ** 2 + (pch["y_m"][i] - cy) ** 2)
            corners.append({"number": c["number"], "letter": c.get("letter") or "",
                            "angle_deg": round(c["angle"], 1), "x_m": round(cx, 1), "y_m": round(cy, 1),
                            "distance_m_on_pole_lap": pch["distance_m"][j],
                            "match_error_m": round(math.hypot(pch["x_m"][j] - cx, pch["y_m"][j] - cy), 1)})
        with open(os.path.join(out, "%s-circuit.json" % slug), "w") as f:
            json.dump({"source": "MultiViewer circuit API (api.multiviewer.app), as used by FastF1 get_circuit_info()",
                       "accessed": accessed, "circuit_key": sess["circuit_key"],
                       "layout_year_served": circ.get("year"), "rotation_deg": circ.get("rotation"),
                       "corners": corners}, f, indent=1)
    print(slug, "done; oversize (raw dropped):", oversize, file=sys.stderr)


# ---------------------------------------------------------------------------------------------
# derive: README tables from the files (no network)
# ---------------------------------------------------------------------------------------------

def derive(slug, out, lap_code=None):
    d = os.path.join(out, slug)
    idx = json.load(open(os.path.join(d, "%s-2026-q-index.json" % slug)))
    circ = json.load(open(os.path.join(d, "%s-circuit.json" % slug)))
    pole = [l for l in idx["telemetry_laps"] if l["pole"]][0]
    ref = pole if not lap_code else [l for l in idx["telemetry_laps"] if l["code"] == lap_code.upper()][0]
    doc = json.load(open(os.path.join(d, ref["file"])))
    ch = doc["channels"]
    nan = float("nan")
    D = ch["distance_m"]
    V = [nan if x is None else x for x in ch["speed_kmh"]]
    T = [nan if x is None else x for x in ch["throttle_pct"]]
    B = [bool(x) for x in ch["brake"]]
    G = ch["gear"]
    TS = ch["time_s"]
    ok = [x == x for x in V]
    n = len(D)
    L = D[-1]
    cn = sorted(circ["corners"], key=lambda c: c["distance_m_on_pole_lap"])
    # marker distances were matched on the POLE trace; re-match on this lap's X/Y
    mk = {}
    for c in cn:
        j = min(range(n), key=lambda i: (ch["x_m"][i] - c["x_m"]) ** 2 + (ch["y_m"][i] - c["y_m"]) ** 2)
        mk[(c["number"], c["letter"])] = D[j]
    print("Lap: %s (%s) lap %d %.3f s %s; length %.0f m (axis), %.0f m (X/Y); layout year served %s; dropouts %s" % (
        doc["driver"]["name"], doc["driver"]["team"], doc["lap"]["lap_number"], doc["lap"]["lap_time_s"],
        doc["lap"]["compound"], L, doc["processing"]["length_m_xy_path"], circ["layout_year_served"],
        doc["processing"]["dropouts"]))
    print("max marker match error m (pole):", max(c["match_error_m"] for c in cn))
    print("\n| Corner | Marker m | Min speed km/h | Gear | Min at m | Lift (thr<95%) m | Braking starts m | Entry speed km/h | Note |")
    print("|---|---|---|---|---|---|---|---|---|")
    PROM = 8.0

    def window(a_, b_):
        return [i for i in range(n) if a_ <= D[i] <= b_ or a_ <= D[i] + L <= b_ or a_ <= D[i] - L <= b_]

    cs = sorted(cn, key=lambda c: mk[(c["number"], c["letter"])])
    for k, c in enumerate(cs):
        dm = mk[(c["number"], c["letter"])]
        prev_d = mk[(cs[k - 1]["number"], cs[k - 1]["letter"])] - (L if k == 0 else 0)
        next_d = mk[(cs[(k + 1) % len(cs)]["number"], cs[(k + 1) % len(cs)]["letter"])] + (L if k == len(cs) - 1 else 0)
        lo = max(dm - 110, (prev_d + dm) / 2)
        hi = min(dm + 110, (next_d + dm) / 2)
        name = "T%d%s" % (c["number"], c["letter"])
        ids = window(lo, hi)
        if any(not ok[i] for i in window(lo - 250, hi)):
            print("| %s | %.0f | - | - | - | - | - | - | no data: car_data dropout in this lap |" % (name, dm))
            continue
        m = min(ids, key=lambda i: V[i])
        pre = window(D[m] - 250, D[m])
        post = window(D[m], D[m] + 250)
        drop_pre = max(V[i] for i in pre) - V[m]
        drop_post = max(V[i] for i in post) - V[m]
        at_marker = min(range(n), key=lambda i: min(abs(D[i] - dm), abs(D[i] - dm + L), abs(D[i] - dm - L)))
        if min(drop_pre, drop_post) < PROM or abs(D[m] - lo) < 7 or abs(D[m] - hi) < 7:
            print("| %s | %.0f | %.0f | %d | %.0f | - | - | - | no local minimum: speed at marker, throttle %d%% |" % (
                name, dm, V[at_marker], G[at_marker], dm, T[at_marker]))
            continue
        j = m
        while m - j <= 60 and not B[j % n]:
            j -= 1
        bstart = entry = "-"
        jb = m
        if B[j % n]:
            while True:
                q = j - 1
                while q >= j - 3 and not B[q % n]:
                    q -= 1
                if q >= j - 3:
                    j = q
                else:
                    break
            jb = j
            bstart = "%.0f" % (D[jb % n])
            ev = [V[i % n] for i in range(jb - 10, jb + 1) if ok[i % n]]
            entry = "%.0f" % max(ev) if ev and all(ok[i % n] for i in range(jb - 10, jb + 1)) else "-"
        k2 = jb
        while k2 > m - 120 and T[k2 % n] >= 95:
            k2 -= 1
        lift = "-"
        note = ""
        if T[k2 % n] < 95:
            while T[(k2 - 1) % n] < 95 and k2 > m - 120:
                k2 -= 1
            lift = "%.0f" % (D[k2 % n])
            if bstart == "-":
                note = "no brake; %.0f km/h at lift" % V[k2 % n]
        elif bstart == "-":
            note = "flat (throttle >= 95% throughout)"
        print("| %s | %.0f | %.0f | %d | %.0f | %s | %s | %s | %s |" % (
            name, dm, V[m], G[m], D[m], lift, bstart, entry, note))

    print("\n| Straight | From m | To m | Length m | Entry km/h | Peak km/h | Peak at m | End km/h | Drop peak to end |")
    print("|---|---|---|---|---|---|---|---|---|")
    runs, i = [], 0
    while i < n:
        if ok[i] and T[i] >= 95 and not B[i]:
            j = i
            while j + 1 < n and ok[j + 1] and T[j + 1] >= 95 and not B[j + 1]:
                j += 1
            runs.append((i, j))
            i = j + 1
        else:
            i += 1
    merged = []
    for r in runs:
        if merged and D[r[0]] - D[merged[-1][1]] <= 20 and all(ok[merged[-1][1]:r[0] + 1]):
            merged[-1] = (merged[-1][0], r[1])
        else:
            merged.append(r)
    for (i, j) in merged:
        if D[j] - D[i] < 300:
            continue
        m = max(range(i, j + 1), key=lambda q: V[q])
        before = [c for c in cs if mk[(c["number"], c["letter"])] <= D[i] + 1]
        after = [c for c in cs if mk[(c["number"], c["letter"])] >= D[j] - 1]
        cb = "T%d%s" % (before[-1]["number"], before[-1]["letter"]) if before else "line"
        ca = "T%d%s" % (after[0]["number"], after[0]["letter"]) if after else "line"
        print("| %s to %s | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f | %.0f |" % (
            cb, ca, D[i], D[j], D[j] - D[i], V[i], V[m], D[m], V[j], V[m] - V[j]))
    good = [i for i in range(n) if ok[i]]
    m = max(good, key=lambda i: V[i])
    print("\nLap maximum: %.0f km/h at %.0f m." % (V[m], D[m]))
    print("Official speed trap on this lap: %s km/h; i1 %s, i2 %s." % (
        doc["lap"]["speed_trap_kmh"], doc["lap"]["i1_speed_kmh"], doc["lap"]["i2_speed_kmh"]))
    seg = [i for i in range(1, n) if ok[i] and ok[i - 1]]
    dt_all = sum(TS[i] - TS[i - 1] for i in seg)
    dt_full = sum(TS[i] - TS[i - 1] for i in seg if T[i] >= 99 and T[i - 1] >= 99)
    d_all = sum(D[i] - D[i - 1] for i in seg)
    d_full = sum(D[i] - D[i - 1] for i in seg if T[i] >= 99 and T[i - 1] >= 99)
    dt_brake = sum(TS[i] - TS[i - 1] for i in seg if B[i] and B[i - 1])
    print("Full throttle (>=99%%): %.1f%% of valid lap time, %.1f%% of valid distance; raw-sample share %.1f%%. Brake on %.1f%% of valid time. Valid coverage %.1f%% of time, %.1f%% of distance." % (
        100 * dt_full / dt_all, 100 * d_full / d_all, 100 * doc["processing"]["raw_full_throttle_sample_share"],
        100 * dt_brake / dt_all, 100 * dt_all / TS[-1], 100 * d_all / L))
    s = doc["lap"]["sector_s"]
    print("Sectors: S1 %.3f S2 %.3f S3 %.3f (sum %.3f)" % (s[0], s[1], s[2], sum(s)))
    ls = [l["length_m"] for l in idx["telemetry_laps"]]
    print("Lap lengths (axis) over %d laps: min %.0f max %.0f median %.0f; X/Y path median %.0f" % (
        len(ls), min(ls), max(ls), statistics.median(ls),
        statistics.median(l["length_m_xy_path"] for l in idx["telemetry_laps"])))
    print("\n| Pos | Driver | Team | Lap | Time s | Compound | S1 | S2 | S3 | Trap | len axis | len xy | xy gap | dropout s | dropped samples | file KB |")
    print("|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|")
    for p, l in enumerate(idx["telemetry_laps"], 1):
        print("| %d | %s | %s | %d | %.3f | %s | %.3f | %.3f | %.3f | %s | %.0f | %.0f | %.1f | %.1f | %d | %.1f |" % (
            p, l["code"], l["team"], l["lap_number"], l["lap_time_s"], l["compound"], *l["sector_s"],
            l["speed_trap_kmh"], l["length_m"], l["length_m_xy_path"],
            l["xy_start_end_gap_m"], l["dropout_s"], l["invalid_car_samples_dropped"], l["file_bytes"] / 1024))


def main():
    ap = argparse.ArgumentParser()
    here = os.path.dirname(os.path.abspath(__file__))
    ap.add_argument("cmd", choices=["fetch", "derive"])
    ap.add_argument("--out", default=os.path.dirname(here))
    ap.add_argument("--cache", default=None, help="directory to cache raw API responses")
    ap.add_argument("--year", type=int, default=2026)
    ap.add_argument("--today", default="2026-10-24", help="sessions must have ended before this date")
    ap.add_argument("--only", default=",".join(CIRCUITS))
    ap.add_argument("--circuit", default=None)
    ap.add_argument("--lap", default=None, help="derive: driver code of the lap to tabulate (default: pole lap)")
    a = ap.parse_args()
    if a.cmd == "derive":
        derive(a.circuit, a.out, a.lap)
        return
    if a.cache:
        os.makedirs(a.cache, exist_ok=True)
    accessed = dt.date.today().isoformat()
    for slug in a.only.split(","):
        fetch_circuit(slug.strip(), CIRCUITS[slug.strip()], a, accessed)


if __name__ == "__main__":
    main()
