document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     MENU DRAWER (HAMBURGER)
  ===================================================== */

  const menuBtn     = document.getElementById('menuBtn');
  const menuDrawer  = document.getElementById('menuDrawer');
  const menuOverlay = document.getElementById('menuOverlay');
  const menuClose   = document.getElementById('menuClose');

  function setMenuOpen(open){
    document.body.classList.toggle('menu-open', !!open);
    if (menuBtn) menuBtn.setAttribute('aria-expanded', open ? 'true' : 'false');

    document.documentElement.style.overflow = open ? 'hidden' : '';
    document.body.style.overflow = open ? 'hidden' : '';
  }

  if (menuBtn && menuDrawer && menuOverlay && menuClose){
    menuBtn.addEventListener('click', () => {
      const open = !document.body.classList.contains('menu-open');
      setMenuOpen(open);
    });

    menuClose.addEventListener('click', () => setMenuOpen(false));
    menuOverlay.addEventListener('click', () => setMenuOpen(false));

    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('menu-open')){
        setMenuOpen(false);
      }
    });

    menuDrawer.addEventListener('click', (e) => {
      const a = e.target.closest('a');
      if (a) setMenuOpen(false);
    });
  }


  /* =====================================================
     HERO SLIDER (AUTO + DRAG SUPER RINGAN + THRESHOLD RENDAH)
  ===================================================== */

  const slides = document.getElementById('heroSlides') || document.querySelector('.hero-slider .slides');
  const dots   = document.querySelectorAll('.slider-dots span');

  if (slides && dots.length > 0) {

    const total = dots.length;
    let index = 0;

    let autoTimer = null;
    let resumeTimer = null;

    const AUTO_INTERVAL_MS = 2200;
    const RESUME_AFTER_MS  = 1600;

    // >>> lebih ringan & cepat pindah
    const DRAG_GAIN = 1.95;   // makin besar makin enteng (coba 1.7 kalau masih kurang)
    const THRESH_FRAC = 0.10; // 10% lebar sudah pindah

    function clamp(i){
      if (i < 0) return total - 1;
      if (i >= total) return 0;
      return i;
    }

    function setDot(i){
      dots.forEach(d => d.classList.remove('active'));
      if (dots[i]) dots[i].classList.add('active');
    }

    function slideW(){
      return slides.clientWidth || 1;
    }

    function goTo(i, behavior='smooth'){
      index = clamp(i);
      slides.scrollTo({ left: index * slideW(), behavior });
      setDot(index);
    }

    function stopAuto(){
      if (autoTimer){
        clearInterval(autoTimer);
        autoTimer = null;
      }
    }

    function startAuto(){
      stopAuto();
      autoTimer = setInterval(() => {
        goTo(index + 1, 'smooth');
      }, AUTO_INTERVAL_MS);
    }

    function pauseThenResume(){
      stopAuto();
      if (resumeTimer) clearTimeout(resumeTimer);
      resumeTimer = setTimeout(() => startAuto(), RESUME_AFTER_MS);
    }

    // ===== DRAG MOUSE =====
    let isDown = false;
    let startX = 0;
    let startScrollLeft = 0;
    let snapBackup = "";

    slides.addEventListener('mousedown', (e) => {
      if (e.button !== 0) return;
      isDown = true;

      slides.classList.add('dragging');
      pauseThenResume();

      startX = e.clientX;
      startScrollLeft = slides.scrollLeft;

      // matikan snap saat drag biar gak “ngunci”
      snapBackup = slides.style.scrollSnapType;
      slides.style.scrollSnapType = 'none';

      e.preventDefault();
    });

    document.addEventListener('mousemove', (e) => {
      if (!isDown) return;

      const dx = e.clientX - startX;
      slides.scrollLeft = startScrollLeft - (dx * DRAG_GAIN);

      e.preventDefault();
    });

    function endDrag(){
      if (!isDown) return;
      isDown = false;

      slides.classList.remove('dragging');
      slides.style.scrollSnapType = snapBackup || '';

      const w = slideW();
      const movedPx = slides.scrollLeft - startScrollLeft;
      const THRESH = w * THRESH_FRAC;

      if (movedPx > THRESH) {
        index = clamp(index + 1);
      } else if (movedPx < -THRESH) {
        index = clamp(index - 1);
      }

      goTo(index, 'smooth');
      pauseThenResume();
    }

    document.addEventListener('mouseup', endDrag);
    slides.addEventListener('mouseleave', endDrag);

    // klik dot => pindah
    dots.forEach((dot, i) => {
      dot.addEventListener('click', () => {
        goTo(i, 'smooth');
        pauseThenResume();
      });
    });

    goTo(0, 'auto');
    startAuto();
  }


  /* =====================================================
     PRODUK UNGGULAN – SLIDER
  ===================================================== */

  const productTrack = document.getElementById('productTrack');
  const btnPrev = document.getElementById('prodPrev');
  const btnNext = document.getElementById('prodNext');

  if (productTrack && btnPrev && btnNext) {
    const scrollAmount = 360;

    btnNext.addEventListener('click', () => {
      productTrack.scrollBy({ left: scrollAmount, behavior: 'smooth' });
    });

    btnPrev.addEventListener('click', () => {
      productTrack.scrollBy({ left: -scrollAmount, behavior: 'smooth' });
    });
  }

});
