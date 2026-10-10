# Receipt scanner (Continuous OCR on-device)

Scansione continua di scontrini da video/camera: localizzazione carta, filtro nitidezza,
OCR INT8 (DBNet + CRNN), unione dei frame per scontrini lunghi, parsing locale.

## Avvio

Dalla cartella `py/` (consigliato):

```
pip install -r ocr/requirements.txt
python -m ocr.main --source ocr/f.mp4 --threshold 100 --debug-dir ocr_debug
python -m ocr.main --source ocr/f.mp4 --det-model det_int8.tflite --rec-model rec_int8.tflite
```

> Attenzione: `-m` vuole il nome del **modulo** (`ocr.main`), non il file (`main.py`), e
> va lanciato da `py/`. In alternativa, da dentro `py/ocr/`: `python main.py --source f.mp4`.

Opzioni utili: `--locate paper|fixed`, `--charset dict.txt`, `--threads 4`, `--display-width 1280`,
`--no-enhance` (OCR sul patch grezzo, per confronto).
Tasti: `p` stampa lo scontrino letto, `r` azzera, `q`/ESC esce.

## Test

```
python -m unittest discover -s ocr/tests -t . -v
```

## Architettura

```
domain/     modelli, porte (Protocol), geometria         <- nessuna dipendenza esterna
camera/     CameraFeed (thread) + LatestFrameBuffer (frame dropping)
quality/    PaperRegionProvider (localizza la carta), quad_fit (rettangolo regolare, RANSAC),
            enhance (bilanciamento colore / riflessi / contrasto), LaplacianBlurFilter
inference/  TfliteModel (INT8), DbNetDetector, CrnnRecognizer, OcrEngine   <- unico strato ML
merging/    Levenshtein, LineMerger, ReceiptAccumulator
parsing/    ReceiptParser (regex, Decimal)
pipeline/   ScanSession (worker), StatusBoard, consumer
ui/         ScanOverlay
main.py     composition root
```

## Taratura

- **Soglia di nitidezza** (`--threshold`): misurata sulla sola area della carta. Guarda la barra
  sotto il riquadro: verde = frame inoltrato all'OCR.
- **Localizzatore** (`quality/paper_locator.py`), in 5 passi:
  1. *fotometria* (`quality/enhance.py`): bilanciamento del bianco robusto, ricostruzione dei riflessi
     speculari, CLAHE per far risaltare il testo;
  2. *seed dal testo*: la carta e' l'unico oggetto pieno di righe di testo (blackhat + chiusura),
     quindi la segmentazione non dipende dal fatto che sia chiara: va bene anche carta grigia o crema;
  3. *colore della carta misurato* sui pixel del seed (croma Lab a/b con tolleranza adattiva + banda di
     luminanza, non la sola L); senza testo (frame mosso) ripiega sul "piu' chiaro e neutro";
  4. *quadrilatero regolare* (`quality/quad_fit.py`): 4 rette RANSAC sul bordo della maschera, convergenza
     tra lati opposti <= 8 gradi (prospettiva) e shear <= 15 gradi; i lati che coincidono col frame
     (scontrino tagliato) sono esentati. Una "perdita" della maschera (busta bianca attaccata a un
     angolo) non puo' piu' storcere il riquadro; se il quad non riempie la maschera (IoU < 0.70) si
     ripiega sul rettangolo minimo ruotato, altrimenti il frame e' scartato;
  5. *raddrizzamento* prospettico del patch.
  Il filtro di nitidezza misura il patch GREZZO (soglia tarata sui pixel originali); l'OCR riceve
  `region.ocr_image`, cioe' il patch migliorato da `ReceiptEnhancer.enhance` (campo piatto per canale:
  carta a bianco, luce uniforme, poi CLAHE). Con `--no-enhance` l'OCR riceve il patch grezzo.
  Parametri in `PaperLocatorConfig` / `QuadFitConfig` / `EnhanceConfig`: `max_converge_deg` e
  `max_shear_deg` se il riquadro appare troppo rigido o troppo libero, `luminance_ratio_high` se una
  parete chiara viene inclusa (o una zona in ombra esclusa), `min_quad_fill` se scarta troppo.
  Con `--debug-dir` si salvano sia il patch migliorato (`frame_N.png`) sia quello grezzo (`frame_N_raw.png`).
  Se non trova nessuna carta il frame viene scartato ("Scontrino non rilevato").
