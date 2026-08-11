const swiper = new Swiper('.swiper', {
  autoplay: {
    delay: 4000,
    disableOnInteraction: false
  },
  loop: true,
  spaceBetween: 0,
  effect: "creative",
  speed: 1500, // transition speed

  creativeEffect: {
    prev: {
      // Zoom out (shrink + fade)
      scale: 1.1,
      opacity: 0,
      translate: [0, 0, 0], // stay centered
    },
    next: {
      // Zoom in (grow + fade in)
      scale: 1.3,
      opacity: 0,
      translate: [0, 0, 0], // stay centered
    },
  },

  navigation: {
    nextEl: ".swiper-button-next",
    prevEl: ".swiper-button-prev",
  },
  pagination: {
    el: false,
    clickable: false,
  },
});
