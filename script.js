import { HandLandmarker, FilesetResolver } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3";

const API_URL = "https://p4-teia.onrender.com";

const sceneIntro = document.getElementById("scene-intro");
const sceneStill = document.getElementById("scene-still");
const flashEl = document.getElementById("flash");
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

let video, detector;
let conexoesConcluidas = [];
let validandoHumano = false;

// Cursores para duas mãos 
let cursores = [
  { x: 0, y: 0, gesto: "", elEmArrasto: null, dragOffsetX: 0, dragOffsetY: 0, placeholder: null, escolhido: false, conectar: false, origem: null },
  { x: 0, y: 0, gesto: "", elEmArrasto: null, dragOffsetX: 0, dragOffsetY: 0, placeholder: null, escolhido: false, conectar: false, origem: null }
];

let palavrasDOM = [];
let palavrasNaFila = [];
let ALTURA_ARENA;

let estadoInteracao = "esperando"; // estados - esperando -> instrucoes -> jogando
let tempoInstrucoesOrigem = 8;
let tempoContagem = tempoInstrucoesOrigem;
let intervaloInstrucoes = null;
let ultimoMomentoComMao = Date.now();
const TEMPO_TIMEOUT = 15000;       // Volta ao início após 10 segundos sem nenhuma mão

// Trava para nao saltar instruçoes
let bloqueioLeitura = true;
setTimeout(() => { bloqueioLeitura = false; }, 2500);


//Função gerenciamento de estados
function mudarEstado(novoEstado) {
  estadoInteracao = novoEstado;

  const cenaIdle = document.getElementById("scene-idle");
  const lineTimer = document.getElementById("line-timer");
  const lines = ["line1", "line2", "line3"].map(id => document.getElementById(id));

  if (estadoInteracao === "esperando") {
    sceneStill.style.display = "none"; //esconde a estrutura da interação

    // mostra --> mexe a mao 
    if (cenaIdle) {
      cenaIdle.style.display = "flex";
      setTimeout(() => cenaIdle.style.opacity = "1", 50);
    }

    sceneIntro.style.display = "flex";
    sceneIntro.style.opacity = "1";
    lines.forEach(line => { if (line) line.classList.remove("visible"); });
    if (lineTimer) lineTimer.style.opacity = "0";
  }

  else if (estadoInteracao === "instrucoes") {
    sceneStill.style.display = "none"; //esconde a estrutura da interação

    if (cenaIdle) { //esconde mexea mao
      cenaIdle.style.opacity = "0";
      setTimeout(() => cenaIdle.style.display = "none", 800);
    }

    // mostrar as instruções 
    lines.forEach((line, index) => {
      setTimeout(() => {
        if (estadoInteracao === "instrucoes" && line) line.classList.add("visible");
      }, index * 300);
    });

    // cronometro
    tempoContagem = tempoInstrucoesOrigem;
    const campoTextoTempo = document.getElementById("tempo-restante");
    if (campoTextoTempo) campoTextoTempo.textContent = tempoContagem;

    if (lineTimer) lineTimer.style.opacity = "1";

    clearInterval(intervaloInstrucoes);
    intervaloInstrucoes = setInterval(() => {
      tempoContagem--;
      if (campoTextoTempo) campoTextoTempo.textContent = tempoContagem;

      if (tempoContagem <= 0) {
        clearInterval(intervaloInstrucoes);
        mudarEstado("jogando");
      }
    }, 1000);
  }

  else if (estadoInteracao === "jogando") {

    sceneStill.style.display = "flex"; //estrutura da interação visível 

    sceneIntro.style.opacity = "0";
    setTimeout(() => {
      if (estadoInteracao === "jogando") sceneIntro.style.display = "none";
    }, 500);

    doFlash(180);
    ultimoMomentoComMao = Date.now();
  }
}

//posiçoes para estabilidade de detecção
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

function doFlash(duration, callback) {
  flashEl.style.transition = `opacity ${duration * 0.001}s ease`;
  flashEl.style.opacity = "1";
  setTimeout(() => {
    flashEl.style.opacity = "0";
    if (callback) setTimeout(callback, duration);
  }, duration);
}

