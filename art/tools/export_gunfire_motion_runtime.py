"""Generate Unity motion documents and serializable types from decoded Gunfire controls."""
from __future__ import annotations

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
TYPES = {
    "System.Single": "float", "System.Double": "double", "System.Int32": "int",
    "System.UInt32": "uint", "System.Boolean": "bool", "UnityEngine.Vector2": "Vector2",
    "UnityEngine.Vector3": "Vector3", "UnityEngine.Vector4": "Vector4",
    "UnityEngine.Quaternion": "Quaternion", "UnityEngine.Color": "Color",
    "UnityEngine.Vector2[]": "Vector2[]", "CameraSettingByGun.SightSetting": "int",
}


def data_class(name: str, class_name: str, fields: list[dict]) -> str:
    lines = ["    [Serializable]", f"    public sealed class {name}", "    {"]
    for field in fields:
        if field["flags"] & 7 != 6:
            continue
        lines.append(f"        public {TYPES[field['type']]} {field['name']};")
    lines.append("    }")
    return "\n".join(lines)


def unity_value(kind: str, value):
    if kind in ("UnityEngine.Vector2", "UnityEngine.Vector3"):
        return dict(zip(("x", "y", "z")[:len(value)], value))
    if kind == "UnityEngine.Vector4" or kind == "UnityEngine.Quaternion":
        return dict(zip(("x", "y", "z", "w"), value))
    if kind == "UnityEngine.Color":
        return dict(zip(("r", "g", "b", "a"), value))
    if kind == "UnityEngine.Vector2[]":
        return [{"x": item[0], "y": item[1]} for item in value]
    return value


def unity_fields(fields: dict, layout: list[dict]) -> dict:
    return {
        field["name"]: unity_value(field["type"], fields[field["name"]])
        for field in layout if field["flags"] & 7 == 6 and field["name"] in fields
    }


def main() -> None:
    layout = json.loads((ROOT / "art/reviews/gunfire-reborn-analysis/weapon-type-layout.json").read_text(encoding="utf-8-sig"))
    controls = json.loads((ROOT / "art/reviews/gunfire-reborn-analysis/weapon-control-data.json").read_text(encoding="utf-8-sig"))
    output = ROOT / "unity/Assets/Resources/Gunfire/Motion"
    output.mkdir(parents=True, exist_ok=True)
    for weapon, data in controls.items():
        components = data["components"]
        document = {
            "motion": next((unity_fields(c["fields"], layout["WeaponMotionCtrl"]) for c in reversed(components) if c["script"] == "WeaponMotionCtrl"), None),
            "camera": next((unity_fields(c["fields"], layout["CameraSettingByGun"]) for c in components if c["script"] == "CameraSettingByGun"), None),
            "normal": next((unity_fields(c["fields"], layout["WeaponNormalCtrl"]) for c in reversed(components) if c["script"] == "WeaponNormalCtrl"), None),
        }
        (output / f"{weapon}.json").write_text(json.dumps(document, ensure_ascii=False, indent=2), encoding="utf-8")
    classes = [
        data_class("GunfireMotionData", "WeaponMotionCtrl", layout["WeaponMotionCtrl"]),
        data_class("GunfireCameraData", "CameraSettingByGun", layout["CameraSettingByGun"]),
        data_class("GunfireNormalData", "WeaponNormalCtrl", layout["WeaponNormalCtrl"]),
        "    [Serializable]\n    public sealed class GunfireWeaponMotionDocument\n    {\n        public GunfireMotionData motion;\n        public GunfireCameraData camera;\n        public GunfireNormalData normal;\n    }",
    ]
    text = "using System;\nusing UnityEngine;\n\nnamespace Spiritfire.Game\n{\n" + "\n\n".join(classes) + "\n}\n"
    (ROOT / "unity/Assets/Game/Scripts/Weapons/GunfireOriginalMotionData.cs").write_text(text, encoding="utf-8")
    print(f"Generated {len(controls)} motion documents and {sum(len(layout[name]) for name in layout)} field definitions")


if __name__ == "__main__":
    main()
