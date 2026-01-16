document.addEventListener('DOMContentLoaded', () => {

  /* =====================================================
     HERO SLIDER (TETAP – TIDAK DIUBAH LOGIKANYA)
  ===================================================== */

  const slides = document.querySelector('.slides');
  const dots = document.querySelectorAll('.slider-dots span');

  if (slides && dots.length > 0) {

    const total = dots.length;
    let index = 0;
    const holdTime = 2000; // 2 detik tampil

    function update(){
      slides.style.transform = `translateX(-${index * 100}%)`;
      dots.forEach(d => d.classList.remove('active'));
      dots[index].classList.add('active');
    }

    // tampilkan slide pertama
    update();

    setInterval(() => {
      index = (index + 1) % total;
      update();
    }, holdTime);
  }


  /* =====================================================
     PRODUK UNGGULAN – SLIDER + DETAIL
     (INI TAMBAHAN BARU)
  ===================================================== */

  const productTrack = document.getElementById('productTrack');
  const btnPrev = document.getElementById('prodPrev');
  const btnNext = document.getElementById('prodNext');

  if (productTrack && btnPrev && btnNext) {

    const scrollAmount = 360; // ± lebar 1 card produk

    btnNext.addEventListener('click', () => {
      productTrack.scrollBy({
        left: scrollAmount,
        behavior: 'smooth'
      });
    });

    btnPrev.addEventListener('click', () => {
      productTrack.scrollBy({
        left: -scrollAmount,
        behavior: 'smooth'
      });
    });

  }

});
