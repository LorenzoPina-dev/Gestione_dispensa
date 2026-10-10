"""Localizzazione e RADDRIZZAMENTO dello scontrino nel frame.

Problemi reali che risolve (utente "imperfetto"): scontrino inclinato, in prospettiva,
tagliato dal bordo del frame, con luce non uniforme, riflessi, carta NON bianca (grigia,
crema) e con mani/buste/pareti chiare vicino.

Pipeline (la segmentazione gira su una copia ridotta a ~480 px: pochi ms)
-------------------------------------------------------------------------
0) FOTOMETRIA (quality/enhance.py): bilanciamento del bianco robusto, ricostruzione dei
   riflessi speculari, CLAHE per far risaltare i caratteri.
1) SEED DAL TESTO. Lo scontrino e' l'unico oggetto "pieno di righe di testo": blackhat
   (tratti scuri sottili) -> soglia -> chiusura rettangolare che fonde caratteri, parole e righe
   -> blob piu' grande con densita' di tratti plausibile. Non dipende dalla luminosita': vale
   per carta bianca, grigia o crema.
2) COLORE DELLA CARTA MISURATO, non assunto: mediana Lab dei pixel del seed che non sono
   inchiostro e spread (95 percentile della distanza di croma) -> tolleranza adattiva.
   Fallback senza testo (frame mosso): il vecchio riferimento "15% piu' luminoso e neutro".
3) MASCHERA = carta per croma (a, b) E per luminanza in una banda
   [luminance_ratio, luminance_ratio_high] x L_ref (ombre ok, parete molto piu' chiara fuori;
   i riflessi sono esentati dal limite alto), unita al seed, morfologia, componente connessa
   che si sovrappone di piu' al seed (solidita' minima: i blob irregolari vengono scartati).
4) QUADRILATERO REGOLARE (quality/quad_fit.py): 4 rette RANSAC sul bordo della maschera,
   convergenza e shear limitati, lati coincidenti col frame esentati. Una perdita della
   maschera (busta bianca in un angolo) non puo' piu' trasformare il riquadro in un trapezio
   storto. Controllo finale: il quadrilatero deve riempire la maschera (IoU >= min_quad_fill);
   altrimenti si ripiega sul rettangolo minimo ruotato, e se non basta il frame e' scartato.
5) RADDRIZZAMENTO prospettico. Con i 4 angoli sorgente S e il rettangolo di destinazione D
   (w x h) si risolve la omografia H (3x3):
       [x', y', w']^T = H [x, y, 1]^T ,   (X, Y) = (x'/w', y'/w')
   e si applica warpPerspective: il testo risulta orizzontale e senza trapezio.
"""
from __future__ import annotations

from dataclasses import dataclass
from typing import Optional, Tuple

import cv2
import numpy as np

from ocr.domain.models import ScanRegion
from ocr.quality.enhance import ReceiptEnhancer
from ocr.quality.quad_fit import QuadFitConfig, estimate_tilt_degrees, fit_regular_quad

# (L di riferimento, a, b, tolleranza di croma)
_Reference = Tuple[float, float, float, float]


