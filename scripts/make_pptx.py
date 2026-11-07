"""Builds presentation/trust-challenge.pptx from out/report.json (run `npm run challenge` first)."""
import json
from pathlib import Path

from pptx import Presentation
from pptx.dml.color import RGBColor
from pptx.enum.shapes import MSO_SHAPE
from pptx.util import Emu, Inches, Pt

ROOT = Path(__file__).resolve().parent.parent
R = json.loads((ROOT / "out" / "report.json").read_text())

BG, PANEL, LINE = RGBColor(0x0E, 0x11, 0x17), RGBColor(0x17, 0x1B, 0x24), RGBColor(0x2A, 0x31, 0x40)
TEXT, MUTED, RED = RGBColor(0xE8, 0xEC, 0xF3), RGBColor(0x8B, 0x95, 0xA7), RGBColor(0xFF, 0x2D, 0x3A)
GREEN, AMBER = RGBColor(0x2F, 0xD2, 0x7E), RGBColor(0xFF, 0xB0, 0x20)

prs = Presentation()
prs.slide_width, prs.slide_height = Inches(13.333), Inches(7.5)


def text(slide, x, y, w, h, content, size=20, color=TEXT, bold=False, font=None):
    box = slide.shapes.add_textbox(Inches(x), Inches(y), Inches(w), Inches(h))
    tf = box.text_frame
    tf.word_wrap = True
    for i, line in enumerate(content if isinstance(content, list) else [content]):
        p = tf.paragraphs[0] if i == 0 else tf.add_paragraph()
        run = p.add_run()
        run.text = line
        run.font.size, run.font.bold, run.font.color.rgb = Pt(size), bold, color
        if font:
            run.font.name = font
        p.space_after = Pt(6)
    return box


def card(slide, x, y, w, h, title, body, accent=LINE):
    shape = slide.shapes.add_shape(MSO_SHAPE.ROUNDED_RECTANGLE, Inches(x), Inches(y), Inches(w), Inches(h))
    shape.adjustments[0] = 0.06
    shape.fill.solid()
    shape.fill.fore_color.rgb = PANEL
    shape.line.color.rgb = accent
    shape.shadow.inherit = False
    text(slide, x + 0.15, y + 0.1, w - 0.3, 0.5, title, 18, TEXT, True)
    text(slide, x + 0.15, y + 0.65, w - 0.3, h - 0.7, body, 14, MUTED)


def new_slide(kicker=None, title=None, notes=None):
    s = prs.slides.add_slide(prs.slide_layouts[6])
    s.background.fill.solid()
    s.background.fill.fore_color.rgb = BG
    if kicker:
        text(s, 0.7, 0.45, 10, 0.4, kicker.upper(), 13, RED, True)
    if title:
        text(s, 0.7, 0.8, 12, 0.9, title, 34, TEXT, True)
    if notes:
        s.notes_slide.notes_text_frame.text = notes
    return s


def table(slide, headers, rows, x, y, w, col_w, size=13):
    shape = slide.shapes.add_table(len(rows) + 1, len(headers), Inches(x), Inches(y), Inches(w), Inches(0.4 * (len(rows) + 1)))
    tbl = shape.table
    for i, cw in enumerate(col_w):
        tbl.columns[i].width = Inches(cw)
    for r, row in enumerate([headers] + rows):
        for c, val in enumerate(row):
            cell = tbl.cell(r, c)
            cell.fill.solid()
            cell.fill.fore_color.rgb = LINE if r == 0 else PANEL
            para = cell.text_frame.paragraphs[0]
            para.text = ""
            run = para.add_run()
            run.text = str(val)
            run.font.size = Pt(size)
            run.font.bold = r == 0
            run.font.color.rgb = TEXT
            if r and isinstance(val, str) and val in ("PASS", "caught", "enriched"):
                run.font.color.rgb = GREEN
            elif r and isinstance(val, str) and val in ("FAIL", "MISSED", "not_found", "rejected", "error", "blocked"):
                run.font.color.rgb = RED
            elif r and isinstance(val, str) and val in ("N/A", "needs_review", "skipped"):
                run.font.color.rgb = AMBER


mode = "LIVE API" if R["mode"] == "live" else "MOCK DATA (offline fixtures)"

