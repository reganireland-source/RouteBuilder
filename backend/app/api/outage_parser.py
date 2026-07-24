# ─────────────────────────────────────────────────────────────────────────────
# outage_parser.py — AI-assisted bulk outage entry ("Outage Parser").
#
# Route prefix: /api/outages/parse  (registered under "/api" in main.py).
#
# WHAT IT DOES
# A network engineer pastes / uploads their current outage table (as text, a
# screenshot image, or a CSV/XLSX file). This endpoint sends that content to a
# vision-capable LLM (Sonnet) together with a catalogue of every real segment
# in the system, and the model:
#   1. EXTRACTS each outage row (fault ref, dates, description), and
#   2. MAPS the human cable/segment name (e.g. "C2C Segment 3C (Korea - Japan)")
#      to a real segment_id in this database (e.g. "C2C-S3C") using geography —
#      the endpoint node names and countries carry more signal than the code.
#
# It returns PROPOSED outages with a per-row confidence; it never writes data.
# The frontend shows them in an editable review table; the actual save is the
# separate destructive PUT /api/outages (replace-all).
#
# Confidence per row:
#   "high" — a single clear segment match.
#   "low"  — a best guess and/or several plausible candidates (amber in the UI).
#   "none" — no reasonable match; the row is flagged red and excluded from save
#            until the engineer picks a segment or deletes it.
#
# Endpoint:
#   POST /api/outages/parse  (admin-only; multipart form: `text` and/or `file`)
# ─────────────────────────────────────────────────────────────────────────────
import base64
import io
import json
import logging

from fastapi import APIRouter, File, Form, HTTPException, UploadFile

from ..data_loader import load_nodes, load_segments, load_systems, load_outages

router = APIRouter()
logger = logging.getLogger("routebuilder.outage_parser")

# Anthropic accepts these image media types for vision.
_IMAGE_TYPES = {"image/png", "image/jpeg", "image/gif", "image/webp"}
# Combined cap across all uploaded files (a large table may be several
# screenshots). Kept in step with the body-size middleware in main.py.
_MAX_UPLOAD_TOTAL = 25 * 1024 * 1024  # 25 MB


def _build_segment_catalogue() -> tuple[list[dict], set[str]]:
    """Return (catalogue, valid_ids).

    The catalogue is a compact list the LLM uses to map free-text cable names to
    real segment ids. Each entry carries the segment id, its parent system name,
    and both endpoint node names + countries — the geography the model matches
    on. `valid_ids` is used afterwards to reject any id the model invents.
    """
    nodes = {n.id: n for n in load_nodes()}
    systems = {s.id: s.name for s in load_systems()}
    catalogue = []
    for seg in load_segments():
        a = nodes.get(seg.start_node_id)
        b = nodes.get(seg.end_node_id)
        catalogue.append({
            "segment_id": seg.id,
            "system": systems.get(seg.system_id, seg.system_id),
            "from": f"{a.name} ({a.country})" if a else seg.start_node_id,
            "to":   f"{b.name} ({b.country})" if b else seg.end_node_id,
        })
    return catalogue, {s.id for s in load_segments()}


_SYSTEM_PROMPT = """You are an expert submarine-cable network operations assistant.

You will be given (a) a table of CURRENT CABLE OUTAGES in whatever messy form the \
user provides — pasted text, a screenshot image, or spreadsheet rows — and (b) a \
CATALOGUE of every real cable segment in our system as JSON.

Your job: extract every distinct outage row and map it to the correct segment_id \
from the catalogue, then return STRICT JSON.

MAPPING RULES (most important):
- Match on GEOGRAPHY first. The endpoints in the source (e.g. "(Hongkong - \
Taiwan)") and the cable/system name are stronger signals than the segment code. \
Compare against each catalogue entry's system, "from" and "to" (which include \
country codes).
- Only ever return a segment_id that appears VERBATIM in the catalogue. Never \
invent one.
- confidence: "high" when exactly one catalogue segment clearly fits; "low" when \
you are guessing or 2-3 segments plausibly fit (put the alternates in \
"candidates"); "none" when nothing in the catalogue reasonably matches (leave \
segment_id as "").

FIELD RULES:
- fault_id: the reference number (e.g. "SNI3976365"). Copy it verbatim even if it \
looks malformed. If truly absent, use "".
- fault_date: ISO "YYYY-MM-DD". Parse ordinal/'12th Oct 2025' style dates. If a \
cell has two dates, use the first and mention the second in the description.
- repair_start: ISO "YYYY-MM-DD", or null for "TBD"/"TBC"/blank.
- estimated_repair_date: ISO "YYYY-MM-DD"; use the string "TBC" for \
"TBD"/"TBC"/unknown; null only if entirely absent.
- description: the full status / critical-path text, kept faithful (you may tidy \
whitespace). Preserve fault detail, km positions, repeater ids, and notes.
- Skip blank spacer rows and header rows.

OUTPUT — return ONLY this JSON, no prose, no code fences:
{
  "outages": [
    {
      "raw_cable": "<cable name as written>",
      "raw_segment": "<segment text as written>",
      "segment_id": "<catalogue id or ''>",
      "confidence": "high" | "low" | "none",
      "candidates": ["<other plausible ids>"],
      "fault_id": "<ref or ''>",
      "fault_date": "YYYY-MM-DD",
      "repair_start": "YYYY-MM-DD" | null,
      "estimated_repair_date": "YYYY-MM-DD" | "TBC" | null,
      "description": "<full text>"
    }
  ]
}"""


