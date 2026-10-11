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

Per calibrare il localizzatore su un frame senza modelli:

```
python -m ocr.debug_ui --source ocr/f.mp4
```

Nella finestra `Receipt locator tuning` premi `Space` per fermare/riprendere il video,
`n` per avanzare di un frame quando e' in pausa e `q`/ESC per uscire. I cursori
modificano contrasto del testo, kernel black-hat, dimensione del seed, fusione delle
righe, tolleranza cromatica, banda di luminanza ed espansione del fallback. La tavola
mostra frame, preprocessing, seed, mask, componente e heatmap; il risultato indica
`NO RECEIPT` oppure la confidence corrente.

La scansione normale applica inoltre un quality gate multi-evidenza. `--quality-threshold`
controlla il punteggio combinato di nitidezza, clipping/glare, contrasto, testo e confidence
del detector; `--min-sharpness` controlla il minimo della varianza del Laplaciano sul patch
raddrizzato. Un frame non valido viene scartato invece di alimentare l'OCR con un risultato
apparentemente affidabile.

### Training del detector YOLO-seg leggero

Il training è opzionale e non viene eseguito dalla scansione runtime. Installa le
dipendenze dalla cartella `py`:

```powershell
pip install -r ocr\requirements-training.txt
```

Scarica e prepara il dataset Kaggle:

```powershell
python -m ocr.training.yolo_receipt download --out data\receipt_raw
python -m ocr.training.yolo_receipt prepare --source data\receipt_raw --out data\receipt_yolo
```

Il dataset Kaggle `kenvippro/receipt-dataset` contiene immagini `Positive` e
`Negative`, ma non contiene maschere, poligoni o bounding box. È quindi adatto
alla classificazione "ricevuta presente/non presente", non direttamente alla
segmentazione. Per allenare correttamente un classificatore mobile usa:

```powershell
python -m ocr.training.yolo_receipt prepare-classify `
  --source data\receipt_raw `
  --out data\receipt_classify

python -m ocr.training.yolo_receipt train-classify `
  --data data\receipt_classify `
  --model yolo11n-cls.pt
```

`--device auto` (valore predefinito) seleziona automaticamente `cuda:0` se
PyTorch vede una GPU CUDA, altrimenti usa `cpu`. Su una macchina CPU-only il
training è corretto ma può richiedere molto tempo; per una prova breve usa
`--epochs 1 --batch 8`.

Per diagnosticare la RX 7800 XT:

```powershell
python -m ocr.training.yolo_receipt hardware
```

Se stampa `cuda_available=False`, l'installazione corrente è una build CPU di
PyTorch e la Radeon non viene utilizzata. Non installare una build CUDA: per
RX 7800 XT serve una build PyTorch ROCm compatibile con il driver/OS AMD oppure
un ambiente WSL2/Linux configurato con ROCm. `torch-directml` può accelerare
alcuni modelli su Windows, ma non è garantito come backend completo per il
training Ultralytics e non viene selezionato automaticamente.

Quando ROCm è visibile a PyTorch, usa parametri orientati al throughput:

```powershell
python -m ocr.training.yolo_receipt train-classify `
  --data data\receipt_classify --model yolo11n-cls.pt `
  --imgsz 224 --batch 128 --workers 8 --cache disk --device auto
```

Parti da `--batch 64` se la memoria GPU non basta e aumenta gradualmente a
128/256. `--cache disk` evita di saturare la RAM con 15.854 immagini; su SSD
NVMe è normalmente il compromesso migliore. `--amp` è attivo di default e
riduce memoria/tempo sui backend che lo supportano; usa `--no-amp` soltanto
se ROCm segnala errori numerici o operatori non supportati.

Il classificatore risponde solo alla domanda "c'è uno scontrino?", non indica
i quattro angoli. Per YOLO-seg servono annotazioni aggiuntive dello scontrino.
Il comando `prepare` richiede infatti label in formato YOLO segmentation e
termina con un errore esplicito se trova soltanto cartelle Positive/Negative.

### Bootstrap YOLO-seg dal dataset Kaggle

Le operazioni di download/estrazione e preparazione mostrano una barra di
avanzamento con numero di file, percentuale e velocità. Il training continua a
mostrare la barra nativa di Ultralytics.

Per non inventare annotazioni, `prepare-pseudo-seg` usa il localizzatore OpenCV
attuale solo sulle immagini `Positive`, converte il quadrilatero rilevato in una
polygon label YOLO-seg e scarta le rilevazioni sotto la confidence richiesta:

