"""Pre-elaborazione fotometrica: bilanciamento colore, riflessi, contrasto.

Due usi, stessi algoritmi:

A) SCENA (copia ridotta del frame, per la segmentazione) -> `balance_scene` + `seed_gray`
   1) BILANCIAMENTO DEL BIANCO "white-patch" robusto. Non si usa il grey-world (sull'intero
      frame sbaglierebbe con sfondi colorati: una parete marrone farebbe virare la carta).
      Si prende il 10% dei pixel piu' luminosi tra quelli QUASI neutri (croma Lab < 18: la
      carta crema o con luce leggermente calda entra, la pelle chiara no, altrimenti verrebbe
      "neutralizzata" e scambiata per carta) e si calcolano i guadagni per canale che li
      rendono grigi:
           g_c = mean(mean_B, mean_G, mean_R) / mean_c        (poi clip in [0.7, 1.4])
   2) RIFLESSI. Pixel quasi bianchi E saturi (max(BGR) >= 250 e min(BGR) >= 232) sono
      riflessi speculari: dilatati e ricostruiti con inpainting (Telea) dai pixel vicini.
      Se coprono > 4% del frame e' sovraesposizione diffusa: non c'e' nulla di affidabile da
      ricostruire e si lascia com'e'. La maschera dei riflessi viene restituita.
   3) CONTRASTO per la ricerca del testo: CLAHE sul canale L (`seed_gray`). Serve solo a far
      risaltare i caratteri; il colore della carta si misura sull'immagine NON equalizzata.

B) PATCH raddrizzato (per l'OCR) -> `enhance`
   Correzione del campo piatto PER CANALE: si stima lo sfondo (carta) con una chiusura
   morfologica (cancella il testo scuro), lo si sfuma e si divide:
           out_c = clip(255 * I_c / bg_c)
   Un'unica operazione che (i) porta la carta a bianco qualunque sia il suo colore (anche
   grigia o crema = bilanciamento colore), (ii) elimina ombre e gradienti di luce, (iii) non
   lascia aloni intorno ai riflessi perche' bg e' limitato a 1.15 x la mediana. Poi CLAHE
   sul canale L e stiramento del nero: il testo sbiadito della carta termica guadagna contrasto.

Limite onesto: un riflesso che SATURA il testo lo cancella; qui si evita solo di contaminare
il resto (segmentazione e OCR delle altre righe).
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class EnhanceConfig:
    # --- 1) bilanciamento del bianco della scena
    wb_bright_fraction: float = 0.10  # quota dei pixel quasi-neutri piu' luminosi usata come "bianco"
    wb_max_chroma: float = 18.0  # croma Lab massimo per essere "quasi neutro" (la pelle chiara sta a ~25: fuori)
    wb_min_pixels: int = 200
    wb_gain_min: float = 0.7
    wb_gain_max: float = 1.4
    # --- 2) riflessi speculari
    glare_max_min: int = 250  # max(B,G,R) >= questo
    glare_min_min: int = 232  # min(B,G,R) >= questo (quasi bianco, non un colore saturo)
    glare_max_fraction: float = 0.04  # oltre: sovraesposizione diffusa, nessun inpainting
    glare_dilate: int = 2  # px di dilatazione della maschera (aloni del riflesso)
    inpaint_radius: int = 3
    # --- 3) contrasto per il seed del testo (scena)
    seed_clahe_clip: float = 3.0
    seed_clahe_tile: int = 8
    # --- patch per l'OCR
    flat_max_side: int = 800  # la stima dello sfondo si fa a questa risoluzione massima
    flat_kernel_ratio: float = 0.03  # lato del kernel di chiusura / lato maggiore del patch
    flat_kernel_min: int = 9
    flat_kernel_max: int = 41
    flat_cap_ratio: float = 1.15  # sfondo limitato a questo multiplo della mediana (niente aloni)
    clahe_clip: float = 2.0
    clahe_tile: int = 8
    stretch_percentile: float = 0.5  # il nero del testo viene riportato a 0


class ReceiptEnhancer:
    """Implementa anche la porta `PatchEnhancer` (metodo `enhance`)."""

    def __init__(self, config: Optional[EnhanceConfig] = None) -> None:
        self._cfg = config if config is not None else EnhanceConfig()

    # ------------------------------------------------------------------ scena
    def balance_scene(self, bgr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        """Bilancia il bianco e ricostruisce i riflessi. Ritorna (immagine, maschera riflessi 0/1)."""
        return self.suppress_glare(self.balance_white(bgr))

    def balance_white(self, bgr: np.ndarray) -> np.ndarray:
        cfg = self._cfg
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB).astype(np.float32)
        lum = lab[..., 0]
        chroma = np.hypot(lab[..., 1] - 128.0, lab[..., 2] - 128.0)
        near_neutral = chroma < cfg.wb_max_chroma
        if int(near_neutral.sum()) < cfg.wb_min_pixels:
            return bgr  # nessun candidato "bianco": meglio non toccare i colori
        threshold = np.percentile(lum[near_neutral], 100.0 * (1.0 - cfg.wb_bright_fraction))
        white = near_neutral & (lum >= threshold)
        if int(white.sum()) < 20:
            return bgr
        means = bgr[white].reshape(-1, 3).astype(np.float64).mean(axis=0)  # B, G, R
        gains = np.clip(means.mean() / np.maximum(means, 1.0), cfg.wb_gain_min, cfg.wb_gain_max)
        return np.clip(bgr.astype(np.float32) * gains.astype(np.float32), 0, 255).astype(np.uint8)

    def suppress_glare(self, bgr: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
        cfg = self._cfg
        glare = ((bgr.max(axis=2) >= cfg.glare_max_min) & (bgr.min(axis=2) >= cfg.glare_min_min)).astype(np.uint8)
        fraction = float(glare.mean())
        if fraction == 0.0:
            return bgr, glare
        if cfg.glare_dilate > 0:
            size = 2 * cfg.glare_dilate + 1
            glare = cv2.dilate(glare, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (size, size)))
        if fraction > cfg.glare_max_fraction:
            return bgr, glare
        return cv2.inpaint(bgr, glare * 255, cfg.inpaint_radius, cv2.INPAINT_TELEA), glare

    def seed_gray(self, bgr: np.ndarray) -> np.ndarray:
        """Contrasto locale indipendente dal colore, per la ricerca del testo."""
        cfg = self._cfg
        lum = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB))[0]
        clahe = cv2.createCLAHE(clipLimit=cfg.seed_clahe_clip, tileGridSize=(cfg.seed_clahe_tile,) * 2)
        return clahe.apply(lum)

    def edge_contrast(self, bgr: np.ndarray) -> np.ndarray:
        """Contrasto dei bordi, usando tutti i canali Lab e non solo la luminanza.

        Le lettere di uno scontrino producono bordi forti anche quando la carta e'
        grigia o quando il contrasto di luminanza e' ridotto da una dominante colore.
        Il massimo dei gradienti Lab conserva il bordo piu' informativo senza
        classificare un colore chiaro solo per la sua luminosita'.
        """
        lab = cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB)
        gradients = []
        for channel in cv2.split(lab):
            gx = cv2.Sobel(channel, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(channel, cv2.CV_32F, 0, 1, ksize=3)
            gradients.append(cv2.magnitude(gx, gy))
        magnitude = np.maximum.reduce(gradients)
        return np.clip(magnitude, 0, 255).astype(np.uint8)

    # ------------------------------------------------------------------ patch OCR
    def enhance(self, patch_bgr: np.ndarray) -> np.ndarray:
        """Patch raddrizzato -> patch con carta bianca, luce uniforme e testo a contrasto pieno."""
        cfg = self._cfg
        height, width = patch_bgr.shape[:2]
        if height < 8 or width < 8:
            return patch_bgr

        scale = min(1.0, cfg.flat_max_side / float(max(height, width)))
        work = (
            cv2.resize(patch_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            if scale < 1.0
            else patch_bgr
        )
        side = int(np.clip(round(cfg.flat_kernel_ratio * max(work.shape[:2])), cfg.flat_kernel_min, cfg.flat_kernel_max))
        side |= 1  # dispari
        background = cv2.morphologyEx(work, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_RECT, (side, side)))
        background = cv2.GaussianBlur(background, (0, 0), side / 2.0).astype(np.float32)
        cap = np.median(background.reshape(-1, 3), axis=0) * cfg.flat_cap_ratio
        background = np.maximum(np.minimum(background, cap), 1.0)
        if scale < 1.0:
            background = cv2.resize(background, (width, height), interpolation=cv2.INTER_LINEAR)

        flat = np.clip(patch_bgr.astype(np.float32) / background * 255.0, 0, 255).astype(np.uint8)
        return self._local_contrast(flat)

    def _local_contrast(self, bgr: np.ndarray) -> np.ndarray:
        cfg = self._cfg
        lum, a, b = cv2.split(cv2.cvtColor(bgr, cv2.COLOR_BGR2LAB))
        clahe = cv2.createCLAHE(clipLimit=cfg.clahe_clip, tileGridSize=(cfg.clahe_tile,) * 2)
        lum = clahe.apply(lum)
        low = float(np.percentile(lum, cfg.stretch_percentile))
        if 0.0 < low < 200.0:
            lum = np.clip((lum.astype(np.float32) - low) * (255.0 / (255.0 - low)), 0, 255).astype(np.uint8)
        return cv2.cvtColor(cv2.merge([lum, a, b]), cv2.COLOR_LAB2BGR)
