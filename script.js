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


// NOVA LÓGICA DE LIMITE: Em vez da largura, usamos a altura da Arena
let ALTURA_ARENA;


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


// INICIAR O DICIONÁRIO E A FILA ──
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


// ── REPOSIÇÃO DE PALAVRAS ──
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


// Função auxiliar matemática para calcular a distância entre dois pontos (2D)
function calcularDistancia(p1, p2) {
  return Math.sqrt(Math.pow(p1.x - p2.x, 2) + Math.pow(p1.y - p2.y, 2));
}

function detectGesture(landmarks) {
  let pulso = landmarks[0];

  let indicador = calcularDistancia(landmarks[8], pulso) > calcularDistancia(landmarks[6], pulso);
  let medio     = calcularDistancia(landmarks[12], pulso) > calcularDistancia(landmarks[10], pulso);
  let anelar    = calcularDistancia(landmarks[16], pulso) > calcularDistancia(landmarks[14], pulso);
  let mindinho  = calcularDistancia(landmarks[20], pulso) > calcularDistancia(landmarks[18], pulso);

  // ✌🏾 Dois dedos para INICIAR a linha (Indicador e Médio esticados)
  if (indicador && medio && !anelar && !mindinho) return "conecta";
  
  // ☝🏾 Um dedo para ARRASTAR (Apenas Indicador esticado)
  if (indicador && !medio && !anelar && !mindinho) return "escolhe";
  
  // ✋🏾 Mão aberta para TRANCAR a conexão (Todos os dedos esticados)
  if (indicador && medio && anelar && mindinho) return "lock";

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


      let absDx = Math.abs(dx);
      let absDy = Math.abs(dy);


      let minDx = (el1.offsetWidth + el2.offsetWidth) / 2 + 20;
      let minDy = (el1.offsetHeight + el2.offsetHeight) / 2 + 20;


      if (absDx < minDx && absDy < minDy) {
        let overlapX = minDx - absDx;
        let overlapY = minDy - absDy;
        let forca = 0.1;


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


    
    let margemW = el1.offsetWidth / 2;
    let margemH = el1.offsetHeight / 2;


    if (el1.x < margemW + 20) el1.x = margemW + 20; 
    if (el1.x > windowWidth - margemW - 20) el1.x = windowWidth - margemW - 20; 
    if (el1.y < margemH + 20) el1.y = margemH + 20; 
    if (el1.y > ALTURA_ARENA - margemH - 20) el1.y = ALTURA_ARENA - margemH - 20; 


    el1.style.left = el1.x + "px";
    el1.style.top = el1.y + "px";
  }
}



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


  
  ALTURA_ARENA = windowHeight * 0.75;
  runIntro();
};


window.windowResized = function() {
  resizeCanvas(windowWidth, windowHeight);
  ALTURA_ARENA = windowHeight * 0.75;
};


window.draw = function () {
  clear();


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


      
      let naAreaPrincipal = handY < ALTURA_ARENA;
      let sobreQualquerPalavra = false;


      palavrasDOM.forEach(el => {
        let rect = el.getBoundingClientRect();
        let sobreEste = handX > rect.left && handX < rect.right && handY > rect.top && handY < rect.bottom;
        let palavraEstaNaArena = el.dataset.naArena === "true";


        if (sobreEste) {
          sobreQualquerPalavra = true;
        }


        let jaConectada = conexoesConcluidas.some(c => c.de === el || c.para === el);


        if (gestoAtual === "escolhe" && sobreEste && !escolhido && !jaConectada) {
          el.isDragging = true;
          el.classList.add("dragging");
          escolhido = true;
        }


        
        if (gestoAtual !== "escolhe" && el.isDragging) {
          el.isDragging = false;
          el.classList.remove("dragging");
          escolhido = false;


          
          let centroYDaPalavra = rect.top + rect.height / 2;
          let soltaNaArena = centroYDaPalavra < ALTURA_ARENA;


         
          if (!soltaNaArena && el.dataset.saiu === "false") {
            el.style.position = "";
            el.style.left = "";
            el.style.top = "";
            el.style.margin = "";
            el.style.transform = "";
            delete el.x;
            delete el.y;
          }
       
          else {
            if (soltaNaArena && el.dataset.saiu === "false") {
              el.dataset.saiu = "true";
              let proximoIrmao = el.nextSibling;
             
              document.getElementById("main-area").appendChild(el);
              spawnNovaPalavra(proximoIrmao);    
            }


            if (soltaNaArena !== palavraEstaNaArena) {
              el.dataset.naArena = soltaNaArena ? "true" : "false";
              pedirLigacoesDaMaquina();
            }
          }
        }


        if (el.isDragging) {
          el.x = handX;
          el.y = handY;
          el.style.position = "fixed";
          el.style.margin = "0";
          el.style.left = handX + "px";
          el.style.top = handY + "px";
          el.style.transform = "translate(-50%, -50%)";
          conectar = false;
        }


        
        if (gestoAtual === "conecta" && sobreEste && !conectar && palavraEstaNaArena) {
          conectar = true;
          origem = el;
        }


        if (gestoAtual === "lock" && sobreEste && conectar && el !== origem && palavraEstaNaArena && !validandoHumano) {
          validandoHumano = true;
          validarHumano(origem, el);
          conectar = false;
          origem = null;
        }
      });



      if (conectar && gestoAtual !== "conecta" && !sobreQualquerPalavra) {
        conectar = false;
        origem = null;
      }
    }
  }



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