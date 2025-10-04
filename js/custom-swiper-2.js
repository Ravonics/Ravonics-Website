const swiper = new Swiper('.swiper', {
  autoplay: {
    delay: 4000,
    disableOnInteraction: false
  },
  loop: true,
  spaceBetween: 0,
  speed: 1500, // transition speed

  // Enable parallax effect
  parallax: true,

  navigation: {
    nextEl: ".swiper-button-next",
    prevEl: ".swiper-button-prev",
  },
  pagination: {
    el: false,
    clickable: false,
  },
});
