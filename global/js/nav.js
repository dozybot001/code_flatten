function switchMainView(viewName) {
    const slider = document.getElementById('viewSlider');
    const bmCast = document.getElementById('bm-cast');
    const bmForge = document.getElementById('bm-forge');
    const bmRefine = document.getElementById('bm-refine');

    // Reset active states
    bmCast.classList.remove('active');
    bmForge.classList.remove('active');
    bmRefine.classList.remove('active');

    // Slider container height is 300vh
    // Page 1 (Cast) -> 0%
    // Page 2 (Forge) -> -33.33% (approx -100vh)
    // Page 3 (Refine) -> -66.66% (approx -200vh)

    if (viewName === 'cast') {
        slider.style.transform = 'translateY(0%)';
        bmCast.classList.add('active');
    } else if (viewName === 'forge') {
        slider.style.transform = 'translateY(-33.333%)';
        bmForge.classList.add('active');
    } else if (viewName === 'refine') {
        slider.style.transform = 'translateY(-66.666%)';
        bmRefine.classList.add('active');
    }
}