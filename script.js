import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const API_URL = "http://127.0.0.1:8000";

const sceneIntro = document.getElementById("scene-intro");
const sceneStill = document.getElementById("scene-still");
const flashEl    = document.getElementById("flash");
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let handX = 0, handY = 0;
let video, detector;
let gestoAtual = "...";
let conexoesConcluidas = [];
let conectar = false;
let origem = null;
let escolhido = false;
let validandoHumano = false;

let palavrasDOM = [];

// Fila de temas
let temas = [];
let temaIndex = 0;
let palavrasNaFila = [];

let ALTURA_ARENA;
let placeholder = null;

// ── FIX 1: Cache de posições para deteção estável ─────────────────
// Recalcular getBoundingClientRect() a cada frame falha quando a div
// se move. Guardamos as posições antes do arrasto começar.
let hitCache = new Map();

function atualizarHitCache() {
  palavrasDOM.forEach(el => {
    if (!el.isDragging) {
      const r = el.getBoundingClientRect();
      if (r.width > 0) hitCache.set(el, { left: r.left, right: r.right, top: r.top, bottom: r.bottom });
    }
  });
}

function estaSobre(el, hx, hy) {
  const c = hitCache.get(el);
  if (c) return hx > c.left && hx < c.right && hy > c.top && hy < c.bottom;
  const r = el.getBoundingClientRect();
  return hx > r.left && hx < r.right && hy > r.top && hy < r.bottom;
}

// ── FIX 2: Offset de arrasto ───────────────────────────────────────
// Guarda a diferença entre o centro da palavra e a mão no momento
// da seleção — a palavra segue a mão SEM saltar para ela.
let dragOffsetX  = 0;
let dragOffsetY  = 0;
let elEmArrasto  = null;

function doFlash(duration, callback) {
  flashEl.style.transition = `opacity ${duration * 0.001}s ease`;
  flashEl.style.opacity = "1";
  setTimeout(() => {
    flashEl.style.opacity = "0";
    if (callback) setTimeout(callback, duration);
  }, duration);
}

async function runIntro() {
  await sleep(600);
  document.getElementById("line1").classList.add("visible");
  await sleep(1500);
  document.getElementById("line2").classList.add("visible");
  await sleep(1500);
  document.getElementById("line3").classList.add("visible");
  await sleep(1500);
  document.getElementById("line4").classList.add("visible");
  await sleep(2400);
  sceneIntro.style.transition = "opacity 0.1s";
  sceneIntro.style.opacity = "0";
  setTimeout(() => (sceneIntro.style.display = "none"), 200);
  doFlash(180, initSidebar);
}

async function initSidebar() {
  sceneStill.style.display = "flex";
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = "";
  palavrasDOM = [];
  hitCache.clear();

  try {
    let res = await fetch(`${API_URL}/palavras`);
    let data = await res.json();
    temas = data.temas || [];
    if (temas.length > 0) palavrasNaFila = [...temas[0].palavras];
    for (let i = 0; i < 16; i++) spawnNovaPalavra(null);
  } catch (e) {
    console.error("Erro a ligar ao Python:", e);
  }
}

function spawnNovaPalavra(referenceNode) {
  if (palavrasNaFila.length === 0) {
    temaIndex++;
    if (temaIndex < temas.length) {
      palavrasNaFila = [...temas[temaIndex].palavras];
    } else {
      return;
    }
  }

  if (palavrasNaFila.length > 0) {
    let p = palavrasNaFila.shift();
    const el = document.createElement("div");
    el.className = "sidebar-word";
    el.textContent = p.texto;
    el.dataset.id = p.id;
    el.dataset.naArena = "false";
    el.dataset.saiu = "false";
    el.isDragging = false;

    const sidebar = document.getElementById("sidebar");
    if (referenceNode && referenceNode.parentNode === sidebar) {
      sidebar.insertBefore(el, referenceNode);
    } else {
      sidebar.appendChild(el);
    }

    palavrasDOM.push(el);
    setTimeout(() => el.classList.add("visible"), 50);
  }
}

