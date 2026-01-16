import json
import struct
from pathlib import Path

SRC = Path("special_use_airspace/sua_primitives.json")
IDX = Path("data/sua_catalog.idx")
BIN = Path("data/sua_catalog.bin")

MAGIC = b"SIA1"
VERSION = 1


def fnv1a_32(text):
    h = 0x811C9DC5
    for b in text.encode("utf-8"):
        h ^= b
        h = (h * 0x01000193) & 0xFFFFFFFF
    return h


def to_e6(value):
    return int(round(float(value) * 1_000_000))


def to_cd(value):
    return int(round(float(value) * 100)) & 0xFFFF


def pack_string_table(strings):
    table = bytearray()
    offsets = {}
    for s in strings:
        if s in offsets:
            continue
        offsets[s] = len(table)
        table.extend(s.encode("utf-8"))
        table.append(0)
    return offsets, bytes(table)


def build_geometry(feat, string_offsets):
    props = feat.get("properties", {})
    type_code = (props.get("TYPE_CODE") or "").strip()
    type_off = string_offsets.get(type_code, 0)
    type_len = len(type_code.encode("utf-8"))

    rings = []
    for ring in feat.get("rings", []):
        segments = ring.get("segments", [])
        if segments:
            rings.append(segments)

    geom = bytearray()
    geom.extend(struct.pack("<HHHHI", len(rings), 0, type_len, 0, type_off))

    min_lat = min_lon = 2**31 - 1
    max_lat = max_lon = -(2**31)

    for segments in rings:
        geom.extend(struct.pack("<HH", len(segments), 0))
        for seg in segments:
            seg_type = seg.get("type")
            if seg_type == "LINE":
                s_lat, s_lon = seg["start"]
                e_lat, e_lon = seg["end"]
                geom.extend(struct.pack(
                    "<Biiii",
                    0x01,
                    to_e6(s_lat),
                    to_e6(s_lon),
                    to_e6(e_lat),
                    to_e6(e_lon),
                ))
                for lat, lon in (seg["start"], seg["end"]):
                    min_lat = min(min_lat, to_e6(lat))
                    min_lon = min(min_lon, to_e6(lon))
                    max_lat = max(max_lat, to_e6(lat))
                    max_lon = max(max_lon, to_e6(lon))
            elif seg_type == "ARC":
                s_lat, s_lon = seg["start"]
                e_lat, e_lon = seg["end"]
                c_lat, c_lon = seg["center"]
                radius_m = int(round(float(seg.get("radius_m", 0))))
                start_cd = to_cd(seg.get("start_angle_deg", 0))
                end_cd = to_cd(seg.get("end_angle_deg", 0))
                direction = 1 if str(seg.get("direction", "CCW")).upper() == "CCW" else 0
                geom.extend(struct.pack(
                    "<BiiiiiiIHHB",
                    0x02,
                    to_e6(s_lat),
                    to_e6(s_lon),
                    to_e6(e_lat),
                    to_e6(e_lon),
                    to_e6(c_lat),
                    to_e6(c_lon),
                    radius_m,
                    start_cd,
                    end_cd,
                    direction,
                ))
                for lat, lon in (seg["start"], seg["end"], seg["center"]):
                    min_lat = min(min_lat, to_e6(lat))
                    min_lon = min(min_lon, to_e6(lon))
                    max_lat = max(max_lat, to_e6(lat))
                    max_lon = max(max_lon, to_e6(lon))

    if min_lat == 2**31 - 1:
        min_lat = min_lon = max_lat = max_lon = 0

    return bytes(geom), min_lat, min_lon, max_lat, max_lon


def main():
    data = json.loads(SRC.read_text())
    features = data.get("features", [])

    names = []
    type_codes = []
    for feat in features:
        props = feat.get("properties", {})
        name = (props.get("NAME") or "").strip()
        if not name:
            name = f"OBJECTID-{props.get('OBJECTID', '')}"
        names.append(name)
        type_codes.append((props.get("TYPE_CODE") or "").strip())

    string_offsets, string_table = pack_string_table(names + type_codes)

    idx_entries = []
    geom_blocks = []
    geom_offset = 0

    for feat in features:
        props = feat.get("properties", {})
        name = (props.get("NAME") or "").strip()
        if not name:
            name = f"OBJECTID-{props.get('OBJECTID', '')}"
        name_off = string_offsets.get(name, 0)
        geom, min_lat, min_lon, max_lat, max_lon = build_geometry(feat, string_offsets)
        geom_blocks.append(geom)
        idx_entries.append({
            "name": name,
            "name_offset": name_off,
            "geom_offset": geom_offset,
            "geom_length": len(geom),
            "min_lat": min_lat,
            "min_lon": min_lon,
            "max_lat": max_lat,
            "max_lon": max_lon,
        })
        geom_offset += len(geom)

    bin_header = struct.pack(
        "<4sHHIII",
        MAGIC,
        VERSION,
        0,
        20,
        20 + len(string_table),
        20 + len(string_table) + sum(len(b) for b in geom_blocks),
    )
    BIN.write_bytes(bin_header + string_table + b"".join(geom_blocks))

    idx_header = struct.pack("<4sHHII", MAGIC, VERSION, 32, len(idx_entries), 0)
    idx_data = bytearray()
    for entry in idx_entries:
        id_hash = fnv1a_32(entry["name"].upper())
        idx_data.extend(struct.pack(
            "<IIIIiiii",
            id_hash,
            entry["name_offset"],
            entry["geom_offset"],
            entry["geom_length"],
            entry["min_lat"],
            entry["min_lon"],
            entry["max_lat"],
            entry["max_lon"],
        ))
    IDX.write_bytes(idx_header + idx_data)

    print(f"Wrote {IDX} and {BIN} ({len(idx_entries)} areas)")


if __name__ == "__main__":
    main()
