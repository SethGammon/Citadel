#!/usr/bin/env python3
"""Render Citadel's readable 16:9 Sentient grant support packet."""

from __future__ import annotations

from pathlib import Path

from reportlab.lib.colors import HexColor
from reportlab.lib.utils import ImageReader
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.pdfmetrics import stringWidth
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.pdfgen import canvas


ROOT = Path(__file__).resolve().parents[1]
OUTPUT = ROOT / "output" / "pdf" / "citadel-sentient-grant-packet.pdf"
ASSETS = ROOT / "docs" / "assets" / "application"

PAGE_W = 960
PAGE_H = 540
MARGIN = 60

PAPER = HexColor("#F7F3EA")
WHITE = HexColor("#FFFFFF")
INK = HexColor("#122B3A")
MUTED = HexColor("#4A6371")
FAINT = HexColor("#6D808A")
NAVY = HexColor("#14374A")
LINE = HexColor("#C9D9DC")
CYAN = HexColor("#087F96")
CYAN_SOFT = HexColor("#DDF3F4")
BLUE = HexColor("#4264B5")
BLUE_SOFT = HexColor("#E8EDFA")
GREEN = HexColor("#18785A")
GREEN_SOFT = HexColor("#E1F2EA")
AMBER = HexColor("#A86210")
AMBER_SOFT = HexColor("#FAEDD8")
VIOLET = HexColor("#6C56A8")
VIOLET_SOFT = HexColor("#EEE9F8")
RED = HexColor("#A84444")
RED_SOFT = HexColor("#F8E8E4")


def register_fonts() -> tuple[str, str, str]:
    font_dir = Path("C:/Windows/Fonts")
    regular = font_dir / "segoeui.ttf"
    bold = font_dir / "segoeuib.ttf"
    mono = font_dir / "CascadiaMono.ttf"
    if regular.exists() and bold.exists() and mono.exists():
        pdfmetrics.registerFont(TTFont("CitadelSans", str(regular)))
        pdfmetrics.registerFont(TTFont("CitadelSans-Bold", str(bold)))
        pdfmetrics.registerFont(TTFont("CitadelMono", str(mono)))
        return "CitadelSans", "CitadelSans-Bold", "CitadelMono"
    return "Helvetica", "Helvetica-Bold", "Courier"


FONT, FONT_BOLD, FONT_MONO = register_fonts()


def set_alpha(pdf: canvas.Canvas, fill: float | None = None, stroke: float | None = None) -> None:
    if fill is not None and hasattr(pdf, "setFillAlpha"):
        pdf.setFillAlpha(fill)
    if stroke is not None and hasattr(pdf, "setStrokeAlpha"):
        pdf.setStrokeAlpha(stroke)


def wrap_lines(text: str, font: str, size: float, width: float) -> list[str]:
    lines: list[str] = []
    for raw in text.splitlines() or [""]:
        words = raw.split()
        if not words:
            lines.append("")
            continue
        current = words[0]
        for word in words[1:]:
            candidate = f"{current} {word}"
            if stringWidth(candidate, font, size) <= width:
                current = candidate
            else:
                lines.append(current)
                current = word
        lines.append(current)
    return lines


def text_block(
    pdf: canvas.Canvas,
    text: str,
    x: float,
    y: float,
    width: float,
    size: float = 13,
    leading: float | None = None,
    color=INK,
    font: str | None = None,
    max_lines: int | None = None,
) -> float:
    selected_font = font or FONT
    line_height = leading or size * 1.38
    lines = wrap_lines(text, selected_font, size, width)
    if max_lines is not None:
        lines = lines[:max_lines]
    pdf.setFillColor(color)
    pdf.setFont(selected_font, size)
    cursor = y
    for line in lines:
        pdf.drawString(x, cursor, line)
        cursor -= line_height
    return cursor


