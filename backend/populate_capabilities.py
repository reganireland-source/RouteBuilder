#!/usr/bin/env python3
"""Bulk-populate NodeCapabilities for all nodes based on owner/type rules."""

import json
import urllib.request
import urllib.error

BASE_URL = "https://routebuilder-production.up.railway.app"

COLO_CAT = {
    "Equinix":        1,
    "DRT":            1,
    "Digital Realty": 1,
    "NEXTDC":         1,
    "Telstra":        4,
}

CLS_CAPS = {
    "backbone": {"ipt": ["1G", "10G", "100G"]},
    "underlay":  {"gid": ["1G", "10G", "100G"]},
}

POP_CAPS = {
    "backbone": {
        "ipt":  ["1G", "10G"],
        "epl":  ["1G", "10G", "100G"],
        "evpl": ["1G"],
    },
    "underlay": {
        "gid":   ["1G", "10G"],
        "ipvpn": ["1G"],
    },
}

def api_get(path):
    req = urllib.request.urlopen(f"{BASE_URL}{path}", timeout=30)
    return json.loads(req.read())

def api_put(path, body):
    data = json.dumps(body).encode()
    req = urllib.request.Request(
        f"{BASE_URL}{path}", data=data, method="PUT",
        headers={"Content-Type": "application/json"},
    )
    try:
        resp = urllib.request.urlopen(req, timeout=30)
        return resp.status, json.loads(resp.read())
    except urllib.error.HTTPError as e:
        return e.code, e.read().decode()

print("Fetching nodes...")
nodes = api_get("/api/nodes")
print(f"  {len(nodes)} nodes found")

ok = skip = fail = 0

for node in nodes:
    ntype = node.get("type")
    owner = node.get("owner", "")

    if ntype == "branching_unit":
        skip += 1
        continue

    # Build capabilities
    import copy
    if ntype == "landing_station":
        caps = copy.deepcopy(CLS_CAPS)
    elif ntype == "terrestrial_pop":
        caps = copy.deepcopy(POP_CAPS)
    else:
        skip += 1
        continue

    cat = COLO_CAT.get(owner)
    if cat:
        caps["colocation"] = {"category": cat}

    status, body = api_put(f"/api/nodes/{node['id']}", {"capabilities": caps})
    if status == 200:
        ok += 1
        print(f"  ✓ {node['id']} ({owner} / {ntype})")
    else:
        fail += 1
        print(f"  ✗ {node['id']} → {status}: {body}")

print(f"\nDone: {ok} updated, {skip} skipped (BUs), {fail} failed")