// ________SideBar__________________________
async function initSidebar() {
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = "";
  palavrasDOM = [];
  hitCache.clear();

  try {
    let res = await fetch(`${API_URL}/palavras`);
    let data = await res.json();
    let temas = data.temas || [];

    palavrasNaFila = [];
    let listasDePalavras = temas.map(t => [...t.palavras]);
    let aindaHaPalavras = true;

    // distribuicao intercalada para misturar odos os temas na barra
    while (aindaHaPalavras) {
      aindaHaPalavras = false;
      for (let i = 0; i < listasDePalavras.length; i++) {
        if (listasDePalavras[i].length > 0) {
          palavrasNaFila.push(listasDePalavras[i].shift());
          aindaHaPalavras = true;
        }
      }
    }

    // desenha palavras
    for (let i = 0; i < 16; i++) spawnNovaPalavra(null);

    mudarEstado("esperando");
  } catch (e) {
    console.error("Erro a ligar ao Python:", e);
    mudarEstado("esperando");
  }
}
function spawnNovaPalavra(referenceNode) {
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

//_________Ligação backend_________________________________
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
      let divDe = palavrasDOM.find(p => p.dataset.id === lig.de);
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

// ── Deteçaão gestos_______
function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function detectGesture(landmarks) {
  const pulso = landmarks[0];
  const indicador = calcularDistancia(landmarks[8], pulso) > calcularDistancia(landmarks[6], pulso);
  const medio = calcularDistancia(landmarks[12], pulso) > calcularDistancia(landmarks[10], pulso);
  const anelar = calcularDistancia(landmarks[16], pulso) > calcularDistancia(landmarks[14], pulso);
  const mindinho = calcularDistancia(landmarks[20], pulso) > calcularDistancia(landmarks[18], pulso);

  if (indicador && medio && anelar && mindinho) return "lock";     // ✋🏾 Mão aberta para trancar
  if (indicador && medio && !anelar && !mindinho) return "conecta";  // ✌🏾 Dois dedos para conectar
  if (indicador && !medio && !anelar && !mindinho) return "escolhe"; // ☝🏾 Um dedo para arrastar
  return "...";
}

function organizarPalavrasNaArena() {
  let ativas = palavrasDOM.filter(el => el.dataset.naArena === "true" && !el.isDragging);

  for (let i = 0; i < ativas.length; i++) {
    let el1 = ativas[i];
    if (el1.x === undefined) {
      el1.x = parseFloat(el1.style.left) || windowWidth / 2;
      el1.y = parseFloat(el1.style.top) || ALTURA_ARENA / 2;
    }

    for (let j = i + 1; j < ativas.length; j++) {
      let el2 = ativas[j];
      if (el2.x === undefined) {
        el2.x = parseFloat(el2.style.left) || windowWidth / 2;
        el2.y = parseFloat(el2.style.top) || ALTURA_ARENA / 2;
      }

      let dx = el2.x - el1.x;
      let dy = el2.y - el1.y;
      if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }

      let minDx = (el1.offsetWidth + el2.offsetWidth) / 2 + 20;
      let minDy = (el1.offsetHeight + el2.offsetHeight) / 2 + 20;

      if (Math.abs(dx) < minDx && Math.abs(dy) < minDy) {
        let overlapX = minDx - Math.abs(dx);
        let overlapY = minDy - Math.abs(dy);
        const forca = 0.1;
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

    const mW = el1.offsetWidth / 2;
    const mH = el1.offsetHeight / 2;
    if (el1.x < mW + 20) el1.x = mW + 20;
    if (el1.x > windowWidth - mW - 20) el1.x = windowWidth - mW - 20;
    if (el1.y < mH + 20) el1.y = mH + 20;
    if (el1.y > ALTURA_ARENA - mH - 20) el1.y = ALTURA_ARENA - mH - 20;

    el1.style.left = el1.x + "px";
    el1.style.top = el1.y + "px";
  }
}

// ── Setup p5.js───────────────────────
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
    numHands: 2 // MULTIPLAYER ATIVADO
  });

  ALTURA_ARENA = windowHeight * 0.8;
  initSidebar();
};