def background(pdf: canvas.Canvas, page: int, section: str) -> None:
    pdf.setFillColor(PAPER)
    pdf.rect(0, 0, PAGE_W, PAGE_H, fill=1, stroke=0)

    pdf.setFillColor(NAVY)
    pdf.rect(0, PAGE_H - 9, PAGE_W, 9, fill=1, stroke=0)
    pdf.setFillColor(CYAN)
    pdf.rect(0, PAGE_H - 9, 240, 9, fill=1, stroke=0)

    set_alpha(pdf, fill=0.42)
    pdf.setFillColor(CYAN_SOFT)
    pdf.circle(PAGE_W + 15, PAGE_H + 28, 130, fill=1, stroke=0)
    pdf.setFillColor(VIOLET_SOFT)
    pdf.circle(PAGE_W + 36, -20, 118, fill=1, stroke=0)
    set_alpha(pdf, fill=1)

    pdf.setFillColor(NAVY)
    pdf.roundRect(32, PAGE_H - 59, 30, 30, 7, fill=1, stroke=0)
    pdf.setFillColor(WHITE)
    pdf.setFont(FONT_BOLD, 12)
    pdf.drawCentredString(47, PAGE_H - 50, "C")
    pdf.setFillColor(INK)
    pdf.setFont(FONT_BOLD, 12)
    pdf.drawString(73, PAGE_H - 50, "CITADEL")

    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_BOLD, 9.5)
    pdf.drawRightString(PAGE_W - 42, PAGE_H - 49, section.upper())

    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.8)
    pdf.line(MARGIN, 48, PAGE_W - MARGIN, 48)
    pdf.setFillColor(MUTED)
    pdf.setFont(FONT_BOLD, 9.5)
    pdf.drawRightString(PAGE_W - MARGIN, 27, f"{page:02d} / 08")


def source(pdf: canvas.Canvas, text: str) -> None:
    text_block(pdf, text, MARGIN, 31, 720, size=8.7, leading=10.5, color=FAINT, font=FONT, max_lines=2)


def eyebrow(pdf: canvas.Canvas, text: str, x: float, y: float, color=CYAN) -> None:
    pdf.setFillColor(color)
    pdf.setFont(FONT_BOLD, 10.5)
    pdf.drawString(x, y, text.upper())


def title(pdf: canvas.Canvas, text: str, x: float, y: float, width: float, size: float = 37) -> float:
    return text_block(pdf, text, x, y, width, size=size, leading=size * 1.08, color=INK, font=FONT_BOLD)


def card(pdf: canvas.Canvas, x: float, y: float, w: float, h: float, accent=CYAN, fill=WHITE) -> None:
    pdf.setFillColor(fill)
    pdf.roundRect(x, y, w, h, 12, fill=1, stroke=0)
    pdf.setStrokeColor(LINE)
    pdf.setLineWidth(0.9)
    pdf.roundRect(x, y, w, h, 12, fill=0, stroke=1)
    pdf.setFillColor(accent)
    pdf.roundRect(x, y, 5, h, 2.5, fill=1, stroke=0)


def metric(pdf: canvas.Canvas, x: float, y: float, w: float, value: str, label: str, color=GREEN) -> None:
    pdf.setFillColor(color)
    pdf.setFont(FONT_BOLD, 19)
    pdf.drawString(x, y, value)
    text_block(pdf, label, x, y - 21, w, size=10.2, leading=12.5, color=MUTED, font=FONT)


def bullet(pdf: canvas.Canvas, text: str, x: float, y: float, width: float, color=CYAN, size: float = 12.5) -> float:
    pdf.setFillColor(color)
    pdf.circle(x + 4, y + 4, 3, fill=1, stroke=0)
    return text_block(pdf, text, x + 18, y + 9, width - 18, size=size, leading=size * 1.42, color=INK) - 8


