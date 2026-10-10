"""Wrapper generico per un modello TFLite (float32 o quantizzato INT8/UINT8).

Unico punto del progetto che importa il runtime ML: sostituirlo (CoreML, ONNX, ...) non
tocca detector, recognizer ne' pipeline.

Quantizzazione affine (schema TFLite)
-------------------------------------
    reale  r = scale * (q - zero_point)          # dequantizzazione
    q = clip(round(r / scale) + zero_point)      # quantizzazione, clip nel range del dtype

`scale` e `zero_point` sono letti dai metadati di ogni tensore: nessun valore hardcoded,
quindi il wrapper funziona con qualunque modello INT8 esportato correttamente.
"""
from __future__ import annotations

import os
from typing import Any, Tuple

import numpy as np


def _resolve_interpreter_class() -> Any:
    """Cerca il runtime piu' leggero disponibile: ai-edge-litert > tflite-runtime > tensorflow."""
    try:
        from ai_edge_litert.interpreter import Interpreter  # type: ignore

        return Interpreter
    except ImportError:
        pass
    try:
        from tflite_runtime.interpreter import Interpreter  # type: ignore

        return Interpreter
    except ImportError:
        pass
    try:
        import tensorflow as tf  # type: ignore

        return tf.lite.Interpreter
    except ImportError as exc:
        raise ImportError(
            "Nessun runtime TFLite trovato. Installa `ai-edge-litert` (o `tflite-runtime`, o `tensorflow`)."
        ) from exc


def detect_layout(shape: Tuple[int, ...]) -> str:
    """'NHWC' se l'ultimo asse e' il canale (1 o 3), altrimenti 'NCHW'."""
    if len(shape) != 4:
        raise ValueError(f"Attesa shape 4D, trovata {shape}")
    return "NHWC" if shape[-1] in (1, 3) else "NCHW"


def channels_and_size(shape: Tuple[int, ...]) -> Tuple[int, int, int]:
    """Restituisce (canali, altezza, larghezza) indipendentemente dal layout."""
    if detect_layout(shape) == "NHWC":
        return shape[3], shape[1], shape[2]
    return shape[1], shape[2], shape[3]


class TfliteModel:
    """Un modello TFLite con 1 input e 1 output (DBNet / CRNN)."""

    def __init__(self, model_path: str, num_threads: int = 2) -> None:
        if not os.path.isfile(model_path):
            raise FileNotFoundError(f"Modello non trovato: {model_path}")
        interpreter_cls = _resolve_interpreter_class()
        self._interpreter = interpreter_cls(model_path=model_path, num_threads=num_threads)
        self._interpreter.allocate_tensors()
        self._input = self._interpreter.get_input_details()[0]
        self._output = self._interpreter.get_output_details()[0]

    # ------------------------------------------------------------------ metadata
    @property
    def input_shape(self) -> Tuple[int, ...]:
        return tuple(int(d) for d in self._interpreter.get_input_details()[0]["shape"])

    @property
    def input_dynamic(self) -> bool:
        """True se il modello dichiara dimensioni dinamiche (-1) nella shape signature."""
        signature = self._input.get("shape_signature")
        if signature is None:
            return False
        return any(int(d) < 0 for d in signature)

    @property
    def input_dtype(self) -> np.dtype:
        return np.dtype(self._input["dtype"])

    @property
    def is_quantized(self) -> bool:
        return np.issubdtype(self.input_dtype, np.integer)

    # ------------------------------------------------------------------ inference
    def resize_input(self, shape: Tuple[int, ...]) -> None:
        self._interpreter.resize_tensor_input(self._input["index"], list(shape))
        self._interpreter.allocate_tensors()

    def run(self, tensor: np.ndarray) -> np.ndarray:
        """tensor: float32 gia' normalizzato, shape = input del modello. Ritorna float32."""
        tensor = np.ascontiguousarray(tensor)
        if tuple(tensor.shape) != self.input_shape:
            self.resize_input(tuple(tensor.shape))

        self._interpreter.set_tensor(self._input["index"], self._quantize_input(tensor))
        self._interpreter.invoke()
        raw = self._interpreter.get_tensor(self._output["index"])
        return self._dequantize_output(raw)

    # ------------------------------------------------------------- (de)quantization
    def _quantize_input(self, x: np.ndarray) -> np.ndarray:
        dtype = self.input_dtype
        scale, zero_point = self._input["quantization"]
        if np.issubdtype(dtype, np.integer) and scale > 0:
            info = np.iinfo(dtype)
            q = np.round(x / scale) + zero_point  # q = round(r / s) + z
            return np.clip(q, info.min, info.max).astype(dtype)
        return x.astype(dtype, copy=False)

    def _dequantize_output(self, raw: np.ndarray) -> np.ndarray:
        scale, zero_point = self._output["quantization"]
        if np.issubdtype(raw.dtype, np.integer) and scale > 0:
            return (raw.astype(np.float32) - zero_point) * scale  # r = s * (q - z)
        return raw.astype(np.float32, copy=True)
