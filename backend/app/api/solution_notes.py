# ─────────────────────────────────────────────────────────────────────────────
# solution_notes.py — Engineer annotations on nodes/segments, plus their
# categories.
#
# Route prefix: none of its own — this router has no prefix, and main.py mounts
# it under "/api", so the paths are /api/solution-notes... and
# /api/note-categories...
#
# Domain:
#   - A "solution note" is a free-form annotation an engineer attaches to a node
#     or segment while designing a solution (e.g. "prefer this CLS for landing").
#     Each SolutionNote is persisted as a JSONB document with a generated id and
#     a created_at date.
#   - A "note category" is a label/grouping for those notes (an editable lookup
#     list used to tag/filter notes in the UI).
# Note: the solution-note handlers delegate persistence to helper functions in
# data_loader (create/update/delete_solution_note), which return None/False to
# signal "not found".
#
# Endpoints:
#   GET    /api/solution-notes            — list all notes.
#   POST   /api/solution-notes            — create a note.
#   PUT    /api/solution-notes/{note_id}  — update a note.
#   DELETE /api/solution-notes/{note_id}  — delete a note.
#   GET    /api/note-categories           — list all categories.
#   POST   /api/note-categories           — create a category.
#   PUT    /api/note-categories/{cat_id}  — update a category.
#   DELETE /api/note-categories/{cat_id}  — delete a category.
# ─────────────────────────────────────────────────────────────────────────────
import uuid
from datetime import date
from fastapi import APIRouter, HTTPException
from ..models import SolutionNote, SolutionNoteUpdate, NoteCategory, NoteCategoryUpdate
from ..data_loader import (
    load_solution_notes, create_solution_note, update_solution_note, delete_solution_note,
    load_note_categories, create_note_category, update_note_category, delete_note_category,
)

router = APIRouter(tags=["solution-notes"])


# ── Solution Notes ────────────────────────────────────────────────────────────

@router.get("/solution-notes", response_model=list[SolutionNote])
def get_solution_notes():
    """GET /api/solution-notes — list all solution notes.

    Params: none.
    Response: a JSON array of SolutionNote objects (each attached to a node or
    segment).

    Auth: public read endpoint; no token required.
    """
    return load_solution_notes()


@router.post("/solution-notes", response_model=SolutionNote, status_code=201)
def post_solution_note(note: SolutionNote):
    """POST /api/solution-notes — create a solution note.

    Fills in server-side defaults for anything the client left blank: a UUID id
    and today's date as created_at.

    Params: request body is a SolutionNote (id and created_at optional — they
    are auto-assigned when missing).
    Response: the created SolutionNote (HTTP 201).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    # Auto-assign an id and created_at when the client didn't supply them.
    if not note.id:
        note = note.model_copy(update={"id": str(uuid.uuid4())})
    if not note.created_at:
        note = note.model_copy(update={"created_at": date.today().isoformat()})
    return create_solution_note(note)


@router.put("/solution-notes/{note_id}", response_model=SolutionNote)
def put_solution_note(note_id: str, updates: SolutionNoteUpdate):
    """PUT /api/solution-notes/{note_id} — partially update a solution note.

    Params:
      - note_id (path): which note to update.
      - request body: a SolutionNoteUpdate with only the fields to change.
    Response: the updated SolutionNote. Returns HTTP 404 if the id is unknown
    (the data_loader helper returns None to signal that).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    updated = update_solution_note(note_id, updates.model_dump(exclude_unset=True))
    # Helper returns None when the note doesn't exist.
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")
    return updated


@router.delete("/solution-notes/{note_id}", status_code=204)
def del_solution_note(note_id: str):
    """DELETE /api/solution-notes/{note_id} — delete a solution note.

    Params: note_id (path) — which note to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown (the
    helper returns False to signal that).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    if not delete_solution_note(note_id):
        raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")


# ── Note Categories ───────────────────────────────────────────────────────────

@router.get("/note-categories", response_model=list[NoteCategory])
def get_note_categories():
    """GET /api/note-categories — list all note categories.

    Params: none.
    Response: a JSON array of NoteCategory objects (the labels used to group
    solution notes).

    Auth: public read endpoint; no token required.
    """
    return load_note_categories()


@router.post("/note-categories", response_model=NoteCategory, status_code=201)
def post_note_category(cat: NoteCategory):
    """POST /api/note-categories — create a note category.

    Params: request body is a NoteCategory (includes its id).
    Response: the created NoteCategory (HTTP 201). Returns HTTP 409 if a category
    with the same id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    cats = load_note_categories()
    # Reject duplicate ids.
    if any(c.id == cat.id for c in cats):
        raise HTTPException(status_code=409, detail=f"Category '{cat.id}' already exists")
    return create_note_category(cat)


@router.put("/note-categories/{cat_id}", response_model=NoteCategory)
def put_note_category(cat_id: str, updates: NoteCategoryUpdate):
    """PUT /api/note-categories/{cat_id} — partially update a note category.

    Params:
      - cat_id (path): which category to update.
      - request body: a NoteCategoryUpdate with only the fields to change.
    Response: the updated NoteCategory. Returns HTTP 404 if unknown (helper
    returns None).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    updated = update_note_category(cat_id, updates.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")
    return updated


@router.delete("/note-categories/{cat_id}", status_code=204)
def del_note_category(cat_id: str):
    """DELETE /api/note-categories/{cat_id} — delete a note category.

    Params: cat_id (path) — which category to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown
    (helper returns False).

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    if not delete_note_category(cat_id):
        raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")