def pill(pdf: canvas.Canvas, text: str, x: float, y: float, color=CYAN, fill=CYAN_SOFT) -> float:
    width = stringWidth(text.upper(), FONT_BOLD, 9.5) + 24
    pdf.setFillColor(fill)
    pdf.roundRect(x, y - 4, width, 23, 11.5, fill=1, stroke=0)
    pdf.setFillColor(color)
    pdf.setFont(FONT_BOLD, 9.5)
    pdf.drawString(x + 12, y + 2, text.upper())
    return width


def fit_image(pdf: canvas.Canvas, path: Path, x: float, y: float, w: float, h: float) -> None:
    image = ImageReader(str(path))
    iw, ih = image.getSize()
    scale = min(w / iw, h / ih)
    dw = iw * scale
    dh = ih * scale
    pdf.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh, preserveAspectRatio=True, mask="auto")


def slide_1(pdf: canvas.Canvas) -> None:
    background(pdf, 1, "The proposal")
    eyebrow(pdf, "Sentient Token and Economic Optimization for Agents", MARGIN, 442)
    title(pdf, "Make agent optimization\nfalsifiable.", MARGIN, 400, 560, 46)
    text_block(
        pdf,
        "An open operation-control and evidence layer that binds what an agent was asked to do, what actually ran, what it cost, and whether an external verifier accepted the result.",
        MARGIN,
        282,
        540,
        size=15.5,
        leading=22,
        color=MUTED,
    )

    card(pdf, 650, 244, 250, 166, BLUE, BLUE_SOFT)
    eyebrow(pdf, "Public-goods request", 678, 377, BLUE)
    pdf.setFillColor(INK)
    pdf.setFont(FONT_BOLD, 31)
    pdf.drawString(678, 335, "$150,000")
    text_block(pdf, "Nine months. Three go/no-go tranches. No equity. Open methods, code, evidence, and negative results.", 678, 300, 190, size=12.5, leading=17, color=MUTED)

    pdf.setFillColor(CYAN_SOFT)
    pdf.roundRect(MARGIN, 86, 840, 112, 12, fill=1, stroke=0)
    pdf.setStrokeColor(LINE)
    pdf.roundRect(MARGIN, 86, 840, 112, 12, fill=0, stroke=1)
    metric(pdf, 88, 150, 145, "809", "public GitHub stars", GREEN)
    metric(pdf, 292, 150, 155, "24", "outside-authored repositories", CYAN)
    metric(pdf, 510, 150, 145, "32 / 32", "official holdout verdicts", BLUE)
    metric(pdf, 714, 150, 150, "OPEN", "MIT code and public proof", CYAN)
    source(pdf, "Prepared 2026-08-03. Dated GitHub interest signal; not user or installation counts. Not submitted.")


def slide_2(pdf: canvas.Canvas) -> None:
    background(pdf, 2, "The missing seam")
    eyebrow(pdf, "Problem", MARGIN, 442)
    title(pdf, "The model call is not the economic unit.", MARGIN, 400, 820, 36)
    text_block(pdf, "Real cost and failure accumulate across the entire operation.", MARGIN, 348, 760, 15, 20, MUTED)

    y = 295
    y = bullet(pdf, "Decomposition, parallelism, retries, tools, context, recovery, and verification can overwhelm a cheap model choice.", MARGIN, y, 385)
    y = bullet(pdf, "A requested model can differ from the provider path that actually executes.", MARGIN, y - 8, 385, BLUE)
    y = bullet(pdf, "Unknown local, subscription, setup, or human cost is often collapsed into zero.", MARGIN, y - 8, 385, AMBER)
    bullet(pdf, "Model prose or stack status can be promoted to completion without an external artifact check.", MARGIN, y - 8, 385, RED)

    card(pdf, 470, 102, 430, 242, CYAN)
    stages = [
        ("01", "Declared plan", "Models, tools, topology, and limits"),
        ("02", "Observed execution", "Calls, attempts, artifacts, and cost lenses"),
        ("03", "External verdict", "Deterministic verifier outside the route"),
        ("04", "Signed evidence", "Offline-reconstructable receipt chain"),
    ]
    row_y = 306
    for number, heading, detail in stages:
        pdf.setFillColor(CYAN)
        pdf.setFont(FONT_BOLD, 10.5)
        pdf.drawString(500, row_y, number)
        pdf.setFillColor(INK)
        pdf.setFont(FONT_BOLD, 13.5)
        pdf.drawString(544, row_y, heading)
        pdf.setFillColor(MUTED)
        pdf.setFont(FONT, 11)
        pdf.drawString(544, row_y - 19, detail)
        row_y -= 52
    pill(pdf, "Unknown stays unknown", 500, 78, AMBER, AMBER_SOFT)
    source(pdf, "Thesis: optimize the model-externally verified operation, not an isolated model call.")


