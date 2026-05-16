import json
import os
import nltk
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from nltk.corpus import wordnet as wn
import schemas

# ── CINTO DE SEGURANÇA DO NLTK PARA O RENDER ──
nltk_data_dir = "/opt/render/nltk_data"
if not os.path.exists(nltk_data_dir):
    os.makedirs(nltk_data_dir, exist_ok=True)
nltk.data.path.append(nltk_data_dir)
nltk.download('wordnet', download_dir=nltk_data_dir, quiet=True)
nltk.download('omw-1.4', download_dir=nltk_data_dir, quiet=True)
# ───────────────────────────────────────────────

# 1. Carrega o json
with open("palavras.json", "r", encoding="utf-8") as f:
    dados = json.load(f)

# tira todas as palavras de dentro dos temas para uma lista única
PALAVRAS_FLAT = []
for tema in dados.get("temas", []):
    PALAVRAS_FLAT.extend(tema.get("palavras", []))

# novo nome do dicionário de ligações
GABARITO = dados.get("gabarito", [])

app = FastAPI(title="Teia de Palavras API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def verificar_nltk(p1: str, p2: str) -> bool:
    try:
        synsets_p1 = wn.synsets(p1, lang='por')
        sinonimos_p1 = set()
        for synset in synsets_p1:
            para_cada_palavra = synset.lemma_names('por')
            sinonimos_p1.update([lemma.lower() for lemma in para_cada_palavra])
        return p2 in sinonimos_p1
    except Exception as e:
        print(f"Erro no NLTK ao verificar {p1} e {p2}: {e}")
        return False

@app.get("/")
def raiz():
    return {"mensagem": "Teia a funcionar com Temas!"}

@app.get("/palavras")
def listar_palavras():
    # Devolve a estrutura completa com os temas para o Javascript
    return dados

@app.post("/ligacoes/maquina")
def ligacoes_maquina(palavras_no_ecra: list[str]):
    ligacoes = []
    mapa_textos = {p["id"]: p["texto"].lower() for p in PALAVRAS_FLAT}
    
    for i in range(len(palavras_no_ecra)):
        for j in range(i + 1, len(palavras_no_ecra)):
            id1 = palavras_no_ecra[i]
            id2 = palavras_no_ecra[j]
            
            texto1 = mapa_textos.get(id1, id1)
            texto2 = mapa_textos.get(id2, id2)
            
            if verificar_nltk(texto1, texto2):
                ligacoes.append({"de": id1, "para": id2, "tipo": "maquina"})
                
    return {"ligacoes": ligacoes}

@app.post("/ligacoes/validar")
def validar_ligacao(dados_ligacao: schemas.VerificarLigacao):
    p1 = dados_ligacao.palavra1.strip().lower()
    p2 = dados_ligacao.palavra2.strip().lower()

    if not p1 or not p2:
        raise HTTPException(status_code=400, detail="Faltam palavras")

    valida = False

    # Validação do gabarito suportando listas
    for regra in GABARITO:
        origem = regra["de"].lower()
        destinos = [d.lower() for d in regra["para"]]

        if (p1 == origem and p2 in destinos) or (p2 == origem and p1 in destinos):
            valida = True
            break

    return {
        "de": p1, "para": p2, "valida": valida,
        "tipo": "confirmada" if valida else "neutra"
    }
    