@dataclass(frozen=True)
class PaperLocatorConfig:
    work_max_side: int = 480
    # --- 1) seed dal testo
    stroke_kernel: int = 9  # lato massimo (px) dei tratti scuri rilevati dal blackhat
    min_text_contrast: float = 12.0  # contrasto minimo (livelli di grigio) di un tratto
    min_edge_contrast: float = 22.0  # contrasto minimo di un bordo Lab
    edge_percentile: float = 92.0  # elimina bordi deboli senza fissare una soglia assoluta
    min_edge_components: int = 6  # un singolo contorno non e' testo ripetuto
    text_merge_width: int = 13  # chiusura che fonde caratteri/parole...
    text_merge_height: int = 9  # ...e righe vicine in un unico blocco
    min_seed_area_ratio: float = 0.01  # area minima del blocco di testo rispetto al frame
    min_text_density: float = 0.02  # quota minima di pixel-tratto nel blocco
    min_interior_text_density: float = 0.004  # evita rettangoli solidi delimitati solo dal bordo
    # --- 2) colore della carta
    chroma_tolerance: float = 6.0  # tolleranza di croma minima (e usata dal fallback)
    chroma_tolerance_max: float = 14.0
    chroma_spread_factor: float = 1.5  # tolleranza = factor * 95 percentile della dispersione
    # --- fallback senza testo: carta = materiale piu' chiaro e neutro
    reference_luminance_percentile: float = 85.0
    reference_max_chroma: float = 12.0
    min_reference_luminance: float = 120.0
    min_seed_luminance: float = 110.0
    # --- 3) maschera
    luminance_ratio: float = 0.55  # limite basso: ombre
    luminance_ratio_high: float = 1.35  # limite alto: esclude pareti molto piu' chiare (riflessi esenti)
    max_area_ratio: float = 0.85  # un blob che copre quasi tutto il frame non e' uno scontrino
    min_area_ratio: float = 0.05
    min_solidity: float = 0.70  # il quadrilatero e' adattato in modo robusto: le perdite sono tollerate
    max_component_aspect: float = 0.85  # rapporto lato corto/lungo; evita componenti che coprono la scena
    # --- 4) quadrilatero
    min_quad_fill: float = 0.70  # IoU minima tra quadrilatero e maschera
    # La mask sorgente deve restare regolare: prospettiva forte non deve trasformarla
    # in un trapezio. Lo shear e' invece ammesso e viene rimosso da rectify().
    quad: QuadFitConfig = QuadFitConfig(max_converge_deg=0.0)
    inset_ratio: float = 0.03  # restringe il quadrilatero: il bordo carta/sfondo falserebbe la nitidezza
    min_side_px: int = 32
    max_patch_side: int = 1600  # tetto alla risoluzione del patch (costo OCR)
    # --- tracking probabilistico tra frame
    track_max_misses: int = 3
    track_max_center_jump: float = 0.22
    track_max_area_ratio: float = 2.8
    track_ema: float = 0.28
    track_min_confidence: float = 0.35
    track_signature_size: int = 16


def order_quad(points: np.ndarray) -> np.ndarray:
    """Ordina 4 punti come TL, TR, BR, BL (due piu' alti -> sopra, due piu' bassi -> sotto)."""
    by_y = points[np.argsort(points[:, 1])]
    top = by_y[:2][np.argsort(by_y[:2, 0])]
    bottom = by_y[2:][np.argsort(by_y[2:, 0])]
    return np.array([top[0], top[1], bottom[1], bottom[0]], dtype=np.float32)


def rectify(image_bgr: np.ndarray, quad: np.ndarray, max_side: int) -> Optional[np.ndarray]:
    """Vista frontale del quadrilatero TL, TR, BR, BL."""
    tl, tr, br, bl = quad
    width = max(np.linalg.norm(tr - tl), np.linalg.norm(br - bl))
    height = max(np.linalg.norm(bl - tl), np.linalg.norm(br - tr))
    scale = min(1.0, max_side / max(width, height, 1.0))
    out_w, out_h = int(round(width * scale)), int(round(height * scale))
    if out_w < 8 or out_h < 8:
        return None
    dst = np.array([[0, 0], [out_w - 1, 0], [out_w - 1, out_h - 1], [0, out_h - 1]], dtype=np.float32)
    homography = cv2.getPerspectiveTransform(quad.astype(np.float32), dst)
    return cv2.warpPerspective(
        image_bgr, homography, (out_w, out_h), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE
    )


