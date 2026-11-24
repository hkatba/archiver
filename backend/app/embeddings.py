"""Text embeddings for semantic search. Default: fastembed (local ONNX, CPU, no API key, no per-call cost)."""

import hashlib
import math
import re
import threading
from functools import lru_cache
from typing import Protocol

from app.config import EMBEDDING_DIM, settings


class Embedder(Protocol):
    name: str

    def documents(self, texts: list[str]) -> list[list[float]]: ...

    def query(self, text: str) -> list[float]: ...


class FastEmbedder:
    def __init__(self, model_name: str):
        from fastembed import TextEmbedding

        self.name = model_name
        self._model = TextEmbedding(model_name, cache_dir=str(settings.fastembed_cache_dir))
        self._lock = threading.Lock()  # onnxruntime sessions are shared; keep calls serialized
        if len(self.query("probe")) != EMBEDDING_DIM:
            raise RuntimeError(f"{model_name} does not produce {EMBEDDING_DIM}-dim vectors")

    def documents(self, texts: list[str]) -> list[list[float]]:
        with self._lock:
            return [v.tolist() for v in self._model.passage_embed(texts, batch_size=32)]

    def query(self, text: str) -> list[float]:
        if "bge" in self.name.lower():  # BGE retrieval instruction; fastembed's query_embed doesn't add it
            text = "Represent this sentence for searching relevant passages: " + text
        with self._lock:
            return next(iter(self._model.embed([text]))).tolist()


class HashEmbedder:
    """Deterministic lexical embedding (feature hashing). For tests/offline use only: no real semantics."""

    name = "hash-v1"

    def _vec(self, text: str) -> list[float]:
        v = [0.0] * EMBEDDING_DIM
        for tok in re.findall(r"[a-z0-9]+", text.lower()):
            h = int(hashlib.md5(tok.encode()).hexdigest(), 16)
            v[h % EMBEDDING_DIM] += 1.0 if (h >> 8) & 1 else -1.0
        norm = math.sqrt(sum(x * x for x in v)) or 1.0
        return [x / norm for x in v]

    def documents(self, texts: list[str]) -> list[list[float]]:
        return [self._vec(t) for t in texts]

    def query(self, text: str) -> list[float]:
        return self._vec(text)


@lru_cache
def get_embedder() -> Embedder:
    if settings.embedding_provider == "hash":
        return HashEmbedder()
    return FastEmbedder(settings.embedding_model)


def cosine(a: list[float], b: list[float]) -> float:
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a)) or 1.0
    nb = math.sqrt(sum(y * y for y in b)) or 1.0
    return dot / (na * nb)
