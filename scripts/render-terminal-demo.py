"""Render the short public terminal demo from executed fixture behavior.

Build-only dependency: Pillow. The generated GIF contains only selected,
content-safe outcomes; temporary paths and complete command logs are excluded.
"""

from pathlib import Path
import shutil
import subprocess
import tempfile

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
DEMO = ROOT / "demos" / "fake-js-repo"
OUTPUT_FULL = ROOT / "docs" / "assets" / "agent-context-patch-terminal-demo-full.gif"
OUTPUT_SHORT = ROOT / "docs" / "assets" / "agent-context-patch-terminal-demo.gif"
WIDTH, HEIGHT = 1200, 675
BACKGROUND = "#0d1117"
FOREGROUND = "#e6edf3"
MUTED = "#8b949e"
GREEN = "#3fb950"
RED = "#f85149"
BLUE = "#58a6ff"


def main() -> None:
    fail_result, pass_result = execute_demo_transition()
    if fail_result.returncode == 0:
        raise RuntimeError("broken greeting fixture unexpectedly passed")
    if "greeting must preserve caller-provided names" not in fail_result.stderr:
        raise RuntimeError("failure did not exercise the caller-input contract")
    if pass_result.returncode != 0:
        raise RuntimeError("repaired greeting fixture did not pass")
    proposal = (
        DEMO
        / ".agent-context"
        / "proposals"
        / "2026-07-09-greeting-contract.md"
    ).read_text(encoding="utf-8")
    for evidence in ["status: applied", "decision: policy_auto", "result: applied"]:
        if evidence not in proposal:
            raise RuntimeError(f"demo proposal is missing verified evidence: {evidence}")

    frames = [
        render_frame(
            "1 / 5  VERIFIED FAILURE",
            [
                ("$ npm test", BLUE),
                ("FAIL  greeting must preserve caller-provided names", RED),
                ("exit 1", MUTED),
            ],
            "A fresh task repeated a known caller-input mistake.",
        ),
        render_frame(
            "2 / 9  CONTENT-SAFE EVIDENCE",
            [
                ('Caller input: "Ada"', FOREGROUND),
                ('Expected: "Hello, Ada!"', GREEN),
                ('Actual:   "Hello, developer!"', RED),
            ],
            "Keep the minimum reproducible fact, not a full terminal log.",
        ),
        render_frame(
            "3 / 9  CURRENT TASK FIRST",
            [
                ("- return `Hello, developer!`;", RED),
                ("+ return `Hello, ${name}!`;", GREEN),
                ("$ npm test", BLUE),
            ],
            "Repair the behavior before considering durable context.",
        ),
        render_frame(
            "4 / 9  VERIFIED REPAIR",
            [
                ("$ npm test", BLUE),
                ("PASS  greeting preserves caller-provided names", GREEN),
                ("exit 0", MUTED),
            ],
            "Only a verified correction may enter the evolution loop.",
        ),
        render_frame(
            "5 / 9  AGENT-OWNED MEANING",
            [
                ("Candidate: recurring caller-input contract", FOREGROUND),
                ("Replace-before-add: no active equivalent", BLUE),
                ("Policy: eligible low-risk addition", GREEN),
            ],
            "The Agent decides meaning; a script does not invent the lesson.",
        ),
        render_frame(
            "6 / 9  DETERMINISTIC COMMIT",
            [
                ("Target: .agent-context/checklists/coding.md", BLUE),
                ("Source hash: verified   Conflict: none", GREEN),
                ("Rollback boundary: exact workspace patch", FOREGROUND),
            ],
            "The kernel owns paths, hashes, conflicts, policy, and recovery.",
        ),
        render_frame(
            "7 / 9  SAFE CONTEXT PATCH",
            [
                ("Evolution outcome:", FOREGROUND),
                ("detect=candidate; propose=created; apply=applied;", GREEN),
                ("targets=.agent-context/checklists/coding.md", MUTED),
            ],
            "No raw chat, full log, private path, or PatchPlan is exposed.",
        ),
        render_frame(
            "8 / 9  BETTER NEXT TASK",
            [
                ("Context read: .agent-context/checklists/coding.md", BLUE),
                ("Reusable guard loaded before the next edit.", GREEN),
                ("Claude Code + OpenAI Codex", FOREGROUND),
            ],
            "Verified failure -> safe context patch -> later reuse",
        ),
        render_frame(
            "9 / 9  AGENT CONTEXT PATCH",
            [
                ("Verified failures become reviewable workspace memory.", GREEN),
                ("Local. Auditable. No daemon or telemetry.", FOREGROUND),
                ("github.com/Cherwayway/agent-context-patch", BLUE),
            ],
            "For Claude Code and OpenAI Codex",
        ),
    ]
    OUTPUT_FULL.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        OUTPUT_FULL,
        save_all=True,
        append_images=frames[1:],
        duration=[8000, 8000, 10000, 8000, 8000, 8000, 10000, 8000, 6000],
        loop=0,
        optimize=True,
        disposal=2,
    )
    short_frames = [frames[index] for index in [0, 3, 6, 7]]
    short_frames[0].save(
        OUTPUT_SHORT,
        save_all=True,
        append_images=short_frames[1:],
        duration=[1800, 1800, 2200, 2200],
        loop=0,
        optimize=True,
        disposal=2,
    )
    print(OUTPUT_FULL)
    print(OUTPUT_SHORT)


