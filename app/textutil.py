"""文本清洗与中英文混排拼接工具。"""
import re
import unicodedata

_CJK_RANGES = (
    (0x2E80, 0x2FDF),  # 部首
    (0x3000, 0x303F),  # CJK 标点
    (0x3040, 0x30FF),  # 日文假名
    (0x3100, 0x31BF),
    (0x3400, 0x4DBF),
    (0x4E00, 0x9FFF),
    (0xAC00, 0xD7AF),  # 韩文
    (0xF900, 0xFAFF),
    (0xFE30, 0xFE4F),
    (0xFF00, 0xFFEF),  # 全角符号
    (0x20000, 0x2FA1F),
)

TERMINAL_PUNCT = tuple("。！？!?；;…」』”\"）)】]") + (".", "：", ":")
SENTENCE_END_RE = re.compile(r"(?<=[。！？!?；;])|(?<=\.)(?=\s)")

_PUA_RE = re.compile("[\ue000-\uf8ff\U000f0000-\U000ffffd\U00100000-\U0010fffd]")
_CTRL_RE = re.compile("[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\ufffd\u200b-\u200f\u00ad\u2060\ufeff]")
_SPACE_RE = re.compile("[ \t\u00a0\u2002-\u200a\u3000]+")
_CJK_SPACE_RE = re.compile(
    "(?<=[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f]) +(?=[\u2e80-\u9fff\uf900-\ufaff\uff00-\uffef\u3000-\u303f])"
)
_OCR_PUNCT = {",": "，", ";": "；", ":": "：", "?": "？", "!": "！"}
_OCR_PUNCT_RE = re.compile("(?<=[\u4e00-\u9fff])([,;:?!])(?!\\d)")
_FULLWIDTH_ALNUM = {c: c - 0xFEE0 for c in list(range(0xFF10, 0xFF1A)) + list(range(0xFF21, 0xFF3B)) + list(range(0xFF41, 0xFF5B))}


def is_cjk(ch: str) -> bool:
    if not ch:
        return False
    o = ord(ch)
    return any(a <= o <= b for a, b in _CJK_RANGES)


def clean_text(text: str, ocr: bool = False) -> str:
    """去除私有区字符/控制字符，压缩空白，删除中文字符之间多余的空格。"""
    if not text:
        return ""
    text = unicodedata.normalize("NFC", text)
    text = _PUA_RE.sub("", text)
    text = _CTRL_RE.sub("", text)
    text = text.replace("\r", "")
    if ocr:
        text = text.translate(_FULLWIDTH_ALNUM)
        # OCR 常把中文标点识别成半角：紧跟中文字符的半角标点转为全角
        text = _OCR_PUNCT_RE.sub(lambda m: _OCR_PUNCT[m.group(1)], text)
    text = _SPACE_RE.sub(" ", text)
    text = _CJK_SPACE_RE.sub("", text)
    return text.strip()


def join_lines(lines: list[str]) -> str:
    """按中英文规则拼接折行：中文直接相连，英文加空格，英文连字符断词合并。"""
    out = ""
    for line in lines:
        line = line.strip()
        if not line:
            continue
        if not out:
            out = line
            continue
        prev, nxt = out[-1], line[0]
        if prev == "-" and len(out) > 1 and out[-2].isalpha() and nxt.islower():
            out = out[:-1] + line
        elif is_cjk(prev) or is_cjk(nxt):
            out += line
        else:
            out += " " + line
    return out


def ends_sentence(text: str) -> bool:
    text = text.rstrip()
    return bool(text) and text.endswith(TERMINAL_PUNCT)


def norm_key(text: str) -> str:
    """用于比较的归一化：去空白与标点、数字统一为 #。"""
    text = re.sub(r"\d+", "#", text)
    return re.sub(r"[\s\W_]+", "", text).lower()


def strip_key(text: str) -> str:
    """去除空白与标点（保留数字），用于标题/表头比对。"""
    return re.sub(r"[\s\W_]+", "", text).lower()


def split_sentences(text: str) -> list[str]:
    parts = [p for p in SENTENCE_END_RE.split(text) if p]
    return parts or [text]


def hard_split(text: str, limit: int) -> list[str]:
    """把超长文本切成不超过 limit 的片段：先按句，再按逗号，最后按字数。"""
    if len(text) <= limit:
        return [text]
    pieces: list[str] = []
    for sent in split_sentences(text):
        if len(sent) <= limit:
            pieces.append(sent)
            continue
        for sub in re.split(r"(?<=[，,、])", sent):
            while len(sub) > limit:
                pieces.append(sub[:limit])
                sub = sub[limit:]
            if sub:
                pieces.append(sub)
    out: list[str] = []
    buf = ""
    for p in pieces:
        if buf and len(buf) + len(p) > limit:
            out.append(buf)
            buf = p
        else:
            buf += p
    if buf:
        out.append(buf)
    return [o.strip() for o in out if o.strip()]
