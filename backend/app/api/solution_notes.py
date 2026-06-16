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
    return load_solution_notes()


@router.post("/solution-notes", response_model=SolutionNote, status_code=201)
def post_solution_note(note: SolutionNote):
    if not note.id:
        note = note.model_copy(update={"id": str(uuid.uuid4())})
    if not note.created_at:
        note = note.model_copy(update={"created_at": date.today().isoformat()})
    return create_solution_note(note)


@router.put("/solution-notes/{note_id}", response_model=SolutionNote)
def put_solution_note(note_id: str, updates: SolutionNoteUpdate):
    updated = update_solution_note(note_id, updates.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")
    return updated


@router.delete("/solution-notes/{note_id}", status_code=204)
def del_solution_note(note_id: str):
    if not delete_solution_note(note_id):
        raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")


# ── Note Categories ───────────────────────────────────────────────────────────

@router.get("/note-categories", response_model=list[NoteCategory])
def get_note_categories():
    return load_note_categories()


@router.post("/note-categories", response_model=NoteCategory, status_code=201)
def post_note_category(cat: NoteCategory):
    cats = load_note_categories()
    if any(c.id == cat.id for c in cats):
        raise HTTPException(status_code=409, detail=f"Category '{cat.id}' already exists")
    return create_note_category(cat)


@router.put("/note-categories/{cat_id}", response_model=NoteCategory)
def put_note_category(cat_id: str, updates: NoteCategoryUpdate):
    updated = update_note_category(cat_id, updates.model_dump(exclude_unset=True))
    if updated is None:
        raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")
    return updated


@router.delete("/note-categories/{cat_id}", status_code=204)
def del_note_category(cat_id: str):
    if not delete_note_category(cat_id):
        raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")