def execute_demo_transition():
    with tempfile.TemporaryDirectory(prefix="agent-context-demo-") as temporary:
        workspace = Path(temporary) / "fake-js-repo"
        shutil.copytree(DEMO, workspace)
        source = workspace / "src" / "greeting.js"
        source.write_text(
            'export function greeting(_name) {\n  return "Hello, developer!";\n}\n',
            encoding="utf-8",
        )
        fail_result = run_test(workspace)
        source.write_text(
            "export function greeting(name) {\n  return `Hello, ${name}!`;\n}\n",
            encoding="utf-8",
        )
        pass_result = run_test(workspace)
        return fail_result, pass_result


def run_test(workspace: Path):
    return subprocess.run(
        ["npm.cmd" if shutil.which("npm.cmd") else "npm", "test"],
        cwd=workspace,
        capture_output=True,
        text=True,
        encoding="utf-8",
        errors="replace",
        check=False,
    )


def render_frame(title: str, lines, caption: str) -> Image.Image:
    image = Image.new("RGB", (WIDTH, HEIGHT), BACKGROUND)
    draw = ImageDraw.Draw(image)
    regular = load_font(34)
    small = load_font(26)
    heading = load_font(28)

    draw.rounded_rectangle((42, 40, WIDTH - 42, HEIGHT - 40), 18, outline="#30363d", width=3)
    draw.rectangle((42, 40, WIDTH - 42, 98), fill="#161b22")
    for x, color in [(72, RED), (104, "#d29922"), (136, GREEN)]:
        draw.ellipse((x, 60, x + 18, 78), fill=color)
    draw.text((180, 55), "agent-context-patch / observable demo", font=small, fill=MUTED)
    draw.text((78, 132), title, font=heading, fill=FOREGROUND)

    y = 212
    for line, color in lines:
        draw.text((78, y), line, font=regular, fill=color)
        y += 68

    draw.line((78, 510, WIDTH - 78, 510), fill="#30363d", width=2)
    draw.text((78, 548), caption, font=small, fill=FOREGROUND)
    return image


def load_font(size: int):
    candidates = [
        Path("C:/Windows/Fonts/consola.ttf"),
        Path("/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"),
    ]
    for path in candidates:
        if path.exists():
            return ImageFont.truetype(str(path), size)
    return ImageFont.load_default(size=size)


if __name__ == "__main__":
    main()