class PaperRegionProvider:
    """Implementa la porta `RegionProvider` cercando la carta nel frame."""

    def __init__(
        self,
        config: PaperLocatorConfig = PaperLocatorConfig(),
        enhancer: Optional[ReceiptEnhancer] = None,
    ) -> None:
        self._cfg = config
        self._enhancer = enhancer if enhancer is not None else ReceiptEnhancer()
        self._open_kernel = np.ones((5, 5), np.uint8)
        self._close_kernel = np.ones((7, 7), np.uint8)
        self._erode_kernel = np.ones((3, 3), np.uint8)
        self._track_quad: Optional[np.ndarray] = None
        self._track_velocity = np.zeros((4, 2), np.float32)
        self._track_signature: Optional[np.ndarray] = None
        self._track_confidence = 0.0
        self._track_misses = 0

    def locate(self, image_bgr: np.ndarray) -> Optional[ScanRegion]:
        cfg = self._cfg
        height, width = image_bgr.shape[:2]
        scale = min(1.0, cfg.work_max_side / float(max(height, width)))
        small = (
            cv2.resize(image_bgr, None, fx=scale, fy=scale, interpolation=cv2.INTER_AREA)
            if scale < 1.0
            else image_bgr
        )

        balanced, glare = self._enhancer.balance_scene(small)
        quad_small = self._find_quad(balanced, glare)
        if quad_small is None:
            return self._predict_track(image_bgr)

        quad = order_quad(quad_small / scale)  # coordinate del frame originale
        quad = self._inset(quad)
        signature = self._signature(image_bgr, quad)
        quad, confidence = self._update_track(quad, signature, (width, height))
        if quad is None or confidence < cfg.track_min_confidence:
            return self._predict_track(image_bgr)
        patch = rectify(image_bgr, quad, cfg.max_patch_side)
        if patch is None or min(patch.shape[:2]) < cfg.min_side_px:
            return None
        return ScanRegion(quad=quad, patch=patch)

    def _signature(self, image_bgr: np.ndarray, quad: np.ndarray) -> np.ndarray:
        """Firma compatta di colore/contrasto del patch, usata solo per tracking."""
        patch = rectify(image_bgr, quad, self._cfg.track_signature_size)
        if patch is None:
            return np.zeros((self._cfg.track_signature_size, self._cfg.track_signature_size, 3), np.float32)
        small = cv2.resize(
            patch,
            (self._cfg.track_signature_size, self._cfg.track_signature_size),
            interpolation=cv2.INTER_AREA,
        )
        lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 0] /= 255.0
        lab[..., 1:] /= 255.0
        return lab

    @staticmethod
    def _signature_similarity(first: np.ndarray, second: np.ndarray) -> float:
        distance = float(np.mean(np.abs(first - second)))
        return float(np.clip(1.0 - distance / 0.20, 0.0, 1.0))

    def _update_track(
        self, quad: np.ndarray, signature: np.ndarray, frame_size: Tuple[int, int]
    ) -> Tuple[Optional[np.ndarray], float]:
        cfg = self._cfg
        if self._track_quad is None:
            self._track_quad = quad.copy()
            self._track_signature = signature
            self._track_confidence = 0.72
            self._track_misses = 0
            return quad, self._track_confidence

        height, width = frame_size[1], frame_size[0]
        old = self._track_quad
        center_jump = float(np.linalg.norm(quad.mean(axis=0) - old.mean(axis=0))) / max(
            1.0, np.hypot(width, height)
        )
        old_area = max(1.0, abs(float(cv2.contourArea(old))))
        new_area = max(1.0, abs(float(cv2.contourArea(quad))))
        area_ratio = max(new_area / old_area, old_area / new_area)
        similarity = (
            self._signature_similarity(self._track_signature, signature)
            if self._track_signature is not None
            else 0.5
        )
        motion_score = float(np.clip(1.0 - center_jump / cfg.track_max_center_jump, 0.0, 1.0))
        area_score = float(np.clip(1.0 - (area_ratio - 1.0) / (cfg.track_max_area_ratio - 1.0), 0.0, 1.0))
        confidence = 0.45 * motion_score + 0.25 * area_score + 0.30 * similarity

        if center_jump > cfg.track_max_center_jump or area_ratio > cfg.track_max_area_ratio:
            return None, confidence

        ema = float(np.clip(cfg.track_ema, 0.0, 1.0))
        updated = ((1.0 - ema) * old + ema * quad).astype(np.float32)
        self._track_velocity = updated - old
        self._track_quad = updated
        self._track_signature = ((1.0 - ema) * self._track_signature + ema * signature).astype(np.float32)
        self._track_confidence = float(np.clip(0.7 * self._track_confidence + 0.3 * confidence, 0.0, 1.0))
        self._track_misses = 0
        return updated, self._track_confidence

    def _predict_track(self, image_bgr: np.ndarray) -> Optional[ScanRegion]:
        if self._track_quad is None or self._track_misses >= self._cfg.track_max_misses:
            self._track_misses = 0
            self._track_confidence *= 0.5
            if self._track_confidence < self._cfg.track_min_confidence:
                self._track_quad = None
                self._track_signature = None
                self._track_velocity.fill(0)
            return None
        self._track_misses += 1
        self._track_confidence *= 0.72
        prediction = self._track_quad + self._track_velocity
        self._track_quad = prediction.astype(np.float32)
        patch = rectify(image_bgr, self._track_quad, self._cfg.max_patch_side)
        if patch is None or min(patch.shape[:2]) < self._cfg.min_side_px:
            return None
        return ScanRegion(quad=self._track_quad.copy(), patch=patch)

    # ----------------------------------------------------------------- pipeline
    def _find_quad(self, balanced: np.ndarray, glare: np.ndarray) -> Optional[np.ndarray]:
        cfg = self._cfg
        lab = cv2.cvtColor(balanced, cv2.COLOR_BGR2LAB).astype(np.float32)
        lum = lab[..., 0]
        a = lab[..., 1] - 128.0
        b = lab[..., 2] - 128.0

        seed = strokes = seed_contour = None
        reference: Optional[_Reference] = None
        found = self._text_seed(balanced)
        if found is not None:
            seed, strokes, seed_contour = found
            reference = self._seed_reference(lum, a, b, seed, strokes)
            if reference is None:
                return None
        if reference is None:  # niente testo leggibile: ripiego sul colore (carta chiara e neutra)
            seed = seed_contour = None
            reference = self._brightest_reference(lum, a, b)
            if reference is None:
                return None

        mask = self._paper_mask(lum, a, b, glare, reference, seed)
        contour = self._select_component(mask, seed)
        if contour is None:
            return None

        component = np.zeros(mask.shape, np.uint8)
        cv2.drawContours(component, [contour], -1, 1, -1)
        orientation = seed_contour if seed_contour is not None else contour
        tilt = estimate_tilt_degrees(orientation.reshape(-1, 2))
        frame_size = (mask.shape[1], mask.shape[0])

        quad = fit_regular_quad(contour.reshape(-1, 2), tilt, frame_size, cfg.quad)
        if quad is None or self._fill(quad, component) < cfg.min_quad_fill:
            # Ripiego: rettangolo minimo ruotato (inclinazione si', prospettiva no).
            rect = cv2.boxPoints(cv2.minAreaRect(contour)).astype(np.float32)
            if self._fill(rect, component) < cfg.min_quad_fill:
                return None
            quad = rect
        return quad.astype(np.float32)

    # ----------------------------------------------------------------- 1) seed
    def _text_seed(self, balanced: np.ndarray):
        """Blocco di testo piu' grande -> (maschera 0/255, tratti 0/255, contorno) oppure None."""
        cfg = self._cfg
        gray = self._enhancer.seed_gray(balanced)
        kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg.stroke_kernel, cfg.stroke_kernel))
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        if int(blackhat.max()) < cfg.min_text_contrast:
            return None
        otsu, _ = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        threshold = max(cfg.min_text_contrast, 0.6 * float(otsu))  # inclusivo: i tratti sbiaditi contano
        strokes = (blackhat >= threshold).astype(np.uint8) * 255
        merged = cv2.morphologyEx(
            strokes,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (cfg.text_merge_width, cfg.text_merge_height)),
        )

        min_area = cfg.min_seed_area_ratio * merged.shape[0] * merged.shape[1]
        best = None
        best_score = 0.0
        for contour in cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[-2]:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue
            filled = np.zeros(merged.shape, np.uint8)
            cv2.drawContours(filled, [contour], -1, 255, -1)
            density = np.count_nonzero((strokes > 0) & (filled > 0)) / max(1.0, float(np.count_nonzero(filled)))
            if density < cfg.min_text_density:
                continue
            interior = cv2.erode(filled, self._erode_kernel)
            interior_density = np.count_nonzero((strokes > 0) & (interior > 0)) / max(
                1.0, float(np.count_nonzero(interior))
            )
            if interior_density < cfg.min_interior_text_density:
                continue
            paper_pixels = (interior > 0) & (strokes == 0)
            if int(paper_pixels.sum()) < 20:
                continue
            paper_level = float(np.median(gray[paper_pixels]))
            if paper_level < cfg.min_seed_luminance:
                continue
            # Preferisce carta chiara/coerente, ma conserva il vantaggio del
            # blocco con molte righe. Cosi' un testo sul volto non vince solo
            # perche' il suo contorno e' piu' grande.
            score = area * (paper_level / 255.0) ** 2 * (0.5 + density)
            if score > best_score:
                best, best_score = contour, score
        if best is None:
            return None
        seed = np.zeros(merged.shape, np.uint8)
        cv2.drawContours(seed, [best], -1, 255, -1)
        return seed, strokes, best

    # ----------------------------------------------------------------- 2) colore carta
    def _seed_reference(
        self, lum: np.ndarray, a: np.ndarray, b: np.ndarray, seed: np.ndarray, strokes: np.ndarray
    ) -> Optional[_Reference]:
        """Colore della carta MISURATO sui pixel del blocco di testo che non sono inchiostro."""
        cfg = self._cfg
        inner = cv2.erode(seed, self._erode_kernel)
        ink = cv2.dilate(strokes, self._erode_kernel)
        paper = (inner > 0) & (ink == 0)
        if int(paper.sum()) < 50:
            # Un blocco di testo molto stretto (tipico degli scontrini grigi)
            # puo' non lasciare abbastanza pixel nell'erosione. Campioniamo
            # allora una fascia attorno al blocco, sempre escludendo l'inchiostro.
            support = cv2.dilate(seed, cv2.getStructuringElement(cv2.MORPH_RECT, (31, 31)))
            paper = (support > 0) & (ink == 0)
        if int(paper.sum()) < 50:
            return None
        ref_l = float(np.median(lum[paper]))
        if ref_l < cfg.min_seed_luminance:
            return None
        ref_a = float(np.median(a[paper]))
        ref_b = float(np.median(b[paper]))
        spread = float(np.percentile(np.hypot(a[paper] - ref_a, b[paper] - ref_b), 95))
        tolerance = float(np.clip(cfg.chroma_spread_factor * spread, cfg.chroma_tolerance, cfg.chroma_tolerance_max))
        return ref_l, ref_a, ref_b, tolerance

    def _brightest_reference(self, lum: np.ndarray, a: np.ndarray, b: np.ndarray) -> Optional[_Reference]:
        """Fallback: i pixel piu' luminosi tra quelli quasi neutri."""
        cfg = self._cfg
        neutral = np.hypot(a, b) < cfg.reference_max_chroma
        if int(neutral.sum()) < 50:
            return None
        bright = lum >= np.percentile(lum[neutral], cfg.reference_luminance_percentile)
        reference = neutral & bright
        if int(reference.sum()) < 20:
            return None
        ref_l = float(np.median(lum[reference]))
        if ref_l < cfg.min_reference_luminance:
            return None  # nulla di abbastanza chiaro: nessuna carta nel frame
        return ref_l, float(np.median(a[reference])), float(np.median(b[reference])), cfg.chroma_tolerance

    # ----------------------------------------------------------------- 3) maschera
    def _paper_mask(
        self,
        lum: np.ndarray,
        a: np.ndarray,
        b: np.ndarray,
        glare: np.ndarray,
        reference: _Reference,
        seed: Optional[np.ndarray],
    ) -> np.ndarray:
        cfg = self._cfg
        ref_l, ref_a, ref_b, tolerance = reference
        same_color = np.hypot(a - ref_a, b - ref_b) < tolerance
        in_band = (lum >= cfg.luminance_ratio * ref_l) & ((lum <= cfg.luminance_ratio_high * ref_l) | (glare > 0))
        mask = (same_color & in_band).astype(np.uint8) * 255
        if seed is not None:
            mask |= seed  # l'inchiostro dentro il blocco di testo e' carta
        mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, self._close_kernel)
        return cv2.morphologyEx(mask, cv2.MORPH_OPEN, self._open_kernel)

    def _select_component(self, mask: np.ndarray, seed: Optional[np.ndarray]) -> Optional[np.ndarray]:
        """Contorno esterno (tutti i punti) della componente migliore: quella che copre di piu'
        il seed, oppure la piu' grande se non c'e' seed. Scarta blob irregolari o troppo grandi."""
        cfg = self._cfg
        min_area = cfg.min_area_ratio * mask.shape[0] * mask.shape[1]
        max_area = cfg.max_area_ratio * mask.shape[0] * mask.shape[1]
        best = None
        best_score = 0.0
        for contour in cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[-2]:
            area = cv2.contourArea(contour)
            if area < min_area or area > max_area:
                continue
            hull_area = cv2.contourArea(cv2.convexHull(contour))
            if hull_area < 1 or area / hull_area < cfg.min_solidity:
                continue
            (_, _), (rect_w, rect_h), _ = cv2.minAreaRect(contour)
            short_side, long_side = sorted((float(rect_w), float(rect_h)))
            if short_side < 1.0 or (seed is None and short_side / long_side > cfg.max_component_aspect):
                continue
            if seed is not None:
                filled = np.zeros(mask.shape, np.uint8)
                cv2.drawContours(filled, [contour], -1, 255, -1)
                score = float(np.count_nonzero((filled > 0) & (seed > 0)))
            else:
                score = area
            if score > best_score:
                best, best_score = contour, score
        return best

    # ----------------------------------------------------------------- 4) quadrilatero
    @staticmethod
    def _fill(quad: np.ndarray, component: np.ndarray) -> float:
        """IoU tra il poligono `quad` e la componente (0/1)."""
        poly = np.zeros(component.shape, np.uint8)
        cv2.fillConvexPoly(poly, np.round(quad).astype(np.int32), 1)
        union = int(np.count_nonzero(poly | component))
        return int(np.count_nonzero(poly & component)) / union if union else 0.0

    def _inset(self, quad: np.ndarray) -> np.ndarray:
        """Riduce il quadrilatero verso il baricentro: s = 1 - 2 * inset (per lato)."""
        center = quad.mean(axis=0)
        factor = 1.0 - 2.0 * self._cfg.inset_ratio
        return (center + (quad - center) * factor).astype(np.float32)
