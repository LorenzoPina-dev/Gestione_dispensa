"""Adattamento ROBUSTO di un quadrilatero "regolare" (rettangolo visto con prospettiva/shear).

Problema: l'involucro convesso + approxPolyDP della maschera segue ogni "perdita" della
segmentazione (una busta bianca attaccata a un angolo, una mano, un panno) e produce
trapezi irregolari. Qui il quadrilatero NON deriva dai vertici della maschera ma da 4 RETTE
adattate con RANSAC al suo bordo, poi forzate a essere un rettangolo proiettato.

Algoritmo
---------
1) Inclinazione theta (stimata dal chiamante, es. dal blocco di testo). Ogni punto del bordo
   si porta nel sistema ruotato (u, v), dove lo scontrino e' circa dritto:
        u =  x cos(t) + y sin(t)        v = -x sin(t) + y cos(t)
2) Punti dei 4 lati. Per ogni riga v il punto piu' a sinistra / destra (u minimo / massimo),
   per ogni colonna u il piu' alto / basso (v minimo / massimo). Si scarta il 5% a ciascun
   estremo (angoli arrotondati dalla morfologia).
3) RANSAC per lato: una perdita che sporge per meno della meta' del lato (es. la busta in basso
   a sinistra) non sposta la retta, perche' la maggioranza dei punti sta sul bordo vero.
4) REGOLARIZZAZIONE. Un rettangolo proiettato ha:
   - lati opposti quasi paralleli: la differenza di angolo (convergenza = prospettiva) e'
     limitata a `max_converge_deg`; l'eccesso viene tolto soprattutto al lato con meno punti;
   - angoli vicini a 90: la deviazione media (shear) e' limitata a `max_shear_deg`.
   I lati che coincidono con il bordo del frame (scontrino tagliato) sono ESENTI: la loro
   direzione e' decisa dal frame, non dalla carta.
5) Gli angoli sono le intersezioni delle 4 rette: il risultato e' sempre un quadrilatero
   convesso e regolare, mai un trapezio "storto" da un angolo catturato male.

Con angoli = TL, TR, BR, BL nel sistema ruotato (il chiamante li riordina nel frame).
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Dict, Optional, Tuple

import cv2
import numpy as np


@dataclass(frozen=True)
class QuadFitConfig:
    edge_trim: float = 0.05  # frazione scartata a ciascun estremo di ogni lato
    ransac_iterations: int = 80
    inlier_tolerance: float = 2.0  # px alla scala di lavoro
    min_side_points: int = 12
    max_converge_deg: float = 8.0  # angolo massimo tra lati opposti (prospettiva)
    max_shear_deg: float = 15.0  # deviazione massima dagli angoli retti (shear)
    min_corner_deg: float = 55.0  # controllo finale sugli angoli interni
    border_tolerance: float = 1.5  # px: un punto entro tale distanza dal frame e' "sul bordo"
    border_fraction: float = 0.5  # lato "sul bordo" se almeno questa quota di inlier lo e'
    seed: int = 0  # RANSAC deterministico


class _Side:
    """Un lato: retta per `centroid` con angolo `angle` (rad), rispetto alla verticale per i
    lati sinistro/destro e all'orizzontale per sopra/sotto."""

    __slots__ = ("centroid", "angle", "weight", "border", "vertical")

    def __init__(self, centroid: np.ndarray, angle: float, weight: int, border: bool, vertical: bool) -> None:
        self.centroid = centroid
        self.angle = angle
        self.weight = weight
        self.border = border
        self.vertical = vertical

    def direction(self) -> np.ndarray:
        a = self.angle
        return np.array([math.sin(a), math.cos(a)]) if self.vertical else np.array([math.cos(a), math.sin(a)])


def estimate_tilt_degrees(points: np.ndarray) -> float:
    """Inclinazione del rettangolo minimo dei punti, riportata in [-45, 45) gradi."""
    pts = np.asarray(points, dtype=np.float32).reshape(-1, 2)
    if len(pts) < 3:
        return 0.0
    box = cv2.boxPoints(cv2.minAreaRect(pts))
    edge = box[1] - box[0]
    angle = math.degrees(math.atan2(float(edge[1]), float(edge[0])))
    return ((angle + 45.0) % 90.0) - 45.0


