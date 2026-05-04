from pydantic import BaseModel

class VerificarLigacao(BaseModel):
    palavra1: str
    palavra2: str