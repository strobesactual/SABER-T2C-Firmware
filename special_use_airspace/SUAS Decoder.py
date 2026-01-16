"""
Code to translate the .shp file to a JSON with compact geometry primitives.

Strategy:
- Keep true polygon edges as LINE segments.
- Detect circular arcs and store them as ARC segments (center + radius + angles).

Run with:
conda activate geo_env
python '/Users/austinhulbert/Documents/GitHub/SABER-T2C-Firmware/special_use_airspace/SUAS Decoder.py'
"""

import json
import math
import os
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
from pyogrio import set_gdal_config_options
from pyproj import Transformer
from shapely.geometry import LineString

input_path = '/Users/austinhulbert/Documents/GitHub/SABER-T2C-Firmware/special_use_airspace/Special_Use_Airspace'
output = '/Users/austinhulbert/Documents/GitHub/SABER-T2C-Firmware/special_use_airspace/sua_primitives.json'

# Enable automatic .shx restoration (fixes missing .shx error)
set_gdal_config_options({'SHAPE_RESTORE_SHX': 'YES'})

COLOR = {
    "reset": "\033[0m",
    "green": "\033[32m",
    "yellow": "\033[33m",
    "blue": "\033[34m",
    "red": "\033[31m",
    "bold": "\033[1m",
}

def c(text, color):
    return f"{COLOR.get(color, '')}{text}{COLOR['reset']}"

def log(label, value, label_color="blue", value_color=None, label_width=26):
    label_txt = f"{label:<{label_width}}"
    value_txt = c(str(value), value_color) if value_color else str(value)
    print(c(label_txt, label_color) + value_txt)

print(c("Starting SUAS primitive export...", "bold"))
log("Input path exists?", os.path.exists(input_path), value_color="green")
log("File is readable?", os.access(input_path, os.R_OK), value_color="green")

# Read the file
gdf = gpd.read_file(input_path)
if gdf.crs is not None and gdf.crs.to_string() != "EPSG:4326":
    gdf = gdf.to_crs("EPSG:4326")

# Select only the columns we care about + keep geometry for coord extraction
columns_to_keep = [
    'OBJECTID', 'NAME', 'TYPE_CODE',
    'UPPER_VAL', 'UPPER_UOM', 'LOWER_VAL', 'LOWER_UOM',
    'geometry'
]
gdf = gdf[columns_to_keep]

# Tuning knobs (meters after projection)
SIMPLIFY_TOL_M = 25.0
LINE_TOL_M = 25.0
ARC_TOL_M = 30.0
MIN_ARC_POINTS = 8
MAX_ARC_POINTS = 200


def build_simple_ring_segments(coords_ll):
    segments = []
    n = len(coords_ll)
    if n < 3:
        return segments
    for i in range(n - 1):
        lat1, lon1 = coords_ll[i][1], coords_ll[i][0]
        lat2, lon2 = coords_ll[i + 1][1], coords_ll[i + 1][0]
        segments.append({
            "type": "LINE",
            "start": [lat1, lon1],
            "end": [lat2, lon2],
        })
    return segments


