// PURPLE CONCEPT - concept car view v3: the three.js side of the concept car (browser, THREE r128). Geometry comes from
// concept/view/car3d.js (built to the design's dimensions, pure); this file turns it into meshes with PBR materials, the team
// livery (projected from the livery designs' side and top views, js/liveries.js), carbon weave, metal finishes, and the
// overlays the view needs (baseline ghost, highlight, x-ray, hot-swap flash, materials mode).
//
//   const car = EI.concept.parts3d.createCar({ THREE, o, carRoot, mirror, ghostRoot, hiRoot })
//   car.setLayout(L)            L = conceptView.layout(params) (carries L.params): rebuild only the groups whose dimensions changed;
//                               returns the ids of the groups rebuilt
//   car.setGhost(baseL | null)  -> [part ids] the baseline's parts that differ, purple (per-vertex weights when the topology matches)
//   car.hideGhost(); car.setFlaps(t 0 corner .. 1 straight); car.setHighlight(Set of part ids); car.setXray(colourFn | null)
//   car.setMode('solid' | 'materials' | 'xray-mass'); car.flash(groupIds); car.tick(now) -> animating?; car.partCentre(part)
//   car.materialsUsed() -> [{ part, material, name, base, changed, swatch }]; car.stats(); car.dispose()
// Groups (car3d.GROUPS): body, sidepods, floor, diffuser, front_wing, rear_wing, wheels, suspension, details.
(function () {
  const root = typeof window !== "undefined" ? window : globalThis;
  const EI = (root.EI = root.EI || {}); const C = (EI.concept = EI.concept || {});
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const lerp = (a, b, t) => a + (b - a) * t;

  // ---------------------------------------------------------------- material looks (bare surfaces; materials mode)
  // material id (concept/data/materials-2026.json) -> how it reads: colour (sRGB), roughness, metalness, weave (carbon family:
  // 'twill' | 'plain' | 'spread' | null), tow width (m), clear coat
  const LOOKS = {
    cfrp_t700s: { col: "#17181b", rough: 0.36, metal: 0, weave: "twill", tow: 0.0028, coat: 1, label: "T700S carbon" },
    cfrp_t800s: { col: "#141518", rough: 0.32, metal: 0, weave: "twill", tow: 0.0023, coat: 1, label: "T800S carbon" },
    cfrp_t1100g: { col: "#121316", rough: 0.3, metal: 0, weave: "spread", tow: 0.012, coat: 1, label: "T1100G carbon (spread tow)" },
    cfrp_m55j: { col: "#14171d", rough: 0.27, metal: 0, weave: "twill", tow: 0.0021, coat: 1, label: "M55J high-modulus carbon" },
    cfrp_m60j: { col: "#151a22", rough: 0.25, metal: 0, weave: "twill", tow: 0.0021, coat: 1, label: "M60J ultra-high-modulus carbon" },
    afrp_k49: { col: "#b88a1c", rough: 0.42, metal: 0, weave: "twill", tow: 0.0026, coat: 0.8, label: "aramid (Kevlar 49)" },
    pbo_zylon: { col: "#b8761e", rough: 0.4, metal: 0, weave: "plain", tow: 0.0024, coat: 0.8, label: "PBO (Zylon)" },
    gfrp_e: { col: "#c9d2c4", rough: 0.38, metal: 0, weave: "plain", tow: 0.003, coat: 0.9, label: "E-glass" },
    core_al_honeycomb: { col: "#b9bcc0", rough: 0.4, metal: 0.9, weave: null, coat: 0, label: "Al honeycomb" },
    core_nomex: { col: "#c8a24a", rough: 0.7, metal: 0, weave: null, coat: 0, label: "Nomex honeycomb" },
    ti64: { col: "#8d8780", rough: 0.3, metal: 1, weave: null, coat: 0, brushed: 1, label: "titanium Ti-6Al-4V" },
    al_7075_t6: { col: "#cfd2d6", rough: 0.26, metal: 1, weave: null, coat: 0, brushed: 1, label: "aluminium 7075-T6" },
    al_li_2099: { col: "#c4c9d2", rough: 0.28, metal: 1, weave: null, coat: 0, brushed: 1, label: "Al-Li 2099" },
    al_li_2195: { col: "#c2c8d3", rough: 0.28, metal: 1, weave: null, coat: 0, brushed: 1, label: "Al-Li 2195" },
    mg_az80a: { col: "#8f8f8b", rough: 0.42, metal: 1, weave: null, coat: 0.3, label: "magnesium AZ80A" },
    mg_we43: { col: "#96958f", rough: 0.44, metal: 1, weave: null, coat: 0.3, label: "magnesium WE43" },
    steel_17_4ph: { col: "#a2a6ab", rough: 0.2, metal: 1, weave: null, coat: 0, label: "17-4PH steel" },
    steel_maraging_300: { col: "#7f8288", rough: 0.24, metal: 1, weave: null, coat: 0, label: "maraging steel" },
    inconel_718: { col: "#7d7468", rough: 0.34, metal: 1, weave: null, coat: 0, heat: 1, label: "Inconel 718" },
    tungsten_ha: { col: "#6c6f73", rough: 0.36, metal: 1, weave: null, coat: 0, label: "tungsten alloy" },
    mmc_supremex_225xe: { col: "#a7a9ab", rough: 0.48, metal: 0.9, weave: null, coat: 0, speckle: 1, label: "Al MMC" },
    albemet_am162: { col: "#b3b6b7", rough: 0.38, metal: 1, weave: null, coat: 0, label: "AlBeMet" },
    carbon_carbon: { col: "#1a1a1b", rough: 0.82, metal: 0, weave: null, coat: 0, label: "carbon-carbon" },
  };
  // parts whose material is fixed by a regulation or not modelled (no `material` parameter): their look
  const FIXED_LOOK = { halo: "ti64", wheels_front: "mg_az80a", wheels_rear: "mg_az80a", brakes_front: "carbon_carbon", brakes_rear: "carbon_carbon", misc: "cfrp_t800s", electronics: "cfrp_t800s", pu_electronics: "inconel_718", cooling: "al_7075_t6", seat_safety: "cfrp_t800s", driver: null };

  // ---------------------------------------------------------------- shaders (onBeforeCompile patches of MeshPhysicalMaterial)
  const PAINT_VS = ["attribute vec3 aRef; varying vec3 vRef; varying vec3 vONrm;", "vRef = aRef; vONrm = normal;"];
  const PAINT_FS = [
    "uniform sampler2D livery; uniform vec4 tL; uniform vec4 tR; uniform vec4 tT; uniform vec4 rS; uniform vec4 rT; uniform float hasSide; uniform float hasTop; uniform float sideOut; uniform vec2 topEdge; varying vec3 vRef; varying vec3 vONrm;",
    "vec4 cvRect(vec4 t, vec2 uv) { if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) return vec4(0.0); return texture2D(livery, vec2(t.x + uv.x * t.z, 1.0 - (t.y + uv.y * t.w))); }",
    "vec3 cvDec(vec4 s) { return s.a < 0.002 ? vec3(0.0) : s.rgb / s.a; }",
  ].join("\n");
  const PAINT_FRAG = [
    "{ vec3 n = normalize(vONrm); float wT = hasTop * smoothstep(topEdge.x, topEdge.y, n.y); vec3 c = pow(max(diffuseColor.rgb, vec3(0.0)), vec3(1.0 / 2.2));",   // composite in sRGB, like the canvas the designs were drawn for
    "  if (hasSide > 0.5) { float uS = vRef.z < 0.0 ? (rS.y - vRef.x) / (rS.y - rS.x) : (vRef.x - rS.x) / (rS.y - rS.x); float vS = (rS.w - vRef.y) / (rS.w - rS.z);",
    "    vec4 s = vRef.z < 0.0 ? cvRect(tL, vec2(uS, vS)) : cvRect(tR, vec2(uS, vS)); float wO = mix(1.0, smoothstep(-0.12, 0.2, n.z * sign(vRef.z)), sideOut); c = mix(c, cvDec(s), s.a * (1.0 - wT) * wO); }",
    "  if (hasTop > 0.5) { vec4 s = cvRect(tT, vec2((vRef.x - rT.x) / (rT.y - rT.x), (vRef.z - rT.z) / (rT.w - rT.z))); c = mix(c, cvDec(s), s.a * wT); }",
    "  diffuseColor.rgb = pow(c, vec3(2.2)); }",
  ].join("\n");
  // carbon weave / metal brushing, triplanar on the object position (metres); faded out where the weave is below a pixel
  const WEAVE_VS = ["varying vec3 vOP; varying vec3 vON;", "vOP = position; vON = normal;"];
  const WEAVE_FS = [
    "uniform float wKind; uniform float wTow; uniform float wAmt; varying vec3 vOP; varying vec3 vON;",
    "float cvHash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }",
    "vec2 cvWeave(vec2 uv) {",   // x: brightness, y: gloss
    "  vec2 c = floor(uv), f = fract(uv); float over;",
    "  if (wKind < 0.5) over = step(mod(c.x + c.y, 4.0), 1.5); else if (wKind < 1.5) over = step(mod(c.x + c.y, 2.0), 0.5); else over = step(mod(floor(c.x) + floor(c.y), 2.0), 0.5);",
    "  float across = over > 0.5 ? f.x : f.y, along = over > 0.5 ? f.y : f.x;",
    "  float prof = sin(3.14159 * across); float fil = 0.5 + 0.5 * sin(across * 6.2831 * (wKind > 1.5 ? 18.0 : 7.0));",
    "  float b = 0.62 + 0.3 * pow(prof, 0.6) + 0.06 * fil + (over > 0.5 ? 0.05 : -0.05) + 0.04 * (cvHash(c) - 0.5);",
    "  float edge = smoothstep(0.0, 0.06, across) * smoothstep(1.0, 0.94, across) * smoothstep(0.0, 0.04, along) * smoothstep(1.0, 0.96, along);",
    "  return vec2(mix(0.5, b, edge), prof * edge); }",
    "vec2 cvTri(vec3 p, vec3 n) { vec3 w = pow(abs(n), vec3(4.0)); w /= (w.x + w.y + w.z + 1e-5);",
    "  vec2 a = cvWeave(p.yz / wTow), b = cvWeave(p.xz / wTow), d = cvWeave(p.xy / wTow); return a * w.x + b * w.y + d * w.z; }",
  ].join("\n");
  const WEAVE_FRAG = [
    "{ vec3 n = normalize(vON); float fw = length(fwidth(vOP)) / wTow; float k = wAmt * (1.0 - smoothstep(0.35, 1.1, fw));",
    "  vec2 wv = cvTri(vOP, n); float bri = mix(0.82, wv.x * 1.15, k); diffuseColor.rgb *= bri; cvGloss = mix(0.0, wv.y, k); }",
  ].join("\n");

  function makePaint(THREE, opts) {
    const m = new THREE.MeshPhysicalMaterial({ color: opts.color, metalness: 0.08, roughness: opts.rough != null ? opts.rough : 0.4, clearcoat: opts.coat != null ? opts.coat : 1, clearcoatRoughness: 0.03, envMapIntensity: 1, side: THREE.DoubleSide });
    m.userData.u = { livery: { value: opts.tex || null }, tL: { value: new THREE.Vector4() }, tR: { value: new THREE.Vector4() }, tT: { value: new THREE.Vector4() }, rS: { value: new THREE.Vector4(0, 1, 0, 1) }, rT: { value: new THREE.Vector4(0, 1, 0, 1) }, hasSide: { value: 0 }, hasTop: { value: 0 }, sideOut: { value: 0 }, topEdge: { value: new THREE.Vector2(0.32, 0.72) } };
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = PAINT_VS[0] + "\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + PAINT_VS[1]);
      sh.fragmentShader = PAINT_FS + "\n" + sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n" + PAINT_FRAG)
        .replace("#include <normal_fragment_maps>", "#include <normal_fragment_maps>\n{ vec3 fp = vRef * 420.0; vec3 fc = floor(fp); vec3 fh = fract(sin(vec3(dot(fc, vec3(127.1, 311.7, 74.7)), dot(fc, vec3(269.5, 183.3, 246.1)), dot(fc, vec3(113.5, 271.9, 124.6)))) * 43758.5453) - 0.5; float ffw = length(fwidth(fp)); normal = normalize(normal + fh * 0.035 * (1.0 - smoothstep(0.3, 1.1, ffw))); }");
    };
    m.customProgramCacheKey = () => "cv3-paint";
    return m;
  }
  function makeLook(THREE, L, opts) {
    opts = opts || {};
    const isWeave = !!L.weave, matte = !!opts.matte;
    // metals at 0.82: a dark studio reflects almost nothing into a pure metal, so a little diffuse keeps titanium reading grey
    const m = new THREE.MeshPhysicalMaterial({ color: new THREE.Color(L.col).convertSRGBToLinear(), metalness: L.metal > 0.5 ? 0.82 : L.metal, roughness: matte ? 0.78 : L.rough, reflectivity: matte ? 0.2 : 0.5, clearcoat: matte ? 0 : L.coat, clearcoatRoughness: 0.08, envMapIntensity: matte ? 0.3 : isWeave ? 0.55 : 1, side: THREE.DoubleSide });
    const kind = L.weave === "twill" ? 0 : L.weave === "plain" ? 1 : L.weave === "spread" ? 2 : 3;
    m.userData.u = { wKind: { value: kind }, wTow: { value: L.tow || (L.brushed ? 0.0004 : 0.002) }, wAmt: { value: isWeave ? 1 : L.brushed ? 0.25 : L.speckle ? 0.35 : 0 } };
    m.extensions = { derivatives: true };
    m.onBeforeCompile = (sh) => {
      Object.assign(sh.uniforms, m.userData.u);
      sh.vertexShader = WEAVE_VS[0] + "\n" + sh.vertexShader.replace("#include <begin_vertex>", "#include <begin_vertex>\n" + WEAVE_VS[1]);
      sh.fragmentShader = WEAVE_FS + "\nfloat cvGloss = 0.0;\n" + sh.fragmentShader.replace("#include <map_fragment>", "#include <map_fragment>\n" + WEAVE_FRAG)
        .replace("#include <roughnessmap_fragment>", "#include <roughnessmap_fragment>\nroughnessFactor = clamp(roughnessFactor * (1.0 - 0.45 * cvGloss), 0.04, 1.0);");
    };
    m.customProgramCacheKey = () => "cv3-look";
    return m;
  }

  // ---------------------------------------------------------------- textures: livery atlas, helmet, tyre sidewall
  const MM = 1000;
  function topKit(g) {   // the top-view drawing kit (mm canvas units, X = z, Y = -x), as js/carglb.js topKit
    const Ads = () => EI.Ads;
    const at = (x, z, fn, rot) => { g.save(); g.translate(z * MM, -x * MM); if (rot) g.rotate(rot); fn(); g.restore(); };
    const txt = (str, x, z, cap, col, font, rot, ls) => at(x, z, () => { g.font = font.replace("%", (cap * MM).toFixed(1) + "px"); if (Ads()) Ads().setLS(g, (ls || 0) * cap * MM); g.textAlign = "center"; g.textBaseline = "middle"; g.fillStyle = col; g.fillText(str, 0, cap * MM * 0.04); if (Ads()) Ads().setLS(g, 0); }, rot);
    const dec = (spec, x, z, cap, maxW, rot) => at(x, z, () => Ads().drawDecal(g, spec, 0, 0, cap * MM, maxW * MM), rot);
    const rect = (x0, x1, z0, z1, col) => { g.fillStyle = col; g.fillRect(z0 * MM, -x1 * MM, (z1 - z0) * MM, (x1 - x0) * MM); };
    const poly = (pts, col) => { g.beginPath(); pts.forEach(([x, z], i) => (i ? g.lineTo(z * MM, -x * MM) : g.moveTo(z * MM, -x * MM))); g.closePath(); g.fillStyle = col; g.fill(); };
    return { at, txt, dec, rect, poly };
  }
  // tiles of the atlas (px at 4096; scaled with the atlas size); side ranges [x0, x1, y0, y1], top ranges [x0, x1, z0, z1] (metres,
  // the livery designs' frame: js/liveries.js, nose tip 3.05, front axle 1.75, rear axle -1.85)
  const TILES = {
    sideL: [0, 0, 4096, 832], sideR: [0, 832, 4096, 832], top: [0, 1664, 4096, 1408],
    epL: [0, 3072, 704, 448], epR: [0, 3520, 704, 448], haloL: [704, 3072, 864, 230], haloR: [704, 3302, 864, 230], haloT: [704, 3532, 864, 512], fwT: [1568, 3072, 704, 1024],
  };
  const RANGES = { main: { s: [-3.2, 3.2, -0.05, 1.25], t: [-3.2, 3.2, -1.1, 1.1] }, ep: { s: [2.1, 3.2, -0.05, 0.65] }, halo: { s: [-0.05, 1.3, 0.6, 0.96], t: [-0.05, 1.3, -0.45, 0.45] }, fw: { t: [2.15, 3.25, -1.1, 1.1] } };
  function buildAtlas(THREE, team, num, code, size) {
    const S = size, k = S / 4096, c = document.createElement("canvas"); c.width = c.height = S; const g = c.getContext("2d");
    const LV = EI.LIVERIES, tid = team.id, has = !!(LV && LV.has && LV.has(tid));
    const px = (t) => TILES[t].map(v => v * k);
    const side = (tile, s, R, draw) => {
      const [ox, oy, w, h] = px(tile), ppm = w / (R[1] - R[0]);
      g.save(); g.beginPath(); g.rect(ox, oy, w, h); g.clip();
      // view x' = s·x: x' from (s > 0 ? x0 : -x1); y' = -y from -y1
      const x0p = s > 0 ? R[0] : -R[1], y0p = -R[3];
      g.setTransform(ppm, 0, 0, ppm, ox - x0p * ppm, oy - y0p * ppm); g.scale(1 / MM, 1 / MM);
      try { draw(LV.sideKit(g, s), s); } catch (e) { console.warn("conceptView: livery side tile " + tile + " skipped", e); }
      g.restore();
    };
    const top = (tile, R, draw) => {
      const [ox, oy, w, h] = px(tile), ppx = w / (R[1] - R[0]), ppz = h / (R[3] - R[2]);
      g.save(); g.beginPath(); g.rect(ox, oy, w, h); g.clip();
      // top kit units: (Xk, Yk) = (z, -x) mm; tile pixel: px = ox + (x - x0)·ppx, py = oy + (z - z0)·ppz (x along the tile)
      g.setTransform(0, ppz / MM, -ppx / MM, 0, ox - R[0] * ppx, oy - R[2] * ppz);
      try { draw(topKit(g)); } catch (e) { console.warn("conceptView: livery top tile " + tile + " skipped", e); }
      g.restore();
    };
    const out = { has, ep: false, halo: false, fw: false };
    if (LV && has) {
      side("sideL", -1, RANGES.main.s, (kit) => LV.side(g, kit, team, num, code));
      side("sideR", 1, RANGES.main.s, (kit) => LV.side(g, kit, team, num, code));
      top("top", RANGES.main.t, (t) => LV.top(g, t, team, num));
      if (LV.hasEndplate && LV.hasEndplate(tid)) { out.ep = true; side("epL", -1, RANGES.ep.s, (kit) => LV.endplate(g, kit, team, num, code)); side("epR", 1, RANGES.ep.s, (kit) => LV.endplate(g, kit, team, num, code)); }
      if (LV.sideHalo) { out.halo = true; side("haloL", -1, RANGES.halo.s, (kit) => LV.sideHalo(g, kit, team, num, code)); side("haloR", 1, RANGES.halo.s, (kit) => LV.sideHalo(g, kit, team, num, code)); top("haloT", RANGES.halo.t, (t) => LV.topHalo(g, t, team, num)); }
      if (LV.hasFrontWing && LV.hasFrontWing(tid)) { out.fw = true; top("fwT", RANGES.fw.t, (t) => LV.frontWing(g, t, team, num)); }
    }
    const tex = new THREE.CanvasTexture(c); tex.premultiplyAlpha = true; tex.anisotropy = 8; tex.generateMipmaps = true;
    const rect = (t) => { const [x, y, w, h] = TILES[t]; return new THREE.Vector4(x / 4096, y / 4096, w / 4096, h / 4096); };
    out.tex = tex; out.rect = rect; out.canvas = c;
    return out;
  }
  // the RB22 atlas (concept/view/livery-rb22.js paints every tile in the concept car's frame)
  function buildAtlasRB22(THREE, LR, car, code, size) {
    const c = document.createElement("canvas"); c.width = c.height = size; const g = c.getContext("2d");
    const draw = () => { g.setTransform(1, 0, 0, 1, 0, 0); g.clearRect(0, 0, size, size); try { LR.paint(g, size, { num: car.num, code, driver: car.driver }); } catch (e) { console.warn("conceptView: RB22 livery skipped", e); } };
    draw();
    const tex = new THREE.CanvasTexture(c); tex.premultiplyAlpha = true; tex.anisotropy = 8; tex.generateMipmaps = true;
    const rect = (t) => { const [x, y, w, h] = LR.TILES[t]; return new THREE.Vector4(x / 4096, y / 4096, w / 4096, h / 4096); };
    // partner artwork (EI.Ads) can arrive after the first paint (the view waits at most 3.5 s for it): paint again once it is in
    const A = EI.Ads, artIn = () => !!(A && A.hasPartner && A.hasPartner("oracle") && A.hasPartner("redbullbull"));
    const late = !artIn() && A && A.ready ? Promise.race([A.ready(), new Promise((r) => setTimeout(r, 20000))]).then(() => { if (!tex.cvGone && artIn()) { draw(); tex.needsUpdate = true; return true; } return false; }) : Promise.resolve(false);
    return { kind: "rb22", has: true, ep: true, halo: false, fw: true, tex, rect, canvas: c, late };
  }
  function helmetTexture(THREE, car) {
    const c = document.createElement("canvas"); c.width = 512; c.height = 256; const g = c.getContext("2d"), d = car.driver || {};
    g.fillStyle = d.helmet || car.team.helmet || car.team.accent || "#dddddd"; g.fillRect(0, 0, 512, 256);
    try { if (EI.LIVERIES && EI.LIVERIES.helmet) { g.save(); g.scale(2, 2); EI.LIVERIES.helmet(g, 256, 128, d, car.team, car.num); g.restore(); } } catch (e) { /* plain helmet */ }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 4; return t;
  }
  // tyre sidewall band: u around the tyre, v from the rim (0) to the shoulder (1); compound stripe + PIRELLI / P ZERO lettering
  function tyreWallTexture(THREE, col) {
    const W = 4096, H = 160, c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    g.clearRect(0, 0, W, H);
    g.fillStyle = "rgba(255,255,255,0.08)"; g.fillRect(0, H * 0.1, W, H * 0.025);
    g.fillStyle = col; for (let q = 0; q < 4; q++) g.fillRect(q * W / 4 + W * 0.02, H * 0.82, W * 0.21, H * 0.08);
    g.textAlign = "center"; g.textBaseline = "middle";
    for (let q = 0; q < 4; q++) {
      const x = (q + 0.5) * W / 4;
      g.save(); g.translate(x, H * 0.5); g.scale(1, -1);
      if (q % 2 === 0) { g.font = 'italic 900 78px "Titillium Web", "Arial Black", sans-serif'; g.fillStyle = col; g.fillText("P ZERO", 0, 0); }
      else { g.font = '900 70px "Titillium Web", "Arial Black", sans-serif'; g.fillStyle = "#f2f2f2"; if (g.letterSpacing !== undefined) g.letterSpacing = "6px"; g.fillText("PIRELLI", 0, 0); }
      g.restore();
    }
    const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.anisotropy = 8; t.wrapS = THREE.RepeatWrapping; return t;
  }

  // ---------------------------------------------------------------- the car
  function createCar(ctx) {
    const { THREE, o, carRoot, mirror, ghostRoot, hiRoot } = ctx, V = C.view._internal, C3 = C.car3d, M3 = C.mesh3d;
    const team = (EI.TEAM_BY_ID && (EI.TEAM_BY_ID[o.team] || EI.TEAM_BY_ID.redbull)) || (EI.TEAMS && EI.TEAMS[0]) || { id: "generic", primary: "#1c2658", secondary: "#0b0d16", accent: "#ffc906", drivers: [] };
    const ds = team.drivers || [], drv = (typeof o.driver === "string" ? ds.find(d => d.code === o.driver) : ds[o.driver || 0]) || ds[0] || null;
    const car = { team, num: drv ? drv.num : 1, driver: drv };
    const code = drv && drv.code ? drv.code : String(team.short || "EI").slice(0, 3).toUpperCase();
    const disposables = [], keep = (x) => { disposables.push(x); return x; };
    const Mats = C.materials || null;
    // the RB22 livery (concept/view/livery-rb22.js) is painted in the concept car's own frame; other teams use the game's livery
    // designs (js/liveries.js), drawn for the game car's proportions and mapped through the design's anchors
    const LR = team.id === "redbull" && C.liveryRB22 ? C.liveryRB22 : null;
    const pc = LR ? LR.BODY : (EI.LIVERIES && EI.LIVERIES.partColours) ? EI.LIVERIES.partColours(team) : { body: team.primary, fwFlap: team.secondary, fwEnd: team.primary, rwMain: team.primary, rwEnd: team.secondary, rwFlap: team.secondary, halo: null, mirror: team.primary, fin: team.secondary };
    const atlasSize = Math.max(1024, Math.min(4096, (o.liverySize || 2048) * 2));
    const atlas = LR ? buildAtlasRB22(THREE, LR, car, code, atlasSize) : buildAtlas(THREE, team, car.num, code, atlasSize);
    keep(atlas.tex);
    // resolves once the livery is final (after a late repaint with the partner artwork); ctx.onRepaint asks the view for a frame
    const liveryReady = (atlas.late || Promise.resolve(false)).then((did) => { if (did && ctx.onRepaint) ctx.onRepaint(); });
    const matte = o.finish === "matte";   // the 2026 RB22 is gloss (photos; Red Bull's launch notes); `finish: "matte"` for the 2022-25 look
    const lin = (hex) => new THREE.Color(hex).convertSRGBToLinear();

    // ---- materials (cached)
    const cache = new Map();
    const cached = (key, make) => { if (!cache.has(key)) cache.set(key, keep(make())); return cache.get(key); };
    function paintMat(role, proj) {
      return cached("paint:" + role + ":" + proj, () => {
        const col = role === "halo" ? (pc.halo || "#15161a") : role === "fwMain" ? (pc.fwFlap || pc.body) : (pc[role] || pc.body || team.primary);
        const m = makePaint(THREE, { color: lin(col), tex: atlas.tex, rough: matte ? 0.62 : 0.3, coat: matte ? 0 : 1 }), u = m.userData.u;
        // broad, near-horizontal wing surfaces mirror the studio's overhead light box: a softer reflection keeps their livery legible
        if (/^(fwFlap|fwMain|fwEnd|rwMain|rwFlap)$/.test(role)) { m.envMapIntensity = /^rw/.test(role) ? 0.12 : 0.4; m.roughness = Math.max(m.roughness, /^rw/.test(role) ? 0.78 : 0.48); m.metalness = /^rw/.test(role) ? 0 : m.metalness; m.clearcoat = Math.min(m.clearcoat, /^rw/.test(role) ? 0 : 0.3); m.clearcoatRoughness = 0.2; }
        const set = (sKey, tKey, R) => { if (sKey) { u.tL.value.copy(atlas.rect(sKey + "L")); u.tR.value.copy(atlas.rect(sKey + "R")); u.rS.value.set(R.s[0], R.s[1], R.s[2], R.s[3]); u.hasSide.value = 1; } if (tKey) { u.tT.value.copy(atlas.rect(tKey)); u.rT.value.set(R.t[0], R.t[1], R.t[2], R.t[3]); u.hasTop.value = 1; } };
        if (atlas.kind === "rb22") {
          const R = LR.RANGES;
          if (role === "mirror" || role === "halo") { /* plain black */ }
          else if (proj === "main") { set("side", "top", R.main); u.topEdge.value.set(0.62, 0.9); }   // the side graphics (the bull) reach up the cover's sloping flanks
          else if (proj === "rwTop") set(null, "rwT", R.rw);
          else if (proj === "rwEnd") { set("epR", null, R.epR); u.sideOut.value = 1; }   // the outer faces only (no mirrored decals inside)
          else if (proj === "fwEnd") { set("epF", null, R.epF); u.sideOut.value = 1; }
          else if (proj === "fwTop") set(null, "fwT", R.fw);
        } else if (atlas.has) {
          if (proj === "main" || proj === "rwEnd") set("side", "top", RANGES.main);
          else if (proj === "top" || proj === "rwTop") set(null, "top", RANGES.main);
          else if (proj === "fwEnd") set(atlas.ep ? "ep" : "side", null, atlas.ep ? RANGES.ep : RANGES.main);
          else if (proj === "fwTop" && role === "fwMain" && atlas.fw) set(null, "fwT", RANGES.fw);
          else if (proj === "halo") { if (atlas.halo) set("halo", "haloT", RANGES.halo); }
        }
        return m;
      });
    }
    const lookMat = (id, matte) => cached("look:" + id + (matte ? ":m" : ""), () => makeLook(THREE, LOOKS[id] || LOOKS.cfrp_t800s, { matte }));
    const helmetTex = keep(helmetTexture(THREE, car)), wallTex = keep(tyreWallTexture(THREE, (EI.TYRES && EI.TYRES.soft && EI.TYRES.soft.color) || "#e8322b"));
    const RAW = {
      tyre: () => new THREE.MeshPhysicalMaterial({ color: lin("#151515"), roughness: 0.86, metalness: 0, clearcoat: 0.15, clearcoatRoughness: 0.6, sheen: 0 }),
      tyreWall: () => new THREE.MeshStandardMaterial({ map: wallTex, transparent: true, roughness: 0.75, metalness: 0, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2, depthWrite: false }),
      interior: () => new THREE.MeshStandardMaterial({ color: lin("#0d0e10"), roughness: 0.78, metalness: 0, side: THREE.DoubleSide }),
      radiator: () => new THREE.MeshStandardMaterial({ color: lin("#2b2d31"), roughness: 0.55, metalness: 0.7, side: THREE.DoubleSide }),
      plank: () => new THREE.MeshStandardMaterial({ color: lin("#5a4632"), roughness: 0.72, metalness: 0, side: THREE.DoubleSide }),
      black: () => new THREE.MeshStandardMaterial({ color: lin("#060606"), roughness: 0.6, metalness: 0, side: THREE.DoubleSide }),
      led: () => new THREE.MeshStandardMaterial({ color: lin("#2a0303"), emissive: lin("#ff0a0a"), emissiveIntensity: 0.9, roughness: 0.3 }),
      caliper: () => new THREE.MeshPhysicalMaterial({ color: lin(team.id === "ferrari" ? "#d4a017" : "#b0141e"), roughness: 0.35, metalness: 0.1, clearcoat: 0.8, clearcoatRoughness: 0.1 }),
      visor: () => new THREE.MeshPhysicalMaterial({ color: lin("#0c0d12"), roughness: 0.05, metalness: 0.6, clearcoat: 1, clearcoatRoughness: 0.02, envMapIntensity: 1.6, side: THREE.DoubleSide }),
      mirror: () => new THREE.MeshStandardMaterial({ color: lin("#c8d2dc"), roughness: 0.04, metalness: 1, envMapIntensity: 1.4 }),
      screen: () => new THREE.MeshStandardMaterial({ color: lin("#050608"), emissive: lin("#1b6f3a"), emissiveIntensity: 0.6, roughness: 0.2 }),
      suit: () => new THREE.MeshStandardMaterial({ color: lin(team.suit || team.primary || "#1c2658"), roughness: 0.85, metalness: 0 }),
      tcam: () => new THREE.MeshPhysicalMaterial({ color: lin(drv && ds.indexOf(drv) === 1 ? "#f2d300" : "#101012"), roughness: 0.35, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
      helmet: () => new THREE.MeshPhysicalMaterial({ map: helmetTex, roughness: 0.3, metalness: 0.15, clearcoat: 1, clearcoatRoughness: 0.03 }),
      disc: () => makeLook(THREE, LOOKS.carbon_carbon),
      // RB22 wheels (photos): satin-black rims, a thin blue band on the outer lip, fluorescent yellow wheel nuts
      rimPaint: () => new THREE.MeshPhysicalMaterial({ color: lin("#0e0f12"), roughness: 0.42, metalness: 0.35, clearcoat: 0.5, clearcoatRoughness: 0.25 }),
      rimLip: () => new THREE.MeshPhysicalMaterial({ color: lin(LR ? "#1d3fb8" : team.primary || "#1d3fb8"), roughness: 0.3, metalness: 0.2, clearcoat: 1, clearcoatRoughness: 0.05, side: THREE.DoubleSide }),
      nut: () => new THREE.MeshPhysicalMaterial({ color: lin("#d8f000"), emissive: lin("#2a3000"), roughness: 0.3, metalness: 0.1, clearcoat: 1, clearcoatRoughness: 0.05 }),
    };
    const raw = (k) => cached("raw:" + k, RAW[k]);

    // ---- per-part material resolution
    const S = { L: null, spec: null, groups: {}, flapT: 0, highlight: new Set(), xray: null, mode: "solid", ghost: {}, ghostIds: [], flashes: [], timing: {} };
    function lookIdOf(it) {
      if (it.look && S.mode !== "materials") return it.look;
      const part = it.part, sp = S.spec;
      if (sp && sp.materials[part]) return sp.materials[part];
      if (Mats && Mats.supports && Mats.supports(part)) return Mats.baseOf(part);
      if (it.look) return it.look;
      return FIXED_LOOK[part] || "cfrp_t800s";
    }
    function matFor(it) {
      const mode = S.mode;
      if (mode === "materials") {
        if (["tyre", "tyreWall", "led", "visor", "mirror", "screen", "suit", "helmet", "black", "plank", "radiator"].indexOf(it.mat) >= 0) return raw(it.mat);
        const id = lookIdOf(it); return id ? lookMat(id, false) : raw("suit");
      }
      switch (it.mat) {
        case "paint": if (it.role === "fwMain" && (LR || (!atlas.fw && !(EI.LIVERIES && EI.LIVERIES.hasFrontWing && EI.LIVERIES.hasFrontWing(team.id))))) return lookMat(lookIdOf(it), !!LR); return paintMat(it.role || "body", it.proj || "main");
        case "carbon": return lookMat(lookIdOf(it), it.carbon === "matte");
        case "metal": return lookMat(it.look || lookIdOf(it), false);
        case "rim": return LR ? raw("rimPaint") : lookMat(lookIdOf(it), false);
        case "rimLip": return LR ? raw("rimLip") : lookMat(lookIdOf(it), false);
        case "nut": return LR ? raw("nut") : lookMat(it.look || "ti64", false);
        case "disc": return raw("disc");
        default: return RAW[it.mat] ? raw(it.mat) : lookMat("cfrp_t800s", false);
      }
    }

    // ---- livery reference coordinates: the design's x mapped through the anchors onto the livery designs' car (js/liveries.js)
    // (RB22 livery: its own frame = the RB22 baseline's anchors, so the baseline maps 1:1 and a changed design is stretched between them)
    const LREF = LR ? (() => { const A = LR.ANCHORS, w = (X) => 1.75 - X / 1000; return { RA: w(A.XR), XPU: w(A.XPU), XC: w(A.XC), XA: w(A.XA), tip: w(A.tip), ride: A.rh }; })()
      : { RA: -1.85, XPU: -0.485, XC: -0.105, XA: 1.825, tip: 3.04, ride: 52 };
    function refMapper(sp) {
      const wx = (X) => 1.75 - X / 1000;
      const xs = [wx(sp.XR), wx(sp.XPU), wx(sp.XC), wx(sp.XA), wx(sp.noseTip != null ? sp.noseTip : C3.DIM.noseTip)], ys = [LREF.RA, LREF.XPU, LREF.XC, LREF.XA, LREF.tip];
      const f = M3.monoCubic(xs, ys, 1).f, dy = (LREF.ride - sp.rh) / 1000;
      return (x, y, z, out, i) => { out[i] = f(x); out[i + 1] = y + dy; out[i + 2] = z; };
    }

    // ---- geometry -> THREE
    function toGeo(g) {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(g.pos, 3)); geo.setAttribute("normal", new THREE.BufferAttribute(g.nrm, 3)); geo.setAttribute("uv", new THREE.BufferAttribute(g.uv, 2));
      geo.setIndex(new THREE.BufferAttribute(g.idx, 1)); geo.computeBoundingSphere(); return geo;
    }
    const hiMat = keep(V.overlayMaterial({ color: o.highlightColor, base: 0.22, rim: 0.85, alpha: 0.9 }));
    const flashMat = keep(V.overlayMaterial({ color: 0xffffff, base: 0.55, rim: 1.0, alpha: 0, additive: true }));
    const ghostMat = keep(V.overlayMaterial({ color: o.ghostColor, base: 0.02, rim: 1.0, alpha: 0.85, rimPow: 3.2 }));
    const ghostHid = keep(V.overlayMaterial({ color: o.ghostColor, base: 0.0, rim: 0.3, alpha: 0.3, hidden: true, rimPow: 3.2 }));
    const xrMats = new Map();
    const xrMat = (part) => { const hex = S.xray ? S.xray(part) : 0x4fb6c8; if (!xrMats.has(hex)) xrMats.set(hex, V.overlayMaterial({ color: hex, base: 0.08, rim: 0.55, alpha: 0.85 })); return xrMats.get(hex); };
    const withOverlayAttrs = (geo, w) => { const n = geo.attributes.position.count; geo.setAttribute("aw", new THREE.BufferAttribute(w || new Float32Array(n).fill(1), 1)); geo.setAttribute("acol", new THREE.BufferAttribute(new Float32Array(n * 3), 3)); return geo; };

    function mountGroup(id, built, built1) {
      const G = { id, key: built.key, items: [], ms: built.ms };
      const mapRef = refMapper(S.spec);
      built.items.forEach((it, k) => {
        const geo = withOverlayAttrs(toGeo(it.geo));
        if (it.mat === "paint") { const P = it.geo.pos, R = new Float32Array(P.length); for (let i = 0; i < P.length; i += 3) mapRef(P[i], P[i + 1], P[i + 2], R, i); geo.setAttribute("aRef", new THREE.BufferAttribute(R, 3)); }
        const rec = { it, geo, part: it.part, sig: geoSig(it.geo) };
        // straight-mode end state (same topology): positions / normals to blend toward
        const it1 = built1 && built1.byName[it.name];
        if (it1 && it.flap && it1.geo.count === it.geo.count) { rec.p0 = it.geo.pos.slice(); rec.n0 = it.geo.nrm.slice(); rec.p1 = it1.geo.pos; rec.n1 = it1.geo.nrm; geo.attributes.position.setUsage(THREE.DynamicDrawUsage); }
        rec.mesh = new THREE.Mesh(geo, S.xray ? xrMat(it.part) : matFor(it)); rec.mesh.castShadow = !S.xray && it.mat !== "tyreWall"; rec.mesh.receiveShadow = false; rec.mesh.name = it.name; rec.mesh.userData.part = it.part;
        carRoot.add(rec.mesh);
        rec.mir = new THREE.Mesh(geo, rec.mesh.material); mirror.add(rec.mir);
        rec.hi = new THREE.Mesh(geo, hiMat); rec.hi.renderOrder = 6; rec.hi.visible = S.highlight.has(it.part); hiRoot.add(rec.hi);
        rec.fl = new THREE.Mesh(geo, flashMat); rec.fl.renderOrder = 7; rec.fl.visible = false; hiRoot.add(rec.fl);
        G.items.push(rec);
      });
      return G;
    }
    function unmountGroup(G) {
      if (!G) return;
      for (const r of G.items) { for (const m of [r.mesh, r.mir, r.hi, r.fl]) if (m && m.parent) m.parent.remove(m); r.geo.dispose(); }
    }
    function applyFlapTo(G) {
      const t = S.flapT;
      for (const r of G.items) {
        if (!r.p1) continue;
        const P = r.geo.attributes.position.array, N = r.geo.attributes.normal.array;
        for (let i = 0; i < P.length; i++) { P[i] = r.p0[i] + (r.p1[i] - r.p0[i]) * t; N[i] = r.n0[i] + (r.n1[i] - r.n0[i]) * t; }
        r.geo.attributes.position.needsUpdate = true; r.geo.attributes.normal.needsUpdate = true; r.geo.computeBoundingSphere();
      }
    }
    const smOn = (id, sp) => (id === "front_wing" ? sp.fw.sm > 0 && sp.fw.n >= 2 : id === "rear_wing" ? sp.rw.sm > 0 && sp.rw.n >= 2 : false);

    // ---- public: layout
    function setLayout(L) {
      const t0 = performance.now();
      S.L = L; const sp = C3.spec(L.params), prevMats = S.spec ? S.spec.materials : {}; S.spec = sp;
      const rebuilt = [];
      // a material swap changes no dimension: refresh the looks of that part's meshes (and report its group, for the flash)
      const swapped = new Set(); for (const id of new Set(Object.keys(prevMats).concat(Object.keys(sp.materials)))) if (prevMats[id] !== sp.materials[id]) swapped.add(id);
      if (swapped.size) for (const id of Object.keys(S.groups)) { let hit = false; for (const r of S.groups[id].items) if (swapped.has(r.part)) { const m = S.xray ? xrMat(r.part) : matFor(r.it); r.mesh.material = m; r.mir.material = m; hit = true; } if (hit) rebuilt.push(id); }
      for (const id of Object.keys(C3.GROUPS)) {
        const key = C3.groupKey(id, sp), G0 = S.groups[id];
        if (G0 && G0.key === key) continue;
        const tg = performance.now();
        const b0 = C3.buildGroup(id, sp, { flap: 0 }), b1 = C3.GROUPS[id].flap && smOn(id, sp) ? C3.buildGroup(id, sp, { flap: 1, flapOnly: true }) : null;
        if (b1) { b1.byName = {}; for (const it of b1.items) b1.byName[it.name] = it; }
        unmountGroup(G0);
        const G = mountGroup(id, b0, b1); S.groups[id] = G; if (b1) applyFlapTo(G);
        S.timing[id] = performance.now() - tg; if (rebuilt.indexOf(id) < 0) rebuilt.push(id);
      }
      S.timing.total = performance.now() - t0;
      return rebuilt;
    }
    function setFlaps(t) {
      t = clamp(t, 0, 1); if (Math.abs(t - S.flapT) < 1e-4) return; S.flapT = t;
      for (const id of ["front_wing", "rear_wing"]) if (S.groups[id]) applyFlapTo(S.groups[id]);
    }
    function refreshMaterials() {
      for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) { const m = S.xray ? xrMat(r.part) : matFor(r.it); r.mesh.material = m; r.mir.material = m; r.mesh.castShadow = !S.xray && r.it.mat !== "tyreWall"; }
    }
    function setMode(mode) { S.mode = mode === "materials" ? "materials" : "solid"; refreshMaterials(); }

    // ---- highlight / flash
    function setHighlight(set) { S.highlight = set || new Set(); for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) r.hi.visible = S.highlight.has(r.part); }
    // geometry signature of an item (vertex count + a strided positional checksum): which items a change really moved
    function geoSig(g) { const P = g.pos, st = Math.max(3, Math.floor(P.length / 3 / 400) * 3); let s = 0; for (let i = 0; i < P.length; i += st) s += P[i] * 1.3 + P[i + 1] * 2.7 + P[i + 2] * 3.1; return g.count + ":" + s.toFixed(4); }
    function snapshot() { const m = new Map(); for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) m.set(r.it.name, r.sig); return m; }
    // flash the rebuilt groups; with `since` (a snapshot()) only the items whose geometry differs from it (a nose change flashes the
    // nose and its pylons, not the whole wing)
    function flash(groupIds, now, since) {
      const t = now != null ? now : performance.now();
      for (const id of groupIds || []) {
        const G = S.groups[id]; if (!G) continue;
        const hit = since ? G.items.filter(r => since.get(r.it.name) !== r.sig) : G.items;
        if (!hit.length) continue;
        S.flashes.push({ id, t0: t }); for (const r of hit) r.fl.visible = true;
      }
    }
    function tick(now) {
      if (!S.flashes.length) return false;
      const DUR = 900; let maxA = 0; const live = [];
      for (const f of S.flashes) { const k = Math.max(0, (now - f.t0) / DUR); if (k < 1) { live.push(f); maxA = Math.max(maxA, Math.sin(Math.PI * Math.min(1, 0.15 + k * 1.1)) * (1 - k)); } }
      flashMat.uniforms.alpha.value = 0.75 * maxA;
      if (!live.length) for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) r.fl.visible = false;
      S.flashes = live; return live.length > 0;
    }

    // ---- x-ray
    function setXray(fn) { S.xray = fn || null; xrMats.forEach(m => m.dispose()); xrMats.clear(); refreshMaterials(); }

    // ---- ghost (baseline)
    const GTOL = 0.004, ss = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
    function clearGhost() { for (const id of Object.keys(S.ghost)) { for (const m of S.ghost[id].meshes) m.parent && m.parent.remove(m); for (const g of S.ghost[id].geos) g.dispose(); } S.ghost = {}; }
    function setGhost(BL) {
      clearGhost();
      if (!BL || !S.spec) { S.ghostIds = []; return []; }
      const bs = C3.spec(BL.params), ids = new Set();
      for (const id of Object.keys(C3.GROUPS)) {
        const cur = S.groups[id]; if (cur && cur.key === C3.groupKey(id, bs)) continue;
        const b = C3.buildGroup(id, bs, { flap: 0 }), meshes = [], geos = [];
        b.items.forEach((it, k) => {
          const ci = cur && cur.items[k], same = ci && ci.it.name === it.name && ci.it.geo.count === it.geo.count, a = same ? (ci.p0 || ci.it.geo.pos) : null, P = it.geo.pos, n = it.geo.count, w = new Float32Array(n);
          let any = false; for (let i = 0; i < n; i++) { const d = a ? Math.hypot(a[i * 3] - P[i * 3], a[i * 3 + 1] - P[i * 3 + 1], a[i * 3 + 2] - P[i * 3 + 2]) : 1; w[i] = ss(GTOL, 2.5 * GTOL, d); if (w[i] > 0.5) any = true; }
          if (!any) return;
          const geo = withOverlayAttrs(toGeo(it.geo), w); geos.push(geo);
          const m1 = new THREE.Mesh(geo, ghostMat); m1.renderOrder = 5; const m2 = new THREE.Mesh(geo, ghostHid); m2.renderOrder = 4; ghostRoot.add(m1, m2); meshes.push(m1, m2);
          ids.add(it.part);
        });
        S.ghost[id] = { meshes, geos };
      }
      const order = C.view.REGIONS.filter(r => r !== "none");
      S.ghostIds = order.filter(r => ids.has(r)).concat(Array.from(ids).filter(r => order.indexOf(r) < 0));
      return S.ghostIds.slice();
    }
    function hideGhost() { clearGhost(); S.ghostIds = []; }

    // ---- queries
    function partCentre(part) {
      const box = new THREE.Box3(), b = new THREE.Box3(); let any = false;
      for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) if (r.part === part) { if (!r.geo.boundingBox) r.geo.computeBoundingBox(); b.copy(r.geo.boundingBox); if (any) box.union(b); else { box.copy(b); any = true; } }
      return any ? box.getCenter(new THREE.Vector3()) : null;
    }
    function materialsUsed() {
      const out = [], sp = S.spec || { materials: {} }, seen = new Set();
      const list = (C.parts && C.parts.MATERIAL_PARTS) || [];
      for (const part of list) {
        if (part === "ballast" || seen.has(part)) continue; seen.add(part);
        const base = Mats && Mats.supports && Mats.supports(part) ? Mats.baseOf(part) : null, id = sp.materials[part] || base;
        const M = Mats && Mats.get ? Mats.get(id) : null;
        out.push({ part, material: id, name: (LOOKS[id] && LOOKS[id].label) || (M && M.name) || id, base, changed: !!(sp.materials[part] && sp.materials[part] !== base), swatch: (LOOKS[id] || {}).col || "#888" });
      }
      for (const part of ["halo", "wheels_front", "brakes_front"]) { const id = FIXED_LOOK[part]; out.push({ part, material: id, name: LOOKS[id].label, base: id, changed: false, fixed: true, swatch: LOOKS[id].col }); }
      return out;
    }
    function stats() {
      let v = 0, t = 0, n = 0; for (const id of Object.keys(S.groups)) for (const r of S.groups[id].items) { v += r.it.geo.count; t += r.it.geo.idx.length / 3; n++; }
      return { meshes: n, vertices: v, triangles: t, partVertices: v, timing: Object.assign({}, S.timing), procedural: Object.keys(S.groups), groups: Object.keys(S.groups).length };
    }
    function dispose() {
      for (const id of Object.keys(S.groups)) unmountGroup(S.groups[id]); S.groups = {};
      clearGhost();
      for (const m of xrMats.values()) m.dispose(); xrMats.clear();
      atlas.tex.cvGone = true; for (const x of disposables) x && x.dispose && x.dispose();
    }
    return {
      setLayout, setGhost, hideGhost, setFlaps, setHighlight, setXray, setMode, flash, snapshot, tick, partCentre, materialsUsed, stats, dispose,
      spec: () => S.spec, _S: S, team, driver: drv, liveryReady,
    };
  }

  C.parts3d = { createCar, LOOKS, FIXED_LOOK, TILES, RANGES };
  if (typeof module !== "undefined" && module.exports) module.exports = C.parts3d;
})();
