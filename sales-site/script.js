const salesEmail = 'sales@domhub.su';
const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

const roleContent = {
  resident: {
    label: 'Resident experience',
    title: 'Гостевые и сервисные сценарии без звонков в диспетчерскую',
    body: 'Житель оформляет пропуск, заявку или уведомление за несколько действий. Статусы понятны, а персонал сразу видит контекст квартиры, гостя, автомобиля или заявки.',
    stat: '2 минуты',
    statCopy: 'на выпуск гостевого пропуска',
  },
  security: {
    label: 'Security workspace',
    title: 'КПП работает по правилам, а не по памяти смены',
    body: 'Охрана проверяет QR, автомобиль, гостя или подрядчика, видит зону доступа и фиксирует admit/deny. Действия остаются в журнале для разбора инцидентов.',
    stat: '24/7',
    statCopy: 'контроль доступа и degraded-сценарии',
  },
  staff: {
    label: 'Concierge and staff',
    title: 'Заявки превращаются в управляемую очередь работ',
    body: 'Консьерж и персонал видят активные обращения, SLA, внутренние комментарии и resident-контекст без лишнего доступа к персональным данным.',
    stat: '1 очередь',
    statCopy: 'для заявок, эскалаций и подрядчиков',
  },
  admin: {
    label: 'Portfolio control',
    title: 'УК видит качество сервиса по объектам',
    body: 'Администратор управляет ролями, доступом, настройками объекта, инцидентами и метриками. Портфельный слой помогает сравнивать объекты и стандартизировать работу.',
    stat: 'N объектов',
    statCopy: 'в едином стандарте управления',
  },
};

function initReveal() {
  const targets = document.querySelectorAll('[data-reveal]');
  if (reducedMotion) {
    targets.forEach((target) => target.classList.add('is-visible'));
    return;
  }

  if (window.gsap && window.ScrollTrigger) {
    window.gsap.registerPlugin(window.ScrollTrigger);
    targets.forEach((target, index) => {
      window.gsap.fromTo(target,
        { autoAlpha: 0, y: 26 },
        {
          autoAlpha: 1,
          y: 0,
          duration: 0.85,
          ease: 'power4.out',
          delay: Math.min(index * 0.025, 0.18),
          scrollTrigger: {
            trigger: target,
            start: 'top 86%',
            once: true,
          },
          onComplete: () => target.classList.add('is-visible'),
        }
      );
    });
    return;
  }

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add('is-visible');
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.16, rootMargin: '0px 0px -8% 0px' });

  targets.forEach((target) => observer.observe(target));
}

function initProgress() {
  const progress = document.querySelector('.scroll-progress');
  if (!progress) return;

  const update = () => {
    const max = document.documentElement.scrollHeight - window.innerHeight;
    const value = max > 0 ? window.scrollY / max : 0;
    progress.style.transform = `scaleX(${Math.min(Math.max(value, 0), 1)})`;
  };

  update();
  window.addEventListener('scroll', update, { passive: true });
  window.addEventListener('resize', update);
}

function initCounters() {
  const counters = document.querySelectorAll('[data-count]');
  if (reducedMotion) return;

  const animateCounter = (element) => {
    const target = Number(element.dataset.count || '0');
    if (!Number.isFinite(target)) return;
    const suffix = element.textContent?.replace(/[0-9]/g, '') || '';
    let start = null;

    const tick = (time) => {
      start ??= time;
      const progress = Math.min((time - start) / 950, 1);
      const eased = 1 - Math.pow(1 - progress, 4);
      element.textContent = `${Math.round(target * eased)}${suffix}`;
      if (progress < 1) requestAnimationFrame(tick);
    };

    requestAnimationFrame(tick);
  };

  const observer = new IntersectionObserver((entries) => {
    entries.forEach((entry) => {
      if (!entry.isIntersecting) return;
      animateCounter(entry.target);
      observer.unobserve(entry.target);
    });
  }, { threshold: 0.4 });

  counters.forEach((counter) => observer.observe(counter));
}

