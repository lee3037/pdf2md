"""文档解析后端契约；后端只负责生成元素、文档统计和来源警告。"""
from __future__ import annotations

from concurrent.futures import Executor
from dataclasses import dataclass, field
from typing import TYPE_CHECKING, Callable, Protocol

if TYPE_CHECKING:
    from ..pipeline import ConvertOptions

Progress = Callable[[int, int], None]


@dataclass
class ParsedDocument:
    elements: list[dict]
    stats: dict
    warnings: list[str] = field(default_factory=list)


class DocumentParser(Protocol):
    id: str
    name: str
    local_ocr_options: bool
    uses_local_workers: bool

    def parse(self, path: str, options: ConvertOptions, executor: Executor | None = None,
              workers: int = 1, progress: Progress | None = None) -> ParsedDocument: ...
