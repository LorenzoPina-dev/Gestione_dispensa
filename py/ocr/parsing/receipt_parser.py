"""Parser locale (solo regex) per scontrini italiani: prodotti, prezzi, totale.

Layout atteso di una riga prodotto:   NOME PRODOTTO (sx) ........ 1,29 (dx)  [A]
    - il prezzo e' l'ULTIMO token numerico `\\d+,\\d{2}` della riga
    - dopo il prezzo possono esserci "EUR"/"€" e una lettera di reparto/IVA (A, B, C...)
    - il nome e' tutto cio' che sta a sinistra e deve contenere almeno una lettera

I prezzi sono Decimal (mai float) per evitare errori di arrotondamento sui soldi.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field
from decimal import Decimal
from typing import List, Optional, Sequence, Tuple

# --- pattern di base --------------------------------------------------------------
# Prezzo: 1-6 cifre, separatore decimale , o . (l'OCR confonde spesso i due), 2 decimali.
# Lookaround: non deve far parte di un numero piu' lungo (es. "12,345" o "1.234,56").
_PRICE = r"(?<![\d,.])-?\d{1,6}[.,]\d{2}(?![\d])"

# Riga prodotto: nome (con almeno una lettera) + prezzo a fine riga + suffissi opzionali.
_ITEM_LINE = re.compile(
    rf"^\s*(?P<name>.*?[^\W\d_].*?)\s+(?P<price>{_PRICE})\s*(?:€|EUR)?\s*(?:[A-Ea-e])?\s*$",
    re.IGNORECASE,
)

# Variante con quantita':  "ACQUA 1.5L   3 x 0,50   1,50"
_ITEM_WITH_QTY = re.compile(
    rf"^\s*(?P<name>.*?[^\W\d_].*?)\s+(?P<qty>\d{{1,3}})\s*[xX*]\s*(?P<unit>{_PRICE})"
    rf"\s+(?P<price>{_PRICE})\s*(?:€|EUR)?\s*(?:[A-Ea-e])?\s*$",
    re.IGNORECASE,
)

_PRICE_TOKEN = re.compile(_PRICE)

# OCR: nei token di prezzo O/o sono quasi sempre 0 e I/l sono quasi sempre 1.
_PRICE_CANDIDATE = re.compile(r"(?<![A-Za-z0-9])([0-9OoIl]{1,6}[.,][0-9OoIl]{2})(?![A-Za-z0-9])")
_OCR_DIGITS = str.maketrans({"O": "0", "o": "0", "I": "1", "l": "1"})

# Totale, dal piu' specifico al piu' generico (priorita' 0 = migliore).
_TOTAL_PATTERNS: Sequence[Tuple[int, "re.Pattern[str]"]] = (
    (0, re.compile(r"^\s*TOTALE\s+(?:COMPLESSIVO|EURO|DA\s+PAGARE)\b", re.IGNORECASE)),
    (1, re.compile(r"^\s*(?:TOTALE|TOTAL)\b", re.IGNORECASE)),
    (2, re.compile(r"^\s*(?:IMPORTO\s+PAGATO|DA\s+PAGARE)\b", re.IGNORECASE)),
)
# "TOTALE IVA", "TOTALE SCONTO", "TOTALE ARTICOLI 5" non sono il totale da pagare.
_TOTAL_EXCLUDE = re.compile(r"\b(?:IVA|SCONTO|SCONTI|IMPOSTA|RESTO|ARTICOLI|PEZZI)\b", re.IGNORECASE)

# Righe non-prodotto (intestazione, pagamento, riepilogo IVA) che possono contenere numeri.
_NON_ITEM = re.compile(
    r"^\s*(?:P\.?\s*IVA|PARTITA|C\.?\s*F\.?\b|TEL\b|VIA\b|VIALE\b|PIAZZA\b|DOCUMENTO|SCONTRINO|"
    r"DESCRIZIONE|SUBTOTALE|SUB-TOTALE|TOTALE\b|TOTAL\b|IMPORTO\b|DA\s+PAGARE|CONTANTE|RESTO|CARTA|"
    r"BANCOMAT|PAGAMENTO|IVA\b|DATA\b|ORA\b|"
    r"CASSA|OPERATORE|ARROTONDAMENTO)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class ReceiptItem:
    name: str
    price: Decimal  # totale della riga (quantita' * prezzo unitario)
    quantity: int = 1
    unit_price: Optional[Decimal] = None
    raw_line: str = ""


@dataclass(frozen=True)
class ParsedReceipt:
    items: Tuple[ReceiptItem, ...] = field(default_factory=tuple)
    total: Optional[Decimal] = None
    total_line: Optional[str] = None

    @property
    def items_sum(self) -> Decimal:
        return sum((item.price for item in self.items), Decimal("0.00"))

    def is_consistent(self, tolerance: Decimal = Decimal("0.01")) -> bool:
        """True se la somma degli articoli coincide col totale (utile per validare l'OCR)."""
        return self.total is not None and abs(self.items_sum - self.total) <= tolerance


class ReceiptParser:
    def parse(self, lines: Sequence[str]) -> ParsedReceipt:
        cleaned = [self._fix_ocr_digits(line) for line in lines if line and line.strip()]
        total, total_line, total_index = self._find_total(cleaned)

        # Dopo il totale ci sono pagamento, resto, riepilogo IVA: non sono articoli.
        item_lines = cleaned if total_index is None else cleaned[:total_index]
        items = [item for item in map(self._parse_item, item_lines) if item is not None]
        return ParsedReceipt(items=tuple(items), total=total, total_line=total_line)

    # ----------------------------------------------------------------------- items
    def _parse_item(self, line: str) -> Optional[ReceiptItem]:
        if _NON_ITEM.match(line):
            return None

        with_qty = _ITEM_WITH_QTY.match(line)
        if with_qty:
            qty = int(with_qty.group("qty"))
            return ReceiptItem(
                name=self._clean_name(with_qty.group("name")),
                price=self._to_decimal(with_qty.group("price")),
                quantity=qty,
                unit_price=self._to_decimal(with_qty.group("unit")),
                raw_line=line,
            )

        match = _ITEM_LINE.match(line)
        if not match:
            return None
        name = self._clean_name(match.group("name"))
        if len(name) < 2:
            return None
        return ReceiptItem(name=name, price=self._to_decimal(match.group("price")), raw_line=line)

    # ----------------------------------------------------------------------- total
    def _find_total(self, lines: Sequence[str]) -> Tuple[Optional[Decimal], Optional[str], Optional[int]]:
        """Ritorna (importo, riga, indice della PRIMA riga di totale).

        Tra piu' candidati vince la priorita' piu' specifica; a parita', l'ultimo
        (il totale vero sta in fondo, i parziali prima)."""
        best: Optional[Tuple[int, int, Decimal, str]] = None  # (priorita', indice, importo, riga)
        first_index: Optional[int] = None

        for index, line in enumerate(lines):
            if _TOTAL_EXCLUDE.search(line):
                continue
            for priority, pattern in _TOTAL_PATTERNS:
                if not pattern.match(line):
                    continue
                prices = _PRICE_TOKEN.findall(line)
                if not prices:
                    break
                if first_index is None:
                    first_index = index
                amount = self._to_decimal(prices[-1])
                if best is None or priority < best[0] or (priority == best[0] and index > best[1]):
                    best = (priority, index, amount, line)
                break

        if best is None:
            return None, None, None
        return best[2], best[3], first_index

    # --------------------------------------------------------------------- helpers
    @staticmethod
    def _fix_ocr_digits(line: str) -> str:
        """Corregge O->0 e I/l->1 SOLO dentro token che hanno forma di prezzo e almeno una cifra vera."""

        def repl(match: "re.Match[str]") -> str:
            token = match.group(1)
            return token.translate(_OCR_DIGITS) if any(c.isdigit() for c in token) else token

        return _PRICE_CANDIDATE.sub(repl, line.strip())

    @staticmethod
    def _to_decimal(token: str) -> Decimal:
        return Decimal(token.replace(",", ".")).quantize(Decimal("0.01"))

    @staticmethod
    def _clean_name(name: str) -> str:
        return re.sub(r"\s+", " ", name).strip(" .:-_*")
