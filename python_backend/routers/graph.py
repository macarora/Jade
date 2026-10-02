from fastapi import APIRouter
import db

router = APIRouter(prefix="/api/graph", tags=["graph"])


@router.get("")
def get_collection_graph():
    """Collection nodes + cross-collection edges with per-connection reasons."""
    with db.get_db() as conn:
        nodes = conn.execute(
            "SELECT c.id, c.name, c.color, COUNT(s.id) AS source_count "
            "FROM collections c LEFT JOIN sources s ON s.collection_id=c.id "
            "GROUP BY c.id ORDER BY c.created_at"
        ).fetchall()

        # Pull every cross-collection connection with names and reasons
        raw = conn.execute(
            """SELECT sa.collection_id AS col_a, sb.collection_id AS col_b,
                      sa.name AS name_a, sb.name AS name_b,
                      sc.similarity, sc.reason
               FROM source_connections sc
               JOIN sources sa ON sa.id = sc.source_a_id
               JOIN sources sb ON sb.id = sc.source_b_id
               WHERE sa.collection_id != sb.collection_id
               ORDER BY sc.similarity DESC"""
        ).fetchall()

    # Group by (sorted) collection pair
    edge_map: dict[tuple, dict] = {}
    for row in raw:
        key = tuple(sorted([row["col_a"], row["col_b"]]))
        if key not in edge_map:
            edge_map[key] = {
                "source": key[0],
                "target": key[1],
                "count": 0,
                "max_similarity": 0.0,
                "connections": [],
            }
        e = edge_map[key]
        e["count"] += 1
        if row["similarity"] > e["max_similarity"]:
            e["max_similarity"] = row["similarity"]
        e["connections"].append({
            "source_name": row["name_a"],
            "target_name": row["name_b"],
            "reason": row["reason"] or "",
            "similarity": row["similarity"],
        })

    return {
        "nodes": [dict(n) for n in nodes],
        "edges": list(edge_map.values()),
    }
