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
    text_group_horizontal_overlap: float = 0.18
    text_group_max_level_delta: float = 42.0
    min_seed_area_ratio: float = 0.01  # area minima del blocco di testo rispetto al frame
    min_text_density: float = 0.02  # quota minima di pixel-tratto nel blocco
    min_interior_text_density: float = 0.004  # evita rettangoli solidi delimitati solo dal bordo
    max_seed_width_ratio: float = 0.82
    max_seed_frame_touch_ratio: float = 0.25
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
    seed_fallback_width: float = 0.34  # espansione del blocco testuale quando la carta si fonde allo sfondo
    seed_fallback_height: float = 0.16
    # --- 4) quadrilatero
    min_quad_fill: float = 0.70  # IoU minima tra quadrilatero e maschera
    # La mask sorgente deve restare regolare: prospettiva forte non deve trasformarla
    # in un trapezio. Lo shear e' invece ammesso e viene rimosso da rectify().
    quad: QuadFitConfig = QuadFitConfig(max_converge_deg=0.0)
    inset_ratio: float = 0.005  # margine verticale minimo
    horizontal_margin_ratio: float = -0.006  # espande i lati per non tagliare le prime lettere
    min_side_px: int = 32
    max_patch_side: int = 1600  # tetto alla risoluzione del patch (costo OCR)
    # --- tracking probabilistico tra frame
    track_max_misses: int = 3
    track_max_center_jump: float = 0.22
    track_max_area_ratio: float = 2.8
    track_ema: float = 0.28
    track_min_confidence: float = 0.35
    track_signature_size: int = 16
    track_min_signature_similarity: float = 0.28
    # --- evidenze classiche (prima del modello)
    edge_band_px: int = 3
    adaptive_text_scale: bool = True
    text_group_vertical_overlap: float = 0.22
    text_candidate_scales: Tuple[float, ...] = (1.35, 1.75, 2.15)
    text_candidate_min_score: float = 0.22
    min_receipt_aspect: float = 0.20


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
        video_mode: bool = False,
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
        self._debug: dict[str, np.ndarray | float | None] = {}
        self._video_mode = video_mode
        self._patch_history: list[np.ndarray] = []

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
        quad = self._constrain_to_frame(quad, width, height)
        signature = self._signature(image_bgr, quad)
        quad, confidence = self._update_track(quad, signature, (width, height))
        if quad is None or confidence < cfg.track_min_confidence:
            return self._predict_track(image_bgr)
        patch = rectify(image_bgr, quad, cfg.max_patch_side)
        if patch is None or min(patch.shape[:2]) < cfg.min_side_px:
            return None
        if self._video_mode:
            patch = self._temporal_patch(patch)
        evidence = self._evidence_confidence(patch)
        return ScanRegion(quad=quad, patch=patch, confidence=evidence)

    def _temporal_patch(self, patch: np.ndarray) -> np.ndarray:
        """Mediana temporale dopo la rettifica: riduce rumore senza fondere geometrie diverse."""
        if self._patch_history and self._patch_history[-1].shape != patch.shape:
            self._patch_history.clear()
        self._patch_history.append(patch.copy())
        self._patch_history = self._patch_history[-3:]
        if len(self._patch_history) < 2:
            return patch
        stack = np.stack(self._patch_history, axis=0)
        return np.median(stack, axis=0).astype(np.uint8)

    def _signature(self, image_bgr: np.ndarray, quad: np.ndarray) -> np.ndarray:
        """Firma compatta di colore/contrasto del patch, usata solo per tracking."""
        patch = rectify(image_bgr, quad, self._cfg.track_signature_size)
        if patch is None:
            size = self._cfg.track_signature_size
            return np.zeros((size, size, 5), np.float32)
        small = cv2.resize(
            patch,
            (self._cfg.track_signature_size, self._cfg.track_signature_size),
            interpolation=cv2.INTER_AREA,
        )
        lab = cv2.cvtColor(small, cv2.COLOR_BGR2LAB).astype(np.float32)
        lab[..., 0] /= 255.0
        lab[..., 1:] /= 255.0
        gray = cv2.cvtColor(small, cv2.COLOR_BGR2GRAY)
        blackhat = cv2.morphologyEx(
            gray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (5, 5)),
        ).astype(np.float32) / 255.0
        row_profile = np.mean(blackhat, axis=1, keepdims=True)
        row_structure = np.broadcast_to(row_profile, blackhat.shape).astype(np.float32)
        return np.dstack([lab, blackhat, row_structure])

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

        if (
            center_jump > cfg.track_max_center_jump
            or area_ratio > cfg.track_max_area_ratio
            or similarity < cfg.track_min_signature_similarity
        ):
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
        return ScanRegion(quad=self._track_quad.copy(), patch=patch, confidence=self._track_confidence)

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
        self._debug = {
            "balanced": balanced.copy(),
            "seed": None if seed is None else seed.copy(),
            "strokes": None if strokes is None else strokes.copy(),
            "mask": mask.copy(),
            "component": None,
            "signature": None,
            "confidence": None,
            "evidence": None,
        }
        candidates: list[tuple[np.ndarray, bool]] = []
        component = np.zeros(mask.shape, np.uint8)
        if contour is not None:
            cv2.drawContours(component, [contour], -1, 1, -1)
            self._debug["component"] = (component * 255).astype(np.uint8)
            orientation = seed_contour if seed_contour is not None else contour
            tilt = estimate_tilt_degrees(orientation.reshape(-1, 2))
            frame_size = (mask.shape[1], mask.shape[0])
            quad = fit_regular_quad(contour.reshape(-1, 2), tilt, frame_size, cfg.quad)
            if quad is None or self._fill(quad, component) < cfg.min_quad_fill:
                rect = cv2.boxPoints(cv2.minAreaRect(contour)).astype(np.float32)
                if self._fill(rect, component) >= cfg.min_quad_fill:
                    quad = rect
                else:
                    quad = None
            if quad is not None:
                candidates.append((quad.astype(np.float32), False))

        if seed_contour is not None:
            for scale in cfg.text_candidate_scales:
                quad = self._quad_from_text_seed(seed_contour, scale)
                if quad is not None:
                    candidates.append((quad, True))
        if not candidates:
            return None

        scored = [(quad, is_text, self._candidate_score(balanced, quad)) for quad, is_text in candidates]
        mask_candidates = [item for item in scored if not item[1]]
        text_candidates = [item for item in scored if item[1]]
        if mask_candidates:
            best_quad, _, best_score = max(mask_candidates, key=lambda item: item[2])
            if text_candidates:
                text_quad, _, text_score = max(text_candidates, key=lambda item: item[2])
                if text_score > best_score + 0.15:
                    best_quad, best_score = text_quad, text_score
        else:
            best_quad, _, best_score = max(scored, key=lambda item: item[2])
        if seed_contour is not None and best_score < cfg.text_candidate_min_score:
            return None
        self._debug["candidate_scores"] = np.asarray(
            [score for _, _, score in scored], dtype=np.float32
        )
        return best_quad.astype(np.float32)

    def _quad_from_text_seed(self, seed_contour: np.ndarray, scale: float = 1.0) -> Optional[np.ndarray]:
        """Fallback per carta e sfondo quasi dello stesso colore.

        Il testo resta l'evidenza più affidabile: si amplia il suo rettangolo solo
        quando la maschera cromatica non riesce a separare i due piani.
        """
        points = seed_contour.reshape(-1, 2).astype(np.float32)
        if len(points) < 4:
            return None
        (cx, cy), (rect_w, rect_h), angle = cv2.minAreaRect(points)
        if min(rect_w, rect_h) < 8.0:
            return None
        long_side = max(float(rect_w), float(rect_h))
        short_side = min(float(rect_w), float(rect_h))
        if short_side / max(long_side, 1.0) > 0.9:
            return None
        width = float(rect_w) * scale * (1.0 + self._cfg.seed_fallback_width)
        height = float(rect_h) * scale * (1.0 + self._cfg.seed_fallback_height)
        rect = cv2.boxPoints(((cx, cy), (width, height), angle)).astype(np.float32)
        return order_quad(rect)

    def _candidate_score(self, image_bgr: np.ndarray, quad: np.ndarray) -> float:
        """Score text-first: il colore pesa meno della struttura interna."""
        patch = rectify(image_bgr, quad, min(self._cfg.max_patch_side, 800))
        if patch is None or min(patch.shape[:2]) < self._cfg.min_side_px:
            return 0.0
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        layout = self._layout_evidence(gray)
        lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB)
        gx = cv2.Sobel(gray, cv2.CV_32F, 1, 0, ksize=3)
        gy = cv2.Sobel(gray, cv2.CV_32F, 0, 1, ksize=3)
        contrast = float(np.clip(np.std(lab[..., 0]) / 48.0, 0.0, 1.0))
        horizontal = float(np.clip(np.mean(np.abs(gx)) / 32.0, 0.0, 1.0))
        patch_height, patch_width = patch.shape[:2]
        aspect = min(patch_height, patch_width) / max(patch_height, patch_width, 1)
        aspect_score = float(np.clip(aspect / self._cfg.min_receipt_aspect, 0.0, 1.0))
        return float(np.clip(0.50 * layout + 0.20 * contrast + 0.10 * horizontal + 0.20 * aspect_score, 0.0, 1.0))

    def _evidence_confidence(self, patch: np.ndarray) -> float:
        """Combina evidenze fotometriche, bordi e struttura interna del documento."""
        gray = cv2.cvtColor(patch, cv2.COLOR_BGR2GRAY)
        lab = cv2.cvtColor(patch, cv2.COLOR_BGR2LAB)
        channels = [gray, lab[..., 0], lab[..., 1], lab[..., 2]]
        gradients = []
        for channel in channels:
            gx = cv2.Sobel(channel, cv2.CV_32F, 1, 0, ksize=3)
            gy = cv2.Sobel(channel, cv2.CV_32F, 0, 1, ksize=3)
            gradients.append(cv2.magnitude(gx, gy))
        gradient = np.max(np.stack(gradients), axis=0)
        gradient_norm = cv2.normalize(gradient, None, 0.0, 1.0, cv2.NORM_MINMAX)
        edge_score = self._border_evidence(gradient_norm)
        layout_score = self._layout_evidence(gray)
        surface_score = self._surface_evidence(lab[..., 0], gradient_norm)
        score = 0.35 * edge_score + 0.45 * layout_score + 0.20 * surface_score
        self._debug["evidence"] = np.array([[score, edge_score, layout_score, surface_score]], np.float32)
        return float(np.clip(score, 0.0, 1.0))

    def _border_evidence(self, gradient: np.ndarray) -> float:
        """Misura la continuità dei quattro lati senza richiedere un colore specifico."""
        height, width = gradient.shape
        band = max(1, min(self._cfg.edge_band_px, height // 20, width // 20))
        sides = (
            gradient[:band, :].mean(),
            gradient[-band:, :].mean(),
            gradient[:, :band].mean(),
            gradient[:, -band:].mean(),
        )
        perimeter = float(np.mean(sides))
        interior = float(np.mean(gradient[band:-band, band:-band])) if height > 2 * band and width > 2 * band else perimeter
        continuity = float(np.clip(perimeter / max(interior * 1.5, 0.08), 0.0, 1.0))
        return float(np.clip(0.55 * continuity + 0.45 * np.clip(perimeter / 0.35, 0.0, 1.0), 0.0, 1.0))

    def _layout_evidence(self, gray: np.ndarray) -> float:
        """Riconosce righe tipografiche ripetute, non una semplice superficie chiara."""
        blackhat = cv2.morphologyEx(
            gray,
            cv2.MORPH_BLACKHAT,
            cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (max(5, self._cfg.stroke_kernel),) * 2),
        )
        threshold = max(8.0, float(np.percentile(blackhat, 85.0)))
        strokes = blackhat >= threshold
        profile = strokes.mean(axis=1)
        active = profile > max(0.008, float(np.percentile(profile, 60.0)))
        transitions = np.count_nonzero(active[1:] != active[:-1]) if active.size > 1 else 0
        rows = min(1.0, float(np.count_nonzero(active)) / max(8.0, gray.shape[0] * 0.12))
        repeated = min(1.0, float(transitions) / max(6.0, gray.shape[0] * 0.08))
        density = float(np.clip(strokes.mean() / 0.10, 0.0, 1.0))
        return float(np.clip(0.50 * rows + 0.30 * repeated + 0.20 * density, 0.0, 1.0))

    @staticmethod
    def _surface_evidence(luminance: np.ndarray, gradient: np.ndarray) -> float:
        """Preferisce una superficie con contrasto interno e senza texture uniforme dominante."""
        local_contrast = float(np.std(luminance) / 64.0)
        texture = float(np.mean(gradient))
        return float(np.clip(0.65 * np.clip(local_contrast, 0.0, 1.0) + 0.35 * np.clip(texture / 0.30, 0.0, 1.0), 0.0, 1.0))

    def debug_image(self, frame_bgr: np.ndarray, quad: Optional[np.ndarray] = None) -> np.ndarray:
        """Crea una tavola leggibile per capire quale evidenza ha guidato il detector."""
        def panel(title: str, image: np.ndarray, color: bool = False) -> np.ndarray:
            if image is None:
                image = np.zeros((180, 240), np.uint8)
            view = image.copy()
            if view.dtype != np.uint8:
                view = cv2.normalize(view, None, 0, 255, cv2.NORM_MINMAX).astype(np.uint8)
            if not color and view.ndim == 2:
                view = cv2.cvtColor(view, cv2.COLOR_GRAY2BGR)
            elif view.ndim == 2:
                view = cv2.cvtColor(view, cv2.COLOR_GRAY2BGR)
            elif view.ndim == 3 and view.shape[2] == 4:
                view = cv2.cvtColor(view, cv2.COLOR_BGRA2BGR)
            view = cv2.resize(view, (320, 220), interpolation=cv2.INTER_NEAREST if not color else cv2.INTER_AREA)
            cv2.putText(view, title, (8, 22), cv2.FONT_HERSHEY_SIMPLEX, 0.6, (0, 255, 255), 1, cv2.LINE_AA)
            return view

        original = frame_bgr.copy()
        if quad is not None:
            cv2.polylines(original, [np.round(quad).astype(np.int32)], True, (0, 255, 0), 3)
        evidence = self._debug.get("evidence")
        if isinstance(evidence, np.ndarray) and evidence.shape == (1, 4):
            labels = ("tot", "bord", "righe", "superf")
            text = "  ".join(f"{name}:{value:.2f}" for name, value in zip(labels, evidence[0]))
            cv2.putText(original, text, (8, max(24, original.shape[0] - 12)), cv2.FONT_HERSHEY_SIMPLEX, 0.55, (0, 255, 255), 1, cv2.LINE_AA)
        balanced = self._debug.get("balanced")
        seed = self._debug.get("seed")
        mask = self._debug.get("mask")
        component = self._debug.get("component")
        signature = self._track_signature
        signature_view = np.zeros((16, 16), np.uint8)
        if signature is not None:
            signature_view = np.clip(signature[..., 4] * 255.0, 0, 255).astype(np.uint8)
            signature_view = cv2.applyColorMap(signature_view, cv2.COLORMAP_TURBO)
        panels = [
            panel("frame + quad", original, True),
            panel("balanced", balanced if isinstance(balanced, np.ndarray) else None, True),
            panel("black-hat seed", seed if isinstance(seed, np.ndarray) else None),
            panel("paper mask", mask if isinstance(mask, np.ndarray) else None),
            panel("selected component", component if isinstance(component, np.ndarray) else None),
            panel("text feature heatmap", signature_view, True),
        ]
        return cv2.vconcat([cv2.hconcat(panels[:3]), cv2.hconcat(panels[3:])])

    # ----------------------------------------------------------------- 1) seed
    def _text_seed(self, balanced: np.ndarray):
        """Blocco di testo piu' grande -> (maschera 0/255, tratti 0/255, contorno) oppure None."""
        cfg = self._cfg
        variants = self._enhancer.seed_gray_variants(balanced)
        base_results = []
        for gray in variants:
            kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (cfg.stroke_kernel, cfg.stroke_kernel))
            result = self._text_seed_from_gray(gray, kernel)
            if result is not None:
                base_results.append(result)
        if base_results:
            selected = max(base_results, key=lambda item: float(np.count_nonzero(item[0])))
            points = cv2.findNonZero(selected[0])
            if points is None:
                return selected
            _, _, _, selected_height = cv2.boundingRect(points)
            if not cfg.adaptive_text_scale or selected_height >= selected[0].shape[0] * 0.30:
                return selected
        else:
            selected = None
        if not cfg.adaptive_text_scale:
            return selected
        best_result = None
        best_score = -1.0
        side = min(variants[0].shape[:2])
        scales = (0.65, 0.85, 1.25, 1.5) if side < 360 else (0.75, 1.25, 1.5)
        for gray in variants:
            for scale in scales:
                stroke_side = int(np.clip(round(cfg.stroke_kernel * scale), 3, 25)) | 1
                kernel = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (stroke_side, stroke_side))
                result = self._text_seed_from_gray(gray, kernel)
                if result is None:
                    continue
                result_score = float(np.count_nonzero(result[0]))
                if result_score > best_score:
                    best_result, best_score = result, result_score
        if selected is None or best_result is None:
            return best_result or selected
        points = cv2.findNonZero(best_result[0])
        if points is None:
            return selected
        _, _, _, candidate_height = cv2.boundingRect(points)
        selected_area = float(np.count_nonzero(selected[0]))
        candidate_area = float(np.count_nonzero(best_result[0]))
        if candidate_height >= selected_height * 1.35 and candidate_area >= selected_area * 0.50:
            return best_result
        return selected

    def _text_seed_from_gray(self, gray: np.ndarray, kernel: np.ndarray):
        cfg = self._cfg
        blackhat = cv2.morphologyEx(gray, cv2.MORPH_BLACKHAT, kernel)
        if int(blackhat.max()) < cfg.min_text_contrast:
            return None
        otsu, _ = cv2.threshold(blackhat, 0, 255, cv2.THRESH_BINARY | cv2.THRESH_OTSU)
        threshold = max(cfg.min_text_contrast, 0.6 * float(otsu))
        strokes = (blackhat >= threshold).astype(np.uint8) * 255
        merged = cv2.morphologyEx(
            strokes,
            cv2.MORPH_CLOSE,
            cv2.getStructuringElement(cv2.MORPH_RECT, (cfg.text_merge_width, cfg.text_merge_height)),
        )

        min_area = cfg.min_seed_area_ratio * merged.shape[0] * merged.shape[1]
        candidates = []
        best_score = 0.0
        for contour in cv2.findContours(merged, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_NONE)[-2]:
            area = cv2.contourArea(contour)
            if area < min_area:
                continue
            x, y, bbox_width, bbox_height = cv2.boundingRect(contour)
            frame_width = float(merged.shape[1])
            if bbox_width / frame_width > cfg.max_seed_width_ratio:
                continue
            touches_sides = int(x == 0) + int(x + bbox_width >= merged.shape[1])
            if touches_sides > 0 and bbox_width / frame_width > cfg.max_seed_frame_touch_ratio:
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
            row_pixels = np.count_nonzero(strokes & interior, axis=1)
            row_activity = float(np.count_nonzero(row_pixels > 0)) / max(1, bbox_height)
            if row_activity < 0.12:
                continue
            # Preferisce carta chiara/coerente, ma conserva il vantaggio del
            # blocco con molte righe. Cosi' un testo sul volto non vince solo
            # perche' il suo contorno e' piu' grande.
            score = area * (paper_level / 255.0) ** 2 * (0.5 + density) * (0.5 + row_activity)
            candidates.append((contour, (x, y, bbox_width, bbox_height), score))
            best_score = max(best_score, score)
        if not candidates:
            return None
        best, best_box, _ = max(candidates, key=lambda item: item[2])
        _, best_y, _, best_h = best_box
        selected = []
        best_top, best_bottom = best_y, best_y + best_h
        for contour, (x, y, width, height), score in candidates:
            top, bottom = max(y, best_top), min(y + height, best_bottom)
            vertical_overlap = max(0, bottom - top) / max(1, min(height, best_h))
            left = max(x, best_box[0])
            right = min(x + width, best_box[0] + best_box[2])
            horizontal_overlap = max(0, right - left) / max(1, min(width, best_box[2]))
            level_delta = abs(float(np.median(gray[y : y + height, x : x + width])) - float(
                np.median(gray[best_y : best_y + best_h, best_box[0] : best_box[0] + best_box[2]])
            ))
            if (
                vertical_overlap >= cfg.text_group_vertical_overlap
                or (
                    horizontal_overlap >= cfg.text_group_horizontal_overlap
                    and level_delta <= cfg.text_group_max_level_delta
                )
            ):
                selected.append(contour)
        grouped = np.zeros(merged.shape, np.uint8)
        cv2.drawContours(grouped, selected, -1, 255, -1)
        # Include both description and price columns, but do not fill the whole frame:
        # the enclosing box is derived only from aligned text components.
        seed_points = cv2.findNonZero(grouped)
        if seed_points is None:
            return None
        rect = cv2.minAreaRect(seed_points.reshape(-1, 2).astype(np.float32))
        seed_contour = cv2.boxPoints(rect).astype(np.int32).reshape(-1, 1, 2)
        _, _, grouped_width, _ = cv2.boundingRect(seed_points)
        if grouped_width <= best_box[2] * 2.5:
            single = np.zeros(merged.shape, np.uint8)
            cv2.drawContours(single, [best], -1, 255, -1)
            return single, strokes, best
        # La mask del seed resta composta dai tratti reali: riempire il rettangolo
        # farebbe propagare artificialmente la carta fino al tavolo.
        return grouped, strokes, seed_contour

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
        """Applica margini distinti lungo gli assi del quadrilatero."""
        center = quad.mean(axis=0)
        horizontal = ((quad[1] - quad[0]) + (quad[2] - quad[3])) * 0.5
        vertical = ((quad[3] - quad[0]) + (quad[2] - quad[1])) * 0.5
        horizontal_norm = float(np.linalg.norm(horizontal))
        vertical_norm = float(np.linalg.norm(vertical))
        if horizontal_norm < 1.0 or vertical_norm < 1.0:
            return quad.astype(np.float32)
        horizontal /= horizontal_norm
        vertical /= vertical_norm
        local_x = (quad - center) @ horizontal
        local_y = (quad - center) @ vertical
        x_scale = 1.0 - 2.0 * self._cfg.horizontal_margin_ratio
        y_scale = 1.0 - 2.0 * self._cfg.inset_ratio
        expanded = center + np.outer(local_x * x_scale, horizontal) + np.outer(local_y * y_scale, vertical)
        return expanded.astype(np.float32)

    @staticmethod
    def _constrain_to_frame(quad: np.ndarray, width: int, height: int) -> np.ndarray:
        """Evita che l'espansione laterale proietti il documento oltre il frame."""
        if np.all(
            (quad[:, 0] >= 0.0)
            & (quad[:, 0] <= width - 1)
            & (quad[:, 1] >= 0.0)
            & (quad[:, 1] <= height - 1)
        ):
            return quad.astype(np.float32)
        outside_x = max(0.0, -float(quad[:, 0].min()), float(quad[:, 0].max()) - (width - 1))
        outside_y = max(0.0, -float(quad[:, 1].min()), float(quad[:, 1].max()) - (height - 1))
        if outside_x <= 0.05 * width and outside_y <= 0.05 * height:
            return quad.astype(np.float32)
        center = quad.mean(axis=0)
        relative = quad - center
        scale = min(
            1.0,
            min((width - 1 - center[0]) / max(float(relative[:, 0].max()), 1e-6), (0.0 - center[0]) / min(float(relative[:, 0].min()), -1e-6)),
            min((height - 1 - center[1]) / max(float(relative[:, 1].max()), 1e-6), (0.0 - center[1]) / min(float(relative[:, 1].min()), -1e-6)),
        )
        return (center + relative * max(0.0, scale)).astype(np.float32)