def utm_epsg_for_lon_lat(lon, lat):
    zone = int((lon + 180) // 6) + 1
    return 32600 + zone if lat >= 0 else 32700 + zone


def fit_circle(points):
    if len(points) < 3:
        return None
    x = np.array([p[0] for p in points], dtype=float)
    y = np.array([p[1] for p in points], dtype=float)
    a = np.column_stack([x, y, np.ones_like(x)])
    b = x * x + y * y
    params, _, _, _ = np.linalg.lstsq(a, b, rcond=None)
    cx = params[0] / 2.0
    cy = params[1] / 2.0
    r_sq = params[2] + cx * cx + cy * cy
    if r_sq <= 0:
        return None
    r = math.sqrt(r_sq)
    return cx, cy, r


def mean_circle_residual(points, cx, cy, r):
    d = [abs(math.hypot(p[0] - cx, p[1] - cy) - r) for p in points]
    return sum(d) / len(d) if d else float("inf")


def point_line_distance(p, a, b):
    ax, ay = a
    bx, by = b
    px, py = p
    dx = bx - ax
    dy = by - ay
    if dx == 0 and dy == 0:
        return math.hypot(px - ax, py - ay)
    t = ((px - ax) * dx + (py - ay) * dy) / (dx * dx + dy * dy)
    t = max(0.0, min(1.0, t))
    proj_x = ax + t * dx
    proj_y = ay + t * dy
    return math.hypot(px - proj_x, py - proj_y)


def line_fit_ok(points, tol_m):
    if len(points) < 2:
        return True
    a = points[0]
    b = points[-1]
    return max(point_line_distance(p, a, b) for p in points) <= tol_m


def infer_direction(points):
    cross_sum = 0.0
    for i in range(1, len(points) - 1):
        x1, y1 = points[i - 1]
        x2, y2 = points[i]
        x3, y3 = points[i + 1]
        cross_sum += (x2 - x1) * (y3 - y2) - (y2 - y1) * (x3 - x2)
    return "CCW" if cross_sum > 0 else "CW"


def segment_ring(coords_xy):
    segments = []
    n = len(coords_xy)
    i = 0
    while i < n - 1:
        best_arc = None
        max_j = min(i + MAX_ARC_POINTS, n)
        for j in range(i + MIN_ARC_POINTS, max_j + 1):
            pts = coords_xy[i:j]
            circle = fit_circle(pts)
            if circle is None:
                break
            cx, cy, r = circle
            resid = mean_circle_residual(pts, cx, cy, r)
            if resid <= ARC_TOL_M:
                best_arc = (j, cx, cy, r, resid, pts)
        if best_arc is not None:
            j, cx, cy, r, resid, pts = best_arc
            segments.append({
                "type": "ARC",
                "start_xy": pts[0],
                "end_xy": pts[-1],
                "center_xy": (cx, cy),
                "radius_m": r,
                "direction": infer_direction(pts),
                "fit_rmse_m": resid,
            })
            i = j - 1
            continue

        j = i + 2
        while j <= n and line_fit_ok(coords_xy[i:j], LINE_TOL_M):
            j += 1
        j = max(j - 1, i + 2)
        segments.append({
            "type": "LINE",
            "start_xy": coords_xy[i],
            "end_xy": coords_xy[j - 1],
        })
        i = j - 1
    return segments


features = []
for _, row in gdf.iterrows():
    geom = row.geometry
    if geom is None or geom.is_empty:
        continue
    if geom.geom_type == "MultiPolygon":
        polys = list(geom.geoms)
    else:
        polys = [geom]

    props = row.drop("geometry").to_dict()
    rings = []

    for poly in polys:
        ext_coords = list(poly.exterior.coords)
        if len(ext_coords) < 3:
            continue

        edge_count = len(ext_coords) - 1
        if edge_count <= 10:
            ring_segments = build_simple_ring_segments(ext_coords)
            if ring_segments:
                rings.append({"segments": ring_segments})
            continue

        lon0, lat0 = poly.centroid.x, poly.centroid.y
        utm_epsg = utm_epsg_for_lon_lat(lon0, lat0)
        to_utm = Transformer.from_crs("EPSG:4326", f"EPSG:{utm_epsg}", always_xy=True)
        to_ll = Transformer.from_crs(f"EPSG:{utm_epsg}", "EPSG:4326", always_xy=True)

        coords_xy = [to_utm.transform(coord[0], coord[1]) for coord in ext_coords]
        coords_xy = list(LineString(coords_xy).simplify(SIMPLIFY_TOL_M, preserve_topology=True).coords)
        if len(coords_xy) < 3:
            continue

        segments = segment_ring(coords_xy)
        if segments:
            ring_segments = []
            for seg in segments:
                if seg["type"] == "LINE":
                    s_lon, s_lat = to_ll.transform(*seg["start_xy"])
                    e_lon, e_lat = to_ll.transform(*seg["end_xy"])
                    ring_segments.append({
                        "type": "LINE",
                        "start": [s_lat, s_lon],
                        "end": [e_lat, e_lon],
                    })
                else:
                    s_lon, s_lat = to_ll.transform(*seg["start_xy"])
                    e_lon, e_lat = to_ll.transform(*seg["end_xy"])
                    c_lon, c_lat = to_ll.transform(*seg["center_xy"])
                    start_angle = math.degrees(math.atan2(seg["start_xy"][1] - seg["center_xy"][1],
                                                          seg["start_xy"][0] - seg["center_xy"][0]))
                    end_angle = math.degrees(math.atan2(seg["end_xy"][1] - seg["center_xy"][1],
                                                        seg["end_xy"][0] - seg["center_xy"][0]))
                    ring_segments.append({
                        "type": "ARC",
                        "start": [s_lat, s_lon],
                        "end": [e_lat, e_lon],
                        "center": [c_lat, c_lon],
                        "radius_m": seg["radius_m"],
                        "start_angle_deg": start_angle,
                        "end_angle_deg": end_angle,
                        "direction": seg["direction"],
                        "fit_rmse_m": seg["fit_rmse_m"],
                    })
            rings.append({"segments": ring_segments})

    if rings:
        features.append({"properties": props, "rings": rings})

payload = {
    "generated_at": datetime.now(timezone.utc).isoformat(),
    "source": "FAA Special Use Airspace shapefile",
    "features": features,
}

with open(output, "w", encoding="utf-8") as f:
    json.dump(payload, f, indent=2)

log("JSON saved to:", output, value_color="green")
log("Total airspaces processed:", len(features), label_color="yellow", value_color="yellow")
print(c("Finished SUAS primitive export.", "bold"))
