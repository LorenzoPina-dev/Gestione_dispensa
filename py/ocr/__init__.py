"""Continuous OCR scanning per scontrini (on-device, real-time).

Architettura a strati (Clean Architecture):

    domain/    -> modelli, geometria e porte (interfacce). Nessuna dipendenza da UI / ML runtime.
    camera/    -> adapter di input: acquisizione frame su thread dedicato.
    quality/   -> filtri di qualita' (blur detection).
    pipeline/  -> orchestrazione (worker thread, status board, consumer).
    ui/        -> overlay AR e finestra di debug. Unico strato che disegna a schermo.

Le dipendenze puntano sempre verso `domain/`.
"""
