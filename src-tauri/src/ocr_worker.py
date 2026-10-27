"""Pinned MinerU 4 adapter, executed only by the app's isolated Python runtime."""
import json
import sys
from pathlib import Path


def setup(manifest_path, source):
    import importlib.metadata
    from mineru.model.download import download_model_repo, verify_model_repo
    from mineru.model.registry import MINERU_4_MODELS_ONNX

    if importlib.metadata.version("mineru") != "4.0.12":
        raise RuntimeError("MinerU version mismatch")
    repo = MINERU_4_MODELS_ONNX
    download_model_repo(repo, source=source, reuse_ready=True)
    verified = verify_model_repo(repo)
    if not verified.ready:
        raise RuntimeError(f"Incomplete OCR models: {verified.missing_paths}")
    # Import the inference entry point and check the actual CPU provider too.
    import onnxruntime
    from mineru.parser import parse  # noqa: F401

    if "CPUExecutionProvider" not in onnxruntime.get_available_providers():
        raise RuntimeError("ONNX CPU provider is unavailable")
    root = Path(manifest_path).parent
    files = {
        str(path.local_path().relative_to(root)): path.local_path().stat().st_size
        for path in repo.required_paths()
    }
    Path(manifest_path).write_text(json.dumps({"version": "4.0.12-basic-onnx-v1", "files": files}), encoding="utf-8")


def extract(source, output, page_range):
    from mineru.parser import ParseResult, parse

    result = parse(source, tier="basic", ocr_mode="ocr", image_analysis=False, page_range=page_range)
    pages = []
    for page in result.pages:
        single = result.middle_json.model_copy(update={"pages": [page]})
        pages.append({"number": page.page_idx + 1, "text": ParseResult(single).markdown()})
    if not pages:
        raise RuntimeError("OCR returned no pages")
    Path(output).write_text(json.dumps({"text": "\n\n".join(p["text"] for p in pages), "pages": pages}, ensure_ascii=False), encoding="utf-8")


if __name__ == "__main__":
    if sys.argv[1] == "setup":
        setup(*sys.argv[2:])
    elif sys.argv[1] == "extract":
        extract(*sys.argv[2:])
    else:
        raise ValueError("Unknown OCR operation")