async function pedirLigacoesDaMaquina() {
  let palavrasAtivas = palavrasDOM
    .filter(el => el.dataset.naArena === "true")
    .map(el => el.dataset.id);

  if (palavrasAtivas.length < 2) {
    conexoesConcluidas = conexoesConcluidas.filter(c => c.tipo !== "maquina");
    return;
  }

  try {
    let res = await fetch(`${API_URL}/ligacoes/maquina`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(palavrasAtivas)
    });
    let data = await res.json();
    conexoesConcluidas = conexoesConcluidas.filter(c => c.tipo !== "maquina");
    data.ligacoes.forEach(lig => {
      let divDe   = palavrasDOM.find(p => p.dataset.id === lig.de);
      let divPara = palavrasDOM.find(p => p.dataset.id === lig.para);
      if (divDe && divPara) {
        conexoesConcluidas.push({ de: divDe, para: divPara, tipo: "maquina", cor: [0, 200, 255] });
      }
    });
  } catch (e) {
    console.error("A máquina falhou:", e);
  }
}

async function validarHumano(divOrigem, divDestino) {
  try {
    let res = await fetch(`${API_URL}/ligacoes/validar`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ palavra1: divOrigem.dataset.id, palavra2: divDestino.dataset.id })
    });
    let data = await res.json();
    if (data.valida) {
      conexoesConcluidas.push({ de: divOrigem, para: divDestino, tipo: "humana", cor: [255, 50, 50] });
    }
  } catch (e) {
    console.error("Erro ao validar:", e);
  } finally {
    validandoHumano = false;
  }
}

function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function detectGesture(landmarks) {
  const pulso     = landmarks[0];
  const indicador = calcularDistancia(landmarks[8],  pulso) > calcularDistancia(landmarks[6],  pulso);
  const medio     = calcularDistancia(landmarks[12], pulso) > calcularDistancia(landmarks[10], pulso);
  const anelar    = calcularDistancia(landmarks[16], pulso) > calcularDistancia(landmarks[14], pulso);
  const mindinho  = calcularDistancia(landmarks[20], pulso) > calcularDistancia(landmarks[18], pulso);

  // Ordem importa: lock tem prioridade sobre conecta
  if (indicador && medio && anelar && mindinho)  return "lock";
  if (indicador && medio && !anelar && !mindinho) return "conecta";
  if (indicador && !medio && !anelar && !mindinho) return "escolhe";
  return "...";
}

function organizarPalavrasNaArena() {
  let ativas = palavrasDOM.filter(el => el.dataset.naArena === "true" && !el.isDragging);

  for (let i = 0; i < ativas.length; i++) {
    let el1 = ativas[i];
    if (el1.x === undefined) {
      el1.x = parseFloat(el1.style.left) || windowWidth / 2;
      el1.y = parseFloat(el1.style.top)  || ALTURA_ARENA / 2;
    }

    for (let j = i + 1; j < ativas.length; j++) {
      let el2 = ativas[j];
      if (el2.x === undefined) {
        el2.x = parseFloat(el2.style.left) || windowWidth / 2;
        el2.y = parseFloat(el2.style.top)  || ALTURA_ARENA / 2;
      }

      let dx = el2.x - el1.x;
      let dy = el2.y - el1.y;
      if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }

      let minDx = (el1.offsetWidth  + el2.offsetWidth)  / 2 + 20;
      let minDy = (el1.offsetHeight + el2.offsetHeight) / 2 + 20;

      if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
        let overlapX = minDx - Math.abs(dx);
        let overlapY = minDy - Math.abs(dy);
        const forca  = 0.1;
        if (overlapX < overlapY) {
          const d = dx > 0 ? 1 : -1;
          el1.x -= overlapX * forca * d;
          el2.x += overlapX * forca * d;
        } else {
          const d = dy > 0 ? 1 : -1;
          el1.y -= overlapY * forca * d;
          el2.y += overlapY * forca * d;
        }
      }
    }

    const mW = el1.offsetWidth  / 2;
    const mH = el1.offsetHeight / 2;
    if (el1.x < mW + 20) el1.x = mW + 20;
    if (el1.x > windowWidth  - mW - 20) el1.x = windowWidth  - mW - 20;
    if (el1.y < mH + 20) el1.y = mH + 20;
    if (el1.y > ALTURA_ARENA - mH - 20) el1.y = ALTURA_ARENA - mH - 20;

    el1.style.left = el1.x + "px";
    el1.style.top  = el1.y + "px";
  }
}

