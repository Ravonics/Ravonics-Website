(function () {
  const canvas = document.getElementById('magazine-surface');
  if (!(canvas instanceof HTMLCanvasElement)) return;

  const mediaCount = Number.parseInt(canvas.getAttribute('data-media-count') || '0', 10);
  const route = canvas.getAttribute('data-route') || '/';
  const kind = canvas.getAttribute('data-kind') || 'unknown';
  const hasInteraction = canvas.getAttribute('data-has-interaction') === 'true';
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  const gl = canvas.getContext('webgl', { alpha: false, antialias: true });
  const context = gl ? null : canvas.getContext('2d');
  if (!gl && !context) return;

  const scene = {
    ticks: 0,
    particles: Array.from({ length: Math.max(28, mediaCount * 4 + 6) }).map((_, index) => ({
      orbit: 90 + index * 2,
      radius: 2.2 + (index % 4),
      speed: 0.0006 + (index % 7) * 0.0002,
      offset: index * 17
    }))
  };

  const palette = {
    bg: 'rgba(8, 18, 39, 0.95)',
    primary: '#86aeff',
    panel: 'rgba(255, 255, 255, 0.06)',
    accent: '#6fd3ff',
    glow: 'rgba(140, 200, 255, 0.35)',
    text: '#dce8ff'
  };

  function compileShader(type, source) {
    const shader = gl.createShader(type);
    if (!shader) return null;
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null;
  }

  function createWebglRenderer() {
    if (!gl) return null;
    const vertex = compileShader(gl.VERTEX_SHADER, 'attribute vec2 a_position; attribute float a_size; uniform float u_time; varying float v_signal; void main() { float drift = sin(u_time + a_position.x * 4.0) * 0.018; gl_Position = vec4(a_position.x, a_position.y + drift, 0.0, 1.0); gl_PointSize = a_size; v_signal = a_position.x; }');
    const fragment = compileShader(gl.FRAGMENT_SHADER, 'precision mediump float; uniform vec4 u_color; varying float v_signal; void main() { vec2 point = gl_PointCoord - 0.5; if (length(point) > 0.5) discard; float glow = 1.0 - smoothstep(0.12, 0.5, length(point)); gl_FragColor = vec4(u_color.rgb + glow * 0.18, 0.9); }');
    if (!vertex || !fragment) return null;
    const program = gl.createProgram();
    if (!program) return null;
    gl.attachShader(program, vertex);
    gl.attachShader(program, fragment);
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null;
    return { program, position: gl.createBuffer(), size: gl.createBuffer(), positionLocation: gl.getAttribLocation(program, 'a_position'), sizeLocation: gl.getAttribLocation(program, 'a_size'), timeLocation: gl.getUniformLocation(program, 'u_time'), colorLocation: gl.getUniformLocation(program, 'u_color') };
  }

  const webglRenderer = createWebglRenderer();

  function resizeCanvas() {
    const width = Math.max(320, Math.floor(canvas.clientWidth || 860));
    const height = Math.max(220, Math.floor(canvas.clientHeight || 220));
    const ratio = window.devicePixelRatio || 1;
    canvas.width = width * ratio;
    canvas.height = height * ratio;
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    if (gl) {
      gl.viewport(0, 0, canvas.width, canvas.height);
    } else if (context) {
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      context.imageSmoothingEnabled = true;
    }
  }

  function renderWebgl(timestamp) {
    if (!gl || !webglRenderer) return;
    const width = Math.max(1, canvas.clientWidth || 860);
    const height = Math.max(1, canvas.clientHeight || 220);
    const positions = new Float32Array(scene.particles.length * 2);
    const sizes = new Float32Array(scene.particles.length);
    const now = reducedMotion ? 0 : timestamp || 0;
    for (let index = 0; index < scene.particles.length; index += 1) {
      const particle = scene.particles[index];
      const progress = (now * particle.speed + particle.offset) % (Math.PI * 2);
      const radius = 0.35 + ((index % 6) / 6) * 0.22;
      positions[index * 2] = Math.cos(progress + scene.ticks) * radius;
      positions[index * 2 + 1] = Math.sin(progress + scene.ticks) * radius * (width / height);
      sizes[index] = particle.radius * (window.devicePixelRatio || 1) + (index % 3) * 2;
    }
    gl.clearColor(0.03, 0.07, 0.15, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.useProgram(webglRenderer.program);
    gl.bindBuffer(gl.ARRAY_BUFFER, webglRenderer.position);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(webglRenderer.positionLocation);
    gl.vertexAttribPointer(webglRenderer.positionLocation, 2, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, webglRenderer.size);
    gl.bufferData(gl.ARRAY_BUFFER, sizes, gl.DYNAMIC_DRAW);
    gl.enableVertexAttribArray(webglRenderer.sizeLocation);
    gl.vertexAttribPointer(webglRenderer.sizeLocation, 1, gl.FLOAT, false, 0, 0);
    gl.uniform1f(webglRenderer.timeLocation, now * 0.001);
    gl.uniform4f(webglRenderer.colorLocation, 0.46, 0.76, 1, 1);
    gl.drawArrays(gl.POINTS, 0, scene.particles.length);
    scene.ticks += reducedMotion ? 0 : 0.002;
  }

  function renderCanvas2d(timestamp) {
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (width === 0 || height === 0) return;
    const cx = width / 2;
    const cy = height / 2;
    context.clearRect(0, 0, width, height);
    context.fillStyle = palette.bg;
    context.fillRect(0, 0, width, height);
    const baseRadius = Math.min(width, height) / 2.6;
    const now = reducedMotion ? 0 : timestamp || 0;
    scene.particles.forEach((node, index) => {
      const progress = (now * node.speed + node.offset) % (Math.PI * 2);
      const radial = baseRadius + (reducedMotion ? 0 : Math.sin(now * 0.0004 + index) * 16);
      const x = cx + Math.cos(progress + scene.ticks) * (node.orbit + radial / 16);
      const y = cy + Math.sin(progress + scene.ticks) * (node.orbit + radial / 16);
      context.beginPath();
      context.fillStyle = node.radius > 4 ? palette.accent : palette.primary;
      context.arc(x, y, node.radius, 0, Math.PI * 2);
      context.fill();
      if (index % 4 === 0) {
        context.strokeStyle = palette.panel;
        context.lineWidth = 1;
        context.beginPath();
        context.moveTo(x, y);
        context.lineTo(cx - (x - cx) * 0.8, cy - (y - cy) * 0.8);
        context.stroke();
      }
    });
    context.fillStyle = palette.text;
    context.font = '12px system-ui, sans-serif';
    context.fillText(`Route: ${route}`, 12, height - 20);
    context.fillText(`Kind: ${kind}`, 12, height - 6);
    context.fillStyle = palette.glow;
    context.fillText(`${hasInteraction ? 'Interactive route' : 'Narrative media route'}`, width - 230, 22);
    context.fillText(`${scene.particles.length} story nodes · ${mediaCount} media references`, width - 230, 36);
    scene.ticks += reducedMotion ? 0 : 0.002;
  }

  function renderStatic() {
    if (webglRenderer) {
      renderWebgl(0);
      return;
    }
    if (!context) return;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    context.clearRect(0, 0, width, height);
    context.fillStyle = 'rgba(9, 18, 37, 0.95)';
    context.fillRect(0, 0, width, height);
    context.fillStyle = '#d6e4ff';
    context.font = '600 17px system-ui, sans-serif';
    context.fillText('Dynamic scene disabled (reduced motion)', 16, 28);
    context.font = '13px system-ui, sans-serif';
    context.fillText(`Route: ${route}`, 16, 54);
    context.fillText(`Media references: ${mediaCount}`, 16, 72);
    context.strokeStyle = 'rgba(140, 200, 255, 0.35)';
    context.strokeRect(12, 12, width - 24, height - 24);
  }

  function render(timestamp) {
    if (webglRenderer) renderWebgl(timestamp);
    else renderCanvas2d(timestamp);
    if (!reducedMotion) window.requestAnimationFrame(render);
  }

  resizeCanvas();
  if (reducedMotion) renderStatic();
  else window.requestAnimationFrame(render);
  window.addEventListener('resize', resizeCanvas, { passive: true });

  const galleryImages = Array.from(document.querySelectorAll('img[data-media-id]')).filter((image) => {
    const source = image.getAttribute('src') || image.getAttribute('data-src') || '';
    return Boolean(source.trim()) && !image.closest('a,button,[role="button"]');
  });
  if (galleryImages.length > 0) {
    const overlay = document.createElement('div');
    const frame = document.createElement('div');
    const view = document.createElement('img');
    const caption = document.createElement('p');
    const close = document.createElement('button');
    let activeImage = 0;
    let previousFocus = null;
    overlay.setAttribute('aria-hidden', 'true');
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', 'Image preview');
    overlay.style.cssText = 'position:fixed;inset:0;background:rgba(5,9,18,.94);display:none;align-items:center;justify-content:center;z-index:9999;padding:2rem;';
    frame.style.cssText = 'position:relative;max-width:min(94vw,1200px);max-height:92vh;';
    view.style.cssText = 'max-width:100%;max-height:78vh;object-fit:contain;border-radius:10px;';
    caption.style.cssText = 'color:#dce9ff;margin:.55rem 0 0;text-align:center;font-size:.9rem;';
    close.style.cssText = 'position:absolute;top:-16px;right:-16px;border:1px solid rgba(255,255,255,.3);background:#09122a;color:#fff;border-radius:999px;min-width:38px;height:38px;padding:0 .55rem;';
    close.textContent = 'Close';
    close.setAttribute('aria-label', 'Close media preview');
    frame.appendChild(view);
    frame.appendChild(caption);
    overlay.appendChild(frame);
    overlay.appendChild(close);
    document.body.appendChild(overlay);

    function hideOverlay() {
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      if (previousFocus instanceof HTMLElement) previousFocus.focus();
    }

    function showOverlay(index) {
      activeImage = (index + galleryImages.length) % galleryImages.length;
      const image = galleryImages[activeImage];
      view.src = image.getAttribute('src') || '';
      view.alt = image.getAttribute('alt') || 'Media preview';
      caption.textContent = image.getAttribute('alt') || image.getAttribute('data-media-id') || 'Media preview';
      previousFocus = document.activeElement;
      overlay.style.display = 'flex';
      overlay.setAttribute('aria-hidden', 'false');
      close.focus();
    }

    close.addEventListener('click', hideOverlay);
    overlay.addEventListener('click', (event) => { if (event.target === overlay) hideOverlay(); });
    document.addEventListener('keydown', (event) => {
      if (overlay.style.display !== 'flex') return;
      if (event.key === 'Escape') hideOverlay();
      if (event.key === 'ArrowRight') showOverlay(activeImage + 1);
      if (event.key === 'ArrowLeft') showOverlay(activeImage - 1);
    });
    galleryImages.forEach((image, index) => {
      image.addEventListener('click', () => showOverlay(index));
      image.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          showOverlay(index);
        }
      });
      image.setAttribute('tabindex', image.getAttribute('tabindex') || '0');
      image.setAttribute('role', 'button');
    });
  }

  document.querySelectorAll('[data-carousel]').forEach((root) => {
    const slides = Array.from(root.querySelectorAll('[data-slide]'));
    if (!slides.length) return;
    const status = root.querySelector('[data-carousel-status]');
    let active = 0;
    const update = (next) => {
      active = (next + slides.length) % slides.length;
      slides.forEach((slide, index) => {
        slide.hidden = index !== active;
        slide.setAttribute('aria-hidden', String(index !== active));
      });
      if (status) status.textContent = `Prompt ${active + 1} of ${slides.length}`;
    };
    root.querySelector('[data-carousel-prev]')?.addEventListener('click', () => update(active - 1));
    root.querySelector('[data-carousel-next]')?.addEventListener('click', () => update(active + 1));
    root.addEventListener('keydown', (event) => {
      if (event.key === 'ArrowLeft') { event.preventDefault(); update(active - 1); }
      if (event.key === 'ArrowRight') { event.preventDefault(); update(active + 1); }
    });
    update(0);
  });

  const media = Array.from(document.querySelectorAll('img[data-media-id]'));
  if (media.length > 1) {
    const hint = document.createElement('p');
    hint.className = 'magazine-scroll-hint';
    hint.setAttribute('role', 'status');
    hint.textContent = 'Tip: focus an image, then use Arrow Left or Arrow Right to inspect the media sequence.';
    document.querySelector('.content-slot')?.prepend(hint);
  }
})();
