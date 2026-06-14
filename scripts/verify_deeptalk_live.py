"""Live verification for DeepTalk LLM sidecar (reads API keys from env only)."""

from __future__ import annotations

import asyncio
import os
import sys
import tempfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
if str(ROOT) not in sys.path:
    sys.path.insert(0, str(ROOT))


def _mask(value: str | None) -> str:
    if not value:
        return "missing"
    if len(value) <= 8:
        return "set"
    return f"set ({value[:4]}...{value[-4:]})"


async def _verify_llm_updater() -> bool:
    from nanobot.webui.seeyouclaw_deeptalk_updater import llm_synthesize_deeptalk_update

    payload = {
        "title": "情感深聊",
        "turnCount": 3,
        "summary": {
            "why": "",
            "current": "",
            "open_questions": [],
            "tasks": [],
        },
        "notesExcerpt": (
            "## Turn 1 - User\n\n"
            "我单身但对前女友念念不忘，实习也没找到。\n\n"
            "## Turn 2 - Assistant\n\n"
            "我听到你在怀念和焦虑之间摇摆。\n"
        ),
        "userText": (
            "我最近生活很烂，研二了暑期实习时间也过了，"
            "面试挂了好几轮，早上也起不来。"
        ),
        "assistantText": (
            "我听到的不只是实习压力，还有对前任的留恋和日常秩序的失控。"
            "此刻什么最让你难受？"
        ),
        "observationText": (
            "Visual observation window: 2 frame(s), route=vision_snapshot, "
            "context=emotion, trigger=llm_router."
        ),
        "hookText": None,
    }
    result = await llm_synthesize_deeptalk_update(payload)
    if result is None:
        print("[FAIL] LLM updater returned None")
        return False
    print("[OK] LLM updater")
    print(f"  model: {result.get('updater_model', 'unknown')}")
    print(f"  lane: {result.get('lane')}")
    print(f"  why: {result.get('why', '')[:160]}")
    print(f"  current: {result.get('current', '')[:160]}")
    questions = result.get("open_questions") or []
    if questions:
        print(f"  question: {questions[0][:120]}")
    spec = str(result.get("spec_body") or "")
    if "Preserve DeepTalk continuity" in spec:
        print("[WARN] spec_body still contains template boilerplate")
    else:
        print(f"  spec: {spec[:120]}...")
    return bool(result.get("why") and result.get("current"))


async def _verify_project_pipeline() -> bool:
    from nanobot.webui.seeyouclaw_deeptalk import ensure_deeptalk_project, update_deeptalk_project

    with tempfile.TemporaryDirectory() as tmp:
        workspace = Path(tmp)
        created = ensure_deeptalk_project(
            workspace,
            {"chatId": "verify-chat", "title": "验证深聊"},
        )
        project_id = created["project"]["id"]
        updated = await update_deeptalk_project(
            workspace,
            {
                "projectId": project_id,
                "userText": "我单身但还想念前女友，实习也很难，生活秩序也乱了。",
                "assistantText": "我听到怀念、求职压力和作息失控叠在一起。现在哪一块最堵？",
                "observationText": (
                    "Visual observation window: 2 frame(s), route=vision_snapshot, "
                    "context=emotion, trigger=llm_router."
                ),
                "hookText": "Long pause detected; revisit the open question.",
            },
        )
        project = updated["project"]
        summary = project["summary"]
        project_dir = workspace / project["path"]
        spec_text = (project_dir / "specs" / "main" / "spec.md").read_text(encoding="utf-8")
        print("[OK] project pipeline")
        print(f"  lane: {summary.get('lane')}")
        print(f"  why: {str(summary.get('why', ''))[:160]}")
        print(f"  signals: {len(summary.get('proactive_signals') or [])}")
        if "Preserve DeepTalk continuity" in spec_text:
            print("[FAIL] spec.md still has template boilerplate")
            return False
        notes = (project_dir / "notes.md").read_text(encoding="utf-8")
        if "## Turn" in notes and "Hook" in notes:
            print("[OK] hook note recorded")
        return bool(summary.get("why") and summary.get("current"))


async def _verify_telephone_speech() -> bool:
    from nanobot.webui.seeyouclaw_telephone import synthesize_telephone_speech

    result = await synthesize_telephone_speech({"text": "你好，这是一次 DeepTalk 语音验证。"})
    ok = bool(result.get("ok"))
    label = "OK" if ok else "FAIL"
    print(f"[{label}] telephone speech provider={result.get('provider')} reason={result.get('reason')}")
    if ok:
        audio = result.get("audioDataUrl") or ""
        print(f"  audio bytes approx: {len(audio)}")
    return ok


async def main() -> int:
    print("DeepTalk live verification")
    print(f"  DEEPSEEK_API_KEY: {_mask(os.environ.get('DEEPSEEK_API_KEY'))}")
    print(f"  DASHSCOPE_API_KEY: {_mask(os.environ.get('DASHSCOPE_API_KEY'))}")
    print(f"  DOUBAO_TTS_API_KEY: {_mask(os.environ.get('DOUBAO_TTS_API_KEY'))}")

    if not os.environ.get("DEEPSEEK_API_KEY"):
        print("[FAIL] DEEPSEEK_API_KEY is required for LLM updater")
        return 1

    results = [
        await _verify_llm_updater(),
        await _verify_project_pipeline(),
    ]

    if os.environ.get("DOUBAO_TTS_API_KEY") or os.environ.get("DASHSCOPE_API_KEY"):
        results.append(await _verify_telephone_speech())
    else:
        print("[SKIP] telephone speech (no DOUBAO_TTS_API_KEY or DASHSCOPE_API_KEY)")

    if all(results):
        print("All checks passed.")
        return 0
    print("Some checks failed.")
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