window.setup = async function () {
  const canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-overlay");
  video = createCapture(VIDEO);
  video.size(windowWidth, windowHeight);
  video.hide();

  const vision = await FilesetResolver.forVisionTasks(
    "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
  );
  detector = await HandLandmarker.createFromOptions(vision, {
    baseOptions: {
      modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task",
      delegate: "GPU"
    },
    runningMode: "VIDEO",
    numHands: 1
  });

  ALTURA_ARENA = windowHeight * 0.75;
  runIntro();
};

window.windowResized = function () {
  resizeCanvas(windowWidth, windowHeight);
  ALTURA_ARENA = windowHeight * 0.75;
};

window.draw = function () {
  clear();

  if (sceneStill.style.display === "flex") {
    if (!elEmArrasto) atualizarHitCache(); // congela posições quando não há arrasto
    organizarPalavrasNaArena();
  }

  if (detector && video.elt.readyState === 4 && sceneStill.style.display === "flex") {
    const results = detector.detectForVideo(video.elt, performance.now());

    if (results.landmarks && results.landmarks.length > 0) {
      const pontos = results.landmarks[0];
      handX = lerp(handX, (1 - pontos[8].x) * width, 0.3);
      handY = lerp(handY, pontos[8].y * height, 0.3);
      gestoAtual = detectGesture(pontos);

      let sobreQualquerPalavra = false;

      // ── Elemento em arrasto: processa separadamente ────────────
      if (elEmArrasto) {
    if (gestoAtual === "escolhe") {
        const novoX = handX + dragOffsetX;
        const novoY = handY + dragOffsetY;
        elEmArrasto.x = novoX;
        elEmArrasto.y = novoY;
        elEmArrasto.style.position = "fixed";
        elEmArrasto.style.margin = "0";
        elEmArrasto.style.transform = "translate(-50%, -50%)"; // Centraliza no ponto do offset
        elEmArrasto.style.left = novoX + "px";
        elEmArrasto.style.top = novoY + "px";
        conectar = false;
    } else {
        // SOLTAR A PALAVRA
        const el = elEmArrasto;
        el.isDragging = false;
        el.classList.remove("dragging");
        
        const rect = el.getBoundingClientRect();
        const centroY = rect.top + rect.height / 2;
        const soltaNaArena = centroY < ALTURA_ARENA;

        // CASO 1: Cancelar (Volta para o lugar do placeholder)
        if (!soltaNaArena && el.dataset.saiu === "false") {
            if (placeholder) {
                placeholder.parentNode.insertBefore(el, placeholder); // Devolve a palavra ao "buraco"
            }
            el.style.position = "";
            el.style.left = "";
            el.style.top = "";
            el.style.transform = "";
            delete el.x;
            delete el.y;
        } 
        // CASO 2: Confirmar Entrada na Arena
        else {
            if (soltaNaArena && el.dataset.saiu === "false") {
                el.dataset.saiu = "true";
                // A nova palavra nasce no lugar onde estava o placeholder
                const proximoIrmao = placeholder ? placeholder.nextSibling : el.nextSibling;
                document.getElementById("main-area").appendChild(el);
                spawnNovaPalavra(proximoIrmao);
            }
            
            if (soltaNaArena !== (el.dataset.naArena === "true")) {
                el.dataset.naArena = soltaNaArena ? "true" : "false";
                pedirLigacoesDaMaquina();
            }
        }

        // Limpeza final do placeholder
        if (placeholder) {
            placeholder.remove();
            placeholder = null;
        }
        elEmArrasto = null;
        escolhido = false;
        hitCache.clear();
    }
}

      // ── Processar restantes palavras ──────────────────────────
      palavrasDOM.forEach(el => {
        if (el === elEmArrasto) return;

        const sobreEste       = estaSobre(el, handX, handY);
        const estaArena       = el.dataset.naArena === "true";
        const jaConectada     = conexoesConcluidas.some(c => c.de === el || c.para === el);

        if (sobreEste) sobreQualquerPalavra = true;

        // Iniciar arrasto — grava offset no momento exato da seleção e CRIA PLACEHOLDER
        if (gestoAtual === "escolhe" && sobreEste && !escolhido && !jaConectada && !elEmArrasto) {
            const r = el.getBoundingClientRect();
            dragOffsetX = (r.left + r.width / 2) - handX;
            dragOffsetY = (r.top + r.height / 2) - handY;
            
            placeholder = document.createElement("div");
            placeholder.className = "sidebar-word";
            placeholder.style.visibility = "hidden";
            placeholder.style.width = r.width + "px";
            placeholder.style.height = r.height + "px";
            el.parentNode.insertBefore(placeholder, el);

            el.isDragging = true;
            el.classList.add("dragging");
            escolhido = true;
            elEmArrasto = el;
        }

        // Iniciar ligação
        if (gestoAtual === "conecta" && sobreEste && !conectar && estaArena) {
          conectar = true;
          origem = el;
        }

        // Concluir ligação
        if (gestoAtual === "lock" && sobreEste && conectar && el !== origem && estaArena && !validandoHumano) {
          validandoHumano = true;
          validarHumano(origem, el);
          conectar = false;
          origem   = null;
        }
      }); // Fim do forEach
      
      if (conectar && gestoAtual !== "conecta" && !sobreQualquerPalavra) {
        conectar = false;
        origem   = null;
      }
    }

    // ── CONTROLO DE ECRÃ INTEIRO (FULLSCREEN) ──
window.keyPressed = function() {
  // Se a tecla pressionada for 'f' ou 'F'
  if (key === 'f' || key === 'F') {
    let fs = fullscreen();
    fullscreen(!fs); // Alterna entre ecrã inteiro e janela normal
  }
};

  }

  // ── DESENHAR CONEXÕES ───────────────────────────────────────
  for (let c of conexoesConcluidas) {
    let rectDe = c.de.getBoundingClientRect();
    let rectPara = c.para.getBoundingClientRect();
    
    let x1 = rectDe.left + rectDe.width / 2;
    let y1 = rectDe.top + rectDe.height / 2;
    let x2 = rectPara.left + rectPara.width / 2;
    let y2 = rectPara.top + rectPara.height / 2;

    if (c.tipo === "maquina") {
      // Linhas da máquina (Retas e simples)
      stroke(c.cor[0], c.cor[1], c.cor[2], 150);
      strokeWeight(2);
      line(x1, y1, x2, y2);
    } else {
      // Linhas humanas (Com o efeito de ondas)
      desenharLinhaHumana(x1, y1, x2, y2, c.cor, true);
    }
  }

  // ── Linha elástica a conectar (com ondas) ───────────────────
  if (conectar && origem) {
    let r1 = origem.getBoundingClientRect();
    let x1 = r1.left + r1.width / 2;
    let y1 = r1.top + r1.height / 2;
    
    desenharLinhaHumana(x1, y1, handX, handY, [255, 255, 255], false);
  }

  // ── Cursor ────────────────────────────────────────────────────
  if (sceneStill.style.display === "flex") {
    noStroke();
    fill(0, 255, 255);
    circle(handX, handY, 15);
  }
};