def slide_3(pdf: canvas.Canvas) -> None:
    background(pdf, 3, "What exists now")
    eyebrow(pdf, "Working substrate", MARGIN, 442)
    title(pdf, "Built before the grant.", MARGIN, 400, 430, 39)
    text_block(pdf, "Citadel starts with one command, then exposes stronger control only when the operation needs it.", MARGIN, 342, 390, 14.5, 20, MUTED)

    items = [
        ("/do", "Beginner path", "Natural-language routing, verification, and a durable next action."),
        ("PLAN", "Portable contract", "Models, tools, topology, retries, privacy, time, cost, and stop rules."),
        ("RUN", "Runtime coverage", "Claude Code, Codex, Ollama, and a pinned Sentient ROMA binding."),
        ("PROOF", "Evidence plane", "External artifact verdicts, failure preservation, signed receipts, and offline replay."),
    ]
    item_y = 278
    for code, heading, detail in items:
        pdf.setFillColor(CYAN if code in ("/do", "PROOF") else BLUE)
        pdf.setFont(FONT_BOLD, 10.5)
        pdf.drawString(MARGIN, item_y, code)
        pdf.setFillColor(INK)
        pdf.setFont(FONT_BOLD, 13.5)
        pdf.drawString(132, item_y, heading)
        text_block(pdf, detail, 132, item_y - 20, 300, 11.2, 14.5, MUTED)
        item_y -= 57

    card(pdf, 482, 92, 418, 312, BLUE, BLUE_SOFT)
    fit_image(pdf, ASSETS / "01-product-entry.png", 501, 111, 380, 274)
    source(pdf, "Product: sethgammon.github.io/Citadel/  |  Repository: github.com/SethGammon/Citadel")


def slide_4(pdf: canvas.Canvas) -> None:
    background(pdf, 4, "Latest public holdout")
    eyebrow(pdf, "Outside-authored repository diagnostic", MARGIN, 442, AMBER)
    title(pdf, "The evidence worked. The baseline did not.", MARGIN, 400, 840, 35)
    text_block(pdf, "Twenty-four distinct repositories. Routes sealed before evaluation. Every official verdict published, including the result that weakens the proposal.", MARGIN, 350, 820, 14, 19, MUTED)

    metric(pdf, 72, 300, 155, "3 / 16", "sealed controller verified", AMBER)
    metric(pdf, 286, 300, 155, "2 / 16", "direct Claude verified", RED)
    metric(pdf, 500, 300, 155, "1 / 16", "local Qwen verified", RED)
    metric(pdf, 714, 300, 165, "-1.26%", "comparison cost; not cash", AMBER)

    card(pdf, MARGIN, 82, 408, 148, CYAN, CYAN_SOFT)
    eyebrow(pdf, "What completed", 88, 203)
    y = 173
    y = bullet(pdf, "Eight calibration and sixteen untouched evaluation tasks across four strata.", 86, y, 350, CYAN, 11.5)
    y = bullet(pdf, "Sixteen signed routes merged before model calls; 32/32 official verdicts.", 86, y - 4, 350, BLUE, 11.5)
    bullet(pdf, "No task replacement, optional stopping, or positive-only publication.", 86, y - 4, 350, GREEN, 11.5)

    card(pdf, 492, 82, 408, 148, RED, RED_SOFT)
    eyebrow(pdf, "Why this is not a win", 520, 203, RED)
    text_block(pdf, "Direct Claude passed only 12.5% overall and 0% in three strata. Matching or slightly exceeding that baseline does not establish useful quality preservation or general savings.", 520, 174, 345, 11.7, 15.5, INK, FONT, max_lines=4)
    pill(pdf, "Baseline validity failed", 520, 101, RED, WHITE)
    source(pdf, "Evidence: benchmarks/public-holdout-pilot/REPORT.md  |  Verify: node scripts/public-holdout-pilot.js verify")