window.windowResized = function () {
  resizeCanvas(windowWidth, windowHeight);
  ALTURA_ARENA = windowHeight * 0.8;
};

window.keyPressed = function () {
  if (key === 'f' || key === 'F') {
    let fs = fullscreen();
    fullscreen(!fs);
  }
};

// ── Draw p5.js ──-------------
window.draw = function () {
  clear();

  if (detector && video.elt.readyState === 4) {
    const results = detector.detectForVideo(video.elt, performance.now());
    const maoDetetada = results && results.landmarks && results.landmarks.length > 0;

    if (maoDetetada) {
      ultimoMomentoComMao = Date.now();

      // Se detetar mão no estado de espera e a trava inicial já expirou, avança
      if (estadoInteracao === "esperando" && !bloqueioLeitura) {
        mudarEstado("instrucoes");
      }
    } else {
      // Se ficar sem mãos durante o tempo limite, regressa ao ecrã inicial de espera
      if (estadoInteracao === "jogando" && (Date.now() - ultimoMomentoComMao > TEMPO_TIMEOUT)) {
        mudarEstado("esperando");
        bloqueioLeitura = true;
        setTimeout(() => { bloqueioLeitura = false; }, 2500);
      }
    }

    //Fisica
    if (sceneStill.style.display === "flex" && estadoInteracao === "jogando") {
      let alguemArrasta = cursores.some(c => c.elEmArrasto !== null);
      if (!alguemArrasta) atualizarHitCache();
      organizarPalavrasNaArena();
    }

    // Intrecao cursores
    if (maoDetetada && estadoInteracao === "jogando" && sceneStill.style.display === "flex") {
      let sobreQualquerPalavra = false;

      results.landmarks.forEach((pontos, i) => {
        if (i < 2) {
          let c = cursores[i];
          c.x = lerp(c.x, (1 - pontos[8].x) * width, 0.3);
          c.y = lerp(c.y, pontos[8].y * height, 0.3);
          c.gesto = detectGesture(pontos);

          //arrasto palavra
          if (c.elEmArrasto) {
            if (c.gesto === "escolhe") {
              const novoX = c.x + c.dragOffsetX;
              let novoY = c.y + c.dragOffsetY;

              if (c.elEmArrasto.dataset.saiu === "true") {
                const margemH = c.elEmArrasto.offsetHeight / 2;
                if (novoY > ALTURA_ARENA - margemH - 10) {
                  novoY = ALTURA_ARENA - margemH - 10;
                }
              }

              c.elEmArrasto.x = novoX;
              c.elEmArrasto.y = novoY;

              c.elEmArrasto.style.position = "fixed";
              c.elEmArrasto.style.margin = "0";
              c.elEmArrasto.style.transform = "translate(-50%, -50%)";
              c.elEmArrasto.style.left = novoX + "px";
              c.elEmArrasto.style.top = novoY + "px";
              c.conectar = false;
            } else {
              const el = c.elEmArrasto;
              el.isDragging = false;
              el.classList.remove("dragging");
              const rect = el.getBoundingClientRect();
              const soltaNaArena = (rect.top + rect.height / 2) < ALTURA_ARENA;

              if (!soltaNaArena && el.dataset.saiu === "false") {
                if (c.placeholder) c.placeholder.parentNode.insertBefore(el, c.placeholder);
                el.style.position = ""; el.style.left = ""; el.style.top = ""; el.style.transform = "";
              } else {
                if (soltaNaArena && el.dataset.saiu === "false") {
                  el.dataset.saiu = "true";
                  document.getElementById("main-area").appendChild(el);
                  spawnNovaPalavra(c.placeholder ? c.placeholder.nextSibling : el.nextSibling);
                }
                if (soltaNaArena !== (el.dataset.naArena === "true")) {
                  el.dataset.naArena = soltaNaArena ? "true" : "false";
                  pedirLigacoesDaMaquina();
                }
              }
              if (c.placeholder) { c.placeholder.remove(); c.placeholder = null; }
              c.elEmArrasto = null; c.escolhido = false;
            }
          }

          //Ligaçoes entre palavras
          palavrasDOM.forEach(el => {
            const ocupada = cursores.some(curs => curs !== c && curs.elEmArrasto === el);
            if (ocupada) return;

            const sobreEste = estaSobre(el, c.x, c.y);
            if (sobreEste) sobreQualquerPalavra = true;

            const jaConectada = conexoesConcluidas.some(con => con.de === el || con.para === el);

            if (c.gesto === "escolhe" && sobreEste && !jaConectada && !c.escolhido && !c.elEmArrasto) {
              const r = el.getBoundingClientRect();
              c.dragOffsetX = (r.left + r.width / 2) - c.x;
              c.dragOffsetY = (r.top + r.height / 2) - c.y;
              c.placeholder = document.createElement("div");
              c.placeholder.className = "sidebar-word";
              c.placeholder.style.visibility = "hidden";
              c.placeholder.style.width = r.width + "px";
              c.placeholder.style.height = r.height + "px";
              el.parentNode.insertBefore(c.placeholder, el);
              el.isDragging = true; el.classList.add("dragging");
              c.escolhido = true; c.elEmArrasto = el;
            }

            if (c.gesto === "conecta" && sobreEste && !c.conectar && el.dataset.naArena === "true") {
              c.conectar = true; c.origem = el;
            }

            if (c.gesto === "lock" && sobreEste && c.conectar && el !== c.origem && !validandoHumano && el.dataset.naArena === "true") {
              validandoHumano = true;
              validarHumano(c.origem, el);
              c.conectar = false; c.origem = null;
            }
          });

          if (c.conectar && c.gesto !== "conecta" && !sobreQualquerPalavra) {
            c.conectar = false; c.origem = null;
          }
        }
      });
    }
  }

  //só executa no estado jogo
  if (estadoInteracao === "jogando") {

    // conexões concluídas
    conexoesConcluidas.forEach(con => {
      let r1 = con.de.getBoundingClientRect();
      let r2 = con.para.getBoundingClientRect();
      if (con.tipo === "maquina") {
        stroke(con.cor[0], con.cor[1], con.cor[2], 150);
        strokeWeight(2.5);
        line(r1.left + r1.width / 2, r1.top + r1.height / 2, r2.left + r2.width / 2, r2.top + r2.height / 2);
      } else {
        desenharLinhaHumana(r1.left + r1.width / 2, r1.top + r1.height / 2, r2.left + r2.width / 2, r2.top + r2.height / 2, con.cor, true);
      }
    });

    // linhas ativas e ponteiros
    if (sceneStill.style.display === "flex") {
      cursores.forEach((c, index) => {
        if (c.conectar && c.origem) {
          let r = c.origem.getBoundingClientRect();
          desenharLinhaHumana(r.left + r.width / 2, r.top + r.height / 2, c.x, c.y, [255, 0, 150], false);
        }
        noStroke();
        fill(index === 0 ? [0, 255, 255] : [255, 255, 0]);
        circle(c.x, c.y, 15);
      });
    }
  }
};

// ── Função ondas ligaçao humana ───────────────────
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

    let coresOndas = [
      [255, 255, 255], [0, 255, 255], [150, 0, 255], [255, 0, 200],
      [255, 255, 255], [0, 255, 255], [150, 0, 255], [255, 0, 200]
    ];

    for (let n = 0; n < coresOndas.length; n++) {
      let c = coresOndas[n];
      stroke(c[0], c[1], c[2], 200);
      strokeWeight(map(n, 0, coresOndas.length, 1.8, 0.8));

      beginShape();
      for (let i = 0; i <= d; i += 5) {
        let vel = (0.04 + n * 0.02) * (n % 2 === 0 ? 1 : -1);
        let freq = i * (0.04 + n * 0.01) + (frameCount * vel);
        let amp = (n * 1) * sin(PI * i / d);
        vertex(i, sin(freq) * amp);
      }
      endShape();
    }
    pop();
  }
}