// ── FUNÇÃO DE ONDAS PARA LIGAÇÕES HUMANAS ───────────────────
function desenharLinhaHumana(x1, y1, x2, y2, corBase, mostrarOndas) {
  let d = dist(x1, y1, x2, y2);
  let angulo = atan2(y2 - y1, x2 - x1);

  stroke(corBase[2], corBase[0], corBase[0], mostrarOndas ? 80 : 200);
  strokeWeight(mostrarOndas ? 1 : 2);
  line(x1, y1, x2, y2);

  if (mostrarOndas) {
    push();
    translate(x1, y1);
    rotate(angulo);
    noFill();

    // cores das ondas
    let coresOndas = [
      [255, 255, 255],   
      [0, 255, 255],     
      [150, 0, 255],     
      [255, 0, 200],
      [255, 255, 255], 
      [0, 255, 255],     
      [150, 0, 255],     
      [255, 0, 200]      
    ];

    for (let n = 0; n < coresOndas.length; n++) {
      let c = coresOndas[n];
      
      
      
      stroke(c[0], c[1], c[2],200);
      
      strokeWeight(map(n, 0, coresOndas.length, 1.8, 0.8));

      beginShape();
      for (let i = 0; i <= d; i += 5) {
        let vel = (0.04 + n * 0.02) * (n % 2 === 0 ? 1 : -1);
        let freq = i * (0.04 + n * 0.01) + (frameCount * vel);
        let amp = ( n * 1) * sin(PI * i / d);
        vertex(i, sin(freq) * amp);
      }
      endShape();
    }
    pop();
  }
}