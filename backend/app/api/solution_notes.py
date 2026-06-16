import uuid
from datetime import date
from fastapi import APIRouter, HTTPException
from ..models import SolutionNote, SolutionNoteUpdate, NoteCategory, NoteCategoryUpdate
from ..data_loader import (
    load_solution_notes, save_solution_notes,
    load_note_categories, save_note_categories,
)

router = APIRouter(tags=["solution-notes"])


# ── Solution Notes ────────────────────────────────────────────────────────────

@router.get("/solution-notes", response_model=list[SolutionNote])
def get_solution_notes():
    return load_solution_notes()


@router.post("/solution-notes", response_model=SolutionNote, status_code=201)
def create_solution_note(note: SolutionNote):
    notes = load_solution_notes()
    if not note.id:
        note = note.model_copy(update={"id": str(uuid.uuid4())})
    if not note.created_at:
        note = note.model_copy(update={"created_at": date.today().isoformat()})
    notes.append(note)
    save_solution_notes(notes)
    return note


@router.put("/solution-notes/{note_id}", response_model=SolutionNote)
def update_solution_note(note_id: str, updates: SolutionNoteUpdate):
    notes = load_solution_notes()
    for i, n in enumerate(notes):
        if n.id == note_id:
            updated = n.model_copy(update=updates.model_dump(exclude_unset=True))
            notes[i] = updated
            save_solution_notes(notes)
            return updated
    raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")


@router.delete("/solution-notes/{note_id}", status_code=204)
def delete_solution_note(note_id: str):
    notes = load_solution_notes()
    new_notes = [n for n in notes if n.id != note_id]
    if len(new_notes) == len(notes):
        raise HTTPException(status_code=404, detail=f"Solution note '{note_id}' not found")
    save_solution_notes(new_notes)


# ── Note Categories ───────────────────────────────────────────────────────────

@router.get("/note-categories", response_model=list[NoteCategory])
def get_note_categories():
    return load_note_categories()


@router.post("/note-categories", response_model=NoteCategory, status_code=201)
def create_note_category(cat: NoteCategory):
    cats = load_note_categories()
    if any(c.id == cat.id for c in cats):
        raise HTTPException(status_code=409, detail=f"Category '{cat.id}' already exists")
    cats.append(cat)
    save_note_categories(cats)
    return cat


@router.put("/note-categories/{cat_id}", response_model=NoteCategory)
def update_note_category(cat_id: str, updates: NoteCategoryUpdate):
    cats = load_note_categories()
    for i, c in enumerate(cats):
        if c.id == cat_id:
            updated = c.model_copy(update=updates.model_dump(exclude_unset=True))
            cats[i] = updated
            save_note_categories(cats)
            return updated
    raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")


@router.delete("/note-categories/{cat_id}", status_code=204)
def delete_note_category(cat_id: str):
    cats = load_note_categories()
    new_cats = [c for c in cats if c.id != cat_id]
    if len(new_cats) == len(cats):
        raise HTTPException(status_code=404, detail=f"Category '{cat_id}' not found")
    save_note_categories(new_cats)
