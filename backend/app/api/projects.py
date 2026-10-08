# ─────────────────────────────────────────────────────────────────────────────
# projects.py — Saved solution-design projects and their circuits.
#
# Route prefix: /api/projects  (this router has prefix="/projects"; main.py
# mounts it under "/api", so the paths are /api/projects...).
#
# Domain: a "project" is a saved piece of design work an engineer builds in the
# UI. Each Project is persisted as a JSONB document and contains a list of
# "circuits" (ProjectCircuit — a designed end-to-end connection, typically the
# route(s) chosen for it) plus an optional "sld_config" (Single Line Diagram
# layout settings). created_at/updated_at are stamped server-side (date only)
# on every mutation.
#
# Endpoints:
#   GET    /api/projects                                  — list all projects.
#   POST   /api/projects                                  — create a project.
#   PUT    /api/projects/{project_id}                     — patch a project.
#   DELETE /api/projects/{project_id}                     — delete a project.
#   POST   /api/projects/{project_id}/circuits            — add a circuit.
#   PUT    /api/projects/{project_id}/circuits/{circuit_id} — update a circuit.
#   DELETE /api/projects/{project_id}/circuits/{circuit_id} — remove a circuit.
#   PUT    /api/projects/{project_id}/sld-config          — set the SLD layout.
# ─────────────────────────────────────────────────────────────────────────────
import uuid
from datetime import date
from fastapi import APIRouter, HTTPException
from ..models import Project, ProjectUpdate, ProjectCircuit, SldConfig
from ..data_loader import load_projects, save_projects

router = APIRouter(prefix="/projects", tags=["projects"])


def _now_iso() -> str:
    # Helper: today's date as an ISO string, used to stamp created_at/updated_at.
    return date.today().isoformat()


@router.get("", response_model=list[Project])
def get_projects():
    """GET /api/projects — list all saved projects.

    Params: none.
    Response: a JSON array of Project objects (each with its circuits and
    sld_config).

    Auth: public read endpoint; no token required.
    """
    return load_projects()


@router.post("", response_model=Project, status_code=201)
def create_project(project: Project):
    """POST /api/projects — create a new project.

    Stamps both created_at and updated_at with today's date, then persists the
    project document.

    Params: request body is a Project (includes its id and any initial
    circuits).
    Response: the created Project (HTTP 201). Returns HTTP 409 if a project with
    the same id already exists.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    if any(p.id == project.id for p in projects):
        raise HTTPException(status_code=409, detail=f"Project '{project.id}' already exists")
    now = _now_iso()
    # New project: created_at and updated_at both set to now.
    project = project.model_copy(update={"created_at": now, "updated_at": now})
    projects.append(project)
    save_projects(projects)
    return project


@router.put("/{project_id}", response_model=Project)
def update_project(project_id: str, updates: ProjectUpdate):
    """PUT /api/projects/{project_id} — partially update a project.

    Merges the supplied fields onto the existing project and refreshes
    updated_at.

    Params:
      - project_id (path): which project to update.
      - request body: a ProjectUpdate with only the fields to change.
    Response: the updated Project. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            # Apply only supplied fields, and always bump updated_at.
            updated = p.model_copy(update={
                **updates.model_dump(exclude_unset=True),
                "updated_at": _now_iso(),
            })
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


