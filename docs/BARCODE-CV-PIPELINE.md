# Barcode CV pipeline

## Obiettivo

La scansione del barcode è stata semplificata in una pipeline **ROI-first e 1D-first**.
La regola architetturale principale è:

> **Il detector trova dove sono le barre; il decoder legge le barre.**
> Il decoder non deve stimare l'orientamento del pacco e non deve ruotare o deformare l'immagine.

Questo evita che una stima geometrica fragile trasformi un barcode già dritto in una ROI ruotata o prospetticamente deformata.

## Flusso end-to-end

```
Camera live
   |
   v
ROI detector
   |
   +--> produzione mobile: YOLOv8-Nano (NCNN / ONNX Runtime Mobile)
   |
   +--> PWA attuale: provider sostituibile, con fallback viewfinder
   |
   v
Axis-aligned ROI
   |
   v
+5..10% padding (attuale 8%)
   |
   v
grayscale
   |
   +--> RAW
   +--> CLAHE
   +--> Sauvola
   +--> Bradley
   +--> equalization + gamma
   +--> upscale + unsharp
   |
   v
10..20 scanline 1D (attuale 14)
   |
   +--> linee orizzontali
   +--> linee leggermente inclinate
   |
   v
ZXing 1D
   |
   v
numeric candidate
   |
   v
GS1 Modulo 10
   |
   +--> checksum fallito: DISCARD
   |
   v
multi-frame consensus
   |
   +--> 2 frame: solo con evidenza indipendente su più varianti
   +--> 3 frame: conferma standard
   |
   v
normalizeProductBarcode()
   |
   v
resolveProductBarcode("BARCODE", GTIN)
```

## Perché non usiamo più la geometria automatica

La pipeline precedente cercava di ricavare un quadrilatero dalle proiezioni dei bordi, calcolava una rotazione e applicava una omografia.
Questa strategia era troppo sensibile a:

- testo e loghi vicini al barcode;
- riflessi sulla plastica;
- bordi della confezione;
- barre già dritte ma con pochi pixel di contrasto;
- stime di orientamento contaminate da strutture che non appartengono al barcode.

Il nuovo scanner **non contiene più quadrilateri, homography, rotazione automatica o correzione prospettica**.

## ROI

L'API `registerBarcodeRoiDetector()` permette di sostituire il provider senza cambiare il decoder.

Il contratto del provider è volutamente minimo:

```ts
type BarcodeRoiDetector = (
  source: CanvasImageSource,
  srcW: number,
  srcH: number,
) => Promise<{
  crop: CropRect;
  confidence: number;
  source: "roi-detector" | "viewfinder";
} | null>;
```

Il contratto restituisce solo una ROI rettangolare. Non può restituire un angolo o un quadrilatero.

In una build Android/iOS il provider può essere collegato a YOLOv8-Nano tramite NCNN o ONNX Runtime Mobile.
La PWA corrente non contiene ancora il modello addestrato né il bridge nativo C++/NCNN/ONNX Mobile, quindi non viene falsamente dichiarato che YOLO sia già in esecuzione.

## Crop e padding

La ROI viene espansa dell'**8%** su ogni lato, limitata ai bordi del frame.
Questo mantiene una parte della quiet zone senza far rientrare nuovamente gran parte della confezione.

## Pre-processing

Il pre-processing opera **solo sulla ROI** e non modifica la geometria.

Varianti disponibili:

1. grayscale;
2. equalizzazione + gamma;
3. CLAHE;
4. Sauvola;
5. Bradley;
6. upscale 2x + unsharp.

Per ogni variante viene generata una matrice di pixel una sola volta e poi riutilizzata dalle scanline, evitando una lettura `getImageData()` per ogni riga.

## Multi-scanline 1D

La scansione corrente usa **14 linee**, configurabili nel range 10–20.

La maggioranza sono orizzontali e una parte è leggermente inclinata, con pendenza massima circa ±5% della larghezza della ROI.

Ogni scanline viene convertita in uno strip 1D e passata al decoder.
Una piega, un riflesso o una piccola occlusione che danneggia il centro del codice può quindi essere bypassata da una linea più alta o più bassa.

## Checksum

Ogni risultato numerico viene validato con il check digit GS1 Modulo 10 prima di entrare nel ranking.

```text
decoder -> digits -> checksum -> accept/reject
```

Un codice che non passa il checksum viene scartato immediatamente.

Il checksum, tuttavia, **non identifica da solo il prodotto**: due codici diversi possono essere entrambi validi.
Per esempio, nel caso noto del progetto:

- `8003440108888` è un EAN-13 valido;
- `043000108888` è un UPC-A valido.

Per questo il ranking usa anche tipo di simbologia e numero di osservazioni indipendenti.

## Consenso temporale

La UI non conferma mai un barcode dal singolo frame.

Regola corrente:

- **3 osservazioni consecutive** come conferma standard;
- **2 osservazioni consecutive** solo quando entrambe sono checksum-valid, ravvicinate nel tempo, spazialmente coerenti e provenienti da più varianti di preprocessing;
- un frame senza osservazione valida interrompe la sequenza.

Questo impedisce che un singolo falso positivo checksum-valid venga immediatamente inviato al Catalogo.

## Stato del progetto

Il codice attuale in `apps/web` è una implementazione browser-safe della stessa architettura concettuale.
Non contiene ancora:

- modello YOLOv8-Nano addestrato per barcode;
- runtime NCNN;
- bridge C++ OpenCV;
- delegate GPU/NPU mobile.

Queste parti appartengono al futuro adapter native-mobile, mentre la PWA mantiene la stessa interfaccia ROI.

## Test e metriche

Prima di dichiarare prestazioni commerciali devono essere misurati sul parco dispositivi target:

- false positive rate;
- false negative rate;
- tempo p50/p95 per frame di decode;
- stabilità su plastica lucida;
- stabilità con movimento;
- temperatura/thermal throttling;
- percentuale di successi a diverse distanze e inclinazioni.

Un target di accuratezza o latenza non deve essere considerato raggiunto senza benchmark reali.