def evidence_row(pdf: canvas.Canvas, y: float, tag: str, verdict: str, summary: str, accent, fill) -> None:
    pdf.setFillColor(fill)
    pdf.roundRect(MARGIN, y, 840, 76, 10, fill=1, stroke=0)
    pdf.setStrokeColor(LINE)
    pdf.roundRect(MARGIN, y, 840, 76, 10, fill=0, stroke=1)
    pdf.setFillColor(accent)
    pdf.rect(MARGIN, y, 6, 76, fill=1, stroke=0)
    pdf.setFillColor(accent)
    pdf.setFont(FONT_BOLD, 11)
    pdf.drawString(84, y + 46, tag.upper())
    pdf.setFillColor(INK)
    pdf.setFont(FONT_BOLD, 14)
    pdf.drawRightString(872, y + 44, verdict)
    text_block(pdf, summary, 84, y + 24, 680, 11.8, 15, MUTED, FONT, max_lines=2)


def slide_5(pdf: canvas.Canvas) -> None:
    background(pdf, 5, "Delivery record")
    eyebrow(pdf, "Built before funding", MARGIN, 442, GREEN)
    title(pdf, "One maintainer already shipped the substrate.", MARGIN, 400, 840, 37)
    text_block(pdf, "Citadel is a public system with continuing repository pull, not a grant-funded mockup.", MARGIN, 348, 800, 14, 19, MUTED)

    metric(pdf, 72, 300, 155, "136", "days public", GREEN)
    metric(pdf, 270, 300, 175, "518 / 542", "main commits attributed to Seth", CYAN)
    metric(pdf, 500, 300, 155, "809 / 80", "stars / forks", BLUE)
    metric(pdf, 714, 300, 175, "524", "unique cloners in 14 days", VIOLET)

    card(pdf, MARGIN, 82, 408, 148, CYAN, CYAN_SOFT)
    eyebrow(pdf, "Working substrate", 88, 203)
    y = 173
    y = bullet(pdf, "Claude Code, Codex, Ollama, and a pinned Sentient ROMA binding.", 86, y, 350, CYAN, 11.5)
    y = bullet(pdf, "49 workflows and 35 hooks across 29 lifecycle events.", 86, y - 4, 350, BLUE, 11.5)
    bullet(pdf, "Windows, Linux, and macOS verification on every release path.", 86, y - 4, 350, GREEN, 11.5)

    card(pdf, 492, 82, 408, 148, AMBER, AMBER_SOFT)
    eyebrow(pdf, "Claim discipline", 520, 203, AMBER)
    text_block(pdf, "A synthetic support envelope passed 12/12 at 38.7% lower comparison cost. The outside-authored follow-up then invalidated its strong-baseline claim. Both remain public.", 520, 174, 345, 11.7, 15.5, INK, FONT, max_lines=4)
    pill(pdf, "Funding scales a working base", 520, 101, GREEN, WHITE)
    source(pdf, "GitHub observed 2026-08-03. Clone window: 2026-07-18 to 2026-07-31. Clones are not installs, users, or adoption.")


