function enableDrag_BASIC(){
  const c = document.getElementById("curveCanvas");
  if (!c) return;

  // WAJIB untuk HP: supaya drag tidak dianggap scroll/zoom browser
  c.style.touchAction = "none";

  // kalau kamu pakai wrapper scroll dari HTML landscape
  const workspace = document.getElementById("workspace");

  let dragging = false;
  let idx = null;

  function lockScroll(lock){
    if (workspace){
      workspace.style.overflow = lock ? "hidden" : "auto";
    }
  }

  // client (layar) -> canvas pixel (akurat walau UI di-zoom pakai CSS)
  function getPos(e){
    const r = c.getBoundingClientRect();
    const sx = c.width  / r.width;
    const sy = c.height / r.height;
    return {
      x: (e.clientX - r.left) * sx,
      y: (e.clientY - r.top)  * sy
    };
  }

  function pickIndex(p){
    const cap = BASIC.pickup ?? TIMING_MAX;
    const plotW = c.width - PLOT_LEFT - AXIS_RIGHT_PADDING;
    const plotH = c.height - AXIS_BOTTOM - AXIS_TOP_PADDING;

    let hit = null;

    for (let i = 0; i < BASIC.curve.length; i++){
      if (BASIC.limiter && rpmPoints_BASIC[i] > BASIC.limiter) continue;

      const x = PLOT_LEFT + (i / (BASIC.curve.length - 1)) * plotW;
      const y = AXIS_TOP_PADDING + plotH - (Math.min(BASIC.curve[i], cap) / cap) * plotH;

      // radius lebih besar untuk jari
      const R = (navigator.maxTouchPoints && navigator.maxTouchPoints > 0) ? 22 : 10;
      if (Math.hypot(p.x - x, p.y - y) <= R){
        hit = i;
        break;
      }
    }
    return hit;
  }

  function setValueFromY(i, y){
    const cap = BASIC.pickup ?? TIMING_MAX;
    const plotH = c.height - AXIS_BOTTOM - AXIS_TOP_PADDING;

    let val = cap * (1 - (y - AXIS_TOP_PADDING) / plotH);
    val = Math.max(TIMING_MIN, Math.min(cap, val));

    BASIC.curve[i] = val;

    const inp = document.querySelector(`#rpmTable tr:nth-child(${i + 2}) input`);
    if (inp) inp.value = val.toFixed(1);

    redraw_BASIC();
  }

  function onDown(e){
    // hanya klik kiri / touch
    if (e.button !== undefined && e.button !== 0) return;

    const p = getPos(e);
    const i = pickIndex(p);
    if (i === null) return;

    dragging = true;
    idx = i;

    lockScroll(true);

    // supaya drag tidak putus walau finger keluar canvas
    try { c.setPointerCapture(e.pointerId); } catch(_){}

    e.preventDefault();
    e.stopPropagation();

    setValueFromY(idx, p.y);
  }

  function onMove(e){
    if (!dragging || idx === null) return;

    const p = getPos(e);

    e.preventDefault();
    e.stopPropagation();

    setValueFromY(idx, p.y);
  }

  function onUp(){
    if (!dragging) return;
    dragging = false;
    idx = null;
    lockScroll(false);
  }

  // matikan handler lama biar tidak bentrok
  c.onmousedown = null;
  c.onmousemove = null;
  window.onmouseup = null;

  // listener wajib passive:false supaya preventDefault bekerja
  c.addEventListener("pointerdown", onDown, { passive:false });
  c.addEventListener("pointermove", onMove, { passive:false });
  c.addEventListener("pointerup", onUp, { passive:true });
  c.addEventListener("pointercancel", onUp, { passive:true });
  window.addEventListener("pointerup", onUp, { passive:true });
}