# 1. Title
s = new_slide("Le Wagon · Data & AI challenge")
text(s, 0.7, 2.0, 12, 1.8, ["Can AI process data", "without compromising trust?"], 54, TEXT, True)
text(s, 0.7, 4.3, 12, 0.6, "Stress-testing a company-enrichment agent on privacy and data integrity", 22, MUTED)
text(s, 0.7, 5.0, 12, 0.5, f"ScortonJS (trust scoring) × Context.dev (web & company data)   ·   results: {mode}", 16, MUTED)

# 2. Setup
s = new_slide("The setup", "An enrichment agent: a domain in, a company profile out")
card(s, 0.7, 2.2, 5.9, 2.4, "Outbound trust → privacy", "Customer records hold names, emails, phones, bank details. What actually leaves our systems when an agent calls a third-party API or an LLM?")
card(s, 6.8, 2.2, 5.9, 2.4, "Inbound trust → integrity", "What comes back is untrusted: wrong, outdated, invented, or carrying hidden instructions. Do we write it into the CRM as truth?")
text(s, 0.7, 5.2, 12, 0.6, "Question for tonight: can we prove the answer, not just claim it?", 20, MUTED)

# 3. Threat model
s = new_slide("Threat model", "Four ways it goes wrong")
for i, (t, b) in enumerate([
    ("1. PII leakage", "Full records pasted into prompts or API calls."),
    ("2. Bad data", "Hallucinated or mismatched profiles for the wrong company."),
    ("3. Injection", "Instructions hidden in notes or scraped pages: “ignore previous instructions…”"),
    ("4. No evidence", "Nobody can show what was sent, received or changed."),
]):
    card(s, 0.7 + i * 3.05, 2.3, 2.9, 2.6, t, b)

# 4. Architecture
s = new_slide("Architecture", "Trust is a pipeline, not a prompt")
steps = [
    ("1. Minimise", "Keep only the company domain. Personal emails: skipped.", RGBColor(0x2F, 0x6B, 0x4A)),
    ("2. Egress guard", "Inspect and log every outbound byte. Block PII.", RGBColor(0x2F, 0x6B, 0x4A)),
    ("3. ScortonJS", "Score the target domain before trusting its data.", RGBColor(0x8A, 0x6A, 0x1A)),
    ("4. Context.dev", "Brand profile + sourced research answer.", RGBColor(0x3A, 0x5A, 0x99)),
    ("5. Validate", "Domain match, injection scan, cross-check, provenance.", RGBColor(0x8A, 0x6A, 0x1A)),
    ("6. Audit", "Hash-chained, PII-free log.", RGBColor(0x2F, 0x6B, 0x4A)),
]
for i, (t, b, c) in enumerate(steps):
    card(s, 0.5 + i * 2.1, 2.5, 1.95, 2.8, t, b, c)
text(s, 0.7, 5.8, 12, 0.5, "green = runs locally · blue = external API · amber = verification", 14, MUTED)

# 5. Tools
s = new_slide("The tools", "Who does what")
card(s, 0.7, 2.2, 3.9, 3.0, "Context.dev", "Source of web and company data: Brand profile by domain, and Answers (researched JSON with source URLs). Optional zero-data-retention per request.")
card(s, 4.75, 2.2, 3.9, 3.0, "ScortonJS", "Open-source trust / cyber-risk scoring. We call its score on each target domain and quarantine low-trust sources.")
card(s, 8.8, 2.2, 3.9, 3.0, "Our guard code", "Minimisation, egress inspection, validation and the audit chain. Small, readable, and testable without any AI.")

# 6. Tests
s = new_slide("The challenge", f"{R['summary']['pass']} passed · {R['summary']['fail']} failed · {R['summary']['na']} n/a")
rows = [[t["id"], t["title"], t["status"].upper(), t["detail"][:70]] for t in R["tests"]]
table(s, ["#", "Test", "Result", "Detail"], rows, 0.5, 1.7, 12.3, [0.6, 4.8, 1.0, 5.9], 12)