def slide_6(pdf: canvas.Canvas) -> None:
    background(pdf, 6, "Funded work")
    eyebrow(pdf, "Nine-month research and engineering program", MARGIN, 442)
    title(pdf, "Funding buys a valid operation baseline.", MARGIN, 400, 790, 38)
    text_block(pdf, "Repair the retrieval and edit substrate exposed by outside-authored work, then rerun the economic question.", MARGIN, 348, 820, 14, 19, MUTED)

    milestones = [
        ("01", "Valid workload and baseline", "Retrieval/edit contract, 60+ operations, complete cost boundary", "$30k", CYAN, CYAN_SOFT),
        ("02", "Adapter SDK", "Sentient ROMA plus two additional open stacks", "$28k", BLUE, BLUE_SOFT),
        ("03", "Expected-value controller", "Price verification, escalation, recovery, and failure", "$35k", VIOLET, VIOLET_SOFT),
        ("04", "Prospective evaluation", "Frozen multi-stack policy and statistical contract", "$32k", AMBER, AMBER_SOFT),
        ("05", "Public proof and release", "Hosted reconstruction, /do onboarding, support window, and maintenance", "$25k", GREEN, GREEN_SOFT),
    ]
    row_y = 294
    for number, heading, detail, amount, color, fill in milestones:
        pdf.setFillColor(fill)
        pdf.roundRect(MARGIN, row_y, 840, 43, 8, fill=1, stroke=0)
        pdf.setFillColor(color)
        pdf.setFont(FONT_BOLD, 10.5)
        pdf.drawString(82, row_y + 15, number)
        pdf.setFillColor(INK)
        pdf.setFont(FONT_BOLD, 13.5)
        pdf.drawString(128, row_y + 15, heading)
        pdf.setFillColor(MUTED)
        pdf.setFont(FONT, 11.5)
        pdf.drawString(350, row_y + 15, detail)
        pdf.setFillColor(color)
        pdf.setFont(FONT_BOLD, 14)
        pdf.drawRightString(874, row_y + 14, amount)
        row_y -= 48
    source(pdf, "Canonical milestones and acceptance gates: docs/grants/MILESTONES_AND_BUDGET.md")


def slide_7(pdf: canvas.Canvas) -> None:
    background(pdf, 7, "Budget and gates")
    eyebrow(pdf, "No-go rules are part of the product", MARGIN, 442, GREEN)
    title(pdf, "Capped spend. Hard outcome gates.", MARGIN, 400, 800, 38)

    card(pdf, MARGIN, 94, 410, 260, CYAN)
    eyebrow(pdf, "Cost basis", 88, 324)
    budget = [
        ("Maintainer labor", "$99,000"),
        ("Evaluation compute and tools", "$27,000"),
        ("Hosted verification and retention", "$7,000"),
        ("Reference hardware and measurement", "$7,000"),
        ("Compatibility and accessibility costs", "$2,000"),
        ("Bounded contingency", "$8,000"),
    ]
    row_y = 292
    for name, amount in budget:
        pdf.setFillColor(MUTED)
        pdf.setFont(FONT, 12.2)
        pdf.drawString(88, row_y, name)
        pdf.setFillColor(INK)
        pdf.setFont(FONT_BOLD, 12.2)
        pdf.drawRightString(438, row_y, amount)
        row_y -= 28
    pdf.setStrokeColor(LINE)
    pdf.line(88, 121, 438, 121)
    pdf.setFillColor(GREEN)
    pdf.setFont(FONT_BOLD, 14)
    pdf.drawString(88, 101, "Total")
    pdf.setFont(FONT_BOLD, 18)
    pdf.drawRightString(438, 101, "$150,000")

    card(pdf, 500, 94, 400, 260, GREEN, GREEN_SOFT)
    eyebrow(pdf, "Primary prospective gate", 530, 324, GREEN)
    metric(pdf, 530, 278, 145, ">= 80%", "absolute verified completion", GREEN)
    metric(pdf, 724, 278, 145, ">= 95%", "of valid frontier rate", GREEN)
    metric(pdf, 530, 190, 145, ">= 30%", "lower measured end-to-end cost", GREEN)
    metric(pdf, 724, 190, 145, "ZERO", "false passes and integrity failures", GREEN)
    pill(pdf, "Unknown cost cannot count as savings", 530, 112, AMBER, AMBER_SOFT)
    source(pdf, "Tranches: $45k / $60k / $45k. Compute credits reduce cash draw dollar-for-dollar; unused funds remain unspent.")


