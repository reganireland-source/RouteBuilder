import uuid
from datetime import date
from fastapi import APIRouter, HTTPException
from ..models import Project, ProjectUpdate, ProjectCircuit, SldConfig
from ..data_loader import load_projects, save_projects

router = APIRouter(prefix="/projects", tags=["projects"])


def _now_iso() -> str:
    return date.today().isoformat()


@router.get("", response_model=list[Project])
def get_projects():
    return load_projects()


@router.post("", response_model=Project, status_code=201)
def create_project(project: Project):
    projects = load_projects()
    if any(p.id == project.id for p in projects):
        raise HTTPException(status_code=409, detail=f"Project '{project.id}' already exists")
    now = _now_iso()
    project = project.model_copy(update={"created_at": now, "updated_at": now})
    projects.append(project)
    save_projects(projects)
    return project


@router.put("/{project_id}", response_model=Project)
def update_project(project_id: str, updates: ProjectUpdate):
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
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
    projects = load_projects()
    new_projects = [p for p in projects if p.id != project_id]
    if len(new_projects) == len(projects):
        raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
    save_projects(new_projects)


# ── Circuit management ────────────────────────────────────────────────────────

@router.post("/{project_id}/circuits", response_model=Project, status_code=201)
def add_circuit(project_id: str, circuit: ProjectCircuit):
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
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
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            new_circuits = []
            found = False
            for c in p.circuits:
                if c.circuit_id == circuit_id:
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
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            new_circuits = [c for c in p.circuits if c.circuit_id != circuit_id]
            if len(new_circuits) == len(p.circuits):
                raise HTTPException(status_code=404, detail=f"Circuit '{circuit_id}' not found")
            updated = p.model_copy(update={"circuits": new_circuits, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")


@router.put("/{project_id}/sld-config", response_model=Project)
def update_sld_config(project_id: str, sld_config: SldConfig):
    projects = load_projects()
    for i, p in enumerate(projects):
        if p.id == project_id:
            updated = p.model_copy(update={"sld_config": sld_config, "updated_at": _now_iso()})
            projects[i] = updated
            save_projects(projects)
            return updated
    raise HTTPException(status_code=404, detail=f"Project '{project_id}' not found")