```powershell
python -m ocr.training.yolo_receipt prepare-pseudo-seg `
  --source data\receipt_raw `
  --out data\receipt_pseudo `
  --min-confidence 0.55
```

Il comando copia anche immagini `Negative` con label vuota, crea gli split e
scrive `data\receipt_pseudo\pseudo_labels.csv`. Quel CSV è obbligatorio da
revisionare: le label sono **pseudo-label**, non ground truth. Prima del training
segmentazione bisogna aprire un campione delle immagini e correggere/eliminare
i poligoni sbagliati. Una pseudo-label errata insegnerebbe a YOLO lo stesso errore
del localizzatore deterministico.

Per impedire il poisoning accidentale, il dataset pseudo viene marcato come
non revisionato e `train` lo rifiuta finché non esiste il file `REVIEWED`.
Puoi correggere i quattro vertici direttamente con il mouse:

```powershell
python -m ocr.training.yolo_receipt annotate-pseudo-seg `
  --data data\receipt_pseudo --split train
```

L'annotatore mostra solo le immagini positive con una mask già esistente.
Trascina i punti rossi sul bordo reale dello scontrino, quindi:

- `a`: approva e salva la mask;
- `r`: rifiuta/elimina la mask;
- `n`: salta senza modificare;
- `q`/`Esc`: esce senza dichiarare completa la revisione.

Per correggere solo un campione iniziale:

```powershell
python -m ocr.training.yolo_receipt annotate-pseudo-seg `
  --data data\receipt_pseudo --split train --limit 200
```

Quando hai corretto lo split, viene creato un marker separato:
`REVIEWED_train`, `REVIEWED_val` oppure `REVIEWED_test`. Il training richiede
almeno `train` e `val`; la valutazione finale richiede anche `test`.

Ripeti il comando sugli split `val` e `test` con annotazioni verificate
manualmente. Se usi `--limit`, il marker non rende automaticamente affidabile
tutto lo split: per un modello definitivo devi usare un dataset con label
verificate oppure accettare esplicitamente il rischio con `--allow-pseudo`.

Dopo la revisione:

```powershell
python -m ocr.training.yolo_receipt train `
  --data data\receipt_pseudo\data.yaml `
  --model yolo11n-seg.pt `
  --out runs `
  --imgsz 640 --batch 32 --device auto
```

Questa procedura è un bootstrap per ridurre l'annotazione manuale. Non trasforma
magicamente le 7.962 immagini Positive in segmentazione supervisionata: il dataset
originale non contiene i contorni. Per una valutazione attendibile occorre tenere
un test set con poligoni verificati manualmente e non usare il CSV pseudo-label
come ground truth.

La sequenza operativa è:

```powershell
# 1. correggi/approva le mask degli split usati per imparare
python -m ocr.training.yolo_receipt annotate-pseudo-seg --data data\receipt_pseudo --split train
python -m ocr.training.yolo_receipt annotate-pseudo-seg --data data\receipt_pseudo --split val

# 2. addestra: usa solo dopo aver revisionato train e val
python -m ocr.training.yolo_receipt train --data data\receipt_pseudo\data.yaml `
  --model yolo11n-seg.pt --out runs --imgsz 640 --batch 32 --device auto

# 3. revisiona il test separato e valuta una sola volta
python -m ocr.training.yolo_receipt annotate-pseudo-seg --data data\receipt_pseudo --split test
python -m ocr.training.yolo_receipt test --weights runs\receipt_n\weights\best.pt `
  --data data\receipt_pseudo\data.yaml --imgsz 640 --device auto
```

Se hai corretto solo un campione e non l'intero `train`/`val`, non chiamarlo
ground truth: per un bootstrap puoi usare `--allow-pseudo`, ma devi considerare
le metriche non affidabili e poi correggere i casi incerti in un secondo ciclo.

Per visualizzare la mask generata sovrapposta all'immagine, con quadrilatero e
vertici numerati:

```powershell
python -m ocr.training.yolo_receipt review-pseudo-seg `
  --data data\receipt_pseudo `
  --split val
```

La revisione mostra solo le immagini positive che hanno una label non vuota.
Per includere anche le immagini senza mask usa `--include-empty`.

Tasti nella finestra:

- `n` o `Space`: immagine successiva;
- `p`: immagine precedente;
- `s`: salva una copia con overlay;
- `q` o `Esc`: esce.

Per salvare automaticamente ogni overlay visualizzato:

```powershell
python -m ocr.training.yolo_receipt review-pseudo-seg `
  --data data\receipt_pseudo --split val `
  --save-dir data\receipt_review
