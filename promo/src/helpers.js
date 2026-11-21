// shared helpers (inlined by tools/build.py). All seek-safe: fromTo + absolute positions.
function hfMeasure(paths) {
  // getTotalLength on a visibility:hidden clone so a hidden clip never yields 0
  const svg = paths[0].closest("svg");
  const clone = svg.cloneNode(true);
  clone.style.cssText = "position:absolute;left:-99999px;top:0;width:1000px;height:1000px;visibility:hidden";
  document.body.appendChild(clone);
  const cl = clone.querySelectorAll("path");
  const src = svg.querySelectorAll("path");
  const map = new Map();
  src.forEach((p, i) => map.set(p, cl[i].getTotalLength()));
  document.body.removeChild(clone);
  return paths.map((p) => map.get(p) || p.getTotalLength());
}
// Draw a group of chunk paths as a continuous sweep.
// sel: css selector of the paths; at: start; total: whole sweep length; chunk: per-path draw time
function drawOn(tl, sel, at, total, chunk, ease) {
  const els = Array.from(document.querySelectorAll(sel));
  if (!els.length) return;
  const lens = hfMeasure(els);
  const n = els.length;
  const step = n > 1 ? (total - chunk) / (n - 1) : 0;
  els.forEach((p, i) => {
    const L = lens[i] * 1.02;
    tl.fromTo(p, { strokeDasharray: L, strokeDashoffset: L }, { strokeDashoffset: 0, duration: chunk, ease: ease || "power1.out" }, at + i * step);
  });
}
// Log lines arrive binary (waterfall): opacity set + small slide.
function logIn(tl, sel, at, every, slide) {
  const els = Array.from(document.querySelectorAll(sel));
  els.forEach((el, i) => {
    const t = at + i * every;
    tl.set(el, { opacity: 1 }, t);
    tl.fromTo(el, { x: slide == null ? -14 : slide }, { x: 0, duration: 0.28, ease: "power3.out" }, t);
  });
}
// Typewriter: deterministic per-char tl.set
function typeText(tl, el, text, at, cps) {
  const per = 1 / (cps || 28);
  for (let i = 1; i <= text.length; i++) tl.set(el, { textContent: text.slice(0, i) }, at + i * per);
  return at + text.length * per;
}
