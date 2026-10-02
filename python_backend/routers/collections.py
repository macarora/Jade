from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
import db

router = APIRouter(prefix="/api/collections", tags=["collections"])

ACCENT_COLORS = [
    "#e07b6b", "#e8b84b", "#8b7fe8", "#5bbfb0",
    "#5ec87a", "#e87b9b", "#7baee8", "#e8a87b",
]


class CollectionCreate(BaseModel):
    name:  str
    color: str | None = None


class CollectionUpdate(BaseModel):
    name:  str | None = None
    color: str | None = None


@router.get("")
def list_collections():
    return db.list_collections()


@router.post("", status_code=201)
def create_collection(body: CollectionCreate):
    existing = db.list_collections()
    color    = body.color or ACCENT_COLORS[len(existing) % len(ACCENT_COLORS)]
    return db.create_collection(body.name, color)


@router.get("/{cid}")
def get_collection(cid: str):
    col = db.get_collection(cid)
    if not col:
        raise HTTPException(404, "Collection not found")
    return col


@router.patch("/{cid}")
def update_collection(cid: str, body: CollectionUpdate):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")
    db.update_collection(cid, body.name, body.color)
    return db.get_collection(cid)


@router.delete("/{cid}", status_code=204)
def delete_collection(cid: str):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")
    db.delete_collection(cid)


@router.get("/{cid}/connections")
def get_connections(cid: str):
    if not db.get_collection(cid):
        raise HTTPException(404, "Collection not found")
    return db.get_connections_for_collection(cid)