```

Allena il modello nano, adatto all'esportazione mobile:

```powershell
python -m ocr.training.yolo_receipt train `
  --data data\receipt_yolo\data.yaml `
  --model yolo11n-seg.pt
```

Valuta ed esporta:

```powershell
python -m ocr.training.yolo_receipt test `
  --weights runs\segment\receipt_n\weights\best.pt `
  --data data\receipt_yolo\data.yaml

python -m ocr.training.yolo_receipt export `
  --weights runs\segment\receipt_n\weights\best.pt `
  --format tflite --int8
```

In PowerShell il carattere `` ` `` deve essere l'ultimo carattere della riga:
non inserire spazi dopo il backtick. Per il telefono il formato consigliato è
TFLite INT8; NCNN è un'alternativa per Android. Il training può scaricare i pesi
pretrained `yolo11n-seg.pt`, ma non scarica né prepara automaticamente il dataset.

### Adattamento automatico foto/video

La modalità `main` tratta la sorgente come video e usa il tempo come informazione
aggiuntiva: il quadrilatero è stabilizzato, i patch rettificati coerenti vengono
fusi con una mediana breve per ridurre rumore e riflessi intermittenti, e
`ReceiptEnhancer.enhance_adaptive()` misura rumore e contrasto prima di applicare
denoise, flattening e CLAHE. La UI `--tune` usa lo stesso comportamento.
`ReceiptPipeline.process()` resta invece single-frame, adatto alle fotografie, per
non introdurre ghosting. La fusione temporale non ricostruisce dettagli saturati o
occlusi e viene invalidata quando la geometria cambia o la shape del patch non coincide.

## Pipeline document-AI modulare

Il package [document_ai](./document_ai/) espone una pipeline indipendente dal backend:

```python
from ocr.document_ai import ReceiptPipeline
result = ReceiptPipeline().process(image_bgr)
```

La baseline usa il localizzatore OpenCV esistente. `LearnedDetector` e `OCRBackend`
sono protocolli opzionali: possono essere collegati a PaddleOCR, PyTorch o a un provider
cloud senza rendere obbligatorio il download dei pesi. Il risultato conserva qualità,
candidate, quadrilatero, patch, OCR, campi strutturati, score e motivi di rifiuto.
Gli score non sono probabilità calibrate: calibrare soglie e ECE su un validation set
separato per sessione/negozio prima di usare `ACCEPT` per decisioni automatiche.

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
  5. *evidenze classiche*: gradienti Sobel su piu' canali, continuita' dei bordi,
     contrasto locale e struttura ripetuta delle righe; queste evidenze producono
     `ScanRegion.confidence` senza assumere uno sfondo bianco;
  6. *selezione text-first*: quando il colore fonde scontrino e sfondo, vengono
     confrontate piu' ipotesi di quadrilatero generate dal blocco tipografico.
     Il candidato testuale puo' sostituire quello cromatico solo se migliora
     nettamente il layout interno, evitando che una grande superficie del tavolo
     vinca solo per area;
  7. *raddrizzamento* prospettico del patch.
  La confidence e' un punteggio euristico (non ancora una probabilita' calibrata):
  combina bordi, righe tipografiche e superficie interna. Con `--debug-dir` viene
  riportata anche nella tavola diagnostica come `tot`, `bord`, `righe` e `superf`.
  Il filtro di nitidezza misura il patch GREZZO (soglia tarata sui pixel originali); l'OCR riceve
  `region.ocr_image`, cioe' il patch migliorato da `ReceiptEnhancer.enhance` (campo piatto per canale:
  carta a bianco, luce uniforme, poi CLAHE). Con `--no-enhance` l'OCR riceve il patch grezzo.
  Parametri in `PaperLocatorConfig` / `QuadFitConfig` / `EnhanceConfig`: `max_converge_deg` e
  `max_shear_deg` se il riquadro appare troppo rigido o troppo libero, `luminance_ratio_high` se una
  parete chiara viene inclusa (o una zona in ombra esclusa), `min_quad_fill` se scarta troppo.
  Con `--debug-dir` si salvano sia il patch migliorato (`frame_N.png`) sia quello grezzo (`frame_N_raw.png`).
  Se non trova nessuna carta il frame viene scartato ("Scontrino non rilevato").