# 7. Privacy proof
c2 = next(r for r in R["records"] if r["input"]["id"] == "c2")
sent = [o for o in R["outbound"] if "brand" in o["url"] or "answers" in o["url"]][:2]
s = new_slide("Privacy proof", "What we held vs. what left")
text(s, 0.7, 1.8, 6, 0.4, "CUSTOMER RECORD (STAYS LOCAL)", 12, MUTED, True)
text(s, 0.7, 2.2, 5.9, 3.8, json.dumps(c2["input"], indent=2), 12, TEXT, font="Menlo")
text(s, 6.9, 1.8, 6, 0.4, "REQUESTS SENT TO CONTEXT.DEV", 12, MUTED, True)
text(s, 6.9, 2.2, 5.9, 3.8, "\n\n".join(f"POST {o['url']}\n{json.dumps(o['body'], indent=2)}" for o in sent), 11, TEXT, font="Menlo")
naive = (R["blocked"]["naiveControl"] or {}).get("types", [])
text(s, 0.7, 6.5, 12, 0.6, f"{len(R['outbound'])} outbound requests inspected. A naive agent sending the full record was blocked: {', '.join(naive) or 'n/a'}.", 15, MUTED)

# 8. Integrity
s = new_slide("Integrity", "What the agent is allowed to believe")
rows = []
for rec in R["records"]:
    res = rec["result"]
    fields = ", ".join(f"{k}{' ✓✓' if v['confidence'] == 'high' else ''}" for k, v in res["fields"].items()) or "none"
    flags = ", ".join(i["code"] for i in res["issues"]) or res.get("reason") or "none"
    trust = res["trust"]
    trust_txt = "n/a" if not trust else (str(trust["score"]) if trust.get("score") is not None else trust["status"])
    rows.append([f"{rec['input']['company']} ({rec['input']['id']})", res["status"], fields, flags, trust_txt])
table(s, ["Input", "Status", "Accepted fields", "Flags", "Scorton"], rows, 0.5, 1.8, 12.3, [2.4, 1.6, 4.4, 2.6, 1.3], 13)

# 9. Fault injection
s = new_slide("Fault injection", "We poison the provider on purpose")
rows = [[f["name"], f["description"], "caught" if f["caught"] else "MISSED"] for f in R["faults"]]
table(s, ["Attack", "Description", "Outcome"], rows, 0.5, 1.8, 12.3, [3.2, 7.2, 1.9], 14)

# 10. Audit
t = R["audit"]["tamper"]
s = new_slide("Evidence", "Tamper-evident audit trail")
text(s, 0.7, 1.8, 12, 3.4, [f"Chain valid: {R['audit']['valid']}  ({len(R['audit']['entries'])} entries, each hashed with the previous one)",
     f"Editing entry #{t['editedIndex']} is detected at #{t['editBrokenAt']}.",
     f"Deleting it is detected at #{t['deleteBrokenAt']}.",
     "The log stores pseudonyms and hashes, never raw personal data."], 20, TEXT)
last = R["audit"]["entries"][:6]
text(s, 0.7, 4.6, 12, 2, [f"#{e['seq']}  {e['event']:<18} {e['hash'][:16]}…" for e in last], 13, MUTED, font="Menlo")

# 11. Limits
s = new_slide("Honest limits", "What this does not solve")
text(s, 0.7, 1.9, 12, 4.5, [
    "• Context.dev ZDR needs an enterprise entitlement; Brand records and caches can still persist on their side.",
    "• Contact details and addresses from any provider are claims to verify, not facts.",
    "• ScortonJS scores a domain's security posture; it does not prove a data field is true.",
    "• Heuristic injection detection is a tripwire, not a guarantee.",
    "• Fault injection runs on recorded responses; live runs prove the happy path against the real API.",
], 20, TEXT)

# 12. Takeaways
s = new_slide("Takeaways", "Yes, if trust is engineered")
card(s, 0.7, 2.2, 3.9, 2.4, "Send less", "Minimise before anything leaves. Guard the boundary, not the prompt.")
card(s, 4.75, 2.2, 3.9, 2.4, "Believe less", "Every inbound field needs a source, a cross-check and a reason to be accepted.")
card(s, 8.8, 2.2, 3.9, 2.4, "Prove more", "Tests and a tamper-evident log turn “trust us” into evidence.")
text(s, 0.7, 5.2, 12, 0.5, "Try it: npm run challenge · npm run challenge:live        Questions?", 18, MUTED)

out = ROOT / "presentation" / "trust-challenge.pptx"
prs.save(out)
print(f"wrote {out}")
