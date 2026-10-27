"""命令行转换：python tests/run_sample.py file.pdf [key=value ...]"""
import json
import sys
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from app.chunker import ChunkOptions  # noqa: E402
from app.pipeline import ConvertOptions, convert  # noqa: E402

if __name__ == "__main__":
    path = sys.argv[1]
    kv = dict(a.split("=", 1) for a in sys.argv[2:])
    t = time.time()
    r = convert(path, ConvertOptions.from_dict(kv), ChunkOptions.from_dict(kv))
    res = r["result"]
    print(res["markdown"])
    print(json.dumps({"stats": res["stats"], "doc": res["doc_stats"], "warnings": res["warnings"]}, ensure_ascii=False))
    print(f"耗时 {time.time() - t:.1f}s")
