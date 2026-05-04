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

// Variáveis para a Fila de Temas
let temas = [];
let temaIndex = 0;
let palavrasNaFila = [];
const LARGURA_SIDEBAR = 250;

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

// ── INICIAR A SIDEBAR E A FILA ──
async function initSidebar() {
  sceneStill.style.display = "flex";
  const sidebar = document.getElementById("sidebar");
  sidebar.innerHTML = ""; 

  try {
    let res = await fetch(`${API_URL}/palavras`);
    let data = await res.json();
    temas = data.temas || [];

    if (temas.length > 0) {
      palavrasNaFila = [...temas[0].palavras];
    }

    for (let i = 0; i < 16; i++) {
      spawnNovaPalavra(null);
    }
  } catch (e) {
    console.error("Erro a ligar ao Python:", e);
  }
}

// ── REPOSIÇAO DE PALAVRAS ──
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

    let sidebar = document.getElementById("sidebar");
    
    if (referenceNode && referenceNode.parentNode === sidebar) {
      sidebar.insertBefore(el, referenceNode);
    } else {
      sidebar.appendChild(el);
    }
    
    palavrasDOM.push(el);
    setTimeout(() => el.classList.add("visible"), 50);
  }
}

// ── COMUNICAÇÃO COM O BACKEND ──
async function pedirLigacoesDaMaquina() {
  let palavrasAtivas = palavrasDOM.filter(el => el.dataset.naArena === "true").map(el => el.dataset.id);

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

function detectGesture(landmarks) {
  let indicador = landmarks[8].y < landmarks[6].y;
  let medio = landmarks[12].y < landmarks[10].y;
  let anelar = landmarks[16].y < landmarks[14].y;
  let mindinho = landmarks[20].y < landmarks[18].y;

  if (indicador && medio && anelar && mindinho) return "pega";
  if (indicador && medio && !anelar && !mindinho) return "mexe";
  if (indicador && !medio && !anelar && !mindinho) return "escolhe";
  if (!indicador && !medio && !anelar && !mindinho) return "lock";
  return "...";
}

// ── NOVA FUNÇÃO: FÍSICA E REPULSÃO DE PALAVRAS ──
function organizarPalavrasNaArena() {
  // Filtramos apenas as que estão soltas na arena
  let ativas = palavrasDOM.filter(el => el.dataset.naArena === "true" && !el.isDragging);

  for (let i = 0; i < ativas.length; i++) {
    let el1 = ativas[i];
    
    // Se ainda não tiverem as coordenadas X e Y puras guardadas, extraímos do CSS
    if (el1.x === undefined) {
      el1.x = parseFloat(el1.style.left) || windowWidth / 2;
      el1.y = parseFloat(el1.style.top) || windowHeight / 2;
    }

    for (let j = i + 1; j < ativas.length; j++) {
      let el2 = ativas[j];
      if (el2.x === undefined) {
        el2.x = parseFloat(el2.style.left) || windowWidth / 2;
        el2.y = parseFloat(el2.style.top) || windowHeight / 2;
      }

      let dx = el2.x - el1.x;
      let dy = el2.y - el1.y;

      // Proteção: Se forem largadas exatamente no mesmo pixel perfeito
      if (dx === 0 && dy === 0) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; }

      let absDx = Math.abs(dx);
      let absDy = Math.abs(dy);

      // Distância mínima para não se tocarem (+20px de margem respirável)
      let minDx = (el1.offsetWidth + el2.offsetWidth) / 2 + 20;
      let minDy = (el1.offsetHeight + el2.offsetHeight) / 2 + 20;

      // Colisão detetada! As caixas estão sobrepostas
      if (absDx < minDx && absDy < minDy) {
        let overlapX = minDx - absDx;
        let overlapY = minDy - absDy;
        let forca = 0.1; // Velocidade do "escorregar" para o lado

        // Empurramos no eixo que precisar de menos movimento para descolar
        if (overlapX < overlapY) {
          let direcao = dx > 0 ? 1 : -1;
          el1.x -= overlapX * forca * direcao;
          el2.x += overlapX * forca * direcao;
        } else {
          let direcao = dy > 0 ? 1 : -1;
          el1.y -= overlapY * forca * direcao;
          el2.y += overlapY * forca * direcao;
        }
      }
    }

    // Proteger para que não saiam do ecrã nem voltem sem querer para a Sidebar
    let margemW = el1.offsetWidth / 2;
    let margemH = el1.offsetHeight / 2;

    if (el1.x < LARGURA_SIDEBAR + margemW + 30) el1.x = LARGURA_SIDEBAR + margemW + 30;
    if (el1.x > windowWidth - margemW - 20) el1.x = windowWidth - margemW - 20;
    if (el1.y < margemH + 20) el1.y = margemH + 20;
    if (el1.y > windowHeight - margemH - 20) el1.y = windowHeight - margemH - 20;

    // Aplicar fisicamente os cálculos ao HTML
    el1.style.left = el1.x + "px";
    el1.style.top = el1.y + "px";
  }
}