def _extract_file_block(file_bytes: bytes, content_type: str, filename: str) -> dict:
    """Turn an uploaded file into one LLM content block.

    - Images become a base64 image block (read by the vision model).
    - XLSX is flattened to tab-separated text via openpyxl.
    - CSV / TXT / anything else is decoded as UTF-8 text.
    """
    name = (filename or "").lower()
    ctype = (content_type or "").lower()

    if ctype in _IMAGE_TYPES or name.endswith((".png", ".jpg", ".jpeg", ".gif", ".webp")):
        media = ctype if ctype in _IMAGE_TYPES else "image/png"
        return {
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": media,
                "data": base64.b64encode(file_bytes).decode("ascii"),
            },
        }

    if name.endswith((".xlsx", ".xlsm")) or "spreadsheet" in ctype:
        try:
            import openpyxl
        except ImportError:
            raise HTTPException(status_code=500, detail="XLSX support unavailable (openpyxl not installed)")
        wb = openpyxl.load_workbook(io.BytesIO(file_bytes), read_only=True, data_only=True)
        lines = []
        for ws in wb.worksheets:
            for row in ws.iter_rows(values_only=True):
                cells = ["" if c is None else str(c) for c in row]
                if any(cells):
                    lines.append("\t".join(cells))
        return {"type": "text", "text": "Spreadsheet rows (tab-separated):\n" + "\n".join(lines)}

    # CSV / TXT / fallback
    try:
        decoded = file_bytes.decode("utf-8", errors="replace")
    except Exception:
        raise HTTPException(status_code=400, detail="Could not read the uploaded file as text.")
    return {"type": "text", "text": decoded}


@router.post("/outages/parse")
async def parse_outages(text: str = Form(None), files: list[UploadFile] = File(None)):
    """POST /api/outages/parse — parse a pasted/uploaded outage table into
    proposed SegmentOutage rows (does NOT save).

    Params (multipart form):
      - text (optional): a pasted/typed outage table.
      - files (optional, repeatable): one or more screenshot images (e.g. pasted
        from the clipboard — a large table can be several screenshots), and/or a
        CSV/XLSX file. All images are read together in one vision call.
      At least one of text or files must be provided.
    Response:
      {
        "proposals": [ { ...outage fields..., "matched": bool,
                         "confidence": "high|low|none", "candidates": [...] } ],
        "existing_count": <how many outages are currently stored>,
        "model": "<model id used>"
      }

    Auth: admin-only. This is a POST, so the admin_write_guard middleware in
    app/main.py requires the x-admin-token header when ADMIN_KEY is set.
    """
    from ..nlp.provider import get_provider

    # ── Assemble the user content blocks (files first, then pasted text) ─────
    # Each image becomes its own block; the vision model reads them in order, so
    # multiple screenshots of one long table are stitched together naturally.
    blocks: list = []
    total = 0
    for f in (files or []):
        raw = await f.read()
        total += len(raw)
        if total > _MAX_UPLOAD_TOTAL:
            raise HTTPException(status_code=413, detail="Uploaded files too large (max 25 MB total).")
        if raw:
            blocks.append(_extract_file_block(raw, f.content_type or "", f.filename or ""))
    if text and text.strip():
        blocks.append({"type": "text", "text": text.strip()})

    if not blocks:
        raise HTTPException(status_code=400, detail="Provide pasted text or upload/paste a file to parse.")

    # ── Build the segment catalogue and prepend the task instruction ─────────
    catalogue, valid_ids = _build_segment_catalogue()
    blocks.insert(0, {
        "type": "text",
        "text": "SEGMENT CATALOGUE (map to these segment_id values only):\n"
                + json.dumps(catalogue, separators=(",", ":"))
                + "\n\nThe outage table follows below.",
    })

    # ── Call the vision LLM ──────────────────────────────────────────────────
    try:
        provider = get_provider()
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))

    try:
        # Generous budget: Sonnet may spend part of it on a thinking block before
        # the JSON, and a large table can be many rows — avoid truncation.
        result = provider.complete_json_multimodal(_SYSTEM_PROMPT, blocks, max_tokens=16000)
    except NotImplementedError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        logger.warning("Outage parse failed: %s", e)
        raise HTTPException(status_code=502, detail=f"AI parsing failed: {str(e)[:200]}")

    # ── Validate + normalise the model output ────────────────────────────────
    raw_rows = result.get("outages", []) if isinstance(result, dict) else []
    proposals = []
    for i, row in enumerate(raw_rows):
        if not isinstance(row, dict):
            continue
        seg_id = (row.get("segment_id") or "").strip()
        # Reject any id the model invented; demote to an unmatched row.
        matched = seg_id in valid_ids
        confidence = row.get("confidence", "none")
        if not matched:
            seg_id = ""
            confidence = "none"
        # Keep only candidate ids that actually exist.
        candidates = [c for c in (row.get("candidates") or []) if c in valid_ids]
        fault_id = (row.get("fault_id") or "").strip() or f"TMP-{i + 1:03d}"
        proposals.append({
            "segment_id": seg_id,
            "fault_id": fault_id,
            "fault_date": (row.get("fault_date") or "").strip(),
            "repair_start": row.get("repair_start") or None,
            "estimated_repair_date": row.get("estimated_repair_date") or None,
            "description": (row.get("description") or "").strip(),
            # Review-only metadata (not part of the SegmentOutage model):
            "matched": matched,
            "confidence": confidence,
            "candidates": candidates,
            "raw_cable": (row.get("raw_cable") or "").strip(),
            "raw_segment": (row.get("raw_segment") or "").strip(),
        })

    return {
        "proposals": proposals,
        "existing_count": len(load_outages()),
        "model": getattr(provider, "_VISION_MODEL", "unknown"),
    }
