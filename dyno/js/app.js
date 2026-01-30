console.log("✅ app.js dimuat");

window.addEventListener("DOMContentLoaded", () => {
  if (typeof DYNO_init === "function") {
    DYNO_init();
  }
});