// ── SETUP & DRAW DO P5 ──
window.setup = async function () {
  let canvas = createCanvas(windowWidth, windowHeight);
  canvas.parent("canvas-overlay"); 
  
  video = createCapture(VIDEO);
  video.size(windowWidth, windowHeight);
  video.hide(); 

  const vision = await FilesetResolver.forVisionTasks("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm");
  detector = await HandLandmarker.createFromOptions(vision, {
    baseOptions: { modelAssetPath: "https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task", delegate: "GPU" },
    runningMode: "VIDEO", numHands: 1
  });

  runIntro();
};

window.draw = function () {
  clear(); 

  // Chama a nossa nova função de física para organizar o espaço!
  if (sceneStill.style.display === "flex") {
    organizarPalavrasNaArena();
  }

  if (detector && video.elt.readyState === 4 && sceneStill.style.display === "flex") {
    const results = detector.detectForVideo(video.elt, performance.now());
    
    if (results.landmarks && results.landmarks.length > 0) {
      let pontosDaMao = results.landmarks[0];
      handX = lerp(handX, (1 - pontosDaMao[8].x) * width, 0.3);
      handY = lerp(handY, pontosDaMao[8].y * height, 0.3);
      gestoAtual = detectGesture(pontosDaMao);

      let naAreaPrincipal = handX > LARGURA_SIDEBAR;

      palavrasDOM.forEach(el => {
        let rect = el.getBoundingClientRect();
        let sobreEste = handX > rect.left && handX < rect.right && handY > rect.top && handY < rect.bottom;

        if (gestoAtual === "escolhe" && sobreEste && !escolhido) {
          el.isDragging = true;
          el.classList.add("dragging");
          escolhido = true;
        }

        // O MOMENTO EM QUE A PALAVRA É SOLTA
        if (gestoAtual !== "escolhe" && el.isDragging) {
          el.isDragging = false;
          el.classList.remove("dragging");
          escolhido = false;

          let centroDaPalavra = rect.left + rect.width / 2;
          let entrouNaArena = centroDaPalavra > LARGURA_SIDEBAR;

          if (entrouNaArena && el.dataset.saiu === "false") {
            el.dataset.saiu = "true";
            let proximoIrmao = el.nextSibling; 
            spawnNovaPalavra(proximoIrmao);    
          }

          let estavaNaArena = el.dataset.naArena === "true";
          if (entrouNaArena !== estavaNaArena) {
            el.dataset.naArena = entrouNaArena ? "true" : "false";
            pedirLigacoesDaMaquina(); 
          }
        }

        if (el.isDragging) {
          // Atualiza as nossas coordenadas para a física não "esquecer" de onde a mão deixou
          el.x = handX;
          el.y = handY;
          el.style.position = "fixed";
          el.style.margin = "0";
          el.style.left = handX + "px";
          el.style.top = handY + "px";
          el.style.transform = "translate(-50%, -50%)"; 
          conectar = false;
        }

        if (gestoAtual === "pega" && sobreEste && !conectar && naAreaPrincipal) {
          conectar = true;
          origem = el;
        }

        if (gestoAtual === "lock" && sobreEste && conectar && el !== origem && naAreaPrincipal && !validandoHumano) {
          validandoHumano = true;
          validarHumano(origem, el);
          conectar = false;
          origem = null;
        }
      });
    }
  }

  // DESENHAR CONEXÕES
  for (let c of conexoesConcluidas) {
    stroke(c.cor[0], c.cor[1], c.cor[2]);
    strokeWeight(c.tipo === "maquina" ? 1.5 : 3.5);
    let rectDe = c.de.getBoundingClientRect();
    let rectPara = c.para.getBoundingClientRect();
    line(
      rectDe.left + rectDe.width / 2, rectDe.top + rectDe.height / 2,
      rectPara.left + rectPara.width / 2, rectPara.top + rectPara.height / 2
    );
  }

  if (conectar && origem) {
    stroke(255, 0, 150);
    strokeWeight(2);
    let rectOrigem = origem.getBoundingClientRect();
    line(
      rectOrigem.left + rectOrigem.width / 2, rectOrigem.top + rectOrigem.height / 2, 
      handX, handY
    );
  }

  if (sceneStill.style.display === "flex") {
    noStroke();
    fill(0, 255, 255);
    circle(handX, handY, 15);
  }
};