def slide_8(pdf: canvas.Canvas) -> None:
    background(pdf, 8, "Why Sentient")
    eyebrow(pdf, "Direct fit with a named request for products", MARGIN, 442)
    title(pdf, "An open optimizer that can prove when it is wrong.", MARGIN, 400, 830, 36)

    card(pdf, MARGIN, 174, 410, 170, CYAN, CYAN_SOFT)
    eyebrow(pdf, "Why fund Citadel", 88, 313)
    y = 278
    y = bullet(pdf, "Directly targets Sentient's Token and Economic Optimization request.", 86, y, 350, CYAN, 12.2)
    y = bullet(pdf, "Already binds a pinned Sentient ROMA stack without replacing its planner.", 86, y - 5, 350, BLUE, 12.2)
    bullet(pdf, "A bounded synthetic pass plus a failed outside baseline identify exactly what funding must repair.", 86, y - 5, 350, GREEN, 12.2)

    card(pdf, 490, 174, 410, 170, VIOLET, VIOLET_SOFT)
    eyebrow(pdf, "What stays public", 518, 313, VIOLET)
    y = 278
    y = bullet(pdf, "MIT code, adapters, contracts, methods, verifiers, cells, and reports.", 516, y, 350, VIOLET, 12.2)
    y = bullet(pdf, "No mandatory Citadel account, token, hosted evidence endpoint, or telemetry resale.", 516, y - 5, 350, CYAN, 12.2)
    bullet(pdf, "Users keep project state, operations, receipts, and the right to run locally.", 516, y - 5, 350, GREEN, 12.2)

    pdf.setFillColor(NAVY)
    pdf.roundRect(MARGIN, 78, 840, 78, 12, fill=1, stroke=0)
    pdf.setFillColor(WHITE)
    pdf.setFont(FONT_BOLD, 16.5)
    pdf.drawString(88, 122, "Seth Gammon - solo builder and maintainer")
    pdf.setFillColor(HexColor("#D8E5EA"))
    pdf.setFont(FONT, 10.3)
    pdf.drawString(88, 99, "seth@softwareshaped.com  |  softwareshaped.com")
    pdf.setFont(FONT, 8.8)
    pdf.drawString(88, 84, "Evidence: github.com/SethGammon/Citadel/blob/main/docs/grants/EVALUATOR_START_HERE.md")
    pdf.setFillColor(HexColor("#83E0E8"))
    pdf.setFont(FONT_BOLD, 11)
    pdf.drawRightString(872, 121, "OPEN. VERIFIABLE. FALSIFIABLE.")
    source(pdf, "Program: sentient.foundation/grants  |  Request: sentient.foundation/product-requests  |  Not submitted.")


def render() -> Path:
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    pdf = canvas.Canvas(str(OUTPUT), pagesize=(PAGE_W, PAGE_H), pageCompression=1)
    pdf.setTitle("Citadel - Sentient Open Source AGI Grant Support Packet")
    pdf.setAuthor("Seth Gammon")
    pdf.setSubject("Verifiable token and economic optimization for open agent stacks")

    slides = [slide_1, slide_2, slide_3, slide_4, slide_5, slide_6, slide_7, slide_8]
    for index, slide in enumerate(slides):
        slide(pdf)
        if index < len(slides) - 1:
            pdf.showPage()
    pdf.save()
    return OUTPUT


if __name__ == "__main__":
    print(render())