def fit_regular_quad(
    points: np.ndarray,
    tilt_deg: float,
    frame_size: Tuple[int, int],
    config: QuadFitConfig = QuadFitConfig(),
) -> Optional[np.ndarray]:
    """Quadrilatero regolare (4, 2) float32 che approssima il bordo `points` (N, 2) in
    coordinate immagine. `frame_size` = (larghezza, altezza). None se non c'e' abbastanza bordo."""
    cfg = config
    pts = np.asarray(points, dtype=np.float64).reshape(-1, 2)
    if len(pts) < 8:
        return None
    width, height = frame_size
    theta = math.radians(tilt_deg)
    c, s = math.cos(theta), math.sin(theta)
    u = pts[:, 0] * c + pts[:, 1] * s
    v = -pts[:, 0] * s + pts[:, 1] * c

    v_keys, u_lo, u_hi = _extremes(v, u, cfg.edge_trim)  # per riga: bordo sinistro e destro
    u_keys, v_lo, v_hi = _extremes(u, v, cfg.edge_trim)  # per colonna: bordo alto e basso
    candidates = (
        ("left", np.column_stack([u_lo, v_keys]), True),
        ("right", np.column_stack([u_hi, v_keys]), True),
        ("top", np.column_stack([u_keys, v_lo]), False),
        ("bottom", np.column_stack([u_keys, v_hi]), False),
    )

    rng = np.random.default_rng(cfg.seed)
    sides: Dict[str, _Side] = {}
    for name, side_pts, vertical in candidates:
        fit = _ransac_line(side_pts, cfg, rng)
        if fit is None:
            return None
        centroid, direction, inliers = fit
        if vertical:
            d = direction if direction[1] >= 0 else -direction
            angle = math.atan2(d[0], d[1])
        else:
            d = direction if direction[0] >= 0 else -direction
            angle = math.atan2(d[1], d[0])
        inlier_uv = side_pts[inliers]
        x = inlier_uv[:, 0] * c - inlier_uv[:, 1] * s
        y = inlier_uv[:, 0] * s + inlier_uv[:, 1] * c
        tol = cfg.border_tolerance
        on_border = (x <= tol) | (x >= width - 1 - tol) | (y <= tol) | (y >= height - 1 - tol)
        border = float(on_border.mean()) >= cfg.border_fraction
        sides[name] = _Side(centroid, angle, int(inliers.sum()), border, vertical)

    _regularize(sides, cfg)

    corners_uv = []
    for first, second in (("left", "top"), ("right", "top"), ("right", "bottom"), ("left", "bottom")):
        a, b = sides[first], sides[second]
        p = _intersect(a.centroid, a.direction(), b.centroid, b.direction())
        if p is None:
            return None
        corners_uv.append(p)
    corners = np.array(corners_uv, dtype=np.float64)
    quad = np.column_stack([corners[:, 0] * c - corners[:, 1] * s, corners[:, 0] * s + corners[:, 1] * c])
    if not np.all(np.isfinite(quad)) or not _is_valid(quad, cfg.min_corner_deg):
        return None
    return quad.astype(np.float32)


# ------------------------------------------------------------------------- internals
def _extremes(key: np.ndarray, val: np.ndarray, trim: float) -> Tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Per ogni bin unitario di `key`: min e max di `val`. Scarta `trim` a ciascun estremo."""
    base = int(np.floor(key.min()))
    idx = np.floor(key).astype(np.int64) - base
    n = int(idx.max()) + 1
    low = np.full(n, np.inf)
    high = np.full(n, -np.inf)
    np.minimum.at(low, idx, val)
    np.maximum.at(high, idx, val)
    centers = np.arange(n, dtype=np.float64) + base + 0.5
    cut = int(round(trim * n))
    keep = np.zeros(n, dtype=bool)
    keep[cut : n - cut] = True
    keep &= np.isfinite(low)
    return centers[keep], low[keep], high[keep]


def _lsq_line(pts: np.ndarray) -> Tuple[np.ndarray, np.ndarray]:
    centroid = pts.mean(axis=0)
    _, _, vt = np.linalg.svd(pts - centroid, full_matrices=False)
    return centroid, vt[0]


def _ransac_line(
    pts: np.ndarray, cfg: QuadFitConfig, rng: np.random.Generator
) -> Optional[Tuple[np.ndarray, np.ndarray, np.ndarray]]:
    """Retta con il maggior numero di punti entro `inlier_tolerance`, rifinita ai minimi quadrati.
    Le coppie si pescano una nella prima e una nella seconda meta' (lungo il lato): base lunga."""
    n = len(pts)
    if n < max(cfg.min_side_points, 2):
        return None
    half = n // 2
    best: Optional[np.ndarray] = None
    best_count = 0
    for _ in range(cfg.ransac_iterations):
        i = int(rng.integers(0, half))
        j = int(rng.integers(half, n))
        d = pts[j] - pts[i]
        norm = math.hypot(d[0], d[1])
        if norm < 1e-9:
            continue
        normal = np.array([-d[1], d[0]]) / norm
        mask = np.abs((pts - pts[i]) @ normal) <= cfg.inlier_tolerance
        count = int(mask.sum())
        if count > best_count:
            best, best_count = mask, count
    if best is None or best_count < cfg.min_side_points:
        return None
    for _ in range(3):
        centroid, direction = _lsq_line(pts[best])
        normal = np.array([-direction[1], direction[0]])
        refined = np.abs((pts - centroid) @ normal) <= cfg.inlier_tolerance
        if int(refined.sum()) < cfg.min_side_points or np.array_equal(refined, best):
            break
        best = refined
    centroid, direction = _lsq_line(pts[best])
    return centroid, direction, best