@router.delete("/{project_id}", status_code=204)
def delete_project(project_id: str):
    """DELETE /api/projects/{project_id} — delete a project.

    Params: project_id (path) — which project to remove.
    Response: empty body, HTTP 204 on success. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    new_projects = [p for p in projects if p.id != project_id]
    # No rows removed => id did not exist.
    if len(new_projects) == len(projects):
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    save_projects(new_projects)


# ── Circuit management ────────────────────────────────────────────────────────
# Circuits live inside a project's "circuits" list. These endpoints mutate that
# nested list and re-save the whole project document each time.

@router.post("/{project_id}/circuits", response_model=Project, status_code=201)
def add_circuit(project_id: str, circuit: ProjectCircuit):
    """POST /api/projects/{project_id}/circuits — add a circuit to a project.

    If the incoming circuit has no circuit_id, one is generated (first 8 chars
    of a UUID). The circuit is appended to the project's circuits list and
    updated_at is bumped.

    Params:
      - project_id (path): the project to add to.
      - request body: a ProjectCircuit (circuit_id optional — auto-assigned if
        blank).
    Response: the whole updated Project (HTTP 201). Returns HTTP 404 if the
    project is unknown, or HTTP 409 if the circuit_id already exists in that
    project.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            # Auto-generate a short circuit_id when the client didn't supply one.
            if not circuit.circuit_id:
                circuit = circuit.model_copy(update={"circuit_id": str(uuid.uuid4())[:8]})
            if any(c.circuit_id == circuit.circuit_id for c in p.circuits):
                raise HTTPException(status_code=409, detail=f"Circuit '{circuit.circuit_id}' already exists in project")
            new_circuits = list(p.circuits) + [circuit]
            updated = p.model_copy(update={"circuits": new_circuits, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


@router.put("/{project_id}/circuits/{circuit_id}", response_model=Project)
def update_circuit(project_id: str, circuit_id: str, circuit: ProjectCircuit):
    """PUT /api/projects/{project_id}/circuits/{circuit_id} — replace a circuit.

    Replaces the matching circuit in the project's circuits list with the
    supplied one (forcing its circuit_id to the path value so it can't be
    changed), and bumps updated_at.

    Params:
      - project_id (path): the project.
      - circuit_id (path): which circuit to replace.
      - request body: the full ProjectCircuit replacement.
    Response: the whole updated Project. Returns HTTP 404 if the project or the
    circuit is not found.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            # Rebuild the list, swapping in the replacement for the matching id.
            new_circuits = []
            found = False
            for c in p.circuits:
                if c.circuit_id == circuit_id:
                    # Force the path circuit_id onto the body so it stays stable.
                    new_circuits.append(circuit.model_copy(update={"circuit_id": circuit_id}))
                    found = True
                else:
                    new_circuits.append(c)
            if not found:
                raise HTTPException(status_code=404, detail=f"Circuit '{circuit_id}' not found")
            updated = p.model_copy(update={"circuits": new_circuits, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


@router.delete("/{project_id}/circuits/{circuit_id}", response_model=Project)
def remove_circuit(project_id: str, circuit_id: str):
    """DELETE /api/projects/{project_id}/circuits/{circuit_id} — remove a circuit.

    Drops the matching circuit from the project's circuits list and bumps
    updated_at. Note: unlike most DELETEs this returns the updated Project (not
    204).

    Params:
      - project_id (path): the project.
      - circuit_id (path): which circuit to remove.
    Response: the whole updated Project. Returns HTTP 404 if the project or the
    circuit is not found.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            new_circuits = [c for c in p.circuits if c.circuit_id != circuit_id]
            # No circuit removed => that circuit_id was not in this project.
            if len(new_circuits) == len(p.circuits):
                raise HTTPException(status_code=404, detail=f"Circuit '{circuit_id}' not found")
            updated = p.model_copy(update={"circuits": new_circuits, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


@router.put("/{project_id}/sld-config", response_model=Project)
def update_sld_config(project_id: str, sld_config: SldConfig):
    """PUT /api/projects/{project_id}/sld-config — set a project's SLD layout.

    Replaces the project's Single Line Diagram configuration (the saved
    layout/styling for its schematic diagram) and bumps updated_at.

    Params:
      - project_id (path): the project.
      - request body: a SldConfig object.
    Response: the whole updated Project. Returns HTTP 404 if unknown.

    Auth: requires the x-admin-token header when ADMIN_KEY is set — enforced
    centrally by the admin_write_guard middleware in app/main.py, not here.
    """
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            updated = p.model_copy(update={"sld_config": sld_config, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