function initRoleTabs() {
  const tabs = document.querySelectorAll('.role-tab');
  const rolePanel = document.querySelector('.role-dashboard');
  const roleLabel = document.querySelector('#role-label');
  const roleTitle = document.querySelector('#role-title');
  const roleBody = document.querySelector('#role-body');
  const roleStat = document.querySelector('#role-stat');
  const roleStatCopy = document.querySelector('#role-stat-copy');

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => {
      const role = tab.dataset.role;
      const content = roleContent[role];
      if (!content || !rolePanel || !roleLabel || !roleTitle || !roleBody || !roleStat || !roleStatCopy) return;

      tabs.forEach((item) => {
        const isActive = item === tab;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-selected', String(isActive));
      });

      rolePanel.classList.add('is-switching');
      window.setTimeout(() => {
        roleLabel.textContent = content.label;
        roleTitle.textContent = content.title;
        roleBody.textContent = content.body;
        roleStat.textContent = content.stat;
        roleStatCopy.textContent = content.statCopy;
        rolePanel.classList.remove('is-switching');
      }, reducedMotion ? 0 : 160);
    });
  });
}

function initSpecs() {
  const buttons = document.querySelectorAll('.spec-button');
  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const panelId = button.dataset.panel;
      if (!panelId) return;

      buttons.forEach((item) => {
        const isActive = item === button;
        item.classList.toggle('active', isActive);
        item.setAttribute('aria-expanded', String(isActive));
      });

      document.querySelectorAll('.spec-panel').forEach((panel) => {
        panel.classList.toggle('active', panel.id === panelId);
      });
    });
  });
}

function initMagneticButtons() {
  if (reducedMotion || window.matchMedia('(pointer: coarse)').matches) return;

  document.querySelectorAll('.magnetic').forEach((element) => {
    element.addEventListener('pointermove', (event) => {
      const rect = element.getBoundingClientRect();
      const x = (event.clientX - rect.left - rect.width / 2) * 0.18;
      const y = (event.clientY - rect.top - rect.height / 2) * 0.18;
      element.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    });

    element.addEventListener('pointerleave', () => {
      element.style.transform = '';
    });
  });
}

function initHeroPointer() {
  const hero = document.querySelector('.hero');
  if (!hero || reducedMotion) return;

  hero.addEventListener('pointermove', (event) => {
    const rect = hero.getBoundingClientRect();
    const x = event.clientX - rect.left - rect.width / 2;
    const y = event.clientY - rect.top - rect.height / 2;
    hero.style.setProperty('--mouse-x', `${x}px`);
    hero.style.setProperty('--mouse-y', `${y}px`);
  }, { passive: true });

  hero.addEventListener('pointerleave', () => {
    hero.style.setProperty('--mouse-x', '0px');
    hero.style.setProperty('--mouse-y', '0px');
  });
}