def _clamp_pair(first: _Side, second: _Side, limit: float) -> None:
    """Limita la differenza di angolo tra due lati opposti; muove di piu' il lato con meno punti."""
    if first.border or second.border:
        return
    diff = first.angle - second.angle
    if abs(diff) <= limit:
        return
    total = float(first.weight + second.weight)
    mean = (first.weight * first.angle + second.weight * second.angle) / total
    sign = 1.0 if diff > 0 else -1.0
    first.angle = mean + sign * limit * (second.weight / total)
    second.angle = mean - sign * limit * (first.weight / total)


def _weighted_angle(sides) -> float:
    total = float(sum(sd.weight for sd in sides))
    return sum(sd.weight * sd.angle for sd in sides) / total


def _regularize(sides: Dict[str, _Side], cfg: QuadFitConfig) -> None:
    limit = math.radians(cfg.max_converge_deg)
    _clamp_pair(sides["left"], sides["right"], limit)
    _clamp_pair(sides["top"], sides["bottom"], limit)

    horizontal = [sd for sd in (sides["top"], sides["bottom"]) if not sd.border]
    vertical = [sd for sd in (sides["left"], sides["right"]) if not sd.border]
    if not horizontal or not vertical:
        return
    # Per un rettangolo ruotato di r: angolo orizzontali = r, angolo verticali = -r -> somma 0.
    skew = _weighted_angle(horizontal) + _weighted_angle(vertical)
    max_shear = math.radians(cfg.max_shear_deg)
    if abs(skew) <= max_shear:
        return
    excess = skew - math.copysign(max_shear, skew)
    for side in horizontal + vertical:
        side.angle -= excess / 2.0


def _intersect(p1: np.ndarray, d1: np.ndarray, p2: np.ndarray, d2: np.ndarray) -> Optional[np.ndarray]:
    matrix = np.array([[d1[0], -d2[0]], [d1[1], -d2[1]]])
    if abs(np.linalg.det(matrix)) < 1e-9:
        return None
    t = np.linalg.solve(matrix, p2 - p1)
    return p1 + t[0] * d1


def _is_valid(quad: np.ndarray, min_corner_deg: float) -> bool:
    """Convesso, orientazione coerente, angoli interni in [min, 180 - min] gradi."""
    sign = 0
    for i in range(4):
        e1 = quad[(i + 1) % 4] - quad[i]
        e2 = quad[(i + 2) % 4] - quad[(i + 1) % 4]
        cross = e1[0] * e2[1] - e1[1] * e2[0]
        n1, n2 = float(np.hypot(*e1)), float(np.hypot(*e2))
        if abs(cross) < 1e-6 or n1 < 1e-6 or n2 < 1e-6:
            return False
        current = 1 if cross > 0 else -1
        if sign == 0:
            sign = current
        elif current != sign:
            return False
        interior = math.degrees(math.acos(max(-1.0, min(1.0, -float(np.dot(e1, e2)) / (n1 * n2)))))
        if interior < min_corner_deg or interior > 180.0 - min_corner_deg:
            return False
    return True
