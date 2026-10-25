// PURPLE journey nav (concept/nav/nav.css): small progressive touches on the static <nav class="pnav"> markup each main page carries.
//  - the current step's link points at this exact page (the race page keeps its ?design=... car when you click it)
//  - the concept lab link carries the ?api= the visitor arrived with (the site root sends ?api=/), so going back to step 1 keeps live mode
//  - on a phone the step row scrolls sideways inside itself: the current step is scrolled into view, a soft edge shows there is more
// No framework, no build step; the page works the same without this file.
(function () {
  function init() {
    const nav = document.querySelector(".pnav"); if (!nav) return;
    let api = null;
    try { api = new URLSearchParams(location.search).get("api"); } catch (e) { /* old browser */ }
    try { if (api) sessionStorage.setItem("purple.api", api); else api = sessionStorage.getItem("purple.api"); } catch (e) { /* storage blocked */ }
    const steps = nav.querySelector(".pnav-steps");
    for (const a of nav.querySelectorAll("a[data-step]")) {
      if (a.getAttribute("aria-current") === "page") { a.href = location.pathname + location.search; continue; }
      if (a.dataset.step === "1" && api) a.href = a.getAttribute("href").split("?")[0] + "?api=" + encodeURIComponent(api);
    }
    if (!steps) return;
    const cur = steps.querySelector('[aria-current="page"]');
    const edge = () => { const more = steps.scrollWidth - steps.clientWidth - steps.scrollLeft > 4; if (more) steps.setAttribute("data-more", ""); else steps.removeAttribute("data-more"); };
    if (cur && steps.scrollWidth > steps.clientWidth) {   // scroll only as far as needed to show the whole current step
      const li = cur.closest("li"), right = li.offsetLeft - steps.offsetLeft + li.offsetWidth;
      if (right > steps.clientWidth) steps.scrollLeft = right - steps.clientWidth + 4;
    }
    edge();
    steps.addEventListener("scroll", edge, { passive: true });
    window.addEventListener("resize", edge);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", init); else init();
})();
