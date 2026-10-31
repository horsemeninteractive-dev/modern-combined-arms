#!/usr/bin/env python3
"""Summarise a Cloudflare heap (allocation) pprof without third-party packages.

Usage:
  python tools/phase2a2-heap-summary.py profile.pprof > heap-summary.json

Cloudflare's heap profile samples a stack trace every 524,288 bytes allocated,
so the numbers here are sampled allocations, not retained heap. Both sample
types are kept: alloc_objects (count) and alloc_space (bytes).
"""

import gzip
import json
import sys
from collections import defaultdict
from pathlib import Path


def varint(buf, index):
    shift = 0
    value = 0
    while True:
        byte = buf[index]
        index += 1
        value |= (byte & 0x7F) << shift
        if not byte & 0x80:
            return value, index
        shift += 7


def fields(buf):
    index = 0
    while index < len(buf):
        key, index = varint(buf, index)
        field = key >> 3
        wire = key & 7
        if wire == 0:
            value, index = varint(buf, index)
        elif wire == 1:
            value = buf[index:index + 8]
            index += 8
        elif wire == 2:
            length, index = varint(buf, index)
            value = buf[index:index + length]
            index += length
        elif wire == 5:
            value = buf[index:index + 4]
            index += 4
        else:
            raise ValueError(f"unsupported protobuf wire type {wire}")
        yield field, wire, value


def packed_u64(buf):
    out = []
    index = 0
    while index < len(buf):
        value, index = varint(buf, index)
        out.append(value)
    return out


def packed_i64(buf):
    # pprof stores Sample.value as int64, encoded as a plain (two's complement)
    # varint. Zigzag decoding here would halve every sample.
    out = []
    index = 0
    while index < len(buf):
        value, index = varint(buf, index)
        if value >= 1 << 63:
            value -= 1 << 64
        out.append(value)
    return out


def main():
    path = Path(sys.argv[1])
    data = path.read_bytes()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)

    strings = []
    functions = {}
    locations = {}
    samples = []
    sample_types = []
    period = None

    for field, wire, value in fields(data):
        if field == 1 and wire == 2:
            type_index = unit_index = None
            for f, w, v in fields(value):
                if f == 1 and w == 0:
                    type_index = v
                elif f == 2 and w == 0:
                    unit_index = v
            sample_types.append((type_index, unit_index))
        elif field == 2 and wire == 2:
            location_ids = []
            values = []
            for f, w, v in fields(value):
                if f == 1:
                    location_ids.extend(packed_u64(v) if w == 2 else [v])
                elif f == 2:
                    values.extend(packed_i64(v) if w == 2 else [v])
            samples.append((location_ids, values))
        elif field == 4 and wire == 2:
            location_id = None
            lines = []
            for f, w, v in fields(value):
                if f == 1 and w == 0:
                    location_id = v
                elif f == 4 and w == 2:
                    function_id = line = None
                    for lf, lw, lv in fields(v):
                        if lf == 1 and lw == 0:
                            function_id = lv
                        elif lf == 2 and lw == 0:
                            line = lv
                    lines.append((function_id, line))
            if location_id is not None:
                locations[location_id] = lines
        elif field == 5 and wire == 2:
            function_id = name_index = filename_index = None
            for f, w, v in fields(value):
                if f == 1 and w == 0:
                    function_id = v
                elif f == 2 and w == 0:
                    name_index = v
                elif f == 4 and w == 0:
                    filename_index = v
            if function_id is not None:
                functions[function_id] = {"nameIndex": name_index, "fileIndex": filename_index}
        elif field == 6 and wire == 2:
            strings.append(value.decode("utf-8", "replace"))
        elif field == 12 and wire == 0:
            period = value

    def resolve(index):
        return strings[index] if index is not None and index < len(strings) else ""

    def function_for(location_id):
        lines = locations.get(location_id) or []
        if not lines:
            return ""
        entry = functions.get(lines[0][0])
        return resolve(entry["nameIndex"]) if entry else ""

    types = [{"type": resolve(t) or "?", "unit": resolve(u) or "?"} for t, u in sample_types]
    per_type_self = [defaultdict(int) for _ in types]
    per_type_inclusive = [defaultdict(int) for _ in types]
    totals = [0 for _ in types]

    for location_ids, values in samples:
        for index in range(min(len(values), len(types))):
            amount = values[index]
            totals[index] += amount
            if location_ids:
                per_type_self[index][function_for(location_ids[0])] += amount
            seen = set()
            for location_id in location_ids:
                name = function_for(location_id)
                if name and name not in seen:
                    seen.add(name)
                    per_type_inclusive[index][name] += amount

    def rows(counter, total):
        return [
            {"function": name, "value": amount, "percent": round(amount / total * 100, 2) if total else 0}
            for name, amount in sorted(counter.items(), key=lambda item: item[1], reverse=True)[:15]
        ]

    result = {
        "source": str(path),
        "bytes": len(data),
        "sampleTypes": types,
        "samplePeriodBytes": period,
        "samples": len(samples),
        "totals": [
            {"type": types[i]["type"], "unit": types[i]["unit"], "value": totals[i], "percentOfSampled": 100.0}
            for i in range(len(types))
        ],
        "bySampleType": [
            {
                "type": types[i]["type"],
                "unit": types[i]["unit"],
                "total": totals[i],
                "topSelf": rows(per_type_self[i], totals[i]),
                "topInclusive": rows(per_type_inclusive[i], totals[i]),
            }
            for i in range(len(types))
        ],
    }
    json.dump(result, sys.stdout, indent=2)
    print()


if __name__ == "__main__":
    main()