async function initFutureCanvas() {
  const canvas = document.querySelector('#future-canvas');
  if (!canvas) return;

  if (reducedMotion) {
    drawFallbackCanvas(canvas, false);
    return;
  }

  try {
    const THREE = await import('https://cdn.jsdelivr.net/npm/three@0.184.0/build/three.module.js');
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 120);
    camera.position.set(0, 4.8, 10.2);
    camera.lookAt(0, 0.4, 0);

    const renderer = new THREE.WebGLRenderer({
      canvas,
      alpha: true,
      antialias: true,
      powerPreference: 'high-performance',
      preserveDrawingBuffer: true,
    });
    renderer.setClearColor(0x000000, 0);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.65));

    const root = new THREE.Group();
    root.position.set(0.9, -0.7, -2.6);
    scene.add(root);

    const ambient = new THREE.AmbientLight(0xffffff, 1.18);
    const key = new THREE.DirectionalLight(0xffffff, 1.35);
    key.position.set(5, 8, 7);
    const fill = new THREE.PointLight(0x4c9ee0, 1.15, 26);
    fill.position.set(-5, 2, 4);
    scene.add(ambient, key, fill);

    const grid = new THREE.GridHelper(20, 34, 0x08356f, 0x8fc7ef);
    grid.material.opacity = 0.22;
    grid.material.transparent = true;
    root.add(grid);

    const brass = new THREE.MeshStandardMaterial({
      color: 0xd7a650,
      metalness: 0.32,
      roughness: 0.46,
      transparent: true,
      opacity: 0.82,
    });
    const steel = new THREE.MeshStandardMaterial({
      color: 0xdcebf4,
      metalness: 0.48,
      roughness: 0.34,
      transparent: true,
      opacity: 0.9,
    });
    const dark = new THREE.MeshStandardMaterial({
      color: 0xf7fbff,
      metalness: 0.38,
      roughness: 0.4,
      transparent: true,
      opacity: 0.94,
    });
    const edgeMaterial = new THREE.LineBasicMaterial({ color: 0x08356f, transparent: true, opacity: 0.24 });
    const pulseMaterial = new THREE.MeshBasicMaterial({ color: 0x4ba36f, transparent: true, opacity: 0.16, side: THREE.DoubleSide });

    const towerGroup = new THREE.Group();
    root.add(towerGroup);

    const towerData = [
      [-3.4, 1.1, -1.2, 0.8, 2.2, 0.8],
      [-2.2, 1.8, 0.4, 0.9, 3.6, 0.9],
      [-0.8, 1.35, -0.6, 0.82, 2.7, 0.82],
      [0.7, 2.3, 0.2, 1.05, 4.6, 1.05],
      [2.1, 1.55, -1.1, 0.9, 3.1, 0.9],
      [3.4, 1.0, 0.8, 0.74, 2.0, 0.74],
    ];

    towerData.forEach(([x, y, z, w, h, d], index) => {
      const geometry = new THREE.BoxGeometry(w, h, d);
      const mesh = new THREE.Mesh(geometry, index % 2 === 0 ? dark : steel);
      mesh.position.set(x, y, z);
      towerGroup.add(mesh);

      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(geometry), edgeMaterial);
      edges.position.copy(mesh.position);
      towerGroup.add(edges);

      const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.72, 0.06, d * 0.72), brass);
      cap.position.set(x, y + h / 2 + 0.06, z);
      towerGroup.add(cap);
    });

    const points = [
      new THREE.Vector3(-4.8, 0.05, 2.2),
      new THREE.Vector3(-2.1, 0.05, 3.3),
      new THREE.Vector3(0.2, 0.05, 2.1),
      new THREE.Vector3(2.8, 0.05, 2.8),
      new THREE.Vector3(4.6, 0.05, 1.4),
      new THREE.Vector3(1.6, 0.05, -2.7),
    ];

    const pointMaterial = new THREE.MeshBasicMaterial({ color: 0xe2ca9f });
    const nodeGeometry = new THREE.SphereGeometry(0.08, 18, 18);
    points.forEach((point) => {
      const node = new THREE.Mesh(nodeGeometry, pointMaterial);
      node.position.copy(point);
      root.add(node);
    });

    const lineGeometry = new THREE.BufferGeometry().setFromPoints(points);
    const line = new THREE.Line(lineGeometry, new THREE.LineBasicMaterial({ color: 0x08356f, transparent: true, opacity: 0.5 }));
    root.add(line);

    const rings = new THREE.Group();
    root.add(rings);
    points.slice(0, 4).forEach((point, index) => {
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.35 + index * 0.05, 0.38 + index * 0.05, 64), pulseMaterial.clone());
      ring.rotation.x = -Math.PI / 2;
      ring.position.copy(point);
      ring.userData.phase = index * 0.72;
      rings.add(ring);
    });

    const starGeometry = new THREE.BufferGeometry();
    const starCount = 420;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i += 1) {
      starPositions[i * 3] = (Math.random() - 0.5) * 22;
      starPositions[i * 3 + 1] = Math.random() * 9 + 0.8;
      starPositions[i * 3 + 2] = (Math.random() - 0.5) * 16;
    }
    starGeometry.setAttribute('position', new THREE.BufferAttribute(starPositions, 3));
    const stars = new THREE.Points(starGeometry, new THREE.PointsMaterial({
      color: 0xe2ca9f,
      size: 0.018,
      transparent: true,
      opacity: 0.42,
    }));
    root.add(stars);

    const hull = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 7.4, 10, 28), new THREE.MeshStandardMaterial({
      color: 0xf7fbff,
      metalness: 0.52,
      roughness: 0.28,
      transparent: true,
      opacity: 0.9,
    }));
    hull.rotation.z = Math.PI / 2;
    hull.rotation.y = -0.18;
    hull.position.set(0.4, 1.12, 1.2);
    root.add(hull);

    const wing = new THREE.Mesh(new THREE.BoxGeometry(6.6, 0.08, 0.9), new THREE.MeshStandardMaterial({
      color: 0xe8f4fa,
      metalness: 0.44,
      roughness: 0.36,
      transparent: true,
      opacity: 0.82,
    }));
    wing.position.set(0.15, 0.92, 1.2);
    wing.rotation.y = -0.12;
    root.add(wing);

    let pointerX = 0;
    let pointerY = 0;
    window.addEventListener('pointermove', (event) => {
      pointerX = (event.clientX / window.innerWidth - 0.5) * 0.22;
      pointerY = (event.clientY / window.innerHeight - 0.5) * 0.18;
    }, { passive: true });

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      renderer.setSize(rect.width, rect.height, false);
      camera.aspect = rect.width / Math.max(rect.height, 1);
      camera.updateProjectionMatrix();
      root.scale.setScalar(rect.width < 760 ? 0.86 : 1.35);
      root.position.x = rect.width < 760 ? 0.25 : 1.05;
      root.position.y = rect.width < 760 ? -1.0 : -0.72;
    };

    resize();
    window.addEventListener('resize', resize);

    const startTime = performance.now();
    const animate = (now = performance.now()) => {
      const elapsed = (now - startTime) / 1000;
      root.rotation.y += ((-0.42 + pointerX) - root.rotation.y) * 0.035;
      root.rotation.x += ((0.08 + pointerY) - root.rotation.x) * 0.035;
      root.rotation.z = -0.035 + Math.sin(elapsed * 0.55) * 0.014;
      stars.rotation.y = elapsed * 0.018;
      towerGroup.position.y = Math.sin(elapsed * 0.7) * 0.025;
      rings.children.forEach((ring) => {
        const phase = elapsed + ring.userData.phase;
        const scale = 0.88 + Math.sin(phase * 1.8) * 0.12;
        ring.scale.setScalar(scale);
        ring.material.opacity = 0.1 + Math.max(0, Math.sin(phase * 1.8)) * 0.17;
      });
      renderer.render(scene, camera);
      requestAnimationFrame(animate);
    };

    requestAnimationFrame(animate);
  } catch (error) {
    drawFallbackCanvas(canvas, true);
  }
}

