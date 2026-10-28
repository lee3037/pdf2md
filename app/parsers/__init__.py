"""解析后端注册表；接口目录与任务调度共用这一份定义。"""
from .base import DocumentParser, ParsedDocument
from .oxr import OXRParser
from .pymupdf import PyMuPDFParser

_registry: dict[str, DocumentParser] = {}


def register(parser: DocumentParser) -> None:
    if parser.id in _registry:
        raise ValueError(f"解析后端已注册：{parser.id}")
    _registry[parser.id] = parser


def get_parser(parser_id: str) -> DocumentParser:
    try:
        return _registry[parser_id]
    except KeyError:
        raise ValueError(f"未知解析后端：{parser_id}") from None


def catalog() -> list[dict]:
    return [{"id": parser.id, "name": parser.name, "local_ocr_options": parser.local_ocr_options}
            for parser in _registry.values()]


register(PyMuPDFParser())
register(OXRParser())
