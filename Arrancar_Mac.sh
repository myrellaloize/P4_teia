#!/bin/bash
echo "=========================================="
echo "  A PREPARAR O CÉREBRO DA TEIA (MAC/LINUX)"
echo "=========================================="

# Garante que o terminal entra na pasta correta
cd "$(dirname "$0")/backend"

echo "Instalando o ambiente virtual..."
python3 -m venv venv
source venv/bin/activate

echo "Instalando dependências..."
pip install -r requirements.txt

echo "Transferindo dicionários NLTK..."
python3 -c "import nltk; nltk.download('wordnet'); nltk.download('omw-1.4')"

echo "=========================================="
echo "  SERVIDOR LIGADO! "
echo "  1. Não feches esta janela do terminal."
echo "  2. Vai à pasta 'frontend' e abre o 'intro.htm' no browser."
echo "=========================================="
python3 -m uvicorn main:app