function drawFallbackCanvas(canvas, animated) {
  const context = canvas.getContext('2d');
  if (!context) return;

  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    const ratio = Math.min(window.devicePixelRatio || 1, 1.8);
    canvas.width = Math.max(1, Math.floor(rect.width * ratio));
    canvas.height = Math.max(1, Math.floor(rect.height * ratio));
    context.setTransform(ratio, 0, 0, ratio, 0, 0);
  };

  const draw = (time = 0) => {
    const rect = canvas.getBoundingClientRect();
    context.clearRect(0, 0, rect.width, rect.height);
    context.globalAlpha = 0.48;
    context.strokeStyle = '#08356f';
    context.lineWidth = 1;

    for (let x = rect.width * 0.48; x < rect.width; x += 44) {
      context.beginPath();
      context.moveTo(x + Math.sin(time / 1100 + x) * 8, 0);
      context.lineTo(x - 160, rect.height);
      context.stroke();
    }

    context.globalAlpha = 0.66;
    context.fillStyle = '#e9f5fb';
    for (let i = 0; i < 7; i += 1) {
      const w = 46 + i * 8;
      const h = 160 + (i % 3) * 70;
      const x = rect.width * 0.58 + i * 58;
      const y = rect.height - h;
      context.fillRect(x, y, w, h);
      context.strokeRect(x, y, w, h);
    }

    context.globalAlpha = 0.82;
    context.fillStyle = '#4ba36f';
    const pulse = 20 + Math.sin(time / 500) * 8;
    context.beginPath();
    context.arc(rect.width * 0.74, rect.height * 0.7, pulse, 0, Math.PI * 2);
    context.fill();

    if (animated) requestAnimationFrame(draw);
  };

  resize();
  draw();
  window.addEventListener('resize', () => {
    resize();
    draw();
  });
}

function initContactForm() {
  document.querySelector('#contact-form')?.addEventListener('submit', (event) => {
    event.preventDefault();

    const form = event.currentTarget;
    const note = document.querySelector('#form-note');
    const data = new FormData(form);
    const name = data.get('name') || '';
    const company = data.get('company') || '';
    const contact = data.get('contact') || '';
    const message = data.get('message') || '';

    form.classList.add('is-sent');
    if (note) note.textContent = 'Готовлю письмо для sales-коммуникации...';

    const subject = encodeURIComponent('DomHub: запрос пилота');
    const body = encodeURIComponent(
      `Имя: ${name}\nКомпания/объект: ${company}\nКонтакт: ${contact}\n\nЗадача:\n${message}`
    );

    window.setTimeout(() => {
      window.location.href = `mailto:${salesEmail}?subject=${subject}&body=${body}`;
      form.classList.remove('is-sent');
      if (note) note.textContent = 'Адрес получателя можно поменять в `script.js`.';
    }, reducedMotion ? 0 : 240);
  });
}

window.addEventListener('DOMContentLoaded', () => {
  document.body.classList.add('is-loaded');
  initProgress();
  initReveal();
  initCounters();
  initRoleTabs();
  initSpecs();
  initMagneticButtons();
  initHeroPointer();
  initFutureCanvas();
  initContactForm();
});
